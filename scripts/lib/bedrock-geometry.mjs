// Bedrock entity geometry (format 1.12 and later) turned into the box nodes that scripts/generate-entity-models.mjs builds
// GLBs from. Java Edition keeps entity geometry in code, but Mojang publishes the Bedrock geometry of the same mobs in
// github.com/Mojang/bedrock-samples, and for most mobs both editions use the same boxes and the same texture layout.
//
// Conventions, checked against catalog models that exist in both editions (see verifyAgainstCatalog in the generator):
//  - The catalog's model space is Bedrock's mirrored on X (a humanoid's right arm is at -X in Bedrock, +X in the catalog).
//  - A bone is a node at its pivot; under it, one node per cube positioned relative to that pivot.
//  - Rotations are Euler angles in degrees about the pivot. In catalog space a Bedrock rotation [x, y, z] is the
//    quaternion of [-x, -y, z] applied X, then Y, then Z (the armadillo, with rotated bones and cubes, matches exactly).
//  - A mirrored cube swaps the UV areas of its +X and -X faces and flips u (the bogged's mirrored limbs match exactly).
//  Java models still differ from Bedrock by a pixel here and there (the warden sits 1 px further back, skeleton legs are
//  0.1 px forward), so converted models are close but not identical to what the Java client draws.

export const BEDROCK_SAMPLES_TAG = "v1.26.60.5";
const BASE = `https://cdn.jsdelivr.net/gh/Mojang/bedrock-samples@${BEDROCK_SAMPLES_TAG}/resource_pack/`;

/** Downloads a file of Mojang's official Bedrock resource pack (pinned release). */
export async function fetchOfficial(path) {
	const response = await fetch(BASE + path);
	if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
	return response.text();
}

/** All geometries in a `.geo.json` text, by identifier. */
export function parseGeometries(text) {
	const doc = JSON.parse(text.replace(/\/\/[^\n]*/g, ""));
	const out = new Map();
	for (const g of doc["minecraft:geometry"] ?? []) out.set(g.description.identifier, g);
	return out;
}

const DEG = Math.PI / 180;
/** Quaternion [x, y, z, w] for Euler angles in degrees, applied X first, then Y, then Z (q = qz · qy · qx). */
export function quaternion([rx, ry, rz], order = "XYZ") {
	const axis = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };
	const angle = { X: rx, Y: ry, Z: rz };
	let q = [0, 0, 0, 1];
	for (const a of order) {
		const h = (angle[a] * DEG) / 2;
		const s = Math.sin(h);
		const r = [axis[a][0] * s, axis[a][1] * s, axis[a][2] * s, Math.cos(h)];
		// q = r · q (the axis applied later multiplies on the left)
		q = [
			r[3] * q[0] + r[0] * q[3] + r[1] * q[2] - r[2] * q[1],
			r[3] * q[1] - r[0] * q[2] + r[1] * q[3] + r[2] * q[0],
			r[3] * q[2] + r[0] * q[1] - r[1] * q[0] + r[2] * q[3],
			r[3] * q[3] - r[0] * q[0] - r[1] * q[1] - r[2] * q[2],
		];
	}
	return q;
}

const mirrorX = ([x, y, z]) => [-x, y, z];
const sub3 = (a, b) => a.map((v, i) => v - b[i]);
const isZero = (r) => !r || r.every((v) => !v);

/**
 * Box nodes for one geometry. `texture` is the texture slot of every box; `skip` names bones to leave out (for example
 * equipment bones that only show with armor). `rotation` maps a Bedrock Euler angle to the catalog's quaternion and is
 * fixed by the verification; it is a parameter so the verification can compare candidates.
 */
export function geometryNodes(geometry, { texture = 0, skip = [], rotation = defaultRotation } = {}) {
	const bones = geometry.bones ?? [];
	const byName = new Map(bones.map((b) => [b.name, b]));
	const children = new Map();
	for (const b of bones) {
		if (skip.includes(b.name)) continue;
		const key = b.parent && byName.has(b.parent) ? b.parent : "";
		if (!children.has(key)) children.set(key, []);
		children.get(key).push(b);
	}
	const pivotOf = (b) => mirrorX(b?.pivot ?? [0, 0, 0]);
	const build = (bone, parentPivot) => {
		const pivot = pivotOf(bone);
		const node = { name: bone.name, translation: sub3(pivot, parentPivot).map((v) => v / 16), children: [] };
		if (!isZero(bone.rotation)) node.rotation = rotation(bone.rotation);
		for (const cube of bone.cubes ?? []) {
			const [ox, oy, oz] = cube.origin;
			const size = cube.size;
			const min = [-(ox + size[0]), oy, oz];
			const center = min.map((m, i) => m + size[i] / 2);
			if (!Array.isArray(cube.uv)) throw new Error(`${bone.name}: only box UVs are supported`);
			const boxSpec = { size, uv: cube.uv, texture, inflate: cube.inflate ?? 0, mirror: !!(cube.mirror ?? bone.mirror) };
			if (isZero(cube.rotation)) node.children.push({ name: bone.name, translation: sub3(center, pivot).map((v) => v / 16), box: boxSpec });
			else {
				const cubePivot = mirrorX(cube.pivot ?? cube.origin);
				node.children.push({
					name: `${bone.name}_rotated`,
					translation: sub3(cubePivot, pivot).map((v) => v / 16),
					rotation: rotation(cube.rotation),
					children: [{ name: bone.name, translation: sub3(center, cubePivot).map((v) => v / 16), box: boxSpec }],
				});
			}
		}
		for (const child of children.get(bone.name) ?? []) node.children.push(build(child, pivot));
		return node;
	};
	return (children.get("") ?? []).map((b) => build(b, [0, 0, 0]));
}

/** A Bedrock bone or cube rotation as a catalog quaternion (see the conventions above). */
export function defaultRotation([rx, ry, rz]) {
	return quaternion([-rx, -ry, rz], "XYZ");
}
