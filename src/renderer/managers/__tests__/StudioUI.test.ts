import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { EventEmitter } from "events";
import * as THREE from "three";
import { CameraManager } from "../CameraManager";
// @ts-expect-error The app uses plain JavaScript without declaration files.
import { ViewControls } from "../../../../example/src/view-controls.js";
// @ts-expect-error The app uses plain JavaScript without declaration files.
import { BlockInspector } from "../../../../example/src/block-inspector.js";
const cleanups: (() => void)[] = [];
beforeEach(() => {
	document.documentElement.innerHTML = readFileSync("example/index.html", "utf8")
		.replace(/<script[\s\S]*?<\/script>/g, "")
		.replace(/<link[^>]+>/g, "");
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			disconnect() {}
			unobserve() {}
		}
	);
	const context = new Proxy(
		{ createRadialGradient: () => ({ addColorStop: () => {} }) },
		{ get: (t, k) => (k in t ? t[k as keyof typeof t] : () => {}) }
	);
	vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as never);
});
afterEach(() => {
	while (cleanups.length) cleanups.pop()?.();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	document.body.replaceChildren();
});
function fixture() {
	const canvas = document.getElementById("canvas") as HTMLCanvasElement;
	canvas.width = 800;
	canvas.height = 600;
	Object.defineProperty(canvas, "clientWidth", { value: 800, configurable: true });
	Object.defineProperty(canvas, "clientHeight", { value: 600, configurable: true });
	vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
		left: 0,
		top: 0,
		right: 800,
		bottom: 600,
		width: 800,
		height: 600,
		x: 0,
		y: 0,
		toJSON: () => ({}),
	});
	const scene = new THREE.Scene(),
		group = new THREE.Group(),
		mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
	scene.add(group);
	group.add(mesh);
	const schematic = {
		group,
		schematicWrapper: {
			get_block: () => "minecraft:chest",
			get_block_string: () => "minecraft:chest[facing=south,type=single]",
		},
		getBlockEntitiesMap: () =>
			new Map([["0,0,0", { nbt: { Items: [{ Slot: 26, id: "minecraft:diamond", Count: 64 }] } }]]),
	};
	const renderer = {
		canvas,
		options: {},
		eventEmitter: new EventEmitter(),
		invalidate: vi.fn(),
		sceneManager: { scene, showGrid: true },
		schematicManager: {
			getAllSchematics: () => [schematic],
			isEmpty: () => false,
			getGlobalTightWorldBox: () => new THREE.Box3().setFromObject(group),
		},
		renderManager: { updateCamera: vi.fn() },
		uiManager: {
			createFPVElements: () => ({
				menu: document.createElement("div"),
				blocker: document.createElement("div"),
			}),
			hideFPVOverlay: vi.fn(),
			showFPVOverlay: vi.fn(),
		},
	};
	const manager = new CameraManager(renderer as never, {
		position: [0, 0, 6],
		preserveCameraOnUpdate: true,
	});
	Object.assign(renderer, { cameraManager: manager });
	manager.activeCamera.camera.position.set(0, 0, 6);
	manager.activeCamera.camera.lookAt(0, 0, 0);
	manager.activeCamera.camera.updateMatrixWorld(true);
	const views = new ViewControls(renderer, vi.fn()),
		showTab = vi.fn(),
		assets = { decorate: (el: HTMLElement, id: string) => (el.dataset.itemId = id) },
		inspector = new BlockInspector(renderer, views, assets, showTab, vi.fn());
	cleanups.push(() => {
		inspector.dispose();
		views.dispose();
		manager.dispose();
		mesh.geometry.dispose();
		mesh.material.dispose();
	});
	return { renderer, manager, views, inspector, canvas, group, schematic, showTab };
}
function click(canvas: HTMLCanvasElement, x = 400, y = 300) {
	canvas.dispatchEvent(
		new PointerEvent("pointerdown", { button: 0, clientX: x, clientY: y, pointerId: 1 })
	);
	canvas.dispatchEvent(new MouseEvent("click", { button: 0, clientX: x, clientY: y }));
}
describe("real Three.js cameras, controls and raycasting", () => {
	it.each([
		["north", 1, 0],
		["east", 0, 1],
		["south", -1, 0],
		["west", 0, -1],
	] as const)("wraps both chest halves from either selection facing %s", (facing, dx, dz) => {
		const { inspector, schematic } = fixture();
		const state = vi.spyOn(schematic.schematicWrapper, "get_block_string");
		state.mockImplementation((...args: unknown[]) => {
			const [x, , z] = args;
			return x === 0 && z === 0
				? `minecraft:chest[facing=${facing},type=left]`
				: x === dx && z === dz
					? `minecraft:chest[facing=${facing},type=right]`
					: "minecraft:air";
		});
		for (const position of [
			[0, 0, 0],
			[dx, 0, dz],
		]) {
			inspector.select(schematic, position);
			expect(inspector.highlight.position.toArray()).toEqual([dx / 2, 0, dz / 2]);
			expect(inspector.highlight.scale.toArray()).toEqual([
				Math.abs(dx) + 1.012,
				1.012,
				Math.abs(dz) + 1.012,
			]);
			expect(inspector.selection.inventory.size).toBe(54);
		}
		// Mismatched neighbours and the next ordinary block must reset the box.
		state.mockReturnValue("minecraft:stone");
		inspector.select(schematic, [4, 2, 3]);
		expect(inspector.highlight.position.toArray()).toEqual([4, 2, 3]);
		expect(inspector.highlight.scale.toArray()).toEqual([1.012, 1.012, 1.012]);
		state.mockImplementation((...args: unknown[]) =>
			args[0] === 0 && args[2] === 0
				? `minecraft:chest[facing=${facing},type=left]`
				: "minecraft:stone"
		);
		inspector.select(schematic, [0, 0, 0]);
		expect(inspector.highlight.scale.toArray()).toEqual([1.012, 1.012, 1.012]);
	});
	it("switches from inside a transformed large building with no front-plane slice on the first frame", () => {
		const { views, manager, group, renderer } = fixture();
		group.scale.set(900, 500, 1200);
		group.rotation.set(0.1, 0.7, 0);
		views.setMode("first");
		views.camera.position.set(3, 4, 5);
		views.camera.quaternion.setFromEuler(new THREE.Euler(-0.3, 1.2, 0, "YXZ"));
		const rotation = views.camera.quaternion.clone();
		views.setMode("ortho");
		manager.update(1 / 60);
		expect(views.camera.quaternion.angleTo(rotation)).toBeLessThan(1e-6);
		views.camera.updateMatrixWorld(true);
		const bounds = renderer.schematicManager.getGlobalTightWorldBox();
		for (const x of [bounds.min.x, bounds.max.x])
			for (const y of [bounds.min.y, bounds.max.y])
				for (const z of [bounds.min.z, bounds.max.z]) {
					const depth = new THREE.Vector3(x, y, z).project(views.camera).z;
					expect(depth).toBeGreaterThan(-1);
					expect(depth).toBeLessThan(1);
				}
	});
	it("rotates continuously in both axes with every preset listening to real document lock events", () => {
		const { views, manager, canvas } = fixture();
		views.setMode("first");
		Object.defineProperty(document, "pointerLockElement", { configurable: true, value: canvas });
		document.dispatchEvent(new Event("pointerlockchange"));
		const expected = new THREE.Euler().setFromQuaternion(views.camera.quaternion, "YXZ");
		for (let i = 0; i < 400; i++) {
			const x = i % 2 ? 4 : -2,
				y = i % 4 < 2 ? 3 : -3;
			expected.y -= x * 0.0016;
			expected.x -= y * 0.0016;
			const event = new MouseEvent("mousemove", { bubbles: true });
			Object.defineProperties(event, { movementX: { value: x }, movementY: { value: y } });
			canvas.dispatchEvent(event);
			manager.update(1 / 60);
			views.drawAxes();
			const q = new THREE.Quaternion().setFromEuler(expected);
			expect(views.camera.quaternion.angleTo(q)).toBeLessThan(1e-6);
		}
		Object.defineProperty(document, "pointerLockElement", { configurable: true, value: null });
		document.dispatchEvent(new Event("pointerlockchange"));
	});
	it("discards orbit drag momentum when entering and leaving first person", () => {
		const { views, manager, canvas } = fixture();
		const initial = views.camera.quaternion.clone();
		canvas.setPointerCapture = () => {};
		canvas.releasePointerCapture = () => {};
		canvas.dispatchEvent(
			new PointerEvent("pointerdown", {
				button: 0,
				pointerId: 1,
				pointerType: "mouse",
				clientX: 400,
				clientY: 300,
			})
		);
		document.dispatchEvent(
			new PointerEvent("pointermove", {
				pointerId: 1,
				pointerType: "mouse",
				clientX: 650,
				clientY: 350,
			})
		);
		document.dispatchEvent(
			new PointerEvent("pointerup", {
				pointerId: 1,
				pointerType: "mouse",
				clientX: 650,
				clientY: 350,
			})
		);
		manager.update(1 / 60);
		const before = views.camera.quaternion.clone();
		expect(before.angleTo(initial)).toBeGreaterThan(0.01);
		views.setMode("first");
		expect(views.camera.quaternion.angleTo(before)).toBeLessThan(0.00001);
		views.camera.quaternion.setFromEuler(new THREE.Euler(-0.6, 2.8, 0, "YXZ"));
		const afterLook = views.camera.quaternion.clone();
		views.setMode("orbit");
		for (let i = 0; i < 30; i++) manager.update(1 / 60);
		expect(views.camera.quaternion.angleTo(afterLook)).toBeLessThan(0.00001);
	});
	it("keeps first-person orientation through unlock/relock and updates the flight speed HUD", () => {
		const { views, manager, canvas } = fixture();
		views.setMode("first");
		const fly = manager.flyControls;
		if (!fly) throw new Error("No fly controls");
		const pointer = fly.getPointerLockControls();
		vi.spyOn(pointer, "unlock").mockImplementation(() => {
			pointer.isLocked = false;
			pointer.dispatchEvent({ type: "unlock" });
		});
		pointer.isLocked = true;
		pointer.dispatchEvent({ type: "lock" });
		for (let i = 0; i < 500; i++) {
			const event = new MouseEvent("mousemove");
			Object.defineProperties(event, {
				movementX: { value: 10 },
				movementY: { value: i % 2 ? 1 : -1 },
			});
			const before = views.camera.quaternion.clone();
			document.dispatchEvent(event);
			manager.update(1 / 60);
			expect(views.camera.quaternion.angleTo(before)).toBeLessThan(0.025);
		}
		const rotation = views.camera.quaternion.clone(),
			position = views.camera.position.clone();
		canvas.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, cancelable: true }));
		expect(document.getElementById("flight-speed")?.textContent).toContain("13.07");
		fly.unlock();
		manager.update(1 / 60);
		pointer.isLocked = true;
		pointer.dispatchEvent({ type: "lock" });
		manager.update(1 / 60);
		expect(views.camera.quaternion.angleTo(rotation)).toBeLessThan(0.00001);
		expect(views.camera.position.equals(position)).toBe(true);
		expect(manager.activeControls?.enabled).toBe(false);
	});
	it("shows the selected redstone snapshot and removes stale signal data on the next selection", () => {
		const { inspector, schematic, canvas } = fixture();
		const state = vi.spyOn(schematic.schematicWrapper, "get_block_string");
		state.mockReturnValue("minecraft:repeater[powered=true,locked=true,delay=3,facing=west]");
		click(canvas);
		expect(document.querySelector(".redstone-state")?.textContent).toBe("已激活");
		expect(document.querySelector('[role="meter"]')?.getAttribute("aria-valuenow")).toBe("15");
		expect(document.querySelector(".redstone-details")?.textContent).toContain("3 红石刻");
		state.mockReturnValue("minecraft:comparator[powered=true,mode=subtract,facing=north]");
		click(canvas);
		expect(document.querySelector(".redstone-strength")?.textContent).toContain("未知");
		expect(document.querySelector('[role="meter"]')).toBe(null);
		expect(document.querySelector(".redstone-note")?.textContent).toContain("OutputSignal");
		state.mockReturnValue("minecraft:chest[facing=south,type=single]");
		inspector.select(schematic, [0, 0, 0]);
		expect(document.querySelector(".redstone-panel")).toBe(null);
		expect(document.querySelectorAll(".inventory-slot")).toHaveLength(27);
	});
	it("switches three modes while preserving projection target and orientation", () => {
		const { views, manager } = fixture(),
			initial = views.camera.quaternion.clone();
		views.setMode("ortho");
		expect(views.camera.isOrthographicCamera).toBe(true);
		expect(views.camera.quaternion.angleTo(initial)).toBeLessThan(0.001);
		expect(manager.activeControls?.enabled).toBe(true);
		expect(document.querySelector("[data-view=ortho]")?.getAttribute("aria-pressed")).toBe("true");
		views.setMode("first");
		expect(views.camera.isPerspectiveCamera).toBe(true);
		expect(manager.isFlyControlsEnabled()).toBe(true);
		expect(manager.activeControls?.enabled).toBe(false);
		views.setMode("orbit");
		expect(manager.isFlyControlsEnabled()).toBe(false);
		expect(manager.activeControls?.enabled).toBe(true);
	});
	it("coordinate sphere exposes six axes and aligns to top", () => {
		const { views } = fixture();
		views.setMode("ortho");
		views.align([0, 1, 0]);
		views.drawAxes();
		expect(document.querySelectorAll("#axis-buttons button")).toHaveLength(6);
		expect(views.camera.getWorldDirection(new THREE.Vector3()).y).toBeCloseTo(-1, 3);
	});
	for (const mode of ["orbit", "ortho"])
		it(`picks the right voxel and slot with ${mode} camera`, () => {
			const { views, inspector, canvas, showTab } = fixture();
			views.setMode(mode);
			click(canvas);
			expect(inspector.selection.position).toEqual([0, 0, 0]);
			expect(showTab).toHaveBeenCalledWith("inspect");
			expect(document.querySelectorAll(".inventory-slot")).toHaveLength(27);
			const slot = document.querySelector('[data-slot="26"]') as HTMLButtonElement;
			expect(slot.textContent).toContain("64");
			slot.click();
			expect(document.querySelector(".item-detail pre")?.textContent).toContain(
				"minecraft:diamond"
			);
		});
	it("a drag returning to its origin does not select", () => {
		const { canvas, inspector } = fixture();
		canvas.dispatchEvent(
			new PointerEvent("pointerdown", { button: 0, clientX: 400, clientY: 300, pointerId: 1 })
		);
		canvas.dispatchEvent(
			new PointerEvent("pointermove", { clientX: 430, clientY: 300, pointerId: 1 })
		);
		canvas.dispatchEvent(new MouseEvent("click", { button: 0, clientX: 400, clientY: 300 }));
		expect(inspector.selection).toBe(null);
	});
	it("first click enters flight; locked click selects and releases the pointer", () => {
		const { views, manager, canvas, inspector } = fixture();
		views.setMode("first");
		const fly = manager.flyControls;
		if (!fly) throw new Error("No fly controls");
		vi.spyOn(fly, "lock").mockImplementation(() => {});
		click(canvas);
		expect(inspector.selection).toBe(null);
		fly.isLocked = true;
		const unlock = vi.spyOn(fly, "unlock").mockImplementation(() => {
			fly.isLocked = false;
		});
		click(canvas);
		expect(inspector.selection.position).toEqual([0, 0, 0]);
		expect(unlock).toHaveBeenCalledOnce();
	});
	it("uses schematic transforms for picking, including negative position and scale", () => {
		const { group, views, inspector, canvas } = fixture();
		group.position.set(-7, 2, 4);
		group.scale.set(2, 1, 3);
		group.rotation.y = 0.5;
		const target = group.localToWorld(new THREE.Vector3());
		views.camera.position.copy(target).add(new THREE.Vector3(3, 2, 7));
		views.camera.lookAt(target);
		click(canvas);
		expect(inspector.selection.position).toEqual([0, 0, 0]);
	});
	it("detaches the selection outline before replacing a schematic", () => {
		const { canvas, inspector } = fixture();
		click(canvas);
		expect(inspector.highlight.visible).toBe(true);
		inspector.clear();
		expect(inspector.highlight.parent).toBe(null);
		expect(inspector.selection).toBe(null);
		expect(document.querySelectorAll(".inventory-slot")).toHaveLength(0);
	});
	it("typing in search never switches camera mode", () => {
		const { views } = fixture();
		document
			.getElementById("material-search")
			?.dispatchEvent(new KeyboardEvent("keydown", { code: "Digit3", bubbles: true }));
		expect(views.mode).toBe("orbit");
	});
});
