/**
 * TypingHands.tsx — procedural hands that type what you type.
 *
 * Every keystroke in the console emits `netlab:keystroke`. This component
 * resolves the character to a physical cap on the MacBook layout, looks up
 * which finger a touch typist would actually use for it, and drives that
 * finger to the key with two-bone IK — then depresses the cap itself, so the
 * hands and the keyboard and the text on screen all agree.
 *
 * Hands live in the laptop's local space, so they follow it wherever the
 * console station places it.
 */
import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import {
  KEY_BY_ID, resolveKey, fingerFor, homeKey,
  type Hand, type FingerIndex, type KeyDef,
} from './keyboardLayout'
import { MB } from './MacBookPro'

/* ── Anatomy, metres ──────────────────────────────────────────────── */
const SEG1 = 0.034   // knuckle → middle joint
const SEG2 = 0.030   // middle joint → fingertip
const THUMB1 = 0.030
const THUMB2 = 0.026

/** Finger thickness tapers from index to pinky. */
const RADIUS: Record<FingerIndex, number> = { 0: 0.0095, 1: 0.0082, 2: 0.0082, 3: 0.0076, 4: 0.0066 }

/** Knuckle offsets from the palm centre, in laptop space (x right, z toward user). */
const KNUCKLES: Record<FingerIndex, [number, number, number]> = {
  0: [-0.031, -0.007, 0.010],   // thumb — lower, inboard, further back
  1: [-0.020, 0.001, -0.026],
  2: [-0.005, 0.002, -0.029],
  3: [0.010, 0.001, -0.027],
  4: [0.024, -0.001, -0.022],
}

/** Resting height of the palm above the deck. */
const PALM_Y = 0.030
/** Knuckle row sits this far in front of the home row. */
const PALM_Z = 0.056
/** Horizontal offset of each palm from the keyboard centre. */
const PALM_X = 0.052

/** Skin is kept fairly dark: the station key lights are close and would
 *  otherwise blow a lighter tone out to flat white. */
const MAT_SKIN = new THREE.MeshStandardMaterial({
  color: '#9c6f55', roughness: 0.82, metalness: 0.01,
})
const MAT_SKIN_DK = new THREE.MeshStandardMaterial({
  color: '#8a6049', roughness: 0.85, metalness: 0.01,
})
/** Shirt sleeve. Bare forearms ended in an abrupt cut on the desk and caught
 *  the key light as two bright tubes; clothing recedes into the dark room. */
const MAT_SLEEVE = new THREE.MeshStandardMaterial({
  color: '#1d2431', roughness: 0.92, metalness: 0.03,
})
const MAT_CUFF = new THREE.MeshStandardMaterial({
  color: '#2a3446', roughness: 0.88, metalness: 0.05,
})

/** Heel-down tilt and inward yaw of the palm, radians. */
const PALM_PITCH = -0.22
const PALM_YAW = 0.14

const PRESS_TIME = 0.11
/** How far the fingertip dips below hover height when striking. */
const STRIKE_DEPTH = 0.006
const HOVER_Y = 0.010

/* ── Per-finger runtime state ─────────────────────────────────────── */

interface FingerState {
  /** Key the finger is currently reaching for; null = home position. */
  targetKey: KeyDef
  /** Seconds remaining in the strike animation. */
  press: number
  /** Smoothed fingertip position, laptop space. */
  tip: THREE.Vector3
}

const _v1 = new THREE.Vector3()
const _v2 = new THREE.Vector3()
const _axis = new THREE.Vector3()
const _up = new THREE.Vector3(0, 1, 0)
const _q = new THREE.Quaternion()
const _dir = new THREE.Vector3()

/** Orient a unit-height cylinder to span from `a` to `b`. */
function span(mesh: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3) {
  _dir.subVectors(b, a)
  const len = _dir.length() || 1e-5
  mesh.position.copy(a).addScaledVector(_dir, 0.5)
  _q.setFromUnitVectors(_up, _dir.divideScalar(len))
  mesh.quaternion.copy(_q)
  mesh.scale.set(1, len, 1)
}

/**
 * Two-bone IK: place the middle joint so the chain reaches `target`.
 * Of the two mirrored solutions we take the one that lifts the joint, which is
 * how a finger actually bends.
 */
