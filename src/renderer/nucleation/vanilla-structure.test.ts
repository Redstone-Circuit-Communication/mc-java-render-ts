import { describe, expect, it } from "vitest";
import { blockStateString, fillFromVanillaStructure, parseJavaNbt, readVanillaStructure, toSnbt } from "./vanilla-structure";

/** Writes a minimal Java NBT document (big-endian), so the tests build their own vanilla structures */
function nbt(root: Record<string, unknown>): Uint8Array {
	const out: number[] = [];
	const u16 = (n: number) => out.push((n >> 8) & 255, n & 255);
	const i32 = (n: number) => out.push((n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255);
	const str = (s: string) => { const b = new TextEncoder().encode(s); u16(b.length); out.push(...b); };
	const typeOf = (v: unknown): number => (typeof v === "string" ? 8 : typeof v === "number" ? 3 : Array.isArray(v) ? 9 : 10);
	const payload = (v: unknown) => {
		if (typeof v === "string") str(v);
		else if (typeof v === "number") i32(v);
		else if (Array.isArray(v)) { out.push(v.length ? typeOf(v[0]) : 0); i32(v.length); v.forEach(payload); }
		else { for (const [k, x] of Object.entries(v as object)) { out.push(typeOf(x)); str(k); payload(x); } out.push(0); }
	};
	out.push(10); str(""); payload(root);
	return Uint8Array.from(out);
}

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
	const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

const structure = {
	DataVersion: 3465,
	size: [3, 2, 1],
	palette: [
		{ Name: "minecraft:air" },
		{ Name: "minecraft:stone" },
		{ Name: "minecraft:repeater", Properties: { delay: "2", facing: "north", locked: "false", powered: "false" } },
		{ Name: "minecraft:oak_sign", Properties: { rotation: "0", waterlogged: "false" } },
	],
	blocks: [
		{ pos: [0, 0, 0], state: 1 },
		{ pos: [1, 0, 0], state: 1 },
		{ pos: [2, 0, 0], state: 2 },
		{ pos: [0, 1, 0], state: 0 },
		{ pos: [1, 1, 0], state: 3, nbt: { id: "minecraft:sign", front_text: { messages: ['{"text":"hi"}'] } } },
	],
	entities: [],
};

describe("Java vanilla structures (the .nbt that Nucleation's fromData does not read)", () => {
	it("reads gzip and uncompressed files, skips air, spells states as name[k=v] and lists block entities", async () => {
		for (const bytes of [await gzip(nbt(structure)), nbt(structure)]) {
			const s = await readVanillaStructure(bytes);
			expect(s).not.toBeNull();
			expect(s!.size).toEqual([3, 2, 1]);
			expect(s!.dataVersion).toBe(3465);
			expect(s!.count).toBe(4);
			expect([...s!.blocks.keys()].sort()).toEqual([
				"minecraft:oak_sign[rotation=0,waterlogged=false]",
				"minecraft:repeater[delay=2,facing=north,locked=false,powered=false]",
				"minecraft:stone",
			]);
			expect(s!.blocks.get("minecraft:stone")).toEqual([0, 0, 0, 1, 0, 0]);
			expect(s!.blockEntities).toHaveLength(1);
			expect(toSnbt(s!.blockEntities[0].nbt)).toBe('{id:"minecraft:sign",front_text:{messages:["{\\"text\\":\\"hi\\"}"]}}');
		}
	});

	it("returns null for anything that is not a vanilla structure (no size / palette / blocks), leaving Nucleation's error", async () => {
		expect(await readVanillaStructure(nbt({ Regions: {}, Version: 6 }))).toBeNull();
		expect(await readVanillaStructure(new Uint8Array([1, 2, 3, 4]))).toBeNull();
	});

	it("writes into a SchematicWrapper: one set_blocks per state, cell by cell when needed; block entities as name[props]{SNBT}", async () => {
		const s = (await readVanillaStructure(nbt(structure)))!;
		const calls: string[] = [];
		const dropped = fillFromVanillaStructure(
			{
				set_blocks: (p: Int32Array, b: string) => { calls.push(`batch ${b} ${p.length / 3}`); return b === "minecraft:stone" ? 1 : p.length / 3; },
				set_block: (x: number, y: number, z: number, b: string) => { calls.push(`single ${b} ${x},${y},${z}`); return true; },
				set_block_from_string: (_x: number, _y: number, _z: number, b: string) => { calls.push(`string ${b}`); },
			} as never,
			s
		);
		expect(dropped).toBe(0);
		expect(calls).toContain("single minecraft:stone 0,0,0");
		expect(calls).toContain("single minecraft:stone 1,0,0");
		expect(calls.find((c) => c.startsWith("string "))).toBe(
			'string minecraft:oak_sign[rotation=0,waterlogged=false]{id:"minecraft:sign",front_text:{messages:["{\\"text\\":\\"hi\\"}"]}}'
		);
	});

	it("keeps tag types in SNBT", () => {
		const tag = parseJavaNbt(Uint8Array.from([10, 0, 0, 1, 0, 1, 99, 5, 4, 0, 1, 76, 0, 0, 0, 0, 0, 0, 0, 7, 0]));
		expect(toSnbt(tag)).toBe("{c:5b,L:7L}");
		expect(blockStateString("minecraft:stone")).toBe("minecraft:stone");
	});
});
