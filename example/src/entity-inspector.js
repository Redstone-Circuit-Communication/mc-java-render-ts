import { entityName, entityFromObject, nbtJson } from "@rsw/mc-java-render-ts";
import { t } from "./i18n.js";
export { entityName, entityFromObject };
/** How each entity status is explained to the visitor. */
const NOTICES = new Set(["model", "placeholder", "debug", "invisible", "failed", "unsupported"]);
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
    el("p", t("entity.position", { pos: entity.position.join(", ") }), "coordinates"),
    el("p", t("entity.rotation", { yaw: entity.rotation[0], pitch: entity.rotation[1] })),
    el("p", t(`entity.${NOTICES.has(entity.status) ? entity.status : "unsupported"}`), "notice"),
  );
  if (nbt.IsBaby || Number(nbt.Age) < 0) content.append(el("p", t("entity.baby")));
  if (nbt.Item)
    content.append(
      el(
        "p",
        t("entity.item", { id: nbt.Item.id ?? t("redstone.unknown"), count: nbt.Item.count ?? nbt.Item.Count ?? 1 }),
      ),
    );
  if (nbt.Value !== undefined) content.append(el("p", t("entity.xp", { value: nbt.Value })));
  const details = document.createElement("details");
  details.append(
    el("summary", t("entity.nbt")),
    el("pre", entity.snbt || nbtJson(entity.rawNbt)),
  );
  content.append(details);
}
