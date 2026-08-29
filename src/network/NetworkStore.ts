/**
 * NetworkStore.ts — Singleton reactive store for network topology.
 *
 * Manages:
 *  - Registered ports (from devices in the scene)
 *  - Cable objects (coiled, held, partial, connected)
 *  - Active links (topology graph)
 *
 * Uses a simple subscriber pattern compatible with React's
 * useSyncExternalStore — no Zustand required.
 *
 * Key operations:
 *  registerPort(port)         — called by device components on mount
 *  spawnCable(cable)          — called by CableSpawner on scene init
 *  pickUpCable(cableId)       — player picks up a coiled cable
 *  connectCableEnd(cableId, portId) — player plugs into a port
 *  disconnectPort(portId)     — player unplugs a cable
 *  getState()                 — returns current immutable snapshot
 */

import type { Port, Cable, Link, ConnectResult } from './types'
import { simulationEngine } from './engine/globalEngine'

/* ─── State shape ─────────────────────────────────────────── */
export interface NetworkState {
  ports:  Map<string, Port>
  cables: Map<string, Cable>
  links:  Map<string, Link>    // keyed by cableId
  /** Cable the player is currently holding (at most one) */
  heldCableId: string | null
  heldDeviceId: string | null
  heldDeviceType: 'Router' | 'Switch' | 'PC' | 'Server' | 'Firewall' | 'Storage' | null
  
  devices: { id: string, type: 'Router' | 'Switch' | 'PC' | 'Server' | 'Firewall' | 'Storage', position: [number, number, number] }[]

  /** Packet Capture State */
  capturingCableId: string | null
  capturedPackets: import('./types').CapturedPacket[]
  isSnifferOpen: boolean
  
  /** Packet Animation State */
  animationMode: boolean
  activeTrace: import('./types').PacketTrace | null
  playbackState: 'playing' | 'paused'
  currentHopIndex: number
  
  /** Troubleshooting Scenarios */
  isScenariosOpen: boolean
  activeScenarioId: string | null
  scenarioSuccess: boolean
  
  /** Project Management */
  isProjectMenuOpen: boolean

  /** Topology Editor */
  isTopologyEditorOpen: boolean

  /** Event Log */
  isEventLogOpen: boolean

  /** Simulation Controls */
  simulationState: 'running' | 'paused' | 'stopped'
  simulationSpeed: number
  simulationTime: number

  /** Inventory & Dynamic Devices */
  isInventoryOpen: boolean
  dynamicDevices: { id: string; type: string; position: [number, number, number] }[]
}

/* ─── Singleton store ─────────────────────────────────────── */
class NetworkStoreClass {
  private state: NetworkState = {
    ports:       new Map(),
    cables:      new Map(),
    links:       new Map(),
    heldCableId: null,
    heldDeviceId: null,
    heldDeviceType: null,
    devices: [],
    capturingCableId: null,
    capturedPackets: [],
    isSnifferOpen: false,
    animationMode: false,
    activeTrace: null,
    playbackState: 'playing',
    currentHopIndex: 0,
    isScenariosOpen: false,
    activeScenarioId: null,
    scenarioSuccess: false,
    isProjectMenuOpen: false,
    isTopologyEditorOpen: false,
    isEventLogOpen: false,
    simulationState: 'running',
    simulationSpeed: 1,
    simulationTime: 0,
    isInventoryOpen: false,
    dynamicDevices: [],
  }

  private subscribers = new Set<() => void>()

  /* ── React useSyncExternalStore interface ─────────────── */

  // NOTE: the engine → store packet-capture bridge is deliberately NOT wired
  // here. globalEngine and this module import each other, so whichever one is
  // the entry of the graph sees the other's exports as still-undefined during
  // construction. globalEngine wires it once both modules are initialised.


  subscribe = (cb: () => void): (() => void) => {
    this.subscribers.add(cb)
    return () => this.subscribers.delete(cb)
  }

