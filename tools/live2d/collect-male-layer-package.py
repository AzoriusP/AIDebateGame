"""Collect successful Comfy layer files into the stable Cubism source package."""
from pathlib import Path
import json, shutil, urllib.request
from PIL import Image,ImageChops
ROOT=Path(__file__).resolve().parents[2]
WORK=ROOT/'work/live2d/male-master'
OUT=ROOT/'design/live2d/male-master/source'
record=json.loads((WORK/'facial-rig-v2.extraction.json').read_text(encoding='utf-8'))
job_id=record['submission']['prompt_id']
with urllib.request.urlopen('http://127.0.0.1:8189/history/'+job_id,timeout=20) as r:job=json.load(r).get(job_id)
if not job or job['status']['status_str']!='success':raise RuntimeError('Extraction has not succeeded')
OUT.mkdir(parents=True,exist_ok=True)
layers=[];alpha_normalization=[]
for item in record['layers']:
    file=job['outputs'][item['save_node']]['images'][0]
    source=ROOT/'design/art-output/live2d-source'/file['subfolder']/file['filename']
    dest=OUT/'layers'/(item['name']+'.png');dest.parent.mkdir(exist_ok=True)
    with Image.open(source) as image:
        if image.mode!='RGBA' or image.size!=(1024,1536) or not image.getchannel('A').getbbox():raise ValueError('Invalid output layer')
        # Restore exact mask bytes after ComfyUI's float/PNG conversion. This is
        # alpha-format normalization, not a redraw. RGB artwork remains identical.
        with Image.open(ROOT/item['mask']) as authored_mask:
            alpha=authored_mask.convert('L')
            before=image.getchannel('A')
            delta=ImageChops.difference(before,alpha)
            alpha_normalization.append({'layer':item['name'],'max_alpha_correction':delta.getextrema()[1],'mask':item['mask'],'rgb_changed':False})
            normalized=image.copy();normalized.putalpha(alpha);normalized.save(dest)
    layers.append({'name':item['name'],'file':'layers/'+dest.name,'visible':item.get('visible',True)})
manifest={'canvas':{'width':1024,'height':1536},'layers':layers,
          'stage':'facial rig artwork; pointing arm and swap variants still pending',
          'sides':'L/R use character side; character L appears on image right',
          'provenance':str(WORK/'facial-rig-v2.extraction.json')}
(OUT/'layers.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
# Compositing is visual QA of extracted layers, not new artwork generation.
for pose,visible_overrides in [('neutral',{}),('closed',{'FaceA_EyeROpen':False,'FaceA_EyeLOpen':False,'FaceA_EyeRClosed':True,'FaceA_EyeLClosed':True}),('talking',{'FaceA_MouthClosed':False,'FaceA_MouthOpen':True})]:
    composite=Image.new('RGBA',(1024,1536),(0,0,0,0))
    for item in layers:
        if visible_overrides.get(item['name'],item['visible']):
            with Image.open(OUT/item['file']) as image:composite=Image.alpha_composite(composite,image)
    composite.save(OUT/(pose+'.preview.png'))
(WORK/'facial-rig-v2.history.json').write_text(json.dumps(job,indent=2),encoding='utf-8')
(WORK/'facial-alpha-normalization.json').write_text(json.dumps(alpha_normalization,indent=2),encoding='utf-8')
print(OUT/'layers.json')
