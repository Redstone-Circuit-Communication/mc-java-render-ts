/**
 * Java 原版结构文件（结构方块存的 `.nbt`：`size`、`palette` / `palettes`、`blocks`、`entities`、`DataVersion`）。
 *
 * nucleation 0.10 的 `Schematic.fromData` 认 litematic、Sponge schem、mcstructure、世界存档、快照，**不认原版结构**：
 * 拿到这种文件会抛 `NucleationError.InvalidArgument`。站点上的 Java 作品全是原版结构（后端的 mc-structure 只收这一种），
 * 所以这里自己读：解压 → 解析 NBT → 按方块状态成批 `setBlocks`，方块实体用 `setBlockFromString("name[props]{SNBT}")`。
 * `SchematicManager.loadSchematic` 先试 `fromData`，失败了、而且字节是原版结构，才走这里（以后 nucleation 支持了，就不会走到这里）。
 */
import type { SchematicWrapper } from "./SchematicWrapper";

export interface VanillaBlockEntity {
	pos: [number, number, number];
	block: string;
	/** 原样的 NBT（带类型），写回时转成 SNBT */
	nbt: Tag;
}

export interface VanillaStructure {
	size: [number, number, number];
	dataVersion: number | null;
	/** 方块状态写法（`name[k=v,…]`）→ 坐标，按 x,y,z 平铺 */
	blocks: Map<string, number[]>;
	blockEntities: VanillaBlockEntity[];
	/** 不是空气的格子数 */
	count: number;
}

const SKIP = new Set(["minecraft:air", "minecraft:cave_air", "minecraft:void_air", "minecraft:structure_void"]);

// ---------- 解压 ----------

