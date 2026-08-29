import { Suspense, useEffect, useState } from 'react'
import { Canvas }   from '@react-three/fiber'
import { Stats }    from '@react-three/drei'
import Lab          from './scene/Lab'
import Lighting     from './scene/Lighting'
import Player       from './player/Player'
import CableSystem  from './scene/CableSystem'
import HUD          from './components/HUD'
import PointerLockOverlay from './components/PointerLockOverlay'
import InteractionPrompt  from './components/InteractionPrompt'
import CableHUD           from './components/CableHUD'
import TerminalOverlay    from './components/TerminalOverlay'
import PacketSnifferHUD   from './components/PacketSnifferHUD'
import PacketAnimationHUD from './components/PacketAnimationHUD'
import PacketAnimator     from './scene/PacketAnimator'
import ConsoleStation      from './scene/ConsoleStation'
import { ScenariosHUD }     from './components/ScenariosHUD'
import { ProjectMenuHUD }   from './components/ProjectMenuHUD'
import { TopologyEditorHUD } from './components/TopologyEditorHUD'
import { useNetworkStore } from './network/useNetworkStore'
import { NetworkStore }    from './network/NetworkStore'
import './App.css'

/**
 * App — root component.
 *
 * Canvas (3D):
 *   Lighting → Lab → Player → CableSystem
 *
 * 2D overlays:
 *   PointerLockOverlay  — click-to-play
 *   InteractionPrompt   — [E] label
 *   CableHUD            — holding indicator + link list + toasts
 *   TerminalOverlay     — computer screen interface
 *   HUD                 — mission / objectives / crosshair / controls
 */
export default function App() {
  const { isSnifferOpen } = useNetworkStore()

  return (
    <div
      id="app-root"
      className="no-select"
      style={{ width: '100%', height: '100%', position: 'relative' }}
    >
      {/* ── 3D Canvas ──────────────────────────────────────────── */}
      <Canvas
        id="main-canvas"
        shadows="soft"
        camera={{
          fov: 85,
          near: 0.05,
          far: 500,
          position: [0, 1.7, 4.5],
        }}
        gl={{
          antialias: true,
          powerPreference: 'high-performance',
        }}
        style={{ position: 'absolute', inset: 0 }}
      >
        {import.meta.env.DEV && <Stats />}

        <Suspense fallback={null}>
          <Lighting />
          <Lab />
          <Player />
          <CableSystem />
          <PacketAnimator />
        </Suspense>

        {/* Its own boundary: whatever the console station loads must never
            blank the lab behind it. */}
        <Suspense fallback={null}>
          <ConsoleStation />
        </Suspense>
      </Canvas>

      {/* ── 2D Overlays ────────────────────────────────────────── */}
      <PointerLockOverlay />
      <InteractionPrompt />
      <CableHUD />
      <TerminalOverlay />
      <HUD />
      {isSnifferOpen && <PacketSnifferHUD onClose={() => NetworkStore.toggleSniffer()} />}
      <PacketAnimationHUD />
      <ScenariosHUD />
      <ProjectMenuHUD />
      <TopologyEditorHUD />
      <FreeMousIndicator />
    </div>
  )
}

/** Small indicator shown when Ctrl free-mouse mode is active */
function FreeMousIndicator() {
  const [active, setActive] = useState(false)
  useEffect(() => {
    const handler = (e: Event) => setActive((e as CustomEvent).detail.active)
    window.addEventListener('netlab:freemouse', handler)
    return () => window.removeEventListener('netlab:freemouse', handler)
  }, [])
  if (!active) return null
  return (
    <div style={{
      position: 'absolute',
      top: 16,
      left: '50%',
      transform: 'translateX(-50%)',
      background: 'rgba(0,0,0,0.75)',
      border: '1px solid rgba(255,200,0,0.7)',
      color: '#ffd700',
      padding: '5px 16px',
      borderRadius: 6,
      fontFamily: 'var(--font-ui)',
      fontSize: 12,
      letterSpacing: 1,
      pointerEvents: 'none',
      zIndex: 100,
      display: 'flex',
      alignItems: 'center',
      gap: 8,
    }}>
      <span style={{ fontSize: 14 }}>🖱️</span>
      FREE MOUSE — Press <kbd style={{ background: 'rgba(255,200,0,0.2)', border: '1px solid rgba(255,200,0,0.5)', padding: '1px 6px', borderRadius: 3 }}>Ctrl</kbd> or Click to lock
    </div>
  )
}
