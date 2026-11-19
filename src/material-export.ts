import type { Material } from "./types.js";
import { L } from "./locale.js";
import { nameFor } from "./names.js";
export function filterMaterials(materials: readonly Material[], query = ""): Material[] {
	const q = query.trim().toLowerCase();
	return materials.filter(
		(item) => item.id.toLowerCase().includes(q) || nameFor(item.id).toLowerCase().includes(q)
	);
}
export function materialRows(materials: readonly Material[]): (string | number)[][] {
	return [
		[
			L("Material", "材料名称"),
			L("Block ID", "方块 ID"),
			L("Count", "数量"),
			L("Stacks (64)", "整组(64)"),
			L("Remainder", "零散数量"),
		],
		...materials.map((m) => [nameFor(m.id), m.id, m.count, Math.floor(m.count / 64), m.count % 64]),
	];
}
/** Includes a UTF-8 BOM so spreadsheet applications read non-ASCII names correctly. */
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
