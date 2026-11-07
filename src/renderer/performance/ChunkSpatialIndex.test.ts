import { describe, it, expect, vi } from "vitest";
import * as THREE from "three";
import { ChunkSpatialIndex } from "./ChunkSpatialIndex";
import { ChunkVisibilityManager } from "./ChunkVisibilityManager";
import { CpuFrameProfiler } from "./CpuFrameProfiler";
const view = (camera: THREE.Camera) => {
	camera.updateMatrixWorld(true);
	return new THREE.Frustum().setFromProjectionMatrix(
		new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
	);
};
function items(n: number) {
	return Array.from({ length: n }, (_, id) => {
		const x = (id % 32) * 16,
			y = (Math.floor(id / 32) % 8) * 16,
			z = Math.floor(id / 256) * 16;
		return {
			id,
			world: new THREE.Box3(new THREE.Vector3(x, y, z), new THREE.Vector3(x + 15, y + 15, z + 15)),
		};
	});
}
describe("chunk hierarchy correctness", () => {
	it("matches exhaustive tests for perspective, orthographic, distance and transformed bounds", () => {
		const input = items(4096),
			tree = new ChunkSpatialIndex(input);
		for (const camera of [
			new THREE.PerspectiveCamera(50, 1.5, 0.1, 1000),
			new THREE.OrthographicCamera(-40, 40, 30, -30, 0.1, 1000),
		]) {
			for (const x of [-80, 10, 260, 600])
				for (const radius of [0, 50, 200]) {
					camera.position.set(x, 70, -80);
					camera.lookAt(x, 40, 150);
					const frustum = view(camera),
						found: typeof input = [];
					tree.query(frustum, camera.position, radius, found);
					const expected = input.filter(
						(item) =>
							frustum.intersectsBox(item.world) &&
							(!radius || item.world.distanceToPoint(camera.position) <= radius)
					);
					expect(found.map((x) => x.id).sort((a, b) => a - b)).toEqual(expected.map((x) => x.id));
				}
		}
		const transform = new THREE.Matrix4()
			.makeRotationY(0.7)
			.scale(new THREE.Vector3(-2, 1, 0.5))
			.setPosition(-100, 20, 30);
		for (const item of input) item.world.applyMatrix4(transform);
		tree.refit();
		const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2000);
		camera.position.set(0, 100, 500);
		camera.lookAt(-100, 0, 0);
		const frustum = view(camera),
			found: typeof input = [];
		tree.query(frustum, camera.position, 0, found);
		expect(found.map((x) => x.id).sort((a, b) => a - b)).toEqual(
			input.filter((i) => frustum.intersectsBox(i.world)).map((i) => i.id)
		);
	});
	it("prunes most leaves for a local view instead of testing all 16,384 chunks", () => {
		const input = items(16384),
			tree = new ChunkSpatialIndex(input);
		const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 120);
		camera.position.set(30, 20, -30);
		camera.lookAt(30, 20, 60);
		const found: typeof input = [];
		tree.query(view(camera), camera.position, 100, found);
		expect(found.length).toBeGreaterThan(0);
		expect(tree.testedItems).toBeLessThan(input.length / 10);
	});
	it("avoids camera-dependent scans when every culling/budget option is disabled", () => {
		const manager = new ChunkVisibilityManager(),
			root = new THREE.Group(),
			mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
		root.add(mesh);
		manager.register(root, [mesh]);
		manager.setOptions({ frustumCulling: false, renderDistance: 0, maxChunks: 0 });
		const camera = new THREE.PerspectiveCamera();
		manager.update(camera);
		const scan = vi.spyOn(mesh, "traverseVisible");
		camera.position.x = 20;
		manager.update(camera);
		expect(scan).not.toHaveBeenCalled();
		expect(manager.getStats().visibleChunks).toBe(1);
		root.visible = false;
		manager.update(camera);
		expect(manager.getStats().visibleChunks).toBe(0);
		manager.unregister(root);
		mesh.geometry.dispose();
		mesh.material.dispose();
	});
	it("refits registered large scenes after root transforms without missing visible chunks", () => {
		const manager = new ChunkVisibilityManager(),
			root = new THREE.Group(),
			geometry = new THREE.BoxGeometry(),
			material = new THREE.MeshBasicMaterial();
		const meshes = items(256).map((i) => {
			const mesh = new THREE.Mesh(geometry, material);
			mesh.position.copy(i.world.min);
			root.add(mesh);
			return mesh;
		});
		manager.register(root, meshes);
		manager.setOptions({ renderDistance: 50, frustumCulling: false });
		const camera = new THREE.PerspectiveCamera();
		camera.position.set(20, 20, 20);
		manager.update(camera);
		root.position.set(-100, 10, 20);
		root.rotation.y = 0.3;
		manager.update(camera);
		for (const mesh of meshes) {
			const box = new THREE.Box3().setFromObject(mesh);
			expect(mesh.visible).toBe(box.distanceToPoint(camera.position) <= 50);
		}
		manager.unregister(root);
		geometry.dispose();
		material.dispose();
	});
});
describe("bounded CPU telemetry", () => {
	it("keeps only the latest frames and separates stages from submission intervals", () => {
		const p = new CpuFrameProfiler(3),
			sample = (v: number) => ({
				controlsMs: v,
				highlightMs: 0,
				gizmoMs: 0,
				visibilityMs: 2,
				submitMs: 3,
				measuredMs: v + 5,
			});
		for (const v of [100, 1, 2, 3]) p.record(sample(v));
		const result = p.snapshot();
		expect(result.samples).toBe(3);
		expect(result.mean.controlsMs).toBe(2);
		expect(result.p95.controlsMs).toBe(3);
		expect(result.mean.measuredMs).toBe(7);
		p.record(sample(NaN));
		expect(p.snapshot().samples).toBe(3);
		p.reset();
		expect(p.snapshot().samples).toBe(0);
	});
});
