/**
 * IPMath.ts - IPv4 calculation and validation utilities
 */

export class IPMath {
  /** Check if a string is a valid IPv4 address (e.g. 192.168.1.1) */
  static validateIp(ip: string): boolean {
    const parts = ip.split('.')
    if (parts.length !== 4) return false
    for (const part of parts) {
      if (!/^\d+$/.test(part)) return false
      const num = parseInt(part, 10)
      if (num < 0 || num > 255) return false
    }
    return true
  }

  /** Check if a string is a valid Subnet Mask (e.g. 255.255.255.0) */
  static validateMask(mask: string): boolean {
    if (!this.validateIp(mask)) return false
    const long = this.ipToLong(mask)
    // A valid mask in binary is a sequence of 1s followed by 0s
    // Formula: ~long & (~long + 1) === 0 (for 32-bit unsigned)
    const inv = (~long) >>> 0
    return (inv & (inv + 1)) === 0
  }

  /** Convert an IP string to a 32-bit unsigned integer */
  static ipToLong(ip: string): number {
    return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0
  }

  /** Convert a 32-bit unsigned integer to an IP string */
  static longToIp(long: number): string {
    return [
      (long >>> 24) & 255,
      (long >>> 16) & 255,
      (long >>> 8) & 255,
      long & 255
    ].join('.')
  }

  /** Calculate the network address given an IP and a Subnet Mask */
  static getNetworkAddress(ip: string, mask: string): string {
    const ipL = this.ipToLong(ip)
    const maskL = this.ipToLong(mask)
    return this.longToIp((ipL & maskL) >>> 0)
  }

  /** Calculate the broadcast address given an IP and a Subnet Mask */
  static getBroadcastAddress(ip: string, mask: string): string {
    const ipL = this.ipToLong(ip)
    const maskL = this.ipToLong(mask)
    const invMask = (~maskL) >>> 0
    return this.longToIp((ipL | invMask) >>> 0)
  }

  /** Calculate the wildcard mask (inverse of subnet mask) */
  static getWildcardMask(mask: string): string {
    const maskL = this.ipToLong(mask)
    return this.longToIp((~maskL) >>> 0)
  }

  /** Convert a CIDR prefix (e.g. 24) to a subnet mask (e.g. 255.255.255.0) */
  static prefixToMask(prefix: number): string {
    if (prefix < 0 || prefix > 32) throw new Error('Invalid prefix length')
    if (prefix === 0) return '0.0.0.0'
    const maskL = (0xFFFFFFFF << (32 - prefix)) >>> 0
    return this.longToIp(maskL)
  }

  /** Calculate the number of usable hosts for a given mask */
  static calculateHosts(mask: string): number {
    const maskL = this.ipToLong(mask)
    const invMask = (~maskL) >>> 0
    if (invMask === 0) return 0 // /32 host route
    if (invMask === 1) return 0 // /31 point-to-point (often 2 depending on RFC, but standard is 0 usable)
    return invMask - 1 // subtract network and broadcast
  }

  /** Check if two IP addresses are in the same subnet */
  static isSameSubnet(ip1: string, ip2: string, mask: string): boolean {
    const net1 = this.getNetworkAddress(ip1, mask)
    const net2 = this.getNetworkAddress(ip2, mask)
    return net1 === net2
  }

  /** Convert a subnet mask to prefix bits count (e.g. '255.255.255.0' → 24) */
  static maskToBits(mask: string): number {
    const long = this.ipToLong(mask)
    let count = 0
    let n = long >>> 0
    while (n) {
      count += n & 1
      n >>>= 1
    }
    return count
  }

  // --- IPv6 ---

  static validateIpv6(ip: string): boolean {
    if (!ip || typeof ip !== 'string') return false
    const parts = ip.split('::')
    if (parts.length > 2) return false
    if (parts.length === 2) {
      const left = parts[0] ? parts[0].split(':') : []
      const right = parts[1] ? parts[1].split(':') : []
      if (left.length + right.length > 7) return false
      for (const p of [...left, ...right]) {
        if (p && !/^[0-9a-fA-F]{1,4}$/.test(p)) return false
      }
      return true
    } else {
      const split = ip.split(':')
      if (split.length !== 8) return false
      for (const p of split) {
        if (!/^[0-9a-fA-F]{1,4}$/.test(p)) return false
      }
      return true
    }
  }

  static expandIpv6(ip: string): string | null {
    if (!this.validateIpv6(ip)) return null
    const parts = ip.split('::')
    const left = parts[0] ? parts[0].split(':') : []
    const right = parts.length > 1 ? (parts[1] ? parts[1].split(':') : []) : []
    
    const missing = 8 - (left.length + right.length)
    const middle = Array(missing).fill('0000')
    
    return [...left, ...middle, ...right].map(p => p.padStart(4, '0').toLowerCase()).join(':')
  }

  static shortenIpv6(ip: string): string {
    const exp = this.expandIpv6(ip)
    if (!exp) return ip
    const parts = exp.split(':').map(p => parseInt(p, 16).toString(16))
    
    let maxZeroStart = -1
    let maxZeroLen = 0
    let curZeroStart = -1
    let curZeroLen = 0
    
    for (let i = 0; i < 8; i++) {
       if (parts[i] === '0') {
           if (curZeroStart === -1) curZeroStart = i
           curZeroLen++
       } else {
           if (curZeroLen > maxZeroLen) {
               maxZeroLen = curZeroLen
               maxZeroStart = curZeroStart
           }
           curZeroStart = -1
           curZeroLen = 0
       }
    }
    if (curZeroLen > maxZeroLen) {
        maxZeroLen = curZeroLen
        maxZeroStart = curZeroStart
    }
    
    if (maxZeroLen > 1) {
        parts.splice(maxZeroStart, maxZeroLen, '')
        if (maxZeroStart === 0) parts.unshift('')
        if (maxZeroStart + maxZeroLen === 8) parts.push('')
    }
    return parts.join(':')
  }

  static ipv6ToBinStr(ip: string): string | null {
    const exp = this.expandIpv6(ip)
    if (!exp) return null
    return exp.split(':').map(h => parseInt(h, 16).toString(2).padStart(16, '0')).join('')
  }

  static isSameIpv6Subnet(ip1: string, ip2: string, prefixLength: number): boolean {
    const bin1 = this.ipv6ToBinStr(ip1)
    const bin2 = this.ipv6ToBinStr(ip2)
    if (!bin1 || !bin2) return false
    return bin1.substring(0, prefixLength) === bin2.substring(0, prefixLength)
  }

  static generateIpv6LinkLocal(mac: string): string {
    const parts = mac.split(':')
    if (parts.length !== 6) return 'fe80::1'
    let byte0 = parseInt(parts[0], 16)
    byte0 ^= 0x02 // Flip U/L bit
    const hex0 = byte0.toString(16).padStart(2, '0')
    const eui = `${hex0}${parts[1]}:${parts[2]}ff:fe${parts[3]}:${parts[4]}${parts[5]}`
    return this.shortenIpv6(`fe80::${eui}`)
  }
}
