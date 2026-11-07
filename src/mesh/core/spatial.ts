import type { Vec3 } from "./types.js";
export interface Bounds {
	min: Vec3;
	max: Vec3;
}
export function distanceSquaredToBox(point: Vec3, box: Bounds): number {
	let sum = 0;
	for (let a = 0; a < 3; a++) {
		const d = Math.max(box.min[a] - point[a], 0, point[a] - box.max[a]);
		sum += d * d;
	}
	return sum;
}
/** Stable smallest K in ascending order. O(N log K), O(K) temporary storage. */
export function topK<T>(items: Iterable<T>, k: number, compare: (a: T, b: T) => number): T[] {
	if (!Number.isSafeInteger(k) || k < 0)
		throw new RangeError("k must be a nonnegative safe integer");
	if (k === 0) return [];
	type Entry = { value: T; order: number };
	const heap: Entry[] = [];
	const cmp = (a: Entry, b: Entry) => compare(a.value, b.value) || a.order - b.order;
	let order = 0;
	for (const value of items) {
		const e = { value, order: order++ };
		if (heap.length < k) {
			let i = heap.length;
			heap.push(e);
			while (i > 0) {
				const p = (i - 1) >> 1;
				if (cmp(heap[p], e) >= 0) break;
				heap[i] = heap[p];
				i = p;
			}
			heap[i] = e;
		} else if (cmp(e, heap[0]) < 0) {
			let i = 0;
			while (i * 2 + 1 < heap.length) {
				let c = i * 2 + 1;
				if (c + 1 < heap.length && cmp(heap[c + 1], heap[c]) > 0) c++;
				if (cmp(heap[c], e) <= 0) break;
				heap[i] = heap[c];
				i = c;
			}
			heap[i] = e;
		}
	}
	return heap.sort(cmp).map((e) => e.value);
}
