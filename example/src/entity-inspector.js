import { entityName, entityFromObject, nbtJson } from "@rsw/mc-java-render-ts";
export { entityName, entityFromObject };
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
    el(
      "p",
      entity.status === "model"
        ? "蓝图保存的静态实体 · 内嵌模型外观"
        : entity.status === "failed"
          ? "模型加载失败，未渲染。"
          : "没有同名模型，未渲染。",
      "notice",
    ),
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
