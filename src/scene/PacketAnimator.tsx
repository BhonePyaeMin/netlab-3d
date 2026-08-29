import React, { useRef, useState, useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useNetworkStore } from '../network/useNetworkStore'
import { NetworkStore } from '../network/NetworkStore'

export default function PacketAnimator() {
  const { activeTrace, currentHopIndex, playbackState, ports } = useNetworkStore()
  
  const meshRef = useRef<THREE.Mesh>(null)
  const [progress, setProgress] = useState(0)
  const curveRef = useRef<THREE.CatmullRomCurve3 | null>(null)

  // When hop or trace changes, reset progress
  useEffect(() => {
    setProgress(0)
  }, [activeTrace, currentHopIndex])

  // Rebuild the curve for the current hop's cable
  useEffect(() => {
    if (!activeTrace) {
      curveRef.current = null
      return
    }

    const hop = activeTrace.hops[currentHopIndex]
    if (!hop || hop.action !== 'forward' || !hop.outgoingPortId) {
      curveRef.current = null
      return
    }

    const startPort = ports.get(hop.outgoingPortId)
    if (!startPort || !startPort.remotePortId) {
      curveRef.current = null
      return
    }

    const endPort = ports.get(startPort.remotePortId)
    if (!endPort) {
      curveRef.current = null
      return
    }

    // Build the bezier curve exactly like CableSystem does
    const a = new THREE.Vector3(...startPort.worldPosition)
    const b = new THREE.Vector3(...endPort.worldPosition)
    const sag = 0.18
    const mid = new THREE.Vector3(
      (a.x + b.x) / 2,
      Math.min(a.y, b.y) - sag,
      (a.z + b.z) / 2
    )
    const bezier = new THREE.QuadraticBezierCurve3(a, mid, b)
    curveRef.current = new THREE.CatmullRomCurve3(bezier.getPoints(30))

  }, [activeTrace, currentHopIndex, ports])

  useFrame((state, delta) => {
    if (!activeTrace || !meshRef.current) return

    // Slowly rotate the packet
    meshRef.current.rotation.x += delta * 2
    meshRef.current.rotation.y += delta * 2

    if (playbackState !== 'playing') return

    const hop = activeTrace.hops[currentHopIndex]
    
    // If drop/consume or no outgoing port, we don't move. Just wait a bit then we're done.
    if (!hop || hop.action !== 'forward' || !curveRef.current) {
      if (progress < 1) {
        setProgress(p => Math.min(1, p + delta * 0.5)) // just a timer
      } else {
        NetworkStore.setPlaybackState('paused')
      }
      return
    }

    // Move along the curve
    if (progress < 1) {
      const nextProgress = Math.min(1, progress + delta * 0.5) // 2 seconds per cable
      setProgress(nextProgress)
      
      const point = curveRef.current.getPoint(nextProgress)
      meshRef.current.position.copy(point)
    } else {
      // Reached the end! Pause, and auto-advance to the next hop
      if (currentHopIndex < activeTrace.hops.length - 1) {
        NetworkStore.setCurrentHopIndex(currentHopIndex + 1)
      } else {
        NetworkStore.setPlaybackState('paused')
      }
    }
  })

  if (!activeTrace) return null

  // If we have a curve, draw it at start. If no curve (e.g. dropped), draw it at the device?
  // We'll just hide the packet if we can't find a curve, but it's better to show it at the incoming port.
  const hop = activeTrace.hops[currentHopIndex]
  if (!curveRef.current && hop?.incomingPortId) {
    const p = ports.get(hop.incomingPortId)
    if (p && meshRef.current) {
      meshRef.current.position.set(p.worldPosition[0], p.worldPosition[1] + 0.1, p.worldPosition[2])
    }
  }

  const getProtocolColor = (proto: string) => {
    switch (proto) {
      case 'ARP': return '#3498db'
      case 'ICMP': return '#e74c3c'
      case 'TCP': return '#2ecc71'
      case 'UDP': return '#f1c40f'
      case 'DNS': return '#9b59b6'
      case 'DHCP': return '#e67e22'
      case 'OSPF': return '#1abc9c'
      default: return '#ecf0f1'
    }
  }

  const color = getProtocolColor(activeTrace.protocol)

  return (
    <mesh ref={meshRef}>
      <octahedronGeometry args={[0.04, 0]} />
      <meshStandardMaterial 
        color={color} 
        emissive={color}
        emissiveIntensity={1.5}
        transparent
        opacity={0.9}
      />
      <pointLight color={color} intensity={0.5} distance={1} />
    </mesh>
  )
}
