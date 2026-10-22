# Veyrath

Multiplayer-first co-op action game for Windows desktop. This repository is the **Milestone 1
network foundation**: one standalone authoritative server, an Electron + TypeScript client, and two
real clients sharing one world. Graphics are placeholder shapes on purpose.

> Working title in the original brief was "Eardhart"; the project is now Veyrath.

## Layout

```text
apps/desktop/          Electron shell: secure window, narrow preload, packaging (electron-builder)
packages/client/       Browser-side game client: canvas rendering, input, HUD, F3 overlay,
                       prediction/reconciliation, interpolation, WebSocket transport
packages/sim/          Pure fixed-tick simulation (no DOM/Node/Electron, seeded RNG, deterministic)
packages/protocol/     Typed client/server messages + strict validation of untrusted input
services/game-server/  Standalone authoritative Node server: rooms, sessions, 30 Hz tick loop
tests/                 unit / integration / network test suites (Vitest)
scripts/               local two-client launcher, automated two-client smoke test
docs/                  ARCHITECTURE.md, TESTING.md, DECISIONS.md
```

## Requirements

- Windows 10/11, Node.js **22.12+** (developed on Node 24, npm 11)
- `npm install` once. Electron 45 downloads its binary on first launch (or run
  `node node_modules/electron/install.js`).

## Commands

| What                                         | Command                                                              |
| -------------------------------------------- | -------------------------------------------------------------------- |
| Start the game server (ws://127.0.0.1:7777)  | `npm run server`                                                     |
| Start one desktop client                     | `npm run client`                                                     |
| Server + **two local clients** in one go     | `npm run play:local`                                                 |
| All tests                                    | `npm test`                                                           |
| Typecheck + lint + format check + tests      | `npm run check`                                                      |
| Automated two-client acceptance run          | `npm run smoke:two`                                                  |
| Package a Windows test build                 | `npm run package:win`                                                |
| Same acceptance run against packaged exe     | `npm run smoke:packaged` (after packaging)                           |
| Client in a browser tab (dev only)           | `npm run dev:web` (server must be running)                           |
| Same acceptance run through simulated lag    | `npm run smoke:lag`                                                  |
| Long-run bot soak (30 min, 5 bots)           | `npm run soak -- --minutes=30 --latency=100 --jitter=30 --loss=0.01` |
| **Friend test:** host on Tailscale + metrics | `npm run host -- --client`                                           |
| **Friend test:** zip for your friend         | `npm run package:friend -- --server=ws://100.x.y.z:7777`             |
| Summarize a metrics file                     | `npm run metrics:report -- logs/metrics-….jsonl`                     |

Server settings come from environment variables; see [.env.example](.env.example).

## Local two-player test (manual)

1. `npm run play:local` — starts the server and opens two windows (P1 left, P2 right).
2. In window **P1**: click **Create room**. The room code appears top-right.
3. In window **P2**: type the code, click **Join room**.
4. Move with **WASD/arrows**, attack with **Space/J** when next to the red square. Both windows show
   the same enemy HP. **F3** toggles the debug overlay. **Esc** or **Leave** exits the room.
5. Try minimizing one window — the other keeps playing and the overlay's snapshot rate stays ~30/s.

The packaged build lands in `apps/desktop/release/` (`win-unpacked/Veyrath.exe` plus a zip); the
server bundle is copied to `apps/desktop/release/server/veyrath-server.cjs` (`node veyrath-server.cjs`).

## Status

**Milestone 2 (friend test over Tailscale) is in progress.** Roadmap: [docs/ROADMAP.md](docs/ROADMAP.md). Tooling is built and verified locally;
the real two-location test has not been run yet. Follow [docs/FRIEND_TEST.md](docs/FRIEND_TEST.md).

Milestone 1 is implemented and its acceptance gates pass **locally** (two windows, one PC). See
[docs/TESTING.md](docs/TESTING.md) for what ran, the results, and known limitations. Nothing here
proves online performance — that is Milestone 2 (friend test over real internet connections).
