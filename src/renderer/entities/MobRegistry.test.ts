import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { entityModelLoaders } from "../cubane/entity-models";
import { blockStateString, resolveEntityModel, resolveEntityPlan } from "./MobRegistry";
import type { EntityRecord } from "./types";

const bundled = (model: string) => Object.prototype.hasOwnProperty.call(entityModelLoaders, model);
function record(id: string, nbt: Record<string, unknown> = {}) {
	return { id: `minecraft:${id}`, position: [0, 0, 0], rotation: [0, 0], nbt, rawNbt: nbt, key: id } as EntityRecord;
}
const plan = (id: string, nbt: Record<string, unknown> = {}) =>
	resolveEntityPlan(record(id, nbt), bundled);
function modelPlan(id: string, nbt: Record<string, unknown> = {}) {
	const found = plan(id, nbt);
	if (found.kind !== "model") throw new Error(`${id} resolved to ${found.kind}`);
	return found;
}

/** Entity data that generate-coverage-schematics.mjs writes for the entities that need some. */
const stack = { id: "minecraft:diamond", count: 1 };
const DATA: Record<string, Record<string, unknown>> = {
	tnt: { block_state: { Name: "minecraft:tnt" } },
	falling_block: { BlockState: { Name: "minecraft:sand" } },
	block_display: { block_state: { Name: "minecraft:stone" } },
	item: { Item: stack },
	item_display: { item: stack },
	text_display: { text: "text_display", line_width: 200 },
	painting: { variant: "minecraft:kebab", facing: 3 },
	item_frame: { Facing: 3, Item: { id: "minecraft:compass", count: 1 }, ItemRotation: 0 },
	glow_item_frame: { Facing: 3, Item: { id: "minecraft:compass", count: 1 }, ItemRotation: 0 },
	experience_orb: { Value: 5 },
};
describe("entity model catalog", () => {
	it("registers a loader for every file of the catalog and nothing else", () => {
		const files = readdirSync("src/renderer/cubane/entity-models")
			.filter((file) => file.endsWith(".json"))
			.map((file) => file.slice(0, -5))
			.sort();
		expect(Object.keys(entityModelLoaders).sort()).toEqual(files);
	});
});

describe("entity plans for the coverage schematic", () => {
	const csv = readFileSync("example/public/schematics/all-entities.csv", "utf8");
	const ids = [...csv.matchAll(/,minecraft:([a-z0-9_]+),/g)].map((match) => match[1]);

	it("gives every entity something to draw", () => {
		// 164 entity ids, plus a second happy ghast row for the ghastling (a baby)
		expect(ids).toHaveLength(165);
		expect(new Set(ids).size).toBe(164);
		expect(ids.filter((id) => plan(id, DATA[id]).kind === "unsupported")).toEqual([]);
		expect(ids.filter((id) => plan(id, DATA[id]).kind === "invisible")).toEqual([]);
	});
	it("only ever names models the catalog ships", () => {
		for (const id of ids) {
			const found = plan(id, DATA[id]);
			if (found.kind === "model") for (const layer of found.layers) expect(bundled(layer.model)).toBe(true);
		}
	});
	it("marks where the game draws nothing, with a debug shape", () => {
		for (const id of ["marker", "interaction", "area_effect_cloud", "ominous_item_spawner", "lightning_bolt"])
			expect(plan(id).kind).toBe("debug");
		expect(plan("interaction", { width: 0.5, height: 2 })).toEqual({
			kind: "debug",
			shape: { type: "box", width: 0.5, height: 2 },
			reason: "an interaction is only its hitbox",
		});
		const cloud = plan("area_effect_cloud", { Radius: 3 });
		expect(cloud.kind === "debug" && cloud.shape).toEqual({ type: "disc", radius: 3, color: 0xa070ff });
	});
	it("draws nothing for an entity that has nothing to show", () => {
		expect(plan("block_display").kind).toBe("invisible");
		expect(plan("item").kind).toBe("invisible");
		expect(plan("item_display").kind).toBe("invisible");
		expect(plan("text_display").kind).toBe("invisible");
		expect(plan("item", { Item: { id: "minecraft:air" } }).kind).toBe("invisible");
	});
});

