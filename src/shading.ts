import * as THREE from "three";
import type { SchematicRenderer } from "./renderer/index.js";

/**
 * Lightweight shading ("光影" on the site, for capable devices): a warm sun with soft shadows fitted to the loaded
 * structure, a sky / ground hemisphere light in place of most of the flat ambient light. Blocks get a lit side, a shaded
 * side and cast shadows; no extra post-processing pass. Off restores the original lights.
 * Call again after the structure changes (loaded, other state) so the shadow camera covers the new bounds.
 * The bedrock package has the same function with the same numbers (src/shading.ts there).
 */
const SUN_AZIMUTH = (-35 * Math.PI) / 180; // a little to the side of +z, so two faces of a wall get different light
const SUN_ELEVATION = (52 * Math.PI) / 180;
export const SHADING = { ambient: 0.9, hemisphere: 1.1, sun: 2.6, sunColor: 0xfff0d8, sky: 0xcfe3ff, ground: 0x8a7350 } as const;

interface Saved {
	ambient: number;
	sun: number;
	sunColor: number;
	sunPosition: THREE.Vector3;
	hemi: THREE.HemisphereLight;
	/** the host's chunk culling, restored when shading goes off */
	chunks?: SchematicRenderer["options"]["chunkRenderOptions"];
	/** marks meshes added later (chunks streaming in, block entities, entities) as casting and receiving shadows */
	sweep: ReturnType<typeof setInterval>;
	meshes: number;
}

/**
 * Every mesh casts and receives shadows — glass, leaves and plants too (2026-11-18: only part of the scene cast shadows).
 * Both faces go into the shadow map: three.js draws only the back faces of a one-sided material there, and a block whose
 * mesh has no back face towards the sun (a slab, a carpet, a plant quad, a surface whose hidden faces the mesher removed)
 * then let the sunlight straight through.
 */
function markShadows(scene: THREE.Scene): number {
	let n = 0;
	scene.traverse((o) => {
		const mesh = o as THREE.Mesh;
		if (!mesh.isMesh) return;
		n++;
		mesh.castShadow = true;
		mesh.receiveShadow = true;
		for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) if (m && m.shadowSide !== THREE.DoubleSide) m.shadowSide = THREE.DoubleSide;
	});
	return n;
}
const saved = new WeakMap<object, Saved>();

/**
 * Put the sun and its shadow box around everything that is loaded. Called when shading turns on and again by the sweep
 * whenever meshes were added (chunks stream in after the host's first call, when the scene is still empty: without the
 * refit the shadow box stayed a 16-block cube around the origin and most of the structure cast no shadow).
 */
function fitSun(renderer: SchematicRenderer, sun: THREE.DirectionalLight, scene: THREE.Scene): void {
	const box = new THREE.Box3();
	for (const schematic of renderer.schematicManager?.getAllSchematics() ?? []) box.expandByObject(schematic.group);
	if (box.isEmpty()) box.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(16, 16, 16));
	const sphere = box.getBoundingSphere(new THREE.Sphere());
	const r = Math.max(8, sphere.radius);
	const dir = new THREE.Vector3(
		Math.cos(SUN_ELEVATION) * Math.sin(SUN_AZIMUTH),
		Math.sin(SUN_ELEVATION),
		Math.cos(SUN_ELEVATION) * Math.cos(SUN_AZIMUTH)
	);
	sun.position.copy(sphere.center).addScaledVector(dir, r * 2);
	sun.target.position.copy(sphere.center);
	if (!sun.target.parent) scene.add(sun.target);
	const cam = sun.shadow.camera as THREE.OrthographicCamera;
	Object.assign(cam, { left: -r, right: r, top: r, bottom: -r, near: 0.5, far: r * 4 });
	cam.updateProjectionMatrix();
}

