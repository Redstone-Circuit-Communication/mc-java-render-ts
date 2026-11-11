import type { EntityRecord } from "./types";

type Nbt = Record<string, unknown>;

/** One catalog model drawn at the entity's pose. Layers after the first share the base's transform. */
export interface ModelLayer {
	model: string;
	/** Multiplies the texture. 0xRRGGBB, applied without an sRGB decode like every entity texture. */
	tint?: number;
	/** The texture carries real alpha: draw it blended instead of alpha-tested. */
	translucent?: boolean;
}

/** The `transformation` of a display entity: p' = translation + left * scale * right * p. */
export interface DisplayTransform {
	translation: [number, number, number];
	scale: [number, number, number];
	/** Quaternions as [x, y, z, w]. */
	left: [number, number, number, number];
	right: [number, number, number, number];
}

export type Direction = "down" | "up" | "north" | "south" | "west" | "east";

/** Only the id matters for how an item looks lying around. */
export interface ItemStack {
	id: string;
}

/** What to draw where the game draws nothing, so the entity can still be found. */
export type DebugShape =
	| { type: "marker" }
	| { type: "spawner" }
	| { type: "box"; width: number; height: number }
	| { type: "disc"; radius: number; color: number }
	| { type: "bolt" };

export type EntityPlan =
	/** One or more catalog models, scaled like the game's renderer and with unused parts hidden. */
	| {
			kind: "model";
			layers: ModelLayer[];
			scale: number;
			/** Node names that stay hidden: tack, chests and arms the entity does not have. */
			hide: readonly string[];
			/** A minecart's contents, drawn from the block models. `offset` is DisplayOffset in pixels. */
			cargo?: { block: string; offset: number };
	  }
	/**
	 * A block model: primed TNT, falling blocks and block displays. TNT and falling blocks stand on the
	 * entity's feet ("feet"); a display's block spans +0..1 from the entity, under its transformation
	 * ("corner").
	 */
	| { kind: "block"; block: string; anchor: "feet" | "corner"; display?: DisplayTransform }
	/**
	 * An item as a thin sprite slab: dropped items ("ground"), item displays ("display") and thrown
	 * projectiles, which turn to face the camera. `size` is the sprite's width in blocks.
	 */
	| {
			kind: "item";
			item: ItemStack;
			mode: "ground" | "display" | "projectile";
			size: number;
			billboard: boolean;
			display?: DisplayTransform;
	  }
	/** A camera-facing sprite cut from an entity texture: experience orbs, bobbers, dragon fireballs. */
	| {
			kind: "sprite";
			texture: string;
			size: number;
			cell?: { cols: number; rows: number; index: number };
			tint?: number;
	  }
	/** An item frame: the frame's block model facing `direction`, with its item inside. */
	| {
			kind: "frame";
			block: string;
			direction: Direction;
			item?: ItemStack;
			rotation: number;
			invisible: boolean;
	  }
	| { kind: "painting"; variant: string; direction: Direction }
	| {
			kind: "text";
			text: string;
			lineWidth: number;
			background: number;
			alignment: "left" | "center" | "right";
			display?: DisplayTransform;
	  }
	/** The game draws nothing for this entity; a debug shape marks where it is. */
	| { kind: "debug"; shape: DebugShape; reason: string }
	/** The pack ships this mob's textures but nothing that describes its geometry. */
	| { kind: "placeholder"; size: readonly [number, number, number]; reason: string }
	/** Nothing to draw: an item entity without an item, a display without content. */
	| { kind: "invisible"; reason: string }
	| { kind: "unsupported" };

const isRecord = (value: unknown): value is Nbt =>
	!!value && typeof value === "object" && !Array.isArray(value);
const num = (value: unknown, fallback = 0): number =>
	typeof value === "number" && Number.isFinite(value) ? value : fallback;
/** Bytes arrive as numbers once the typed tags are unwrapped. */
const flag = (value: unknown): boolean => value === true || (typeof value === "number" && value !== 0);
/** A list of finite numbers of the fallback's length, or the fallback. */
const vector = (value: unknown, fallback: readonly number[]): number[] =>
	Array.isArray(value) &&
	value.length === fallback.length &&
	value.every((n) => typeof n === "number" && Number.isFinite(n))
		? [...value]
		: [...fallback];

