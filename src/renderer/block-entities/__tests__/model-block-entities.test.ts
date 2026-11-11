import { describe, expect, it } from "vitest";
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Texture } from "three";
import type { InstancedMesh } from "three";
import {
	BlockEntityRendererRegistry,
	DEFAULT_BLOCK_ENTITY_RENDERERS,
	INVISIBLE_BLOCKS_OVERLAY_NAME,
	createConduitOverlay,
	createCopperGolemStatueOverlay,
	createEndPortalOverlay,
	createInvisibleBlockOverlay,
	createSkullOverlay,
	renderBlockEntities,
	resolveConduit,
	resolveSkull,
	resolveSkullBlock,
	resolveStatue,
	resolveStatueStage,
	selectMarkers,
	selectPaletteBlocks,
	selectPortals,
	selectSkulls,
	selectStatues,
} from "..";
import type {
	BlockEntityResources,
	BlockEntitySchematic,
	BlockEntitySnapshot,
	SchematicPosition,
} from "..";

type Placed = [name: string, properties: Record<string, string>, position: SchematicPosition];

/** A snapshot the way the wasm schematic reports it: a palette, and [x, y, z, paletteIndex] rows. */
function snapshot(placed: Placed[]): BlockEntitySnapshot {
	const palette: unknown[] = [];
	const indexOf = new Map<string, number>();
	const blocks = placed.map(([name, properties, position]) => {
		const key = `${name}${JSON.stringify(properties)}`;
		if (!indexOf.has(key)) {
			indexOf.set(key, palette.length);
			palette.push({ Name: name, Properties: properties });
		}
		return [...position, indexOf.get(key)];
	});
	return { palette, blocks, entities: [] };
}
const state = (name: string, properties: Record<string, string> = {}) => ({ name, properties });

/** Instances of an overlay's meshes: position and yaw, read back from their matrices. */
function instances(mesh: InstancedMesh) {
	return Array.from({ length: mesh.count }, (_, i) => {
		const e = mesh.instanceMatrix.array.slice(i * 16, i * 16 + 16);
		return { at: [e[12], e[13], e[14]].map((v) => Math.round(v * 1e4) / 1e4), yaw: Math.atan2(e[8], e[0]) };
	});
}
const meshesOf = (group: Group, name: string) => (group.children.find((c) => c.name === name)?.children ?? []) as InstancedMesh[];

/** Entity models are boxes named after their parts: enough to bake and to see what was hidden. */
function fixtures(parts: string[] = ["body"]) {
	const textures: string[] = [];
	const models: string[] = [];
	const own = new Texture();
	const resources: BlockEntityResources = {
		getEntityMesh: async (type) => {
			models.push(type);
			const root = new Group();
			for (const part of parts) {
				const node = new Group();
				node.name = part;
				const mesh = new Mesh(new BoxGeometry(0.5, 0.5, 0.5), new MeshStandardMaterial({ map: own }));
				node.add(mesh);
				root.add(node);
			}
			const outer = new Group();
			outer.position.y = -0.5;
			outer.add(root);
			return outer;
		},
		getTexture: async (path) => {
			textures.push(path);
			return new Texture();
		},
	};
	const schematic: BlockEntitySchematic = { group: new Group(), schematicWrapper: {} };
	return { resources, schematic, textures, models, own };
}

