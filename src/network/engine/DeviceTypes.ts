/**
 * DeviceTypes.ts — Enumerated device and interface types.
 *
 * Pure TypeScript — no Three.js dependency.
 * Shared across the entire engine.
 */

export interface DeviceCapabilities {
  console: boolean
  cli: boolean
  terminal_type: 'cisco_ios' | 'linux' | 'vpcs' | 'windows' | 'none'
}


/** All device categories supported by the simulation. */
export type DeviceType =
  | 'router'
  | 'layer2switch'
  | 'layer3switch'
  | 'pc'
  | 'server'
  | 'firewall'
  | 'storage'
  | 'accesspoint'
  | 'hub'
  | 'printer'
  | 'cloud'
  | 'generic'

/** Physical port types on a device chassis. */
export type PortType =
  | 'ethernet'    // RJ-45 Ethernet
  | 'console'     // RJ-45 / DB-9 console
  | 'serial'      // Serial WAN (DB-60, etc.)
  | 'fiber'       // SFP / GBIC fiber
  | 'usb'         // USB management

/** Network interface hardware types. */
export type InterfaceType =
  | 'FastEthernet'
  | 'GigabitEthernet'
  | 'TenGigabitEthernet'
  | 'Serial'
  | 'Loopback'
  | 'Vlan'
  | 'Tunnel'
  | 'Null'

/** Admin (configured) state of an interface — set by operator. */
export type AdminStatus = 'up' | 'down'

/** Operational line-protocol state — determined by the engine. */
export type OperStatus = 'up' | 'down' | 'testing'

/** Duplex mode. */
export type Duplex = 'full' | 'half' | 'auto'

/** Device operational status. */
export type DeviceStatus = 'OFF' | 'STARTING' | 'RUNNING' | 'STOPPING' | 'ERROR'
