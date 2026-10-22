# Milestone 3 plan — bringing in art and content

**Status: plan only.** Nothing here has been built. Milestone 3 starts after the Milestone 2 friend
test is stable **and** you approve it. Lights-end has not been opened; this plan was written
without it.

## Ground rules

1. **Art and data come over; code doesn't.** From the old game we take images, models, animation
   sheets, maps and numbers (HP, damage, speeds). We never copy its networking, game loop or
   systems. Old behaviour is re-described as data, then rebuilt on the new simulation.
2. **The server stays in charge.** Content can't add any way for a client to decide outcomes.
   Everything that affects play runs in `packages/sim`, at the fixed tick, deterministically.
3. **One thing at a time.** One hero, then the arena, then one boss. Each one is tested in
   multiplayer before the next starts.
4. **You pick, I import.** I only open the specific files you point me at. The old asset pack
   contains many zip files you don't use: those are never unpacked or copied in bulk. Only files
   you name come over, one by one.

## What comes from the old game (your decisions, 2026-10-22)

| Kind                       | Source                                              | Until it's ready                    |
| -------------------------- | --------------------------------------------------- | ----------------------------------- |
| Players / heroes           | **Old game's assets**                               | –                                   |
| Weapons                    | **Old game's assets**                               | –                                   |
| Map / arena                | **Old game's assets**                               | Current plain grid arena            |
| Bosses                     | **Old game's assets**                               | –                                   |
| VFX (hits, swings, spells) | **Old game's assets**                               | Simple shape flashes (current)      |
| Enemies                    | **New art you'll make** (old enemy art is not used) | Placeholder shapes, defined as data |
| Sound                      | **Redone by you later**                             | Cheap placeholder sounds            |

So the pipeline must handle two sources: selected old files, and your own new art as you make it.
Both go through the same import and `IMPORTED.md` log.

## How content is split

Every piece of content gets two halves, so the server never loads art and the client never
decides rules:

| Half                  | Used by         | Example fields                                                                                         |
| --------------------- | --------------- | ------------------------------------------------------------------------------------------------------ |
| **Gameplay data**     | server + client | max HP, move speed, hitbox radius, attacks (damage, reach, cooldown in ticks), AI behaviour parameters |
| **Presentation data** | client only     | sprite sheet, animations per state (idle, run, attack, hit, die), scale, colours, sounds, UI icon      |

Both halves are plain data files (JSON), checked by a validator when the game builds. Bad data
fails the build instead of crashing mid-game. The build also computes a **content version**, and
client and server compare it when a player joins (like the protocol version check today), so a
friend with outdated content gets "Update the game" instead of a silent mismatch.

## Planned layout

```text
assets/
  source/            originals as imported (kept for re-export), with IMPORTED.md log
content/
  heroes/<id>.json   gameplay + presentation for one hero
  enemies/<id>.json
  bosses/<id>.json
packages/content/    TypeScript types, validator, content-version hash (no DOM, no Node APIs)
packages/client/public/assets/   runtime files the game loads (sprite sheets, models, audio)
```

`IMPORTED.md` records, for every imported file: where it came from, the date, and whether we're
allowed to ship it (your own art vs a bought asset pack and its licence).

## File formats

| Kind                      | Format                                                             | Loaded by                |
| ------------------------- | ------------------------------------------------------------------ | ------------------------ |
| 2D characters and effects | PNG sprite sheet + JSON atlas (Aseprite or TexturePacker export)   | PixiJS                   |
| Maps / arenas             | Tiled JSON (`.tmj`) + tileset PNG, or a simple arena JSON at first | PixiJS + sim (collision) |
| 3D hero models (optional) | glTF binary (`.glb`) with animations                               | Three.js                 |
| Sound                     | `.ogg` (plus `.mp3` only if needed)                                | Web Audio                |

If the old game's art is in other formats (layered PSDs, separate frame PNGs, other 3D formats),
there's a conversion step during import, not a new loader.

## Engine work before any real content (step 0)

This step uses placeholders only, so it doesn't need Lights-end:

1. **Swap the canvas renderer for PixiJS** behind the existing `Renderer` interface. Same
   circles and squares at first, so we can prove nothing in networking changed (all smoke gates
   must still pass, FPS checked).
2. **Asset loading:** a manifest, a loading screen, and assets bundled inside the app, never
   downloaded at runtime.
3. **`packages/content`:** types and validator, with one placeholder hero and enemy defined as
   data instead of hard-coded constants. _Done 2026-10-22 (types, validator, content version,
   placeholder hero/enemy/boss files, 20 tests). Not yet wired into the simulation._
4. **Placeholder sounds:** a tiny set of free-to-use beeps and thumps for swing, hit, death and
   UI, wired to game events, so your real sounds later are a file swap, not code.
5. **Generalize the simulation:** many enemies instead of one, entities created from content
   data, and attacks as data (reach, arc, damage, cooldown, wind-up). The determinism and HP tests
   are extended to cover this.
6. **Snapshot budget check:** more entities mean bigger snapshots. We measure the size per tick
   and set a limit before adding content (delta snapshots only if numbers demand it).

Three.js for 3D heroes is a separate, optional decision after step 0. PixiJS alone may be enough.

## The import steps

| Step | What                              | Done when                                                                                                                                                 |
| ---- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | One hero + their weapon + its VFX | Moves and attacks with real animations and effects; two clients see the same thing; smoke gates pass                                                      |
| 2    | The map / arena                   | Real map art; walls and obstacles collide in the server simulation; both clients agree on positions                                                       |
| 3    | One boss                          | Phases or special attacks as data; tested with 2+ players through the lag proxy; no FPS regressions                                                       |
| –    | Enemies                           | Behaviour built with placeholder art (several at once, HP matches on all clients, snapshot size within budget); your own art drops in whenever it's ready |
| –    | Sound                             | Placeholder sounds wired to events (hit, swing, death); your own sounds replace them later                                                                |

Each step ends with the tests green, a two-window smoke run (with and without simulated lag), and
a short entry in `docs/DECISIONS.md`.

## What I'll need from you (when we start)

- **Which hero, weapon, map and boss** to bring over first, and which VFX go with them.
- **Where they are** on your PC (exact folders or files), so I only open those and skip the
  unused zips.
- **What the art is**: your own, made for you, or a bought pack. Packs often have licence limits
  on redistribution, which matters once friends download the game.
- **The look you want:** top-down or isometric 2D, and whether heroes should be 3D models.
- Optionally, the old numbers (HP, damage, speeds) as you remember or have them written down. I'd
  rather take them from you than dig through old code.

## Risks to watch

- **Repo size:** large art bloats Git. If assets pass a few hundred MB, we switch them to Git LFS
  before committing.
- **Old numbers may not fit:** values tuned for the old game loop (per frame, not per tick) need
  converting, and balance will need replaying, not copying.
- **Bigger downloads for your friend:** each content update means a bigger zip until Milestone 4
  (auto-updates).
