import { ChunkSpatialIndex } from "./ChunkSpatialIndex";
import { topK } from "../core/spatial.js";
import * as THREE from "three";
import type { ChunkGeometryGroup } from "../types";

export interface ChunkRenderOptions {
	/** Maximum submitted 3D sections across all schematics. 0 = unlimited. */
	maxChunks?: number;
	/** World-space distance to the nearest point on a section's bounds. 0 = unlimited. */
	renderDistance?: number;
	frustumCulling?: boolean;
}

// Three.js objects can originate from a consumer's copy of the library.
function isMesh(object: THREE.Object3D): object is THREE.Mesh {
	return (object as THREE.Mesh).isMesh === true;
}
function isInstancedMesh(object: THREE.Object3D): object is THREE.InstancedMesh {
	return (object as THREE.InstancedMesh).isInstancedMesh === true;
}

interface Chunk {
	key: string;
	local: THREE.Box3;
	world: THREE.Box3;
	distance: number;
	root: THREE.Object3D;
	order: number;
}
interface Binding {
	apply(selected: Set<string>): void;
	restore(): void;
	stats(): { calls: number; triangles: number };
}
interface Entry {
	root: THREE.Object3D;
	chunks: Map<string, Chunk>;
	bindings: Binding[];
	matrix: THREE.Matrix4;
	visible: boolean;
	dirty: boolean;
	spatialIndex?: ChunkSpatialIndex<Chunk>;
	selectedKeys: Set<string>;
}

/** Retains material batching while selecting individual chunk index ranges.
 * No remeshing, GPU buffer allocation, or per-block traversal during flight. */
export class ChunkVisibilityManager {
	private entries = new Map<THREE.Object3D, Entry>();
	private options = { maxChunks: 0, renderDistance: 0, frustumCulling: true };
	private dirty = true;
	private nextOrder = 0;
	private queryBuffer: Chunk[] = [];
	private lastView = new THREE.Matrix4().makeScale(0, 0, 0);
	private view = new THREE.Matrix4();
	private frustum = new THREE.Frustum();
	private cameraPosition = new THREE.Vector3();
	private stats = { totalChunks: 0, visibleChunks: 0, drawCalls: 0, triangles: 0 };

	setOptions(options: ChunkRenderOptions): void {
		for (const key of ["maxChunks", "renderDistance"] as const) {
			const value = options[key];
			if (value !== undefined && Number.isFinite(value))
				this.options[key] = Math.max(0, Math.floor(value));
		}
		if (options.frustumCulling !== undefined) this.options.frustumCulling = options.frustumCulling;
		this.dirty = true;
	}

	getStats() {
		return { ...this.stats };
	}

