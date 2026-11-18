import { Vector3 } from "three";
import type { SchematicRenderer } from "./renderer/index.js";
import { collisionHeight } from "./collision.js";

/**
 * The loaded structure as a collision grid for a host-driven first-person camera (docs/UNIFIED_API.md, "First person").
 * Cell `(i, j, k)` spans `origin + [i, i + 1] × [j, j + 1] × [k, k + 1]` in world space; `height` is 0 (walk through),
 * 0.5 (bottom half: slabs, stairs) or 1 (full block); cells outside `[min, max)` are empty. Same shape in both renderers.
 */
export interface Solids {
	origin: [number, number, number];
	min: [number, number, number];
	max: [number, number, number];
	height(i: number, j: number, k: number): number;
}

/** The first visible schematic as a collision grid, or null when nothing is loaded. Heights are cached per cell. */
export function solidsOf(renderer: SchematicRenderer): Solids | null {
	const all = renderer.schematicManager?.getAllSchematics() ?? [];
	const s = all.find((x) => x.group.visible) ?? all[0];
	if (!s) return null;
	s.group.updateMatrixWorld(true);
	const p = s.group.getWorldPosition(new Vector3());
	// a block at local (x, y, z) fills [x - 0.5, x + 0.5] (picking.ts rounds hit points with + 0.5); the group is only translated
	const origin: [number, number, number] = [p.x - 0.5, p.y - 0.5, p.z - 0.5];
	const lo = s.getTightBoundsMin() ?? [0, 0, 0];
	const hi = s.getTightBoundsMax() ?? lo;
	const min: [number, number, number] = [lo[0], lo[1], lo[2]];
	const max: [number, number, number] = [hi[0] + 1, hi[1] + 1, hi[2] + 1];
	const cache = new Map<string, number>();
	return {
		origin,
		min,
		max,
		height(i, j, k) {
			if (i < min[0] || j < min[1] || k < min[2] || i >= max[0] || j >= max[1] || k >= max[2]) return 0;
			const key = `${i},${j},${k}`;
			let h = cache.get(key);
			if (h === undefined) {
				const state = s.schematicWrapper.get_block_string(i, j, k) ?? "";
				h = state ? collisionHeight(state) : 0;
				cache.set(key, h);
			}
			return h;
		},
	};
}
