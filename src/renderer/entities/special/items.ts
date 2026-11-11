/** What the item resolver needs from the resource pack; Cubane's AssetLoader provides it. */
export interface ItemSource {
	getResourceString(path: string): Promise<string | undefined>;
	getModel(path: string): Promise<{ textures?: Record<string, unknown>; elements?: unknown[] }>;
}

export interface ItemLayer {
	/** Under textures/, without the extension: "item/diamond". */
	texture: string;
	/** 0xRRGGBB multiplier from the definition's tint for this layer. */
	tint?: number;
}

export type ItemAppearance =
	/** A generated item: flat layers, lowest first. */
	| { kind: "sprite"; layers: ItemLayer[] }
	/** A model with elements: drawn from the block of the same id. */
	| { kind: "block"; block: string };

type Json = Record<string, unknown>;
const isRecord = (value: unknown): value is Json =>
	!!value && typeof value === "object" && !Array.isArray(value);
const bare = (id: string): string => id.replace(/^minecraft:/, "");

interface Entry {
	model: string;
	tints: unknown[];
}

/**
 * The models an item definition shows when nothing is known about the stack: a condition takes its
 * false branch, a select its fallback (or first case), a range dispatch its fallback (or the entry
 * at the lowest threshold), a composite every part.
 */
function collect(node: unknown, out: Entry[] = [], depth = 0): Entry[] {
	if (!isRecord(node) || depth > 8) return out;
	switch (typeof node.type === "string" ? bare(node.type) : "") {
		case "model":
			if (typeof node.model === "string")
				out.push({ model: node.model, tints: Array.isArray(node.tints) ? node.tints : [] });
			break;
		case "composite":
			if (Array.isArray(node.models)) for (const part of node.models) collect(part, out, depth + 1);
			break;
		case "condition":
			collect(node.on_false, out, depth + 1);
			break;
		case "select": {
			const first = Array.isArray(node.cases) && isRecord(node.cases[0]) ? node.cases[0].model : undefined;
			collect(node.fallback ?? first, out, depth + 1);
			break;
		}
		case "range_dispatch": {
			const entries = (Array.isArray(node.entries) ? node.entries : []).filter(isRecord);
			entries.sort((a, b) => Number(a.threshold ?? 0) - Number(b.threshold ?? 0));
			collect(node.fallback ?? entries[0]?.model, out, depth + 1);
			break;
		}
		case "special":
			// The base model carries the item's own look; the special renderer draws on top of it.
			if (typeof node.base === "string") out.push({ model: node.base, tints: [] });
			break;
		default:
			break;
	}
	return out;
}

/** A tint's colour for a stack without components: its constant, or the default it falls back to. */
function tintOf(tint: unknown): number | undefined {
	if (!isRecord(tint)) return undefined;
	const value = tint.value ?? tint.default;
	if (typeof value === "number") return value & 0xffffff;
	if (Array.isArray(value) && value.length === 3 && value.every((n) => typeof n === "number")) {
		const [r, g, b] = value.map((n) => Math.round(Math.min(1, Math.max(0, n)) * 255));
		return (r << 16) | (g << 8) | b;
	}
	return undefined;
}

const textureOf = (value: unknown): string | undefined => {
	const reference = typeof value === "string" ? value : isRecord(value) ? value.sprite : undefined;
	return typeof reference === "string" ? bare(reference) : undefined;
};

/** How an item looks lying around, or null when the pack has no definition for it. */
export async function resolveItem(source: ItemSource, id: string): Promise<ItemAppearance | null> {
	const name = bare(id);
	if (!/^[a-z0-9_.-]+$/.test(name)) return null;
	const text = await source.getResourceString(`items/${name}.json`);
	if (!text) return null;
	let definition: unknown;
	try {
		definition = JSON.parse(text);
	} catch {
		return null;
	}
	const layers: ItemLayer[] = [];
	for (const entry of collect(isRecord(definition) ? definition.model : undefined)) {
		const model = await source.getModel(entry.model);
		if (model.elements?.length) return { kind: "block", block: `minecraft:${name}` };
		const textures = model.textures ?? {};
		for (let index = 0; textures[`layer${index}`] !== undefined; index++) {
			const texture = textureOf(textures[`layer${index}`]);
			if (texture) layers.push({ texture, tint: tintOf(entry.tints[index]) });
		}
	}
	// A special-rendered item (chest, banner, head, ...) has no flat layers; its block is the closest look.
	if (layers.length) return { kind: "sprite", layers };
	return name === "air" ? null : { kind: "block", block: `minecraft:${name}` };
}
