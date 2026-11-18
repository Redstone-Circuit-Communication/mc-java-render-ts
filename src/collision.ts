/**
 * How tall a block is for the walking first-person camera (docs/UNIFIED_API.md, "First person"): 0 = you walk through it,
 * 0.5 = the bottom half (bottom slabs, stairs, beds … — with the 0.6-block step height you walk up them), 1 = a full block.
 * Deliberately approximate: walking through a build needs "can I stand here", not the exact model shapes.
 * The same file is in both renderer packages (Java ids with `[props]`, Bedrock ids with a states object).
 */
export type BlockProps = Readonly<Record<string, string | number | boolean>>;

const PASSABLE = new Set([
	"air", "cave_air", "void_air", "structure_void", "water", "flowing_water", "lava", "flowing_lava", "light", "light_block",
	"fire", "soul_fire", "redstone_wire", "tripwire", "trip_wire", "tripwire_hook", "lever", "ladder", "vine", "cobweb", "web",
	"snow_layer", "short_grass", "tall_grass", "tallgrass", "fern", "large_fern", "double_plant", "dead_bush", "deadbush",
	"seagrass", "tall_seagrass", "kelp", "kelp_plant", "sugar_cane", "reeds", "sweet_berry_bush", "wheat", "carrots",
	"potatoes", "beetroot", "beetroots", "nether_wart", "cocoa", "lily_pad", "waterlily", "frogspawn", "glow_lichen",
	"sculk_vein", "hanging_roots", "spore_blossom", "small_dripleaf", "big_dripleaf_stem", "cave_vines", "cave_vines_plant",
	"cave_vines_body_with_berries", "cave_vines_head_with_berries", "twisting_vines", "twisting_vines_plant", "weeping_vines",
	"weeping_vines_plant", "scaffolding", "bubble_column", "portal", "nether_portal", "end_portal", "end_gateway",
	"pumpkin_stem", "melon_stem", "attached_pumpkin_stem", "attached_melon_stem", "dandelion", "yellow_flower", "poppy",
	"red_flower", "blue_orchid", "allium", "azure_bluet", "oxeye_daisy", "cornflower", "lily_of_the_valley", "wither_rose",
	"sunflower", "lilac", "rose_bush", "peony", "torchflower", "torchflower_crop", "pitcher_plant", "pitcher_crop",
	"brown_mushroom", "red_mushroom", "crimson_fungus", "warped_fungus", "crimson_roots", "warped_roots", "nether_sprouts",
	"repeater", "comparator", "powered_repeater", "unpowered_repeater", "powered_comparator", "unpowered_comparator",
	"flower_pot", "end_rod", "lantern", "soul_lantern", "chain", "iron_chain", "lightning_rod", "sea_pickle", "turtle_egg",
	"pointed_dripstone", "conduit", "string", "bush", "firefly_bush", "leaf_litter", "short_dry_grass", "tall_dry_grass",
]);
const PASSABLE_SUFFIX = [
	"_carpet", "_pressure_plate", "_button", "torch", "_sign", "_banner", "rail", "_sapling", "_tulip", "_fan", "_coral",
	"_roots", "candle", "_petals", "_door", "_trapdoor", "_head", "_skull", "_bud", "amethyst_cluster", "_wildflowers",
];
const HALF_SUFFIX = ["_stairs", "_bed", "bed", "daylight_detector", "daylight_detector_inverted", "stonecutter", "stonecutter_block", "cake", "campfire", "sculk_sensor", "sculk_shrieker"];

const truthy = (v: string | number | boolean | undefined) => v === true || v === "true" || v === 1 || v === "1";

/** `name` with or without the `minecraft:` namespace; Java `[props]` are parsed off the name, Bedrock states come as `props`. */
export function collisionHeight(rawName: string, props: BlockProps = {}): number {
	let name = rawName.trim();
	const bracket = name.indexOf("[");
	let all: Record<string, string | number | boolean> = { ...props };
	if (bracket >= 0) {
		for (const pair of name.slice(bracket + 1, name.lastIndexOf("]")).split(",")) {
			const eq = pair.indexOf("=");
			if (eq > 0) all[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
		}
		name = name.slice(0, bracket);
	}
	name = name.replace(/^minecraft:/, "");
	if (!name || PASSABLE.has(name) || PASSABLE_SUFFIX.some((s) => name.endsWith(s))) return 0;
	if (name.includes("slab")) {
		if (name.startsWith("double_") || name.includes("double_slab") || all.type === "double" || all.type === "top") return 1;
		if (truthy(all.top_slot_bit) || all["minecraft:vertical_half"] === "top") return 1;
		return 0.5;
	}
	if (name.endsWith("_stairs")) return all.half === "top" || truthy(all.upside_down_bit) ? 1 : 0.5;
	if (HALF_SUFFIX.some((s) => name === s || name.endsWith(s))) return 0.5;
	return 1;
}
