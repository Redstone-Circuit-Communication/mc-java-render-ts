import type { Geometry, PaletteItem } from "./types.js";
import { DIRECTIONS } from "./types.js";

export interface Template extends Geometry {
	packedNormals: Int8Array;
	min: number[];
	max: number[];
}

export interface PreparedGeometry {
	geometry: Geometry;
	faces: Int8Array;
	templates: Map<number, Template>;
}

export interface PreparedItem extends Omit<PaletteItem, "geometries"> {
	geometries: PreparedGeometry[];
}

export function boundaryFace(g: Geometry, offset: number): number {
	const epsilon = 1e-4;
	for (let face = 0; face < 6; face++) {
		const axis = face >> 1,
			boundary = face % 2 ? 0.5 : -0.5;
		let match = true;
		for (let j = 0; j < 3 && match; j++) {
			const vertex = g.indices[offset + j];
			if (Math.abs(g.positions[vertex * 3 + axis] - boundary) > epsilon) match = false;
			for (let a = 0; a < 3; a++)
				if (Math.abs(g.normals[vertex * 3 + a] - DIRECTIONS[face][a]) > epsilon) match = false;
		}
		if (match) return face;
	}
	return -1;
}

function mask(value: number, name: string): void {
	if (!Number.isInteger(value) || value < 0 || value > 63)
		throw new RangeError(`${name} must be 0..63`);
}

export function preparePalette(items: readonly PaletteItem[]): Map<number, PreparedItem> {
	const result = new Map<number, PreparedItem>();
	for (const item of items) {
		if (
			!Number.isInteger(item.index) ||
			item.index < 0 ||
			item.index > 2147483646 ||
			result.has(item.index)
		)
			throw new RangeError(
				"Palette indices must be unique nonnegative Int32 values below 2147483647"
			);
		mask(item.occlusionFlags, "occlusionFlags");
		mask(item.selfOcclusionFlags ?? 0, "selfOcclusionFlags");
		const geometries = item.geometries.map((input) => {
			const count = input.positions.length / 3;
			if (
				!Number.isInteger(count) ||
				input.normals.length !== count * 3 ||
				input.uvs.length !== count * 2 ||
				input.indices.length % 3
			)
				throw new RangeError("Mismatched geometry attribute or triangle lengths");
			if (!Number.isInteger(input.materialIndex) || input.materialIndex < 0)
				throw new RangeError("Invalid materialIndex");
			for (const values of [input.positions, input.normals, input.uvs])
				for (const value of values)
					if (!Number.isFinite(value)) throw new RangeError("Non-finite geometry attribute");
			for (const value of input.normals)
				if (Math.abs(value) > 1.0001) throw new RangeError("Normals must be normalized");
			for (const index of input.indices)
				if (index >= count) throw new RangeError("Index outside geometry");
			// Own copies so later caller mutations cannot invalidate cached face classifications.
			const geometry: Geometry = {
				positions: input.positions.slice(),
				normals: input.normals.slice(),
				uvs: input.uvs.slice(),
				indices: input.indices.slice(),
				materialIndex: input.materialIndex,
			};
			const faces = new Int8Array(geometry.indices.length / 3);
			for (let i = 0; i < faces.length; i++) faces[i] = boundaryFace(geometry, i * 3);
			return { geometry, faces, templates: new Map<number, Template>() };
		});
		result.set(item.index, { ...item, geometries });
	}
	return result;
}

/** Keep seams: compact by source vertex identity, never weld by position. */
export function visibleTemplate(
	prepared: PreparedGeometry,
	hidden: number,
	cacheLimit: number
): Template {
	const cached = prepared.templates.get(hidden);
	if (cached) return cached;
	const g = prepared.geometry,
		remap = new Int32Array(g.positions.length / 3).fill(-1);
	const source: number[] = [],
		indices: number[] = [];
	for (let t = 0; t < prepared.faces.length; t++) {
		const face = prepared.faces[t];
		if (face >= 0 && hidden & (1 << face)) continue;
		for (let j = 0; j < 3; j++) {
			const old = g.indices[t * 3 + j];
			if (remap[old] === -1) {
				remap[old] = source.length;
				source.push(old);
			}
			indices.push(remap[old]);
		}
	}
	const positions = new Float32Array(source.length * 3),
		normals = new Float32Array(source.length * 3);
	const uvs = new Float32Array(source.length * 2);
	for (let i = 0; i < source.length; i++) {
		for (let a = 0; a < 3; a++) {
			positions[i * 3 + a] = g.positions[source[i] * 3 + a];
			normals[i * 3 + a] = g.normals[source[i] * 3 + a];
		}
		uvs[i * 2] = g.uvs[source[i] * 2];
		uvs[i * 2 + 1] = g.uvs[source[i] * 2 + 1];
	}
	const min = [Infinity, Infinity, Infinity],
		max = [-Infinity, -Infinity, -Infinity];
	const packedNormals = new Int8Array(normals.length);
	for (let i = 0; i < positions.length; i++) {
		min[i % 3] = Math.min(min[i % 3], positions[i]);
		max[i % 3] = Math.max(max[i % 3], positions[i]);
		packedNormals[i] = Math.max(-127, Math.min(127, Math.round(normals[i] * 127)));
	}
	const template = {
		positions,
		normals,
		packedNormals,
		min,
		max,
		uvs,
		indices: source.length > 65536 ? new Uint32Array(indices) : new Uint16Array(indices),
		materialIndex: g.materialIndex,
	};
	if (cacheLimit > 0) {
		if (prepared.templates.size >= cacheLimit) {
			const oldest = prepared.templates.keys().next();
			if (!oldest.done) prepared.templates.delete(oldest.value);
		}
		prepared.templates.set(hidden, template);
	}
	return template;
}

export function neighborHidesFace(
	current: PaletteItem | PreparedItem,
	neighbor: PaletteItem | PreparedItem,
	face: number
): boolean {
	const bit = 1 << (face ^ 1);
	return (
		!!(neighbor.occlusionFlags & bit) ||
		!!(
			current.cullGroup &&
			current.cullGroup === neighbor.cullGroup &&
			(neighbor.selfOcclusionFlags ?? 0) & bit
		)
	);
}
