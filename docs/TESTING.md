# Testing

## Commands

```bash
npm test                 # all Vitest suites (unit, integration, network)
npm run check            # typecheck + lint + prettier --check + tests
npm run smoke:two        # build, then 2 real Electron windows + real server process, scripted
npm run package:win      # electron-builder → apps/desktop/release/
npm run smoke:packaged   # same smoke run against release/win-unpacked/Veyrath.exe
```

Smoke runs open two windows for ~30 s; reports land in `.smoke/` (`host.jsonl`, `join.jsonl`,
`results.json`, `run.log`, `host.png`, `join.png`).

## Automated suites (`tests/`)

| File                        | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unit/protocol.test.ts`     | valid messages; strips unknown fields; malformed JSON, oversized, wrong types, NaN/Infinity, ranges, names, room codes, rejoin credentials                                                                                                                                                                                                                                                                                                                        |
| `unit/sim.test.ts`          | **determinism** (same seed + inputs → identical 900-tick history; different seed diverges); movement/clamping; **authoritative HP** (in-range, out-of-range, cooldown, simultaneous hits, death/respawn); slot limits                                                                                                                                                                                                                                             |
| `unit/server-parts.test.ts` | input queue (**duplicate / out-of-order rejection**, bound, monotonic seq); token bucket; snapshot skip + hard-limit terminate (fake socket); rate-abuse flag; ticker holds 30 Hz under slow ticks; env config                                                                                                                                                                                                                                                    |
| `unit/client-net.test.ts`   | prediction matches server; **server wins on disagreement**; pending bound; interpolation; stale snapshot rejection                                                                                                                                                                                                                                                                                                                                                |
| `integration/rooms.test.ts` | two clients see each other move; **both attack, identical HP on both clients per tick**; client cannot set state; 5-player cap; version mismatch (fatal, close 4001, server keeps serving); drop → frozen → **rejoin same player**; grace expiry; wrong token; replace stale socket; leave/room cleanup; **60 join/leave/drop cycles leave no rooms, timers, listeners or queued inputs**; lobby timeout; **repeated server start/stop**                          |
| `network/abuse.test.ts`     | oversized frame → 1009; invalid spam → close 4002 with capped replies; binary frames; **input spam rate-limited, queue ≤ 8, close 4029**; honest 30 Hz client never limited; dup/out-of-order seq, ack monotonic; input before join; **silent client (stopped rendering) → server still ~30 Hz, others unaffected**; **client not reading its socket → server tick + other client unaffected, buffer bounded**; dead peer heartbeat; server-full / connection cap |

## Results of the runs made for Milestone 1 (2026-10-21, Windows 11, Node 24.13, Electron 45.0.0)

- `npm run check`: typecheck, lint and format clean; **79/79 tests passed** (6 files, ~14 s).
  The suite was run two more times back to back with the same result.
- `npm run smoke:two` (dev Electron build) and `npm run smoke:packaged` (packaged `Veyrath.exe` +
  packaged server bundle): **all five gates PASS on both**. Last packaged run:

  | Gate                                                   | Result | Evidence                                                                                                                                                |
  | ------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | G1 two clients, one world, see each other move         | PASS   | each client saw the other move 445–549 units                                                                                                            |
  | G2 both attack the same enemy, same HP                 | PASS   | hits from both player IDs; 350 common ticks compared, 0 HP mismatches                                                                                   |
  | G3 server unaffected by minimized / slow window        | PASS   | window minimized 5 s (`isMinimized()=true`); host still received 29–31 snapshots/s; server 29.9 Hz; slow client 25 FPS vs 111, both sending 30 inputs/s |
  | G4 drop → rejoin same player; clean leave; other stays | PASS   | rejoined same ID ~1.2 s after drop; host had 0 interruptions; host's world shows 1 player after leave                                                   |
  | G5 server cleanup                                      | PASS   | 0 rooms / players / connections after exit; 0 rejected/invalid; max tick 1.56 ms                                                                        |

## Milestone 1 acceptance gates

| Gate (brief §4)                                                                                                    | Status                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Two distinct clients share one authoritative world and see each other's movement                                   | **Passed** (local)                                                                                                     |
| Player 1 and Player 2 both attack the same enemy and get the same HP result                                        | **Passed** (local)                                                                                                     |
| Server continues normally when one window is minimized or runs at a different FPS                                  | **Passed** (local; minimize is programmatic via `BrowserWindow.minimize()`, slow FPS is an artificial 40 ms busy-wait) |
| Disconnected player leaves cleanly; other stays connected; reconnect defined and verified                          | **Passed** (semantics in ARCHITECTURE.md)                                                                              |
| Invalid / oversized / spam inputs bounded or rejected; repeated joins don't accumulate listeners, timers or queues | **Passed** (automated)                                                                                                 |
| Build and test commands documented and repeatable                                                                  | **Passed**                                                                                                             |
| Online performance over real internet                                                                              | **Not run** — local loopback only. Milestone 2.                                                                        |

## Known limitations

- Everything was verified on **one PC over loopback**. RTT ≈ 0.3 ms; no latency, loss, jitter, NAT,
  or firewall was involved. Nothing here says how it plays between two homes.
- The packaged exe ran on the build machine only; not tried on a clean Windows install. It is
  **unsigned** (SmartScreen will warn) and uses the default Electron icon.
- The server speaks plain `ws://` with no authentication and binds 127.0.0.1 by default. Fine for a
  private Tailscale test; not for the open internet.
- Rejoin only works from the same running client within 15 s; restarting the app joins as a new
  player.
- Attacks and HP are not predicted, so hit feedback arrives one round trip late. Players don't collide
  with each other or the enemy; the enemy doesn't fight back.
- A client whose main thread is badly stalled also handles pongs late, so its displayed RTT is
  inflated (≈ 46 ms seen locally at 25 FPS with the busy-wait).
- Browser dev mode (`npm run dev:web`) is subject to background-tab timer throttling; the Electron
  app is not.
- `npm install` on npm 11 prints "install scripts not covered by allowScripts" for esbuild and
  electron-winstaller; neither is needed (esbuild ships its binary as an optional dependency).
