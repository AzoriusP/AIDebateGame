import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const { Performance } = require('../../../demo/static/character-performance.js');
const projectFile = relative => new URL('../../../' + relative, import.meta.url);

test('new facial forms preserve the existing proof meshes in every state and objection pose', async () => {
  const core = await readFile(projectFile('demo/static/vendor/live2d/5-r.5/live2dcubismcore.min.js'), 'utf8');
  const context = vm.createContext({ console, process, Buffer, require, __dirname: fileURLToPath(new URL('.', import.meta.url)), setTimeout, clearTimeout, TextDecoder, TextEncoder });
  vm.runInContext(core, context);
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { ready = Boolean(context.Live2DCubismCore.Version.csmGetVersion()); break; }
    catch { await new Promise(resolve => setTimeout(resolve, 10)); }
  }
  assert.ok(ready, 'the pinned official Core must initialize');
  context.sourceBytes = await readFile(projectFile('demo/static/assets/live2d/pipeline-proof/proof.moc3'));
  context.samples = [];
  for (const state of ['calm', 'anxious', 'tense', 'desperate']) {
    const driver = new Performance({ seed: 17 }); driver.setEmotion(state);
    for (const dt of [0, .05, .05]) {
      const values = driver.update(dt);
      for (const objection of [0, .5, 1]) context.samples.push({ state, values, objection });
    }
  }
  const result = vm.runInContext(`(() => {
    const bytes = new Uint8Array(sourceBytes).buffer;
    const Core = Live2DCubismCore;
    if (Core.Moc.prototype.hasMocConsistency(bytes) !== 1) throw new Error('Invalid proof MOC');
    const moc = Core.Moc.fromArrayBuffer(bytes);
    let model;
    try {
      model = Core.Model.fromMoc(moc);
      const defaults = Array.from(model.parameters.defaultValues);
      const set = (id, value) => { const index = model.parameters.ids.indexOf(id); if (index >= 0) model.parameters.values[index] = value; };
      const snapshot = () => JSON.stringify({ vertices: model.drawables.vertexPositions.map(v => Array.from(v)), opacity: Array.from(model.drawables.opacities) });
      let comparisons = 0;
      for (const { state, values, objection } of samples) {
        model.parameters.values.set(defaults);
        set('ParamBreath', values.breath); set('ParamEyeLOpen', values.eyeOpen); set('ParamEyeROpen', values.eyeOpen);
        set('ParamBodyAngleZ', values.bodyAngle); set('ParamObjection', objection);
        model.update(); const before = snapshot();
        set('ParamBrowForm', values.browForm); set('ParamMouthForm', values.mouthForm);
        model.update();
        if (snapshot() !== before) throw new Error('Proof appearance changed: ' + state + '/' + objection);
        comparisons++;
      }
      return { comparisons, drawables: model.drawables.count };
    } finally { if (model) model.release(); if (moc) moc._release(); }
  })()`, context);
  assert.equal(result.comparisons, 36);
  assert.equal(result.drawables, 5);
});
