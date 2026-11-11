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
	/**
	 * model: drawn from its model, block, sprite or text. placeholder: only a hitbox-sized stand-in,
	 * the geometry is missing. debug: the game draws nothing, a debug shape marks the spot.
	 * invisible: nothing to draw. unsupported: nothing knows this id. failed: something was chosen
	 * but could not be built.
	 */
	status?: "model" | "placeholder" | "debug" | "invisible" | "unsupported" | "failed";
	/** Why a placeholder, a debug shape or an invisible entity looks the way it does. */
	note?: string;
}
