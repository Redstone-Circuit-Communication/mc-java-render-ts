import { createWorkshop, BlueprintLoader, CameraControls, readBlockInventory, materialsToCsv, type BlueprintResult, type Position } from '@rsw/mc-java-render-ts';
import { countLitematicMaterials } from '@rsw/mc-java-render-ts/core';
import { MeshBuilder } from '@rsw/mc-java-render-ts/mesh';
async function use(canvas: HTMLCanvasElement, buffer: ArrayBuffer) {
  const workshop = await createWorkshop({ canvas, resourcePackUrl: '/pack.zip' });
  const result: BlueprintResult = await workshop.load(buffer, 'test.litematic');
  const position: Position = [0, 0, 0];
  const inventory = readBlockInventory(result.schematic, position);
  workshop.renderer.eventEmitter.on('test', () => {});
  new CameraControls(workshop.renderer).align(position);
  new BlueprintLoader(workshop.renderer);
  materialsToCsv((await countLitematicMaterials(buffer)).materials);
  new MeshBuilder([]).build({blocks: new Int32Array()});
  await workshop.dispose();
  return inventory;
}
void use;
