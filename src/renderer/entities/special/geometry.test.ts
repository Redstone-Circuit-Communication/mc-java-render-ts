import { describe, expect, it } from "vitest";
import { extrudeSprite, firstFrame, spriteQuad, wrapLines, type Pixels } from "./geometry";

/** A width x height sprite whose texel (x, y) is opaque when `solid(x, y)`. */
function sprite(width: number, height: number, solid: (x: number, y: number) => boolean): Pixels {
	const data = new Uint8ClampedArray(width * height * 4);
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) data[(y * width + x) * 4 + 3] = solid(x, y) ? 255 : 0;
	return { data, width, height };
}
const bounds = (positions: Float32Array, axis: number) => {
	const values = Array.from({ length: positions.length / 3 }, (_, i) => positions[i * 3 + axis]);
	return [Math.min(...values), Math.max(...values)];
};

describe("extruded sprites", () => {
	it("gives a fully opaque sprite two faces and a rim", () => {
		const mesh = extrudeSprite(sprite(2, 2, () => true));
		// 2 faces + one edge for every texel side on the outline: 8.
		expect(mesh.positions.length / 3).toBe((2 + 8) * 4);
		expect(mesh.indices.length).toBe((2 + 8) * 6);
		expect(bounds(mesh.positions, 0)).toEqual([-0.5, 0.5]);
		expect(bounds(mesh.positions, 2)).toEqual([-1 / 32, 1 / 32]);
	});
	it("edges a texel that stands alone on all four sides", () => {
		const mesh = extrudeSprite(sprite(3, 3, (x, y) => x === 1 && y === 1));
		expect(mesh.positions.length / 3).toBe((2 + 4) * 4);
	});
	it("draws no edge between two opaque texels, and none for transparent ones", () => {
		const row = extrudeSprite(sprite(2, 1, () => true));
		expect(row.positions.length / 3).toBe((2 + 6) * 4); // 2*2 outer sides + 2 caps
		const empty = extrudeSprite(sprite(2, 2, () => false));
		expect(empty.positions.length / 3).toBe(2 * 4);
	});
	it("scales to the requested size and thickness, and can skip the rim", () => {
		const mesh = extrudeSprite(sprite(2, 2, () => true), { size: 0.5, thickness: 0.1, edges: false });
		expect(mesh.positions.length / 3).toBe(8);
		expect(bounds(mesh.positions, 1)).toEqual([-0.25, 0.25]);
		expect(bounds(mesh.positions, 2)[1]).toBeCloseTo(0.05, 6);
	});
	it("maps v as the row from the top, so the top of the sprite samples the first row", () => {
		const { positions, uvs } = extrudeSprite(sprite(2, 2, () => true), { edges: false });
		for (let i = 0; i < 4; i++) {
			const y = positions[i * 3 + 1];
			expect(uvs[i * 2 + 1]).toBeCloseTo(y > 0 ? 0 : 1, 6);
		}
	});
	it("takes an edge's colour from the middle of its texel", () => {
		const mesh = extrudeSprite(sprite(2, 2, (x, y) => x === 0 && y === 0), { edges: true });
		// The two faces take the first sixteen numbers; what follows is the rim.
		const edgeUvs = Array.from(mesh.uvs.slice(16));
		for (let i = 0; i < edgeUvs.length; i += 2) {
			expect(edgeUvs[i]).toBeCloseTo(0.25, 6);
			expect(edgeUvs[i + 1]).toBeCloseTo(0.25, 6);
		}
	});
});

describe("sprite quads and frames", () => {
	it("cuts a quad out of a sheet, v from the top", () => {
		const quad = spriteQuad(0.3, 0.3, [0.25, 0.25, 0.5, 0.5]);
		expect(Array.from(quad.uvs)).toEqual([0.25, 0.5, 0.5, 0.5, 0.5, 0.25, 0.25, 0.25]);
		expect(bounds(quad.positions, 0)).toEqual([-0.15, 0.15].map((v) => Math.fround(v)));
	});
	it("keeps only the first square of an animated strip", () => {
		const strip = sprite(2, 6, (_, y) => y < 2);
		const frame = firstFrame(strip);
		expect([frame.width, frame.height]).toEqual([2, 2]);
		expect(firstFrame(sprite(2, 2, () => true)).height).toBe(2);
		expect(firstFrame(sprite(2, 3, () => true)).height).toBe(3);
	});
});

describe("text wrapping", () => {
	const measure = (line: string) => line.length;
	it("wraps at spaces and keeps blank lines", () => {
		expect(wrapLines("aa bb cc", 5, measure)).toEqual(["aa bb", "cc"]);
		expect(wrapLines("one\n\ntwo", 10, measure)).toEqual(["one", "", "two"]);
	});
	it("cuts a word wider than the line", () => {
		expect(wrapLines("abcdefgh", 3, measure)).toEqual(["abc", "def", "gh"]);
	});
	it("returns one empty line for no text", () => {
		expect(wrapLines("", 10, measure)).toEqual([""]);
	});
});
