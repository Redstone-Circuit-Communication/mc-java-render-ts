import * as THREE from "three";
import type { DebugShape, Direction, DisplayTransform, EntityPlan, ItemStack } from "../MobRegistry";
import {
	extrudeSprite,
	firstFrame,
	spriteQuad,
	wrapLines,
	type MeshData,
	type Pixels,
} from "./geometry";
import { resolveItem, type ItemAppearance, type ItemSource } from "./items";

/** What props need from the pack: item definitions, models, and decoded textures. */
export interface EntityAssets extends ItemSource {
	/** RGBA texels of textures/<path>.png, or null when the pack has none. */
	pixels(path: string): Promise<Pixels | null>;
}

/** A block model centred on the origin, or null when the pack cannot draw it. */
export type BlockLoader = (block: string) => Promise<THREE.Object3D | null>;

/** A 2D drawing surface, for text. Absent where there is no DOM. */
export interface Surface {
	canvas: HTMLCanvasElement;
	ctx: CanvasRenderingContext2D;
}
export type SurfaceFactory = (width: number, height: number) => Surface | null;
const domSurface: SurfaceFactory = (width, height) => {
	if (typeof document === "undefined") return null;
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext("2d");
	return ctx ? { canvas, ctx } : null;
};

export type PropPlan = Extract<
	EntityPlan,
	{ kind: "item" | "sprite" | "frame" | "painting" | "text" | "debug" }
>;

interface Parts {
	materials: THREE.Material[];
	geometries: THREE.BufferGeometry[];
	textures: THREE.Texture[];
	/** Objects whose materials belong to Cubane (block models); the caller gives them their own. */
	shared: THREE.Object3D[];
}
export interface BuiltProp extends Parts {
	object: THREE.Object3D;
}

/** Frees what a build made. Block models are Cubane's and stay. */
export function release(parts: Pick<Parts, "materials" | "geometries" | "textures">): void {
	for (const geometry of parts.geometries) geometry.dispose();
	for (const texture of parts.textures) texture.dispose();
	for (const material of parts.materials) material.dispose();
}

const STEP: Record<Direction, [number, number, number]> = {
	down: [0, -1, 0],
	up: [0, 1, 0],
	north: [0, 0, -1],
	south: [0, 0, 1],
	west: [-1, 0, 0],
	east: [1, 0, 0],
};
/** Direction#toYRot: the yaw that faces a horizontal direction. */
const YAW: Partial<Record<Direction, number>> = { south: 0, west: 90, north: 180, east: 270 };
const radians = (degrees: number) => THREE.MathUtils.degToRad(degrees);

/** p' = translation + left * scale * right * p, the transformation of a display entity. */
export function transformed(object: THREE.Object3D, transform?: DisplayTransform): THREE.Object3D {
	if (!transform) return object;
	const outer = new THREE.Group();
	outer.position.fromArray(transform.translation);
	const left = new THREE.Group();
	left.quaternion.fromArray(transform.left);
	const scale = new THREE.Group();
	scale.scale.fromArray(transform.scale);
	const right = new THREE.Group();
	right.quaternion.fromArray(transform.right);
	right.add(object);
	scale.add(right);
	left.add(scale);
	outer.add(left);
	return outer;
}

const cameraQuaternion = new THREE.Quaternion();
const parentQuaternion = new THREE.Quaternion();
/**
 * Keeps `group` facing the camera. A render only calls onBeforeRender on meshes, and the renderer reads
 * each mesh's matrixWorld right after, so every mesh turns the group and refreshes its matrices.
 */
export function faceCamera(group: THREE.Object3D, meshes: THREE.Mesh[]): void {
	const turn = (_renderer: unknown, _scene: unknown, camera: THREE.Camera) => {
		camera.getWorldQuaternion(cameraQuaternion);
		if (group.parent) group.parent.getWorldQuaternion(parentQuaternion);
		else parentQuaternion.identity();
		// World rotation = parent * local, so local = parent^-1 * camera.
		group.quaternion.copy(parentQuaternion).invert().multiply(cameraQuaternion);
		group.updateMatrixWorld(true);
	};
	for (const mesh of meshes) {
		mesh.onBeforeRender = turn;
		mesh.frustumCulled = false;
	}
}

