import { createWorkshopRenderer, countLitematicMaterials, BlueprintLoader, ItemAssets, nameFor, filterMaterials, materialsToCsv, materialsToTsv, captureScreenshot, readRenderSettings, setLocale } from "@rsw/mc-java-render-ts";
import { t, applyI18n, setLang, lang, onLangChange } from "./i18n.js";
import { ViewControls } from "./view-controls.js";
import { BlockInspector } from "./block-inspector.js";
import { RenderSettings } from "./render-settings.js";
import { PerformanceHUD } from "./performance-hud.js";
const $ = (id) => document.getElementById(id),
  canvas = $("canvas");
let blueprints;
let previewReason = "";
/** What the status line and the material summary show, kept so they can be redrawn in another language. */
let statusKey = "status.starting",
  summary = null;
/**
 * Where the example's own files live: Vite's `base` (`EXAMPLE_BASE` when building, `./` otherwise). Paths written as
 * `./…` (the demo list, the default structure) are looked up under it.
 */
const BASE = import.meta.env.BASE_URL;
const assetUrl = (path) => (path.startsWith("./") ? BASE + path.slice(2) : path);
const DEFAULT_SCHEMATIC = "./schematics/inspection-demo.litematic",
  PACK_VERSION = "minecraft-26.3",
  // The game's own client jar for Minecraft 26.3, downloaded by the visitor's browser from Mojang (41 MB, then cached).
  // Nothing from Minecraft is bundled with the example. The URL is content-addressed and never changes.
  MINECRAFT_ASSETS = "https://piston-data.mojang.com/v1/objects/e877b6a07acd633fb3bb475002175cec036e7b87/client.jar";
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
function setStatus(key) {
  statusKey = key;
  $("scene-status").textContent = t(key);
}
function renderSummary() {
  if (!summary) return;
  $("materials-status").textContent = t("materials.summary", { regions: summary.regions });
  $("scene-dimensions").textContent = summary.dims ? t("scene.dimensions", { dims: summary.dims }) : t("status.preview");
  $("total-blocks").textContent = summary.blocks.toLocaleString(lang());
  $("total-types").textContent = summary.kinds.toLocaleString(lang());
}
function setBusy(value, message = t("busy.building")) {
  busy = value;
  performanceHUD?.setLoading(value);
  canvas.setAttribute("aria-busy", String(value));
  $("loading-card").hidden = !value;
  $("loading-card").classList.remove("error");
  $("loading-title").textContent = t("loading.title");
  $("loading-message").textContent = message;
  setStatus(value ? "status.loading" : previewReason ? "status.preview" : "status.ready");
  for (const b of document.querySelectorAll(
    "[data-view],#open-file,#fit-view,#toggle-grid,#take-screenshot,#demo-select,#axis-buttons button",
  ))
    b.disabled = value || (Boolean(previewReason) && !["open-file", "demo-select"].includes(b.id));
  $("copy-materials").disabled = $("export-materials").disabled =
    value || !allMaterials.length;
  $("container-select").disabled = value || !inspector?.targets.length;
}
function showError(error) {
  console.error(error);
  setBusy(false);
  setStatus("status.failed");
  if (renderer?.schematicManager?.getAllSchematics().length) {
    toast(t("toast.loadFailed", { message: error.message }));
    return;
  }
  $("loading-card").hidden = false;
  $("loading-card").classList.add("error");
  $("loading-title").textContent = t("loading.failedTitle");
  $("loading-message").textContent = error.message;
  if (!views && !previewReason)
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
  $("filtered-count").textContent = t("materials.kinds", { count: items.length });
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = allMaterials.length
      ? t("materials.noMatch")
      : t("materials.empty");
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
    quantity.textContent = item.count.toLocaleString(lang());
    const stacks = document.createElement("div");
    stacks.className = "material-stacks";
    stacks.textContent = t("materials.stacks", { stacks: Math.floor(item.count / 64), rest: item.count % 64 });
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
    toast(t("toast.copied"));
  } catch {
    toast(t("toast.copyFailed"));
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
    `${basename(currentFilename)}-${t("file.materials")}.csv`,
  );
  toast(t("toast.exported"));
});
$("take-screenshot").addEventListener("click", async () => {
  try {
    download(await captureScreenshot(renderer), `${basename(currentFilename)}-${t("file.preview")}.png`);
    toast(t("toast.shot"));
  } catch (error) { toast(t("toast.shotFailed", { message: error.message })); }
});
async function readMaterialPreview(buffer, filename) {
  if (!/\.litematic$/i.test(filename)) throw new Error(t("error.previewFormat"));
  return countLitematicMaterials(buffer);
}
async function loadBlueprint(buffer, filename) {
  setBusy(true, t("busy.reading"));
  if (views?.locked) views.manager.flyControls.unlock();
  try {
    const result = previewReason
      ? await readMaterialPreview(buffer, filename)
      : await blueprints.load(buffer, filename);
    const schematic = result.schematic;
    allMaterials = result.materials;
    currentFilename = filename;
    $("scene-name").textContent = basename(filename);
    $("scene-name").title = filename;
    document.querySelector(".file-extension").textContent =
      "." + filename.split(".").at(-1);
    $("material-search").value = "";
    $("material-count-badge").textContent = allMaterials.length;
    summary = {
      regions: result.regionCount,
      dims: schematic ? schematic.getTightDimensions().join(" × ") : null,
      blocks: allMaterials.reduce((n, m) => n + m.count, 0),
      kinds: allMaterials.length,
    };
    renderSummary();
    renderMaterials();
    inspector?.indexContainers();
    await views?.fit();
    setBusy(false);
    if (previewReason) {
      $("loading-card").hidden = false;
      $("loading-title").textContent = t("loading.no3d");
      $("loading-message").textContent = t("loading.no3dMessage", { reason: previewReason });
    } else {
      renderer.invalidate();
    }
  } catch (error) {
    showError(error);
    throw error;
  }
}
async function loadUrl(url) {
  setBusy(true, t("busy.fetching"));
  try {
    const response = await fetch(assetUrl(url));
    if (!response.ok)
      throw new Error(t("error.request", { status: response.status }));
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
    toast(t("toast.pickFile"));
    return;
  }
  setBusy(true, t("busy.local"));
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
    r.onerror = () => reject(r.error ?? new Error(t("error.clear", { name })));
    r.onblocked = () =>
      reject(new Error(t("error.blocked")));
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
/** The renderer keeps packs in IndexedDB by name: when the example's packs change, drop the ones cached by an older version. */
async function clearOutdatedResourcePacks() {
  const key = "example-pack-version";
  try {
    if (localStorage.getItem(key) === PACK_VERSION) return;
    for (const name of ["ResourcePacksDB", "cubane-resource-packs", "cubane-atlas-cache"]) await deleteIndexedDB(name);
    localStorage.setItem(key, PACK_VERSION);
  } catch {
    // storage unavailable (private mode): nothing cached to clear
  }
}
async function start() {
  await clearSavedResourcePacksIfRequested();
  await clearOutdatedResourcePacks();
  setBusy(true, t("busy.assets"));
  const performanceSettings = readRenderSettings();
  try {
    renderer = await createWorkshopRenderer({
      canvas,
      resourcePackUrl: MINECRAFT_ASSETS,
      resourcePackName: PACK_VERSION,
      rendererOptions: {
        maxPixelRatio: performanceSettings.maxPixelRatio,
        targetFPS: performanceSettings.targetFPS,
        chunkRenderOptions: performanceSettings,
        postProcessingOptions: { enableSSAO: performanceSettings.ssao },
        backgroundColor: "#dfe6d7",
        cameraOptions: {
          position: [20, 20, 20],
          defaultCameraPreset: "perspective",
          preserveCameraOnUpdate: true,
        },
      },
    });
  } catch (error) {
    previewReason = error instanceof Error ? error.message : String(error);
    await loadUrl(DEFAULT_SCHEMATIC);
    return;
  }
  blueprints = new BlueprintLoader(renderer, { beforeReplace: () => inspector?.clear() });
  assets = new ItemAssets(renderer.cubane.getAssetLoader(), { iconBaseUrl: assetUrl("./ui"), renderer });
  views = new ViewControls(renderer, toast);
  inspector = new BlockInspector(renderer, views, assets, showTab, toast);
  renderSettings = new RenderSettings(renderer, performanceSettings);
  performanceHUD = new PerformanceHUD(renderer);
  window.mcStudio = { renderer, views, inspector, renderSettings, performanceHUD, loadBlueprint };
  await loadUrl(DEFAULT_SCHEMATIC);
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
// Language: English unless the browser or the visitor prefers Chinese. The library's own text (block names, container
// titles, redstone readouts) follows the same choice.
setLocale(lang());
applyI18n();
$("lang-toggle").addEventListener("click", () => setLang(lang() === "en" ? "zh-CN" : "en"));
onLangChange((next) => {
  setLocale(next);
  setStatus(statusKey);
  renderSummary();
  renderMaterials();
  views?.syncFlightUI();
  inspector?.refresh();
  renderSettings?.refresh?.();
});
start().catch(showError);
