import { pickScene, listContainers, listEntities } from "@rsw/mc-java-render-ts";
import { entityName, renderEntityDetails } from "./entity-inspector.js";
import {
  Raycaster,
  Vector2,
  BoxGeometry,
  EdgesGeometry,
  LineSegments,
  LineBasicMaterial,
} from "three";
import {
  blockState,
  readBlockInventory,
  nbtJson,
} from "@rsw/mc-java-render-ts";
import { nameFor } from "@rsw/mc-java-render-ts";
import { readRedstone } from "@rsw/mc-java-render-ts";
function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}
const MESSAGES = {
  player: "末影箱内容属于玩家数据，不保存在蓝图的方块 NBT 中。",
  loot: "该容器使用战利品表，蓝图中尚未生成实际物品。",
  missing: "蓝图未保存此容器的物品列表，无法判断是否为空。",
  partial: "大型箱子有一侧未保存物品列表，以下仅显示已保存的内容。",
};
export class BlockInspector {
  constructor(renderer, views, assets, showTab, notify) {
    Object.assign(this, { renderer, views, assets, showTab, notify });
    this.raycaster = new Raycaster();
    this.mouse = new Vector2();
    this.selection = null;
    this.pointer = null;
    this.targets = [];
    this.entityTargets = [];
    this.events = new AbortController();
    this.content = document.getElementById("inspect-content");
    this.initialContent = this.content.cloneNode(true);
    this.tooltip = document.getElementById("item-tooltip");
    const signal = this.events.signal,
      canvas = renderer.canvas;
    canvas.addEventListener(
      "pointerdown",
      (e) => {
        if (e.button === 0)
          this.pointer = {
            x: e.clientX,
            y: e.clientY,
            id: e.pointerId,
            moved: false,
            locked: views.locked,
          };
      },
      { signal },
    );
    canvas.addEventListener(
      "pointermove",
      (e) => {
        if (
          this.pointer &&
          this.pointer.id === e.pointerId &&
          !this.pointer.locked &&
          Math.hypot(e.clientX - this.pointer.x, e.clientY - this.pointer.y) > 5
        )
          this.pointer.moved = true;
      },
      { signal },
    );
    canvas.addEventListener("pointercancel", () => (this.pointer = null), {
      signal,
    });
    canvas.addEventListener(
      "click",
      (e) => {
        const p = this.pointer;
        this.pointer = null;
        if (
          canvas.getAttribute("aria-busy") === "true" ||
          e.button !== 0 ||
          !p ||
          p.moved
        )
          return;
        if (views.mode === "first" && !p.locked) return;
        if (p.locked) {
          e.stopImmediatePropagation();
          this.mouse.set(0, 0);
        } else {
          const r = canvas.getBoundingClientRect();
          this.mouse.set(
            ((e.clientX - r.left) / r.width) * 2 - 1,
            (-(e.clientY - r.top) / r.height) * 2 + 1,
          );
        }
        this.pick();
      },
      { capture: true, signal },
    );
    document.getElementById("container-select").addEventListener(
      "change",
      (e) => {
        const target = this.targets[Number(e.target.value)];
        if (e.target.value === "" || !target) return;
        this.select(target.schematic, target.position);
        views.focusBlock(target.schematic, target.position);
      },
      { signal },
    );
    document.getElementById("entity-select").addEventListener("change", (event) => {
      const target = this.entityTargets[Number(event.target.value)];
      if (event.target.value === "" || !target) return;
      this.selectEntity(target.schematic, target.entity);
      views.focusBlock(target.schematic, target.entity.position.map((v) => v - 0.5));
    }, { signal });
    document.getElementById("show-entities").addEventListener("change", (event) => {
      for (const schematic of renderer.schematicManager.getAllSchematics())
        schematic.entityManager?.setVisible(event.target.checked);
      if (this.selection?.kind === "entity") this.clear();
    }, { signal });
    const box = new BoxGeometry(1, 1, 1);
    this.highlight = new LineSegments(
      new EdgesGeometry(box),
      new LineBasicMaterial({
        color: 0x45632a,
        depthTest: true,
        transparent: true,
        opacity: 0.9,
      }),
    );
    box.dispose();
    this.highlight.name = "inspected-block";
    this.highlight.raycast = () => {};
    this.highlight.visible = false;
    window.addEventListener(
      "blur",
      () => {
        this.pointer = null;
        this.tooltip.hidden = true;
      },
      { signal },
    );
  }
  pick() {
    const hit = pickScene(this.renderer, this.views.camera, this.mouse, this.raycaster);
    if (hit?.kind === "entity") { this.selectEntity(hit.schematic, hit.entity); return; }
    if (hit?.kind === "block") { this.select(hit.schematic, hit.position); return; }
    this.clear();
    this.notify("没有选中方块或实体");
  }
  selectEntity(schematic, entity) {
    this.selection = { kind: "entity", schematic, entity };
    this.highlight.visible = false;
    this.highlight.removeFromParent();
    this.tooltip.hidden = true;
    document.getElementById("selection-dot").hidden = false;
    this.showTab("inspect");
    renderEntityDetails(this.content, entity);
    this.renderer.invalidate();
    if (this.views.locked) this.views.manager.flyControls.unlock();
  }
  select(schematic, position) {
    this.selection = { ...readBlockInventory(schematic, position), schematic };
    schematic.group.add(this.highlight);
    const pair = this.selection.inventory?.pairPosition ?? position;
    this.highlight.position.set(...position.map((value, axis) => (value + pair[axis]) / 2));
    this.highlight.scale.set(...position.map((value, axis) => Math.abs(value - pair[axis]) + 1.012));
    this.highlight.visible = true;
    document.getElementById("selection-dot").hidden = false;
    this.showTab("inspect");
    this.render();
    this.renderer.invalidate();
    if (this.views.locked) this.views.manager.flyControls.unlock();
  }
  clear() {
    this.selection = null;
    this.highlight.visible = false;
    this.highlight.removeFromParent();
    this.tooltip.hidden = true;
    this.content.replaceChildren(
      ...[...this.initialContent.childNodes].map((n) => n.cloneNode(true)),
    );
    document.getElementById("selection-dot").hidden = true;
    document.getElementById("container-select").value = "";
    document.getElementById("entity-select").value = "";
    this.renderer.invalidate();
  }
  indexContainers() {
    this.indexEntities();
    this.targets = [];
    const select = document.getElementById("container-select");
    select.replaceChildren(new Option("选择容器，定位并查看…", ""));
    this.targets = listContainers(this.renderer.schematicManager.getAllSchematics());
    this.targets.forEach((t, i) =>
      select.append(
        new Option(`${nameFor(t.id)} · ${t.position.join(", ")}`, String(i)),
      ),
    );
    select.disabled = !this.targets.length;
    select.options[0].textContent = this.targets.length
      ? `发现 ${this.targets.length} 个容器 · 选择定位`
      : "蓝图未保存容器方块实体";
  }
  indexEntities() {
    this.entityTargets = [];
    const select = document.getElementById("entity-select");
    const shown = document.getElementById("show-entities").checked;
    for (const schematic of this.renderer.schematicManager.getAllSchematics()) {
      schematic.entityManager?.setVisible(shown);

    }
    this.entityTargets = listEntities(this.renderer.schematicManager.getAllSchematics());
    select.replaceChildren(new Option(this.entityTargets.length ? `发现 ${this.entityTargets.length} 个实体 · 选择定位` : "蓝图未保存实体", ""));
    for (const [index, { entity }] of this.entityTargets.entries())
      select.append(new Option(`${entityName(entity)} · ${entity.position.join(", ")}${entity.status !== "model" ? " · 占位标记" : ""}`, String(index)));
    select.disabled = !this.entityTargets.length;
  }
  render() {
    if (this.selection?.kind === "entity") {
      renderEntityDetails(this.content, this.selection.entity);
      return;
    }
    this.tooltip.hidden = true;
    const { state, position, nbt, snbt, inventory } = this.selection,
      { id, properties } = blockState(state),
      redstone = readRedstone(state, nbt);
    this.content.replaceChildren();
    const heading = el("div", "block-heading"),
      icon = el("span", "item-icon"),
      label = el("div");
    this.assets.decorate(icon, id);
    label.append(
      el("h3", "", inventory?.name ?? nameFor(id)),
      el("code", "", id),
    );
    heading.append(icon, label);
    this.content.append(heading);
    const coords = el("div", "coordinates");
    position.forEach((v, i) => {
      const cell = el("span");
      cell.append(
        el("b", "", ["X", "Y", "Z"][i]),
        document.createTextNode(String(v)),
      );
      coords.append(cell);
    });
    this.content.append(coords);
    if (redstone) this.content.append(this.redstonePanel(redstone));
    if (inventory) {
      if (MESSAGES[inventory.state])
        this.content.append(
          el("p", "notice warning", MESSAGES[inventory.state]),
        );
      if (inventory.size) {
        const shell = el("div", "inventory-shell"),
          title = el("div", "inventory-title", inventory.name);
        title.append(el("span", "", `${inventory.size} 格 · 只读`));
        shell.append(title);
        const grid = el("div", "inventory-grid");
        grid.style.setProperty("--columns", inventory.columns);
        grid.setAttribute("aria-label", `${inventory.name}物品槽`);
        inventory.slots.forEach((item, slot) => {
          const b = el(
            "button",
            `inventory-slot${item?.enchanted ? " enchanted" : ""}`,
          );
          b.type = "button";
          b.dataset.slot = slot;
          b.setAttribute(
            "aria-label",
            item
              ? `槽位 ${slot}，${item.customName || nameFor(item.id)}，${item.count} 个`
              : `槽位 ${slot}，空`,
          );
          b.setAttribute("aria-pressed", "false");
          if (item) {
            const icon = el("span", "item-icon");
            this.assets.decorate(icon, item.id);
            b.append(icon);
            if (item.count > 1)
              b.append(el("span", "slot-count", String(item.count)));
            b.addEventListener("pointerenter", (e) =>
              this.showTooltip(item, e.clientX, e.clientY),
            );
            b.addEventListener("pointermove", (e) =>
              this.positionTooltip(e.clientX, e.clientY),
            );
            b.addEventListener("focus", () => {
              const r = b.getBoundingClientRect();
              this.showTooltip(item, r.left, r.bottom);
            });
          }
          b.addEventListener(
            "pointerleave",
            () => (this.tooltip.hidden = true),
          );
          b.addEventListener("blur", () => (this.tooltip.hidden = true));
          b.addEventListener("click", () => {
            grid
              .querySelectorAll("button")
              .forEach((v) => v.setAttribute("aria-pressed", String(v === b)));
            this.showItem(item, slot);
          });
          grid.append(b);
        });
        shell.append(grid);
        if (inventory.labels) {
          const labels = el("div", "slot-labels");
          labels.style.setProperty("--columns", inventory.columns);
          inventory.labels.forEach((t) => labels.append(el("span", "", t)));
          shell.append(labels);
        }
        const stats = el("div", "inventory-stats");
        stats.append(
          el("span", "", `${inventory.occupied} / ${inventory.size} 格已占用`),
          el("span", "", `${inventory.total.toLocaleString("zh-CN")} 个物品`),
        );
        shell.append(stats);
        this.content.append(shell);
        if (inventory.state === "loaded" && !inventory.occupied)
          this.content.append(el("p", "notice", "这个容器是空的。"));
        this.itemDetail = el("div");
        this.content.append(this.itemDetail);
        inventory.warnings.forEach((w) =>
          this.content.append(el("p", "notice warning", w)),
        );
      }
    } else if (!redstone)
      this.content.append(
        el("p", "notice", "这不是已支持的容器方块，可在下方查看方块状态。"),
      );
    if (Object.keys(properties).length) {
      const props = el("div", "block-properties");
      Object.entries(properties).forEach(([k, v]) =>
        props.append(el("span", "", `${k}=${v}`)),
      );
      this.content.append(props);
    }
    if (inventory || Object.keys(nbt).length)
      this.content.append(
        this.nbtDetails("查看方块实体数据 · JSON", inventory?.nbt ?? nbt),
      );
    if (snbt)
      this.content.append(this.nbtDetails("选中方块的完整 NBT · SNBT", snbt));
  }
  redstonePanel(info) {
    const panel = el("section", "redstone-panel"),
      header = el("div", "redstone-header"),
      badge = el("span", "redstone-state", info.status);
    panel.setAttribute("aria-label", "红石信号");
    badge.dataset.state =
      info.active === null ? "unknown" : info.active ? "active" : "inactive";
    header.append(el("h4", "", "红石信号"), badge);
    const strength = el("div", "redstone-strength");
    strength.append(
      el("span", "", info.signalLabel),
      el(
        "strong",
        "",
        info.strength === null ? "未知" : `${info.strength} / 15`,
      ),
    );
    panel.append(header, strength);
    if (info.strength !== null) {
      const meter = el("div", "redstone-meter");
      meter.setAttribute("role", "meter");
      meter.setAttribute("aria-label", info.signalLabel);
      meter.setAttribute("aria-valuemin", "0");
      meter.setAttribute("aria-valuemax", "15");
      meter.setAttribute("aria-valuenow", String(info.strength));
      for (let i = 1; i <= 15; i++) {
        const segment = el("span");
        segment.dataset.on = String(i <= info.strength);
        meter.append(segment);
      }
      panel.append(meter);
    }
    const details = el("dl", "redstone-details");
    for (const { label, value } of info.details)
      details.append(el("dt", "", label), el("dd", "", value));
    panel.append(details, el("p", "redstone-source", info.source));
    if (info.note) panel.append(el("p", "redstone-note", info.note));
    panel.append(
      el("p", "redstone-snapshot", "蓝图保存时的状态 · 未运行红石模拟"),
    );
    return panel;
  }
  showItem(item, slot) {
    this.tooltip.hidden = true;
    if (!this.itemDetail) return;
    this.itemDetail.replaceChildren();
    if (!item) {
      this.itemDetail.append(el("p", "notice", `槽位 ${slot}：没有保存物品。`));
      return;
    }
    const panel = el("section", "item-detail");
    panel.append(
      el("h4", "", item.customName || nameFor(item.id)),
      el("p", "", `${item.id} · 数量 ${item.count} · 槽位 ${slot}`),
    );
    item.lore.forEach((t) => panel.append(el("p", "item-lore", t)));
    const details = this.nbtDetails("物品 NBT · JSON 视图", item.raw);
    details.open = true;
    panel.append(details);
    this.itemDetail.append(panel);
  }
  nbtDetails(title, value) {
    const details = el("details", "nbt-details");
    details.append(
      el("summary", "", title),
      el("pre", "", typeof value === "string" ? value : nbtJson(value)),
    );
    return details;
  }
  showTooltip(item, x, y) {
    this.tooltip.replaceChildren(
      el("strong", "", item.customName || nameFor(item.id)),
      el("small", "", item.id),
      el("small", "", `数量 ${item.count} · 点击查看 NBT`),
    );
    this.tooltip.hidden = false;
    this.positionTooltip(x, y);
  }
  positionTooltip(x, y) {
    this.tooltip.style.left = `${Math.max(8, Math.min(x + 14, innerWidth - this.tooltip.offsetWidth - 12))}px`;
    this.tooltip.style.top = `${Math.max(8, Math.min(y + 14, innerHeight - this.tooltip.offsetHeight - 12))}px`;
  }
  dispose() {
    this.events.abort();
    this.highlight.removeFromParent();
    this.highlight.geometry.dispose();
    this.highlight.material.dispose();
    this.tooltip.hidden = true;
  }
}
