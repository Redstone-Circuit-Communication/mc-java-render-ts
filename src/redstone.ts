import type { RedstoneInfo } from "./types.js";
import { blockState, unwrapNbt } from "./inventory.js";
import { L } from "./locale.js";

const DIRECTIONS: Record<string, [string, string]> = {
	north: ["North · −Z", "北 · −Z"],
	south: ["South · +Z", "南 · +Z"],
	east: ["East · +X", "东 · +X"],
	west: ["West · −X", "西 · −X"],
	up: ["Up · +Y", "上 · +Y"],
	down: ["Down · −Y", "下 · −Y"],
};
const UNKNOWN = () => L("Unknown", "未知");
const directionName = (d: string) => (DIRECTIONS[d] ? L(...DIRECTIONS[d]) : UNKNOWN());
const OPPOSITE: Record<string, string> = {
	north: "south",
	south: "north",
	east: "west",
	west: "east",
	up: "down",
	down: "up",
};
const bool = (value: unknown) => (value === "true" ? true : value === "false" ? false : null);
function integer(value: unknown, min = 0, max = 15) {
	if (typeof value !== "number" && typeof value !== "string") return null;
	if (typeof value === "string" && !/^\d+$/.test(value)) return null;
	const n = Number(value);
	return Number.isInteger(n) && n >= min && n <= max ? n : null;
}
const binarySignal = (active: boolean | null) => (active === null ? null : active ? 15 : 0);
const yesNo = (value: boolean | null) =>
	value === null ? UNKNOWN() : value ? L("Yes", "是") : L("No", "否");
const VANILLA_WOODS =
	"oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|bamboo|crimson|warped|pale_oak";
const BINARY_INPUT = new RegExp(
	`^(lever|tripwire_hook|detector_rail|(?:stone|polished_blackstone|${VANILLA_WOODS})_(?:button|pressure_plate))$`
);

/** Read a Java Edition schematic snapshot. No propagation, ticking or guessed input levels. */
export function readRedstone(state: string, rawNbt: unknown = {}): RedstoneInfo | null {
	const { id, properties: p } = blockState(state);
	if (!id.startsWith("minecraft:")) return null;
	const name = id.slice(10),
		nbt = unwrapNbt(rawNbt) ?? {};
	const info: RedstoneInfo = {
		active: null,
		status: L("Unknown state", "状态未知"),
		strength: null,
		signalLabel: L("Output strength", "输出强度"),
		source: L("The schematic saves no usable signal strength", "蓝图未保存可用的信号强度"),
		details: [],
		note: "",
	};
	const detail = (label: string, value: string) => info.details.push({ label, value });
	const direction = (label: string, value: string) => detail(label, directionName(value));
	const active = (
		value: boolean | null,
		on = L("Active", "已激活"),
		off = L("Inactive", "未激活")
	) => {
		info.active = value;
		info.status = value === null ? L("Unknown state", "状态未知") : value ? on : off;
	};
	const binary = (property: string, on?: string, off?: string) => {
		active(bool(p[property]), on, off);
		info.strength = binarySignal(info.active);
		if (info.strength !== null)
			info.source = L(
				`Block state ${property} · vanilla outputs 0 or 15`,
				`方块状态 ${property} · 原版固定输出 0 / 15`
			);
	};
	const analog = () => {
		info.strength = integer(p.power);
		active(info.strength === null ? null : info.strength > 0);
		if (info.strength !== null) info.source = L("Block state power", "方块状态 power");
	};
	const consumer = (property: string, on?: string, off?: string) => {
		active(bool(p[property]), on, off);
		info.signalLabel = L("Input strength", "输入强度");
		info.source = L(
			"Block states do not save the input signal level",
			"方块状态不保存输入信号的数值"
		);
		info.note = L(
			"Whether it is working does not tell the input strength, nor does it mean the block outputs a redstone signal.",
			"工作状态不能用来推算输入强度，也不代表该方块输出红石信号。"
		);
	};

	if (name === "redstone_wire") {
		analog();
		info.signalLabel = L("Signal strength", "信号强度");
		for (const d of ["north", "south", "east", "west"])
			detail(
				directionName(d),
				(
					{
						none: L("Not connected", "不连接"),
						side: L("Side", "水平连接"),
						up: L("Up", "向上连接"),
					} as Record<string, string>
				)[p[d]] ?? UNKNOWN()
			);
	} else if (name === "repeater") {
		binary("powered");
		const delay = integer(p.delay, 1, 4);
		detail(
			L("Delay", "延迟"),
			delay === null
				? UNKNOWN()
				: L(
						`${delay} redstone ticks · ${delay * 2} game ticks · ${(delay / 10).toFixed(1)} s`,
						`${delay} 红石刻 · ${delay * 2} 游戏刻 · ${(delay / 10).toFixed(1)} 秒`
					)
		);
		detail(L("Locked", "锁定"), yesNo(bool(p.locked)));
		// Java's facing points from output toward input for both repeaters and comparators.
		direction(L("Input side", "输入方向"), p.facing);
		direction(L("Output side", "输出方向"), OPPOSITE[p.facing]);
	} else if (name === "comparator") {
		info.strength = integer(nbt.OutputSignal);
		const powered = bool(p.powered);
		active(powered ?? (info.strength === null ? null : info.strength > 0));
		detail(
			L("Mode", "模式"),
			(
				{ compare: L("Compare", "比较"), subtract: L("Subtract", "减法") } as Record<string, string>
			)[p.mode] ?? UNKNOWN()
		);
		direction(L("Input side", "输入方向"), p.facing);
		direction(L("Output side", "输出方向"), OPPOSITE[p.facing]);
		if (info.strength !== null) {
			info.source = L("Block entity NBT · OutputSignal", "方块实体 NBT · OutputSignal");
			if (powered !== null && powered !== info.strength > 0)
				info.note = L(
					"The saved powered state and OutputSignal disagree; both are shown as saved.",
					"保存的 powered 与 OutputSignal 不一致，面板分别保留原始状态和数值。"
				);
		} else {
			info.note = L(
				"No valid OutputSignal: powered only tells whether it is active, not the exact output from 0 to 15.",
				"缺少有效的 OutputSignal；powered 只能表示激活状态，无法确定 0–15 的具体输出。"
			);
		}
	} else if (["redstone_torch", "redstone_wall_torch"].includes(name)) {
		binary("lit", L("Lit", "已点亮"), L("Unlit", "已熄灭"));
	} else if (name === "redstone_block") {
		active(true, L("Always powered", "持续供能"));
		info.strength = 15;
		info.source = L("Fixed vanilla signal source", "原版固定信号源");
	} else if (name === "observer") {
		binary("powered", L("Emitting a pulse", "正在输出脉冲"), L("No pulse", "未输出脉冲"));
		direction(L("Observed side", "侦测方向"), p.facing);
		direction(L("Output side", "输出方向"), OPPOSITE[p.facing]);
		detail(
			L("Pulse length", "脉冲时长"),
			L("1 redstone tick · 2 game ticks", "1 红石刻 · 2 游戏刻")
		);
	} else if (BINARY_INPUT.test(name)) {
		binary("powered");
		if (name === "tripwire_hook")
			detail(L("Tripwire attached", "绊线连接"), yesNo(bool(p.attached)));
	} else if (
		[
			"daylight_detector",
			"light_weighted_pressure_plate",
			"heavy_weighted_pressure_plate",
			"target",
		].includes(name)
	) {
		analog();
		if (name === "daylight_detector") detail(L("Inverted", "反转模式"), yesNo(bool(p.inverted)));
	} else if (["sculk_sensor", "calibrated_sculk_sensor"].includes(name)) {
		analog();
		detail(
			L("Phase", "阶段"),
			(
				{
					inactive: L("Inactive", "待命"),
					active: L("Active", "激活"),
					cooldown: L("Cooldown", "冷却"),
				} as Record<string, string>
			)[p.sculk_sensor_phase] ?? UNKNOWN()
		);
	} else if (name === "redstone_lamp") {
		consumer("lit", L("Lit", "已点亮"), L("Unlit", "未点亮"));
	} else if (["piston", "sticky_piston"].includes(name)) {
		consumer("extended", L("Extended", "已伸出"), L("Retracted", "已收回"));
		direction(L("Pushes toward", "伸出方向"), p.facing);
		info.note = L(
			"Being extended is not a power check: a schematic snapshot cannot tell the current input, quasi-connectivity or pending updates.",
			"伸出状态不是供电检测；蓝图快照无法据此判断当前输入、准连接或待执行更新。"
		);
	} else if (name === "hopper") {
		consumer("enabled", L("Transferring", "可传输"), L("Locked", "已锁定"));
		// Activation here means redstone locking, not inventory transfer availability.
		info.active = p.enabled === "false" ? true : p.enabled === "true" ? false : null;
		direction(L("Hopper faces", "漏斗朝向"), p.facing);
	} else if (["dispenser", "dropper"].includes(name)) {
		consumer("triggered", L("Triggered", "已触发"), L("Not triggered", "未触发"));
		direction(L("Fires toward", "发射方向"), p.facing);
	} else if (["powered_rail", "activator_rail"].includes(name)) {
		consumer("powered");
	} else {
		return null;
	}
	return info;
}

