import {
	AdditiveBlending,
	BoxGeometry,
	DoubleSide,
	Group,
	InstancedMesh,
	Matrix4,
	MeshBasicMaterial,
	MeshLambertMaterial,
	PlaneGeometry,
	Quaternion,
	Vector3,
} from "three";
import type { BufferGeometry, Material, Mesh, Object3D, Texture } from "three";
import { bakeInstanceGeometry, configureInstancedMesh } from "./instance-geometry";
import {
	selectConduits,
	selectMarkers,
	selectPortals,
	selectSkulls,
	selectStatues,
} from "./model-placements";
import type {
	MarkerKind,
	MarkerPlacement,
	ModelPlacement,
	PortalPlacement,
} from "./model-placements";
import type { BlockEntityResources, BlockEntitySchematic, BlockEntitySnapshot } from "./types";

export interface ModelOverlay {
	readonly count: number;
	dispose(): void;
}

export const INVISIBLE_BLOCKS_OVERLAY_NAME = "schematic-renderer:invisible-blocks";

const emptyOverlay = (): ModelOverlay => ({ count: 0, dispose: () => undefined });

/** The first texture a model's own materials carry, which a resource pack may or may not replace. */
function ownTexture(object: Object3D): Texture | null {
	let found: Texture | null = null;
	object.traverse((node) => {
		const mesh = node as Mesh;
		if (found !== null || mesh.isMesh !== true) return;
		const material = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as
			| (Material & { map?: Texture | null })
			| undefined;
		found = material?.map ?? null;
	});
	return found;
}

interface BakedModel {
	geometry: BufferGeometry;
	/** The texture to draw with, and whether this overlay made it and so has to free it. */
	texture: Texture | null;
	owned: boolean;
}

async function bakeModel(
	placement: ModelPlacement,
	resources: BlockEntityResources
): Promise<BakedModel | null> {
	let object: Object3D;
	try {
		object = await resources.getEntityMesh(placement.model);
	} catch (error) {
		console.warn(`[schematic-renderer] Model ${placement.model} could not be loaded.`, error);
		return null;
	}
	// A part is a group and its mesh, and GLTFLoader renames the mesh when it repeats the group's name
	// ("eye" and "eye_1"), so hiding the group has to hide everything under it for baking to skip it.
	const hidden = new Set(placement.hide ?? []);
	if (hidden.size > 0)
		object.traverse((node) => {
			if (hidden.has(node.name))
				node.traverse((part) => {
					part.visible = false;
				});
		});
	let texture = ownTexture(object);
	const geometry = bakeInstanceGeometry(object);
	if (geometry === null) {
		console.warn(`[schematic-renderer] Model ${placement.model} has no usable geometry.`);
		return null;
	}
	let owned = false;
	if (placement.texture !== undefined) {
		try {
			// GLB UVs expect unflipped textures. Clone the cache-owned Cubane texture so that correcting
			// flipY never mutates or disposes the shared source.
			const copy = (await resources.getTexture(placement.texture)).clone();
			copy.flipY = false;
			copy.needsUpdate = true;
			texture = copy;
			owned = true;
		} catch (error) {
			console.warn(
				`[schematic-renderer] Texture ${placement.texture} could not be loaded; keeping the model's own.`,
				error
			);
		}
	}
	return { geometry, texture, owned };
}

/**
 * Draws catalog models in blocks: one instanced draw per model, texture and set of hidden parts. This is the
 * copper-chest renderer's approach without anything chest-specific, so heads, statues and conduits can share it.
 */
