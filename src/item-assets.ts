import type {SchematicRenderer} from '../engine/index.mjs';

type AssetLoader = ReturnType<SchematicRenderer['cubane']['getAssetLoader']>;

export interface ItemAssetsOptions {
    iconBaseUrl?: string
}

export class ItemAssets {
    private cache = new Map<string, Promise<string | null>>();
    private urls = new Set<string>();
    private disposed = false;

    constructor(private loader: AssetLoader, private options: ItemAssetsOptions = {}) {

    }

    texture(id: string): Promise<string | null> {
        if (this.disposed) return Promise.resolve(null);
        let pending = this.cache.get(id);
        if (!pending) {
            pending = this.load(id).catch(() => null);
            this.cache.set(id, pending);
        }
        return pending;
    }
    private async load(id: string): Promise<string | null> {
        if (!/^minecraft:[a-z0-9_]+$/.test(id)) return null;
        const short = id.slice(10);
        const direct = await this.loader.getResourceBlob(
            `textures/item/${short}.png`,
        );
        if (direct) return this.url(direct);
        if (["chest", "trapped_chest", "ender_chest"].includes(short)) return null;
        const candidates = [];
        const source = await this.loader.getResourceString(
            `models/item/${short}.json`,
        );
        if (source) {
            const layer = JSON.parse(source).textures?.layer0;
            if (typeof layer === "string" && !layer.startsWith("#"))
                candidates.push(layer.replace(/^minecraft:/, ""));
        }
        try {
            const block = await this.loader.getModel(`block/${short}`),
                refs = block?.textures ?? {};
            for (const key of [
                "all",
                "side",
                "top",
                "front",
                "texture",
                "particle",
                ...Object.keys(refs),
            ])
                if (refs[key])
                    candidates.push(
                        this.loader
                            .resolveTexture(`#${key}`, block)
                            .replace(/^minecraft:/, ""),
                    );
        } catch {
            /* Normal items do not always have a block model. */
        }
        candidates.push(
            `block/${short}`,
            `block/${short}_side`,
            `block/${short}_top`,
        );
        for (const path of new Set(candidates)) {
            if (
                !/^(item|block)\/[a-z0-9_/-]+$/.test(path) ||
                path.includes("missing")
            )
                continue;
            const blob = await this.loader.getResourceBlob(`textures/${path}.png`);
            if (blob) return this.url(blob);
        }
        return null;
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
