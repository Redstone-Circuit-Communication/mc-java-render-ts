import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { SignRenderer } from "../SignRenderer";
import type { AssetLoader } from "../AssetLoader";

const images = new WeakMap<object, ImageData>();
function pixels(width: number, height: number, value = 180): ImageData {
	const data = new Uint8ClampedArray(width * height * 4).fill(value);
	for (let i = 3; i < data.length; i += 4) data[i] = 255;
	return { width, height, data, colorSpace: "srgb" } as ImageData;
}
function fixture(missingBoard = false) {
	const getTexturePixels = vi.fn(async (path: string) =>
		path === "font/ascii" ? pixels(128, 128, 255) : missingBoard ? null : pixels(64, 32)
	);
	const renderer = new SignRenderer({ getTexturePixels } as unknown as AssetLoader);
	return { renderer, getTexturePixels };
}
async function sign(renderer: SignRenderer, name: string, props: Record<string, string>, nbt = {}) {
	const group = await renderer.buildSignMesh(`minecraft:${name}`, props, nbt);
	expect(group).not.toBeNull();
	return group!.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
}
function frontNormal(mesh: THREE.Mesh) {
	return new THREE.Vector3().fromBufferAttribute(mesh.geometry.getAttribute("normal"), 8);
}
function image(mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>) {
	return images.get(mesh.material.map!.image as object)!;
}
function inkCount(img: ImageData, x: number, y: number, w: number, h: number) {
	let count = 0;
	for (let py = y; py < y + h; py++)
		for (let px = x; px < x + w; px++) {
			if (img.data[(py * img.width + px) * 4] !== 180) count++;
		}
	return count;
}

beforeEach(() => {
	vi.stubGlobal(
		"ImageData",
		class {
			constructor(
				public data: Uint8ClampedArray,
				public width: number,
				public height: number
			) {}
		}
	);
	vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
		this: HTMLCanvasElement
	) {
		return {
			putImageData: (data: ImageData) => images.set(this, data),
			drawImage: () => {},
			getImageData: () => pixels(this.width, this.height),
		} as unknown as CanvasRenderingContext2D;
	} as unknown as typeof HTMLCanvasElement.prototype.getContext);
});
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("sign geometry and NBT text", () => {
	it.each([
		["north", 0, 0.4375, 0, -1],
		["south", 0, -0.4375, 0, 1],
		["east", -0.4375, 0, 1, 0],
		["west", 0.4375, 0, -1, 0],
	] as const)("mounts %s signs against their supporting block", async (facing, x, z, nx, nz) => {
		const mesh = await sign(fixture().renderer, "oak_wall_sign", { facing });
		mesh.geometry.computeBoundingBox();
		const center = mesh.geometry.boundingBox!.getCenter(new THREE.Vector3());
		expect(center.x).toBeCloseTo(x);
		expect(center.z).toBeCloseTo(z);
		expect(center.y).toBeCloseTo(1 / 48);
		const normal = frontNormal(mesh);
		expect(normal.x).toBeCloseTo(nx);
		expect(normal.z).toBeCloseTo(nz);
		expect(mesh.geometry.boundingBox!.min.y).toBeCloseTo(-11 / 48);
		expect(mesh.geometry.boundingBox!.max.y).toBeCloseTo(13 / 48);
	});
	it.each(Array.from({ length: 16 }, (_, i) => i))(
		"preserves standing rotation %i and block origin",
		async (rotation) => {
			const mesh = await sign(fixture().renderer, "oak_sign", { rotation: String(rotation) });
			const n = frontNormal(mesh),
				a = (-rotation * Math.PI) / 8;
			expect(n.x).toBeCloseTo(Math.sin(a));
			expect(n.z).toBeCloseTo(Math.cos(a));
			mesh.geometry.computeBoundingBox();
			expect(mesh.geometry.boundingBox!.min.y).toBeCloseTo(-0.5);
		}
	);
	it("decodes Nucleation tagged NBT and keeps empty rows and blank back", async () => {
		const mesh = await sign(
			fixture().renderer,
			"spruce_wall_sign",
			{ facing: "east" },
			{
				front_text: {
					Compound: {
						messages: {
							List: [{ String: "" }, { String: "brook" }, { String: "" }, { String: "" }],
						},
						color: { String: "black" },
						has_glowing_text: { Byte: 0 },
					},
				},
				back_text: {
					Compound: {
						messages: { List: [{ String: "" }, { String: "" }, { String: "" }, { String: "" }] },
					},
				},
			}
		);
		const img = image(mesh);
		expect(inkCount(img, 8, 8, 96, 12)).toBe(0);
		expect(inkCount(img, 8, 20, 96, 12)).toBeGreaterThan(0);
		expect(inkCount(img, 8, 32, 96, 24)).toBe(0);
		expect(inkCount(img, 112, 8, 96, 48)).toBe(0);
	});
	it("renders independent front/back content and includes back text in the cache key", async () => {
		const { renderer } = fixture();
		const front_text = { messages: ['{"text":"A","extra":[{"text":"B"}]}', "", "", ""] };
		const first = await sign(renderer, "oak_sign", {}, { front_text });
		const second = await sign(
			renderer,
			"oak_sign",
			{},
			{ front_text, back_text: { messages: ["", "", "", "BACK"] } }
		);
		expect(first.material.map).not.toBe(second.material.map);
		expect(inkCount(image(first), 112, 8, 96, 48)).toBe(0);
		expect(inkCount(image(second), 112, 44, 96, 12)).toBeGreaterThan(0);
	});
	it("accepts legacy Text1-4", async () => {
		const mesh = await sign(
			fixture().renderer,
			"oak_sign",
			{},
			{ Text1: '{"text":"Legacy"}', Text2: '""' }
		);
		expect(inkCount(image(mesh), 8, 8, 96, 12)).toBeGreaterThan(0);
	});
	it("uses the bundled texture when an incomplete resource pack omits entity signs", async () => {
		const close = vi.fn();
		const decode = vi.fn(async () => ({ width: 64, height: 32, close }));
		vi.stubGlobal("createImageBitmap", decode);
		const { renderer, getTexturePixels } = fixture(true);
		const mesh = await sign(
			renderer,
			"spruce_wall_sign",
			{ facing: "east" },
			{ front_text: { messages: ["brook", "", "", ""] } }
		);
		expect(getTexturePixels).toHaveBeenCalledWith("entity/signs/spruce");
		expect(decode).toHaveBeenCalledOnce();
		expect(close).toHaveBeenCalledOnce();
		expect(inkCount(image(mesh), 8, 8, 96, 12)).toBeGreaterThan(0);
		expect(frontNormal(mesh).x).toBeCloseTo(1);
	});
});
