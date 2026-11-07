import type {
	BlockInventory,
	ContainerDefinition,
	ContainerInventory,
	InventoryItem,
	InventorySchematic,
	NbtData,
	Position,
} from "./types.js";

const DEFINITIONS: Record<string, [string, number, number, string[]?]> = {
	chest: ["箱子", 27, 9],
	trapped_chest: ["陷阱箱", 27, 9],
	barrel: ["木桶", 27, 9],
	shulker_box: ["潜影盒", 27, 9],
	hopper: ["漏斗", 5, 5],
	dispenser: ["发射器", 9, 3],
	dropper: ["投掷器", 9, 3],
	crafter: ["合成器", 9, 3],
	furnace: ["熔炉", 3, 3, ["输入", "燃料", "输出"]],
	blast_furnace: ["高炉", 3, 3, ["输入", "燃料", "输出"]],
	smoker: ["烟熏炉", 3, 3, ["输入", "燃料", "输出"]],
	brewing_stand: ["酿造台", 5, 5, ["药水", "药水", "药水", "原料", "燃料"]],
	chiseled_bookshelf: ["雕纹书架", 6, 3],
	decorated_pot: ["饰纹陶罐", 1, 1],
	ender_chest: ["末影箱", 0, 9],
};
const TAG =
	/^(Compound|List|String|Byte|Short|Int|Long|Float|Double|ByteArray|IntArray|LongArray)$/;

export function unwrapNbt(value: unknown): NbtData {
	if (Array.isArray(value)) return value.map(unwrapNbt);
	if (!value || typeof value !== "object" || ArrayBuffer.isView(value)) return value;
	const record = value as NbtData;
	const entries = Object.entries(record);
	if (entries.length === 1 && TAG.test(entries[0][0])) return unwrapNbt(entries[0][1]);
	if (
		typeof record.type === "string" &&
		Object.hasOwn(value, "value") &&
		Object.keys(value).every((k) => ["type", "value", "name"].includes(k))
	)
		return unwrapNbt(record.type === "list" ? record.value?.value : record.value);
	return Object.fromEntries(entries.map(([k, v]) => [k, unwrapNbt(v)]));
}

export function blockState(input = "") {
	const [id, states = ""] = input.split("[");
	return {
		id,
		properties: Object.fromEntries(
			states
				.replace(/]$/, "")
				.split(",")
				.filter(Boolean)
				.map((v) => v.split("="))
		),
	};
}

export function containerDefinition(id: string): ContainerDefinition | null {
	let name = blockState(id).id.replace(/^minecraft:/, "");
	if (name.endsWith("_shulker_box")) name = "shulker_box";
	if (/^(waxed_)?(exposed_|weathered_|oxidized_)?copper_chest$/.test(name)) name = "chest";
	const definition = DEFINITIONS[name];
	return definition
		? {
				name: definition[0],
				size: definition[1],
				columns: definition[2],
				labels: definition[3],
				unavailable: name === "ender_chest",
			}
		: null;
}

export function textComponent(value: unknown): string {
	if (value == null) return "";
	if (typeof value === "string") {
		try {
			return textComponent(JSON.parse(value));
		} catch {
			return value;
		}
	}
	if (Array.isArray(value)) return value.map(textComponent).join("");
	if (typeof value === "object")
		return (
			String((value as NbtData).text ?? (value as NbtData).translate ?? "") +
			textComponent((value as NbtData).extra ?? [])
		);
	return String(value);
}

export function normalizeItem(raw: unknown, fallbackSlot?: number): InventoryItem | null {
	const item = unwrapNbt(raw),
		stack = item?.item ?? item;
	if (!stack || typeof stack.id !== "string" || stack.id === "minecraft:air") return null;
	const count = Number(stack.count ?? stack.Count ?? 1),
		slot = Number(item.slot ?? item.Slot ?? fallbackSlot);
	if (!Number.isInteger(count) || count <= 0 || !Number.isInteger(slot) || slot < 0) return null;
	const components = stack.components ?? {},
		tag = stack.tag ?? {};
	const lore = components["minecraft:lore"] ?? tag.display?.Lore;
	return {
		id: stack.id,
		count,
		slot,
		raw: item,
		customName: textComponent(
			components["minecraft:custom_name"] ?? components["minecraft:item_name"] ?? tag.display?.Name
		),
		lore: Array.isArray(lore) ? lore.map(textComponent) : [],
		enchanted: Boolean(
			components["minecraft:enchantments"] ||
			components["minecraft:stored_enchantments"] ||
			tag.Enchantments?.length ||
			tag.StoredEnchantments?.length
		),
	};
}