describe("model names", () => {
	it("resolves aliases and leaves modded ids alone", () => {
		expect(resolveEntityModel(record("ender_dragon"), bundled)).toBe("dragon");
		expect(resolveEntityModel(record("bamboo_raft"), bundled)).toBe("raft");
		expect(resolveEntityModel(record("bamboo_chest_raft"), bundled)).toBe("chest_raft");
		expect(resolveEntityModel(record("leash_knot"), bundled)).toBe("lead_knot");
		expect(resolveEntityModel(record("creaking_transient"), bundled)).toBe("creaking");
		expect(resolveEntityModel(record("mannequin"), bundled)).toBe("player");
		expect(plan("poplar_boat").kind).toBe("model");
		expect(resolveEntityPlan({ ...record("zombie"), id: "mod:zombie" }, bundled).kind).toBe("unsupported");
	});
	it("picks the pufferfish shape from PuffState", () => {
		expect(modelPlan("pufferfish").layers[0].model).toBe("puffer_fish_small");
		expect(modelPlan("pufferfish", { PuffState: 1 }).layers[0].model).toBe("puffer_fish_medium");
		expect(modelPlan("pufferfish", { PuffState: 2 }).layers[0].model).toBe("puffer_fish_big");
	});
	it("unpacks the tropical fish variant into shape, pattern and two dyes", () => {
		const [base, pattern] = modelPlan("tropical_fish").layers;
		expect([base.model, pattern.model]).toEqual(["tropical_fish_a", "tropical_fish_pattern_a_1"]);
		expect([base.tint, pattern.tint]).toEqual([0xf9fffe, 0xf9fffe]);
		const packed = 1 | (3 << 8) | (14 << 16) | (4 << 24);
		const [bBase, bPattern] = modelPlan("tropical_fish", { Variant: packed }).layers;
		expect([bBase.model, bPattern.model]).toEqual(["tropical_fish_b", "tropical_fish_pattern_b_4"]);
		expect([bBase.tint, bPattern.tint]).toEqual([0xb02e26, 0xfed83d]);
	});
	it("uses a model as soon as the catalog ships one for a mob that only has a stand-in", () => {
		const missing = resolveEntityPlan(record("nautilus"), () => false);
		expect(missing.kind).toBe("placeholder");
		const shipped = resolveEntityPlan(record("nautilus"), (model) => model === "nautilus");
		expect(shipped.kind).toBe("model");
	});
	it("draws the mobs converted from Bedrock geometry with their catalog models", () => {
		for (const id of ["nautilus", "zombie_nautilus", "parched", "copper_golem", "cushion"]) expect(plan(id).kind, id).toBe("model");
	});
});

