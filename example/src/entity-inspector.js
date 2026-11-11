import { entityName, entityFromObject, nbtJson } from "@rsw/mc-java-render-ts";
export { entityName, entityFromObject };
const NOTICES = {
  model: "蓝图保存的静态实体 · 内嵌模型外观",
  placeholder: "资源包只有这个生物的贴图，没有几何数据：暂以碰撞箱占位。把模型放进 entity-models/ 后自动生效。",
  debug: "原版游戏不渲染这个实体；这里画了一个调试标记来标出它的位置，可在侧栏关闭。",
  invisible: "这个实体没有可画的内容（没有物品、文字或方块状态）。",
  failed: "模型加载失败，未渲染。",
  unsupported: "这个实体还没有渲染方式，未渲染。",
};
function el(tag, text, cls) {
  const node = document.createElement(tag);
  node.textContent = text;
  if (cls) node.className = cls;
  return node;
}
export function renderEntityDetails(content, entity) {
  const nbt = entity.nbt;
  content.replaceChildren(
    el("h3", entityName(entity)),
    el("code", entity.id),
    el("p", `位置：${entity.position.join(", ")}`, "coordinates"),
    el("p", `朝向：${entity.rotation[0]}° 俯仰：${entity.rotation[1]}°`),
    el("p", NOTICES[entity.status] ?? NOTICES.unsupported, "notice"),
  );
  if (nbt.IsBaby || Number(nbt.Age) < 0) content.append(el("p", "幼年实体"));
  if (nbt.Item)
    content.append(
      el(
        "p",
        `物品：${nbt.Item.id ?? "未知"} × ${nbt.Item.count ?? nbt.Item.Count ?? 1}`,
      ),
    );
  if (nbt.Value !== undefined) content.append(el("p", `经验值：${nbt.Value}`));
  const details = document.createElement("details");
  details.append(
    el("summary", "实体 NBT（只读）"),
    el("pre", entity.snbt || nbtJson(entity.rawNbt)),
  );
  content.append(details);
}
