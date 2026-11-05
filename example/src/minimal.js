import { createWorkshop, nameFor, materialsToCsv } from '@rsw/mc-java-render-ts';
const $ = id => document.getElementById(id);
let workshop, materials = [], busy = true;
function setBusy(value) {
  busy = value;
  for (const id of ['open', 'fit', 'mode', 'export']) $(id).disabled = value;
}
async function load(action) {
  setBusy(true); $('status').textContent = '正在读取蓝图…';
  try {
    const result = await action();
    materials = result.materials;
    await workshop.camera.fit();
    $('status').textContent = `${result.filename}\n${result.dimensions.join(' × ')} 格\n${result.totalBlocks.toLocaleString()} 方块 · ${materials.length} 种材料`;
    $('materials').replaceChildren(...materials.map(item => {
      const li = document.createElement('li');
      li.textContent = `${nameFor(item.id)} × ${item.count}`; return li;
    }));
  } catch (error) { $('status').textContent = `加载失败：${error.message}`; }
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
  $('mode').textContent = workshop.camera.mode === 'ortho' ? '切换透视' : '切换正交';
};
$('export').onclick = () => {
  const url = URL.createObjectURL(new Blob([materialsToCsv(materials)], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = '材料清单.csv'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
try {
  workshop = await createWorkshop({ canvas: $('canvas'), resourcePackUrl: './packs/vanilla_pack_fixed.zip',
    rendererOptions: { backgroundColor: '#dfe6d7', maxPixelRatio: 1, cameraOptions: { position: [20, 20, 20], preserveCameraOnUpdate: true } } });
  window.workshop = workshop;
  await load(() => workshop.loadUrl('./schematics/inspection-demo.litematic'));
} catch (error) { $('status').textContent = `初始化失败：${error.message}`; }
window.addEventListener('pagehide', event => { if (!event.persisted) workshop?.dispose(); });
