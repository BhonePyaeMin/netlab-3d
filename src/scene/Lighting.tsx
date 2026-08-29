/**
 * Lighting.tsx
 *
 * Lighting rig for the NetLab 3D server room.
 *
 * Design intent:
 *  - Dim ambient fill to simulate a server room at night
 *  - Cool-blue hemisphere light (ceiling glow vs dark floor)
 *  - Directional key light with shadows
 *  - Coloured point lights for rack glow effects and mood
 *
 * Phase 1: Full lighting foundation.
 * Future phases: shadow cameras tuned as room grows.
 */
import { useSettingsStore } from '../store/SettingsStore'

export default function Lighting() {
  const { lightBrightness } = useSettingsStore()
  
  return (
    <>
      {/* ── Ambient fill — very dim so point lights dominate ── */}
      <ambientLight intensity={0.08 * lightBrightness} color="#1a2040" />

      {/* ── Hemisphere — ceiling (cool) vs floor (warm) ─────── */}
      <hemisphereLight
        color="#2060c8"
        groundColor="#100808"
        intensity={0.35 * lightBrightness}
      />

      {/* ── Key directional light with shadows ──────────────── */}
      <directionalLight
        position={[8, 12, 6]}
        intensity={1.2 * lightBrightness}
        color="#c8d8ff"
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={0.1}
        shadow-camera-far={60}
        shadow-camera-left={-15}
        shadow-camera-right={15}
        shadow-camera-top={15}
        shadow-camera-bottom={-15}
        shadow-bias={-0.0005}
      />

      {/* ── Fill light (opposite side) ───────────────────────── */}
      <directionalLight
        position={[-6, 8, -4]}
        intensity={0.3 * lightBrightness}
        color="#4060a0"
      />

      {/* ── Overhead fluorescent strips (row of point lights) ── */}
      <pointLight position={[-3, 3.8, 0]}  intensity={18 * lightBrightness} distance={8}  color="#d0e8ff" decay={2} />
      <pointLight position={[ 0, 3.8, 0]}  intensity={18 * lightBrightness} distance={8}  color="#d0e8ff" decay={2} />
      <pointLight position={[ 3, 3.8, 0]}  intensity={18 * lightBrightness} distance={8}  color="#d0e8ff" decay={2} />

      {/* ── Server rack accent glow (cyan) ───────────────────── */}
      <pointLight position={[-5, 1.5, -5]} intensity={40 * lightBrightness} distance={5}  color="#00dcff" decay={2} />
      <pointLight position={[-5, 0.5, -5]} intensity={20 * lightBrightness} distance={3}  color="#00aaff" decay={2} />

      {/* ── Router table accent (purple) ─────────────────────── */}
      <pointLight position={[0, 1.2, -4]}  intensity={25 * lightBrightness} distance={4}  color="#7b61ff" decay={2} />

      {/* ── Floor ambient bounce (warm) ──────────────────────── */}
      <pointLight position={[0, 0.1, 0]}   intensity={5 * lightBrightness}  distance={10} color="#ff8040" decay={2} />
    </>
  )
}
