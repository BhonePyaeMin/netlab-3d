/**
 * ACLEngine.ts — Cisco IOS-like IPv4 Access Control List Engine.
 *
 * Supports:
 *   - Standard ACLs (1-99, named): match source IP only
 *   - Extended ACLs (100-199, named): match protocol, src/dst IP+port
 *
 * Rules are evaluated sequentially. Implicit deny-all at end.
 */
import { IPMath } from './IPMath'
import type { IPv4Packet, ICMPPacket, UDPPacket, TCPPacket } from './DataPlane'

export type AclAction = 'permit' | 'deny'
export type AclProtocol = 'ip' | 'tcp' | 'udp' | 'icmp' | 'ospf' | 'any'
export type AclPortOp = 'eq' | 'lt' | 'gt' | 'neq' | 'range' | 'any'

export interface AclPortMatch {
  op: AclPortOp
  port: number
  portHigh?: number // used for 'range'
}

export interface AclRule {
  sequence: number
  action: AclAction
  protocol: AclProtocol       // 'ip' or 'any' = any protocol (standard); specific for extended
  srcIp: string               // '0.0.0.0' = any
  srcWildcard: string         // '255.255.255.255' = any
  dstIp: string               // '0.0.0.0' = any (for extended)
  dstWildcard: string         // '255.255.255.255' = any
  srcPort?: AclPortMatch      // for TCP/UDP extended
  dstPort?: AclPortMatch      // for TCP/UDP extended
  matchCount: number          // number of times this rule matched
  log?: boolean               // log matches
}

export interface AccessList {
  id: string                  // '1', '100', 'MY_ACL' etc.
  type: 'standard' | 'extended'
  rules: AclRule[]
}

export class ACLEngine {
  private acls: Map<string, AccessList> = new Map()

  // ─── ACL Management ───────────────────────────────────────────────────────

  public getAcl(id: string): AccessList | undefined {
    return this.acls.get(id.toLowerCase())
  }

  public getOrCreateAcl(id: string, type: 'standard' | 'extended'): AccessList {
    const key = id.toLowerCase()
    if (!this.acls.has(key)) {
      this.acls.set(key, { id, type, rules: [] })
    }
    return this.acls.get(key)!
  }

  public deleteAcl(id: string): boolean {
    return this.acls.delete(id.toLowerCase())
  }

  public getAllAcls(): AccessList[] {
    return Array.from(this.acls.values())
  }

  /**
   * Add or replace a rule by sequence number.
   */
  public addRule(aclId: string, type: 'standard' | 'extended', rule: Omit<AclRule, 'matchCount'>): void {
    const acl = this.getOrCreateAcl(aclId, type)
    // Remove existing rule with same sequence
    acl.rules = acl.rules.filter(r => r.sequence !== rule.sequence)
    acl.rules.push({ ...rule, matchCount: 0 })
    // Sort by sequence number
    acl.rules.sort((a, b) => a.sequence - b.sequence)
  }

  public removeRule(aclId: string, sequence: number): void {
    const acl = this.getAcl(aclId)
    if (acl) {
      acl.rules = acl.rules.filter(r => r.sequence !== sequence)
    }
  }

  // ─── Packet Matching ──────────────────────────────────────────────────────

  /**
   * Evaluate an IPv4 packet against an ACL.
   * @returns 'permit' | 'deny'
   */
  public matchPacket(aclId: string, packet: IPv4Packet): AclAction {
    const acl = this.getAcl(aclId)
    if (!acl) return 'permit' // No ACL = permit

    for (const rule of acl.rules) {
      if (this.ruleMatches(rule, packet)) {
        rule.matchCount++
        return rule.action
      }
    }

    // Implicit deny-all
    return 'deny'
  }

