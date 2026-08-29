import { simulationEngine } from './globalEngine'

export class GNS3Connector {
  private apiUrl = 'http://localhost:8000/api/gns3'

  public async connectToConsole(deviceId: string): Promise<{ success: boolean; message: string }> {
    try {
      // In a real implementation, this might establish a WebSocket or check node status
      const res = await fetch(`${this.apiUrl}/nodes/${deviceId}/console`, { method: 'HEAD' })
      if (res.ok) {
        return { success: true, message: `Connected to ${deviceId} console.` }
      }
      return { success: false, message: `Unable to connect to ${deviceId} console.` }
    } catch (e) {
      console.warn(`[GNS3] API unreachable for ${deviceId}`)
      return { success: false, message: `Unable to connect to ${deviceId} console.` }
    }
  }

  public async executeCommand(deviceId: string, command: string, terminalType: string): Promise<string> {
    try {
      const res = await fetch(`${this.apiUrl}/nodes/${deviceId}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command, terminalType })
      })
      if (!res.ok) {
        throw new Error('API Error')
      }
      const data = await res.json()
      return data.output || ''
    } catch (e) {
      // Fallback to internal simulation engine if GNS3 is unavailable
      return simulationEngine.executeCommand(deviceId, command)
    }
  }
}

export const gns3Connector = new GNS3Connector()
