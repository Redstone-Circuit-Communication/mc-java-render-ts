/**
 * Compatibility worker using the shared TypeScript mesh core
 *
 * Preserves the existing worker protocol, batching, palette contexts and face culling.
 * Supports SharedArrayBuffer for zero-copy data transfer when available.
 */

// Import the WASM module - Vite will handle the bundling
import { LegacyMeshBuilder as MeshBuilder } from "./LegacyMeshBuilder";
import type { ChunkGeometryData } from "../types";
import { ChunkBatchAccumulator, prepareChunkGeometry } from "../performance/ChunkBatchGeometry";
import { CHUNK_INPUT_HEADER_SIZE } from "./SharedMemoryManager";

// Types
type PaletteGeometryData = {
	index: number;
	occlusionFlags: number;
	selfOcclusionFlags?: number;
	cullGroup?: string;
	category?: string;
	geometries: Array<{
		positions: Float32Array;
		normals: Float32Array;
		uvs: Float32Array;
		indices: Uint16Array | Uint32Array;
		materialIndex: number;
	}>;
};

type ChunkBuildRequest = {
	chunkKey?: string;
	chunkId: string;
	batchId?: string;
	blocks: number[][] | Int32Array;
	chunkOrigin?: [number, number, number];
	// SharedArrayBuffer support
	sharedInputBuffer?: SharedArrayBuffer;
	// Neighbouring chunks' boundary blocks (flat [x, y, z, paletteIndex, …], world
	// coords) for cross-chunk face culling. Occlusion lookup only — never rendered.
	apronBlocks?: Int32Array;
	// Identifies which view's palette to mesh against (shared worker pools). Absent → default.
	meshContextId?: string;
};

// Reused empty apron so chunks with no neighbour data don't allocate.
const EMPTY_APRON = new Int32Array(0);

// State. Mesh builders and batch accumulators are namespaced by `meshContextId`
// so several renderers can share one worker pool without their palettes
// colliding — one WASM MeshBuilder per view. Single-instance use stays on the
// `DEFAULT_CTX` id, so behavior is unchanged when no id is supplied.
const DEFAULT_CTX = "default";
const meshBuilders = new Map<string, MeshBuilder>();
let isInitialized = false;
let initPromise: Promise<void> | null = null;
// Old greedy backend is intentionally unavailable: it corrupts geometry and UVs.

/** Get (or lazily create) the WASM MeshBuilder for a mesh context. WASM must be initialized first. */
function getMeshBuilder(meshContextId: string = DEFAULT_CTX): MeshBuilder {
	let mb = meshBuilders.get(meshContextId);
	if (!mb) {
		mb = new MeshBuilder();
		meshBuilders.set(meshContextId, mb);
	}
	return mb;
}

// Batch mode state - accumulates all chunks before returning
// Uses Float32 for positions to avoid Int16 overflow with world coordinates
const batchAccumulators = new Map<string, ChunkBatchAccumulator>();

// Performance tracking
let buildCount = 0;
let totalBuildTime = 0;
let totalDataTransferTime = 0;

/**
 * Initialize the WASM module
 */
async function initialize(): Promise<void> {
	if (isInitialized) return;
	if (initPromise) return initPromise;

	initPromise = (async () => {
		try {
			// Initialize WASM - use new API format to avoid deprecation warning
			// Strict TypeScript backend needs no asynchronous WASM initialization.

			// Mesh builders are created lazily per mesh context (see getMeshBuilder).
			isInitialized = true;
		} catch (error) {
			console.error("[MeshBuilderWasm Worker] Failed to initialize:", error);
			throw error;
		}
	})();

	return initPromise;
}

// Initialize immediately when worker loads
initialize().catch(console.error);

/**
 * Handle messages from main thread
 */
