import test from "node:test";
import assert from "node:assert/strict";
import { MeshBuilder, topK, distanceSquaredToBox } from "../dist/mesh/core/index.js";
import { cube, solid } from "./mesh-fixtures.mjs";
const build = (palette, blocks, options = {}) =>
	new MeshBuilder(palette).build({ blocks: new Int32Array(blocks), ...options });
const bounds = (result) => {
	const min = [Infinity, Infinity, Infinity],
		max = [-Infinity, -Infinity, -Infinity];
	for (const m of result.meshes)
		for (let i = 0; i < m.positions.length; i++) {
			const v =
				m.positions[i] / (m.positions instanceof Int16Array ? 1024 : 1) + result.origin[i % 3];
			min[i % 3] = Math.min(min[i % 3], v);
			max[i % 3] = Math.max(max[i % 3], v);
		}
	return { min, max };
};
function winding(result) {
	for (const m of result.meshes)
		for (let i = 0; i < m.indices.length; i += 3) {
			const [a, b, c] = m.indices.slice(i, i + 3);
			const u = [0, 1, 2].map((j) => m.positions[b * 3 + j] - m.positions[a * 3 + j]);
			const v = [0, 1, 2].map((j) => m.positions[c * 3 + j] - m.positions[a * 3 + j]);
			const cross = [
				u[1] * v[2] - u[2] * v[1],
				u[2] * v[0] - u[0] * v[2],
				u[0] * v[1] - u[1] * v[0],
			];
			assert.ok(cross.reduce((s, x, j) => s + x * m.normals[a * 3 + j], 0) > 0);
		}
}
test("16³ solid emits only 6,144 referenced vertices and 3,072 outward triangles", () => {
	const result = build([cube()], solid(16));
	assert.equal(result.stats.vertices, 6144);
	assert.equal(result.stats.triangles, 3072);
	assert.equal(result.stats.bytes, 122880);
	assert.ok(result.meshes[0].normals instanceof Int8Array);
	for (const m of result.meshes) assert.equal(new Set(m.indices).size, m.positions.length / 3);
	winding(result);
});
test("single cube keeps integer center, UV subregion and winding", () => {
	const r = build([cube()], [0, 0, 0, 0]);
	assert.deepEqual(bounds(r), { min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] });
	assert.equal(Math.min(...r.meshes[0].uvs), 0.125);
	assert.equal(Math.max(...r.meshes[0].uvs), 0.5);
	winding(r);
});
test("slab remains half height and does not falsely hide upper faces", () => {
	const r = build([cube(0, { top: 0 })], [0, 0, 0, 0]);
	assert.deepEqual(bounds(r), { min: [-0.5, -0.5, -0.5], max: [0.5, 0, 0.5] });
	winding(r);
	assert.equal(build([cube(), cube(1, { top: 0 })], [0, 0, 0, 0, 1, 0, 0, 1]).stats.triangles, 22);
});
test("six independent face materials and UVs survive", () => {
	const r = build([cube(0, { separate: true })], [0, 0, 0, 0]);
	assert.deepEqual(
		r.meshes[0].groups.map((g) => g.materialIndex),
		[0, 1, 2, 3, 4, 5]
	);
	assert.ok(r.meshes[0].groups.every((g) => g.count === 6));
});
test("X=40 and negative overflow use Float32, small coordinates use Int16", () => {
	for (const x of [40, -40]) {
		const r = build([cube()], [x, 0, 0, 0], { origin: [0, 0, 0] });
		assert.ok(r.meshes[0].positions instanceof Float32Array);
		assert.equal(bounds(r).min[0], x - 0.5);
		assert.equal(bounds(r).max[0], x + 0.5);
	}
	assert.ok(build([cube()], [0, 0, 0, 0]).meshes[0].positions instanceof Int16Array);
});
test("oversized model bounds trigger fallback even for small chunk", () => {
	const p = cube();
	for (let i = 0; i < p.geometries[0].positions.length; i += 3) p.geometries[0].positions[i] *= 100;
	assert.ok(build([p], [0, 0, 0, 0]).meshes[0].positions instanceof Float32Array);
});
test("explicit Float32 avoids position quantization", () => {
	const p = cube();
	p.geometries[0].positions[0] = 0.123456;
	const r = build([p], [0, 0, 0, 0], { positions: "float32" });
	assert.equal(r.meshes[0].positions[0], p.geometries[0].positions[0]);
});
test("apron occludes but is never emitted; main blocks win apron overlap", () => {
	const r = build([cube()], [0, 0, 0, 0], {
		apron: new Int32Array([1, 0, 0, 0, 0, 0, 0, 0, 999, 0, 0, 0]),
	});
	assert.equal(r.stats.triangles, 10);
	assert.deepEqual(bounds(r), { min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] });
});
test("same-group glass self culls, distinct groups and cutouts do not", () => {
	const glass = cube(0, {
		occlusionFlags: 0,
		selfOcclusionFlags: 63,
		cullGroup: "glass",
		category: "transparent",
	});
	const other = cube(1, { occlusionFlags: 0, selfOcclusionFlags: 63, cullGroup: "blue" });
	assert.equal(build([glass], [0, 0, 0, 0, 1, 0, 0, 0]).stats.triangles, 20);
	assert.equal(build([glass, other], [0, 0, 0, 0, 1, 0, 0, 1]).stats.triangles, 24);
	assert.equal(
		build([cube(0, { occlusionFlags: 0 })], [0, 0, 0, 0, 1, 0, 0, 0]).stats.triangles,
		24
	);
});
test("sparse distant blocks do not allocate their full AABB", () => {
	const r = build([cube()], [0, 0, 0, 0, 1000000, 0, 0, 0]);
	assert.equal(r.stats.vertices, 48);
	assert.equal(r.stats.triangles, 24);
});
test("large world origins are subtracted before Float32 conversion", () => {
	const r = build([cube()], [2000000000, 0, 0, 0]);
	assert.deepEqual(bounds(r), { min: [1999999999.5, -0.5, -0.5], max: [2000000000.5, 0.5, 0.5] });
});
test("32-bit indices chosen above 65,536 vertices", () => {
	const blocks = [];
	for (let i = 0; i < 2800; i++) blocks.push(i * 2, 0, 0, 0);
	const r = build([cube()], blocks);
	assert.ok(r.meshes[0].indices instanceof Uint32Array);
	assert.equal(r.meshes[0].positions.length / 3, 67200);
	assert.equal(new Set(r.meshes[0].indices).size, 67200);
});
test("invalid inputs reject; failed palette update is atomic; copies isolate mutations", () => {
	const p = cube(),
		b = new MeshBuilder([p]);
	assert.throws(() => b.updatePalette([p, p]));
	p.geometries[0].positions.fill(0);
	assert.equal(b.build({ blocks: new Int32Array([0, 0, 0, 0]) }).stats.vertices, 24);
	assert.throws(() => b.build({ blocks: new Int32Array([0]) }));
	assert.throws(() => b.build({ blocks: new Int32Array([0, 0, 0, 99]) }));
	assert.throws(() => b.build({ blocks: new Int32Array([0, 0, 0, 0, 0, 0, 0, 0]) }));
	assert.throws(() => b.build({ blocks: new Int32Array(), origin: [NaN, 0, 0] }));
});
test("empty result has finite origin and no buffers", () => {
	assert.deepEqual(build([], []), {
		origin: [0, 0, 0],
		meshes: [],
		stats: { blocks: 0, vertices: 0, triangles: 0, bytes: 0 },
	});
});
test("palette replacement invalidates mask cache", () => {
	const b = new MeshBuilder([cube()]);
	const blocks = new Int32Array([0, 0, 0, 0]);
	b.build({ blocks });
	b.updatePalette([cube(0, { top: 0 })]);
	assert.equal(bounds(b.build({ blocks })).max[1], 0);
});
test("cached and uncached templates are byte-identical", () => {
	const p = [cube(), cube(1, { top: 0 })],
		blocks = new Int32Array([0, 0, 0, 0, 0, 1, 0, 1, 1, 0, 0, 0]);
	assert.deepEqual(
		new MeshBuilder(p).build({ blocks }),
		new MeshBuilder(p, { templatesPerGeometry: 0 }).build({ blocks })
	);
});
test("Top-K matches stable full sort including ties, zeros and oversized budgets", () => {
	let seed = 7;
	const rand = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
	const a = Array.from({ length: 1000 }, (_, id) => ({ id, d: Math.floor(rand() * 30) }));
	for (const k of [0, 1, 3, 50, 999, 1000, 2000])
		assert.deepEqual(
			topK(a, k, (a, b) => a.d - b.d),
			a
				.slice()
				.sort((a, b) => a.d - b.d)
				.slice(0, k)
		);
	assert.throws(() => topK(a, -1, () => 0));
});
test("squared box distance handles interior and negative coordinates", () => {
	assert.equal(distanceSquaredToBox([0, 0, 0], { min: [-1, -1, -1], max: [1, 1, 1] }), 0);
	assert.equal(distanceSquaredToBox([-4, 5, 0], { min: [-1, -1, -1], max: [1, 1, 1] }), 25);
});
