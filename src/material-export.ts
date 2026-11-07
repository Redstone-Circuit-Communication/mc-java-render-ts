import type { Material } from "./types.js";
import { nameFor } from "./names.js";
export function filterMaterials(materials: readonly Material[], query = ""): Material[] {
	const q = query.trim().toLowerCase();
	return materials.filter(
		(item) => item.id.toLowerCase().includes(q) || nameFor(item.id).toLowerCase().includes(q)
	);
}
export function materialRows(materials: readonly Material[]): (string | number)[][] {
	return [
		["材料名称", "方块 ID", "数量", "整组(64)", "零散数量"],
		...materials.map((m) => [nameFor(m.id), m.id, m.count, Math.floor(m.count / 64), m.count % 64]),
	];
}
/** Includes a UTF-8 BOM for Chinese text in spreadsheet applications. */
export function materialsToCsv(materials: readonly Material[]): string {
	const escape = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
	return (
		"\uFEFF" +
		materialRows(materials)
			.map((row) => row.map(escape).join(","))
			.join("\r\n")
	);
}
export function materialsToTsv(materials: readonly Material[]): string {
	return materialRows(materials)
		.map((row) => row.join("\t"))
		.join("\n");
}
