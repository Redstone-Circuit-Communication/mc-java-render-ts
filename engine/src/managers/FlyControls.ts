// managers/FlyControls.ts
// First-person fly controls using PointerLockControls for smooth camera movement

import * as THREE from "three";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";
import { EventEmitter } from "events";

export interface FlyControlsOptions {
	/** Movement speed in units per second */
	moveSpeed?: number;
	/** Sprint multiplier when holding Ctrl */
	sprintMultiplier?: number;
	/** Look sensitivity (mouse movement) */
	lookSensitivity?: number;
	/** Keybinds for movement */
	keybinds?: Partial<FlyControlsKeybinds>;
	/** Whether to create the default fly-mode overlay. */
	showOverlay?: boolean;
	/** Also accept arrow keys for horizontal movement. */
	allowArrowKeys?: boolean;
	/** Allow the wheel to adjust flight speed while the pointer is locked. */
	wheelSpeed?: boolean;
}

export interface FlyControlsKeybinds {
	forward: string;
	backward: string;
	left: string;
	right: string;
	up: string;
	down: string;
	sprint: string;
}

type ControlEvent = { type: "change" | "lock" | "unlock"; target: FlyControls };
type ControlListener = (event: ControlEvent) => void;

const DEFAULT_KEYBINDS: FlyControlsKeybinds = {
	forward: "KeyW",
	backward: "KeyS",
	left: "KeyA",
	right: "KeyD",
	up: "Space",
	down: "ShiftLeft",
	sprint: "ControlLeft",
};

const MIN_MOVE_SPEED = 0.1;
const MAX_MOVE_SPEED = 43.556;

/**
 * First-person fly controls for navigating 3D scenes.
 * Click to enter fly mode, ESC to exit.
 * WASD to move, Space/Shift for up/down, Ctrl to sprint, wheel to adjust speed.
 */
export class FlyControls extends EventEmitter {
	private _enabled = true;
	public isLocked: boolean = false;
	private disposed = false;

	private pointerLockControls: PointerLockControls;
	private camera: THREE.Camera;
	private domElement: HTMLElement;

	// Movement state
	private moveSpeed: number;
	private sprintMultiplier: number;
	private keybinds: FlyControlsKeybinds;

	// Input tracking
	private pressedKeys = new Set<string>();
	private movementStartedAt: number | null = null;
	private pointerChanged = false;
	// Accumulate yaw/pitch, rather than round-tripping quaternion -> Euler for
	// every mouse event. At the vertical poles that conversion loses a degree
	// of freedom and can change the heading on the following event.
	private lookEuler = new THREE.Euler(0, 0, 0, "YXZ");
	private lastLookQuaternion = new THREE.Quaternion(0, 0, 0, 0);
	private velocity = new THREE.Vector3();
	private direction = new THREE.Vector3();
	protected movementScale = new THREE.Vector3(1, 1, 1);
	private forward = new THREE.Vector3();
	private right = new THREE.Vector3();
	private movement = new THREE.Vector3();
	private readonly worldUp = new THREE.Vector3(0, 1, 0);
	private allowArrowKeys: boolean;
	private wheelSpeed: boolean;
	private eventListeners = new Map<ControlEvent["type"], Map<ControlListener, () => void>>();

	// UI elements
	private overlayElement: HTMLDivElement | null = null;

	constructor(camera: THREE.Camera, domElement: HTMLElement, options: FlyControlsOptions = {}) {
		super();
		this.camera = camera;
		this.domElement = domElement;

		// Apply options
		this.moveSpeed = options.moveSpeed ?? 10.89;
		this.sprintMultiplier = options.sprintMultiplier ?? 2;
		this.keybinds = { ...DEFAULT_KEYBINDS, ...options.keybinds };
		this.allowArrowKeys = options.allowArrowKeys ?? false;
		this.wheelSpeed = options.wheelSpeed ?? true;

		// Create PointerLockControls
		this.pointerLockControls = new PointerLockControls(camera, domElement);
		// Use Three.js for lock lifecycle only. Exactly one handler owns rotation,
		// without depending on event capture ordering or stopping other listeners.
		this.pointerLockControls.enabled = false;
		this.pointerLockControls.pointerSpeed = options.lookSensitivity ?? 1;
		// Stay outside Euler's pole singularity, including when looking straight up/down.
		this.pointerLockControls.minPolarAngle = 0.001;
		this.pointerLockControls.maxPolarAngle = Math.PI - 0.001;

		// Set up event listeners
		this.setupEventListeners();

		// Create overlay UI
		if (options.showOverlay !== false) this.createOverlay();
	}

