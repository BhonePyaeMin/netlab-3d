import React, { useState, useMemo } from 'react'
import { useNetworkStore } from '../network/useNetworkStore'
import { NetworkStore } from '../network/NetworkStore'
import Draggable from 'react-draggable'

export default function PacketSnifferHUD({ onClose }: { onClose: () => void }) {
  const { capturingCableId, capturedPackets, links } = useNetworkStore()
  
  const [selectedCable, setSelectedCable] = useState<string>('')
  const [filters, setFilters] = useState({
    ARP: true,
    ICMP: true,
    TCP: true,
    UDP: true,
    DNS: true,
    DHCP: true,
    OSPF: true,
  })

  // Format time (HH:MM:SS.mmm)
  const formatTime = (ts: number) => {
    const d = new Date(ts)
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}.${d.getMilliseconds().toString().padStart(3, '0')}`
  }

  // Filtered packets
  const displayPackets = useMemo(() => {
    return capturedPackets.filter(p => {
      if (p.protocol === 'ARP' && !filters.ARP) return false
      if (p.protocol === 'ICMP' && !filters.ICMP) return false
      if (p.protocol === 'TCP' && !filters.TCP) return false
      if (p.protocol === 'UDP' && !filters.UDP) return false
      if (p.protocol === 'DNS' && !filters.DNS) return false
      if (p.protocol === 'DHCP' && !filters.DHCP) return false
      if (p.protocol === 'OSPF' && !filters.OSPF) return false
      return true
    })
  }, [capturedPackets, filters])

  const handleStart = () => {
    if (selectedCable) {
      NetworkStore.setCapturingCable(selectedCable)
    }
  }

  const handleStop = () => {
    NetworkStore.setCapturingCable(null)
  }

  const handleClear = () => {
    NetworkStore.clearCapturedPackets()
  }

  const toggleFilter = (key: keyof typeof filters) => {
    setFilters(prev => ({ ...prev, [key]: !prev[key] }))
  }

  return (
    <Draggable handle=".sniffer-header" defaultPosition={{ x: 100, y: 100 }}>
      <div style={{
        position: 'absolute',
        width: 1000,
        height: 600,
        background: 'rgba(15, 20, 25, 0.95)',
        border: '1px solid #444',
        borderRadius: 8,
        display: 'flex',
        flexDirection: 'column',
        color: '#e0e0e0',
        fontFamily: 'var(--font-ui), sans-serif',
        boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
        zIndex: 100,
        pointerEvents: 'auto',
      }}>
        {/* Header */}
        <div className="sniffer-header" style={{
          padding: '10px 15px',
          background: 'linear-gradient(to right, #1a2332, #243045)',
          borderBottom: '1px solid #444',
          borderTopLeftRadius: 8,
          borderTopRightRadius: 8,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          cursor: 'grab',
        }}>
          <h3 style={{ margin: 0, fontSize: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>🦈</span> Packet Sniffer
          </h3>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', color: '#aaa', cursor: 'pointer', fontSize: 16
          }}>×</button>
        </div>

        {/* Toolbar */}
        <div style={{ padding: '10px', borderBottom: '1px solid #333', display: 'flex', gap: '15px', alignItems: 'center', background: '#181f29' }}>
          <select 
            value={selectedCable} 
            onChange={e => setSelectedCable(e.target.value)}
            disabled={capturingCableId !== null}
            style={{ padding: '6px', background: '#222', color: '#fff', border: '1px solid #555', borderRadius: 4, width: 200 }}
          >
            <option value="">-- Select Link --</option>
            {Array.from(links.values()).map(l => (
              <option key={l.cableId} value={l.cableId}>
                {l.deviceA} ↔ {l.deviceB}
              </option>
            ))}
          </select>

          {capturingCableId ? (
            <button onClick={handleStop} style={btnStyle('#d32f2f')}>⏹ Stop Capture</button>
          ) : (
            <button onClick={handleStart} disabled={!selectedCable} style={btnStyle(selectedCable ? '#2e7d32' : '#555')}>▶ Start Capture</button>
          )}

          <button onClick={handleClear} style={btnStyle('#555')}>🗑 Clear</button>

          <div style={{ width: '1px', height: '24px', background: '#444', margin: '0 5px' }} />

          {/* Filters */}
          <div style={{ display: 'flex', gap: 10, fontSize: 12 }}>
            {Object.keys(filters).map(f => (
              <label key={f} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                <input 
                  type="checkbox" 
                  checked={filters[f as keyof typeof filters]} 
                  onChange={() => toggleFilter(f as keyof typeof filters)}
                />
                {f}
              </label>
            ))}
          </div>
        </div>

        {/* Table area */}
        <div style={{ flex: 1, overflow: 'auto', background: '#0a0d11' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, textAlign: 'left' }}>
            <thead style={{ position: 'sticky', top: 0, background: '#1c2431', boxShadow: '0 1px 3px rgba(0,0,0,0.5)' }}>
              <tr>
                <th style={thStyle}>No.</th>
                <th style={thStyle}>Time</th>
                <th style={thStyle}>Source</th>
                <th style={thStyle}>Destination</th>
                <th style={thStyle}>Protocol</th>
                <th style={thStyle}>Length</th>
                <th style={thStyle}>Info (MAC / Ports / VLAN)</th>
              </tr>
            </thead>
            <tbody>
              {displayPackets.map((p, i) => (
                <tr key={p.id} style={{
                  background: i % 2 === 0 ? '#111720' : '#0a0d11',
                  borderBottom: '1px solid #222',
                  color: getProtocolColor(p.protocol)
                }}>
                  <td style={tdStyle}>{p.id}</td>
                  <td style={tdStyle}>{formatTime(p.timestamp)}</td>
                  <td style={tdStyle}>{p.srcIp || p.srcMac}</td>
                  <td style={tdStyle}>{p.dstIp || p.dstMac}</td>
                  <td style={tdStyle}>{p.protocol}</td>
                  <td style={tdStyle}>{p.size}</td>
                  <td style={tdStyle}>
                    {p.srcPort ? `${p.srcPort} → ${p.dstPort}  ` : ''}
                    {p.vlan !== 1 ? `VLAN=${p.vlan} ` : ''}
                    MAC: {p.srcMac} → {p.dstMac}
                  </td>
                </tr>
              ))}
              {displayPackets.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ padding: 20, textAlign: 'center', color: '#555' }}>
                    No packets captured yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        
        {/* Footer */}
        <div style={{ padding: '4px 10px', background: '#1a2332', fontSize: 11, color: '#aaa', borderTop: '1px solid #444', borderBottomLeftRadius: 8, borderBottomRightRadius: 8 }}>
          {capturingCableId ? `Capturing on link... (${capturedPackets.length} packets)` : `Ready.`}
        </div>
      </div>
    </Draggable>
  )
}

const btnStyle = (bg: string) => ({
  background: bg,
  color: '#fff',
  border: 'none',
  padding: '6px 12px',
  borderRadius: 4,
  cursor: 'pointer',
  fontFamily: 'var(--font-ui)'
})

const thStyle = {
  padding: '8px 10px',
  fontWeight: 'normal',
  color: '#bbb',
  borderRight: '1px solid #333'
}

const tdStyle = {
  padding: '4px 10px',
  borderRight: '1px solid #222'
}

const getProtocolColor = (proto: string) => {
  switch (proto) {
    case 'ARP': return '#d6eaf8'
    case 'ICMP': return '#f2d7d5'
    case 'TCP': return '#d5f5e3'
    case 'UDP': return '#daefdf'
    case 'DNS': return '#e8daef'
    case 'DHCP': return '#fcf3cf'
    case 'OSPF': return '#fadbd8'
    default: return '#e0e0e0'
  }
}