  private ruleMatches(rule: AclRule, packet: IPv4Packet): boolean {
    // 1. Protocol check
    if (!this.protocolMatches(rule.protocol, packet.protocol)) return false

    // 2. Source IP check (wildcard match)
    if (!this.wildcardMatch(packet.srcIp, rule.srcIp, rule.srcWildcard)) return false

    // 3. Destination IP check (wildcard match)
    if (rule.dstIp !== '0.0.0.0' || rule.dstWildcard !== '255.255.255.255') {
      if (!this.wildcardMatch(packet.dstIp, rule.dstIp, rule.dstWildcard)) return false
    }

    // 4. Port checks (TCP/UDP)
    if (rule.srcPort || rule.dstPort) {
      let srcPort: number | undefined
      let dstPort: number | undefined

      if (packet.protocol === 6 || packet.protocol === 17) {
        const transport = packet.payload as UDPPacket | TCPPacket
        srcPort = transport?.srcPort
        dstPort = transport?.dstPort
      }

      if (rule.srcPort && srcPort !== undefined) {
        if (!this.portMatches(srcPort, rule.srcPort)) return false
      }
      if (rule.dstPort && dstPort !== undefined) {
        if (!this.portMatches(dstPort, rule.dstPort)) return false
      }
    }

    return true
  }

  private protocolMatches(ruleProtocol: AclProtocol, packetProtocol: number): boolean {
    switch (ruleProtocol) {
      case 'ip':
      case 'any':
        return true
      case 'icmp': return packetProtocol === 1
      case 'tcp':  return packetProtocol === 6
      case 'udp':  return packetProtocol === 17
      case 'ospf': return packetProtocol === 89
      default:     return false
    }
  }

  /**
   * Cisco wildcard mask matching.
   * A wildcard bit of 0 = must match, 1 = don't care.
   * e.g. host: 192.168.1.10 / 0.0.0.0
   *      subnet: 192.168.1.0 / 0.0.0.255 (matches .0–.255)
   *      any: 0.0.0.0 / 255.255.255.255
   */
  private wildcardMatch(packetIp: string, ruleIp: string, wildcard: string): boolean {
    try {
      const pOctets = packetIp.split('.').map(Number)
      const rOctets = ruleIp.split('.').map(Number)
      const wOctets = wildcard.split('.').map(Number)

      if (pOctets.length !== 4 || rOctets.length !== 4 || wOctets.length !== 4) return false

      for (let i = 0; i < 4; i++) {
        // bit-level: (packet XOR rule) AND (NOT wildcard) must be 0
        if ((pOctets[i] ^ rOctets[i]) & (~wOctets[i] & 0xFF)) return false
      }
      return true
    } catch {
      return false
    }
  }

  private portMatches(port: number, match: AclPortMatch): boolean {
    switch (match.op) {
      case 'eq':    return port === match.port
      case 'neq':   return port !== match.port
      case 'lt':    return port < match.port
      case 'gt':    return port > match.port
      case 'range': return port >= match.port && port <= (match.portHigh ?? match.port)
      case 'any':   return true
      default:      return true
    }
  }

  // ─── Auto-sequence Helper ─────────────────────────────────────────────────

  public nextSequence(aclId: string): number {
    const acl = this.getAcl(aclId)
    if (!acl || acl.rules.length === 0) return 10
    const max = Math.max(...acl.rules.map(r => r.sequence))
    return max + 10
  }

  // ─── Formatting ───────────────────────────────────────────────────────────

