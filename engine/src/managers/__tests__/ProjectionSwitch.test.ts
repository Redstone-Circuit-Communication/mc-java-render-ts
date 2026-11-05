import { describe, it, expect, vi } from "vitest";
import * as THREE from "three";
import { EventEmitter } from "events";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Effect, EffectPass, RenderPass } from "postprocessing";
import { N8AOPostPass } from "n8ao";
import { CameraManager } from "../CameraManager";
import { CameraWrapper } from "../CameraWrapper";
import { RenderManager } from "../RenderManager";
import { TiltShiftPlaneEffect } from "../../effects/TiltShiftPlaneEffect";
import { preserveCameraView } from "../../utils/preserveCameraView";
import type { SchematicRenderer } from "../../SchematicRenderer";
vi.mock("../../workers/MeshBuilder.worker?worker&inline", () => ({ default: class {} }));
vi.mock("../../workers/MeshBuilderWasm.worker?worker&inline", () => ({ default: class {} }));
function fixture(background: THREE.Scene["background"] = new THREE.Color("#dfe6d7")) {
	const scene = new THREE.Scene();
	scene.background = background;
	const perspective = new THREE.PerspectiveCamera(60, 1.5, 0.1, 10000);
	const orthographic = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 10000);
	const schematic = {
		sceneManager: { scene },
		cameraManager: { activeCamera: { camera: perspective } },
		invalidate: vi.fn(),
	};
	const manager = Object.assign(Object.create(RenderManager.prototype) as RenderManager, {
		schematicRenderer: schematic,
		passes: new Map(),
		_backgroundMode: "hdri",
		_forceBackground: false,
		isometricBackground: new THREE.Color(0x7ea8ff),
		backgroundBeforeOrthographic: undefined,
		originalBackground: null,
		ssaoPresets: { isometric: {}, perspective: {} },
	});
	const change = (camera: THREE.Camera, name = "custom") => {
		schematic.cameraManager.activeCamera.camera = camera as THREE.PerspectiveCamera;
		manager.updateCamera(camera);
		Reflect.get(manager, "handleCameraChange").call(manager, name);
	};
	return { manager, scene, perspective, orthographic, schematic, change };
}
describe("projection/background transitions", () => {
	it("starts without HDRI and retains the configured demo color on entering orthographic", () => {
		const f = fixture();
		const renderer = Object.assign(f.schematic, {
			canvas: document.createElement("canvas"),
			eventEmitter: new EventEmitter(),
			options: { hdri: "", backgroundColor: "#dfe6d7" },
		});
		const manager = new RenderManager(renderer as unknown as SchematicRenderer);
		expect(manager.getBackgroundMode()).toBe("solid");
		expect(manager.getIsometricBackgroundColor().getHexString()).toBe("dfe6d7");
		const background = f.scene.background;
		f.schematic.cameraManager.activeCamera.camera = f.orthographic as never;
		Reflect.get(manager, "applyCameraBackground").call(manager);
		expect(f.scene.background).toBe(background);
		// An actual HDRI falls back to the same configured color, then returns.
		Reflect.set(manager, "_backgroundMode", "hdri");
		const hdri = new THREE.Texture();
		f.scene.background = hdri;
		Reflect.get(manager, "applyCameraBackground").call(manager);
		expect((f.scene.background as THREE.Color).getHexString()).toBe("dfe6d7");
		f.schematic.cameraManager.activeCamera.camera = f.perspective;
		Reflect.get(manager, "applyCameraBackground").call(manager);
		expect(f.scene.background).toBe(hdri);
	});
	for (const [name, background] of [
		["solid", new THREE.Color("#dfe6d7")],
		["HDRI", new THREE.Texture()],
		["null", null],
	] as const)
		it(`restores ${name} exactly after first and repeated orthographic round trips`, () => {
			const f = fixture(background);
			for (let i = 0; i < 3; i++) {
				f.change(f.orthographic);
				expect(f.scene.background).not.toBe(background);
				f.change(f.orthographic);
				f.change(f.perspective);
				expect(f.scene.background).toBe(background);
			}
		});
	it("explicit solid/image/transparent modes and forced HDRI survive all projections", () => {
		for (const mode of ["solid", "image", "transparent", "hdri"]) {
			const background =
				mode === "transparent"
					? null
					: mode === "solid"
						? new THREE.Color("red")
						: new THREE.Texture();
			const f = fixture(background);
			Reflect.set(f.manager, "_backgroundMode", mode);
			Reflect.set(f.manager, "_forceBackground", mode === "hdri");
			f.change(f.orthographic);
			expect(f.scene.background).toBe(background);
			f.change(f.perspective);
			expect(f.scene.background).toBe(background);
		}
	});
	it("a new background chosen while orthographic replaces the old snapshot", async () => {
		const f = fixture();
		f.change(f.orthographic);
		Object.assign(f.manager, {
			setAlphaMode: vi.fn().mockResolvedValue(undefined),
			renderer: { setClearColor: vi.fn() },
		});
		await f.manager.setBackgroundMode("solid", { color: 0x112233 });
		const selected = f.scene.background;
		f.change(f.perspective);
		expect(f.scene.background).toBe(selected);
		expect((selected as THREE.Color).getHex()).toBe(0x112233);
	});
	it("late HDRI completion cannot overwrite an explicit non-HDRI background", () => {
		const f = fixture();
		Reflect.set(f.manager, "_backgroundMode", "solid");
		const bg = f.scene.background;
		const texture = new THREE.DataTexture(),
			dispose = vi.spyOn(texture, "dispose");
		Reflect.get(f.manager, "applyHDRITexture").call(f.manager, texture, true, "old.hdr");
		expect(dispose).toHaveBeenCalledOnce();
		expect(f.scene.background).toBe(bg);
	});
	it("synchronizes active, parked, alpha and tilt-shift passes before first draw", () => {
		const f = fixture();
		const render = new RenderPass(f.scene, f.perspective),
			alpha = new RenderPass(f.scene, f.perspective),
			parked = new RenderPass(f.scene, f.perspective);
		const effect = new Effect(
			"camera",
			"void mainImage(const in vec4 c, const in vec2 uv, out vec4 o){o=c;}"
		);
		const changed = vi.spyOn(effect, "mainCamera", "set");
		const effectPass = new EffectPass(f.perspective, effect),
			tilt = new TiltShiftPlaneEffect(f.perspective);
		Object.assign(f.manager, {
			composer: { passes: [render, effectPass] },
			_opaqueComposer: { passes: [parked] },
			_alphaComposer: { passes: [alpha] },
			passes: new Map([["tiltShift", tilt]]),
		});
		f.manager.updateCamera(f.orthographic);
		for (const pass of [render, alpha, parked]) expect(pass.camera).toBe(f.orthographic);
		expect(changed).toHaveBeenLastCalledWith(f.orthographic);
		expect(Reflect.get(tilt, "camera")).toBe(f.orthographic);
		render.dispose();
		alpha.dispose();
		parked.dispose();
		effectPass.dispose();
		tilt.dispose();
	});
	it("recompiles actual N8AO shaders for the very first orthographic frame, then restores perspective", () => {
		const f = fixture();
		const ao = new N8AOPostPass(f.scene, f.perspective, 32, 32);
		Reflect.get(f.manager, "passes").set("ssao", ao);
		const shader = () => Reflect.get(ao, "effectShaderQuad").material.fragmentShader as string;
		expect(shader()).not.toContain("#define ORTHO");
		f.manager.updateCamera(f.orthographic);
		expect(shader()).toContain("#define ORTHO");
		const material = Reflect.get(ao, "effectShaderQuad").material;
		f.manager.updateCamera(f.orthographic);
		expect(Reflect.get(ao, "effectShaderQuad").material).toBe(material);
		f.manager.updateCamera(f.perspective);
		expect(shader()).not.toContain("#define ORTHO");
		ao.dispose();
	});
});

