# mc-java-render-ts

English | [简体中文](README.zh-CN.md)

A browser renderer for Minecraft **Java Edition** structures: Litematica `.litematic`, Sponge `.schem`, MCEdit
`.schematic` and vanilla structure `.nbt` files, drawn with three.js from a standard resource pack. It powers the 3D view
of [Redstone Archive](https://redstonearchive.top) and is a fork of
[schematic-renderer](https://github.com/CoastlineCreations/schematic-renderer).

**Live example:** <https://redstone-circuit-communication.github.io/mc-java-render-ts/> (English, with a switch to Chinese)

Its Bedrock Edition sibling, [mc-bedrock-render-ts](https://github.com/Redstone-Circuit-Communication/mc-bedrock-render-ts),
exposes the same API for `.mcstructure` files.

## Features

- Mesh building in Web Workers, with chunk-by-chunk loading for large structures
- Any Java resource pack, or several layered on top of each other
- Orbit, orthographic and first-person cameras, plus a host-driven camera API (frames, poses) for custom controls
- Block and entity picking, container inventories, redstone state readouts and material lists
- Inventory-style item icons, and English or Simplified Chinese names and readouts (`setLocale`)
- Screen-space ambient occlusion, SMAA / MSAA anti-aliasing and optional sun shadows
- A self-contained ES module build (`pnpm build:sdk`) that a site can load at runtime

## Usage

```ts
import { createWorkshop } from "@rsw/mc-java-render-ts";

const workshop = await createWorkshop({
	canvas,
	// one pack, or several layered in order: later packs override earlier ones
	resourcePackUrl: ["/packs/vanilla.zip", "/packs/my-textures.zip"],
});
const result = await workshop.load(buffer, "door.litematic"); // or loadFile(file)
await workshop.camera.fit();
console.log(result.dimensions, result.totalBlocks);
workshop.camera.setMode("ortho"); // "orbit" | "first" | "ortho"
const png = await workshop.screenshot();
await workshop.dispose();
```

Large structures can stream in one 16³ chunk at a time:

```ts
const workshop = await createWorkshop({ canvas, resourcePackUrl, rendererOptions: { chunkLoading: { minIntervalMs: 50 } } });
await workshop.load(buffer, "base.litematic", {
	onStart: () => workshop.camera.fit(), // before the first chunk: the size is known
	onChunk: (done, total) => progress(done, total),
	signal, // abort between two chunks
});
```

`docs/renderer/SDK.md` describes the runtime-loaded SDK build and the camera, first-person and shading APIs.

### Text and icons

The text the library produces (block and entity names, container titles, redstone readouts, CSV headers) is English by
default:

```ts
import { setLocale, nameFor, ItemAssets } from "@rsw/mc-java-render-ts";

setLocale("zh-CN");              // or "en"
nameFor("minecraft:chest");      // "箱子"

// icons as object URLs; with `renderer`, block items are drawn in 3D the way the inventory shows them
const assets = new ItemAssets(workshop.renderer.cubane.getAssetLoader(), { renderer: workshop.renderer });
assets.decorate(element, "minecraft:furnace");
```

## Resource packs

The library ships no game assets. It needs a Java resource pack that contains block states and models as well as
textures, which in practice means the game's own assets, optionally with a texture pack layered on top. The Minecraft
client jar itself works as a pack: its `assets/` folder has the same layout.

Java Edition keeps entity geometry in code rather than in resource packs, so the library carries a catalog of entity
models (`src/renderer/cubane/entity-models/`, from the upstream project). Models the catalog lacks are converted from
Mojang's official Bedrock geometry by `scripts/generate-entity-models.mjs`; mobs that still have no model are drawn as a
hitbox-sized stand-in.

The example bundles nothing from Minecraft. The visitor's browser downloads the official client jar of Minecraft 26.3
from Mojang's servers (`piston-data.mojang.com`, about 41 MB, cached after the first visit), the same file the launcher
downloads. To use another version, take the `downloads.client.url` of that version from Mojang's
[version manifest](https://piston-meta.mojang.com/mc/game/version_manifest_v2.json).

## Development

```bash
pnpm install
pnpm build              # dist/ (ES modules and type declarations)
pnpm test               # build, consumer type check, Node tests and Vitest
pnpm lint
pnpm dev:example        # example at http://localhost:5173
pnpm build:example      # example/dist, as deployed to GitHub Pages
pnpm build:sdk          # sdk/mc-java-render/<version>/ for runtime loading
pnpm schematics:coverage   # regenerate the every-block / every-entity example schematics
```

The development scripts read the official client jar, downloaded from Mojang into `.cache/` (not committed) the first time
they need it. The example page is English by default and follows a Chinese browser language; its strings are in
`example/src/i18n.js`.

The mesh builder written in Rust lives in `mesh_builder_wasm/`; its prebuilt output is checked in under
`src/renderer/wasm/`.

## License

[AGPL-3.0-only](LICENSE), inherited from the upstream project. If you run a modified version of this library on a
network service, the AGPL requires you to offer its source code to the users of that service.

Changes made in this fork are recorded in [docs/renderer/CHANGELOG.md](docs/renderer/CHANGELOG.md); third-party notices
are in [NOTICE.md](NOTICE.md).

## Acknowledgements

- [schematic-renderer](https://github.com/CoastlineCreations/schematic-renderer) and its asset pipeline, Cubane, by
  CoastlineCreations (AGPL-3.0-only): the upstream project this library is forked from.
- [Nucleation](https://github.com/CoastlineCreations/nucleation) by CoastlineCreations (MIT): schematic parsing.
- [three.js](https://github.com/mrdoob/three.js) (MIT), [postprocessing](https://github.com/pmndrs/postprocessing) (Zlib)
  and [N8AO](https://github.com/N8python/n8ao) (ISC): rendering and post-processing.
- [ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm) (MIT), [JSZip](https://github.com/Stuk/jszip) (MIT) and
  [lil-gui](https://github.com/georgealways/lil-gui) (MIT).

Minecraft is a trademark of Mojang AB. This project is not an official Minecraft product and is not associated with
Mojang or Microsoft.
