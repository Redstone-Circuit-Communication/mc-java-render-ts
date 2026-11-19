import * as THREE from "three";
import type { SchematicRenderer } from "./renderer/index.js";

type AssetLoader = ReturnType<SchematicRenderer["cubane"]["getAssetLoader"]>;

/** Anything that can build block meshes, such as a `SchematicRenderer`. */
export interface BlockMeshSource {
	cubane: {
		getBlockMesh(block: string): Promise<THREE.Object3D>;
		parseBlockString?(block: string): unknown;
		getBlockMeshBuilder?(): { createBlockMesh(model: never, transform?: object, block?: never): Promise<THREE.Object3D> };
	};
}

export interface ItemAssetsOptions {
	iconBaseUrl?: string;
	/**
	 * With a renderer, block items get inventory-style icons: the block drawn in 3D at the angle of the item model's
	 * `display.gui` transform, as the game's inventory shows it. Without one, every item shows a flat texture.
	 */
	renderer?: BlockMeshSource;
	/** Edge length of the 3D icons in pixels (default 64). */
	iconSize?: number;
}

/** The game's default inventory transform for block items (`block/block.json`). */
const DEFAULT_GUI = { rotation: [30, 225, 0], scale: [0.625, 0.625, 0.625] };

const TEXTURE_KEYS = ["layer0", "all", "side", "top", "front", "texture", "particle"];

/** First model named anywhere in an item definition's model tree. */
function findModelReference(node: unknown): string | null {
	if (!node || typeof node !== "object") return null;
	const { model, base } = node as { model?: unknown; base?: unknown };
	if (typeof model === "string") return model;
	if (typeof base === "string") return base;
	for (const child of Object.values(node)) {
		const found = findModelReference(child);
		if (found) return found;
	}
	return null;
}

export class ItemAssets {
	private cache = new Map<string, Promise<string | null>>();
	private urls = new Set<string>();
	private disposed = false;

	constructor(
		private loader: AssetLoader,
		private options: ItemAssetsOptions = {}
	) {}

