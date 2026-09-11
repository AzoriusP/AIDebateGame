import { CubismFramework, Option, LogLevel } from '../vendor/CubismWebFramework-5-r.5/src/live2dcubismframework';
import { CubismModelSettingJson } from '../vendor/CubismWebFramework-5-r.5/src/cubismmodelsettingjson';
import { CubismUserModel } from '../vendor/CubismWebFramework-5-r.5/src/model/cubismusermodel';
import { CubismModel } from '../vendor/CubismWebFramework-5-r.5/src/model/cubismmodel';
import { CubismMatrix44 } from '../vendor/CubismWebFramework-5-r.5/src/math/cubismmatrix44';
import { CubismMotion } from '../vendor/CubismWebFramework-5-r.5/src/motion/cubismmotion';
import { ACubismMotion } from '../vendor/CubismWebFramework-5-r.5/src/motion/acubismmotion';
import { CubismUpdateScheduler } from '../vendor/CubismWebFramework-5-r.5/src/motion/cubismupdatescheduler';
import { ICubismUpdater } from '../vendor/CubismWebFramework-5-r.5/src/motion/icubismupdater';
import { CubismExpressionUpdater } from '../vendor/CubismWebFramework-5-r.5/src/motion/cubismexpressionupdater';
import { CubismPhysicsUpdater } from '../vendor/CubismWebFramework-5-r.5/src/motion/cubismphysicsupdater';
import { CubismPoseUpdater } from '../vendor/CubismWebFramework-5-r.5/src/motion/cubismposeupdater';
import { CubismRenderer_WebGL } from '../vendor/CubismWebFramework-5-r.5/src/rendering/cubismrenderer_webgl';
import { folderSource, modelFiles, motionParameterOwnership, parseModel, projectModelPath, urlSource } from './resources.mjs';
import { Acting, POSE_PARTS, ACTING_PARAMETERS } from './acting.mjs';

const VENDOR = '/static/vendor/live2d/5-r.5/';

// ── 取景标定（全部由 309×254 卡片上的像素实测反推，模型单位）─────────────────
// 站姿身体网格 Neutral_Body：宽 ≈ 0.4238，高 ≈ 0.9590，顶边 y ≈ +0.4583，
// 底边 y ≈ -0.5007，横向中心 x ≈ -0.1097。
//
// 实测补充（关键，决定了人物在卡里的位置）：
//   1) 网格里「实画」宽只有网格宽的 ≈ 92% —— 右侧留有一条透明余量（给 Point 伸展动作让位）。
//   2) 头顶（含发梢）基本就落在网格顶边上（实测头顶 y ≈ +0.4623，网格顶边 y ≈ +0.4583），
//      所以纵向锚点直接用网格顶边即可，不要再往下缩。
//   3) 各姿势「实画内容中心」相对其网格中心的偏移各不相同（内容在网格里并非左右居中）：
//      站姿 -0.0072、前倾 +0.0092、异议 -0.1163（模型单位；正值 = 枢轴要往右移，
//      才能把内容推回画面中央）。异议姿势偏差极大，是因为它靠左的脸与伸到右边的身体
//      共用一张网格 —— 该姿势以「脸」为构图中心，手臂允许伸出画外。
//      逐姿势校正后，每个姿势都完整落在画布里。
const BODY_INK_RATIO = 0.922;
const POSE_CONTENT_BIAS: Record<string, number> = { neutral: -0.0072, lean: 0.0092, point: -0.1163 };