/** Builds the entities that are neither a model nor a block: items, sprites, frames, paintings, text. */
export class PropBuilder {
	private appearances = new Map<string, Promise<ItemAppearance | null>>();
	private texels = new Map<string, Promise<Pixels | null>>();

	constructor(
		private assets?: EntityAssets,
		private loadBlock?: BlockLoader,
		private surface: SurfaceFactory = domSurface
	) {}

	/** Forget what was read from the pack, which may have changed. */
	reset(): void {
		this.appearances.clear();
		this.texels.clear();
	}

	async build(plan: PropPlan): Promise<BuiltProp | null> {
		const parts: Parts = { materials: [], geometries: [], textures: [], shared: [] };
		let object: THREE.Object3D | null = null;
		try {
			switch (plan.kind) {
				case "item":
					object = await this.item(plan, parts);
					break;
				case "sprite":
					object = await this.sprite(plan, parts);
					break;
				case "frame":
					object = await this.frame(plan, parts);
					break;
				case "painting":
					object = await this.painting(plan, parts);
					break;
				case "text":
					object = this.text(plan, parts);
					break;
				case "debug":
					object = this.debug(plan.shape, parts);
					break;
			}
		} catch (error) {
			release(parts);
			throw error;
		}
		if (!object) {
			release(parts);
			return null;
		}
		return { object, ...parts };
	}

	// ---- pack access ---------------------------------------------------------------------
	private pixels(path: string): Promise<Pixels | null> {
		let pending = this.texels.get(path);
		if (!pending) {
			pending = this.assets ? this.assets.pixels(path).catch(() => null) : Promise.resolve(null);
			this.texels.set(path, pending);
		}
		return pending;
	}

	private appearance(id: string): Promise<ItemAppearance | null> {
		let pending = this.appearances.get(id);
		if (!pending) {
			pending = this.assets ? resolveItem(this.assets, id).catch(() => null) : Promise.resolve(null);
			this.appearances.set(id, pending);
		}
		return pending;
	}

	// ---- three helpers ----------------------------------------------------------------------
	private geometry(data: MeshData, parts: Parts): THREE.BufferGeometry {
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute("position", new THREE.BufferAttribute(data.positions, 3));
		geometry.setAttribute("normal", new THREE.BufferAttribute(data.normals, 3));
		geometry.setAttribute("uv", new THREE.BufferAttribute(data.uvs, 2));
		geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
		parts.geometries.push(geometry);
		return geometry;
	}

	/** RGBA rows from the top, uploaded without a flip: v is the row from the top. */
	private texture(pixels: Pixels, parts: Parts): THREE.DataTexture {
		const data = new Uint8Array(pixels.width * pixels.height * 4);
		data.set(pixels.data);
		const texture = new THREE.DataTexture(
			data,
			pixels.width,
			pixels.height,
			THREE.RGBAFormat,
			THREE.UnsignedByteType
		);
		texture.magFilter = THREE.NearestFilter;
		texture.minFilter = THREE.NearestFilter;
		texture.generateMipmaps = false;
		texture.needsUpdate = true;
		parts.textures.push(texture);
		return texture;
	}

	private spriteMaterial(map: THREE.Texture, tint: number | undefined, parts: Parts) {
		const material = new THREE.MeshBasicMaterial({
			map,
			alphaTest: 0.1,
			side: THREE.DoubleSide,
		});
		if (tint !== undefined) rgb(material.color, tint);
		parts.materials.push(material);
		return material;
	}

	private solid(color: number, opacity: number, parts: Parts): THREE.MeshBasicMaterial {
		const material = new THREE.MeshBasicMaterial({
			color,
			transparent: opacity < 1,
			opacity,
			depthWrite: opacity >= 1,
			side: THREE.DoubleSide,
		});
		parts.materials.push(material);
		return material;
	}

