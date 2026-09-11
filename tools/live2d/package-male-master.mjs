// Package the original project objection motion after a verified Editor export.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { cleanPath, parseModel } from './src/resources.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const output = path.join(project, 'demo/static/assets/live2d/male-master');
const work = path.join(project, 'work/live2d/male-master');
const manifestPath = path.join(output, 'male-master.model3.json');
const original = await fs.readFile(manifestPath);
const manifest = parseModel(original.buffer.slice(original.byteOffset, original.byteOffset + original.byteLength));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const refs = manifest.FileReferences;
const protectedFiles = [refs.Moc, ...refs.Textures].map(ref => path.resolve(output, cleanPath(ref)));
const hashes = {};
for (const file of protectedFiles) hashes[file] = hash(await fs.readFile(file));
const audit = JSON.parse(await fs.readFile(path.join(work, 'core-audit.json'), 'utf8'));
if (!audit.pass || audit.mocSha256 !== hashes[protectedFiles[0]]) throw new Error('Run the real Core audit on this exact MOC before packaging its motion.');
const parameterIds = new Set(audit.parameters.map(p => p.id));
for (const id of ['ParamObjection', 'ParamMouthOpenY', 'ParamEyeLOpen', 'ParamEyeROpen']) if (!parameterIds.has(id)) throw new Error('Model parameter missing: ' + id);

const keys = {
  ParamObjection: [[0, 0], [.12, 0], [.20, 1], [1.12, 1], [1.20, 0], [1.50, 0]],
  ParamMouthOpenY: [[0, 0], [.12, 0], [.20, 1], [.80, 1], [1.12, 0], [1.50, 0]],
};
const motion = {
  Version: 3,
  Meta: { Duration: 1.5, Fps: 30, Loop: false, AreBeziersRestricted: true, CurveCount: 2,
    TotalSegmentCount: 10, TotalPointCount: 12, UserDataCount: 0, TotalUserDataSize: 0, FadeInTime: .03, FadeOutTime: .05 },
  Curves: Object.entries(keys).map(([Id, points]) => ({ Target: 'Parameter', Id,
    Segments: [...points[0], ...points.slice(1).flatMap(point => [0, ...point])] })),
};
const backup = path.join(work, 'editor-export-original', `male-master.${hash(original).slice(0, 16)}.model3.json`);
await fs.mkdir(path.dirname(backup), { recursive: true });
try { await fs.writeFile(backup, original, { flag: 'wx' }); }
catch (error) { if (error.code !== 'EEXIST') throw error; }
if (hash(await fs.readFile(backup)) !== hash(original)) throw new Error('Export backup hash differs');
await fs.mkdir(path.join(output, 'motions'), { recursive: true });
const motionPath = path.join(output, 'motions/objection.motion3.json');
await fs.writeFile(motionPath, JSON.stringify(motion, null, 2) + '\n');
refs.Motions = { ...refs.Motions, Objection: [{ File: 'motions/objection.motion3.json', FadeInTime: .03, FadeOutTime: .05 }] };
manifest.Groups = (manifest.Groups || []).filter(g => !['EyeBlink', 'LipSync'].includes(g.Name));
manifest.Groups.push({ Target: 'Parameter', Name: 'EyeBlink', Ids: ['ParamEyeLOpen', 'ParamEyeROpen'] }, { Target: 'Parameter', Name: 'LipSync', Ids: ['ParamMouthOpenY'] });
await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
for (const [file, before] of Object.entries(hashes)) if (hash(await fs.readFile(file)) !== before) throw new Error('Protected MOC/atlas changed: ' + file);
const receipt = { originalExportBackup: backup, originalExportSha256: hash(original), model: manifestPath, modelSha256: hash(await fs.readFile(manifestPath)), motion: motionPath, motionSha256: hash(await fs.readFile(motionPath)), keys, protectedMocAndAtlasSha256: hashes, mocAndAtlasUnchanged: true, limitation: 'Arm opacity crossfades remain inside the two 0.08-second transitions. This is not continuous mutual exclusion of the two arm layers.' };
await fs.writeFile(path.join(work, 'motion-package.json'), JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify(receipt, null, 2));
