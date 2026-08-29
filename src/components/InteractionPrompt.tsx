/**
 * InteractionPrompt.tsx
 *
 * Shows "[E] <label>" when the player's crosshair is aimed at an
 * interactable object within reach.
 *
 * Receives data via the 'netlab:interaction' custom DOM event published
 * by Player.tsx — works across the Canvas boundary without Zustand.
 */
import { useEffect, useState } from 'react'
import { useSettingsStore } from '../store/SettingsStore'

export default function InteractionPrompt() {
  const [label, setLabel] = useState<string | null>(null)
  const { interactKey } = useSettingsStore()

  useEffect(() => {
    const handler = (e: Event) => {
      const { hitLabel } = (e as CustomEvent<{ hitLabel: string | null }>).detail
      setLabel(hitLabel)
    }
    window.addEventListener('netlab:interaction', handler)
    return () => window.removeEventListener('netlab:interaction', handler)
  }, [])

  if (!label) return null

  const parts = label.split('|').map(p => p.trim()).filter(Boolean)

  const parsedParts = parts.map(part => {
    let displayKey = interactKey
    let displayText = part
    
    const match = part.match(/^\[([A-Z0-9]+)\]\s*(.*)$/i)
    if (match) {
      displayKey = match[1].toUpperCase()
      displayText = match[2]
    }
    return { key: displayKey, text: displayText }
  })

  return (
    <div
      id="interaction-prompt"
      style={{
        position: 'absolute',
        bottom: 100,
        left: '50%',
        transform: 'translateX(-50%)',
        pointerEvents: 'none',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        alignItems: 'center',
        animation: 'promptIn 0.15s ease-out',
      }}
    >
      <style>{`
        @keyframes promptIn {
          from { opacity: 0; transform: translateX(-50%) translateY(8px); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
      `}</style>

      {parsedParts.map((item, idx) => (
        <div
          key={idx}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            background: 'rgba(0,8,20,0.82)',
            border: '1px solid rgba(0,220,255,0.45)',
            borderRadius: 8,
            padding: '8px 18px',
            backdropFilter: 'blur(10px)',
            boxShadow: '0 4px 20px rgba(0,220,255,0.15)',
            whiteSpace: 'nowrap',
          }}
        >
          {/* Key badge */}
          <kbd
            style={{
              fontSize: 13,
              fontFamily: 'var(--font-mono)',
              fontWeight: 700,
              background: 'rgba(0,220,255,0.15)',
              border: '1px solid rgba(0,220,255,0.6)',
              borderBottom: '3px solid rgba(0,220,255,0.35)',
              borderRadius: 5,
              padding: '3px 10px',
              color: '#00dcff',
            }}
          >
            {item.key}
          </kbd>

          {/* Label */}
          <span
            style={{
              fontSize: 13,
              fontFamily: 'var(--font-ui)',
              color: '#ffffff',
              letterSpacing: 0.5,
            }}
          >
            {item.text}
          </span>
        </div>
      ))}
    </div>
  )
}
