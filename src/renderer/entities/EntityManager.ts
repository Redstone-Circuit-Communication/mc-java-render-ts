import * as THREE from "three";
import { normalizeEntities } from "./normalize";
import { resolveEntityPlan, type EntityPlan, type ModelLayer } from "./MobRegistry";
import {
	PropBuilder,
	release,
	transformed,
	type BlockLoader,
	type EntityAssets,
	type PropPlan,
} from "./special/PropBuilder";
import type { EntityRecord } from "./types";

export type { BlockLoader, EntityAssets } from "./special/PropBuilder";

export interface EntitySource {
	get_entities(): unknown;
	getEntitiesSnbt?(): string[];
}

type ModelPlan = Extract<EntityPlan, { kind: "model" }>;

/** Static snapshot entities. Shared GLB geometry/textures remain owned by Cubane. */
export class EntityManager {
	readonly group = new THREE.Group();
	records: EntityRecord[] = [];
	private generation = 0;
	private disposed = false;
	private materials = new Set<THREE.Material>();
	/** Only geometry this manager made itself (stand-ins); models and blocks share Cubane's. */
	private geometries = new Set<THREE.BufferGeometry>();
	private textures = new Set<THREE.Texture>();
	private props: PropBuilder;
	private showDebug = true;
	private opacity = 1;
	private shown = true;
	private bounds?: { enabled?: boolean; min: THREE.Vector3; max: THREE.Vector3 };

	constructor(
		private parent: THREE.Group,
		private id: string,
		private source: EntitySource,
		private loadModel: (model: string) => Promise<THREE.Object3D | null>,
		private invalidate: () => void,
		private hasModel?: (model: string) => boolean,
		private loadBlock?: BlockLoader,
		assets?: EntityAssets
	) {
		this.group.name = "entities";
		this.group.userData.kind = "entity-group";
		this.props = new PropBuilder(assets, loadBlock);
	}

	async rebuild(): Promise<void> {
		this.clear();
		this.props.reset();
		if (this.disposed) return;
		const generation = this.generation;
		let snbt: string[] = [];
		try {
			snbt = this.source.getEntitiesSnbt?.() ?? [];
		} catch {
			/* JSON remains available. */
		}
		this.records = normalizeEntities(this.source.get_entities(), this.id, snbt);
		this.parent.add(this.group);
		// Bound outstanding requests, and yield so large entity lists do not block input.
		for (let start = 0; start < this.records.length; start += 16) {
			const batch = this.records.slice(start, start + 16);
			await Promise.all(
				batch.map(async (record) => {
					const plan = resolveEntityPlan(record, this.hasModel);
					let content: THREE.Object3D | null = null;
					try {
						content = await this.build(record, plan, generation);
					} catch {
						/* Recorded as failed below. */
					}
					if (this.stale(generation)) return;
					record.status = statusOf(plan, !!content);
					if (plan.kind === "invisible" || plan.kind === "placeholder" || plan.kind === "debug")
						record.note = plan.reason;
					if (!content) return;
					const root = new THREE.Group();
					root.name = record.id;
					root.userData = { kind: "entity", entity: record, debug: plan.kind === "debug" };
					// Minecraft positions are corner-based; block meshes are centered on integers.
					root.position.fromArray(record.position).addScalar(-0.5);
					root.rotation.y = rotationOf(plan, record);
					root.add(content);
					this.group.add(root);
				})
			);
			if (this.stale(generation)) return;
			this.setOpacity(this.opacity);
			this.setBounds(this.bounds);
			this.invalidate();
			if (start + 16 < this.records.length) await new Promise((resolve) => setTimeout(resolve, 0));
		}
	}

	/** A build that outlived its rebuild must not touch the manager: no materials, nothing added. */
	private stale(generation: number): boolean {
		return this.disposed || generation !== this.generation;
	}

	private async build(
		record: EntityRecord,
		plan: EntityPlan,
		generation: number
	): Promise<THREE.Object3D | null> {
		switch (plan.kind) {
			case "model":
				return this.buildModel(record, plan, generation);
			case "block":
				return this.buildBlock(plan, generation);
			case "placeholder":
				return this.buildPlaceholder(plan);
			case "item":
			case "sprite":
			case "frame":
			case "painting":
			case "text":
			case "debug":
				return this.buildProp(plan, generation);
			default:
				return null;
		}
	}