export function readContainer(id: string, raw: unknown): ContainerInventory | null {
	const definition = containerDefinition(id);
	if (!definition) return null;
	const nbt = unwrapNbt(raw ?? {}),
		content = nbt.Items ?? nbt.items ?? nbt.components?.["minecraft:container"];
	const entries = Array.isArray(content) ? content : nbt.item ? [{ Slot: 0, ...nbt.item }] : [];
	const slots: (InventoryItem | null)[] = Array(definition.size).fill(null),
		warnings: string[] = [];
	for (const raw of entries) {
		const item = normalizeItem(raw, definition.size === 1 ? 0 : undefined);
		if (!item || item.slot >= slots.length) {
			warnings.push("无效或超出范围的槽位已保留在原始 NBT 中。");
			continue;
		}
		if (slots[item.slot]) warnings.push(`槽位 ${item.slot} 重复，显示最后一条记录。`);
		slots[item.slot] = item;
	}
	let state: ContainerInventory["state"] = "loaded";
	if (definition.unavailable) state = "player";
	else if (nbt.LootTable || nbt.loot_table) state = "loot";
	else if (!Array.isArray(content) && !nbt.item) state = "missing";
	return {
		...definition,
		name: textComponent(nbt.CustomName ?? nbt.custom_name) || definition.name,
		slots,
		nbt,
		state,
		warnings: [...new Set(warnings)],
		occupied: slots.filter(Boolean).length,
		total: slots.reduce((n, item) => n + (item?.count ?? 0), 0),
	};
}

export function pairedChestPosition(state: string, position: Position): Position | null {
	const { id, properties } = blockState(state);
	if (
		!/:(chest|trapped_chest|(?:waxed_)?(?:exposed_|weathered_|oxidized_)?copper_chest)$/.test(id) ||
		!["left", "right"].includes(properties.type)
	)
		return null;
	const directions: Record<string, [number, number]> = {
		north: [1, 0],
		east: [0, 1],
		south: [-1, 0],
		west: [0, -1],
	};
	const clockwise = directions[properties.facing];
	if (!clockwise) return null;
	const sign = properties.type === "left" ? 1 : -1;
	return [position[0] + clockwise[0] * sign, position[1], position[2] + clockwise[1] * sign];
}

export function readBlockInventory(
	schematic: InventorySchematic,
	position: Position
): BlockInventory {
	const wrapper = schematic.schematicWrapper;
	const state =
		wrapper.get_block_string(...position) ?? wrapper.get_block(...position) ?? "minecraft:air";
	const nbt = schematic.getBlockEntitiesMap().get(position.join(","))?.nbt;
	const snbt = wrapper.getBlockEntitySnbt?.(...position);
	let inventory = readContainer(state, nbt);
	const pairPosition = pairedChestPosition(state, position);
	if (inventory && pairPosition) {
		const pairState = wrapper.get_block_string(...pairPosition) ?? "";
		const a = blockState(state),
			b = blockState(pairState);
		if (
			a.id === b.id &&
			a.properties.facing === b.properties.facing &&
			b.properties.type === (a.properties.type === "left" ? "right" : "left")
		) {
			const pair = readContainer(
				pairState,
				schematic.getBlockEntitiesMap().get(pairPosition.join(","))?.nbt
			);
			if (pair) {
				// Vanilla DoubleChestContainer places RIGHT in slots 0–26, LEFT in 27–53.
				const halves: ContainerInventory[] =
					a.properties.type === "right" ? [inventory, pair] : [pair, inventory];
				const slots = halves.flatMap((half, i) =>
					half.slots.map((item) => (item ? { ...item, slot: item.slot + i * 27 } : null))
				);
				inventory = {
					...inventory,
					name: inventory.name === containerDefinition(state)?.name ? "大型箱子" : inventory.name,
					size: 54,
					slots,
					occupied: slots.filter(Boolean).length,
					total: slots.reduce((n, item) => n + (item?.count ?? 0), 0),
					state: halves.some((h) => h.state !== "loaded") ? "partial" : "loaded",
					nbt: { right: halves[0].nbt, left: halves[1].nbt },
					warnings: halves.flatMap((h) => h.warnings),
					pairPosition,
				};
			}
		}
	}
	return { state, position, nbt: unwrapNbt(nbt ?? {}), snbt, inventory };
}

export const nbtJson = (value: unknown) =>
	JSON.stringify(value, (_, v) => (typeof v === "bigint" ? `${v}L` : v), 2);
