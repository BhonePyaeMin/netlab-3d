# NetLab 3D — Network & Cyber Security Learning Simulator

> A first-person 3D interactive networking laboratory where you physically walk around, connect cables, configure routers, and learn networking hands-on.

![NetLab 3D](https://img.shields.io/badge/NetLab_3D-v0.2.0-00dcff?style=for-the-badge&labelColor=050508)
![React](https://img.shields.io/badge/React-19-61dafb?style=flat-square&logo=react)
![Three.js](https://img.shields.io/badge/Three.js-r185-black?style=flat-square&logo=threedotjs)
![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178c6?style=flat-square&logo=typescript)
![Vite](https://img.shields.io/badge/Vite-8-646cff?style=flat-square&logo=vite)

---

## Overview

NetLab 3D is a browser-based, first-person 3D educational simulator inspired by network engineering simulation games. Instead of clicking configuration buttons, you **physically** walk through a virtual server room, pick up Ethernet cables, plug them into real ports, open router CLIs, and type Cisco-style commands to configure live network topologies.

---

## Controls

| Key | Action |
|-----|--------|
| **W A S D** | Walk forward / left / back / right |
| **Mouse** | Look around (first-person) |
| **Shift** | Sprint (1.8× speed) |
| **Space** | Jump |
| **E** | Interact with device |
| **ESC** | Release mouse / pause |

> **To start:** Click anywhere on the screen to capture the mouse.

---

## Tech Stack

### Frontend
| Package | Version | Purpose |
|---------|---------|---------|
| React | 19 | UI framework |
| Vite | 8 | Dev server & bundler |
| TypeScript | 6 | Type safety |
| Three.js | r185 | 3D rendering engine |
| @react-three/fiber | 9 | React renderer for Three.js |
| @react-three/drei | 10 | Three.js helpers (Text, Stats, etc.) |

### Backend *(planned Phase 15+)*
| Package | Purpose |
|---------|---------|
| Python / FastAPI | REST API |
| SQLite | User progress & scores |
| Gemini API | AI Tutor (via backend only) |

---

## Project Structure

```
src/
├── hooks/                    # Reusable game hooks
│   ├── useKeyboard.ts        # Keyboard state tracker (ref-based, zero re-renders)
│   └── usePointerLock.ts     # Pointer Lock API manager
│
├── player/                   # First-person player system
│   ├── Player.tsx            # Root player component (assembles all hooks)
│   ├── usePlayerLook.ts      # Mouse → yaw/pitch → camera rotation
│   ├── usePlayerPhysics.ts   # Gravity, jump, WASD movement, wall collision
│   └── useInteractionRay.ts  # Crosshair raycast + E-key interaction
│
├── scene/                    # 3D world
│   ├── Lab.tsx               # Full server room geometry + devices
│   └── Lighting.tsx          # Cinematic lighting rig (ambient + shadows + glows)
│
├── components/               # 2D HUD overlays
│   ├── HUD.tsx               # Mission panel, objectives, crosshair, status bar
│   ├── InteractionPrompt.tsx # [E] Open Router CLI badge
│   └── PointerLockOverlay.tsx# Click-to-play screen
│
├── App.tsx                   # Root: Canvas + overlays wired together
├── main.tsx                  # React 18 createRoot entry point
└── index.css                 # Global dark design system (CSS vars)
```

---

## Getting Started

### Prerequisites
- Node.js 18+ 
- npm 9+

### Install

```bash
cd "3D Network & Cyber Security Simulator"
npm install
```

## How to Run

```bash
"C:\Users\66877\Desktop\3D Network "
" Cyber Security Simulator"
npm run dev
# or: node .\node_modules\vite\bin\vite.js
```

Open in Browser: The server starts on http://localhost:5173/, which you can now interact with!

## Localhost Check

The localhost port can change if 5173 is in use, so check what your localhost URL is in the terminal output.

### Type Check

```powershell
powershell -Command "Set-Location 'C:\Users\66877\Desktop\3D Network & Cyber Security Simulator'; node .\node_modules\typescript\bin\tsc -b --noEmit"
```

---

## Core Simulation Milestone (End-to-End Ping)

The primary goal for the simulation engine is to support a complete, realistic packet journey.

### CLI Configuration Flow

```text
User types command
        ↓
CLI parser
        ↓
Validate command
        ↓
Modify internal Router object
        ↓
Return simulated IOS output
```

The underlying network interfaces are driven by the following configuration state:

```typescript
interface InterfaceConfig {
    name: string;
    ipAddress?: string;
    subnetMask?: string;
    adminStatus: "up" | "down";
    protocolStatus: "up" | "down";
    description?: string;
}
```

This allows the simulator to support realistic Cisco IOS configuration:

```text
R1(config)# interface g0/0
R1(config-if)# ip address 192.168.10.1 255.255.255.0
R1(config-if)# no shutdown
```

### Packet Propagation & Ping

This is the big milestone. You should eventually be able to do:

```text
PC1> ping 192.168.20.10
```

and have the simulator calculate whether the packet can travel through the topology:

```text
PC1
 ↓
SW1
 ↓
R1
 ↓
R2
 ↓
SW2
 ↓
PC2
```

The simulator checks the following layers sequentially:

```text
Physical connection?
       ↓
Interfaces up?
       ↓
IP configured?
       ↓
Same subnet OR route available?
       ↓
Routing table?
       ↓
Destination reachable?
       ↓
PING SUCCESS
```

Example Output:

```text
PC1> ping 192.168.20.10

Pinging 192.168.20.10...

Reply from 192.168.20.10
Reply from 192.168.20.10
Reply from 192.168.20.10
Reply from 192.168.20.10

Ping statistics:
    Sent = 4
    Received = 4
    Lost = 0
```

---

## Development Phases

| Phase | Status | Description |
|-------|--------|-------------|
| 1 | ✅ Done | Project setup, 3D lab scene, lighting |
| 2 | ✅ Done | First-person player (WASD, mouse, gravity, jump, E-key raycast) |
| 3 | 🔜 Next | Ethernet cable pickup & connect system |
| 4 | 🔜 | Network topology engine (pure TypeScript) |
| 5 | 🔜 | Network device models (Router, Switch, PC, Server) |
| 6 | 🔜 | Cisco-style CLI terminal (safe internal parser — no shell execution) |
| 7 | 🔜 | IP configuration (IPv4, subnets, wildcard masks) |
| 8 | 🔜 | Simulated ping |
| 9 | 🔜 | Mission system |
| 10 | 🔜 | OSPF Area 0 simulation |
| 11 | 🔜 | Scoring & troubleshooting |
| 12 | 🔜 | VLAN / DHCP / NAT |
| 13 | 🔜 | Cybersecurity missions |
| 14 | 🔜 | AI Tutor (Gemini API via FastAPI backend) |
| 15 | 🔜 | Backend API + SQLite database |
| 16 | 🔜 | Polish, testing, optimisation |
| 17 | 🔜 | Optional GNS3 integration |

---

## Architecture

```
React (UI)
│
├── Three.js / R3F (3D rendering)
│   ├── Lab.tsx        ← server room geometry
│   ├── Lighting.tsx   ← cinematic light rig
│   └── Player.tsx     ← camera controller
│
├── Game Systems (pure TypeScript — no Three.js dependency)
│   ├── NetworkTopologyEngine   (Phase 4)
│   ├── NetworkSimulationEngine (Phase 4)
│   ├── CLIEngine               (Phase 6)
│   ├── RoutingEngine           (Phase 7)
│   ├── OSPFEngine              (Phase 10)
│   ├── MissionEngine           (Phase 9)
│   └── ValidationEngine        (Phase 9)
│
└── FastAPI (Python backend — Phase 15)
    └── SQLite (user progress)
```

### Network Engine Design

Two engine interfaces are planned so GNS3 can be plugged in later:

```typescript
interface NetworkEngine {
  ping(src: string, dst: string): PingResult
  getTopology(): Topology
  sendCommand(deviceId: string, cmd: string): string
}

class SimulationNetworkEngine implements NetworkEngine { ... }  // built-in (default)
class GNS3NetworkEngine       implements NetworkEngine { ... }  // future
```

---

## Safety Notice

> ⚠️ **This is a safe network SIMULATOR.**

All CLI commands (e.g. `router ospf 1`, `ip address 192.168.1.1 255.255.255.0`) are parsed and executed **entirely within the browser's JavaScript engine** against internal router state objects.

The application **never** uses:
- `child_process` / `exec` / `spawn`
- PowerShell or CMD
- Any real shell command execution

---

## 3D Lab Contents

The virtual lab currently contains:

- 🏢 Full server room (floor, 4 walls, ceiling, fluorescent lighting)
- 🗄️ Server rack with blinking LED indicators
- 📡 Router1 + Router2 (interactable — `[E] Open CLI`)
- 🔀 Switch1 + Switch2 (interactable — `[E] Inspect`)
- 💻 PC1 + PC2 workstations with glowing monitors
- 🔌 Ethernet cable runs (visual, decorative — gameplay cables Phase 3)
- ✨ **NETLAB 3D** branding on the back wall

---

## OSPF Mission (Phase 10 target)

```
PC1 — SW1 — R1 — R2 — SW2 — PC2
```

| Device | Interface | IP |
|--------|-----------|-----|
| R1 | G0/0 | 192.168.10.1/24 |
| R1 | G0/1 | 10.0.0.1/30 |
| R2 | G0/0 | 192.168.20.1/24 |
| R2 | G0/1 | 10.0.0.2/30 |
| PC1 | Eth0 | 192.168.10.10/24 (gw .1) |
| PC2 | Eth0 | 192.168.20.10/24 (gw .1) |

Player goal: configure OSPF Area 0 on both routers so `PC1 ping PC2` succeeds.

---
   
## License

MIT — Educational use encouraged.

---

## Planned GNS3 Features & CLI Commands

Once the internal simulation engine is complete (Stages 4-13), the following Cisco IOS style commands and features will be fully supported directly within the 3D terminal:

### General & Navigation
- `enable` / `disable`
- `configure terminal`
- `exit` / `end`
- `write memory` / `copy running-config startup-config`

### Show Commands (Troubleshooting)
- `show ip interface brief`
- `show interface [name]`
- `show ip route`
- `show ip ospf neighbor`
- `show mac address-table`
- `show arp`
- `show running-config`

### Interface Configuration
- `interface [name]` (e.g. `interface GigabitEthernet0/0`)
- `ip address [ip] [mask]`
- `no shutdown` / `shutdown`
- `description [text]`

### Routing & Protocol Configuration (OSPF)
- `router ospf [process-id]`
- `network [ip] [wildcard-mask] area [area-id]`
- `passive-interface [name]`
- `ip route [dest] [mask] [next-hop]` (Static routing)

### Switching & VLANs
- `vlan [id]`
- `switchport mode access`
- `switchport access vlan [id]`
- `switchport mode trunk`

### Security & Services
- `ip nat inside` / `ip nat outside`
- `access-list [id] permit/deny [source] [wildcard]`
- DHCP pool configurations

### Utilities (Exec mode)
- `ping [ip]`
- `traceroute [ip]`

---

*Built with Three.js, React, and a passion for networking education.*
