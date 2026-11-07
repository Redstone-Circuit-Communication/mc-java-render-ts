import type { ChunkGeometryData, ChunkGeometryGroup } from "../types";

/** Finalize in the worker before transferring buffers to the renderer. */
export function prepareChunkGeometry(data: ChunkGeometryData): ChunkGeometryData {
	const sorted = sortChunkGeometry(data);
	if (sorted.normals instanceof Int8Array) {
		const normals = new Float32Array(sorted.normals.length);
		for (let i = 0; i < normals.length; i++) normals[i] = sorted.normals[i] / 127;
		sorted.normals = normals;
	}
	return sorted;
}

/** Keep compact WASM arrays until the final allocation, instead of expanding every
 * vertex into several growable JavaScript number arrays and copying it again. */
export class ChunkBatchAccumulator {
	private parts: { mesh: ChunkGeometryData; origin: number[]; key?: string }[] = [];
	private vertices = 0;
	private indices = 0;

	add(mesh: ChunkGeometryData, origin: number[], key?: string): void {
		this.parts.push({ mesh, origin, key });
		this.vertices += mesh.positions.length / 3;
		this.indices += mesh.indices.length;
	}

	finish(category: string): ChunkGeometryData {
		const positions = new Float32Array(this.vertices * 3);
		const normals = new Int8Array(this.vertices * 3);
		const uvs = new Float32Array(this.vertices * 2);
		const indices =
			this.vertices > 65535 ? new Uint32Array(this.indices) : new Uint16Array(this.indices);
		const groups: ChunkGeometryGroup[] = [];
		const chunkBounds: NonNullable<ChunkGeometryData["chunkBounds"]> = {};
		let vertexOffset = 0,
			indexOffset = 0;
		for (const { mesh, origin, key } of this.parts) {
			const min = [Infinity, Infinity, Infinity],
				max = [-Infinity, -Infinity, -Infinity];
			for (let i = 0; i < mesh.positions.length; i++) {
				const axis = i % 3;
				const value =
					mesh.positions[i] / (mesh.positions instanceof Int16Array ? 1024 : 1) + origin[axis];
				positions[vertexOffset * 3 + i] = value;
				min[axis] = Math.min(min[axis], value);
				max[axis] = Math.max(max[axis], value);
			}
			if (key && mesh.positions.length) {
				const box = chunkBounds[key];
				if (box)
					for (let axis = 0; axis < 3; axis++) {
						box.min[axis] = Math.min(box.min[axis], min[axis]);
						box.max[axis] = Math.max(box.max[axis], max[axis]);
					}
				else chunkBounds[key] = { min, max };
			}
			normals.set(mesh.normals, vertexOffset * 3);
			uvs.set(mesh.uvs, vertexOffset * 2);
			for (let i = 0; i < mesh.indices.length; i++)
				indices[indexOffset + i] = mesh.indices[i] + vertexOffset;
			for (const group of mesh.groups)
				groups.push({
					start: indexOffset + group.start,
					count: group.count,
					materialIndex: group.materialIndex,
					chunkKey: key,
				});
			vertexOffset += mesh.positions.length / 3;
			indexOffset += mesh.indices.length;
		}
		this.parts = [];
		return { category, positions, normals, uvs, indices, groups, chunkBounds };
	}
}

/** One draw group per material for an overview, with retained chunk subranges
 * for partial views. Vertex buffers are never rebuilt when the camera moves. */
export function sortChunkGeometry(data: ChunkGeometryData): ChunkGeometryData {
	const byMaterial = new Map<number, ChunkGeometryGroup[]>();
	for (const group of data.groups) {
		const list = byMaterial.get(group.materialIndex) ?? [];
		list.push(group);
		byMaterial.set(group.materialIndex, list);
	}
	const indices =
		data.indices instanceof Uint16Array
			? new Uint16Array(data.indices.length)
			: new Uint32Array(data.indices.length);
	const groups: ChunkGeometryGroup[] = [],
		chunkGroups: ChunkGeometryGroup[] = [];
	let offset = 0;
	for (const [materialIndex, parts] of byMaterial) {
		const start = offset;
		for (const part of parts) {
			indices.set(data.indices.subarray(part.start, part.start + part.count), offset);
			const last = chunkGroups[chunkGroups.length - 1];
			if (last && last.materialIndex === materialIndex && last.chunkKey === part.chunkKey)
				last.count += part.count;
			else
				chunkGroups.push({
					start: offset,
					count: part.count,
					materialIndex,
					chunkKey: part.chunkKey,
				});
			offset += part.count;
		}
		groups.push({ start, count: offset - start, materialIndex });
	}
	return { ...data, indices, groups, chunkGroups };
}
