import type { EntityRecord } from "./types";

/** Every vanilla entity uses the bundled model named after its id. */
export function resolveEntityModel(
	entity: EntityRecord,
	hasModel?: (model: string) => boolean
): string | undefined {
	if (!entity.id.startsWith("minecraft:")) return undefined;
	const model = entity.id.slice(10);
	return !hasModel || hasModel(model) ? model : undefined;
}
