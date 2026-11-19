import { STORAGE_KEY, RENDER_PRESETS, readRenderSettings, normalizeRenderSettings, applyRenderSettings } from "@rsw/mc-java-render-ts";
import { t, lang } from "./i18n.js";
export { RENDER_PRESETS, readRenderSettings, normalizeRenderSettings };
export class RenderSettings {
  constructor(renderer, initial = readRenderSettings()) {
    this.renderer = renderer;
    this.settings = normalizeRenderSettings(initial);
    this.events = new AbortController();
    const signal = this.events.signal;
    this.panel = document.getElementById("render-settings");
    this.preset = document.getElementById("render-preset");
    this.inputs = Object.fromEntries(
      Object.keys(this.settings).map((key) => [
        key,
        document.getElementById(`render-${key}`),
      ]),
    );
    for (const [key, input] of Object.entries(this.inputs))
      input.addEventListener(
        "change",
        () => {
          this.settings[key] =
            input.type === "checkbox"
              ? input.checked
              : input.value === ""
                ? RENDER_PRESETS.balanced[key]
                : Number(input.value);
          this.apply();
        },
        { signal },
      );
    this.preset.addEventListener(
      "change",
      () => {
        if (!RENDER_PRESETS[this.preset.value]) return;
        this.settings = { ...RENDER_PRESETS[this.preset.value] };
        this.apply();
      },
      { signal },
    );
    this.panel.addEventListener("toggle", () => this.updateStats(), { signal });
    this.panel.addEventListener(
      "keydown",
      (e) => {
        if (e.key === "Escape") {
          this.panel.open = false;
          this.panel.querySelector("summary").focus();
        }
      },
      { signal },
    );
    this.profileToggle = document.getElementById("profile-cpu");
    this.profileOutput = document.getElementById("cpu-profile");
    this.profileHelp = document.getElementById("cpu-profile-help");
    this.profileToggle?.addEventListener(
      "change",
      () => {
        renderer.renderManager.setFrameProfilingEnabled(
          this.profileToggle.checked,
        );
        this.profileOutput.hidden = this.profileHelp.hidden =
          !this.profileToggle.checked;
        this.updateStats();
      },
      { signal },
    );
    this.panel.querySelector("fieldset").disabled = false;
    this.apply(false);
    // No animation frame / render request just to refresh the settings readout.
    this.timer = setInterval(() => {
      if (this.panel.open) this.updateStats();
    }, 1000);
  }
  apply(save = true) {
    const settings = (this.settings = normalizeRenderSettings(this.settings));
    applyRenderSettings(this.renderer, settings);
    for (const [key, input] of Object.entries(this.inputs)) {
      if (input.type === "checkbox") input.checked = settings[key];
      else input.value = String(settings[key]);
    }
    this.preset.value =
      Object.keys(RENDER_PRESETS).find((key) =>
        Object.entries(RENDER_PRESETS[key]).every(
          ([k, v]) => settings[k] === v,
        ),
      ) ?? "custom";
    if (save)
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      } catch {
        /* Private mode: settings still apply this session. */
      }
    this.updateStats();
  }
  updateStats() {
    if (this.profileToggle?.checked) {
      const profile = this.renderer.renderManager.getFrameProfile();
      const labels = {
        controlsMs: t("profile.controls"),
        highlightMs: t("profile.highlight"),
        gizmoMs: t("profile.gizmo"),
        visibilityMs: t("profile.visibility"),
        submitMs: t("profile.submit"),
        measuredMs: t("profile.measured"),
      };
      this.profileOutput.textContent = profile?.samples
        ? `${t("profile.header", { samples: profile.samples })}\n` +
          Object.entries(labels)
            .map(
              ([key, label]) =>
                `${label} ${profile.mean[key].toFixed(2)} / ${profile.p95[key].toFixed(2)}`,
            )
            .join("\n")
        : t("profile.waiting");
      this.profileOutput.style.whiteSpace = "pre-line";
    }
    const stats = this.renderer.chunkVisibility.getStats();
    const format = (n) => Math.round(n).toLocaleString(lang());
    document.getElementById("render-stats").textContent =
      t("stats.chunks", { visible: format(stats.visibleChunks), total: format(stats.totalChunks), triangles: format(stats.triangles), calls: format(stats.drawCalls) });
    document.getElementById("render-resolution").textContent =
      t("stats.canvas", { w: this.renderer.canvas.width, h: this.renderer.canvas.height });
  }
  /** Redraws the readouts after a language switch. */
  refresh() {
    this.updateStats();
  }
  dispose() {
    if (this.profileToggle?.checked)
      this.renderer.renderManager.setFrameProfilingEnabled(false);
    this.events.abort();
    clearInterval(this.timer);
  }
}