	public get enabled(): boolean {
		return this._enabled;
	}

	public set enabled(enabled: boolean) {
		this._enabled = enabled && !this.disposed;
		this.pointerLockControls.enabled = false;
		if (!this._enabled) {
			this.onBlur();
			if (this.isLocked) this.unlock();
			this.setOverlayVisible(false);
		}
	}

	public get object(): THREE.Camera {
		return this.camera;
	}

	public set object(camera: THREE.Camera) {
		this.camera = camera;
		this.pointerLockControls.object = camera;
	}

	/** Three.js-style events remain available alongside EventEmitter's on/off API. */
	public addEventListener(type: ControlEvent["type"], listener: ControlListener): void {
		let listeners = this.eventListeners.get(type);
		if (!listeners) this.eventListeners.set(type, (listeners = new Map()));
		if (listeners.has(listener)) return;
		const callback = () => listener.call(this, { type, target: this });
		listeners.set(listener, callback);
		this.on(type, callback);
	}

	public removeEventListener(type: ControlEvent["type"], listener: ControlListener): void {
		const listeners = this.eventListeners.get(type);
		const callback = listeners?.get(listener);
		if (callback) this.off(type, callback);
		listeners?.delete(listener);
	}

	private setupEventListeners(): void {
		this.pointerLockControls.addEventListener("change", this.onPointerChange);
		// Pointer lock events
		this.pointerLockControls.addEventListener("lock", () => {
			if (!this.enabled) return;
			this.isLocked = true;
			this.showOverlay(false);
			this.emit("lock");
		});

		this.pointerLockControls.addEventListener("unlock", () => {
			this.isLocked = false;
			this.onBlur();
			// Only show overlay if fly controls are enabled
			if (this.enabled) {
				this.showOverlay(true);
			}
			this.emit("unlock");
		});

		// Click to lock
		this.domElement.addEventListener("click", this.onCanvasClick);
		// Own wheel input before OrbitControls and page scrolling can act on it.
		this.domElement.addEventListener("wheel", this.onWheel, { passive: false, capture: true });
		// Apply relative input once. Pointer-lock transitions / OS cursor warps
		// can report a viewport-sized delta in one event.
		document.addEventListener("mousemove", this.guardMouseDelta, true);

		// Keyboard events
		document.addEventListener("keydown", this.onKeyDown);
		document.addEventListener("keyup", this.onKeyUp);
		window.addEventListener("blur", this.onBlur);
		document.addEventListener("visibilitychange", this.onVisibilityChange);
	}

	private onPointerChange = (): void => {
		if (!this.enabled || this.pointerChanged) return;
		// Wake immediately, but notify camera/UI observers only once per frame.
		// The mouse handler still applies every valid delta without added lag.
		this.pointerChanged = true;
		this.emit("input");
	};

	private onBlur = (): void => {
		this.pressedKeys.clear();
		this.velocity.set(0, 0, 0);
		this.movementStartedAt = null;
		this.pointerChanged = false;
	};

	private onVisibilityChange = (): void => {
		if (document.hidden) this.onBlur();
	};

	private hasMovementInput(): boolean {
		return ["forward", "backward", "left", "right", "up", "down"].some((action) =>
			this.isPressed(this.keybinds[action as keyof FlyControlsKeybinds])
		);
	}