	// ---- items -----------------------------------------------------------------------------
	/**
	 * An item as a card centred on the origin with its front toward +Z: layers of a generated item, or
	 * the block of a block item. `size` is the sprite's width in blocks, `blockSize` the block's.
	 */
	private async itemCard(stack: ItemStack, size: number, parts: Parts, blockSize = size) {
		const appearance = await this.appearance(stack.id);
		if (!appearance) return null;
		const card = new THREE.Group();
		const meshes: THREE.Mesh[] = [];
		if (appearance.kind === "block") {
			const block = await this.loadBlock?.(appearance.block);
			if (!block) return null;
			block.scale.setScalar(blockSize);
			parts.shared.push(block);
			card.add(block);
			return { card, meshes };
		}
		let drawn = 0;
		for (const layer of appearance.layers) {
			const pixels = await this.pixels(layer.texture);
			if (!pixels) continue;
			const frame = firstFrame(pixels);
			// Later layers sit just outside the first so they never fight it; only the first has edges.
			const data = extrudeSprite(frame, {
				size,
				thickness: size / 16 + drawn * size * 0.004,
				edges: drawn === 0,
			});
			const mesh = new THREE.Mesh(
				this.geometry(data, parts),
				this.spriteMaterial(this.texture(frame, parts), layer.tint, parts)
			);
			meshes.push(mesh);
			card.add(mesh);
			drawn++;
		}
		return drawn ? { card, meshes } : null;
	}

	private async item(plan: Extract<PropPlan, { kind: "item" }>, parts: Parts) {
		// A block item is drawn at its own size on a display and at half of it on the ground.
		const made = await this.itemCard(
			plan.item,
			plan.size,
			parts,
			plan.mode === "ground" ? plan.size / 2 : plan.size
		);
		if (!made) return null;
		const holder = new THREE.Group();
		if (plan.mode === "display") {
			// ItemDisplayRenderer turns the item half a turn, so at yaw 0 its front looks north.
			made.card.rotation.y = Math.PI;
			holder.add(transformed(made.card, plan.display));
			return holder;
		}
		// Resting on the entity's feet, whatever its size.
		made.card.position.y = plan.size / 2;
		holder.add(made.card);
		if (plan.billboard) faceCamera(made.card, made.meshes);
		return holder;
	}

	private async sprite(plan: Extract<PropPlan, { kind: "sprite" }>, parts: Parts) {
		const pixels = await this.pixels(plan.texture);
		if (!pixels) return null;
		let uv: [number, number, number, number] = [0, 0, 1, 1];
		if (plan.cell) {
			const { cols, rows, index } = plan.cell;
			const column = index % cols;
			const row = Math.floor(index / cols);
			uv = [column / cols, row / rows, (column + 1) / cols, (row + 1) / rows];
		}
		const mesh = new THREE.Mesh(
			this.geometry(spriteQuad(plan.size, plan.size, uv), parts),
			this.spriteMaterial(this.texture(pixels, parts), plan.tint, parts)
		);
		const card = new THREE.Group();
		card.position.y = plan.size / 2;
		card.add(mesh);
		faceCamera(card, [mesh]);
		const holder = new THREE.Group();
		holder.add(card);
		return holder;
	}

	// ---- hanging entities --------------------------------------------------------------------
	private async frame(plan: Extract<PropPlan, { kind: "frame" }>, parts: Parts) {
		// The entity sits 0.46875 behind its block's centre; the renderer starts from that centre.
		const [x, y, z] = STEP[plan.direction];
		const outer = new THREE.Group();
		outer.position.set(x * 0.46875, y * 0.46875, z * 0.46875);
		// ItemFrameRenderer: turn about X for floor and ceiling frames, then about Y; the model's front
		// is -Z, so a horizontal frame turns 180 - yaw.
		const yaw = YAW[plan.direction];
		if (yaw !== undefined) outer.rotation.set(0, radians(180 - yaw), 0);
		else outer.rotation.set(radians(-90 * y), Math.PI, 0);
		if (!plan.invisible) {
			const frame = await this.loadBlock?.(plan.block);
			if (frame) {
				parts.shared.push(frame);
				outer.add(frame);
			}
		}
		if (plan.item) {
			const made = await this.itemCard(plan.item, 0.5, parts);
			if (made) {
				// Inside the frame, against its back plate, turned to face out, spun by ItemRotation.
				const slot = new THREE.Group();
				slot.position.z = 0.4375;
				slot.rotation.z = (plan.rotation * Math.PI) / 4;
				made.card.rotation.y = Math.PI;
				slot.add(made.card);
				outer.add(slot);
			}
		}
		const holder = new THREE.Group();
		holder.add(outer);
		return holder;
	}

