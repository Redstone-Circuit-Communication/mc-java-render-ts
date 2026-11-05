import type { MaterialsResult } from './types.js';

export interface MaterialsWorker {
  onmessage: ((event: MessageEvent<{ id: number; result: MaterialsResult; error?: string }>) => void) | null;
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
  constructor(private createWorker: () => MaterialsWorker = () =>
    new Worker(new URL('./materials.worker.js', import.meta.url), { type: 'module' }),
    private timeoutMs = 120000) {}
  count(buffer: ArrayBuffer): Promise<MaterialsResult> {
    if (this.disposed) return Promise.reject(new Error('材料统计已关闭'));
    return new Promise((resolve, reject) => {
      try {
        if (!this.worker) {
          const worker = this.worker = this.createWorker();
          worker.onmessage = ({ data }) => {
            const request = this.pending.get(data.id);
            if (!request) return;
            this.pending.delete(data.id);
            clearTimeout(request.timeout);
            if (data.error) request.reject(new Error(data.error));
            else request.resolve(data.result);
          };
          worker.onerror = () => { if (this.worker === worker) this.reset(new Error('材料统计线程出错，请重试')); };
          worker.onmessageerror = () => { if (this.worker === worker) this.reset(new Error('无法读取材料统计结果')); };
        }
        const id = ++this.serial;
        const copy = buffer.slice(0);
        const timeout = setTimeout(() => this.reset(new Error('材料统计超时，请重试')), this.timeoutMs);
        this.pending.set(id, { resolve, reject, timeout });
        this.worker.postMessage({ id, buffer: copy }, [copy]);
      } catch (error) { this.reset(error); reject(error); }
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
  dispose(): void { this.disposed = true; this.reset(new Error('材料统计已关闭')); }
}
