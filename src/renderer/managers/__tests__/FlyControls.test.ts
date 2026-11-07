import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Euler, PerspectiveCamera, Vector3 } from "three";
import { FlyControls } from "../FlyControls";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

let now = 0;
beforeEach(() => {
	now = 0;
	vi.spyOn(performance, "now").mockImplementation(() => now);
});
function tick(controls: FlyControls, delta = 0.02, wallSeconds = delta) {
	now += wallSeconds * 1000;
	controls.update(delta);
}

const controlsToDispose: FlyControls[] = [];
function fixture() {
	const camera = new PerspectiveCamera();
	const canvas = document.createElement("canvas");
	document.body.append(canvas);
	const controls = new FlyControls(camera, canvas, { showOverlay: false });
	controlsToDispose.push(controls);
	const pointer = controls.getPointerLockControls();
	vi.spyOn(pointer, "unlock").mockImplementation(() => {
		pointer.isLocked = false;
		pointer.dispatchEvent({ type: "unlock" });
	});
	pointer.isLocked = true;
	pointer.dispatchEvent({ type: "lock" });
	return { camera, canvas, controls, pointer };
}
function move(x: number, y: number) {
	const event = new MouseEvent("mousemove");
	Object.defineProperties(event, { movementX: { value: x }, movementY: { value: y } });
	document.dispatchEvent(event);
}
function key(code: string, type = "keydown") {
	document.dispatchEvent(new KeyboardEvent(type, { code, cancelable: true }));
}
afterEach(() => {
	for (const controls of controlsToDispose.splice(0)) controls.dispose();
	vi.restoreAllMocks();
	document.body.replaceChildren();
});

