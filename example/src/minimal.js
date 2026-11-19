import { createWorkshop, nameFor, materialsToCsv } from '@rsw/mc-java-render-ts';
const $ = id => document.getElementById(id);
let workshop, materials = [], busy = true;
function setBusy(value) {
  busy = value;
  for (const id of ['open', 'fit', 'mode', 'export']) $(id).disabled = value;
}
async function load(action) {
  setBusy(true); $('status').textContent = 'Reading the schematic…';
  try {
    const result = await action();
    materials = result.materials;
    await workshop.camera.fit();
    $('status').textContent = `${result.filename}\n${result.dimensions.join(' × ')}\n${result.totalBlocks.toLocaleString()} blocks · ${materials.length} materials`;
    $('materials').replaceChildren(...materials.map(item => {
      const li = document.createElement('li');
      li.textContent = `${nameFor(item.id)} × ${item.count}`; return li;
    }));
  } catch (error) { $('status').textContent = `Failed to load: ${error.message}`; }
  finally { setBusy(false); }
}
$('open').onclick = () => $('file').click();
$('file').onchange = event => {
  const file = event.target.files[0]; event.target.value = '';
  if (file && !busy) load(() => workshop.loadFile(file));
};
$('fit').onclick = () => workshop.camera.fit();
$('mode').onclick = () => {
  workshop.camera.setMode(workshop.camera.mode === 'ortho' ? 'orbit' : 'ortho');
  $('mode').textContent = workshop.camera.mode === 'ortho' ? 'Perspective' : 'Orthographic';
};
$('export').onclick = () => {
  const url = URL.createObjectURL(new Blob([materialsToCsv(materials)], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = 'materials.csv'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
try {
  workshop = await createWorkshop({ canvas: $('canvas'), resourcePackUrl: 'https://piston-data.mojang.com/v1/objects/e877b6a07acd633fb3bb475002175cec036e7b87/client.jar',
    rendererOptions: { backgroundColor: '#dfe6d7', maxPixelRatio: 1, cameraOptions: { position: [20, 20, 20], preserveCameraOnUpdate: true } } });
  window.workshop = workshop;
  await load(() => workshop.loadUrl('./schematics/inspection-demo.litematic'));
} catch (error) { $('status').textContent = `Initialization failed: ${error.message}`; }
window.addEventListener('pagehide', event => { if (!event.persisted) workshop?.dispose(); });
