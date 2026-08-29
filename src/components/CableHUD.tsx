/**
 * CableHUD.tsx
 *
 * Shows toast notifications for cable events:
 *   ✓ Link established: PC1 ↔ Switch1
 *   ✓ Connected to Switch1 G0/1 — now plug the other end
 *   ❌ Invalid port — Console is console type
 *   ❌ Port already in use
 *
 * Also shows the "holding cable" indicator and G=Drop hint.
 *
 * Listens to 'netlab:cableevent' DOM events from CableSystem.tsx
 */
import { useEffect, useState } from 'react'
import { useNetworkStore }     from '../network/useNetworkStore'
import { useSettingsStore }    from '../store/SettingsStore'

interface Toast {
  id:      number
  message: string
  success: boolean
}

let toastSeq = 0

export default function CableHUD() {
  const { heldCableId, heldDeviceId, heldDeviceType, links } = useNetworkStore()
  const { connectKey, pickUpKey } = useSettingsStore()
  const [toasts, setToasts]    = useState<Toast[]>([])

  const pushToast = (message: string, success: boolean) => {
    const id = ++toastSeq
    setToasts(prev => [...prev.slice(-2), { id, message, success }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000)
  }

  useEffect(() => {
    const handler = (e: Event) => {
      const { type, result } = (e as CustomEvent).detail
      if (type === 'pickup') {
        pushToast(`📦 Picked up — ${result || 'Cable'}`, true)
      } else if (type === 'drop') {
        pushToast(`💧 Dropped — ${result || 'Cable'}`, false)
      } else if (type === 'connect' && result) {
        pushToast(result.message, result.success)
      }
    }
    window.addEventListener('netlab:cableevent', handler)
    return () => window.removeEventListener('netlab:cableevent', handler)
  }, [])

  return (
    <>
      {/* ── Holding indicator ─────────────────────────────── */}
      {(heldCableId || heldDeviceId) && (
        <div
          style={{
            position: 'absolute',
            top: 120, // Moved to top so it doesn't overlap interaction prompts
            left: '50%',
            transform: 'translateX(-50%)',
            pointerEvents: 'none',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <div style={{
            background: 'rgba(0,10,25,0.85)',
            border: '1px solid rgba(0,220,255,0.5)',
            borderRadius: 8,
            padding: '6px 18px',
            fontSize: 12,
            color: '#00dcff',
            fontFamily: 'var(--font-ui)',
            letterSpacing: 0.5,
            backdropFilter: 'blur(10px)',
          }}>
            {heldCableId ? (
              <>🔌 Holding Ethernet Cable — aim at a port and press <kbd style={{ background:'rgba(255,255,255,0.1)', borderRadius:3, padding:'1px 5px', fontSize:11 }}>{connectKey}</kbd></>
            ) : (
              <>📦 Holding {heldDeviceType} ({heldDeviceId}) — aim at a desk and press <kbd style={{ background:'rgba(255,255,255,0.1)', borderRadius:3, padding:'1px 5px', fontSize:11 }}>G</kbd></>
            )}
          </div>
          <div style={{ fontSize: 10, color:'rgba(255,255,255,0.35)', fontFamily:'var(--font-mono)', letterSpacing:1 }}>
            Press <kbd style={{ background:'rgba(255,255,255,0.1)', borderRadius:3, padding:'1px 4px' }}>G</kbd> to drop
          </div>
        </div>
      )}

      {/* ── Link counter badge (top-right, below objectives) */}
      {links.size > 0 && (
        <div style={{
          position: 'absolute',
          top: 200,
          right: 16,
          fontFamily: 'var(--font-ui)',
          fontSize: 10,
          color: '#00ff88',
          letterSpacing: 1,
        }}>
          {Array.from(links.values()).map(link => (
            <div key={link.cableId} style={{
              background: 'rgba(0,10,0,0.8)',
              border: '1px solid rgba(0,255,136,0.3)',
              borderRadius: 5,
              padding: '4px 10px',
              marginBottom: 4,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}>
              <span style={{ color:'#00ff88', fontSize:11 }}>✓</span>
              <span style={{ color:'rgba(255,255,255,0.8)' }}>
                {link.deviceA} ↔ {link.deviceB}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ── Toast notifications ────────────────────────────── */}
      <div style={{
        position: 'absolute',
        bottom: 210,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        pointerEvents: 'none',
      }}>
        {toasts.map(toast => (
          <div
            key={toast.id}
            style={{
              background: toast.success
                ? 'rgba(0,15,5,0.9)'
                : 'rgba(20,0,0,0.9)',
              border: `1px solid ${toast.success ? 'rgba(0,255,136,0.5)' : 'rgba(255,60,60,0.5)'}`,
              borderRadius: 8,
              padding: '8px 20px',
              fontSize: 13,
              fontFamily: 'var(--font-ui)',
              color: toast.success ? '#00ff88' : '#ff6060',
              backdropFilter: 'blur(10px)',
              boxShadow: toast.success
                ? '0 4px 20px rgba(0,255,136,0.15)'
                : '0 4px 20px rgba(255,60,60,0.15)',
              animation: 'toastIn 0.2s ease-out',
              whiteSpace: 'nowrap',
            }}
          >
            <style>{`
              @keyframes toastIn {
                from { opacity:0; transform:translateY(8px); }
                to   { opacity:1; transform:translateY(0); }
              }
            `}</style>
            {toast.message}
          </div>
        ))}
      </div>
    </>
  )
}
