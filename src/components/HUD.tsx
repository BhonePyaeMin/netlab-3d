/* ============================================================
   HUD — 2D overlay on top of the 3D canvas.

   Phase 1+: mission panel, objectives, crosshair, controls.
   Later phases will wire these to live game state via Zustand.
   ============================================================ */

import { NetworkStore } from '../network/NetworkStore'
import { useNetworkStore } from '../network/useNetworkStore'
import { SimulationControlsHUD } from './SimulationControlsHUD'
import { EventLogHUD } from './EventLogHUD'

const CONTROLS = [
  { key: 'W A S D', desc: 'Move' },
  { key: 'Mouse',   desc: 'Look' },
  { key: 'Shift',   desc: 'Sprint' },
  { key: 'Ctrl',    desc: 'Free Mouse' },
  { key: 'P',       desc: 'Pick Up' },
  { key: 'C',       desc: 'Connect' },
  { key: 'E',       desc: 'Open CLI' },
  { key: 'G',       desc: 'Drop' },
  { key: 'ESC',     desc: 'Release' },
]

/** Top-left mission panel */
function MissionPanel() {
  return (
    <div
      id="hud-mission"
      className="hud-panel"
      style={{
        position: 'absolute',
        top: 16,
        left: 16,
        minWidth: 220,
        maxWidth: 300,
      }}
    >
      <div style={{ fontSize: 10, letterSpacing: 2, color: 'var(--color-accent-dim)', marginBottom: 6, textTransform: 'uppercase' }}>
        Current Mission
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', marginBottom: 10 }}>
        Phase 1 — Lab Orientation
      </div>
      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
        Explore the networking laboratory.<br />
        Walk around with <strong style={{ color: '#fff' }}>W A S D</strong>.
      </div>
    </div>
  )
}

