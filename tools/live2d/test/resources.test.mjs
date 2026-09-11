import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanPath, folderSource, urlSource, parseModel, projectModelPath, motionParameterOwnership } from '../src/resources.mjs';
test('source query selects only registered real project packages', () => {
  assert.equal(projectModelPath('proof'), '/static/assets/live2d/pipeline-proof/proof.model3.json');
  assert.equal(projectModelPath('male-master'), '/static/assets/live2d/male-master/male-master.model3.json');
  for (const name of ['../secrets', '/static/assets/live2d/other/model.model3.json', 'https://example.org/model.model3.json', '__proto__', 'constructor', '', null]) assert.equal(projectModelPath(name), null);
});
test('package references stay inside selected folder', () => {
  for (const bad of ['../secrets', '/outside', 'https://example.org/model', '//host/file', 'a\\b', '%2e%2e/a', 'a/%2fsecret', 'foo?x=y', 'a//b']) assert.throws(() => cleanPath(bad));
  assert.equal(cleanPath('./textures/头发.png'), 'textures/头发.png');
});
test('local import resolves nested texture without network', async () => {
  const mock = (name, value) => ({ webkitRelativePath: name, arrayBuffer: async () => value });
  const model = mock('export/proof.model3.json', 42);
  const source = folderSource([model, mock('export/proof.2048/texture_00.png', 73)], model);
  assert.equal(await source.model(), 42);
  assert.equal(await source.asset('proof.2048/texture_00.png'), 73);
  await assert.rejects(source.asset('missing.png'), /缺少/);
  await assert.rejects(source.asset('../private.json'), /不能越出/);
});
test('URL imports cannot fetch arbitrary external or application paths', () => {
  for (const path of ['https://other.test/static/assets/live2d/a.model3.json', '/config.json', '/static/assets/live2d/a.model3.json?next=1']) assert.throws(() => urlSource(path, 'http://localhost:8790'));
  urlSource('/static/assets/live2d/proof/proof.model3.json', 'http://localhost:8790').dispose();
});
test('a portrait or placeholder cannot be accepted as a model manifest', () => {
  const bytes = obj => new TextEncoder().encode(JSON.stringify(obj)).buffer;
  assert.throws(() => parseModel(bytes({ Version: 3, FileReferences: { Textures: ['portrait.png'] } })));
  assert.equal(parseModel(bytes({ Version: 3, FileReferences: { Moc: 'proof.moc3', Textures: ['texture.png'] } })).Version, 3);
});
test('model-level blink and lip-sync motions retain priority over automatic parameters', () => {
  const eyes = ['ParamEyeLOpen', 'ParamEyeROpen'], lips = ['ParamMouthOpenY'];
  const occupied = motionParameterOwnership([{ Target: 'Model', Id: 'EyeBlink' }, { Target: 'Model', Id: 'LipSync' }, { Target: 'Parameter', Id: 'ParamObjection' }, { Target: 'Parameter', Id: 'ParamBrowForm' }, { Target: 'Parameter', Id: 'ParamMouthForm' }], eyes, lips);
  assert.deepEqual([...occupied].sort(), [...eyes, ...lips, 'ParamObjection', 'ParamBrowForm', 'ParamMouthForm'].sort());
  const armOnly = motionParameterOwnership([{ Target: 'Parameter', Id: 'ParamObjection' }, { Target: 'Model', Id: 'Opacity' }], eyes, lips);
  assert.equal(armOnly.has('ParamEyeLOpen'), false);
  assert.equal(armOnly.has('ParamMouthOpenY'), false);
  assert.equal(armOnly.has('ParamBrowForm'), false);
  assert.equal(armOnly.has('ParamMouthForm'), false);
});
