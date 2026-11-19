# Notices

mc-java-render-ts is a fork of [schematic-renderer](https://github.com/CoastlineCreations/schematic-renderer) by
CoastlineCreations, licensed under the GNU Affero General Public License v3.0 only (see `LICENSE`). The upstream copyright
notices are kept; changes made in this fork are listed in `docs/renderer/CHANGELOG.md`.

## Code from the upstream project

As a fork, most of `src/renderer/` is upstream code. This includes the Rust mesh builder in `mesh_builder_wasm/` with its
prebuilt output in `src/renderer/wasm/`, and `src/renderer/effects/GammaCorrectionEffect.ts`.

## Bundled dependencies

The SDK build bundles the following packages; their license texts ship with each package.

| Package | License |
| --- | --- |
| [Nucleation](https://github.com/CoastlineCreations/nucleation) | MIT |
| [three.js](https://github.com/mrdoob/three.js) | MIT |
| [postprocessing](https://github.com/pmndrs/postprocessing) | Zlib |
| [N8AO](https://github.com/N8python/n8ao) | ISC |
| [JSZip](https://github.com/Stuk/jszip) | MIT (dual-licensed MIT or GPL-3.0-or-later) |
| [lil-gui](https://github.com/georgealways/lil-gui) | MIT |
| [ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm) (loaded on demand for video recording) | MIT |

## Example assets

- The example downloads the official Minecraft client jar from Mojang's servers in the visitor's browser at runtime;
  no Minecraft assets are bundled with it or published with it.
- The development scripts in `scripts/` read the same official client jar, downloaded from Mojang into `.cache/` (not
  committed) on first use. Entity models that the bundled catalog lacks are converted from Mojang's official Bedrock
  geometry (github.com/Mojang/bedrock-samples) by `scripts/generate-entity-models.mjs`.

Minecraft is a trademark of Mojang AB. Minecraft assets are © Mojang AB. This project is not an official Minecraft product
and is not associated with Mojang or Microsoft.
