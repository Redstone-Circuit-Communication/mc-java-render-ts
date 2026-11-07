import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { AssetLoader } from "../AssetLoader";

describe("missing block textures", () => {
	it("never substitutes a different atlas entry with the same basename", async () => {
		const loader = new AssetLoader(false);
		const atlas = new THREE.Texture();
		Object.assign(loader, { textureAtlas: atlas });
		vi.spyOn(loader, "getResourceString").mockResolvedValue(undefined);
		vi.spyOn(loader, "getResourceBlob").mockResolvedValue(undefined);
		vi.spyOn(loader, "getTextureUV").mockImplementation((path) =>
			path === "block/stone" ? { u: 0, v: 0, width: 1, height: 1 } : null
		);
		const material = (await loader.getMaterial("block/custom/stone")) as THREE.MeshStandardMaterial;
		expect(material.userData.useAtlas).toBe(false);
		expect(material.map?.userData.isMissingTexture).toBe(true);
		expect(await loader.getTexture("block/missing_texture")).toBe(material.map);
		loader.dispose();
	});
});
