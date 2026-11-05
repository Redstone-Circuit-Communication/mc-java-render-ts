/** NBT contains version-specific keys and heterogeneous typed-tag wrappers. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 异构 NBT 形状随版本/来源变化，无法用有限联合类型建模
export type NbtData = any;
export type Position = [number, number, number];
export interface Material { id: string; count: number; stacks: number; remainder: number }
export interface MaterialsResult { regionCount: number; materials: Material[] }
export interface ContainerDefinition {
  name: string; size: number; columns: number; labels?: string[]; unavailable: boolean;
}
export interface InventoryItem {
  id: string; count: number; slot: number; raw: NbtData;
  customName: string; lore: string[]; enchanted: boolean;
}
export interface ContainerInventory extends ContainerDefinition {
  slots: (InventoryItem | null)[]; nbt: NbtData;
  state: 'loaded' | 'player' | 'loot' | 'missing' | 'partial';
  warnings: string[]; occupied: number; total: number; pairPosition?: Position;
}
export interface InventorySchematic {
  schematicWrapper: {
    get_block_string(x: number, y: number, z: number): string | undefined | null;
    get_block(x: number, y: number, z: number): string | undefined | null;
    getBlockEntitySnbt?(x: number, y: number, z: number): string | undefined | null;
  };
  getBlockEntitiesMap(): Map<string, { nbt?: NbtData }>;
}
export interface BlockInventory {
  state: string; position: Position; nbt: NbtData;
  snbt?: string | null; inventory: ContainerInventory | null;
}
export interface RedstoneInfo {
  active: boolean | null; status: string; strength: number | null;
  signalLabel: string; source: string; details: { label: string; value: string }[]; note: string;
}
export interface RenderSettingsValue {
  maxChunks: number; renderDistance: number; maxPixelRatio: number;
  targetFPS: number; ssao: boolean; frustumCulling: boolean;
}
export interface EntitySummary {
  id: string; nbt: NbtData; position?: number[]; rotation?: number[];
  status?: string; rawNbt?: NbtData; snbt?: string;
}
export interface EntityObject {
  parent: EntityObject | null;
  userData?: { kind?: string; entity?: EntitySummary; [key: string]: unknown };
}
