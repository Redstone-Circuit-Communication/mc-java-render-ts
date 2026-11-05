import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import * as THREE from "three";
import { readFileSync } from "node:fs";
import { initSync, MeshBuilder } from "../wasm/mesh_builder_wasm.js";
import {
	ChunkBatchAccumulator,
	sortChunkGeometry,
	prepareChunkGeometry,
} from "./ChunkBatchGeometry";
import { ChunkVisibilityManager } from "./ChunkVisibilityManager";
import { WorldMeshBuilder } from "../WorldMeshBuilder";
import type { ChunkGeometryData } from "../types";
vi.mock("../workers/MeshBuilder.worker?worker&inline", () => ({ default: class {} }));
vi.mock("../workers/MeshBuilderWasm.worker?worker&inline", () => ({ default: class {} }));

function required<T>(value: T | null | undefined): T {
	if (value === null || value === undefined) throw new Error("Missing test fixture data");
	return value;
}
const cube = new THREE.BoxGeometry();
const palette = [0, 1].map((index) => ({
	index,
	category: "solid",
	occlusionFlags: 63,
	geometries: [
		{
			positions: cube.attributes.position.array,
			normals: cube.attributes.normal.array,
			uvs: cube.attributes.uv.array,
			indices: required(cube.index).array,
			materialIndex: index,
		},
	],
}));
let builder: MeshBuilder;
beforeAll(() => {
	initSync({ module: readFileSync("src/wasm/mesh_builder_wasm_bg.wasm") });
	builder = new MeshBuilder();
	builder.update_palette(palette);
});
afterAll(() => {
	builder.free();
	cube.dispose();
});

function fixture(xs = [-16, 0, 16, 32]) {
	const acc = new ChunkBatchAccumulator();
	for (const x of xs) {
		const result = builder.build_chunk(
			new Int32Array([x, 0, 0, 0, x, 1, 0, 1]),
			x,
			0,
			0,
			new Int32Array()
		);
		for (const mesh of result.meshes) acc.add(mesh, [x, 0, 0], `${Math.floor(x / 16)},0,0`);
	}
	const data = acc.finish("solid");
	const materials = [new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial()];
	const meshes: THREE.Mesh[] = Reflect.get(
		WorldMeshBuilder.prototype,
		"createMeshesFromBatchResult"
	).call(Object.create(WorldMeshBuilder.prototype), { meshes: [data] }, materials);
	const root = new THREE.Group();
	root.add(...meshes);
	const manager = new ChunkVisibilityManager();
	manager.setOptions({ frustumCulling: false });
	manager.register(root, meshes);
	const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 1000);
	camera.position.set(0, 0, 8);
	camera.lookAt(0, 0, 0);
	return {
		data,
		root,
		meshes,
		manager,
		camera,
		dispose: () => {
			manager.unregister(root);
			meshes.forEach((m) => m.geometry.dispose());
			materials.forEach((m) => m.dispose());
		},
	};
}