/** DyeColor texture diffuse colours, indexed by dye id. */
const DYE = [
	0xf9fffe, 0xf9801d, 0xc74ebd, 0x3ab3da, 0xfed83d, 0x80c71f, 0xf38baa, 0x474f52, 0x9d9d97,
	0x169c9c, 0x8932b8, 0x3c44aa, 0x835432, 0x5e7c16, 0xb02e26, 0x1d1d21,
];
const dye = (id: unknown): number => DYE[Math.min(15, Math.max(0, Math.trunc(num(id))))];

/** Catalog models that live under another name. */
const ALIASES: Readonly<Record<string, string>> = {
	ender_dragon: "dragon",
	bamboo_raft: "raft",
	bamboo_chest_raft: "chest_raft",
	leash_knot: "lead_knot",
	creaking_transient: "creaking",
	// A mannequin is a player model; the catalog's `player` is the wide Steve skin.
	mannequin: "player",
};

/** Entities the game never draws, each with a debug shape that marks where it is. */
function debugPlan(name: string, nbt: Nbt): EntityPlan | undefined {
	switch (name) {
		case "marker":
			return { kind: "debug", shape: { type: "marker" }, reason: "markers are never rendered in the game" };
		case "ominous_item_spawner":
			return { kind: "debug", shape: { type: "spawner" }, reason: "the spawner is never rendered in the game" };
		case "interaction":
			return {
				kind: "debug",
				shape: { type: "box", width: num(nbt.width, 1), height: num(nbt.height, 1) },
				reason: "an interaction is only its hitbox",
			};
		case "area_effect_cloud":
			return {
				kind: "debug",
				shape: {
					type: "disc",
					radius: Math.max(0.1, num(nbt.Radius, 3)),
					color: typeof nbt.Color === "number" ? nbt.Color & 0xffffff : 0xa070ff,
				},
				reason: "the cloud is particles; the disc is its radius",
			};
		case "lightning_bolt":
			return {
				kind: "debug",
				shape: { type: "bolt" },
				reason: "a bolt lives for two ticks and spans the sky; this one is shortened",
			};
		default:
			return undefined;
	}
}

/**
 * Mobs the pack ships textures for but whose geometry exists only in the game's code. They use their
 * model as soon as the catalog gets one; until then a hitbox-sized stand-in marks the spot.
 */
const PENDING_GEOMETRY: Readonly<Record<string, readonly [number, number, number]>> = {
	nautilus: [0.95, 0.95, 0.95],
	zombie_nautilus: [0.95, 0.95, 0.95],
	parched: [0.6, 1.99, 0.6],
};

/**
 * Scale of the game's EntityRenderer for models the catalog stores at 1x.
 * Not applied because they could not be checked against the game: horse 1.1, cat 0.8,
 * polar_bear 1.2 and husk 1.0625.
 */
const SCALES: Readonly<Record<string, number>> = {
	giant: 6,
	ghast: 4.5,
	happy_ghast: 4,
	wither: 2,
	wither_skeleton: 1.2,
	elder_guardian: 2.35,
	cave_spider: 0.7,
	end_crystal: 2,
	bat: 0.35,
	donkey: 0.87,
	mule: 0.92,
	evoker: 0.9375,
	vindicator: 0.9375,
	pillager: 0.9375,
	illusioner: 0.9375,
	witch: 0.9375,
	villager: 0.9375,
	wandering_trader: 0.9375,
};

const TACK = [
	"saddle",
	"headpiece",
	"noseband",
	"left_bit",
	"right_bit",
	"left_rein",
	"right_rein",
];
const CAMEL_TACK = ["saddle", "bridle", "mirror", "reins"];

/** 1.21.5 moved the saddle into `equipment`; earlier versions kept SaddleItem or a Saddle byte. */
function saddled(nbt: Nbt): boolean {
	const equipment = isRecord(nbt.equipment) ? nbt.equipment : undefined;
	return !!(equipment?.saddle || nbt.SaddleItem || flag(nbt.Saddle) || flag(nbt.saddle));
}

