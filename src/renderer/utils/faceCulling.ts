/** Cubane blocks are centered at integer coordinates; the only boundaries are ±0.5. */
export const FACE_DIRECTIONS = [
	[-1, 0, 0],
	[1, 0, 0],
	[0, -1, 0],
	[0, 1, 0],
	[0, 0, -1],
	[0, 0, 1],
] as const;
export interface Occluder {
	occlusionFlags: number;
	selfOcclusionFlags?: number;
	cullGroup?: string;
}
export function boundaryFace(
	positions: ArrayLike<number>,
	normals: ArrayLike<number>,
	indices: ArrayLike<number>,
	offset: number
): number {
	const v = indices[offset],
		epsilon = 0.0001;
	const face = FACE_DIRECTIONS.findIndex((d) =>
		d.every((n, a) => Math.abs(n - normals[v * 3 + a]) < epsilon)
	);
	if (face < 0) return -1;
	const axis = Math.floor(face / 2),
		boundary = face % 2 === 0 ? -0.5 : 0.5;
	for (let i = 0; i < 3; i++)
		if (Math.abs(positions[indices[offset + i] * 3 + axis] - boundary) > epsilon) return -1;
	return face;
}
export function neighborHidesFace(current: Occluder, neighbor: Occluder, face: number): boolean {
	const bit = 1 << (face ^ 1);
	return (
		Boolean(neighbor.occlusionFlags & bit) ||
		(Boolean(current.cullGroup) &&
			current.cullGroup === neighbor.cullGroup &&
			Boolean((neighbor.selfOcclusionFlags ?? 0) & bit))
	);
}
export function getSelfCullGroup(block: string): string {
	const id = block.split("[")[0];
	return /^minecraft:(glass|tinted_glass|[a-z_]+_stained_glass|water|lava)$/.test(id) ? id : "";
}