	/** Items, sprites, frames, paintings, text and debug shapes: built by the PropBuilder. */
	private async buildProp(plan: PropPlan, generation: number): Promise<THREE.Object3D | null> {
		const prop = await this.props.build(plan);
		if (!prop) return null;
		if (this.stale(generation)) {
			release(prop);
			return null;
		}
		const copies = new Map<THREE.Material, THREE.Material>();
		for (const shared of prop.shared) this.adopt(shared, copies);
		for (const material of prop.materials) {
			material.userData.entityOpacity = material.opacity;
			material.userData.entityTransparent = material.transparent;
			this.materials.add(material);
		}
		for (const geometry of prop.geometries) this.geometries.add(geometry);
		for (const texture of prop.textures) this.textures.add(texture);
		return prop.object;
	}

	/** Every layer shares one pivot at the feet, so scaling the wrapper scales them together. */
	private async buildModel(
		record: EntityRecord,
		plan: ModelPlan,
		generation: number
	): Promise<THREE.Object3D | null> {
		const [base, ...overlays] = plan.layers;
		// A base that fails fails the entity; a missing overlay never hides the mob under it.
		const [model, ...extras] = await Promise.all([
			this.loadModel(base.model),
			...overlays.map((layer) => this.loadModel(layer.model).catch(() => null)),
		]);
		if (!model || this.stale(generation)) return null;
		const wrapper = new THREE.Group();
		if (plan.scale !== 1) wrapper.scale.setScalar(plan.scale);
		const copies = new Map<THREE.Material, THREE.Material>();
		[model, ...extras].forEach((layer, index) => {
			if (!layer) return;
			// Undo only EntityRenderer's block-entity Y offset. GLB origin is preserved.
			layer.position.y += 0.5;
			this.adopt(layer, copies, plan.layers[index]);
			layer.traverse((node) => {
				// GLTFLoader renames repeated mesh names; rotate the pivot group only.
				if (!(node instanceof THREE.Mesh) && /^(head|headwear)$/.test(node.name))
					node.rotation.x -= THREE.MathUtils.degToRad(record.rotation[1]);
				if (plan.hide.includes(node.name)) node.visible = false;
			});
			wrapper.add(layer);
		});
		if (plan.cargo && this.loadBlock) {
			const cargo = await this.loadBlock(plan.cargo.block).catch(() => null);
			if (cargo && !this.stale(generation)) {
				// AbstractMinecartRenderer: the block is drawn at 0.75 and its corner sits
				// (DisplayOffset - 8) / 16 above the cart's origin, which is 0.375 above the feet.
				this.adopt(cargo, copies);
				cargo.scale.setScalar(0.75);
				cargo.position.set(0, 0.375 + 0.75 * ((plan.cargo.offset - 8) / 16 + 0.5), 0);
				wrapper.add(cargo);
			}
		}
		return wrapper;
	}

	private async buildBlock(
		plan: Extract<EntityPlan, { kind: "block" }>,
		generation: number
	): Promise<THREE.Object3D | null> {
		const block = await this.loadBlock?.(plan.block);
		if (!block || this.stale(generation)) return null;
		this.adopt(block, new Map());
		const holder = new THREE.Group();
		if (plan.anchor === "feet") {
			block.position.set(0, 0.5, 0);
			holder.add(block);
			return holder;
		}
		// The block spans +0..1 from the entity, under the display's transformation.
		block.position.set(0.5, 0.5, 0.5);
		holder.add(transformed(block, plan.display));
		return holder;
	}

	/** A box of the mob's hitbox, drawn where the model would stand, so a missing asset is visible. */
	private buildPlaceholder(plan: Extract<EntityPlan, { kind: "placeholder" }>): THREE.Object3D {
		const [width, height, depth] = plan.size;
		const geometry = new THREE.BoxGeometry(width, height, depth).translate(0, height / 2, 0);
		const edgeGeometry = new THREE.EdgesGeometry(geometry);
		const fill = new THREE.MeshBasicMaterial({
			color: 0xff00ff,
			transparent: true,
			opacity: 0.3,
			depthWrite: false,
		});
		const edges = new THREE.LineBasicMaterial({ color: 0xff00ff });
		for (const material of [fill, edges]) {
			material.userData.entityOpacity = material.opacity;
			material.userData.entityTransparent = material.transparent;
			this.materials.add(material);
		}
		this.geometries.add(geometry).add(edgeGeometry);
		const group = new THREE.Group();
		group.add(new THREE.Mesh(geometry, fill), new THREE.LineSegments(edgeGeometry, edges));
		return group;
	}

