import MaterialsWorkerModule from "./materials.worker?worker&inline";
import type { MaterialsResult } from "./types.js";

export interface MaterialsWorker {
	onmessage:
		((event: MessageEvent<{ id: number; result: MaterialsResult; error?: string }>) => void) | null;
	onerror: ((event: ErrorEvent) => void) | null;
	onmessageerror: ((event: MessageEvent) => void) | null;
	postMessage(message: { id: number; buffer: ArrayBuffer }, transfer: Transferable[]): void;
	terminate(): void;
}
interface Pending {
	resolve: (value: MaterialsResult) => void;
	reject: (reason: unknown) => void;
	timeout: ReturnType<typeof setTimeout>;
}
/** Lazy, reusable worker. Input buffers remain owned by the caller. */
export class MaterialsCounter {
	private worker: MaterialsWorker | null = null;
	private pending = new Map<number, Pending>();
	private serial = 0;
	private disposed = false;
	constructor(
		private createWorker: () => MaterialsWorker = () => new MaterialsWorkerModule(),
		private timeoutMs = 120000
	) {}
	count(buffer: ArrayBuffer): Promise<MaterialsResult> {
		if (this.disposed) return Promise.reject(new Error("the material counter has been disposed"));
		return new Promise((resolve, reject) => {
			try {
				if (!this.worker) {
					const worker = (this.worker = this.createWorker());
					worker.onmessage = ({ data }) => {
						const request = this.pending.get(data.id);
						if (!request) return;
						this.pending.delete(data.id);
						clearTimeout(request.timeout);
						if (data.error) request.reject(new Error(data.error));
						else request.resolve(data.result);
					};
					worker.onerror = () => {
						if (this.worker === worker)
							this.reset(new Error("the material counting worker failed; try again"));
					};
					worker.onmessageerror = () => {
						if (this.worker === worker)
							this.reset(new Error("cannot read the material counting result"));
					};
				}
				const id = ++this.serial;
				const copy = buffer.slice(0);
				const timeout = setTimeout(
					() => this.reset(new Error("material counting timed out; try again")),
					this.timeoutMs
				);
				this.pending.set(id, { resolve, reject, timeout });
				this.worker.postMessage({ id, buffer: copy }, [copy]);
			} catch (error) {
				this.reset(error);
				reject(error);
			}
		});
	}
	reset(error: unknown): void {
		this.worker?.terminate();
		this.worker = null;
		for (const request of this.pending.values()) {
			clearTimeout(request.timeout);
			request.reject(error);
		}
		this.pending.clear();
	}
	dispose(): void {
		this.disposed = true;
		this.reset(new Error("the material counter has been disposed"));
	}
}
