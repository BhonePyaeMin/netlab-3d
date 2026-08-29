import React, { useState, useEffect, useRef } from 'react'
import Draggable, { type DraggableEvent, type DraggableData } from 'react-draggable'
import { NetworkStore } from '../network/NetworkStore'
import { useNetworkStore } from '../network/useNetworkStore'
import { simulationEngine } from '../network/engine/globalEngine'
import { Router, Layer2Switch, Layer3Switch, PC, Server, Firewall, Cloud } from '../network/engine/Devices'
import type { DeviceType } from '../network/engine/DeviceTypes'
import { IPMath } from '../network/engine/IPMath'
import { createPort } from '../network/engine/PhysicalPort'
import { createInterface } from '../network/engine/NetworkInterface'

type ConnectingState = {
  active: boolean
  sourceNodeId: string | null
  sourcePortId: string | null
}

const ICONS: Record<DeviceType, string> = {
  router: '🔵',
  layer2switch: '🟩',
  layer3switch: '🟨',
  pc: '💻',
  server: '🖥️',
  firewall: '🧱',
  accesspoint: '📡',
  hub: '⬛',
  printer: '🖨️',
  cloud: '☁️',
  generic: '📦'
}

export function TopologyEditorHUD() {
  const store = useNetworkStore()
  
  const [connecting, setConnecting] = useState<ConnectingState>({ active: false, sourceNodeId: null, sourcePortId: null })
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, deviceId: string } | null>(null)
  const [portSelect, setPortSelect] = useState<{ x: number, y: number, deviceId: string, isSource: boolean } | null>(null)
  const [inspectDevice, setInspectDevice] = useState<string | null>(null)
  
  // Render loop to animate active packets along links
  const [frame, setFrame] = useState(0)
  useEffect(() => {
    let handle: number
    const loop = () => {
      setFrame(f => f + 1)
      handle = requestAnimationFrame(loop)
    }
    loop()
    return () => cancelAnimationFrame(handle)
  }, [])

  if (!store.isTopologyEditorOpen) return null

  const addDevice = (type: DeviceType) => {
    // Generate unique ID
    const count = simulationEngine.getDevices().filter(d => d.deviceType === type).length + 1
    let idPrefix = type.toUpperCase()
    if (type === 'layer2switch' || type === 'layer3switch') idPrefix = 'SW'
    if (type === 'router') idPrefix = 'R'
    const id = `${idPrefix}${count}`

    let device
    switch (type) {
      case 'router': device = new Router(id); break
      case 'layer2switch': device = new Layer2Switch(id); break
      case 'layer3switch': device = new Layer3Switch(id); break
      case 'pc': device = new PC(id); break
      case 'server': device = new Server(id); break
      case 'firewall': device = new Firewall(id); break
      case 'cloud': device = new Cloud(id); break
      default: return
    }

    // Default 2D position in center of screen
    device.position = { x: 400 + Math.random() * 100, y: 300 + Math.random() * 100, z: 0 }
    
    simulationEngine.addDevice(device)
    NetworkStore.notify()
  }

  const handleDrag = (deviceId: string, e: DraggableEvent, data: DraggableData) => {
    const dev = simulationEngine.getDevice(deviceId)
    if (dev) {
      dev.position.x = data.x
      dev.position.y = data.y
      // Just manually force re-render for lines
      setFrame(f => f + 1)
    }
  }

  const startConnection = (deviceId: string, e: React.MouseEvent) => {
    setConnecting({ active: true, sourceNodeId: deviceId, sourcePortId: null })
  }

  const handleDeviceClick = (deviceId: string, e: React.MouseEvent) => {
    if (connecting.active) {
      if (connecting.sourceNodeId !== deviceId && connecting.sourceNodeId) {
        // Complete connection by dynamically instantiating ports
        const srcDev = simulationEngine.getDevice(connecting.sourceNodeId)
        const dstDev = simulationEngine.getDevice(deviceId)
        
        if (srcDev && dstDev) {
          const srcPortCount = srcDev.ports.size
          const dstPortCount = dstDev.ports.size
          
          const srcPortId = `${srcDev.id}_Eth${srcPortCount}`
          const dstPortId = `${dstDev.id}_Eth${dstPortCount}`
          
          simulationEngine.registerPort(createPort(srcPortId, srcDev.id, `Ethernet${srcPortCount}`))
          simulationEngine.registerPort(createPort(dstPortId, dstDev.id, `Ethernet${dstPortCount}`))
          
          if (['router', 'pc', 'server'].includes(srcDev.deviceType)) {
            srcDev.addInterface(createInterface(`${srcDev.id}_Ethernet${srcPortCount}`, srcDev.id, `Ethernet${srcPortCount}`, 'FastEthernet', srcPortId))
          }
          if (['router', 'pc', 'server'].includes(dstDev.deviceType)) {
            dstDev.addInterface(createInterface(`${dstDev.id}_Ethernet${dstPortCount}`, dstDev.id, `Ethernet${dstPortCount}`, 'FastEthernet', dstPortId))
          }
          
          simulationEngine.connectCable(`cable-${Date.now()}`, srcPortId, dstPortId)
          NetworkStore.notify()
        }
        setConnecting({ active: false, sourceNodeId: null, sourcePortId: null })
      }
    } else {
      NetworkStore.setActiveCLI(deviceId)
    }
  }

  const cancelConnection = () => {
    setConnecting({ active: false, sourceNodeId: null, sourcePortId: null })
  }

  // Draw SVG lines for links
  const renderLinks = () => {
    return simulationEngine.getLinks().map(link => {
      const devA = simulationEngine.getDevice(link.portA.deviceId)
      const devB = simulationEngine.getDevice(link.portB.deviceId)
      
      if (!devA || !devB) return null
      
      const isUp = link.portA.linkDetected && link.portB.linkDetected

      return (
        <g key={link.id}>
          <line 
            x1={devA.position.x + 32} 
            y1={devA.position.y + 32} 
            x2={devB.position.x + 32} 
            y2={devB.position.y + 32} 
            stroke={isUp ? '#00ff88' : '#ff3333'} 
            strokeWidth={4}
            opacity={0.7}
          />
          {/* Packet animation pulses could go here if we read packet capture data */}
        </g>
      )
    })
  }

  return (
    <div className="fixed inset-0 z-50 bg-[#12141c] text-white flex select-none font-mono">
      {/* Sidebar Palette */}
      <div className="w-64 bg-[#1a1d27] border-r border-[#2d3248] p-4 flex flex-col gap-4 shadow-xl z-30">
        <h2 className="text-xl font-bold text-[#00dcff]">Nodes</h2>
        <div className="flex flex-col gap-2">
          {['router', 'layer2switch', 'pc', 'server', 'firewall', 'cloud'].map(type => (
            <button 
              key={type}
              onClick={() => addDevice(type as DeviceType)}
              className="flex items-center gap-3 p-3 bg-[#24283b] hover:bg-[#343a55] rounded cursor-pointer transition-colors border border-[#2d3248]"
            >
              <span className="text-2xl">{ICONS[type as DeviceType]}</span>
              <span className="capitalize">{type}</span>
            </button>
          ))}
        </div>
        
        <div className="mt-auto">
          <button 
            onClick={() => NetworkStore.toggleTopologyEditor()}
            className="w-full p-3 bg-red-600 hover:bg-red-500 rounded text-white font-bold"
          >
            Close Editor
          </button>
        </div>
      </div>

      {/* Canvas Area */}
      <div className="flex-1 relative overflow-hidden bg-[url('/grid.svg')] cursor-crosshair">
        {/* Connection Mode Overlay */}
        {connecting.active && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-blue-600 text-white px-6 py-2 rounded-full shadow-lg flex items-center gap-4 z-40">
            <span>Select target device to connect...</span>
            <button onClick={cancelConnection} className="bg-white text-blue-900 px-3 py-1 rounded text-sm font-bold hover:bg-gray-200">Cancel</button>
          </div>
        )}

        {/* Links SVG */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none z-10">
          {renderLinks()}
        </svg>

        {/* Device Nodes */}
        {simulationEngine.getDevices().map(dev => {
          let statusColor = '#22c55e' // RUNNING
          if (dev.status === 'OFF') statusColor = '#ef4444'
          else if (dev.status === 'STARTING' || dev.status === 'STOPPING') statusColor = '#eab308'
          else if (dev.status === 'ERROR') statusColor = '#f97316'

          return (
          <Draggable 
            key={dev.id} 
            position={{ x: dev.position.x || 0, y: dev.position.y || 0 }}
            onDrag={(e, d) => handleDrag(dev.id, e, d)}
            handle=".drag-handle"
          >
            <div 
              className="absolute z-20 flex flex-col items-center"
              onContextMenu={(e) => {
                e.preventDefault()
                setContextMenu({ x: e.clientX, y: e.clientY, deviceId: dev.id })
              }}
            >
              <div 
                className={`drag-handle w-16 h-16 bg-[#1a1d27] border-2 ${connecting.sourceNodeId === dev.id ? 'border-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.5)]' : 'border-[#4b5563]'} rounded-xl shadow-xl flex items-center justify-center text-4xl cursor-grab active:cursor-grabbing hover:border-[#00dcff] transition-all`}
                onClick={(e) => handleDeviceClick(dev.id, e)}
              >
                {ICONS[dev.deviceType]}
                <div 
                  className="absolute -top-1 -right-1 w-3 h-3 rounded-full border border-[#12141c] shadow"
                  style={{ backgroundColor: statusColor }}
                  title={dev.status}
                />
              </div>
              <div className="mt-2 bg-[#000000bb] px-2 py-1 rounded text-xs font-bold text-center border border-[#333]">
                <div className="text-[#00dcff]">{dev.hostname}</div>
                <div className="text-[10px] text-gray-300">
                  {Array.from(dev.interfaces.values()).filter(i => i.ipAddress && i.ipAddress !== 'dhcp').map(i => i.ipAddress).join(', ')}
                </div>
              </div>
              
              {/* Connect Button overlay */}
              {!connecting.active && (
                <button 
                  onClick={(e) => { e.stopPropagation(); startConnection(dev.id, e) }}
                  className="absolute -right-3 -top-3 w-6 h-6 bg-blue-600 rounded-full text-white flex items-center justify-center hover:bg-blue-400 border-2 border-[#12141c] shadow-lg transition-transform hover:scale-110"
                  title="Connect"
                >
                  🔗
                </button>
              )}
            </div>
          </Draggable>
        )})}

        {/* Port Selection Menu removed because ports are instantiated dynamically */}

        {/* Context Menu */}
        {contextMenu && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setContextMenu(null)} onContextMenu={(e) => {e.preventDefault(); setContextMenu(null)}} />
            <div 
              className="fixed z-50 bg-[#1a1d27] border border-[#4b5563] rounded shadow-2xl overflow-hidden flex flex-col min-w-[200px]"
              style={{ left: contextMenu.x, top: contextMenu.y }}
            >
              <div className="bg-[#2d3248] px-4 py-2 text-xs text-gray-300 font-bold uppercase border-b border-[#4b5563]">
                {simulationEngine.getDevice(contextMenu.deviceId)?.hostname || 'Device'} Actions
              </div>
              <button 
                className="px-4 py-2 text-left hover:bg-[#343a55] text-white flex items-center gap-2"
                onClick={() => { NetworkStore.setActiveCLI(contextMenu.deviceId); setContextMenu(null) }}
              >
                <span>💻</span> Console / Configure
              </button>
              <button 
                className="px-4 py-2 text-left hover:bg-[#343a55] text-white flex items-center gap-2 border-t border-[#2d3248]"
                onClick={() => { setInspectDevice(contextMenu.deviceId); setContextMenu(null) }}
              >
                <span>🔍</span> Inspect
              </button>
              <button 
                className="px-4 py-2 text-left hover:bg-[#343a55] text-white flex items-center gap-2 border-t border-[#2d3248]"
                onClick={() => {
                  const dev = simulationEngine.getDevice(contextMenu.deviceId)
                  if (dev) dev.start()
                  NetworkStore.notify()
                  setContextMenu(null)
                }}
              >
                <span>▶️</span> Start
              </button>
              <button 
                className="px-4 py-2 text-left hover:bg-[#343a55] text-white flex items-center gap-2 border-t border-[#2d3248]"
                onClick={() => {
                  const dev = simulationEngine.getDevice(contextMenu.deviceId)
                  if (dev) dev.stop()
                  NetworkStore.notify()
                  setContextMenu(null)
                }}
              >
                <span>⏹️</span> Stop
              </button>
              <button 
                className="px-4 py-2 text-left hover:bg-[#343a55] text-white flex items-center gap-2 border-t border-[#2d3248]"
                onClick={() => {
                  const dev = simulationEngine.getDevice(contextMenu.deviceId)
                  if (dev) dev.restart()
                  NetworkStore.notify()
                  setContextMenu(null)
                }}
              >
                <span>🔄</span> Restart
              </button>
              <button 
                className="px-4 py-2 text-left hover:bg-[#343a55] text-red-400 flex items-center gap-2 border-t border-[#2d3248]"
                onClick={() => {
                  const dev = simulationEngine.getDevice(contextMenu.deviceId)
                  if (dev) dev.reset()
                  NetworkStore.notify()
                  setContextMenu(null)
                }}
              >
                <span>⚡</span> Reset
              </button>
              <button 
                className="px-4 py-2 text-left hover:bg-[#343a55] text-white flex items-center gap-2 border-t border-[#2d3248]"
                onClick={() => {
                  const dev = simulationEngine.getDevice(contextMenu.deviceId)
                  if (dev) {
                    const newName = prompt('Enter new hostname:', dev.hostname)
                    if (newName) {
                      dev.hostname = newName
                      NetworkStore.notify()
                    }
                  }
                  setContextMenu(null)
                }}
              >
                <span>✏️</span> Rename
              </button>
              <button 
                className="px-4 py-2 text-left hover:bg-[#343a55] text-red-400 flex items-center gap-2 border-t border-[#2d3248]"
                onClick={() => {
                  simulationEngine.removeDevice(contextMenu.deviceId)
                  NetworkStore.notify()
                  setContextMenu(null)
                }}
              >
                <span>🗑️</span> Delete
              </button>
              
              {/* Connected Interfaces List for Disconnecting */}
              <div className="bg-[#2d3248] px-4 py-1 text-xs text-gray-400 font-bold uppercase mt-2">
                Connections
              </div>
              <div className="max-h-32 overflow-y-auto">
                {Array.from(simulationEngine.getDevice(contextMenu.deviceId)?.ports.values() || [])
                  .filter(p => p.connectedCableId)
                  .map(p => (
                    <button 
                      key={p.id}
                      className="w-full px-4 py-2 text-left hover:bg-[#343a55] text-white border-t border-[#2d3248] text-xs flex justify-between"
                      onClick={() => {
                        NetworkStore.disconnectPort(p.id)
                        setContextMenu(null)
                      }}
                    >
                      <span>{p.name}</span>
                      <span className="text-red-400 font-bold" title="Disconnect [D]">D ✖</span>
                    </button>
                  ))}
                {Array.from(simulationEngine.getDevice(contextMenu.deviceId)?.ports.values() || []).filter(p => p.connectedCableId).length === 0 && (
                  <div className="px-4 py-2 text-xs text-gray-500 italic">No connections</div>
                )}
              </div>
            </div>
          </>
        )}

        {/* Inspect Modal */}
        {inspectDevice && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#000000aa] p-8">
            <div className="bg-[#1a1d27] border border-[#00dcff] rounded shadow-2xl w-[600px] max-h-[80vh] flex flex-col">
              <div className="bg-[#2d3248] px-4 py-3 flex justify-between items-center border-b border-[#4b5563]">
                <h3 className="font-bold text-[#00dcff]">{simulationEngine.getDevice(inspectDevice)?.hostname} - Inspection</h3>
                <button onClick={() => setInspectDevice(null)} className="text-white hover:text-red-400 font-bold">✕</button>
              </div>
              <div className="p-4 overflow-y-auto whitespace-pre font-mono text-xs text-green-400">
                {(() => {
                  const dev = simulationEngine.getDevice(inspectDevice)
                  if (!dev) return 'Device not found.'
                  let dump = `=== Status ===\nState: ${dev.status}\n\n=== Interfaces ===\n`
                  for (const intf of dev.interfaces.values()) {
                    dump += `${intf.id.padEnd(20)} ${intf.ipAddress || 'unassigned'} (Admin: ${intf.adminStatus}, Oper: ${intf.operStatus})\n`
                  }
                  dump += `\n=== Routing Table ===\n`
                  for (const route of dev.routingTable) {
                    dump += `${route.protocol.charAt(0).toUpperCase()} ${route.network}/${IPMath.calculatePrefixLength(route.mask)} `
                    if (route.nextHop) dump += `via ${route.nextHop} `
                    if (route.outgoingInterfaceId) dump += `${route.outgoingInterfaceId}`
                    dump += `\n`
                  }
                  dump += `\n=== ARP Table ===\n`
                  for (const [ip, arp] of dev.arpTable.entries()) {
                    dump += `${ip.padEnd(16)} -> ${arp.macAddress}\n`
                  }
                  return dump
                })()}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
