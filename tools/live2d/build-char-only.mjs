// 只重建 character-runtime.js —— 不触碰 Shaders / preview / bootstrap，
// 避免误伤 demo/static/vendor 下已就绪的产物。
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const output = path.resolve(root, '../../demo/static');

await build({
  entryPoints: [path.join(root, 'src/character.ts')],
  outfile: path.join(output, 'vendor/live2d/5-r.5/character-runtime.js'),
  bundle: true,
  format: 'iife',
  target: ['es2022'],
  legalComments: 'eof',
});
console.log('Rebuilt character-runtime.js only.');
