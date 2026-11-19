import { Vector3, OrthographicCamera } from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { SchematicRenderer } from "./renderer/index.js";
import type { LoadedSchematic } from "./blueprint-loader.js";
import type { Position } from "./types.js";
const isOrthographic = (camera: import("three").Camera): camera is OrthographicCamera =>
	(camera as OrthographicCamera).isOrthographicCamera === true;
export type ViewMode = "orbit" | "first" | "ortho";
/** Who moves the camera in first-person mode: the built-in fly controls (pointer lock, WASD), or the host via setPose. */
export interface ModeOptions {
	input?: "builtin" | "host";
}
/** A framing the host computes itself (docs/UNIFIED_API.md, "Frames"): angles in radians, distance and halfHeight in blocks. */
export interface CameraFrame {
	yaw: number;
	pitch: number;
	/** Perspective: distance from the target. Orthographic: how far back the camera stands (does not change the picture). */
	distance?: number;
	/** Perspective: vertical field of view (radians). */
	fov?: number;
	/** Orthographic: half the visible height in blocks (at zoom 1). */
	halfHeight?: number;
}
/** First-person eye: position in world space, look direction as yaw (0 = towards +z, increasing towards +x) and pitch (> 0 up). */
export interface CameraPose {
	x: number;
	y: number;
	z: number;
	yaw: number;
	pitch: number;
}
/** Camera operations only. Buttons, keyboard shortcuts and axis UI belong to the host. */
export class CameraControls {
	readonly manager: SchematicRenderer["cameraManager"];
	mode: ViewMode = "orbit";
	distance = 20;
	/** First-person mode driven by the host (setPose) instead of the built-in fly controls. */
	hostInput = false;
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
	setMode(mode: ViewMode, options: ModeOptions = {}): void {
		const host = mode === "first" && options.input === "host";
		if ((mode === this.mode && host === this.hostInput) || !["orbit", "first", "ortho"].includes(mode)) return;
		if (this.orbitControls) this.orbitControls.enabled = true;
		this.hostInput = false;
		const target = this.target();
		this.distance = Math.max(1, this.camera.position.distanceTo(target));
		this.manager.disableFlyControls();
		this.manager.stopAutoOrbit();
		this.manager.stopAnimation();
		const preset = mode === "ortho" ? "isometric" : "perspective";
		if (this.manager.activeCameraPreset !== preset)
			this.manager.switchCameraPreset(preset, { preserveView: true, target });
		this.mode = mode;
		if (host) {
			// the host moves the camera: no orbit dragging, no pointer lock; the orbit target stays one block ahead of the eye
			this.hostInput = true;
			if (this.orbitControls) this.orbitControls.enabled = false;
		} else if (mode === "first") this.manager.enableFlyControls();
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
	/**
	 * A view for share links, `{ yaw, pitch, zoom }`, with the same conventions as the Bedrock package: `yaw` 0 puts the camera
 * on the target's +z side (south) and grows toward +x;
	 * a positive `pitch` looks down; `zoom` is the distance to the target (perspective) or `camera.zoom` (orthographic).
	 */
	getView(): { yaw: number; pitch: number; zoom: number } {
		const offset = this.camera.position.clone().sub(this.target());
		const dist = offset.length() || 1;
		return {
			yaw: Math.atan2(offset.x, offset.z),
			pitch: Math.asin(Math.max(-1, Math.min(1, offset.y / dist))),
			zoom: isOrthographic(this.camera) ? this.camera.zoom : dist,
		};
	}
	setView(view: { yaw: number; pitch: number; zoom: number }): void {
		if (![view.yaw, view.pitch, view.zoom].every(Number.isFinite)) return;
		if (this.mode === "first") this.setMode("orbit");
		this.manager.stopAnimation();
		const target = this.target();
		const pitch = Math.max(-1.55, Math.min(1.55, view.pitch));
		const dist = isOrthographic(this.camera)
			? Math.max(1, this.camera.position.distanceTo(target))
			: Math.max(0.5, view.zoom);
		const direction = new Vector3(
			Math.sin(view.yaw) * Math.cos(pitch),
			Math.sin(pitch),
			Math.cos(view.yaw) * Math.cos(pitch)
		);
		this.camera.position.copy(target).addScaledVector(direction, dist);
		this.camera.lookAt(target);
		if (isOrthographic(this.camera)) {
			this.camera.zoom = Math.max(0.05, view.zoom);
			this.camera.updateProjectionMatrix();
		}
		this.orbitControls?.update();
		this.renderer.invalidate();
	}
	/**
	 * Put the camera on a framing the host computed itself (the same picture in both renderers and in the host's own preview):
	 * keeps the current target, sets the field of view (perspective) or the visible height (orthographic). Leaves first person.
	 */
	setFrame(frame: CameraFrame): void {
		if (![frame.yaw, frame.pitch].every(Number.isFinite)) return;
		if (this.mode === "first") this.setMode("orbit");
		this.manager.stopAnimation();
		const cam = this.camera;
		const target = this.target();
		const pitch = Math.max(-1.55, Math.min(1.55, frame.pitch));
		const direction = new Vector3(Math.sin(frame.yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(frame.yaw) * Math.cos(pitch));
		const current = Math.max(0.05, cam.position.distanceTo(target));
		if (isOrthographic(cam)) {
			const h = frame.halfHeight;
			if (h !== undefined && Number.isFinite(h) && h > 0) {
				const aspect = (cam.right - cam.left) / (cam.top - cam.bottom || 1) || 1;
				cam.top = h;
				cam.bottom = -h;
				cam.left = -h * aspect;
				cam.right = h * aspect;
				cam.zoom = 1;
			}
		} else if (frame.fov !== undefined && Number.isFinite(frame.fov) && frame.fov > 0) {
			(cam as import("three").PerspectiveCamera).fov = (frame.fov * 180) / Math.PI;
		}
		const distance = frame.distance !== undefined && Number.isFinite(frame.distance) && frame.distance > 0 ? frame.distance : current;
		if (this.orbitControls) this.orbitControls.minDistance = Math.min(this.orbitControls.minDistance, distance);
		cam.position.copy(target).addScaledVector(direction, distance);
		cam.lookAt(target);
		(cam as import("three").PerspectiveCamera | OrthographicCamera).updateProjectionMatrix();
		this.orbitControls?.update();
		this.renderer.invalidate();
	}
	/** The framing as setFrame takes it, plus the projection. */
	getFrame(): Required<CameraFrame> & { ortho: boolean } {
		const cam = this.camera;
		const offset = cam.position.clone().sub(this.target());
		const distance = offset.length() || 1;
		const ortho = isOrthographic(cam);
		const fov = ortho ? 0 : ((cam as import("three").PerspectiveCamera).fov * Math.PI) / 180;
		return {
			yaw: Math.atan2(offset.x, offset.z),
			pitch: Math.asin(Math.max(-1, Math.min(1, offset.y / distance))),
			distance,
			fov,
			halfHeight: ortho ? (cam.top - cam.bottom) / (2 * cam.zoom) : distance * Math.tan(fov / 2),
			ortho,
		};
	}
	/** First person driven by the host (`setMode("first", { input: "host" })`): put the eye at `pose`. */
	setPose(pose: CameraPose): void {
		if (![pose.x, pose.y, pose.z, pose.yaw, pose.pitch].every(Number.isFinite)) return;
		const pitch = Math.max(-1.55, Math.min(1.55, pose.pitch));
		const direction = new Vector3(Math.sin(pose.yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(pose.yaw) * Math.cos(pitch));
		const cam = this.camera;
		cam.position.set(pose.x, pose.y, pose.z);
		const ahead = cam.position.clone().add(direction);
		cam.lookAt(ahead);
		this.orbitControls?.target.copy(ahead); // OrbitControls.update() looks at its target: keep it straight ahead
		this.distance = 1;
		this.renderer.invalidate();
	}
	/** The eye position and look direction (any mode). */
	getPose(): CameraPose {
		const cam = this.camera;
		const d = cam.getWorldDirection(new Vector3());
		return { x: cam.position.x, y: cam.position.y, z: cam.position.z, yaw: Math.atan2(d.x, d.z), pitch: Math.asin(Math.max(-1, Math.min(1, d.y))) };
	}
	/** Must be called from a user gesture (browser Pointer Lock restriction). */
	lock(): void {
		this.manager.flyControls?.lock();
	}
	unlock(): void {
		this.manager.flyControls?.unlock();
	}
}
