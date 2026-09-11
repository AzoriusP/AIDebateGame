import fs from 'node:fs/promises';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import assert from 'node:assert/strict';
const root=new URL('../../',import.meta.url), here=fileURLToPath(new URL('.',import.meta.url));
const context=vm.createContext({console,process,Buffer,require:createRequire(import.meta.url),__dirname:here,setTimeout,clearTimeout,TextDecoder,TextEncoder});
vm.runInContext(await fs.readFile(new URL('demo/static/vendor/live2d/5-r.5/live2dcubismcore.min.js',root),'utf8'),context);
for(let i=0;i<100;i++){try{if(context.Live2DCubismCore.Version.csmGetVersion())break;}catch{} await new Promise(r=>setTimeout(r,10));}
const compiled=await build({stdin:{contents:`
import {CubismFramework} from './vendor/CubismWebFramework-5-r.5/src/live2dcubismframework';
import {CubismMotion} from './vendor/CubismWebFramework-5-r.5/src/motion/cubismmotion';
CubismFramework.startUp(); CubismFramework.initialize();
export function validate(input){const bytes=new Uint8Array(input).buffer;const motion=CubismMotion.create(bytes,bytes.byteLength,undefined,undefined,true);if(!motion)throw new Error('SDK rejected motion');const duration=motion.getDuration();motion.release();return duration;}
`,resolveDir:here,loader:'ts'},bundle:true,format:'iife',globalName:'BatchAudit',write:false,logLevel:'silent'});
vm.runInContext(compiled.outputFiles[0].text,context);
const out=new URL('outputs/live2d-motion-batch/',root);
const report=JSON.parse(await fs.readFile(new URL('batch-report.json',out),'utf8'));
for(const entry of report.entries){context.clipBytes=await fs.readFile(new URL(entry.file,out));assert.equal(vm.runInContext('BatchAudit.validate(clipBytes)',context),entry.duration);}
report.validation.officialSdkParsedMotionCount=report.entries.length;
await fs.writeFile(new URL('sdk-validation.json',out),JSON.stringify({pass:true,motions:report.entries.length,visualReview:false},null,2)+'\n');
console.log('Official Cubism Framework parsed all '+report.entries.length+' clips with motion consistency checking enabled.');
