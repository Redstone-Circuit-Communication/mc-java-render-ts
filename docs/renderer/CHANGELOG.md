# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Open-source release (unreleased)

### Added

- `setLocale('en' | 'zh-CN')`: the text this package produces (block and entity names, container titles and slot labels,
  inventory warnings, redstone readouts, CSV headers) is English by default and Simplified Chinese on request.
- `ItemAssets` option `renderer`: block items get inventory-style 3D icons drawn from the block's mesh at the item model's
  `display.gui` angle; other items keep their flat texture.
- Entity models for the nautilus, zombie nautilus and parched, converted from Mojang's official Bedrock geometry
  (`scripts/lib/bedrock-geometry.mjs`, checked against catalog models that exist in both editions); the copper golem and
  cushion models are now converted the same way instead of being inferred from their textures.

- **Smooth-lighting ambient occlusion**, as the game shades corners: the shared mesh core darkens each vertex of an
  axis-aligned face by the full opaque cubes next to its corner, and chunk materials read it as a `blockShade` attribute
  (meshes sharing those materials without the attribute are unaffected). On by default; renderer option
  `ambientOcclusion: false` turns it off.
- Render settings gain `shading` and `chunkMs` (chunk-by-chunk loading), applied only when given; the presets match a
  typical host's (power saving 400 ms, balanced 200 ms, quality 5 ms with shading).

### Changed

- Error messages are in English.
- 3D item icons draw the item's own model (a wall's post with two sides, a fence's two posts …); blocks without an item
  use their block model, and a special renderer this package lacks falls back to the flat texture.
- The every-entity example gives the ghasts a row of their own, next to the ender dragon and the giant.
- The example and the development scripts download the official Minecraft client jar from Mojang (the scripts cache it in
  `.cache/`); no Minecraft assets are kept in the repository. The example page is English by default with a Chinese switch.

## 1.2.1 (2026-11-18)

- Shading: every model casts shadows and the shadow map draws both faces; with chunk-by-chunk loading the shadow box grows
  with the structure (before, turning shading on before a structure loaded left the box around the origin, so most blocks
  cast no shadow). Shadows use PCFShadowMap (recent three.js removed PCFSoftShadowMap and warns about it).
- The SDK build drops `console.log / info / debug`; `BlueprintLoader` no longer fails when the host renderer has no
  `options` or event emitter.
- **A new build gets a new version number**: SDK version folders are cached for a long time, so files replaced under the
  same version keep being served from browsers' caches.

## 1.2.0 (2026-11-18)

- Added `camera.setFrame / getFrame`, `camera.setPose / getPose`, `setMode('first', { input: 'host' })` and
  `workshop.solids()` (`src/solids.ts`, `src/collision.ts`): host-driven framing and first person (walking and flying).
- Added lightweight shading in `src/shading.ts` (`shading` and `shadingQuality` of `applyRenderSettings`) and multisampled
  anti-aliasing (`postProcessingOptions.multisampling`).
- Stronger ambient occlusion (radius 2 blocks, 1.2 orthographic), built from the preset instead of hard-coded old values.
  Perspective near plane 1 → 0.05 blocks.
- Fixed: Nucleation failed to start when the host page has a `process` stand-in in the browser (`nucleation/runtime.ts`).
- `packageManager` and `devEngines` in `package.json` named different pnpm versions (12.14.0 and 12.16.1), so installing
  through corepack failed; they now agree.
- The SDK build (`pnpm build:sdk`) drops `console.log / info / debug` and keeps warnings and errors.
- Shading: every model casts shadows and the shadow map draws both faces (with single-sided materials only back faces were
  drawn, so meshes without hidden faces left many surfaces without shadow); chunks outside the view are not culled while
  shading is on.
- Fixed: `BlueprintLoader` read properties of a host renderer without `options` or an event emitter and failed (five
  existing Node tests); the entity model count test went from 369 to 388.

## [1.1.1] - 2026-11-17

### Fixed

- **Java vanilla structures (`.nbt`, the files a structure block saves) did not open and threw
  `NucleationError.InvalidArgument`**: Nucleation 0.10's `fromData` does not read that format (it reads litematic, Sponge
  schem, mcstructure and world saves). `SchematicManager` tries `fromData` first and, when that fails and the bytes are a
  vanilla structure, reads them with `nucleation/vanilla-structure.ts`: decompress (gzip / zlib / none) → NBT → one
  `setBlocks` per block state, with block entities converted to SNBT as they are and passed to `setBlockFromString` (sign
  text and container contents included). Checked on a real structure: 13,532 blocks, 274 states and 135 block entities,
  none lost.

## [1.1.0] - 2026-11-16

Runtime-loaded SDK builds: the renderer can be published as versioned SDK folders that a host page imports at runtime
(see `docs/renderer/SDK.md`).

### Added

- Renderer option `chunkLoading: { minIntervalMs }` (same name as in the Bedrock package): meshes are built incrementally,
  one chunk per batch (`chunkSideLength`, 16³ by default), each taking at least `minIntervalMs` milliseconds with the rest
  of the time left idle; progress through `callbacks.onChunkProgress(id, done, total)` and the `schematicChunkProgress`
  event. Chunk-by-chunk loading no longer logs a `[SceneAdd]` line per batch.
- `BlueprintLoader.load(buffer, filename, { onStart, onChunk, signal })` (and `Workshop.load`): with chunk-by-chunk loading
  a structure shows while it is built, the old structure is removed once the new one has been parsed, and a new `load`
  aborts one still in progress (`AbortError`); `abortError()`, `isAbortError(e)`.