  getSnapshot = (): NetworkState => this.state

  private notify() {
    // Create a new state object so React detects the change
    this.state = { ...this.state }
    this.subscribers.forEach(cb => cb())
  }

  /* ── Port registration ───────────────────────────────── */

  registerPort(port: Port) {
    const next = new Map(this.state.ports)
    next.set(port.id, { ...port })
    this.state = { ...this.state, ports: next }
    this.notify()
  }

  unregisterPort(portId: string) {
    const next = new Map(this.state.ports)
    next.delete(portId)
    this.state = { ...this.state, ports: next }
    this.notify()
  }

  updatePortPosition(portId: string, pos: [number, number, number]) {
    const port = this.state.ports.get(portId)
    if (!port) return
    const next = new Map(this.state.ports)
    next.set(portId, { ...port, worldPosition: pos })
    this.state = { ...this.state, ports: next }
    // Don't notify on position update — happens every frame
  }

  /* ── Cable lifecycle ─────────────────────────────────── */

  spawnCable(cable: Cable) {
    const next = new Map(this.state.cables)
    next.set(cable.id, { ...cable, status: 'coiled' })
    this.state = { ...this.state, cables: next }
    this.notify()
  }

  /**
   * Player presses E on a cable coil on the floor.
   * Cable becomes 'held' — it follows the player's hand.
   */
  pickUpCable(cableId: string): boolean {
    if (this.state.heldCableId) return false   // already holding one
    const cable = this.state.cables.get(cableId)
    if (!cable || cable.status !== 'coiled') return false

    const nextCables = new Map(this.state.cables)
    nextCables.set(cableId, { ...cable, status: 'held' })
    this.state = { ...this.state, cables: nextCables, heldCableId: cableId }
    this.notify()
    return true
  }

  /**
   * Drop a held cable back onto the floor.
   */
  dropCable(position?: [number, number, number]) {
    const cableId = this.state.heldCableId
    if (!cableId) return
    const cable = this.state.cables.get(cableId)
    if (!cable) return

    // If partial (one end was connected), disconnect that end first
    if (cable.status === 'partial' && cable.endpointA) {
      this._disconnectPort(cable.endpointA, cableId)
      simulationEngine.disconnectCable(cable.endpointA)
    }

    const nextCables = new Map(this.state.cables)
    nextCables.set(cableId, {
      ...cable,
      status: 'coiled',
      endpointA: null,
      endpointB: null,
      spawnPosition: position || cable.spawnPosition
    })
    this.state = { ...this.state, cables: nextCables, heldCableId: null }
    this.notify()
  }

  /**
   * Auto-generate a new cable when the user presses C on an empty port without holding a cable.
   */
  startNewCableConnection(portId: string): ConnectResult {
    const port = this.state.ports.get(portId)
    if (!port) return { success: false, message: 'Port not found' }
    if (port.portType !== 'ethernet') return { success: false, message: `Invalid connection: incompatible port types.` }
    if (port.connectedCableId) return { success: false, message: `Port already connected.` }

    const newCableId = `cable-${Date.now()}`
    const newCable: Cable = {
      id: newCableId,
      status: 'held',
      color: '#3366ff',
      endpointA: null,
      endpointB: null,
      spawnPosition: port.worldPosition || [0,0,0]
    }
    
    // Add to state
    this.state.cables.set(newCableId, newCable)
    this.state.heldCableId = newCableId
    
    // Immediately plug endpointA into portId!
    return this.connectCableEnd(portId)
  }

