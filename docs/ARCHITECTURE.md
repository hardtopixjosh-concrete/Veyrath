# Architecture (Milestone 1)

## Shape

```text
 ┌──────────── Electron (apps/desktop) ───────────┐        ┌──── services/game-server ────┐
 │ main process: window, CLI options, IPC (2 calls)│        │ http + ws on one port        │
 │ preload: contextBridge → window.veyrath         │        │  /health  (JSON stats)       │
 │ renderer = packages/client (bundled, file://)   │  ws:// │ GameServer                   │
 │   KeyboardInput ─► GameSession ─► Transport ────┼────────┼─► ClientConnection (limits)  │
 │   Renderer ◄── SnapshotBuffer / Predictor ◄─────┼────────┼── Room ─ World (packages/sim)│
 └─────────────────────────────────────────────────┘        │ FixedTicker 30 Hz            │
                                                            └──────────────────────────────┘
```

`packages/protocol` defines every message both ways; `packages/sim` is imported by the server (to
simulate) and by the client (only the pure `movePlayer` function, for prediction).

## Ownership

| Server owns (authoritative)                              | Client owns (non-authoritative)                |
| -------------------------------------------------------- | ---------------------------------------------- |
| player IDs, rejoin tokens, slots, room membership        | keyboard → intent (`moveX`, `moveY`, `attack`) |
| positions, enemy movement/AI, attacks, damage, HP, death | rendering, HUD, overlay, effects               |
| input validation, rate limits, queue bounds, cleanup     | predicted own position (always reconciled)     |
| tick clock and snapshots                                 | interpolation of remote entities               |

Clients never send positions, damage, or HP. Unknown fields are dropped by the parser; unknown
message types are rejected.

## Simulation (`packages/sim`)

- Fixed **30 Hz** tick. `stepWorld(world, inputs)` advances exactly one tick; it has no notion of
  wall-clock time. Lint rules forbid `Date.now`, `Math.random`, `performance`, DOM and Node APIs in
  this package.
- Seeded mulberry32 RNG stored in the world (`rngState`) drives the enemy. Same seed + same inputs →
  byte-identical snapshots (tested over 900 ticks).
- Positions are quantized to 0.01 so server state, wire snapshot and client replay are identical.
- Players iterate in slot order, so simultaneous hits resolve deterministically.

## Server (`services/game-server`)

- **Tick loop**: `FixedTicker` schedules against an absolute timeline (drift-corrected, catches up
  ≤ 5 late ticks, then resets). It runs in its own Node process, so nothing a client window does —
  minimize, lose focus, render slowly, freeze — can affect it.
- **Rooms**: 5-character codes, 1–5 players, slot = lowest free. Each room has its own world and
  seed. Room is deleted when its last member is removed.
- **Inputs**: one bounded queue per player (default 8). `seq` must strictly increase; duplicates and
  out-of-order inputs are rejected; overflow drops the oldest. Each tick consumes **at most one**
  input per player — sending faster cannot make you move faster. The snapshot carries `ack` (last
  applied seq) for reconciliation.
- **Snapshots**: full world state, JSON, every tick by default (`VEYRATH_SNAPSHOT_EVERY_TICKS`).
  World JSON is serialized once per tick and shared by all recipients.
- **Backpressure**: WebSockets are reliable/ordered, so obsolete state must be dropped at the app
  layer. If a connection has > 64 KB unsent, snapshots to it are **skipped** (the next full snapshot
  supersedes them); essential messages (welcome/error/left/pong) are still sent. Above 1 MB unsent the
  connection is terminated. Hit/attack information is state-based (`lastHitTick`, `lastAttackTick`,
  `hp`), so skipping a snapshot never loses an event.
- **Abuse limits**: 1 KB max frame (socket-level `maxPayload` + parser), token bucket (burst 90,
  60 msg/s) with disconnect on sustained abuse, disconnect after 20 invalid messages, binary frames
  rejected, 30 s lobby timeout for sockets that never join, max 256 connections / 64 rooms,
  5 s ping heartbeat terminates dead peers.
- **Version check**: `create`/`join`/`rejoin` carry the protocol version; a mismatch gets a fatal
  `version_mismatch` error and close code 4001.

## Session semantics

| Event                              | Result                                                                                      |
| ---------------------------------- | ------------------------------------------------------------------------------------------- |
| `leave` (button / Esc)             | Slot freed immediately; socket stays open for create/join.                                  |
| Connection drops (network, crash)  | Player stays in world as `connected:false`, frozen, for the grace period (15 s).            |
| Reconnect within grace             | Client auto-sends `rejoin` (room, playerId, token) every 1 s → same player, slot, position. |
| Rejoin while old socket still open | New socket wins; old one gets `replaced` and is closed (4009).                              |
| Grace expires                      | Slot released; later `rejoin` fails with `rejoin_failed`.                                   |
| Last member removed                | Room deleted.                                                                               |
| Server stops                       | Every client gets `server_shutdown` + close 1001; all state cleared.                        |

Rejoin credentials live in client memory only: restarting the app joins as a new player.

## Client (`packages/client`)

- **Timers, not frames**: input (30/s, with bounded catch-up after a stalled main thread), pings
  (1/s) and snapshot handling run on timers/socket events. `requestAnimationFrame` only draws.
  Electron disables background throttling so a minimized window keeps its network rate.
- **Prediction**: own movement applied immediately with the shared `movePlayer`; on each snapshot
  the client resets to the server position and replays un-acked inputs. Small errors blend out over
  ~100 ms, large ones (> 120 units) snap. Attacks/HP are not predicted.
- **Interpolation**: remote players and the enemy are drawn 3 ticks (~100 ms) behind the estimated
  server clock, lerped between bracketing snapshots (buffer of 40).
- **Transport** interface (`net/transport.ts`) isolates WebSocket specifics.

## Electron security

`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`; preload
exposes exactly two functions (`getConfig`, `smokeReport`); IPC handlers verify the sender is our
bundled `file://` page; navigation, new windows, webviews and all permission requests are denied;
strict CSP in `index.html`; menu removed and devtools disabled in packaged builds; no secrets in the
client. CLI options are validated in the main process before reaching the page.
