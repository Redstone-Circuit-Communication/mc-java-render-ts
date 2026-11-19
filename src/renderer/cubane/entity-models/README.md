# Entity models

Each JSON file contains one base64-encoded GLB from the original model catalog.
`index.ts` maps entity names to explicit dynamic imports so the ES library fetches
only models requested by `EntityRenderer`. The UMD build embeds these imports to
keep its script-tag distribution self-contained.

When adding a model, add its JSON file and matching loader entry. Keep the key
equal to the entity name used by callers, including any version suffix.

## Derived models

The resource pack ships entity textures, never entity geometry. `scripts/generate-entity-models.mjs` adds models the catalog
lacks, textured with the official client jar (downloaded from Mojang into `.cache/` on first run):

- Re-skins of an existing model (same UV mask): `poplar_boat`, `poplar_chest_boat`, `camel_husk`, `happy_ghast`, `happy_ghast_baby`,
  `tropical_fish_pattern_{a,b}_1..6`.
- Converted from the mob's official Bedrock Edition geometry (github.com/Mojang/bedrock-samples, pinned release) with
  `scripts/lib/bedrock-geometry.mjs`: `nautilus`, `zombie_nautilus`, `parched`, `copper_golem`, `cushion`. Both editions
  use the same boxes and texture layout for these mobs; mobs that exist in both editions convert to within a pixel of the
  catalog's own models.
- `sulfur_cube`: two boxes whose sizes follow from its texture, placed as in the Bedrock geometry.

A mob that still has no model is drawn as a hitbox-sized stand-in, so the spot remains visible.
