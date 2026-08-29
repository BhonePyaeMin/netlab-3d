import React, { useRef } from 'react'
import { NetworkStore } from '../network/NetworkStore'
import { useNetworkStore } from '../network/useNetworkStore'
import { ProjectManager } from '../network/engine/ProjectManager'

export function ProjectMenuHUD() {
  const { isProjectMenuOpen } = useNetworkStore()
  const fileInputRef = useRef<HTMLInputElement>(null)

  if (!isProjectMenuOpen) return null

  const handleNew = () => {
    if (window.confirm('Are you sure you want to clear the current project? All unsaved changes will be lost.')) {
      import('../network/engine/globalEngine').then(mod => {
        mod.simulationEngine.clear()
        NetworkStore.setProjectMenuOpen(false)
      })
    }
  }

  const handleSave = () => {
    const jsonStr = ProjectManager.exportProject()
    const blob = new Blob([jsonStr], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    
    const a = document.createElement('a')
    a.href = url
    a.download = 'netlab-project.json'
    a.click()
    
    URL.revokeObjectURL(url)
    NetworkStore.setProjectMenuOpen(false)
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    
    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const jsonStr = event.target?.result as string
        ProjectManager.importProject(jsonStr)
        NetworkStore.setProjectMenuOpen(false)
        alert('Project loaded successfully!')
      } catch (err) {
        console.error(err)
        alert('Failed to load project file.')
      }
    }
    reader.readAsText(file)
  }

  const handleOpenClick = () => {
    fileInputRef.current?.click()
  }

  return (
    <div style={{
      position: 'absolute',
      top: 60,
      right: 20,
      width: '200px',
      background: 'rgba(0, 10, 20, 0.9)',
      border: '1px solid #00dcff',
      color: '#00dcff',
      padding: '16px',
      fontFamily: 'monospace',
      zIndex: 100,
      borderRadius: '8px',
      boxShadow: '0 4px 12px rgba(0,220,255,0.1)'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
        <h3 style={{ margin: 0, textTransform: 'uppercase' }}>Project</h3>
        <button 
          onClick={() => NetworkStore.setProjectMenuOpen(false)}
          style={{ background: 'none', border: 'none', color: '#00dcff', cursor: 'pointer' }}>
          ✖
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <button
          onClick={handleNew}
          style={{
            background: 'rgba(0, 220, 255, 0.1)',
            border: '1px solid #00dcff',
            color: '#00dcff',
            padding: '8px',
            textAlign: 'center',
            cursor: 'pointer',
            borderRadius: '4px'
          }}>
          New Project
        </button>
        <button
          onClick={handleOpenClick}
          style={{
            background: 'rgba(0, 220, 255, 0.1)',
            border: '1px solid #00dcff',
            color: '#00dcff',
            padding: '8px',
            textAlign: 'center',
            cursor: 'pointer',
            borderRadius: '4px'
          }}>
          Open...
        </button>
        <button
          onClick={handleSave}
          style={{
            background: 'rgba(0, 220, 255, 0.1)',
            border: '1px solid #00dcff',
            color: '#00dcff',
            padding: '8px',
            textAlign: 'center',
            cursor: 'pointer',
            borderRadius: '4px'
          }}>
          Save As...
        </button>
      </div>
      
      <input 
        type="file" 
        accept=".json" 
        style={{ display: 'none' }} 
        ref={fileInputRef}
        onChange={handleFileChange} 
      />
    </div>
  )
}