describe("Minecraft-style fly controls", () => {
	it("applies each canvas mouse event once and leaves other input listeners observable", () => {
		const { camera, canvas, pointer, controls } = fixture();
		const observed = vi.fn();
		canvas.addEventListener("mousemove", observed);
		for (let i = 0; i < 200; i++) {
			controls.enabled = true;
			expect(pointer.enabled).toBe(false);
			const event = new MouseEvent("mousemove", { bubbles: true });
			Object.defineProperties(event, { movementX: { value: 2 }, movementY: { value: 1 } });
			canvas.dispatchEvent(event);
			tick(controls);
		}
		expect(observed).toHaveBeenCalledTimes(200);
		const expected = camera.quaternion.clone().setFromEuler(new Euler(-0.4, -0.8, 0, "YXZ"));
		expect(camera.quaternion.angleTo(expected)).toBeLessThan(1e-6);
	});
	it.each([
		[2560, 1440],
		[640, 480],
	])("rejects horizontal and vertical cursor warps at %sx%s", (width, height) => {
		const { camera, canvas } = fixture();
		Object.defineProperties(canvas, {
			clientWidth: { value: width },
			clientHeight: { value: height },
		});
		for (const [x, y] of [
			[300, 0],
			[-300, 0],
			[0, 300],
			[0, -300],
		]) {
			const before = camera.quaternion.clone();
			move(x, y);
			expect(camera.quaternion.equals(before)).toBe(true);
			move(2, 2);
			expect(camera.quaternion.angleTo(before)).toBeGreaterThan(0.001);
		}
	});
	it("integrates pitch continuously through repeated full up/down sweeps without Euler feedback", () => {
		const { camera, pointer, controls } = fixture();
		pointer.minPolarAngle = 0;
		pointer.maxPolarAngle = Math.PI;
		// A saved camera can retain roll. At the poles quaternion -> Euler cannot
		// recover yaw and roll independently, so input must retain its own angles.
		const expected = new Euler(0.2, 1.1, 0.15, "YXZ");
		camera.quaternion.setFromEuler(expected);
		for (let i = 0; i < 5000; i++) {
			const y = Math.floor(i / 500) % 2 ? 4 : -4;
			const x = i % 5 === 0 ? 1 : 0;
			expected.y -= x * 0.002;
			expected.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, expected.x - y * 0.002));
			move(x, y);
			const reference = camera.quaternion.clone().setFromEuler(expected);
			expect(camera.quaternion.angleTo(reference)).toBeLessThan(0.000001);
			if (i % 8 === 0) tick(controls);
		}
	});
	it("preserves an externally changed camera pose before resuming mouse look", () => {
		const { camera } = fixture();
		move(10, 10);
		const expected = new Euler(-0.6, 2.4, 0, "YXZ");
		camera.quaternion.setFromEuler(expected);
		move(0, 2);
		expected.x -= 0.004;
		expect(
			camera.quaternion.angleTo(camera.quaternion.clone().setFromEuler(expected))
		).toBeLessThan(0.000001);
	});
	for (const sign of [-1, 1]) {
		it(`keeps yaw and roll stable after reaching pitch limit ${sign}`, () => {
			const { camera } = fixture();
			camera.quaternion.setFromEuler(new Euler(0, 1.1, 0, "YXZ"));
			for (let i = 0; i < 10; i++) move(0, sign * 200);
			for (let i = 0; i < 500; i++) {
				const before = camera.quaternion.clone();
				move(5, i % 2 ? sign : -sign);
				expect(camera.quaternion.angleTo(before)).toBeLessThan(0.02);
				const look = new Euler().setFromQuaternion(camera.quaternion, "YXZ");
				expect(Math.abs(look.z)).toBeLessThan(0.0001);
			}
		});
	}
	it("uses WASD relative to yaw, Space up, either Shift down, and Ctrl to sprint", () => {
		const { camera, controls } = fixture();
		camera.quaternion.setFromEuler(new Euler(1.2, Math.PI / 2, 0, "YXZ"));
		key("KeyW");
		tick(controls);
		expect(camera.position.x).toBeCloseTo(-controls.getMoveSpeed() * 0.02);
		expect(camera.position.y).toBe(0);
		key("KeyW", "keyup");
		key("Space");
		tick(controls);
		key("Space", "keyup");
		for (const shift of ["ShiftLeft", "ShiftRight"]) {
			const before = camera.position.y;
			key(shift);
			tick(controls);
			expect(camera.position.y - before).toBeCloseTo(-controls.getMoveSpeed() * 0.02);
			key(shift, "keyup");
		}
		key("KeyD");
		key("ControlLeft");
		const before = camera.position.clone();
		tick(controls);
		expect(camera.position.distanceTo(before)).toBeCloseTo(
			controls.getMoveSpeed() * controls.getSprintMultiplier() * 0.02
		);
	});
	it("keeps horizontal movement at the pitch limit and prevents diagonal speed gain", () => {
		const { camera, controls } = fixture();
		for (let i = 0; i < 10; i++) move(0, -200);
		key("KeyW");
		key("KeyD");
		tick(controls);
		expect(camera.position.length()).toBeCloseTo(controls.getMoveSpeed() * 0.02);
		expect(camera.position.y).toBe(0);
	});
	it("keeps ascent independent of WASD and cancels opposite keys", () => {
		const { camera, controls } = fixture();
		key("KeyW");
		key("Space");
		tick(controls);
		expect(camera.position.y).toBeCloseTo(controls.getMoveSpeed() * 0.02);
		expect(camera.position.z).toBeCloseTo(-controls.getMoveSpeed() * 0.02);
		const before = camera.position.clone();
		key("KeyS");
		key("ShiftLeft");
		tick(controls);
		expect(camera.position.equals(before)).toBe(true);
	});
	it("rejects cursor-warp spikes without losing subsequent normal mouse movement", () => {
		const { camera } = fixture();
		move(10, -10);
		const before = camera.quaternion.clone();
		move(6000, -3000);
		expect(camera.quaternion.angleTo(before)).toBeLessThan(0.000001);
		move(Number.NaN, 0);
		expect(camera.quaternion.angleTo(before)).toBeLessThan(0.000001);
		move(5, -5);
		expect(camera.quaternion.angleTo(before)).toBeGreaterThan(0.001);
		expect(camera.quaternion.angleTo(before)).toBeLessThan(0.02);
	});
	it("adjusts bounded flight speed with the wheel only while locked", () => {
		const { camera, canvas, controls, pointer } = fixture();
		const start = controls.getMoveSpeed();
		const before = camera.position.clone();
		const wheel = (deltaY: number, deltaMode = 0) => {
			const event = new WheelEvent("wheel", { deltaY, deltaMode, cancelable: true });
			canvas.dispatchEvent(event);
			return event;
		};
		expect(wheel(-100).defaultPrevented).toBe(true);
		expect(controls.getMoveSpeed()).toBeGreaterThan(start);
		wheel(100);
		expect(controls.getMoveSpeed()).toBeCloseTo(start);
		for (let i = 0; i < 500; i++) wheel(-100);
		expect(controls.getMoveSpeed()).toBeLessThanOrEqual(43.556);
		for (let i = 0; i < 500; i++) wheel(3, 1);
		expect(controls.getMoveSpeed()).toBeGreaterThanOrEqual(0.1);
		expect(camera.position.equals(before)).toBe(true);
		pointer.dispatchEvent({ type: "unlock" });
		const paused = controls.getMoveSpeed();
		expect(wheel(-100).defaultPrevented).toBe(true);
		expect(controls.getMoveSpeed()).toBe(paused);
	});
	it("owns wheel input ahead of orbit zoom and page scrolling, then releases it", () => {
		const camera = new PerspectiveCamera();
		camera.position.set(3, 4, 8);
		const canvas = document.createElement("canvas");
		document.body.append(canvas);
		// Register orbit first, as CameraManager does. A stale enabled orbit control
		// must not dolly/lookAt its old target when the first-person wheel fires.
		const orbit = new OrbitControls(camera, canvas);
		const controls = new FlyControls(camera, canvas, { showOverlay: false });
		controlsToDispose.push(controls);
		const pointer = controls.getPointerLockControls();
		pointer.dispatchEvent({ type: "lock" });
		camera.quaternion.setFromEuler(new Euler(0.7, 1.8, 0, "YXZ"));
		const position = camera.position.clone(),
			rotation = camera.quaternion.clone();
		const pageScroll = vi.fn();
		document.body.addEventListener("wheel", pageScroll);
		const wheel = (deltaY: number) =>
			canvas.dispatchEvent(
				new WheelEvent("wheel", {
					deltaY,
					bubbles: true,
					cancelable: true,
				})
			);
		for (let i = 0; i < 20; i++) {
			wheel(i % 2 ? 100 : -100);
			tick(controls);
			expect(camera.position.equals(position)).toBe(true);
			expect(camera.quaternion.angleTo(rotation)).toBeLessThan(1e-7);
		}
		expect(pageScroll).not.toHaveBeenCalled();
		pointer.dispatchEvent({ type: "unlock" });
		wheel(100);
		expect(camera.position.equals(position)).toBe(true);
		controls.enabled = false;
		wheel(100);
		expect(camera.position.equals(position)).toBe(false);
		expect(pageScroll).toHaveBeenCalledOnce();
		controls.enabled = true;
		controls.dispose();
		wheel(100);
		expect(pageScroll).toHaveBeenCalledTimes(2);
		document.body.removeEventListener("wheel", pageScroll);
		orbit.dispose();
	});
	it("clears movement on blur, unlock and disable", () => {
		const { camera, controls, pointer } = fixture();
		for (const reset of [
			() => window.dispatchEvent(new Event("blur")),
			() => pointer.dispatchEvent({ type: "unlock" }),
			() => (controls.enabled = false),
		]) {
			controls.enabled = true;
			pointer.dispatchEvent({ type: "lock" });
			key("KeyW");
			reset();
			tick(controls);
			expect(camera.position.equals(new Vector3())).toBe(true);
		}
	});
});