	private guardMouseDelta = (event: MouseEvent): void => {
		if (!this.enabled || !this.isLocked) return;
		// This handler owns look input; PointerLockControls still owns browser lock
		// lifecycle, speed settings and public events. Do not apply a delta twice.
		// A cursor-warp filter must not become weaker on a larger display. At
		// default sensitivity 256 pixels already represents a 29 degree turn.
		const limit = 256;
		if (
			!Number.isFinite(event.movementX) ||
			!Number.isFinite(event.movementY) ||
			Math.abs(event.movementX) > limit ||
			Math.abs(event.movementY) > limit
		)
			return;
		if (event.movementX === 0 && event.movementY === 0) return;
		if (!this.camera.quaternion.equals(this.lastLookQuaternion)) {
			// Synchronize on mode switches / externally positioned cameras only.
			this.lookEuler.setFromQuaternion(this.camera.quaternion, "YXZ");
		}
		const pointer = this.pointerLockControls;
		const sensitivity = 0.002 * pointer.pointerSpeed;
		this.lookEuler.y -= event.movementX * sensitivity;
		this.lookEuler.x = THREE.MathUtils.clamp(
			this.lookEuler.x - event.movementY * sensitivity,
			Math.PI / 2 - pointer.maxPolarAngle,
			Math.PI / 2 - pointer.minPolarAngle
		);
		this.camera.quaternion.setFromEuler(this.lookEuler);
		this.lastLookQuaternion.copy(this.camera.quaternion);
		pointer.dispatchEvent({ type: "change" });
	};

	private onWheel = (event: WheelEvent): void => {
		if (!this.enabled) return;
		event.preventDefault();
		event.stopImmediatePropagation();
		// While unlocked, keep the first-person view still; UI panels outside the
		// canvas retain normal scrolling. Disabling speed changes must not enable zoom.
		if (!this.isLocked || !this.wheelSpeed || !Number.isFinite(event.deltaY)) return;
		// Treat one wheel notch (~100 pixels / 3 lines) as a 20% change;
		// retain fractional trackpad deltas and bound accelerated page-wheel events.
		const unit = event.deltaMode === 1 ? 100 / 3 : event.deltaMode === 2 ? 100 : 1;
		const steps = THREE.MathUtils.clamp((-event.deltaY * unit) / 100, -4, 4);
		this.setMoveSpeed(this.moveSpeed * Math.pow(1.2, steps));
		this.emit("input");
	};

	private isPressed(binding: string): boolean {
		if (this.pressedKeys.has(binding)) return true;
		const other = { ShiftLeft: "ShiftRight", ControlLeft: "ControlRight" }[binding];
		return !!other && this.pressedKeys.has(other);
	}

	private movementKey(code: string): string {
		if (!this.allowArrowKeys) return code;
		switch (code) {
			case "ArrowUp":
				return this.keybinds.forward;
			case "ArrowDown":
				return this.keybinds.backward;
			case "ArrowLeft":
				return this.keybinds.left;
			case "ArrowRight":
				return this.keybinds.right;
			default:
				return code;
		}
	}

	private onCanvasClick = (): void => {
		if (this.enabled && !this.isLocked) {
			this.lock();
		}
	};

	private onKeyDown = (event: KeyboardEvent): void => {
		if (!this.enabled || !this.isLocked) return;
		if (
			event.target instanceof Element &&
			event.target.closest("input,textarea,select,[contenteditable]:not([contenteditable=false])")
		)
			return;

		const key = this.movementKey(event.code);
		const wasMoving = this.hasMovementInput();
		const alreadyPressed = this.pressedKeys.has(key);
		this.pressedKeys.add(key);
		if (!wasMoving && this.hasMovementInput()) this.movementStartedAt = performance.now();

		// Prevent default for movement keys
		if (
			Object.values(this.keybinds).some(
				(binding) =>
					binding === key ||
					(binding === "ShiftLeft" && key === "ShiftRight") ||
					(binding === "ControlLeft" && key === "ControlRight")
			)
		) {
			event.preventDefault();
			if (!alreadyPressed) this.emit("input");
		}
	};

