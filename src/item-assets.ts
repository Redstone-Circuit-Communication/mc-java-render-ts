import type { SchematicRenderer } from "./renderer/index.js";

type AssetLoader = ReturnType<SchematicRenderer["cubane"]["getAssetLoader"]>;

export interface ItemAssetsOptions {
	iconBaseUrl?: string;
}

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
	/** Same path for every id: item definition, its model, then one texture of that model. */
	private async load(id: string): Promise<string | null> {
		if (!/^minecraft:[a-z0-9_]+$/.test(id)) return null;
		const definition = await this.loader.getResourceString(`items/${id.slice(10)}.json`);
		if (!definition) return null;
		const reference = findModelReference(JSON.parse(definition).model);
		if (!reference) return null;
		const model = await this.loader.getModel(reference);
		const textures = model.textures ?? {};
		const key = [...TEXTURE_KEYS, ...Object.keys(textures)].find((name) => textures[name]);
		if (!key) return null;
		const path = this.loader.resolveTexture(`#${key}`, model);
		const blob = await this.loader.getResourceBlob(`textures/${path}.png`);
		return blob ? this.url(blob) : null;
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
		for (const url of this.urls) URL.revokeObjectURL(url);
		this.urls.clear();
		this.cache.clear();
	}
}
