/**
 * Lab.tsx — NetLab 3D Server Room
 *
 * Phase 3: Full networking laboratory with unique device IDs,
 * floating billboard labels, improved layout, and all devices
 * wired to the Phase 2 interaction raycaster.
 *
 * Devices:
 *   Router1, Router2   — Cisco-style rack-mount routers
 *   Switch1, Switch2   — 8-port managed switches
 *   PC1, PC2           — workstation + monitor
 *   Server1            — 1U rack-mount server
 *   Rack1              — 12U server rack
 *
 * Layout (top-down, Z into screen):
 *
 *   ┌─────────────────── back wall ───────────────────┐
 *   │  [Rack1]   [Router1+SW1 table]  [Server1 table] │
 *   │                                                  │
 *   │  [SW2 table]    (open walkway)   [Router2 table] │
 *   │                                                  │
 *   │  [PC2 table]   (open walkway)   [PC1 table]     │
 *   └──────────────── front wall (player spawn) ───────┘
 */
import { useRef, useMemo, useEffect, useState } from 'react'
import { useFrame, useThree }                    from '@react-three/fiber'
import { Text, Billboard }             from '@react-three/drei'
import * as THREE                      from 'three'
import { NetworkStore }                from '../network/NetworkStore'
import { useTerminalSession }          from '../components/TerminalScreen'
import { useNetworkStore }             from '../network/useNetworkStore'
import type { Port }                   from '../network/types'

/* ============================================================
   ROOM CONSTANTS  (must match usePlayerPhysics boundaries)
   ============================================================ */
export const ROOM_W = 16    // X  — wider for better walkability
export const ROOM_D = 18    // Z
export const ROOM_H = 4.5   // Y
const WALL_T = 0.15

/* ============================================================
   SHARED MATERIALS  (created once, never per-frame)
   ============================================================ */
const m = (opts: ConstructorParameters<typeof THREE.MeshStandardMaterial>[0]) =>
  new THREE.MeshStandardMaterial(opts)

const MAT_FLOOR     = m({ color:'#181b24', roughness:0.9,  metalness:0.08 })
const MAT_WALL      = m({ color:'#0e1018', roughness:0.95, metalness:0.03 })
const MAT_CEILING   = m({ color:'#0b0d14', roughness:1,    metalness:0    })
const MAT_TABLE     = m({ color:'#1c2030', roughness:0.65, metalness:0.25 })
const MAT_TABLE_LEG = m({ color:'#252838', roughness:0.55, metalness:0.6  })
const MAT_RACK_BODY = m({ color:'#0d0d12', roughness:0.4,  metalness:0.85 })
const MAT_RACK_TRIM = m({ color:'#18181f', roughness:0.3,  metalness:0.9,  emissive:'#000818', emissiveIntensity:0.3 })
const MAT_ROUTER    = m({ color:'#1a3050', roughness:0.5,  metalness:0.7,  emissive:'#001a38', emissiveIntensity:0.5 })
const MAT_SWITCH    = m({ color:'#0f2820', roughness:0.5,  metalness:0.65, emissive:'#001810', emissiveIntensity:0.4 })
const MAT_SERVER    = m({ color:'#141418', roughness:0.4,  metalness:0.8,  emissive:'#040408', emissiveIntensity:0.2 })
const MAT_FIREWALL  = m({ color:'#330808', roughness:0.5,  metalness:0.6,  emissive:'#1a0404', emissiveIntensity:0.4 })
const MAT_STORAGE   = m({ color:'#0a1420', roughness:0.3,  metalness:0.9,  emissive:'#050a10', emissiveIntensity:0.2 })
const MAT_PC        = m({ color:'#1a1a28', roughness:0.65, metalness:0.5  })
const MAT_MONITOR   = m({ color:'#060610', roughness:0.2,  metalness:0.4,  emissive:'#000820', emissiveIntensity:0.9 })
const MAT_LED_G     = m({ color:'#00ff88', emissive:'#00cc55', emissiveIntensity:4, roughness:0.1 })
const MAT_LED_B     = m({ color:'#00aaff', emissive:'#0077dd', emissiveIntensity:4, roughness:0.1 })
const MAT_LED_A     = m({ color:'#ffaa00', emissive:'#cc8800', emissiveIntensity:4, roughness:0.1 })
const MAT_GRID      = m({ color:'#00dcff', emissive:'#00dcff', emissiveIntensity:0.12,
                           transparent:true, opacity:0.10, roughness:1 })

/* ============================================================
   PRIMITIVE HELPERS
   ============================================================ */

/** Single LED sphere */
function Led({ pos, mat }: { pos:[number,number,number]; mat:THREE.Material }) {
  return (
    <mesh position={pos} material={mat}>
      <sphereGeometry args={[0.013, 6, 6]} />
    </mesh>
  )
}

