import type { SchematicRenderer } from "./renderer/index.js";
/** Call from a user gesture when the caller wants to download the returned Blob. */
export function captureScreenshot(
	renderer: SchematicRenderer,
	type = "image/png",
	quality?: number
): Promise<Blob> {
	if (!renderer.renderManager) return Promise.reject(new Error("the renderer is not initialized yet"));
	renderer.renderManager.render();
	return new Promise((resolve, reject) => {
		try {
			renderer.canvas.toBlob(
				(blob) => (blob ? resolve(blob) : reject(new Error("screenshot failed"))),
				type,
				quality
			);
		} catch (error) {
			reject(error);
		}
	});
}