async function inflate(bytes: Uint8Array, format: "gzip" | "deflate"): Promise<Uint8Array> {
	// 复制成普通的 Uint8Array：底层可能是 SharedArrayBuffer 的视图不能直接当 BlobPart（tsc 报过错）
	const stream = new Blob([new Uint8Array(bytes)]).stream().pipeThrough(new DecompressionStream(format));
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** gzip（1f 8b）、zlib（78 xx）或者没压缩（第一个字节是 TAG_Compound 0x0A） */
export async function decompressNbt(bytes: Uint8Array): Promise<Uint8Array | null> {
	if (bytes.length < 3) return null;
	if (bytes[0] === 0x1f && bytes[1] === 0x8b) return inflate(bytes, "gzip");
	if (bytes[0] === 0x78 && (bytes[0] * 256 + bytes[1]) % 31 === 0) return inflate(bytes, "deflate");
	if (bytes[0] === 0x0a) return bytes;
	return null;
}

// ---------- NBT（Java 版：大端），保留标签类型（方块实体要原样写回 SNBT） ----------

export type Tag =
	| { t: 1 | 2 | 3 | 5 | 6; v: number }
	| { t: 4; v: bigint }
	| { t: 8; v: string }
	| { t: 7 | 11; v: number[] }
	| { t: 12; v: bigint[] }
	| { t: 9; et: number; v: Tag[] }
	| { t: 10; v: Map<string, Tag> };

class Reader {
	private p = 0;
	private view: DataView;
	private text = new TextDecoder();
	constructor(private bytes: Uint8Array) {
		this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	}
	private need(n: number) {
		if (this.p + n > this.bytes.length) throw new Error("NBT 提前结束");
	}
	private u8() { this.need(1); return this.view.getUint8(this.p++); }
	private i8() { this.need(1); return this.view.getInt8(this.p++); }
	private i16() { this.need(2); const v = this.view.getInt16(this.p); this.p += 2; return v; }
	private i32() { this.need(4); const v = this.view.getInt32(this.p); this.p += 4; return v; }
	private i64() { this.need(8); const v = this.view.getBigInt64(this.p); this.p += 8; return v; }
	private f32() { this.need(4); const v = this.view.getFloat32(this.p); this.p += 4; return v; }
	private f64() { this.need(8); const v = this.view.getFloat64(this.p); this.p += 8; return v; }
	private str() {
		this.need(2);
		const n = this.view.getUint16(this.p);
		this.p += 2;
		this.need(n);
		const s = this.text.decode(this.bytes.subarray(this.p, this.p + n));
		this.p += n;
		return s;
	}
	private len() {
		const n = this.i32();
		if (n < 0 || n > 64_000_000) throw new Error("NBT 长度不对");
		return n;
	}
	tag(t: number, depth = 0): Tag {
		if (depth > 512) throw new Error("NBT 嵌套太深");
		switch (t) {
			case 1: return { t, v: this.i8() };
			case 2: return { t, v: this.i16() };
			case 3: return { t, v: this.i32() };
			case 4: return { t, v: this.i64() };
			case 5: return { t, v: this.f32() };
			case 6: return { t, v: this.f64() };
			case 7: { const n = this.len(); const v: number[] = []; for (let i = 0; i < n; i++) v.push(this.i8()); return { t, v }; }
			case 8: return { t, v: this.str() };
			case 9: {
				const et = this.u8();
				const n = this.len();
				const v: Tag[] = [];
				for (let i = 0; i < n; i++) v.push(this.tag(et, depth + 1));
				return { t, et, v };
			}
			case 10: {
				const v = new Map<string, Tag>();
				for (;;) {
					const tt = this.u8();
					if (tt === 0) return { t, v };
					const k = this.str();
					v.set(k, this.tag(tt, depth + 1));
				}
			}
			case 11: { const n = this.len(); const v: number[] = []; for (let i = 0; i < n; i++) v.push(this.i32()); return { t, v }; }
			case 12: { const n = this.len(); const v: bigint[] = []; for (let i = 0; i < n; i++) v.push(this.i64()); return { t, v }; }
			default: throw new Error(`不认识的 NBT 类型 ${t}`);
		}
	}
	root(): Tag {
		if (this.u8() !== 10) throw new Error("NBT 的根不是复合标签");
		this.str();
		return this.tag(10);
	}
}

export const parseJavaNbt = (bytes: Uint8Array): Tag => new Reader(bytes).root();

const SNBT_KEY = /^[A-Za-z0-9._+-]+$/;
const quote = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
const float = (n: number) => (Number.isFinite(n) ? String(n) : "0");

/** 带类型的 NBT → SNBT（`1b`、`5s`、`2L`、`0.5f`、`1.0d`、`[I;1,2]`…），给 nucleation 的 setBlockFromString */
export function toSnbt(tag: Tag): string {
	switch (tag.t) {
		case 1: return `${tag.v}b`;
		case 2: return `${tag.v}s`;
		case 3: return String(tag.v);
		case 4: return `${tag.v}L`;
		case 5: return `${float(tag.v)}f`;
		case 6: return `${float(tag.v)}d`;
		case 7: return `[B;${tag.v.map((n) => `${n}b`).join(",")}]`;
		case 8: return quote(tag.v);
		case 9: return `[${tag.v.map(toSnbt).join(",")}]`;
		case 10: return `{${[...tag.v].map(([k, x]) => `${SNBT_KEY.test(k) ? k : quote(k)}:${toSnbt(x)}`).join(",")}}`;
		case 11: return `[I;${tag.v.join(",")}]`;
		case 12: return `[L;${tag.v.map((n) => `${n}L`).join(",")}]`;
	}
}

/** 方便看、方便测的普通值（long 变成数字） */
export function plain(tag: Tag): unknown {
	switch (tag.t) {
		case 4: return Number(tag.v);
		case 12: return tag.v.map(Number);
		case 9: return tag.v.map(plain);
		case 10: return Object.fromEntries([...tag.v].map(([k, x]) => [k, plain(x)]));
		default: return tag.v;
	}
}

const get = (tag: Tag | undefined, key: string): Tag | undefined => (tag?.t === 10 ? tag.v.get(key) : undefined);
const num = (tag: Tag | undefined): number | null =>
	tag && (tag.t === 1 || tag.t === 2 || tag.t === 3 || tag.t === 5 || tag.t === 6) ? tag.v : tag?.t === 4 ? Number(tag.v) : null;
const list = (tag: Tag | undefined): Tag[] | null => (tag?.t === 9 ? tag.v : null);
const str = (tag: Tag | undefined): string | null => (tag?.t === 8 ? tag.v : null);

/** `minecraft:repeater` + `{delay: "1", facing: "north"}` → `minecraft:repeater[delay=1,facing=north]` */
export function blockStateString(name: string, props?: Record<string, unknown>): string {
	const entries = props ? Object.entries(props).filter(([, v]) => v !== undefined && v !== null) : [];
	return entries.length ? `${name}[${entries.map(([k, v]) => `${k}=${String(v)}`).join(",")}]` : name;
}

/** 是原版结构就读出来，不是（比如 litematic、Sponge schem）返回 null */
export function toVanillaStructure(root: Tag): VanillaStructure | null {
	const size = list(get(root, "size"))?.map(num) ?? null;
	const palette = list(get(root, "palette")) ?? list(list(get(root, "palettes"))?.[0]);
	const blockList = list(get(root, "blocks"));
	if (!size || size.length !== 3 || size.some((n) => n === null || n < 0) || !palette || !blockList) return null;
	const names = palette.map((p) => str(get(p, "Name")) ?? "");
	const states = palette.map((p, i) => {
		if (!names[i]) return null;
		const props = get(p, "Properties");
		return blockStateString(names[i], props?.t === 10 ? Object.fromEntries([...props.v].map(([k, x]) => [k, plain(x)])) : undefined);
	});
	const blocks = new Map<string, number[]>();
	const blockEntities: VanillaBlockEntity[] = [];
	let count = 0;
	for (const b of blockList) {
		const state = num(get(b, "state"));
		const pos = list(get(b, "pos"))?.map(num);
		if (state === null || !states[state] || !pos || pos.length !== 3 || pos.some((n) => n === null)) continue;
		if (SKIP.has(names[state])) continue;
		const block = states[state]!;
		const [x, y, z] = pos as [number, number, number];
		let at = blocks.get(block);
		if (!at) blocks.set(block, (at = []));
		at.push(x, y, z);
		count++;
		const nbt = get(b, "nbt");
		if (nbt?.t === 10) blockEntities.push({ pos: [x, y, z], block, nbt });
	}
	return { size: size as [number, number, number], dataVersion: num(get(root, "DataVersion")), blocks, blockEntities, count };
}

export async function readVanillaStructure(bytes: Uint8Array): Promise<VanillaStructure | null> {
	const raw = await decompressNbt(bytes);
	if (!raw) return null;
	try {
		return toVanillaStructure(parseJavaNbt(raw));
	} catch {
		return null;
	}
}

/**
 * 把读出来的结构写进一个空的 SchematicWrapper：同一个状态一次 setBlocks，没写全的再一格一格写；
 * 方块实体最后用 `name[props]{SNBT}` 一格一格写（告示牌的字、容器的东西都在里面），nucleation 不收这段 NBT 时只写方块本身。
 * 返回没写进 NBT 的方块实体数（只影响告示牌的字之类，不影响方块）。
 */
export function fillFromVanillaStructure(
	target: Pick<SchematicWrapper, "set_blocks" | "set_block" | "set_block_from_string">,
	s: VanillaStructure
): number {
	for (const [block, flat] of s.blocks) {
		let written = 0;
		try {
			written = target.set_blocks(Int32Array.from(flat), block);
		} catch {
			written = -1;
		}
		if (written !== flat.length / 3) for (let i = 0; i < flat.length; i += 3) target.set_block(flat[i], flat[i + 1], flat[i + 2], block);
	}
	let dropped = 0;
	for (const e of s.blockEntities) {
		const [x, y, z] = e.pos;
		try {
			target.set_block_from_string(x, y, z, `${e.block}${toSnbt(e.nbt)}`);
		} catch {
			dropped++;
			target.set_block(x, y, z, e.block);
		}
	}
	return dropped;
}
