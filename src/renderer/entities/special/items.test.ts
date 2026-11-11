import { describe, expect, it } from "vitest";
import { resolveItem, type ItemSource } from "./items";

type Model = { textures?: Record<string, unknown>; elements?: unknown[] };
function source(definitions: Record<string, unknown>, models: Record<string, Model>): ItemSource {
	return {
		getResourceString: async (path) => {
			const name = /^items\/(.*)\.json$/.exec(path)?.[1];
			return name !== undefined && name in definitions ? JSON.stringify(definitions[name]) : undefined;
		},
		getModel: async (path) => models[path.replace("minecraft:", "")] ?? {},
	};
}
const model = (path: string, extra: Record<string, unknown> = {}) => ({
	type: "minecraft:model",
	model: `minecraft:${path}`,
	...extra,
});
const generated = (...layers: string[]): Model => ({
	textures: Object.fromEntries(layers.map((layer, i) => [`layer${i}`, `minecraft:${layer}`])),
});

describe("item definitions", () => {
	const models = {
		"item/diamond": generated("item/diamond"),
		"item/compass_16": generated("item/compass_16"),
		"item/compass_17": generated("item/compass_17"),
		"item/splash": generated("item/potion_overlay", "item/splash_potion"),
		"item/other": generated("item/other"),
		"block/stone": { elements: [{}], textures: { all: "minecraft:block/stone" } },
	};
	it("reads a plain model", async () => {
		const items = source({ diamond: { model: model("item/diamond") } }, models);
		expect(await resolveItem(items, "minecraft:diamond")).toEqual({
			kind: "sprite",
			layers: [{ texture: "item/diamond", tint: undefined }],
		});
	});
	it("takes a condition's false branch and a range dispatch's lowest threshold", async () => {
		const compass = {
			model: {
				type: "minecraft:condition",
				on_true: model("item/other"),
				on_false: {
					type: "minecraft:range_dispatch",
					entries: [
						{ model: model("item/compass_17"), threshold: 0.5 },
						{ model: model("item/compass_16"), threshold: 0 },
					],
				},
			},
		};
		const result = await resolveItem(source({ compass }, models), "compass");
		expect(result).toEqual({ kind: "sprite", layers: [{ texture: "item/compass_16", tint: undefined }] });
	});
	it("prefers a fallback, and a select's first case without one", async () => {
		const withFallback = { model: { type: "minecraft:select", cases: [{ model: model("item/other") }], fallback: model("item/diamond") } };
		const without = { model: { type: "minecraft:select", cases: [{ model: model("item/other"), when: "x" }] } };
		const items = source({ a: withFallback, b: without }, models);
		expect(((await resolveItem(items, "a")) as { layers: { texture: string }[] }).layers[0].texture).toBe("item/diamond");
		expect(((await resolveItem(items, "b")) as { layers: { texture: string }[] }).layers[0].texture).toBe("item/other");
	});
	it("tints a layer with its default, as an RGB colour", async () => {
		const potion = { model: model("item/splash", { tints: [{ type: "minecraft:potion", default: -13083194 }] }) };
		const result = await resolveItem(source({ splash_potion: potion }, models), "minecraft:splash_potion");
		expect(result).toEqual({
			kind: "sprite",
			layers: [
				{ texture: "item/potion_overlay", tint: 0x385dc6 },
				{ texture: "item/splash_potion", tint: undefined },
			],
		});
		const constant = { model: model("item/diamond", { tints: [{ type: "minecraft:constant", value: [1, 0, 0.5] }] }) };
		const red = await resolveItem(source({ x: constant }, models), "x");
		expect((red as { layers: { tint: number }[] }).layers[0].tint).toBe(0xff0080);
	});
	it("stacks the parts of a composite", async () => {
		const both = { model: { type: "minecraft:composite", models: [model("item/diamond"), model("item/other")] } };
		const result = await resolveItem(source({ both }, models), "both");
		expect((result as { layers: { texture: string }[] }).layers.map((l) => l.texture)).toEqual(["item/diamond", "item/other"]);
	});
	it("draws a model with elements from its block, and an item with no layers likewise", async () => {
		const items = source(
			{ stone: { model: model("block/stone") }, chest: { model: { type: "minecraft:special", base: "minecraft:item/chest" } } },
			models
		);
		expect(await resolveItem(items, "stone")).toEqual({ kind: "block", block: "minecraft:stone" });
		expect(await resolveItem(items, "minecraft:chest")).toEqual({ kind: "block", block: "minecraft:chest" });
	});
	it("returns null for what has no definition, air and odd ids", async () => {
		const items = source({ air: { model: { type: "minecraft:empty" } } }, models);
		expect(await resolveItem(items, "minecraft:nothing")).toBeNull();
		expect(await resolveItem(items, "minecraft:air")).toBeNull();
		expect(await resolveItem(items, "minecraft:../x")).toBeNull();
	});
});