describe("actual WASM geometry through batched chunk selection", () => {
	it("uses finalized worker buffers without sorting or scanning vertices again", () => {
		const f = fixture();
		const workerData = prepareChunkGeometry(f.data);
		const expected = sortChunkGeometry(f.data);
		expect(workerData.indices).toEqual(expected.indices);
		expect(workerData.chunkGroups).toEqual(expected.chunkGroups);
		for (let i = 0; i < workerData.normals.length; i++)
			expect(workerData.normals[i]).toBeCloseTo(f.data.normals[i] / 127);
		const builder = Object.create(WorldMeshBuilder.prototype);
		const sort = vi.spyOn(builder, "optimizeGeometryGroups");
		const boxScan = vi.spyOn(THREE.BufferGeometry.prototype, "computeBoundingBox");
		const sphereScan = vi.spyOn(THREE.BufferGeometry.prototype, "computeBoundingSphere");
		const meshes: THREE.Mesh[] = Reflect.get(builder, "createMeshesFromBatchResult").call(
			builder,
			{ meshes: [workerData] },
			f.meshes[0].material
		);
		expect(sort.mock.results[0].value).toBe(workerData);
		expect(required(meshes[0].geometry.index).array).toBe(workerData.indices);
		expect(meshes[0].geometry.attributes.normal.array).toBe(workerData.normals);
		expect(boxScan).not.toHaveBeenCalled();
		expect(sphereScan).not.toHaveBeenCalled();
		const point = new THREE.Vector3();
		for (let i = 0; i < workerData.positions.length; i += 3) {
			point.fromArray(workerData.positions, i);
			expect(required(meshes[0].geometry.boundingBox).containsPoint(point)).toBe(true);
			expect(required(meshes[0].geometry.boundingSphere).containsPoint(point)).toBe(true);
		}
		sort.mockRestore();
		boxScan.mockRestore();
		sphereScan.mockRestore();
		meshes[0].geometry.dispose();
		f.dispose();
	});

	it("preserves triangles, world coordinates, material batching and negative chunk keys", () => {
		const f = fixture();
		const sorted = sortChunkGeometry(f.data);
		expect(sorted.groups).toHaveLength(2);
		expect(Object.keys(required(f.data.chunkBounds))).toEqual([
			"-1,0,0",
			"0,0,0",
			"1,0,0",
			"2,0,0",
		]);
		expect(required(f.data.chunkBounds)["-1,0,0"].min[0]).toBe(-16.5);
		expect(f.data.indices.length / 3).toBe(80);
		f.manager.update(f.camera);
		expect(f.manager.getStats()).toEqual({
			visibleChunks: 4,
			totalChunks: 4,
			triangles: 80,
			drawCalls: 2,
		});
		f.dispose();
	});
	it("caps nearest chunks without rebuilding buffers and restores the complete overview", () => {
		const f = fixture();
		const geometry = f.meshes[0].geometry;
		const indices = required(geometry.index).array,
			positions = geometry.attributes.position.array;
		f.manager.setOptions({ maxChunks: 1 });
		f.manager.update(f.camera);
		expect(f.manager.getStats()).toMatchObject({ visibleChunks: 1, triangles: 20, drawCalls: 2 });
		const raycaster = new THREE.Raycaster(new THREE.Vector3(32, 0, 8), new THREE.Vector3(0, 0, -1));
		f.root.updateMatrixWorld(true);
		expect(raycaster.intersectObjects(f.meshes)).toHaveLength(0);
		f.camera.position.x = 32;
		f.manager.update(f.camera);
		expect(raycaster.intersectObjects(f.meshes).length).toBeGreaterThan(0);
		f.manager.setOptions({ maxChunks: 0 });
		f.manager.update(f.camera);
		expect(f.manager.getStats()).toMatchObject({ visibleChunks: 4, triangles: 80, drawCalls: 2 });
		expect(required(geometry.index).array).toBe(indices);
		expect(geometry.attributes.position.array).toBe(positions);
		f.dispose();
	});
	it("rejects out-of-view and distant sections, including when the camera turns around", () => {
		const f = fixture();
		f.manager.setOptions({ frustumCulling: true, renderDistance: 9 });
		f.manager.update(f.camera);
		expect(f.manager.getStats().visibleChunks).toBe(1);
		f.camera.lookAt(0, 0, 20);
		f.manager.update(f.camera);
		expect(f.manager.getStats().visibleChunks).toBe(0);
		expect(f.meshes[0].visible).toBe(false);
		f.camera.lookAt(0, 0, 0);
		f.manager.setOptions({ renderDistance: 7 });
		f.manager.update(f.camera);
		expect(f.manager.getStats().visibleChunks).toBe(0);
		f.dispose();
	});
	it("uses transformed world bounds and orthographic projection, and sees root motion", () => {
		const f = fixture();
		f.root.position.x = 50;
		f.root.rotation.y = Math.PI / 2;
		f.root.scale.setScalar(2);
		const camera = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.1, 100);
		camera.position.set(50, 0, 10);
		camera.lookAt(50, 0, 0);
		f.manager.setOptions({ maxChunks: 1, frustumCulling: true, renderDistance: 12 });
		f.manager.update(camera);
		expect(f.manager.getStats().visibleChunks).toBe(1);
		f.root.position.x = 100;
		f.manager.update(camera);
		expect(f.manager.getStats().visibleChunks).toBe(0);
		f.dispose();
	});
	it("applies one budget across schematics and excludes hidden schematics", () => {
		const f = fixture();
		const other = fixture([64]);
		f.manager.register(other.root, other.meshes);
		f.manager.setOptions({ maxChunks: 2 });
		f.manager.update(f.camera);
		expect(f.manager.getStats()).toMatchObject({ visibleChunks: 2, totalChunks: 5 });
		f.root.visible = false;
		f.manager.update(f.camera);
		expect(f.manager.getStats()).toMatchObject({ visibleChunks: 1, totalChunks: 1 });
		f.manager.unregister(other.root);
		other.dispose();
		f.dispose();
	});
	it("compacts block-entity instances and signs with their chunks and restores them on unregister", () => {
		const f = fixture([0, 32]);
		const overlay = new THREE.Group();
		overlay.name = "schematic-renderer:shulker-boxes";
		const instances = new THREE.InstancedMesh(
			new THREE.BoxGeometry(),
			new THREE.MeshBasicMaterial(),
			2
		);
		instances.setMatrixAt(0, new THREE.Matrix4());
		instances.setMatrixAt(1, new THREE.Matrix4().makeTranslation(32, 0, 0));
		instances.setColorAt(0, new THREE.Color("red"));
		instances.setColorAt(1, new THREE.Color("blue"));
		overlay.add(instances);
		f.root.add(overlay);
		const sign = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
		sign.position.x = 32;
		f.root.add(sign);
		f.manager.register(f.root, [...f.meshes, overlay, sign]);
		f.manager.setOptions({ maxChunks: 1 });
		f.manager.update(f.camera);
		expect(instances.count).toBe(1);
		expect(sign.visible).toBe(false);
		f.camera.position.x = 32;
		f.manager.update(f.camera);
		const matrix = new THREE.Matrix4();
		instances.getMatrixAt(0, matrix);
		expect(matrix.elements[12]).toBe(32);
		const color = new THREE.Color();
		instances.getColorAt(0, color);
		expect(color.getHexString()).toBe("0000ff");
		expect(sign.visible).toBe(true);
		f.manager.unregister(f.root);
		expect(instances.count).toBe(2);
		instances.getMatrixAt(0, matrix);
		expect(matrix.elements[12]).toBe(0);
		instances.geometry.dispose();
		(instances.material as THREE.Material).dispose();
		sign.geometry.dispose();
		(sign.material as THREE.Material).dispose();
		f.dispose();
	});
});

