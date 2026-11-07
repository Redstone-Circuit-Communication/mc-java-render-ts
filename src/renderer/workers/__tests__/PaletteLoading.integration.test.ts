import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { WorldMeshBuilder } from "../../WorldMeshBuilder";
import { Cubane } from "../../cubane/Cubane";
import { LegacyMeshBuilder } from "../LegacyMeshBuilder";
import { initializeNucleationWasm, SchematicWrapper } from "../../nucleationExports";
import type { SchematicRenderer } from "../../SchematicRenderer";
import type { PaletteItem } from "../../../mesh/core/index";

vi.unmock("nucleation");
vi.unmock("../../nucleationExports");
vi.mock("../MeshBuilder.worker?worker&inline", () => ({ default: class {} }));
vi.mock("../MeshBuilderWasm.worker?worker&inline", () => ({ default: class {} }));

beforeAll(() => initializeNucleationWasm());
const cleanup: (() => void)[] = [];
afterEach(() => {
	while (cleanup.length) cleanup.pop()?.();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

function fixture() {
	const worker = { postMessage: vi.fn(), terminate: vi.fn() };
	const renderer = {
		options: {
			context: {
				getSharedWorkers: () => [worker],
				sharedFreeWorkers: [worker],
				sharedWorkerQueue: [],
			},
		},
	} as unknown as SchematicRenderer;
	const cubane = new Cubane({ autoRestore: false });
	const actualGetMesh = cubane.getBlockMesh.bind(cubane);
	const geometry = new THREE.BoxGeometry(),
		material = new THREE.MeshBasicMaterial();
	vi.spyOn(cubane, "getBlockMesh").mockImplementation(async (name) => {
		// Exercise the real sign delegation path; GPU/textures are unnecessary
		// for testing whether palette IDs survive the main-thread/worker boundary.
		if (name.split("[", 1)[0].endsWith("_sign")) return actualGetMesh(name);
		const group = new THREE.Group();
		if (!name.endsWith(":air") && name !== "minecraft:structure_void")
			group.add(new THREE.Mesh(geometry, material));
		return group;
	});
	vi.spyOn(cubane, "getBlockOptimizationData").mockResolvedValue(null as never);
	const builder = new WorldMeshBuilder(renderer, cubane);
	cleanup.push(() => {
		builder.dispose();
		cubane.dispose();
		geometry.dispose();
		material.dispose();
	});
	return {
		builder,
		payload: () =>
			worker.postMessage.mock.calls.find(([m]) => m.type === "updatePalette")?.[0]
				.paletteData as PaletteItem[],
	};
}

describe("palette loading across renderer and strict mesh core", () => {
	it.each(["default", "fallback"])(
		"loads delegated entries through the actual %s worker protocol",
		async (backend) => {
			const f = fixture();
			await f.builder.precomputePaletteGeometries([
				{ name: "minecraft:stone", properties: {} },
				{ name: "minecraft:oak_sign", properties: {} },
				{ name: "minecraft:white_banner", properties: {} },
			]);
			const messages: any[] = [];
			const scope = {
				onmessage: null as ((e: MessageEvent) => void | Promise<void>) | null,
				postMessage: (data: unknown) => messages.push(data),
			};
			vi.stubGlobal("self", scope);
			if (backend === "default") await import("../MeshBuilderWasm.worker");
			else await import("../MeshBuilder.worker");
			const send = async (data: Record<string, unknown>) => {
				const onmessage = scope.onmessage;
				expect(onmessage).toBeTypeOf("function");
				if (!onmessage) throw new Error("Worker did not install onmessage");
				await onmessage({ data } as MessageEvent);
			};
			await send({ type: "updatePalette", paletteData: f.payload() });
			const chunk = {
				chunkId: "signs",
				blocks: new Int32Array([0, 0, 0, 0, 1, 0, 0, 1, 2, 0, 0, 2]),
				chunkOrigin: [0, 0, 0],
				apronBlocks: new Int32Array([-1, 0, 0, 1]),
			};
			await send({ type: "buildChunk", ...chunk });
			expect(messages.filter((m) => m.type === "error")).toEqual([]);
			const result = messages.find((m) => m.type === "chunkBuilt");
			expect(
				result?.meshes.reduce(
					(n: number, m: { indices: Uint16Array }) => n + m.indices.length / 3,
					0
				)
			).toBe(12);
			if (backend === "default") {
				await send({ type: "startBatch", batchId: "test" });
				await send({ type: "buildChunkBatched", batchId: "test", ...chunk });
				await send({ type: "finishBatch", batchId: "test" });
				expect(messages.filter((m) => m.type === "error")).toEqual([]);
				expect(messages.some((m) => m.type === "batchFinished")).toBe(true);
			}
			await send({ type: "disposeContext" });
		}
	);
	it("keeps delegated signs, banners and empty models valid in blocks and neighbour aprons", async () => {
		const f = fixture();
		await f.builder.precomputePaletteGeometries([
			{ name: "minecraft:air", properties: {} },
			{ name: "minecraft:stone", properties: {} },
			{ name: "minecraft:oak_sign", properties: { rotation: "0" } },
			{ name: "minecraft:white_banner", properties: { rotation: "0" } },
			{ name: "minecraft:structure_void", properties: {} },
		]);
		const worker = new LegacyMeshBuilder();
		worker.update_palette(f.payload());
		const result = worker.build_chunk(
			new Int32Array([0, 0, 0, 1, 1, 0, 0, 2, 2, 0, 0, 3, 3, 0, 0, 4]),
			0,
			0,
			0,
			new Int32Array([-1, 0, 0, 2])
		);
		expect(result.stats.triangles).toBe(12);
		expect(f.payload().map((p) => p.index)).toEqual([0, 1, 2, 3, 4]);
		// Unknown IDs must remain errors; the fix must not discard corrupt blocks.
		expect(() =>
			worker.build_chunk(new Int32Array([0, 0, 0, 99]), 0, 0, 0, new Int32Array())
		).toThrow("Unknown palette index 99");
		worker.free();
	});
	it.each(["inspection-demo.litematic", "redstone-demo.litematic"])(
		"accepts every parsed palette entry in shipped %s",
		async (name) => {
			const schematic = new SchematicWrapper();
			cleanup.push(() => schematic.free());
			schematic.from_data(readFileSync(`example/public/schematics/${name}`));
			const palette = schematic.get_palette();
			const f = fixture();
			await f.builder.precomputePaletteGeometries(palette);
			const worker = new LegacyMeshBuilder();
			worker.update_palette(f.payload());
			for (let index = 0; index < palette.length; index++) {
				if (palette[index].name === "minecraft:air") continue; // Native chunk streaming omits air.
				expect(
					() => worker.build_chunk(new Int32Array([0, 0, 0, index]), 0, 0, 0, new Int32Array()),
					palette[index].name
				).not.toThrow();
			}
			worker.free();
		}
	);
});
