import { STORAGE_KEY, RENDER_PRESETS, readRenderSettings, normalizeRenderSettings, applyRenderSettings } from "@rsw/mc-java-render-ts";
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
        controlsMs: "控制",
        highlightMs: "高亮",
        gizmoMs: "辅助框",
        visibilityMs: "区块筛选",
        submitMs: "绘制提交",
        measuredMs: "已测合计",
      };
      this.profileOutput.textContent = profile?.samples
        ? `${profile.samples} 帧 · 均值 / P95（ms）\n` +
          Object.entries(labels)
            .map(
              ([key, label]) =>
                `${label} ${profile.mean[key].toFixed(2)} / ${profile.p95[key].toFixed(2)}`,
            )
            .join("\n")
        : "等待采样：请移动相机。静止时按需渲染，不强制生成帧。";
      this.profileOutput.style.whiteSpace = "pre-line";
    }
    const stats = this.renderer.chunkVisibility.getStats();
    const format = (n) => Math.round(n).toLocaleString("zh-CN");
    document.getElementById("render-stats").textContent =
      `区块 ${format(stats.visibleChunks)} / ${format(stats.totalChunks)} · 三角形 ${format(stats.triangles)} · 材质批次 ${format(stats.drawCalls)}`;
    document.getElementById("render-resolution").textContent =
      `画布 ${this.renderer.canvas.width} × ${this.renderer.canvas.height} · 静止时按需渲染`;
  }
  dispose() {
    if (this.profileToggle?.checked)
      this.renderer.renderManager.setFrameProfilingEnabled(false);
    this.events.abort();
    clearInterval(this.timer);
  }
}
