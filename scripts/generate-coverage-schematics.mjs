// Builds the two inspection schematics shipped with the example:
//   all-blocks.litematic    one default state of every block that has a block state file,
//                           each with a sign two blocks above it
//   all-entities.litematic  one entity for every entity id in the pack's language file,
//                           each with a sign six blocks above it (fifteen for the giants)
// Each sign shows the English name and the id, on both faces, so a block or entity that does
// not render can still be clicked through its sign. Each file comes with a CSV index.
// Run: node scripts/generate-coverage-schematics.mjs
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync, inflateRawSync } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(root, "example/public/schematics");
const ASSETS = "assets/minecraft/";

/** Minimal zip reader for the stored or deflated entries of the resource pack. */
function openZip(path) {
	const buf = readFileSync(path);
	let end = buf.length - 22;
	while (end >= 0 && buf.readUInt32LE(end) !== 0x06054b50) end--;
	if (end < 0) throw new Error(`${path} is not a zip file`);
	const entries = new Map();
	let at = buf.readUInt32LE(end + 16);
	for (let i = buf.readUInt16LE(end + 10); i > 0; i--) {
		if (buf.readUInt32LE(at) !== 0x02014b50) throw new Error("Corrupt zip directory");
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
		names: [...entries.keys()],
		json(name) {
			const entry = entries.get(name);
			if (!entry) throw new Error(`${name} is missing from the pack`);
			const start =
				entry.header +
				30 +
				buf.readUInt16LE(entry.header + 26) +
				buf.readUInt16LE(entry.header + 28);
			const data = buf.subarray(start, start + entry.size);
			return JSON.parse((entry.method === 8 ? inflateRawSync(data) : data).toString("utf8"));
		},
	};
}

// ---- NBT writer ------------------------------------------------------------
const tag = (t) => (v) => ({ t, v });
const [byte, short, int, long, float, double, string, compound, ints] = [
	1, 2, 3, 4, 5, 6, 8, 10, 11,
].map(tag);
const list = (et, v) => ({ t: 9, et, v });
const longs = (v) => ({ t: 12, v });

const i32 = (n) => {
	const b = Buffer.alloc(4);
	b.writeInt32BE(n);
	return b;
};
const utf = (s) => {
	const data = Buffer.from(s, "utf8");
	const head = Buffer.alloc(2);
	head.writeUInt16BE(data.length);
	return Buffer.concat([head, data]);
};
function body(t) {
	switch (t.t) {
		case 1:
			return Buffer.from([t.v & 255]);
		case 2: {
			const b = Buffer.alloc(2);
			b.writeInt16BE(t.v);
			return b;
		}
		case 3:
			return i32(t.v);
		case 4: {
			const b = Buffer.alloc(8);
			b.writeBigInt64BE(BigInt(t.v));
			return b;
		}
		case 5: {
			const b = Buffer.alloc(4);
			b.writeFloatBE(t.v);
			return b;
		}
		case 6: {
			const b = Buffer.alloc(8);
			b.writeDoubleBE(t.v);
			return b;
		}
		case 8:
			return utf(t.v);
		case 9:
			return Buffer.concat([Buffer.from([t.et]), i32(t.v.length), ...t.v.map(body)]);
		case 10:
			return Buffer.concat([
				...Object.entries(t.v).map(([k, v]) =>
					Buffer.concat([Buffer.from([v.t]), utf(k), body(v)])
				),
				Buffer.from([0]),
			]);
		case 11:
			return Buffer.concat([i32(t.v.length), ...t.v.map(i32)]);
		case 12:
			return Buffer.concat([i32(t.v.length / 8), t.v]);
		default:
			throw new Error(`Unsupported NBT tag ${t.t}`);
	}
}