	private onKeyUp = (event: KeyboardEvent): void => {
		this.pressedKeys.delete(this.movementKey(event.code));
		if (!this.hasMovementInput()) this.movementStartedAt = null;
	};

	private onOverlayClick = (): void => {
		if (this.enabled && !this.isLocked) {
			this.lock();
		}
	};

	private createOverlay(): void {
		this.overlayElement = document.createElement("div");
		Object.assign(this.overlayElement.style, {
			position: "absolute",
			top: "0",
			left: "0",
			width: "100%",
			height: "100%",
			display: "flex",
			alignItems: "center",
			justifyContent: "center",
			backgroundColor: "rgba(0, 0, 0, 0.5)",
			color: "white",
			fontFamily: "system-ui, -apple-system, sans-serif",
			fontSize: "18px",
			textAlign: "center",
			cursor: "pointer",
			zIndex: "900", // Lower than sidebar (1000) so UI panels appear above
			pointerEvents: "auto",
			opacity: "0",
			transition: "opacity 0.2s ease",
		});

		const content = document.createElement("div");
		content.innerHTML = `
			<div style="font-size: 24px; margin-bottom: 12px;">Click to Enter Fly Mode</div>
			<div style="font-size: 14px; color: rgba(255,255,255,0.7);">
				<div>WASD - Move</div>
				<div>Space - Up • Shift - Down</div>
				<div>Ctrl - Sprint • Scroll - Flight speed</div>
				<div>ESC - Exit</div>
			</div>
		`;
		this.overlayElement.appendChild(content);

		// Add click listener to overlay
		this.overlayElement.addEventListener("click", this.onOverlayClick);

		// Position relative to canvas
		const parent = this.domElement.parentElement;
		if (parent) {
			parent.style.position = "relative";
			parent.appendChild(this.overlayElement);
		}

		// Initially hidden
		this.showOverlay(false);
	}

	private showOverlay(visible: boolean): void {
		if (this.overlayElement) {
			this.overlayElement.style.opacity = visible ? "1" : "0";
			this.overlayElement.style.pointerEvents = visible ? "auto" : "none";
		}
	}

	/**
	 * Show or hide the fly controls overlay
	 * @param visible Whether the overlay should be visible
	 */
	public setOverlayVisible(visible: boolean): void {
		this.showOverlay(visible);
	}

	/**
	 * Lock the pointer and enter fly mode
	 */
	public lock(): void {
		if (this.enabled) {
			this.pointerLockControls.lock();
		}
	}

	/**
	 * Unlock the pointer and exit fly mode
	 */
	public unlock(): void {
		this.pointerLockControls.unlock();
	}

	/**
	 * Toggle pointer lock
	 */
	public toggle(): void {
		if (this.isLocked) {
			this.unlock();
		} else {
			this.lock();
		}
	}

