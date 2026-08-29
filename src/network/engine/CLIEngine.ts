/**
 * CLIEngine.ts — Cisco IOS CLI Parser State Machine
 */
import type { NetworkDevice } from './NetworkDevice'
import { IPMath }             from './IPMath'
import type { Router, PC, Server } from './Devices'
import { OSPFProcess } from './OSPFProcess'
import { RIPProcess } from './RIPProcess'
import { DHCPServer } from './DHCPServer'
import { DNSServer } from './DNSServer'
import type { AclProtocol, AclPortMatch } from './ACLEngine'
import type { ICMPPacket, IPv4Packet } from './DataPlane'
import { buildCdpNeighbors, buildLldpNeighbors, expandCdpCapabilities } from './NeighborDiscovery'

export type CLIMode = 'user' | 'priv' | 'config' | 'config-if' | 'config-router' | 'config-vlan' | 'config-dhcp'

export class CLISession {
  private device: NetworkDevice
  private mode: CLIMode = 'user'
  private currentContext: string = '' // e.g. "GigabitEthernet0/0" when in config-if
  private currentSubContext: string = '' // Used for dhcp pool names, router protocol types, etc.

  constructor(device: NetworkDevice) {
    this.device = device
  }

  public getPrompt(): string {
    const hostname = this.device.hostname
    const type = this.device.capabilities?.terminal_type || 'cisco_ios'
    
    if (type === 'linux') return `root@${hostname.toLowerCase()}:~#`
    if (type === 'windows') return `C:\\Users\\Administrator>`
    if (type === 'vpcs') return `${hostname}>`

    switch (this.mode) {
      case 'user': return `${hostname}>`
      case 'priv': return `${hostname}#`
      case 'config': return `${hostname}(config)#`
      case 'config-if': return `${hostname}(config-if)#`
      case 'config-router': return `${hostname}(config-router)#`
      case 'config-vlan': return `${hostname}(config-vlan)#`
      case 'config-dhcp': return `${hostname}(dhcp-config)#`
      default: return `${hostname}>`
    }
  }

  public getHelp(cmd: string): string {
    // Basic ? help
    if (this.mode === 'user') return `Exec commands:\n  enable  Turn on privileged commands\n  exit    Exit from the EXEC\n  ping    Send echo messages\n  show    Show running system information`
    if (this.mode === 'priv') return `Privileged commands:\n  configure  Enter configuration mode\n  copy       Copy from one file to another\n  disable    Turn off privileged commands\n  reload     Halt and perform a cold restart\n  write      Write running configuration to memory`
    if (this.mode === 'config') return `Global configuration commands:\n  exit       Exit from configure mode\n  hostname   Set system's network name\n  interface  Select an interface to configure\n  router     Enable a routing process`
    return `Help not available for current context.`
  }

  public autoComplete(cmd: string): string {
    // Super basic tab completion mock
    const dict = ['enable', 'disable', 'configure terminal', 'exit', 'end', 'hostname', 'show running-config', 'show startup-config', 'show interfaces', 'show ip interface brief', 'show version', 'write memory']
    const match = dict.find(d => d.startsWith(cmd))
    return match || cmd
  }

