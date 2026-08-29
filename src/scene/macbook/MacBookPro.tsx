/**
 * MacBookPro.tsx — procedural 14" MacBook Pro (M-series form factor).
 *
 * Built entirely from geometry and a generated canvas texture: the site is
 * served from GitHub Pages, so the model cannot depend on a downloaded GLB.
 *
 * Real 14" dimensions are used throughout (312.6 × 221.2 × 15.5 mm, 14.2"
 * display at 3024×1964) so the laptop sits correctly against the 1.7 m eye
 * height and 0.75 m desks already in the lab.
 *
 * Note: the lid is deliberately left unbranded — the shape is generic
 * hardware, but stamping a real company's logo on it would not be.
 */
import { useMemo, useRef, forwardRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { RoundedBox } from '@react-three/drei'
import * as THREE from 'three'
import { KEYS, KEY_TRAVEL, type KeyDef } from './keyboardLayout'

/* ── Dimensions, metres ───────────────────────────────────────────── */
export const MB = {
  width:      0.3126,
  depth:      0.2212,
  baseH:      0.0155,
  lidH:       0.2145,
  lidT:       0.0043,
  /** Active display area of the 14.2" panel. */
  screenW:    0.3025,
  screenH:    0.1965,
  /** Lid tilt back from vertical, radians (~106° open). */
  tilt:       0.30,
  trackpadW:  0.1300,
  trackpadD:  0.0810,
  deckInset:  0.0035,
} as const

/* ── Materials ────────────────────────────────────────────────────── */
const mat = (o: ConstructorParameters<typeof THREE.MeshStandardMaterial>[0]) =>
  new THREE.MeshStandardMaterial(o)

/** Space-black anodised aluminium. */
const MAT_BODY     = mat({ color: '#1b1c1f', roughness: 0.42, metalness: 0.86 })
const MAT_BODY_DK  = mat({ color: '#141518', roughness: 0.50, metalness: 0.80 })
/** Recessed keyboard well — reads darker than the surrounding deck. */
const MAT_WELL     = mat({ color: '#0d0e10', roughness: 0.72, metalness: 0.35 })
const MAT_KEY      = mat({ color: '#141417', roughness: 0.62, metalness: 0.12 })
const MAT_TRACKPAD = mat({ color: '#212328', roughness: 0.16, metalness: 0.35 })
const MAT_BEZEL    = mat({ color: '#070709', roughness: 0.55, metalness: 0.30 })
const MAT_FOOT     = mat({ color: '#0a0a0c', roughness: 0.95, metalness: 0.02 })
const MAT_PORT     = mat({ color: '#08080a', roughness: 0.8,  metalness: 0.5  })
/** Warm keyboard backlight bleeding around the caps. */
const MAT_BACKLIGHT = mat({
  color: '#000000', emissive: '#ffd9a0', emissiveIntensity: 1.5,
  transparent: true, opacity: 0.5, roughness: 1,
})
/** Display when the machine is asleep. */
const MAT_SCREEN_OFF = mat({
  color: '#05070b', roughness: 0.22, metalness: 0.1,
  emissive: '#050a12', emissiveIntensity: 0.6,
})
/** Display while a session is live — the DOM screen sits just in front. */
const MAT_SCREEN_ON = mat({
  color: '#02040a', roughness: 0.25, metalness: 0.05,
  emissive: '#0a1826', emissiveIntensity: 1.1,
})

/* ── Key legend texture ───────────────────────────────────────────── */

/** Bounding box of the keyboard well, derived from the layout. */
export const KEY_BOUNDS = (() => {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
  for (const k of KEYS) {
    minX = Math.min(minX, k.x - k.w / 2); maxX = Math.max(maxX, k.x + k.w / 2)
    minZ = Math.min(minZ, k.z - k.d / 2); maxZ = Math.max(maxZ, k.z + k.d / 2)
  }
  const pad = 0.004
  return { minX: minX - pad, maxX: maxX + pad, minZ: minZ - pad, maxZ: maxZ + pad,
           w: maxX - minX + pad * 2, d: maxZ - minZ + pad * 2 }
})()

/**
 * All key legends drawn into one canvas, applied as a single decal plane over
 * the caps. One draw call instead of ~80 text meshes; at 1 mm of key travel
 * the legend not sinking with the cap is imperceptible.
 */
function makeLegendTexture(): THREE.CanvasTexture {
  const PX_PER_M = 6000
  const cw = Math.round(KEY_BOUNDS.w * PX_PER_M)
  const ch = Math.round(KEY_BOUNDS.d * PX_PER_M)

  const canvas = document.createElement('canvas')
  canvas.width = cw
  canvas.height = ch
  const ctx = canvas.getContext('2d')!

  ctx.clearRect(0, 0, cw, ch)
  ctx.fillStyle = '#e9e9ee'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  for (const k of KEYS) {
    if (!k.label) continue
    const px = ((k.x - KEY_BOUNDS.minX) / KEY_BOUNDS.w) * cw
    const py = ((k.z - KEY_BOUNDS.minZ) / KEY_BOUNDS.d) * ch

    // Single characters get the big centred glyph; words are set smaller and
    // bottom-left, the way modifier caps are actually printed.
    const isGlyph = k.label.length === 1
    const size = isGlyph ? ch * 0.030 : ch * 0.020
    ctx.font = `${isGlyph ? 500 : 400} ${size}px "SF Pro Display", "Helvetica Neue", Arial, sans-serif`

    if (isGlyph || k.w < 0.03) {
      ctx.textAlign = 'center'
      ctx.fillText(k.label, px, py)
    } else {
      ctx.textAlign = 'left'
      const left = ((k.x - k.w / 2 - KEY_BOUNDS.minX) / KEY_BOUNDS.w) * cw
      ctx.fillText(k.label, left + ch * 0.012, py + (k.d > 0.015 ? ch * 0.012 : 0))
    }
  }

  const tex = new THREE.CanvasTexture(canvas)
  tex.anisotropy = 8
  tex.colorSpace = THREE.SRGBColorSpace
  tex.needsUpdate = true
  return tex
}

/* ── Key caps ─────────────────────────────────────────────────────── */

export interface KeyPressState {
  /** keyId → seconds remaining in the press animation. */
  current: Map<string, number>
}

/** Duration of a single cap depression, seconds. */
const PRESS_TIME = 0.11

function KeyCaps({ pressed }: { pressed: React.RefObject<Map<string, number>> }) {
  const group = useRef<THREE.Group>(null)
  const meshes = useRef<Record<string, THREE.Mesh>>({})

  useFrame((_, delta) => {
    const map = pressed.current
    if (!map) return
    for (const [id, remaining] of map) {
      const mesh = meshes.current[id]
      const next = remaining - delta
      if (next <= 0) {
        map.delete(id)
        if (mesh) mesh.position.y = 0
        continue
      }
      map.set(id, next)
      if (!mesh) continue
      // Ease down then back up over the press window.
      const t = 1 - next / PRESS_TIME
      const depth = Math.sin(t * Math.PI)
      mesh.position.y = -depth * KEY_TRAVEL
    }
  })

  return (
    <group ref={group}>
      {KEYS.map((k: KeyDef) => (
        <mesh
          key={k.id}
          ref={(el) => { if (el) meshes.current[k.id] = el }}
          position={[k.x, 0, k.z]}
          material={MAT_KEY}
        >
          <boxGeometry args={[k.w, 0.0028, k.d]} />
        </mesh>
      ))}
    </group>
  )
}

/* ── Component ────────────────────────────────────────────────────── */

interface Props {
  /** 0 = shut, 1 = fully open. */
  openAmount?: number
  /** Display is lit (a session is attached). */
  powered?: boolean
  /** Map of keyId → remaining press time, mutated by TypingHands. */
  pressed: React.RefObject<Map<string, number>>
  /** Live console painted onto the display. Absent = asleep. */
  screenMap?: THREE.Texture | null
}

/**
 * Origin is the centre of the laptop's footprint, on the desk surface.
 * The lid hinges at the back edge (−Z) and the user sits at +Z.
 */
const MacBookPro = forwardRef<THREE.Group, Props>(function MacBookPro(
  { openAmount = 1, powered = false, pressed, screenMap = null }, ref,
) {
  const legend = useMemo(makeLegendTexture, [])
  const lidRef = useRef<THREE.Group>(null)

  // Deck height: top of the base, where keys and trackpad sit.
  const deckY = MB.baseH

  useFrame(() => {
    if (lidRef.current) {
      // Sweep from shut (lying flat on the base) to the open tilt.
      lidRef.current.rotation.x = -(Math.PI / 2) * (1 - openAmount) - MB.tilt * openAmount
    }
  })

  return (
    <group ref={ref}>
      {/* ── Unibody base ─────────────────────────────────────── */}
      <RoundedBox
        args={[MB.width, MB.baseH, MB.depth]}
        radius={0.0032}
        smoothness={3}
        position={[0, MB.baseH / 2, 0]}
        material={MAT_BODY}
        castShadow
        receiveShadow
      />

      {/* Rubber feet */}
      {([[-1, -1], [1, -1], [-1, 1], [1, 1]] as [number, number][]).map(([sx, sz], i) => (
        <mesh key={i}
              position={[sx * (MB.width / 2 - 0.022), 0.0008, sz * (MB.depth / 2 - 0.016)]}
              material={MAT_FOOT}>
          <cylinderGeometry args={[0.0045, 0.0045, 0.0016, 12]} />
        </mesh>
      ))}

      {/* ── Keyboard well ────────────────────────────────────── */}
      <mesh position={[0, deckY - 0.0011, (KEY_BOUNDS.minZ + KEY_BOUNDS.maxZ) / 2]}
            material={MAT_WELL} receiveShadow>
        <boxGeometry args={[KEY_BOUNDS.w, 0.0022, KEY_BOUNDS.d]} />
      </mesh>

      {/* Backlight bleed under the caps */}
      {powered && (
        <mesh position={[0, deckY + 0.0002, (KEY_BOUNDS.minZ + KEY_BOUNDS.maxZ) / 2]}
              rotation={[-Math.PI / 2, 0, 0]} material={MAT_BACKLIGHT}>
          <planeGeometry args={[KEY_BOUNDS.w - 0.002, KEY_BOUNDS.d - 0.002]} />
        </mesh>
      )}

      {/* Key caps + legends */}
      <group position={[0, deckY + 0.0016, 0]}>
        <KeyCaps pressed={pressed} />
        <mesh position={[0, 0.0016, (KEY_BOUNDS.minZ + KEY_BOUNDS.maxZ) / 2]}
              rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[KEY_BOUNDS.w, KEY_BOUNDS.d]} />
          <meshBasicMaterial map={legend} transparent depthWrite={false} />
        </mesh>
      </group>

      {/* Speaker grilles either side of the keyboard */}
      {([-1, 1] as const).map(side => (
        <mesh key={side}
              position={[side * (MB.width / 2 - 0.021), deckY - 0.0005,
                         (KEY_BOUNDS.minZ + KEY_BOUNDS.maxZ) / 2]}
              material={MAT_BODY_DK}>
          <boxGeometry args={[0.026, 0.0012, KEY_BOUNDS.d * 0.86]} />
        </mesh>
      ))}

      {/* ── Trackpad ─────────────────────────────────────────── */}
      <mesh position={[0, deckY - 0.0004, MB.depth / 2 - MB.trackpadD / 2 - 0.014]}
            material={MAT_TRACKPAD} receiveShadow>
        <boxGeometry args={[MB.trackpadW, 0.0012, MB.trackpadD]} />
      </mesh>

      {/* ── Ports ────────────────────────────────────────────── */}
      {/* Left: MagSafe + 2× Thunderbolt */}
      {[-0.052, -0.020, 0.012].map((z, i) => (
        <mesh key={`l${i}`} position={[-MB.width / 2 + 0.0012, MB.baseH / 2, z]}
              material={MAT_PORT}>
          <boxGeometry args={[0.0026, 0.0032, i === 0 ? 0.010 : 0.0086]} />
        </mesh>
      ))}
      {/* Right: HDMI + SD + Thunderbolt */}
      {[-0.044, -0.010, 0.020].map((z, i) => (
        <mesh key={`r${i}`} position={[MB.width / 2 - 0.0012, MB.baseH / 2, z]}
              material={MAT_PORT}>
          <boxGeometry args={[0.0026, 0.0036, i === 0 ? 0.015 : 0.0095]} />
        </mesh>
      ))}

      {/* Soft key light so the deck, hands and body read against the very
          dark lab — the screen glow alone leaves the shot almost unlit. */}
      {powered && (
        <>
          <pointLight position={[0.16, 0.30, 0.26]} intensity={0.42}
                      distance={1.6} decay={2} color="#cfe4ff" />
          <pointLight position={[-0.22, 0.18, 0.30]} intensity={0.20}
                      distance={1.2} decay={2} color="#ffd2a8" />
        </>
      )}

      {/* ── Lid ──────────────────────────────────────────────── */}
      <group ref={lidRef} position={[0, MB.baseH, -MB.depth / 2 + 0.004]}>
        {/* Panel — extends along +Y from the hinge */}
        <RoundedBox
          args={[MB.width, MB.lidH, MB.lidT]}
          radius={0.0030}
          smoothness={3}
          position={[0, MB.lidH / 2, -MB.lidT / 2]}
          material={MAT_BODY}
          castShadow
        />

        {/* Bezel */}
        <mesh position={[0, MB.lidH / 2, 0.0002]} material={MAT_BEZEL}>
          <planeGeometry args={[MB.width - 0.006, MB.lidH - 0.006]} />
        </mesh>

        {/* Display surface. A basic (unlit) material is deliberate — a real
            panel emits its own light and must not be shaded by the room. */}
        <mesh position={[0, MB.lidH / 2 - 0.0035, 0.0006]}>
          <planeGeometry args={[MB.screenW, MB.screenH]} />
          {powered && screenMap
            ? <meshBasicMaterial map={screenMap} toneMapped={false} />
            : <primitive object={powered ? MAT_SCREEN_ON : MAT_SCREEN_OFF} attach="material" />}
        </mesh>

        {/* Notch — a tab of bezel intruding into the top of the panel */}
        <mesh position={[0, MB.lidH - 0.0075, 0.0009]} material={MAT_BEZEL}>
          <planeGeometry args={[0.0325, 0.0085]} />
        </mesh>
        {/* Camera pinhole in the notch */}
        <mesh position={[0, MB.lidH - 0.0075, 0.0012]}>
          <circleGeometry args={[0.0011, 12]} />
          <meshStandardMaterial color="#05050a" roughness={0.2} metalness={0.6}
                                emissive="#0a1a2a" emissiveIntensity={0.7} />
        </mesh>

        {/* Screen glow spilling onto the deck and the typist */}
        {powered && (
          <pointLight position={[0, MB.lidH / 2, 0.06]} intensity={0.9}
                      distance={1.1} decay={2} color="#7fd8ff" />
        )}
      </group>
    </group>
  )
})

export default MacBookPro
