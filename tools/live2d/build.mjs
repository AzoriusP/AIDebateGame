import { build } from 'esbuild';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.dirname(fileURLToPath(import.meta.url));
const output = path.resolve(root, '../../demo/static');
const framework = path.join(root, 'vendor/CubismWebFramework-5-r.5');
await mkdir(path.join(output, 'vendor/live2d/5-r.5'), { recursive: true });
await build({ entryPoints: [path.join(root, 'src/preview.ts')], outfile: path.join(output, 'vendor/live2d/5-r.5/preview-runtime.js'), bundle: true, format: 'iife', target: ['es2022'], sourcemap: false, legalComments: 'eof', banner: { js: '/* AIDebate local Cubism preview; official Framework 5-r.5. See LICENSE-Framework.md. */' } });
await build({ entryPoints: [path.join(root, 'src/character.ts')], outfile: path.join(output, 'vendor/live2d/5-r.5/character-runtime.js'), bundle: true, format: 'iife', target: ['es2022'], legalComments: 'eof' });
await build({ entryPoints: [path.join(root, 'src/bootstrap.ts')], outfile: path.join(output, 'live2d-preview.js'), bundle: true, format: 'iife', target: ['es2022'] });
await cp(path.join(framework, 'Shaders/WebGL'), path.join(output, 'vendor/live2d/5-r.5/Shaders'), { recursive: true });
await writeFile(path.join(output, 'vendor/live2d/5-r.5/LICENSE-Framework.md'), await readFile(path.join(framework, 'LICENSE.md')));
console.log('Built demo/static/live2d-preview.js and local Cubism R5 shaders. Core must be supplied separately from the official SDK.');

await build({ entryPoints: [path.join(output, 'recording-rehearsal.js')], outfile: path.join(output, 'rehearsal-runtime.js'), bundle: true, format: 'iife', target: ['es2022'] });