function solveJoint(
  knuckle: THREE.Vector3, target: THREE.Vector3, l1: number, l2: number,
  out: THREE.Vector3,
) {
  _v1.subVectors(target, knuckle)
  const d = Math.min(_v1.length(), l1 + l2 - 1e-4) || 1e-4
  _v1.normalize()

  // Angle between the first bone and the straight line to the target.
  const cosA = THREE.MathUtils.clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1)
  const a = Math.acos(cosA)

  // Rotate the direction about an axis perpendicular to it and to world up.
  _axis.crossVectors(_v1, _up)
  if (_axis.lengthSq() < 1e-8) _axis.set(1, 0, 0)
  _axis.normalize()

  _v2.copy(_v1).applyAxisAngle(_axis, a)
  const lifted = _v2.y
  _v2.copy(_v1).applyAxisAngle(_axis, -a)
  if (_v2.y < lifted) _v2.copy(_v1).applyAxisAngle(_axis, a)

  out.copy(knuckle).addScaledVector(_v2, l1)
}

/* ── One hand ─────────────────────────────────────────────────────── */

function HandRig({ hand, state }: { hand: Hand; state: React.RefObject<FingerState[]> }) {
  const palmRef = useRef<THREE.Group>(null)
  const boneRefs = useRef<Record<string, THREE.Mesh>>({})
  const jointRefs = useRef<Record<string, THREE.Mesh>>({})

  const sign = hand === 'L' ? -1 : 1
  const basePalm = new THREE.Vector3(sign * PALM_X, MB.baseH + PALM_Y, PALM_Z)
  const palmPos = useRef(basePalm.clone())
  const knuckle = new THREE.Vector3()
  const joint = new THREE.Vector3()

  useFrame((_, delta) => {
    const fingers = state.current
    if (!fingers) return

    const k = 1 - Math.exp(-22 * delta)   // frame-rate independent smoothing

    // The palm drifts toward whatever the fingers are reaching for, so distant
    // keys move the whole hand rather than stretching a finger to breaking.
    let sumX = 0, sumZ = 0
    for (let f = 0; f < 5; f++) {
      const home = homeKey(hand, f as FingerIndex)
      sumX += fingers[f].targetKey.x - home.x
      sumZ += fingers[f].targetKey.z - home.z
    }
    const driftX = (sumX / 5) * 0.55
    const driftZ = (sumZ / 5) * 0.55
    palmPos.current.lerp(
      _v1.set(basePalm.x + driftX, basePalm.y, basePalm.z + driftZ), k,
    )
    if (palmRef.current) palmRef.current.position.copy(palmPos.current)

    for (let f = 0; f < 5; f++) {
      const fs = fingers[f]
      const isThumb = f === 0
      const l1 = isThumb ? THUMB1 : SEG1
      const l2 = isThumb ? THUMB2 : SEG2

      // Strike depth: dips to the cap at the middle of the press window.
      let y = MB.baseH + HOVER_Y
      if (fs.press > 0) {
        fs.press = Math.max(0, fs.press - delta)
        const t = 1 - fs.press / PRESS_TIME
        y -= Math.sin(t * Math.PI) * STRIKE_DEPTH
      }

      fs.tip.lerp(_v2.set(fs.targetKey.x, y, fs.targetKey.z), k)

      // Knuckle spread is mirrored for the left hand so both thumbs face inward.
      const off = KNUCKLES[f as FingerIndex]
      knuckle.set(
        palmPos.current.x + (hand === 'L' ? -off[0] : off[0]),
        palmPos.current.y + off[1],
        palmPos.current.z + off[2],
      )

      solveJoint(knuckle, fs.tip, l1, l2, joint)

      const b1 = boneRefs.current[`${f}a`]
      const b2 = boneRefs.current[`${f}b`]
      const j = jointRefs.current[`${f}`]
      const tipMesh = jointRefs.current[`${f}t`]
      if (b1) span(b1, knuckle, joint)
      if (b2) span(b2, joint, fs.tip)
      if (j) j.position.copy(joint)
      if (tipMesh) tipMesh.position.copy(fs.tip)
    }
  })

  return (
    <group>
      {/* Palm + forearm — positioned each frame.
          The palm is tilted heel-down so the knuckles ride above the keys, and
          yawed slightly inward, which is how hands actually sit on a keyboard. */}
      <group ref={palmRef} rotation={[PALM_PITCH, hand === 'L' ? PALM_YAW : -PALM_YAW, 0]}>
        <mesh material={MAT_SKIN} castShadow>
          <boxGeometry args={[0.062, 0.019, 0.052]} />
        </mesh>
        {/* Heel of the hand, rounding off the back of the palm */}
        <mesh position={[0, -0.002, 0.028]} material={MAT_SKIN}>
          <sphereGeometry args={[0.022, 12, 10]} />
        </mesh>
        {/* Wrist, then the forearm running back past the desk edge. Angled
            slightly down and outward so it reads as an arm rather than a tube
            resting on the desk. */}
        <mesh position={[0, -0.004, 0.046]} rotation={[Math.PI / 2, 0, 0]}
              material={MAT_SKIN} castShadow>
          <cylinderGeometry args={[0.017, 0.019, 0.040, 14]} />
        </mesh>
        {/* Cuff, then the sleeved forearm heading off past the desk edge. */}
        <mesh position={[hand === 'L' ? -0.005 : 0.005, -0.008, 0.072]}
              rotation={[Math.PI / 2 - 0.10, 0, 0]}
              material={MAT_CUFF} castShadow>
          <cylinderGeometry args={[0.021, 0.023, 0.024, 14]} />
        </mesh>
        <mesh position={[hand === 'L' ? -0.014 : 0.014, -0.020, 0.170]}
              rotation={[Math.PI / 2 - 0.13, 0, hand === 'L' ? -0.10 : 0.10]}
              material={MAT_SLEEVE} castShadow>
          <cylinderGeometry args={[0.023, 0.032, 0.200, 14]} />
        </mesh>
      </group>

      {/* Finger bones — world-space, driven by IK */}
      {[0, 1, 2, 3, 4].map(f => (
        <group key={f}>
          <mesh ref={el => { if (el) boneRefs.current[`${f}a`] = el }} material={MAT_SKIN} castShadow>
            <cylinderGeometry args={[RADIUS[f as FingerIndex], RADIUS[f as FingerIndex] * 0.94, 1, 10]} />
          </mesh>
          <mesh ref={el => { if (el) boneRefs.current[`${f}b`] = el }} material={MAT_SKIN} castShadow>
            <cylinderGeometry args={[RADIUS[f as FingerIndex] * 0.9, RADIUS[f as FingerIndex] * 0.78, 1, 10]} />
          </mesh>
          <mesh ref={el => { if (el) jointRefs.current[`${f}`] = el }} material={MAT_SKIN_DK}>
            <sphereGeometry args={[RADIUS[f as FingerIndex] * 0.95, 10, 8]} />
          </mesh>
          <mesh ref={el => { if (el) jointRefs.current[`${f}t`] = el }} material={MAT_SKIN}>
            <sphereGeometry args={[RADIUS[f as FingerIndex] * 0.8, 10, 8]} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

/* ── Both hands + the keystroke bus ───────────────────────────────── */

interface Props {
  /** Shared with MacBookPro: keyId → remaining press time. */
  pressed: React.RefObject<Map<string, number>>
  /** Hands only type while a session is attached. */
  active: boolean
}

function initialFingers(hand: Hand): FingerState[] {
  return ([0, 1, 2, 3, 4] as FingerIndex[]).map(f => {
    const home = homeKey(hand, f)
    return {
      targetKey: home,
      press: 0,
      tip: new THREE.Vector3(home.x, MB.baseH + HOVER_Y, home.z),
    }
  })
}

export default function TypingHands({ pressed, active }: Props) {
  const left  = useRef<FingerState[]>(initialFingers('L'))
  const right = useRef<FingerState[]>(initialFingers('R'))
  /** Timers that return each finger home after a strike. */
  const homeTimers = useRef<Map<string, number>>(new Map())

  useEffect(() => {
    if (!active) return

    const onKey = (e: Event) => {
      const { key, shift } = (e as CustomEvent).detail as { key: string; shift?: boolean }
      const stroke = resolveKey(key)
      if (!stroke) return

      const strike = (keyId: string) => {
        const def = KEY_BY_ID[keyId]
        if (!def) return
        const { hand, finger } = fingerFor(keyId)
        const fingers = hand === 'L' ? left.current : right.current
        fingers[finger].targetKey = def
        fingers[finger].press = PRESS_TIME
        pressed.current?.set(keyId, PRESS_TIME)
        homeTimers.current.set(`${hand}${finger}`, 0.30)
      }

      strike(stroke.keyId)

      // A shifted character means the *other* hand's pinky is holding shift.
      if (stroke.shift || shift) {
        const { hand } = fingerFor(stroke.keyId)
        strike(hand === 'L' ? 'rshift' : 'lshift')
      }
    }

    window.addEventListener('netlab:keystroke', onKey)
    return () => window.removeEventListener('netlab:keystroke', onKey)
  }, [active, pressed])

  // Return fingers to the home row a moment after their last strike.
  useFrame((_, delta) => {
    for (const [id, remaining] of homeTimers.current) {
      const next = remaining - delta
      if (next > 0) { homeTimers.current.set(id, next); continue }
      homeTimers.current.delete(id)
      const hand = id[0] as Hand
      const finger = Number(id[1]) as FingerIndex
      const fingers = hand === 'L' ? left.current : right.current
      fingers[finger].targetKey = homeKey(hand, finger)
    }
  })

  return (
    <group>
      <HandRig hand="L" state={left} />
      <HandRig hand="R" state={right} />
    </group>
  )
}
