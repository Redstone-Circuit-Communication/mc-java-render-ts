import { Vector3, OrthographicCamera } from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { SchematicRenderer } from "./renderer/index.js";
import type { LoadedSchematic } from "./blueprint-loader.js";
import type { Position } from "./types.js";
const isOrthographic = (camera: import("three").Camera): camera is OrthographicCamera =>
	(camera as OrthographicCamera).isOrthographicCamera === true;
export type ViewMode = "orbit" | "first" | "ortho";
/** Camera operations only. Buttons, keyboard shortcuts and axis UI belong to the host. */
export class CameraControls {
	readonly manager: SchematicRenderer["cameraManager"];
	mode: ViewMode = "orbit";
	distance = 20;
	constructor(readonly renderer: SchematicRenderer) {
		this.manager = renderer.cameraManager;
		this.manager.cameraOptions.preserveCameraOnUpdate = true;
		this.manager.initializeFlyControls({
			showOverlay: false,
			moveSpeed: 10.89,
			sprintMultiplier: 2,
			lookSensitivity: 0.8,
		});
	}
	get camera() {
		return this.manager.activeCamera.camera;
	}
	get locked(): boolean {
		return this.manager.isFlyControlsLocked();
	}
	private get orbitControls(): OrbitControls | undefined {
		const controls = this.manager.activeControls;
		return controls && "target" in controls ? (controls as OrbitControls) : undefined;
	}
	target(): Vector3 {
		if (this.mode !== "first" && this.orbitControls) return this.orbitControls.target.clone();
		return this.camera.position
			.clone()
			.addScaledVector(this.camera.getWorldDirection(new Vector3()), this.distance);
	}
	setMode(mode: ViewMode): void {
		if (mode === this.mode || !["orbit", "first", "ortho"].includes(mode)) return;
		const target = this.target();
		this.distance = Math.max(1, this.camera.position.distanceTo(target));
		this.manager.disableFlyControls();
		this.manager.stopAutoOrbit();
		this.manager.stopAnimation();
		const preset = mode === "ortho" ? "isometric" : "perspective";
		if (this.manager.activeCameraPreset !== preset)
			this.manager.switchCameraPreset(preset, { preserveView: true, target });
		this.mode = mode;
		if (mode === "first") this.manager.enableFlyControls();
		this.renderer.renderManager?.updateCamera(this.camera);
		this.renderer.invalidate();
	}
	async fit(): Promise<void> {
		if (this.mode === "first") this.setMode("orbit");
		this.manager.stopAnimation();
		if (isOrthographic(this.camera)) {
			this.camera.zoom = 1;
			this.camera.updateProjectionMatrix();
		}
		await this.manager.focusOnSchematics({
			animationDuration: 0,
			preserveCamera: false,
			padding: 0.15,
		});
		this.renderer.invalidate();
	}
	toggleGrid(): boolean {
		const scene = this.renderer.sceneManager;
		scene.showGrid = !scene.showGrid;
		this.renderer.invalidate();
		return scene.showGrid;
	}
	align(direction: Position): void {
		if (this.mode === "first") this.setMode("orbit");
		this.manager.stopAnimation();
		if (this.orbitControls) {
			this.orbitControls.minPolarAngle = 0;
			this.orbitControls.maxPolarAngle = Math.PI;
		}
		this.manager.snapToDirection(direction, true);
		this.renderer.invalidate();
	}
	focusBlock(schematic: LoadedSchematic, position: Position): void {
		if (this.mode === "first") this.setMode("orbit");
		this.manager.stopAnimation();
		const target = schematic.group.localToWorld(new Vector3(...position));
		const direction = this.camera.getWorldDirection(new Vector3()).negate();
		this.camera.position.copy(target).addScaledVector(direction, 8);
		this.camera.lookAt(target);
		this.orbitControls?.target.copy(target);
		if (isOrthographic(this.camera)) {
			this.camera.zoom = (this.camera.top - this.camera.bottom) / 7;
			this.camera.updateProjectionMatrix();
		}
		this.orbitControls?.update();
		this.renderer.invalidate();
	}
	/** Must be called from a user gesture (browser Pointer Lock restriction). */
	lock(): void {
		this.manager.flyControls?.lock();
	}
	unlock(): void {
		this.manager.flyControls?.unlock();
	}
}
