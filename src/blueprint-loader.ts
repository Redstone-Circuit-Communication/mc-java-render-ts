import type { SchematicRenderer } from "./renderer/index.js";
import { MaterialsCounter } from "./materials-client.js";
import type { Material, MaterialsResult } from "./types.js";
export type LoadedSchematic = ReturnType<
	NonNullable<SchematicRenderer["schematicManager"]>["getAllSchematics"]
>[number];
export interface BlueprintResult extends MaterialsResult {
	id: string;
	filename: string;
	schematic: LoadedSchematic;
	dimensions: number[];
	totalBlocks: number;
}
export interface MaterialCounter {
	count(buffer: ArrayBuffer): Promise<MaterialsResult>;
	dispose(): void;
}
export interface BlueprintLoaderOptions {
	counter?: MaterialCounter;
	/** Runs after the new scene is built and before the old scene is removed (with `chunkLoading`: before the new one streams in). */
	beforeReplace?: () => void;
}
/** Third argument of `load` (same in both libraries). */
export interface LoadHooks {
	/**
	 * The new blueprint is in the scene. With the renderer's `chunkLoading` this comes before its first chunk (size known:
	 * aim the camera here); without it, right before the load resolves.
	 */
	onStart?(schematic: LoadedSchematic): void;
	/** With `chunkLoading`: `done` of `total` chunks are on screen. */
	onChunk?(done: number, total: number): void;
	/** Abort to cancel the load (it rejects with an `AbortError`). */
	signal?: AbortSignal;
}
/** The error a cancelled load rejects with (a newer load, `dispose`, an aborted signal). */
export function abortError(): Error {
	return typeof DOMException === "function"
		? new DOMException("structure loading was aborted", "AbortError")
		: Object.assign(new Error("structure loading was aborted"), { name: "AbortError" });
}
export const isAbortError = (e: unknown): boolean =>
	!!e && typeof e === "object" && (e as { name?: unknown }).name === "AbortError";
const AIR = new Set(["minecraft:air", "minecraft:cave_air", "minecraft:void_air"]);
/**
 * Serializes loads; parse/build failures leave the previous blueprint intact.
 * With the renderer's `chunkLoading` the new blueprint streams in chunk by chunk: the previous one stays until the new one
 * has parsed, and a new `load` cancels the one still streaming (it rejects with an `AbortError`).
 */
