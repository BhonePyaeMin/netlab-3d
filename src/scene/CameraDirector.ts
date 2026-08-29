/**
 * CameraDirector.ts — arbitration for who owns the camera.
 *
 * The Player hooks drive the camera every frame from mouse-look and physics.
 * When a cinematic takes over (sitting down at the console), the player must
 * stop writing to the camera or the two fight each other and the view jitters.
 *
 * This is a deliberately tiny module rather than part of a bigger store: both
 * Player (inside the Canvas) and the console UI (outside it) read it, and it
 * must not pull either of them into an import cycle.
 */
import * as THREE from 'three'

export interface CameraShot {
  /** Where the camera should end up, world space. */
  position: THREE.Vector3
  /** What it should be looking at, world space. */
  target: THREE.Vector3
}

type Listener = () => void

class CameraDirectorClass {
  /** Non-null while a cinematic owns the camera. */
  private shot: CameraShot | null = null
  private listeners = new Set<Listener>()

  /** Pose to restore when the cinematic ends. */
  private saved: { position: THREE.Vector3; quaternion: THREE.Quaternion } | null = null

  subscribe = (cb: Listener): (() => void) => {
    this.listeners.add(cb)
    return () => { this.listeners.delete(cb) }
  }

  private notify() { this.listeners.forEach(cb => cb()) }

  /** True while a cinematic owns the camera — Player checks this each frame. */
  get active(): boolean { return this.shot !== null }

  getShot(): CameraShot | null { return this.shot }

  /** Remember where the player was standing so the view can be handed back. */
  saveCamera(camera: THREE.Camera) {
    this.saved = {
      position: camera.position.clone(),
      quaternion: camera.quaternion.clone(),
    }
  }

  getSaved() { return this.saved }

  /** Take the camera and fly it to `shot`. */
  begin(shot: CameraShot) {
    this.shot = shot
    this.notify()
  }

  /** Move an in-progress shot (e.g. the laptop was repositioned). */
  update(shot: CameraShot) {
    if (!this.shot) return
    this.shot = shot
    this.notify()
  }

  /** Hand the camera back to the player. */
  end() {
    this.shot = null
    this.notify()
  }
}

export const CameraDirector = new CameraDirectorClass()