self.onmessage = async (event: MessageEvent) => {
	const { type, ...payload } = event.data;

	try {
		// Ensure WASM is initialized before processing
		await initialize();

		switch (type) {
			case "disposeContext": {
				const contextId = payload.meshContextId ?? DEFAULT_CTX;
				meshBuilders.get(contextId)?.free();
				meshBuilders.delete(contextId);
				for (const key of batchAccumulators.keys()) {
					if (key.startsWith(contextId + ACC_DELIM)) batchAccumulators.delete(key);
				}
				break;
			}
			case "updatePalette":
				updatePalette(payload.paletteData, payload.meshContextId ?? DEFAULT_CTX);
				break;
			case "buildChunk":
				buildChunk(payload as unknown as ChunkBuildRequest);
				break;
			case "startBatch":
				startBatch(payload.meshContextId ?? DEFAULT_CTX, payload.batchId);
				break;
			case "finishBatch":
				finishBatch(payload.meshContextId ?? DEFAULT_CTX, payload.batchId);
				break;
			case "cancelBatch":
				clearBatch(payload.meshContextId ?? DEFAULT_CTX, payload.batchId);
				break;
			case "buildChunkBatched":
				buildChunkBatched(payload as unknown as ChunkBuildRequest);
				break;
			case "setGreedyMeshing":
				if (payload.enabled) throw new Error("Greedy meshing is disabled until geometry and texture equivalence are verified");
				self.postMessage({ type: "greedyMeshingSet", enabled: false });
				break;
			default:
				console.warn(`[MeshBuilderWasm Worker] Unknown message type: ${type}`);
		}
	} catch (error: unknown) {
		console.error("[MeshBuilderWasm Worker] Error:", error);
		self.postMessage({
			type: "error",
			error: error instanceof Error ? error.message : String(error),
			chunkId: payload.chunkId,
			batchId: payload.batchId,
			meshContextId: payload.meshContextId,
		});
	}
};

/**
 * Start batch mode - chunks will be accumulated instead of returned
 */
// Each leased sub-batch has its own accumulator and response ID.
const ACC_DELIM = "\0";
const batchPrefix = (meshContextId: string, batchId = "default") =>
	`${meshContextId}${ACC_DELIM}${batchId}${ACC_DELIM}`;
const accKey = (meshContextId: string, batchId: string | undefined, category: string) =>
	`${batchPrefix(meshContextId, batchId)}${category}`;

function clearBatch(meshContextId: string, batchId?: string) {
	const prefix = batchPrefix(meshContextId, batchId);
	for (const key of batchAccumulators.keys()) {
		if (key.startsWith(prefix)) batchAccumulators.delete(key);
	}
}

function startBatch(meshContextId: string, batchId?: string) {
	clearBatch(meshContextId, batchId);
}

/**
 * Finish batch mode - return all accumulated geometry as merged buffers
 * Uses Float32 for positions (no quantization) to support world-space coordinates
 */
function finishBatch(meshContextId: string, batchId?: string) {
	const startTime = performance.now();
	const meshes: Array<ChunkGeometryData & { vertexCount: number; isFloat32Positions: boolean }> =
		[];
	const transferables: Transferable[] = [];

	const prefix = batchPrefix(meshContextId, batchId);
	for (const [key, acc] of batchAccumulators) {
		if (!key.startsWith(prefix)) continue;
		const category = key.slice(prefix.length);
		const mesh = prepareChunkGeometry(acc.finish(category));
		if (!mesh.positions.length) continue;
		meshes.push({ ...mesh, vertexCount: mesh.positions.length / 3, isFloat32Positions: true });
		transferables.push(
			mesh.positions.buffer,
			mesh.normals.buffer,
			mesh.uvs.buffer,
			mesh.indices.buffer
		);
	}

	const elapsed = performance.now() - startTime;

	for (const key of [...batchAccumulators.keys()]) {
		if (key.startsWith(prefix)) batchAccumulators.delete(key);
	}

	(self as unknown as Worker).postMessage(
		{
			type: "batchFinished",
			meshContextId,
			batchId,
			meshes,
			origin: [0, 0, 0],
			timings: { finalize: elapsed },
		},
		{ transfer: transferables }
	);
}

/**
 * Build chunk in batch mode - accumulates results instead of returning
 */
