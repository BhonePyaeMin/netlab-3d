/**
 * Player.tsx
 *
 * Assembles all player hooks into a single R3F component placed inside
 * the Canvas.  Drives the PerspectiveCamera and publishes interaction
 * state to the InteractionPrompt HUD via a shared atom / context.
 *
 * Architecture:
 *   Player
 *   ├── useKeyboard       — key state ref
 *   ├── usePointerLock    — pointer lock state
 *   ├── usePlayerLook     — mouse → yaw/pitch → camera rotation
 *   ├── usePlayerPhysics  — gravity / jump / WASD / wall collision
 *   └── useInteractionRay — crosshair raycast / E-key interaction
 *
 * Published globals (window.__netlab) for HUD components that live
 * outside the Canvas context (avoids prop drilling / zustand for now).
 */
import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useKeyboard }         from '../hooks/useKeyboard'
import { usePointerLock }      from '../hooks/usePointerLock'
import { usePlayerLook }       from './usePlayerLook'
import { usePlayerPhysics }    from './usePlayerPhysics'
import { useInteractionRay }   from './useInteractionRay'

/* Starting position — inside the lab, facing the equipment wall */
const START_POS: [number, number, number] = [0, 1.7, 7.5]
const START_YAW = Math.PI   // face toward negative Z (into the room)

export default function Player() {
  const { camera, gl, scene } = useThree()

  /* ── Canvas element ref for pointer lock ──────────────── */
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  useEffect(() => {
    canvasRef.current = gl.domElement as HTMLCanvasElement
  }, [gl])

  /* ── Hooks ────────────────────────────────────────────── */
  const keys                        = useKeyboard()
  const { isLocked }                = usePointerLock(canvasRef)
  const { applyLook, setYaw }       = usePlayerLook(isLocked)
  const { applyPhysics }            = usePlayerPhysics()
  const { hitLabel, applyRaycast }  = useInteractionRay(keys, isLocked)

  /* ── Initialise camera position ───────────────────────── */
  useEffect(() => {
    camera.position.set(...START_POS)
    setYaw(START_YAW)
  }, [camera, setYaw])

  /* ── Publish hitLabel for HUD ─────────────────────────── */
  useEffect(() => {
    // Simple global pub so HUD (outside canvas) can read it
    ;(window as Window & { __netlab?: Record<string, unknown> }).__netlab ??= {}
    ;(window as Window & { __netlab?: Record<string, unknown> }).__netlab!.hitLabel = hitLabel
    // Dispatch a custom event so the HUD can react
    window.dispatchEvent(new CustomEvent('netlab:interaction', { detail: { hitLabel } }))
  }, [hitLabel])

  /* ── Per-frame update ─────────────────────────────────── */
  useFrame((_, delta) => {
    applyLook(camera)
    applyPhysics(camera, keys.current!, delta, isLocked)
    applyRaycast(camera, scene)
  })

  return null  // no 3D mesh — only drives the camera
}