	/**
	 * Update movement - call this every frame
	 */
	public update(deltaTime: number = 0): void {
		if (!this.enabled || !this.isLocked) return;
		let step = Number.isFinite(deltaTime) ? THREE.MathUtils.clamp(deltaTime, 0, 0.05) : 0;
		if (this.movementStartedAt !== null) {
			// An idle poll may be a second old. Only integrate time *after* keydown.
			step = Math.min(step, Math.max(0, (performance.now() - this.movementStartedAt) / 1000));
			this.movementStartedAt = null;
		}

		// Calculate movement direction
		this.direction.set(0, 0, 0);

		// Forward/Backward
		if (this.isPressed(this.keybinds.forward)) {
			this.direction.z -= 1;
		}
		if (this.isPressed(this.keybinds.backward)) {
			this.direction.z += 1;
		}

		// Left/Right (strafe)
		if (this.isPressed(this.keybinds.left)) {
			this.direction.x -= 1;
		}
		if (this.isPressed(this.keybinds.right)) {
			this.direction.x += 1;
		}

		// Up/Down (world space)
		if (this.isPressed(this.keybinds.up)) {
			this.direction.y += 1;
		}
		if (this.isPressed(this.keybinds.down)) {
			this.direction.y -= 1;
		}

		// Minecraft normalizes WASD on the horizontal plane; ascent/descent is independent.
		const horizontalLength = Math.hypot(this.direction.x, this.direction.z);
		if (horizontalLength > 1) {
			this.direction.x /= horizontalLength;
			this.direction.z /= horizontalLength;
		}

		// Apply sprint multiplier
		let speed = this.moveSpeed;
		if (this.isPressed(this.keybinds.sprint)) {
			speed *= this.sprintMultiplier;
		}

		// Calculate velocity
		this.velocity
			.copy(this.direction)
			.multiply(this.movementScale)
			.multiplyScalar(speed * step);

		// Get camera direction vectors
		// Camera-right is stable even at vertical pitch; projected look direction is not.
		this.right.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
		this.right.y = 0;
		this.right.normalize();
		this.forward.crossVectors(this.worldUp, this.right).normalize();

		// Apply movement in camera space
		this.movement.set(0, 0, 0);
		this.movement.addScaledVector(this.forward, -this.velocity.z);
		this.movement.addScaledVector(this.right, this.velocity.x);
		this.movement.y += this.velocity.y;

		// Update camera position
		this.camera.position.add(this.movement);

		// Emit change event
		const pointerChanged = this.pointerChanged;
		this.pointerChanged = false;
		if (this.movement.lengthSq() > 0 || pointerChanged) {
			this.emit("change");
		}
		// Keep polling while held, even if the first step is zero or keys cancel.
		if (this.hasMovementInput()) this.emit("input");
	}

	// Getters/Setters for settings

	public getMoveSpeed(): number {
		return this.moveSpeed;
	}

	public setMoveSpeed(speed: number): void {
		if (!Number.isFinite(speed)) return;
		this.moveSpeed = THREE.MathUtils.clamp(speed, MIN_MOVE_SPEED, MAX_MOVE_SPEED);
		this.emit("speedChange", this.moveSpeed);
	}

	public getSprintMultiplier(): number {
		return this.sprintMultiplier;
	}

	public setSprintMultiplier(multiplier: number): void {
		this.sprintMultiplier = multiplier;
	}

	public getKeybinds(): FlyControlsKeybinds {
		return { ...this.keybinds };
	}

	public setKeybinds(keybinds: Partial<FlyControlsKeybinds>): void {
		this.keybinds = { ...this.keybinds, ...keybinds };
	}

	/**
	 * Get the underlying PointerLockControls for advanced usage
	 */
	public getPointerLockControls(): PointerLockControls {
		return this.pointerLockControls;
	}

	/**
	 * Clean up resources
	 */
	public dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.enabled = false;
		// Remove event listeners
		this.domElement.removeEventListener("click", this.onCanvasClick);
		this.domElement.removeEventListener("wheel", this.onWheel, true);
		document.removeEventListener("mousemove", this.guardMouseDelta, true);
		document.removeEventListener("keydown", this.onKeyDown);
		document.removeEventListener("keyup", this.onKeyUp);
		window.removeEventListener("blur", this.onBlur);
		document.removeEventListener("visibilitychange", this.onVisibilityChange);
		this.pointerLockControls.removeEventListener("change", this.onPointerChange);

		// Unlock if locked
		if (this.isLocked) {
			this.unlock();
		}

		// Remove overlay and its click listener
		if (this.overlayElement) {
			this.overlayElement.removeEventListener("click", this.onOverlayClick);
			if (this.overlayElement.parentElement) {
				this.overlayElement.parentElement.removeChild(this.overlayElement);
			}
		}
		this.overlayElement = null;

		// Dispose PointerLockControls
		this.pointerLockControls.dispose();

		// Clear state
		this.pressedKeys.clear();
		this.eventListeners.clear();
		this.removeAllListeners();
	}
}
