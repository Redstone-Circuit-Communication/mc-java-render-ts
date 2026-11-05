import { afterEach, it, expect, vi } from "vitest";
import { createWorkCheckpoint } from "../cooperativeYield";
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});
it("shares a real task boundary across lanes and resets the budget after resuming", async () => {
	let now = 0;
	vi.spyOn(performance, "now").mockImplementation(() => now);
	let resume!: () => void;
	const yieldTask = vi.fn(
		() =>
			new Promise<void>((resolve) => {
				resume = resolve;
			})
	);
	vi.stubGlobal("scheduler", { yield: yieldTask });
	const checkpoint = createWorkCheckpoint(6);
	expect(checkpoint()).toBeUndefined();
	now = 7;
	const pause = checkpoint();
	expect(pause).toBeInstanceOf(Promise);
	expect(checkpoint()).toBe(pause);
	expect(yieldTask).toHaveBeenCalledOnce();
	now = 100;
	resume();
	await pause;
	expect(checkpoint()).toBeUndefined();
});