  public executeCommand(rawCmd: string): string {
    const cmd = rawCmd.trim().replace(/\s+/g, ' ')
    if (!cmd) return ''

    const tokens = cmd.split(' ')
    const root = tokens[0].toLowerCase()

    const type = this.device.capabilities?.terminal_type || 'cisco_ios'

    if (type === 'linux') {
      if (root === 'ping') return this.handlePing(tokens)
      if (root === 'ifconfig' || root === 'ip') return this.formatShowVpcsIp() // Mocking output for now
      if (root === 'clear') return ''
      if (root === 'ls') return 'bin  boot  dev  etc  home  lib  opt  root  run  sbin  tmp  usr  var'
      if (root === 'whoami') return 'root'
      return `bash: ${root}: command not found`
    }

    if (type === 'windows') {
      if (root === 'ping') return this.handlePing(tokens)
      if (root === 'ipconfig') return this.formatShowVpcsIp() // Mocking output
      if (root === 'cls') return ''
      if (root === 'dir') return ' Volume in drive C has no label.\n Directory of C:\\Users\\Administrator'
      if (root === 'whoami') return 'NT AUTHORITY\\SYSTEM'
      return `'${root}' is not recognized as an internal or external command, operable program or batch file.`
    }

    // VPCS specific commands
    if (this.device.deviceType === 'pc') {
      if (root === 'ip') {
        const intf = Array.from(this.device.interfaces.values())[0]
        if (!intf) return '% No interface available'
        
        if (!tokens[1]) {
          return this.formatShowVpcsIp()
        }
        
        if (tokens[1].toLowerCase() === 'dhcp') {
          intf.ipAddress = 'dhcp'
          intf.subnetMask = undefined
          this.device.defaultGateway = null
          this.device.updateConnectedRoutes()
          return 'DDORA IP 0.0.0.0/0 GW 0.0.0.0' // Placeholder for DHCP start
        }
        
        let ip: string, mask: string, gw: string | undefined
        
        if (tokens[1].includes('/')) {
          const parts = tokens[1].split('/')
          ip = parts[0]
          try {
            mask = IPMath.prefixToMask(parseInt(parts[1], 10))
          } catch (e) {
            return 'Invalid subnet mask'
          }
          gw = tokens[2]
        } else {
          ip = tokens[1]
          mask = tokens[2]
          gw = tokens[3]
        }
        
        if (!IPMath.validateIp(ip)) return 'Invalid IP address'
        if (!IPMath.validateMask(mask)) return 'Invalid subnet mask'
        if (gw && !IPMath.validateIp(gw)) return 'Invalid gateway'
        
        intf.ipAddress = ip
        intf.subnetMask = mask
        intf.adminStatus = 'up' // VPCS implicitly brings interface up
        this.device.defaultGateway = gw || null
        
        // Setup default route
        if (gw) {
          this.device.staticRoutes = this.device.staticRoutes.filter(r => r.network !== '0.0.0.0')
          this.device.staticRoutes.push({
            network: '0.0.0.0',
            mask: '0.0.0.0',
            nextHop: gw,
            outgoingInterfaceId: null,
            metric: 1,
            administrativeDistance: 1,
            protocol: 'static'
          })
        }
        this.device.updateConnectedRoutes()
        
        return `Checking for duplicate IPv4 address...\nPC1 : ${ip} ${mask} gateway ${gw || ''}`
      }
      
      if (root === 'show' && tokens[1]?.toLowerCase() === 'ip') {
        return this.formatShowVpcsIp()
      }
      
      if (root === 'ping') {
        if (tokens[1] === 'ipv6') tokens.splice(1, 1)
        return this.handlePing(tokens)
      }
      if (root === 'traceroute' || root === 'tracert') {
        return this.handleTraceroute(tokens)
      }
      if (root === 'arp') {
        return this.formatShowArp()
      }
      
      if (root === 'save') {
        // In this simulation, saving just copies running state to a persistent mock state
        // or just returns success since state is already retained in memory.
        this.device.startupConfig = this.device.generateRunningConfig()
        return `Saving startup configuration to startup.vpc\n.  done`
      }
      
      // If it's a PC and not a supported command, return an error immediately
      return `% Invalid input detected at '^' marker.`
    }

    // Global navigation commands
    if (root === 'clear' && tokens[1] === 'logging') {
      this.device.logs = []
      return ''
    }

    if (root === 'exit') {
      if (this.mode === 'config-if' || this.mode === 'config-router' || this.mode === 'config-vlan' || this.mode === 'config-dhcp') {
        this.mode = 'config'
        this.currentContext = ''
        this.currentSubContext = ''
        return ''
      }
      if (this.mode === 'config') {
        this.mode = 'priv'
        return ''
      }
      if (this.mode === 'priv') {
        this.mode = 'user'
        return ''
      }
      return '' // cannot exit user
    }

    if (root === 'end') {
      this.mode = 'priv'
      this.currentContext = ''
      this.currentSubContext = ''
      return ''
    }

    if (this.mode === 'user') {
      if (root === 'enable' || root === 'en') {
        this.mode = 'priv'
        return ''
      }
      if (root === 'ping') {
        if (tokens[1] === 'ipv6') tokens.splice(1, 1)
        return this.handlePing(tokens)
      }
      if (root === 'traceroute' || root === 'tracert') {
        return this.handleTraceroute(tokens)
      }
    }

    if (this.mode === 'priv') {
      if (root === 'ping') {
        return this.handlePing(tokens)
      }
      if (root === 'traceroute' || root === 'tracert') {
        return this.handleTraceroute(tokens)
      }
      if (root === 'disable') {
        this.mode = 'user'
        return ''
      }
      if (root === 'configure' || root === 'conf') {
        if (tokens[1] === 'terminal' || tokens[1] === 't' || !tokens[1]) {
          this.mode = 'config'
          return 'Enter configuration commands, one per line.  End with CNTL/Z.'
        }
      }
      if (root === 'write' && tokens[1] === 'memory') {
        this.device.startupConfig = this.device.generateRunningConfig()
        return 'Building configuration...\n[OK]'
      }
      if (root === 'show' || root === 'sh') {
        return this.handleShowCommand(tokens)
      }
      if (root === 'reload') {
        this.mode = 'user'
        return 'Proceed with reload? [confirm]\nSystem is restarting...'
      }
    }

    if (this.mode === 'config') {
      if (root === 'vlan') {
        const vlanId = parseInt(tokens[1], 10)
        if (!isNaN(vlanId) && vlanId >= 1 && vlanId <= 4094) {
          if (!this.device.vlanDatabase.has(vlanId)) {
            this.device.vlanDatabase.set(vlanId, { id: vlanId, name: `VLAN${vlanId.toString().padStart(4, '0')}` })
          }
          this.mode = 'config-vlan'
          this.currentContext = vlanId.toString()
          return ''
        }
        return '% Invalid VLAN ID'
      }

      if (root === 'ipv6' && tokens[1] === 'unicast-routing') {
        this.device.ipv6UnicastRoutingEnabled = true
        return ''
      }
      if (root === 'no' && tokens[1] === 'ipv6' && tokens[2] === 'unicast-routing') {
        this.device.ipv6UnicastRoutingEnabled = false
        return ''
      }

      // CDP enable/disable (global config)
      if (root === 'cdp' && tokens[1] === 'run') {
        this.device.cdpEnabled = true
        return ''
      }
      if (root === 'no' && tokens[1] === 'cdp' && tokens[2] === 'run') {
        this.device.cdpEnabled = false
        return ''
      }
      // LLDP enable/disable (global config)
      if (root === 'lldp' && tokens[1] === 'run') {
        this.device.lldpEnabled = true
        return ''
      }
      if (root === 'no' && tokens[1] === 'lldp' && tokens[2] === 'run') {
        this.device.lldpEnabled = false
        return ''
      }

      if (root === 'hostname') {
        const name = tokens[1]
        if (name) {
          this.device.engine?.renameDevice(this.device.id, name)
          return ''
        }
        return '% Incomplete command.'
      }
      
      if (root === 'ip' && tokens[1] === 'route') {
        const dest = tokens[2]
        const mask = tokens[3]
        const nextHopOrIntf = tokens[4]
        const metricStr = tokens[5]
        
        if (!dest || !mask || !nextHopOrIntf) return '% Incomplete command.'
        
        if (!IPMath.validateIp(dest)) return '% Invalid destination IP address'
        if (!IPMath.validateMask(mask)) return '% Invalid subnet mask'
        
        let nextHop: string | null = null
        let outgoingInterfaceId: string | null = null
        
        if (IPMath.validateIp(nextHopOrIntf)) {
          nextHop = nextHopOrIntf
        } else {
          // Assume it's an interface name
          const exists = Array.from(this.device.interfaces.values()).find(i => 
            i.name.toLowerCase() === nextHopOrIntf.toLowerCase() ||
            i.name.toLowerCase().startsWith(nextHopOrIntf.toLowerCase())
          )
          if (exists) {
            outgoingInterfaceId = exists.id
          } else {
            return '% Invalid next-hop or interface'
          }
        }
        
        const metric = metricStr ? parseInt(metricStr, 10) : 1
        
        // Remove existing identical route if it exists
        this.device.staticRoutes = this.device.staticRoutes.filter(r => 
          !(r.network === dest && r.mask === mask && r.nextHop === nextHop && r.outgoingInterfaceId === outgoingInterfaceId)
        )
        
        this.device.staticRoutes.push({
          network: dest,
          mask: mask,
          nextHop,
          outgoingInterfaceId,
          metric,
          administrativeDistance: outgoingInterfaceId ? 0 : 1, // Directly connected static routes have AD 0
          protocol: 'static'
        })
        
        this.device.log(`%ROUTE-5-ADD: Route to ${dest}/${mask} added via ${nextHop || outgoingInterfaceId}`)
        this.device.updateConnectedRoutes()
        return ''
      }
      
      if (root === 'no' && tokens[1] === 'ip' && tokens[2] === 'route') {
        const dest = tokens[3]
        const mask = tokens[4]
        const nextHopOrIntf = tokens[5]
        
        if (!dest || !mask || !nextHopOrIntf) return '% Incomplete command.'
        
        let nextHop: string | null = null
        let outgoingInterfaceId: string | null = null
        
        if (IPMath.validateIp(nextHopOrIntf)) {
          nextHop = nextHopOrIntf
        } else {
          const exists = Array.from(this.device.interfaces.values()).find(i => 
            i.name.toLowerCase() === nextHopOrIntf.toLowerCase() ||
            i.name.toLowerCase().startsWith(nextHopOrIntf.toLowerCase())
          )
          if (exists) {
            outgoingInterfaceId = exists.id
          }
        }
        
        this.device.staticRoutes = this.device.staticRoutes.filter(r => 
          !(r.network === dest && r.mask === mask && r.nextHop === nextHop && r.outgoingInterfaceId === outgoingInterfaceId)
        )
        this.device.log(`%ROUTE-5-REMOVE: Route to ${dest}/${mask} removed`)
        this.device.updateConnectedRoutes()
        return ''
      }

      // NAT Global configuration
      if (root === 'ip' && tokens[1] === 'nat' && tokens[2] === 'inside' && tokens[3] === 'source') {
        const routerDev = this.device as unknown as Router
        if (tokens[4] === 'static') {
          const localIp = tokens[5]
          const globalIp = tokens[6]
          if (IPMath.validateIp(localIp) && IPMath.validateIp(globalIp)) {
            routerDev.natProcess.addStaticMapping(localIp, globalIp)
            return ''
          }
          return '% Invalid IP address'
        }
        if (tokens[4] === 'list') {
          const aclName = tokens[5]
          if (tokens[6] === 'interface') {
            const intfName = tokens[7]
            if (aclName && intfName) {
              const outIntf = Array.from(this.device.interfaces.values()).find(i => 
                i.name.toLowerCase() === intfName.toLowerCase() ||
                i.name.toLowerCase().startsWith(intfName.toLowerCase())
              )
              if (outIntf) {
                routerDev.natProcess.addDynamicMapping(aclName, outIntf.id)
                return ''
              }
              return '% Invalid interface'
            }
          }
        }
        return '% Incomplete command.'
      }

      // ─── Standard ACL: access-list <1-99> permit|deny <src> [<wildcard>] ───
      // ─── Extended ACL: access-list <100-199> permit|deny <proto> <src> <wc> <dst> <wc> [eq <port>]
      if (root === 'access-list') {
        return this.parseAccessList(tokens)
      }

      if (root === 'no' && tokens[1] === 'access-list') {
        const aclId = tokens[2]
        if (!aclId) return '% Incomplete command.'
        this.device.aclEngine.deleteAcl(aclId)
        return ''
      }

      // Named ACL: ip access-list standard|extended <name>
      if (root === 'ip' && tokens[1] === 'access-list') {
        const type = tokens[2] as 'standard' | 'extended'
        const name = tokens[3]
        if ((type === 'standard' || type === 'extended') && name) {
          this.device.aclEngine.getOrCreateAcl(name, type)
          // TODO: enter named-acl sub-mode (future enhancement)
          return ''
        }
        return '% Incomplete command.'
      }

      if (root === 'interface' || root === 'int') {
        if (tokens[1]) {
          const intfRaw = tokens.slice(1).join(' ').toLowerCase()
          let intfName = intfRaw
          
          // Handle "interface vlan 10" or "int vlan10"
          if (intfName.startsWith('vlan')) {
            const vlanNumMatch = intfName.match(/vlan\s*(\d+)/)
            if (vlanNumMatch) {
              const vlanId = parseInt(vlanNumMatch[1], 10)
              const name = `Vlan${vlanId}`
              let exists = Array.from(this.device.interfaces.values()).find(i => i.name === name)
              if (!exists) {
                // Create SVI
                exists = {
                  id: `${this.device.id}_Vlan${vlanId}`,
                  deviceId: this.device.id,
                  name: name,
                  type: 'svi',
                  vlanId: vlanId,
                  macAddress: this.device.id.startsWith('SW') ? '00:00:00:11:11:11' : '00:00:00:22:22:22', // Mock MAC
                  ipAddress: null,
                  subnetMask: null,
                  ipv6Addresses: [],
                  ipv6LinkLocal: IPMath.generateIpv6LinkLocal(this.device.id.startsWith('SW') ? '00:00:00:11:11:11' : '00:00:00:22:22:22'),
                  adminStatus: 'up',
                  operStatus: 'up',
                  mtu: 1500,
                  speed: 1000,
                  duplex: 'auto',
                  description: '',
                  switchportMode: 'access',
                  accessVlan: 1,
                  trunkNativeVlan: 1,
                  trunkAllowedVlans: 'all',
                  connectedPortId: null
                }
                this.device.interfaces.set(exists.id, exists)
              }
              this.mode = 'config-if'
              this.currentContext = exists.name
              return ''
            }
          }
          
          // Helper to expand abbreviations like g0/0 -> gigabitethernet0/0
          let expandedName = intfName
          if (intfName.startsWith('g') && !intfName.startsWith('gi')) expandedName = intfName.replace('g', 'gigabitethernet')
          else if (intfName.startsWith('gi')) expandedName = intfName.replace('gi', 'gigabitethernet')
          else if (intfName.startsWith('f') && !intfName.startsWith('fa')) expandedName = intfName.replace('f', 'fastethernet')
          else if (intfName.startsWith('fa')) expandedName = intfName.replace('fa', 'fastethernet')

          let exists = Array.from(this.device.interfaces.values()).find(i => 
            i.name.toLowerCase() === expandedName || 
            i.name.toLowerCase() === intfName ||
            i.name.toLowerCase().startsWith(expandedName)
          )

          // If not found, check if it's a subinterface like gigabitethernet0/0.10
          if (!exists && expandedName.includes('.')) {
            const [parentName, subId] = expandedName.split('.')
            const parent = Array.from(this.device.interfaces.values()).find(i => 
              i.name.toLowerCase() === parentName ||
              i.name.toLowerCase().startsWith(parentName)
            )
            
            if (parent) {
              // Create subinterface
              const name = `${parent.name}.${subId}`
              exists = {
                id: `${parent.id}.${subId}`,
                deviceId: this.device.id,
                name: name,
                type: 'subinterface',
                parentPortId: parent.connectedPortId || undefined, // inherit physical port
                macAddress: parent.macAddress, // share MAC
                ipAddress: null,
                subnetMask: null,
                ipv6Addresses: [],
                ipv6LinkLocal: IPMath.generateIpv6LinkLocal(parent.macAddress),
                adminStatus: 'up',
                operStatus: 'up',
                mtu: 1500,
                speed: parent.speed,
                duplex: parent.duplex,
                description: '',
                switchportMode: 'access',
                accessVlan: 1,
                trunkNativeVlan: 1,
                trunkAllowedVlans: 'all',
                connectedPortId: parent.connectedPortId // share the same physical port for TX
              }
              this.device.interfaces.set(exists.id, exists)
            }
          }
          
          if (exists) {
            this.mode = 'config-if'
            this.currentContext = exists.name
            return ''
          }
          return '% Invalid interface type and number'
        }
      }

      if (root === 'router' && tokens[1] === 'ospf') {
        if (this.device.deviceType !== 'router' && this.device.deviceType !== 'layer3switch') {
          return '% Routing not supported on this device'
        }
        const pid = parseInt(tokens[2], 10)
        if (!isNaN(pid) && pid >= 1 && pid <= 65535) {
          const routerDev = this.device as unknown as Router
          if (!routerDev.ospfProcess) {
            routerDev.ospfProcess = new OSPFProcess(routerDev, pid)
          }
          this.mode = 'config-router'
          this.currentContext = pid.toString()
          this.currentSubContext = 'ospf'
          return ''
        }
        return '% Invalid process ID'
      }

      if (root === 'router' && tokens[1] === 'rip') {
        if (this.device.deviceType !== 'router' && this.device.deviceType !== 'layer3switch') {
          return '% Routing not supported on this device'
        }
        const routerDev = this.device as unknown as Router
        if (!routerDev.ripProcess) {
          routerDev.ripProcess = new RIPProcess(routerDev)
        }
        this.mode = 'config-router'
        this.currentContext = ''
        this.currentSubContext = 'rip'
        return ''
      }

      if (root === 'ip' && tokens[1] === 'dhcp' && tokens[2] === 'pool') {
        const poolName = tokens[3]
        if (!poolName) return '% Incomplete command.'
        if (this.device.deviceType !== 'router' && this.device.deviceType !== 'layer3switch') {
          return '% DHCP not supported on this device'
        }
        const routerDev = this.device as unknown as Router
        if (!routerDev.dhcpServer) {
          routerDev.dhcpServer = new DHCPServer(routerDev)
        }
        routerDev.dhcpServer.addPool(poolName)
        this.mode = 'config-dhcp'
        this.currentContext = poolName
        return ''
      }

      if (root === 'ip' && tokens[1] === 'dhcp' && tokens[2] === 'excluded-address') {
        const startIp = tokens[3]
        const endIp = tokens[4]
        if (!startIp || !IPMath.validateIp(startIp)) return '% Invalid IP address'
        if (endIp && !IPMath.validateIp(endIp)) return '% Invalid IP address'
        if (this.device.deviceType !== 'router' && this.device.deviceType !== 'layer3switch') {
           return '% DHCP not supported on this device'
        }
        const routerDev = this.device as unknown as Router
        if (!routerDev.dhcpServer) {
          routerDev.dhcpServer = new DHCPServer(routerDev)
        }
        routerDev.dhcpServer.addExcludedAddressRange(startIp, endIp || startIp)
        return ''
      }

      // DNS Server configuration
      if (root === 'ip' && tokens[1] === 'dns' && tokens[2] === 'server') {
        const anyRouter = this.device as unknown as Router
        const anySrv = this.device as unknown as Server
        const dnsHolder = (anyRouter.dnsServer !== undefined ? anyRouter : anySrv) as any
        if (!dnsHolder.dnsServer) {
          dnsHolder.dnsServer = new DNSServer(this.device)
        }
        dnsHolder.dnsServer.enabled = true
        return ''
      }

      if (root === 'no' && tokens[1] === 'ip' && tokens[2] === 'dns' && tokens[3] === 'server') {
        const dnsHolder = this.device as any
        if (dnsHolder.dnsServer) dnsHolder.dnsServer.enabled = false
        return ''
      }

      if (root === 'ip' && tokens[1] === 'host') {
        const hostname = tokens[2]
        const ipAddr = tokens[3]
        if (!hostname || !ipAddr || !IPMath.validateIp(ipAddr)) return '% Invalid hostname or IP'
        const dnsHolder = this.device as any
        if (!dnsHolder.dnsServer) {
          dnsHolder.dnsServer = new DNSServer(this.device)
          dnsHolder.dnsServer.enabled = true
        }
        dnsHolder.dnsServer.addRecord(hostname, ipAddr)
        return ''
      }

      if (root === 'no' && tokens[1] === 'ip' && tokens[2] === 'host') {
        const hostname = tokens[3]
        if (!hostname) return '% Incomplete command.'
        const dnsHolder = this.device as any
        dnsHolder.dnsServer?.removeRecord(hostname)
        return ''
      }

      if (root === 'ip' && tokens[1] === 'name-server') {
        const serverIp = tokens[2]
        if (!serverIp || !IPMath.validateIp(serverIp)) return '% Invalid IP address'
        const dnsHolder = this.device as any
        if (dnsHolder.dnsClient) {
          dnsHolder.dnsClient.serverIp = serverIp
        }
        return ''
      }
    }

    if (this.mode === 'config-vlan') {
      if (root === 'name') {
        const name = tokens[1]
        if (name) {
          const vlan = this.device.vlanDatabase.get(parseInt(this.currentContext, 10))
          if (vlan) {
            vlan.name = name
          }
          return ''
        }
        return '% Incomplete command.'
      }
    }

    if (this.mode === 'config-router') {
      const routerDev = this.device as unknown as Router
      
      if (this.currentSubContext === 'ospf') {
        const ospf = routerDev.ospfProcess
        if (!ospf) return '% Error: OSPF process not found'
  
        if (root === 'router-id') {
          const id = tokens[1]
          if (IPMath.validateIp(id)) {
            ospf.routerId = id
            return ''
          }
          return '% Invalid router-id'
        }
  
        if (root === 'network') {
          const net = tokens[1]
          const wild = tokens[2]
          if (tokens[3] === 'area' && tokens[4]) {
            if (IPMath.validateIp(net) && IPMath.validateIp(wild)) {
              ospf.addNetwork(net, wild, tokens[4])
              return ''
            }
          }
          return '% Invalid network statement'
        }
        
        if (root === 'no' && tokens[1] === 'network') {
          const net = tokens[2]
          const wild = tokens[3]
          if (tokens[4] === 'area' && tokens[5]) {
            ospf.removeNetwork(net, wild, tokens[5])
            return ''
          }
          return '% Invalid network statement'
        }
      }

      if (this.currentSubContext === 'rip') {
        const rip = routerDev.ripProcess
        if (!rip) return '% Error: RIP process not found'

        if (root === 'version') {
          const ver = parseInt(tokens[1], 10)
          if (ver === 1 || ver === 2) {
            rip.version = ver as 1 | 2
            return ''
          }
          return '% Invalid version'
        }

        if (root === 'no' && tokens[1] === 'auto-summary') {
          rip.autoSummary = false
          return ''
        }
        if (root === 'auto-summary') {
          rip.autoSummary = true
          return ''
        }

        if (root === 'network') {
          const net = tokens[1]
          if (IPMath.validateIp(net)) {
            rip.addNetwork(net)
            return ''
          }
          return '% Invalid network statement'
        }

        if (root === 'no' && tokens[1] === 'network') {
          const net = tokens[2]
          if (IPMath.validateIp(net)) {
            rip.removeNetwork(net)
            return ''
          }
          return '% Invalid network statement'
        }
      }
    }

    if (this.mode === 'config-dhcp') {
      const routerDev = this.device as unknown as Router
      const pool = routerDev.dhcpServer?.pools.get(this.currentContext)
      if (!pool) return '% Error: DHCP pool not found'

      if (root === 'network') {
        const net = tokens[1]
        const mask = tokens[2]
        if (IPMath.validateIp(net) && IPMath.validateMask(mask)) {
          pool.network = net
          pool.mask = mask
          return ''
        }
        return '% Invalid network or mask'
      }

      if (root === 'default-router') {
        const ip = tokens[1]
        if (IPMath.validateIp(ip)) {
          pool.defaultRouter = ip
          return ''
        }
        return '% Invalid IP address'
      }

      if (root === 'dns-server') {
        const ip = tokens[1]
        if (IPMath.validateIp(ip)) {
          pool.dnsServer = ip
          return ''
        }
        return '% Invalid IP address'
      }
    }

    if (this.mode === 'config-if') {
      const intf = Array.from(this.device.interfaces.values()).find(i => i.name === this.currentContext)
      if (!intf) return '% Error: Interface context lost'

      if (root === 'encapsulation' && tokens[1] === 'dot1q') {
        if (intf.type !== 'subinterface') {
          return '% Configuring IP routing on a LAN subinterface is only allowed if that subinterface is already configured as part of an IEEE 802.10, IEEE 802.1Q, or ISL vLAN.'
        }
        const vlanId = parseInt(tokens[2], 10)
        if (!isNaN(vlanId) && vlanId >= 1 && vlanId <= 4094) {
          intf.encapsulationDot1Q = vlanId
          return ''
        }
        return '% Invalid VLAN ID'
      }

      if (root === 'ip' && tokens[1] === 'address') {
        if (tokens[2] === 'dhcp') {
          intf.ipAddress = 'dhcp'
          intf.subnetMask = undefined
          return ''
        }

        const ip = tokens[2]
        let mask = tokens[3]
        
        if (!ip) return '% Incomplete command.'
        
        // Handle CIDR (e.g. 192.168.1.1/24)
        if (ip.includes('/')) {
          const [addr, prefix] = ip.split('/')
          if (IPMath.validateIp(addr) && !isNaN(parseInt(prefix, 10))) {
            try {
              mask = IPMath.prefixToMask(parseInt(prefix, 10))
              intf.ipAddress = addr
              intf.subnetMask = mask
              this.device.updateConnectedRoutes()
              return ''
            } catch (e) {
              return '% Invalid IP address or mask.'
            }
          }
        }
        
        if (!mask) return '% Incomplete command.'

        if (IPMath.validateIp(ip) && IPMath.validateMask(mask)) {
          intf.ipAddress = ip
          intf.subnetMask = mask
          this.device.updateConnectedRoutes()
          return ''
        }
        return '% Invalid IP address or mask.'
      }

      if (root === 'no' && tokens[1] === 'ip' && tokens[2] === 'address') {
        intf.ipAddress = null
        intf.subnetMask = null
        this.device.updateConnectedRoutes()
        return ''
      }

      if (root === 'ip' && tokens[1] === 'nat') {
        if (tokens[2] === 'inside') {
          intf.natZone = 'inside'
          return ''
        }
        if (tokens[2] === 'outside') {
          intf.natZone = 'outside'
          return ''
        }
        return '% Incomplete command.'
      }

      if (root === 'no' && tokens[1] === 'ip' && tokens[2] === 'nat') {
        intf.natZone = undefined
        return ''
      }

      // ip access-group <acl-name> in|out
      if (root === 'ip' && tokens[1] === 'access-group') {
        const aclId = tokens[2]
        const direction = tokens[3]?.toLowerCase() as 'in' | 'out'
        if (!aclId || (direction !== 'in' && direction !== 'out')) return '% Incomplete command.'
        const existing = this.device.interfaceAcls.get(intf.id) || {}
        existing[direction] = aclId
        this.device.interfaceAcls.set(intf.id, existing)
        return ''
      }

      if (root === 'no' && tokens[1] === 'ip' && tokens[2] === 'access-group') {
        const aclId = tokens[3]
        const direction = tokens[4]?.toLowerCase() as 'in' | 'out'
        if (aclId && (direction === 'in' || direction === 'out')) {
          const existing = this.device.interfaceAcls.get(intf.id)
          if (existing) {
            delete existing[direction]
            if (!existing.in && !existing.out) this.device.interfaceAcls.delete(intf.id)
          }
        }
        return ''
      }

      if (root === 'ipv6' && tokens[1] === 'address') {
        if (tokens[3] === 'link-local') {
          if (!IPMath.validateIpv6(tokens[2])) return '% Invalid IPv6 address'
          intf.ipv6LinkLocal = IPMath.shortenIpv6(tokens[2])
          this.device.updateConnectedIpv6Routes()
          return ''
        } else {
          const [ip, prefix] = tokens[2].split('/')
          if (!ip || !prefix || !IPMath.validateIpv6(ip)) return '% Invalid IPv6 address/prefix'
          const prefNum = parseInt(prefix, 10)
          if (prefNum < 0 || prefNum > 128) return '% Invalid prefix length'
          intf.ipv6Addresses = [tokens[2]]
          this.device.updateConnectedIpv6Routes()
          return ''
        }
      }

      if (root === 'no' && tokens[1] === 'ipv6' && tokens[2] === 'address') {
        intf.ipv6Addresses = []
        if (tokens[3] === 'link-local') intf.ipv6LinkLocal = IPMath.generateIpv6LinkLocal(intf.macAddress)
        this.device.updateConnectedIpv6Routes()
        return ''
      }

      if (root === 'shutdown' || root === 'shut') {
        intf.adminStatus = 'down'
        // Changing admin status affects operStatus immediately in simulation
        intf.operStatus = 'down'
        this.device.updateConnectedRoutes()
        return `\n%LINK-5-CHANGED: Interface ${intf.name}, changed state to administratively down`
      }

      if (root === 'no' && (tokens[1] === 'shutdown' || tokens[1] === 'shut')) {
        intf.adminStatus = 'up'
        // If it's connected to something, it should go up (mocking this for now as going up if connected)
        const p = this.device.getPort(intf.connectedPortId || '')
        if (p && p.linkDetected) {
          intf.operStatus = 'up'
        }
        this.device.updateConnectedRoutes()
        const stateStr = intf.operStatus === 'up' ? 'up' : 'down'
        return `\n%LINK-3-UPDOWN: Interface ${intf.name}, changed state to ${stateStr}`
      }
      
      if (root === 'description' || root === 'desc') {
        intf.description = tokens.slice(1).join(' ')
        return ''
      }

      if (root === 'switchport' || root === 'sw') {
        const cmd2 = tokens[1]
        if (cmd2 === 'mode') {
          if (tokens[2] === 'access') {
            intf.switchportMode = 'access'
            return ''
          }
          if (tokens[2] === 'trunk') {
            intf.switchportMode = 'trunk'
            return ''
          }
          return '% Invalid input detected at \'^\' marker.'
        }
        if (cmd2 === 'access' && tokens[2] === 'vlan') {
          const vlanId = parseInt(tokens[3], 10)
          if (!isNaN(vlanId) && vlanId >= 1 && vlanId <= 4094) {
            intf.accessVlan = vlanId
            if (!this.device.vlanDatabase.has(vlanId)) {
              this.device.vlanDatabase.set(vlanId, { id: vlanId, name: `VLAN${vlanId.toString().padStart(4, '0')}` })
              return `% Access VLAN does not exist. Creating vlan ${vlanId}`
            }
            return ''
          }
        }
        if (cmd2 === 'trunk' && tokens[2] === 'native' && tokens[3] === 'vlan') {
          const vlanId = parseInt(tokens[4], 10)
          if (!isNaN(vlanId) && vlanId >= 1 && vlanId <= 4094) {
            intf.trunkNativeVlan = vlanId
            return ''
          }
        }
        if (cmd2 === 'trunk' && tokens[2] === 'allowed' && tokens[3] === 'vlan') {
          const vlanStr = tokens[4]
          if (vlanStr) {
            if (vlanStr === 'all') {
              intf.trunkAllowedVlans = 'all'
            } else {
              const vlans = vlanStr.split(',').map(v => parseInt(v.trim(), 10)).filter(v => !isNaN(v))
              intf.trunkAllowedVlans = vlans
            }
            return ''
          }
        }
        if (cmd2 === 'port-security') {
          if (!tokens[2]) {
            intf.portSecurityEnabled = true
            return ''
          }
          if (tokens[2] === 'maximum' && tokens[3]) {
            const max = parseInt(tokens[3], 10)
            if (!isNaN(max) && max >= 1 && max <= 8192) {
              intf.portSecurityMax = max
              return ''
            }
            return '% Invalid input detected at \'^\' marker.'
          }
          if (tokens[2] === 'mac-address' && tokens[3] === 'sticky') {
            intf.portSecuritySticky = true
            return ''
          }
          if (tokens[2] === 'violation' && tokens[3]) {
            const mode = tokens[3].toLowerCase()
            if (mode === 'protect' || mode === 'restrict' || mode === 'shutdown') {
              intf.portSecurityViolation = mode as any
              return ''
            }
            return '% Invalid input detected at \'^\' marker.'
          }
        }
        return '% Invalid input detected at \'^\' marker.'
      }

      if (root === 'no' && tokens[1] === 'switchport' && tokens[2] === 'port-security') {
        if (!tokens[3]) {
          intf.portSecurityEnabled = false
          return ''
        }
        if (tokens[3] === 'maximum') {
          intf.portSecurityMax = 1
          return ''
        }
        if (tokens[3] === 'mac-address' && tokens[4] === 'sticky') {
          intf.portSecuritySticky = false
          return ''
        }
        if (tokens[3] === 'violation') {
          intf.portSecurityViolation = 'shutdown'
          return ''
        }
      }
    }

    if (this.mode.startsWith('config-')) {
      const prevMode = this.mode
      const prevCtx = this.currentContext
      const prevSubCtx = this.currentSubContext
      this.mode = 'config'
      const res = this.executeCommand(rawCmd)
      if (res.startsWith('% Invalid') || res.startsWith('% Incomplete')) {
        this.mode = prevMode
        this.currentContext = prevCtx
        this.currentSubContext = prevSubCtx
      }
      return res
    }

    return `% Invalid input detected at '^' marker.`
  }