  /**
   * Player presses C while holding a cable and looking at a port.
   * First call  → connects endpointA (cable becomes 'partial').
   * Second call → connects endpointB (cable becomes 'connected').
   */
  connectCableEnd(portId: string): ConnectResult {
    const cableId = this.state.heldCableId
    if (!cableId) {
      return { success: false, message: 'Not holding a cable' }
    }

    const cable = this.state.cables.get(cableId)
    const port  = this.state.ports.get(portId)

    if (!cable) return { success: false, message: 'Cable not found' }
    if (!port)  return { success: false, message: 'Port not found' }

    // Check port type compatibility
    if (port.portType !== 'ethernet') {
      return { success: false, message: `Invalid connection: incompatible port types.` }
    }

    // Check port not already occupied
    if (port.connectedCableId) {
      return { success: false, message: `Port already connected.` }
    }

    // Check cable not already connected to this same device (loop)
    if (cable.status === 'partial' && cable.endpointA) {
      const otherPort = this.state.ports.get(cable.endpointA)
      if (otherPort?.deviceId === port.deviceId) {
        return { success: false, message: 'Invalid connection: cannot connect a device to itself.' }
      }
    }

    const nextPorts  = new Map(this.state.ports)
    const nextCables = new Map(this.state.cables)
    const nextLinks  = new Map(this.state.links)

    // Mark port as occupied
    nextPorts.set(portId, { ...port, connectedCableId: cableId })

    if (cable.status === 'held') {
      // First end
      nextCables.set(cableId, { ...cable, status: 'partial', endpointA: portId })
      this.state = { ...this.state, ports: nextPorts, cables: nextCables }
      this.notify()
      return { success: true, message: `✓ Connected to ${port.label} — now plug the other end` }

    } else if (cable.status === 'partial' && cable.endpointA) {
      // Second end — create the link!
      const updatedCable = { ...cable, status: 'connected' as const, endpointB: portId }
      nextCables.set(cableId, updatedCable)

      const portA = this.state.ports.get(cable.endpointA)!
      const link: Link = {
        cableId,
        portA: cable.endpointA,
        portB: portId,
        deviceA: portA.deviceId,
        deviceB: port.deviceId,
        established: Date.now(),
      }
      nextLinks.set(cableId, link)

      this.state = {
        ...this.state,
        ports:       nextPorts,
        cables:      nextCables,
        links:       nextLinks,
        heldCableId: null,   // player releases cable
      }
      
      // Update pure-TypeScript simulation engine
      simulationEngine.connectCable(cableId, cable.endpointA, portId)
      
      this.notify()

      return {
        success: true,
        message: `✓ Link established: ${portA.deviceId} ↔ ${port.deviceId}`,
        link,
      }
    }

    return { success: false, message: 'Unexpected cable state' }
  }

  /**
   * Player presses D while looking at an occupied port.
   * Unplugs the cable completely from BOTH ports.
   * The cable drops to the floor (coiled).
   */
  disconnectPort(portId: string): boolean {
    const port = this.state.ports.get(portId)
    if (!port || !port.connectedCableId) return false
    
    const cableId = port.connectedCableId
    const cable = this.state.cables.get(cableId)
    if (!cable) return false

    // Cannot unplug if holding a DIFFERENT cable or a device
    if (this.state.heldCableId && this.state.heldCableId !== cableId) return false
    if (this.state.heldDeviceId) return false

    const nextPorts = new Map(this.state.ports)
    const nextCables = new Map(this.state.cables)
    const nextLinks = new Map(this.state.links)

    // Free the port
    nextPorts.set(portId, { ...port, connectedCableId: null })

    if (cable.status === 'connected') {
      const otherPortId = cable.endpointA === portId ? cable.endpointB : cable.endpointA
      // Disconnect at the engine level (this handles the simulation logic)
      simulationEngine.disconnectCable(portId)
      // Break the link
      nextLinks.delete(cableId)
      
      // The cable is now only connected to the other port. The player holds the loose end.
      nextCables.set(cableId, {
        ...cable,
        status: 'partial',
        endpointA: otherPortId,
        endpointB: null
      })
      this.state.heldCableId = cableId
    } else if (cable.status === 'partial') {
      // Disconnect at the engine level
      simulationEngine.disconnectCable(portId)
      // It was only connected here, now the player holds the entire free cable
      nextCables.set(cableId, {
        ...cable,
        status: 'held',
        endpointA: null,
        endpointB: null
      })
      this.state.heldCableId = cableId
    }

    this.state = {
      ...this.state,
      ports: nextPorts,
      cables: nextCables,
      links: nextLinks,
    }
    this.notify()
    return true
  }

