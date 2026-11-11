import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { Schematic } from "nucleation";
import { EntityManager } from "./EntityManager";

// Decode the real bundled geometry; only image decoding needs a browser.
const loader = new GLTFLoader().register(() => ({
	name: "test-textures",
	loadTexture: async () => new THREE.Texture(),
}));
const templates = new Map<string, THREE.Object3D>();
async function load(model: string) {
	if (!templates.has(model)) {
		const path = `src/renderer/cubane/entity-models/${model}.json`;
		const data = Uint8Array.from(Buffer.from(JSON.parse(readFileSync(path, "utf8")), "base64"));
		const { scene } = await loader.parseAsync(data.buffer, "");
		const group = new THREE.Group();
		scene.position.y = -0.5;
		group.add(scene);
		templates.set(model, group);
	}
	const template = templates.get(model);
	if (!template) throw new Error(`Missing template for ${model}`);
	return template.clone();
}
const source = (filename: string) => {
	const schematic = Schematic.fromData(
		Array.from(readFileSync(`example/public/schematics/${filename}`))
	);
	return {
		get_entities: () => JSON.parse(schematic.getEntitiesJson()),
		getEntitiesSnbt: () => JSON.parse(schematic.getEntitiesSnbtJson()),
	};
};

describe("actual schematic entities and bundled GLBs", () => {
	beforeAll(async () => {
		await load("zombie");
	});
	it("loads all five entities in five-entities.litematic, the raft through its alias", async () => {
		const parent = new THREE.Group();
		const manager = new EntityManager(
			parent,
			"b",
			source("five-entities.litematic"),
			load,
			() => {}
		);
		await manager.rebuild();
		expect(manager.records).toHaveLength(5);
		expect(manager.records.filter((record) => record.status === "model")).toHaveLength(5);
		const allay = manager.group.children.find((node) => node.name === "minecraft:allay");
		if (!allay) throw new Error("Missing allay model");
		expect(new THREE.Box3().setFromObject(allay).min.y).toBeCloseTo(0.5);
		manager.dispose();
	});
	it("keeps fractional feet positions, four yaw directions and head pivots", async () => {
		const manager = new EntityManager(
			new THREE.Group(),
			"demo",
			source("entities-demo.litematic"),
			load,
			() => {}
		);
		await manager.rebuild();
		expect(manager.records).toHaveLength(15);
		// Everything but the marker, which the game does not draw and gets a debug shape instead.
		expect(manager.records.filter((record) => record.status === "model")).toHaveLength(14);
		expect(manager.records.filter((record) => record.status === "debug")).toHaveLength(1);
		for (const node of manager.group.children.filter((node) => node.name === "minecraft:zombie")) {
			const record = node.userData.entity;
			const bounds = new THREE.Box3().setFromObject(node);
			expect(bounds.min.y).toBeCloseTo(record.position[1] - 0.5);
			const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(node.quaternion);
			const yaw = THREE.MathUtils.degToRad(record.rotation[0]);
			expect(forward.x).toBeCloseTo(-Math.sin(yaw));
			expect(forward.z).toBeCloseTo(Math.cos(yaw));
			const head = node.getObjectByName("head");
			if (!head) throw new Error("Missing head pivot");
			expect(head.rotation.x).toBeCloseTo(-THREE.MathUtils.degToRad(record.rotation[1]));
		}
		const cart = manager.group.children.find((node) => node.name === "minecraft:minecart");
		if (!cart) throw new Error("Missing minecart model");
		expect(new THREE.Box3().setFromObject(cart).min.y).toBeCloseTo(
			cart.userData.entity.position[1] - 0.5 + 1 / 16
		);
		const count = manager.group.children.length;
		await manager.rebuild();
		expect(manager.group.children).toHaveLength(count);
		manager.dispose();
	});
});
