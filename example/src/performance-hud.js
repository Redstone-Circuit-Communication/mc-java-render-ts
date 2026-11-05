import { FrameStats } from "@rsw/mc-java-render-ts";

export class PerformanceHUD {
  constructor(renderer, root = document.getElementById("performance-hud")) {
    this.renderer = renderer;
    this.root = root;
    this.stats = new FrameStats();
    this.loading = true;
    this.fps = root.querySelector("[data-fps]");
    this.low = root.querySelector("[data-low]");
    this.state = root.querySelector("[data-frame-state]");
    this.onFrame = ({ timestamp }) => {
      if (!this.loading && !document.hidden && !renderer.suspended)
        this.stats.record(timestamp);
    };
    this.onIdle = () => this.stats.idle();
    this.onVisibility = () => {
      this.stats.reset();
      this.refresh();
    };
    renderer.eventEmitter.on("frameRendered", this.onFrame);
    renderer.eventEmitter.on("renderIdle", this.onIdle);
    document.addEventListener("visibilitychange", this.onVisibility);
    // DOM text only: never request a render or keep an extra rAF loop alive.
    this.timer = setInterval(() => this.refresh(), 250);
    this.refresh();
  }
  setLoading(loading) {
    if (this.loading !== loading) this.stats.reset();
    this.loading = loading;
    this.refresh();
  }
  refresh() {
    const snapshot = this.stats.snapshot(performance.now());
    const paused = document.hidden || this.renderer.suspended;
    const unavailable = this.loading || paused;
    const text = (node, value) => {
      if (node.textContent !== value) node.textContent = value;
    };
    text(
      this.fps,
      unavailable
        ? "—"
        : snapshot.active && !snapshot.samples
          ? "—"
          : snapshot.fps.toFixed(0),
    );
    text(
      this.low,
      unavailable || snapshot.low === null ? "—" : snapshot.low.toFixed(0),
    );
    text(
      this.state,
      this.loading
        ? "加载中"
        : paused
          ? "已暂停"
          : !snapshot.active
            ? "空闲 · 按需渲染"
            : snapshot.low === null
              ? "1% Low 采样中"
              : "近 10 秒",
    );
    this.root.dataset.state = unavailable
      ? "paused"
      : snapshot.active
        ? "active"
        : "idle";
  }
  dispose() {
    clearInterval(this.timer);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.renderer.eventEmitter.off("frameRendered", this.onFrame);
    this.renderer.eventEmitter.off("renderIdle", this.onIdle);
  }
}