  /* ── Interaction state ───────────────────────────────── */
  private _disconnectPort(portId: string, cableId: string) {
    const port = this.state.ports.get(portId)
    if (port?.connectedCableId === cableId) {
      const nextPorts = new Map(this.state.ports)
      nextPorts.set(portId, { ...port, connectedCableId: null })
      this.state = { ...this.state, ports: nextPorts }
    }
  }

  /** Get all links as an array */
  getLinks(): Link[] {
    return Array.from(this.state.links.values())
  }

  /** Check if two devices are linked (directly) */
  areLinked(deviceA: string, deviceB: string): boolean {
    for (const link of this.state.links.values()) {
      if ((link.deviceA === deviceA && link.deviceB === deviceB) ||
          (link.deviceA === deviceB && link.deviceB === deviceA)) {
        return true
      }
    }
    return false
  }

  /** Dump topology to console for debugging */
  logTopology() {
    console.group('[NetLab] Network Topology')
    console.log('Ports:', this.state.ports.size)
    console.log('Cables:', this.state.cables.size)
    console.log('Links:')
    this.state.links.forEach(l =>
      console.log(`  ${l.deviceA} ↔ ${l.deviceB}  [cable: ${l.cableId}]`)
    )
    console.groupEnd()
  }

  /* ── Packet Capture ──────────────────────────────────── */

  setCapturingCable(cableId: string | null) {
    this.state = { ...this.state, capturingCableId: cableId }
    simulationEngine.capturingCableId = cableId
    if (cableId === null) {
      this.state.capturedPackets = []
    }
    this.notify()
  }

  addCapturedPacket(packet: import('./types').CapturedPacket) {
    // Only keep last 1000 packets to avoid memory leak
    const nextPackets = [...this.state.capturedPackets, packet].slice(-1000)
    this.state = { ...this.state, capturedPackets: nextPackets }
    this.notify()
  }

  clearCapturedPackets() {
    this.state = { ...this.state, capturedPackets: [] }
    this.notify()
  }

  toggleSniffer() {
    this.state = { ...this.state, isSnifferOpen: !this.state.isSnifferOpen }
    this.notify()
  }

  /* ── Packet Animation ────────────────────────────────── */

  setAnimationMode(enabled: boolean) {
    this.state = { ...this.state, animationMode: enabled, activeTrace: null, currentHopIndex: 0 }
    simulationEngine.animationMode = enabled
    this.notify()
  }

  setActiveTrace(trace: import('./types').PacketTrace | null) {
    this.state = { 
      ...this.state, 
      activeTrace: trace, 
      playbackState: 'playing', 
      currentHopIndex: 0 
    }
    this.notify()
  }

  setPlaybackState(state: 'playing' | 'paused') {
    this.state = { ...this.state, playbackState: state }
    this.notify()
  }

  setCurrentHopIndex(index: number) {
    if (!this.state.activeTrace) return
    const clamped = Math.max(0, Math.min(index, this.state.activeTrace.hops.length - 1))
    this.state = { ...this.state, currentHopIndex: clamped }
    this.notify()
  }

  /* ── Scenarios ───────────────────────────────────────── */

  toggleScenarios() {
    this.state = { ...this.state, isScenariosOpen: !this.state.isScenariosOpen }
    this.notify()
  }

  setActiveScenarioId(id: string | null) {
    this.state = { ...this.state, activeScenarioId: id, scenarioSuccess: false }
    this.notify()
  }

  setScenarioSuccess(success: boolean) {
    this.state = { ...this.state, scenarioSuccess: success }
    this.notify()
  }

  /* ── Project Management ──────────────────────────────── */

