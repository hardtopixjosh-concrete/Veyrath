# Imported assets

Every file brought into Veyrath from outside the repo: where it came from, when, and whether it may
ship. Files are copied byte-for-byte unless a conversion is noted. See
[docs/OLD_ASSETS_CATALOG.md](../docs/OLD_ASSETS_CATALOG.md) for what else is available.

| Date       | File in Veyrath                                           | Source (old game, `C:\Users\hardt\OneDrive\Documents\VEYRATH\…`) | SHA-256 (first 16) | Licence / may ship                                                                                                   |
| ---------- | --------------------------------------------------------- | ---------------------------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------- |
| 2026-10-25 | `packages/client/public/assets/heroes/alchemist.glb`      | `sites\veyrath\dist\assets\hero\ranger-alchemist.glb` (8.4 MB)   | `e5468bd4e6fc4a89` | Yes. Quaternius outfits / base characters / Universal Animation Library: **CC0 1.0**; textures repainted by the user |
| 2026-10-25 | `packages/client/public/assets/heroes/weapons-ranger.glb` | `sites\veyrath\dist\assets\hero\weapons-ranger.glb` (0.4 MB)     | `488b8de7c63cc31a` | Yes. Built by the user in Blender (old game's weapon builder output)                                                 |

## Contents notes

- **alchemist.glb:** one skinned mesh set on the 65-bone UAL skeleton (`hand_r` / `hand_l` for
  weapons), 1.81 units tall, Y-up, ~35k triangles, 19 WebP textures (`EXT_texture_webp`), 54
  animation clips. Used now: `Idle`, `Run`, `R_potion` (throw). Also available: `Walk`, `Die`,
  `TakeDamage`, `Rolling`, `R_bombbag`, `R_barrel`, upper-body `*_up` variants, and more.
- **weapons-ranger.glb:** one root node per weapon (`potion`, `bombbag`, `barrel`, `canister`,
  `flamethrower`, bows, guns, …), each with `<name>_mesh` and a `<name>_tip` marker. No textures.
