import * as THREE from "three";

interface Item {
	world: THREE.Box3;
}
interface Node<T> {
	box: THREE.Box3;
	left?: Node<T>;
	right?: Node<T>;
	items?: T[];
}
/** Static topology, refittable bounds. Keeps exact leaf tests and never reduces visibility quality. */
export class ChunkSpatialIndex<T extends Item> {
	private readonly root: Node<T>;
	private stack: Node<T>[] = [];
	public visitedNodes = 0;
	public testedItems = 0;
	constructor(items: T[]) {
		this.root = this.build(items.slice());
	}
	private build(items: T[]): Node<T> {
		const box = new THREE.Box3();
		for (const item of items) box.union(item.world);
		if (items.length <= 8) return { box, items };
		const extent = box.getSize(new THREE.Vector3());
		const axis =
			extent.x >= extent.y && extent.x >= extent.z ? "x" : extent.y >= extent.z ? "y" : "z";
		items.sort(
			(a, b) => a.world.min[axis] + a.world.max[axis] - (b.world.min[axis] + b.world.max[axis])
		);
		const middle = items.length >> 1;
		return {
			box,
			left: this.build(items.slice(0, middle)),
			right: this.build(items.slice(middle)),
		};
	}
	refit(): void {
		const visit = (node: Node<T>) => {
			node.box.makeEmpty();
			if (node.items) for (const item of node.items) node.box.union(item.world);
			else {
				const { left, right } = node;
				if (!left || !right) throw new Error("Malformed spatial index node");
				visit(left);
				visit(right);
				node.box.union(left.box).union(right.box);
			}
		};
		visit(this.root);
	}
	query(
		frustum: THREE.Frustum | undefined,
		position: THREE.Vector3,
		maxDistance: number,
		output: T[]
	): void {
		this.visitedNodes = 0;
		this.testedItems = 0;
		const limit = maxDistance > 0 ? maxDistance * maxDistance : Infinity;
		const accepts = (box: THREE.Box3) => {
			if (frustum && !frustum.intersectsBox(box)) return false;
			if (limit === Infinity) return true;
			const dx = Math.max(box.min.x - position.x, 0, position.x - box.max.x);
			const dy = Math.max(box.min.y - position.y, 0, position.y - box.max.y);
			const dz = Math.max(box.min.z - position.z, 0, position.z - box.max.z);
			return dx * dx + dy * dy + dz * dz <= limit;
		};
		this.stack.length = 0;
		this.stack.push(this.root);
		while (this.stack.length) {
			const node = this.stack.pop();
			if (!node) break;
			this.visitedNodes++;
			if (!accepts(node.box)) continue;
			if (node.items)
				for (const item of node.items) {
					this.testedItems++;
					if (accepts(item.world)) output.push(item);
				}
			else {
				const { left, right } = node;
				if (!left || !right) throw new Error("Malformed spatial index node");
				this.stack.push(right, left);
			}
		}
	}
}
