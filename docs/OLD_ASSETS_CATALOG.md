# Old game asset catalog

Read-only survey of `C:\Users\hardt\OneDrive\Documents\VEYRATH`, made 2026-10-25 for Milestone 3.
Only file names, types, sizes and folder layouts were listed. **No code, design docs or old
networking were opened**, nothing was copied into Veyrath, and zip packs were not unpacked (their
folder names were listed, plus one sample image each to compare art styles).

The folder holds 41,364 files (24 GB). Most of it is build output and temporary copies.

## Update: the game-ready assets (from the user's `FILE_MAP_FOR_PORT.pdf`)

The old game's **finished, in-game assets** live in `sites\veyrath\dist\` (392 MB in `assets\`),
which the first survey skipped as build output. Paths below were checked on disk (names and sizes
only). **These, not the raw packs, are what Milestone 3 should import.**

| Kind            | Game-ready source (`sites\veyrath\dist\…`)                                                                                                                                                                              | Notes                                                                                                |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Heroes (3D)** | `assets\hero\warrior.glb`, `mage.glb`, `ranger.glb` (3.3–5 MB); path heroes `pyro`, `frost`, `storm`, `blood`, `crimson`, `warrior-berserker/-dark/-warlord`, `ranger-archer/-alchemist/-gunslinger/-ninja` (3.8–10 MB) | Three.js models on one shared animation skeleton. The old game drew heroes in **3D** over a 2D world |
| **Weapons**     | `assets\hero\weapons-warrior.glb`, `weapons-mage.glb`, `weapons-ranger.glb`                                                                                                                                             | Held weapon meshes per class                                                                         |
| **Bosses**      | `assets\butcher`, `prophet`, `colossus1–3`, `wyrm1–2`, `golem`, `tyrant1–3` (11–24 MB each)                                                                                                                             | Pre-rendered HD 2D strips. Must not be recompressed                                                  |
| **Map**         | `maps\desert.tmj` (Tiled, 9600×7200, 15 areas), `desert-props.tsj`, `ground\` baked tiles; ~800 prop/wall/ground sheets in `assets\`                                                                                    | Isometric desert, already sliced; `assets\manifest.json` has anchor/solid/foot per sprite            |
| **VFX**         | `fx-*` sheets in `assets\`, `data\vfx\recipes.json`, `timing.json`                                                                                                                                                      | The recipes are data for the old VFX engine (code, not imported)                                     |
| Enemies (later) | `assets\dm-*`, `demon-*` sheets (15 cols × 8 dirs, 128 px)                                                                                                                                                              | You plan your own enemy art                                                                          |
| Licences        | `assets\*-license.txt` (17 files)                                                                                                                                                                                       | Ship alongside the assets                                                                            |

**Boss answer:** the bosses were the Butcher, Prophet, Colossus (3 forms), Wyrm (2), Golem and
Tyrant (3), as above.

**Conflict to note:** the file map's "checklist for the port" also says to copy the old `docs\`,
design PDFs, `AGENTS.md`, the Steam launcher, and to port the old game code as data tables. The
Veyrath brief rules out reusing old code, networking, launcher and handoff docs. This catalog
follows the brief: **assets only**, plus gameplay numbers you hand over yourself, unless you decide
otherwise.

## What's there, by kind

| Kind (plan)               | Where                                                         | What it is                                                                                                                                                                                                                                                      | Notes                                                                                                        |
| ------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Heroes** (2D, ready)    | `2D HD Character pack 1 V1.2.zip` (706 MB, 35,735 files)      | 9 heroes: Knight, Archer, Wizard, Paladin, Camo Archer, Mage, Death Knight, Dark Lord, Longbow. ~30 animations each (Idle, Run, Walk, Melee ×2, MeleeSpin, CastSpell, Special ×2, ShieldBlock, Roll, Slide, Die, TakeDamage…), **8 directions**, 128×128 frames | Pre-rendered 3/4-view sprites. Fits the 2D plan directly                                                     |
| **Heroes** (your 3D work) | `design/characters/` (2.3 GB, 2,336 images)                   | Base male/female models, Frost and Pyro mage kits, Pyro outfit pieces, Solar cape/crown, renders, run frames; 8 `.glb` + 15 `.blend` files                                                                                                                      | Stylised 3D, different look from the HD pack; would need rendering to 8-direction sprites (or a 3D renderer) |
| **Weapons**               | `2D Desert Fantasy tileset v1.0.zip` → `Animations/Equipment` | Sword, Axe, Shield, slash animation, head/chest/legs armour pieces, a mount                                                                                                                                                                                     | HD-pack heroes already hold their weapons; these suit equipment swaps later                                  |
|                           | `design/characters/outfits/pack/gun-frames`                   | Gun animation frames from your own work                                                                                                                                                                                                                         |                                                                                                              |
| **Map**                   | `2D Desert Fantasy tileset v1.0.zip` (171 MB, 4,012 files)    | 2,489 environment sprites, animated and destructible tiles, props (barrels, fire, torches, portal, turret)                                                                                                                                                      | **Isometric** desert style                                                                                   |
|                           | `Desert Biome/` (19 images)                                   | Map overview, layout sketch, screenshots of the old desert map                                                                                                                                                                                                  | Layout reference: spawn, forge, merchant, shrines, camps, arenas                                             |
| **Bosses**                | _Not found as their own folder_                               | The old map names arenas _colosseum_, _ravager pit_, _wyrm pit_                                                                                                                                                                                                 | See questions below                                                                                          |
|                           | `2D Demons - TopDown assetpack v1.1.zip` (247 MB)             | 34 demons: Imp 1–10, Demon Spawn 1–13, Demon Beast 1–5, Demon Elite 1–6. 8-direction sheets (Attack ×4, Run, Die, Taunt…), same 3/4 style as the HD pack                                                                                                        | Elites/Beasts could serve as bosses; you said enemy art will be your own                                     |
| **VFX**                   | `Visuals/` – 13 "Super Pixel" packs (≈ 220 MB)                | Effects Gigapack, Blood, Explosions, Impacts ×2, Fantasy FX ×2, Projectiles ×3, Sci-fi FX ×2                                                                                                                                                                    | Pixel-art style, likely sharper/blockier than the HD sprites                                                 |
|                           | Desert tileset → `Animations/Effects`                         | 256 effect frames matching the desert style                                                                                                                                                                                                                     |                                                                                                              |
| Pickups                   | `objects pickups visuals/` (2 packs)                          | Item pickups (fantasy), objects and items                                                                                                                                                                                                                       | Pixel-art                                                                                                    |
| UI (later)                | `Visuals/UI/` (8 kits)                                        | Main menu, unlocks, armory/inventory, character select, crest & cloth, orb HUD, settings, talent tree                                                                                                                                                           | Not in Milestone 3 scope                                                                                     |
| 3D source packs (later)   | `Visuals/Character models/` (≈ 970 MB)                        | Modular fantasy outfits, modular women, Universal Animation Library ×2, Universal Base Characters                                                                                                                                                               | Source for your own 3D characters                                                                            |
| Sound (skipped)           | `Sounds/` (442 ogg, 15 mp3)                                   | –                                                                                                                                                                                                                                                               | You're redoing sound                                                                                         |

## Not looked at (on purpose)

- Code and builds: `launcher/`, `sites/`, `tmp/` (16 GB), `outputs/`.
- Design docs: the PDFs, `GAME_REFERENCE.md`, `AGENTS.md`, `docs/`.

## Style check (one sample each)

- **HD Character pack and Demons pack** match each other: pre-rendered 3D figures in a 3/4 view,
  8 directions, 128-px frames.
- **Desert tileset / old map** is **isometric**. The current Veyrath world is drawn straight
  top-down, so using this art means drawing the world isometrically (the server's 2D simulation
  doesn't change, only the camera).
- **Your Pyro mage** (3D render) is a smoother, stylised look. It can match the packs if rendered
  from Blender at the same angle into 8-direction sprite sheets.
- **Super Pixel FX** are pixel art; worth a side-by-side check before committing to them.

## Questions before importing

1. **First hero:** the shipped **Warrior** (`warrior.glb` + `weapons-warrior.glb`) is the real
   in-game look and comes with its animations. It needs a Three.js hero layer on top of the PixiJS
   world, as the original brief planned. The quicker but outdated option is the legacy 2D
   `knight-*` sheets.
2. **Old docs and code:** keep the brief's rule (assets only), or allow reading specific design
   data later (for example balance numbers or weapon families)?
3. **Licences:** pack licences are copied next to the assets; confirm the HD Character, Demons and
   Desert packs allow shipping inside builds you give to friends.
