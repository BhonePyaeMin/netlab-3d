/**
 * CableSystem.tsx
 *
 * Renders ALL cables in the scene — both pickupable coils on the floor
 * and active bezier tubes connecting ports.
 *
 * Also handles the "held cable" end following the player's hand (camera pos).
 *
 * Per-frame behaviour:
 *   'coiled'    → render coil mesh at spawnPosition
 *   'held'      → render half-tube from camera to nothing (just a dangling end)
 *   'partial'   → render tube from port A position to camera hand position
 *   'connected' → render full tube from port A to port B
 *
 * Sub-components:
 *   CableCoil     — pickup object on floor
 *   ActiveCable   — rendered bezier tube
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree }         from '@react-three/fiber'
import { Billboard, Text }            from '@react-three/drei'
import * as THREE                     from 'three'
import { NetworkStore }               from '../network/NetworkStore'
import { useNetworkStore }            from '../network/useNetworkStore'
import type { Cable }                 from '../network/types'

/* ─── Build a bezier tube geometry between two points ─── */
function makeCableGeometry(
  a: THREE.Vector3,
  b: THREE.Vector3,
  sag = 0.18,
): THREE.TubeGeometry {
  const mid = new THREE.Vector3(
    (a.x + b.x) / 2,
    Math.min(a.y, b.y) - sag,
    (a.z + b.z) / 2,
  )
  const bezier = new THREE.QuadraticBezierCurve3(a, mid, b)
  return new THREE.TubeGeometry(
    new THREE.CatmullRomCurve3(bezier.getPoints(30)),
    30, 0.007, 6, false,
  )
}

/* ══════════════════════════════════════════════════════════
   CABLE COIL — lies on floor until picked up
   ══════════════════════════════════════════════════════════ */
function CableCoil({ cable }: { cable: Cable }) {
  const meshRef = useRef<THREE.Mesh>(null)
  const mat     = useMemo(() =>
    new THREE.MeshStandardMaterial({ color: cable.color, roughness: 0.8, metalness: 0.05 }),
    [cable.color]
  )

  // Slow rotation animation
  useFrame(({ clock }) => {
    if (meshRef.current) {
      meshRef.current.rotation.y = clock.getElapsedTime() * 0.4
    }
  })

  return (
    <group
      position={cable.spawnPosition}
      userData={{
        interactable: true,
        label: `[P] Pick up cable (${cable.color === '#1a4a8a' ? 'Blue' : cable.color === '#1a5a30' ? 'Green' : 'Yellow'})`,
        onSecondaryAction: () => {
          const ok = NetworkStore.pickUpCable(cable.id)
          if (ok) {
            window.dispatchEvent(new CustomEvent('netlab:cableevent', {
              detail: { type: 'pickup', cableId: cable.id },
            }))
          }
        },
      }}
    >
      {/* Hit volume */}
      <mesh>
        <boxGeometry args={[0.25, 0.12, 0.25]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {/* Coil — torus shape */}
      <mesh ref={meshRef} position={[0, 0.04, 0]} material={mat}>
        <torusGeometry args={[0.06, 0.012, 8, 20]} />
      </mesh>
      {/* Extra loops */}
      <mesh position={[0, 0.055, 0]} rotation={[0, Math.PI/3, 0]} material={mat}>
        <torusGeometry args={[0.045, 0.008, 6, 16]} />
      </mesh>

      {/* Label */}
      <Billboard>
        <Text
          position={[0, 0.16, 0]}
          fontSize={0.045}
          color="#00dcff"
          anchorX="center"
          anchorY="middle"
        >
          Ethernet Cable
        </Text>
      </Billboard>
    </group>
  )
}

/* ══════════════════════════════════════════════════════════
   ACTIVE CABLE — rendered bezier tube
   ══════════════════════════════════════════════════════════ */
function ActiveCable({ cable }: { cable: Cable }) {
  const meshRef   = useRef<THREE.Mesh>(null)
  const { camera } = useThree()
  const { ports }  = useNetworkStore()

  const mat = useMemo(() =>
    new THREE.MeshStandardMaterial({ color: cable.color, roughness: 0.75, metalness: 0.06 }),
    [cable.color]
  )

  useFrame(() => {
    if (!meshRef.current) return

    let posA: THREE.Vector3 | null = null
    let posB: THREE.Vector3 | null = null

    if (cable.endpointA) {
      const portA = ports.get(cable.endpointA)
      if (portA) posA = new THREE.Vector3(...portA.worldPosition)
    }

    if (cable.status === 'partial') {
      // Hand position = slightly below and in front of camera
      const hand = camera.position.clone()
      const fwd  = new THREE.Vector3()
      camera.getWorldDirection(fwd)
      hand.addScaledVector(fwd, 0.5)
      hand.y -= 0.25
      posB = hand
    } else if (cable.endpointB) {
      const portB = ports.get(cable.endpointB)
      if (portB) posB = new THREE.Vector3(...portB.worldPosition)
    }

    if (posA && posB) {
      const newGeo = makeCableGeometry(posA, posB)
      meshRef.current.geometry.dispose()
      meshRef.current.geometry = newGeo
    }
  })

  const initialGeo = useMemo(() => {
    const a = cable.endpointA ? ports.get(cable.endpointA) : null
    const b = cable.endpointB ? ports.get(cable.endpointB) : null
    if (a && b) {
      return makeCableGeometry(
        new THREE.Vector3(...a.worldPosition),
        new THREE.Vector3(...b.worldPosition),
      )
    }
    return new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(0,0,0), new THREE.Vector3(0,-0.1,0), new THREE.Vector3(0,-0.2,0)
      ]), 4, 0.007, 6, false
    )
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])   // only once — useFrame updates it

  return (
    <mesh ref={meshRef} geometry={initialGeo} material={mat} castShadow />
  )
}

