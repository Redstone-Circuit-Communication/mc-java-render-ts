import type {MaterialsResult} from "./types.js";
// Standalone Litematica NBT reader; counts blocks from every region, regardless of renderer state.
const decoder = new TextDecoder();

// NBT tag payloads map to a fixed set of JS runtime types.
type NbtValue =
    | number
    | bigint
    | string
    | Uint8Array
    | NbtValue[]
    | { [key: string]: NbtValue };

function isCompound(
    value: NbtValue | undefined,
): value is { [key: string]: NbtValue } {
    return (
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value) &&
        !ArrayBuffer.isView(value)
    );
}

function isBigIntArray(value: NbtValue[]): value is bigint[] {
    return value.every((item) => typeof item === "bigint");
}

function parseNbt(buffer: ArrayBuffer): { [key: string]: NbtValue } {
    const view = new DataView(buffer);
    let p = 0;
    const u8 = () => view.getUint8(p++);
    const i16 = () => {
        const n = view.getInt16(p);
        p += 2;
        return n;
    };
    const i32 = () => {
        const n = view.getInt32(p);
        p += 4;
        return n;
    };
    const i64 = () => {
        const n = view.getBigUint64(p);
        p += 8;
        return n;
    };
    const str = () => {
        const len = view.getUint16(p);
        p += 2;
        const v = decoder.decode(new Uint8Array(buffer, p, len));
        p += len;
        return v;
    };

    function compound(): { [key: string]: NbtValue } {
        const out: { [key: string]: NbtValue } = Object.create(null);
        while (true) {
            const child = u8();
            if (!child) break;
            const key = str();
            out[key] = payload(child);
        }
        return out;
    }

    function payload(t: number): NbtValue {
        switch (t) {
            case 1:
                return view.getInt8(p++);
            case 2:
                return i16();
            case 3:
                return i32();
            case 4:
                return i64();
            case 5: {
                const n = view.getFloat32(p);
                p += 4;
                return n;
            }
            case 6: {
                const n = view.getFloat64(p);
                p += 8;
                return n;
            }
            case 7: {
                const n = i32();
                if (n < 0) throw Error("Invalid NBT byte array");
                const a = new Uint8Array(buffer, p, n);
                p += n;
                return a;
            }
            case 8:
                return str();
            case 9: {
                const child = u8(),
                    len = i32();
                if (len < 0 || len > 10000000) throw Error("Invalid NBT list");
                const a: NbtValue[] = [];
                for (let i = 0; i < len; i++) a.push(payload(child));
                return a;
            }
            case 10:
                return compound();
            case 11: {
                const n = i32();
                if (n < 0) throw Error("Invalid NBT int array");
                const a: number[] = [];
                for (let i = 0; i < n; i++) a.push(i32());
                return a;
            }
            case 12: {
                const n = i32();
                if (n < 0) throw Error("Invalid NBT long array");
                const a: bigint[] = [];
                for (let i = 0; i < n; i++) a.push(i64());
                return a;
            }
            default:
                throw Error(`Unsupported NBT tag ${t}`);
        }
    }

    if (u8() !== 10) throw Error("Not an NBT compound");
    str();
    return compound();
}

export async function countLitematicMaterials(input: ArrayBuffer): Promise<MaterialsResult> {
    const bytes = new Uint8Array(input);
    let raw = input;
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
        if (typeof DecompressionStream === "undefined")
            throw Error("浏览器不支持 gzip 解压");
        const stream = new Blob([input])
            .stream()
            .pipeThrough(new DecompressionStream("gzip"));
        raw = await new Response(stream).arrayBuffer();
    }
    const root = parseNbt(raw);
    const regions = root.Regions;
    if (!isCompound(regions)) throw Error("不是有效的 Litematic 蓝图");
    const totals = new Map<string, number>();
    let regionCount = 0;
    for (const [regionName, regionValue] of Object.entries(regions)) {
        if (!isCompound(regionValue)) continue;
        const paletteValue = regionValue.BlockStatePalette;
        const stateWordsValue = regionValue.BlockStates;
        if (!Array.isArray(paletteValue) || !Array.isArray(stateWordsValue)) continue;
        if (!isBigIntArray(stateWordsValue)) continue;
        const size = isCompound(regionValue.Size) ? regionValue.Size : undefined;
        const sx = Math.abs(typeof size?.x === "number" ? size.x : 0),
            sy = Math.abs(typeof size?.y === "number" ? size.y : 0),
            sz = Math.abs(typeof size?.z === "number" ? size.z : 0);
        const volume = sx * sy * sz;
        if (!Number.isSafeInteger(volume) || volume > 100000000)
            throw Error(`区域 ${regionName} 太大，无法安全统计`);
        const bits = Math.max(2, Math.ceil(Math.log2(Math.max(2, paletteValue.length))));
        const counts = countPaletteStates(
            stateWordsValue,
            paletteValue.length,
            volume,
            bits,
            regionName,
        );
        for (let i = 0; i < paletteValue.length; i++) {
            const paletteEntry = paletteValue[i];
            const rawId = isCompound(paletteEntry) ? paletteEntry.Name : undefined;
            const id = typeof rawId === "string" ? rawId : undefined;
            if (
                !id ||
                !counts[i] ||
                ["minecraft:air", "minecraft:cave_air", "minecraft:void_air"].includes(
                    id,
                )
            )
                continue;
            totals.set(id, (totals.get(id) || 0) + counts[i]);
        }
        regionCount++;
    }
    return {
        regionCount,
        materials: [...totals]
            .map(([id, count]) => ({
                id,
                count,
                stacks: Math.floor(count / 64),
                remainder: count % 64,
            }))
            .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id)),
    };
}

// Exported for packed-state regression tests; values may span both 32- and 64-bit boundaries.
export function countPaletteStates(
    stateWords: readonly bigint[],
    paletteLength: number,
    volume: number,
    bits: number,
    regionName = "test",
) {
    // Split each 64-bit word once. Bitwise extraction avoids several BigInt
    // allocations per block while preserving values across word boundaries.
    if (!Number.isSafeInteger(volume) || volume < 0 || volume > 100000000)
        throw new Error("Invalid block volume");
    if (!Number.isSafeInteger(paletteLength) || paletteLength < 1 ||
        !Number.isInteger(bits) || bits < 2 || bits > 31 || paletteLength > 2 ** bits)
        throw new Error("Invalid palette or bit width");
    if (stateWords.length < Math.ceil(volume * bits / 64))
        throw new Error(`区域 ${regionName} 方块数据被截断`);
    const words = new Uint32Array(stateWords.length * 2);
    for (let i = 0; i < stateWords.length; i++) {
        words[i * 2] = Number(stateWords[i] & 0xffffffffn);
        words[i * 2 + 1] = Number(stateWords[i] >> 32n);
    }
    const mask = 2 ** bits - 1;
    const counts = new Array(paletteLength).fill(0);
    for (let i = 0; i < volume; i++) {
        const bitPosition = i * bits;
        const wordIndex = Math.floor(bitPosition / 32);
        const offset = bitPosition % 32;
        let v = (words[wordIndex] ?? 0) >>> offset;
        if (offset + bits > 32) v |= (words[wordIndex + 1] ?? 0) << (32 - offset);
        const index = v & mask;
        if (index >= counts.length)
            throw Error(`区域 ${regionName} 包含无效方块索引 ${index}`);
        counts[index]++;
    }
    return counts;
}