function hiddenParts(name: string, nbt: Nbt): string[] {
	switch (name) {
		case "horse":
		case "skeleton_horse":
		case "zombie_horse":
			return saddled(nbt) ? [] : TACK;
		case "donkey":
		case "mule":
			return [
				...(saddled(nbt) ? [] : TACK),
				...(flag(nbt.ChestedHorse) ? [] : ["left_chest", "right_chest"]),
			];
		case "llama":
		case "trader_llama":
			return flag(nbt.ChestedHorse) ? [] : ["chest_left", "chest_right"];
		case "camel":
		case "camel_husk":
			return saddled(nbt) ? [] : CAMEL_TACK;
		case "armor_stand":
			return [
				...(flag(nbt.ShowArms) ? [] : ["left_arm", "right_arm"]),
				...(flag(nbt.NoBasePlate) ? ["base"] : []),
			];
		default:
			return [];
	}
}

function scaleOf(name: string, nbt: Nbt): number {
	// A slime of Size n is n + 1 times the model.
	if (name === "slime" || name === "magma_cube") return Math.max(1, num(nbt.Size) + 1);
	return SCALES[name] ?? 1;
}

/** TropicalFish.Variant packs shape | pattern << 8 | base colour << 16 | pattern colour << 24. */
function tropicalFish(nbt: Nbt, has: (model: string) => boolean): ModelLayer[] {
	const variant = num(nbt.Variant) >>> 0;
	const shape = (variant & 0xff) === 1 ? "b" : "a";
	const pattern = Math.min(5, (variant >>> 8) & 0xff) + 1;
	const numbered = `tropical_fish_pattern_${shape}_${pattern}`;
	return [
		{ model: `tropical_fish_${shape}`, tint: dye((variant >>> 16) & 0xff) },
		{
			model: has(numbered) ? numbered : `tropical_fish_pattern_${shape}`,
			tint: dye((variant >>> 24) & 0xff),
		},
	];
}

/** Layers the game draws on top of a default (adult, untamed, unsaddled) mob. */
function layersOf(name: string, nbt: Nbt, has: (model: string) => boolean): ModelLayer[] {
	switch (name) {
		case "pufferfish": {
			const state = Math.min(2, Math.max(0, Math.trunc(num(nbt.PuffState))));
			return [{ model: ["puffer_fish_small", "puffer_fish_medium", "puffer_fish_big"][state] }];
		}
		case "tropical_fish":
			return tropicalFish(nbt, has);
		case "armor_stand":
			return [
				{ model: flag(nbt.Small) && has("armor_stand_small") ? "armor_stand_small" : "armor_stand" },
			];
		case "sheep":
			return [
				{ model: "sheep" },
				...(flag(nbt.Sheared) ? [] : [{ model: "sheep_wool", tint: dye(nbt.Color) }]),
			];
		case "mooshroom":
			return [{ model: "mooshroom" }, { model: "mooshroom_mushrooms" }];
		case "slime":
			return [{ model: "slime" }, { model: "slime_outer", translucent: true }];
		case "drowned":
		case "stray":
		case "bogged":
			return [{ model: name }, { model: `${name}_outer` }];
		default:
			return [{ model: ALIASES[name] ?? name }];
	}
}

/** What a minecart carries by default (AbstractMinecart#getDefaultDisplayBlockState). */
const MINECART_BLOCKS: Readonly<Record<string, string>> = {
	chest_minecart: "minecraft:chest[facing=north]",
	furnace_minecart: "minecraft:furnace[facing=north,lit=false]",
	hopper_minecart: "minecraft:hopper",
	tnt_minecart: "minecraft:tnt",
	spawner_minecart: "minecraft:spawner",
	command_block_minecart: "minecraft:command_block[facing=north]",
};

/** `{Name, Properties}` as a block string. */
export function blockStateString(state: unknown, fallback: string): string {
	if (!isRecord(state) || typeof state.Name !== "string" || !state.Name) return fallback;
	const properties = isRecord(state.Properties)
		? Object.entries(state.Properties)
				.filter(([, value]) => ["string", "number", "boolean"].includes(typeof value))
				.map(([key, value]) => `${key}=${value}`)
		: [];
	return properties.length ? `${state.Name}[${properties.join(",")}]` : state.Name;
}