// 半身景别：可见高度 = 站姿身体高 × 此系数（0.34 ≈「头 + 肩 + 上胸」）。
const BUST_DEPTH = 0.34;
// 全身景别：可见高度 = 站姿身体高 × 此系数（>1 = 头顶脚底各留一点呼吸余量）。
// 主界面的「形象预览」用这一档 —— 卡片大、要看清整个人，半身景别在那里会显得头都快顶出框。
const FULL_DEPTH = 1.2;
// 横向安全系数：实画宽最多占画布宽的比例。
// 值不能取得太满 —— 各姿势实画宽不同（前倾比站姿宽约 15%），
// 0.92 下站姿约占 80% 宽、前倾左右各留少量余量，两个常用姿势都不切边。
const INK_SAFE = 0.92;
// 头顶距画布顶边的距离，按「可见高度」的比例。
const TOP_MARGIN = 0.07;
// 横向跟随：机位缩放锁定不动（避免忽大忽小），但横向枢轴跟随当前姿势的身体中心，
// 并以这个时间常数平滑过渡。否则站姿居中时，前倾姿势的脸会被右边界切掉
// —— 两个常用姿势的内容中心相差约 0.04 模型单位，锁定单一机位必然牺牲一个。
const PAN_TAU = 0.28;
// 三个姿势在模型里的网格前缀（与 acting.mjs 的 POSE_PARTS 一一对应，但这里是网格名）
const POSE_PREFIX: Record<string, string> = { neutral: 'Neutral_', lean: 'Lean_', point: 'Point_' };

export type Source = { label: string; model(): Promise<ArrayBuffer>; asset(ref: string): Promise<ArrayBuffer>; dispose(): void };
type Control = { index: number; id: string; min: number; max: number; default: number; input?: HTMLInputElement; pin?: HTMLInputElement; output?: HTMLOutputElement };
type Motion = { name: string; motion: CubismMotion; parameters: Set<string> };
export type ModelContext = { canvas: HTMLCanvasElement; gl: WebGL2RenderingContext; performance: any; enabled(): boolean; zoom(): number; isCurrent(): boolean; note(id: string, text: string): void };
class CallbackUpdater extends ICubismUpdater {
  constructor(order: number, private callback: (model: CubismModel, dt: number) => void) { super(order); }
  onLateUpdate(model: CubismModel, dt: number) { this.callback(model, dt); }
}