export function applyShading(renderer: SchematicRenderer, on: boolean, quality: "normal" | "high" = "normal"): void {
	const gl = renderer.renderManager?.renderer as THREE.WebGLRenderer | undefined;
	const scene = renderer.sceneManager?.scene;
	const lights = renderer.sceneManager?.getLights?.();
	const ambient = lights?.get("ambientLight") as THREE.AmbientLight | undefined;
	const sun = lights?.get("directionalLight") as THREE.DirectionalLight | undefined;
	if (!gl || !scene || !ambient || !sun || !("shadowMap" in gl)) return;
	const wasEnabled = gl.shadowMap.enabled;
	let s = saved.get(renderer);
	if (on) {
		if (!s) {
			const hemi = new THREE.HemisphereLight(SHADING.sky, SHADING.ground, 0);
			hemi.name = "rswShadingHemisphere";
			scene.add(hemi);
			const sweep = setInterval(() => {
				const cur = saved.get(renderer);
				// the renderer was disposed (or shading turned off elsewhere): stop sweeping
				if (!cur || renderer.renderManager?.renderer !== gl) {
					clearInterval(sweep);
					return;
				}
				const n = markShadows(scene);
				if (n !== cur.meshes) {
					cur.meshes = n;
					fitSun(renderer, sun, scene);
					gl.shadowMap.needsUpdate = true;
					renderer.invalidate();
				}
			}, 1000);
			s = { ambient: ambient.intensity, sun: sun.intensity, sunColor: sun.color.getHex(), sunPosition: sun.position.clone(), hemi, sweep, meshes: 0 };
			saved.set(renderer, s);
		}
		// Chunks the camera does not see are hidden by the chunk culling, and hidden chunks cast no shadow: a tower behind you
		// would lose its shadow. With shading on, every chunk stays in the scene (shading is for capable devices).
		if (renderer.options && renderer.chunkVisibility) {
			const cur = renderer.options.chunkRenderOptions;
			// remember the host's culling, not our own "show everything" from an earlier call
			if (!(cur?.frustumCulling === false && cur.maxChunks === 0 && cur.renderDistance === 0)) s.chunks = cur;
			const all = { ...renderer.options.chunkRenderOptions, frustumCulling: false, maxChunks: 0, renderDistance: 0 };
			renderer.options.chunkRenderOptions = all;
			renderer.chunkVisibility.setOptions(all);
		}
		fitSun(renderer, sun, scene);
		sun.color.setHex(SHADING.sunColor);
		sun.intensity = SHADING.sun;
		ambient.intensity = SHADING.ambient;
		s.hemi.intensity = SHADING.hemisphere;
		sun.castShadow = true;
		const size = quality === "high" ? 4096 : 2048;
		if (sun.shadow.mapSize.x !== size) {
			sun.shadow.mapSize.set(size, size);
			sun.shadow.map?.dispose();
			sun.shadow.map = null;
		}
		// both faces are in the shadow map now: a little more normal bias keeps lit faces from shadowing themselves (acne)
		sun.shadow.bias = -0.0005;
		sun.shadow.normalBias = 0.06;
		sun.shadow.radius = 2;
		gl.shadowMap.enabled = true;
		gl.shadowMap.type = THREE.PCFShadowMap; // PCFSoftShadowMap is gone in three r18x (it warns and falls back to this)
		gl.shadowMap.needsUpdate = true;
		s.meshes = markShadows(scene);
	} else if (s) {
		ambient.intensity = s.ambient;
		sun.intensity = s.sun;
		sun.color.setHex(s.sunColor);
		sun.position.copy(s.sunPosition);
		sun.castShadow = false;
		s.hemi.removeFromParent();
		clearInterval(s.sweep);
		if (s.chunks && renderer.chunkVisibility) {
			renderer.options.chunkRenderOptions = s.chunks;
			renderer.chunkVisibility.setOptions(s.chunks);
		}
		saved.delete(renderer);
		gl.shadowMap.enabled = false;
	}
	// switching the shadow map on or off changes the shader programs
	if (wasEnabled !== gl.shadowMap.enabled)
		scene.traverse((o) => {
			const m = (o as THREE.Mesh).material;
			if (m) for (const x of Array.isArray(m) ? m : [m]) x.needsUpdate = true;
		});
	renderer.invalidate();
}
