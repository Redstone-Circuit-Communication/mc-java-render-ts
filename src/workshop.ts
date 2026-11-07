import { SchematicRenderer, type SchematicRendererOptions } from "./renderer/index.js";
import { BlueprintLoader } from "./blueprint-loader.js";
import { CameraControls } from "./camera-controls.js";
import { captureScreenshot } from "./capture.js";
export interface WorkshopOptions {
	canvas: HTMLCanvasElement;
	resourcePackUrl: string;
	resourcePackName?: string;
	rendererOptions?: SchematicRendererOptions;
	/** Initialization timeout, milliseconds. */
	timeoutMs?: number;
}
/** Initialize the renderer and its resource pack before returning an SDK instance. */
export function createWorkshopRenderer(options: WorkshopOptions): Promise<SchematicRenderer> {
	return new Promise<SchematicRenderer>((resolve, reject) => {
		let instance: SchematicRenderer | undefined;
		let settled = false;
		const finish = (error?: unknown, ready?: SchematicRenderer) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			options.canvas.removeEventListener("rendererError", onError);
			if (ready) resolve(ready);
			else {
				try {
					instance?.dispose();
				} finally {
					reject(error);
				}
			}
		};
		const onError = (event: Event) => finish((event as CustomEvent).detail);
		const timer = setTimeout(
			() => finish(new Error("渲染器初始化超时")),
			options.timeoutMs ?? 120000
		);
		options.canvas.addEventListener("rendererError", onError);
		try {
			instance = new SchematicRenderer(
				options.canvas,
				{},
				{
					[options.resourcePackName ?? "workshop"]: async () => {
						const response = await fetch(options.resourcePackUrl);
						if (!response.ok) throw new Error(`资源包请求失败（HTTP ${response.status}）`);
						return response.blob();
					},
				},
				{
					showGrid: true,
					showAxes: false,
					enableDragAndDrop: false,
					enableInteraction: false,
					singleSchematicMode: false,
					enableProgressBar: false,
					sidebarOptions: { enabled: false },
					resourcePackOptions: { showMissingPackNotice: false },
					...options.rendererOptions,
					callbacks: {
						...options.rendererOptions?.callbacks,
						onRendererInitialized: (ready) => {
							if (settled) {
								ready.dispose();
								return;
							}
							try {
								options.rendererOptions?.callbacks?.onRendererInitialized?.(ready);
								finish(undefined, ready);
							} catch (error) {
								finish(error);
							}
						},
					},
				}
			);
		} catch (error) {
			finish(error);
		}
	});
}

export async function createWorkshop(options: WorkshopOptions) {
	const renderer = await createWorkshopRenderer(options);
	const blueprints = new BlueprintLoader(renderer);
	const camera = new CameraControls(renderer);
	let closing: Promise<void> | undefined;
	return {
		renderer,
		blueprints,
		camera,
		load: blueprints.load.bind(blueprints),
		loadFile: blueprints.loadFile.bind(blueprints),
		loadUrl: blueprints.loadUrl.bind(blueprints),
		screenshot: (type?: string, quality?: number) => captureScreenshot(renderer, type, quality),
		dispose: () =>
			(closing ??= (async () => {
				await blueprints.dispose();
				renderer.dispose();
			})()),
	};
}
export type Workshop = Awaited<ReturnType<typeof createWorkshop>>;
