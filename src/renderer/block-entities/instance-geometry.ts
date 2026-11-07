import { StaticDrawUsage, type BufferGeometry, type InstancedMesh } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { BlockEntityResources } from "./types";

/** Bake visible GLB parts into model space before sharing geometry across instances. */
export function bakeInstanceGeometry(
	entityModel: Awaited<ReturnType<BlockEntityResources["getEntityMesh"]>>
): BufferGeometry | null {
	entityModel.updateMatrixWorld(true);
	const parts: BufferGeometry[] = [];

	entityModel.traverse((object) => {
		const candidate = object as typeof object & {
			isMesh?: boolean;
			geometry?: BufferGeometry;
		};
		if (
			candidate.isMesh !== true ||
			candidate.geometry?.isBufferGeometry !== true ||
			!object.visible
		) {
			return;
		}

		const geometry = candidate.geometry.clone();
		geometry.applyMatrix4(object.matrixWorld);
		if (geometry.getAttribute("position")?.count === 0) {
			geometry.dispose();
		} else {
			parts.push(geometry);
		}
	});

	if (parts.length === 0) return null;
	if (parts.length === 1) return parts[0] ?? null;

	let merged: BufferGeometry | null = null;
	try {
		merged = mergeGeometries(parts, false);
	} finally {
		for (const part of parts) part.dispose();
	}
	return merged;
}

export function configureInstancedMesh(mesh: InstancedMesh) {
	mesh.instanceMatrix.setUsage(StaticDrawUsage);
	mesh.instanceMatrix.needsUpdate = true;
	mesh.computeBoundingBox();
	mesh.computeBoundingSphere();
	mesh.castShadow = true;
	mesh.receiveShadow = true;
}
