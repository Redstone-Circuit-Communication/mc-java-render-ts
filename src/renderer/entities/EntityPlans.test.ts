import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { EntityManager } from "./EntityManager";
import { PropBuilder, type EntityAssets } from "./special/PropBuilder";
import type { Pixels } from "./special/geometry";

/** Which named nodes each fake catalog model has; the rest of the hierarchy mirrors a real GLB. */
const NODES: Record<string, string[]> = {
	horse: ["head", "saddle", "left_rein"],
	sheep: ["head", "body"],
	sheep_wool: ["head", "body"],
	slime: ["cube"],
	slime_outer: ["cube"],
	zombie: ["head", "body"],
	giant: ["head", "body"],
	minecart: ["front"],
	chest_minecart: ["front"],
};
const geometry = new THREE.BoxGeometry(1, 1, 1);
const materials = new Map<string, THREE.MeshStandardMaterial>();
const material = (name: string) => {
	if (!materials.has(name)) materials.set(name, new THREE.MeshStandardMaterial());
	return materials.get(name) as THREE.MeshStandardMaterial;
};
/** Like EntityRenderer: a group holding the scene, which sits half a block low. */
async function loadModel(name: string) {
	const scene = new THREE.Group();
	scene.position.y = -0.5;
	for (const node of NODES[name] ?? ["body"]) {
		const pivot = new THREE.Group();
		pivot.name = node;
		pivot.add(new THREE.Mesh(geometry, material(name)));
		scene.add(pivot);
	}
	const group = new THREE.Group();
	group.add(scene);
	return group;
}
const requested: string[] = [];
const blockGeometry = new THREE.BoxGeometry(1, 1, 1);
async function loadBlock(block: string) {
	requested.push(block);
	const group = new THREE.Group();
	group.name = `block:${block}`;
	group.add(new THREE.Mesh(blockGeometry, new THREE.MeshStandardMaterial()));
	return group;
}
/** Mobs the catalog has no geometry for, which is when a stand-in is drawn. */
const MISSING = new Set(["nautilus", "parched"]);
const hasModel = (model: string) => !MISSING.has(model);

function entity(id: string, nbt: Record<string, unknown> = {}, position = [0.5, 1, 0.5]) {
	return { id: `minecraft:${id}`, position, nbt };
}
/** Opaque texels, so every sprite is a solid square and the counts below are easy to follow. */
const opaque = (width: number, height: number): Pixels => ({
	data: new Uint8ClampedArray(width * height * 4).fill(255),
	width,
	height,
});
const itemModel = (path: string, tints?: unknown[]) => ({
	model: { type: "minecraft:model", model: `minecraft:${path}`, ...(tints ? { tints } : {}) },
});
const DEFINITIONS: Record<string, unknown> = {
	"items/diamond.json": itemModel("item/diamond"),
	"items/snowball.json": itemModel("item/snowball"),
	"items/compass.json": itemModel("item/compass_16"),
	"items/splash_potion.json": itemModel("item/splash_potion", [{ type: "minecraft:potion", default: -13083194 }]),
	"items/oak_planks.json": itemModel("block/oak_planks"),
};
const MODELS: Record<string, { textures?: Record<string, string>; elements?: unknown[] }> = {
	"item/diamond": { textures: { layer0: "minecraft:item/diamond" } },
	"item/snowball": { textures: { layer0: "minecraft:item/snowball" } },
	"item/compass_16": { textures: { layer0: "minecraft:item/compass_16" } },
	"item/splash_potion": {
		textures: { layer0: "minecraft:item/potion_overlay", layer1: "minecraft:item/splash_potion" },
	},
	"block/oak_planks": { elements: [{}] },
};
const TEXELS: Record<string, Pixels> = {
	"item/diamond": opaque(2, 2),
	"item/snowball": opaque(2, 2),
	"item/compass_16": opaque(2, 2),
	"item/potion_overlay": opaque(2, 2),
	"item/splash_potion": opaque(2, 2),
	"painting/kebab": opaque(16, 16),
	"painting/back": opaque(16, 16),
	"entity/experience/experience_orb": opaque(64, 64),
	"entity/fishing/fishing_hook": opaque(8, 8),
	"entity/enderdragon/dragon_fireball": opaque(16, 16),
};
const assets: EntityAssets = {
	getResourceString: async (path) =>
		path in DEFINITIONS ? JSON.stringify(DEFINITIONS[path]) : undefined,
	getModel: async (path) => MODELS[path.replace("minecraft:", "")] ?? {},
	pixels: async (path) => TEXELS[path] ?? null,
};

