import React from 'react'
import { useNetworkStore } from '../network/useNetworkStore'
import { NetworkStore } from '../network/NetworkStore'
import Draggable from 'react-draggable'

export default function PacketAnimationHUD() {
  const { animationMode, activeTrace, playbackState, currentHopIndex } = useNetworkStore()

  if (!animationMode) return null

  const handleClose = () => NetworkStore.setAnimationMode(false)
  
  const handlePlayPause = () => {
    NetworkStore.setPlaybackState(playbackState === 'playing' ? 'paused' : 'playing')
  }

  const handleStepPrev = () => {
    NetworkStore.setPlaybackState('paused')
    NetworkStore.setCurrentHopIndex(currentHopIndex - 1)
  }

  const handleStepNext = () => {
    NetworkStore.setPlaybackState('paused')
    NetworkStore.setCurrentHopIndex(currentHopIndex + 1)
  }

  const currentHop = activeTrace?.hops[currentHopIndex]

  return (
    <Draggable handle=".anim-header" defaultPosition={{ x: 20, y: 20 }}>
      <div style={{
        position: 'absolute',
        width: 320,
        background: 'rgba(15, 20, 25, 0.95)',
        border: '1px solid #444',
        borderRadius: 8,
        display: 'flex',
        flexDirection: 'column',
        color: '#e0e0e0',
        fontFamily: 'var(--font-ui), sans-serif',
        boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
        zIndex: 110,
        pointerEvents: 'auto',
      }}>
        {/* Header */}
        <div className="anim-header" style={{
          padding: '10px 15px',
          background: 'linear-gradient(to right, #2c3e50, #34495e)',
          borderBottom: '1px solid #444',
          borderTopLeftRadius: 8,
          borderTopRightRadius: 8,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          cursor: 'grab',
        }}>
          <h3 style={{ margin: 0, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>⏯</span> Packet Animation
          </h3>
          <button onClick={handleClose} style={{
            background: 'none', border: 'none', color: '#aaa', cursor: 'pointer', fontSize: 16
          }}>×</button>
        </div>

        {/* Content */}
        <div style={{ padding: '15px' }}>
          {!activeTrace ? (
            <div style={{ color: '#aaa', fontSize: 12, textAlign: 'center', padding: '20px 0' }}>
              Waiting for packet generation...<br/>
              (e.g., use ping from a PC)
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
              {/* Packet Info */}
              <div style={{ background: '#1c2431', padding: 10, borderRadius: 6, border: '1px solid #333' }}>
                <div style={{ fontSize: 10, color: '#aaa', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 5 }}>Trace Info</div>
                <div style={{ fontSize: 12 }}>
                  <div><strong>Proto:</strong> {activeTrace.protocol}</div>
                  {activeTrace.srcIp && <div><strong>Src IP:</strong> {activeTrace.srcIp}</div>}
                  {activeTrace.dstIp && <div><strong>Dst IP:</strong> {activeTrace.dstIp}</div>}
                  <div style={{ marginTop: 5, color: '#888', fontSize: 11 }}>
                    Hop {currentHopIndex + 1} of {activeTrace.hops.length}
                  </div>
                </div>
              </div>

              {/* Hop Details */}
              {currentHop && (
                <div style={{ background: '#1c2431', padding: 10, borderRadius: 6, border: '1px solid #333' }}>
                  <div style={{ fontSize: 10, color: '#aaa', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 5 }}>
                    Hop Decisions — {currentHop.deviceId}
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: '#d0d0d0', lineHeight: 1.4 }}>
                    {currentHop.decisions.map((d, i) => (
                      <li key={i}>{d}</li>
                    ))}
                  </ul>
                  <div style={{ marginTop: 10, fontSize: 11, color: currentHop.action === 'drop' ? '#e74c3c' : '#2ecc71' }}>
                    <strong>Action:</strong> {currentHop.action.toUpperCase()} 
                    {currentHop.outgoingPortId && ` (via ${currentHop.outgoingPortId})`}
                  </div>
                </div>
              )}

              {/* Controls */}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 5 }}>
                <button 
                  onClick={handleStepPrev} 
                  disabled={currentHopIndex === 0}
                  style={btnStyle(currentHopIndex === 0 ? '#333' : '#2c3e50')}
                >
                  ⏮ Step
                </button>
                <button 
                  onClick={handlePlayPause}
                  style={btnStyle('#27ae60')}
                >
                  {playbackState === 'playing' ? '⏸ Pause' : '▶ Play'}
                </button>
                <button 
                  onClick={handleStepNext} 
                  disabled={currentHopIndex >= activeTrace.hops.length - 1}
                  style={btnStyle(currentHopIndex >= activeTrace.hops.length - 1 ? '#333' : '#2c3e50')}
                >
                  Step ⏭
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Draggable>
  )
}

const btnStyle = (bg: string) => ({
  flex: 1,
  background: bg,
  color: '#fff',
  border: 'none',
  padding: '8px 0',
  borderRadius: 4,
  cursor: 'pointer',
  fontFamily: 'var(--font-ui)',
  fontSize: 12
})