- `CameraControls.getView()` / `setView({ yaw, pitch, zoom })`: a view for share links, with the same conventions as the
  Bedrock package.
- `src/sdk.ts`: `SDK_API` (the contract version between hosts and the renderers, currently 1), `SDK_EDITION`,
  `SDK_VERSION`.
- `vite.sdk.config.mjs` and `pnpm build:sdk`: `sdk/mc-java-render/<version>/index.js` (three, Nucleation and everything
  else bundled, chunks loaded on demand in `chunks/`), plus `release.json`.

## [Unreleased]

### Added

- ESLint and Prettier configuration for code quality
- Pre-commit hooks with Husky and lint-staged
- GitHub Actions CI/CD pipelines for testing and publishing
- Comprehensive test suite with Vitest
- Dual publishing to npm and GitHub Packages

### Entities

- Entity ids resolve to a rendering plan (`resolveEntityPlan`) instead of "the model with the same name": aliases (`ender_dragon` → `dragon`, `bamboo_raft` → `raft`, `leash_knot` → `lead_knot`, `creaking_transient`, `mannequin`), pufferfish shape and tropical fish pattern/dyes from NBT, and renderer scales (`giant` ×6, `ghast` ×4.5, `wither` ×2, `elder_guardian` ×2.35, `cave_spider` ×0.7, `wither_skeleton` ×1.2, ...)
- Overlay layers that the game draws on a default mob: sheep wool (dyed, unless sheared), mooshroom mushrooms, slime shell (blended), drowned/stray/bogged outer layers
- Tack, chests and arms the entity does not have are hidden (horses, donkeys, mules, llamas, camels, armor stands)
- Minecarts carry their block; primed TNT, falling blocks and block displays are drawn from the block models
- New catalog models derived from the pack's textures: `poplar_boat`, `poplar_chest_boat`, `camel_husk`, `happy_ghast`, `cushion`, `sulfur_cube`, `copper_golem`, `tropical_fish_pattern_{a,b}_1..6` (`scripts/generate-entity-models.mjs`)
- Dropped items, item displays, item frames (and glow frames), paintings, text displays, thrown items and projectiles (snowball, egg, ender pearl, potions, bottle o' enchanting, eye of ender, fireballs, firework rocket, dragon fireball), experience orbs and fishing bobbers are drawn: items as slabs of their pack texture (resolved from the item definition, layers and tints included), projectiles and orbs facing the camera, frames and paintings turned the way they hang
- Entities the game never draws (marker, interaction, area effect cloud, ominous item spawner, lightning bolt) get a debug shape that marks their position; `EntityManager#setShowDebug` hides them, and the example has a switch
- `EntityRecord.status` gains `placeholder` (hitbox stand-in for mobs without geometry), `debug` and `invisible` (nothing to draw), with a `note`
- The inspection schematic places paintings, frames and displays the way the game stores them (frames 0.46875 behind their block's centre, displays centred), so they no longer sink into the floor

### Blocks

- Spawners, trial spawners and vaults draw their inner faces where they belong. Those models list a second cube with its corners reversed on x (`from` 16 to `to` 0) so that its faces point inward; the element centre was computed as `from + max(0, to - from) / 2`, which put that cube half a block to the east, and the optimised path collapsed its faces to a line. The centre is now the midpoint of the corners in both paths, and the optimised path keeps the signed size, so the faces stay turned inward (`snow` layer 2 had the same element)
- Blocks whose block model has no geometry used to render as nothing: skeleton, wither skeleton, zombie, creeper, piglin and dragon heads (floor and wall), copper golem statues (every oxidation stage, waxed or not), conduits, end portals and end gateways. They now go through block-entity renderers that draw catalog models in instanced meshes (`createModelOverlay`), with the pack's texture so resource packs can reskin them. Statues are drawn standing whatever their pose, and a conduit is its shell only, because the poses and the active parts are not in the pack
- Barriers, light blocks, structure voids and moving pistons get a small marker where they are; `blockEntityOptions.invisibleBlocks: false` turns it off, and the overlay is named `INVISIBLE_BLOCKS_OVERLAY_NAME` so a viewer can hide it

### Changed

- Standardized on npm with a committed package-lock.json, reproducible npm ci installs, and Node.js 24 in CI
- Updated package.json with repository metadata and keywords
- Asset loader no longer warns that the built-in `builtin/*` parent models are missing

- All-blocks and all-entities inspection schematics (with CSV position indexes) in the example, regenerated by `scripts/generate-coverage-schematics.mjs`
- A labelled sign above every block and entity in the inspection schematics, so unrendered objects can still be picked

### Fixed

- Entities in the all-entities inspection schematic are centred on their cells (their positions were a half block off)

### Removed

- Per-entity model specialization and the orange entity marker: every entity now uses its same-named model or is not drawn
- Icon lookup fallbacks: icons resolve through the item definition, its model and one model texture
- Old `.tgz` package files from the repository

## [1.1.17] - 2025-01-14

### Added

- RenderSettingsUI component for managing render settings
- ExportUI component for schematic export management
- Enhanced camera and schematic handling for tighter framing

### Changed

- Bump version and enhance resource pack management
- Update dependencies

## [1.1.0] - Previous

### Added

- Initial public release
- Three.js-based schematic rendering
- Support for Litematic and NBT formats
- Isometric and perspective camera modes
- SSAO and post-processing effects
- HDRI background support
- Web Worker-based mesh building
- WASM mesh builder option for performance
