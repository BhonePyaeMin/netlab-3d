/**
 * PhysicalPort.ts — Physical chassis port on a network device.
 *
 * A PhysicalPort is the RJ-45/SFP socket on the device body.
 * It can be connected to a Cable.
 * It maps to a logical Interface on routers/L3 switches.
 *
 * Pure TypeScript — no Three.js dependency.
 */
import type { PortType } from './DeviceTypes'

export interface PhysicalPort {
  /** Globally unique port ID, e.g. "Router1_G0/0" */
  readonly id: string

  /** Device this port belongs to */
  readonly deviceId: string

  /** Human-readable port name, e.g. "GigabitEthernet0/0" */
  readonly name: string

  /** Physical connector type */
  readonly portType: PortType

  /** Link speed in Mbps (1000 = 1 Gbps) */
  readonly speedMbps: number

  /** Cable currently plugged in — null if empty */
  connectedCableId: string | null

  /** Remote port this is physically linked to (populated by topology engine) */
  remotePortId: string | null

  /** Whether a physical signal is detected on this port */
  linkDetected: boolean
}

/** Create a new PhysicalPort with defaults */
export function createPort(
  id: string,
  deviceId: string,
  name: string,
  portType: PortType = 'ethernet',
  speedMbps = 1000,
): PhysicalPort {
  return {
    id,
    deviceId,
    name,
    portType,
    speedMbps,
    connectedCableId: null,
    remotePortId: null,
    linkDetected: false,
  }
}