const STEP: Record<string, [number, number, number]> = {
	north: [0, 0, -1],
	south: [0, 0, 1],
	east: [1, 0, 0],
	west: [-1, 0, 0],
	up: [0, 1, 0],
	down: [0, -1, 0],
};
type BlockReader = {
	schematicWrapper: {
		get_block_string?(x: number, y: number, z: number): string | undefined;
		get_block?(x: number, y: number, z: number): string | undefined;
	};
};
const blockAt = (schematic: BlockReader, [x, y, z]: [number, number, number]) => {
	const w = schematic.schematicWrapper;
	return blockState(w.get_block_string?.(x, y, z) ?? w.get_block?.(x, y, z) ?? "minecraft:air");
};

/**
 * An extended piston is two blocks, the base and its head, and the game treats them as one piston. For a position on either
 * part this returns both, or null when the position is not part of an extended piston.
 */
export function pistonParts(
	schematic: BlockReader,
	position: [number, number, number]
): { base: [number, number, number]; head: [number, number, number] } | null {
	const here = blockAt(schematic, position);
	const name = here.id.replace(/^minecraft:/, "");
	const step = STEP[here.properties.facing];
	if (!step) return null;
	if ((name === "piston" || name === "sticky_piston") && here.properties.extended === "true") {
		const head: [number, number, number] = [
			position[0] + step[0],
			position[1] + step[1],
			position[2] + step[2],
		];
		return blockAt(schematic, head).id.replace(/^minecraft:/, "") === "piston_head"
			? { base: position, head }
			: null;
	}
	if (name === "piston_head") {
		const base: [number, number, number] = [
			position[0] - step[0],
			position[1] - step[1],
			position[2] - step[2],
		];
		return /^(sticky_)?piston$/.test(blockAt(schematic, base).id.replace(/^minecraft:/, ""))
			? { base, head: position }
			: null;
	}
	return null;
}
