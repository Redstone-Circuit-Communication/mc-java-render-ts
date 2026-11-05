import * as THREE from "three";
import { normalizeEntities } from "./normalize";
import { resolveEntityModel } from "./MobRegistry";
import type { EntityRecord } from "./types";

export interface EntitySource {
	get_entities(): unknown;
	getEntitiesSnbt?(): string[];
}

/** Static snapshot entities. Shared GLB geometry/textures remain owned by Cubane. */
export class EntityManager {
	readonly group = new THREE.Group();
	records: EntityRecord[] = [];
	private generation = 0;
	private disposed = false;
	private materials = new Set<THREE.Material>();
	private geometries = new Set<THREE.BufferGeometry>();
	private opacity = 1;
	private shown = true;
	private bounds?: { enabled?: boolean; min: THREE.Vector3; max: THREE.Vector3 };

	constructor(
		private parent: THREE.Group,
		private id: string,
		private source: EntitySource,
		private loadModel: (model: string) => Promise<THREE.Object3D | null>,
		private invalidate: () => void
	) {
		this.group.name = "entities";
		this.group.userData.kind = "entity-group";
	}

	async rebuild(): Promise<void> {
		this.clear();
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
					const spec = resolveEntityModel(record);
					let model: THREE.Object3D | null = null;
					try {
						if (spec) model = await this.loadModel(spec.model);
					} catch {
						/* Mark failed below. */
					}
					if (this.disposed || generation !== this.generation) return;
					record.status = model ? "model" : spec ? "failed" : "unsupported";
					const root = new THREE.Group();
					root.name = record.id;
					root.userData = { kind: "entity", entity: record };
					// Minecraft positions are corner-based; block meshes are centered on integers.
					root.position.fromArray(record.position).addScalar(-0.5);
					root.rotation.y =
						(spec?.yawOffset ?? Math.PI) - THREE.MathUtils.degToRad(record.rotation[0]);
					if (model) {
						// Undo only EntityRenderer's block-entity Y offset. GLB origin is preserved.
						model.position.y += 0.5;
						if (spec?.origin) model.position.add(new THREE.Vector3(...spec.origin));
						// The bundled *_baby GLBs contain adult-sized geometry. Apply the
						// type-specific Minecraft render scale instead of trusting the name.
						if (spec?.scale !== 1) {
							const scaled = new THREE.Group();
							scaled.scale.setScalar(spec?.scale ?? 1);
							scaled.add(model);
							model = scaled;
						}
						const copies = new Map<THREE.Material, THREE.Material>();
						model.traverse((node) => {
							if (node instanceof THREE.Mesh) {
								const copy = (material: THREE.Material) => {
									let owned = copies.get(material);
									if (!owned) {
										owned = material.clone();
										owned.userData.entityOpacity = material.opacity;
										owned.userData.entityTransparent = material.transparent;
										copies.set(material, owned);
										this.materials.add(owned);
									}
									return owned;
								};
								node.material = Array.isArray(node.material)
									? node.material.map(copy)
									: copy(node.material);
							}
							// GLTFLoader renames repeated mesh names; rotate the pivot group only.
							if (
								!spec?.bodyPitch &&
								!(node instanceof THREE.Mesh) &&
								/^(head|headwear)$/.test(node.name)
							)
								node.rotation.x -= THREE.MathUtils.degToRad(record.rotation[1]);
						});
						if (spec?.bodyPitch) {
							root.rotation.order = "YXZ";
							root.rotation.x = -THREE.MathUtils.degToRad(record.rotation[1]);
						}
						root.add(model);
					} else {
						// Explicit pickable marker, never silently discard saved entities.
						const geometry = new THREE.OctahedronGeometry(0.2);
						const material = new THREE.MeshBasicMaterial({ color: 0xdb8b36, wireframe: true });
						this.geometries.add(geometry);
						this.materials.add(material);
						const marker = new THREE.Mesh(geometry, material);
						marker.position.y = 0.25;
						root.add(marker);
					}
					this.group.add(root);
				})
			);
			if (this.disposed || generation !== this.generation) return;
			this.setOpacity(this.opacity);
			this.setBounds(this.bounds);
			this.invalidate();
			if (start + 16 < this.records.length) await new Promise((resolve) => setTimeout(resolve, 0));
		}
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
			root.visible =
				!bounds?.enabled ||
				p.every((v, i) => v >= bounds.min.getComponent(i) && v < bounds.max.getComponent(i));
		}
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
		for (const geometry of this.geometries) geometry.dispose();
		this.materials.clear();
		this.geometries.clear();
		this.records = [];
	}
	dispose(): void {
		this.disposed = true;
		this.clear();
	}
}
