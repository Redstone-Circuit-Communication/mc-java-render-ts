import { Matrix3, Mesh, Raycaster, type Camera, type Vector2 } from 'three';
import type { SchematicRenderer } from '../engine/index.mjs';
import type { LoadedSchematic } from './blueprint-loader.js';
import type { Position, EntitySummary } from './types.js';
import { entityFromObject } from './entities.js';
import { blockState, containerDefinition } from './inventory.js';
const isMesh = (object: import('three').Object3D): object is Mesh => (object as Mesh).isMesh === true;
export type PickResult =
  | { kind: 'block'; schematic: LoadedSchematic; position: Position; id: string }
  | { kind: 'entity'; schematic: LoadedSchematic; entity: EntitySummary };
/** ndc uses normalized device coordinates (-1..1), or (0, 0) for a crosshair. */
export function pickScene(renderer: SchematicRenderer, camera: Camera, ndc: Vector2, raycaster = new Raycaster()): PickResult | null {
  renderer.sceneManager.scene.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);
  raycaster.setFromCamera(ndc, camera);
  renderer.chunkVisibility?.update(camera);
  const meshes: Mesh[] = [];
  const owners = new Map<Mesh, LoadedSchematic>();
  for (const schematic of renderer.schematicManager?.getAllSchematics() ?? []) {
    if (!schematic.group.visible) continue;
    schematic.group.traverseVisible(object => {
      if (isMesh(object)) { meshes.push(object); owners.set(object, schematic); }
    });
  }
  for (const hit of raycaster.intersectObjects(meshes, false)) {
    if (!(isMesh(hit.object)) || !hit.face) continue;
    let visible = true;
    for (let parent: typeof hit.object.parent = hit.object; parent; parent = parent.parent)
      if (!parent.visible) visible = false;
    if (!visible) continue;
    const schematic = owners.get(hit.object);
    if (!schematic) continue;
    const entity = entityFromObject(hit.object);
    if (entity) return { kind: 'entity', schematic, entity };
    const normal = hit.face.normal.clone().applyNormalMatrix(new Matrix3().getNormalMatrix(hit.object.matrixWorld));
    const point = schematic.group.worldToLocal(hit.point.clone().addScaledVector(normal, -0.0001));
    const position: Position = [Math.floor(point.x + 0.5), Math.floor(point.y + 0.5), Math.floor(point.z + 0.5)];
    const id = schematic.schematicWrapper.get_block(...position);
    if (!id || /^minecraft:(air|cave_air|void_air)$/.test(id)) continue;
    return { kind: 'block', schematic, position, id };
  }
  return null;
}
export function listContainers(schematics: readonly LoadedSchematic[]) {
  const targets: { schematic: LoadedSchematic; position: Position; id: string }[] = [];
  for (const schematic of schematics) {
    for (const entity of schematic.getBlockEntitiesMap().values()) {
      const position: Position = [entity.position[0], entity.position[1], entity.position[2]];
      const state = schematic.schematicWrapper.get_block_string(...position) ?? '';
      if (containerDefinition(state)) targets.push({ schematic, position, id: blockState(state).id });
    }
  }
  return targets.sort((a, b) => a.position[1] - b.position[1] || a.position[0] - b.position[0] || a.position[2] - b.position[2]);
}
export function listEntities(schematics: readonly LoadedSchematic[]) {
  return schematics.flatMap(schematic => (schematic.entityManager?.records ?? []).map(entity => ({ schematic, entity })));
}
