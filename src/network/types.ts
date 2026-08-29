/**
 * types.ts — Core network data types.
 *
 * These are PURE TypeScript — no Three.js dependency.
 * The network topology engine can run independently of the renderer.
 */

/** Physical port on a network device. */
export interface Port {
  /** Unique port ID, e.g. "Router1_G0/0" */
  id: string
  /** Device this port belongs to */
  deviceId: string
  /** Port type — only same-type ports can connect */
  portType: 'ethernet' | 'console' | 'serial'
  /** Which cable is plugged in, null if empty */
  connectedCableId: string | null
  /** World-space position of the port socket [x, y, z] */
  worldPosition: [number, number, number]
  /** Human-readable name shown to player */
  label: string
}

/** Physical Ethernet cable object. */
export interface Cable {
  /** Unique cable ID */
  id: string
  /** Port ID of end A — null if not connected */
  endpointA: string | null
  /** Port ID of end B — null if not connected */
  endpointB: string | null
  /** Visual colour (#hex) */
  color: string
  /**
   * Status of this cable:
   *  'coiled'     — lying on floor, not picked up
   *  'held'       — player is carrying it (endpointA = null, endpointB = null)
   *  'partial'    — one end connected, player holding the other
   *  'connected'  — both ends plugged in
   */
  status: 'coiled' | 'held' | 'partial' | 'connected'
  /** World position of the coil spawn (floor) */
  spawnPosition: [number, number, number]
}

/** A link between two ports (both ends of a cable connected). */
export interface Link {
  cableId: string
  portA: string
  portB: string
  deviceA: string
  deviceB: string
  established: number  // timestamp
}

export interface CapturedPacket {
  id: number
  timestamp: number
  cableId?: string
  srcMac: string
  dstMac: string
  srcIp?: string
  dstIp?: string
  protocol: string
  vlan: number
  ttl?: number
  srcPort?: number
  dstPort?: number
  size: number
}

export interface PacketTraceHop {
  deviceId: string
  incomingPortId?: string
  outgoingPortId?: string
  decisions: string[]
  action: 'forward' | 'drop' | 'consume'
}

export interface PacketTrace {
  id: string
  timestamp: number
  protocol: string
  srcIp?: string
  dstIp?: string
  hops: PacketTraceHop[]
}

/** Result returned from topology operations */
export interface ConnectResult {
  success: boolean
  message: string
  link?: Link
}
