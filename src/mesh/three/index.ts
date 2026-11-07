import * as THREE from "three";
import type { BuildResult, MeshData } from "../core/index.js";

/** Owns only geometry; the caller retains ownership of materials and textures. */
export function createGeometry(data: MeshData): THREE.BufferGeometry {
	const geometry = new THREE.BufferGeometry();
	let positions: Float32Array;
	if (data.positions instanceof Int16Array) {
		positions = new Float32Array(data.positions.length);
		for (let i = 0; i < positions.length; i++) positions[i] = data.positions[i] / 1024;
	} else positions = data.positions;
	geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
	geometry.setAttribute("normal", new THREE.BufferAttribute(data.normals, 3, true));
	geometry.setAttribute("uv", new THREE.BufferAttribute(data.uvs, 2));
	geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
	for (const group of data.groups) geometry.addGroup(group.start, group.count, group.materialIndex);
	geometry.computeBoundingBox();
	geometry.computeBoundingSphere();
	return geometry;
}
export interface MeshHandle {
	root: THREE.Group;
	dispose(): void;
}
export function createMeshes(result: BuildResult, materials: THREE.Material[]): MeshHandle {
	for (const data of result.meshes)
		for (const group of data.groups)
			if (!materials[group.materialIndex])
				throw new RangeError(`Missing material ${group.materialIndex}`);
	const root = new THREE.Group();
	root.position.set(...result.origin);
	for (const data of result.meshes) {
		const mesh = new THREE.Mesh(createGeometry(data), materials);
		mesh.name = data.category;
		root.add(mesh);
	}
	let disposed = false;
	return {
		root,
		dispose() {
			if (disposed) return;
			disposed = true;
			root.removeFromParent();
			for (const child of root.children) (child as THREE.Mesh).geometry.dispose();
			root.clear();
		},
	};
}
/** Explicit lifecycle: no UI, keyboard handlers, ResizeObserver or automatic RAF. */
export class CanvasRenderer {
	readonly renderer: THREE.WebGLRenderer;
	readonly scene = new THREE.Scene();
	readonly camera = new THREE.PerspectiveCamera(50, 1, 0.1, 10000);
	private handles = new Set<MeshHandle>();
	private disposed = false;
	constructor(
		canvas: HTMLCanvasElement,
		options: { antialias?: boolean; pixelRatio?: number; background?: number } = {}
	) {
		this.renderer = new THREE.WebGLRenderer({ canvas, antialias: options.antialias ?? true });
		this.renderer.setPixelRatio(options.pixelRatio ?? 1);
		this.scene.background = new THREE.Color(options.background ?? 0x111d26);
		this.scene.add(new THREE.HemisphereLight(0xffffff, 0x506878, 2));
		const light = new THREE.DirectionalLight(0xffffff, 2.5);
		light.position.set(20, 40, 30);
		this.scene.add(light);
		this.camera.position.set(24, 20, 24);
		this.camera.lookAt(0, 0, 0);
	}
	private assertLive(): void {
		if (this.disposed) throw new Error("CanvasRenderer is disposed");
	}
	add(result: BuildResult, materials: THREE.Material[]): MeshHandle {
		this.assertLive();
		const handle = createMeshes(result, materials);
		this.scene.add(handle.root);
		const dispose = handle.dispose;
		handle.dispose = () => {
			this.handles.delete(handle);
			dispose();
		};
		this.handles.add(handle);
		return handle;
	}
	resize(width: number, height: number): void {
		this.assertLive();
		if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0)
			throw new RangeError("Invalid canvas dimensions");
		this.renderer.setSize(width, height, false);
		this.camera.aspect = width / height;
		this.camera.updateProjectionMatrix();
	}
	render(): void {
		this.assertLive();
		this.renderer.render(this.scene, this.camera);
	}
	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		for (const handle of this.handles) handle.dispose();
		this.renderer.dispose();
	}
}
