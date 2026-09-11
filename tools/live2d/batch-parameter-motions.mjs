import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {Performance}=require('../../demo/static/character-performance.js');
const root=new URL('../../',import.meta.url);
const base=new URL('demo/static/assets/live2d/male-acting/',root);
const out=new URL('outputs/live2d-motion-batch/',root);
const hash=b=>createHash('sha256').update(b).digest('hex');
const moc=await fs.readFile(new URL('male-acting.moc3',base));
const audit=JSON.parse(await fs.readFile(new URL('work/live2d/male-master/acting-v2/core-audit.json',root),'utf8'));
assert.equal(audit.pass,true); assert.equal(audit.mocSha256,hash(moc),'Re-audit changed model before generating clips');
for(const id of ['ParamBreath','ParamEyeROpen','ParamMouthOpenY']) {
 const binding=audit.bindings.find(x=>x.id===id);
 assert.ok(binding?.meshes?.some(m=>m.vertexDelta>1e-6||m.opacityDelta>1e-6), 'No verified binding: '+id);
}
await fs.mkdir(new URL('motions/',out),{recursive:true});
const entries=[],fps=30,frames=240;
for(const emotion of ['calm','tense','anxious','desperate'])for(const speaking of [false,true]){
 const driver=new Performance({seed:17});driver.setEmotion(emotion);driver.setSpeaking(speaking);
 const values=[];
 for(let i=0;i<=frames;i++)values.push(driver.update(i?1/fps:0));
 const mappings=[['ParamBreath','breath',0],['ParamEyeROpen','eyeOpen',0],['ParamMouthOpenY','mouthOpen',2]];
 const curves=mappings.map(([id,key,kind])=>{
  const points=values.map((v,i)=>[Number((i/fps).toFixed(6)),key==='mouthOpen'?Number(v[key]>.45):Number(v[key].toFixed(6))]);
  // Return to the resting eye/mouth at the last frame; clips are not forced loops.
  if(key==='mouthOpen')points.at(-1)[1]=0;
  if(key==='eyeOpen')points.at(-1)[1]=emotion==='desperate'?.75:1;
  for(const [time,value]of points)assert.ok(Number.isFinite(time)&&value>=0&&value<=1);
  return {Target:'Parameter',Id:id,Segments:[...points[0],...points.slice(1).flatMap(p=>[kind,...p])]};
 });
 const clip={Version:3,Meta:{Duration:frames/fps,Fps:fps,Loop:false,AreBeziersRestricted:true,CurveCount:3,TotalSegmentCount:frames*3,TotalPointCount:(frames+1)*3,UserDataCount:0,TotalUserDataSize:0,FadeInTime:.12,FadeOutTime:.12},Curves:curves};
 const file=`motions/${emotion}-${speaking?'speaking':'listening'}.motion3.json`;
 const bytes=JSON.stringify(clip,null,2)+'\n';await fs.writeFile(new URL(file,out),bytes);
 entries.push({emotion,speaking,file,sha256:hash(bytes),duration:8,curves:3});
}
const manifest=JSON.parse(await fs.readFile(new URL('male-acting.model3.json',base),'utf8'));
for(const ref of [manifest.FileReferences.Moc,...manifest.FileReferences.Textures,manifest.FileReferences.Pose,manifest.FileReferences.DisplayInfo].filter(Boolean)){
 const target=new URL(ref,out); assert.ok(target.href.startsWith(out.href));await fs.mkdir(new URL('.',target),{recursive:true});await fs.copyFile(new URL(ref,base),target);
}
const labels={calm:'冷静',tense:'紧张',anxious:'焦虑',desperate:'绝望'};
manifest.FileReferences.Motions=Object.fromEntries(entries.map(e=>[`${labels[e.emotion]}·${e.speaking?'说话':'倾听'}`,[{File:e.file,FadeInTime:.12,FadeOutTime:.12}]]));
await fs.writeFile(new URL('male-acting.model3.json',out),JSON.stringify(manifest,null,2)+'\n');
const report={modelSha256:hash(moc),generatedMotionCount:entries.length,entries,validation:{finiteValues:true,parametersInRange:true,deterministicSeed:17,visualReview:false},limitations:['Only already-bound breath, near eye and mouth are animated.','Emotion labels describe rhythm presets, not newly authored facial expressions.','No new mesh binding or pose artwork is created.']};
await fs.writeFile(new URL('batch-report.json',out),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({output:out.pathname,motions:entries.length,sha256:hash(JSON.stringify(report)),visualReview:false}));