	/** Gives the object materials of its own, so opacity and tints never touch the shared ones. */
	private adopt(
		object: THREE.Object3D,
		copies: Map<THREE.Material, THREE.Material>,
		layer?: ModelLayer
	): void {
		const copy = (material: THREE.Material) => {
			let owned = copies.get(material);
			if (!owned) {
				owned = material.clone();
				owned.userData.entityOpacity = material.opacity;
				owned.userData.entityTransparent = material.transparent;
				copies.set(material, owned);
				this.materials.add(owned);
				if (layer?.tint !== undefined) tint(owned, layer.tint);
				if (layer?.translucent) {
					// The texture's own alpha is the point, not a cut-out edge.
					owned.transparent = true;
					owned.alphaTest = 0;
					owned.depthWrite = false;
					owned.userData.entityTransparent = true;
				}
			}
			return owned;
		};
		object.traverse((node) => {
			if (node instanceof THREE.Mesh)
				node.material = Array.isArray(node.material) ? node.material.map(copy) : copy(node.material);
		});
	}

	setVisible(visible: boolean): void {
		this.shown = visible;
		this.group.visible = visible;
		this.invalidate();
	}
	setBounds(bounds?: { enabled?: boolean; min: THREE.Vector3; max: THREE.Vector3 }): void {
		this.bounds = bounds;
		this.group.visible = this.shown;
		for (const root of this.group.children) {
			const p = (root.userData.entity as EntityRecord).position;
			const inside =
				!bounds?.enabled ||
				p.every((v, i) => v >= bounds.min.getComponent(i) && v < bounds.max.getComponent(i));
			root.visible = inside && (this.showDebug || !root.userData.debug);
		}
	}
	/** Debug shapes mark entities the game does not draw; hiding them leaves the rest untouched. */
	setShowDebug(show: boolean): void {
		this.showDebug = show;
		this.setBounds(this.bounds);
		this.invalidate();
	}
	setOpacity(opacity: number): void {
		this.opacity = opacity;
		for (const material of this.materials) {
			material.opacity = (material.userData.entityOpacity ?? 1) * opacity;
			material.transparent = (material.userData.entityTransparent ?? false) || opacity < 1;
			material.needsUpdate = true;
		}
	}
	clear(): void {
		++this.generation;
		this.group.removeFromParent();
		this.group.clear();
		for (const material of this.materials) material.dispose();
		this.materials.clear();
		for (const geometry of this.geometries) geometry.dispose();
		this.geometries.clear();
		for (const texture of this.textures) texture.dispose();
		this.textures.clear();
		this.records = [];
	}
	dispose(): void {
		this.disposed = true;
		this.clear();
	}
}

function statusOf(plan: EntityPlan, built: boolean): EntityRecord["status"] {
	if (plan.kind === "invisible") return "invisible";
	if (plan.kind === "unsupported") return "unsupported";
	if (!built) return "failed";
	if (plan.kind === "placeholder") return "placeholder";
	return plan.kind === "debug" ? "debug" : "model";
}

/**
 * Models are authored facing -Z and the game turns them by 180 - yaw. Displays keep world axes and
 * turn by -yaw. Everything else (blocks that stand, frames, paintings, sprites, debug shapes) works
 * out its own orientation.
 */
function rotationOf(plan: EntityPlan, record: EntityRecord): number {
	const yaw = THREE.MathUtils.degToRad(record.rotation[0]);
	switch (plan.kind) {
		case "model":
		case "placeholder":
			return Math.PI - yaw;
		case "text":
			return -yaw;
		case "block":
			return plan.anchor === "corner" ? -yaw : 0;
		case "item":
			return plan.mode === "display" ? -yaw : 0;
		default:
			return 0;
	}
}

/** Entity textures are not sRGB-decoded here, so a tint must not be encoded either. */
function tint(material: THREE.Material, hex: number): void {
	const color = (material as THREE.MeshStandardMaterial).color;
	if (color instanceof THREE.Color)
		color.setRGB(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255, THREE.LinearSRGBColorSpace);
}
