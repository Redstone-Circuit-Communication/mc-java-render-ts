import { countLitematicMaterials } from './materials.js';
const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent<{ id: number; buffer: ArrayBuffer }>) => void;
  postMessage(message: unknown): void;
};
scope.onmessage = async ({ data: { id, buffer } }) => {
  try { scope.postMessage({ id, result: await countLitematicMaterials(buffer) }); }
  catch (error) { scope.postMessage({ id, error: error instanceof Error ? error.message : String(error) }); }
};