/** Top-right objectives panel */
function ObjectivesPanel() {
  const objectives = [
    { label: 'Step 1: Enter the lab environment',                                  done: true },
    { label: 'Step 2: Look at devices/cables and press P to Pick Up',              done: false },
    { label: 'Step 3: Press G to drop held items on the desk or floor',            done: false },
    { label: 'Step 4: While holding a cable, press C to connect it to a port',     done: false },
    { label: 'Step 5: Look at a Switch or Router and press E to open CLI',         done: false },
  ]

  return (
    <div
      id="hud-objectives"
      className="hud-panel"
      style={{
        position: 'absolute',
        top: 16,
        right: 16,
        minWidth: 220,
        maxWidth: 280,
      }}
    >
      <div style={{ fontSize: 10, letterSpacing: 2, color: 'var(--color-accent-dim)', marginBottom: 8, textTransform: 'uppercase' }}>
        Objectives
      </div>
      <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 5 }}>
        {objectives.map((obj, i) => (
          <li key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
            <span
              style={{
                fontSize: 14,
                color: obj.done ? 'var(--color-success)' : 'var(--color-text-dim)',
                flexShrink: 0,
              }}
            >
              {obj.done ? '✓' : '○'}
            </span>
            <span style={{ color: obj.done ? 'var(--color-success)' : 'var(--color-text-muted)' }}>
              {obj.label}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Crosshair — ring + dot in the centre of the screen */
function Crosshair() {
  return (
    <div
      id="hud-crosshair"
      style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        pointerEvents: 'none',
      }}
    >
      {/* Outer ring */}
      <div style={{
        width: 20,
        height: 20,
        border: '1.5px solid rgba(0,220,255,0.5)',
        borderRadius: '50%',
        position: 'absolute',
        top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
      }} />
      {/* Centre dot */}
      <div style={{
        width: 3,
        height: 3,
        background: 'var(--color-accent)',
        borderRadius: '50%',
        boxShadow: '0 0 6px var(--color-accent)',
        position: 'absolute',
        top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
      }} />
    </div>
  )
}

/** Bottom-right controls legend */
function ControlsLegend() {
  return (
    <div
      id="hud-controls"
      style={{
        position: 'absolute',
        bottom: 16,
        right: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        pointerEvents: 'none',
      }}
    >
      {CONTROLS.map(({ key, desc }) => (
        <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
          <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{desc}</span>
          <kbd
            style={{
              fontSize: 10,
              fontFamily: 'var(--font-mono)',
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: 4,
              padding: '2px 6px',
              color: 'var(--color-text)',
              minWidth: 44,
              textAlign: 'center',
            }}
          >
            {key}
          </kbd>
        </div>
      ))}
    </div>
  )
}

/** Bottom-left score / status bar */
function StatusBar() {
  const toggleSniffer = () => {
    import('../network/NetworkStore').then(mod => {
      mod.NetworkStore.toggleSniffer()
    })
  }

  const toggleAnimation = () => {
    import('../network/NetworkStore').then(mod => {
      const state = mod.NetworkStore.getSnapshot()
      mod.NetworkStore.setAnimationMode(!state.animationMode)
    })
  }

  const toggleScenarios = () => {
    import('../network/NetworkStore').then(mod => {
      mod.NetworkStore.toggleScenarios()
    })
  }

  const toggleProjectMenu = () => {
    import('../network/NetworkStore').then(mod => {
      mod.NetworkStore.toggleProjectMenu()
    })
  }

  return (
    <div
      id="hud-statusbar"
      className="hud-panel"
      style={{
        position: 'absolute',
        bottom: 16,
        left: 16,
        display: 'flex',
        gap: 20,
        padding: '8px 14px',
        fontSize: 11,
      }}
    >
      <div>
        <span style={{ color: 'var(--color-text-muted)' }}>Score </span>
        <span style={{ color: 'var(--color-accent)', fontWeight: 700 }}>0</span>
      </div>
      <div>
        <span style={{ color: 'var(--color-text-muted)' }}>Time </span>
        <span style={{ color: 'var(--color-text)', fontWeight: 600 }}>00:00</span>
      </div>
      <div>
        <span style={{ color: 'var(--color-text-muted)' }}>Phase </span>
        <span style={{ color: 'var(--color-warning)', fontWeight: 600 }}>1</span>
      </div>
      <button 
        onClick={toggleSniffer}
        style={{
          marginLeft: 20,
          background: 'rgba(0, 220, 255, 0.1)',
          border: '1px solid rgba(0, 220, 255, 0.4)',
          color: '#00dcff',
          padding: '4px 12px',
          borderRadius: 4,
          cursor: 'pointer',
          pointerEvents: 'auto',
          fontSize: 12,
          fontFamily: 'var(--font-ui)',
          letterSpacing: 1
        }}
      >
        🦈 Packet Sniffer
      </button>

      <button 
        onClick={toggleAnimation}
        style={{
          marginLeft: 10,
          background: 'rgba(231, 76, 60, 0.1)',
          border: '1px solid rgba(231, 76, 60, 0.4)',
          color: '#e74c3c',
          padding: '4px 12px',
          borderRadius: 4,
          cursor: 'pointer',
          pointerEvents: 'auto',
          fontSize: 12,
          fontFamily: 'var(--font-ui)',
          letterSpacing: 1
        }}
      >
        ⏯ Animation Mode
      </button>

      <button 
        onClick={toggleScenarios}
        style={{
          marginLeft: 10,
          background: 'rgba(46, 204, 113, 0.1)',
          border: '1px solid rgba(46, 204, 113, 0.4)',
          color: '#2ecc71',
          padding: '4px 12px',
          borderRadius: 4,
          cursor: 'pointer',
          pointerEvents: 'auto',
          fontSize: 12,
          fontFamily: 'var(--font-ui)',
          letterSpacing: 1
        }}
      >
        🛠 Scenarios
      </button>

      <button 
        onClick={toggleProjectMenu}
        style={{
          marginLeft: 10,
          background: 'rgba(155, 89, 182, 0.1)',
          border: '1px solid rgba(155, 89, 182, 0.4)',
          color: '#9b59b6',
          padding: '4px 12px',
          borderRadius: 4,
          cursor: 'pointer',
          pointerEvents: 'auto',
          fontSize: 12,
          fontFamily: 'var(--font-ui)',
          letterSpacing: 1
        }}
      >
        📁 Project
      </button>

      <button 
        onClick={() => NetworkStore.toggleTopologyEditor()}
        style={{
          marginLeft: 10,
          background: 'rgba(52, 152, 219, 0.1)',
          border: '1px solid rgba(52, 152, 219, 0.4)',
          color: '#3498db',
          padding: '4px 12px',
          borderRadius: 4,
          cursor: 'pointer',
          pointerEvents: 'auto',
          fontSize: 12,
          fontFamily: 'var(--font-ui)',
          letterSpacing: 1
        }}
      >
        🗺️ Editor
      </button>
    </div>
  )
}

/* ============================================================
   MAIN HUD EXPORT
   ============================================================ */

export default function HUD() {
  return (
    <div
      id="hud-root"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 10,
        fontFamily: 'var(--font-ui)',
      }}
    >
      {/* TerminalOverlay and PointerLockOverlay are mounted by App, which is
          the composition root. Rendering them here too stacked a second copy
          of each inside this pointer-events:none / z-index:10 container, so
          the console appeared twice and swallowed keystrokes. */}
      <SimulationControlsHUD />
      <EventLogHUD />
      <MissionPanel />
      <ObjectivesPanel />
      <Crosshair />
      <ControlsLegend />
      <StatusBar />
    </div>
  )
}