export async function createModelOverlay(
	name: string,
	schematic: BlockEntitySchematic,
	signal: AbortSignal,
	placements: readonly ModelPlacement[],
	resources: BlockEntityResources
): Promise<ModelOverlay> {
	if (placements.length === 0 || signal.aborted) return emptyOverlay();

	const groups = new Map<string, ModelPlacement[]>();
	for (const placement of placements) {
		const key = [placement.model, placement.texture ?? "", (placement.hide ?? []).join(",")].join("\0");
		const group = groups.get(key);
		if (group === undefined) groups.set(key, [placement]);
		else group.push(placement);
	}
	const entries = [...groups.values()];
	const baked = await Promise.all(entries.map((group) => bakeModel(group[0], resources)));

	const overlay = new Group();
	overlay.name = name;
	const meshes: InstancedMesh[] = [];
	const geometries: BufferGeometry[] = [];
	const materials: MeshLambertMaterial[] = [];
	const ownedTextures: Texture[] = [];
	const position = new Vector3();
	const rotation = new Quaternion();
	const scale = new Vector3(1, 1, 1);
	const up = new Vector3(0, 1, 0);
	const matrix = new Matrix4();
	let renderedCount = 0;

	entries.forEach((group, index) => {
		const model = baked[index];
		if (model === null) return;
		geometries.push(model.geometry);
		if (model.owned && model.texture !== null) ownedTextures.push(model.texture);
		const material = new MeshLambertMaterial({
			alphaTest: 1 / 255,
			depthTest: true,
			depthWrite: true,
			map: model.texture ?? undefined,
			side: DoubleSide,
		});
		materials.push(material);
		const mesh = new InstancedMesh(model.geometry, material, group.length);
		mesh.name = `${name}:${group[0].model}`;
		group.forEach((placement, slot) => {
			const [x, y, z] = placement.offset ?? [0, 0, 0];
			position.set(placement.position[0] + x, placement.position[1] + y, placement.position[2] + z);
			rotation.setFromAxisAngle(up, placement.rotationY);
			matrix.compose(position, rotation, scale);
			mesh.setMatrixAt(slot, matrix);
		});
		configureInstancedMesh(mesh);
		meshes.push(mesh);
		overlay.add(mesh);
		renderedCount += group.length;
	});

	return publish(schematic, signal, overlay, renderedCount, () => {
		for (const mesh of meshes) mesh.dispose();
		for (const geometry of geometries) geometry.dispose();
		for (const material of materials) material.dispose();
		for (const texture of ownedTextures) texture.dispose();
	});
}

/** Adds the overlay to the schematic, or frees everything if the build was aborted or drew nothing. */
function publish(
	schematic: BlockEntitySchematic,
	signal: AbortSignal,
	overlay: Group,
	count: number,
	free: () => void
): ModelOverlay {
	if (signal.aborted || count === 0) {
		overlay.clear();
		free();
		return emptyOverlay();
	}
	schematic.group.add(overlay);
	let disposed = false;
	return {
		count,
		dispose: () => {
			if (disposed) return;
			disposed = true;
			schematic.group.remove(overlay);
			overlay.clear();
			free();
		},
	};
}

// ---- heads, statues, conduits -------------------------------------------------------------------
export const createSkullOverlay = (
	schematic: BlockEntitySchematic,
	signal: AbortSignal,
	snapshot: BlockEntitySnapshot,
	resources: BlockEntityResources
) =>
	createModelOverlay(
		"schematic-renderer:skulls",
		schematic,
		signal,
		selectSkulls(snapshot),
		resources
	);

export const createCopperGolemStatueOverlay = (
	schematic: BlockEntitySchematic,
	signal: AbortSignal,
	snapshot: BlockEntitySnapshot,
	resources: BlockEntityResources
) =>
	createModelOverlay(
		"schematic-renderer:copper-golem-statues",
		schematic,
		signal,
		selectStatues(snapshot),
		resources
	);

export const createConduitOverlay = (
	schematic: BlockEntitySchematic,
	signal: AbortSignal,
	snapshot: BlockEntitySnapshot,
	resources: BlockEntityResources
) =>
	createModelOverlay(
		"schematic-renderer:conduits",
		schematic,
		signal,
		selectConduits(snapshot),
		resources
	);

// ---- end portals and gateways ---------------------------------------------------------------------
/**
 * The game draws a portal with a shader that swirls two textures. This is one frame of it: the sky tinted
 * dark teal, with the stars added on top. A portal is a surface 0.75 up its block; a gateway fills the block.
 */
