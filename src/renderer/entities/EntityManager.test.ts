import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { Group } from "three";
import { EntityManager } from "./EntityManager";
import { normalizeEntities } from "./normalize";
import { resolveEntityModel } from "./MobRegistry";
import { entityModelLoaders } from "../cubane/entity-models";

/** The real bundled catalog, without touching the filesystem. */
const bundled = (model: string) => Object.prototype.hasOwnProperty.call(entityModelLoaders, model);

function entity(id = "minecraft:zombie", position = [1.5, 1, -3.5], nbt = {}) {
	return { id, position, nbt };
}
function fixture(records = [entity()], hasModel?: (model: string) => boolean) {
	const parent = new THREE.Group();
	const geometry = new THREE.BoxGeometry(0.5, 2, 0.5).translate(0, 1, 0);
	const material = new THREE.MeshStandardMaterial();
	const template = new THREE.Group();
	const body = new THREE.Group();
	body.position.y = -0.5;
	body.add(new THREE.Mesh(geometry, material));
	const head = new THREE.Group();
	head.name = "head";
	head.position.y = 1.5;
	body.add(head);
	template.add(body);
	const load = vi.fn(async () => template.clone());
	const source = { get_entities: () => records };
	const manager = new EntityManager(parent, "test", source, load, vi.fn(), hasModel);
	return { parent, geometry, material, template, load, source, manager };
}

describe("entity snapshots", () => {
	it("unwraps typed NBT, retains fractional coordinates and unique keys at the same position", () => {
		const raw = entity("minecraft:zombie", [-3.25, 1.5, 9.75], {
			Rotation: { List: [{ Float: 90 }, { Float: 15 }] },
			UUID: { IntArray: [1, 2, 3, 4] },
			IsBaby: { Byte: 1 },
		});
		const records = normalizeEntities([raw, raw, { ...raw, position: [NaN, 0, 0] }], "s", [
			"original",
		]);
		expect(records).toHaveLength(2);
		expect(records[0].position).toEqual([-3.25, 1.5, 9.75]);
		expect(records[0].rotation).toEqual([90, 15]);
		expect(records[0].snbt).toBe("original");
		expect(records[0].rawNbt).toBe(raw.nbt);
		expect(records[0].key).not.toBe(records[1].key);
		expect(resolveEntityModel(records[0])).toBe("zombie");
	});
	it("maps every vanilla id to the model of the same name, ignoring NBT", () => {
		const [raft, boat, baby, modded] = normalizeEntities(
			[
				entity("minecraft:bamboo_raft"),
				entity("minecraft:boat", [0, 0, 0], { Type: "bamboo" }),
				entity("minecraft:pig", [0, 0, 0], { Age: -100 }),
				entity("mod:zombie"),
			],
			"s"
		);
		expect(resolveEntityModel(raft)).toBe("bamboo_raft");
		expect(resolveEntityModel(boat)).toBe("boat");
		expect(resolveEntityModel(baby)).toBe("pig");
		expect(resolveEntityModel(modded)).toBeUndefined();
	});
	it("resolves ids only when the catalog ships a same-named model", () => {
		const [wolf, item, dragon] = normalizeEntities(
			[entity("minecraft:wolf"), entity("minecraft:item"), entity("minecraft:ender_dragon")],
			"s"
		);
		expect(resolveEntityModel(wolf, bundled)).toBe("wolf");
		expect(resolveEntityModel(item, bundled)).toBeUndefined();
		expect(resolveEntityModel(dragon, bundled)).toBeUndefined();
	});
	it("renders same-named models and adds nothing for the rest", async () => {
		const { manager, load } = fixture(
			[entity("minecraft:wolf"), entity("minecraft:item")],
			bundled
		);
		await manager.rebuild();
		expect(manager.records.map((record) => record.status)).toEqual(["model", "unsupported"]);
		expect(load).toHaveBeenCalledWith("wolf");
		expect(manager.group.children.map((node) => node.name)).toEqual(["minecraft:wolf"]);
		manager.dispose();
	});
	it("places feet on centered blocks, rotates head independently, and isolates materials", async () => {
		const { manager, parent, material } = fixture([
			entity("minecraft:zombie", [1.5, 1, -3.5], { Rotation: [90, 30] }),
			entity(),
		]);
		await manager.rebuild();
		const first = manager.group.children[0];
		expect(first.position.toArray()).toEqual([1, 0.5, -4]);
		expect(first.rotation.y).toBeCloseTo(Math.PI / 2);
		expect(first.rotation.x).toBe(0);
		expect(first.getObjectByName("head")?.rotation.x).toBeCloseTo(-Math.PI / 6);
		expect(new THREE.Box3().setFromObject(first).min.y).toBeCloseTo(0.5);
		manager.setOpacity(0.4);
		expect(material.opacity).toBe(1);
		parent.position.set(3, 5, 7);
		expect(new THREE.Box3().setFromObject(parent).min.y).toBeCloseTo(5.5);
		manager.dispose();
	});
	it("never disposes shared GLB geometry/materials and ignores a late load after removal", async () => {
		const { manager, parent, geometry, material, load, template } = fixture();
		const sharedGeometry = vi.spyOn(geometry, "dispose");
		const sharedMaterial = vi.spyOn(material, "dispose");
		await manager.rebuild();
		let owned: THREE.Material | undefined;
		manager.group.traverse((node) => {
			if (node instanceof THREE.Mesh) owned = node.material as THREE.Material;
		});
		if (!owned) throw new Error("Expected an owned material on the rebuilt group");
		const ownedDisposal = vi.spyOn(owned, "dispose");
		let resolve!: (value: PromiseLike<Group> | Group) => void;
		load.mockImplementation(
			() =>
				new Promise((done) => {
					resolve = done;
				})
		);
		const pending = manager.rebuild();
		expect(ownedDisposal).toHaveBeenCalledOnce();
		manager.dispose();
		resolve(template.clone());
		await pending;
		expect(parent.children).toHaveLength(0);
		expect(manager.group.children).toHaveLength(0);
		expect(sharedGeometry).not.toHaveBeenCalled();
		expect(sharedMaterial).not.toHaveBeenCalled();
	});
	it("records unsupported and failed entities without adding anything to the scene", async () => {
		const { manager, load } = fixture([
			entity("mod:unknown"),
			entity("minecraft:allay", [4, 1, 1]),
		]);
		load.mockRejectedValue(new Error("missing model"));
		await manager.rebuild();
		expect(manager.records.map((r) => r.status)).toEqual(["unsupported", "failed"]);
		expect(manager.group.children).toHaveLength(0);
		manager.dispose();
	});
	it("applies slice bounds and survives rebuild", async () => {
		const { manager } = fixture([
			entity("minecraft:zombie", [1, 1, 1]),
			entity("minecraft:allay", [4, 1, 1]),
		]);
		await manager.rebuild();
		manager.setBounds({
			enabled: true,
			min: new THREE.Vector3(0, 0, -10),
			max: new THREE.Vector3(3, 3, 3),
		});
		expect(manager.group.children.map((n) => n.visible)).toEqual([true, false]);
		manager.setVisible(false);
		await manager.rebuild();
		expect(manager.group.visible).toBe(false);
		expect(manager.group.children).toHaveLength(2);
		manager.dispose();
	});
});