async function build(records: ReturnType<typeof entity>[], withAssets = false) {
	const manager = new EntityManager(
		new THREE.Group(),
		"t",
		{ get_entities: () => records },
		loadModel,
		() => {},
		hasModel,
		loadBlock,
		withAssets ? assets : undefined
	);
	await manager.rebuild();
	// Roots join in the order their models finish loading, so look them up by record.
	const rootOf = (index: number) =>
		manager.group.children.find((node) => node.userData.entity === manager.records[index]) as THREE.Group;
	return { manager, rootOf };
}
/** The prop itself: an entity root holds one holder, which holds the prop. */
const prop = (root: THREE.Object3D) => root.children[0].children[0] as THREE.Group;
const named = (root: THREE.Object3D, name: string) => root.getObjectByName(name) as THREE.Object3D;

describe("entity plans drawn by the manager", () => {
	it("scales the whole model about the feet and leaves the feet where they were", async () => {
		const { manager, rootOf } = await build([entity("giant"), entity("zombie")]);
		expect(rootOf(0).children[0].scale.x).toBe(6);
		expect(rootOf(1).children[0].scale.x).toBe(1);
		expect(rootOf(0).position.toArray()).toEqual([0, 0.5, 0]);
		manager.dispose();
	});
	it("hides unused tack until the entity is saddled", async () => {
		const { manager, rootOf } = await build([
			entity("horse"),
			entity("horse", { equipment: { saddle: { id: "minecraft:saddle" } } }),
		]);
		expect(named(rootOf(0), "saddle").visible).toBe(false);
		expect(named(rootOf(0), "left_rein").visible).toBe(false);
		expect(named(rootOf(0), "head").visible).toBe(true);
		expect(named(rootOf(1), "saddle").visible).toBe(true);
		manager.dispose();
	});
	it("stacks overlay layers with their own tint and blending, without touching shared materials", async () => {
		const { manager, rootOf } = await build([entity("sheep", { Color: 14 }), entity("slime")]);
		const [skin, wool] = rootOf(0).children[0].children;
		expect(skin).toBeDefined();
		const woolMaterial = (wool.getObjectByName("body") as THREE.Object3D).children[0] as THREE.Mesh;
		expect((woolMaterial.material as THREE.MeshStandardMaterial).color.r).toBeCloseTo(0xb0 / 255, 5);
		expect(material("sheep_wool").color.r).toBe(1);
		const shell = rootOf(1).children[0].children[1].getObjectByName("cube") as THREE.Object3D;
		const blended = (shell.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
		expect(blended.transparent).toBe(true);
		expect(blended.alphaTest).toBe(0);
		expect(blended.depthWrite).toBe(false);
		expect(material("slime_outer").transparent).toBe(false);
		manager.dispose();
	});
	it("shows a block where the game draws it", async () => {
		requested.length = 0;
		const { manager, rootOf } = await build([
			entity("tnt", { block_state: { Name: "minecraft:tnt" } }),
			entity("block_display", {
				block_state: { Name: "minecraft:stone" },
				transformation: { translation: [1, 2, 3], scale: [2, 2, 2] },
			}),
			entity("block_display"),
		]);
		expect(named(rootOf(0), "block:minecraft:tnt").position.toArray()).toEqual([0, 0.5, 0]);
		expect(rootOf(0).rotation.y).toBe(0);
		const display = prop(rootOf(1));
		expect(display.position.toArray()).toEqual([1, 2, 3]);
		expect(named(rootOf(1), "block:minecraft:stone").position.toArray()).toEqual([0.5, 0.5, 0.5]);
		expect(manager.records.map((record) => record.status)).toEqual(["model", "model", "invisible"]);
		expect(requested).toEqual(["minecraft:tnt", "minecraft:stone"]);
		manager.dispose();
	});
	it("puts a minecart's contents above its floor, at three quarters of a block", async () => {
		requested.length = 0;
		const { manager, rootOf } = await build([entity("chest_minecart"), entity("minecart")]);
		const cargo = named(rootOf(0), "block:minecraft:chest[facing=north]");
		expect(cargo.scale.x).toBe(0.75);
		expect(cargo.position.y).toBeCloseTo(0.65625, 5);
		expect(requested).toEqual(["minecraft:chest[facing=north]"]);
		expect(rootOf(1).getObjectByName("block:minecraft:chest[facing=north]")).toBeUndefined();
		manager.dispose();
	});
	it("marks where the game draws nothing, and where a mob has no geometry yet", async () => {
		const { manager, rootOf } = await build([entity("marker"), entity("nautilus"), entity("parched")]);
		expect(manager.records.map((record) => record.status)).toEqual(["debug", "placeholder", "placeholder"]);
		expect(manager.records[0].note).toBeDefined();
		expect(manager.records[1].note).toContain("entity-models/nautilus.json");
		expect(manager.group.children).toHaveLength(3);
		const standIn = rootOf(1).children[0].children[0] as THREE.Mesh;
		const fill = standIn.material as THREE.MeshBasicMaterial;
		manager.setOpacity(0.5);
		expect(fill.opacity).toBeCloseTo(0.15, 5);
		let disposed = 0;
		standIn.geometry.addEventListener("dispose", () => disposed++);
		manager.dispose();
		expect(disposed).toBe(1);
	});
});

const meshesOf = (root: THREE.Object3D) => {
	const meshes: THREE.Mesh[] = [];
	root.traverse((node) => {
		if (node instanceof THREE.Mesh) meshes.push(node);
	});
	return meshes;
};
const vertexCount = (mesh: THREE.Mesh) => (mesh.geometry.attributes.position as { count: number }).count;
const plainRender = THREE.Mesh.prototype.onBeforeRender;

describe("items, frames, paintings, sprites and debug shapes", () => {
	it("draws a dropped item as a slab of its texture, resting on its feet", async () => {
		const { manager, rootOf } = await build([entity("item", { Item: { id: "minecraft:diamond" } })], true);
		expect(manager.records[0].status).toBe("model");
		const card = prop(rootOf(0));
		expect(card.position.y).toBe(0.25);
		const [mesh] = meshesOf(card);
		expect(meshesOf(card)).toHaveLength(1);
		// Two faces and the eight sides of a 2x2 block of opaque texels.
		expect(vertexCount(mesh)).toBe((2 + 8) * 4);
		expect((mesh.material as THREE.MeshBasicMaterial).map?.magFilter).toBe(THREE.NearestFilter);
		manager.dispose();
	});
	it("layers a potion, tinting the liquid and not the bottle", async () => {
		const { manager, rootOf } = await build([entity("splash_potion")], true);
		const [liquid, bottle] = meshesOf(rootOf(0));
		expect((liquid.material as THREE.MeshBasicMaterial).color.r).toBeCloseTo(0x38 / 255, 5);
		expect((bottle.material as THREE.MeshBasicMaterial).color.r).toBe(1);
		// Only the first layer has a rim.
		expect(vertexCount(liquid)).toBeGreaterThan(vertexCount(bottle));
		expect(vertexCount(bottle)).toBe(8);
		manager.dispose();
	});
	it("turns thrown items to the camera and leaves dropped items and displays alone", async () => {
		const { manager, rootOf } = await build(
			[
				entity("snowball"),
				entity("item", { Item: { id: "minecraft:diamond" } }),
				entity("item_display", { item: { id: "minecraft:diamond" } }),
				entity("experience_orb", { Value: 5 }),
			],
			true
		);
		expect(meshesOf(rootOf(0))[0].onBeforeRender).not.toBe(plainRender);
		expect(meshesOf(rootOf(1))[0].onBeforeRender).toBe(plainRender);
		expect(meshesOf(rootOf(2))[0].onBeforeRender).toBe(plainRender);
		expect(meshesOf(rootOf(3))[0].onBeforeRender).not.toBe(plainRender);
		expect(rootOf(0).rotation.y).toBe(0);
		manager.dispose();
	});
	it("shows an item display centred, a block item at full size, and turns a display with its yaw", async () => {
		requested.length = 0;
		const { manager, rootOf } = await build(
			[
				entity("item_display", { item: { id: "minecraft:diamond" } }),
				entity("item_display", { item: { id: "minecraft:oak_planks" } }),
				{ ...entity("item_display", { item: { id: "minecraft:diamond" } }), nbt: { item: { id: "minecraft:diamond" }, Rotation: [90, 0] } },
			],
			true
		);
		expect(prop(rootOf(0)).rotation.y).toBe(Math.PI);
		expect(requested).toEqual(["minecraft:oak_planks"]);
		expect(named(rootOf(1), "block:minecraft:oak_planks").scale.x).toBe(1);
		expect(rootOf(2).rotation.y).toBeCloseTo(-Math.PI / 2, 5);
		manager.dispose();
	});
	it("hangs a frame 0.46875 in front of its wall with the item against the back plate", async () => {
		requested.length = 0;
		const { manager, rootOf } = await build(
			[
				entity("item_frame", { Facing: 3, Item: { id: "minecraft:compass" }, ItemRotation: 2 }),
				entity("glow_item_frame", { Facing: 1, Invisible: 1, Item: { id: "minecraft:compass" } }),
			],
			true
		);
		const south = prop(rootOf(0));
		expect(south.position.toArray()).toEqual([0, 0, 0.46875]);
		expect(south.rotation.y).toBeCloseTo(Math.PI, 5);
		expect(named(rootOf(0), "block:minecraft:item_frame[map=false]")).toBeDefined();
		const slot = south.children[1];
		expect(slot.position.z).toBe(0.4375);
		expect(slot.rotation.z).toBeCloseTo(Math.PI / 2, 5);
		expect(slot.children[0].rotation.y).toBe(Math.PI);
		expect(slot.children[0].children[0] === undefined).toBe(false);
		const up = prop(rootOf(1));
		expect(up.position.toArray()).toEqual([0, 0.46875, 0]);
		expect(up.rotation.x).toBeCloseTo(-Math.PI / 2, 5);
		expect(requested).toEqual(["minecraft:item_frame[map=false]"]); // the invisible one has no frame
		manager.dispose();
	});
	it("faces a painting the way it hangs, at sixteen texels to the block", async () => {
		const { manager, rootOf } = await build(
			[entity("painting", { variant: "minecraft:kebab", facing: 3 }), entity("painting", { facing: 0 })],
			true
		);
		const east = prop(rootOf(0));
		// Built facing +Z; turned so +Z points east, then south for facing 0.
		expect(Math.sin(east.rotation.y)).toBeCloseTo(1, 5);
		expect(Math.cos(east.rotation.y)).toBeCloseTo(0, 5);
		expect(Math.sin(prop(rootOf(1)).rotation.y)).toBeCloseTo(0, 5);
		const [slab, face] = meshesOf(rootOf(0));
		expect(face.position.z).toBeCloseTo(1 / 32 + 0.001, 6);
		expect(slab).toBeDefined();
		manager.dispose();
	});
	it("cuts an orb's icon from its sheet and rests every sprite on the ground", async () => {
		const { manager, rootOf } = await build(
			[entity("experience_orb", { Value: 5 }), entity("dragon_fireball"), entity("fishing_bobber")],
			true
		);
		const orb = meshesOf(rootOf(0))[0];
		const uv = (orb.geometry.attributes.uv as unknown as { array: ArrayLike<number> }).array;
		expect(Array.from(uv).filter((_, i) => i % 2 === 0).sort()).toEqual([0.25, 0.25, 0.5, 0.5]);
		expect(prop(rootOf(0)).position.y).toBeCloseTo(0.15, 6);
		expect(prop(rootOf(1)).position.y).toBe(1);
		expect(prop(rootOf(2)).position.y).toBe(0.25);
		manager.dispose();
	});
	it("builds debug shapes from the entity's own size", async () => {
		const { manager, rootOf } = await build([
			entity("interaction", { width: 0.5, height: 2 }),
			entity("marker"),
			entity("area_effect_cloud", { Radius: 4 }),
			entity("lightning_bolt"),
			entity("ominous_item_spawner"),
		]);
		expect(manager.records.every((record) => record.status === "debug")).toBe(true);
		const hitbox = meshesOf(rootOf(0))[0];
		expect(hitbox.position.y).toBe(1);
		expect(meshesOf(rootOf(1))).toHaveLength(4);
		expect(meshesOf(rootOf(3))).toHaveLength(16);
		expect(meshesOf(rootOf(2))[0].rotation.x).toBeCloseTo(-Math.PI / 2, 5);
		manager.dispose();
	});
	it("hides debug shapes on request without touching anything else", async () => {
		const { manager, rootOf } = await build([entity("marker"), entity("horse")]);
		manager.setShowDebug(false);
		expect(rootOf(0).visible).toBe(false);
		expect(rootOf(1).visible).toBe(true);
		manager.setShowDebug(true);
		expect(rootOf(0).visible).toBe(true);
		manager.dispose();
	});
	it("owns what it made: opacity reaches sprites, and textures and geometry are freed", async () => {
		const { manager, rootOf } = await build([entity("snowball")], true);
		const mesh = meshesOf(rootOf(0))[0];
		const material = mesh.material as THREE.MeshBasicMaterial;
		manager.setOpacity(0.5);
		expect(material.opacity).toBe(0.5);
		expect(material.transparent).toBe(true);
		let freed = 0;
		material.map?.addEventListener("dispose", () => freed++);
		mesh.geometry.addEventListener("dispose", () => freed++);
		manager.dispose();
		expect(freed).toBe(2);
	});
	it("reads nothing from a pack it was not given", async () => {
		const { manager } = await build([entity("snowball"), entity("painting")]);
		expect(manager.records.map((record) => record.status)).toEqual(["failed", "failed"]);
		expect(manager.group.children).toHaveLength(0);
		manager.dispose();
	});
});

describe("text displays", () => {
	function surface() {
		const calls: { fill?: string; texts: [string, number, number][] } = { texts: [] };
		const context = {
			font: "",
			fillStyle: "",
			textBaseline: "",
			measureText: (line: string) => ({ width: line.length * 24 }), // 6 text pixels a character at 4x
			fillRect: () => {
				calls.fill = context.fillStyle;
			},
			fillText: (line: string, x: number, y: number) => calls.texts.push([line, x, y]),
		};
		const make = (width: number, height: number) =>
			({ canvas: { width, height } as unknown as HTMLCanvasElement, ctx: context as unknown as CanvasRenderingContext2D });
		return { calls, make };
	}
	const text = (nbt: Record<string, unknown> = {}) => ({
		kind: "text" as const,
		text: "text_display",
		lineWidth: 200,
		background: 0x40000000,
		alignment: "center" as const,
		...nbt,
	});
	it("sizes the plane to the text at 0.025 blocks a pixel", async () => {
		const { calls, make } = surface();
		const built = await new PropBuilder(undefined, undefined, make).build(text());
		const mesh = meshesOf(built!.object)[0];
		const positions = mesh.geometry.attributes.position as unknown as { array: ArrayLike<number> };
		const xs = Array.from(positions.array).filter((_, i) => i % 3 === 0);
		// 12 characters of 6 pixels, one pixel of margin on each side.
		expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(74 * 0.025, 5);
		expect(calls.texts.map(([line]) => line)).toEqual(["text_display"]);
		expect(calls.fill).toBe("rgba(0,0,0,0.25098039215686274)");
		expect((mesh.material as THREE.MeshBasicMaterial).transparent).toBe(true);
	});
	it("wraps at the line width and aligns each line", async () => {
		const { calls, make } = surface();
		await new PropBuilder(undefined, undefined, make).build(text({ text: "aaaa bbbbbbbb", lineWidth: 50, alignment: "right" }));
		expect(calls.texts.map(([line]) => line)).toEqual(["aaaa", "bbbbbbbb"]);
		// Right-aligned, the shorter line starts 24 text pixels (the width difference) further in.
		expect(calls.texts[0][1] - calls.texts[1][1]).toBe(24 * 4);
	});
	it("draws nothing where there is no drawing surface", async () => {
		expect(await new PropBuilder(undefined, undefined, () => null).build(text())).toBeNull();
	});
});