	register(root: THREE.Object3D, objects: THREE.Object3D[], sectionSize = 16): void {
		this.unregister(root);
		root.updateWorldMatrix(true, true);
		const inverse = root.matrixWorld.clone().invert();
		const chunks = new Map<string, Chunk>();
		const bindings: Binding[] = [];
		const add = (key: string, box: THREE.Box3) => {
			const chunk = chunks.get(key);
			if (chunk) chunk.local.union(box);
			else
				chunks.set(key, {
					key,
					local: box.clone(),
					world: new THREE.Box3(),
					distance: 0,
					root,
					order: this.nextOrder++,
				});
		};
		const keyAt = (position: THREE.Vector3) =>
			[position.x, position.y, position.z]
				.map((n) => Math.floor(Math.round(n) / sectionSize))
				.join(",");
		const meshStats = (object: THREE.Object3D) => {
			let calls = 0,
				triangles = 0;
			object.traverseVisible((child) => {
				if (!isMesh(child)) return;
				const instances = isInstancedMesh(child) ? child.count : 1;
				const groups = child.geometry.groups;
				const grouped = Array.isArray(child.material);
				calls += instances ? (grouped ? groups.length : 1) : 0;
				triangles +=
					(instances *
						(grouped
							? groups.reduce((n, g) => n + g.count, 0)
							: (child.geometry.index?.count ?? child.geometry.attributes.position?.count ?? 0))) /
					3;
			});
			return { calls, triangles };
		};
		for (const object of objects) {
			const data = object.userData.chunkGeometry as
				| {
						ranges: ChunkGeometryGroup[];
						bounds: Record<string, { min: number[]; max: number[] }>;
				  }
				| undefined;
			if (isMesh(object) && data) {
				const relative = inverse.clone().multiply(object.matrixWorld);
				for (const [key, box] of Object.entries(data.bounds))
					add(
						key,
						new THREE.Box3(
							new THREE.Vector3().fromArray(box.min),
							new THREE.Vector3().fromArray(box.max)
						).applyMatrix4(relative)
					);
				const original = object.geometry.groups.map((g) => ({ ...g }));
				const visible = object.visible;
				let submittedIndices = 0;
				bindings.push({
					apply: (selected) => {
						const groups = object.geometry.groups;
						groups.length = 0;
						submittedIndices = 0;
						for (const range of data.ranges) {
							if (range.chunkKey !== undefined && !selected.has(range.chunkKey)) continue;
							submittedIndices += range.count;
							const last = groups[groups.length - 1];
							if (
								last &&
								last.materialIndex === range.materialIndex &&
								last.start + last.count === range.start
							)
								last.count += range.count;
							else
								groups.push({
									start: range.start,
									count: range.count,
									materialIndex: range.materialIndex,
								});
						}
						object.visible = visible && groups.length > 0;
					},
					restore: () => {
						object.geometry.groups = original;
						object.visible = visible;
					},
					stats: () => {
						if (object.children.length || !Array.isArray(object.material)) return meshStats(object);
						return {
							calls: object.visible ? object.geometry.groups.length : 0,
							triangles: object.visible ? submittedIndices / 3 : 0,
						};
					},
				});
				continue;
			}
			// Static block-entity overlays use InstancedMesh; compact visible instances
			// from an immutable copy, so repeated culling and restoring never loses data.
			if (isInstancedMesh(object) || object.name.startsWith("schematic-renderer:")) {
				object.traverse((child) => {
					if (!isInstancedMesh(child)) return;
					const count = child.count,
						visible = child.visible;
					const matrices = child.instanceMatrix.array.slice();
					const colors = child.instanceColor?.array.slice();
					const keys: string[] = [];
					const relative = inverse.clone().multiply(child.matrixWorld);
					const instance = new THREE.Matrix4();
					if (!child.geometry.boundingBox) child.geometry.computeBoundingBox();
					const localBox = child.geometry.boundingBox;
					if (!localBox || localBox.isEmpty()) return;
					for (let i = 0; i < count; i++) {
						instance.fromArray(matrices, i * 16).premultiply(relative);
						const key = keyAt(new THREE.Vector3().setFromMatrixPosition(instance));
						keys.push(key);
						add(key, localBox.clone().applyMatrix4(instance));
					}
					// Preserve full bounds: compacting must never leave stale *smaller* bounds.
					child.computeBoundingBox();
					child.computeBoundingSphere();
					bindings.push({
						apply: (selected) => {
							let next = 0;
							for (let i = 0; i < count; i++)
								if (selected.has(keys[i])) {
									child.instanceMatrix.array.set(matrices.subarray(i * 16, i * 16 + 16), next * 16);
									if (colors && child.instanceColor)
										child.instanceColor.array.set(colors.subarray(i * 3, i * 3 + 3), next * 3);
									next++;
								}
							child.count = next;
							child.visible = visible && next > 0;
							child.instanceMatrix.needsUpdate = true;
							if (child.instanceColor) child.instanceColor.needsUpdate = true;
						},
						restore: () => {
							child.instanceMatrix.array.set(matrices);
							child.instanceMatrix.needsUpdate = true;
							if (colors && child.instanceColor) {
								child.instanceColor.array.set(colors);
								child.instanceColor.needsUpdate = true;
							}
							child.count = count;
							child.visible = visible;
						},
						stats: () => meshStats(child),
					});
				});
			} else {
				// Signs and conventional per-chunk meshes remain ordinary objects.
				const box = new THREE.Box3().setFromObject(object).applyMatrix4(inverse);
				if (box.isEmpty()) continue;
				const key = object.userData.chunkKey ?? keyAt(box.getCenter(new THREE.Vector3()));
				add(key, box);
				const visible = object.visible;
				bindings.push({
					apply: (selected) => {
						object.visible = visible && selected.has(key);
					},
					restore: () => {
						object.visible = visible;
					},
					stats: () => meshStats(object),
				});
			}
		}
		for (const chunk of chunks.values())
			chunk.world.copy(chunk.local).applyMatrix4(root.matrixWorld);
		this.entries.set(root, {
			root,
			chunks,
			bindings,
			matrix: root.matrixWorld.clone(),
			spatialIndex: chunks.size >= 128 ? new ChunkSpatialIndex([...chunks.values()]) : undefined,
			visible: root.visible,
			dirty: true,
			selectedKeys: new Set(),
		});
		this.dirty = true;
	}

