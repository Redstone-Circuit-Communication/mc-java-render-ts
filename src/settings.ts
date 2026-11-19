import type { RenderSettingsValue } from "./types.js";
import type { SchematicRenderer } from "./renderer/index.js";
import { applyShading } from "./shading.js";
export const STORAGE_KEY = "mc-studio.render-settings.v1";
export const RENDER_PRESETS: Record<"performance" | "balanced" | "quality", RenderSettingsValue> = {
	performance: {
		maxChunks: 128,
		renderDistance: 256,
		maxPixelRatio: 0.75,
		ssao: false,
		targetFPS: 60,
		frustumCulling: true,
	},
	balanced: {
		maxChunks: 512,
		renderDistance: 0,
		maxPixelRatio: 1,
		ssao: false,
		targetFPS: 60,
		frustumCulling: true,
	},
	quality: {
		maxChunks: 0,
		renderDistance: 0,
		maxPixelRatio: 2,
		ssao: true,
		targetFPS: 60,
		frustumCulling: true,
	},
};
export function normalizeRenderSettings(input: Record<string, unknown> = {}): RenderSettingsValue {
	input = input && typeof input === "object" ? input : {};
	const defaults = RENDER_PRESETS.balanced;
	const number = (
		key: "maxChunks" | "renderDistance" | "maxPixelRatio" | "targetFPS",
		min: number,
		max: number,
		round = true
	) => {
		const n = input[key];
		if (typeof n !== "number" || !Number.isFinite(n)) return defaults[key];
		const clamped = Math.min(max, Math.max(min, n));
		return round ? Math.floor(clamped) : clamped;
	};
	return {
		maxChunks: number("maxChunks", 0, 32768),
		renderDistance: number("renderDistance", 0, 8192),
		maxPixelRatio: number("maxPixelRatio", 0.5, 2, false),
		targetFPS: number("targetFPS", 0, 240),
		ssao: typeof input.ssao === "boolean" ? input.ssao : defaults.ssao,
		frustumCulling:
			typeof input.frustumCulling === "boolean" ? input.frustumCulling : defaults.frustumCulling,
	};
}
export function readRenderSettings() {
	try {
		return normalizeRenderSettings(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") ?? {});
	} catch {
		return normalizeRenderSettings();
	}
}

/** Apply rendering settings without requiring a particular HTML page. */
export function applyRenderSettings(
	renderer: SchematicRenderer,
	input: Partial<RenderSettingsValue>
): RenderSettingsValue {
	if (!renderer.renderManager) throw new Error("the renderer is not initialized yet");
	const settings = normalizeRenderSettings(input);
	const { maxChunks, renderDistance, frustumCulling, ssao, maxPixelRatio, targetFPS } = settings;
	renderer.options.chunkRenderOptions = { maxChunks, renderDistance, frustumCulling };
	renderer.chunkVisibility.setOptions(renderer.options.chunkRenderOptions);
	if (renderer.options.maxPixelRatio !== maxPixelRatio)
		renderer.renderManager.setMaxPixelRatio(maxPixelRatio);
	renderer.renderManager.setSSAOEnabled(ssao);
	// lightweight shading (optional key: hosts that never send it keep the original lights)
	if (typeof input.shading === "boolean") applyShading(renderer, input.shading, input.shadingQuality === "high" ? "high" : "normal");
	renderer.setTargetFPS(targetFPS);
	renderer.invalidate();
	return settings;
}
