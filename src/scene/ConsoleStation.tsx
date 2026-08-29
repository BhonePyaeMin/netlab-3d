/**
 * ConsoleStation.tsx — the 3D console experience.
 *
 * When a device console opens, the player "sits down": a MacBook Pro is placed
 * on the desk beside that device, its lid swings open, the camera flies to a
 * third-person shot over the typist's shoulder, and the live TerminalSession is
 * projected onto the laptop's display as real DOM. Typing drives the hands, the
 * hands depress the caps, and the caps match the text appearing on screen —
 * all from the same keystroke stream.
 *
 * Two shots are available (V cycles):
 *   shoulder — 3/4 over-the-shoulder, hands and keyboard in frame
 *   screen   — square on the display, for reading long output
 */
import { useEffect, useRef, useState, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import MacBookPro from './macbook/MacBookPro'
import TypingHands from './macbook/TypingHands'
import { CameraDirector } from './CameraDirector'
import { useTerminalSession } from '../components/TerminalScreen'
import { ScreenTexture } from './macbook/ScreenTexture'
import { NetworkStore } from '../network/NetworkStore'
import { ROOM_W, ROOM_D } from './Lab'

/* ── Desk grid, mirrored from Lab.tsx ─────────────────────────────── */
const DESK_XS = [-ROOM_W * 0.25, 0, ROOM_W * 0.25]
const DESK_ZS = [-ROOM_D * 0.1, ROOM_D * 0.25]
const DESK_TOP = 0.75

/** Camera shots, as offsets from the laptop origin in its local frame. */
const SHOTS = {
  shoulder: {
    pos: new THREE.Vector3(0.26, 0.34, 0.46),
    look: new THREE.Vector3(0.01, 0.11, -0.01),
  },
  screen: {
    pos: new THREE.Vector3(0.00, 0.20, 0.34),
    look: new THREE.Vector3(0, 0.135, -0.05),
  },
} as const
type ShotName = keyof typeof SHOTS

const nearest = (v: number, options: number[]) =>
  options.reduce((best, o) => (Math.abs(o - v) < Math.abs(best - v) ? o : best), options[0])

export default function ConsoleStation() {
  const session = useTerminalSession()
  const { camera } = useThree()

  const [shot, setShot] = useState<ShotName>('shoulder')
  const [lid, setLid] = useState(0)
  /** Shared between the hands and the keyboard: keyId → remaining press time. */
  const pressed = useRef<Map<string, number>>(new Map())
  /** Lid open amount, eased every frame; mirrored into state for rendering. */
  const lidRef = useRef(0)
  /** The console, painted into a texture for the display panel. */
  const screen = useMemo(() => new ScreenTexture(), [])
  useEffect(() => () => screen.dispose(), [screen])
  /** Cursor blink phase, advanced on the render clock. */
  const blink = useRef(0)

  const active = session.deviceId !== null && session.view === '3d'

  /* ── Where does the laptop stand? ──────────────────────────────── */
  const placement = useMemo(() => {
    if (!session.deviceId) return null
    const state = NetworkStore.getSnapshot()
    const dev =
      state.devices.find(d => d.id === session.deviceId) ??
      state.dynamicDevices.find(d => d.id === session.deviceId)

    // Fall back to the front-centre desk if the device has no known position.
    const dx = dev?.position?.[0] ?? 0
    const dz = dev?.position?.[2] ?? DESK_ZS[1]

    const deskX = nearest(dx, DESK_XS)
    const deskZ = nearest(dz, DESK_ZS)

    // Sit to the right of the device: the lab spawns coiled cables at
    // deskX - 0.5, so the left side of every desk is already occupied.
    // The desk is 2.2 wide, so +0.55 stays comfortably on the surface.
    return new THREE.Vector3(deskX + 0.55, DESK_TOP + 0.021, deskZ + 0.16)
  }, [session.deviceId])

  /* ── Cinematic camera ──────────────────────────────────────────── */
  useEffect(() => {
    if (active && placement) {
      CameraDirector.saveCamera(camera)
      const s = SHOTS[shot]
      CameraDirector.begin({
        position: placement.clone().add(s.pos),
        target: placement.clone().add(s.look),
      })
    }
    // Releasing the camera is handled by the exit animation below.
  }, [active, placement, camera])

  // Re-aim when the shot changes without re-saving the player's pose.
  useEffect(() => {
    if (!active || !placement || !CameraDirector.active) return
    const s = SHOTS[shot]
    CameraDirector.update({
      position: placement.clone().add(s.pos),
      target: placement.clone().add(s.look),
    })
  }, [shot, active, placement])

  /* ── Camera shot cycling ───────────────────────────────────────
   * Not a letter key: the hidden capture input holds focus the whole time a
   * 3D session is open, so any printable key belongs to the command line.
   */
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'F4') return
      e.preventDefault()
      setShot(s => (s === 'shoulder' ? 'screen' : 'shoulder'))
    }
    const onCycle = () => setShot(s => (s === 'shoulder' ? 'screen' : 'shoulder'))
    window.addEventListener('keydown', onKey)
    window.addEventListener('netlab:cycleShot', onCycle)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('netlab:cycleShot', onCycle)
    }
  }, [active])

  /* ── Lid animation + camera fly ────────────────────────────────── */
  const released = useRef(false)
  useEffect(() => { released.current = false }, [active])

  useFrame((_, delta) => {
    // Lid opens on attach, shuts on detach. Tracked in a ref and pushed to
    // state only when it moves enough to matter, so this doesn't re-render
    // the whole station every frame.
    const goal = active ? 1 : 0
    const next = lidRef.current + (goal - lidRef.current) * (1 - Math.exp(-7 * delta))
    if (Math.abs(next - lidRef.current) > 0.0015) {
      lidRef.current = next
      setLid(next)
    } else if (lidRef.current !== goal) {
      lidRef.current = goal
      setLid(goal)
    }

    // Repaint the display. ScreenTexture no-ops unless something changed, so
    // an idle console costs a string compare per frame.
    if (active) {
      blink.current += delta
      const net = NetworkStore.getSnapshot()
      screen.update({
        session,
        packets: net.capturedPackets,
        capturing: net.capturingCableId !== null,
        cursorOn: blink.current % 1.05 < 0.55,
      })
    }

    const shotNow = CameraDirector.getShot()
    if (shotNow) {
      const k = 1 - Math.exp(-6 * delta)
      camera.position.lerp(shotNow.position, k)
      _target.lerp(shotNow.target, k)
      camera.lookAt(_target)
      return
    }

    // Session ended: ease back to where the player was standing, then let go.
    if (!active && !released.current) {
      const saved = CameraDirector.getSaved()
      if (saved) {
        const k = 1 - Math.exp(-7 * delta)
        camera.position.lerp(saved.position, k)
        camera.quaternion.slerp(saved.quaternion, k)
        if (camera.position.distanceTo(saved.position) < 0.02) released.current = true
      } else {
        released.current = true
      }
    }
  })

  // Hand the camera back the moment the session detaches, so the ease-out
  // above runs against the saved pose rather than a live shot.
  useEffect(() => {
    if (!active && CameraDirector.active) {
      _target.set(0, 0, 0)
      CameraDirector.end()
    }
  }, [active])

  if (!placement) return null

  return (
    <group position={placement} visible={lid > 0.001}>
      <MacBookPro openAmount={lid} powered={active} pressed={pressed}
                   screenMap={active ? screen.texture : null} />

      {active && <TypingHands pressed={pressed} active={active} />}
    </group>
  )
}

const _target = new THREE.Vector3()

