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
import { t, lang, applyI18n } from "./i18n.js";
function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}
/** Notes for containers whose contents the schematic cannot show. */
const STATE_NOTES = new Set(["player", "loot", "missing", "partial"]);
/** The overlay that marks barriers, light blocks, structure voids and moving pistons, which the game does not draw. */
const INVISIBLE_BLOCKS_OVERLAY = "schematic-renderer:invisible-blocks";
function showInvisibleBlockMarkers(schematic, shown) {
  const overlay = schematic.group?.getObjectByName(INVISIBLE_BLOCKS_OVERLAY);
  if (overlay) overlay.visible = shown;
}

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
    document.getElementById("show-debug-entities").addEventListener("change", (event) => {
      for (const schematic of renderer.schematicManager.getAllSchematics()) {
        schematic.entityManager?.setShowDebug(event.target.checked);
        showInvisibleBlockMarkers(schematic, event.target.checked);
      }
      renderer.invalidate?.();
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
    this.notify(t("inspect.nothing"));
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
  /** Redraws the text after a language switch: the jump lists, the empty panel and the current selection. */
  refresh() {
    applyI18n(this.initialContent);
    if (!this.selection) {
      this.content.replaceChildren(...[...this.initialContent.childNodes].map((n) => n.cloneNode(true)));
    }
    if (this.renderer.schematicManager.getAllSchematics().length) {
      const containers = document.getElementById("container-select"), entities = document.getElementById("entity-select");
      const [container, entity] = [containers.value, entities.value];
      this.indexContainers();
      [containers.value, entities.value] = [container, entity];
    }
    if (this.selection?.kind === "entity") this.render();
    else if (this.selection) {
      this.selection = { ...readBlockInventory(this.selection.schematic, this.selection.position), schematic: this.selection.schematic };
      this.render();
    }
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
    select.replaceChildren(new Option(t("inspect.pickContainer"), ""));
    this.targets = listContainers(this.renderer.schematicManager.getAllSchematics());
    this.targets.forEach((target, i) =>
      select.append(
        new Option(`${nameFor(target.id)} · ${target.position.join(", ")}`, String(i)),
      ),
    );
    select.disabled = !this.targets.length;
    select.options[0].textContent = this.targets.length
      ? t("inspect.containersFound", { count: this.targets.length })
      : t("inspect.noContainers");
  }
  indexEntities() {
    this.entityTargets = [];
    const select = document.getElementById("entity-select");
    const shown = document.getElementById("show-entities").checked;
    const debugShown = document.getElementById("show-debug-entities").checked;
    for (const schematic of this.renderer.schematicManager.getAllSchematics()) {
      schematic.entityManager?.setVisible(shown);
      schematic.entityManager?.setShowDebug(debugShown);
      showInvisibleBlockMarkers(schematic, debugShown);
    }
    this.entityTargets = listEntities(this.renderer.schematicManager.getAllSchematics());
    select.replaceChildren(new Option(this.entityTargets.length ? t("inspect.entitiesFound", { count: this.entityTargets.length }) : t("inspect.noEntities"), ""));
    const tag = { model: "", placeholder: t("entity.tagPlaceholder"), debug: t("entity.tagDebug"), invisible: t("entity.tagEmpty") };
    for (const [index, { entity }] of this.entityTargets.entries())
      select.append(new Option(`${entityName(entity)} · ${entity.position.join(", ")}${tag[entity.status] ?? t("entity.tagNone")}`, String(index)));
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
      if (STATE_NOTES.has(inventory.state))
        this.content.append(
          el("p", "notice warning", t(`state.${inventory.state}`)),
        );
      if (inventory.size) {
        const shell = el("div", "inventory-shell"),
          title = el("div", "inventory-title", inventory.name);
        title.append(el("span", "", t("inv.size", { size: inventory.size })));
        shell.append(title);
        const grid = el("div", "inventory-grid");
        grid.style.setProperty("--columns", inventory.columns);
        grid.setAttribute("aria-label", t("inv.slotsLabel", { name: inventory.name }));
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
              ? t("inv.slotItem", { slot, name: item.customName || nameFor(item.id), count: item.count })
              : t("inv.slotEmpty", { slot }),
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
          el("span", "", t("inv.occupied", { occupied: inventory.occupied, size: inventory.size })),
          el("span", "", t("inv.total", { total: inventory.total.toLocaleString(lang()) })),
        );
        shell.append(stats);
        this.content.append(shell);
        if (inventory.state === "loaded" && !inventory.occupied)
          this.content.append(el("p", "notice", t("inv.empty")));
        this.itemDetail = el("div");
        this.content.append(this.itemDetail);
        inventory.warnings.forEach((w) =>
          this.content.append(el("p", "notice warning", w)),
        );
      }
    } else if (!redstone)
      this.content.append(
        el("p", "notice", t("inv.unsupported")),
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
        this.nbtDetails(t("inv.blockEntityJson"), inventory?.nbt ?? nbt),
      );
    if (snbt)
      this.content.append(this.nbtDetails(t("inv.snbt"), snbt));
  }
  redstonePanel(info) {
    const panel = el("section", "redstone-panel"),
      header = el("div", "redstone-header"),
      badge = el("span", "redstone-state", info.status);
    panel.setAttribute("aria-label", t("redstone.title"));
    badge.dataset.state =
      info.active === null ? "unknown" : info.active ? "active" : "inactive";
    header.append(el("h4", "", t("redstone.title")), badge);
    const strength = el("div", "redstone-strength");
    strength.append(
      el("span", "", info.signalLabel),
      el(
        "strong",
        "",
        info.strength === null ? t("redstone.unknown") : `${info.strength} / 15`,
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
      el("p", "redstone-snapshot", t("redstone.snapshot")),
    );
    return panel;
  }
  showItem(item, slot) {
    this.tooltip.hidden = true;
    if (!this.itemDetail) return;
    this.itemDetail.replaceChildren();
    if (!item) {
      this.itemDetail.append(el("p", "notice", t("item.none", { slot })));
      return;
    }
    const panel = el("section", "item-detail");
    panel.append(
      el("h4", "", item.customName || nameFor(item.id)),
      el("p", "", t("item.summary", { id: item.id, count: item.count, slot })),
    );
    item.lore.forEach((t) => panel.append(el("p", "item-lore", t)));
    const details = this.nbtDetails(t("item.nbt"), item.raw);
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
      el("small", "", t("item.count", { count: item.count })),
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
