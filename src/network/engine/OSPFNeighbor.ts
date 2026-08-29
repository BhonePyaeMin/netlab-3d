export type OSPFNeighborState = 'Down' | 'Init' | '2-Way' | 'ExStart' | 'Exchange' | 'Loading' | 'Full'

export class OSPFNeighbor {
  public routerId: string
  public ipAddress: string
  public interfaceId: string
  
  public state: OSPFNeighborState = 'Down'
  
  public deadTimer: number = 0
  public deadInterval: number = 40 // Default 40s
  
  // For simplicity in this educational simulation, once we hit 2-Way we just jump straight to Full.
  // A more advanced sim would do DBD exchange, LSR, LSU.
  
  constructor(routerId: string, ipAddress: string, interfaceId: string) {
    this.routerId = routerId
    this.ipAddress = ipAddress
    this.interfaceId = interfaceId
  }

  public tick(deltaTime: number): void {
    if (this.state !== 'Down') {
      this.deadTimer -= deltaTime / 1000 // Convert ms to seconds
      if (this.deadTimer <= 0) {
        this.state = 'Down'
      }
    }
  }

  public resetDeadTimer(): void {
    this.deadTimer = this.deadInterval
  }
}
