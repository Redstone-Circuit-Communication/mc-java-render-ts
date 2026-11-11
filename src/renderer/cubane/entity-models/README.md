# Entity models

Each JSON file contains one base64-encoded GLB from the original model catalog.
`index.ts` maps entity names to explicit dynamic imports so the ES library fetches
only models requested by `EntityRenderer`. The UMD build embeds these imports to
keep its script-tag distribution self-contained.

When adding a model, add its JSON file and matching loader entry. Keep the key
equal to the entity name used by callers, including any version suffix.

## Derived models

The resource pack ships entity textures, never entity geometry, so some mobs have no GLB to export.
`scripts/generate-entity-models.mjs` adds the ones that the pack and the existing catalog determine:

- Re-skins of an existing model (same UV mask): `poplar_boat`, `poplar_chest_boat`, `camel_husk`,
  `happy_ghast`, `tropical_fish_pattern_{a,b}_1..6`.
- Boxes recovered from a texture's UV layout (a cuboid unwraps into one fixed cross, so sizes and
  texOffs follow from the opaque pixels): `cushion`, `sulfur_cube`, `copper_golem`. Where a box sits
  is not in the texture; the copper golem's pivots and the sulfur cube's placement are inferred.
  Replace the JSON with a real export when you have one. `scripts/fit-texture-boxes.py` repeats the
  recovery for any entity texture.

Still without geometry: `nautilus`, `zombie_nautilus` and `parched`. Add `<name>.json` and a loader
entry and `MobRegistry` uses it; until then a hitbox-sized stand-in marks the spot.