export class BlueprintLoader {
	private counter: MaterialCounter;
	private serial = 0;
	private queue: Promise<unknown> = Promise.resolve();
	private disposed = false;
	private namespace = `workshop-${Math.random().toString(36).slice(2)}`;
	private streaming?: AbortController;
	constructor(
		private renderer: SchematicRenderer,
		private options: BlueprintLoaderOptions = {}
	) {
		this.counter = options.counter ?? new MaterialsCounter();
	}
	load(buffer: ArrayBuffer, filename: string, hooks: LoadHooks = {}): Promise<BlueprintResult> {
		if (this.disposed) return Promise.reject(new Error("the blueprint loader has been disposed"));
		if (!/\.(litematic|schem|schematic|nbt)$/i.test(filename))
			return Promise.reject(new Error("unsupported schematic format"));
		// Snapshot before queuing so caller mutations cannot corrupt an upcoming load.
		const copy = buffer.slice(0);
		const stop = new AbortController();
		if (this.chunked) {
			this.streaming?.abort();
			this.streaming = stop;
		}
		const onAbort = () => stop.abort();
		if (hooks.signal?.aborted) stop.abort();
		else hooks.signal?.addEventListener("abort", onAbort, { once: true });
		const task = this.queue
			.then(() => this.loadOne(copy, filename, hooks, stop.signal))
			.finally(() => {
				hooks.signal?.removeEventListener("abort", onAbort);
				if (this.streaming === stop) this.streaming = undefined;
			});
		this.queue = task.catch(() => undefined);
		return task;
	}
	private get chunked(): boolean {
		// hosts and tests may hand in a renderer without options: no chunk streaming then
		return !!this.renderer.options?.chunkLoading;
	}
	async loadFile(file: File): Promise<BlueprintResult> {
		return this.load(await file.arrayBuffer(), file.name);
	}
	async loadUrl(url: string | URL, init?: RequestInit): Promise<BlueprintResult> {
		const response = await fetch(url, init);
		if (!response.ok) throw new Error(`schematic request failed (HTTP ${response.status})`);
		const pathname = String(url).split(/[?#]/)[0];
		const filename = decodeURIComponent(pathname.split("/").pop() || "blueprint.litematic");
		return this.load(await response.arrayBuffer(), filename);
	}
	private assertOpen(): void {
		if (this.disposed) throw new Error("the blueprint loader has been disposed");
	}
	private async loadOne(
		buffer: ArrayBuffer,
		filename: string,
		hooks: LoadHooks,
		signal: AbortSignal
	): Promise<BlueprintResult> {
		this.assertOpen();
		if (signal.aborted) throw abortError();
		const manager = this.renderer.schematicManager;
		if (!manager) throw new Error("the renderer is not initialized yet");
		const id = `${this.namespace}-${++this.serial}`;
		const chunked = this.chunked;
		const events = this.renderer.eventEmitter;
		const onProgress = (e: { id: string; done: number; total: number }) => {
			if (e.id === id) hooks.onChunk?.(e.done, e.total);
		};
		// removing the schematic stops its build at the next chunk (SchematicObject.ensureBuildCurrent)
		const onAbort = () => void manager.removeSchematic(id);
		signal.addEventListener("abort", onAbort, { once: true });
		const replaceOld = () => {
			this.options.beforeReplace?.();
			for (const old of manager.getAllSchematics()) if (old.id !== id) void manager.removeSchematic(old.id);
		};
		try {
			let result = /\.litematic$/i.test(filename) ? await this.counter.count(buffer) : null;
			this.assertOpen();
			if (signal.aborted) throw abortError();
			if (chunked) events?.on("schematicChunkProgress", onProgress);
			await manager.loadSchematic(id, buffer, { focused: false });
			this.assertOpen();
			const schematic = manager.getAllSchematics().find((s) => s.id === id);
			if (!schematic) throw signal.aborted ? abortError() : new Error("the schematic loaded but is missing from the scene");
			if (chunked) {
				// parsed: the new one streams in where the old one was
				replaceOld();
				hooks.onStart?.(schematic);
			} else schematic.group.visible = false;
			await schematic.getMeshes();
			this.assertOpen();
			if (signal.aborted || !manager.getAllSchematics().includes(schematic)) throw abortError();
			if (!result) {
				const counts = JSON.parse(schematic.schematicWrapper.native.countBlocksJson()) as Record<
					string,
					number
				>;
				const materials: Material[] = Object.entries(counts)
					.filter(
						([block, count]) => !AIR.has(block.split("[")[0]) && Number.isFinite(count) && count > 0
					)
					.map(([id, count]) => ({
						id,
						count,
						stacks: Math.floor(count / 64),
						remainder: count % 64,
					}))
					.sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
				result = { regionCount: 1, materials };
			}
			const dimensions = schematic.getTightDimensions();
			if (!chunked) {
				replaceOld();
				schematic.group.visible = true;
				hooks.onStart?.(schematic);
			}
			this.renderer.invalidate();
			return {
				...result,
				id,
				filename,
				schematic,
				dimensions,
				totalBlocks: result.materials.reduce((n, m) => n + m.count, 0),
			};
		} catch (error) {
			try {
				await manager.removeSchematic(id);
			} catch {
				/* Preserve the original failure. */
			}
			throw signal.aborted && !this.disposed ? abortError() : error;
		} finally {
			signal.removeEventListener("abort", onAbort);
			// a host renderer without an event emitter (and the tests' stand-in) never subscribed
			events?.removeListener("schematicChunkProgress", onProgress);
		}
	}
	/** Stops the worker immediately; await completion before disposing the renderer. */
	async dispose(): Promise<void> {
		this.disposed = true;
		this.streaming?.abort();
		this.counter.dispose();
		await this.queue;
	}
}
