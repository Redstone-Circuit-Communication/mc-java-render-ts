import test from "node:test";
import assert from "node:assert/strict";
import { BlueprintLoader } from "../dist/blueprint-loader.js";
import { countPaletteStates, materialsToCsv, filterMaterials, setLocale } from "../dist/core.js";
function setup() {
	const old = { id: "old", group: { visible: true } };
	const schematics = [old];
	let active = 0,
		maxActive = 0,
		badMesh = false;
	const manager = {
		getAllSchematics: () => [...schematics],
		async loadSchematic(id, buffer) {
			active++;
			maxActive = Math.max(maxActive, active);
			await new Promise((r) => setTimeout(r, 5));
			if (new Uint8Array(buffer)[0] === 255) {
				active--;
				throw new Error("parse failed");
			}
			schematics.push({
				id,
				group: { visible: true },
				getMeshes: async () => {
					active--;
					if (badMesh) throw new Error("mesh failed");
				},
				getTightDimensions: () => [2, 3, 4],
				schematicWrapper: {
					native: {
						countBlocksJson: () => JSON.stringify({ "minecraft:air": 2, "minecraft:stone": 65 }),
					},
				},
			});
		},
		async removeSchematic(id) {
			const i = schematics.findIndex((s) => s.id === id);
			if (i >= 0) schematics.splice(i, 1);
		},
	};
	let stopped = false;
	const counter = {
		count: async () => ({
			regionCount: 2,
			materials: [{ id: "minecraft:stone", count: 3, stacks: 0, remainder: 3 }],
		}),
		dispose: () => {
			stopped = true;
		},
	};
	const renderer = { schematicManager: manager, invalidate() {} };
	return {
		renderer,
		counter,
		schematics,
		old,
		maxActive: () => maxActive,
		setBadMesh: () => {
			badMesh = true;
		},
		stopped: () => stopped,
	};
}
test("parse and mesh failures preserve the previous scene", async () => {
	const state = setup();
	const loader = new BlueprintLoader(state.renderer, { counter: state.counter });
	await assert.rejects(loader.load(new Uint8Array([255]).buffer, "bad.schem"), /parse failed/);
	assert.deepEqual(state.schematics, [state.old]);
	state.setBadMesh();
	await assert.rejects(loader.load(new ArrayBuffer(2), "bad.schem"), /mesh failed/);
	assert.deepEqual(state.schematics, [state.old]);
	await loader.dispose();
});
test("successful replacement excludes air, calculates stacks and returns geometry info", async () => {
	const state = setup();
	let called = 0;
	const loader = new BlueprintLoader(state.renderer, {
		counter: state.counter,
		beforeReplace: () => {
			called++;
			assert.equal(state.schematics.includes(state.old), true);
		},
	});
	const result = await loader.load(new ArrayBuffer(4), "new.schem");
	assert.equal(called, 1);
	assert.equal(result.totalBlocks, 65);
	assert.deepEqual(result.dimensions, [2, 3, 4]);
	assert.deepEqual(result.materials, [
		{ id: "minecraft:stone", count: 65, stacks: 1, remainder: 1 },
	]);
	assert.equal(state.schematics.length, 1);
	assert.equal(result.schematic.group.visible, true);
	await loader.dispose();
});
test("concurrent requests are serialized and a failed load does not poison the queue", async () => {
	const state = setup();
	const loader = new BlueprintLoader(state.renderer, { counter: state.counter });
	const bad = assert.rejects(loader.load(new Uint8Array([255]).buffer, "bad.schem"));
	const first = loader.load(new ArrayBuffer(4), "a.litematic");
	const second = loader.load(new ArrayBuffer(4), "b.schem");
	await bad;
	assert.equal((await first).regionCount, 2);
	const last = await second;
	assert.equal(state.maxActive(), 1);
	assert.deepEqual(
		state.schematics.map((s) => s.id),
		[last.id]
	);
	await loader.dispose();
	assert.equal(state.stopped(), true);
	await assert.rejects(loader.load(new ArrayBuffer(4), "closed.schem"), /disposed/);
});
test("dispose during mesh loading cleans the new scene and preserves the old one", async () => {
	const state = setup();
	let release, entered;
	const started = new Promise((r) => (entered = r));
	const original = state.renderer.schematicManager.loadSchematic;
	state.renderer.schematicManager.loadSchematic = async (...args) => {
		await original(...args);
		entered();
		await new Promise((r) => (release = r));
	};
	const loader = new BlueprintLoader(state.renderer, { counter: state.counter });
	const loading = assert.rejects(loader.load(new ArrayBuffer(4), "a.schem"), /disposed/);
	await started;
	const stopping = loader.dispose();
	release();
	await Promise.all([stopping, loading]);
	assert.deepEqual(state.schematics, [state.old]);
});
test("URL names ignore query strings and HTTP failures reject before touching the scene", async (t) => {
	const original = globalThis.fetch;
	t.after(() => (globalThis.fetch = original));
	const state = setup();
	const loader = new BlueprintLoader(state.renderer, { counter: state.counter });
	globalThis.fetch = async () => new Response(new Uint8Array([1]));
	const result = await loader.loadUrl("https://example.invalid/%E8%93%9D%E5%9B%BE.schem?v=1#test");
	assert.equal(result.filename, "蓝图.schem");
	globalThis.fetch = async () => new Response("", { status: 404 });
	await assert.rejects(loader.loadUrl("https://example.invalid/missing.schem"), /404/);
	assert.equal(state.schematics[0].id, result.id);
	await loader.dispose();
});
test("truncated packed states reject and CSV handles quotes and localized search", () => {
	assert.throws(() => countPaletteStates([], 2, 1, 2), /truncated/);
	const items = [
		{ id: "minecraft:chest", count: 65, stacks: 1, remainder: 1 },
		{ id: 'mod:a"b', count: 2, stacks: 0, remainder: 2 },
	];
	assert.deepEqual(filterMaterials(items, "chest"), [items[0]]);
	setLocale("zh-CN");
	assert.deepEqual(filterMaterials(items, "箱子"), [items[0]]);
	setLocale("en");
	const csv = materialsToCsv(items);
	assert.equal(csv.charCodeAt(0), 0xfeff);
	assert.match(csv, /mod:a""b/);
});