  private handleShowCommand(tokens: string[]): string {
    const sub = tokens[1]?.toLowerCase()
    
    if (sub === 'ip' && tokens[2]?.toLowerCase() === 'route') {
      if (tokens[3]?.toLowerCase() === 'ospf') {
        return this.formatShowIpRoute('ospf')
      }
      if (tokens[3]?.toLowerCase() === 'rip') {
        return this.formatShowIpRoute('rip')
      }
      return this.formatShowIpRoute()
    }

    if (sub === 'ip' && tokens[2]?.toLowerCase() === 'protocols') {
      return this.formatShowIpProtocols()
    }

    if (sub === 'ip' && tokens[2]?.toLowerCase() === 'dhcp') {
      if (tokens[3]?.toLowerCase() === 'binding') {
        return this.formatShowIpDhcpBinding()
      }
      if (tokens[3]?.toLowerCase() === 'pool') {
        return this.formatShowIpDhcpPool()
      }
    }

    if (sub === 'ip' && tokens[2]?.toLowerCase() === 'ospf') {
      if (tokens[3]?.toLowerCase() === 'neighbor') {
        return this.formatShowIpOspfNeighbor()
      }
      if (tokens[3]?.toLowerCase() === 'interface') {
        return this.formatShowIpOspfInterface()
      }
      if (tokens[3]?.toLowerCase() === 'database') {
        return this.formatShowIpOspfDatabase()
      }
      return this.formatShowIpOspf()
    }

    if (sub === 'port-security') {
      if (tokens[2]?.toLowerCase() === 'interface' && tokens[3]) {
        return this.formatShowPortSecurityInterface(tokens[3])
      }
      return this.formatShowPortSecurity()
    }

    if (sub === 'ip' && tokens[2]?.toLowerCase() === 'nat') {
      if (tokens[3]?.toLowerCase() === 'translations') {
        return this.formatShowIpNatTranslations()
      }
      if (tokens[3]?.toLowerCase() === 'statistics') {
        return this.formatShowIpNatStatistics()
      }
      return '% Incomplete command.'
    }

    if (sub === 'dns') {
      return this.formatShowDns()
    }

    if (sub === 'vlan') {
      return this.formatShowVlanBrief()
    }
    
    if (sub === 'spanning-tree') {
      return this.formatShowSpanningTree()
    }

    if (sub === 'interfaces' && tokens[2]?.toLowerCase() === 'trunk') {
      return this.formatShowInterfacesTrunk()
    }

    if (sub === 'running-config' || sub === 'run') {
      return `Building configuration...\n\n${this.device.generateRunningConfig() || 'Current configuration : 0 bytes'}`
    }
    if (sub === 'startup-config' || sub === 'start') {
      return this.device.startupConfig ? `Using 120 bytes\n${this.device.startupConfig}` : '%% Non-volatile configuration memory is not present'
    }
    if (sub === 'version' || sub === 'ver') {
      return `Cisco IOS Software, C2900 Software (C2900-UNIVERSALK9-M), Version 15.1(4)M4, RELEASE SOFTWARE (fc1)\nCompiled Thu 23-Feb-12 18:29 by prod_rel_team\nROM: System Bootstrap, Version 15.0(1r)M16, RELEASE SOFTWARE (fc1)\n\n${this.device.hostname} uptime is 1 hour, 22 minutes\nSystem returned to ROM by reload`
    }
    if (sub === 'logging') {
      if (this.device.logs.length === 0) return 'Syslog logging: enabled\nNo messages logged.'
      return `Syslog logging: enabled\n\n` + this.device.logs.join('\n')
    }
    if (sub === 'ip') {
      if (tokens[2]?.toLowerCase() === 'interface' && tokens[3]?.toLowerCase() === 'brief') {
        return this.formatShowIpInterfaceBrief()
      }
    }
    if (sub === 'ipv6') {
      if (tokens[2]?.toLowerCase() === 'interface' && tokens[3]?.toLowerCase() === 'brief') {
        return this.formatShowIpv6InterfaceBrief()
      }
      if (tokens[2]?.toLowerCase() === 'route') {
        return this.formatShowIpv6Route()
      }
    }
    if (sub === 'interfaces' || sub === 'int') {
      return this.formatShowInterfaces()
    }
    if (sub === 'mac' && (tokens[2]?.toLowerCase() === 'address-table' || tokens[2]?.toLowerCase() === 'address')) {
      return this.formatShowMacAddressTable()
    }
    if (sub === 'arp') {
      return this.formatShowArp()
    }
    if (sub === 'access-lists' || sub === 'access-list') {
      const aclId = tokens[2]
      return this.device.aclEngine.formatShowAccessLists(aclId)
    }
    // CDP commands
    if (sub === 'cdp') {
      if (!this.device.cdpEnabled) return '% CDP is not enabled'
      const t2 = tokens[2]?.toLowerCase()
      if (t2 === 'neighbors') {
        if (tokens[3]?.toLowerCase() === 'detail') return this.formatShowCdpNeighborsDetail()
        return this.formatShowCdpNeighbors()
      }
      return this.formatShowCdpNeighbors()
    }
    // LLDP commands
    if (sub === 'lldp') {
      if (!this.device.lldpEnabled) return '% LLDP is not enabled'
      const t2 = tokens[2]?.toLowerCase()
      if (t2 === 'neighbors') {
        if (tokens[3]?.toLowerCase() === 'detail') return this.formatShowLldpNeighborsDetail()
        return this.formatShowLldpNeighbors()
      }
      return this.formatShowLldpNeighbors()
    }
    return `% Invalid input detected at '^' marker.`
  }