	unregister(root: THREE.Object3D): void {
		for (const binding of this.entries.get(root)?.bindings ?? []) binding.restore();
		this.entries.delete(root);
		this.dirty = true;
	}

	update(camera: THREE.Camera): void {
		camera.updateWorldMatrix(true, false);
		this.view.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
		const cameraDependent =
			this.options.frustumCulling || this.options.renderDistance > 0 || this.options.maxChunks > 0;
		let changed = this.dirty || (cameraDependent && !this.lastView.equals(this.view));
		for (const entry of this.entries.values()) {
			entry.root.updateWorldMatrix(true, false);
			if (!entry.matrix.equals(entry.root.matrixWorld)) {
				entry.matrix.copy(entry.root.matrixWorld);
				for (const chunk of entry.chunks.values())
					chunk.world.copy(chunk.local).applyMatrix4(entry.matrix);
				entry.spatialIndex?.refit();
				changed = true;
			}
			let visible = true;
			for (let parent: THREE.Object3D | null = entry.root; parent; parent = parent.parent)
				visible &&= parent.visible;
			if (entry.visible !== visible) {
				entry.visible = visible;
				changed = true;
			}
		}
		if (!changed) return;
		this.lastView.copy(this.view);
		this.frustum.setFromProjectionMatrix(this.view, camera.coordinateSystem);
		this.cameraPosition.setFromMatrixPosition(camera.matrixWorld);
		let candidates: Chunk[] = [];
		const needDistance = this.options.renderDistance > 0 || this.options.maxChunks > 0;
		for (const entry of this.entries.values()) {
			if (!entry.visible) continue;
			let source: Iterable<Chunk> = entry.chunks.values();
			if (entry.spatialIndex && (this.options.frustumCulling || this.options.renderDistance > 0)) {
				this.queryBuffer.length = 0;
				entry.spatialIndex.query(
					this.options.frustumCulling ? this.frustum : undefined,
					this.cameraPosition,
					this.options.renderDistance,
					this.queryBuffer
				);
				source = this.queryBuffer;
			}
			for (const chunk of source) {
				if (needDistance) {
					const p = this.cameraPosition,
						b = chunk.world;
					const dx = Math.max(b.min.x - p.x, 0, p.x - b.max.x);
					const dy = Math.max(b.min.y - p.y, 0, p.y - b.max.y);
					const dz = Math.max(b.min.z - p.z, 0, p.z - b.max.z);
					chunk.distance = dx * dx + dy * dy + dz * dz;
				}
				if (this.options.renderDistance > 0 && chunk.distance > this.options.renderDistance ** 2)
					continue;
				if (
					!entry.spatialIndex &&
					this.options.frustumCulling &&
					!this.frustum.intersectsBox(chunk.world)
				)
					continue;
				candidates.push(chunk);
			}
		}
		if (this.options.maxChunks > 0 && candidates.length > this.options.maxChunks) {
			candidates = topK(
				candidates,
				this.options.maxChunks,
				(a, b) => a.distance - b.distance || a.key.localeCompare(b.key) || a.order - b.order
			);
		}
		const selections = new Map<THREE.Object3D, Set<string>>();
		for (const chunk of candidates) {
			let keys = selections.get(chunk.root);
			if (!keys) {
				keys = new Set();
				selections.set(chunk.root, keys);
			}
			keys.add(chunk.key);
		}
		const stats = { totalChunks: 0, visibleChunks: candidates.length, drawCalls: 0, triangles: 0 };
		for (const entry of this.entries.values()) {
			const keys = selections.get(entry.root) ?? new Set<string>();
			const selectionChanged =
				entry.dirty ||
				keys.size !== entry.selectedKeys.size ||
				[...keys].some((key) => !entry.selectedKeys.has(key));
			if (selectionChanged) {
				for (const binding of entry.bindings) binding.apply(keys);
				entry.selectedKeys = keys;
			}
			entry.dirty = false;
			if (entry.visible) {
				stats.totalChunks += entry.chunks.size;
				for (const binding of entry.bindings) {
					const result = binding.stats();
					stats.drawCalls += result.calls;
					stats.triangles += result.triangles;
				}
			}
		}
		this.stats = stats;
		this.dirty = false;
	}
}
