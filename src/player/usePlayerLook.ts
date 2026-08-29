/**
 * usePlayerLook.ts
 *
 * Handles first-person mouse look (yaw + pitch) from raw mouse delta events.
 *
 * Returns:
 *   applyLook(camera) — call each frame to apply accumulated rotation
 *
 * Uses refs (not state) — zero re-renders for mouse movement.
 * Rotation order: YXZ to prevent gimbal lock on the Y (yaw) axis.
 */
import { useEffect, useRef, useCallback } from 'react'
import * as THREE from 'three'
import { SettingsStore } from '../store/SettingsStore'

const MAX_PITCH     = Math.PI / 2.05  // ~87°, prevents flipping

const _euler = new THREE.Euler(0, 0, 0, 'YXZ')

export function usePlayerLook(isLocked: boolean) {
  const yaw   = useRef(0)    // horizontal rotation (Y)
  const pitch = useRef(0)    // vertical rotation   (X)
  const locked = useRef(isLocked)

  // Keep ref in sync without needing re-subscribe
  useEffect(() => { locked.current = isLocked }, [isLocked])

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!locked.current) return
      
      const sens = SettingsStore.getState().mouseSensitivity
      yaw.current   -= e.movementX * sens
      pitch.current -= e.movementY * sens
      pitch.current  = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, pitch.current))
    }

    document.addEventListener('mousemove', onMouseMove)
    return () => document.removeEventListener('mousemove', onMouseMove)
  }, [])

  /** Call inside useFrame to apply current yaw/pitch to the camera. */
  const applyLook = useCallback((camera: THREE.Camera) => {
    _euler.set(pitch.current, yaw.current, 0)
    camera.rotation.copy(_euler)
  }, [])

  /** Set initial yaw (e.g. to face into the room). MUST be wrapped in useCallback to prevent Player re-mounting loop! */
  const setYaw = useCallback((rad: number) => { yaw.current = rad }, [])

  return { applyLook, setYaw }
}
