import type { SchematicRenderer } from "./renderer/index.js";
/** Call from a user gesture when the caller wants to download the returned Blob. */
export function captureScreenshot(
	renderer: SchematicRenderer,
	type = "image/png",
	quality?: number
): Promise<Blob> {
	if (!renderer.renderManager) return Promise.reject(new Error("渲染器尚未初始化"));
	renderer.renderManager.render();
	return new Promise((resolve, reject) => {
		try {
			renderer.canvas.toBlob(
				(blob) => (blob ? resolve(blob) : reject(new Error("截图失败"))),
				type,
				quality
			);
		} catch (error) {
			reject(error);
		}
	});
}