  toggleProjectMenu() {
    this.state = { ...this.state, isProjectMenuOpen: !this.state.isProjectMenuOpen }
    this.notify()
  }

  setProjectMenuOpen(open: boolean) {
    this.state = { ...this.state, isProjectMenuOpen: open }
    this.notify()
  }

  /* ── Topology Editor ──────────────────────────────── */

  toggleTopologyEditor = () => {
    this.state = { ...this.state, isTopologyEditorOpen: !this.state.isTopologyEditorOpen }
    this.notify()
  }

  toggleEventLog = () => {
    this.state = { ...this.state, isEventLogOpen: !this.state.isEventLogOpen }
    this.notify()
  }

  setTopologyEditorOpen(open: boolean) {
    this.state = { ...this.state, isTopologyEditorOpen: open }
    this.notify()
  }

  /* ── Simulation Controls ──────────────────────────── */

  setSimulationState(s: 'running' | 'paused' | 'stopped') {
    this.state = { ...this.state, simulationState: s }
    this.notify()
  }

  setSimulationSpeed(speed: number) {
    this.state = { ...this.state, simulationSpeed: speed }
    this.notify()
  }

  setSimulationTime(time: number) {
    this.state = { ...this.state, simulationTime: time }
    this.notify()
  }
  /* ── Inventory & Dynamic Devices ──────────────────── */

  toggleInventory = () => {
    this.state = { ...this.state, isInventoryOpen: !this.state.isInventoryOpen }
    this.notify()
  }

  setInventoryOpen(open: boolean) {
    this.state = { ...this.state, isInventoryOpen: open }
    this.notify()
  }

  /* ── Devices ─────────────────────────────────────────── */

  /**
   * Spawn a new dynamic device on the canvas
   */
  spawnDynamicDevice(id: string, type: 'Router'|'Switch'|'PC'|'Server'|'Firewall'|'Storage', position: [number, number, number]) {
    const nextDevices = [...this.state.devices, { id, type, position }]
    this.state = { ...this.state, devices: nextDevices }
    this.notify()
  }

  pickUpDevice(id: string): boolean {
    if (this.state.heldDeviceId || this.state.heldCableId) return false
    const device = this.state.devices.find(d => d.id === id)
    if (!device) return false
    
    // Check if it has connected cables
    const devicePorts = Array.from(this.state.ports.values()).filter(p => p.deviceId === id)
    const hasConnectedCables = devicePorts.some(p => p.connectedCableId !== null)
    if (hasConnectedCables) {
      console.warn(`[NetLab] Cannot pick up ${id} — unplug all cables first.`)
      // Instead of failing silently, we can trigger a DOM event or just fail
      return false
    }

    this.state = {
      ...this.state,
      heldDeviceId: id,
      heldDeviceType: device.type,
      // Remove from active placed devices while held
      devices: this.state.devices.filter(d => d.id !== id)
    }
    this.notify()
    return true
  }

  dropDevice(position: [number, number, number]) {
    if (!this.state.heldDeviceId || !this.state.heldDeviceType) return
    const id = this.state.heldDeviceId
    const type = this.state.heldDeviceType

    // Update physical positions of all ports for this device
    const nextPorts = new Map(this.state.ports)
    for (const [portId, port] of nextPorts.entries()) {
      if (port.deviceId === id) {
        // Just offset the port position dynamically from the device base position
        // This is an approximation since exact port locations vary by model,
        // but since we only have one generic port highlight, we can just center them
        // or apply a fixed offset.
        // For simplicity, we just put them roughly inside the device mesh bounds.
        nextPorts.set(portId, { ...port, worldPosition: position })
      }
    }

    this.state = {
      ...this.state,
      ports: nextPorts,
      devices: [...this.state.devices, { id, type, position }],
      heldDeviceId: null,
      heldDeviceType: null
    }
    this.notify()
  }
}

/** Singleton — import this everywhere */
export const NetworkStore = new NetworkStoreClass()
