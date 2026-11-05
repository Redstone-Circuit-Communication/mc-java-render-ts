import type { EntitySummary, EntityObject } from "./types.js";
import { textComponent } from "./inventory.js";

const NAMES: Record<string, string> = {
  allay: "悦灵",
  zombie: "僵尸",
  skeleton: "骷髅",
  creeper: "苦力怕",
  pig: "猪",
  cow: "牛",
  armor_stand: "盔甲架",
  minecart: "矿车",
  chest_minecart: "运输矿车",
  hopper_minecart: "漏斗矿车",
  boat: "船",
  oak_boat: "橡木船",
  bamboo_raft: "竹筏",
};
export function entityName(record: EntitySummary): string {
  return (
    textComponent(record.nbt.CustomName) ||
    NAMES[record.id.replace(/^minecraft:/, "")] ||
    record.id
  );
}
export function entityFromObject(object: EntityObject | null): EntitySummary | null {
  for (let node = object; node; node = node.parent)
    if (node.userData?.kind === "entity") return node.userData.entity ?? null;
  return null;
}