  public formatShowAccessLists(aclId?: string): string {
    const lists = aclId ? [this.getAcl(aclId)].filter(Boolean) : this.getAllAcls()

    if (lists.length === 0) {
      return aclId ? `% ACL ${aclId} not found` : ''
    }

    const lines: string[] = []
    for (const acl of lists as AccessList[]) {
      const typeStr = acl.type === 'standard' ? 'Standard' : 'Extended'
      const numId = parseInt(acl.id)
      const header = !isNaN(numId)
        ? `${typeStr} IP access list ${acl.id}`
        : `${typeStr} IP access list ${acl.id}`
      lines.push(header)

      for (const rule of acl.rules) {
        let line = `    ${rule.sequence} ${rule.action}`

        if (acl.type === 'extended') {
          line += ` ${rule.protocol}`
        }

        // Source
        if (rule.srcIp === '0.0.0.0' && rule.srcWildcard === '255.255.255.255') {
          line += ' any'
        } else if (rule.srcWildcard === '0.0.0.0') {
          line += ` host ${rule.srcIp}`
        } else {
          line += ` ${rule.srcIp} ${rule.srcWildcard}`
        }

        if (rule.srcPort) {
          line += ` ${rule.srcPort.op === 'any' ? '' : rule.srcPort.op + ' ' + rule.srcPort.port}`
        }

        // Destination (extended only)
        if (acl.type === 'extended') {
          if (rule.dstIp === '0.0.0.0' && rule.dstWildcard === '255.255.255.255') {
            line += ' any'
          } else if (rule.dstWildcard === '0.0.0.0') {
            line += ` host ${rule.dstIp}`
          } else {
            line += ` ${rule.dstIp} ${rule.dstWildcard}`
          }

          if (rule.dstPort) {
            line += ` ${rule.dstPort.op === 'any' ? '' : rule.dstPort.op + ' ' + rule.dstPort.port}`
          }
        }

        line += ` (${rule.matchCount} match${rule.matchCount === 1 ? '' : 'es'})`
        lines.push(line)
      }
    }

    return lines.join('\n')
  }

  public generateConfig(): string[] {
    const lines: string[] = []
    
    for (const acl of this.getAllAcls()) {
      const isNum = !isNaN(parseInt(acl.id))
      if (isNum) {
        // e.g., access-list 1 permit any
        for (const rule of acl.rules) {
          let line = `access-list ${acl.id} ${rule.action}`
          if (acl.type === 'extended') line += ` ${rule.protocol}`
          
          if (rule.srcIp === '0.0.0.0' && rule.srcWildcard === '255.255.255.255') line += ' any'
          else if (rule.srcWildcard === '0.0.0.0') line += ` host ${rule.srcIp}`
          else line += ` ${rule.srcIp} ${rule.srcWildcard}`
          
          if (rule.srcPort && rule.srcPort.op !== 'any') {
            line += ` ${rule.srcPort.op} ${rule.srcPort.port}`
          }

          if (acl.type === 'extended') {
            if (rule.dstIp === '0.0.0.0' && rule.dstWildcard === '255.255.255.255') line += ' any'
            else if (rule.dstWildcard === '0.0.0.0') line += ` host ${rule.dstIp}`
            else line += ` ${rule.dstIp} ${rule.dstWildcard}`
            
            if (rule.dstPort && rule.dstPort.op !== 'any') {
              line += ` ${rule.dstPort.op} ${rule.dstPort.port}`
            }
          }
          lines.push(line)
        }
      } else {
        // e.g. ip access-list extended MY_ACL
        lines.push(`ip access-list ${acl.type} ${acl.id}`)
        for (const rule of acl.rules) {
          let line = ` ${rule.sequence} ${rule.action}`
          if (acl.type === 'extended') line += ` ${rule.protocol}`
          
          if (rule.srcIp === '0.0.0.0' && rule.srcWildcard === '255.255.255.255') line += ' any'
          else if (rule.srcWildcard === '0.0.0.0') line += ` host ${rule.srcIp}`
          else line += ` ${rule.srcIp} ${rule.srcWildcard}`

          if (rule.srcPort && rule.srcPort.op !== 'any') line += ` ${rule.srcPort.op} ${rule.srcPort.port}`

          if (acl.type === 'extended') {
            if (rule.dstIp === '0.0.0.0' && rule.dstWildcard === '255.255.255.255') line += ' any'
            else if (rule.dstWildcard === '0.0.0.0') line += ` host ${rule.dstIp}`
            else line += ` ${rule.dstIp} ${rule.dstWildcard}`

            if (rule.dstPort && rule.dstPort.op !== 'any') line += ` ${rule.dstPort.op} ${rule.dstPort.port}`
          }
          lines.push(line)
        }
        lines.push('!')
      }
    }
    
    return lines
  }
}
