import type { EntityRecord } from "./types";

export interface EntityModelSpec {
	model: string;
	baby?: string;
	scale?: number;
	babyScale?: number;
	origin?: [number, number, number];
	/** GLBs face -Z; MC living entities at yaw 0 face +Z. */
	yawOffset?: number;
	bodyPitch?: boolean;
}

const registry: Record<string, EntityModelSpec> = {
	allay: { model: "allay" },
	zombie: { model: "zombie", baby: "zombie_baby", babyScale: 0.5 },
	skeleton: { model: "skeleton" },
	creeper: { model: "creeper" },
	pig: { model: "pig", baby: "pig_baby" },
	cow: { model: "cow", baby: "cow_baby" },
	armor_stand: { model: "armor_stand", baby: "armor_stand_small", babyScale: 0.5 },
	// The entity id and the model file disagree, and the dragon is authored facing
	// +Z (head at +Z, tail at -Z) unlike the -Z living-entity models.
	ender_dragon: { model: "dragon", yawOffset: 0 },
	minecart: { model: "minecart", bodyPitch: true, origin: [0, -1 / 16, -1 / 16] },
	chest_minecart: { model: "chest_minecart", bodyPitch: true, origin: [0, -1 / 16, -1 / 16] },
	hopper_minecart: { model: "hopper_minecart", bodyPitch: true, origin: [0, -1 / 16, -1 / 16] },
	tnt_minecart: { model: "tnt_minecart", bodyPitch: true, origin: [0, -1 / 16, -1 / 16] },
};
const woods = [
	"oak",
	"spruce",
	"birch",
	"jungle",
	"acacia",
	"dark_oak",
	"mangrove",
	"cherry",
	"pale_oak",
	"bamboo",
];
for (const wood of woods) {
	const boat = wood === "bamboo" ? "raft" : "boat";
	registry[`${wood}_${boat}`] = {
		model: wood === "bamboo" ? "raft" : `${wood}_${boat}`,
		bodyPitch: true,
	};
	registry[`${wood}_chest_${boat}`] = {
		model: wood === "bamboo" ? "chest_raft" : `${wood}_chest_${boat}`,
		bodyPitch: true,
	};
}

export function resolveEntityModel(
	entity: EntityRecord,
	hasModel?: (model: string) => boolean
): EntityModelSpec | undefined {
	if (!entity.id.startsWith("minecraft:")) return undefined;
	let id = entity.id.slice(10);
	if (id === "boat" || id === "chest_boat") {
		const wood = typeof entity.nbt.Type === "string" ? entity.nbt.Type : "oak";
		if (!woods.includes(wood)) return undefined;
		id = `${wood}_${id === "chest_boat" ? "chest_" : ""}${wood === "bamboo" ? "raft" : "boat"}`;
	}
	const spec = Object.prototype.hasOwnProperty.call(registry, id) ? registry[id] : undefined;
	// The catalog names most base models after the entity id, so an unregistered mob
	// still renders when a same-named model ships. Calibrated variants (baby scale,
	// origin, pitch, extra parts) still require an explicit registry entry.
	if (!spec) return hasModel?.(id) ? { model: id } : undefined;
	const baby =
		entity.nbt.IsBaby === 1 ||
		entity.nbt.IsBaby === true ||
		Number(entity.nbt.Age ?? 0) < 0 ||
		(id === "armor_stand" && (entity.nbt.Small === 1 || entity.nbt.Small === true));
	// These bundled baby animal files contain adult geometry and no juvenile
	// transforms. Keep the unsupported variant visible as a marker, not an adult.
	if (baby && (id === "pig" || id === "cow")) return undefined;
	return {
		...spec,
		model: baby && spec.baby ? spec.baby : spec.model,
		scale: baby ? (spec.babyScale ?? 1) : 1,
	};
}
