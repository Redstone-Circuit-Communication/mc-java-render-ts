/** Plain buffers, so the shapes can be built and tested without three. */
export interface MeshData {
	positions: Float32Array;
	normals: Float32Array;
	uvs: Float32Array;
	indices: Uint32Array;
}

/** RGBA rows from top to bottom, as ImageData holds them. */
export interface Pixels {
	data: ArrayLike<number>;
	width: number;
	height: number;
}

/** Texels at or below this alpha are not drawn; the materials alpha-test at 0.1. */
export const ALPHA_CUTOFF = 26;

type Vec3 = [number, number, number];
type Vec2 = [number, number];

class MeshBuilder {
	private positions: number[] = [];
	private normals: number[] = [];
	private uvs: number[] = [];
	private indices: number[] = [];

	/** Corners run counter-clockwise as seen from the side the normal points to. */
	quad(corners: [Vec3, Vec3, Vec3, Vec3], normal: Vec3, uvs: [Vec2, Vec2, Vec2, Vec2]): void {
		const base = this.positions.length / 3;
		corners.forEach((corner, i) => {
			this.positions.push(...corner);
			this.normals.push(...normal);
			this.uvs.push(...uvs[i]);
		});
		this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
	}

	build(): MeshData {
		return {
			positions: new Float32Array(this.positions),
			normals: new Float32Array(this.normals),
			uvs: new Float32Array(this.uvs),
			indices: new Uint32Array(this.indices),
		};
	}
}

const alphaAt = (pixels: Pixels, x: number, y: number): number =>
	x < 0 || y < 0 || x >= pixels.width || y >= pixels.height
		? 0
		: Number(pixels.data[(y * pixels.width + x) * 4 + 3]);

/**
 * A sprite as a thin slab centred on the origin, front facing +Z, like the game's generated item
 * models: two faces and, for every opaque texel beside a transparent one, an edge that takes the
 * colour of that texel. UVs treat v as the row from the top, which is how an uploaded RGBA array
 * (DataTexture, no flip) is sampled. `size` is the sprite's width in blocks.
 */
export function extrudeSprite(
	pixels: Pixels,
	{ size = 1, thickness = 1 / 16, edges = true } = {}
): MeshData {
	const mesh = new MeshBuilder();
	const half = size / 2;
	const depth = thickness / 2;
	const uv = (x: number, y: number): Vec2 => [(x + half) / size, (half - y) / size];
	mesh.quad(
		[[-half, -half, depth], [half, -half, depth], [half, half, depth], [-half, half, depth]],
		[0, 0, 1],
		[uv(-half, -half), uv(half, -half), uv(half, half), uv(-half, half)]
	);
	mesh.quad(
		[[half, -half, -depth], [-half, -half, -depth], [-half, half, -depth], [half, half, -depth]],
		[0, 0, -1],
		[uv(half, -half), uv(-half, -half), uv(-half, half), uv(half, half)]
	);
	if (!edges) return mesh.build();

	const { width, height } = pixels;
	const solid = (x: number, y: number) => alphaAt(pixels, x, y) > ALPHA_CUTOFF;
	for (let py = 0; py < height; py++)
		for (let px = 0; px < width; px++) {
			if (!solid(px, py)) continue;
			const x0 = (px / width - 0.5) * size;
			const x1 = ((px + 1) / width - 0.5) * size;
			const y1 = (0.5 - py / height) * size;
			const y0 = (0.5 - (py + 1) / height) * size;
			// Every corner of an edge samples the middle of its texel.
			const c: Vec2 = [(px + 0.5) / width, (py + 0.5) / height];
			const same: [Vec2, Vec2, Vec2, Vec2] = [c, c, c, c];
			if (!solid(px - 1, py))
				mesh.quad([[x0, y0, -depth], [x0, y0, depth], [x0, y1, depth], [x0, y1, -depth]], [-1, 0, 0], same);
			if (!solid(px + 1, py))
				mesh.quad([[x1, y0, depth], [x1, y0, -depth], [x1, y1, -depth], [x1, y1, depth]], [1, 0, 0], same);
			if (!solid(px, py - 1))
				mesh.quad([[x0, y1, depth], [x1, y1, depth], [x1, y1, -depth], [x0, y1, -depth]], [0, 1, 0], same);
			if (!solid(px, py + 1))
				mesh.quad([[x0, y0, -depth], [x1, y0, -depth], [x1, y0, depth], [x0, y0, depth]], [0, -1, 0], same);
		}
	return mesh.build();
}

/** One quad facing +Z, centred on the origin, showing `uv` (u0, v0, u1, v1 with v from the top). */
export function spriteQuad(
	width: number,
	height: number,
	uv: [number, number, number, number] = [0, 0, 1, 1]
): MeshData {
	const mesh = new MeshBuilder();
	const [u0, v0, u1, v1] = uv;
	const x = width / 2;
	const y = height / 2;
	mesh.quad(
		[[-x, -y, 0], [x, -y, 0], [x, y, 0], [-x, y, 0]],
		[0, 0, 1],
		[[u0, v1], [u1, v1], [u1, v0], [u0, v0]]
	);
	return mesh.build();
}

/** The first frame of an animated strip (taller than wide, in whole squares); anything else as is. */
export function firstFrame(pixels: Pixels): Pixels {
	const { width, height } = pixels;
	if (height <= width || height % width !== 0) return pixels;
	const data = new Uint8Array(width * width * 4);
	for (let i = 0; i < data.length; i++) data[i] = Number(pixels.data[i]);
	return { data, width, height: width };
}

/** Greedy word wrap of `text` into lines no wider than `maxWidth`, breaking inside a long word. */
export function wrapLines(
	text: string,
	maxWidth: number,
	measure: (line: string) => number
): string[] {
	const lines: string[] = [];
	for (const paragraph of text.split("\n")) {
		let line = "";
		for (const word of paragraph.split(" ")) {
			const candidate = line ? `${line} ${word}` : word;
			if (measure(candidate) <= maxWidth) {
				line = candidate;
				continue;
			}
			if (line) lines.push(line);
			line = "";
			// A word wider than the whole line is cut where it stops fitting.
			let rest = word;
			while (rest && measure(rest) > maxWidth) {
				let cut = rest.length - 1;
				while (cut > 1 && measure(rest.slice(0, cut)) > maxWidth) cut--;
				lines.push(rest.slice(0, cut));
				rest = rest.slice(cut);
			}
			line = rest;
		}
		lines.push(line);
	}
	return lines;
}
