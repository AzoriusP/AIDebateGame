import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('../../', import.meta.url);
const base = new URL('demo/static/assets/live2d/male-acting/', root);
const work = new URL('work/live2d/male-master/acting-v2/', root);
const hash = data => createHash('sha256').update(data).digest('hex');
const moc = await fs.readFile(new URL('male-acting.moc3', base));
const audit = JSON.parse(await fs.readFile(new URL('core-audit.json', work), 'utf8'));
if (!audit.pass || audit.mocSha256 !== hash(moc)) throw new Error('Audit this exact exported MOC first');
const manifestFile = new URL('male-acting.model3.json', base);
const original = await fs.readFile(manifestFile);
try { await fs.writeFile(new URL('editor-original.model3.json', work), original, { flag: 'wx' }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
const manifest = JSON.parse(original);
const clips = [
  { name: '呼吸', file: 'breath', id: 'ParamBreath', keys: [[0,0],[1, .5],[2,1],[3,.5],[4,0]], stepped: false },
  { name: '眨眼', file: 'blink', id: 'ParamEyeROpen', keys: [[0,1],[.08,0],[.13,0],[.23,1],[.5,1]], stepped: false },
  { name: '说话', file: 'talk', id: 'ParamMouthOpenY', keys: [[0,0],[.1,1],[.24,0],[.35,1],[.5,0],[.65,1],[.8,0],[1,0]], stepped: true },
];
await fs.mkdir(new URL('motions/', base), { recursive: true });
for (const clip of clips) {
  const motion = { Version: 3, Meta: { Duration: clip.keys.at(-1)[0], Fps: 30, Loop: false, AreBeziersRestricted: true, CurveCount: 1, TotalSegmentCount: clip.keys.length - 1, TotalPointCount: clip.keys.length, UserDataCount: 0, TotalUserDataSize: 0, FadeInTime: 0, FadeOutTime: 0 }, Curves: [{ Target: 'Parameter', Id: clip.id, Segments: [...clip.keys[0], ...clip.keys.slice(1).flatMap(key => [clip.stepped ? 2 : 0, ...key])] }] };
  await fs.writeFile(new URL(`motions/${clip.file}.motion3.json`, base), JSON.stringify(motion, null, 2) + '\n');
}
// Standard SDK viewers select the first pose. The game's Acting controller owns live pose selection.
await fs.writeFile(new URL('male-acting.pose3.json', base), JSON.stringify({ Type: 'Live2D Pose', FadeInTime: .01, Groups: [[{ Id: 'PoseNeutral' }, { Id: 'PoseLean' }, { Id: 'PosePoint' }]] }, null, 2) + '\n');
manifest.FileReferences.Pose = 'male-acting.pose3.json';
manifest.FileReferences.Motions = Object.fromEntries(clips.map(clip => [clip.name, [{ File: `motions/${clip.file}.motion3.json`, FadeInTime: 0, FadeOutTime: 0 }]]));
manifest.Groups = [{ Target: 'Parameter', Name: 'EyeBlink', Ids: ['ParamEyeROpen'] }, { Target: 'Parameter', Name: 'LipSync', Ids: ['ParamMouthOpenY'] }];
await fs.writeFile(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
const paths = ['male-acting.moc3', 'male-acting.model3.json', 'male-acting.pose3.json', 'male-acting.cdi3.json', ...manifest.FileReferences.Textures, ...clips.map(clip => `motions/${clip.file}.motion3.json`)];
const files = [];
for (const path of paths) { const data = await fs.readFile(new URL(path, base)); files.push({ path, bytes: data.length, sha256: hash(data) }); }
await fs.writeFile(new URL('runtime-package.json', work), JSON.stringify({ mocAuditPassed: true, files, limitations: ['Three key poses; shoulder and elbow are not continuously rigged.', 'Only the near eye has blink binding.', 'Hair, face identity and clothing swaps are not yet produced.'] }, null, 2) + '\n');
console.log('Packaged 3 parameter motions, SDK pose configuration, and verified MOC/atlas references.');
