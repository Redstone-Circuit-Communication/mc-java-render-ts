export interface SchematicEntity {
	id: string;
	position: [number, number, number];
	nbt: Record<string, unknown>;
}

export interface EntityRecord extends SchematicEntity {
	key: string;
	rotation: [number, number];
	rawNbt: Record<string, unknown>;
	snbt?: string;
	status?: "model" | "unsupported" | "failed";
}
