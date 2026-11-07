export function cube(
	index = 0,
	{
		top = 0.5,
		separate = false,
		uv = [0.25, 0.125, 0.5, 0.375],
		category = "solid",
		occlusionFlags = top === 0.5 ? 63 : 4,
		cullGroup = "",
		selfOcclusionFlags = 0,
	} = {}
) {
	const directions = [
		[-1, 0, 0],
		[1, 0, 0],
		[0, -1, 0],
		[0, 1, 0],
		[0, 0, -1],
		[0, 0, 1],
	];
	const positions = [],
		normals = [],
		uvs = [],
		indices = [];
	for (const n of directions) {
		const u = n[0] ? [0, 1, 0] : [1, 0, 0];
		const v = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
		const base = positions.length / 3;
		for (const [a, b] of [
			[-1, -1],
			[1, -1],
			[1, 1],
			[-1, 1],
		]) {
			const p = n.map((x, i) => (x + a * u[i] + b * v[i]) * 0.5);
			p[1] = -0.5 + (p[1] + 0.5) * (top + 0.5);
			positions.push(...p);
			normals.push(...n);
			uvs.push(uv[0] + (a + 1) * 0.5 * (uv[2] - uv[0]), uv[1] + (b + 1) * 0.5 * (uv[3] - uv[1]));
		}
		indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
	}
	const geom = (face) => ({
		positions: new Float32Array(
			face === undefined ? positions : positions.slice(face * 12, face * 12 + 12)
		),
		normals: new Float32Array(
			face === undefined ? normals : normals.slice(face * 12, face * 12 + 12)
		),
		uvs: new Float32Array(face === undefined ? uvs : uvs.slice(face * 8, face * 8 + 8)),
		indices: new Uint16Array(face === undefined ? indices : [0, 1, 2, 0, 2, 3]),
		materialIndex: face ?? index,
	});
	return {
		index,
		category,
		occlusionFlags,
		cullGroup,
		selfOcclusionFlags,
		geometries: separate ? directions.map((_, f) => geom(f)) : [geom()],
	};
}
export function solid(size = 16, paletteIndex = 0) {
	const blocks = new Int32Array(size ** 3 * 4);
	let i = 0;
	for (let z = 0; z < size; z++)
		for (let y = 0; y < size; y++)
			for (let x = 0; x < size; x++) {
				blocks.set([x, y, z, paletteIndex], i);
				i += 4;
			}
	return blocks;
}
export function scene(name = "terrace", size = 16) {
	const palette = [cube(0), cube(1), cube(2, { top: 0 }), cube(3), cube(4), cube(5)];
	if (name === "solid") return { palette, blocks: solid(size) };
	if (name === "materials")
		return { palette: [cube(0, { separate: true })], blocks: new Int32Array([0, 0, 0, 0]) };
	if (name === "range") return { palette, blocks: new Int32Array([0, 0, 0, 0, 40, 0, 0, 1]) };
	if (name === "slabs")
		return { palette, blocks: new Int32Array([0, 0, 0, 2, 1, 0, 0, 2, 0, 0, 1, 2, 1, 0, 1, 0]) };
	const b = [];
	for (let z = 0; z < size; z++)
		for (let x = 0; x < size; x++) {
			const height = Math.max(1, Math.floor(4 + 3 * Math.sin(x * 0.35) * Math.cos(z * 0.28)));
			for (let y = 0; y < height; y++) b.push(x, y, z, y === height - 1 ? 0 : 1);
			if (x === Math.floor(size / 2) && z > 2 && z < size - 3) b.push(x, height, z, 2);
		}
	for (let y = 3; y < 10; y++) b.push(-2, y, 4, 3);
	for (let z = 2; z < 7; z++) for (let x = -4; x < 1; x++) b.push(x, 10, z, 4);
	return { palette, blocks: new Int32Array(b) };
}