  // ─── ACL Parsing ─────────────────────────────────────────────────────────

  /**
   * Parse: access-list <id> permit|deny [<proto>] <src> [<wc>] [<dst>] [<wc>] [eq <port>]
   */
  private parseAccessList(tokens: string[]): string {
    // tokens[0] = 'access-list'
    const aclIdStr = tokens[1]
    const actionStr = tokens[2]?.toLowerCase()

    if (!aclIdStr || !actionStr) return '% Incomplete command.'
    if (actionStr !== 'permit' && actionStr !== 'deny') return '% Invalid action. Use permit or deny.'

    const action = actionStr as 'permit' | 'deny'
    const aclNum = parseInt(aclIdStr, 10)
    const isStandard = !isNaN(aclNum) && aclNum >= 1 && aclNum <= 99
    const isExtended = !isNaN(aclNum) && aclNum >= 100 && aclNum <= 199
    const isNamed = isNaN(aclNum) // named acl

    let type: 'standard' | 'extended' = 'standard'
    if (isExtended) type = 'extended'
    if (isNamed) {
      // Try to infer type from existing ACL
      const existing = this.device.aclEngine.getAcl(aclIdStr)
      type = existing ? existing.type : 'standard'
    }

    const seq = this.device.aclEngine.nextSequence(aclIdStr)

    let t = 3 // current token index

    // Protocol (extended only)
    let protocol: AclProtocol = 'ip'
    if (type === 'extended') {
      const protoStr = tokens[t]?.toLowerCase()
      if (protoStr === 'ip' || protoStr === 'tcp' || protoStr === 'udp' || protoStr === 'icmp' || protoStr === 'ospf') {
        protocol = protoStr as AclProtocol
        t++
      } else {
        return '% Invalid protocol. Use ip, tcp, udp, icmp, or ospf.'
      }
    }

    // Source
    const { ip: srcIp, wildcard: srcWc, consumed: srcConsumed } = this.parseIpWildcard(tokens, t)
    if (!srcIp) return '% Invalid source IP address.'
    t += srcConsumed

    // Source port (extended tcp/udp)
    let srcPort: AclPortMatch | undefined
    if (type === 'extended' && (protocol === 'tcp' || protocol === 'udp') && tokens[t] && ['eq','lt','gt','neq','range'].includes(tokens[t])) {
      srcPort = this.parsePortMatch(tokens, t)
      t += srcPort ? (srcPort.op === 'range' ? 3 : 2) : 0
    }

    // Destination (extended only)
    let dstIp = '0.0.0.0'
    let dstWc = '255.255.255.255'
    if (type === 'extended') {
      const { ip, wildcard, consumed } = this.parseIpWildcard(tokens, t)
      if (!ip) return '% Invalid destination IP address.'
      dstIp = ip
      dstWc = wildcard
      t += consumed
    }

    // Destination port (extended tcp/udp)
    let dstPort: AclPortMatch | undefined
    if (type === 'extended' && (protocol === 'tcp' || protocol === 'udp') && tokens[t] && ['eq','lt','gt','neq','range'].includes(tokens[t])) {
      dstPort = this.parsePortMatch(tokens, t)
    }

    this.device.aclEngine.addRule(aclIdStr, type, {
      sequence: seq,
      action,
      protocol,
      srcIp,
      srcWildcard: srcWc,
      dstIp,
      dstWildcard: dstWc,
      srcPort,
      dstPort
    })

    return ''
  }

  /** Parse IP/wildcard from token array. Returns { ip, wildcard, consumed }. */
  private parseIpWildcard(tokens: string[], start: number): { ip: string; wildcard: string; consumed: number } {
    const kw = tokens[start]?.toLowerCase()
    if (kw === 'any') return { ip: '0.0.0.0', wildcard: '255.255.255.255', consumed: 1 }
    if (kw === 'host') {
      const ip = tokens[start + 1]
      if (IPMath.validateIp(ip)) return { ip, wildcard: '0.0.0.0', consumed: 2 }
      return { ip: '', wildcard: '', consumed: 0 }
    }
    const ip = tokens[start]
    if (!IPMath.validateIp(ip)) return { ip: '', wildcard: '', consumed: 0 }
    const wc = tokens[start + 1]
    if (wc && IPMath.validateIp(wc)) return { ip, wildcard: wc, consumed: 2 }
    // No wildcard = host
    return { ip, wildcard: '0.0.0.0', consumed: 1 }
  }

