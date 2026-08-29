/**
 * PointerLockOverlay.tsx
 *
 * Full-screen "Click to Play" overlay shown when the mouse is NOT locked.
 * Disappears as soon as pointer lock is acquired.
 *
 * Click handler calls canvas.requestPointerLock() directly as a backup
 * (the document-level listener in usePointerLock also handles it).
 */
import { useEffect, useState } from 'react'
import { SettingsStore, useSettingsStore } from '../store/SettingsStore'

export default function PointerLockOverlay() {
  const [locked, setLocked] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [cliOpen, setCliOpen] = useState(false)
  const [freeMouse, setFreeMouse] = useState(false)
  
  const { mouseSensitivity, lightBrightness, interactKey, pickUpKey } = useSettingsStore()

  useEffect(() => {
    const onChange = () => {
      const isLocked = !!document.pointerLockElement
      setLocked(isLocked)
      if (isLocked) setShowSettings(false)
    }
    document.addEventListener('pointerlockchange', onChange)
    return () => document.removeEventListener('pointerlockchange', onChange)
  }, [])

  // Hide this overlay while the CLI terminal is open or Ctrl free-mouse is active
  useEffect(() => {
    const onOpen      = () => setCliOpen(true)
    const onClose     = () => setCliOpen(false)
    const onFreeMouse = (e: Event) => setFreeMouse((e as CustomEvent).detail.active)
    window.addEventListener('netlab:openCLI',  onOpen)
    window.addEventListener('netlab:closeCLI', onClose)
    window.addEventListener('netlab:freemouse', onFreeMouse)
    return () => {
      window.removeEventListener('netlab:openCLI',  onOpen)
      window.removeEventListener('netlab:closeCLI', onClose)
      window.removeEventListener('netlab:freemouse', onFreeMouse)
    }
  }, [])

  const handleClick = (e: React.MouseEvent) => {
    // If clicking on settings UI, don't lock pointer
    if ((e.target as HTMLElement).closest('.settings-panel')) return
    if ((e.target as HTMLElement).closest('.settings-btn')) return

    const canvas = document.querySelector('canvas')
    if (canvas && !document.pointerLockElement) canvas.requestPointerLock()
  }

  if (locked || cliOpen || freeMouse) return null

  return (
    <div
      id="pointer-lock-overlay"
      onClick={handleClick}
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 3, 10, 0.85)',
        backdropFilter: 'blur(8px)',
        zIndex: 20,
        cursor: 'pointer',
      }}
    >
      <style>{`
        @keyframes pulse-ring {
          0%,100% { transform: scale(1);    opacity: 0.8; }
          50%      { transform: scale(1.12); opacity: 0.4; }
        }
        @keyframes fade-in-up {
          from { opacity: 0; transform: translateY(20px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* Settings Button */}
      <button 
        className="settings-btn"
        onClick={() => setShowSettings(!showSettings)}
        style={{
          position: 'absolute',
          top: 24,
          right: 24,
          background: 'rgba(0,220,255,0.1)',
          border: '1px solid rgba(0,220,255,0.4)',
          color: '#00dcff',
          padding: '8px 16px',
          borderRadius: 6,
          fontFamily: 'var(--font-ui)',
          cursor: 'pointer',
          transition: 'all 0.2s'
        }}
      >
        ⚙️ Settings
      </button>

      {showSettings ? (
        <div 
          className="settings-panel"
          style={{
            animation: 'fade-in-up 0.2s ease-out',
            background: 'rgba(0, 10, 25, 0.9)',
            border: '1px solid rgba(0,220,255,0.4)',
            padding: 32,
            borderRadius: 12,
            width: 400,
            cursor: 'default'
          }}
        >
          <h2 style={{ color: '#fff', fontFamily: 'var(--font-ui)', marginTop: 0 }}>Settings</h2>
          
          <div style={{ marginBottom: 24 }}>
            <label style={{ display: 'flex', justifyContent: 'space-between', color: '#00dcff', fontFamily: 'var(--font-ui)', marginBottom: 8 }}>
              Interact Key <span>{interactKey}</span>
            </label>
            <select
              value={interactKey}
              onChange={e => SettingsStore.update({ interactKey: e.target.value })}
              style={{ width: '100%', background: 'rgba(0,20,40,0.8)', color: '#fff', border: '1px solid rgba(0,220,255,0.4)', padding: '8px', borderRadius: '6px' }}
            >
              <option value="E">E</option>
              <option value="F">F</option>
              <option value="Q">Q</option>
              <option value="C">C</option>
            </select>
          </div>

          <div style={{ marginBottom: 24 }}>
            <label style={{ display: 'flex', justifyContent: 'space-between', color: '#00dcff', fontFamily: 'var(--font-ui)', marginBottom: 8 }}>
              Mouse Sensitivity <span>{(mouseSensitivity * 1000).toFixed(1)}</span>
            </label>
            <input 
              type="range" 
              min="0.0005" max="0.005" step="0.0001" 
              value={mouseSensitivity}
              onChange={e => SettingsStore.update({ mouseSensitivity: parseFloat(e.target.value) })}
              style={{ width: '100%' }}
            />
          </div>

          <div style={{ marginBottom: 24 }}>
            <label style={{ display: 'flex', justifyContent: 'space-between', color: '#00dcff', fontFamily: 'var(--font-ui)', marginBottom: 8 }}>
              Light Brightness <span>{lightBrightness.toFixed(1)}x</span>
            </label>
            <input 
              type="range" 
              min="0.2" max="3.0" step="0.1" 
              value={lightBrightness}
              onChange={e => SettingsStore.update({ lightBrightness: parseFloat(e.target.value) })}
              style={{ width: '100%' }}
            />
          </div>

          <button 
            onClick={() => setShowSettings(false)}
            style={{
              width: '100%',
              background: 'rgba(0,220,255,0.2)',
              border: '1px solid #00dcff',
              color: '#fff',
              padding: '10px',
              borderRadius: 6,
              fontFamily: 'var(--font-ui)',
              cursor: 'pointer',
            }}
          >
            Done
          </button>
        </div>
      ) : (
        <div style={{ animation: 'fade-in-up 0.5s ease-out', textAlign: 'center', userSelect: 'none' }}>

          {/* Pulsing mouse icon */}
          <div style={{
            width: 80, height: 80,
            borderRadius: '50%',
            border: '2px solid rgba(0,220,255,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 24px',
            animation: 'pulse-ring 2s ease-in-out infinite',
            boxShadow: '0 0 30px rgba(0,220,255,0.25)',
          }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#00dcff" strokeWidth="1.5">
              <rect x="5" y="2" width="14" height="20" rx="7" />
              <line x1="12" y1="2" x2="12" y2="8" />
            </svg>
          </div>

          <h2 style={{ fontFamily: 'var(--font-ui)', fontSize: 28, fontWeight: 700, color: '#fff', letterSpacing: 2, marginBottom: 8 }}>
            NETLAB 3D
          </h2>
          <p style={{ fontFamily: 'var(--font-ui)', fontSize: 15, color: 'rgba(0,220,255,0.9)', letterSpacing: 1, marginBottom: 32 }}>
            Click anywhere to enter the lab
          </p>

          {/* WASD grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 56px)', gap: 8, margin: '0 auto 20px', width: 'fit-content' }}>
            {[null, 'W', null, 'A', 'S', 'D'].map((k, i) =>
              k ? (
                <div key={i} style={{ textAlign: 'center' }}>
                  <kbd style={{
                    display: 'block',
                    background: 'rgba(255,255,255,0.08)',
                    border: '1px solid rgba(255,255,255,0.22)',
                    borderBottom: '3px solid rgba(255,255,255,0.1)',
                    borderRadius: 6,
                    padding: '10px 0',
                    fontSize: 16,
                    fontFamily: 'var(--font-mono)',
                    color: '#fff',
                    fontWeight: 700,
                    marginBottom: 5,
                  }}>
                    {k}
                  </kbd>
                  <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: 1 }}>
                    {k === 'W' ? 'Forward' : k === 'S' ? 'Back' : k === 'A' ? 'Left' : 'Right'}
                  </span>
                </div>
              ) : <div key={i} />
            )}
          </div>

          {/* Extra keys row */}
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap', maxWidth: 450, margin: '0 auto' }}>
            {[
              { key: 'Space',       label: 'Jump'       },
              { key: 'Shift',       label: 'Sprint'     },
              { key: 'Ctrl',        label: 'Free Look'  },
              { key: interactKey,   label: 'Open CLI'   },
              { key: pickUpKey,     label: 'Pick Up'    },
              { key: 'G',           label: 'Drop'       },
              { key: SettingsStore.getState().connectKey,      label: 'Connect'    },
              { key: SettingsStore.getState().disconnectKey,   label: 'Disconnect' },
              { key: 'ESC',         label: 'Release'    },
            ].map(({ key, label }) => (
              <div key={key} style={{ textAlign: 'center' }}>
                <kbd style={{
                  display: 'block',
                  background: 'rgba(0,220,255,0.08)',
                  border: '1px solid rgba(0,220,255,0.3)',
                  borderRadius: 5,
                  padding: '4px 10px',
                  fontSize: 11,
                  fontFamily: 'var(--font-mono)',
                  color: '#00dcff',
                  marginBottom: 5,
                  whiteSpace: 'nowrap',
                }}>
                  {key}
                </kbd>
                <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: 1 }}>
                  {label}
                </span>
              </div>
            ))}
          </div>

          <p style={{ marginTop: 28, fontSize: 11, color: 'rgba(255,255,255,0.2)', fontFamily: 'var(--font-mono)', letterSpacing: 1 }}>
            Press ESC at any time to release mouse
          </p>
        </div>
      )}
    </div>
  )
}
