import React, { useState, useEffect } from 'react'
import { NetworkStore } from '../network/NetworkStore'
import { useNetworkStore } from '../network/useNetworkStore'
import { simulationEngine } from '../network/engine/globalEngine'

export function SimulationControlsHUD() {
  const store = useNetworkStore()
  const [timeStr, setTimeStr] = useState('00:00:00')

  // UI loop for smooth time rendering without spamming the global store
  useEffect(() => {
    let handle: number
    const updateTime = () => {
      const totalSeconds = Math.floor(simulationEngine.now() / 1000)
      const hours = Math.floor(totalSeconds / 3600)
      const minutes = Math.floor((totalSeconds % 3600) / 60)
      const seconds = totalSeconds % 60
      
      const formatted = [
        hours.toString().padStart(2, '0'),
        minutes.toString().padStart(2, '0'),
        seconds.toString().padStart(2, '0')
      ].join(':')

      setTimeStr(formatted)
      handle = requestAnimationFrame(updateTime)
    }
    updateTime()
    return () => cancelAnimationFrame(handle)
  }, [])

  const setSpeed = (s: number) => {
    simulationEngine.setSpeed(s)
    NetworkStore.setSimulationSpeed(s)
  }

  const handlePlayPause = () => {
    if (store.simulationState === 'running') {
      simulationEngine.setState('paused')
      NetworkStore.setSimulationState('paused')
    } else {
      simulationEngine.setState('running')
      NetworkStore.setSimulationState('running')
    }
  }

  const handleStop = () => {
    simulationEngine.setState('stopped')
    NetworkStore.setSimulationState('stopped')
  }

  const handleReset = () => {
    simulationEngine.setState('paused') // Usually reset pauses
    NetworkStore.setSimulationState('paused')
    simulationEngine.resetSimulation()
    // Reset time display immediately
    setTimeStr('00:00:00')
  }

  return (
    <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-[#1a1d27] border border-[#2d3248] rounded-lg shadow-2xl flex items-center p-2 gap-4 pointer-events-auto z-40">
      
      {/* Clock Readout */}
      <div className="font-mono text-[#00dcff] font-bold text-lg px-4 bg-[#12141c] rounded border border-[#2d3248] py-1 shadow-inner min-w-[110px] text-center">
        {timeStr}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2 border-r border-[#2d3248] pr-4">
        <button 
          onClick={handlePlayPause}
          className={`w-10 h-10 rounded flex items-center justify-center transition-colors ${
            store.simulationState === 'running' 
              ? 'bg-[#2ecc71] hover:bg-[#27ae60] text-black shadow-[0_0_15px_rgba(46,204,113,0.4)]' 
              : 'bg-[#2d3248] hover:bg-[#343a55] text-white'
          }`}
          title={store.simulationState === 'running' ? 'Pause Simulation' : 'Resume Simulation'}
        >
          {store.simulationState === 'running' ? '⏸' : '▶'}
        </button>
        
        <button 
          onClick={handleStop}
          className={`w-10 h-10 rounded flex items-center justify-center transition-colors ${
            store.simulationState === 'stopped' 
              ? 'bg-red-500 text-white shadow-[0_0_15px_rgba(239,68,68,0.4)]' 
              : 'bg-[#2d3248] hover:bg-[#343a55] text-white'
          }`}
          title="Stop Simulation"
        >
          ⏹
        </button>

        <button 
          onClick={handleReset}
          className="w-10 h-10 rounded flex items-center justify-center bg-[#2d3248] hover:bg-orange-500 transition-colors text-white hover:text-black"
          title="Reset Simulation (Flushes State)"
        >
          🔄
        </button>
      </div>

      {/* Speed Multipliers */}
      <div className="flex items-center gap-1">
        {[1, 2, 5, 10].map(speed => (
          <button
            key={speed}
            onClick={() => setSpeed(speed)}
            className={`px-3 py-1 text-sm font-bold rounded transition-colors ${
              store.simulationSpeed === speed
                ? 'bg-[#3498db] text-white shadow-[0_0_10px_rgba(52,152,219,0.5)]'
                : 'bg-transparent text-gray-400 hover:text-white hover:bg-[#2d3248]'
            }`}
          >
            {speed}x
          </button>
        ))}
      </div>

      {/* Event Log Toggle */}
      <div className="flex items-center gap-1 border-l border-[#2d3248] pl-4">
        <button
          onClick={() => NetworkStore.toggleEventLog()}
          className={`w-10 h-10 rounded flex items-center justify-center transition-colors ${
            store.isEventLogOpen
              ? 'bg-[#9b59b6] text-white shadow-[0_0_15px_rgba(155,89,182,0.4)]'
              : 'bg-[#2d3248] hover:bg-[#343a55] text-white'
          }`}
          title="Toggle Event Log"
        >
          📜
        </button>
      </div>
    </div>
  )
}
