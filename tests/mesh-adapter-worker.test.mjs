import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { MeshBuilder } from "../dist/mesh/core/index.js";
import { createGeometry, createMeshes } from "../dist/mesh/three/index.js";
import { MeshWorkerClient } from "../dist/mesh/worker/index.js";
import { cube } from "./mesh-fixtures.mjs";

test("Three adapter decodes Int16 positions, keeps normalized Int8 normals and does not own materials", () => {
	const result = new MeshBuilder([cube()]).build({ blocks: new Int32Array([100, 0, 0, 0]) });
	const material = new THREE.MeshBasicMaterial();
	let materialDisposed = false;
	material.addEventListener("dispose", () => (materialDisposed = true));
	const handle = createMeshes(result, [material]);
	assert.equal(handle.root.position.x, 100);
	const mesh = handle.root.children[0];
	assert.equal(mesh.geometry.boundingBox.min.x, -0.5);
	assert.equal(mesh.geometry.attributes.normal.normalized, true);
	assert.ok(mesh.geometry.attributes.normal.array instanceof Int8Array);
	let disposed = 0;
	mesh.geometry.addEventListener("dispose", () => disposed++);
	handle.dispose();
	handle.dispose();
	assert.equal(disposed, 1);
	assert.equal(materialDisposed, false);
	material.dispose();
});
test("Three Float32 fallback retains X=40 without scale corruption and validates materials", () => {
	const r = new MeshBuilder([cube()]).build({
		blocks: new Int32Array([40, 0, 0, 0]),
		origin: [0, 0, 0],
	});
	const g = createGeometry(r.meshes[0]);
	assert.equal(g.boundingBox.max.x, 40.5);
	g.dispose();
	assert.throws(() => createMeshes(r, []), /Missing material/);
});

class FakeWorker extends EventTarget {
	messages = [];
	terminated = false;

	postMessage(data, transfer) {
		this.messages.push(structuredClone(data, { transfer }));
	}

	terminate() {
		this.terminated = true;
	}

	reply(data) {
		this.dispatchEvent(new MessageEvent("message", { data }));
	}
}

test("worker client request IDs route out-of-order results and transfer buffers explicitly", async () => {
	const worker = new FakeWorker(),
		client = new MeshWorkerClient(worker);
	const blocks = new Int32Array([0, 0, 0, 0]);
	const first = client.build({ blocks }, { transfer: true });
	assert.equal(blocks.byteLength, 0);
	const second = client.build({ blocks: new Int32Array() });
	const [a, b] = worker.messages;
	worker.reply({ type: "built", id: b.id, result: { label: "second" } });
	worker.reply({ type: "built", id: a.id, result: { label: "first" } });
	assert.equal((await first).label, "first");
	assert.equal((await second).label, "second");
	client.dispose();
	assert.equal(worker.terminated, true);
});
test("worker abort discards stale replies; dispose rejects pending work; errors reach caller", async () => {
	const worker = new FakeWorker(),
		client = new MeshWorkerClient(worker),
		controller = new AbortController();
	const p = client.build({ blocks: new Int32Array() }, { signal: controller.signal });
	controller.abort();
	await assert.rejects(p, { name: "AbortError" });
	worker.reply({ type: "built", id: worker.messages[0].id, result: {} });
	const bad = client.build({ blocks: new Int32Array() });
	worker.reply({ type: "error", id: worker.messages.at(-1).id, error: "bad geometry" });
	await assert.rejects(bad, /bad geometry/);
	const pending = client.build({ blocks: new Int32Array() });
	client.dispose();
	await assert.rejects(pending, /disposed/);
	await assert.rejects(client.build({ blocks: new Int32Array() }), /disposed/);
});
test("worker transport failures reject all pending operations and terminate worker", async () => {
	const worker = new FakeWorker(),
		client = new MeshWorkerClient(worker);
	const p = client.build({ blocks: new Int32Array() });
	worker.dispatchEvent(new Event("messageerror"));
	await assert.rejects(p, /failed/);
	assert.equal(worker.terminated, true);
});
