import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const root = new URL('../../', import.meta.url);
const file = relative => new URL(relative, root);
const context = vm.createContext({ console, process, Buffer, require: createRequire(import.meta.url), __dirname: fileURLToPath(new URL('.', import.meta.url)), setTimeout, clearTimeout, TextDecoder, TextEncoder });
vm.runInContext(await fs.readFile(file('demo/static/vendor/live2d/5-r.5/live2dcubismcore.min.js'), 'utf8'), context);
for (let attempt = 0; attempt < 100; attempt++) {
  try { if (context.Live2DCubismCore.Version.csmGetVersion()) break; } catch {}
  await new Promise(resolve => setTimeout(resolve, 10));
}
context.sourceBytes = await fs.readFile(file('demo/static/assets/live2d/male-acting/male-acting.moc3'));
const result = vm.runInContext(`(() => {
  const Core = Live2DCubismCore, bytes = new Uint8Array(sourceBytes).buffer;
  if (Core.Moc.prototype.hasMocConsistency(bytes) !== 1) throw new Error('Inconsistent MOC');
  const moc = Core.Moc.fromArrayBuffer(bytes), model = Core.Model.fromMoc(moc);
  try {
    const set = (id, value) => { const index = model.parameters.ids.indexOf(id); if (index < 0) throw new Error('Missing ' + id); model.parameters.values[index] = value; };
    const snapshot = () => model.drawables.vertexPositions.map((v, i) => ({ vertices: Array.from(v), opacity: model.drawables.opacities[i] }));
    const bindings = [];
    model.parts.opacities.fill(1);
    for (const id of ['ParamBreath', 'ParamEyeROpen', 'ParamMouthOpenY']) {
      model.parameters.values.set(model.parameters.defaultValues);
      set(id, 0); model.update(); const low = snapshot();
      set(id, 1); model.update(); const high = snapshot();
      const meshes = [];
      low.forEach((a, i) => {
        const vertexDelta = Math.max(...a.vertices.map((v, j) => Math.abs(v - high[i].vertices[j])));
        const opacityDelta = Math.abs(a.opacity - high[i].opacity);
        if (vertexDelta > 1e-6 || opacityDelta > 1e-6) meshes.push({ id: model.drawables.ids[i], vertexDelta, opacityDelta });
      });
      bindings.push({ id, meshes });
    }
    const poses = []; let combinationChecks = 0;
    model.parameters.values.set(model.parameters.defaultValues);
    for (const id of ['PoseNeutral', 'PoseLean', 'PosePoint']) {
      model.parts.opacities.fill(0); model.parts.opacities[model.parts.ids.indexOf(id)] = 1; model.update();
      poses.push({ id, visible: model.drawables.ids.filter((_, i) => model.drawables.opacities[i] > .01) });
      for (const breath of [0, .5, 1]) for (const eye of [0, .5, 1]) for (const mouth of [0, 1]) {
        set('ParamBreath', breath); set('ParamEyeROpen', eye); set('ParamMouthOpenY', mouth); model.update();
        const visible = model.drawables.ids.filter((_, i) => model.drawables.opacities[i] > .01);
        if (visible.length !== 3 || visible.some(mesh => !mesh.startsWith(id.replace('Pose', '') + '_'))) throw new Error('Pose overlap or missing feature');
        if (!model.drawables.vertexPositions.every(v => Array.from(v).every(Number.isFinite))) throw new Error('Invalid combined geometry');
        combinationChecks++;
      }
      model.parameters.values.set(model.parameters.defaultValues);
    }
    return { drawables: Array.from(model.drawables.ids), parts: Array.from(model.parts.ids), parameters: Array.from(model.parameters.ids), bindings, poses, combinationChecks };
  } finally { model.release(); moc._release(); }
})()`, context);
assert.equal(result.drawables.length, 12);
for (const binding of result.bindings) {
  const expected = binding.id === 'ParamBreath' ? 12 : binding.id === 'ParamEyeROpen' ? 3 : 6;
  assert.equal(binding.meshes.length, expected, binding.id + ' must affect every pose');
}
for (const pose of result.poses) {
  assert.equal(pose.visible.length, 3, 'only body, eye and closed mouth should be visible');
  assert.ok(pose.visible.every(id => id.startsWith(pose.id.replace('Pose', '') + '_')));
}
const report = { pass: true, mocSha256: createHash('sha256').update(context.sourceBytes).digest('hex'), ...result };
await fs.mkdir(file('work/live2d/male-master/acting-v2/'), { recursive: true });
await fs.writeFile(file('work/live2d/male-master/acting-v2/core-audit.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