function cargoOf(name: string, nbt: Nbt): { block: string; offset: number } | undefined {
	const block = MINECART_BLOCKS[name];
	if (!block) return undefined;
	const custom = flag(nbt.CustomDisplayTile);
	return {
		block: custom ? blockStateString(nbt.DisplayState, block) : block,
		offset: custom ? num(nbt.DisplayOffset, 6) : 6,
	};
}

/** Direction ids of entities that hang on blocks: frames use all six, paintings the four sides. */
const DIRECTIONS_3D: Direction[] = ["down", "up", "north", "south", "west", "east"];
const DIRECTIONS_2D: Direction[] = ["south", "west", "north", "east"];
const direction = (table: Direction[], value: unknown, fallback: Direction): Direction =>
	table[Math.trunc(num(value, -1))] ?? fallback;

function itemStack(value: unknown): ItemStack | undefined {
	if (!isRecord(value) || typeof value.id !== "string" || !value.id) return undefined;
	const id = value.id.includes(":") ? value.id : `minecraft:${value.id}`;
	return id === "minecraft:air" ? undefined : { id };
}

/** Item each thrown entity shows, and the renderer's scale on top of the item's own 0.5 on the ground. */
const PROJECTILES: Readonly<Record<string, { item: string; scale: number }>> = {
	snowball: { item: "snowball", scale: 1 },
	egg: { item: "egg", scale: 1 },
	ender_pearl: { item: "ender_pearl", scale: 1 },
	experience_bottle: { item: "experience_bottle", scale: 1 },
	potion: { item: "splash_potion", scale: 1 },
	splash_potion: { item: "splash_potion", scale: 1 },
	lingering_potion: { item: "lingering_potion", scale: 1 },
	eye_of_ender: { item: "ender_eye", scale: 1 },
	fireball: { item: "fire_charge", scale: 3 },
	small_fireball: { item: "fire_charge", scale: 0.75 },
	firework_rocket: { item: "firework_rocket", scale: 1 },
};

/** ExperienceOrb#getIcon: which of the sheet's icons a value shows. */
function orbIcon(value: number): number {
	const steps = [2477, 1237, 617, 307, 149, 73, 37, 17, 7, 3];
	const above = steps.findIndex((step) => value >= step);
	return above < 0 ? 0 : steps.length - above;
}

/** Plain text of a text component (a string, JSON, or a compound with text/translate/extra). */
function plainText(value: unknown): string {
	if (value == null) return "";
	if (typeof value === "string") {
		try {
			return plainText(JSON.parse(value));
		} catch {
			return value;
		}
	}
	if (Array.isArray(value)) return value.map(plainText).join("");
	if (isRecord(value)) return String(value.text ?? value.translate ?? "") + plainText(value.extra);
	return String(value);
}

function propPlan(name: string, nbt: Nbt): EntityPlan | undefined {
	const projectile = PROJECTILES[name];
	if (projectile) {
		const stack = itemStack(nbt.Item) ?? itemStack(nbt.FireworksItem) ?? {
			id: `minecraft:${projectile.item}`,
		};
		return { kind: "item", item: stack, mode: "projectile", size: 0.5 * projectile.scale, billboard: true };
	}
	switch (name) {
		case "item": {
			const stack = itemStack(nbt.Item);
			return stack
				? { kind: "item", item: stack, mode: "ground", size: 0.5, billboard: false }
				: { kind: "invisible", reason: "an item entity without an item" };
		}
		case "item_display": {
			const stack = itemStack(nbt.item);
			return stack
				? {
						kind: "item",
						item: stack,
						mode: "display",
						size: nbt.item_display === "ground" ? 0.5 : 1,
						billboard: false,
						display: displayTransform(nbt.transformation),
					}
				: { kind: "invisible", reason: "an item display without an item" };
		}
		case "item_frame":
		case "glow_item_frame": {
			const stack = itemStack(nbt.Item);
			return {
				kind: "frame",
				block: `minecraft:${name}[map=false]`,
				direction: direction(DIRECTIONS_3D, nbt.Facing ?? nbt.facing, "south"),
				// A filled map is drawn by the map renderer, which is out of reach here.
				item: stack?.id === "minecraft:filled_map" ? undefined : stack,
				rotation: ((Math.trunc(num(nbt.ItemRotation)) % 8) + 8) % 8,
				invisible: flag(nbt.Invisible),
			};
		}
		case "painting": {
			const variant = typeof nbt.variant === "string" ? nbt.variant.replace(/^minecraft:/, "") : "kebab";
			return {
				kind: "painting",
				variant: variant || "kebab",
				direction: direction(DIRECTIONS_2D, nbt.facing ?? nbt.Facing, "south"),
			};
		}
		case "text_display": {
			const text = plainText(nbt.text);
			if (!text) return { kind: "invisible", reason: "a text display without text" };
			const alignment = nbt.alignment === "left" || nbt.alignment === "right" ? nbt.alignment : "center";
			return {
				kind: "text",
				text,
				lineWidth: Math.max(1, num(nbt.line_width, 200)),
				background: typeof nbt.background === "number" ? nbt.background >>> 0 : 0x40000000,
				alignment,
				display: displayTransform(nbt.transformation),
			};
		}
		case "experience_orb":
			return {
				kind: "sprite",
				texture: "entity/experience/experience_orb",
				size: 0.3,
				cell: { cols: 4, rows: 4, index: orbIcon(num(nbt.Value, 1)) },
				// The orb pulses between yellow and green; this is the colour at its first tick.
				tint: 0x7fff03,
			};
		case "fishing_bobber":
			return { kind: "sprite", texture: "entity/fishing/fishing_hook", size: 0.5 };
		case "dragon_fireball":
			return { kind: "sprite", texture: "entity/enderdragon/dragon_fireball", size: 2 };
		default:
			return undefined;
	}
}