// ---- litematic writer ------------------------------------------------------
/** Litematica packs palette indices LSB-first across 64-bit words, at least 2 bits each. */
function packStates(cells, paletteSize) {
	const bits = Math.max(2, Math.ceil(Math.log2(paletteSize)));
	const words = Math.ceil((cells.length * bits) / 64);
	const little = Buffer.alloc(words * 8);
	let bit = 0;
	for (const value of cells) {
		for (let b = 0; b < bits; b++, bit++) if ((value >> b) & 1) little[bit >> 3] |= 1 << (bit & 7);
	}
	const big = Buffer.alloc(words * 8);
	for (let w = 0; w < words; w++)
		for (let i = 0; i < 8; i++) big[w * 8 + i] = little[w * 8 + 7 - i];
	return big;
}

const canon = (props) =>
	Object.entries(props)
		.sort(([a], [b]) => (a < b ? -1 : 1))
		.map(([k, v]) => `${k}=${v}`)
		.join(",");

function makePalette() {
	const palette = [{ name: "minecraft:air", props: {} }];
	const index = new Map([["minecraft:air|", 0]]);
	return {
		palette,
		of(name, props = {}) {
			const key = `${name}|${canon(props)}`;
			let i = index.get(key);
			if (i === undefined) {
				i = palette.length;
				palette.push({ name, props });
				index.set(key, i);
			}
			return i;
		},
	};
}

function litematic({ name, size, palette, cells, tileEntities = [], entities = [] }) {
	const xyz = (v) => compound({ x: int(v.x), y: int(v.y), z: int(v.z) });
	const entry = ({ name: block, props }) =>
		compound({
			Name: string(block),
			...(Object.keys(props).length
				? {
						Properties: compound(
							Object.fromEntries(Object.entries(props).map(([k, v]) => [k, string(v)]))
						),
					}
				: {}),
		});
	const root = compound({
		MinecraftDataVersion: int(4790),
		Version: int(7),
		SubVersion: int(1),
		Metadata: compound({
			Name: string(name),
			Author: string("Schematic Studio"),
			Description: string("Generated by scripts/generate-coverage-schematics.mjs"),
			Software: string("mc-java-render-ts"),
			RegionCount: int(1),
			TimeCreated: long(0),
			TimeModified: long(0),
			TotalBlocks: int(cells.reduce((n, c) => n + (c ? 1 : 0), 0)),
			TotalVolume: int(cells.length),
			EnclosingSize: xyz(size),
		}),
		Regions: compound({
			Main: compound({
				Position: xyz({ x: 0, y: 0, z: 0 }),
				Size: xyz(size),
				BlockStatePalette: list(10, palette.map(entry)),
				BlockStates: longs(packStates(cells, palette.length)),
				PendingBlockTicks: list(0, []),
				PendingFluidTicks: list(0, []),
				TileEntities: list(10, tileEntities),
				Entities: list(10, entities),
			}),
		}),
	});
	return gzipSync(Buffer.concat([Buffer.from([10]), utf(""), body(root)]));
}

