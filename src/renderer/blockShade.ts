import * as THREE from "three";

/**
 * Smooth-lighting ambient occlusion for chunk meshes. The mesh core gives every vertex a brightness (0–255) from the solid
 * blocks around its corner; chunk geometry stores it as a darkness attribute, `blockShade` (0 = unchanged), and the block
 * materials read it in their shader. A mesh that shares these materials without the attribute (a block entity, an item
 * icon, a falling block) reads WebGL's default of 0 and is drawn as before.
 */
export function setBlockShade(geometry: THREE.BufferGeometry, ao: Uint8Array | undefined): void {
	if (!ao) return;
	const shade = new Uint8Array(ao.length);
	for (let i = 0; i < ao.length; i++) shade[i] = 255 - ao[i];
	geometry.setAttribute("blockShade", new THREE.BufferAttribute(shade, 1, true));
}

const PATCHED = new WeakSet<THREE.Material>();
type BuiltIn = THREE.Material & {
	isMeshStandardMaterial?: boolean;
	isMeshBasicMaterial?: boolean;
	isMeshLambertMaterial?: boolean;
	isMeshPhongMaterial?: boolean;
};

/** Lets block materials darken by `blockShade`; built-in three.js mesh materials only, each patched once. */
export function useBlockShade(materials: THREE.Material | THREE.Material[]): void {
	for (const material of (Array.isArray(materials) ? materials : [materials]) as BuiltIn[]) {
		if (!material || PATCHED.has(material)) continue;
		if (!(
			material.isMeshStandardMaterial ||
			material.isMeshBasicMaterial ||
			material.isMeshLambertMaterial ||
			material.isMeshPhongMaterial
		))
			continue;
		PATCHED.add(material);
		const previous = material.onBeforeCompile;
		const baseKey = material.customProgramCacheKey();
		material.onBeforeCompile = (shader, renderer) => {
			previous.call(material, shader, renderer);
			shader.vertexShader =
				"attribute float blockShade;\nvarying float vBlockShade;\n" +
				shader.vertexShader.replace(
					"#include <begin_vertex>",
					"#include <begin_vertex>\n\tvBlockShade = blockShade;"
				);
			shader.fragmentShader =
				"varying float vBlockShade;\n" +
				shader.fragmentShader.replace(
					"#include <color_fragment>",
					"#include <color_fragment>\n\tdiffuseColor.rgb *= 1.0 - vBlockShade;"
				);
		};
		material.customProgramCacheKey = () => `${baseKey}|blockShade`;
		material.needsUpdate = true;
	}
}
