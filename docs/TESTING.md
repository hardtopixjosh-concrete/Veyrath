# Testing

## Commands

```bash
npm test                 # all Vitest suites (unit, integration, network)
npm run check            # typecheck + lint + prettier --check + tests
npm run smoke:two        # build, then 2 real Electron windows + real server process, scripted
npm run package:win      # electron-builder → apps/desktop/release/
npm run smoke:packaged   # same smoke run against release/win-unpacked/Veyrath.exe
npm run smoke:lag        # smoke run through the netem proxy (120 ms RTT ± 40 ms, 2 % stalls)
npm run soak -- --minutes=30 --bots=5 --latency=100 --jitter=30 --loss=0.01
npm run metrics:report -- <metrics.jsonl>
```

`smoke-two-clients.mjs` accepts `--latency=MS --jitter=MS --loss=RATE` to route both clients
through `scripts/netem-proxy.mjs`. The soak writes `logs/soak-<time>.json` (summary) and
`logs/soak-<time>-metrics.jsonl`.

Smoke runs open two windows for ~30 s; reports land in `.smoke/` (`host.jsonl`, `join.jsonl`,
`results.json`, `run.log`, `host.png`, `join.png`).

## Automated suites (`tests/`)

| File                           | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unit/protocol.test.ts`        | valid messages; strips unknown fields; malformed JSON, oversized, wrong types, NaN/Infinity, ranges, names, room codes, rejoin credentials                                                                                                                                                                                                                                                                                                                        |
| `unit/sim.test.ts`             | **determinism** (same seed + inputs → identical 900-tick history; different seed diverges); movement/clamping; **authoritative HP** (in-range, out-of-range, cooldown, simultaneous hits, death/respawn); slot limits                                                                                                                                                                                                                                             |
| `unit/server-parts.test.ts`    | input queue (**duplicate / out-of-order rejection**, bound, monotonic seq); token bucket; snapshot skip + hard-limit terminate (fake socket); rate-abuse flag; ticker holds 30 Hz under slow ticks; env config                                                                                                                                                                                                                                                    |
| `unit/client-net.test.ts`      | prediction matches server; **server wins on disagreement**; pending bound; interpolation; stale snapshot rejection                                                                                                                                                                                                                                                                                                                                                |
| `integration/rooms.test.ts`    | two clients see each other move; **both attack, identical HP on both clients per tick**; client cannot set state; 5-player cap; version mismatch (fatal, close 4001, server keeps serving); drop → frozen → **rejoin same player**; grace expiry; wrong token; replace stale socket; leave/room cleanup; **60 join/leave/drop cycles leave no rooms, timers, listeners or queued inputs**; lobby timeout; **repeated server start/stop**                          |
| `unit/desktop-options.test.ts` | server URL precedence (`--server` > env > `veyrath.config.json` > default); BOM tolerance; malformed config files rejected                                                                                                                                                                                                                                                                                                                                        |
| `integration/metrics.test.ts`  | `stats` message validation; metrics log records events, client stats with server-measured RTT, server stats; stats from sockets outside a room ignored                                                                                                                                                                                                                                                                                                            |
| `network/abuse.test.ts`        | oversized frame → 1009; invalid spam → close 4002 with capped replies; binary frames; **input spam rate-limited, queue ≤ 8, close 4029**; honest 30 Hz client never limited; dup/out-of-order seq, ack monotonic; input before join; **silent client (stopped rendering) → server still ~30 Hz, others unaffected**; **client not reading its socket → server tick + other client unaffected, buffer bounded**; dead peer heartbeat; server-full / connection cap |

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

## Milestone 2 — local verification (2026-10-21)

Done on one PC before the real friend test. **None of this replaces the two-location test** in
[FRIEND_TEST.md](FRIEND_TEST.md).

- `npm run check`: **90/90 tests passed** (9 files).
- Two-window smoke through the netem proxy (120 ms RTT ± 40 ms jitter, 2 % stalls of 250 ms):
  **all gates passed**: 327 common ticks, 0 HP mismatches; host received 30–31 updates/s while
  minimized; slow (25 FPS) client still sent 30 inputs/s; drop → rejoined as the same player;
  0 rejected inputs. Clients measured RTT ≈ 154–212 ms and snapshot jitter ≈ 15–19 ms.
- An earlier lagged run showed ~45 rejected inputs. The cause was the test proxy delivering chunks
  out of order (timers that come due together don't fire in a guaranteed order). The server
  correctly rejected them; the proxy now drains one ordered queue per direction. Afterwards:
  0 rejected inputs at up to 250 ms ± 80 ms with 5 % stalls.
- Packaged exe smoke (no impairment) on protocol v2: all gates passed.
- Friend package: built a zip, unzipped it, launched `Veyrath.exe` with **no** `--server` flag →
  connected using only `veyrath.config.json`.
- Tailscale on the host PC: installed and signed in; address `100.96.171.24`. Server bound to that
  address; the friend build connected to it **from the same PC** (RTT 0.4 ms). Not yet tested from
  another PC, so firewall reachability is unverified.
- **30-minute soak** (5 bots, one room, real server process, netem 100 ms ± 30 ms with 1 % stalls;
  a drop + rejoin or a leave + fresh join every minute): **all checks passed**. Tick rate 30.00 Hz
  over 30 min, 0 tick-loop resets, worst tick 4.17 ms; 15/15 drops rejoined as the same player,
  14/14 leave → join cycles succeeded; 0 unexpected disconnects or errors; clean state afterwards.
  Server heap went from a median of 7.7 MB (early) to 10.9 MB (late), RSS 52 → 58 MB. That is
  within the check's limit, but 30 minutes is too short to tell slow growth from normal GC
  behaviour; a longer run would settle it.
- In-game connection indicator (HUD dot + label: Good / Fair / Poor with ping, or Reconnecting /
  No updates): unit-tested; seen in a lagged two-window run showing "Poor · 180 ms" at 60 ms jitter.

## Auto-update verification (2026-10-22)

- `tests/integration/updates.test.ts` (12 tests): feed URL mapping; serves `latest.yml` (with
  cache-busting query) and the installer; refuses other extensions, encoded/raw `..` traversal,
  sub-paths, missing files, POST; serves nothing without an updates folder; the simulation still
  ticks > 27 Hz with max tick < 20 ms while a 40 MB installer downloads.
- **End to end on this PC with real installers** (built by `scripts/release.mjs --out=…`):
  installed 0.2.0 silently, started a server offering 0.2.1, launched 0.2.0. It downloaded the
  112 MB installer (about 0.2 s on loopback), installed it silently, and relaunched itself as
  **0.2.1** about 10 s later with its window open; with the server still up it then reported
  "up to date (0.2.1)", and with the server down it reported "update check skipped" and stayed
  playable. Installed version confirmed from the app archive and the Windows uninstall entry. Test
  installs were uninstalled afterwards.
- **Not yet verified:** an update over Tailscale between two PCs (download speed depends on the
  host's upload), and SmartScreen behaviour on the friend's PC for the installer and for updates.

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
