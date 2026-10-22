# Decisions (Veyrath only)

Short log of decisions made for this codebase. Newest last.

1. **2026-10-21 — Name.** The brief called the project "Eardhart"; it is built as **Veyrath**
   (package scope `@veyrath/*`, product name `Veyrath`).
2. **npm workspaces** (npm 11, lockfile committed, `packageManager` pinned). No extra package manager
   to install. Electron is pinned to an exact version (`45.0.0`) for reproducible packaging.
3. **Workspace packages export TypeScript source.** Vite (client), esbuild (server, Electron main and
   preload) and Vitest compile them directly; `tsc` is used for typechecking only. One build step
   per deliverable, no project-reference build graph.
4. **30 Hz fixed tick, snapshot every tick, full JSON snapshots.** Small world, ≤ 5 players: a
   snapshot is well under 1 KB. Delta compression / binary encoding deferred until measurements
   from Milestone 2 justify them.
5. **One input per player per tick** with strictly increasing `seq`, bounded queue (8), oldest
   dropped. Keeps prediction exact (each input = one `movePlayer` step) and caps speed-hacking.
6. **State-based combat feedback** (`lastAttackTick`, `lastHitTick`, `hp`) instead of one-shot
   events, so skipped/coalesced snapshots never lose anything essential.
7. **Disconnect ≠ leave.** A drop holds the slot for 15 s (rejoin with a per-player secret token);
   `leave` frees it immediately. Token is held in client memory only.
8. **Canvas 2D placeholder renderer** for Milestone 1 instead of PixiJS: zero dependencies while the
   network layer is proven. PixiJS/Three.js remain the plan for real content.
9. **Server binds 127.0.0.1 by default.** Remote play requires opting in with `VEYRATH_HOST`
   (Milestone 2, private route such as Tailscale).
10. **Smoke mode in the shipping client** (`--smoke=…` flags) so the exact packaged exe can be
    acceptance-tested end to end. It is inert unless those flags are passed.
11. **Client input uses a catch-up accumulator.** Found during the smoke run: a renderer stalled
    40 ms/frame starved the input timer to ~14 inputs/s (player moved at half speed). Inputs now
    catch up (≤ 4 per callback) so the send rate stays 30/s at low FPS.
