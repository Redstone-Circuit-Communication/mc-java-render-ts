# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 1.2.1（2026-11-18）

- 光影：所有模型都投影，阴影图画正反两面；逐块加载时阴影框跟着结构一起长（以前宿主在结构加载前打开光影，阴影框停在原点周围 16 格，大部分方块不投影）；阴影改用 PCFShadowMap（three r18x 去掉了 PCFSoftShadowMap，用它会报警告）。
- 给站点的构建去掉 `console.log / info / debug`；`BlueprintLoader` 在宿主渲染器没有 `options`、事件发射器时不再报错。
- **换了内容就换版本号**：1.2.0 的目录在线上会被长期缓存，同一个版本号里换文件，看过的浏览器还是用旧的。

## 1.2.0（2026-11-18）

- 新增 `camera.setFrame / getFrame`、`camera.setPose / getPose`、`setMode('first', { input: 'host' })`、`workshop.solids()`（`src/solids.ts`、`src/collision.ts`）：站点的取景和第一人称（行走、飞行）。
- 新增轻量光影 `src/shading.ts`（`applyRenderSettings` 的 `shading`、`shadingQuality`）；抗锯齿的多重采样 `postProcessingOptions.multisampling`。
- 环境光遮蔽加强（半径 2 格 / 正交 1.2 格）；建遮蔽效果时用预设，不再写死旧值。透视的最近距离 1 → 0.05 格。
- 修：宿主在浏览器里有 `process` 替身时 nucleation 起不来（`nucleation/runtime.ts`）。
- `package.json` 的 `packageManager` 和 `devEngines` 写的 pnpm 版本不一样（12.14.0 和 12.16.1），用 corepack 装依赖直接失败；改成一致。
- 给站点的构建（`pnpm build:sdk`）去掉 `console.log / info / debug`，只留警告和错误。
- 光影：所有模型都投影，阴影图画正反两面（单面材质只画背面时，去掉了隐藏面的方块网格有很多表面不投影）；开光影时不裁剪镜头外的区块。
- 修：宿主的渲染器没有 `options` 或事件发射器时，`BlueprintLoader` 读属性报错（原来就有的 5 项 Node 测试失败）；实体模型数量的测试从 369 改成 388。

## [1.1.1] - 2026-11-17

### Fixed

- **Java 原版结构 `.nbt`（结构方块存的文件）打不开，报 `NucleationError.InvalidArgument`**：nucleation 0.10 的 `fromData` 不认这种格式（它认 litematic、Sponge schem、
  mcstructure、存档），而站点上的 Java 作品全是这种。`SchematicManager` 先试 `fromData`，失败了而且字节是原版结构，就用 `nucleation/vanilla-structure.ts` 自己读：
  解压（gzip / zlib / 未压缩）→ NBT → 同一个方块状态一次 `setBlocks`，方块实体按类型原样转成 SNBT 交给 `setBlockFromString`（告示牌的字、容器里的东西都在）。
  用一份真实投稿验证：13,532 个方块、274 种状态、135 个方块实体，一个没丢。**写进 nucleation 这一步没有在写的环境里实测**（没有 nucleation），请跑 `pnpm test`。

## [1.1.0] - 2026-11-16

站点接入（作品页、审核页的 3D 视图）：渲染库不编进站点，按版本放在独立的 SDK 目录里运行时加载（见 `docs/renderer/SDK.md`）。**这一版的改动没有在写的环境里构建和测试过**（没有 three、nucleation），请先跑 `pnpm typecheck`、`pnpm test`、`pnpm build:sdk`。

### Added

- 渲染器选项 `chunkLoading: { minIntervalMs }`（和基岩包同名）：按 `incremental` 构建，一批一个区块（`chunkSideLength`，默认 16³），每块至少 `minIntervalMs` 毫秒，剩下的时间空着；
  进度 `callbacks.onChunkProgress(id, done, total)` 和事件 `schematicChunkProgress`。逐块加载时不再每批打一行 `[SceneAdd]` 日志。
- `BlueprintLoader.load(buffer, filename, { onStart, onChunk, signal })`（`Workshop.load` 同）：逐块加载时结构边建边显示，旧结构在新结构解析好之后移除，新的 `load` 取消还在加载的那一次（`AbortError`）；`abortError()`、`isAbortError(e)`。
- `CameraControls.getView()` / `setView({ yaw, pitch, zoom })`：分享链接里的视角，约定和基岩包相同（`docs/UNIFIED_API.md` 第 1 条原样加入）。
- `src/sdk.ts`：`SDK_API`（站点和渲染库的约定版本，现在是 1）、`SDK_EDITION`、`SDK_VERSION`。
- `vite.sdk.config.mjs` 与 `pnpm build:sdk`：`sdk/mc-java-render/<版本>/index.js`（three、nucleation 等全部打进去，按需加载的分块在 `chunks/`），附 `release.json`。

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
