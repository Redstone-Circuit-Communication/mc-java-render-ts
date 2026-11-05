import { DIRECTIONS } from './types.js';
import type { BuildRequest, BuildResult, MeshData, PaletteItem, Vec3 } from './types.js';
import { preparePalette, visibleTemplate, neighborHidesFace } from './palette.js';
import type { PreparedItem, Template } from './palette.js';

interface Part { template: Template; x: number; y: number; z: number }
interface Batch { materials: Map<number, Part[]>; vertices: number; indices: number; quantized: boolean }
const EMPTY = new Int32Array();
const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
/** Stateful palette compiler; no DOM, Three.js, globals or WASM dependency. */
export class MeshBuilder {
  private palette = new Map<number, PreparedItem>();
  private readonly cacheLimit: number;
  constructor(items: readonly PaletteItem[] = [], options: { templatesPerGeometry?: number } = {}) {
    this.cacheLimit = options.templatesPerGeometry ?? 64;
    if (!Number.isInteger(this.cacheLimit) || this.cacheLimit < 0 || this.cacheLimit > 64) throw new RangeError('templatesPerGeometry must be 0..64');
    this.updatePalette(items);
  }
  updatePalette(items: readonly PaletteItem[]): void { this.palette = preparePalette(items); }
  dispose(): void { this.palette.clear(); }
  build(request: BuildRequest): BuildResult {
    const { blocks, apron = EMPTY } = request;
    if (!(blocks instanceof Int32Array) || !(apron instanceof Int32Array) || blocks.length % 4 || apron.length % 4)
      throw new RangeError('Blocks and apron must contain Int32 [x,y,z,paletteIndex] tuples');
    if (request.positions !== undefined && request.positions !== 'auto' && request.positions !== 'float32') throw new RangeError('Unknown position encoding');
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < blocks.length; i += 4) {
      minX = Math.min(minX, blocks[i]); maxX = Math.max(maxX, blocks[i]);
      minY = Math.min(minY, blocks[i+1]); maxY = Math.max(maxY, blocks[i+1]);
      minZ = Math.min(minZ, blocks[i+2]); maxZ = Math.max(maxZ, blocks[i+2]);
    }
    const origin: Vec3 = request.origin ? [...request.origin] : blocks.length ? [minX,minY,minZ] : [0,0,0];
    if (origin.length !== 3 || !origin.every(Number.isFinite)) throw new RangeError('Invalid origin');
    const stats = { blocks: blocks.length / 4, vertices: 0, triangles: 0, bytes: 0 };
    if (!blocks.length) return { origin, meshes: [], stats };
    const sx = maxX-minX+3, sy = maxY-minY+3, sz = maxZ-minZ+3, volume = sx*sy*sz;
    // Dense access for ordinary chunks; avoid huge allocations for sparse or distant inputs.
    const dense = Number.isSafeInteger(volume) && volume <= 4_194_304 && volume <= Math.max(4096, blocks.length*8)
      ? new Int32Array(volume) : undefined;
    const sparse = dense ? undefined : new Map<string, number>();
    const inside = (x: number,y: number,z: number) => x>=minX-1 && x<=maxX+1 && y>=minY-1 && y<=maxY+1 && z>=minZ-1 && z<=maxZ+1;
    const at = (x: number,y: number,z: number) => x-minX+1+(y-minY+1)*sx+(z-minZ+1)*sx*sy;
    const get = (x: number,y: number,z: number): number => dense ? (inside(x,y,z) ? dense[at(x,y,z)] : 0) : sparse!.get(key(x,y,z)) ?? 0;
    const set = (x: number,y: number,z: number,p: number) => { if(dense) dense[at(x,y,z)] = p; else sparse!.set(key(x,y,z),p); };
    for (let i=0;i<blocks.length;i+=4) {
      const x=blocks[i], y=blocks[i+1], z=blocks[i+2], p=blocks[i+3];
      if (!this.palette.has(p)) throw new RangeError(`Unknown palette index ${p}`);
      if (get(x,y,z)) throw new RangeError(`Duplicate block at ${key(x,y,z)}`);
      set(x,y,z,p+1);
    }
    for (let i=0;i<apron.length;i+=4) {
      const x=apron[i],y=apron[i+1],z=apron[i+2],p=apron[i+3];
      if (!inside(x,y,z) || get(x,y,z)) continue;
      if (!this.palette.has(p)) throw new RangeError(`Unknown apron palette index ${p}`);
      set(x,y,z,p+1);
    }
    const batches = new Map<string, Batch>();
    for (let i=0;i<blocks.length;i+=4) {
      const x=blocks[i],y=blocks[i+1],z=blocks[i+2], item=this.palette.get(blocks[i+3])!;
      let hidden=0;
      for(let f=0;f<6;f++) {
        const d=DIRECTIONS[f], neighbor=this.palette.get(get(x+d[0],y+d[1],z+d[2])-1);
        if(neighbor && neighborHidesFace(item,neighbor,f)) hidden |= 1<<f;
      }
      for(const prepared of item.geometries) {
        const template=visibleTemplate(prepared,hidden,this.cacheLimit);
        if (!template.indices.length) continue;
        const category=item.category ?? 'solid';
        let batch=batches.get(category);
        if(!batch) { batch={materials:new Map(),vertices:0,indices:0,quantized:request.positions!=='float32'}; batches.set(category,batch); }
        const part={template,x:x-origin[0],y:y-origin[1],z:z-origin[2]};
        if(batch.quantized) for(let axis=0;axis<3;axis++) {
          const offset=axis===0?part.x:axis===1?part.y:part.z;
          if(Math.round((template.min[axis]+offset)*1024)<-32768 || Math.round((template.max[axis]+offset)*1024)>32767) {
            batch.quantized=false;break;
          }
        }
        let list=batch.materials.get(template.materialIndex);
        if(!list) {list=[];batch.materials.set(template.materialIndex,list);}
        list.push(part); batch.vertices+=template.positions.length/3; batch.indices+=template.indices.length;
      }
    }
    const meshes: MeshData[]=[];
    for(const [category,batch] of batches) {
      const positions=batch.quantized?new Int16Array(batch.vertices*3):new Float32Array(batch.vertices*3);
      const normals=new Int8Array(batch.vertices*3),uvs=new Float32Array(batch.vertices*2);
      const indices=batch.vertices>65536?new Uint32Array(batch.indices):new Uint16Array(batch.indices);
      const groups: MeshData['groups']=[];
      let vo=0,io=0;
      for(const [materialIndex,parts] of batch.materials) {
        const start=io;
        for(const {template:t,x,y,z} of parts) {
          for(let v=0;v<t.positions.length;v++) {
            const p=t.positions[v]+(v%3===0?x:v%3===1?y:z);
            positions[vo*3+v]=batch.quantized?Math.round(p*1024):p;

          }
          normals.set(t.packedNormals,vo*3);
          uvs.set(t.uvs,vo*2);
          for(let j=0;j<t.indices.length;j++) indices[io++]=vo+t.indices[j];
          vo+=t.positions.length/3;
        }
        groups.push({start,count:io-start,materialIndex});
      }
      meshes.push({category,positions,normals,uvs,indices,groups});
      stats.vertices+=batch.vertices; stats.triangles+=batch.indices/3;
      stats.bytes+=positions.byteLength+normals.byteLength+uvs.byteLength+indices.byteLength;
    }
    return {origin,meshes,stats};
  }
}
