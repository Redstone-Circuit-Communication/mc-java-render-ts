import { parseIndexedSchematicBlock, parsePaletteBlockState } from "./types";
import type { BlockEntityBlockState, BlockEntitySnapshot, SchematicPosition } from "./types";

/**
 * Where and how blocks whose look is not in their block model are drawn: non-player heads, copper golem
 * statues, conduits, end portals, and a marker for the blocks that have no look at all. Pure rules, no three;
 * model-overlays.ts turns them into instanced meshes.
 */
export const MAX_MODEL_BLOCKS_INSPECTED = 750_000;
export const MAX_MODEL_PALETTE_ENTRIES_INSPECTED = 65_536;
export const MAX_MODEL_INSTANCES = 4_096;

export type Facing = "north" | "east" | "south" | "west";
export type Offset = readonly [number, number, number];

/** A catalog model standing in a block. Offsets are in world axes from the block's centre. */
export interface ModelPlacement {
	position: SchematicPosition;
	/** Catalog model, drawn through Cubane's entity renderer; its feet rest on the block's floor. */
	model: string;
	/** A texture under textures/ that replaces the model's own, so resource packs can reskin it. */
	texture?: string;
	/** Nodes of the model to leave out. */
	hide?: readonly string[];
	offset?: Offset;
	/** About Y, radians. The catalog models face north (-Z) at zero. */
	rotationY: number;
}

/**
 * Blocks of a schematic whose palette entry `supports`, resolved one by one. A position is taken once and
 * `limit` bounds the result, as for every other block-entity renderer.
 */
export function selectPaletteBlocks<T>(
	snapshot: BlockEntitySnapshot,
	supports: (blockName: string) => boolean,
	resolve: (state: BlockEntityBlockState, position: SchematicPosition) => T | null,
	limit = MAX_MODEL_INSTANCES
): T[] {
	if (!Array.isArray(snapshot.palette) || !Array.isArray(snapshot.blocks)) return [];
	const states = new Map<number, BlockEntityBlockState>();
	const palette = Math.min(snapshot.palette.length, MAX_MODEL_PALETTE_ENTRIES_INSPECTED);
	for (let index = 0; index < palette; index += 1) {
		const state = parsePaletteBlockState(snapshot.palette[index]);
		if (state !== null && supports(state.name)) states.set(index, state);
	}
	if (states.size === 0) return [];

	const found: T[] = [];
	const taken = new Set<string>();
	const inspected = Math.min(snapshot.blocks.length, MAX_MODEL_BLOCKS_INSPECTED);
	for (let index = 0; index < inspected && found.length < limit; index += 1) {
		const block = parseIndexedSchematicBlock(snapshot.blocks[index]);
		if (block === null) continue;
		const state = states.get(block.paletteIndex);
		if (state === undefined) continue;
		const key = block.position.join(",");
		if (taken.has(key)) continue;
		const value = resolve(state, block.position);
		if (value === null) continue;
		taken.add(key);
		found.push(value);
	}
	return found;
}

/** Y rotation that turns a model facing north to `facing`: the catalog's chests and statues. */
export function facingRotation(facing: unknown): number | null {
	switch (facing) {
		case "north":
			return 0;
		case "east":
			return -Math.PI / 2;
		case "south":
			return Math.PI;
		case "west":
			return Math.PI / 2;
		default:
			return null;
	}
}

// ---- heads ---------------------------------------------------------------------------------
export type SkullKind = "skeleton" | "wither_skeleton" | "zombie" | "creeper" | "piglin" | "dragon";

/** Block ids and catalog model of every head that is not a player's. */
const SKULLS: Readonly<
	Record<SkullKind, { floor: string; wall: string; model: string; texture: string }>
> = {
	skeleton: {
		floor: "minecraft:skeleton_skull",
		wall: "minecraft:skeleton_wall_skull",
		model: "head_skeleton",
		texture: "entity/skeleton/skeleton",
	},
	wither_skeleton: {
		floor: "minecraft:wither_skeleton_skull",
		wall: "minecraft:wither_skeleton_wall_skull",
		model: "head_wither_skeleton",
		texture: "entity/skeleton/wither_skeleton",
	},
	zombie: {
		floor: "minecraft:zombie_head",
		wall: "minecraft:zombie_wall_head",
		model: "head_zombie",
		texture: "entity/zombie/zombie",
	},
	creeper: {
		floor: "minecraft:creeper_head",
		wall: "minecraft:creeper_wall_head",
		model: "head_creeper",
		texture: "entity/creeper/creeper",
	},
	piglin: {
		floor: "minecraft:piglin_head",
		wall: "minecraft:piglin_wall_head",
		model: "head_piglin",
		texture: "entity/piglin/piglin",
	},
	dragon: {
		floor: "minecraft:dragon_head",
		wall: "minecraft:dragon_wall_head",
		model: "head_dragon",
		texture: "entity/enderdragon/dragon",
	},
};
const SKULL_BLOCKS = new Map<string, { kind: SkullKind; wall: boolean }>(
	(Object.entries(SKULLS) as [SkullKind, (typeof SKULLS)[SkullKind]][]).flatMap(([kind, ids]) => [
		[ids.floor, { kind, wall: false }],
		[ids.wall, { kind, wall: true }],
	])
);

export function resolveSkullBlock(blockName: unknown): { kind: SkullKind; wall: boolean } | null {
	return typeof blockName === "string" ? (SKULL_BLOCKS.get(blockName) ?? null) : null;
}

