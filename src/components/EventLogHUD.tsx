import React, { useEffect, useState, useRef } from 'react'
import { simulationEngine } from '../network/engine/globalEngine'
import { useNetworkStore } from '../network/useNetworkStore'
import { NetworkStore } from '../network/NetworkStore'

export function EventLogHUD() {
  const isEventLogOpen = useNetworkStore(s => s.isEventLogOpen)
  const [logs, setLogs] = useState<{ timeMs: number, device?: string, message: string }[]>([])
  const containerRef = useRef<HTMLDivElement>(null)

  // Poll for logs every 500ms when open
  useEffect(() => {
    if (!isEventLogOpen) return
    const interval = setInterval(() => {
      setLogs([...simulationEngine.globalLogs])
    }, 500)
    
    // Initial fetch
    setLogs([...simulationEngine.globalLogs])
    
    return () => clearInterval(interval)
  }, [isEventLogOpen])

  // Auto-scroll to bottom on new logs
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [logs])

  if (!isEventLogOpen) return null

  const clearLogs = () => {
    simulationEngine.globalLogs = []
    setLogs([])
  }

  const formatTime = (ms: number) => {
    const totalSeconds = Math.floor(ms / 1000)
    const hours = Math.floor(totalSeconds / 3600)
    const mins = Math.floor((totalSeconds % 3600) / 60)
    const secs = totalSeconds % 60
    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 80, // Above the status bar
        right: 16,
        width: 450,
        height: 300,
        background: 'rgba(15, 15, 20, 0.95)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: 8,
        display: 'flex',
        flexDirection: 'column',
        backdropFilter: 'blur(10px)',
        zIndex: 100,
        overflow: 'hidden',
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        fontFamily: 'var(--font-mono)'
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '8px 12px',
          background: 'rgba(255, 255, 255, 0.05)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 8, height: 8, background: 'var(--color-accent)', borderRadius: '50%', boxShadow: '0 0 8px var(--color-accent)' }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)' }}>Network Event Log</span>
        </div>
        <button
          onClick={clearLogs}
          style={{
            background: 'rgba(255, 50, 50, 0.2)',
            border: '1px solid rgba(255, 50, 50, 0.3)',
            color: '#ffaaaa',
            padding: '2px 8px',
            borderRadius: 4,
            fontSize: 11,
            cursor: 'pointer',
            transition: 'background 0.2s'
          }}
          onMouseOver={e => e.currentTarget.style.background = 'rgba(255, 50, 50, 0.4)'}
          onMouseOut={e => e.currentTarget.style.background = 'rgba(255, 50, 50, 0.2)'}
        >
          Clear
        </button>
      </div>

      {/* Log Container */}
      <div 
        ref={containerRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 6
        }}
      >
        {logs.length === 0 ? (
          <div style={{ color: 'var(--color-text-dim)', fontSize: 12, fontStyle: 'italic', textAlign: 'center', marginTop: 20 }}>
            No events logged yet.
          </div>
        ) : (
          logs.map((log, idx) => (
            <div key={idx} style={{ fontSize: 11, lineHeight: 1.4, display: 'flex', gap: 8 }}>
              <span style={{ color: 'var(--color-text-dim)', whiteSpace: 'nowrap' }}>[{formatTime(log.timeMs)}]</span>
              {log.device && (
                <span style={{ color: 'var(--color-accent-dim)', fontWeight: 'bold' }}>{log.device}:</span>
              )}
              <span style={{ color: 'var(--color-text)', wordBreak: 'break-word' }}>
                {log.message}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