describe("atomic projection and pose", () => {
	it("keeps the whole depth of a large building in front of the first orthographic near plane", () => {
		const perspective = new THREE.PerspectiveCamera(60, 1.5, 0.05, 10000);
		perspective.position.set(12, 8, 15);
		const target = new THREE.Vector3(12, 8, -5);
		perspective.lookAt(target);
		const bounds = new THREE.Box3(
			new THREE.Vector3(-500, -100, -700),
			new THREE.Vector3(400, 600, 300)
		);
		const ortho = new THREE.OrthographicCamera();
		preserveCameraView(perspective, ortho, target, 1.5, undefined, bounds);
		expect(ortho.top - ortho.bottom).toBeCloseTo(40 * Math.tan(Math.PI / 6));
		const point = target
			.clone()
			.add(new THREE.Vector3(3, 2, 0))
			.project(ortho);
		expect(point.x).toBeCloseTo(3 / ortho.right);
		expect(point.y).toBeCloseTo(2 / ortho.top);
		const distance = ortho.position.distanceTo(target);
		for (const direction of [
			new THREE.Vector3(0, 0, 1),
			new THREE.Vector3(1, 2, -3).normalize(),
			new THREE.Vector3(-2, -1, 3).normalize(),
		]) {
			ortho.position.copy(target).addScaledVector(direction, distance);
			ortho.lookAt(target);
			ortho.updateMatrixWorld(true);
			for (const x of [bounds.min.x, bounds.max.x])
				for (const y of [bounds.min.y, bounds.max.y])
					for (const z of [bounds.min.z, bounds.max.z]) {
						const depth = new THREE.Vector3(x, y, z).project(ortho).z;
						expect(depth).toBeGreaterThan(-1);
						expect(depth).toBeLessThan(1);
					}
		}
	});
	it("initializes the orthographic preset pose on construction", () => {
		const camera = new CameraWrapper(
			"orthographic",
			document.createElement("canvas"),
			{} as SchematicRenderer,
			{ position: [12, 15, 20], rotation: [-0.4, 0.5, 0] }
		);
		expect(camera.camera.position.toArray()).toEqual([12, 15, 20]);
		expect(camera.camera.rotation.x).toBeCloseTo(-0.4);
	});
	it("preserves scale, target and pose across the first projection and round trip", () => {
		const perspective = new THREE.PerspectiveCamera(60, 1.5, 0.1, 10000);
		perspective.zoom = 1.5;
		perspective.position.set(20, 15, 25);
		const target = new THREE.Vector3(3, 2, 1);
		perspective.lookAt(target);
		perspective.updateProjectionMatrix();
		const oldPosition = perspective.position.clone(),
			oldQuaternion = perspective.quaternion.clone();
		const ortho = new THREE.OrthographicCamera();
		const oldHeight =
			2 *
			perspective.position.distanceTo(target) *
			Math.tan(THREE.MathUtils.degToRad(perspective.getEffectiveFOV()) / 2);
		preserveCameraView(perspective, ortho, target, 1.5);
		expect(ortho.top - ortho.bottom).toBeCloseTo(oldHeight);
		expect(ortho.position.equals(oldPosition)).toBe(true);
		expect(ortho.quaternion.equals(oldQuaternion)).toBe(true);
		// The perspective divide is absent on the first projection, not just after another toggle.
		expect(ortho.projectionMatrix.elements[11]).toBe(0);
		expect(ortho.projectionMatrix.elements[15]).toBe(1);
		preserveCameraView(ortho, perspective, target, 1.5);
		expect(perspective.position.distanceTo(oldPosition)).toBeLessThan(1e-10);
	});
	it("publishes cameraChanged only after preserving the final view, without later refocusing", () => {
		const canvas = document.createElement("canvas");
		Object.defineProperties(canvas, { clientWidth: { value: 1200 }, clientHeight: { value: 800 } });
		const perspective = new THREE.PerspectiveCamera(60, 1.5, 0.1, 10000),
			ortho = new THREE.OrthographicCamera();
		perspective.position.set(30, 25, 35);
		perspective.lookAt(0, 0, 0);
		const controls = new OrbitControls(ortho, canvas),
			oldControls = new OrbitControls(perspective, canvas);
		const manager = Object.assign(
			Object.setPrototypeOf(new EventEmitter(), CameraManager.prototype) as CameraManager,
			{
				cameras: new Map([
					["perspective", { camera: perspective }],
					["isometric", { camera: ortho }],
				]),
				controls: new Map([
					["perspective-orbit", oldControls],
					["isometric-orbit", controls],
				]),
				activeCameraKey: "perspective",
				activeControlKey: "perspective-orbit",
				rendererDomElement: canvas,
				animationRequestId: null,
				flyControlsEnabled: false,
				schematicRenderer: {
					renderManager: { updateCamera: vi.fn() },
					invalidate: vi.fn(),
					schematicManager: { isEmpty: () => true },
				},
				focusOnSchematics: vi.fn(),
			}
		);
		const pose = perspective.position.clone();
		manager.on("cameraChanged", () => {
			expect(ortho.position.distanceTo(pose)).toBeLessThan(1e-9);
			expect(ortho.projectionMatrix.elements[11]).toBe(0);
		});
		manager.switchCameraPreset("isometric", { preserveView: true });
		expect(manager.focusOnSchematics).not.toHaveBeenCalled();
		controls.dispose();
		oldControls.dispose();
	});
});

it("resizes an orthographic frustum without changing its scale or reverting projection", () => {
	const f = fixture();
	f.change(f.orthographic);
	Object.assign(f.manager, { renderer: { setSize: vi.fn() } });
	const height = f.orthographic.top - f.orthographic.bottom;
	f.manager.resize(1600, 800);
	expect(f.orthographic.right - f.orthographic.left).toBe(height * 2);
	expect(f.orthographic.top - f.orthographic.bottom).toBe(height);
	expect(f.orthographic.projectionMatrix.elements[11]).toBe(0);
	const matrix = f.orthographic.projectionMatrix.clone();
	f.manager.resize(0, 0);
	expect(f.orthographic.projectionMatrix.equals(matrix)).toBe(true);
});