export class PreviewModel extends CubismUserModel {
  source: Source;
  setting: CubismModelSettingJson | null = null;
  scheduler = new CubismUpdateScheduler();
  parameters: Control[] = [];
  parts: Control[] = [];
  pins = new Map<number, number>();
  partPins = new Map<number, number>();
  expressions: { name: string; motion: ACubismMotion }[] = [];
  motions: Motion[] = [];
  textures: WebGLTexture[] = [];
  activeMotion: Motion | null = null;
  acting: Acting | null = null;
  bounds = { width: 2, height: 2, x: 0, y: 0 };
  // 当前姿势「身体」网格的范围：取景缩放与枢轴以它为准，不含伸出的手臂
  poseBounds = { width: 2, height: 2, x: 0, y: 0 };
  // 三个姿势各自的身体网格横向中心（初始化时量一次），用于机位横向跟随
  poseCenters: Record<string, number> = {};
  // 横向枢轴（平滑跟随当前姿势），初始为站姿中心
  panX = 0;
  // 机位是否已锁定：首次计算用站姿，之后跨姿势保持不变
  frameLocked = false;
  // 景别：'bust' = 半身（对战卡，头肩胸，戏剧张力优先）
  //       'full' = 全身（主界面形象预览，卡片大，要看清整个人）
  framing: 'bust' | 'full' = 'bust';
  disposed = false;
  constructor(source: Source, private context: ModelContext) { super(); this.source = source; }
  async initialize() {
    const bytes = await this.source.model(); this.alive();
    const manifest = parseModel(bytes), refs = manifest.FileReferences;
    this.setting = new CubismModelSettingJson(bytes, bytes.byteLength);
    const moc = await this.source.asset(refs.Moc); this.alive();
    this.loadModel(moc, true);
    if (!this._model || this._model.getDrawableCount() === 0) throw new Error('Cubism Core 无法读取真实模型，或模型没有可绘制网格。请检查导出版本与 .moc3。');
    for (let i = 0; i < this._model.getParameterCount(); i++) this.parameters.push({ index: i, id: this._model.getParameterId(i).getString(), min: this._model.getParameterMinimumValue(i), max: this._model.getParameterMaximumValue(i), default: this._model.getParameterDefaultValue(i) });
    for (let i = 0; i < this._model.getPartCount(); i++) this.parts.push({ index: i, id: this._model.getPartId(i).getString(), min: 0, max: 1, default: this._model.getPartOpacityByIndex(i) });
    if (Object.values(POSE_PARTS).every(id => this.parts.some(p => p.id === id))) this.acting = new Acting();
    this.createRenderer(this.context.canvas.width, this.context.canvas.height);
    this.getRenderer().startUp(this.context.gl!);
    this.getRenderer().setIsPremultipliedAlpha(true);
    for (let i = 0; i < refs.Textures.length; i++) {
      const textureBytes = await this.source.asset(refs.Textures[i]); this.alive();
      const url = URL.createObjectURL(new Blob([textureBytes]));
      try {
        const image = new Image(); image.src = url; await image.decode(); this.alive();
        if (image.width > this.context.gl!.getParameter(this.context.gl!.MAX_TEXTURE_SIZE) || image.height > this.context.gl!.getParameter(this.context.gl!.MAX_TEXTURE_SIZE)) throw new Error('纹理尺寸超过当前显卡支持范围');
        const texture = this.context.gl!.createTexture(); if (!texture) throw new Error('无法分配纹理');
        this.textures.push(texture); this.context.gl!.bindTexture(this.context.gl!.TEXTURE_2D, texture);
        this.context.gl!.pixelStorei(this.context.gl!.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
        this.context.gl!.texImage2D(this.context.gl!.TEXTURE_2D, 0, this.context.gl!.RGBA, this.context.gl!.RGBA, this.context.gl!.UNSIGNED_BYTE, image);
        this.context.gl!.texParameteri(this.context.gl!.TEXTURE_2D, this.context.gl!.TEXTURE_MIN_FILTER, this.context.gl!.LINEAR);
        this.context.gl!.texParameteri(this.context.gl!.TEXTURE_2D, this.context.gl!.TEXTURE_MAG_FILTER, this.context.gl!.LINEAR);
        this.context.gl!.texParameteri(this.context.gl!.TEXTURE_2D, this.context.gl!.TEXTURE_WRAP_S, this.context.gl!.CLAMP_TO_EDGE);
        this.context.gl!.texParameteri(this.context.gl!.TEXTURE_2D, this.context.gl!.TEXTURE_WRAP_T, this.context.gl!.CLAMP_TO_EDGE);
        this.context.gl!.bindTexture(this.context.gl!.TEXTURE_2D, null); this.getRenderer().bindTexture(i, texture);
      } finally { URL.revokeObjectURL(url); }
    }
    for (const item of refs.Expressions || []) {
      const data = await this.source.asset(item.File); this.alive();
      JSON.parse(new TextDecoder().decode(data));
      const motion = this.loadExpression(data, data.byteLength, item.Name);
      if (!motion) throw new Error('表情读取失败：' + item.File);
      this.expressions.push({ name: item.Name, motion });
    }
    for (const [group, items] of Object.entries(refs.Motions || {}) as [string, any[]][]) {
      for (let index = 0; index < items.length; index++) {
        const item = items[index], data = await this.source.asset(item.File); this.alive();
        const json = JSON.parse(new TextDecoder().decode(data));
        const name = `${group} · ${index + 1}`;
        const motion = this.loadMotion(data, data.byteLength, name, undefined, undefined, this.setting, group, index, true);
        if (!motion) throw new Error('动作读取失败：' + item.File);
        const eyeIds = this.parameters.filter(p => /^ParamEye[LR]Open$/.test(p.id)).map(p => this._model.getParameterId(p.index));
        const lipIds = this.parameters.filter(p => p.id === 'ParamMouthOpenY').map(p => this._model.getParameterId(p.index));
        motion.setEffectIds(eyeIds, lipIds);
        this.motions.push({ name, motion, parameters: motionParameterOwnership(json.Curves, eyeIds.map(id => id.getString()), lipIds.map(id => id.getString())) });
      }
    }
    if (refs.Physics) { const data = await this.source.asset(refs.Physics); this.alive(); this.loadPhysics(data, data.byteLength); this.scheduler.addUpdatableList(new CubismPhysicsUpdater(this._physics)); }
    if (refs.Pose) { const data = await this.source.asset(refs.Pose); this.alive(); this.loadPose(data, data.byteLength); this.scheduler.addUpdatableList(new CubismPoseUpdater(this._pose)); }
    this.scheduler.addUpdatableList(new CallbackUpdater(200, (_model, dt) => this.drivePerformance(dt)));
    this.scheduler.addUpdatableList(new CubismExpressionUpdater(this._expressionManager));
    this.scheduler.addUpdatableList(new CallbackUpdater(850, (_model, dt) => {
      if (!this.acting) return;
      const opacities = this.acting.update(dt);
      for (const part of this.parts) if (part.id in opacities) this._model.setPartOpacityByIndex(part.index, opacities[part.id]);
      this.context.note('acting-note', `当前：${({ neutral: '站姿', lean: '前倾', point: '左手异议' })[this.acting.pose]} · ${({ idle: '待命', enter: '起势', hold: '保持发言，点击“结束发言”收手', exit: '收势' })[this.acting.phase]}`);
    }));
    this.scheduler.addUpdatableList(new CallbackUpdater(900, () => this.applyPins()));
    // 先让站姿生效（acting 的 850 号 updater 会把 PoseNeutral 置 1），
    // 再锁机位 —— 否则量到的是默认参数下的错误比例。
    this.acting?.select('neutral');
    this.scheduler.onLateUpdate(this._model, 0);
    this._model.update(); this.fit(); this._model.saveParameters();
    if (!this.frameLocked) {
      this.bounds = { ...this.poseBounds };
      // 三个姿势的身体中心各量一次（网格自带姿势偏移，与参数无关），供横向跟随用。
      for (const pose of Object.keys(POSE_PREFIX)) {
        const m = this.measurePose(pose);
        if (m) this.poseCenters[pose] = m.x;
      }
      this.panX = this.bounds.x;
      this.frameLocked = true;
    }
    this.context.note('frame-note', `取景：身体宽 ${this.bounds.width.toFixed(4)} 高 ${this.bounds.height.toFixed(4)} 枢轴 x=${this.bounds.x.toFixed(4)}`);
  }
  alive() { if (this.disposed || !this.context.isCurrent()) throw new DOMException('已取消旧模型加载', 'AbortError'); }
  drivePerformance(dt: number) {
    if (!this.context.enabled()) return;
    const values = this.context.performance.update(dt);
    const targets: Record<string, number> = { ParamBreath: values.breath, ParamEyeLOpen: values.eyeOpen, ParamEyeROpen: values.eyeOpen, ParamMouthOpenY: values.mouthOpen, ParamBodyAngleZ: values.bodyAngle, ParamBrowForm: values.browForm, ParamMouthForm: values.mouthForm };
    if (this.acting) targets.ParamMouthOpenY = values.mouthOpen > .45 ? 1 : 0;
    for (const p of this.parameters) if (p.id in targets && !this.activeMotion?.parameters.has(p.id)) this._model.setParameterValueByIndex(p.index, targets[p.id]);
  }
  applyPins() {
    for (const [index, value] of this.pins) this._model.setParameterValueByIndex(index, value);
    for (const [index, value] of this.partPins) this._model.setPartOpacityByIndex(index, value);
  }
  update(dt: number) {
    // R5 sample order: restore parameters → motion → save → scheduled effects → Core update.
    this._model.loadParameters();
    if (!this._motionManager.isFinished()) this._motionManager.updateMotion(this._model, dt);
    else if (this.activeMotion) { this.activeMotion = null; this.restoreDefaults(); this.context.note('motion-note', '动作已结束，回到当前状态。'); }
    this._model.saveParameters();
    this.scheduler.onLateUpdate(this._model, dt);
    this._model.update();
    this.fit();
    // 横向枢轴平滑跟随当前姿势：缩放锁死（大小不跳），只让画面横向滑过去，
    // 这样站姿、前倾、异议三个姿势都能完整落在画布里。
    if (this.frameLocked) {
      const target = this.panTarget();
      const k = 1 - Math.exp(-Math.max(dt, 0) / PAN_TAU);
      this.panX += (target - this.panX) * k;
    }
  }
  restoreDefaults() {
    for (const p of this.parameters) this._model.setParameterValueByIndex(p.index, p.default);
    for (const p of this.parts) this._model.setPartOpacityByIndex(p.index, p.default);
    this._model.saveParameters();
  }
  reset() {
    this._motionManager.stopAllMotions(); this._expressionManager.stopAllMotions();
    this.activeMotion = null; this.pins.clear(); this.partPins.clear(); this.restoreDefaults();
    this.acting?.reset();
    for (const p of [...this.parameters, ...this.parts]) if (p.pin) p.pin.checked = false;
    this.update(0); this.draw();
  }
  play(index: number) {
    const item = this.motions[index]; if (!item) return;
    this._motionManager.stopAllMotions(); this.restoreDefaults();
    item.motion.setLoop(false); this.activeMotion = item;
    this._motionManager.startMotionPriority(item.motion, false, 3);
    this.context.note('motion-note', '播放：' + item.name + (this.pins.size ? '（固定参数会覆盖对应动作，请按需取消勾选）' : ''));
  }
  expression(index: number) {
    this._expressionManager.stopAllMotions();
    if (index >= 0 && this.expressions[index]) this._expressionManager.startMotion(this.expressions[index].motion, false);
  }
  stop() { this._motionManager.stopAllMotions(); this.activeMotion = null; this.acting?.reset(); this.restoreDefaults(); this.update(0); this.draw(); this.context.note('motion-note', '动作已停止。'); }
  pose(name: string) {
    if (!this.acting) return;
    for (const part of this.parts) if (Object.values(POSE_PARTS).some(id => id === part.id)) { this.partPins.delete(part.index); if (part.pin) part.pin.checked = false; }
    this.acting.select(name); this.update(0); this.draw();
  }
  objection() {
    if (!this.acting) { this.play(this.motions.findIndex(x => /objection|异议/i.test(x.name))); return; }
    for (const part of this.parts) if (Object.values(POSE_PARTS).some(id => id === part.id)) { this.partPins.delete(part.index); if (part.pin) part.pin.checked = false; }
    this.acting.begin(); this.update(0); this.draw();
  }
  verifyBindings() {
    const savedParameters = this.parameters.map(p => this._model.getParameterValueByIndex(p.index));
    const savedParts = this.parts.map(p => this._model.getPartOpacityByIndex(p.index));
    const snapshot = () => Array.from({ length: this._model.getDrawableCount() }, (_, index) => ({ vertices: Array.from(this._model.getDrawableVertices(index)), opacity: this._model.getDrawableOpacity(index) }));
    const results = [];
    try {
      for (const id of this.acting ? ACTING_PARAMETERS : ['ParamBreath', 'ParamEyeLOpen', 'ParamEyeROpen', 'ParamMouthOpenY', 'ParamObjection']) {
        const p = this.parameters.find(item => item.id === id);
        if (!p) { results.push({ id, result: '参数缺失', changed: false, changedMeshes: 0, vertexDelta: 0, opacityDelta: 0 }); continue; }
        for (const base of this.parameters) this._model.setParameterValueByIndex(base.index, base.default);
        for (const part of this.parts) this._model.setPartOpacityByIndex(part.index, part.default);
        this._model.setParameterValueByIndex(p.index, p.min); this._model.update(); const low = snapshot();
        this._model.setParameterValueByIndex(p.index, p.max); this._model.update(); const high = snapshot();
        let vertexDelta = 0, opacityDelta = 0, changedMeshes = 0;
        for (let i = 0; i < low.length; i++) {
          let meshDelta = 0;
          for (let v = 0; v < low[i].vertices.length; v++) meshDelta = Math.max(meshDelta, Math.abs(low[i].vertices[v] - high[i].vertices[v]));
          const opacity = Math.abs(low[i].opacity - high[i].opacity);
          vertexDelta = Math.max(vertexDelta, meshDelta); opacityDelta = Math.max(opacityDelta, opacity);
          if (meshDelta > 1e-6 || opacity > 1e-6) changedMeshes++;
        }
        results.push({ id, result: changedMeshes ? '有真实网格/透明度变化' : '存在但未检测到绑定变化', changed: changedMeshes > 0, changedMeshes, vertexDelta, opacityDelta });
      }
    } finally {
      this.parameters.forEach((p, i) => this._model.setParameterValueByIndex(p.index, savedParameters[i]));
      this.parts.forEach((p, i) => this._model.setPartOpacityByIndex(p.index, savedParts[i]));
      this._model.update(); this.draw();
    }
    return results;
  }
  // 量取指定姿势的身体网格范围。只用精确姿势前缀匹配，不依赖 opacity ——
  // opacity 由 part updater 写，锁机位那一刻未必生效，会把三套身体当并集量进去。
  measurePose(pose: string) {
    const prefix = POSE_PREFIX[pose] ?? POSE_PREFIX.neutral;
    let bMinX = Infinity, bMinY = Infinity, bMaxX = -Infinity, bMaxY = -Infinity;
    let found = 0;
    for (let i = 0; i < this._model.getDrawableCount(); i++) {
      const id = this._model.getDrawableId(i).getString();
      if (!id.startsWith(prefix) || !id.includes('Body')) continue;
      const vertices = this._model.getDrawableVertices(i);
      found++;
      for (let v = 0; v < vertices.length; v += 2) {
        bMinX = Math.min(bMinX, vertices[v]); bMaxX = Math.max(bMaxX, vertices[v]);
        bMinY = Math.min(bMinY, vertices[v + 1]); bMaxY = Math.max(bMaxY, vertices[v + 1]);
      }
    }
    if (!found) return null;
    if (![bMinX, bMinY, bMaxX, bMaxY].every(Number.isFinite)) return null;
    return { width: Math.max(bMaxX - bMinX, .01), height: Math.max(bMaxY - bMinY, .01), x: (bMinX + bMaxX) / 2, y: (bMinY + bMaxY) / 2 };
  }
  fit() {
    // 机位「缩放」取站姿身体范围并锁死：姿势切换只换网格、不换缩放，否则人物会忽大忽小。
    const posed = this.measurePose('neutral');
    if (!posed) throw new Error('模型缺少 Neutral_Body 网格，无法取景');
    this.poseBounds = posed;
  }
  // 横向枢轴目标：当前姿势的身体中心（各姿势网格自带偏移，站姿 / 前倾差约 0.015、
  // 异议姿势差约 0.14）。机位横向跟随它，才能让每个姿势都完整落在画面里。
  panTarget() {
    const pose = this.acting?.pose ?? 'neutral';
    return this.poseCenters[pose] ?? this.bounds.x;
  }
  // 切景别：只改取景框，不动模型状态，可随时切换（宿主换卡时调用）。
  setFraming(mode: 'bust' | 'full') {
    if (mode !== 'bust' && mode !== 'full') return;
    this.framing = mode;
  }
  draw() {
    if (this.disposed || !this.context.gl || this.context.gl.isContextLost()) return;
    const canvas = this.context.canvas;
    this.context.gl.viewport(0, 0, canvas.width, canvas.height); this.context.gl.clearColor(0, 0, 0, 0); this.context.gl.clear(this.context.gl.COLOR_BUFFER_BIT);
    const zoom = this.context.zoom();
    const bw = this.bounds.width, bh = this.bounds.height;
    const bodyTop = this.bounds.y + bh / 2;

    // ── 溢出画布检测 ──────────────────────────────────────────────
    // weak-hit 演出窗口会把画布 CSS 拉得比 UI 框（stage）宽，让「异议」指向的手臂
    // 画出角色卡外。此时机位必须仍按 UI 框取景、并钉在 stage 所在的那块区域上：
    //   1) 若直接按加宽后的画布算 min(scaleDepth, scaleSafe)，横向约束放松会推高 scale
    //      → 开窗瞬间人物猛然推近，关窗又弹回；
    //   2) 只有锁住「常规机位 + 常规缩放」，多出来的画布才纯粹是额外的可见面积，
    //      脸在屏幕上的位置一像素都不动。
    const stage = canvas.parentElement;
    const designW = stage?.clientWidth || canvas.clientWidth;
    const designH = stage?.clientHeight || canvas.clientHeight;
    const overflowing = canvas.clientWidth - designW > 1 || canvas.clientHeight - designH > 1;
    const aspectCam = overflowing ? designW / designH : canvas.width / canvas.height;
    const aspectOut = canvas.width / canvas.height;

    // 可见范围由 scale 唯一决定：可见高 = 2/scale，可见宽 = 2×aspect/scale。
    // （旧实现把 winH 当成可见高来定位，但矩阵实际给出的可见高是 2/scale，两者差 2 倍以上，
    //   于是可见区顶边跑到身体顶端上方一大截 —— 人像被压到画面下半，看着只剩胸部。）
    const inkW = bw * BODY_INK_RATIO;                       // 站姿实画宽
    const full = this.framing === 'full';
    const scaleDepth = 2 / (bh * (full ? FULL_DEPTH : BUST_DEPTH));
    const scaleSafe = (2 * aspectCam * INK_SAFE) / inkW;    // 横向安全：实画宽最多占满取景框 INK_SAFE
    const scale = Math.min(scaleDepth, scaleSafe) * zoom;

    const visH = 2 / scale, visW = 2 * aspectCam / scale;

    // 纵向：
    //   半身 —— 头顶（≈ 网格顶边）落在画布顶部往下 TOP_MARGIN×可见高 处，胸口切在底边。
    //   全身 —— 整个人上下居中（可见高比身体高多出来的部分平均分到顶和底）。
    const winCy0 = full
      ? this.bounds.y
      : bodyTop - visH * (0.5 - TOP_MARGIN);
    // 横向：枢轴跟随当前姿势（panX），并叠加该姿势的「内容中心 vs 网格中心」校正。
    // 全身景别下不做该校正 —— 校正值是为「只露上半身、手臂甩出画外」的构图调的，
    // 全身构图里手臂本就在画内，再偏移反而会把人推离中线。
    const pose = this.acting?.pose ?? 'neutral';
    let winCx = (this.frameLocked ? this.panX : this.bounds.x) + (full ? 0 : (POSE_CONTENT_BIAS[pose] ?? 0));
    let winCy = winCy0;
    if (overflowing && designH > 0) {
      // stage 在画布布局盒里的位置（offsetLeft/Top 不受 transform 影响）。
      // 对齐左上角：常规机位恰好铺满 stage 那块区域，多出的画布全在偏移方向。
      // 仅支持「宽或高单向溢出」——同时双向溢出时纵向无法既锁缩放又对齐。
      const m = (2 / scale) / canvas.clientHeight;        // 每 CSS 像素对应的模型单位
      winCx += m * ((canvas.clientWidth - designW) / 2 - canvas.offsetLeft);
      winCy += m * canvas.offsetTop;
    }

    const matrix = new CubismMatrix44();
    matrix.scale(scale / aspectOut, scale);
    matrix.translate(-winCx * scale / aspectOut, -winCy * scale);
    this.getRenderer().setMvpMatrix(matrix); this.getRenderer().setRenderState(null, [0, 0, canvas.width, canvas.height]); this.getRenderer().drawModel(VENDOR + 'Shaders/');
  }
  facts() { return { source: this.source.label, parameters: this.parameters.map(p => ({ id: p.id, min: p.min, max: p.max, default: p.default, value: this._model.getParameterValueByIndex(p.index) })), parts: this.parts.map(p => p.id), partValues: this.parts.map(p => this._model.getPartOpacityByIndex(p.index)), drawables: this._model.getDrawableCount(), expressions: this.expressions.map(x => x.name), motions: this.motions.map(x => x.name), coreVersion: (window as any).Live2DCubismCore.Version.csmGetVersion() }; }
  dispose() {
    if (this.disposed) return; this.disposed = true; this.source.dispose(); this.scheduler.release();
    this.deleteRenderer();
    for (const texture of this.textures) this.context.gl?.deleteTexture(texture);
    super.release();
    for (const item of [...this.motions, ...this.expressions]) ACubismMotion.delete(item.motion);
    this.setting?.release(); this.textures.length = 0;
  }
}

