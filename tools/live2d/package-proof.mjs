// Adds an original motion to an actual Cubism Editor export. Never writes MOC3.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const output = path.join(project, 'demo/static/assets/live2d/pipeline-proof');
const manifestPath = path.join(output, 'proof.model3.json');
const original = await fs.readFile(manifestPath, 'utf8').catch(error => {
  if (error.code === 'ENOENT') throw new Error('请先在 Cubism Editor 中导出 proof.model3.json、proof.moc3 和纹理图集，再运行此脚本。', { cause: error });
  throw error;
});
const manifest = JSON.parse(original);
if (manifest.Version !== 3 || !manifest.FileReferences?.Moc || !manifest.FileReferences.Textures?.length) {
  throw new Error('First export proof.model3.json, proof.moc3 and a texture atlas from Cubism Editor.');
}
for (const reference of [manifest.FileReferences.Moc, ...manifest.FileReferences.Textures]) {
  if (typeof reference !== 'string' || reference.includes('\\') || reference.includes(':')) throw new Error('Invalid export path');
  const absolute = path.resolve(output, reference);
  if (!absolute.startsWith(output + path.sep)) throw new Error('Export reference escapes the proof directory');
  await fs.access(absolute);
}
const moc = await fs.readFile(path.resolve(output, manifest.FileReferences.Moc));
if (moc.length < 64 || moc.subarray(0, 4).toString() !== 'MOC3') throw new Error('A real Editor export is required.');

const backup = path.join(project, 'work/live2d/editor-export-original');
await fs.mkdir(backup, { recursive: true });
try { await fs.writeFile(path.join(backup, 'proof.model3.json'), original, { flag: 'wx' }); }
catch (error) { if (error.code !== 'EEXIST') throw error; }

// Linear Cubism motion segments: time/value, then type(0)/time/value.
// Raise the arrow, hold the point, then return to the resting keyform.
const keys = [[0, 0], [0.16, 0], [0.3, 1], [0.95, 1], [1.4, 0], [1.6, 0]];
const motion = {
  Version: 3,
  Meta: {
    Duration: 1.6, Fps: 30, Loop: false, AreBeziersRestricted: true,
    CurveCount: 1, TotalSegmentCount: keys.length - 1, TotalPointCount: keys.length,
    UserDataCount: 0, TotalUserDataSize: 0, FadeInTime: 0.08, FadeOutTime: 0.15,
  },
  Curves: [{ Target: 'Parameter', Id: 'ParamObjection',
    Segments: [...keys[0], ...keys.slice(1).flatMap(key => [0, ...key])] }],
};
await fs.mkdir(path.join(output, 'motions'), { recursive: true });
await fs.writeFile(path.join(output, 'motions/objection.motion3.json'), JSON.stringify(motion, null, 2) + '\n');
manifest.FileReferences.Motions = {
  ...manifest.FileReferences.Motions,
  Objection: [{ File: 'motions/objection.motion3.json', FadeInTime: 0.08, FadeOutTime: 0.15 }],
};
manifest.Groups = (manifest.Groups || []).filter(group => group.Name !== 'EyeBlink');
manifest.Groups.push({ Target: 'Parameter', Name: 'EyeBlink', Ids: ['ParamEyeLOpen', 'ParamEyeROpen'] });
await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log('Packaged original objection motion and EyeBlink group. MOC3 and textures unchanged. Validate actual parameter bindings in the Web preview.');
