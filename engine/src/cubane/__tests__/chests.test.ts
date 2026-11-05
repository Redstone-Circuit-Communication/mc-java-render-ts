import { afterEach, describe, expect, it } from "vitest";
import { Box3, Texture, Vector3 } from "three";
import type { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { Cubane } from "../Cubane";

const instances: Cubane[] = [];
function fixture() {
	const cubane = new Cubane({ autoRestore: false });
	instances.push(cubane);
	// Parse the real bundled GLB geometry; only image decoding needs a DOM stub.
	const loader: GLTFLoader = Reflect.get(Reflect.get(cubane, "entityRenderer"), "loader");
	loader.register(() => ({ name: "test-textures", loadTexture: async () => new Texture() }));
	return cubane;
}
afterEach(() => {
	for (const cubane of instances.splice(0)) cubane.dispose();
});

describe("closed chest block geometry", () => {
	for (const id of ["chest", "trapped_chest"]) {
		it.each([
			["north", 1, 0],
			["east", 0, 1],
			["south", -1, 0],
			["west", 0, -1],
		] as const)(`${id} halves meet with one centered latch facing %s`, async (facing, dx, dz) => {
			const cubane = fixture();
			const left = await cubane.getBlockMesh(`minecraft:${id}[facing=${facing},type=left]`);
			const right = await cubane.getBlockMesh(`minecraft:${id}[facing=${facing},type=right]`);
			right.position.set(dx, 0, dz);
			const a = new Box3().setFromObject(left),
				b = new Box3().setFromObject(right);
			const axis = dx ? "x" : "z";
			expect(Math.max(a.min[axis], b.min[axis])).toBeCloseTo(Math.min(a.max[axis], b.max[axis]));
			const union = a.clone().union(b);
			expect(union.getSize(new Vector3())[axis]).toBeCloseTo(30 / 16);
			expect(union.getCenter(new Vector3())[axis]).toBeCloseTo((dx || dz) / 2);
			expect(left.rotation.y).toBe(0); // Root stays at identity for palette extraction.
			const latchA = left.getObjectByName("knob");
			const latchB = right.getObjectByName("knob");
			expect(latchA).toBeDefined();
			expect(latchB).toBeDefined();
			const latch = new Box3().setFromObject(latchA!).union(new Box3().setFromObject(latchB!));
			expect(latch.getSize(new Vector3())[axis]).toBeCloseTo(2 / 16);
			expect(latch.getCenter(new Vector3())[axis]).toBeCloseTo((dx || dz) / 2);
			// Retrieving and moving a clone never corrupts another state or cache entry.
			const again = await cubane.getBlockMesh(`minecraft:${id}[facing=${facing},type=left]`);
			expect(new Box3().setFromObject(again).equals(a)).toBe(true);
			const single = await cubane.getBlockMesh(`minecraft:${id}[facing=${facing},type=single]`);
			expect(new Box3().setFromObject(single).getSize(new Vector3())[axis]).toBeCloseTo(14 / 16);
		});
	}
});