	texture(id: string): Promise<string | null> {
		if (this.disposed) return Promise.resolve(null);
		let pending = this.cache.get(id);
		if (!pending) {
			pending = this.load(id).catch(() => null);
			this.cache.set(id, pending);
		}
		return pending;
	}
	/**
	 * Same path for every id: the item definition, then either a 3D view of the block (block models and the special
	 * models of chests, beds, heads …, when a renderer was given) or one texture of the item's model.
	 */
	private async load(id: string): Promise<string | null> {
		if (!/^minecraft:[a-z0-9_]+$/.test(id)) return null;
		const definition = await this.loader.getResourceString(`items/${id.slice(10)}.json`);
		if (!definition) {
			// blocks without an item of their own (potted plants, wall torches …): their block model
			if (!this.options.renderer) return null;
			const icon = await this.blockIcon(id, `minecraft:block/${id.slice(10)}`, false).catch(() => null);
			return icon ? this.url(icon) : null;
		}
		const tree = JSON.parse(definition).model;
		const reference = findModelReference(tree);
		if (!reference) return null;
		const special = JSON.stringify(tree).includes('"minecraft:special"');
		if (this.options.renderer && (/^(minecraft:)?block\//.test(reference) || special)) {
			const icon = await this.blockIcon(id, reference, special).catch(() => null);
			if (icon) return this.url(icon);
		}
		const model = await this.loader.getModel(reference);
		const textures = model.textures ?? {};
		const key = [...TEXTURE_KEYS, ...Object.keys(textures)].find((name) => textures[name]);
		if (!key) return null;
		const path = this.loader.resolveTexture(`#${key}`, model);
		const blob = await this.loader.getResourceBlob(`textures/${path}.png`);
		return blob ? this.url(blob) : null;
	}

	/** `display.gui` of a model or the first of its parents that has one. */
	private async guiTransform(reference: string): Promise<{ rotation: number[]; scale: number[] }> {
		let name: string | undefined = reference;
		for (let depth = 0; name && depth < 8; depth++) {
			const [namespace, path] = name.includes(":") ? name.split(":") : ["minecraft", name];
			const text = await this.loader.getResourceString(`models/${path}.json`).catch(() => null);
			if (!text || namespace !== "minecraft") break;
			const model = JSON.parse(text);
			const gui = model.display?.gui;
			if (gui) return { rotation: gui.rotation ?? [0, 0, 0], scale: gui.scale ?? [1, 1, 1] };
			name = model.parent;
		}
		return DEFAULT_GUI;
	}

	private gl?: { renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.OrthographicCamera };
	/** One icon at a time on the shared canvas. */
	private drawing: Promise<unknown> = Promise.resolve();

	/**
	 * The mesh an icon shows: the item's own model (as the inventory draws it: a wall's post with two sides, a fence with
	 * two posts …); items with a special renderer (chests, beds, heads …) have no geometry in their model and are drawn as
	 * the block.
	 */
	private async itemMesh(id: string, reference: string, special: boolean): Promise<THREE.Object3D> {
		const cubane = this.options.renderer!.cubane;
		if (!special && cubane.getBlockMeshBuilder && cubane.parseBlockString) {
			const model = await this.loader.getModel(reference).catch(() => null);
			if (model?.elements?.length)
				return cubane.getBlockMeshBuilder().createBlockMesh(model as never, {}, cubane.parseBlockString(id) as never);
		}
		return cubane.getBlockMesh(id);
	}

	/** The block drawn in 3D the way the inventory shows it, as a PNG. */
	private async blockIcon(id: string, reference: string, special: boolean): Promise<Blob | null> {
		const source = this.options.renderer;
		if (!source) return null;
		const [object, gui] = await Promise.all([this.itemMesh(id, reference, special), this.guiTransform(reference)]);
		// nothing drawable (a special renderer this package lacks): let the caller fall back to the flat texture
		if (new THREE.Box3().setFromObject(object).isEmpty()) return null;
		const run = this.drawing.then(() => this.draw(object, gui));
		this.drawing = run.catch(() => undefined);
		return run;
	}

	private async draw(object: THREE.Object3D, gui: { rotation: number[]; scale: number[] }): Promise<Blob | null> {
		if (this.disposed) return null;
		const size = this.options.iconSize ?? 64;
		if (!this.gl) {
			const canvas = document.createElement("canvas");
			canvas.width = canvas.height = size;
			const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
			renderer.setClearColor(0x000000, 0);
			const scene = new THREE.Scene();
			// the inventory lights a block from the front left: the top at about its texture's own colour, the left face at about
			// 0.8 of it and the right face at about 0.6
			scene.add(new THREE.AmbientLight(0xffffff, 1.0));
			const light = new THREE.DirectionalLight(0xffffff, 0.82);
			light.position.set(-0.4, 1, 0.6);
			scene.add(light);
			const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10);
			camera.position.set(0, 0, 5);
			this.gl = { renderer, scene, camera };
		}
		const { renderer, scene, camera } = this.gl;
		const holder = new THREE.Group();
		const centre = new THREE.Box3().setFromObject(object).getCenter(new THREE.Vector3());
		object.position.sub(centre);
		holder.add(object);
		const [rx, ry, rz] = gui.rotation.map((d) => (d * Math.PI) / 180);
		holder.rotation.set(rx, ry, rz, "XYZ");
		holder.scale.set(gui.scale[0], gui.scale[1], gui.scale[2]);
		scene.add(holder);
		holder.updateMatrixWorld(true);
		// frame the block like the inventory does: a full block fills about 90 % of the slot
		const half = (0.625 * 1.62) / 0.9 / 2;
		Object.assign(camera, { left: -half, right: half, top: half, bottom: -half });
		camera.updateProjectionMatrix();
		renderer.render(scene, camera);
		scene.remove(holder);
		return new Promise((resolve) => renderer.domElement.toBlob((blob) => resolve(blob), "image/png"));
	}

	private url(blob: Blob): string | null {
		if (this.disposed) return null;
		const url = URL.createObjectURL(blob);
		this.urls.add(url);
		return url;
	}

	decorate(element: HTMLElement, id: string): void {
		element.dataset.itemId = id;
		element.replaceChildren();
		const placeholder = document.createElement("span");
		placeholder.className = "missing-item";
		placeholder.textContent = "?";
		element.append(placeholder);
		this.texture(id).then((url) => {
			if (this.disposed || !url || element.dataset.itemId !== id) return;
			const img = document.createElement("img");
			img.src = url;
			img.alt = "";
			img.draggable = false;
			element.replaceChildren(img);
		});
	}

	dispose(): void {
		this.disposed = true;
		this.gl?.renderer.dispose();
		this.gl = undefined;
		for (const url of this.urls) URL.revokeObjectURL(url);
		this.urls.clear();
		this.cache.clear();
	}
}