function displayTransform(value: unknown): DisplayTransform | undefined {
	if (!isRecord(value)) return undefined;
	return {
		translation: vector(value.translation, [0, 0, 0]) as DisplayTransform["translation"],
		scale: vector(value.scale, [1, 1, 1]) as DisplayTransform["scale"],
		left: vector(value.left_rotation, [0, 0, 0, 1]) as DisplayTransform["left"],
		right: vector(value.right_rotation, [0, 0, 0, 1]) as DisplayTransform["right"],
	};
}

function blockPlan(name: string, nbt: Nbt): EntityPlan | undefined {
	switch (name) {
		case "tnt":
			return {
				kind: "block",
				block: blockStateString(nbt.block_state, "minecraft:tnt"),
				anchor: "feet",
			};
		case "falling_block":
			return {
				kind: "block",
				block: blockStateString(nbt.BlockState, "minecraft:sand"),
				anchor: "feet",
			};
		case "block_display": {
			const block = blockStateString(nbt.block_state, "");
			return block
				? { kind: "block", block, anchor: "corner", display: displayTransform(nbt.transformation) }
				: { kind: "invisible", reason: "a block display without a block state" };
		}
		default:
			return undefined;
	}
}

/**
 * Decides how an entity is drawn. `hasModel` says which names the bundled catalog ships; without it
 * every name is assumed present. Nothing is read from the entity beyond its id and NBT.
 */
export function resolveEntityPlan(
	entity: EntityRecord,
	hasModel?: (model: string) => boolean
): EntityPlan {
	if (!entity.id.startsWith("minecraft:")) return { kind: "unsupported" };
	const name = entity.id.slice(10);
	const nbt = entity.nbt ?? {};
	const has = (model: string) => !hasModel || hasModel(model);

	const special = debugPlan(name, nbt) ?? blockPlan(name, nbt) ?? propPlan(name, nbt);
	if (special) return special;

	const layers = layersOf(name, nbt, has);
	if (!has(layers[0].model)) {
		const size = PENDING_GEOMETRY[name];
		return size
			? { kind: "placeholder", size, reason: `no geometry for ${name}; add entity-models/${name}.json` }
			: { kind: "unsupported" };
	}
	return {
		kind: "model",
		layers: layers.filter((layer, index) => index === 0 || has(layer.model)),
		scale: scaleOf(name, nbt),
		hide: hiddenParts(name, nbt),
		cargo: cargoOf(name, nbt),
	};
}

/** The base catalog model of an entity, if it is drawn from one. */
export function resolveEntityModel(
	entity: EntityRecord,
	hasModel?: (model: string) => boolean
): string | undefined {
	const plan = resolveEntityPlan(entity, hasModel);
	return plan.kind === "model" ? plan.layers[0].model : undefined;
}