describe("heads that are not a player's", () => {
	it("knows every skull block, floor and wall, and leaves player heads to their own renderer", () => {
		const names = [
			"skeleton_skull", "skeleton_wall_skull", "wither_skeleton_skull", "wither_skeleton_wall_skull",
			"zombie_head", "zombie_wall_head", "creeper_head", "creeper_wall_head",
			"piglin_head", "piglin_wall_head", "dragon_head", "dragon_wall_head",
		];
		for (const name of names) expect(resolveSkullBlock(`minecraft:${name}`)).not.toBeNull();
		expect(resolveSkullBlock("minecraft:skeleton_wall_skull")).toEqual({ kind: "skeleton", wall: true });
		expect(resolveSkullBlock("minecraft:zombie_head")).toEqual({ kind: "zombie", wall: false });
		expect(resolveSkullBlock("minecraft:player_head")).toBeNull();
		expect(resolveSkullBlock("minecraft:stone")).toBeNull();
	});
	it("stands a floor head on its block, facing south at rotation 0 and turning 22.5 degrees a step", () => {
		const head = (rotation?: string) =>
			resolveSkull(state("minecraft:skeleton_skull", rotation === undefined ? {} : { rotation }), [3, 1, 4]);
		expect(head()?.model).toBe("head_skeleton");
		expect(head()?.texture).toBe("entity/skeleton/skeleton");
		expect(head()?.offset).toBeUndefined();
		// The models face north at zero, so facing south is half a turn.
		expect(head("0")?.rotationY).toBeCloseTo(Math.PI, 6);
		expect(head("4")?.rotationY).toBeCloseTo(Math.PI / 2, 6);
		expect(head("8")?.rotationY).toBeCloseTo(0, 6);
		expect(head("15")?.rotationY).toBeCloseTo(Math.PI - (15 * Math.PI) / 8, 6);
		expect(head("99")?.rotationY).toBeCloseTo(Math.PI, 6);
	});
	it("hangs a wall head 0.25 toward its wall and 0.25 up, facing out", () => {
		const wall = (facing?: string) =>
			resolveSkull(state("minecraft:wither_skeleton_wall_skull", facing === undefined ? {} : { facing }), [0, 0, 0]);
		expect(wall("north")?.offset).toEqual([0, 0.25, 0.25]);
		expect(wall("south")?.offset).toEqual([0, 0.25, -0.25]);
		expect(wall("west")?.offset).toEqual([0.25, 0.25, 0]);
		expect(wall("east")?.offset).toEqual([-0.25, 0.25, 0]);
		expect(wall("north")?.rotationY).toBe(0);
		expect(wall("east")?.rotationY).toBeCloseTo(-Math.PI / 2, 6);
		expect(wall("south")?.rotationY).toBeCloseTo(Math.PI, 6);
		expect(wall("west")?.rotationY).toBeCloseTo(Math.PI / 2, 6);
		expect(wall()?.offset).toEqual([0, 0.25, 0.25]); // a schematic may omit the default property
		expect(wall("up")).toBeNull();
	});
	it("takes each head's texture from the pack", () => {
		const textureOf = (name: string) => resolveSkull(state(`minecraft:${name}`), [0, 0, 0])?.texture;
		expect(textureOf("wither_skeleton_skull")).toBe("entity/skeleton/wither_skeleton");
		expect(textureOf("zombie_head")).toBe("entity/zombie/zombie");
		expect(textureOf("creeper_head")).toBe("entity/creeper/creeper");
		expect(textureOf("piglin_head")).toBe("entity/piglin/piglin");
		expect(textureOf("dragon_head")).toBe("entity/enderdragon/dragon");
	});
});

describe("copper golem statues", () => {
	it("maps the oxidation stage, waxed or not, to a texture", () => {
		expect(resolveStatueStage("minecraft:copper_golem_statue")).toBe("copper");
		expect(resolveStatueStage("minecraft:waxed_weathered_copper_golem_statue")).toBe("weathered");
		expect(resolveStatueStage("minecraft:oxidized_copper_golem_statue")).toBe("oxidized");
		expect(resolveStatueStage("minecraft:copper_chest")).toBeNull();
		const placed = resolveStatue(state("minecraft:exposed_copper_golem_statue", { facing: "east" }), [1, 2, 3]);
		expect(placed).toEqual({
			position: [1, 2, 3],
			model: "copper_golem",
			texture: "entity/copper_golem/copper_golem_exposed",
			rotationY: -Math.PI / 2,
		});
	});
	it("draws every pose standing and defaults to facing north", () => {
		for (const pose of ["standing", "sitting", "running", "star"])
			expect(resolveStatue(state("minecraft:copper_golem_statue", { copper_golem_pose: pose }), [0, 0, 0])?.model).toBe("copper_golem");
		expect(resolveStatue(state("minecraft:copper_golem_statue"), [0, 0, 0])?.rotationY).toBe(0);
		expect(resolveStatue(state("minecraft:copper_golem_statue", { facing: "up" }), [0, 0, 0])).toBeNull();
	});
});

describe("conduits", () => {
	it("keeps only the shell of a conduit that has no frame", () => {
		expect(resolveConduit(state("minecraft:conduit"), [0, 0, 0])).toEqual({
			position: [0, 0, 0],
			model: "conduit",
			texture: "entity/conduit/base",
			hide: ["eye", "cage", "wind"],
			rotationY: 0,
		});
		expect(resolveConduit(state("minecraft:stone"), [0, 0, 0])).toBeNull();
	});
});

describe("selecting blocks from a schematic", () => {
	const board = snapshot([
		["minecraft:skeleton_skull", { rotation: "4" }, [0, 0, 0]],
		["minecraft:stone", {}, [1, 0, 0]],
		["minecraft:zombie_head", {}, [2, 0, 0]],
		["minecraft:skeleton_skull", { rotation: "4" }, [0, 0, 0]], // the same cell again
		["minecraft:copper_golem_statue", { facing: "south" }, [3, 0, 0]],
		["minecraft:conduit", {}, [4, 0, 0]],
		["minecraft:end_portal", {}, [5, 0, 0]],
		["minecraft:end_gateway", {}, [6, 0, 0]],
		["minecraft:barrier", {}, [7, 0, 0]],
		["minecraft:light", { level: "15" }, [8, 0, 0]],
	]);
	it("picks each family out of the palette and takes a cell once", () => {
		expect(selectSkulls(board).map((head) => head.position)).toEqual([[0, 0, 0], [2, 0, 0]]);
		expect(selectStatues(board)).toHaveLength(1);
		expect(selectPortals(board).map((portal) => portal.kind)).toEqual(["portal", "gateway"]);
		expect(selectMarkers(board).map((marker) => marker.kind)).toEqual(["barrier", "light"]);
	});
	it("bounds the result, and returns nothing without a palette", () => {
		const taken = selectPaletteBlocks(board, () => true, (s, position) => ({ s, position }), 3);
		expect(taken).toHaveLength(3);
		expect(selectSkulls({ palette: undefined, blocks: undefined, entities: undefined })).toEqual([]);
	});
});

