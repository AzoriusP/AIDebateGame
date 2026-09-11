import { PreviewModel } from './model';
import { CubismFramework, Option, LogLevel } from '../vendor/CubismWebFramework-5-r.5/src/live2dcubismframework';
import { CubismRenderer_WebGL } from '../vendor/CubismWebFramework-5-r.5/src/rendering/cubismrenderer_webgl';
import { folderSource, modelFiles, projectModelPath, urlSource } from './resources.mjs';
import { ACTING_PARAMETERS } from './acting.mjs';

const VENDOR = '/static/vendor/live2d/5-r.5/';
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('canvas');
const check = (id: string) => $<HTMLInputElement>(id).checked;
const selection = (id: string) => $<HTMLSelectElement>(id).value;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
function status(message: string, level = 'info') { $('status').textContent = message; $('status').dataset.level = level; }
type Source = { label: string; model(): Promise<ArrayBuffer>; asset(ref: string): Promise<ArrayBuffer>; dispose(): void };
type Control = { index: number; id: string; min: number; max: number; default: number; input?: HTMLInputElement; pin?: HTMLInputElement; output?: HTMLOutputElement };
const performance = new (window as any).DebatePerformance.Performance({ seed: 17 });
let rig: PreviewModel | null = null, pending: Source | null = null, generation = 0, raf = 0, last = 0, paused = false, corePromise: Promise<void> | null = null;
let selectedFiles: File[] = [], candidates: File[] = [];
let gl: WebGL2RenderingContext | null = null;

