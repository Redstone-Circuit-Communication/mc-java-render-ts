import { CpuFrameProfiler } from "../../performance/CpuFrameProfiler";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "events";
import { RenderManager } from "../RenderManager";
vi.mock("../../workers/MeshBuilder.worker?worker&inline", () => ({ default: class {} }));
vi.mock("../../workers/MeshBuilderWasm.worker?worker&inline", () => ({ default: class {} }));
afterEach(() => vi.restoreAllMocks());
function fixture() {
	const manager = Object.create(RenderManager.prototype) as RenderManager;
	const events = new EventEmitter(),
		onFrame = vi.fn();
	events.on("frameRendered", onFrame);
	const draw = vi.fn(),
		lost = vi.fn(() => false);
	Object.assign(manager, {
		isRendering: false,
		contextLost: false,
		disposed: false,
		usesSharedRenderer: false,
		_isWebGPU: false,
		eventEmitter: events,
		renderer: { render: draw, getContext: () => ({ isContextLost: lost }) },
		schematicRenderer: {
			chunkVisibility: { update: vi.fn() },
			sceneManager: { scene: {} },
			cameraManager: { activeCamera: { camera: {} } },
		},
	});
	return { manager, draw, onFrame, lost };
}
describe("actual render telemetry", () => {
	it("reports only a successful submission with its completion timestamp", () => {
		const f = fixture();
		vi.spyOn(performance, "now").mockReturnValue(1234);
		f.manager.render();
		expect(f.draw).toHaveBeenCalledOnce();
		expect(f.onFrame).toHaveBeenCalledWith({ timestamp: 1234 });
		Reflect.set(f.manager, "isRendering", true);
		f.manager.render();
		expect(f.onFrame).toHaveBeenCalledOnce();
	});
	it("does not count disposed, lost-context or failed draws", () => {
		const f = fixture();
		vi.spyOn(console, "warn").mockImplementation(() => {});
		vi.spyOn(console, "error").mockImplementation(() => {});
		Reflect.set(f.manager, "disposed", true);
		f.manager.render();
		Reflect.set(f.manager, "disposed", false);
		f.lost.mockReturnValue(true);
		f.manager.render();
		Reflect.set(f.manager, "contextLost", false);
		f.lost.mockReturnValue(false);
		f.draw.mockImplementation(() => {
			throw Error("test");
		});
		f.manager.render();
		expect(f.onFrame).not.toHaveBeenCalled();
	});
});

it("profiles real successful submissions without treating CPU submission time as GPU time", () => {
	const f = fixture();
	Reflect.set(f.manager, "cpuProfiler", new CpuFrameProfiler());
	f.manager.setFrameProfilingEnabled(true);
	let now = 100;
	vi.spyOn(performance, "now").mockImplementation(() => now);
	Reflect.get(f.manager, "schematicRenderer").chunkVisibility.update.mockImplementation(() => {
		now += 4;
	});
	f.draw.mockImplementation(() => {
		now += 8;
	});
	f.manager.setFramePreparation({ controlsMs: 2, highlightMs: 1, gizmoMs: 3 });
	f.manager.render();
	expect(f.manager.getFrameProfile()).toMatchObject({
		samples: 1,
		mean: {
			controlsMs: 2,
			highlightMs: 1,
			gizmoMs: 3,
			visibilityMs: 4,
			submitMs: 8,
			measuredMs: 18,
		},
	});
	f.manager.render();
	expect(f.manager.getFrameProfile()?.mean.controlsMs).toBe(1); // direct render does not reuse preparation
	f.manager.setFrameProfilingEnabled(false);
	expect(f.manager.getFrameProfile()).toBeNull();
});