/** SkullBlockRenderer: a wall head sits 0.25 toward its wall and 0.25 up, facing out. */
const WALL_HEADS: Readonly<Record<Facing, { offset: Offset; rotationY: number }>> = {
	north: { offset: [0, 0.25, 0.25], rotationY: 0 },
	east: { offset: [-0.25, 0.25, 0], rotationY: -Math.PI / 2 },
	south: { offset: [0, 0.25, -0.25], rotationY: Math.PI },
	west: { offset: [0.25, 0.25, 0], rotationY: Math.PI / 2 },
};

export function resolveSkull(
	state: BlockEntityBlockState,
	position: SchematicPosition
): ModelPlacement | null {
	const block = resolveSkullBlock(state.name);
	if (block === null) return null;
	const { model, texture } = SKULLS[block.kind];
	if (block.wall) {
		const wall = WALL_HEADS[(state.properties.facing ?? "north") as Facing];
		return wall === undefined ? null : { position, model, texture, ...wall };
	}
	// Rotation 0 faces south and each step turns 22.5 degrees clockwise; the model faces north at zero.
	const parsed = Number(state.properties.rotation);
	const rotation = Number.isInteger(parsed) && parsed >= 0 && parsed <= 15 ? parsed : 0;
	return { position, model, texture, rotationY: Math.PI - (rotation * Math.PI) / 8 };
}

export function selectSkulls(snapshot: BlockEntitySnapshot): ModelPlacement[] {
	return selectPaletteBlocks(snapshot, (name) => resolveSkullBlock(name) !== null, resolveSkull);
}

// ---- copper golem statues ---------------------------------------------------------------------
export type StatueStage = "copper" | "exposed" | "weathered" | "oxidized";

const STATUE_STAGES: Readonly<Record<string, StatueStage>> = {
	"minecraft:copper_golem_statue": "copper",
	"minecraft:exposed_copper_golem_statue": "exposed",
	"minecraft:weathered_copper_golem_statue": "weathered",
	"minecraft:oxidized_copper_golem_statue": "oxidized",
	"minecraft:waxed_copper_golem_statue": "copper",
	"minecraft:waxed_exposed_copper_golem_statue": "exposed",
	"minecraft:waxed_weathered_copper_golem_statue": "weathered",
	"minecraft:waxed_oxidized_copper_golem_statue": "oxidized",
};
const STATUE_TEXTURES: Readonly<Record<StatueStage, string>> = {
	copper: "entity/copper_golem/copper_golem",
	exposed: "entity/copper_golem/copper_golem_exposed",
	weathered: "entity/copper_golem/copper_golem_weathered",
	oxidized: "entity/copper_golem/copper_golem_oxidized",
};

/** Waxing does not change the texture, so waxed and unwaxed statues share a stage. */
export function resolveStatueStage(blockName: unknown): StatueStage | null {
	return typeof blockName === "string" ? (STATUE_STAGES[blockName] ?? null) : null;
}

/**
 * Every pose (standing, sitting, running, star) is drawn standing: the pose keyframes live in the game's
 * code and not in the pack, so only the model's own pose is known.
 */
export function resolveStatue(
	state: BlockEntityBlockState,
	position: SchematicPosition
): ModelPlacement | null {
	const stage = resolveStatueStage(state.name);
	const rotationY = facingRotation(state.properties.facing ?? "north");
	if (stage === null || rotationY === null) return null;
	return { position, model: "copper_golem", texture: STATUE_TEXTURES[stage], rotationY };
}

export function selectStatues(snapshot: BlockEntitySnapshot): ModelPlacement[] {
	return selectPaletteBlocks(snapshot, (name) => resolveStatueStage(name) !== null, resolveStatue);
}

// ---- conduits -------------------------------------------------------------------------------
export function resolveConduit(
	state: BlockEntityBlockState,
	position: SchematicPosition
): ModelPlacement | null {
	if (state.name !== "minecraft:conduit") return null;
	// Without its frame a conduit is only the shell; the cage, eye and wind belong to an active one.
	return {
		position,
		model: "conduit",
		texture: "entity/conduit/base",
		hide: ["eye", "cage", "wind"],
		rotationY: 0,
	};
}

export function selectConduits(snapshot: BlockEntitySnapshot): ModelPlacement[] {
	return selectPaletteBlocks(snapshot, (name) => name === "minecraft:conduit", resolveConduit);
}

// ---- end portals -----------------------------------------------------------------------------
export type PortalKind = "portal" | "gateway";
export interface PortalPlacement {
	position: SchematicPosition;
	kind: PortalKind;
}

export function resolvePortalKind(blockName: unknown): PortalKind | null {
	if (blockName === "minecraft:end_portal") return "portal";
	return blockName === "minecraft:end_gateway" ? "gateway" : null;
}

export function selectPortals(snapshot: BlockEntitySnapshot): PortalPlacement[] {
	return selectPaletteBlocks(
		snapshot,
		(name) => resolvePortalKind(name) !== null,
		(state, position) => ({ position, kind: resolvePortalKind(state.name) as PortalKind })
	);
}

// ---- blocks the game never draws ----------------------------------------------------------------
export type MarkerKind = "barrier" | "light" | "structure_void" | "moving_piston";
export interface MarkerPlacement {
	position: SchematicPosition;
	kind: MarkerKind;
}

export function resolveMarkerKind(blockName: unknown): MarkerKind | null {
	switch (blockName) {
		case "minecraft:barrier":
			return "barrier";
		case "minecraft:light":
			return "light";
		case "minecraft:structure_void":
			return "structure_void";
		case "minecraft:moving_piston":
			return "moving_piston";
		default:
			return null;
	}
}

export function selectMarkers(snapshot: BlockEntitySnapshot): MarkerPlacement[] {
	return selectPaletteBlocks(
		snapshot,
		(name) => resolveMarkerKind(name) !== null,
		(state, position) => ({ position, kind: resolveMarkerKind(state.name) as MarkerKind })
	);
}
