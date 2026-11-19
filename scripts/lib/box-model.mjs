// GLB helpers shared by scripts/generate-entity-models.mjs and its verification: a minimal zip reader for resource packs,
// GLB (de)serialisation for the catalog's base64 JSON files, and a builder for models made of textured boxes.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { inflateRawSync } from "node:zlib";

export const pngSize = (png) => [png.readUInt32BE(16), png.readUInt32BE(20)];
export const dataUri = (png) => `data:image/png;base64,${png.toString("base64")}`;

// ---- resource pack ---------------------------------------------------------
export function openZip(path) {
	const buf = readFileSync(path);
	let end = buf.length - 22;
	while (end >= 0 && buf.readUInt32LE(end) !== 0x06054b50) end--;
	if (end < 0) throw new Error(`${path} is not a zip file`);
	const entries = new Map();
	let at = buf.readUInt32LE(end + 16);
	for (let i = buf.readUInt16LE(end + 10); i > 0; i--) {
		const nameLength = buf.readUInt16LE(at + 28);
		const next = at + 46 + nameLength + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32);
		entries.set(buf.toString("utf8", at + 46, at + 46 + nameLength), {
			method: buf.readUInt16LE(at + 10),
			size: buf.readUInt32LE(at + 20),
			header: buf.readUInt32LE(at + 42),
		});
		at = next;
	}
	return {
		bytes(name) {
			const entry = entries.get(name);
			if (!entry) throw new Error(`${name} is missing from the pack`);
			const start =
				entry.header +
				30 +
				buf.readUInt16LE(entry.header + 26) +
				buf.readUInt16LE(entry.header + 28);
			const data = buf.subarray(start, start + entry.size);
			return Buffer.from(entry.method === 8 ? inflateRawSync(data) : data);
		},
	};
}
// ---- GLB read / write -------------------------------------------------------
export function readGlb(catalog, name) {
	const b64 = JSON.parse(readFileSync(resolve(catalog, `${name}.json`), "utf8"));
	const buf = Buffer.from(b64, "base64");
	let json;
	let bin = Buffer.alloc(0);
	for (let at = 12; at < buf.length; ) {
		const length = buf.readUInt32LE(at);
		const type = buf.readUInt32LE(at + 4);
		const chunk = buf.subarray(at + 8, at + 8 + length);
		if (type === 0x4e4f534a) json = JSON.parse(chunk.toString("utf8"));
		else if (type === 0x004e4942) bin = Buffer.from(chunk);
		at += 8 + length;
	}
	return { json, bin };
}
export function glbBytes({ json, bin }) {
	json.buffers[0].byteLength = bin.length;
	const pad = (data, fill) =>
		data.length % 4 ? Buffer.concat([data, Buffer.alloc(4 - (data.length % 4), fill)]) : data;
	const jsonChunk = pad(Buffer.from(JSON.stringify(json), "utf8"), 0x20);
	const binChunk = pad(bin, 0);
	const head = Buffer.alloc(12);
	head.writeUInt32LE(0x46546c67, 0);
	head.writeUInt32LE(2, 4);
	head.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8);
	const chunk = (type, data) => {
		const h = Buffer.alloc(8);
		h.writeUInt32LE(data.length, 0);
		h.writeUInt32LE(type, 4);
		return Buffer.concat([h, data]);
	};
	return Buffer.concat([head, chunk(0x4e4f534a, jsonChunk), chunk(0x004e4942, binChunk)]);
}
// ---- boxes ----------------------------------------------------------------
// Face order, vertex order and UV corners are copied from the catalog's own cuboids (checked on the
// creeper head): front is -Z at (u+d, v+d), back +Z at (u+2d+w, v+d), +X at (u, v+d),
// -X at (u+d+w, v+d), top at (u+d, v), bottom at (u+d+w, v).
const FACES = [
	{ n: [1, 0, 0], c: [[1, 1, 1], [1, 1, -1], [1, -1, 1], [1, -1, -1]], uv: ["tl", "tr", "bl", "br"], rect: (w, h, d, u, v) => [u, v + d, u + d, v + d + h] },
	{ n: [-1, 0, 0], c: [[-1, 1, -1], [-1, 1, 1], [-1, -1, -1], [-1, -1, 1]], uv: ["tl", "tr", "bl", "br"], rect: (w, h, d, u, v) => [u + d + w, v + d, u + 2 * d + w, v + d + h] },
	{ n: [0, 1, 0], c: [[-1, 1, -1], [1, 1, -1], [-1, 1, 1], [1, 1, 1]], uv: ["br", "bl", "tr", "tl"], rect: (w, h, d, u, v) => [u + d, v, u + d + w, v + d] },
	{ n: [0, -1, 0], c: [[-1, -1, 1], [1, -1, 1], [-1, -1, -1], [1, -1, -1]], uv: ["tr", "tl", "br", "bl"], rect: (w, h, d, u, v) => [u + d + w, v, u + d + 2 * w, v + d] },
	{ n: [0, 0, 1], c: [[-1, 1, 1], [1, 1, 1], [-1, -1, 1], [1, -1, 1]], uv: ["tl", "tr", "bl", "br"], rect: (w, h, d, u, v) => [u + 2 * d + w, v + d, u + 2 * d + 2 * w, v + d + h] },
	{ n: [0, 0, -1], c: [[1, 1, -1], [-1, 1, -1], [1, -1, -1], [-1, -1, -1]], uv: ["tl", "tr", "bl", "br"], rect: (w, h, d, u, v) => [u + d, v + d, u + d + w, v + d + h] },
];
const INSET = 1 / 64; // the catalog insets each face by 1/64 texel so nearest sampling never bleeds

