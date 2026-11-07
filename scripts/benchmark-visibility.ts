// Node 24+, after npm ci in schematic-renderer-master. No browser/GPU required.
import * as THREE from "three";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { ChunkSpatialIndex } from "../src/renderer/performance/ChunkSpatialIndex.ts";
const items = Array.from({ length: 32768 }, (_, id) => {
	const x = (id % 64) * 16,
		y = (Math.floor(id / 64) % 8) * 16,
		z = Math.floor(id / 512) * 16;
	return {
		id,
		world: new THREE.Box3(new THREE.Vector3(x, y, z), new THREE.Vector3(x + 15, y + 15, z + 15)),
	};
});
const start = performance.now(),
	tree = new ChunkSpatialIndex(items),
	buildMs = performance.now() - start;
const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 512),
	matrix = new THREE.Matrix4();
const views = Array.from({ length: 24 }, (_, i) => {
	camera.position.set(80 + i * 25, 80, -70 + i * 3);
	camera.lookAt(100 + i * 25, 50, 220 + i * 3);
	camera.updateMatrixWorld(true);
	return {
		position: camera.position.clone(),
		frustum: new THREE.Frustum().setFromProjectionMatrix(
			matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
		),
	};
});
const radius = 400;
function linear(view: (typeof views)[number]) {
	return items.filter((item) => {
		const box = item.world,
			p = view.position;
		const dx = Math.max(box.min.x - p.x, 0, p.x - box.max.x);
		const dy = Math.max(box.min.y - p.y, 0, p.y - box.max.y);
		const dz = Math.max(box.min.z - p.z, 0, p.z - box.max.z);
		return dx * dx + dy * dy + dz * dz <= radius * radius && view.frustum.intersectsBox(box);
	});
}
function indexed(view: (typeof views)[number]) {
	const out: typeof items = [];
	tree.query(view.frustum, view.position, radius, out);
	return out;
}
const tested: number[] = [],
	visible: number[] = [];
for (const view of views) {
	const result = indexed(view);
	assert.deepEqual(
		result.map((x) => x.id).sort((a, b) => a - b),
		linear(view).map((x) => x.id)
	);
	tested.push(tree.testedItems);
	visible.push(result.length);
}
function measure(fn: typeof linear) {
	for (let i = 0; i < 3; i++) for (const view of views) fn(view);
	const samples: number[] = [];
	for (let i = 0; i < 10; i++)
		for (const view of views) {
			const start = performance.now();
			fn(view);
			samples.push(performance.now() - start);
		}
	samples.sort((a, b) => a - b);
	return {
		samples: samples.length,
		p50Ms: samples[Math.floor(samples.length * 0.5)],
		p95Ms: samples[Math.ceil(samples.length * 0.95) - 1],
	};
}
const report = {
	node: process.version,
	scope:
		"CPU broad-phase frustum+distance query only; not complete frame time or GPU/FPS. Both paths return identical chunk IDs.",
	chunks: items.length,
	trajectoryViews: views.length,
	buildMs,
	visibleRange: [Math.min(...visible), Math.max(...visible)],
	leafTestsRange: [Math.min(...tested), Math.max(...tested)],
	linear: measure(linear),
	hierarchy: measure(indexed),
};
writeFileSync(
	new URL("../../docs/VISIBILITY-BENCHMARK.json", import.meta.url),
	JSON.stringify(report, null, 2) + "\n"
);
console.log(JSON.stringify(report, null, 2));