/** Table with 4 legs and under-shelf */
function Table({ pos, w=2.2, d=0.9, h=0.75 }:
  { pos:[number,number,number]; w?:number; d?:number; h?:number }) {
  const legH  = h - 0.04
  const legR  = 0.028
  const ix    = w/2 - 0.1
  const iz    = d/2 - 0.1
  return (
    <group position={pos}>
      {/* Tabletop */}
      <mesh position={[0,h,0]} receiveShadow castShadow material={MAT_TABLE}>
        <boxGeometry args={[w, 0.04, d]} />
      </mesh>
      {/* Legs */}
      {([ [-ix,-iz],[ix,-iz],[-ix,iz],[ix,iz] ] as [number,number][]).map(([lx,lz],i)=>(
        <mesh key={i} position={[lx, legH/2, lz]} receiveShadow material={MAT_TABLE_LEG}>
          <cylinderGeometry args={[legR,legR,legH,8]} />
        </mesh>
      ))}
      {/* Cross-brace */}
      <mesh position={[0,0.22,0]} material={MAT_TABLE_LEG}>
        <boxGeometry args={[w-0.18, 0.022, 0.022]} />
      </mesh>
      {/* Under-shelf */}
      <mesh position={[0,0.35,0]} receiveShadow material={MAT_TABLE}>
        <boxGeometry args={[w-0.05, 0.016, d-0.05]} />
      </mesh>
    </group>
  )
}

/* ============================================================
   FLOATING DEVICE LABEL (Billboard — always faces camera)
   ============================================================ */
function DeviceLabel({ id, type, height=0.25, color='#00dcff' }:
  { id:string; type:string; height?:number; color?:string }) {
  const session = useTerminalSession()
  // These billboards always face the camera, so during the 3D console shot they
  // plant themselves across the laptop screen. They are lab wayfinding, not
  // part of the cinematic.
  if (session.deviceId && session.view === '3d') return null

  return (
    <Billboard follow lockX={false} lockY={false} lockZ={false}>
      <group position={[0, height, 0]}>
        {/* Background pill */}
        <mesh>
          <planeGeometry args={[0.55, 0.14]} />
          <meshBasicMaterial color="#000c18" transparent opacity={0.75} depthWrite={false} />
        </mesh>
        {/* Border glow (slightly larger) */}
        <mesh position={[0,0,-0.001]}>
          <planeGeometry args={[0.57, 0.16]} />
          <meshBasicMaterial color={color} transparent opacity={0.25} depthWrite={false} />
        </mesh>
        {/* Device ID */}
        <Text
          position={[0, 0, 0.002]}
          fontSize={0.065}
          color={color}
          anchorX="center"
          anchorY="middle"
          font={undefined}
          renderOrder={999}
          depthOffset={-10}
        >
          {id}
        </Text>
      </group>
    </Billboard>
  )
}

/* ============================================================
   SERVER RACK
   ============================================================ */
function ServerRack({ pos, id='Rack1' }: { pos:[number,number,number]; id?:string }) {
  const [inv, setInv] = useState({ Router: 2, PC: 2, Switch: 2 })
  const categories = ['Router', 'PC', 'Switch'] as const

  const rW = 0.65, rD = 0.9, rH = 3.8
  const unitH = rH / 22

  // Generate the vertical stack array based on remaining inventory
  const stack: { type: typeof categories[number], idx: number }[] = []
  categories.forEach(cat => {
    for (let i = 0; i < inv[cat]; i++) {
      stack.push({ type: cat, idx: i })
    }
  })

  return (
    <group position={pos}>
      {/* Body */}
      <mesh receiveShadow castShadow material={MAT_RACK_BODY}>
        <boxGeometry args={[rW, rH, rD]} />
      </mesh>

      {/* Side rails */}
      {([-1,1] as const).map((s,i)=>(
        <mesh key={i} position={[s*(rW/2-0.02),0,0]} material={MAT_RACK_TRIM}>
          <boxGeometry args={[0.045, rH, rD]} />
        </mesh>
      ))}

      {/* Rack-mounted drawer (2U) */}
      <group position={[0, -rH/2 + unitH * 2.5, rD/2 - 0.25]}>
        <mesh material={MAT_SERVER}>
          <boxGeometry args={[rW - 0.08, unitH * 2, 0.4]} />
        </mesh>
        {/* Drawer Handle */}
        <mesh position={[0, 0, 0.21]} material={MAT_RACK_TRIM}>
          <boxGeometry args={[0.3, 0.04, 0.03]} />
        </mesh>
        {/* Label */}
        <group position={[0, 0, 0.22]}>
          <DeviceLabel id="TOOLS & CABLES" type="Utility Drawer" height={0.06} color="#cccccc" />
        </group>
      </group>

      {/* Dynamic Contents (Devices available to take) */}
      <group position={[0, 0, 0]}>
        {stack.map((item, index) => {
          const y = -rH/2 + unitH * (index * 2.5 + 5.5) // Spaced out above the drawer
          let mat = MAT_SERVER
          let heightMult = 0.8
          if (item.type === 'Switch') { mat = MAT_SWITCH; heightMult = 0.5 }
          if (item.type === 'Router') { mat = MAT_ROUTER; heightMult = 0.6 }
          if (item.type === 'PC') { mat = MAT_PC; heightMult = 0.8 }

          return (
            <group key={`${item.type}-${item.idx}`} position={[0, y, rD/2 - 0.25]}>
              <mesh
                userData={{
                  interactable: true,
                  label: `[P] Pick up ${item.type}`,
                  onSecondaryAction: () => {
                    // Instead of only spawning a dumb 3D object, we must spawn it in the simulation engine to generate ports!
                    // This creates the engine objects, interfaces, AND registers the 3D model properly.
                    import('../network/engine/globalEngine').then(({ spawnDeviceToEngine }) => {
                      const newId = spawnDeviceToEngine(item.type as any, [0,0,0])
                      NetworkStore.pickUpDevice(newId)
                      setInv(prev => ({ ...prev, [item.type]: prev[item.type] - 1 }))
                    })
                  }
                }}
                material={mat}
              >
                <boxGeometry args={[rW-0.08, unitH * heightMult, 0.4]} />
              </mesh>
              <group position={[0, 0, 0.201]}>
                <DeviceLabel id="" type={item.type} height={0.06} color="#ffffff" />
              </group>
            </group>
          )
        })}
      </group>

      <Billboard follow lockX={false} lockY={false} lockZ={false}>
        <group position={[0, rH/2 + 0.2, 0]}>
          <mesh>
            <planeGeometry args={[1.0, 0.2]} />
            <meshBasicMaterial color="#000c18" transparent opacity={0.75} depthWrite={false} />
          </mesh>
          <Text position={[0,0,0.01]} fontSize={0.08} color="#00ff88" anchorX="center" anchorY="middle">SERVER RACK</Text>
        </group>
      </Billboard>
    </group>
  )
}