/** Box `at` pixels from its parent's origin (centre), `size` in pixels; model space is Y up, front -Z. */
export const box = (name, min, size, uv, texture = 0, extra = {}) => ({
	name,
	translation: min.map((m, i) => (m + size[i] / 2) / 16),
	box: { size, uv, texture },
	...extra,
});
/** Same, but `min` is relative to `pivot` (both in pixels). */
export const inGroup = (pivot, node) => ({ ...node, translation: node.translation.map((t, i) => t - pivot[i] / 16) });

export function boxGlb(textures, nodes) {
	const json = {
		asset: { generator: "scripts/generate-entity-models.mjs", version: "2.0" },
		scene: 0,
		scenes: [{ name: "derived", nodes: [] }],
		nodes: [],
		meshes: [],
		materials: [],
		textures: [],
		images: [],
		samplers: [{ magFilter: 9728, minFilter: 9728, wrapS: 33071, wrapT: 33071 }],
		accessors: [],
		bufferViews: [],
		buffers: [{ byteLength: 0 }],
	};
	textures.forEach(({ png, blend, name }, i) => {
		json.images.push({ uri: dataUri(png), mimeType: "image/png" });
		json.textures.push({ sampler: 0, source: i, name });
		json.materials.push({
			pbrMetallicRoughness: {
				baseColorFactor: [1, 1, 1, 1],
				metallicFactor: 0,
				roughnessFactor: 1,
				baseColorTexture: { index: i, texCoord: 0 },
			},
			emissiveFactor: [0, 0, 0],
			alphaMode: blend ? "BLEND" : "MASK",
			...(blend ? {} : { alphaCutoff: 0.05 }),
			doubleSided: true,
		});
	});
	const chunks = [];
	let length = 0;
	const view = (data, target, stride) => {
		json.bufferViews.push({
			buffer: 0,
			byteOffset: length,
			byteLength: data.byteLength,
			...(stride ? { byteStride: stride } : {}),
			target,
		});
		chunks.push(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
		length += data.byteLength;
		return json.bufferViews.length - 1;
	};
	const accessor = (viewIndex, componentType, count, type, min, max) =>
		json.accessors.push({ bufferView: viewIndex, byteOffset: 0, componentType, normalized: false, count, type, ...(min ? { min, max } : {}) }) - 1;
	const bounds = (array, size) => {
		const min = Array(size).fill(Infinity);
		const max = Array(size).fill(-Infinity);
		for (let i = 0; i < array.length; i++) {
			min[i % size] = Math.min(min[i % size], array[i]);
			max[i % size] = Math.max(max[i % size], array[i]);
		}
		return [min, max];
	};
	const addMesh = ({ size: [w, h, d], uv: [u, v], texture: t, inflate = 0, mirror = false }) => {
		const [W, H] = pngSize(textures[t].png);
		// inflate grows the box on every side without changing its UVs
		const half = [w / 32 + inflate / 16, h / 32 + inflate / 16, d / 32 + inflate / 16];
		const position = new Float32Array(72);
		const normal = new Float32Array(72);
		const coord = new Float32Array(48);
		const index = new Uint16Array(36);
		FACES.forEach((face, f) => {
			// A mirrored box (Java's ModelPart mirror) swaps the UV areas of its +X and -X faces and flips u on every face.
			const source = mirror && face.n[0] ? FACES.find((g) => g.n[0] === -face.n[0]) : face;
			const [x0, y0, x1, y1] = source.rect(w, h, d, u, v);
			face.c.forEach((sign, k) => {
				const at = f * 4 + k;
				for (let a = 0; a < 3; a++) {
					position[at * 3 + a] = sign[a] * half[a];
					normal[at * 3 + a] = face.n[a];
				}
				const corner = face.uv[k];
				const left = corner.endsWith("l") !== mirror;
				coord[at * 2] = (left ? x0 + INSET : x1 - INSET) / W;
				coord[at * 2 + 1] = (corner.startsWith("t") ? y0 + INSET : y1 - INSET) / H;
			});
			index.set([0, 2, 1, 2, 3, 1].map((i) => f * 4 + i), f * 6);
		});
		const attributes = {
			POSITION: accessor(view(position, 34962, 12), 5126, 24, "VEC3", ...bounds(position, 3)),
			NORMAL: accessor(view(normal, 34962, 12), 5126, 24, "VEC3", ...bounds(normal, 3)),
			TEXCOORD_0: accessor(view(coord, 34962, 8), 5126, 24, "VEC2", ...bounds(coord, 2)),
		};
		const indices = accessor(view(index, 34963), 5123, 36, "SCALAR", [0], [23]);
		json.meshes.push({ primitives: [{ attributes, indices, mode: 4, material: t }] });
		return json.meshes.length - 1;
	};
	const addNode = (spec) => {
		const node = {};
		if (spec.name) node.name = spec.name;
		if (spec.translation?.some(Boolean)) node.translation = spec.translation;
		if (spec.rotation) node.rotation = spec.rotation;
		if (spec.box) node.mesh = addMesh(spec.box);
		if (spec.children) node.children = spec.children.map(addNode);
		json.nodes.push(node);
		return json.nodes.length - 1;
	};
	json.scenes[0].nodes.push(addNode({ children: nodes }));
	return { json, bin: Buffer.concat(chunks) };
}


/** Every vertex of a GLB in model space (pixels) with its texture coordinates: `[x, y, z, u, v]`, node transforms applied. */
export function worldVertices({ json, bin }) {
	const out = [];
	const read = (index, width) => {
		const accessor = json.accessors[index];
		const view = json.bufferViews[accessor.bufferView];
		const stride = view.byteStride ?? width * 4;
		const first = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
		return Array.from({ length: accessor.count }, (_, i) => Array.from({ length: width }, (_, k) => bin.readFloatLE(first + i * stride + k * 4)));
	};
	const rotate = ([x, y, z, w], [vx, vy, vz]) => {
		const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
		return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
	};
	const visit = (index, transform) => {
		const node = json.nodes[index];
		const local = (p) => {
			let q = node.scale ? p.map((v, i) => v * node.scale[i]) : p;
			if (node.rotation) q = rotate(node.rotation, q);
			if (node.translation) q = q.map((v, i) => v + node.translation[i]);
			return transform(q);
		};
		if (node.mesh !== undefined)
			for (const primitive of json.meshes[node.mesh].primitives) {
				const positions = read(primitive.attributes.POSITION, 3);
				const uvs = read(primitive.attributes.TEXCOORD_0, 2);
				positions.forEach((p, i) => out.push([...local(p).map((v) => v * 16), ...uvs[i]]));
			}
		for (const child of node.children ?? []) visit(child, local);
	};
	for (const root of json.scenes[json.scene ?? 0].nodes) visit(root, (p) => p);
	return out;
}