	private async painting(plan: Extract<PropPlan, { kind: "painting" }>, parts: Parts) {
		const art = await this.pixels(`painting/${plan.variant}`);
		if (!art) return null;
		const back = await this.pixels("painting/back");
		// A painting is 16 texels to the block and a sixteenth thick, centred on its entity.
		const width = art.width / 16;
		const height = art.height / 16;
		const group = new THREE.Group();
		const slab = new THREE.BoxGeometry(width, height, 1 / 16);
		parts.geometries.push(slab);
		group.add(
			new THREE.Mesh(
				slab,
				back ? this.spriteMaterial(this.texture(back, parts), undefined, parts) : this.solid(0x7b5a3a, 1, parts)
			)
		);
		const face = new THREE.Mesh(
			this.geometry(spriteQuad(width, height), parts),
			this.spriteMaterial(this.texture(art, parts), undefined, parts)
		);
		face.position.z = 1 / 32 + 0.001;
		group.add(face);
		// Built facing +Z; yaw 0 faces south, and the sides run clockwise from there.
		group.rotation.y = -radians(YAW[plan.direction] ?? 0);
		const holder = new THREE.Group();
		holder.add(group);
		return holder;
	}

	// ---- text ------------------------------------------------------------------------------
	/** 8-pixel text at 0.025 blocks a pixel, drawn at four canvas pixels to each of its own. */
	private text(plan: Extract<PropPlan, { kind: "text" }>, parts: Parts) {
		const scale = 4;
		const probe = this.surface(1, 1);
		if (!probe) return null;
		probe.ctx.font = `bold ${8 * scale}px monospace`;
		const measure = (line: string) => probe.ctx.measureText(line).width / scale;
		const lines = wrapLines(plan.text, plan.lineWidth, measure);
		const widest = Math.max(...lines.map(measure));
		const width = Math.ceil(widest) + 2;
		const height = lines.length * 9 + 1;
		const surface = this.surface(width * scale, height * scale);
		if (!surface) return null;
		const { ctx, canvas } = surface;
		const background = plan.background;
		ctx.fillStyle = `rgba(${(background >> 16) & 255},${(background >> 8) & 255},${background & 255},${((background >>> 24) & 255) / 255})`;
		ctx.fillRect(0, 0, canvas.width, canvas.height);
		ctx.font = `bold ${8 * scale}px monospace`;
		ctx.fillStyle = "#ffffff";
		ctx.textBaseline = "top";
		lines.forEach((line, index) => {
			const room = widest - measure(line);
			const left = plan.alignment === "left" ? 0 : plan.alignment === "right" ? room : room / 2;
			ctx.fillText(line, (1 + left) * scale, (1 + index * 9) * scale);
		});
		const texture = new THREE.CanvasTexture(canvas);
		texture.flipY = false; // v is the row from the top, as everywhere else here
		texture.magFilter = THREE.NearestFilter;
		texture.minFilter = THREE.LinearFilter;
		texture.generateMipmaps = false;
		parts.textures.push(texture);
		const material = new THREE.MeshBasicMaterial({
			map: texture,
			transparent: true,
			depthWrite: false,
			side: THREE.DoubleSide,
		});
		parts.materials.push(material);
		const mesh = new THREE.Mesh(this.geometry(spriteQuad(width * 0.025, height * 0.025), parts), material);
		const holder = new THREE.Group();
		holder.add(transformed(mesh, plan.display));
		return holder;
	}