function buildChunkBatched(request: ChunkBuildRequest) {
	if (!isInitialized) {
		throw new Error("WASM not initialized");
	}

	const { chunkId, batchId, blocks, chunkOrigin, sharedInputBuffer, apronBlocks } = request;
	const meshContextId = request.meshContextId ?? DEFAULT_CTX;
	const mb = getMeshBuilder(meshContextId);
	const startTime = performance.now();

	let blocksArray: Int32Array;
	let originX: number;
	let originY: number;
	let originZ: number;

	// Get blocks data (same logic as buildChunk)
	if (sharedInputBuffer) {
		const view = new DataView(sharedInputBuffer);
		const blockCount = view.getUint32(0, true);
		originX = view.getInt32(4, true);
		originY = view.getInt32(8, true);
		originZ = view.getInt32(12, true);
		blocksArray = new Int32Array(sharedInputBuffer, CHUNK_INPUT_HEADER_SIZE, blockCount * 4);
	} else if (blocks instanceof Int32Array) {
		blocksArray = blocks;
		originX = chunkOrigin?.[0] ?? 0;
		originY = chunkOrigin?.[1] ?? 0;
		originZ = chunkOrigin?.[2] ?? 0;
	} else {
		// Acknowledge even empty chunks in batch mode
		self.postMessage({ type: "chunkAccumulated", chunkId, batchId, meshContextId });
		return;
	}

	if (blocksArray.length === 0) {
		self.postMessage({ type: "chunkAccumulated", chunkId, batchId, meshContextId });
		return;
	}

	// Build chunk with WASM - use chunk's min position as origin
	// Use greedy meshing if enabled for better vertex reduction
	const apron = apronBlocks ?? EMPTY_APRON;
	const result = mb.build_chunk(blocksArray, originX, originY, originZ, apron);

	for (const mesh of result.meshes || []) {
		const key = accKey(meshContextId, batchId, mesh.category || "solid");
		let acc = batchAccumulators.get(key);
		if (!acc) {
			acc = new ChunkBatchAccumulator();
			batchAccumulators.set(key, acc);
		}
		acc.add(mesh, [originX, originY, originZ], request.chunkKey);
	}

	const elapsed = performance.now() - startTime;
	buildCount++;
	totalBuildTime += elapsed;

	// Acknowledge chunk processed (no data returned in batch mode)
	self.postMessage({
		type: "chunkAccumulated",
		chunkId,
		batchId,
		meshContextId,
		timings: { total: elapsed },
	});
}

/**
 * Update palette geometry data in WASM
 */
function updatePalette(paletteData: PaletteGeometryData[], meshContextId: string = DEFAULT_CTX) {
	if (!isInitialized) {
		throw new Error("WASM not initialized");
	}
	const mb = getMeshBuilder(meshContextId);

	// Convert palette data to format expected by WASM
	// The WASM module expects: { index, occlusionFlags, category, geometries: [...] }
	const wasmPaletteData = paletteData.map((item) => ({
		index: item.index,
		occlusionFlags: item.occlusionFlags || 0,
		selfOcclusionFlags: item.selfOcclusionFlags || 0,
		cullGroup: item.cullGroup || "",
		category: item.category || "solid",
		geometries: item.geometries.map((geom) => ({
			positions: geom.positions,
			normals: geom.normals,
			uvs: geom.uvs,
			indices: geom.indices instanceof Uint16Array ? new Uint32Array(geom.indices) : geom.indices,
			materialIndex: geom.materialIndex,
		})),
	}));

	mb.update_palette(wasmPaletteData);

	self.postMessage({ type: "paletteUpdated", count: paletteData.length });
}

/**
 * Build chunk mesh using WASM
 * Supports both SharedArrayBuffer (zero-copy) and regular transfers
 */
