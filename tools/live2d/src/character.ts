import { CubismFramework, Option, LogLevel } from '../vendor/CubismWebFramework-5-r.5/src/live2dcubismframework';
import { CubismRenderer_WebGL } from '../vendor/CubismWebFramework-5-r.5/src/rendering/cubismrenderer_webgl';
import { PreviewModel } from './model';
import { urlSource } from './resources.mjs';

// One protagonist, one GPU context shared by lobby and match hosts.
let host: HTMLElement | null = null, canvas: HTMLCanvasElement | null = null;
let gl: WebGL2RenderingContext | null = null, model: PreviewModel | null = null;
let epoch = 0, raf = 0, last = 0, paused = true, enabled = true;
// 景别随宿主走：主界面的「形象预览」卡片大 → 全身；对战玩家卡 → 半身。
// 两个宿主共用一个模型实例，而 transfer 是 characters.js 直接把 rootNode 搬到
// 另一个宿主里（不一定会再调 mount），所以景别必须每次绘制时按当前 DOM 祖先重新判定，
// 不能只在 mount 时记一次。framingOverride 仅用于手动强制（调试）。
let framingOverride: 'bust' | 'full' | null = null;
function currentFraming(): 'bust' | 'full' {
  if (framingOverride) return framingOverride;
  return host?.closest?.('#avatar-preview') ? 'full' : 'bust';
}
const driver = new (window as any).DebatePerformance.Performance({ seed: 17 });
function stop() { cancelAnimationFrame(raf); raf = 0; last = 0; }
function draw() { model?.setFraming(currentFraming()); model?.draw(); }
function resize() {
  if (!canvas) return;
  // clientWidth/clientHeight exclude ancestor entrance transforms. Using the visual
  // bounding rect here made the model keep an occasionally scaled/offset viewport.
  const width = canvas.clientWidth, height = canvas.clientHeight;
  const ratio = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.round(width * ratio)); canvas.height = Math.max(1, Math.round(height * ratio));
  draw();
}
function frame(time: number) {
  raf = 0;
  if (paused || document.hidden || !model) return;
  const dt = last ? Math.min((time - last) / 1000, .05) : 0; last = time;
  try { model.update(dt); draw(); start(); }
  catch (error) { stop(); if (host) { host.dataset.error = String(error); host.dispatchEvent(new CustomEvent('live2d-error', { bubbles: true })); } }
}
function start() { if (!raf && model && !paused && !document.hidden) raf = requestAnimationFrame(frame); }
const observer = new ResizeObserver(resize);
function unload() { epoch++; stop(); model?.dispose(); model = null; }
function mount(next: HTMLElement) {
  host = next;
  // 注意：characters.js 传进来的不一定是宿主本身，而是挂在宿主里的
  // `#live2d-runtime-root`，所以景别判定要用 closest 往上找，不能直接比 id。
  const nextCanvas = next.querySelector('canvas')!;
  if (canvas !== nextCanvas) {
    unload(); observer.disconnect(); canvas = nextCanvas;
    gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true });
    if (!gl) throw new Error('此设备无法创建 WebGL2 角色画面');
    canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); stop(); host?.dispatchEvent(new CustomEvent('live2d-error', { bubbles: true })); });
    canvas.addEventListener('webglcontextrestored', () => { unload(); CubismRenderer_WebGL.doStaticRelease(); });
    observer.observe(canvas);
  }
  resize();
}
async function loadModel(path: string) {
  if (!canvas || !gl) throw new Error('角色画布尚未挂载');
  // Only the authored protagonists are admitted to this runtime.
  if (![
    '/static/assets/live2d/male-acting/male-acting.model3.json',
    '/static/assets/live2d/male-master/male-master.model3.json',
  ].includes(path)) throw new Error('未登记的主角模型');
  unload(); const ticket = epoch;
  const option = new Option(); option.loggingLevel = LogLevel.LogLevel_Error;
  if (!CubismFramework.isStarted()) CubismFramework.startUp(option);
  if (!CubismFramework.isInitialized()) CubismFramework.initialize();
  const source = urlSource(path, location.origin);
  const candidate = new PreviewModel(source, { canvas, gl, performance: driver, enabled: () => true, zoom: () => 1,
    isCurrent: () => epoch === ticket, note: (id, text) => { if (host && id === 'acting-note') host.dataset.acting = text; } });
  try {
    await candidate.initialize();
    if (ticket !== epoch) { candidate.dispose(); return; }
    model = candidate; driver.reset(); model.setFraming(currentFraming()); model.update(0); resize(); start();
  } catch (error) { candidate.dispose(); throw error; }
}
function reset() { driver.reset(); model?.reset(); }
document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else start(); });
window.addEventListener('pagehide', () => { stop(); });
window.addEventListener('pageshow', start);
(window as any).Live2DCharacterRuntime = Object.freeze({
  mount, loadModel, unload, resize, isLoaded: () => Boolean(model),
  pause(value: boolean) { paused = Boolean(value); if (paused) stop(); else start(); },
  setMotionEnabled(value: boolean) { enabled = Boolean(value); driver.setMotionEnabled(enabled); if (!enabled) model?.acting?.reset(); model?.update(0); draw(); },
  setSpeaking(value: boolean) { driver.setSpeaking(value); },
  setEmotion(value: string) { driver.setEmotion(value); },
  selectPose(name: string) { model?.pose(name); },
  // 'auto' = 跟随宿主（默认）；'full' / 'bust' = 强制，调试用。
  setFraming(value: string) { framingOverride = value === 'full' || value === 'bust' ? value : null; draw(); },
  playObjection() { if (enabled) model?.objection(); },
  endStatement() { model?.acting?.end(); },
  reset,
});

