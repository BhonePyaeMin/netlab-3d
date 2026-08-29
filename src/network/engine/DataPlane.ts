/**
 * DataPlane.ts — Definitions for simulated network traffic payloads.
 */

export interface EthernetFrame {
  /** Source MAC Address (e.g. 00:1A:2B:3C:4D:5E) */
  srcMac: string
  
  /** Destination MAC Address (e.g. FF:FF:FF:FF:FF:FF) */
  dstMac: string
  
  /** EtherType (e.g. 0x0800 for IPv4, 0x0806 for ARP) */
  ethertype: number
  
  /** Payload (IP packet, ARP packet, etc.) */
  payload: any
}

export type Frame = EthernetFrame

export interface ArpPacket {
  operation: 'request' | 'reply'
  senderMac: string
  senderIp: string
  targetMac: string
  targetIp: string
}

export interface IPv4Packet {
  srcIp: string
  dstIp: string
  protocol: number // 1 = ICMP, 6 = TCP, 17 = UDP, 89 = OSPF
  ttl: number
  payload: any
}

export interface ICMPPacket {
  type: number          // 8 = Echo Request, 0 = Echo Reply, 11 = Time Exceeded, 3 = Unreachable
  code: number          // 0 = general
  identifier: number    // ping session id
  sequenceNumber: number
  payload: string
}

export interface IPv6Packet {
  srcIp: string
  dstIp: string
  nextHeader: number // 58 = ICMPv6, 6 = TCP, 17 = UDP
  hopLimit: number
  payload: any
}

export interface ICMPv6Packet {
  type: number // 128 = Echo Request, 129 = Echo Reply, 135 = Neighbor Solicitation, 136 = Neighbor Advertisement, 3 = Time Exceeded
  code: number
  payload: any // For Echo: { identifier, sequenceNumber, data }. For NS/NA: NdpPayload. For Time Exceeded: string/header
}

export interface NdpPayload {
  targetAddress: string
  targetMac?: string
}

export interface TCPPacket {
  srcPort: number
  dstPort: number
  sequenceNumber: number
  acknowledgmentNumber: number
  flags: number         // SYN=0x02, ACK=0x10, FIN=0x01, RST=0x04
  windowSize: number
  checksum: number
  payload: any
}


export interface Dot1QPayload {
  vlanId: number
  ethertype: number
  payload: any
}

// OSPF Data Structures

export type OSPFPacketType = 'hello' | 'dbd' | 'lsr' | 'lsu' | 'lsack'

export interface OSPFHeader {
  version: number // usually 2
  type: OSPFPacketType
  packetLength: number
  routerId: string
  areaId: string
  checksum: number
  authtype: number
  authentication: number
  payload: OSPFHello | OSPFLSU // simplified
}

export interface OSPFHello {
  networkMask: string
  helloInterval: number
  options: number
  rtrPriority: number
  routerDeadInterval: number
  designatedRouter: string
  backupDesignatedRouter: string
  neighbors: string[] // List of router IDs
}

export interface OSPFLSU {
  lsas: OSPFLSA[]
}

export interface OSPFLSA {
  age: number
  type: 1 | 2 // 1 = Router, 2 = Network (simplified to 1 for ptp simulation)
  linkStateId: string // Router ID of the originator
  advertisingRouter: string // Router ID
  sequenceNumber: number
  links: OSPFLink[]
}

export interface OSPFLink {
  id: string // Neighbor Router ID or Network Address depending on type
  data: string // Interface IP Address or Subnet Mask
  type: 1 | 2 | 3 // 1 = Point-to-Point, 2 = Transit, 3 = Stub
  metric: number
}

// UDP Data Structures
export interface UDPPacket {
  srcPort: number
  dstPort: number
  length: number
  checksum: number
  payload: any
}

// RIP Data Structures
export interface RIPPacket {
  command: 1 | 2 // 1 = Request, 2 = Response
  version: 1 | 2
  entries: RIPRouteEntry[]
}

export interface RIPRouteEntry {
  addressFamily: number // 2 for IP
  routeTag: number
  ipAddress: string
  subnetMask: string
  nextHop: string
  metric: number // 1-15, 16 is unreachable
}

// DHCP Data Structures
export interface DHCPPacket {
  op: 1 | 2 // 1 = BootRequest, 2 = BootReply
  xid: number // Transaction ID
  ciaddr: string // Client IP address
  yiaddr: string // 'Your' (client) IP address
  siaddr: string // Next server IP address
  chaddr: string // Client MAC address
  options: DHCPOptions
}

export interface DHCPOptions {
  messageType?: 1 | 2 | 3 | 5 | 8 // 1=Discover, 2=Offer, 3=Request, 5=Ack, 8=Inform
  subnetMask?: string
  router?: string
  dnsServer?: string
  ipAddressLeaseTime?: number
  serverIdentifier?: string
  requestedIpAddress?: string
}

// DNS Data Structures
export interface DNSPacket {
  id: number          // Transaction ID
  qr: 0 | 1          // 0 = Query, 1 = Response
  opcode: number      // 0 = Standard query
  aa: boolean         // Authoritative Answer
  tc: boolean         // Truncated
  rd: boolean         // Recursion Desired
  ra: boolean         // Recursion Available
  rcode: number       // 0 = No error, 3 = NXDomain
  questions: DNSQuestion[]
  answers: DNSRecord[]
}

export interface DNSQuestion {
  name: string         // Hostname (e.g. "server.lab.local")
  type: 1 | 28        // 1 = A (IPv4), 28 = AAAA (IPv6)
  class: 1            // 1 = IN (Internet)
}

export interface DNSRecord {
  name: string
  type: 1 | 28
  class: 1
  ttl: number
  data: string        // IP address
}


