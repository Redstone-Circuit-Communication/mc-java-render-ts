import { describe, it, expect } from "vitest";
import { nextFrameTime } from "../framePacing";

describe("display frame pacing", () => {
	it("does not skip 60 Hz frames because of sub-millisecond rAF jitter", () => {
		let last = 0;
		for (let i = 1; i <= 600; i++) {
			const now = (i * 1000) / 60 + (i % 2 ? -0.4 : 0.4);
			const next = nextFrameTime(now, last, 1000 / 60);
			expect(next).not.toBeNull();
			last = next ?? last;
		}
		expect(last).toBeCloseTo(10000);
	});
	it.each([60, 120, 144, 240])("preserves the 60 FPS cap on a %s Hz display", (hz) => {
		let last = 0,
			count = 0;
		for (let i = 1; i <= hz * 10; i++) {
			const next = nextFrameTime((i * 1000) / hz, last, 1000 / 60);
			if (next !== null) {
				last = next;
				count++;
			}
		}
		expect(count).toBe(600);
	});
	it("wakes promptly after idle without accumulating catch-up frames", () => {
		const last = nextFrameTime(100000, 0, 1000 / 60) ?? 0;
		expect(last).toBeCloseTo(100000);
		expect(nextFrameTime(100001, last, 1000 / 60)).toBeNull();
		expect(nextFrameTime(100016.6, last, 1000 / 60)).not.toBeNull();
		expect(nextFrameTime(7, 6, 0)).toBe(7);
	});
});