describe("model overlays", () => {
	const board = snapshot([
		["minecraft:skeleton_skull", { rotation: "0" }, [10, 4, 20]],
		["minecraft:skeleton_wall_skull", { facing: "north" }, [11, 4, 20]],
		["minecraft:zombie_head", {}, [12, 4, 20]],
	]);
	it("draws one instanced mesh per model and texture, in their blocks", async () => {
		const { resources, schematic, textures, models } = fixtures();
		const overlay = await createSkullOverlay(schematic, new AbortController().signal, board, resources);
		expect(overlay.count).toBe(3);
		expect(models.sort()).toEqual(["head_skeleton", "head_zombie"]);
		expect(textures.sort()).toEqual(["entity/skeleton/skeleton", "entity/zombie/zombie"]);
		const group = schematic.group.children[0] as Group;
		expect(group.name).toBe("schematic-renderer:skulls");
		const skeletons = group.children.find((c) => c.name.endsWith("head_skeleton")) as InstancedMesh;
		const placed = instances(skeletons);
		// The wall head sits 0.25 up and 0.25 toward its wall (south, for a head facing north).
		expect(placed.map((p) => p.at)).toEqual([[10, 4, 20], [11, 4.25, 20.25]]);
		expect(placed[0].yaw).toBeCloseTo(Math.PI, 5);
		expect(placed[1].yaw).toBeCloseTo(0, 5);
	});
	it("replaces the model's texture with a copy of the pack's, unflipped, and never frees the pack's", async () => {
		const { resources, schematic, own } = fixtures();
		const overlay = await createSkullOverlay(schematic, new AbortController().signal, board, resources);
		const mesh = (schematic.group.children[0] as Group).children[0] as InstancedMesh;
		const material = mesh.material as MeshStandardMaterial;
		expect(material.map).not.toBe(own);
		expect(material.map?.flipY).toBe(false);
		overlay.dispose();
		expect(schematic.group.children).toHaveLength(0);
	});
	it("falls back to the model's own texture when the pack has none", async () => {
		const { resources, schematic, own } = fixtures();
		const failing: BlockEntityResources = { ...resources, getTexture: async () => { throw new Error("no such texture"); } };
		const overlay = await createSkullOverlay(schematic, new AbortController().signal, board, failing);
		expect(overlay.count).toBe(3);
		const mesh = (schematic.group.children[0] as Group).children[0] as InstancedMesh;
		expect((mesh.material as MeshStandardMaterial).map).toBe(own);
	});
	it("leaves the hidden parts out of a conduit", async () => {
		const { resources, schematic } = fixtures(["eye", "cage", "base", "wind"]);
		const overlay = await createConduitOverlay(
			schematic,
			new AbortController().signal,
			snapshot([["minecraft:conduit", {}, [0, 0, 0]]]),
			resources
		);
		expect(overlay.count).toBe(1);
		const mesh = (schematic.group.children[0] as Group).children[0] as InstancedMesh;
		expect(mesh.geometry.getAttribute("position").count).toBe(24); // one box
	});
	it("draws statues of each stage as their own mesh", async () => {
		const { resources, schematic, textures } = fixtures();
		const overlay = await createCopperGolemStatueOverlay(
			schematic,
			new AbortController().signal,
			snapshot([
				["minecraft:copper_golem_statue", {}, [0, 0, 0]],
				["minecraft:waxed_copper_golem_statue", {}, [1, 0, 0]],
				["minecraft:oxidized_copper_golem_statue", {}, [2, 0, 0]],
			]),
			resources
		);
		expect(overlay.count).toBe(3);
		expect(textures.sort()).toEqual(["entity/copper_golem/copper_golem", "entity/copper_golem/copper_golem_oxidized"]);
		expect((schematic.group.children[0] as Group).children).toHaveLength(2);
	});
	it("draws nothing, and keeps nothing, for an aborted build or a missing model", async () => {
		const { resources, schematic } = fixtures();
		const aborted = new AbortController();
		aborted.abort();
		expect((await createSkullOverlay(schematic, aborted.signal, board, resources)).count).toBe(0);
		const broken: BlockEntityResources = { ...resources, getEntityMesh: async () => { throw new Error("gone"); } };
		expect((await createSkullOverlay(schematic, new AbortController().signal, board, broken)).count).toBe(0);
		expect(schematic.group.children).toHaveLength(0);
	});
});

