import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { ChunkVisibilityManager } from "../../performance/ChunkVisibilityManager";
import { getClampedPixelRatio } from "../../utils/pixelRatio";
// @ts-expect-error The application uses plain JavaScript.
import { RenderSettings, readRenderSettings } from "../../../../example/src/render-settings.js";

beforeEach(() => {
	vi.useFakeTimers();
	localStorage.clear();
	document.documentElement.innerHTML = readFileSync("example/index.html", "utf8")
		.replace(/<script[\s\S]*?<\/script>/g, "")
		.replace(/<link[^>]+>/g, "");
});
afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("live rendering settings", () => {
	it("applies limits and presets, persists values, and keeps the camera unchanged", () => {
		const camera = new THREE.PerspectiveCamera();
		camera.position.set(10, 20, 30);
		const renderer = {
			canvas: document.getElementById("canvas"),
			options: { maxPixelRatio: 2 },
			cameraManager: { activeCamera: { camera } },
			chunkVisibility: new ChunkVisibilityManager(),
			renderManager: { setSSAOEnabled: vi.fn(), setMaxPixelRatio: vi.fn() },
			setTargetFPS: vi.fn(),
			invalidate: vi.fn(),
		};
		const settings = new RenderSettings(renderer);
		const limit = document.getElementById("render-maxChunks") as HTMLInputElement;
		limit.value = "12";
		limit.dispatchEvent(new Event("change"));
		expect(renderer.options).toMatchObject({ chunkRenderOptions: { maxChunks: 12 } });
		expect(readRenderSettings().maxChunks).toBe(12);
		const preset = document.getElementById("render-preset") as HTMLSelectElement;
		preset.value = "quality";
		preset.dispatchEvent(new Event("change"));
		expect(renderer.options).toMatchObject({
			chunkRenderOptions: { maxChunks: 0, renderDistance: 0 },
		});
		expect(renderer.renderManager.setSSAOEnabled).toHaveBeenLastCalledWith(true);
		expect(camera.position.toArray()).toEqual([10, 20, 30]);
		expect(limit.value).toBe("0");
		renderer.invalidate.mockClear();
		vi.advanceTimersByTime(3000);
		expect(renderer.invalidate).not.toHaveBeenCalled();
		settings.dispose();
		expect(vi.getTimerCount()).toBe(0);
	});
	it("handles corrupt stored JSON and a fractional pixel ratio on ordinary and HiDPI displays", () => {
		localStorage.setItem("mc-studio.render-settings.v1", "invalid");
		expect(readRenderSettings().maxChunks).toBe(512);
		vi.stubGlobal("devicePixelRatio", 1);
		expect(getClampedPixelRatio(0.75)).toBe(0.75);
		vi.stubGlobal("devicePixelRatio", 3);
		expect(getClampedPixelRatio(1)).toBe(1);
		expect(getClampedPixelRatio(2)).toBe(2);
	});
});
