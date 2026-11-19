import { MeshBuilder, type PaletteItem } from "../../mesh/core/index.js";
/** Retain the legacy worker API while sharing the corrected TypeScript implementation. */
export class LegacyMeshBuilder {
	private core = new MeshBuilder();
	update_palette(items: PaletteItem[]): void {
		this.core.updatePalette(items);
	}
	build_chunk(blocks: Int32Array, x: number, y: number, z: number, apron: Int32Array, ao = true) {
		return this.core.build({ blocks, origin: [x, y, z], apron, ao });
	}
	free(): void {
		this.core.dispose();
	}
}
