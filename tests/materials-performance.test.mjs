import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Worker } from "node:worker_threads";
import { countLitematicMaterials, countPaletteStates } from "../dist/materials.js";
import { MaterialsCounter } from "../dist/materials-client.js";

for (const bits of [2, 3, 4, 5, 6, 7, 9, 12, 17]) {
	test(`packed ${bits}-bit states match a BigInt reference across word boundaries`, () => {
		const paletteLength = 2 ** bits - 1,
			volume = 1027;
		const words = new Array(Math.ceil((volume * bits) / 64)).fill(0n);
		const expected = new Array(paletteLength).fill(0);
		for (let i = 0; i < volume; i++) {
			const value = (i * 137 + 5) % paletteLength;
			expected[value]++;
			const bit = i * bits,
				index = Math.floor(bit / 64),
				offset = bit % 64;
			words[index] |= (BigInt(value) << BigInt(offset)) & 0xffffffffffffffffn;
			if (offset + bits > 64) words[index + 1] |= BigInt(value) >> BigInt(64 - offset);
		}
		assert.deepEqual(countPaletteStates(words, paletteLength, volume, bits), expected);
	});
}
test("invalid palette indices still reject", () => {
	assert.throws(() => countPaletteStates([3n], 3, 1, 2), /invalid block index/);
});

test("actual material worker preserves input, matches parser output and can be reused", async () => {
	let created = 0;
	const url = new URL("../dist/materials.worker.js", import.meta.url).href;
	const counter = new MaterialsCounter(() => {
		created++;
		const worker = new Worker(
			`
      const { parentPort } = require("node:worker_threads");
      global.postMessage = data => parentPort.postMessage(data);
      import(${JSON.stringify(url)}).then(() => parentPort.on("message", data => global.onmessage({data})));
    `,
			{ eval: true }
		);
		const adapter = {
			postMessage: (value, transfer) => worker.postMessage(value, transfer),
			terminate: () => worker.terminate(),
		};
		worker.on("message", (data) => adapter.onmessage?.({ data }));
		worker.on("error", (error) => adapter.onerror?.(error));
		return adapter;
	});
	try {
		for (const name of ["inspection-demo", "entities-demo", "redstone-demo", "inspection-demo"]) {
			const bytes = await readFile(new URL(`./fixtures/${name}.litematic`, import.meta.url));
			const input = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
			const expected = await countLitematicMaterials(input);
			assert.deepEqual(await counter.count(input), expected);
			assert.equal(input.byteLength, bytes.byteLength);
		}
		assert.equal(created, 1);
		await assert.rejects(counter.count(new ArrayBuffer(8)));
		const bytes = await readFile(new URL("./fixtures/inspection-demo.litematic", import.meta.url));
		const input = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
		assert.deepEqual(await counter.count(input), await countLitematicMaterials(input));
	} finally {
		counter.dispose();
	}
	await assert.rejects(counter.count(new ArrayBuffer(0)), /disposed/);
});

test("worker failure rejects pending work and permits retry with a fresh worker", async () => {
	const workers = [];
	const counter = new MaterialsCounter(() => {
		const worker = {
			postMessage() {},
			terminate() {
				this.terminated = true;
			},
		};
		workers.push(worker);
		return worker;
	});
	const first = counter.count(new ArrayBuffer(8));
	const rejected = assert.rejects(first, /worker failed/);
	workers[0].onerror();
	await rejected;
	assert.equal(workers[0].terminated, true);
	const retry = counter.count(new ArrayBuffer(8));
	workers[1].onmessage({ data: { id: 2, result: { materials: [] } } });
	assert.deepEqual(await retry, { materials: [] });
	counter.dispose();
});
