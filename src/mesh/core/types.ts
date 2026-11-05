export type Vec3 = readonly [number, number, number];
export interface Geometry {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint16Array | Uint32Array;
  materialIndex: number;
}
/** Face bits: west, east, down, up, north, south. Only full faces occlude. */
export interface PaletteItem {
  index: number;
  category?: string;
  occlusionFlags: number;
  selfOcclusionFlags?: number;
  cullGroup?: string;
  geometries: readonly Geometry[];
}
export interface Group { start: number; count: number; materialIndex: number }
export interface MeshData {
  category: string;
  /** Local positions. Decode Int16 by /1024; Float32 is already in block units. */
  positions: Int16Array | Float32Array;
  /** Decode Int8 using normalized=true or /127. */
  normals: Int8Array;
  uvs: Float32Array;
  indices: Uint16Array | Uint32Array;
  groups: Group[];
}
export interface BuildRequest {
  /** Flat [worldX, worldY, worldZ, paletteIndex, ...], integer block centers. */
  blocks: Int32Array;
  origin?: Vec3;
  /** Neighbours participate in occlusion but are never emitted. */
  apron?: Int32Array;
  /** auto = rounded Int16 if every value fits, otherwise Float32. */
  positions?: 'auto' | 'float32';
}
export interface BuildResult {
  origin: Vec3;
  meshes: MeshData[];
  stats: { blocks: number; vertices: number; triangles: number; bytes: number };
}
export const DIRECTIONS: readonly Vec3[] = [
  [-1,0,0], [1,0,0], [0,-1,0], [0,1,0], [0,0,-1], [0,0,1],
];
