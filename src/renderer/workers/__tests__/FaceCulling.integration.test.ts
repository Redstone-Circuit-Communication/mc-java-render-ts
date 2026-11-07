import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { BoxGeometry } from "three";
import { readFileSync } from "node:fs";
import { initSync, MeshBuilder } from "../../wasm/mesh_builder_wasm.js";
import { boundaryFace, getSelfCullGroup } from "../../utils/faceCulling";
function geometry(height = 1, center = 0) {
	const g = new BoxGeometry(1, height, 1).translate(0, center, 0);
	if (!g.index) throw new Error("Missing indices");
	return {
		positions: g.attributes.position.array,
		normals: g.attributes.normal.array,
		uvs: g.attributes.uv.array,
		indices: new Uint32Array(g.index.array),
		materialIndex: 0,
	};
}
const cube = geometry();
const stone = { index: 0, category: "solid", occlusionFlags: 63, geometries: [cube] };
const glass = {
	index: 1,
	category: "transparent",
	occlusionFlags: 0,
	selfOcclusionFlags: 63,
	cullGroup: "minecraft:glass",
	geometries: [cube],
};
const cases = [
	{
		name: "upper slab underside and air gap remain visible",
		palette: [
			stone,
			{ index: 1, category: "solid", occlusionFlags: 8, geometries: [geometry(0.5, 0.25)] },
		],
		blocks: [0, -1, 0, 0, 0, 0, 0, 1],
		triangles: 24,
	},
	{
		name: "lower slab touching solid culls both contact faces",
		palette: [
			stone,
			{ index: 1, category: "solid", occlusionFlags: 4, geometries: [geometry(0.5, -0.25)] },
		],
		blocks: [0, -1, 0, 0, 0, 0, 0, 1],
		triangles: 20,
	},
	{
		name: "matching glass hides its internal faces",
		palette: [glass],
		blocks: [0, 0, 0, 1, 1, 0, 0, 1],
		triangles: 20,
	},
	{
		name: "different glass colors preserve the interface",
		palette: [glass, { ...glass, index: 2, cullGroup: "minecraft:red_stained_glass" }],
		blocks: [0, 0, 0, 1, 1, 0, 0, 2],
		triangles: 24,
	},
	{
		name: "glass cannot hide stone, but stone hides touching glass",
		palette: [stone, glass],
		blocks: [0, 0, 0, 0, 1, 0, 0, 1],
		triangles: 22,
	},
	{
		name: "opaque neighbors hide their shared faces",
		palette: [stone],
		blocks: [0, 0, 0, 0, 1, 0, 0, 0],
		triangles: 20,
	},
	{
		name: "glass culling crosses chunk seams",
		palette: [glass],
		blocks: [15, 0, 0, 1],
		apron: [16, 0, 0, 1],
		triangles: 10,
	},
];
let handler: (e: MessageEvent) => void;
const postMessage = vi.fn();
beforeAll(async () => {
	const worker: { onmessage: ((e: MessageEvent) => void) | null; postMessage: typeof postMessage } =
		{ onmessage: null, postMessage };
	vi.stubGlobal("self", worker);
	await import("../MeshBuilder.worker");
	if (!worker.onmessage) throw new Error("Worker did not initialize");
	handler = worker.onmessage;
	initSync({ module: readFileSync("src/renderer/wasm/mesh_builder_wasm_bg.wasm") });
});
afterAll(() => vi.unstubAllGlobals());
for (const backend of ["JavaScript", "WASM"])
	describe(`${backend} actual mesh output`, () => {
		for (const scenario of cases)
			it(scenario.name, () => {
				let meshes;
				if (backend === "JavaScript") {
					postMessage.mockClear();
					handler({
						data: { type: "updatePalette", paletteData: scenario.palette },
					} as MessageEvent);
					handler({
						data: {
							type: "buildChunk",
							chunkId: "test",
							blocks: new Int32Array(scenario.blocks),
							chunkOrigin: [0, 0, 0],
							apronBlocks: new Int32Array(scenario.apron ?? []),
						},
					} as MessageEvent);
					const result = postMessage.mock.calls
						.map((c) => c[0])
						.find((m) => m.type === "chunkBuilt");
					expect(result).toBeDefined();
					meshes = result.meshes;
				} else {
					const mb = new MeshBuilder();
					mb.update_palette(scenario.palette);
					meshes = mb.build_chunk(
						new Int32Array(scenario.blocks),
						0,
						0,
						0,
						new Int32Array(scenario.apron ?? [])
					).meshes;
					mb.free();
				}
				expect(
					meshes.reduce((n: number, m: { indices: Uint32Array }) => n + m.indices.length / 3, 0)
				).toBe(scenario.triangles);
			});
	});
it("inset/slanted triangles are never mistaken for block boundaries", () => {
	expect(
		boundaryFace([0.5, 0, 0, 0.25, 1, 0, 0.5, 0, 1], [1, 0, 0, 1, 0, 0, 1, 0, 0], [0, 1, 2], 0)
	).toBe(-1);
	expect(
		boundaryFace(
			[0.5, 0, 0, 0.5, 1, 0, 0.5, 0, 1],
			[0.95, 0.2, 0, 0.95, 0.2, 0, 0.95, 0.2, 0],
			[0, 1, 2],
			0
		)
	).toBe(-1);
	expect(getSelfCullGroup("minecraft:glass")).toBe("minecraft:glass");
	expect(getSelfCullGroup("minecraft:glass_pane")).toBe("");
	expect(getSelfCullGroup("minecraft:ice")).toBe("");
});
