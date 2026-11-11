// Adds the entity models that the bundled catalog lacks and that the resource pack lets us derive.
//
// The pack ships textures only: Java Edition keeps entity geometry in code, never in assets/ (the
// pack's models/ folder holds just block/ and item/). So every model here is built from two facts
// that the pack and the existing catalog do prove:
//
//   re-skinned  the geometry is the one of an existing catalog entry; only the texture differs
//               (identical UV mask, checked against the pack's PNG alpha):
//                 poplar_boat, poplar_chest_boat   <- oak_boat, oak_chest_boat
//                 camel_husk                       <- camel
//                 happy_ghast                      <- ghast (same UV mask, texture is twice as tall)
//                 tropical_fish_pattern_{a,b}_1..6 <- tropical_fish_pattern_{a,b} (shared UVs)
//   from UVs    a cuboid's size and texOffs follow from the opaque pixels of its texture, because a
//               box unwraps into one fixed cross. cushion and sulfur_cube are single boxes with a
//               unique solution; copper_golem is a unique exact cover by nine boxes.
//
// What the texture cannot tell is where a box sits. Placement of the copper golem (arms, antenna,
// nose) and of the sulfur cube follows the humanoid/slime layouts and the entity's hitbox; it is
// marked INFERRED below. Replace the generated JSON with a real export when one is available.
//
// Run: node scripts/generate-entity-models.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const catalog = resolve(root, "src/renderer/cubane/entity-models");
const TEXTURES = "assets/minecraft/textures/entity/";