  /** Parse port match operator from tokens. */
  private parsePortMatch(tokens: string[], start: number): AclPortMatch | undefined {
    const op = tokens[start]?.toLowerCase() as AclPortMatch['op']
    const port = parseInt(tokens[start + 1], 10)
    if (isNaN(port)) return undefined
    if (op === 'range') {
      const portHigh = parseInt(tokens[start + 2], 10)
      return { op, port, portHigh: isNaN(portHigh) ? port : portHigh }
    }
    return { op, port }
  }

  // ─── Ping ─────────────────────────────────────────────────────────────────

  private handlePing(tokens: string[]): string {
    if (tokens[1] === 'ipv6') tokens.splice(1, 1)
    const destIp = tokens[1]
    const isIpv6 = destIp ? IPMath.validateIpv6(destIp) : false
    if (!destIp || (!IPMath.validateIp(destIp) && !isIpv6)) {
      return '% Invalid destination IP address'
    }

    if (isIpv6) {
      return this.handleIpv6Ping(tokens)
    }

    const count = 5
    const timeout = 2 // seconds (simulated)
    const pingId = Math.floor(Math.random() * 0xFFFF)
    const results: string[] = []
    let sent = 0
    let received = 0
    const rtts: number[] = []

    // Find source interface and routing next-hop
    let srcIp: string | null = null
    let srcMac: string | null = null
    let srcPortId: string | null = null
    let nextHopIp: string | null = null
    let outIntfId: string | null = null

    // Route lookup
    let bestRoute = null
    let maxPrefix = -1
    for (const route of this.device.routingTable) {
      if (IPMath.isSameSubnet(destIp, route.network, route.mask) || (route.network === '0.0.0.0' && route.mask === '0.0.0.0')) {
        const maskBits = IPMath.validateMask(route.mask) ? IPMath.maskToBits(route.mask) : 0
        if (maskBits > maxPrefix) {
          bestRoute = route
          maxPrefix = maskBits
        }
      }
    }

    if (!bestRoute) {
      return `Sending ${count}, 100-byte ICMP Echos to ${destIp}, timeout is ${timeout} seconds:\n${'.'.repeat(count)}\nSuccess rate is 0 percent (0/${count})\n% No route to host`
    }

    outIntfId = bestRoute.outgoingInterfaceId
    nextHopIp = bestRoute.nextHop

    // Recursive route resolution
    if (!outIntfId && nextHopIp) {
      const recRoute = this.device.routingTable.find(r => r.protocol === 'connected' && IPMath.isSameSubnet(nextHopIp!, r.network, r.mask))
      if (recRoute) outIntfId = recRoute.outgoingInterfaceId
    }

    if (!outIntfId) {
      return `% No route to host ${destIp}`
    }

    const outIntf = this.device.getInterface(outIntfId)
    if (!outIntf || outIntf.operStatus !== 'up' || !outIntf.ipAddress) {
      return `% Interface down or unconfigured`
    }

    srcIp = outIntf.ipAddress
    srcMac = outIntf.macAddress
    srcPortId = outIntf.connectedPortId || (outIntf.type === 'subinterface' ? outIntf.parentPortId! : null)

    if (!srcPortId) return `% Interface has no physical port`

    const targetIp = nextHopIp || destIp
    let targetMac = this.device.resolveArp(targetIp)

    // If no ARP entry, send ARP request first
    if (!targetMac) {
      // Simulate ARP - for simulation we inject the ARP directly
      const arpFrame = {
        srcMac,
        dstMac: 'ff:ff:ff:ff:ff:ff',
        ethertype: 0x0806,
        payload: {
          operation: 'request',
          senderMac: srcMac,
          senderIp: srcIp,
          targetMac: '00:00:00:00:00:00',
          targetIp: targetIp
        }
      }
      this.device.engine?.transmitFrame(this.device.id, srcPortId, arpFrame)
      // Re-check after ARP
      targetMac = this.device.resolveArp(targetIp)
    }

    if (!targetMac) {
      return `Sending ${count}, 100-byte ICMP Echos to ${destIp}, timeout is ${timeout} seconds:\n${'.'.repeat(count)}\nSuccess rate is 0 percent (0/${count})\n% ARP resolution failed for ${targetIp}`
    }

    // Register ping reply callback
    const startTimes: Map<number, number> = new Map()
    let probeResults = '.'.repeat(count).split('')

    this.device.pingCallbacks.set(pingId, (icmp: ICMPPacket, _srcIp: string, _rtt: number, seqNum: number) => {
      const idx = seqNum - 1
      if (idx >= 0 && idx < count) {
        const t0 = startTimes.get(seqNum) ?? this.device.engine!.now()
        const rtt = Math.max(1, Math.floor(Math.random() * 4) + 1) // simulated 1-4ms
        probeResults[idx] = '!'
        received++
        rtts.push(rtt)
      }
    })

    // Send ICMP Echo Requests
    for (let seq = 1; seq <= count; seq++) {
      startTimes.set(seq, this.device.engine!.now())
      const icmpPayload: ICMPPacket = {
        type: 8, // Echo Request
        code: 0,
        identifier: pingId,
        sequenceNumber: seq,
        payload: 'x'.repeat(100)
      }
      const ipv4Payload: IPv4Packet = {
        srcIp: srcIp!,
        dstIp: destIp,
        protocol: 1,
        ttl: 64,
        payload: icmpPayload
      }
      const echoFrame = {
        srcMac: srcMac!,
        dstMac: targetMac,
        ethertype: 0x0800,
        payload: ipv4Payload
      }
      sent++
      this.device.engine?.transmitFrame(this.device.id, srcPortId!, echoFrame)
    }

    // Clean up callback
    this.device.pingCallbacks.delete(pingId)

    // Format output
    const resultStr = probeResults.join('')
    const successRate = Math.round((received / count) * 100)
    let statsLine = `Success rate is ${successRate} percent (${received}/${count})`
    if (rtts.length > 0) {
      const min = Math.min(...rtts)
      const max = Math.max(...rtts)
      const avg = Math.round(rtts.reduce((a, b) => a + b, 0) / rtts.length)
      statsLine += `, round-trip min/avg/max = ${min}/${avg}/${max} ms`
    }

    return `Type escape sequence to abort.\nSending ${count}, 100-byte ICMP Echos to ${destIp}, timeout is ${timeout} seconds:\n${resultStr}\n${statsLine}`
  }

  private handleIpv6Ping(tokens: string[]): string {
    const destIp = tokens[1]
    const count = 5
    const timeout = 2
    const pingId = Math.floor(Math.random() * 0xFFFF)
    const rtts: number[] = []
    let sent = 0
    let received = 0

    let srcIp: string | null = null
    let srcMac: string | null = null
    let srcPortId: string | null = null
    let nextHopIp: string | null = null
    let outIntfId: string | null = null

    let bestRoute = null
    let maxPrefix = -1
    for (const route of this.device.ipv6RoutingTable) {
      if ((route.network === '::' && route.prefixLength === 0) || IPMath.isSameIpv6Subnet(destIp, route.network, route.prefixLength)) {
        if (route.prefixLength > maxPrefix) {
          bestRoute = route
          maxPrefix = route.prefixLength
        }
      }
    }

    if (!bestRoute) {
      return `Sending ${count}, 100-byte ICMP Echos to ${destIp}, timeout is ${timeout} seconds:\n${'.'.repeat(count)}\nSuccess rate is 0 percent (0/${count})\n% No route to host`
    }

    outIntfId = bestRoute.outgoingInterfaceId
    nextHopIp = bestRoute.nextHop

    if (!outIntfId && nextHopIp) {
      const recRoute = this.device.ipv6RoutingTable.find(r => r.protocol === 'connected' && IPMath.isSameIpv6Subnet(nextHopIp!, r.network, r.prefixLength))
      if (recRoute) outIntfId = recRoute.outgoingInterfaceId
    }

    if (!outIntfId) {
      return `% No route to host ${destIp}`
    }

    const outIntf = this.device.getInterface(outIntfId)
    if (!outIntf || outIntf.operStatus !== 'up' || (!outIntf.ipv6Addresses.length && !outIntf.ipv6LinkLocal)) {
      return `% Interface down or unconfigured`
    }

    srcIp = outIntf.ipv6Addresses.length > 0 ? outIntf.ipv6Addresses[0].split('/')[0] : outIntf.ipv6LinkLocal!
    srcMac = outIntf.macAddress
    srcPortId = outIntf.connectedPortId || (outIntf.type === 'subinterface' ? outIntf.parentPortId! : null)

    if (!srcPortId) return `% Interface has no physical port`

    const targetIp = nextHopIp || destIp
    let targetMac = this.device.resolveNdp(targetIp)

    if (!targetMac) {
      const nsPayload = { targetAddress: targetIp, targetMac: '' }
      const nsIpv6 = { srcIp, dstIp: targetIp, nextHeader: 58, hopLimit: 255, payload: { type: 135, code: 0, payload: nsPayload } }
      this.device.engine?.transmitFrame(this.device.id, srcPortId, { srcMac, dstMac: '33:33:ff:00:00:00', ethertype: 0x86DD, payload: nsIpv6 })
      targetMac = this.device.resolveNdp(targetIp)
    }

    if (!targetMac) {
      return `Sending ${count}, 100-byte ICMP Echos to ${destIp}, timeout is ${timeout} seconds:\n${'.'.repeat(count)}\nSuccess rate is 0 percent (0/${count})\n% NDP resolution failed for ${targetIp}`
    }

    const startTimes: Map<number, number> = new Map()
    let probeResults = '.'.repeat(count).split('')

    this.device.pingCallbacks.set(pingId, (icmp: any, _srcIp: string, _rtt: number, seqNum: number) => {
      const idx = seqNum - 1
      if (idx >= 0 && idx < count) {
        const rtt = Math.max(1, Math.floor(Math.random() * 4) + 1)
        probeResults[idx] = '!'
        received++
        rtts.push(rtt)
      }
    })

    for (let seq = 1; seq <= count; seq++) {
      startTimes.set(seq, this.device.engine!.now())
      const icmpPayload = { type: 128, code: 0, payload: { identifier: pingId, sequenceNumber: seq, data: 'x'.repeat(100) } }
      const ipv6Payload = { srcIp: srcIp!, dstIp: destIp, nextHeader: 58, hopLimit: 64, payload: icmpPayload }
      const echoFrame = { srcMac: srcMac!, dstMac: targetMac, ethertype: 0x86DD, payload: ipv6Payload }
      sent++
      this.device.engine?.transmitFrame(this.device.id, srcPortId!, echoFrame)
    }

    this.device.pingCallbacks.delete(pingId)

    const resultStr = probeResults.join('')
    const successRate = Math.round((received / count) * 100)
    let statsLine = `Success rate is ${successRate} percent (${received}/${count})`
    if (rtts.length > 0) {
      const min = Math.min(...rtts)
      const max = Math.max(...rtts)
      const avg = Math.round(rtts.reduce((a, b) => a + b, 0) / rtts.length)
      statsLine += `, round-trip min/avg/max = ${min}/${avg}/${max} ms`
    }

    return `Type escape sequence to abort.\nSending ${count}, 100-byte ICMPv6 Echos to ${destIp}, timeout is ${timeout} seconds:\n${resultStr}\n${statsLine}`
  }