describe("how the game draws a catalog model", () => {
	it("applies the renderer's scale", () => {
		expect(modelPlan("giant").scale).toBe(6);
		expect(modelPlan("ghast").scale).toBe(4.5);
		expect(modelPlan("wither_skeleton").scale).toBe(1.2);
		expect(modelPlan("cave_spider").scale).toBe(0.7);
		expect(modelPlan("zombie").scale).toBe(1);
		expect(modelPlan("slime", { Size: 3 }).scale).toBe(4);
		expect(modelPlan("magma_cube").scale).toBe(1);
	});
	it("hides tack, chests and arms that the entity does not have", () => {
		expect(modelPlan("horse").hide).toContain("saddle");
		expect(modelPlan("horse", { equipment: { saddle: { id: "minecraft:saddle" } } }).hide).toEqual([]);
		expect(modelPlan("horse", { SaddleItem: { id: "minecraft:saddle" } }).hide).toEqual([]);
		expect(modelPlan("donkey").hide).toContain("left_chest");
		expect(modelPlan("donkey", { ChestedHorse: 1 }).hide).toContain("saddle");
		expect(modelPlan("donkey", { ChestedHorse: 1 }).hide).not.toContain("left_chest");
		expect(modelPlan("llama").hide).toEqual(["chest_left", "chest_right"]);
		expect(modelPlan("llama", { ChestedHorse: 1 }).hide).toEqual([]);
		expect(modelPlan("camel").hide).toContain("bridle");
		expect(modelPlan("armor_stand").hide).toEqual(["left_arm", "right_arm"]);
		expect(modelPlan("armor_stand", { ShowArms: 1, NoBasePlate: 1 }).hide).toEqual(["base"]);
		expect(modelPlan("zombie").hide).toEqual([]);
	});
	it("adds the layers a default mob wears", () => {
		expect(modelPlan("sheep").layers).toEqual([{ model: "sheep" }, { model: "sheep_wool", tint: 0xf9fffe }]);
		expect(modelPlan("sheep", { Color: 14 }).layers[1].tint).toBe(0xb02e26);
		expect(modelPlan("sheep", { Sheared: 1 }).layers).toEqual([{ model: "sheep" }]);
		expect(modelPlan("slime").layers[1]).toEqual({ model: "slime_outer", translucent: true });
		expect(modelPlan("mooshroom").layers[1].model).toBe("mooshroom_mushrooms");
		for (const id of ["drowned", "stray", "bogged"])
			expect(modelPlan(id).layers.map((layer) => layer.model)).toEqual([id, `${id}_outer`]);
	});
	it("gives minecarts their contents", () => {
		expect(modelPlan("minecart").cargo).toBeUndefined();
		expect(modelPlan("chest_minecart").cargo).toEqual({ block: "minecraft:chest[facing=north]", offset: 6 });
		expect(modelPlan("tnt_minecart").cargo?.block).toBe("minecraft:tnt");
		expect(
			modelPlan("furnace_minecart", {
				CustomDisplayTile: 1,
				DisplayState: { Name: "minecraft:diamond_block" },
				DisplayOffset: 8,
			}).cargo
		).toEqual({ block: "minecraft:diamond_block", offset: 8 });
	});
});

describe("items, sprites and hanging entities", () => {
	it("shows a dropped item and an item display from their stack", () => {
		expect(plan("item", DATA.item)).toEqual({
			kind: "item",
			item: { id: "minecraft:diamond" },
			mode: "ground",
			size: 0.5,
			billboard: false,
		});
		const display = plan("item_display", { ...DATA.item_display, transformation: { scale: [2, 2, 2] } });
		expect(display.kind === "item" && [display.mode, display.size, display.billboard]).toEqual(["display", 1, false]);
		expect(display.kind === "item" && display.display?.scale).toEqual([2, 2, 2]);
		const ground = plan("item_display", { item: stack, item_display: "ground" });
		expect(ground.kind === "item" && ground.size).toBe(0.5);
	});
	it("turns thrown entities into camera-facing items, at the renderer's scale", () => {
		const check = (id: string, item: string, size: number) => {
			const found = plan(id);
			expect(found.kind === "item" && [found.item.id, found.size, found.mode, found.billboard]).toEqual([
				item,
				size,
				"projectile",
				true,
			]);
		};
		check("snowball", "minecraft:snowball", 0.5);
		check("potion", "minecraft:splash_potion", 0.5);
		check("lingering_potion", "minecraft:lingering_potion", 0.5);
		check("eye_of_ender", "minecraft:ender_eye", 0.5);
		check("fireball", "minecraft:fire_charge", 1.5);
		check("small_fireball", "minecraft:fire_charge", 0.375);
		check("firework_rocket", "minecraft:firework_rocket", 0.5);
		const custom = plan("snowball", { Item: { id: "minecraft:egg" } });
		expect(custom.kind === "item" && custom.item.id).toBe("minecraft:egg");
		const rocket = plan("firework_rocket", { FireworksItem: { id: "minecraft:firework_star" } });
		expect(rocket.kind === "item" && rocket.item.id).toBe("minecraft:firework_star");
	});
	it("cuts an experience orb's icon from its value", () => {
		const icon = (value: number) => {
			const found = plan("experience_orb", { Value: value });
			return found.kind === "sprite" ? found.cell?.index : undefined;
		};
		expect([0, 2, 3, 6, 7, 16, 17, 2476, 2477, 99999].map(icon)).toEqual([0, 0, 1, 1, 2, 2, 3, 9, 10, 10]);
		expect(plan("fishing_bobber")).toEqual({ kind: "sprite", texture: "entity/fishing/fishing_hook", size: 0.5 });
		expect(plan("dragon_fireball")).toEqual({ kind: "sprite", texture: "entity/enderdragon/dragon_fireball", size: 2 });
	});
	it("reads a frame's direction as one of six, and a painting's as one of four", () => {
		const frame = (facing: number) => {
			const found = plan("item_frame", { Facing: facing });
			return found.kind === "frame" ? found.direction : found.kind;
		};
		expect([0, 1, 2, 3, 4, 5].map(frame)).toEqual(["down", "up", "north", "south", "west", "east"]);
		const painting = (facing: number) => {
			const found = plan("painting", { facing });
			return found.kind === "painting" ? found.direction : found.kind;
		};
		expect([0, 1, 2, 3].map(painting)).toEqual(["south", "west", "north", "east"]);
		expect(plan("painting", { variant: "minecraft:pool" })).toEqual({ kind: "painting", variant: "pool", direction: "south" });
	});
	it("keeps a frame's item, its rotation, and whether the frame shows", () => {
		const found = plan("glow_item_frame", { ...DATA.glow_item_frame, ItemRotation: 11, Invisible: 1 });
		expect(found).toEqual({
			kind: "frame",
			block: "minecraft:glow_item_frame[map=false]",
			direction: "south",
			item: { id: "minecraft:compass" },
			rotation: 3,
			invisible: true,
		});
		const map = plan("item_frame", { Item: { id: "minecraft:filled_map" } });
		expect(map.kind === "frame" && map.item).toBeUndefined();
	});
	it("reads a text display's text, wrapping width, background and alignment", () => {
		expect(plan("text_display", DATA.text_display)).toEqual({
			kind: "text",
			text: "text_display",
			lineWidth: 200,
			background: 0x40000000,
			alignment: "center",
			display: undefined,
		});
		const json = plan("text_display", { text: '{"text":"a","extra":[{"text":"b"}]}', alignment: "left", background: -1 });
		expect(json.kind === "text" && [json.text, json.alignment, json.background]).toEqual(["ab", "left", 0xffffffff]);
	});
});