it("preserves chunk metadata through the real WASM worker message protocol", async () => {
	const messages: Record<string, unknown>[] = [];
	const worker = {
		onmessage: null as ((event: MessageEvent) => Promise<void>) | null,
		postMessage: (message: Record<string, unknown>) => messages.push(message),
	};
	vi.stubGlobal("self", worker);
	try {
		await import("../workers/MeshBuilderWasm.worker");
		const send = async (data: Record<string, unknown>) =>
			required(worker.onmessage)(
				new MessageEvent("message", { data: { ...data, meshContextId: "cull-test", batchId: "b" } })
			);
		await send({ type: "updatePalette", paletteData: palette });
		await send({ type: "startBatch" });
		for (const x of [0, 32])
			await send({
				type: "buildChunkBatched",
				chunkId: `id-${x}`,
				chunkKey: `${x / 16},0,0`,
				blocks: new Int32Array([x, 0, 0, 0]),
				chunkOrigin: [x, 0, 0],
			});
		await send({ type: "finishBatch" });
		expect(messages.some((m) => m.type === "error")).toBe(false);
		const result = required(messages.find((m) => m.type === "batchFinished"));
		const mesh = (result.meshes as ChunkGeometryData[])[0];
		expect(mesh.indices.length / 3).toBe(24);
		expect(required(mesh.chunkGroups).map((g) => g.chunkKey)).toEqual(["0,0,0", "2,0,0"]);
		expect(mesh.groups).toHaveLength(1);
		expect(mesh.normals).toBeInstanceOf(Float32Array);
		expect(required(mesh.chunkBounds)["2,0,0"].max[0]).toBe(32.5);
		await send({ type: "disposeContext" });
	} finally {
		vi.unstubAllGlobals();
	}
});