	// ---- debug shapes -----------------------------------------------------------------------
	private box(
		parts: Parts,
		material: THREE.Material,
		size: [number, number, number],
		at: [number, number, number]
	): THREE.Mesh {
		const geometry = new THREE.BoxGeometry(...size);
		parts.geometries.push(geometry);
		const mesh = new THREE.Mesh(geometry, material);
		mesh.position.set(...at);
		return mesh;
	}

	private outline(parts: Parts, geometry: THREE.BufferGeometry, color: number): THREE.LineSegments {
		const edges = new THREE.EdgesGeometry(geometry);
		parts.geometries.push(edges);
		const material = new THREE.LineBasicMaterial({ color });
		parts.materials.push(material);
		return new THREE.LineSegments(edges, material);
	}

	private debug(shape: DebugShape, parts: Parts): THREE.Object3D {
		const group = new THREE.Group();
		switch (shape.type) {
			case "marker": {
				// Three axes from a white core: red X, green Y, blue Z.
				group.add(this.box(parts, this.solid(0xffffff, 1, parts), [0.08, 0.08, 0.08], [0, 0.04, 0]));
				group.add(this.box(parts, this.solid(0xff3030, 1, parts), [0.5, 0.03, 0.03], [0.25, 0.04, 0]));
				group.add(this.box(parts, this.solid(0x30ff30, 1, parts), [0.03, 0.5, 0.03], [0, 0.29, 0]));
				group.add(this.box(parts, this.solid(0x3070ff, 1, parts), [0.03, 0.03, 0.5], [0, 0.04, 0.25]));
				break;
			}
			case "spawner": {
				const cube = this.box(parts, this.solid(0x2ec7c7, 0.35, parts), [0.4, 0.4, 0.4], [0, 0.2, 0]);
				const lines = this.outline(parts, cube.geometry, 0x2ec7c7);
				lines.position.y = 0.2;
				group.add(cube, lines);
				break;
			}
			case "box": {
				const hitbox = this.box(
					parts,
					this.solid(0x3090ff, 0.25, parts),
					[shape.width, shape.height, shape.width],
					[0, shape.height / 2, 0]
				);
				const lines = this.outline(parts, hitbox.geometry, 0x3090ff);
				lines.position.y = shape.height / 2;
				group.add(hitbox, lines);
				break;
			}
			case "disc": {
				const disc = new THREE.CircleGeometry(shape.radius, 48);
				const rim = new THREE.RingGeometry(Math.max(0.01, shape.radius - 0.05), shape.radius, 48);
				parts.geometries.push(disc, rim);
				const fill = new THREE.Mesh(disc, this.solid(shape.color, 0.35, parts));
				const edge = new THREE.Mesh(rim, this.solid(shape.color, 1, parts));
				for (const flat of [fill, edge]) {
					flat.rotation.x = -Math.PI / 2;
					flat.position.y = 0.02;
				}
				group.add(fill, edge);
				break;
			}
			case "bolt": {
				// Eight stacked two-block bars stepping sideways: a zigzag, sixteen blocks tall.
				const x = [0, 0.35, -0.25, 0.4, -0.3, 0.2, -0.4, 0.1];
				const z = [0, -0.2, 0.3, -0.1, 0.25, -0.35, 0.15, 0];
				const core = this.solid(0xe8f0ff, 1, parts);
				const glow = this.solid(0x9bb7ff, 0.3, parts);
				x.forEach((offset, index) => {
					group.add(this.box(parts, core, [0.14, 2, 0.14], [offset, index * 2 + 1, z[index]]));
					group.add(this.box(parts, glow, [0.4, 2, 0.4], [offset, index * 2 + 1, z[index]]));
				});
				break;
			}
		}
		return group;
	}
}

/** Sets a colour from 0xRRGGBB without an sRGB decode, like every entity texture here. */
function rgb(color: THREE.Color, hex: number): void {
	color.setRGB(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255, THREE.LinearSRGBColorSpace);
}
