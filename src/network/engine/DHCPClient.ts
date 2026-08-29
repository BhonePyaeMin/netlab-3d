import { NetworkDevice } from './NetworkDevice'
import type { DHCPPacket, Frame, IPv4Packet, UDPPacket } from './DataPlane'

export class DHCPClient {
  public device: NetworkDevice
  public intfId: string
  
  public state: 'Init' | 'Selecting' | 'Requesting' | 'Bound' = 'Init'
  public serverIdentifier?: string
  public offeredIp?: string
  
  private xid: number = Math.floor(Math.random() * 0xFFFFFFFF)

  constructor(device: NetworkDevice, intfId: string) {
    this.device = device
    this.intfId = intfId
  }

  public start() {
    this.state = 'Selecting'
    this.xid = Math.floor(Math.random() * 0xFFFFFFFF)
    this.sendDiscover()
  }

  private sendDiscover() {
    const intf = this.device.getInterface(this.intfId)
    if (!intf) return

    const dhcpDiscover: DHCPPacket = {
      op: 1, // BootRequest
      xid: this.xid,
      ciaddr: '0.0.0.0',
      yiaddr: '0.0.0.0',
      siaddr: '0.0.0.0',
      chaddr: intf.macAddress,
      options: {
        messageType: 1 // Discover
      }
    }

    this.sendPacket(dhcpDiscover)
  }

  private sendRequest(requestedIp: string, serverId: string) {
    const intf = this.device.getInterface(this.intfId)
    if (!intf) return

    const dhcpRequest: DHCPPacket = {
      op: 1, // BootRequest
      xid: this.xid,
      ciaddr: '0.0.0.0',
      yiaddr: '0.0.0.0',
      siaddr: '0.0.0.0',
      chaddr: intf.macAddress,
      options: {
        messageType: 3, // Request
        requestedIpAddress: requestedIp,
        serverIdentifier: serverId
      }
    }

    this.sendPacket(dhcpRequest)
  }

  private sendPacket(dhcpPayload: DHCPPacket) {
    const intf = this.device.getInterface(this.intfId)
    if (!intf) return

    const udpPacket: UDPPacket = {
      srcPort: 68,
      dstPort: 67,
      length: 300,
      checksum: 0,
      payload: dhcpPayload
    }

    const ipPacket: IPv4Packet = {
      version: 4,
      ihl: 5,
      tos: 0,
      totalLength: 320,
      identification: 0,
      flags: 0,
      fragmentOffset: 0,
      ttl: 255,
      protocol: 17, // UDP
      headerChecksum: 0,
      srcIp: '0.0.0.0',
      dstIp: '255.255.255.255',
      payload: udpPacket
    }

    const frame: Frame = {
      srcMac: intf.macAddress,
      dstMac: 'FF:FF:FF:FF:FF:FF',
      ethertype: 0x0800,
      payload: ipPacket
    }

    if (intf.type === 'subinterface' && intf.encapsulationDot1Q) {
      this.device.engine?.transmitFrame(this.device.id, intf.parentPortId!, {
        srcMac: frame.srcMac,
        dstMac: frame.dstMac,
        ethertype: 0x8100,
        payload: {
          vlanId: intf.encapsulationDot1Q,
          ethertype: 0x0800,
          payload: frame.payload
        }
      })
    } else {
      this.device.engine?.transmitFrame(this.device.id, intf.connectedPortId!, frame)
    }
  }

  public receiveDHCP(frame: Frame) {
    const intf = this.device.getInterface(this.intfId)
    if (!intf) return

    const ipPacket = frame.payload as IPv4Packet
    if (!ipPacket || ipPacket.protocol !== 17) return
    const udpPacket = ipPacket.payload as UDPPacket
    if (!udpPacket || udpPacket.dstPort !== 68) return
    const dhcpPacket = udpPacket.payload as DHCPPacket
    if (!dhcpPacket || dhcpPacket.op !== 2 || dhcpPacket.xid !== this.xid) return

    const msgType = dhcpPacket.options.messageType

    if (this.state === 'Selecting' && msgType === 2) {
      // Received Offer
      this.offeredIp = dhcpPacket.yiaddr
      this.serverIdentifier = dhcpPacket.options.serverIdentifier
      this.state = 'Requesting'
      
      if (this.offeredIp && this.serverIdentifier) {
        this.sendRequest(this.offeredIp, this.serverIdentifier)
      }
    } else if (this.state === 'Requesting' && msgType === 5) {
      // Received ACK
      this.state = 'Bound'
      intf.ipAddress = dhcpPacket.yiaddr
      intf.subnetMask = dhcpPacket.options.subnetMask || '255.255.255.0'
      
      // Setup default route if router provided
      if (dhcpPacket.options.router) {
        // Clear previous static default routes installed by DHCP
        this.device.staticRoutes = this.device.staticRoutes.filter(r => !(r.network === '0.0.0.0' && r.mask === '0.0.0.0'))
        
        this.device.staticRoutes.push({
          network: '0.0.0.0',
          mask: '0.0.0.0',
          nextHop: dhcpPacket.options.router,
          outgoingInterfaceId: this.intfId
        })
      }

      this.device.updateConnectedRoutes()
      
      console.log(`[${this.device.hostname} ${intf.name}] DHCP Bound: IP ${intf.ipAddress}/${intf.subnetMask}`)
    }
  }
}