/* ============================================================
   CABLE CABINET
   ============================================================ */
function CableCabinet({ pos, rot=[0,0,0] }: { pos:[number,number,number]; rot?:[number,number,number] }) {
  const [cableCount, setCableCount] = useState(12)

  return (
    <group position={pos} rotation={new THREE.Euler(...rot)}>
      <mesh receiveShadow castShadow material={MAT_RACK_BODY}>
        <boxGeometry args={[1.5, 2.0, 0.6]} />
      </mesh>
      {/* Shelves */}
      <mesh position={[0, -0.5, 0.1]} material={MAT_TABLE}>
        <boxGeometry args={[1.4, 0.05, 0.4]} />
      </mesh>
      <mesh position={[0, 0, 0.1]} material={MAT_TABLE}>
        <boxGeometry args={[1.4, 0.05, 0.4]} />
      </mesh>
      <mesh position={[0, 0.5, 0.1]} material={MAT_TABLE}>
        <boxGeometry args={[1.4, 0.05, 0.4]} />
      </mesh>

      {/* Dynamic Contents (Cables available to take) */}
      <group position={[0, 0, 0.1]}>
        {/* Render up to 4 cables on the bottom shelf */}
        {[-0.45, -0.15, 0.15, 0.45].slice(0, Math.min(cableCount, 4)).map((x, i) => (
          <mesh
            key={`cable-bot-${i}`}
            position={[x, -0.45, 0]}
            userData={{
              interactable: true,
              label: '[P] Pick up cable',
              onSecondaryAction: () => {
                const id = `cable-${Date.now()}`
                const color = i % 2 === 0 ? '#ff3333' : '#3366ff'
                NetworkStore.spawnCable({ id, color, status: 'coiled', endpointA: null, endpointB: null, spawnPosition: pos })
                NetworkStore.pickUpCable(id)
                setCableCount(c => c - 1)
              }
            }}
          >
            <cylinderGeometry args={[0.06, 0.06, 0.1, 16]} />
            <meshStandardMaterial color={i % 2 === 0 ? '#ff3333' : '#3366ff'} />
          </mesh>
        ))}
        {/* Render up to 4 cables on the middle shelf */}
        {[-0.45, -0.15, 0.15, 0.45].slice(0, Math.max(0, Math.min(cableCount - 4, 4))).map((x, i) => (
          <mesh
            key={`cable-mid-${i}`}
            position={[x, 0.05, 0]}
            userData={{
              interactable: true,
              label: '[P] Pick up cable',
              onSecondaryAction: () => {
                const id = `cable-${Date.now()}`
                const color = i % 2 === 0 ? '#33cc33' : '#ff9900'
                NetworkStore.spawnCable({ id, color, status: 'coiled', endpointA: null, endpointB: null, spawnPosition: pos })
                NetworkStore.pickUpCable(id)
                setCableCount(c => c - 1)
              }
            }}
          >
            <cylinderGeometry args={[0.06, 0.06, 0.1, 16]} />
            <meshStandardMaterial color={i % 2 === 0 ? '#33cc33' : '#ff9900'} />
          </mesh>
        ))}
        {/* Render remaining cables on the top shelf */}
        {[-0.45, -0.15, 0.15, 0.45].slice(0, Math.max(0, cableCount - 8)).map((x, i) => (
          <mesh
            key={`cable-top-${i}`}
            position={[x, 0.55, 0]}
            userData={{
              interactable: true,
              label: '[P] Pick up cable',
              onSecondaryAction: () => {
                const id = `cable-${Date.now()}`
                const color = i % 2 === 0 ? '#9900ff' : '#666666'
                NetworkStore.spawnCable({ id, color, status: 'coiled', endpointA: null, endpointB: null, spawnPosition: pos })
                NetworkStore.pickUpCable(id)
                setCableCount(c => c - 1)
              }
            }}
          >
            <cylinderGeometry args={[0.06, 0.06, 0.1, 16]} />
            <meshStandardMaterial color={i % 2 === 0 ? '#9900ff' : '#666666'} />
          </mesh>
        ))}
      </group>

      <Billboard follow lockX={false} lockY={false} lockZ={false}>
        <group position={[0, 1.2, 0]}>
          <mesh>
            <planeGeometry args={[1.0, 0.2]} />
            <meshBasicMaterial color="#000c18" transparent opacity={0.75} depthWrite={false} />
          </mesh>
          <Text position={[0,0,0.01]} fontSize={0.08} color="#00ff88" anchorX="center" anchorY="middle">CABLE STORAGE</Text>
        </group>
      </Billboard>
    </group>
  )
}

