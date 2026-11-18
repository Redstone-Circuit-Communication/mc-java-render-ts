import { defineConfig } from "vite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// The site's SDK directory (docs/renderer/SDK.md): `pnpm build:sdk` → sdk/mc-java-render/<version>/index.js
// (+ chunks loaded on demand). The site imports index.js at runtime with import(), so nothing is external here:
// three, nucleation and every other dependency are bundled. Unlike vite.config.mjs (the npm package, where the
// consumer's bundler provides three and nucleation) this output must run on its own.
//
// Library mode keeps the entry's exports and inlines assets as data: URLs (the wasm files), so the directory can be
// copied anywhere; dynamic imports (nucleation) stay separate chunks next to index.js and are fetched only when used.
// Workers are `?worker&inline` (blob: URLs), which is why the site's CSP needs `worker-src blob:`.
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const declared = /SDK_VERSION = "([^"]+)"/.exec(readFileSync("src/sdk.ts", "utf8"))?.[1];
if (declared !== pkg.version)
	throw new Error(`src/sdk.ts SDK_VERSION (${declared}) and package.json version (${pkg.version}) differ`);
const outDir = `${process.env.SDK_OUT ?? "sdk"}/mc-java-render/${pkg.version}`;

const inlineWasm = () => ({
	name: "inline-wasm",
	enforce: "pre",
	load(id) {
		const path = id.split("?")[0];
		if (path.endsWith(".wasm")) {
			const url = "data:application/wasm;base64," + readFileSync(path).toString("base64");
			return "export default " + JSON.stringify(url);
		}
	},
});
const releaseJson = () => ({
	name: "sdk-release-json",
	generateBundle() {
		const api = Number(/SDK_API = (\d+)/.exec(readFileSync("src/sdk.ts", "utf8"))?.[1]);
		this.emitFile({
			type: "asset",
			fileName: "release.json",
			source: JSON.stringify({ edition: "java", name: pkg.name, version: pkg.version, api, entry: "index.js" }, null, 2) + "\n",
		});
	},
});

/**
 * The site build is quiet: `console.log / info / debug` calls in this package's own sources become `(void 0)?.(...)`
 * (the arguments are not even evaluated, the minifier drops them). The renderer logs a lot while it works ([ChunkTiming],
 * [ResourcePackManager] …); visitors' consoles should only show warnings and errors. The npm build keeps every log.
 */
const quietLogs = () => ({
	name: "sdk-quiet-logs",
	enforce: "pre",
	transform(code, id) {
		const path = id.split("?")[0];
		if (!path.includes("/src/") || path.includes("/node_modules/") || !/\.(ts|js|mjs)$/.test(path)) return null;
		if (!/console\.(log|info|debug)\s*\(/.test(code)) return null;
		return { code: code.replace(/\bconsole\.(log|info|debug)\s*\(/g, "(void 0)?.("), map: null };
	},
});

export default defineConfig({
	publicDir: false,
	build: {
		target: "es2022",
		outDir,
		emptyOutDir: true,
		copyPublicDir: false,
		// 源码映射默认不发（入口的映射就有 5 MB）；要排查线上问题时 SDK_SOURCEMAP=1 pnpm build:sdk
		sourcemap: process.env.SDK_SOURCEMAP === "1",
		lib: {
			entry: { index: resolve("src/index.ts") },
			formats: ["es"],
			fileName: () => "index.js",
		},
		rolldownOptions: {
			// Bundle everything (the npm build externalizes three and nucleation; the SDK must not)
			external: [],
			output: { chunkFileNames: "chunks/[name]-[hash].js" },
		},
	},
	plugins: [quietLogs(), inlineWasm(), releaseJson()],
	define: { global: "globalThis", "process.env.NODE_ENV": JSON.stringify("production") },
	worker: { format: "es", plugins: () => [quietLogs(), inlineWasm()] },
});