const csv = (rows) =>
	rows
		.map((row) =>
			row
				.map((c) => (/[",\n]/.test(String(c)) ? `"${String(c).replaceAll('"', '""')}"` : c))
				.join(",")
		)
		.join("\n") + "\n";

// ---- all blocks ------------------------------------------------------------
// Variant blocks take the variant closest to the vanilla defaults. Multipart blocks take the
// union of all part conditions (first alternative of OR, first value of "a|b", first part wins on
// a conflict), so fences, walls, vines and mushroom blocks show every model part.
const PREFER = [
	"false",
	"0",
	"none",
	"normal",
	"single",
	"straight",
	"north_south",
	"north",
	"bottom",
	"lower",
	"y",
	"floor",
	"wall",
	"left",
	"low",
	"x",
	"1",
	"inactive",
	"down",
	"top",
	"true",
];
const rank = (v) => (PREFER.includes(v) ? PREFER.indexOf(v) : PREFER.length);
const parseKey = (key) =>
	key === "" ? {} : Object.fromEntries(key.split(",").map((kv) => kv.split("=")));

function variantProps(variants) {
	let best;
	for (const key of Object.keys(variants)) {
		const props = parseKey(key);
		const score = Object.values(props).reduce((sum, v) => sum + rank(v), 0);
		if (!best || score < best.score || (score === best.score && key < best.key))
			best = { key, score, props };
	}
	return best?.props ?? {};
}

function merge(target, extra) {
	for (const [k, v] of Object.entries(extra)) if (k in target && target[k] !== v) return false;
	Object.assign(target, extra);
	return true;
}
function conditionProps(when) {
	if (!when) return null;
	if (Array.isArray(when.OR)) {
		for (const alternative of when.OR) {
			const props = conditionProps(alternative);
			if (props) return props;
		}
		return null;
	}
	if (Array.isArray(when.AND)) {
		const all = {};
		for (const condition of when.AND) {
			const props = conditionProps(condition);
			if (!props || !merge(all, props)) return null;
		}
		return all;
	}
	return Object.fromEntries(Object.entries(when).map(([k, v]) => [k, String(v).split("|")[0]]));
}
function multipartProps(parts) {
	const props = {};
	for (const part of parts) {
		const wanted = conditionProps(part.when);
		if (wanted) merge(props, wanted);
	}
	return props;
}

/** Doors and tall plants: the upper half goes on top of the lower one. */
function upperHalf(props, variants) {
	if (props.half !== "lower" || !variants) return null;
	const want = canon({ ...props, half: "upper" });
	return Object.keys(variants).some((key) => canon(parseKey(key)) === want)
		? { ...props, half: "upper" }
		: null;
}

const SIGN_WIDTH = 14;

/** Greedy word wrap; the separator stays at the end of each piece and overlong pieces are split. */
function wrapParts(text, separator) {
	const pieces = text.split(separator === " " ? /(?<= )/ : /(?<=_)/).filter(Boolean);
	const lines = [];
	let line = "";
	for (let piece of pieces) {
		while (piece.length > SIGN_WIDTH) {
			if (line.trim()) lines.push(line.trimEnd());
			line = "";
			lines.push(piece.slice(0, SIGN_WIDTH));
			piece = piece.slice(SIGN_WIDTH);
		}
		if (line && (line + piece).trimEnd().length > SIGN_WIDTH) {
			lines.push(line.trimEnd());
			line = "";
		}
		line += piece;
	}
	if (line.trim()) lines.push(line.trimEnd());
	return lines;
}

/** Four sign lines: the English name first, then the id. The id keeps up to three lines. */
function signLines(name, id) {
	const idLines = wrapParts(id.replace(/^minecraft:/, ""), "_").slice(0, 3);
	const nameLines = name ? wrapParts(name.replace(/[^\x20-\x7e]/g, "?"), " ") : [];
	return [...nameLines.slice(0, 4 - idLines.length), ...idLines];
}

/** A sign block entity whose front and back both show the same four lines. */
function signEntity(x, y, z, lines, id = "minecraft:sign") {
	const face = () =>
		compound({
			messages: list(
				8,
				Array.from({ length: 4 }, (_, i) => string(JSON.stringify({ text: lines[i] ?? "" })))
			),
			color: string("black"),
			has_glowing_text: byte(0),
		});
	return compound({
		id: string(id),
		x: int(x),
		y: int(y),
		z: int(z),
		is_waxed: byte(0),
		front_text: face(),
		back_text: face(),
	});
}

/** Banners and pots take optional extra data from a block entity; signs are labelled. */
function blockEntity(id, name, x, y, z) {
	const at = { x: int(x), y: int(y), z: int(z) };
	if (/_sign$/.test(id))
		return signEntity(
			x,
			y,
			z,
			signLines(name, `minecraft:${id}`),
			id.includes("hanging") ? "minecraft:hanging_sign" : "minecraft:sign"
		);
	if (/_banner$/.test(id))
		return compound({ id: string("minecraft:banner"), ...at, patterns: list(0, []) });
	if (id === "decorated_pot") {
		const sherds = Array.from({ length: 4 }, () => string("minecraft:brick"));
		return compound({ id: string("minecraft:decorated_pot"), ...at, sherds: list(8, sherds) });
	}
	return null;
}

const NOT_BLOCKS = new Set(["air", "cave_air", "void_air", "item_frame", "glow_item_frame"]);

function buildBlocks(zip) {
	const lang = zip.json(`${ASSETS}lang/en_us.json`);
	const prefix = `${ASSETS}blockstates/`;
	const ids = zip.names
		.filter((n) => n.startsWith(prefix) && n.endsWith(".json"))
		.map((n) => n.slice(prefix.length, -5))
		.filter((id) => !NOT_BLOCKS.has(id))
		.sort();
	const cols = Math.ceil(Math.sqrt(ids.length));
	const rows = Math.ceil(ids.length / cols);
	const LABEL_Y = 2;
	const size = { x: cols * 2 - 1, y: LABEL_Y + 1, z: rows * 2 - 1 };
	const cells = new Uint16Array(size.x * size.y * size.z);
	const at = (x, y, z) => (y * size.z + z) * size.x + x;
	const { palette, of } = makePalette();
	const tileEntities = [];
	const index = [["index", "name", "id", "x", "y", "z", "state", "note"]];
	ids.forEach((id, i) => {
		const x = (i % cols) * 2;
		const z = Math.floor(i / cols) * 2;
		const name = lang[`block.minecraft.${id}`];
		const def = zip.json(`${prefix}${id}.json`);
		const props = def.variants ? variantProps(def.variants) : multipartProps(def.multipart ?? []);
		const upper = def.variants ? upperHalf(props, def.variants) : null;
		cells[at(x, 0, z)] = of(`minecraft:${id}`, props);
		if (upper) cells[at(x, 1, z)] = of(`minecraft:${id}`, upper);
		const entity = blockEntity(id, name, x, 0, z);
		if (entity) tileEntities.push(entity);
		cells[at(x, LABEL_Y, z)] = of("minecraft:oak_sign", { rotation: "0" });
		tileEntities.push(signEntity(x, LABEL_Y, z, signLines(name, `minecraft:${id}`)));
		const notes = [upper ? "upper half at y=1" : "", `label sign at y=${LABEL_Y}`].filter(Boolean);
		index.push([i + 1, name ?? "", `minecraft:${id}`, x, 0, z, canon(props), notes.join("; ")]);
	});
	const file = litematic({ name: "全方块 · 逐个排查", size, palette, cells, tileEntities });
	const placed = cells.reduce((n, c) => n + (c ? 1 : 0), 0);
	return { file, index, size, placed, count: ids.length, cols, tileEntities: tileEntities.length };
}

// ---- all entities ----------------------------------------------------------
const SKIPPED_ENTITIES = new Set(["player", "falling_block_type", "killer_bunny"]);
const LEGACY_ENTITIES = new Set(["boat", "chest_boat", "creaking_transient"]);
const HUGE_ENTITIES = new Set(["ender_dragon", "giant"]);
const stack = (id) => compound({ id: string(id), count: int(1) });
const frame = { Facing: byte(3), Item: stack("minecraft:compass"), ItemRotation: byte(0) };
const ENTITY_DATA = {
	item: { Item: stack("minecraft:diamond"), Age: short(0), PickupDelay: short(0) },
	falling_block: { BlockState: compound({ Name: string("minecraft:sand") }), Time: int(1) },
	tnt: { fuse: short(80), block_state: compound({ Name: string("minecraft:tnt") }) },
	block_display: { block_state: compound({ Name: string("minecraft:stone") }) },
	item_display: { item: stack("minecraft:diamond") },
	text_display: { text: string("text_display"), line_width: int(200) },
	painting: { variant: string("minecraft:kebab"), facing: byte(3) },
	item_frame: frame,
	glow_item_frame: frame,
	experience_orb: { Value: short(5), count: int(1) },
	area_effect_cloud: { Radius: float(3), Duration: int(600) },
};

function buildEntities(zip) {
	const lang = zip.json(`${ASSETS}lang/en_us.json`);
	const models = new Set(
		readdirSync(resolve(root, "src/renderer/cubane/entity-models"))
			.filter((f) => f.endsWith(".json"))
			.map((f) => f.slice(0, -5))
	);
	const ids = Object.keys(lang)
		.map((key) => /^entity\.minecraft\.([a-z0-9_]+)$/.exec(key)?.[1])
		.filter((id) => id && !SKIPPED_ENTITIES.has(id))
		.sort();
	const regular = ids.filter((id) => !HUGE_ENTITIES.has(id));
	const huge = ids.filter((id) => HUGE_ENTITIES.has(id));
	const cols = Math.ceil(Math.sqrt(regular.length));
	const rows = Math.ceil(regular.length / cols);
	// Ghasts are four blocks tall and withers 3.5, so labels sit above them;
	// giants reach about thirteen, so their row is labelled higher still.
	const LABEL_Y = 6;
	const HUGE_LABEL_Y = 15;
	const size = {
		x: Math.max(cols * 6, huge.length * 24),
		y: (huge.length ? HUGE_LABEL_Y : LABEL_Y) + 1,
		z: rows * 6 + (huge.length ? 24 : 0),
	};
	const placed = [
		...regular.map((id, i) => ({ id, x: (i % cols) * 6 + 3, z: Math.floor(i / cols) * 6 + 3 })),
		...huge.map((id, i) => ({ id, x: i * 24 + 12, z: rows * 6 + 12 })),
	];
	const { palette, of } = makePalette();
	const cells = new Uint16Array(size.x * size.y * size.z);
	const at = (x, y, z) => (y * size.z + z) * size.x + x;
	cells.fill(of("minecraft:smooth_stone"), 0, size.x * size.z);
	const tileEntities = [];
	const index = [["index", "name", "id", "x", "y", "z", "label_y", "same_named_model", "note"]];
	const entities = placed.map(({ id, x, z }, i) => {
		const labelY = HUGE_ENTITIES.has(id) ? HUGE_LABEL_Y : LABEL_Y;
		const name = lang[`entity.minecraft.${id}`];
		cells[at(x, labelY, z)] = of("minecraft:oak_sign", { rotation: "0" });
		tileEntities.push(signEntity(x, labelY, z, signLines(name, `minecraft:${id}`)));
		// Entity positions are block corners; +0.5 centres each one on its cell.
		index.push([
			i + 1,
			name ?? "",
			`minecraft:${id}`,
			x + 0.5,
			1,
			z + 0.5,
			labelY,
			models.has(id) ? "yes" : "no",
			LEGACY_ENTITIES.has(id) ? "legacy name" : "",
		]);
		return compound({
			Pos: list(6, [double(x + 0.5), double(1), double(z + 0.5)]),
			Rotation: list(5, [float(0), float(0)]),
			UUID: ints([1, 2, 3, i + 1]),
			id: string(`minecraft:${id}`),
			...(ENTITY_DATA[id] ?? {}),
		});
	});
	const file = litematic({
		name: "全实体 · 逐个排查",
		size,
		palette,
		cells,
		tileEntities,
		entities,
	});
	return {
		file,
		index,
		size,
		count: placed.length,
		cols,
		withoutModel: placed.filter(({ id }) => !models.has(id)).length,
	};
}

const zip = openZip(resolve(root, "example/public/packs/vanilla_pack_fixed.zip"));
const blocks = buildBlocks(zip);
const entities = buildEntities(zip);
writeFileSync(resolve(outDir, "all-blocks.litematic"), blocks.file);
writeFileSync(resolve(outDir, "all-blocks.csv"), csv(blocks.index));
writeFileSync(resolve(outDir, "all-entities.litematic"), entities.file);
writeFileSync(resolve(outDir, "all-entities.csv"), csv(entities.index));
const dims = ({ x, y, z }) => `${x} × ${y} × ${z}`;
console.log(
	`all-blocks: ${blocks.count} blocks, ${blocks.cols} per row, ${dims(blocks.size)}, ${blocks.placed} non-air cells, ${blocks.tileEntities} block entities`
);
console.log(
	`all-entities: ${entities.count} entities (${entities.withoutModel} without a same-named model), ${entities.cols} per row, ${dims(entities.size)}`
);