/* ============================================================
   ROUTER
   ============================================================ */
function Router({ pos, id='Router1' }: { pos:[number,number,number]; id?:string }) {
  const blinkRef = useRef<THREE.MeshStandardMaterial>(
    new THREE.MeshStandardMaterial({ color:'#ffaa00', emissive:'#cc8800', emissiveIntensity:3, roughness:0.1 })
  )
  useFrame(({ clock }) => {
    blinkRef.current.emissiveIntensity = Math.sin(clock.getElapsedTime()*3.7) > 0 ? 4 : 0.1
  })

  return (
    <group
      position={pos}
      userData={{
        interactable: true,
        deviceId: id,
        label: `[P] Pick up ${id} | [E] Open CLI`,
        onInteract: () => {
          console.log(`[NetLab] Opening CLI for ${id}`)
          window.dispatchEvent(new CustomEvent('netlab:openCLI', { detail: { deviceId: id } }))
        },
        onSecondaryAction: () => {
          NetworkStore.pickUpDevice(id)
        },
      }}
    >
      {/* Hit area clear of front ports */}
      <mesh position={[0, 0, -0.05]}>
        <boxGeometry args={[0.52, 0.18, 0.28]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {/* Chassis */}
      <mesh receiveShadow castShadow material={MAT_ROUTER}>
        <boxGeometry args={[0.46, 0.044, 0.3]} />
      </mesh>

      {/* Front bezel */}
      <mesh position={[0, 0, 0.15]} material={MAT_ROUTER}>
        <boxGeometry args={[0.46, 0.044, 0.006]} />
      </mesh>

      {/* Ventilation slots (right side) */}
      {[0.08,0.04,0,-0.04,-0.08].map((z,i)=>(
        <mesh key={i} position={[0.22, 0, z]} material={MAT_RACK_TRIM}>
          <boxGeometry args={[0.008, 0.028, 0.018]} />
        </mesh>
      ))}

      {/* Port LEDs */}
      {([-0.1,-0.05,0,0.05,0.1] as number[]).map((x,i)=>(
        <Led key={i} pos={[x, 0.024, 0.153]}
             mat={i<3 ? MAT_LED_G : i===3 ? MAT_LED_B : MAT_LED_A} />
      ))}

      {/* Activity LED */}
      <mesh position={[0.2, 0.024, 0.153]} material={blinkRef.current}>
        <sphereGeometry args={[0.012, 6, 6]} />
      </mesh>

      {/* Console port dot */}
      <mesh position={[-0.2, 0, 0.153]} material={MAT_RACK_TRIM}>
        <cylinderGeometry args={[0.007,0.007,0.01,8]} />
      </mesh>

      <DeviceLabel id={id} type="Cisco Router" height={0.08} color="#80c8ff" />

      {/* Dynamic Ports */}
      <DynamicPort portId={`${id}_GigabitEthernet0_0`} pos={[-0.1, 0.024, 0.153]} label="Gi0/0" />
      <DynamicPort portId={`${id}_GigabitEthernet0_1`} pos={[-0.05, 0.024, 0.153]} label="Gi0/1" />
      <DynamicPort portId={`${id}_GigabitEthernet0_2`} pos={[0, 0.024, 0.153]} label="Gi0/2" />
      <DynamicPort portId={`${id}_GigabitEthernet0_3`} pos={[0.05, 0.024, 0.153]} label="Gi0/3" />
      <DynamicPort portId={`${id}_GigabitEthernet0_4`} pos={[0.1, 0.024, 0.153]} label="Gi0/4" />
      <DynamicPort portId={`${id}_CON`} pos={[-0.2, 0, 0.153]} type="console" label="Console" />
    </group>
  )
}

/* ============================================================
   SWITCH
   ============================================================ */
function Switch({ pos, id='Switch1' }:
  { pos:[number,number,number]; id?:string }) {

  const { ports: allPorts } = useNetworkStore()
  const switchPorts = Array.from(allPorts.values()).filter(p => p.deviceId === id && p.portType === 'ethernet')
  // We want to visually display 24 ports even if unconfigured, or exactly what's configured
  // For an 8-port switch, we'll force portsCount to 8 for the LED display
  const portsCount = Math.max(switchPorts.length, 8)

  // Staggered blink simulation per-port
  const ledRefs  = useRef<THREE.MeshStandardMaterial[]>([])

  useMemo(() => {
    ledRefs.current = Array.from({length: portsCount}, (_,i)=> {
      const mat = new THREE.MeshStandardMaterial({
        color:'#00ff88', emissive:'#00cc55', emissiveIntensity: i<5 ? 3.5 : 0.05, roughness:0.1
      })
      return mat
    })
  }, [portsCount])

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime()
    // Randomly blink active ports
    ledRefs.current.forEach((mat,i) => {
      if (i < 5) {
        mat.emissiveIntensity = Math.sin(t*4 + i*1.3) > 0.6 ? 0.2 : 3.5
      }
    })
  })

  return (
    <group
      position={pos}
      userData={{
        interactable: true,
        deviceId: id,
        label: `[P] Pick up ${id} | [E] Open CLI`,
        onInteract: () => {
          console.log(`[NetLab] Opening CLI for ${id}`)
          window.dispatchEvent(new CustomEvent('netlab:openCLI', { detail: { deviceId: id } }))
        },
        onSecondaryAction: () => {
          NetworkStore.pickUpDevice(id)
        },
      }}
    >
      {/* Hit area */}
      <mesh>
        <boxGeometry args={[0.46, 0.06, 0.3]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {/* Chassis */}
      <mesh receiveShadow castShadow material={MAT_SWITCH}>
        <boxGeometry args={[0.46, 0.044, 0.3]} />
      </mesh>

      {/* Front bezel */}
      <mesh position={[0, 0, 0.15]} material={MAT_SWITCH}>
        <boxGeometry args={[0.46, 0.044, 0.006]} />
      </mesh>

      {/* Port LEDs (single-row 8 ports) */}
      {ledRefs.current.slice(0, 8).map((mat, i) => {
        const xPos = -0.17 + (i * 0.04)
        const yPos = 0.015
        return (
          <Led key={i}
               pos={[xPos, yPos, 0.153]}
               mat={mat} />
        )
      })}

      {/* Power LED */}
      <Led pos={[0.21, 0.025, 0.153]} mat={MAT_LED_G} />

      <DeviceLabel id={id} type="8-Port Managed Switch" height={0.07} color="#80ffb0" />

      {/* Dynamic Ports (map over actual ports from store) */}
      <SwitchDynamicPorts id={id} switchPorts={switchPorts} />
    </group>
  )
}

