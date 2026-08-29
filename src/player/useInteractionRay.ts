/**
 * useInteractionRay.ts
 *
 * Raycasts from the camera centre (crosshair) each frame to detect
 * interactable objects within reach.  Exposes the closest hit object
 * and fires onInteract() when the player presses E.
 *
 * Interactable objects must have userData.interactable = true  and
 * userData.label = string (e.g. "Open Router1").
 *
 *   hitLabel      — string | null  (what the crosshair is pointing at)
 *   hitObject     — THREE.Object3D | null
 *   applyRaycast  — call inside useFrame(camera, scene)
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { SettingsStore } from '../store/SettingsStore'

const MAX_REACH   = 3.5        // maximum interaction distance (units)
const _raycaster  = new THREE.Raycaster()
const _center     = new THREE.Vector2(0, 0)  // screen centre

export function useInteractionRay(
  keys: React.RefObject<Set<string>>,
  isLocked: boolean,
) {
  const [hitLabel,  setHitLabel]  = useState<string | null>(null)
  const [hitObject, setHitObject] = useState<THREE.Object3D | null>(null)

  const eWasDown   = useRef(false)
  const pWasDown   = useRef(false)
  const dWasDown   = useRef(false)
  const cWasDown   = useRef(false)
  const lockedRef  = useRef(isLocked)

  useEffect(() => { lockedRef.current = isLocked }, [isLocked])

  /** Call inside useFrame — updates hit state each frame. */
  const applyRaycast = useCallback((
    camera: THREE.Camera,
    scene:  THREE.Scene,
  ) => {
    if (!lockedRef.current) {
      if (hitLabel) setHitLabel(null)
      if (hitObject) setHitObject(null)
      return
    }

    // Cast ray from camera centre into scene
    _raycaster.setFromCamera(_center, camera)
    _raycaster.far = MAX_REACH

    const hits = _raycaster.intersectObjects(scene.children, true)

    // Walk up the hierarchy to find an interactable ancestor
    let found: THREE.Object3D | null = null
    for (const hit of hits) {
      let obj: THREE.Object3D | null = hit.object
      while (obj) {
        if (obj.userData?.interactable) { found = obj; break }
        obj = obj.parent
      }
      if (found) break
    }

    const newLabel = found ? (found.userData.label as string) ?? 'Interact' : null

    if (newLabel !== hitLabel)  setHitLabel(newLabel)
    if (found   !== hitObject)  setHitObject(found)

    // Interaction key (E) — fire interaction on leading edge (press, not hold)
    const interactCode = `Key${SettingsStore.getState().interactKey}`
    const interactDown = keys.current?.has(interactCode) ?? false
    if (interactDown && !eWasDown.current && found) {
      found.userData.onInteract?.()
    }
    eWasDown.current = interactDown

    // Secondary key (P - Pick Up)
    const pickupCode = `Key${SettingsStore.getState().pickUpKey}`
    const pickupDown = keys.current?.has(pickupCode) ?? false
    if (pickupDown && !pWasDown.current && found) {
      found.userData.onSecondaryAction?.()
    }
    pWasDown.current = pickupDown

    // Tertiary key (D - Disconnect)
    const disconnectCode = `Key${SettingsStore.getState().disconnectKey}`
    const disconnectDown = keys.current?.has(disconnectCode) ?? false
    if (disconnectDown && !dWasDown.current && found) {
      found.userData.onDisconnectAction?.()
    }
    dWasDown.current = disconnectDown

    // Connect key (C - Connect)
    const connectCode = `Key${SettingsStore.getState().connectKey}`
    const connectDown = keys.current?.has(connectCode) ?? false
    if (connectDown && !cWasDown.current && found) {
      found.userData.onConnectAction?.()
    }
    cWasDown.current = connectDown

  }, [hitLabel, hitObject, keys])

  return { hitLabel, hitObject, applyRaycast }
}
