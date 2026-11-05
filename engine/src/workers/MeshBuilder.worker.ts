import { MeshBuilder } from '../core/index.js';
import type { PaletteItem, Vec3 } from '../core/index.js';
/** Fallback entry: same compact TS core, no WASM or UI imports. */
const builders = new Map<string, MeshBuilder>();
self.onmessage = (event: MessageEvent) => {
  const data = event.data, context = data.meshContextId ?? 'default';
  try {
    if (data.type === 'disposeContext') { builders.get(context)?.dispose(); builders.delete(context); return; }
    let builder = builders.get(context);
    if (!builder) { builder = new MeshBuilder(); builders.set(context,builder); }
    if (data.type === 'updatePalette') {
      builder.updatePalette(data.paletteData as PaletteItem[]);
      self.postMessage({type:'paletteUpdated',count:data.paletteData.length});
    } else if (data.type === 'buildChunk') {
      const blocks = data.blocks instanceof Int32Array ? data.blocks : new Int32Array(data.blocks.flat());
      const start = performance.now();
      const result = builder.build({blocks,origin:data.chunkOrigin as Vec3 | undefined,apron:data.apronBlocks});
      const transfer: Transferable[] = [];
      for (const mesh of result.meshes) for (const array of [mesh.positions,mesh.normals,mesh.uvs,mesh.indices]) transfer.push(array.buffer as ArrayBuffer);
      self.postMessage({type:'chunkBuilt',chunkId:data.chunkId,meshes:result.meshes,origin:result.origin,timings:{total:performance.now()-start}}, {transfer});
    } else throw new Error('Unknown mesh worker request');
  } catch (error) {
    self.postMessage({type:'error',chunkId:data.chunkId,error:error instanceof Error ? error.message : String(error)});
  }
};
