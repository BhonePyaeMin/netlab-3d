/**
 * INetworkEngine.ts — Abstraction for the core topology engine.
 */
import type { NetworkDevice } from './NetworkDevice'
import type { PhysicalPort }  from './PhysicalPort'
import type { EthernetFrame } from './DataPlane'

export interface INetworkEngine {
  /** Add a device to the simulation */
  addDevice(device: NetworkDevice): void

  /** Get a device by ID */
  getDevice(id: string): NetworkDevice | undefined

  /** Remove a device from the simulation */
  removeDevice(id: string): void

  /** Rename a device */
  renameDevice(id: string, newHostname: string): void

  /** Update a device's physical coordinates */
  moveDevice(id: string, x: number, y: number, z: number): void

  /** Register a physical port to the engine's global lookup */
  registerPort(port: PhysicalPort): void

  /** Get a physical port by ID */
  getPort(id: string): PhysicalPort | undefined

  /** Connect a cable between two ports */
  connectCable(cableId: string, portAId: string, portBId: string): void

  /** Disconnect a cable from a port */
  disconnectCable(portId: string): void

  /** Process a configuration command on a device */
  executeCommand(deviceId: string, command: string): string

  /** Get the current CLI prompt for a device */
  getPrompt(deviceId: string): string

  /** Get inline help for a command */
  getHelp(deviceId: string, command: string): string

  /** Tab completion for a command */
  autoComplete(deviceId: string, command: string): string

  /** Transmit a frame out of a physical port to across the simulated link */
  transmitFrame(sourceDeviceId: string, sourcePortId: string, frame: EthernetFrame): void
}