describe("block entities", () => {
	it("draws TNT and falling blocks on their feet and a display from its corner", () => {
		expect(plan("tnt", DATA.tnt)).toEqual({ kind: "block", block: "minecraft:tnt", anchor: "feet" });
		const falling = plan("falling_block", {
			BlockState: { Name: "minecraft:oak_stairs", Properties: { facing: "east", half: "top" } },
		});
		expect(falling).toEqual({
			kind: "block",
			block: "minecraft:oak_stairs[facing=east,half=top]",
			anchor: "feet",
		});
		const display = plan("block_display", {
			block_state: { Name: "minecraft:stone" },
			transformation: { translation: [1, 2, 3], scale: [2, 2, 2] },
		});
		expect(display).toEqual({
			kind: "block",
			block: "minecraft:stone",
			anchor: "corner",
			display: { translation: [1, 2, 3], scale: [2, 2, 2], left: [0, 0, 0, 1], right: [0, 0, 0, 1] },
		});
	});
	it("formats block states", () => {
		expect(blockStateString({ Name: "minecraft:stone" }, "x")).toBe("minecraft:stone");
		expect(blockStateString({ Name: "minecraft:lever", Properties: { face: "wall", powered: "true" } }, "x")).toBe(
			"minecraft:lever[face=wall,powered=true]"
		);
		expect(blockStateString(undefined, "fallback")).toBe("fallback");
		expect(blockStateString({ Name: "" }, "fallback")).toBe("fallback");
	});
});

describe("ghastlings", () => {
	it("draw a baby happy ghast with its own model at 0.2375 of the adult", () => {
		const adult = resolveEntityPlan(record("happy_ghast"), () => true);
		const baby = resolveEntityPlan({ ...record("happy_ghast"), nbt: { Age: -24000 } }, () => true);
		expect(adult.kind === "model" && adult.layers[0].model).toBe("happy_ghast");
		expect(baby.kind === "model" && baby.layers[0].model).toBe("happy_ghast_baby");
		if (adult.kind !== "model" || baby.kind !== "model") throw new Error("expected models");
		expect(baby.scale).toBeCloseTo(adult.scale * 0.2375);
	});
});
