# Roadmap

Revised 2026-10-22 after reviewing the original brief's milestones. The brief's Milestones 1–3
stand; 4–6 are reshaped as below. Each milestone still ends with passed / failed / not-run gates.

## Settled decisions

- **Hosting model: host-a-game.** The authoritative server is bundled into the game. Whoever
  clicks **Host** runs it on their PC; friends join. No monthly server costs. If the host quits,
  the session ends (acceptable for friends-only co-op). The standalone server stays available for
  anyone who wants a dedicated host later.
- **No Steam app ID for now.** The one-time Steam fee is deferred. Until then, friends install once
  and reach the host over Tailscale.
- **Browser build dropped.** The old Milestone 5 (ChatGPT Sites / browser client) is out.
- **Host-served auto-updates (built 2026-10-22).** Sending zips by hand was too painful, so the
  game updates itself from the host's game server (`npm run release`, served by `npm run host`).
  It carries over to host-a-game unchanged; Steam may replace it at Milestone 5.

## Milestones

| #   | Milestone                   | Status   | Done when                                                                                              |
| --- | --------------------------- | -------- | ------------------------------------------------------------------------------------------------------ |
| 1   | Network foundation          | **Done** | Two local clients, one authoritative world, all gates passed (see TESTING.md)                          |
| 2   | Friend test over Tailscale  | **Done** | Ran 2026-10-25: 9/10 checks passed or passed after fixes, F4 partial (see TESTING.md)                  |
| 2b  | Feel fixes from the metrics | Next     | Instant swing animation on keypress (server still decides hits); tuning only where numbers say so      |
| 3   | Content import              | Planned  | PixiJS renderer, content pipeline, one hero + weapon + VFX, the map, one boss (MILESTONE_3_PLAN.md)    |
| 4   | Host-a-game                 | Planned  | **Host** button starts the bundled server; **Join** connects to a host's address; friend test repeated |
| 5   | Steam                       | Later    | Own app ID (fee), Steam networking for reaching the host (no Tailscale), Steam identity, Steam updates |

Milestone 2b is small and sits between 2 and 3 because it depends on real latency numbers.

## Open questions (decide when they come up)

- Progression and saves: if the game gets persistent inventory or unlocks, they must live
  server-side (host's save or a service), not in the client.
- Transport under packet loss: WebSockets are TCP; if the friend test shows stalls, Steam's
  networking (Milestone 5) has an unreliable channel and the transport layer is already separate.
- Memory over long sessions: the 30-minute soak showed slight growth; a multi-hour soak should
  confirm it levels off before release.