  private handleTraceroute(tokens: string[]): string {
    const destIp = tokens[1]
    if (!destIp || !IPMath.validateIp(destIp)) {
      return '% Invalid destination IP address'
    }

    const maxTtl = 30
    const timeout = 2
    const tracerouteId = Math.floor(Math.random() * 0xFFFF)
    const resultLines: string[] = []

    let srcIp: string | null = null
    let srcMac: string | null = null
    let srcPortId: string | null = null
    let nextHopIp: string | null = null
    let outIntfId: string | null = null

    let bestRoute = null
    let maxPrefix = -1
    for (const route of this.device.routingTable) {
      if (IPMath.isSameSubnet(destIp, route.network, route.mask) || (route.network === '0.0.0.0' && route.mask === '0.0.0.0')) {
        const maskBits = IPMath.validateMask(route.mask) ? IPMath.maskToBits(route.mask) : 0
        if (maskBits > maxPrefix) {
          bestRoute = route
          maxPrefix = maskBits
        }
      }
    }

    if (!bestRoute) {
      return `% No route to host`
    }

    outIntfId = bestRoute.outgoingInterfaceId
    nextHopIp = bestRoute.nextHop

    if (!outIntfId && nextHopIp) {
      const recRoute = this.device.routingTable.find(r => r.protocol === 'connected' && IPMath.isSameSubnet(nextHopIp!, r.network, r.mask))
      if (recRoute) outIntfId = recRoute.outgoingInterfaceId
    }

    if (!outIntfId) {
      return `% No route to host ${destIp}`
    }

    const outIntf = this.device.getInterface(outIntfId)
    if (!outIntf || outIntf.operStatus !== 'up' || !outIntf.ipAddress) {
      return `% Interface down or unconfigured`
    }

    srcIp = outIntf.ipAddress
    srcMac = outIntf.macAddress
    srcPortId = outIntf.connectedPortId || (outIntf.type === 'subinterface' ? outIntf.parentPortId! : null)

    if (!srcPortId) return `% Interface has no physical port`

    const targetIp = nextHopIp || destIp
    let targetMac = this.device.resolveArp(targetIp)

    if (!targetMac) {
      const arpFrame = {
        srcMac,
        dstMac: 'ff:ff:ff:ff:ff:ff',
        ethertype: 0x0806,
        payload: {
          operation: 'request',
          senderMac: srcMac,
          senderIp: srcIp,
          targetMac: '00:00:00:00:00:00',
          targetIp: targetIp
        }
      }
      this.device.engine?.transmitFrame(this.device.id, srcPortId, arpFrame)
      targetMac = this.device.resolveArp(targetIp)
    }

    if (!targetMac) {
      return `% ARP resolution failed for ${targetIp}`
    }

    resultLines.push(`Tracing the route to ${destIp}`)
    resultLines.push(`VRF info: (vrf in name/id, vrf out name/id)`)

    let destinationReached = false
    let currentSeq = 1

    for (let ttl = 1; ttl <= maxTtl; ttl++) {
      let hopResults = []
      let hopIp = ''
      
      for (let probe = 1; probe <= 3; probe++) {
        const seq = currentSeq++
        let rtt = -1
        let repliedIp = ''
        
        this.device.pingCallbacks.set(tracerouteId, (icmp: ICMPPacket, repliedSrcIp: string, actualRtt: number, seqNum: number) => {
          if (seqNum === seq) {
            rtt = Math.max(1, Math.floor(Math.random() * 4) + 1)
            repliedIp = repliedSrcIp
            if (icmp.type === 0) {
              destinationReached = true
            }
          }
        })
        
        const icmpPayload: ICMPPacket = {
          type: 8,
          code: 0,
          identifier: tracerouteId,
          sequenceNumber: seq,
          payload: 'x'.repeat(100)
        }
        const ipv4Payload: IPv4Packet = {
          srcIp: srcIp!,
          dstIp: destIp,
          protocol: 1,
          ttl: ttl,
          payload: icmpPayload
        }
        let echoFrame: any = {
          srcMac: srcMac!,
          dstMac: targetMac,
          ethertype: 0x0800,
          payload: ipv4Payload
        }
        
        if (outIntf.type === 'subinterface' && outIntf.encapsulationDot1Q) {
          echoFrame = {
            srcMac: outIntf.macAddress,
            dstMac: targetMac,
            ethertype: 0x8100,
            payload: {
              vlanId: outIntf.encapsulationDot1Q,
              ethertype: 0x0800,
              payload: ipv4Payload
            }
          }
        }
        
        this.device.engine?.transmitFrame(this.device.id, srcPortId!, echoFrame)
        
        this.device.pingCallbacks.delete(tracerouteId)
        
        if (rtt >= 0) {
           hopResults.push(`${rtt} msec`)
           hopIp = repliedIp
        } else {
           hopResults.push(`*`)
        }
      }
      
      const hopStr = ttl.toString().padStart(2, ' ')
      if (hopIp) {
         resultLines.push(` ${hopStr}  ${hopIp.padEnd(15, ' ')} ${hopResults.join('  ')}`)
      } else {
         resultLines.push(` ${hopStr}  * * *`)
      }
      
      if (destinationReached) break
    }
    
    return resultLines.join('\n')
  }

  private formatShowArp(): string {
    let out = 'Protocol  Address          Age (min)  Hardware Addr   Type   Interface\n'
    const entries = Array.from(this.device.arpTable.values())
    
    for (const entry of entries) {
      const ageMs = this.device.engine!.now() - (entry.expiresAt - 14400000) // 14400000 was the 4 hour TTL
      const ageMin = Math.max(0, Math.floor(ageMs / 60000))
      
      const protocol = 'Internet'.padEnd(9, ' ')
      const address = entry.ipAddress.padEnd(16, ' ')
      const ageStr = (ageMin === 0 ? '-' : ageMin.toString()).padStart(9, ' ')
      const hwAddr = entry.macAddress.padEnd(15, ' ')
      const type = 'ARPA'.padEnd(6, ' ')
      const intf = this.device.getInterface(entry.interfaceId)
      const intfName = intf ? intf.name : entry.interfaceId
      
      out += `${protocol} ${address} ${ageStr}  ${hwAddr}   ${type}  ${intfName}\n`
    }
    return out.trim()
  }

  // ─── CDP formatters ───────────────────────────────────────────────────────

  private formatShowCdpNeighbors(): string {
    const neighbors = buildCdpNeighbors(this.device)
    if (neighbors.length === 0) {
      return 'Capability Codes: R - Router, T - Trans Bridge, B - Source Route Bridge\n' +
             '                  S - Switch, H - Host, I - IGMP, r - Repeater\n\n' +
             'No CDP neighbor entries found.'
    }

    let out = 'Capability Codes: R - Router, T - Trans Bridge, B - Source Route Bridge\n'
    out +=    '                  S - Switch, H - Host, I - IGMP, r - Repeater\n\n'
    out +=    'Device ID        Local Intrfce     Holdtme    Capability  Platform  Port ID\n'

    for (const n of neighbors) {
      const devId    = n.deviceId.padEnd(16, ' ')
      const localIf  = n.localPortName.padEnd(17, ' ')
      const holdtime = n.holdTime.toString().padEnd(10, ' ')
      const caps     = n.capabilities.join(' ').padEnd(11, ' ')
      const platform = n.platform.split(',')[0].replace('Cisco IOS Software', 'Cisco').padEnd(9, ' ')
      const portId   = n.remotePortName
      out += `${devId} ${localIf} ${holdtime} ${caps} ${platform} ${portId}\n`
    }

    out += `\nTotal cdp entries displayed : ${neighbors.length}`
    return out.trim()
  }

  private formatShowCdpNeighborsDetail(): string {
    const neighbors = buildCdpNeighbors(this.device)
    if (neighbors.length === 0) {
      return '% No CDP neighbor entries found.'
    }

    let out = '-------------------------\n'
    for (const n of neighbors) {
      out += `Device ID: ${n.deviceId}\n`
      out += `Entry address(es):\n`
      if (n.ipAddress) {
        out += `  IP address: ${n.ipAddress}\n`
      } else {
        out += `  IP address: (not set)\n`
      }
      out += `Platform: ${n.platform},  Capabilities: ${expandCdpCapabilities(n.capabilities)}\n`
      out += `Interface: ${n.localPortName},  Port ID (outgoing port): ${n.remotePortName}\n`
      out += `Holdtime : ${n.holdTime} sec\n\n`
      out += `Version :\n${n.softwareVersion}\n\n`
      out += `advertisement version: 2\n`
      if (n.nativeVlan !== null) {
        out += `Native VLAN: ${n.nativeVlan}\n`
      }
      out += `Duplex: ${n.duplex}\n`
      out += `-------------------------\n`
    }

    return out.trim()
  }

  // ─── LLDP formatters ──────────────────────────────────────────────────────

  private formatShowLldpNeighbors(): string {
    const neighbors = buildLldpNeighbors(this.device)
    if (neighbors.length === 0) {
      return 'Capability codes:\n' +
             '    (R) Router, (B) Bridge, (T) Telephone, (C) DOCSIS Cable Device\n' +
             '    (W) WLAN Access Point, (P) Repeater, (S) Station, (O) Other\n\n' +
             'No LLDP neighbor entries found.'
    }

    let out = 'Capability codes:\n'
    out +=    '    (R) Router, (B) Bridge, (T) Telephone, (C) DOCSIS Cable Device\n'
    out +=    '    (W) WLAN Access Point, (P) Repeater, (S) Station, (O) Other\n\n'
    out +=    'Device ID           Local Intf     Hold-time  Capability      Port ID\n'

    for (const n of neighbors) {
      const devId   = n.systemName.padEnd(19, ' ')
      const localIf = n.localPortName.padEnd(14, ' ')
      const hold    = n.ttl.toString().padEnd(10, ' ')
      const caps    = n.capabilities.join(', ').padEnd(15, ' ')
      const portId  = n.portId
      out += `${devId} ${localIf} ${hold} ${caps} ${portId}\n`
    }

    out += `\nTotal entries displayed: ${neighbors.length}`
    return out.trim()
  }

  private formatShowLldpNeighborsDetail(): string {
    const neighbors = buildLldpNeighbors(this.device)
    if (neighbors.length === 0) {
      return '% No LLDP neighbor entries found.'
    }

    let out = ''
    for (const n of neighbors) {
      out += `------------------------------------------------\n`
      out += `Local Interface: ${n.localPortName}\n`
      out += `Chassis id: ${n.chassisId}\n`
      out += `Port id: ${n.portId}\n`
      out += `Port Description: ${n.portDescription}\n`
      out += `System Name: ${n.systemName}\n\n`
      out += `System Description: \n${n.systemDescription}\n\n`
      out += `Time remaining: ${n.ttl} seconds\n`
      out += `System Capabilities: ${n.capabilities.join(', ')}\n`
      out += `Enabled Capabilities: ${n.capabilities.join(', ')}\n`
      if (n.managementAddress) {
        out += `Management Addresses:\n`
        out += `    IP: ${n.managementAddress}\n`
      }
      out += `\n`
    }

    out += `Total entries displayed: ${neighbors.length}`
    return out.trim()
  }

  private formatShowInterfaces(): string {
    let out = ''
    for (const intf of this.device.interfaces.values()) {
      const p = this.device.getPort(intf.connectedPortId || '')
      const lineProtocol = intf.operStatus === 'up' ? 'up' : 'down'
      out += `${intf.name} is ${intf.adminStatus === 'down' ? 'administratively down' : 'up'}, line protocol is ${lineProtocol}\n`
      out += `  Hardware is ${intf.type}, address is ${intf.macAddress} (bia ${intf.macAddress})\n`
      if (intf.ipAddress) {
        out += `  Internet address is ${intf.ipAddress}/${intf.subnetMask}\n`
      }
      out += `  MTU ${intf.mtu} bytes, BW ${intf.speed * 1000} Kbit/sec, DLY 10 usec,\n`
      out += `  Encapsulation ARPA, loopback not set\n`
      out += `  Keepalive set (10 sec)\n`
      out += `  Full Duplex, ${intf.speed}Mbps, link type is auto, media type is auto\n\n`
    }
    return out.trim()
  }