export async function createEndPortalOverlay(
	schematic: BlockEntitySchematic,
	signal: AbortSignal,
	snapshot: BlockEntitySnapshot,
	resources: BlockEntityResources
): Promise<ModelOverlay> {
	const portals = selectPortals(snapshot);
	if (portals.length === 0 || signal.aborted) return emptyOverlay();
	const [sky, stars] = await Promise.allSettled([
		resources.getTexture("environment/end_sky"),
		resources.getTexture("entity/end_portal/end_portal"),
	]);
	if (signal.aborted) return emptyOverlay();

	const overlay = new Group();
	overlay.name = "schematic-renderer:end-portals";
	const meshes: InstancedMesh[] = [];
	const geometries: BufferGeometry[] = [];
	const materials: Material[] = [];
	const matrix = new Matrix4();
	let renderedCount = 0;

	for (const kind of ["portal", "gateway"] as const) {
		const list: PortalPlacement[] = portals.filter((portal) => portal.kind === kind);
		if (list.length === 0) continue;
		const geometry =
			kind === "portal"
				? new PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0.25, 0)
				: new BoxGeometry(1, 1, 1);
		geometries.push(geometry);
		const base = new MeshBasicMaterial({
			color: sky.status === "fulfilled" ? 0x3a6f78 : 0x06121a,
			map: sky.status === "fulfilled" ? sky.value : null,
			side: DoubleSide,
		});
		materials.push(base);
		const layers: [Material, number][] = [[base, 0]];
		if (stars.status === "fulfilled") {
			const glitter = new MeshBasicMaterial({
				map: stars.value,
				color: 0x9be8ff,
				transparent: true,
				blending: AdditiveBlending,
				depthWrite: false,
				side: DoubleSide,
			});
			materials.push(glitter);
			layers.push([glitter, 1]);
		}
		for (const [material, order] of layers) {
			const mesh = new InstancedMesh(geometry, material, list.length);
			mesh.name = `schematic-renderer:end-portal:${kind}:${order}`;
			mesh.renderOrder = order;
			list.forEach((portal, slot) => {
				matrix.makeTranslation(...portal.position);
				mesh.setMatrixAt(slot, matrix);
			});
			configureInstancedMesh(mesh);
			mesh.castShadow = false;
			mesh.receiveShadow = false;
			meshes.push(mesh);
			overlay.add(mesh);
		}
		renderedCount += list.length;
	}

	return publish(schematic, signal, overlay, renderedCount, () => {
		for (const mesh of meshes) mesh.dispose();
		for (const geometry of geometries) geometry.dispose();
		for (const material of materials) material.dispose();
	});
}

// ---- blocks the game does not draw ------------------------------------------------------------------
/** The shape that marks each kind: sizes in blocks. */
const MARKER_LOOKS: Readonly<Record<MarkerKind, { size: number; color: number; opacity: number }>> = {
	barrier: { size: 0.9, color: 0xff3b3b, opacity: 0.35 },
	light: { size: 0.3, color: 0xffe680, opacity: 1 },
	structure_void: { size: 0.25, color: 0xd070ff, opacity: 1 },
	moving_piston: { size: 0.6, color: 0x9aa0a6, opacity: 0.35 },
};

/**
 * Barriers, light blocks, structure voids and moving pistons have no model, so the game draws none of them;
 * a small shape marks where each is. The overlay is named INVISIBLE_BLOCKS_OVERLAY_NAME so a viewer can hide it.
 */
export async function createInvisibleBlockOverlay(
	schematic: BlockEntitySchematic,
	signal: AbortSignal,
	snapshot: BlockEntitySnapshot
): Promise<ModelOverlay> {
	const markers = selectMarkers(snapshot);
	if (markers.length === 0 || signal.aborted) return emptyOverlay();

	const overlay = new Group();
	overlay.name = INVISIBLE_BLOCKS_OVERLAY_NAME;
	const meshes: InstancedMesh[] = [];
	const geometries: BufferGeometry[] = [];
	const materials: Material[] = [];
	const matrix = new Matrix4();
	let renderedCount = 0;

	for (const kind of Object.keys(MARKER_LOOKS) as MarkerKind[]) {
		const list: MarkerPlacement[] = markers.filter((marker) => marker.kind === kind);
		if (list.length === 0) continue;
		const { size, color, opacity } = MARKER_LOOKS[kind];
		const geometry = new BoxGeometry(size, size, size);
		const material = new MeshBasicMaterial({
			color,
			transparent: opacity < 1,
			opacity,
			depthWrite: opacity >= 1,
		});
		geometries.push(geometry);
		materials.push(material);
		const mesh = new InstancedMesh(geometry, material, list.length);
		mesh.name = `${INVISIBLE_BLOCKS_OVERLAY_NAME}:${kind}`;
		list.forEach((marker, slot) => {
			matrix.makeTranslation(...marker.position);
			mesh.setMatrixAt(slot, matrix);
		});
		configureInstancedMesh(mesh);
		meshes.push(mesh);
		overlay.add(mesh);
		renderedCount += list.length;
	}

	return publish(schematic, signal, overlay, renderedCount, () => {
		for (const mesh of meshes) mesh.dispose();
		for (const geometry of geometries) geometry.dispose();
		for (const material of materials) material.dispose();
	});
}
