import { SchematicRenderer, BlueprintLoader, ItemAssets, nameFor, filterMaterials, materialsToCsv, materialsToTsv, captureScreenshot, readRenderSettings } from "@rsw/mc-java-render-ts";
import { ViewControls } from "./view-controls.js";
import { BlockInspector } from "./block-inspector.js";
import { RenderSettings } from "./render-settings.js";
import { PerformanceHUD } from "./performance-hud.js";
const $ = (id) => document.getElementById(id),
  canvas = $("canvas");
let blueprints;
const DEFAULT_SCHEMATIC = "./schematics/inspection-demo.litematic",
  PACK_VERSION = "vanilla-layout-fixed-20261101";
let renderer,
  views,
  inspector,
  renderSettings,
  performanceHUD,
  assets,
  allMaterials = [],
  busy = true,
  toastTimer;
let currentFilename = "inspection-demo.litematic";
const basename = (name) =>
  name.replace(/\.(litematic|schem|schematic|nbt)$/i, "");
function toast(message) {
  $("toast").textContent = message;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("toast").hidden = true), 3000);
}
function showTab(tab) {
  for (const name of ["materials", "inspect"]) {
    const active = tab === name;
    $(`${name}-pane`).hidden = !active;
    $(`${name}-tab`).setAttribute("aria-selected", String(active));
    $(`${name}-tab`).tabIndex = active ? 0 : -1;
  }
  $("item-tooltip").hidden = true;
}
for (const tab of ["materials", "inspect"]) {
  $(`${tab}-tab`).addEventListener("click", () => showTab(tab));
  $(`${tab}-tab`).addEventListener("keydown", (e) => {
    if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
      e.preventDefault();
      const next =
        e.key === "Home"
          ? "materials"
          : e.key === "End"
            ? "inspect"
            : tab === "materials"
              ? "inspect"
              : "materials";
      showTab(next);
      $(`${next}-tab`).focus();
    }
  });
}
function setBusy(value, message = "生成方块模型与贴图…") {
  busy = value;
  performanceHUD?.setLoading(value);
  canvas.setAttribute("aria-busy", String(value));
  $("loading-card").hidden = !value;
  $("loading-card").classList.remove("error");
  $("loading-title").textContent = "正在打开蓝图";
  $("loading-message").textContent = message;
  $("scene-status").textContent = value ? "加载中" : "蓝图已就绪";
  for (const b of document.querySelectorAll(
    "[data-view],#open-file,#fit-view,#toggle-grid,#take-screenshot,#demo-select,#axis-buttons button",
  ))
    b.disabled = value;
  $("copy-materials").disabled = $("export-materials").disabled =
    value || !allMaterials.length;
  $("container-select").disabled = value || !inspector?.targets.length;
}
function showError(error) {
  console.error(error);
  setBusy(false);
  $("scene-status").textContent = "加载失败";
  if (renderer?.schematicManager?.getAllSchematics().length) {
    toast(`加载失败：${error.message}`);
    return;
  }
  $("loading-card").hidden = false;
  $("loading-card").classList.add("error");
  $("loading-title").textContent = "暂时无法打开蓝图";
  $("loading-message").textContent = error.message;
  if (!views)
    for (const b of document.querySelectorAll(
      "[data-view],#fit-view,#toggle-grid,#take-screenshot,#open-file,#demo-select",
    ))
      b.disabled = true;
}
function visibleMaterials() {
  return filterMaterials(allMaterials, $("material-search").value);
}
function renderMaterials() {
  const list = $("material-list");
  list.replaceChildren();
  const items = visibleMaterials();
  $("filtered-count").textContent = `${items.length} 种`;
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = allMaterials.length
      ? "没有找到匹配的材料"
      : "蓝图中没有非空气方块";
    list.append(empty);
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const item of items) {
    const row = document.createElement("div");
    row.className = "material-row";
    const icon = document.createElement("span");
    icon.className = "item-icon";
    assets?.decorate(icon, item.id);
    const label = document.createElement("div");
    label.className = "material-label";
    const name = document.createElement("div");
    name.className = "material-name";
    name.textContent = nameFor(item.id);
    const id = document.createElement("div");
    id.className = "material-id";
    id.textContent = item.id;
    const quantity = document.createElement("div");
    quantity.className = "material-count";
    quantity.textContent = item.count.toLocaleString("zh-CN");
    const stacks = document.createElement("div");
    stacks.className = "material-stacks";
    stacks.textContent = `${Math.floor(item.count / 64)} 组 + ${item.count % 64}`;
    label.append(name, id);
    quantity.append(stacks);
    row.append(icon, label, quantity);
    fragment.append(row);
  }
  list.append(fragment);
}
$("material-search").addEventListener("input", renderMaterials);
document.addEventListener("keydown", (e) => {
  if (
    e.key === "/" &&
    !e.ctrlKey &&
    !e.metaKey &&
    !views?.locked &&
    !e.target.closest("input,textarea,select,[contenteditable=true]")
  ) {
    e.preventDefault();
    showTab("materials");
    $("material-search").focus();
  }
});
$("copy-materials").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(
      materialsToTsv(visibleMaterials()),
    );
    toast("材料清单已复制");
  } catch {
    toast("复制失败，请使用导出 CSV。");
  }
});
function download(blob, filename) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
$("export-materials").addEventListener("click", () => {
  download(
    new Blob(
      [materialsToCsv(visibleMaterials())],
      { type: "text/csv;charset=utf-8" },
    ),
    basename(currentFilename) + "-材料清单.csv",
  );
  toast("已导出当前筛选的材料清单");
});
$("take-screenshot").addEventListener("click", async () => {
  try {
    download(await captureScreenshot(renderer), basename(currentFilename) + "-预览.png");
    toast("截图已导出");
  } catch (error) { toast(`截图失败：${error.message}`); }
});
async function loadBlueprint(buffer, filename) {
  setBusy(true, "读取蓝图与容器 NBT…");
  if (views?.locked) views.manager.flyControls.unlock();
  try {
    const result = await blueprints.load(buffer, filename);
    const schematic = result.schematic;
    allMaterials = result.materials;
    currentFilename = filename;
    $("scene-name").textContent = basename(filename);
    $("scene-name").title = filename;
    document.querySelector(".file-extension").textContent =
      "." + filename.split(".").at(-1);
    $("material-search").value = "";
    $("total-blocks").textContent = allMaterials
      .reduce((n, m) => n + m.count, 0)
      .toLocaleString("zh-CN");
    $("total-types").textContent = allMaterials.length.toLocaleString("zh-CN");
    $("material-count-badge").textContent = allMaterials.length;
    $("materials-status").textContent =
      `完整蓝图 · ${result.regionCount} 个区域 · 已合并同类方块`;
    $("scene-dimensions").textContent =
      schematic.getTightDimensions().join(" × ") + " 格";
    renderMaterials();
    inspector.indexContainers();
    await views.fit();
    setBusy(false);
    renderer.invalidate();
  } catch (error) {
    showError(error);
    throw error;
  }
}
async function loadUrl(url) {
  setBusy(true, "获取蓝图文件…");
  try {
    const response = await fetch(url);
    if (!response.ok)
      throw new Error(`蓝图请求失败（HTTP ${response.status}）`);
    await loadBlueprint(
      await response.arrayBuffer(),
      decodeURIComponent(url.split(/[?#]/)[0].split("/").at(-1)),
    );
  } catch (error) {
    showError(error);
  }
}
$("demo-select").addEventListener("change", (e) => loadUrl(e.target.value));
$("open-file").addEventListener("click", () => $("file-input").click());
async function openFile(file) {
  if (busy || !file) return;
  if (!/\.(litematic|schem|schematic|nbt)$/i.test(file.name)) {
    toast("请选择 .litematic、.schem、.schematic 或 .nbt 蓝图文件");
    return;
  }
  setBusy(true, "读取本地文件…");
  try {
    await loadBlueprint(await file.arrayBuffer(), file.name);
    $("demo-select").selectedIndex = -1;
  } catch (error) {
    showError(error);
  }
}
$("file-input").addEventListener("change", (e) => {
  openFile(e.target.files[0]);
  e.target.value = "";
});
let dragDepth = 0;
window.addEventListener("dragover", (e) => {
  if (e.dataTransfer.types.includes("Files")) e.preventDefault();
});
window.addEventListener("drop", (e) => {
  if (e.dataTransfer.types.includes("Files")) e.preventDefault();
});
$("viewport").addEventListener("dragenter", (e) => {
  if (e.dataTransfer.types.includes("Files")) {
    e.preventDefault();
    dragDepth++;
    if (!busy) $("drop-overlay").hidden = false;
  }
});
$("viewport").addEventListener("dragleave", () => {
  if (--dragDepth <= 0) {
    dragDepth = 0;
    $("drop-overlay").hidden = true;
  }
});
$("viewport").addEventListener("drop", (e) => {
  e.preventDefault();
  dragDepth = 0;
  $("drop-overlay").hidden = true;
  openFile(e.dataTransfer.files[0]);
});
function deleteIndexedDB(name) {
  return new Promise((resolve, reject) => {
    const r = indexedDB.deleteDatabase(name);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error ?? new Error(`无法清理 ${name}`));
    r.onblocked = () =>
      reject(new Error("请关闭此站点的其他标签页，再重试清理缓存"));
  });
}
async function clearSavedResourcePacksIfRequested() {
  const params = new URLSearchParams(location.search);
  if (params.get("resetPacks") !== "1") return;
  for (const name of [
    "ResourcePacksDB",
    "cubane-resource-packs",
    "cubane-atlas-cache",
  ])
    await deleteIndexedDB(name);
  params.delete("resetPacks");
  history.replaceState(
    null,
    "",
    location.pathname + (params.size ? "?" + params : "") + location.hash,
  );
}
async function start() {
  await clearSavedResourcePacksIfRequested();
  setBusy(true, "准备原版资源包…");
  canvas.addEventListener("rendererError", (e) => showError(e.detail));
  const resourcePacks = {
    vanilla_pack_fixed: async () => {
      const response = await fetch(
        `./packs/vanilla_pack_fixed.zip?v=${PACK_VERSION}`,
      );
      if (!response.ok)
        throw new Error(`资源包请求失败（HTTP ${response.status}）`);
      return response.blob();
    },
  };
  const performanceSettings = readRenderSettings();
  renderer = new SchematicRenderer(canvas, {}, resourcePacks, {
    maxPixelRatio: performanceSettings.maxPixelRatio,
    targetFPS: performanceSettings.targetFPS,
    chunkRenderOptions: performanceSettings,
    postProcessingOptions: { enableSSAO: performanceSettings.ssao },
    showGrid: true,
    showAxes: false,
    enableDragAndDrop: false,
    enableInteraction: false,
    singleSchematicMode: false,
    enableProgressBar: false,
    sidebarOptions: { enabled: false },
    resourcePackOptions: { showMissingPackNotice: false },
    backgroundColor: "#dfe6d7",
    cameraOptions: {
      position: [20, 20, 20],
      defaultCameraPreset: "perspective",
      preserveCameraOnUpdate: true,
    },
    callbacks: {
      onRendererInitialized: async (ready) => {
        renderer = ready;
        blueprints = new BlueprintLoader(renderer, { beforeReplace: () => inspector?.clear() });
        assets = new ItemAssets(renderer.cubane.getAssetLoader(), { iconBaseUrl: "./ui" });
        views = new ViewControls(renderer, toast);
        inspector = new BlockInspector(renderer, views, assets, showTab, toast);
        renderSettings = new RenderSettings(renderer, performanceSettings);
        performanceHUD = new PerformanceHUD(renderer);
        window.mcStudio = {
          renderer,
          views,
          inspector,
          renderSettings,
          performanceHUD,
          loadBlueprint,
        };
        await loadUrl(DEFAULT_SCHEMATIC);
      },
    },
  });
  window.mcRenderer = renderer;
}
window.addEventListener("pagehide", (e) => {
  if (e.persisted) return;
  const stopped = blueprints?.dispose();
  performanceHUD?.dispose();
  renderSettings?.dispose();
  inspector?.dispose();
  views?.dispose();
  assets?.dispose();
  if (stopped) stopped.finally(() => renderer?.dispose());
  else renderer?.dispose();
});
start().catch(showError);