  private formatShowMacAddressTable(): string {
    let out = '          Mac Address Table\n'
    out += '-------------------------------------------\n\n'
    out += 'Vlan    Mac Address       Type        Ports\n'
    out += '----    -----------       --------    -----\n'
    
    // Convert MAC map to array and sort
    const entries = Array.from(this.device.macTable.values())
    if (entries.length === 0) return out + ' No entries found.'

    for (const entry of entries) {
      const vlan = entry.vlan.toString().padEnd(7, ' ')
      const mac = entry.macAddress.padEnd(17, ' ')
      const type = 'DYNAMIC'.padEnd(11, ' ')
      const port = this.device.getPort(entry.portId)
      const portName = port ? port.name : entry.portId
      out += `${vlan} ${mac} ${type} ${portName}\n`
    }

    return out
  }
  private formatShowIpInterfaceBrief(): string {
    let out = 'Interface              IP-Address      OK? Method Status                Protocol\n'
    for (const intf of this.device.interfaces.values()) {
      const name = intf.name.padEnd(22, ' ')
      const ip = (intf.ipAddress || 'unassigned').padEnd(15, ' ')
      const ok = 'YES'
      const method = 'unset'.padEnd(6, ' ')
      const status = intf.adminStatus === 'down' ? 'administratively down'.padEnd(21, ' ') : intf.operStatus.padEnd(21, ' ')
      const protocol = intf.operStatus
      out += `${name} ${ip} ${ok} ${method} ${status} ${protocol}\n`
    }
    return out.trim()
  }

  private formatShowVpcsIp(): string {
    const intf = Array.from(this.device.interfaces.values())[0]
    if (!intf) return 'No interface found.'
    
    const ipStr = intf.ipAddress === 'dhcp' ? 'dhcp' : intf.ipAddress
    const prefix = intf.subnetMask ? IPMath.maskToBits(intf.subnetMask) : 0
    const ipMaskStr = (ipStr && ipStr !== 'dhcp' && prefix) ? `${ipStr}/${prefix}` : (ipStr || '0.0.0.0/0')
    const gwStr = this.device.defaultGateway || '0.0.0.0'
    const macStr = intf.macAddress
    
    return `NAME        : ${this.device.hostname}
IP/MASK     : ${ipMaskStr}
GATEWAY     : ${gwStr}
MAC         : ${macStr}`
  }

  private formatShowIpv6InterfaceBrief(): string {
    let out = 'Interface              [IPv6 Status]\n'
    for (const intf of this.device.interfaces.values()) {
      const name = intf.name.padEnd(22, ' ')
      out += `${name} [up/up]\n`
      if (intf.ipv6LinkLocal) {
        out += `  ${intf.ipv6LinkLocal}\n`
      }
      for (const ip of intf.ipv6Addresses) {
        out += `  ${ip}\n`
      }
    }
    return out.trim()
  }

  private formatShowIpv6Route(): string {
    let out = `IPv6 Routing Table\nCodes: C - Connected, S - Static, O - OSPF, R - RIP\n\n`
    for (const route of this.device.ipv6RoutingTable) {
      let codeStr = ' '
      if (route.protocol === 'connected') codeStr = 'C'
      else if (route.protocol === 'static') codeStr = 'S'
      else if (route.protocol === 'ospf') codeStr = 'O'
      else if (route.protocol === 'rip') codeStr = 'R'
      
      const pfx = `${route.network}/${route.prefixLength}`
      if (route.protocol === 'connected') {
        const intf = this.device.getInterface(route.outgoingInterfaceId!)
        out += `${codeStr}   ${pfx} [${route.administrativeDistance}/${route.metric}]\n     via ${intf ? intf.name : route.outgoingInterfaceId}, directly connected\n`
      } else {
        out += `${codeStr}   ${pfx} [${route.administrativeDistance}/${route.metric}]\n     via ${route.nextHop || (this.device.getInterface(route.outgoingInterfaceId!)?.name || '')}\n`
      }
    }
    return out.trimEnd()
  }

  private formatShowIpRoute(filterProto?: string): string {
    let out = `Codes: L - local, C - connected, S - static, R - RIP, M - mobile, B - BGP
       D - EIGRP, EX - EIGRP external, O - OSPF, IA - OSPF inter area 
       N1 - OSPF NSSA external type 1, N2 - OSPF NSSA external type 2
       E1 - OSPF external type 1, E2 - OSPF external type 2
       i - IS-IS, su - IS-IS summary, L1 - IS-IS level-1, L2 - IS-IS level-2
       ia - IS-IS inter area, * - candidate default, U - per-user static route
       o - ODR, P - periodic downloaded static route, H - NHRP, l - LISP
       a - application route
       + - replicated route, % - next hop override

Gateway of last resort is not set

`
    for (const route of this.device.routingTable) {
      if (filterProto && route.protocol !== filterProto) continue
      
      let codeStr = ''
      if (route.protocol === 'connected') codeStr = 'C'
      else if (route.protocol === 'static') codeStr = 'S'
      else if (route.protocol === 'ospf') codeStr = 'O'
      else if (route.protocol === 'rip') codeStr = 'R'
      
      if (route.network === '0.0.0.0' && route.mask === '0.0.0.0' && route.protocol === 'static') {
        codeStr = 'S*'
      }

      // Convert mask to prefix for display (e.g. /24)
      let prefixStr = ''
      try {
        const maskL = IPMath.ipToLong(route.mask)
        const invMask = (~maskL) >>> 0
        const prefix = 32 - Math.log2(invMask + 1)
        prefixStr = `/${prefix}`
      } catch (e) {
        prefixStr = ''
      }

      if (route.protocol === 'connected') {
        const intf = this.device.getInterface(route.outgoingInterfaceId!)
        const intfName = intf ? intf.name : route.outgoingInterfaceId
        out += `${codeStr.padEnd(2, ' ')}    ${route.network}${prefixStr} is directly connected, ${intfName}\n`
      } else {
        const adminDist = route.administrativeDistance
        const metric = route.metric
        let viaStr = route.nextHop ? `via ${route.nextHop}` : ''
        if (route.outgoingInterfaceId) {
          const intf = this.device.getInterface(route.outgoingInterfaceId)
          if (intf) viaStr += (viaStr ? `, ` : `is directly connected, `) + intf.name
        }
        out += `${codeStr.padEnd(2, ' ')}    ${route.network}${prefixStr} [${adminDist}/${metric}] ${viaStr}\n`
      }
    }
    return out.trimEnd()
  }

  private formatShowIpOspf(): string {
    if (this.device.deviceType !== 'router' && this.device.deviceType !== 'layer3switch') return ''
    const routerDev = this.device as unknown as Router
    if (!routerDev.ospfProcess) return ' OSPF Routing Process not enabled'
    
    const ospf = routerDev.ospfProcess
    let out = ` Routing Process "ospf ${ospf.processId}" with ID ${ospf.getRouterId()}\n`
    out += ` Supports only single TOS(TOS0) routes\n`
    out += ` Supports opaque LSA\n`
    out += ` SPF schedule delay 5 secs, Hold time between two SPFs 10 secs\n`
    out += ` Minimum LSA interval 5 secs. Minimum LSA arrival 1 secs\n`
    return out.trimEnd()
  }

  private formatShowIpOspfNeighbor(): string {
    if (this.device.deviceType !== 'router' && this.device.deviceType !== 'layer3switch') return ''
    const routerDev = this.device as unknown as Router
    if (!routerDev.ospfProcess) return ''
    
    let out = `Neighbor ID     Pri   State           Dead Time   Address         Interface\n`
    for (const [intfId, neighbors] of routerDev.ospfProcess.neighbors) {
      const intf = this.device.getInterface(intfId)
      const intfName = intf ? intf.name : intfId
      for (const n of neighbors) {
        if (n.state === 'Down') continue
        const stateStr = `${n.state.toUpperCase()}/-`.padEnd(15, ' ')
        const deadTimeStr = `00:00:${Math.floor(n.deadTimer).toString().padStart(2, '0')}`.padEnd(11, ' ')
        out += `${n.routerId.padEnd(15, ' ')} 1     ${stateStr} ${deadTimeStr} ${n.ipAddress.padEnd(15, ' ')} ${intfName}\n`
      }
    }
    return out.trimEnd()
  }

  private formatShowIpOspfInterface(): string {
    if (this.device.deviceType !== 'router' && this.device.deviceType !== 'layer3switch') return ''
    const routerDev = this.device as unknown as Router
    if (!routerDev.ospfProcess) return ''
    
    let out = ''
    for (const [intfId, config] of routerDev.ospfProcess.ospfInterfaces) {
      const intf = this.device.getInterface(intfId)
      if (!intf) continue
      out += `${intf.name} is up, line protocol is up \n`
      out += `  Internet Address ${intf.ipAddress}/${IPMath.calculateHosts(intf.subnetMask!) === 0 ? 32 : 32 - Math.log2(IPMath.calculateHosts(intf.subnetMask!) + 2)}, Area ${config.area}\n`
      out += `  Process ID ${routerDev.ospfProcess.processId}, Router ID ${routerDev.ospfProcess.getRouterId()}, Network Type BROADCAST, Cost: ${config.cost}\n`
      out += `  Timer intervals configured, Hello ${config.helloInterval}, Dead ${config.deadInterval}, Wait ${config.deadInterval}, Retransmit 5\n\n`
    }
    return out.trimEnd()
  }

  private formatShowIpOspfDatabase(): string {
    if (this.device.deviceType !== 'router' && this.device.deviceType !== 'layer3switch') return ''
    const routerDev = this.device as unknown as Router
    if (!routerDev.ospfProcess) return ''
    
    let out = `            OSPF Router with ID (${routerDev.ospfProcess.getRouterId()}) (Process ID ${routerDev.ospfProcess.processId})\n\n`
    out += `                Router Link States (Area 0)\n\n`
    out += `Link ID         ADV Router      Age         Seq#       Checksum Link count\n`
    
    for (const [id, lsa] of routerDev.ospfProcess.lsdb) {
       out += `${id.padEnd(15, ' ')} ${lsa.advertisingRouter.padEnd(15, ' ')} 1           0x8000000${lsa.sequenceNumber} 0x0000   ${lsa.links.length}\n`
    }
    return out.trimEnd()
  }

  private formatShowIpProtocols(): string {
    if (this.device.deviceType !== 'router' && this.device.deviceType !== 'layer3switch') return ''
    const routerDev = this.device as unknown as Router
    let out = ''
    if (routerDev.ospfProcess) {
      out += `Routing Protocol is "ospf ${routerDev.ospfProcess.processId}"\n`
      out += `  Outgoing update filter list for all interfaces is not set\n`
      out += `  Incoming update filter list for all interfaces is not set\n`
      out += `  Router ID ${routerDev.ospfProcess.getRouterId()}\n`
      out += `  Routing for Networks:\n`
      for (const [intfId, cfg] of routerDev.ospfProcess.ospfInterfaces) {
        const intf = this.device.getInterface(intfId)
        if (intf) {
          out += `    ${intf.ipAddress} in Area ${cfg.area}\n`
        }
      }
      out += `  Routing Information Sources:\n`
      out += `    Gateway         Distance      Last Update\n`
      out += `    Distance: (default is 110)\n\n`
    }
    if (routerDev.ripProcess) {
      out += `Routing Protocol is "rip"\n`
      out += `  Sending updates every 30 seconds, next due in 0 seconds\n`
      out += `  Invalid after 180 seconds, hold down 180, flushed after 240\n`
      out += `  Default redistribution metric is not configured\n`
      out += `  Redistributing: rip\n`
      out += `  Default version control: send version ${routerDev.ripProcess.version}, receive version ${routerDev.ripProcess.version}\n`
      out += `    Interface             Send  Recv  Triggered RIP  Key-chain\n`
      out += `  Automatic network summarization is ${routerDev.ripProcess.autoSummary ? 'in' : 'not in'} effect\n`
      out += `  Maximum path: 4\n`
      out += `  Routing for Networks:\n`
      for (const net of routerDev.ripProcess.networks) {
        out += `    ${net}\n`
      }
      out += `  Routing Information Sources:\n`
      out += `    Gateway         Distance      Last Update\n`
      out += `  Distance: (default is 120)\n\n`
    }
    return out.trimEnd()
  }