describe("end portals and markers for blocks the game does not draw", () => {
	const board = snapshot([
		["minecraft:end_portal", {}, [0, 0, 0]],
		["minecraft:end_portal", {}, [1, 0, 0]],
		["minecraft:end_gateway", {}, [2, 0, 0]],
		["minecraft:barrier", {}, [3, 0, 0]],
		["minecraft:light", { level: "7" }, [4, 0, 0]],
		["minecraft:structure_void", {}, [5, 0, 0]],
		["minecraft:moving_piston", {}, [6, 0, 0]],
	]);
	it("lays a starry surface over each portal and fills a gateway", async () => {
		const { resources, schematic, textures } = fixtures();
		const overlay = await createEndPortalOverlay(schematic, new AbortController().signal, board, resources);
		expect(overlay.count).toBe(3);
		expect(textures.sort()).toEqual(["entity/end_portal/end_portal", "environment/end_sky"]);
		const group = schematic.group.children[0] as Group;
		// A sky layer and a star layer for the portals, and the same two for the gateway.
		expect(group.children).toHaveLength(4);
		const portalLayer = group.children.find((c) => c.name.includes(":portal:0")) as InstancedMesh;
		expect(portalLayer.count).toBe(2);
	});
	it("still draws the sky if the stars are missing", async () => {
		const { resources, schematic } = fixtures();
		const noStars: BlockEntityResources = {
			...resources,
			getTexture: async (path) => {
				if (path.includes("end_portal")) throw new Error("none");
				return new Texture();
			},
		};
		const overlay = await createEndPortalOverlay(schematic, new AbortController().signal, board, noStars);
		expect(overlay.count).toBe(3);
		expect((schematic.group.children[0] as Group).children).toHaveLength(2);
	});
	it("marks each invisible block with a shape of its own, in one named overlay", async () => {
		const { schematic } = fixtures();
		const overlay = await createInvisibleBlockOverlay(schematic, new AbortController().signal, board);
		expect(overlay.count).toBe(4);
		const group = schematic.group.children[0] as Group;
		expect(group.name).toBe(INVISIBLE_BLOCKS_OVERLAY_NAME);
		expect(group.children.map((c) => c.name.split(":").pop())).toEqual(["barrier", "light", "structure_void", "moving_piston"]);
		const barrier = group.children[0] as InstancedMesh;
		expect(instances(barrier)).toEqual([{ at: [3, 0, 0], yaw: 0 }]);
		overlay.dispose();
		expect(schematic.group.children).toHaveLength(0);
	});
});

describe("the default registry", () => {
	it("takes over the blocks that have no geometry in their model", () => {
		const registry = new BlockEntityRendererRegistry();
		for (const name of [
			"skeleton_skull", "skeleton_wall_skull", "wither_skeleton_skull", "zombie_head", "creeper_wall_head",
			"piglin_head", "dragon_wall_head", "copper_golem_statue", "waxed_oxidized_copper_golem_statue",
			"conduit", "end_portal", "end_gateway", "barrier", "light", "structure_void", "moving_piston",
		])
			expect(registry.handles(`minecraft:${name}`)).toBe(true);
		// A spawner has a model of its own; only its inverted faces needed fixing.
		for (const name of ["spawner", "trial_spawner", "vault", "stone", "end_portal_frame", "snow"])
			expect(registry.handles(`minecraft:${name}`)).toBe(false);
	});
	it("can leave the markers out and still draw the rest", async () => {
		const ids = ["minecraft:skull", "minecraft:copper_golem_statue", "minecraft:conduit", "minecraft:end_portal", "minecraft:invisible_blocks"];
		const renderers = DEFAULT_BLOCK_ENTITY_RENDERERS.filter((renderer) => ids.includes(renderer.id));
		expect(renderers).toHaveLength(5);
		const board = snapshot([
			["minecraft:skeleton_skull", {}, [0, 0, 0]],
			["minecraft:barrier", {}, [1, 0, 0]],
		]);
		const run = async (invisibleBlocks?: boolean) => {
			const { resources, schematic } = fixtures();
			const wrapper = { get_palette: () => board.palette, blocks_indices: () => board.blocks, get_all_block_entities: () => [] };
			return renderBlockEntities(
				{ ...schematic, schematicWrapper: wrapper },
				new AbortController().signal,
				resources,
				{ includeDefaultRenderers: false, renderers, invisibleBlocks }
			);
		};
		expect((await run()).count).toBe(2);
		expect((await run(false)).count).toBe(1);
	});
});