function buildChunk(request: ChunkBuildRequest) {
	if (!isInitialized) {
		throw new Error("WASM not initialized");
	}

	const { chunkId, blocks, chunkOrigin, sharedInputBuffer, apronBlocks } = request;
	const mb = getMeshBuilder(request.meshContextId ?? DEFAULT_CTX);
	const startTime = performance.now();
	let dataTransferStart = startTime;

	let blocksArray: Int32Array;
	let originX: number;
	let originY: number;
	let originZ: number;

	// Check if using SharedArrayBuffer (zero-copy path)
	if (sharedInputBuffer) {
		// Read directly from shared memory - NO COPY!
		const view = new DataView(sharedInputBuffer);
		const blockCount = view.getUint32(0, true);
		originX = view.getInt32(4, true);
		originY = view.getInt32(8, true);
		originZ = view.getInt32(12, true);

		// Create view into shared buffer - NO COPY!
		blocksArray = new Int32Array(sharedInputBuffer, CHUNK_INPUT_HEADER_SIZE, blockCount * 4);

		const dataTransferTime = performance.now() - dataTransferStart;
		totalDataTransferTime += dataTransferTime;
	} else {
		// Traditional path - data was copied via postMessage
		dataTransferStart = performance.now();

		if (blocks instanceof Int32Array) {
			blocksArray = blocks;
		} else if (Array.isArray(blocks)) {
			// Convert array of [x, y, z, paletteIndex] to flat Int32Array
			blocksArray = new Int32Array(blocks.length * 4);
			for (let i = 0; i < blocks.length; i++) {
				const block = blocks[i];
				blocksArray[i * 4] = block[0];
				blocksArray[i * 4 + 1] = block[1];
				blocksArray[i * 4 + 2] = block[2];
				blocksArray[i * 4 + 3] = block[3];
			}
		} else {
			self.postMessage({ type: "chunkBuilt", chunkId, meshes: [], origin: [0, 0, 0] });
			return;
		}

		// Calculate origin if not provided
		originX = chunkOrigin?.[0] ?? 0;
		originY = chunkOrigin?.[1] ?? 0;
		originZ = chunkOrigin?.[2] ?? 0;

		if (!chunkOrigin) {
			// Auto-detect origin from block positions
			let minX = Infinity,
				minY = Infinity,
				minZ = Infinity;
			for (let i = 0; i < blocksArray.length; i += 4) {
				minX = Math.min(minX, blocksArray[i]);
				minY = Math.min(minY, blocksArray[i + 1]);
				minZ = Math.min(minZ, blocksArray[i + 2]);
			}
			originX = minX;
			originY = minY;
			originZ = minZ;
		}
	}

	if (blocksArray.length === 0) {
		self.postMessage({ type: "chunkBuilt", chunkId, meshes: [], origin: [0, 0, 0] });
		return;
	}

	const wasmStart = performance.now();

	// Call WASM build_chunk (with or without greedy meshing)
	const apron = apronBlocks ?? EMPTY_APRON;
	const result = mb.build_chunk(blocksArray, originX, originY, originZ, apron);

	const wasmTime = performance.now() - wasmStart;
	const elapsed = performance.now() - startTime;

	// Track performance
	buildCount++;
	totalBuildTime += elapsed;

	// Log performance periodically
	if (buildCount % 50 === 0) {
		const avgTime = totalBuildTime / buildCount;
		const avgDataTime = totalDataTransferTime / buildCount;
		const memMode = sharedInputBuffer ? "SharedArrayBuffer" : "postMessage copy";
		console.log(
			`[MeshBuilderWasm Stats] Avg total: ${avgTime.toFixed(2)}ms, data: ${avgDataTime.toFixed(3)}ms (${memMode})`
		);
	}

	// Extract transferable buffers (still need to transfer output data)
	const transferables: Transferable[] = [];
	const meshes = result.meshes || [];

	for (const mesh of meshes) {
		if (mesh.positions?.buffer) transferables.push(mesh.positions.buffer);
		if (mesh.normals?.buffer) transferables.push(mesh.normals.buffer);
		if (mesh.uvs?.buffer) transferables.push(mesh.uvs.buffer);
		if (mesh.indices?.buffer) transferables.push(mesh.indices.buffer);
	}

	self.postMessage(
		{
			type: "chunkBuilt",
			chunkId,
			meshes,
			origin: result.origin || [originX, originY, originZ],
			timings: {
				total: elapsed,
				wasm: wasmTime,
				dataTransfer: sharedInputBuffer ? 0 : elapsed - wasmTime,
			},
		},
		{ transfer: transferables }
	);
}