  private formatShowIpDhcpBinding(): string {
    if (this.device.deviceType !== 'router' && this.device.deviceType !== 'layer3switch') return ''
    const routerDev = this.device as unknown as Router
    if (!routerDev.dhcpServer) return 'DHCP server not configured.'
    
    let out = 'IP address       Client-ID/              Lease expiration        Type\n'
    out += '                 Hardware address\n'
    for (const binding of routerDev.dhcpServer.bindings.values()) {
      out += `${binding.ipAddress.padEnd(16, ' ')} ${binding.macAddress.padEnd(23, ' ')} Automatic               --\n`
    }
    return out.trimEnd()
  }

  private formatShowIpDhcpPool(): string {
    if (this.device.deviceType !== 'router' && this.device.deviceType !== 'layer3switch') return ''
    const routerDev = this.device as unknown as Router
    if (!routerDev.dhcpServer) return 'DHCP server not configured.'

    let out = ''
    for (const pool of routerDev.dhcpServer.pools.values()) {
      out += `Pool ${pool.name} :\n`
      out += ` Utilization mark (100) : 0\n`
      out += ` Subnet size (number of addresses) : 254\n`
      out += ` Total addresses : 254\n`
      out += ` Leased addresses : ${routerDev.dhcpServer.bindings.size}\n`
      out += ` Excluded addresses : ${routerDev.dhcpServer.excludedAddresses.length}\n`
      out += ` Pending event : none\n`
      out += ` 1 subnet is currently in the pool :\n`
      out += ` Current index        IP address range             Leased/Excluded/Total\n`
      out += ` ${pool.network || '0.0.0.0'}             ${pool.network || '0.0.0.0'} - ${pool.network || '0.0.0.0'}     ${routerDev.dhcpServer.bindings.size}/${routerDev.dhcpServer.excludedAddresses.length}/254\n\n`
    }
    return out.trimEnd()
  }

  private formatShowDns(): string {
    const dnsHolder = this.device as any
    let out = ''
    if (dnsHolder.dnsServer && dnsHolder.dnsServer.enabled) {
      out += 'DNS Server is enabled\n\n'
      out += 'Host                      Address             TTL\n'
      out += '----                      -------             ---\n'
      for (const [hostname, record] of dnsHolder.dnsServer.records) {
        out += `${record.hostname.padEnd(25, ' ')} ${record.ipAddress.padEnd(19, ' ')} ${record.ttl}\n`
      }
      out += '\n'
    } else {
      out += 'DNS Server is disabled\n\n'
    }

    if (dnsHolder.dnsClient) {
      out += `Name Server is ${dnsHolder.dnsClient.serverIp || 'not configured'}\n\n`
      out += 'DNS Cache:\n'
      out += 'Host                      Address             TTL\n'
      out += '----                      -------             ---\n'
      for (const [hostname, entry] of dnsHolder.dnsClient.cache) {
        out += `${hostname.padEnd(25, ' ')} ${entry.ipAddress.padEnd(19, ' ')} ${entry.ttl}\n`
      }
    }

    return out.trimEnd()
  }

  private formatShowIpNatTranslations(): string {
    if (this.device.deviceType !== 'router') return ''
    const routerDev = this.device as unknown as Router
    if (!routerDev.natProcess || (routerDev.natProcess.translations.length === 0 && routerDev.natProcess.staticMappings.length === 0)) {
      return ''
    }

    let out = 'Pro Inside global      Inside local       Outside local      Outside global\n'
    
    for (const m of routerDev.natProcess.staticMappings) {
      out += `--- ${m.globalIp.padEnd(18, ' ')} ${m.localIp.padEnd(18, ' ')} ---                ---\n`
    }

    for (const t of routerDev.natProcess.translations) {
      const ig = `${t.insideGlobalIp}:${t.insideGlobalPort}`
      const il = `${t.insideLocalIp}:${t.insideLocalPort}`
      const ol = `${t.outsideLocalIp}:${t.outsideLocalPort}`
      const og = `${t.outsideGlobalIp}:${t.outsideGlobalPort}`
      out += `${t.protocol.padEnd(3, ' ')} ${ig.padEnd(18, ' ')} ${il.padEnd(18, ' ')} ${ol.padEnd(18, ' ')} ${og}\n`
    }
    return out.trimEnd()
  }

  private formatShowIpNatStatistics(): string {
    if (this.device.deviceType !== 'router') return ''
    const routerDev = this.device as unknown as Router
    if (!routerDev.natProcess) return ''

    let out = `Total active translations: ${routerDev.natProcess.translations.length} (${routerDev.natProcess.staticMappings.length} static, ${routerDev.natProcess.translations.length - routerDev.natProcess.staticMappings.length} dynamic; 0 extended)\n`
    out += `Static translations: ${routerDev.natProcess.staticMappings.length}\n`
    out += `Hits: ${routerDev.natProcess.stats.hits}  Misses: ${routerDev.natProcess.stats.misses}\n`
    out += `Dynamic mappings:\n`
    for (const dyn of routerDev.natProcess.dynamicMappings) {
      out += `-- Inside Source\n`
      out += `[Id: 1] access-list ${dyn.aclName} interface ${routerDev.getInterface(dyn.interfaceId)?.name || 'Unknown'} refcount ${routerDev.natProcess.translations.length}\n`
    }
    return out.trimEnd()
  }

  private formatShowVlanBrief(): string {
    let out = 'VLAN Name                             Status    Ports\n'
    out += '---- -------------------------------- --------- -------------------------------\n'
    
    // Sort VLANs by ID
    const sortedVlans = Array.from(this.device.vlanDatabase.values()).sort((a, b) => a.id - b.id)
    
    for (const vlan of sortedVlans) {
      const vlanIdStr = vlan.id.toString().padEnd(4, ' ')
      const vlanName = vlan.name.padEnd(32, ' ')
      const status = 'active'.padEnd(9, ' ')
      
      const ports = Array.from(this.device.interfaces.values())
        .filter(i => i.switchportMode === 'access' && i.accessVlan === vlan.id)
        .map(i => i.name)
        .join(', ')
      
      out += `${vlanIdStr} ${vlanName} ${status} ${ports}\n`
    }
    
    return out.trimEnd()
  }

  private formatShowInterfacesTrunk(): string {
    let out = 'Port        Mode         Encapsulation  Status        Native vlan\n'
    
    const trunkPorts = Array.from(this.device.interfaces.values()).filter(i => i.switchportMode === 'trunk')
    
    for (const intf of trunkPorts) {
      const port = intf.name.padEnd(11, ' ')
      const mode = 'on'.padEnd(12, ' ')
      const encap = '802.1q'.padEnd(14, ' ')
      const status = 'trunking'.padEnd(13, ' ')
      const native = intf.trunkNativeVlan.toString()
      out += `${port} ${mode} ${encap} ${status} ${native}\n`
    }
    
    out += '\nPort        Vlans allowed on trunk\n'
    for (const intf of trunkPorts) {
      const port = intf.name.padEnd(11, ' ')
      const allowed = Array.isArray(intf.trunkAllowedVlans) ? intf.trunkAllowedVlans.join(',') : '1-4094'
      out += `${port} ${allowed}\n`
    }
    
    return out.trimEnd()
  }

  private formatShowPortSecurity(): string {
    const out: string[] = []
    out.push('Secure Port  MaxSecureAddr  CurrentAddr  SecurityViolation  Security Action')
    out.push('-----------  -------------  -----------  -----------------  ---------------')
    
    let anyFound = false
    for (const intf of this.device.interfaces.values()) {
      if (intf.portSecurityEnabled) {
        anyFound = true
        const portName = intf.name.padEnd(11)
        const max = intf.portSecurityMax.toString().padStart(13)
        const current = intf.portSecurityMacAddresses.length.toString().padStart(11)
        const violationCount = intf.portSecurityViolationCount.toString().padStart(17)
        const action = (intf.portSecurityViolation.charAt(0).toUpperCase() + intf.portSecurityViolation.slice(1)).padStart(15)
        out.push(`${portName}  ${max}  ${current}  ${violationCount}  ${action}`)
      }
    }

    if (!anyFound) return ''
    return out.join('\n')
  }

  private formatShowPortSecurityInterface(intfName: string): string {
    const intf = Array.from(this.device.interfaces.values()).find(i => i.name.toLowerCase() === intfName.toLowerCase())
    if (!intf) {
      return `% Invalid interface ${intfName}`
    }

    if (!intf.portSecurityEnabled) {
      return `Port Security              : Disabled
Port Status                : Secure-down
Violation Mode             : Shutdown
Aging Time                 : 0 mins
Aging Type                 : Absolute
SecureStatic Address Aging : Disabled
Maximum MAC Addresses      : 1
Total MAC Addresses        : 0
Configured MAC Addresses   : 0
Sticky MAC Addresses       : 0
Last Source Address:Vlan   : 0000.0000.0000:0
Security Violation Count   : 0`
    }

    const portStatus = intf.operStatus === 'up' ? 'Secure-up' : 'Secure-down'
    const violationMode = intf.portSecurityViolation.charAt(0).toUpperCase() + intf.portSecurityViolation.slice(1)
    
    let lastSource = '0000.0000.0000:0'
    if (intf.portSecurityMacAddresses.length > 0) {
      const mac = intf.portSecurityMacAddresses[intf.portSecurityMacAddresses.length - 1]
      lastSource = `${mac.replace(/:/g, '')}:${intf.accessVlan}`
    }

    return `Port Security              : Enabled
Port Status                : ${portStatus}
Violation Mode             : ${violationMode}
Aging Time                 : 0 mins
Aging Type                 : Absolute
SecureStatic Address Aging : Disabled
Maximum MAC Addresses      : ${intf.portSecurityMax}
Total MAC Addresses        : ${intf.portSecurityMacAddresses.length}
Configured MAC Addresses   : 0
Sticky MAC Addresses       : ${intf.portSecuritySticky ? intf.portSecurityMacAddresses.length : 0}
Last Source Address:Vlan   : ${lastSource}
Security Violation Count   : ${intf.portSecurityViolationCount}`
  }
  private formatShowSpanningTree(): string {
    if (this.device.deviceType === 'pc' || this.device.deviceType === 'server' || this.device.deviceType === 'router') {
      return '% Spanning tree not enabled'
    }
    
    let out = ''
    
    for (const vlan of this.device.vlanDatabase.values()) {
      out += `VLAN${vlan.id.toString().padStart(4, '0')}\n`
      out += `  Spanning tree enabled protocol ieee\n`
      out += `  Root ID    Priority    32768\n`
      out += `             Address     0000.1111.2222\n`
      out += `             This bridge is the root\n`
      out += `             Hello Time   2 sec  Max Age 20 sec  Forward Delay 15 sec\n\n`
      out += `  Bridge ID  Priority    32768\n`
      out += `             Address     ${this.device.interfaces.values().next().value?.macAddress || '0000.0000.0000'}\n`
      out += `             Hello Time   2 sec  Max Age 20 sec  Forward Delay 15 sec\n`
      out += `             Aging Time  300 sec\n\n`
      
      out += `Interface           Role Sts Cost      Prio.Nbr Type\n`
      out += `------------------- ---- --- --------- -------- --------------------------------\n`
      
      // Find ports active in this VLAN
      for (const intf of this.device.interfaces.values()) {
        if (intf.operStatus === 'up' && (intf.accessVlan === vlan.id || intf.switchportMode === 'trunk')) {
          const name = intf.name.padEnd(19, ' ')
          const role = 'Desg'
          const sts = 'FWD'
          const cost = intf.speed === 1000 ? '4' : '19'
          const prio = '128.1'
          const type = 'P2p '
          out += `${name} ${role} ${sts} ${cost.padStart(9)} ${prio.padStart(8)} ${type}\n`
        }
      }
      out += '\n'
    }
    
    return out.trim()
  }
}
