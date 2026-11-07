import type { EntityRecord } from "./types";

const tags =
	/^(Compound|List|String|Byte|Short|Int|Long|Float|Double|ByteArray|IntArray|LongArray)$/;
export function unwrapEntityNbt(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(unwrapEntityNbt);
	if (!value || typeof value !== "object") return value;
	const entries = Object.entries(value);
	if (entries.length === 1 && tags.test(entries[0][0])) return unwrapEntityNbt(entries[0][1]);
	return Object.fromEntries(entries.map(([key, item]) => [key, unwrapEntityNbt(item)]));
}

/** Nucleation already resolves region offsets. Never round or reapply them here. */
export function normalizeEntities(
	input: unknown,
	schematicId: string,
	snbt: string[] = []
): EntityRecord[] {
	if (!Array.isArray(input)) return [];
	const used = new Set<string>();
	return input.flatMap((raw, index) => {
		if (!raw || typeof raw !== "object") return [];
		const nbt = unwrapEntityNbt(raw.nbt ?? {}) as Record<string, unknown>;
		const position = raw.position ?? nbt.Pos;
		const id = raw.id ?? nbt.id;
		if (
			typeof id !== "string" ||
			!Array.isArray(position) ||
			position.length !== 3 ||
			!position.every((n: unknown) => typeof n === "number" && Number.isFinite(n))
		)
			return [];
		const rotation = Array.isArray(nbt.Rotation) ? nbt.Rotation : [];
		const uuid = nbt.UUID ?? nbt.UUIDMost;
		const base = `${schematicId}:${uuid === undefined ? `index:${index}` : `uuid:${JSON.stringify(uuid)}:${JSON.stringify(nbt.UUIDLeast ?? "")}`}`;
		let key = base;
		while (used.has(key)) key += `:${index}`;
		used.add(key);
		return [
			{
				key,
				id: id.includes(":") ? id : `minecraft:${id}`,
				position: [...position],
				rotation: [0, 1].map((i) => (Number.isFinite(rotation[i]) ? Number(rotation[i]) : 0)),
				nbt,
				rawNbt: raw.nbt ?? {},
				snbt: snbt[index],
			} as EntityRecord,
		];
	});
}
