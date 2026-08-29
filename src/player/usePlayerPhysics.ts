/**
 * usePlayerPhysics.ts
 *
 * Simulates player physics: gravity, ground detection, jumping, WASD movement,
 * sprint, and axis-aligned wall collision with the lab room boundaries.
 *
 * Room geometry (from Lab.tsx):
 *   Width  (X): 14  → half = 7
 *   Depth  (Z): 16  → half = 8
 *   Ceiling (Y): 4.5
 *
 * Returns:
 *   applyPhysics(camera, keys, delta) — call inside useFrame
 */
import { useRef } from 'react'
import * as THREE from 'three'

/* ── Player constants ───────────────────────────────────── */
const PLAYER_HEIGHT   = 1.7    // eye height above floor
const MOVE_SPEED      = 5.0    // units / second
const SPRINT_MULT     = 1.8
const JUMP_VELOCITY   = 5.5    // upward velocity on jump
const GRAVITY         = 18.0   // downward acceleration
const FLOOR_Y         = 0.0    // world floor level

/* ── Room boundaries (match Lab.tsx ROOM_W / ROOM_D) ───── */
const ROOM_HALF_W     = 7.6    // ROOM_W(16)/2 − margin
const ROOM_HALF_D     = 8.6    // ROOM_D(18)/2 − margin
const WALL_MARGIN     = 0.3    // how close player can get to a wall

/* ── Reusable vectors (avoid GC pressure) ───────────────── */
const _dir   = new THREE.Vector3()
const _right = new THREE.Vector3()
const _up    = new THREE.Vector3(0, 1, 0)
const _move  = new THREE.Vector3()

export function usePlayerPhysics() {
  const velocityY  = useRef(0)       // vertical velocity for gravity/jump
  const onGround   = useRef(true)    // is player standing on the floor?
  const jumpQueued = useRef(false)   // was Space pressed this frame?

  /**
   * Call once per frame inside useFrame.
   * Mutates camera.position directly.
   */
  const applyPhysics = (
    camera: THREE.Camera,
    keys: Set<string>,
    delta: number,
    isLocked: boolean,
  ) => {
    /* ── Jump input ────────────────────────────────────────── */
    if (keys.has('Space') && onGround.current && !jumpQueued.current) {
      velocityY.current = JUMP_VELOCITY
      onGround.current  = false
      jumpQueued.current = true
    }
    if (!keys.has('Space')) jumpQueued.current = false

    /* ── Gravity ────────────────────────────────────────────── */
    velocityY.current -= GRAVITY * delta

    /* ── Vertical position ──────────────────────────────────── */
    const eyeY = camera.position.y + velocityY.current * delta
    if (eyeY <= FLOOR_Y + PLAYER_HEIGHT) {
      camera.position.y = FLOOR_Y + PLAYER_HEIGHT
      velocityY.current = 0
      onGround.current  = true
    } else {
      camera.position.y = eyeY
    }

    /* ── Horizontal movement (only when locked) ─────────────── */
    if (!isLocked) return

    const fwd     = Number(keys.has('KeyW') || keys.has('ArrowUp'))
                  - Number(keys.has('KeyS') || keys.has('ArrowDown'))
    const strafe  = Number(keys.has('KeyD') || keys.has('ArrowRight'))
                  - Number(keys.has('KeyA') || keys.has('ArrowLeft'))

    if (fwd === 0 && strafe === 0) return

    const speed = (keys.has('ShiftLeft') || keys.has('ShiftRight'))
      ? MOVE_SPEED * SPRINT_MULT
      : MOVE_SPEED

    // Forward = camera direction projected onto XZ plane
    camera.getWorldDirection(_dir)
    _dir.y = 0
    _dir.normalize()

    // Right = cross(forward, up)
    _right.crossVectors(_dir, _up).normalize()

    _move.set(0, 0, 0)
    _move.addScaledVector(_dir,   fwd)
    _move.addScaledVector(_right, strafe)
    if (_move.lengthSq() > 0) _move.normalize()
    _move.multiplyScalar(speed * delta)

    /* ── Axis-separated collision with room walls ───────────── */
    // Try X movement first
    const nextX = camera.position.x + _move.x
    if (Math.abs(nextX) < ROOM_HALF_W - WALL_MARGIN) {
      camera.position.x = nextX
    }

    // Try Z movement independently (slide along walls)
    const nextZ = camera.position.z + _move.z
    if (Math.abs(nextZ) < ROOM_HALF_D - WALL_MARGIN) {
      camera.position.z = nextZ
    }
  }

  return { applyPhysics, onGround, velocityY }
}
