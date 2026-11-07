import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

/** Preserve target-plane scale and orientation while changing projection. */
export function preserveCameraView(
	previous: THREE.PerspectiveCamera | THREE.OrthographicCamera,
	next: THREE.PerspectiveCamera | THREE.OrthographicCamera,
	target: THREE.Vector3,
	aspect: number,
	controls?: OrbitControls,
	bounds?: THREE.Box3
): void {
	const position = previous.position.clone();
	const quaternion = previous.quaternion.clone();
	let distance = Math.max(0.001, position.distanceTo(target));
	const height =
		previous instanceof THREE.OrthographicCamera
			? (previous.top - previous.bottom) / previous.zoom
			: 2 * distance * Math.tan(THREE.MathUtils.degToRad(previous.getEffectiveFOV()) / 2);
	const damping = controls?.enableDamping ?? false;
	if (controls) {
		// Flush stale inertia before installing the final pose.
		controls.enableDamping = false;
		controls.update();
		controls.minPolarAngle = 0;
		controls.maxPolarAngle = Math.PI;
	}
	next.position.copy(position);
	next.quaternion.copy(quaternion);
	next.near = 0.05;
	if (next instanceof THREE.OrthographicCamera) {
		next.top = height / 2;
		next.bottom = -height / 2;
		next.left = (-height * aspect) / 2;
		next.right = (height * aspect) / 2;
		next.zoom = 1;
		if (bounds && !bounds.isEmpty()) {
			// Orthographic scale is independent of distance. Put the camera outside
			// the entire model, including geometry behind the former FPV position.
			// Enclose a sphere about the orbit target so later rotations remain safe.
			let radius = 0;
			const corner = new THREE.Vector3();
			for (const x of [bounds.min.x, bounds.max.x])
				for (const y of [bounds.min.y, bounds.max.y])
					for (const z of [bounds.min.z, bounds.max.z])
						radius = Math.max(radius, corner.set(x, y, z).distanceTo(target));
			const safeDistance = radius + Math.max(1, radius * 0.01);
			if (distance < safeDistance) {
				next.position.addScaledVector(next.getWorldDirection(corner), distance - safeDistance);
				distance = safeDistance;
			}
		}
	} else {
		next.aspect = aspect;
		if (previous instanceof THREE.OrthographicCamera) {
			distance = height / (2 * Math.tan(THREE.MathUtils.degToRad(next.getEffectiveFOV()) / 2));
			next.position
				.copy(target)
				.addScaledVector(next.getWorldDirection(new THREE.Vector3()), -distance);
		}
	}
	next.far = Math.max(previous.far, 10000, distance * 10);
	if (controls) {
		controls.minDistance = Math.min(controls.minDistance, distance);
		controls.maxDistance = Math.max(controls.maxDistance, distance * 10);
		controls.target.copy(target);
		controls.update();
		controls.enableDamping = damping;
	}
	next.updateProjectionMatrix();
	next.updateMatrixWorld(true);
}
