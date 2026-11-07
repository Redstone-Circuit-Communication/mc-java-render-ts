import type { RedstoneInfo } from "./types.js";
import { blockState, unwrapNbt } from "./inventory.js";

const DIRECTIONS: Record<string, string> = {
	north: "北 · −Z",
	south: "南 · +Z",
	east: "东 · +X",
	west: "西 · −X",
	up: "上 · +Y",
	down: "下 · −Y",
};
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
const yesNo = (value: boolean | null) => (value === null ? "未知" : value ? "是" : "否");
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
		status: "状态未知",
		strength: null,
		signalLabel: "输出强度",
		source: "蓝图未保存可用的信号强度",
		details: [],
		note: "",
	};
	const detail = (label: string, value: string) => info.details.push({ label, value });
	const direction = (label: string, value: string) => detail(label, DIRECTIONS[value] ?? "未知");
	const active = (value: boolean | null, on = "已激活", off = "未激活") => {
		info.active = value;
		info.status = value === null ? "状态未知" : value ? on : off;
	};
	const binary = (property: string, on?: string, off?: string) => {
		active(bool(p[property]), on, off);
		info.strength = binarySignal(info.active);
		if (info.strength !== null) info.source = `方块状态 ${property} · 原版固定输出 0 / 15`;
	};
	const analog = () => {
		info.strength = integer(p.power);
		active(info.strength === null ? null : info.strength > 0);
		if (info.strength !== null) info.source = "方块状态 power";
	};
	const consumer = (property: string, on?: string, off?: string) => {
		active(bool(p[property]), on, off);
		info.signalLabel = "输入强度";
		info.source = "方块状态不保存输入信号的数值";
		info.note = "工作状态不能用来推算输入强度，也不代表该方块输出红石信号。";
	};

	if (name === "redstone_wire") {
		analog();
		info.signalLabel = "信号强度";
		for (const d of ["north", "south", "east", "west"])
			detail(
				DIRECTIONS[d],
				({ none: "不连接", side: "水平连接", up: "向上连接" } as Record<string, string>)[p[d]] ??
					"未知"
			);
	} else if (name === "repeater") {
		binary("powered");
		const delay = integer(p.delay, 1, 4);
		detail(
			"延迟",
			delay === null
				? "未知"
				: `${delay} 红石刻 · ${delay * 2} 游戏刻 · ${(delay / 10).toFixed(1)} 秒`
		);
		detail("锁定", yesNo(bool(p.locked)));
		// Java's facing points from output toward input for both repeaters and comparators.
		direction("输入方向", p.facing);
		direction("输出方向", OPPOSITE[p.facing]);
	} else if (name === "comparator") {
		info.strength = integer(nbt.OutputSignal);
		const powered = bool(p.powered);
		active(powered ?? (info.strength === null ? null : info.strength > 0));
		detail(
			"模式",
			({ compare: "比较", subtract: "减法" } as Record<string, string>)[p.mode] ?? "未知"
		);
		direction("输入方向", p.facing);
		direction("输出方向", OPPOSITE[p.facing]);
		if (info.strength !== null) {
			info.source = "方块实体 NBT · OutputSignal";
			if (powered !== null && powered !== info.strength > 0)
				info.note = "保存的 powered 与 OutputSignal 不一致，面板分别保留原始状态和数值。";
		} else {
			info.note = "缺少有效的 OutputSignal；powered 只能表示激活状态，无法确定 0–15 的具体输出。";
		}
	} else if (["redstone_torch", "redstone_wall_torch"].includes(name)) {
		binary("lit", "已点亮", "已熄灭");
	} else if (name === "redstone_block") {
		active(true, "持续供能");
		info.strength = 15;
		info.source = "原版固定信号源";
	} else if (name === "observer") {
		binary("powered", "正在输出脉冲", "未输出脉冲");
		direction("侦测方向", p.facing);
		direction("输出方向", OPPOSITE[p.facing]);
		detail("脉冲时长", "1 红石刻 · 2 游戏刻");
	} else if (BINARY_INPUT.test(name)) {
		binary("powered");
		if (name === "tripwire_hook") detail("绊线连接", yesNo(bool(p.attached)));
	} else if (
		[
			"daylight_detector",
			"light_weighted_pressure_plate",
			"heavy_weighted_pressure_plate",
			"target",
		].includes(name)
	) {
		analog();
		if (name === "daylight_detector") detail("反转模式", yesNo(bool(p.inverted)));
	} else if (["sculk_sensor", "calibrated_sculk_sensor"].includes(name)) {
		analog();
		detail(
			"阶段",
			({ inactive: "待命", active: "激活", cooldown: "冷却" } as Record<string, string>)[
				p.sculk_sensor_phase
			] ?? "未知"
		);
	} else if (name === "redstone_lamp") {
		consumer("lit", "已点亮", "未点亮");
	} else if (["piston", "sticky_piston"].includes(name)) {
		consumer("extended", "已伸出", "已收回");
		direction("伸出方向", p.facing);
		info.note = "伸出状态不是供电检测；蓝图快照无法据此判断当前输入、准连接或待执行更新。";
	} else if (name === "hopper") {
		consumer("enabled", "可传输", "已锁定");
		// Activation here means redstone locking, not inventory transfer availability.
		info.active = p.enabled === "false" ? true : p.enabled === "true" ? false : null;
		direction("漏斗朝向", p.facing);
	} else if (["dispenser", "dropper"].includes(name)) {
		consumer("triggered", "已触发", "未触发");
		direction("发射方向", p.facing);
	} else if (["powered_rail", "activator_rail"].includes(name)) {
		consumer("powered");
	} else {
		return null;
	}
	return info;
}
