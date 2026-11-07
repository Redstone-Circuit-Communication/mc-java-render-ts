import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Schematic } from "nucleation";
import { readRedstone } from "../dist/redstone.js";

const read = (state, nbt) => readRedstone(`minecraft:${state}`, nbt);

test("wire preserves all sixteen saved signal strengths and connection directions", () => {
	for (let power = 0; power <= 15; power++) {
		const info = read(`redstone_wire[power=${power},north=up,south=side,east=none,west=side]`);
		assert.equal(info.strength, power);
		assert.equal(info.active, power > 0);
		assert.equal(info.details[0].value, "向上连接");
	}
});
test("repeater shows fixed output, lock, delay and the opposite of facing as output", () => {
	const info = read("repeater[powered=true,delay=4,locked=true,facing=north]");
	assert.equal(info.strength, 15);
	assert.deepEqual(info.details, [
		{ label: "延迟", value: "4 红石刻 · 8 游戏刻 · 0.4 秒" },
		{ label: "锁定", value: "是" },
		{ label: "输入方向", value: "北 · −Z" },
		{ label: "输出方向", value: "南 · +Z" },
	]);
	assert.equal(read("repeater[powered=false,locked=true]").strength, 0);
});
test("comparator reads typed OutputSignal and never guesses fifteen from powered", () => {
	for (const nbt of [
		{ OutputSignal: 7 },
		{ Compound: { OutputSignal: { Int: 7 } } },
		{ type: "compound", value: { OutputSignal: { type: "int", value: 7 } } },
	]) {
		const info = read("comparator[powered=true,mode=subtract,facing=west]", nbt);
		assert.equal(info.strength, 7);
		assert.equal(info.details[0].value, "减法");
		assert.equal(info.details[2].value, "东 · +X");
	}
	assert.equal(read("comparator[powered=true]", {}).strength, null);
	assert.equal(read("comparator[powered=false]", {}).strength, null);
	assert.equal(read("comparator[powered=false]", { OutputSignal: 0 }).strength, 0);
	assert.match(read("comparator[powered=false]", { OutputSignal: 7 }).note, /不一致/);
});
test("binary sources and variable sources remain distinct", () => {
	for (const id of [
		"lever",
		"oak_button",
		"stone_pressure_plate",
		"tripwire_hook",
		"detector_rail",
		"observer",
	])
		for (const powered of [false, true])
			assert.equal(read(`${id}[powered=${powered}]`).strength, powered ? 15 : 0);
	for (const id of ["redstone_torch", "redstone_wall_torch"])
		assert.equal(read(`${id}[lit=false]`).strength, 0);
	assert.equal(read("redstone_block").strength, 15);
	for (const id of [
		"daylight_detector",
		"light_weighted_pressure_plate",
		"heavy_weighted_pressure_plate",
		"target",
		"sculk_sensor",
	])
		assert.equal(read(`${id}[power=4]`).strength, 4);
});
test("receivers never fabricate input strength or imply they output power", () => {
	for (const state of [
		"redstone_lamp[lit=true]",
		"piston[extended=true]",
		"sticky_piston[extended=false]",
		"hopper[enabled=false]",
		"dispenser[triggered=true]",
		"powered_rail[powered=true]",
	]) {
		const info = read(state);
		assert.equal(info.strength, null);
		assert.equal(info.signalLabel, "输入强度");
	}
	assert.equal(read("hopper[enabled=false]").status, "已锁定");
	assert.equal(read("hopper[enabled=true]").active, false);
	assert.equal(read("furnace[lit=true]"), null);
	assert.equal(read("redstone_ore[lit=true]"), null);
	assert.equal(readRedstone("mod:repeater[powered=true]"), null);
});
test("missing, malformed and out-of-range snapshot values stay unknown", () => {
	for (const value of [undefined, null, "", "  ", true, {}, -1, 16, 3.5, NaN, Infinity])
		assert.equal(read("comparator[powered=true]", { OutputSignal: value }).strength, null);
	for (const power of ["", "-1", "16", "3.5", "NaN", "true"])
		assert.equal(read(`redstone_wire[power=${power}]`).strength, null);
	assert.equal(read("repeater").active, null);
	assert.equal(read("lever[powered=maybe]").strength, null);
	assert.equal(read("repeater[delay=8]").details[0].value, "未知");
});
test("real compressed redstone demo decodes saved states and comparator NBT", () => {
	const data = fs.readFileSync(new URL("./fixtures/redstone-demo.litematic", import.meta.url));
	const native = Schematic.fromData([...data]);
	try {
		const entities = new Map(
			JSON.parse(native.getAllBlockEntitiesJson()).map((e) => [e.position.join(","), e.nbt])
		);
		const inspect = (x, z) =>
			readRedstone(native.getBlockString(x, 1, z), entities.get(`${x},1,${z}`));
		assert.equal(inspect(2, 2).strength, 15);
		assert.equal(inspect(5, 2).strength, 7);
		assert.equal(inspect(8, 2).strength, 0);
		assert.equal(inspect(11, 2).strength, 15);
		assert.equal(inspect(14, 2).strength, 7);
		assert.equal(inspect(17, 2).strength, null);
		assert.equal(inspect(2, 8).status, "已点亮");
		assert.equal(inspect(2, 8).strength, null);
	} finally {
		native.clearContents();
	}
});
