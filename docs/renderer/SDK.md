# SDK build for host pages

Besides the npm package, the renderer can be built as a self-contained SDK folder that a page loads at runtime with
`import()`. A host keeps such folders on its server (for example under `/sdk/`), lists the current one in a manifest, and
imports it when a visitor opens a 3D view. A renderer fix then only needs a new version folder and a manifest update; the
host page itself is not rebuilt.

## Building

```bash
pnpm install --frozen-lockfile
pnpm build:sdk                     # → sdk/mc-java-render/<version>/
SDK_OUT=/tmp/out pnpm build:sdk    # another output root
SDK_SOURCEMAP=1 pnpm build:sdk     # include source maps (the entry's map alone is about 5 MB)
```

Output:

```
sdk/mc-java-render/<version>/
  index.js          the entry a host imports
  chunks/*.js       chunks loaded on demand (Nucleation is a dynamic import in runtime.ts: its own chunk, downloaded
                    when the first structure loads)
  release.json      { edition, name, version, api, entry }: what a host's manifest needs
```

`vite.sdk.config.mjs` differs from the npm build (`vite.config.mjs`) in one way: **nothing is external** (the npm package
leaves three and Nucleation to the consumer's bundler; the SDK has to run on its own). Library mode, ES format, wasm inlined
as `data:` URLs and workers as `?worker&inline` (`blob:` URLs) are the same as in the npm build. The version comes from
package.json; the build fails when `SDK_VERSION` in `src/sdk.ts` does not match.

## The contract version `SDK_API`

`SDK_API` in `src/sdk.ts` (currently 1) versions the members a host calls on both renderers (Java and Bedrock):
`createWorkshop`, `Workshop.load` and its three callbacks, `camera.fit / setMode / getView / setView`,
`renderer.setBackgroundColor`, `screenshot`, `dispose`, `applyRenderSettings`, `isAbortError`, and the renderer option
`chunkLoading`. Bug fixes and new optional members leave it unchanged. Only when the name, parameters or return value of one
of these members changes do both renderers and their hosts bump it together, so a host can tell the visitor that the
renderer and the page do not match instead of failing halfway.

## Checking a build

1. `pnpm typecheck` and `pnpm test`.
2. `ls sdk/mc-java-render/<version>/`: there is an `index.js`, and one chunk in `chunks/` is clearly larger than the others
   (Nucleation and its wasm).
3. Serve `sdk/` from any static server and run in the browser console:
   ```js
   const m = await import("/sdk/mc-java-render/<version>/index.js");
   [m.SDK_API, m.SDK_EDITION, m.SDK_VERSION, typeof m.createWorkshop]   // [1, "java", "<version>", "function"]
   ```

## When Nucleation does not bundle

If `pnpm build:sdk` fails, or the browser reports that Nucleation failed to initialize when a structure loads:

- Check whether the error is about the wasm URL. Library mode inlines `new URL("x.wasm", import.meta.url)` as a `data:` URL;
  if Nucleation used `import x from "./x.wasm"` (a bundler's wasm integration), a plugin such as `vite-plugin-wasm` would
  be needed, or `inlineWasm` limited to this repository's own wasm (`src/renderer/wasm/`).
- Fallback: Nucleation ships a UMD build for browsers, and `src/renderer/nucleation/runtime.ts` uses `globalThis.Nucleation`
  first. Copy it into the version folder, load it before `index.js` (or have the host load it), and mark `nucleation` as
  external again in the build configuration.

## 1.2.0: framing, first person and shading (added together with the Bedrock package)

All of these are new optional members, so `SDK_API` stays 1: a host checks that a member exists before using it, and older
renderer builds keep working without the feature.

| Member | Purpose |
| --- | --- |
| `camera.setFrame({ yaw, pitch, distance?, fov?, halfHeight? })` | A framing computed by the host: the target stays (the structure's centre after `fit()`); perspective sets the field of view (radians) and distance, orthographic sets the half height of the view (blocks). Lets several views of one structure use exactly the same camera. |
| `camera.getFrame()` | The current framing (plus `ortho`); the inverse of `setFrame`. |
| `camera.setMode('first', { input: 'host' })` | First person driven by the host: the built-in flight controls (pointer lock, WASD) stay off, and so does drag rotation. |
| `camera.setPose({ x, y, z, yaw, pitch })` / `getPose()` | The first-person eye: world position and direction (yaw 0 faces +z and grows toward +x; pitch above 0 looks up). The orbit controls' target sits one block in front of the eye, so their updates do not turn the view. |
| `workshop.solids()` | The structure's collision cells `{ origin, min, max, height(i, j, k) }`: cell (i, j, k) covers `origin + [i, i+1]×[j, j+1]×[k, k+1]`, with a height of 0 (passable), 0.5 (lower half: slabs, stairs, beds) or 1 (full). The block rules live in `src/collision.ts`, shared by both packages, and read Java `[props]` as well as Bedrock states. |
| `postProcessingOptions.enableSMAA` / `multisampling` | Anti-aliasing: SMAA (on by default); multisampling sample count (0 is off, 4 is "high"). |
| `applyRenderSettings(renderer, { shading, shadingQuality })` | Lightweight shading: a warm sun with soft shadows (the shadow box fitted to the structure) and a sky / ground hemisphere light in place of most of the flat ambient light. `shadingQuality: 'high'` uses a 4096 shadow map, otherwise 2048. Call it again when the structure changes (the Bedrock package refits by itself). |

The same release moved the perspective near plane from 1 block to 0.05 (the camera can get right up to a block) and
strengthened ambient occlusion to a radius of 2 blocks (1.2 orthographic); before, it was barely visible, and the Java
package had hard-coded old values instead of using the preset.

Also:

- Nucleation's wasm loader decides whether it runs in Node only by looking for a global `process`. When a host puts a
  `process` stand-in into the browser (Nuxt's dev server, webpack polyfills), it takes the Node path and fails with
  `fs.readFileSync is not a function`. `src/renderer/nucleation/runtime.ts` now hides such a stand-in (one without
  `versions.node`) while Nucleation loads, and restores it afterwards.
- The canvas sizes its drawing buffer from its **parent element** (RenderManager reads
  `parentElement.clientWidth / clientHeight`). For off-screen rendering, wrap the canvas in a box of a fixed size; attached
  directly to `body` it takes the size of the whole page.
