import test from "node:test";
import assert from "node:assert/strict";
import { FrameStats } from "../dist/frame-stats.js";

for (const hz of [30, 60, 120, 144, 240])
	test(`steady ${hz} FPS reports matching live and 1% Low`, () => {
		const stats = new FrameStats();
		for (let i = 0; i <= hz * 5; i++) stats.record((i * 1000) / hz);
		const result = stats.snapshot(5000);
		assert.ok(Math.abs(result.fps - hz) < 1e-6);
		assert.ok(Math.abs(result.low - hz) < 1e-6);
	});
test("1% Low is the reciprocal mean of the slowest frame times, not minimum FPS or mean FPS", () => {
	const stats = new FrameStats();
	let at = 0;
	stats.record(at);
	for (let i = 0; i < 198; i++) stats.record((at += 10));
	stats.record((at += 50));
	stats.record((at += 100));
	assert.equal(stats.snapshot(at).low, 1000 / 75);
});
test("idle intervals are excluded, long active stalls remain measurable", () => {
	const stats = new FrameStats();
	let at = 0;
	stats.record(at);
	for (let i = 0; i < 100; i++) stats.record((at += 10));
	stats.idle();
	assert.equal(stats.snapshot(at + 500).fps, 0);
	stats.record((at += 2000));
	stats.record((at += 10));
	assert.equal(stats.snapshot(at).low, 100);
	stats.record((at += 1000));
	assert.ok(stats.snapshot(at).low < 3);
});
test("requires 100 intervals and expires the rolling window", () => {
	const stats = new FrameStats();
	stats.record(0);
	for (let i = 1; i < 100; i++) stats.record(i * 10);
	assert.equal(stats.snapshot(990).low, null);
	stats.record(1000);
	assert.equal(stats.snapshot(1000).low, 100);
	stats.idle();
	assert.equal(stats.snapshot(12000).low, null);
});
test("reset drops old scene measurements and malformed input cannot produce NaN", () => {
	const stats = new FrameStats();
	stats.record(0);
	stats.record(16);
	stats.record(NaN);
	stats.record(Infinity);
	assert.ok(Number.isFinite(stats.snapshot(16).fps));
	stats.reset();
	assert.deepEqual(stats.snapshot(100), {
		fps: 0,
		low: null,
		active: false,
		samples: 0,
	});
	stats.record(100);
	stats.record(100);
	assert.equal(stats.snapshot(100).samples, 0);
});
test("sample storage stays bounded even with uncapped submissions", () => {
	const stats = new FrameStats();
	for (let i = 0; i < 20000; i++) stats.record(i / 10);
	assert.equal(stats.snapshot(2000).samples, 4096);
});