/* ══════════════════════════════════════════════════════════
   PORT HIGHLIGHT — glowing ring shown on available ports
   when player is holding a cable
   ══════════════════════════════════════════════════════════ */
function PortHighlight({ portId }: { portId: string }) {
  const { ports } = useNetworkStore()
  const port = ports.get(portId)
  if (!port || port.connectedCableId) return null

  return (
    <group position={port.worldPosition}>
      {/* Pulsing ring */}
      <mesh rotation={[Math.PI/2, 0, 0]}>
        <torusGeometry args={[0.022, 0.004, 8, 24]} />
        <meshStandardMaterial
          color="#00ff88"
          emissive="#00ff88"
          emissiveIntensity={3}
          transparent opacity={0.9}
        />
      </mesh>

      {/* Invisible interaction hit area */}
      <mesh
        userData={{
          interactable: true,
          label: `[C] Plug into ${port.label}`,
          onConnectAction: () => {
            const result = NetworkStore.connectCableEnd(portId)
            window.dispatchEvent(new CustomEvent('netlab:cableevent', {
              detail: { type: 'connect', portId, result },
            }))
            NetworkStore.logTopology()
          },
        }}
      >
        <sphereGeometry args={[0.08, 8, 8]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  )
}

/* ══════════════════════════════════════════════════════════
   MAIN CABLE SYSTEM COMPONENT
   ══════════════════════════════════════════════════════════ */
export default function CableSystem() {
  const { cables, ports, heldCableId } = useNetworkStore()
  const isHolding = heldCableId !== null

  // Register coiled cables on mount
  useEffect(() => {
    NetworkStore.spawnCable({
      id: 'cable-blue',
      endpointA: null, endpointB: null,
      color: '#1a4a8a',
      status: 'coiled',
      spawnPosition: [-7.5, 1.35, -5.0], // Top shelf
    })
    NetworkStore.spawnCable({
      id: 'cable-green',
      endpointA: null, endpointB: null,
      color: '#1a5a30',
      status: 'coiled',
      spawnPosition: [-7.5, 0.85, -5.0], // Middle shelf
    })
    NetworkStore.spawnCable({
      id: 'cable-yellow',
      endpointA: null, endpointB: null,
      color: '#7a6010',
      status: 'coiled',
      spawnPosition: [-7.5, 0.35, -5.0], // Bottom shelf
    })
  }, [])

  // Handle drop cable on G key
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'KeyG' && heldCableId) {
        NetworkStore.dropCable()
        window.dispatchEvent(new CustomEvent('netlab:cableevent', {
          detail: { type: 'drop' },
        }))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [heldCableId])

  const cablesArr = Array.from(cables.values())

  return (
    <group name="cable-system">
      {/* Render coils (pickupable) */}
      {cablesArr
        .filter(c => c.status === 'coiled')
        .map(c => <CableCoil key={c.id} cable={c} />)
      }

      {/* Render active cable tubes */}
      {cablesArr
        .filter(c => c.status === 'partial' || c.status === 'connected')
        .map(c => <ActiveCable key={c.id} cable={c} />)
      }

      {/* Port highlights — shown on all empty ethernet ports when holding cable, ONLY for placed devices */}
      {isHolding && Array.from(ports.values())
        .filter(p => p.portType === 'ethernet' && !p.connectedCableId && NetworkStore.getSnapshot().devices.some(d => d.id === p.deviceId))
        .map(p => <PortHighlight key={p.id} portId={p.id} />)
      }
    </group>
  )
}
