import type { SchematicRenderer } from '../engine/index.mjs';
import { MaterialsCounter } from './materials-client.js';
import type { Material, MaterialsResult } from './types.js';
export type LoadedSchematic = ReturnType<NonNullable<SchematicRenderer['schematicManager']>['getAllSchematics']>[number];
export interface BlueprintResult extends MaterialsResult {
  id: string; filename: string; schematic: LoadedSchematic; dimensions: number[]; totalBlocks: number;
}
export interface MaterialCounter { count(buffer: ArrayBuffer): Promise<MaterialsResult>; dispose(): void }
export interface BlueprintLoaderOptions {
  counter?: MaterialCounter;
  /** Runs after the new scene is built and before the old scene is removed. */
  beforeReplace?: () => void;
}
const AIR = new Set(['minecraft:air', 'minecraft:cave_air', 'minecraft:void_air']);
/** Serializes loads; parse/build failures leave the previous blueprint intact. */
export class BlueprintLoader {
  private counter: MaterialCounter;
  private serial = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private disposed = false;
  private namespace = `workshop-${Math.random().toString(36).slice(2)}`;
  constructor(private renderer: SchematicRenderer, private options: BlueprintLoaderOptions = {}) {
    this.counter = options.counter ?? new MaterialsCounter();
  }
  load(buffer: ArrayBuffer, filename: string): Promise<BlueprintResult> {
    if (this.disposed) return Promise.reject(new Error('蓝图加载器已关闭'));
    if (!/\.(litematic|schem|schematic|nbt)$/i.test(filename))
      return Promise.reject(new Error('不支持的蓝图格式'));
    // Snapshot before queuing so caller mutations cannot corrupt an upcoming load.
    const copy = buffer.slice(0);
    const task = this.queue.then(() => this.loadOne(copy, filename));
    this.queue = task.catch(() => undefined);
    return task;
  }
  async loadFile(file: File): Promise<BlueprintResult> { return this.load(await file.arrayBuffer(), file.name); }
  async loadUrl(url: string | URL, init?: RequestInit): Promise<BlueprintResult> {
    const response = await fetch(url, init);
    if (!response.ok) throw new Error(`蓝图请求失败（HTTP ${response.status}）`);
    const pathname = String(url).split(/[?#]/)[0];
    const filename = decodeURIComponent(pathname.split('/').pop() || 'blueprint.litematic');
    return this.load(await response.arrayBuffer(), filename);
  }
  private assertOpen(): void { if (this.disposed) throw new Error('蓝图加载器已关闭'); }
  private async loadOne(buffer: ArrayBuffer, filename: string): Promise<BlueprintResult> {
    this.assertOpen();
    const manager = this.renderer.schematicManager;
    if (!manager) throw new Error('渲染器尚未初始化');
    const id = `${this.namespace}-${++this.serial}`;
    try {
      let result = /\.litematic$/i.test(filename) ? await this.counter.count(buffer) : null;
      this.assertOpen();
      await manager.loadSchematic(id, buffer, { focused: false });
      this.assertOpen();
      const schematic = manager.getAllSchematics().find(s => s.id === id);
      if (!schematic) throw new Error('蓝图加载后未找到场景');
      schematic.group.visible = false;
      await schematic.getMeshes();
      this.assertOpen();
      if (!result) {
        const counts = JSON.parse(schematic.schematicWrapper.native.countBlocksJson()) as Record<string, number>;
        const materials: Material[] = Object.entries(counts)
          .filter(([block, count]) => !AIR.has(block.split('[')[0]) && Number.isFinite(count) && count > 0)
          .map(([id, count]) => ({ id, count, stacks: Math.floor(count / 64), remainder: count % 64 }))
          .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
        result = { regionCount: 1, materials };
      }
      const dimensions = schematic.getTightDimensions();
      this.options.beforeReplace?.();
      for (const old of manager.getAllSchematics())
        if (old.id !== id) await manager.removeSchematic(old.id);
      schematic.group.visible = true;
      this.renderer.invalidate();
      return { ...result, id, filename, schematic, dimensions,
        totalBlocks: result.materials.reduce((n, m) => n + m.count, 0) };
    } catch (error) {
      try { await manager.removeSchematic(id); } catch { /* Preserve the original failure. */ }
      throw error;
    }
  }
  /** Stops the worker immediately; await completion before disposing the renderer. */
  async dispose(): Promise<void> { this.disposed = true; this.counter.dispose(); await this.queue; }
}