async function ensureCore() {
  if (corePromise) return corePromise;
  corePromise = (async () => {
    if (!(window as any).Live2DCubismCore) await new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      const timeout = setTimeout(() => { script.remove(); reject(new Error('Cubism Core 加载超时')); }, 15000);
      script.src = VENDOR + 'live2dcubismcore.min.js';
      script.onload = () => { clearTimeout(timeout); resolve(); };
      script.onerror = () => { clearTimeout(timeout); script.remove(); reject(new Error('缺少已获许可的 Cubism Core。请先完成 SDK 安装，再重新加载。')); };
      document.head.append(script);
    });
    const option = new Option(); option.loggingLevel = LogLevel.LogLevel_Error; option.logFunction = message => console.error('[Cubism]', message);
    if (!CubismFramework.isStarted() && !CubismFramework.startUp(option)) throw new Error('Cubism Framework 初始化失败');
    if (!CubismFramework.isInitialized()) CubismFramework.initialize();
    const shaders = ['vertshadersrc.vert', 'vertshadersrcmasked.vert', 'vertshadersrcsetupmask.vert', 'fragshadersrcsetupmask.frag', 'fragshadersrcpremultipliedalpha.frag', 'fragshadersrcmaskpremultipliedalpha.frag', 'fragshadersrcmaskinvertedpremultipliedalpha.frag', 'vertshadersrccopy.vert', 'fragshadersrccopy.frag', 'fragshadersrccolorblend.frag', 'fragshadersrcalphablend.frag', 'vertshadersrcblend.vert', 'fragshadersrcpremultipliedalphablend.frag'];
    await Promise.all(shaders.map(async name => { const response = await fetch(VENDOR + 'Shaders/' + name); if (!response.ok) throw new Error('缺少本地渲染文件：' + name); await response.text(); }));
  })().catch(error => { corePromise = null; throw error; });
  return corePromise;
}
function resize() {
  const rect = canvas.getBoundingClientRect(), ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(rect.width * ratio)), height = Math.max(1, Math.round(rect.height * ratio));
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  rig?.draw();
}
function stopLoop() { cancelAnimationFrame(raf); raf = 0; last = 0; }
function startLoop() { if (raf || !rig || paused || document.hidden) return; raf = requestAnimationFrame(frame); }
function frame(time: number) {
  raf = 0; if (!rig || paused || document.hidden) return;
  try { const dt = last ? clamp((time - last) / 1000, 0, .05) : 0; last = time; rig.update(dt); rig.draw(); refreshValues(); startLoop(); }
  catch (error) { stopLoop(); status('模型运行失败：' + (error as Error).message, 'error'); }
}
function refreshValues() {
  if (!rig) return;
  const facts = rig.facts();
  for (const p of rig.parameters) { const value = facts.parameters[p.index].value; if (p.output) p.output.value = value.toFixed(2); if (p.input && !p.pin?.checked) p.input.value = String(value); }
  for (const p of rig.parts) { const value = facts.partValues[p.index]; if (p.output) p.output.value = value.toFixed(2); if (p.input && !p.pin?.checked) p.input.value = String(value); }
}
function controls(container: string, items: Control[], pins: Map<number, number>) {
  const host = $(container); host.replaceChildren();
  for (const item of items) {
    const row = document.createElement('div'); row.className = 'parameter';
    const label = document.createElement('label'), pin = document.createElement('input'); pin.type = 'checkbox'; pin.setAttribute('aria-label', '固定 ' + item.id);
    label.append(pin, document.createTextNode(item.id));
    const input = document.createElement('input'); input.type = 'range'; input.min = String(item.min); input.max = String(item.max); input.step = String(Math.max((item.max - item.min) / 500, .001)); input.value = String(item.default); input.setAttribute('aria-label', item.id);
    const output = document.createElement('output'); output.value = item.default.toFixed(2);
    input.addEventListener('input', () => { pin.checked = true; pins.set(item.index, Number(input.value)); output.value = Number(input.value).toFixed(2); rig?.update(0); rig?.draw(); });
    pin.addEventListener('change', () => { if (pin.checked) pins.set(item.index, Number(input.value)); else pins.delete(item.index); rig?.update(0); rig?.draw(); });
    item.pin = pin; item.input = input; item.output = output; row.append(label, input, output); host.append(row);
  }
}
function setEnabled(loaded: boolean) { for (const id of ['pause', 'reset', 'unload', 'stop-motion', 'verify-bindings']) ($<HTMLButtonElement>(id)).disabled = !loaded; }
function optionList(id: string, names: string[], placeholder: string) {
  const select = $<HTMLSelectElement>(id); select.replaceChildren();
  names.forEach((name, index) => select.add(new OptionElement(name, String(index))));
  if (!names.length) select.add(new OptionElement(placeholder, '-1'));
  select.disabled = !names.length;
}
const OptionElement = window.Option;
function displayModel(model: PreviewModel) {
  const facts = model.facts();
  $('facts').textContent = `模型：${facts.source}\n${facts.drawables} 个真实网格 · ${facts.parameters.length} 个参数 · ${facts.parts.length} 个 Parts\n${facts.expressions.length} 个表情 · ${facts.motions.length} 个动作 · Core ${facts.coreVersion}`;
  controls('parameters', model.acting ? model.parameters.filter(p => ACTING_PARAMETERS.some(id => id === p.id)) : model.parameters, model.pins); controls('parts', model.parts, model.partPins);
  optionList('expression', model.expressions.map(x => x.name), '无表情文件');
  if (model.expressions.length) { const select = $<HTMLSelectElement>('expression'); select.insertBefore(new OptionElement('清除表情', '-1'), select.firstChild); select.value = '-1'; }
  optionList('motion', model.motions.map(x => x.name), '无动作文件');
  $<HTMLButtonElement>('apply-expression').disabled = !model.expressions.length;
  $<HTMLButtonElement>('play-motion').disabled = !model.motions.length;
  const objection = model.motions.findIndex(x => /objection|异议/i.test(x.name));
  $<HTMLButtonElement>('objection').disabled = objection < 0 && !model.acting;
  $('acting-controls').hidden = !model.acting;
  $('motion-note').textContent = model.acting ? '三姿势可独立眨眼、呼吸与说话；异议按钮会保持左手伸指，直到结束发言。' : objection >= 0 ? '已找到异议动作，播放后检查手臂与透视。' : '此模型未提供 Objection 异议动作，不显示替代动画。';
  $('empty').hidden = true; setEnabled(true);
}
function clearModel() {
  stopLoop(); rig?.dispose(); rig = null; pending?.dispose(); pending = null;
  if (gl && !gl.isContextLost()) { gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); }
  $('empty').hidden = false; $('facts').textContent = ''; $('parameters').replaceChildren(); $('parts').replaceChildren(); setEnabled(false);
  $('binding-report').textContent = '尚未检测。';
  delete $('binding-report').dataset.results;
  $('acting-controls').hidden = true;
  optionList('expression', [], '无表情文件'); optionList('motion', [], '无动作文件');
  for (const id of ['apply-expression', 'play-motion', 'objection']) $<HTMLButtonElement>(id).disabled = true;
}
async function load(source: Source) {
  const ticket = ++generation; clearModel(); pending = source; status('正在读取：' + source.label);
  let candidate: PreviewModel | null = null;
  try {
    gl ||= canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: true });
    if (!gl || gl.isContextLost()) throw new Error('当前浏览器无法建立 WebGL2。请启用硬件加速后重新打开。');
    resize(); await ensureCore(); if (ticket !== generation) return;
    candidate = new PreviewModel(source, { canvas, gl: gl!, performance, enabled: () => check('performance'), zoom: () => Number(selection('zoom')), isCurrent: () => pending === source, note: (id, text) => { $(id).textContent = text; } }); await candidate.initialize();
    if (ticket !== generation) { candidate.dispose(); return; }
    rig = candidate; performance.reset(); paused = false; $<HTMLButtonElement>('pause').textContent = '暂停'; $('pause').setAttribute('aria-pressed', 'false');
    for (const button of document.querySelectorAll<HTMLElement>('[data-state]')) button.setAttribute('aria-pressed', String(button.dataset.state === 'calm'));
    performance.setSpeaking(check('speaking'));
    displayModel(rig); rig.update(0); rig.draw(); startLoop();
    status('Cubism Core 已成功载入 .moc3，正在用真实网格和纹理渲染。请拖动参数核对画面形变。');
  } catch (error) {
    candidate?.dispose();
    if (ticket !== generation) return;
    clearModel(); status((error as Error).message + '\n请检查文件夹是否完整，并从 Cubism Editor 重新导出后重试。', 'error');
  }
}
$('load-proof').addEventListener('click', () => load(urlSource(projectModelPath('proof'), location.origin)));
$('load-male-master').addEventListener('click', () => load(urlSource(projectModelPath('male-master'), location.origin)));
$('load-male-acting').addEventListener('click', () => load(urlSource(projectModelPath('male-acting'), location.origin)));
$('folder').addEventListener('change', () => {
  selectedFiles = [...($<HTMLInputElement>('folder').files || [])]; candidates = modelFiles(selectedFiles);
  optionList('local-model', candidates.map(f => f.webkitRelativePath || f.name), '没有找到 .model3.json');
  $<HTMLButtonElement>('load-local').disabled = !candidates.length;
  if (!candidates.length) status('选择的文件夹中没有 .model3.json，请选择 Cubism 导出的完整文件夹。', 'error');
});
$('load-local').addEventListener('click', () => { const file = candidates[Number(selection('local-model'))]; if (file) load(folderSource(selectedFiles, file)); });
$('pause').addEventListener('click', () => { paused = !paused; $('pause').textContent = paused ? '继续' : '暂停'; $('pause').setAttribute('aria-pressed', String(paused)); if (paused) stopLoop(); else startLoop(); });
$('unload').addEventListener('click', () => { generation++; clearModel(); status('模型已卸载，纹理和模型内存已释放。'); });
$('reset').addEventListener('click', () => { rig?.reset(); performance.reset(); performance.setSpeaking(check('speaking')); for (const button of document.querySelectorAll<HTMLElement>('[data-state]')) button.setAttribute('aria-pressed', String(button.dataset.state === 'calm')); });
$('zoom').addEventListener('input', () => { $('zoom-value').textContent = Math.round(Number(selection('zoom')) * 100) + '%'; rig?.draw(); });
$('states').addEventListener('click', event => { const target = (event.target as HTMLElement).closest<HTMLElement>('[data-state]'); if (!target) return; performance.setEmotion(target.dataset.state); for (const button of document.querySelectorAll<HTMLElement>('[data-state]')) button.setAttribute('aria-pressed', String(button === target)); });
$('speaking').addEventListener('change', () => performance.setSpeaking(check('speaking')));
$('apply-expression').addEventListener('click', () => rig?.expression(Number(selection('expression'))));
$('play-motion').addEventListener('click', () => { rig?.play(Number(selection('motion'))); });
$('stop-motion').addEventListener('click', () => rig?.stop());
$('verify-bindings').addEventListener('click', () => {
  if (!rig) return;
  const results = rig.verifyBindings();
  $('binding-report').textContent = results.map(r => `${r.id}：${r.result}\n  变化网格 ${r.changedMeshes}；最大顶点差 ${r.vertexDelta.toFixed(6)}；最大透明度差 ${r.opacityDelta.toFixed(6)}`).join('\n');
  $('binding-report').dataset.results = JSON.stringify(results);
});
$('objection').addEventListener('click', () => rig?.objection());
$('acting-controls').addEventListener('click', event => {
  const button = (event.target as HTMLElement).closest<HTMLElement>('[data-pose]');
  if (button) rig?.pose(button.dataset.pose!);
});
$('end-statement').addEventListener('click', () => { rig?.acting?.end(); rig?.update(0); rig?.draw(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) stopLoop(); else startLoop(); });
canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); stopLoop(); status('显卡绘图上下文丢失。恢复后请重新加载模型。', 'error'); });
canvas.addEventListener('webglcontextrestored', () => {
  generation++; clearModel();
  // The browser reuses the gl object, but every GPU program is invalid after loss.
  // R5 keeps its shader manager outside renderer.release(); clear that cache too.
  CubismRenderer_WebGL.doStaticRelease();
  status('绘图上下文已恢复，请重新加载模型。');
});
const observer = new ResizeObserver(resize); observer.observe($('stage'));
window.addEventListener('pagehide', () => { generation++; clearModel(); observer.disconnect(); if (CubismFramework.isInitialized()) CubismFramework.dispose(); if (CubismFramework.isStarted()) CubismFramework.cleanUp(); corePromise = null; });
window.addEventListener('pageshow', event => { if (event.persisted) observer.observe($('stage')); });
// Read-only diagnostics let the browser audit actual Core parameter ranges and model counts.
(window as any).Live2DPreview = Object.freeze({ snapshot: () => rig ? { ...rig.facts(), paused, running: Boolean(raf) } : { loaded: false, status: $('status').textContent } });
const requestedSource = new URLSearchParams(location.search).get('source');
if (requestedSource) {
  const modelPath = projectModelPath(requestedSource);
  if (modelPath) void load(urlSource(modelPath, location.origin));
  else status('未识别的项目模型，请使用页面按钮或选择完整模型文件夹。', 'error');
}
