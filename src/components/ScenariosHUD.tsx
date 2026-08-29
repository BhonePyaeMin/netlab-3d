import React, { useState } from 'react'
import { NetworkStore } from '../network/NetworkStore'
import { useNetworkStore } from '../network/useNetworkStore'
import { Scenarios } from '../network/engine/ScenarioManager'

export function ScenariosHUD() {
  const { isScenariosOpen, activeScenarioId, scenarioSuccess } = useNetworkStore()
  if (!isScenariosOpen && !activeScenarioId) return null

  const activeScenario = Scenarios.find(s => s.id === activeScenarioId)

  const handleCheck = () => {
    if (activeScenario) {
      const isSuccess = activeScenario.checkSuccess()
      NetworkStore.setScenarioSuccess(isSuccess)
      if (isSuccess) {
        alert('Congratulations! You resolved the issue!')
      } else {
        alert('Not yet! Keep troubleshooting.')
      }
    }
  }

  return (
    <div style={{
      position: 'absolute',
      top: 20,
      right: 20,
      width: '350px',
      background: 'rgba(0, 20, 0, 0.9)',
      border: '1px solid #0f0',
      color: '#0f0',
      padding: '16px',
      fontFamily: 'monospace',
      zIndex: 100,
      borderRadius: '8px',
      boxShadow: '0 4px 12px rgba(0,255,0,0.1)'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
        <h3 style={{ margin: 0, textTransform: 'uppercase' }}>Network Scenarios</h3>
        <button 
          onClick={() => {
            NetworkStore.toggleScenarios()
            if (!activeScenarioId) {
               // Only close if no active scenario, otherwise just close the menu?
               // Wait, toggleScenarios handles the visibility.
            }
          }}
          style={{ background: 'none', border: 'none', color: '#0f0', cursor: 'pointer' }}>
          ✖
        </button>
      </div>

      {!activeScenarioId ? (
        <div>
          <p style={{ color: '#aaa', fontSize: '12px' }}>Load a broken topology and fix it.</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {Scenarios.map(sc => (
              <button
                key={sc.id}
                onClick={() => {
                  sc.setup()
                  NetworkStore.setActiveScenarioId(sc.id)
                }}
                style={{
                  background: 'rgba(0,255,0,0.1)',
                  border: '1px solid #0f0',
                  color: '#0f0',
                  padding: '8px',
                  textAlign: 'left',
                  cursor: 'pointer'
                }}>
                <strong>{sc.title}</strong>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div>
          <div style={{ marginBottom: '16px' }}>
            <h4 style={{ margin: '0 0 8px 0', color: '#fff' }}>{activeScenario?.title}</h4>
            <p style={{ margin: 0, fontSize: '13px', lineHeight: '1.4' }}>{activeScenario?.description}</p>
          </div>
          
          <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
            <button
              onClick={handleCheck}
              style={{
                flex: 1,
                background: scenarioSuccess ? '#0f0' : 'rgba(0,255,0,0.2)',
                color: scenarioSuccess ? '#000' : '#0f0',
                border: '1px solid #0f0',
                padding: '8px',
                cursor: 'pointer',
                fontWeight: 'bold'
              }}>
              {scenarioSuccess ? 'SOLVED' : 'Check Solution'}
            </button>
            <button
              onClick={() => {
                NetworkStore.setActiveScenarioId(null)
                // Reload an empty lab or keep it as is
              }}
              style={{
                background: 'rgba(255,0,0,0.2)',
                color: '#f55',
                border: '1px solid #f55',
                padding: '8px',
                cursor: 'pointer'
              }}>
              Exit
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
