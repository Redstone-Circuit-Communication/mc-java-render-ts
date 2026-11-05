import { afterEach, expect, it, vi } from "vitest";
import * as THREE from "three";
import { RenderManager } from "../RenderManager";
vi.mock("../../workers/MeshBuilder.worker?worker&inline", () => ({ default: class {} }));
vi.mock("../../workers/MeshBuilderWasm.worker?worker&inline", () => ({ default: class {} }));
vi.mock("postprocessing", async (importOriginal) => ({
	...(await importOriginal<typeof import("postprocessing")>()),
	EffectComposer: class {
		passes: unknown[] = [];
		setSize = vi.fn();
		addPass(pass: unknown, index = this.passes.length) {
			this.passes.splice(index, 0, pass);
		}
	},
}));
vi.mock("n8ao", () => ({
	N8AOPostPass: class {
		configuration = {};
		enabled = true;
		setQualityMode = vi.fn();
		setSize = vi.fn();
	},
}));
afterEach(() => {
	vi.unstubAllGlobals();
	document.body.replaceChildren();
});

async function fixture() {
	const parent = document.createElement("div"),
		canvas = document.createElement("canvas");
	parent.append(canvas);
	document.body.append(parent);
	for (const element of [parent, canvas]) {
		Object.defineProperty(element, "clientWidth", { value: 800 });
		Object.defineProperty(element, "clientHeight", { value: 600 });
	}
	const camera = new THREE.PerspectiveCamera(70, 4 / 3, 0.05, 10000);
	camera.position.set(1, 2, 3);
	camera.lookAt(0, 0, 0);
	const renderer = { setPixelRatio: vi.fn(), setSize: vi.fn(), getPixelRatio: () => 0.75 };
	const schematic = {
		canvas,
		options: { maxPixelRatio: 2, postProcessingOptions: { enableSSAO: false } },
		sceneManager: { scene: new THREE.Scene() },
		cameraManager: { activeCamera: { camera } },
		invalidate: vi.fn(),
	};
	const manager = Object.create(RenderManager.prototype) as RenderManager;
	Reflect.set(manager, "schematicRenderer", schematic);
	Reflect.set(manager, "renderer", renderer);
	Reflect.set(manager, "passes", new Map());
	await Reflect.get(manager, "initComposer").call(manager);
	return { manager, schematic, renderer, camera };
}

it("lazily inserts SSAO after the scene pass and toggles it without duplicate passes", async () => {
	const { manager, schematic } = await fixture();
	expect(manager.isSSAOEnabled()).toBe(false);
	manager.setSSAOEnabled(true);
	expect(manager.isSSAOEnabled()).toBe(true);
	const composer = Reflect.get(manager, "composer");
	expect(composer.passes).toHaveLength(2);
	expect(composer.passes[1]).toBe(manager.getEffect("ssao"));
	manager.setSSAOEnabled(false);
	manager.setSSAOEnabled(true);
	expect(composer.passes).toHaveLength(2);
	expect(schematic.options.postProcessingOptions.enableSSAO).toBe(true);
});

it("resizes canvas, composer and AO buffers together while preserving the camera pose", async () => {
	const { manager, renderer, schematic, camera } = await fixture();
	vi.stubGlobal("devicePixelRatio", 2);
	const position = camera.position.clone(),
		rotation = camera.quaternion.clone();
	manager.setSSAOEnabled(true);
	manager.setMaxPixelRatio(0.75);
	expect(renderer.setPixelRatio).toHaveBeenCalledWith(0.75);
	expect(renderer.setSize).toHaveBeenCalledWith(800, 600, false);
	expect(Reflect.get(manager, "composer").setSize).toHaveBeenCalledWith(800, 600);
	expect(manager.getEffect("ssao")?.setSize).toHaveBeenCalledWith(600, 450);
	expect(schematic.options.maxPixelRatio).toBe(0.75);
	expect(camera.position.equals(position)).toBe(true);
	expect(camera.quaternion.equals(rotation)).toBe(true);
	expect(schematic.invalidate).toHaveBeenCalled();
});
