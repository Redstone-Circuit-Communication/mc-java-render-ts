import { defineConfig } from "vite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

// Keep the SDK's module addresses (including its worker entry) and bundle the
// browser renderer once. Vite shares common chunks between the public entries.
const entries = [
	...readdirSync("src")
		.filter((file) => file.endsWith(".ts"))
		.map((file) => file.slice(0, -3)),
	"renderer/index",
	"mesh/core/index",
	"mesh/three/index",
	"mesh/worker/index",
	"mesh/worker/entry",
];
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
export default defineConfig({
	build: {
		target: "es2022",
		copyPublicDir: false,
		lib: {
			entry: Object.fromEntries(entries.map((name) => [name, resolve("src", name + ".ts")])),
			formats: ["es"],
			fileName: (_, name) => name + ".js",
		},
		rolldownOptions: {
			external: (id) => id === "nucleation" || id === "three" || id.startsWith("three/"),
		},
	},
	plugins: [inlineWasm()],
	define: { global: "globalThis" },
	worker: { format: "es", plugins: () => [inlineWasm()] },
	test: {
		globals: true,
		environment: "happy-dom",
		include: ["src/renderer/**/*.{test,spec}.ts"],
		setupFiles: ["src/renderer/test/setup.ts"],
	},
});