describe("flight timing and event cadence", () => {
	it.each(["KeyW", "KeyA", "KeyS", "KeyD"])(
		"does not charge idle time to the first %s frame",
		(code) => {
			const { camera, controls } = fixture();
			now = 10000;
			key(code);
			tick(controls, 1, 0.008);
			expect(camera.position.length()).toBeCloseTo(controls.getMoveSpeed() * 0.008);
			key(code, "keyup");
			now += 10000;
			const before = camera.position.clone();
			key(code);
			tick(controls, 2, 0.004);
			expect(camera.position.distanceTo(before)).toBeCloseTo(controls.getMoveSpeed() * 0.004);
		}
	);
	it.each([30, 60, 120, 144])("moves the same distance over one second at %s Hz", (hz) => {
		const { camera, controls } = fixture();
		key("KeyW");
		for (let i = 0; i < hz; i++) tick(controls, 1 / hz);
		expect(camera.position.z).toBeCloseTo(-controls.getMoveSpeed(), 6);
	});
	it("bounds long-task recovery, ignores invalid deltas and stops immediately on release", () => {
		const { camera, controls } = fixture();
		key("KeyW");
		tick(controls);
		const before = camera.position.clone();
		tick(controls, 3);
		expect(camera.position.distanceTo(before)).toBeCloseTo(controls.getMoveSpeed() * 0.05);
		const stopped = camera.position.clone();
		controls.update(Number.NaN);
		controls.update(-1);
		expect(camera.position.equals(stopped)).toBe(true);
		key("KeyW", "keyup");
		tick(controls);
		expect(camera.position.equals(stopped)).toBe(true);
	});
	it("wakes after a zero-length first frame and does not reset timing on key repeat", () => {
		const { camera, controls } = fixture();
		const input = vi.fn();
		controls.on("input", input);
		key("KeyW");
		controls.update(1);
		expect(camera.position.length()).toBe(0);
		expect(input).toHaveBeenCalledTimes(2);
		now += 10;
		key("KeyW");
		tick(controls, 0.02, 0.01);
		expect(camera.position.length()).toBeCloseTo(controls.getMoveSpeed() * 0.02);
	});
	it("coalesces high-rate mouse notifications without discarding any rotation", () => {
		const { controls, camera } = fixture();
		const input = vi.fn(),
			change = vi.fn();
		controls.on("input", input);
		controls.on("change", change);
		for (let i = 0; i < 100; i++) move(1, 0);
		expect(input).toHaveBeenCalledOnce();
		expect(change).not.toHaveBeenCalled();
		expect(new Euler().setFromQuaternion(camera.quaternion, "YXZ").y).toBeCloseTo(-0.2);
		tick(controls);
		expect(change).toHaveBeenCalledOnce();
		tick(controls);
		expect(change).toHaveBeenCalledOnce();
		move(1, 0);
		expect(input).toHaveBeenCalledTimes(2);
	});
	it("clears keys when the document becomes hidden", () => {
		const { camera, controls } = fixture();
		key("KeyW");
		vi.spyOn(document, "hidden", "get").mockReturnValue(true);
		document.dispatchEvent(new Event("visibilitychange"));
		tick(controls, 1);
		expect(camera.position.length()).toBe(0);
	});
});
