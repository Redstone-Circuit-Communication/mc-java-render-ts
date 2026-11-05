import type { BuildRequest, BuildResult, PaletteItem } from '../core/index.js';
export type WorkerRequest = { id: number; type: 'palette'; palette: PaletteItem[] } |
  { id: number; type: 'build'; request: BuildRequest };
export type WorkerResponse = { id: number; type: 'ready' } | { id: number; type: 'built'; result: BuildResult } |
  { id: number; type: 'error'; error: string };
/** No globals installed on import. Supply a dedicated module Worker owned by this client. */
export class MeshWorkerClient {
  private sequence=0;
  private pending=new Map<number,{resolve:(r:BuildResult|undefined)=>void;reject:(e:Error)=>void;cleanup:()=>void}>();
  private disposed=false;
  private worker: Worker;
  constructor(worker: Worker) {
    this.worker=worker;
    worker.addEventListener('message',this.onMessage);
    worker.addEventListener('error',this.onError);
    worker.addEventListener('messageerror',this.onError);
  }
  private onMessage=(event: MessageEvent<WorkerResponse>)=>{
    const message=event.data, entry=this.pending.get(message.id);if(!entry)return;
    this.pending.delete(message.id);entry.cleanup();
    if(message.type==='error')entry.reject(new Error(message.error));
    else entry.resolve(message.type==='built'?message.result:undefined);
  };
  private onError=()=>{this.dispose(new Error('Mesh worker failed'));};
  private send(message: WorkerRequest, signal?: AbortSignal, transfer: Transferable[]=[]): Promise<BuildResult|undefined> {
    if(this.disposed)return Promise.reject(new Error('MeshWorkerClient is disposed'));
    if(signal?.aborted)return Promise.reject(new DOMException('Aborted','AbortError'));
    return new Promise((resolve,reject)=>{
      const abort=()=>{this.pending.delete(message.id);signal?.removeEventListener('abort',abort);reject(new DOMException('Aborted','AbortError'));};
      const cleanup=()=>signal?.removeEventListener('abort',abort);
      this.pending.set(message.id,{resolve,reject,cleanup});signal?.addEventListener('abort',abort,{once:true});
      try {this.worker.postMessage(message,transfer);} catch(error) {this.pending.delete(message.id);cleanup();reject(error);}
    });
  }
  async updatePalette(palette: PaletteItem[]): Promise<void> {await this.send({id:++this.sequence,type:'palette',palette});}
  async build(request: BuildRequest, options: { signal?: AbortSignal; transfer?: boolean } = {}): Promise<BuildResult> {
    const transfer: Transferable[]=[];
    if(options.transfer) for(const array of [request.blocks,request.apron])
      if(array?.buffer instanceof ArrayBuffer && !transfer.includes(array.buffer)) transfer.push(array.buffer);
    return (await this.send({id:++this.sequence,type:'build',request},options.signal,transfer))!;
  }
  /** Abort drops the result; terminate/dispose is required to interrupt synchronous work. */
  dispose(reason=new Error('MeshWorkerClient is disposed')): void {
    if(this.disposed)return;this.disposed=true;this.worker.terminate();
    this.worker.removeEventListener('message',this.onMessage);this.worker.removeEventListener('error',this.onError);
    this.worker.removeEventListener('messageerror',this.onError);
    for(const entry of this.pending.values()){entry.cleanup();entry.reject(reason);}this.pending.clear();
  }
}
