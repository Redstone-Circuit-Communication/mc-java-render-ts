import { CameraControls } from "@rsw/mc-java-render-ts";
import { Vector3, Quaternion } from "three";
const LABELS = {
  orbit: "透视 · 环绕视角",
  first: "第一人称 · 自由飞行",
  ortho: "正交 · 等比例投影",
};
const AXES = [
  { label: "X", direction: [1, 0, 0], color: "#bd7d6a" },
  { label: "−X", direction: [-1, 0, 0], color: "#bd7d6a" },
  { label: "Y", direction: [0, 1, 0], color: "#80a35c" },
  { label: "−Y", direction: [0, -1, 0], color: "#80a35c" },
  { label: "Z", direction: [0, 0, 1], color: "#789eaa" },
  { label: "−Z", direction: [0, 0, -1], color: "#789eaa" },
];
export class ViewControls extends CameraControls {
  constructor(renderer, notify) {
    super(renderer);
    this.renderer = renderer;
    this.manager = renderer.cameraManager;
    this.notify = notify;
    this.mode = "orbit";
    this.distance = 20;
    this.frame = null;
    this.lastAxesQuaternion = new Quaternion(0, 0, 0, 0);
    this.axesInverse = new Quaternion();
    this.axesPoint = new Vector3();
    this.axisProjection = AXES.map((axis, i) => ({
      ...axis,
      i,
      vector: new Vector3(),
    }));
    this.axisRings = Array.from({ length: 3 }, (_, axis) =>
      Array.from({ length: 65 }, (_, step) => {
        const point = new Vector3();
        point.setComponent((axis + 1) % 3, Math.cos((step * Math.PI) / 32));
        point.setComponent((axis + 2) % 3, Math.sin((step * Math.PI) / 32));
        return point;
      }),
    );
    this.events = new AbortController();
    const signal = this.events.signal;
    this.update = () => {
      if (this.frame !== null) return;
      this.frame = requestAnimationFrame(() => {
        this.frame = null;
        this.drawAxes();
      });
    };
    for (const event of ["propertyChanged", "cameraMove", "cameraChanged"])
      this.manager.on(event, this.update);
    this.flightChanged = () => this.syncFlightUI();
    this.speedChanged = () => this.syncFlightSpeed();
    this.manager.flyControls.on("speedChange", this.speedChanged);
    this.manager.on("flyControlsLocked", this.flightChanged);
    this.manager.on("flyControlsUnlocked", this.flightChanged);
    document.addEventListener(
      "pointerlockerror",
      () => {
        notify("无法锁定鼠标，请再次点击进入，或使用环绕视角。");
        this.syncFlightUI();
      },
      { signal },
    );
    document.querySelectorAll("[data-view]").forEach((b) =>
      b.addEventListener("click", () => this.setMode(b.dataset.view), {
        signal,
      }),
    );
    document.getElementById("resume-flight").addEventListener(
      "click",
      () => {
        if (!("requestPointerLock" in renderer.canvas)) {
          notify("当前浏览器不支持鼠标锁定，请使用环绕或正交视角。");
          return;
        }
        this.manager.flyControls.lock();
      },
      { signal },
    );
    document
      .getElementById("fit-view")
      .addEventListener("click", () => this.fit(), { signal });
    document
      .getElementById("toggle-grid")
      .addEventListener("click", () => this.toggleGrid(), { signal });
    document.addEventListener(
      "keydown",
      (e) => {
        if (
          renderer.canvas.getAttribute("aria-busy") === "true" ||
          e.target.closest("input,textarea,select,[contenteditable=true]") ||
          e.ctrlKey ||
          e.metaKey ||
          e.altKey
        )
          return;
        const mode = { Digit1: "orbit", Digit2: "first", Digit3: "ortho" }[
          e.code
        ];
        if (mode) {
          e.preventDefault();
          this.setMode(mode);
        }
        if (e.code === "KeyF") {
          e.preventDefault();
          this.fit();
        }
        if (e.code === "KeyG") {
          e.preventDefault();
          this.toggleGrid();
        }
      },
      { signal },
    );
    const parent = document.getElementById("axis-buttons");
    this.axisButtons = AXES.map((axis) => {
      const b = document.createElement("button");
      b.textContent = axis.label;
      b.setAttribute("aria-label", `从 ${axis.label} 轴观察`);
      b.title = `从 ${axis.label} 轴观察`;
      b.style.background = axis.color;
      b.addEventListener("click", () => this.align(axis.direction), { signal });
      parent.append(b);
      return b;
    });
    this.resizeObserver = new ResizeObserver(this.update);
    this.resizeObserver.observe(renderer.canvas);
    this.syncFlightUI();
    this.update();
  }
  setMode(mode) {
    super.setMode(mode);
    this.syncFlightUI();
    this.update();
  }
  syncFlightUI() {
    document
      .querySelectorAll("[data-view]")
      .forEach((b) =>
        b.setAttribute("aria-pressed", String(b.dataset.view === this.mode)),
      );
    document.getElementById("view-label").textContent = LABELS[this.mode];
    document.getElementById("crosshair").hidden = !this.locked;
    document.getElementById("resume-flight").hidden =
      this.mode !== "first" || this.locked;
    document.getElementById("control-hint").innerHTML =
      this.mode === "first"
        ? "<span><b>WASD</b> 移动</span><span><b>Space / Shift</b> 升降</span><span><b>Ctrl</b> 加速</span><span><b>滚轮</b> 调速 <b id=flight-speed></b></span><span><b>左键</b> 查看</span><span><b>Esc</b> 释放鼠标</span>"
        : "<span><b>左键单击</b> 查看方块 / 实体</span><span><b>拖动</b> 旋转</span><span><b>右键</b> 平移</span><span><b>滚轮</b> 缩放</span>";
    this.syncFlightSpeed();
  }
  syncFlightSpeed() {
    const label = document.getElementById("flight-speed");
    if (label)
      label.textContent = `${this.manager.flyControls.getMoveSpeed().toFixed(2)} 格/秒`;
  }
  async fit() { await super.fit(); this.update(); }
  toggleGrid() {
    const visible = super.toggleGrid();
    document.getElementById("toggle-grid").setAttribute("aria-pressed", String(visible));
  }
  align(direction) { super.align(direction); this.update(); }
  focusBlock(schematic, position) { super.focusBlock(schematic, position); this.update(); }
  drawAxes() {
    if (this.lastAxesQuaternion?.equals(this.camera.quaternion)) return;
    this.lastAxesQuaternion.copy(this.camera.quaternion);
    const ctx = document.getElementById("axis-canvas").getContext("2d");
    if (!ctx) return;
    const inverse = this.axesInverse.copy(this.camera.quaternion).invert();
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    ctx.clearRect(0, 0, 128, 128);
    const fill = ctx.createRadialGradient(52, 44, 8, 64, 64, 45);
    fill.addColorStop(0, "#fcfdf5cf");
    fill.addColorStop(1, "#c9d4bf60");
    ctx.fillStyle = fill;
    ctx.strokeStyle = "#b6c4a780";
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.arc(64, 64, 39, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    for (let axis = 0; axis < 3; axis++) {
      ctx.beginPath();
      ctx.strokeStyle = "#aab99a65";
      for (let step = 0; step <= 64; step++) {
        const v = this.axesPoint
          .copy(this.axisRings[axis][step])
          .applyQuaternion(inverse);
        const x = 64 + v.x * 39,
          y = 64 - v.y * 39;
        if (step === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    const projected = this.axisProjection;
    for (const axis of projected)
      axis.vector.fromArray(axis.direction).applyQuaternion(inverse);
    projected.sort((a, b) => a.vector.z - b.vector.z);
    for (const axis of projected) {
      const { x, y, z } = axis.vector,
        px = 64 + x * 43,
        py = 64 - y * 43;
      ctx.beginPath();
      ctx.moveTo(64, 64);
      ctx.lineTo(px, py);
      ctx.strokeStyle = axis.color;
      ctx.globalAlpha = z < 0 ? 0.35 : 0.8;
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.globalAlpha = 1;
      const b = this.axisButtons[axis.i];
      b.style.left = `${px}px`;
      b.style.top = `${py}px`;
      b.style.opacity = z < 0 ? ".55" : "1";
      b.style.zIndex = String(Math.round((z + 1) * 10));
    }
    ctx.beginPath();
    ctx.arc(64, 64, 3, 0, Math.PI * 2);
    ctx.fillStyle = "#8e9f7d";
    ctx.fill();
  }
  dispose() {
    this.events.abort();
    this.resizeObserver.disconnect();
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    for (const e of ["propertyChanged", "cameraMove", "cameraChanged"])
      this.manager.off(e, this.update);
    this.manager.off("flyControlsLocked", this.flightChanged);
    this.manager.off("flyControlsUnlocked", this.flightChanged);
    this.manager.flyControls?.off("speedChange", this.speedChanged);
    document.getElementById("axis-buttons").replaceChildren();
  }
}