// ---- resource pack ---------------------------------------------------------
function openZip(path) {
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
const pack = openZip(resolve(root, "example/public/packs/vanilla_pack_fixed.zip"));
const texture = (path) => pack.bytes(`${TEXTURES}${path}.png`);
const pngSize = (png) => [png.readUInt32BE(16), png.readUInt32BE(20)];

// ---- GLB read / write -------------------------------------------------------
function readGlb(name) {
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
function glbBytes({ json, bin }) {
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
const written = [];
function save(name, glb, note) {
	writeFileSync(resolve(catalog, `${name}.json`), JSON.stringify(glbBytes(glb).toString("base64")) + "\n");
	written.push(name);
	console.log(`${name.padEnd(28)} ${note}`);
}
const dataUri = (png) => `data:image/png;base64,${png.toString("base64")}`;
const embeddedSize = (json) => {
	const uri = json.images[0].uri;
	return pngSize(Buffer.from(uri.slice(uri.indexOf(",") + 1), "base64"));
};

/**
 * Same geometry as `source`, new texture. The PNG must have the source's size unless `size` says
 * otherwise; `vScale` rescales v when the layout fills only the top part of a taller PNG.
 */
function reskin(source, png, { vScale = 1, size } = {}) {
	const glb = readGlb(source);
	const [w, h] = size ?? embeddedSize(glb.json);
	const [nw, nh] = pngSize(png);
	if (nw !== w || nh !== h)
		throw new Error(`${source}: expected a ${w}x${h} texture, got ${nw}x${nh}`);
	glb.json.images[0] = { uri: dataUri(png), mimeType: "image/png" };
	if (vScale !== 1) {
		const done = new Set();
		for (const mesh of glb.json.meshes)
			for (const primitive of mesh.primitives) {
				const index = primitive.attributes.TEXCOORD_0;
				const accessor = glb.json.accessors[index];
				const view = glb.json.bufferViews[accessor.bufferView];
				if (accessor.componentType !== 5126 || accessor.type !== "VEC2")
					throw new Error(`${source}: unexpected TEXCOORD_0 layout`);
				const first = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
				if (done.has(first)) continue;
				done.add(first);
				let lo = Infinity;
				let hi = -Infinity;
				for (let i = 0; i < accessor.count; i++) {
					const at = first + i * (view.byteStride ?? 8) + 4;
					const v = glb.bin.readFloatLE(at) * vScale;
					glb.bin.writeFloatLE(v, at);
					lo = Math.min(lo, v);
					hi = Math.max(hi, v);
				}
				accessor.min[1] = lo;
				accessor.max[1] = hi;
			}
	}
	return glb;
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
const box = (name, min, size, uv, texture = 0, extra = {}) => ({
	name,
	translation: min.map((m, i) => (m + size[i] / 2) / 16),
	box: { size, uv, texture },
	...extra,
});
/** Same, but `min` is relative to `pivot` (both in pixels). */
const inGroup = (pivot, node) => ({ ...node, translation: node.translation.map((t, i) => t - pivot[i] / 16) });

function boxGlb(textures, nodes) {
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
	const addMesh = ({ size: [w, h, d], uv: [u, v], texture: t }) => {
		const [W, H] = pngSize(textures[t].png);
		const half = [w / 32, h / 32, d / 32];
		const position = new Float32Array(72);
		const normal = new Float32Array(72);
		const coord = new Float32Array(48);
		const index = new Uint16Array(36);
		FACES.forEach((face, f) => {
			const [x0, y0, x1, y1] = face.rect(w, h, d, u, v);
			face.c.forEach((sign, k) => {
				const at = f * 4 + k;
				for (let a = 0; a < 3; a++) {
					position[at * 3 + a] = sign[a] * half[a];
					normal[at * 3 + a] = face.n[a];
				}
				const corner = face.uv[k];
				coord[at * 2] = (corner.endsWith("l") ? x0 + INSET : x1 - INSET) / W;
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
		if (spec.box) node.mesh = addMesh(spec.box);
		if (spec.children) node.children = spec.children.map(addNode);
		json.nodes.push(node);
		return json.nodes.length - 1;
	};
	json.scenes[0].nodes.push(addNode({ children: nodes }));
	return { json, bin: Buffer.concat(chunks) };
}

// ---- re-skinned models ----------------------------------------------------
save("poplar_boat", reskin("oak_boat", texture("boat/poplar")), "oak_boat geometry, boat/poplar.png (UV mask identical)");
save("poplar_chest_boat", reskin("oak_chest_boat", texture("chest_boat/poplar")), "oak_chest_boat geometry, chest_boat/poplar.png (UV mask identical)");
save("camel_husk", reskin("camel", texture("camel/camel_husk")), "camel geometry, camel/camel_husk.png (UV mask 97.9% identical)");
// The catalog's ghast texture is 64x32; the pack's is the same layout at twice the resolution, and
// happy_ghast.png (128x128) keeps it in the top half, so u is unchanged and v halves.
save("happy_ghast", reskin("ghast", texture("ghast/happy_ghast"), { vScale: 0.5, size: [128, 128] }), "ghast geometry, ghast/happy_ghast.png (top half = ghast mask x2)");
for (const shape of ["a", "b"])
	for (let pattern = 1; pattern <= 6; pattern++)
		save(
			`tropical_fish_pattern_${shape}_${pattern}`,
			reskin(`tropical_fish_pattern_${shape}`, texture(`fish/tropical_${shape}_pattern_${pattern}`)),
			`tropical_fish_pattern_${shape} geometry, fish/tropical_${shape}_pattern_${pattern}.png`
		);

// ---- boxes recovered from texture layouts -----------------------------------
// cushion: red_cushion.png is exactly one 16x4x16 unwrap at texOffs(0,0) and nothing else.
save(
	"cushion",
	boxGlb([{ png: texture("cushion/white_cushion"), name: "cushion" }], [box("cushion", [-8, 0, -8], [16, 4, 16], [0, 0])]),
	"16x4x16 box @ (0,0), white_cushion.png (unique solution)"
);

// sulfur_cube: inner 16^3 @ (0,36), outer 18^3 @ (0,0); the small variants are 8^3 / 10^3.
// INFERRED: placement follows the slime (outer on the ground, inner one pixel above it, same centre).
save(
	"sulfur_cube",
	boxGlb(
		[
			{ png: texture("sulfur_cube/sulfur_cube_outer"), name: "sulfur_cube_outer", blend: true },
			{ png: texture("sulfur_cube/sulfur_cube_inner"), name: "sulfur_cube_inner" },
		],
		[
			box("inner", [-8, 1, -8], [16, 16, 16], [0, 36], 1),
			box("outer", [-9, 0, -9], [18, 18, 18], [0, 0], 0),
		]
	),
	"inner 16^3 + outer 18^3 (translucent); sizes from the texture, placement INFERRED"
);

// copper_golem: copper_golem.png has exactly one exact cover by nine boxes (uvfit): head 8x5x10 @ (0,0),
// nose 2x3x2 @ (56,0), antenna rod 2x4x2 @ (37,8) and bulb 4x4x4 @ (37,0), body 8x6x6 @ (0,15),
// arms 3x10x4 @ (36,16) and (50,16), legs 4x5x4 @ (0,27) and (16,27). Total height 16 px = the hitbox.
// INFERRED: pivots. Legs under the body, arms against its sides from its top edge, head on the body,
// nose on the front face, antenna centred on top; right limbs on +X like the catalog's humanoids.
const HEAD = [0, 11, 0];
save(
	"copper_golem",
	boxGlb(
		[{ png: texture("copper_golem/copper_golem"), name: "copper_golem" }],
		[
			box("right_leg", [0, 0, -2], [4, 5, 4], [0, 27]),
			box("left_leg", [-4, 0, -2], [4, 5, 4], [16, 27]),
			box("body", [-4, 5, -3], [8, 6, 6], [0, 15]),
			box("right_arm", [4, 1, -2], [3, 10, 4], [36, 16]),
			box("left_arm", [-7, 1, -2], [3, 10, 4], [50, 16]),
			{
				name: "head",
				translation: HEAD.map((p) => p / 16),
				children: [
					inGroup(HEAD, box("head", [-4, 11, -5], [8, 5, 10], [0, 0])),
					inGroup(HEAD, box("nose", [-1, 10, -6], [2, 3, 2], [56, 0])),
					inGroup(HEAD, box("antenna", [-1, 16, -1], [2, 4, 2], [37, 8])),
					inGroup(HEAD, box("antenna_top", [-2, 20, -2], [4, 4, 4], [37, 0])),
				],
			},
		]
	),
	"nine boxes from the texture (unique exact cover); pivots INFERRED"
);

// ---- register the loaders -------------------------------------------------------
const indexPath = resolve(catalog, "index.ts");
const lines = readFileSync(indexPath, "utf8").split("\n");
const entry = /^\t"?([^":]+)"?: \(\) => import\(/;
const have = new Set(lines.map((line) => entry.exec(line)?.[1]).filter(Boolean));
let added = 0;
for (const name of written.sort()) {
	if (have.has(name)) continue;
	const key = /^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name);
	const line = `\t${key}: () => import("./${name}.json"),`;
	let at = lines.findIndex((l) => {
		const existing = entry.exec(l)?.[1];
		return existing !== undefined && existing > name;
	});
	if (at < 0) at = lines.lastIndexOf("};");
	lines.splice(at, 0, line);
	added++;
}
writeFileSync(indexPath, lines.join("\n"));
console.log(`\n${written.length} models written, ${added} loader entries added to entity-models/index.ts`);