function SwitchDynamicPorts({ id, switchPorts }: { id: string, switchPorts: any[] }) {
  const sortedPorts = [...switchPorts].sort((a, b) => a.id.localeCompare(b.id))

  return (
    <>
      {sortedPorts.map((port, i) => {
        let xPos = 0
        let yPos = 0
        let label = ''

        if (port.id.includes('FastEthernet')) {
          const match = port.id.match(/FastEthernet0_(\d+)/)
          const portNum = match ? parseInt(match[1]) : i + 1
          const idx = portNum - 1 // 0-7
          
          if (idx >= 8) return null
          xPos = -0.17 + idx * 0.04
          yPos = 0.015
          label = `Fa0/${portNum}`
        } else {
          return null
        }

        return <DynamicPort key={port.id} portId={port.id} pos={[xPos, yPos, 0.153]} label={label} />
      })}
    </>
  )
}

/* ============================================================
   PC WORKSTATION
   ============================================================ */
function PC({ pos, id='PC1', screenColor='#00dcff' }:
  { pos:[number,number,number]; id?:string; screenColor?:string }) {

  const screenMat = useMemo(() => m({
    color: screenColor,
    emissive: screenColor,
    emissiveIntensity: 1.6,
    roughness: 0.05,
    metalness: 0,
    transparent: true,
    opacity: 0.9,
  }), [screenColor])

  return (
    <group
      position={pos}
      userData={{
        interactable: true,
        deviceId: id,
        label: `[P] Pick up ${id} | [E] Open Terminal`,
        onInteract: () => {
          console.log(`[NetLab] Opening Terminal for ${id}`)
          window.dispatchEvent(new CustomEvent('netlab:openCLI', { detail: { deviceId: id } }))
        },
        onSecondaryAction: () => {
          NetworkStore.pickUpDevice(id)
        },
      }}
    >
      {/* Hit area covers tower + monitor but stays clear of back ports */}
      <mesh position={[0, 0.35, -0.35]}>
        <boxGeometry args={[0.5, 0.9, 0.35]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {/* Tower */}
      <group position={[0.15, 0, 0]}>
        <mesh position={[0, 0.22, 0]} receiveShadow castShadow material={MAT_PC}>
          <boxGeometry args={[0.13, 0.42, 0.34]} />
        </mesh>
        {/* CD/DVD slot */}
        <mesh position={[0, 0.31, 0.171]} material={MAT_RACK_TRIM}>
          <boxGeometry args={[0.09, 0.018, 0.002]} />
        </mesh>
        {/* USB ports */}
        <mesh position={[0.02, 0.22, 0.171]} material={MAT_RACK_TRIM}>
          <boxGeometry args={[0.015, 0.01, 0.002]} />
        </mesh>
        <mesh position={[-0.02, 0.22, 0.171]} material={MAT_RACK_TRIM}>
          <boxGeometry args={[0.015, 0.01, 0.002]} />
        </mesh>
        {/* Power button */}
        <mesh position={[0.04, 0.34, 0.171]}>
          <cylinderGeometry args={[0.006,0.006,0.004,12]} />
          <meshStandardMaterial color="#00ff88" emissive="#00cc55" emissiveIntensity={3} />
        </mesh>
        <Led pos={[0.04, 0.30, 0.171]} mat={MAT_LED_G} />
      </group>

      {/* Monitor — base */}
      <mesh position={[0, 0.015, -0.22]} receiveShadow material={MAT_PC}>
        <boxGeometry args={[0.2, 0.025, 0.2]} />
      </mesh>
      {/* Stand neck */}
      <mesh position={[0, 0.25, -0.32]} material={MAT_PC}>
        <boxGeometry args={[0.025, 0.44, 0.025]} />
      </mesh>
      {/* Bezel */}
      <mesh position={[0, 0.55, -0.32]} receiveShadow castShadow material={MAT_MONITOR}>
        <boxGeometry args={[0.40, 0.28, 0.022]} />
      </mesh>
      {/* Screen */}
      <mesh position={[0, 0.55, -0.307]} material={screenMat}>
        <boxGeometry args={[0.36, 0.24, 0.001]} />
      </mesh>
      {/* Power LED on bezel */}
      <Led pos={[0.17, 0.42, -0.308]} mat={MAT_LED_B} />

      <DeviceLabel id={id} type="Workstation" height={0.88} color="#00dcff" />

      {/* PC Ethernet Ports (Front Panel) */}
      <DynamicPort portId={`${id}_Ethernet0`} pos={[0.12, 0.10, 0.175]} label="Eth0" />
      <DynamicPort portId={`${id}_Ethernet1`} pos={[0.18, 0.10, 0.175]} label="Eth1" />
    </group>
  )
}




/* ============================================================
   FLOOR GRID
   ============================================================ */
function FloorGrid() {
  return (
    <mesh rotation={[-Math.PI/2, 0, 0]} position={[0, 0.001, 0]}>
      <planeGeometry args={[ROOM_W, ROOM_D, Math.floor(ROOM_W), Math.floor(ROOM_D)]} />
      <primitive object={MAT_GRID} attach="material" />
    </mesh>
  )
}

/* ============================================================
   WALL PANEL
   ============================================================ */
function Wall({ pos, rot, w, h }: {
  pos:[number,number,number]; rot:[number,number,number]; w:number; h:number }) {
  return (
    <group position={pos} rotation={new THREE.Euler(...rot)}>
      <mesh receiveShadow material={MAT_WALL}>
        <boxGeometry args={[w, h, WALL_T]} />
      </mesh>
      {/* Baseboard */}
      <mesh position={[0, -h/2+0.05, WALL_T/2+0.002]} material={MAT_RACK_TRIM}>
        <boxGeometry args={[w, 0.10, 0.01]} />
      </mesh>
      {/* Dado rail */}
      <mesh position={[0, -h/2+0.9, WALL_T/2+0.002]} material={MAT_RACK_TRIM}>
        <boxGeometry args={[w, 0.025, 0.006]} />
      </mesh>
    </group>
  )
}

/* ============================================================
   CEILING LIGHT FIXTURE
   ============================================================ */
function CeilLight({ x, z }: { x:number; z:number }) {
  return (
    <group position={[x, ROOM_H-0.01, z]}>
      {/* Housing */}
      <mesh material={MAT_RACK_TRIM}>
        <boxGeometry args={[0.15, 0.04, 1.8]} />
      </mesh>
      {/* Diffuser */}
      <mesh position={[0,-0.028,0]}>
        <boxGeometry args={[0.13, 0.005, 1.75]} />
        <meshStandardMaterial color="#ffffff" emissive="#c8e0ff" emissiveIntensity={2.2} />
      </mesh>
    </group>
  )
}

/* ============================================================
   FLOOR CABLE TRUNKING
   ============================================================ */
function Trunking({ start, end }: { start:[number,number]; end:[number,number] }) {
  const cx = (start[0]+end[0])/2
  const cz = (start[1]+end[1])/2
  const len = Math.hypot(end[0]-start[0], end[1]-start[1])
  const angle = Math.atan2(end[1]-start[1], end[0]-start[0])
  return (
    <mesh position={[cx,0.008,cz]} rotation={[0,angle,0]} receiveShadow>
      <boxGeometry args={[len, 0.014, 0.065]} />
      <meshStandardMaterial color="#141820" roughness={0.95} />
    </mesh>
  )
}

/* ============================================================
   DYNAMIC PORT COMPONENT
   ============================================================ */
function DynamicPort({ portId, pos, type = 'ethernet', label }: { portId: string; pos: [number, number, number]; type?: 'ethernet'|'console'; label: string }) {
  const meshRef = useRef<THREE.Mesh>(null)
  const { ports, heldCableId } = useNetworkStore()
  const port = ports.get(portId)

  useFrame(() => {
    if (meshRef.current) {
      const wp = new THREE.Vector3()
      meshRef.current.getWorldPosition(wp)
      // Only update if it actually moved significantly to avoid spam
      const current = NetworkStore.getSnapshot().ports.get(portId)?.worldPosition
      if (!current || Math.abs(current[0]-wp.x) > 0.01 || Math.abs(current[2]-wp.z) > 0.01) {
        NetworkStore.updatePortPosition(portId, [wp.x, wp.y, wp.z])
      }
    }
  })

  if (!port) return null

  const isOccupied = !!port.connectedCableId

  let interactLabel = ''
  if (isOccupied) {
    let otherLabel = 'Unknown'
    if (port.connectedCableId) {
      const cable = NetworkStore.getSnapshot().cables.get(port.connectedCableId)
      if (cable) {
        const otherPortId = cable.endpointA === portId ? cable.endpointB : cable.endpointA
        if (otherPortId) {
          otherLabel = NetworkStore.getSnapshot().ports.get(otherPortId)?.label || 'Unknown'
        } else {
          otherLabel = 'Floor' // held by player or coiled
        }
      }
    }
    interactLabel = `[D] Disconnect / Unplug | ${label} — CONNECTED → ${otherLabel}`
  } else {
    interactLabel = `[C] Connect / Plug In | ${label} — AVAILABLE`
  }

  return (
    <group position={pos}>
      <mesh
        ref={meshRef}
        userData={{
          interactable: true,
          label: interactLabel,
          onConnectAction: () => {
            if (isOccupied) {
              window.dispatchEvent(new CustomEvent('netlab:cableevent', {
                detail: { type: 'connect', result: { success: false, message: 'Port already connected.' } },
              }))
              return
            }
            if (port.portType !== 'ethernet') {
              window.dispatchEvent(new CustomEvent('netlab:cableevent', {
                detail: { type: 'connect', result: { success: false, message: 'Invalid connection: incompatible port types.' } },
              }))
              return
            }

            let result
            if (heldCableId) {
              result = NetworkStore.connectCableEnd(portId)
            } else {
              result = NetworkStore.startNewCableConnection(portId)
            }
            window.dispatchEvent(new CustomEvent('netlab:cableevent', {
              detail: { type: 'connect', portId, result },
            }))
          },
          onDisconnectAction: () => {
            if (isOccupied) {
              NetworkStore.disconnectPort(portId)
              window.dispatchEvent(new CustomEvent('netlab:cableevent', {
                detail: { type: 'drop', result: 'Disconnected cable' },
              }))
            }
          }
        }}
      >
        <sphereGeometry args={[0.08, 8, 8]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  )
}

/* ============================================================
   FIREWALL
   ============================================================ */
function Firewall({ pos, id='Firewall1' }: { pos:[number,number,number]; id?:string }) {
  const blinkRef = useRef<THREE.MeshStandardMaterial>(
    new THREE.MeshStandardMaterial({ color:'#ff3333', emissive:'#cc0000', emissiveIntensity:3, roughness:0.1 })
  )
  useFrame(({ clock }) => {
    blinkRef.current.emissiveIntensity = Math.sin(clock.getElapsedTime()*2.5) > 0 ? 4 : 0.1
  })

  return (
    <group
      position={pos}
      userData={{
        interactable: true,
        deviceId: id,
        label: `[P] Pick up ${id} | [E] Open CLI`,
        onInteract: () => {
          console.log(`[NetLab] Opening CLI for ${id}`)
          window.dispatchEvent(new CustomEvent('netlab:openCLI', { detail: { deviceId: id } }))
        },
        onSecondaryAction: () => {
          NetworkStore.pickUpDevice(id)
        },
      }}
    >
      {/* Hit area */}
      <mesh>
        <boxGeometry args={[0.52, 0.18, 0.38]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {/* Chassis */}
      <mesh receiveShadow castShadow material={MAT_FIREWALL}>
        <boxGeometry args={[0.46, 0.088, 0.3]} />
      </mesh>

      {/* Front bezel */}
      <mesh position={[0, 0, 0.15]} material={MAT_FIREWALL}>
        <boxGeometry args={[0.46, 0.088, 0.006]} />
      </mesh>

      {/* Ventilation slots (right side) */}
      {[0.08,0.04,0,-0.04,-0.08].map((z,i)=>(
        <mesh key={i} position={[0.22, 0, z]} material={MAT_RACK_TRIM}>
          <boxGeometry args={[0.008, 0.06, 0.018]} />
        </mesh>
      ))}

      {/* Activity LED */}
      <mesh position={[0.2, 0.024, 0.153]} material={blinkRef.current}>
        <sphereGeometry args={[0.012, 6, 6]} />
      </mesh>

      <DeviceLabel id={id} type="Firewall Appliance" height={0.08} color="#ff6666" />

      {/* Dynamic Ports */}
      <DynamicPort portId={`${id}_Eth1`} pos={[-0.1, 0.024, 0.153]} label="Eth1" />
      <DynamicPort portId={`${id}_Eth2`} pos={[-0.05, 0.024, 0.153]} label="Eth2" />
      <DynamicPort portId={`${id}_CON`} pos={[-0.2, 0, 0.153]} type="console" label="Console" />
    </group>
  )
}

/* ============================================================
   STORAGE
   ============================================================ */
function Storage({ pos, id='Storage1' }: { pos:[number,number,number]; id?:string }) {
  const blinkRef = useRef<THREE.MeshStandardMaterial>(
    new THREE.MeshStandardMaterial({ color:'#0088ff', emissive:'#0055cc', emissiveIntensity:3, roughness:0.1 })
  )
  useFrame(({ clock }) => {
    blinkRef.current.emissiveIntensity = Math.sin(clock.getElapsedTime()*1.5) > 0 ? 3 : 0.1
  })

  return (
    <group
      position={pos}
      userData={{
        interactable: true,
        deviceId: id,
        label: `[P] Pick up ${id} | [E] Open CLI`,
        onInteract: () => {
          console.log(`[NetLab] Opening CLI for ${id}`)
          window.dispatchEvent(new CustomEvent('netlab:openCLI', { detail: { deviceId: id } }))
        },
        onSecondaryAction: () => {
          NetworkStore.pickUpDevice(id)
        },
      }}
    >
      {/* Hit area */}
      <mesh>
        <boxGeometry args={[0.52, 0.28, 0.45]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {/* Chassis */}
      <mesh receiveShadow castShadow material={MAT_STORAGE}>
        <boxGeometry args={[0.46, 0.18, 0.4]} />
      </mesh>

      {/* Drive bays (front) */}
      {[-0.15, -0.05, 0.05, 0.15].map((x, i) => (
        <group key={i} position={[x, 0, 0.20]}>
          <mesh material={MAT_RACK_TRIM}>
            <boxGeometry args={[0.08, 0.16, 0.01]} />
          </mesh>
          <mesh position={[0, 0.06, 0.006]} material={blinkRef.current}>
            <sphereGeometry args={[0.008, 6, 6]} />
          </mesh>
        </group>
      ))}

      <DeviceLabel id={id} type="Storage Array" height={0.12} color="#66aaff" />

      {/* Dynamic Ports */}
      <DynamicPort portId={`${id}_Eth1`} pos={[-0.2, 0.06, -0.2]} label="Eth1" />
      <DynamicPort portId={`${id}_Eth2`} pos={[-0.15, 0.06, -0.2]} label="Eth2" />
    </group>
  )
}

/* ============================================================
   MAIN LAB EXPORT
   ============================================================ */
export default function Lab() {
  const { devices, heldDeviceId, heldCableId } = useNetworkStore()
  const { camera } = useThree()

  // Handle drop on G key
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'KeyG') {
        const dir = new THREE.Vector3()
        camera.getWorldDirection(dir)
        const pos = camera.position.clone().addScaledVector(dir, 1.5)

        if (heldDeviceId) {
          // Clamp to desk height
          NetworkStore.dropDevice([pos.x, 0.775, pos.z])
        } else if (heldCableId) {
          // Drop cable onto desk
          NetworkStore.dropCable([pos.x, 0.78, pos.z])
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [heldDeviceId, heldCableId, camera])

  return (
    <group name="lab">
      {/* ── Floor ─────────────────────────────────────────── */}
      <mesh receiveShadow rotation={[-Math.PI/2,0,0]} material={MAT_FLOOR}>
        <planeGeometry args={[ROOM_W, ROOM_D]} />
      </mesh>
      <FloorGrid />

      {/* ── Ceiling ───────────────────────────────────────── */}
      <mesh rotation={[Math.PI/2,0,0]} position={[0,ROOM_H,0]} material={MAT_CEILING}>
        <planeGeometry args={[ROOM_W, ROOM_D]} />
      </mesh>

      {/* ── Ceiling lights ────────────────────────────────── */}
      {[-4,0,4].map(x => [-3,0,3].map(z => (
        <CeilLight key={`${x}_${z}`} x={x} z={z} />
      )))}

      {/* ── Walls ─────────────────────────────────────────── */}
      <Wall pos={[0, ROOM_H/2, -ROOM_D/2]}  rot={[0,0,0]}           w={ROOM_W} h={ROOM_H} />
      <Wall pos={[0, ROOM_H/2,  ROOM_D/2]}  rot={[0,Math.PI,0]}     w={ROOM_W} h={ROOM_H} />
      <Wall pos={[-ROOM_W/2, ROOM_H/2, 0]}  rot={[0,Math.PI/2,0]}   w={ROOM_D} h={ROOM_H} />
      <Wall pos={[ ROOM_W/2, ROOM_H/2, 0]}  rot={[0,-Math.PI/2,0]}  w={ROOM_D} h={ROOM_H} />

      {/* Server Rack — back-left corner */}
      <ServerRack pos={[-6, 1.2, -7.5]} id="Rack1" />

      {/* Cable Cabinet - left wall */}
      <CableCabinet pos={[-7.5, 1.0, -5]} rot={[0, Math.PI/2, 0]} />

      {/* ── DESKS (Grid Layout) ─────────────────────────── */}
      {[-ROOM_W * 0.25, 0, ROOM_W * 0.25].map(x => 
        [-ROOM_D * 0.1, ROOM_D * 0.25].map(z => (
          <Table key={`desk_${x}_${z}`} pos={[x, 0, z]} w={2.2} d={0.9} />
        ))
      )}

      {/* ── NOTE: Decorative cables removed — CableSystem handles all cables ── */}

      {/* ── FLOOR CABLE TRUNKING (Grid) ─────────────────────────── */}
      {/* Horizontal trunks */}
      {[-ROOM_D * 0.1, ROOM_D * 0.25].map(z => (
         <Trunking key={`htrunk_${z}`} start={[-ROOM_W * 0.25, z]} end={[ROOM_W * 0.25, z]} />
      ))}
      {/* Vertical trunks connecting rows */}
      {[-ROOM_W * 0.25, 0, ROOM_W * 0.25].map(x => (
         <Trunking key={`vtrunk_${x}`} start={[x, -ROOM_D * 0.1]} end={[x, ROOM_D * 0.25]} />
      ))}

      {/* ── ROOM BRANDING ─────────────────────────────────── */}
      <Text
        position={[0, ROOM_H-0.55, -ROOM_D/2+WALL_T+0.03]}
        fontSize={0.28}
        color="#00dcff"
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.006}
        outlineColor="#003355"
        renderOrder={1}
      >
        NETLAB 3D
      </Text>
      <Text
        position={[0, ROOM_H-0.92, -ROOM_D/2+WALL_T+0.03]}
        fontSize={0.10}
        color="#4080a0"
        anchorX="center"
        anchorY="middle"
        renderOrder={1}
      >
        Network & Cyber Security Learning Simulator
      </Text>

      {/* ── DYNAMIC DEVICES ──────────────────────────────── */}
      {devices.map(d => {
        if (d.type === 'Router') return <Router key={d.id} id={d.id} pos={d.position} />
        if (d.type === 'Switch') return <Switch key={d.id} id={d.id} pos={d.position} />
        if (d.type === 'PC') return <PC key={d.id} id={d.id} pos={d.position} />
        if (d.type === 'Firewall') return <Firewall key={d.id} id={d.id} pos={d.position} />
        if (d.type === 'Storage') return <Storage key={d.id} id={d.id} pos={d.position} />
        return null
      })}

    </group>
  )
}
