import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useSettingsStore } from '../store/SettingsStore'

/* ============================================================
   PLAYER CONTROLLER — First-person WASD + mouse look
   
   Controls:
     WASD / Arrow Keys  — move
     Shift              — sprint
     Ctrl (hold/toggle) — free mouse cursor mode
     ESC                — release mouse (browser default)
   ============================================================ */

const MOVE_SPEED      = 5.0
const SPRINT_MULT     = 1.8
const PLAYER_HEIGHT   = 1.7
const ROOM_HALF_W     = 6.5
const ROOM_HALF_D     = 7.5
const BOUNDARY_MARGIN = 0.4

// Smooth look interpolation — lower = smoother, higher = snappier
const LOOK_SMOOTH     = 0.18

const YXZ  = new THREE.Euler(0, 0, 0, 'YXZ')
const keys = new Set<string>()

export default function PlayerController() {
  const { camera, gl } = useThree()
  const { mouseSensitivity } = useSettingsStore()

  const yaw         = useRef(0)
  const pitch       = useRef(0)
  const targetYaw   = useRef(0)
  const targetPitch = useRef(0)
  const isLocked    = useRef(false)
  const freeMouse   = useRef(false)  // Ctrl-key free cursor mode

  useEffect(() => {
    const canvas = gl.domElement

    /* ── Pointer lock state ───────────────────────────────── */
    const onLockChange = () => {
      isLocked.current = document.pointerLockElement === canvas
      // If pointer lock was released externally (ESC), exit free-mouse mode too
      if (!isLocked.current && !freeMouse.current) {
        // Normal ESC release — nothing extra needed
      }
    }

    /* ── Mouse look (only when locked) ───────────────────── */
    const onMouseMove = (e: MouseEvent) => {
      if (!isLocked.current) return
      const sens = mouseSensitivity ?? 0.0018
      targetYaw.current   -= e.movementX * sens
      targetPitch.current -= e.movementY * sens
      targetPitch.current  = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, targetPitch.current))
    }

    /* ── Ctrl key — toggle free mouse cursor mode ─────────── */
    let cliIsOpen = false
    const onCliOpen  = () => { cliIsOpen = true }
    const onCliClose = () => { cliIsOpen = false }

    const onKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

      keys.add(e.code)

      // Ctrl (Left or Right) → toggle free mouse mode
      if ((e.code === 'ControlLeft' || e.code === 'ControlRight') && !cliIsOpen) {
        e.preventDefault()
        if (!freeMouse.current) {
          // Enter free-mouse mode: exit pointer lock, show cursor
          freeMouse.current = true
          if (document.pointerLockElement) document.exitPointerLock()
          canvas.style.cursor = 'default'
          window.dispatchEvent(new CustomEvent('netlab:freemouse', { detail: { active: true } }))
        } else {
          // Exit free-mouse mode: re-lock pointer
          freeMouse.current = false
          canvas.style.cursor = 'none'
          window.dispatchEvent(new CustomEvent('netlab:freemouse', { detail: { active: false } }))
          canvas.requestPointerLock()
        }
      }
    }

    const onKeyUp = (e: KeyboardEvent) => {
      keys.delete(e.code)
    }

    /* ── Click to (re-)lock — only when NOT in CLI or free-mouse ── */
    const requestLock = () => {
      if (!isLocked.current && !cliIsOpen && !freeMouse.current) {
        canvas.requestPointerLock()
      } else if (freeMouse.current && !cliIsOpen) {
        // Clicking while in free-mouse mode exits it and re-locks
        freeMouse.current = false
        canvas.style.cursor = 'none'
        window.dispatchEvent(new CustomEvent('netlab:freemouse', { detail: { active: false } }))
        canvas.requestPointerLock()
      }
    }

    /* ── Attach listeners ─────────────────────────────────── */
    document.addEventListener('click',            requestLock)
    document.addEventListener('pointerlockchange', onLockChange)
    document.addEventListener('mousemove',         onMouseMove)
    window .addEventListener('keydown',            onKeyDown)
    window .addEventListener('keyup',              onKeyUp)
    window .addEventListener('netlab:openCLI',    onCliOpen)
    window .addEventListener('netlab:closeCLI',   onCliClose)

    /* Start inside the lab, facing the server rack */
    camera.position.set(0, PLAYER_HEIGHT, 4.5)
    YXZ.set(0, Math.PI, 0)  // face inward toward the rack
    camera.rotation.copy(YXZ)
    yaw.current         = Math.PI
    pitch.current       = 0
    targetYaw.current   = Math.PI
    targetPitch.current = 0

    return () => {
      document.removeEventListener('click',            requestLock)
      document.removeEventListener('pointerlockchange', onLockChange)
      document.removeEventListener('mousemove',         onMouseMove)
      window .removeEventListener('keydown',            onKeyDown)
      window .removeEventListener('keyup',              onKeyUp)
      window .removeEventListener('netlab:openCLI',    onCliOpen)
      window .removeEventListener('netlab:closeCLI',   onCliClose)
      keys.clear()
    }
  }, [camera, gl, mouseSensitivity])

  /* ── Per-frame camera & movement update ──────────────────── */
  useFrame((_, delta) => {
    // Smooth interpolate yaw/pitch toward target values
    yaw.current   += (targetYaw.current   - yaw.current)   * Math.min(1, LOOK_SMOOTH + delta * 8)
    pitch.current += (targetPitch.current - pitch.current) * Math.min(1, LOOK_SMOOTH + delta * 8)

    YXZ.set(pitch.current, yaw.current, 0)
    camera.rotation.copy(YXZ)

    // Only move when pointer is locked (not in free-mouse mode)
    if (!isLocked.current) return

    const forward = Number(keys.has('KeyW') || keys.has('ArrowUp'))
                  - Number(keys.has('KeyS') || keys.has('ArrowDown'))
    const strafe  = Number(keys.has('KeyD') || keys.has('ArrowRight'))
                  - Number(keys.has('KeyA') || keys.has('ArrowLeft'))

    if (forward === 0 && strafe === 0) return

    const speed = (keys.has('ShiftLeft') || keys.has('ShiftRight'))
      ? MOVE_SPEED * SPRINT_MULT
      : MOVE_SPEED

    const dir = new THREE.Vector3()
    camera.getWorldDirection(dir)
    dir.y = 0
    dir.normalize()

    const right = new THREE.Vector3()
    right.crossVectors(dir, new THREE.Vector3(0, 1, 0))

    const move = new THREE.Vector3()
    move.addScaledVector(dir,   forward)
    move.addScaledVector(right, strafe)
    if (move.lengthSq() > 0) move.normalize()
    move.multiplyScalar(speed * delta)

    const next = camera.position.clone().add(move)
    next.x = Math.max(-(ROOM_HALF_W - BOUNDARY_MARGIN), Math.min(ROOM_HALF_W - BOUNDARY_MARGIN, next.x))
    next.z = Math.max(-(ROOM_HALF_D - BOUNDARY_MARGIN), Math.min(ROOM_HALF_D - BOUNDARY_MARGIN, next.z))
    next.y = PLAYER_HEIGHT

    camera.position.copy(next)
  })

  return null
}
