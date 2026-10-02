# NetLab 3D — Network & Cyber Security Learning Simulator

> A first-person 3D interactive networking laboratory where you physically walk around, connect cables, configure routers, and learn networking hands-on.

![NetLab 3D](https://img.shields.io/badge/NetLab_3D-v0.5.0-00dcff?style=for-the-badge&labelColor=050508)
![React](https://img.shields.io/badge/React-19-61dafb?style=flat-square&logo=react)
![Three.js](https://img.shields.io/badge/Three.js-r185-black?style=flat-square&logo=threedotjs)
![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178c6?style=flat-square&logo=typescript)
![Vite](https://img.shields.io/badge/Vite-8-646cff?style=flat-square&logo=vite)

### ▶ [Play it live — bhonepyaemin.com/netlab](https://bhonepyaemin.com/netlab/)

Click to enter the lab, walk with `W A S D`, look at a router or switch and press `E`
to open its console — a MacBook Pro opens on the desk in the scene and the keys press
as you type, in sync with the output on its display. `F4` cycles the camera between the over-the-shoulder and screen-on
shots; the **2D console** button drops back to a flat terminal window; `Esc` stands
back up. Deployed automatically from `main` by
[.github/workflows/deploy.yml](.github/workflows/deploy.yml).

---

## Overview

NetLab 3D is a browser-based, first-person 3D educational simulator inspired by network engineering simulation games. Instead of clicking configuration buttons, you **physically** walk through a virtual server room, pick up Ethernet cables, plug them into real ports, open router CLIs, and type Cisco-style commands to configure live network topologies.

---

## Controls

**Walking around the lab**

| Key | Action |
|-----|--------|
| **W A S D** | Walk forward / left / back / right |
| **Mouse** | Look around (first-person) |
| **Shift** | Sprint (1.8× speed) |
| **Space** | Jump |
| **E** | Aim at a device and open its console |
| **P** | Pick up a cable or device |
| **C** | Connect the cable to the port you are aiming at (auto-generates a cable if you hold none) |
| **X / D** | Disconnect / unplug a cable from a port |
| **G** | Drop the held cable or device |
| **Ctrl** | Free the mouse — needed to click the toolbar and panels. Press again (or click the scene) to look around again |
| **Esc** | Release the mouse / close the console |

**Inside a console** (after pressing `E` on a device)

| Key | Action |
|-----|--------|
| **Enter** | Run the command |
| **↑ / ↓** | Recall earlier commands on *this* device (kept across refreshes) |
| **Tab** / **?** | Complete the command / context help |
| **Ctrl+C** / **Ctrl+L** | Abandon the line / clear the screen |
| **F4** | Cycle the 3D camera shot (over-the-shoulder ↔ screen-on) |
| **F2** | Toggle the side panes (2D window) |
| **Esc** | Close the console — its screen is remembered |

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
├── engine/                          # Phase 4 — pure-TS topology layer (no Three.js)
│   └── NetworkTopologyEngine.ts     # getTopology() / getNeighbors() / isPathPossible() / isSameBroadcastDomain()
│
├── hooks/                           # Reusable game hooks
│   ├── useKeyboard.ts               # Keyboard state tracker (ref-based, zero re-renders)
│   └── usePointerLock.ts            # Pointer Lock API manager
│
├── network/                         # Network data & state
│   ├── types.ts                     # Core types: Port, Cable, Link, CapturedPacket …
│   ├── NetworkStore.ts              # Singleton reactive store (ports/cables/links/devices)
│   ├── useNetworkStore.ts           # React hook (useSyncExternalStore)
│   ├── SecurityEventBus.ts          # IDS alert bus (keeps history while the IDS window is closed)
│   ├── useSecurity.ts               # Hooks: IDS log, unread badge, missions
│   │
│   └── engine/                      # Phase 5 — pure-TS simulation engine (no Three.js)
│       ├── DeviceTypes.ts           # Enums: DeviceType, PortType, InterfaceType …
│       ├── InterfaceConfig.ts       # README-spec InterfaceConfig + toInterfaceConfig()
│       ├── NetworkInterface.ts      # Logical interface model (IP, MAC, adminStatus …)
│       ├── PhysicalPort.ts          # Physical chassis port (RJ-45 socket)
│       ├── NetworkDevice.ts         # Abstract base class for all devices
│       ├── Devices.ts               # Router / Layer2Switch / PC / Server classes
│       ├── SimulationNetworkEngine.ts # Engine: connect/disconnect cables, route frames, analytic ping
│       ├── CLIEngine.ts             # Cisco IOS + VPCS CLI parser & session manager
│       ├── globalEngine.ts          # Singleton engine + initTopology() (default lab) + spawnDeviceToEngine()
│       ├── MissionEngine.ts         # Security + routing missions, objectives, live progress checks
│       ├── ScenarioManager.ts       # Troubleshooting labs (inject a fault → fix it → Check Solution)
│       ├── ChallengeHints.ts        # "What do I type next?" — progress-aware hints per mission/lab
│       ├── LabReset.ts              # Unplug + factory-reset helpers used by missions/labs/reset
│       ├── LabPersistence.ts        # Autosave/restore of device configs + cabling (localStorage)
│       ├── IPMath.ts                # Subnet math utilities
│       ├── ReconEngine.ts           # nmap-style scanning
│       ├── OSPFProcess.ts           # OSPF Area 0 simulation (hello, adjacency, LSA flooding, SPF)
│       ├── RIPProcess.ts            # RIP v2 simulation
│       ├── DHCPServer.ts / DHCPClient.ts
│       ├── DNSServer.ts  / DNSClient.ts
│       ├── ACLEngine.ts             # Access-control list processing
│       ├── NATProcess.ts            # NAT/PAT translation
│       ├── VPCSPersistence.ts       # `save` on a PC
│       └── SimulationLink.ts        # Physical link between two ports
│
├── terminal/                        # The console (shared by the 2D window and the 3D MacBook)
│   ├── TerminalSession.ts           # One record per device: scrollback, ↑ history, draft line; `hint`/`history`/`sessions`
│   ├── keyHandler.ts                # One keyboard contract for both presentations
│   ├── ansi.ts · highlight.ts · banner.ts · theme.ts · hexdump.ts
│   └── terminal.css
│
├── player/                          # First-person player system
│   ├── Player.tsx                   # Root player component (assembles all hooks)
│   ├── usePlayerLook.ts             # Mouse → yaw/pitch → camera rotation
│   ├── usePlayerPhysics.ts          # Gravity, jump, WASD movement, wall collision
│   └── useInteractionRay.ts         # Crosshair raycast + E/P/C/X key interactions
│
├── scene/                           # 3D world components
│   ├── Lab.tsx                      # Server room geometry, device meshes, DynamicPort
│   ├── CableSystem.tsx              # Cable coils, bezier tube mesh, port highlights
│   ├── ConsoleStation.tsx           # MacBook Pro sit-down console experience
│   ├── macbook/                     # MacBookPro model, screen texture, key layout
│   ├── CameraDirector.ts            # F4 camera shots
│   ├── PacketAnimator.tsx           # Animated packet trace along cable paths
│   ├── Lighting.tsx                 # Cinematic lighting rig
│   └── PlayerController.tsx         # In-scene player mesh / held-item rendering
│
├── components/                      # 2D HUD overlays
│   ├── HUD.tsx                      # Docked left/right rails, objectives, crosshair, toolbar
│   ├── MissionsHUD.tsx              # Mission tracker (objectives, steps, 💡 hints) + mission picker
│   ├── SecurityHUD.tsx              # Intrusion Detection System (IDS) alert window
│   ├── EventLogHUD.tsx              # Live network event log
│   ├── CableHUD.tsx                 # Held-cable indicator + toasts
│   ├── InteractionPrompt.tsx        # Context-sensitive [E]/[C]/[X] badge
│   ├── TerminalOverlay.tsx          # Flat 2D terminal window
│   ├── TerminalScreen.tsx           # Console UI: device tabs, hint strip, map/devices panes
│   ├── MapDiagram.tsx               # Clickable topology map inside the console
│   ├── PacketSnifferHUD.tsx         # Wireshark-style packet capture panel
│   ├── PacketAnimationHUD.tsx       # Step-through packet trace playback
│   ├── TopologyEditorHUD.tsx        # Visual topology diagram editor
│   ├── ProjectMenuHUD.tsx           # Save / load topology projects
│   ├── PointerLockOverlay.tsx       # Click-to-play start screen
│   ├── useActiveHint.ts             # Hook: hint for the running mission/lab
│   └── hudStyle.ts                  # Shared HUD panel style
│
├── store/
│   └── SettingsStore.ts             # Key-binding & display preferences
│
├── App.tsx                          # Root: Canvas + overlays wired together
├── main.tsx                         # React 19 createRoot entry point + lab autosave start
└── index.css                        # Global dark design system (CSS vars)

test-*.test.ts                       # Root-level suites: missions, scenarios, OSPF + hints, persistence
```

---

## Getting Started

### Prerequisites
- [Node.js 18+](https://nodejs.org/)
- npm 9+
- Git

---

## How to Run (Step by Step)

### Step 1 — Open a Terminal

Open your terminal or command prompt and navigate to the project folder:

```bash
cd "path/to/netlab-3d"
```

### Step 2 — Install Dependencies

> ⚠️ Only needed the **first time** (or after pulling new changes).

```bash
npm install
```

### Step 3 — Start the Dev Server

```bash
npm run dev # (can run this on windows or powershell)
```

Expected output:

```
  VITE v8.x.x  ready in ~600 ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose
```

### Step 4 — Open in Browser

Go to **http://localhost:5173/** in your browser.

> 💡 If port `5173` is already in use, Vite will automatically pick the next available port (e.g. `5174`). Always check the terminal output for the exact URL.

### Step 5 — Stop the Server

Press **`Ctrl + C`** in the terminal to stop the dev server.

### Type Check, Tests & Build

```bash
npm run typecheck   # tsc -b --noEmit
npm test            # vitest (single run)
npm run build       # production bundle in dist/
npm run lint        # oxlint
```

Run one suite: `npx vitest run test-missions.test.ts`. The root-level `test-*.test.ts` files cover the missions, labs, OSPF, hints and persistence. A few older suites under `src/network/engine/__tests__/` currently fail to *import* (a circular import in the engine) — that is a known issue, not something you broke.

> 💡 The dev server keeps working through a refresh: your device configs, cabling and console history are autosaved in the browser (see **Consoles & autosave** below).

---

## Playing the Lab (Step by Step)

### Quick start — your first 5 minutes

1. Run `npm run dev`, open the URL and **click** to enter the lab.
2. The lab **boots pre-configured**: every device already has its IP address and both routers have static routes. The only thing missing is the **cabling**.
3. Wire `PC1 → Router1 → Router2 → PC2` (3 cables):
   1. Aim at a coiled cable on a desk and press **P**.
   2. Aim at **PC1**'s `Ethernet0` port until it glows and press **C**; then aim at **Router1**'s `GigabitEthernet0/0` and press **C**.
   3. Pick up a second cable: **Router1** `GigabitEthernet0/1` ↔ **Router2** `GigabitEthernet0/1`.
   4. Third cable: **Router2** `GigabitEthernet0/0` ↔ **PC2** `Ethernet0`.
4. Aim at **PC1** and press **E**. Type `ping 192.168.20.10` — four replies mean packets crossed the whole lab.
5. Press **Esc**, then **Ctrl** (free mouse) and click **🎯 Missions** to start a guided mission.

### The HUD

Two docked columns — **left**: mission tracker + mission list; **right**: objectives, cable links and the network event log — plus a toolbar along the bottom. Panels share the height and scroll instead of overlapping; below 1100px wide everything folds into one right-hand column.

> **Clicking the HUD:** the mouse is captured while you walk. Press **Ctrl** to free it, click what you need, then press **Ctrl** again (or click the scene) to look around again.

| Toolbar button | What it does |
|----------------|--------------|
| 🔎 Sniffer | Capture packets on a cable |
| 🛡️ IDS | Intrusion-detection alerts (red badge = unread alerts) |
| 🎬 Playback | Step through a packet's journey hop by hop |
| 🎯 Missions | Guided missions + troubleshooting labs (gold dot = one is running) |
| 📜 Log | Show / hide the network event log |
| 📁 Project · 🗺️ Editor | Save/load the lab · edit the topology |

### Missions

Starting a mission **wires the lab for it** (your cables are put away first) and shows its numbered steps in the tracker. Objectives tick themselves off as you make progress; only IDS alerts raised *after* you start count.

**Security** — **PC2 is the attacker workstation**: only it has `arpspoof` and `macof`; `nmap` works on any PC.

| Mission | Do this | The IDS shows |
|---------|---------|---------------|
| Detect the MITM | On PC2: `arpspoof --target 192.168.10.10 --gateway 192.168.10.1` | **ARP Poison** (critical) |
| Lock the network down | Switch1 → `enable`, `configure terminal`, then on `interface FastEthernet0/1` and `0/2`: `switchport mode access`, `switchport port-security`. Then on PC2: `macof` | **MAC Flood** if unprotected, **Port Security** violation once protected |
| Block traffic with an ACL | Router2 → `access-list 100 deny icmp 192.168.10.0 0.0.0.255 192.168.20.0 0.0.0.255`, `access-list 100 permit ip any any`, `interface GigabitEthernet0/0`, `ip access-group 100 out`. Ping PC2 from PC1 | **ACL Denied** |
| Catch the scanner | On PC2: `nmap 192.168.10.0/24` | **Port Scan** (warning) |

**Routing — Bring up OSPF.** The routers start *without* static routes, so PC1 cannot reach PC2.

| Step | Where | Type |
|------|-------|------|
| 1 | Router1 | `enable`, `configure terminal`, `router ospf 1`, `network 192.168.10.0 0.0.0.255 area 0`, `network 10.0.0.0 0.0.0.3 area 0`, `end` |
| 2 | Router2 | same, with `network 192.168.20.0 0.0.0.255 area 0` and `network 10.0.0.0 0.0.0.3 area 0` |
| 3 | Router1 | `show ip ospf neighbor` — wait ~15 s (hello timer is 10 s) until **FULL**; then `show ip route ospf` |
| 4 | PC1 | `ping 192.168.20.10` |

When it is complete the tracker offers **💥 Break it & fix it**, which loads the *OSPF Neighbours Won't Form* lab.

**Troubleshooting labs** — Wrong Subnet Mask · Shutdown Interface · Wrong Access VLAN · Missing Static Route · OSPF Neighbours Won't Form. Each re-wires the real lab (you can see the cables), injects a fault and shows a numbered walkthrough. Fix it from the device consoles, then click **Check Solution** (or **Show fix** if stuck).

**↺ Reset lab to default** (bottom of the Missions list) unplugs everything, restores the default IP plan and forgets all console history.

### Hints — "what do I type next?"

While a mission or lab is running, the next step is shown in three places and moves on by itself as you make progress:

1. **Mission tracker** → **💡 Hint**: which device, the exact commands, and *why*.
2. **Hint strip** above the console: on the right device every command is a chip — click one to paste it into the prompt, then press **Enter**. On the wrong device it shows **open Router2 ↗** instead.
3. **`hint`** in any console prints the same thing.

Labs only hint at the diagnosis; the fix stays behind **Show fix**.

### Consoles & autosave

Every device keeps its **own console**, like GNS3 windows that stay open in the background.

1. Aim at **Router1**, press **E**, and type your commands (`enable`, `configure terminal`, `interface g0/0` …).
2. Press **Esc**, aim at **PC1**, press **E**, and configure/ping from there — Router1's screen is untouched.
3. Open Router1 again (**E**, or click its chip in the **CONSOLES** strip above the terminal). Its whole screen is back: every command and output, the `Router1#` prompt, your ↑ history and even a half-typed line.
4. **Refresh the page.** Consoles *and* the lab come back: each device's configuration and which ports are cabled together. No `write memory` / `save` is needed. After a refresh you are at the user prompt again, so type `enable`.

Console commands (handled by the console itself, never sent to the device):

| Command | What it does |
|---------|--------------|
| `hint` | Next step of the running mission/lab |
| `history` / `show history` | Numbered list of everything typed on this device |
| `history clear` | Forget this device's command history |
| `sessions` | Devices that have a console on record, with command counts |
| `clear` | Wipe this device's screen (and its saved transcript) |

Not saved: where you dropped a cable on the floor, mission progress, and devices added with the Topology Editor. Everything lives in your browser's localStorage (`netlab:lab:v1`, `netlab:terminal:v1`), so it is per browser and private windows won't keep it.

---

## Core Simulation Milestone (End-to-End Ping)

The primary goal for the simulation engine is to support a complete, realistic packet journey.

### CLI Configuration Flow

```text
User types command
        ↓
CLI parser (CLIEngine.ts)
        ↓
Validate command
        ↓
Modify internal Router / Switch / PC object
        ↓
Return simulated IOS output
```

### Interface State Model

Network interfaces are modelled with the following configuration shape (fully implemented in `src/network/engine/InterfaceConfig.ts`):

```typescript
interface InterfaceConfig {
    name: string;                        // e.g. "GigabitEthernet0/0"
    ipAddress?: string;                  // null if unconfigured
    subnetMask?: string;
    adminStatus: "up" | "down";          // set by operator (no shutdown / shutdown)
    protocolStatus: "up" | "down";       // driven by physical cable connection
    description?: string;
}
```

A connected + `no shutdown` interface reaches **up/up** (both fields `"up"`).  
Disconnecting the cable immediately reverts `protocolStatus` to `"down"`.

This allows the simulator to support realistic Cisco IOS configuration:

```text
R1(config)# interface g0/0
R1(config-if)# ip address 192.168.10.1 255.255.255.0
R1(config-if)# no shutdown
```

### VPCS CLI Commands

The virtual PCs (PC1, PC2) support GNS3 VPCS-style commands:

```text
PC1> ?
?                    Print help
arp                  Show ARP table
clear                Clear screen
help                 Print help
ip                   Show IP configuration
ip <addr> <mask>     Set IP address
ip <addr> <mask> <gw>
                     Set IP address and gateway
nmap <cidr>          Scan subnet for hosts and services
ping <host>          Ping host
route                Show routing table
save                 Save configuration
show ip              Show IP configuration
traceroute <host>    Trace route to host
```

Example usage:
```text
PC1> ip 192.168.10.10 255.255.255.0 192.168.10.1
PC1> save
Configuration saved.
PC1> show ip
NAME        : PC1
IP/MASK     : 192.168.10.10/24
GATEWAY     : 192.168.10.1
MAC         : 00:50:79:66:68:01
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
Physical connection?   ← NetworkTopologyEngine.isPathPossible()
       ↓
Interfaces up?         ← InterfaceConfig.protocolStatus === "up"
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
| 3 | ✅ Done | Ethernet cable pickup & connect system (visual tube mesh, port raycast targets, connect/disconnect flow) |
| 4 | ✅ Done | Network topology engine — `NetworkTopologyEngine` with `getTopology()`, `getNeighbors()`, `isPathPossible()` |
| 5 | ✅ Done | Network device models — Router, Switch, PC, Server with `InterfaceConfig` / `protocolStatus` |
| 6 | ✅ Done | Cisco-style CLI terminal (safe internal parser — no shell execution) |
| 7 | ✅ Done | IP configuration (IPv4, subnets, wildcard masks) — static routes, OSPF, RIP |
| 8 | ✅ Done | Simulated ping (end-to-end packet path via topology engine) |
| 9 | ✅ Done | Mission system (security + routing missions with live objective checks) |
| 10 | ✅ Done | OSPF Area 0 simulation + "Bring up OSPF" mission and break-it-and-fix-it lab |
| 11 | 🟡 Partly | Troubleshooting labs + hints are done; scoring is still to do |
| 12 | ✅ Done | VLAN / DHCP / NAT |
| 13 | ✅ Done | Cybersecurity missions (ARP Spoofing, MAC Flooding, ACL, port scan) + Intrusion Detection System |
| 13b | ✅ Done | Per-device console history, lab autosave, mission hints, docked HUD |
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
│   ├── Lab.tsx           ← server room geometry + DynamicPort raycast targets
│   ├── CableSystem.tsx   ← cable coils, bezier tube mesh, port highlights
│   ├── ConsoleStation.tsx← MacBook Pro sit-down CLI experience
│   ├── Lighting.tsx      ← cinematic light rig
│   └── Player.tsx        ← camera controller + useInteractionRay
│
├── Network State (reactive bridge)
│   └── NetworkStore.ts   ← ports / cables / links; dispatches netlab:interfacestate events
│
└── Game Systems (pure TypeScript — zero Three.js dependency)
    ├── NetworkTopologyEngine   ✅ Phase 4 — getTopology / getNeighbors / isPathPossible
    ├── SimulationNetworkEngine ✅ Phase 4/5 — devices, ports, frame routing
    ├── InterfaceConfig         ✅ Phase 5 — adminStatus / protocolStatus model
    ├── CLIEngine               ✅ Phase 6 — Cisco IOS & VPCS parser
    ├── OSPFProcess             ✅ Phase 10 — engine + "Bring up OSPF" mission
    ├── RIPProcess              ✅ (implemented in engine)
    ├── DHCPServer / DHCPClient ✅ (implemented in engine)
    ├── ACLEngine               ✅ (implemented in engine)
    ├── NATProcess              ✅ (implemented in engine)
    ├── RoutingEngine           🔜 Phase 7
    ├── MissionEngine           ✅ Phase 9 — missions + objectives (ScenarioManager: labs)
    ├── ChallengeHints          ✅ progress-aware hints
    ├── LabPersistence          ✅ autosave/restore of configs + cabling
    ├── SecurityEventBus        ✅ IDS alerts
    └── ValidationEngine        🔜

FastAPI (Python backend — Phase 15)
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

### Topology Engine API (Phase 4 — implemented)

```typescript
import { topologyEngine } from './src/engine/NetworkTopologyEngine'

// Full device + link graph
topologyEngine.getTopology()
// → { devices: DeviceNode[], links: LinkEdge[] }
//   DeviceNode.interfaces[] uses InterfaceConfig with protocolStatus

// Direct neighbours via physical cable
topologyEngine.getNeighbors('PC1')
// → [] (no cable)  |  ['Switch1'] (after connecting)

// BFS physical reachability (no IP knowledge required)
topologyEngine.isPathPossible('PC1', 'Router1')
// → true / false

// Also available in DevTools console:
window.topologyEngine.logTopology()
```

### Interface State Events (Phase 3/5 — implemented)

Every cable connect/disconnect fires a DOM event observable anywhere in the app:

```typescript
window.addEventListener('netlab:interfacestate', (e) => {
  const { event, sides } = (e as CustomEvent).detail
  // event: 'connected' | 'disconnected'
  // sides: [{ deviceId, portId, interface: InterfaceConfig }, ...]
  console.log(event, sides)
})
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
- 🗄️ Server rack (Rack1) — pick up Router / Switch / PC from it
- 📦 Cable cabinet — pick up Ethernet cables from shelves
- 📡 **Router1 + Router2** — interactable (`[E] Open CLI`, `[P] Pick up`)
- 🔀 **Switch1 + Switch2** — interactable (`[E] Open CLI`, `[P] Pick up`)
- 💻 **PC1 + PC2** workstations with glowing monitors (`[E] Open Terminal`)
- 🔌 **Live Ethernet cables** — pick up, walk to a port, press `[C]` to connect
- 🟢 **Port highlights** — glowing rings show connectable ports when holding a cable
- 📊 **Network Event Log** — live feed of cable and interface state changes
- 🖥️ **MacBook Pro console station** — sit-down 3D typing experience
- ✨ **NETLAB 3D** branding on the back wall

---

## Lab Topology & Addressing

```
PC1 — SW1 — R1 — R2 — SW2 — PC2
```

The lab boots with this plan **already configured** (only the cabling is up to you):

| Device | Interface | IP |
|--------|-----------|-----|
| Router1 | G0/0 | 192.168.10.1/24 |
| Router1 | G0/1 | 10.0.0.1/30 |
| Router2 | G0/0 | 192.168.20.1/24 |
| Router2 | G0/1 | 10.0.0.2/30 |
| PC1 | Eth0 | 192.168.10.10/24 (gw 192.168.10.1) |
| PC2 | Eth0 | 192.168.20.10/24 (gw 192.168.20.1) |

Static routes: Router1 → `192.168.20.0/24` via `10.0.0.2`, Router2 → `192.168.10.0/24` via `10.0.0.1`. Switch ports start **administratively down** (unlike a real Catalyst), so a switch port needs `no shutdown`.

Player goal: cable the lab and get `PC1 ping PC2` to succeed with static routes **or** OSPF Area 0 — the full walkthrough is at the bottom of this file, and the guided version is **🎯 Missions → Routing → Bring up OSPF**.

---

## Implemented CLI Commands (Phase 6)

The following Cisco IOS-style commands are fully functional in the in-game terminal:

### General & Navigation
- `enable` / `disable`
- `configure terminal`
- `exit` / `end`
- `write memory` / `copy running-config startup-config`

### Show Commands (Troubleshooting)
- `show ip interface brief`
- `show interface [name]`
- `show ip route`
- `show ip ospf neighbor` / `interface` / `database`
- `show ip route ospf`
- `show port-security` / `show port-security interface [name]`
- `show mac address-table`
- `show arp`
- `show running-config`
- `show version`
- `show access-lists`

### Interface Configuration
- `interface [name]` (e.g. `interface GigabitEthernet0/0`)
- `ip address [ip] [mask]`
- `no shutdown` / `shutdown`
- `description [text]`

### Routing & Protocol Configuration
- `router ospf [process-id]`
- `network [ip] [wildcard-mask] area [area-id]`
- `passive-interface [name]`
- `ip route [dest] [mask] [next-hop]` (Static routing)
- `router rip` / `version 2` / `network [ip]`

### Switching & VLANs
- `vlan [id]`
- `switchport mode access`
- `switchport access vlan [id]`
- `switchport mode trunk`

### Security & Services
- `ip nat inside` / `ip nat outside`
- `access-list [id] permit/deny [source] [wildcard]`
- `ip access-group [acl] in/out` (Interface level)
- `ip dhcp snooping` (Global)
- `ip arp inspection trust` (Interface level)
- `switchport port-security` / `maximum` / `violation` (Interface level)
- DHCP pool configurations

### Utilities (Exec mode)
- `ping [ip]`
- `traceroute [ip]`
- `nmap [cidr]` (PCs — a sweep of 8+ hosts raises a **Port Scan** IDS alert)
- `arpspoof --target [ip] --gateway [ip]` (attacker PC = **PC2** only)
- `macof [count]` (attacker PC = **PC2** only; default 10000 frames)

### Console commands (any device)
- `hint` — next step of the running mission/lab
- `history` / `show history` / `history clear` — commands typed on this device
- `sessions` — devices with a console on record
- `clear` — wipe this device's screen

---

## Full Configuration Walkthrough (Phases A–E)

Topology: `PC1 — SW1 — R1 — R2 — SW2 — PC2` (addresses in [Lab Topology & Addressing](#lab-topology--addressing)).
Complete this guide in order. Each phase depends on the previous one working — don't skip ahead.

> **Good to know**
> - The lab already ships with the IPs and static routes from Phase B/C. Re-typing them is harmless and good practice; if you only want to *check*, use the `show` commands instead.
> - You never need `write memory` / `save` to keep your work — everything is autosaved and survives a refresh. The commands still work (and are the habit to build).
> - After a refresh the console is back at `Router1>`; type `enable` again.
> - Stuck? Start 🎯 Missions and press **💡 Hint**, or type `hint` in any console.

### 📋 Table of Contents
1. [Phase A — Physical Wiring](#phase-a--physical-wiring)
2. [Phase B — Basic Device Configuration](#phase-b--basic-device-configuration)
3. [Phase C — Routing](#phase-c--routing)
4. [Phase D — Ping Test & Verification](#phase-d--ping-test--verification)
5. [Phase E — Security Hardening](#phase-e--security-hardening)
6. [Golden Order Summary](#golden-order-summary)
7. [Troubleshooting Checklist](#troubleshooting-checklist)

---

### Phase A — Physical Wiring

Connect all cables before touching any CLI. Interfaces can't come up without a physical link. (Pick up with **P**, plug each end with **C**.)

| # | From | Port | To | Port |
|---|---|---|---|---|
| 1 | PC1 | Ethernet0 | Switch1 | FastEthernet0/1 |
| 2 | Switch1 | FastEthernet0/2 | Router1 | GigabitEthernet0/0 |
| 3 | Router1 | GigabitEthernet0/1 | Router2 | GigabitEthernet0/1 |
| 4 | Router2 | GigabitEthernet0/0 | Switch2 | FastEthernet0/1 |
| 5 | Switch2 | FastEthernet0/2 | PC2 | Ethernet0 |

> **⚠️ Note:** Do not configure any device until all 5 cables are connected. A quicker lab without switches (3 cables: `PC1—R1`, `R1—R2`, `R2—PC2`) also works and is what the missions use.

---

### Phase B — Basic Device Configuration

Configure devices in this order: PC1 → Switch1 → Router1 → Router2 → Switch2 → PC2. Open each with **E**, leave with **Esc** — every console keeps its own history.

#### 1️⃣ PC1
```text
PC1> ip 192.168.10.10 255.255.255.0 192.168.10.1
PC1> save
Configuration saved.
PC1> ip
NAME        : PC1
IP/MASK     : 192.168.10.10/24
GATEWAY     : 192.168.10.1
MAC         : 00:1A:2B:00:04:33
```

#### 2️⃣ Switch1
Switch ports are **administratively down** until you bring them up.
```text
Switch1> enable
Switch1# configure terminal
Switch1(config)# interface FastEthernet0/1
Switch1(config-if)# switchport mode access
Switch1(config-if)# switchport access vlan 1
Switch1(config-if)# no shutdown
Switch1(config-if)# exit
Switch1(config)# interface FastEthernet0/2
Switch1(config-if)# switchport mode access
Switch1(config-if)# switchport access vlan 1
Switch1(config-if)# no shutdown
Switch1(config-if)# exit
Switch1(config)# end
Switch1# write memory
Building configuration...
[OK]
```

#### 3️⃣ Router1
```text
Router1> enable
Router1# configure terminal

! LAN-facing interface (toward PC1 via Switch1)
Router1(config)# interface GigabitEthernet0/0
Router1(config-if)# ip address 192.168.10.1 255.255.255.0
Router1(config-if)# no shutdown
Router1(config-if)# exit

! WAN-facing interface (toward Router2)
Router1(config)# interface GigabitEthernet0/1
Router1(config-if)# ip address 10.0.0.1 255.255.255.252
Router1(config-if)# no shutdown
Router1(config-if)# exit

Router1(config)# end
Router1# write memory
```

**✅ Verify before continuing:**
```text
Router1# show ip interface brief
Interface              IP-Address      OK? Method Status                Protocol
GigabitEthernet0/0     192.168.10.1    YES unset  up                    up
GigabitEthernet0/1     10.0.0.1        YES unset  up                    up
GigabitEthernet0/2     unassigned      YES unset  administratively down down
```
Both wired interfaces must show `up` / `up`.
- `down` / `down` → cable not connected (go back to Phase A)
- `administratively down` → you forgot `no shutdown`

#### 4️⃣ Router2
```text
Router2> enable
Router2# configure terminal

! LAN-facing interface (toward PC2 via Switch2)
Router2(config)# interface GigabitEthernet0/0
Router2(config-if)# ip address 192.168.20.1 255.255.255.0
Router2(config-if)# no shutdown
Router2(config-if)# exit

! WAN-facing interface (toward Router1)
Router2(config)# interface GigabitEthernet0/1
Router2(config-if)# ip address 10.0.0.2 255.255.255.252
Router2(config-if)# no shutdown
Router2(config-if)# exit

Router2(config)# end
Router2# write memory
```
**✅ Verify:** `show ip interface brief` → both wired interfaces `up` / `up`.

#### 5️⃣ Switch2
```text
Switch2> enable
Switch2# configure terminal
Switch2(config)# interface FastEthernet0/1
Switch2(config-if)# switchport mode access
Switch2(config-if)# switchport access vlan 1
Switch2(config-if)# no shutdown
Switch2(config-if)# exit
Switch2(config)# interface FastEthernet0/2
Switch2(config-if)# switchport mode access
Switch2(config-if)# switchport access vlan 1
Switch2(config-if)# no shutdown
Switch2(config-if)# exit
Switch2(config)# end
Switch2# write memory
```

#### 6️⃣ PC2
```text
PC2> ip 192.168.20.10 255.255.255.0 192.168.20.1
PC2> save
Configuration saved.
```

---

### Phase C — Routing

Only proceed once all wired interfaces on both routers show `up` / `up`. Pick **one** option.

#### Option A — Static routes

**Router1 — route to PC2's subnet**
```text
Router1> enable
Router1# configure terminal
Router1(config)# ip route 192.168.20.0 255.255.255.0 10.0.0.2
Router1(config)# end
Router1# write memory
```

**Router2 — route to PC1's subnet**
```text
Router2> enable
Router2# configure terminal
Router2(config)# ip route 192.168.10.0 255.255.255.0 10.0.0.1
Router2(config)# end
Router2# write memory
```

**✅ Verify on both routers:**
```text
Router1# show ip route
...
C     192.168.10.0/24 is directly connected, GigabitEthernet0/0
C     10.0.0.0/30 is directly connected, GigabitEthernet0/1
S     192.168.20.0/24 [1/1] via 10.0.0.2
```

#### Option B — OSPF Area 0 (dynamic routing)

First **remove the static routes** — a static route (distance 1) always beats OSPF (distance 110), so OSPF would never be used:
```text
Router1(config)# no ip route 192.168.20.0 255.255.255.0 10.0.0.2
Router2(config)# no ip route 192.168.10.0 255.255.255.0 10.0.0.1
```
Then on **Router1**:
```text
Router1(config)# router ospf 1
Router1(config-router)# network 192.168.10.0 0.0.0.255 area 0
Router1(config-router)# network 10.0.0.0 0.0.0.3 area 0
Router1(config-router)# end
```
and on **Router2**:
```text
Router2(config)# router ospf 1
Router2(config-router)# network 192.168.20.0 0.0.0.255 area 0
Router2(config-router)# network 10.0.0.0 0.0.0.3 area 0
Router2(config-router)# end
```
**✅ Verify** (wait ~15 seconds — hellos go out every 10 s):
```text
Router1# show ip ospf neighbor       ← state must read FULL
Router1# show ip route ospf          ← the remote LAN appears with an O code
```
No neighbour? Both ends of the link must use the **same area** (and the same hello/dead timers and subnet). The *OSPF Neighbours Won't Form* lab practises exactly this.

---

### Phase D — Ping Test & Verification

Test from PC1 first (farthest point from the newly added route):
```text
PC1> ping 192.168.20.10
84 bytes from 192.168.20.10 icmp_seq=1 ttl=64 time=3.000 ms
84 bytes from 192.168.20.10 icmp_seq=2 ttl=64 time=3.000 ms
84 bytes from 192.168.20.10 icmp_seq=3 ttl=64 time=3.000 ms
84 bytes from 192.168.20.10 icmp_seq=4 ttl=64 time=3.000 ms
```
A failure prints `192.168.20.10 icmp_seq=1 timeout` (no reply) or `% Destination host unreachable` (no route / not on-subnet).

Then confirm the reverse direction:
```text
PC2> ping 192.168.10.10
```

If it fails, debug in this exact order:
1. `show ip interface brief` on every device — any interface down? → fix Phase A/B (don't forget `no shutdown` on the switch ports).
2. `show ip route` on both routers — is the route present with the correct next hop?
3. `ip` on both PCs — correct address, mask and gateway?
Only after 1–3 pass, re-run ping.

**✅ Once both directions succeed** you have a known-good baseline before adding any security configuration. (It is autosaved; `write memory` / `save` are optional habits.)

---

### Phase E — Security Hardening

Security config goes on switches and routers — PC2 plays the attacker. Apply one feature at a time and re-test ping after each step. Keep the **🛡️ IDS** window open to watch alerts arrive.

#### 🔒 Step 1 — Port Security (Switch1 & Switch2)
```text
Switch1> enable
Switch1# configure terminal
Switch1(config)# interface FastEthernet0/1
Switch1(config-if)# switchport port-security
Switch1(config-if)# switchport port-security maximum 1
Switch1(config-if)# switchport port-security violation shutdown
Switch1(config-if)# exit
Switch1(config)# end
Switch1# show port-security interface FastEthernet0/1
```
**✅ Re-test:** `PC1> ping 192.168.20.10` should still succeed (port security only blocks a *second* MAC on the port). To see it bite, cable PC2 to a switch and run `macof` on it — the **Port Security** alert appears in the IDS.

#### 🔒 Step 2 — ACL / Firewall (Router1)
Example: allow all traffic, but block Telnet.
```text
Router1> enable
Router1# configure terminal
Router1(config)# access-list 101 deny tcp any any eq 23
Router1(config)# access-list 101 permit ip any any
Router1(config)# interface GigabitEthernet0/1
Router1(config-if)# ip access-group 101 out
Router1(config-if)# exit
Router1(config)# end
Router1# show access-lists
Extended IP access list 101
    10 deny tcp any any eq 23
    20 permit ip any any
```
Re-test ping — it should still pass. An ACL that *denies ICMP* (see the "Block traffic with an ACL" mission) makes the ping fail and raises an **ACL Denied** alert. Removing the final `permit ip any any` breaks everything through the implicit deny — a key teaching moment.

#### 🔒 Step 3 — DHCP snooping / ARP inspection (Switch1 & Switch2)
```text
Switch1(config)# ip dhcp snooping
Switch1(config)# interface FastEthernet0/2
Switch1(config-if)# ip arp inspection trust
```
`ip dhcp snooping` turns on ARP inspection in this simulator; mark the uplink toward the router as **trusted**. (`ip arp inspection vlan …` and `show ip arp inspection` are not implemented.)

#### ⚔️ Step 4 — Attack Simulation (attacker = PC2 — do this LAST)
```text
PC2> arpspoof --target 192.168.10.10 --gateway 192.168.10.1
```
The built-in tool injects the forged ARP reply straight into the victim's cache, so it is **not** filtered by DAI — you *detect* it instead:
- The **🛡️ IDS** shows a critical **ARP Poison** alert on PC1.
- Confirm the damage on the victim:
```text
PC1> arp
Protocol  Address          Age (min)  Hardware Addr   Type   Interface
Internet  192.168.10.1     -          00:1A:2B:00:04:34   ARPA    Ethernet0   ← the gateway now maps to PC2's MAC
```

---

### 🏁 Golden Order Summary
```text
1. Wire all 5 cables (or the 3-cable routed path)     (Phase A)
2. PC1 → Switch1 → Router1 → Router2 → Switch2 → PC2   (Phase B)   ← switch ports need `no shutdown`
3. Static routes OR OSPF on Router1 and Router2        (Phase C)
4. Ping PC1 ↔ PC2 — must succeed before anything else  (Phase D)
5. Port security → ACLs → DHCP snooping → attack simulation
   — testing ping after each step, IDS window open     (Phase E)
```

### 🛠 Troubleshooting Checklist
| Symptom | Likely Cause | Fix |
|---|---|---|
| Interface shows `down` / `down` | Cable not connected | Return to Phase A |
| Interface shows `administratively down` | Missing `no shutdown` (routers *and* switch ports) | Run `no shutdown` in `config-if` mode |
| `show ip route` missing a static route | Typo in `ip route` or wrong next hop | Re-check Phase C exactly |
| OSPF configured but no `O` routes | A static route with the same prefix wins; or neighbours never reached FULL | `no ip route …`; check `show ip ospf neighbor` and that both ends use the same area |
| Ping fails only between two PCs on one switch | Ports are in different VLANs | `show vlan brief`, then `switchport access vlan N` |
| Ping fails after adding ACL | Missing `permit ip any any` (implicit deny) | Add a permit-all rule at the end of the ACL |
| Ping fails after port security | Max MAC count exceeded, port err-disabled | `shutdown` then `no shutdown` on the port to recover |
| ARP table shows the wrong gateway MAC | `arpspoof` ran (expected in the attack step) | Watch it in the IDS; **↺ Reset lab to default** to clean up |
| Console back at `Router1>` after a refresh | The lab state is restored, the session mode is not | Type `enable` again |
| Want a clean slate | — | 🎯 Missions → **↺ Reset lab to default** (clears configs, cabling and console history) |

---

## License

MIT — Educational use encouraged.

*Built with Three.js, React, and a passion for networking + cybersecurity education.*
