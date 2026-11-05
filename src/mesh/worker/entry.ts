import { MeshBuilder } from '../core/index.js';
import type { WorkerRequest, WorkerResponse } from './index.js';
const builder=new MeshBuilder();
// Module-worker entry only; importing core or worker client never installs this handler.
const scope=globalThis as unknown as {onmessage:(e:MessageEvent<WorkerRequest>)=>void;postMessage:(m:WorkerResponse,transfer?:Transferable[])=>void};
scope.onmessage=event=>{
  const message=event.data;
  try {
    if(message.type==='palette'){builder.updatePalette(message.palette);scope.postMessage({id:message.id,type:'ready'});}
    else if(message.type==='build'){
      const result=builder.build(message.request),transfer:Transferable[]=[];
      for(const mesh of result.meshes)for(const a of [mesh.positions,mesh.normals,mesh.uvs,mesh.indices])transfer.push(a.buffer as ArrayBuffer);
      scope.postMessage({id:message.id,type:'built',result},transfer);
    } else throw new Error('Unknown worker request');
  }catch(error){scope.postMessage({id:message.id,type:'error',error:error instanceof Error?error.message:String(error)});}
};
