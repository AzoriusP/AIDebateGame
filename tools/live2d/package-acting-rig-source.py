"""Collect pose branches and local facial overlays into a grouped Cubism PSD.

The broad pose drawings remain branches; this is not yet a modular outfit rig.
"""
import hashlib, importlib.util, json, sys, urllib.request
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'work/live2d/psd-compatibility/python-libs'))
from psd_tools import PSDImage
from psd_tools.api.layers import Group
OUT=ROOT/'design/live2d/male-master/acting-v2/rig-source'
OUT.mkdir(parents=True,exist_ok=True);(OUT/'layers').mkdir(exist_ok=True)
record=json.loads((ROOT/'work/live2d/male-master/acting-v2-face-rig.extraction.json').read_text())
with urllib.request.urlopen('http://127.0.0.1:8189/history/'+record['submission']['prompt_id'],timeout=20) as r:
    job=json.load(r)[record['submission']['prompt_id']]
assert job['status']['status_str']=='success'
offsets={'Neutral':216,'Lean':222,'Point':256}
entries=[]
for pose in offsets:
    base=Image.open(ROOT/'design/live2d/male-master/acting-v2/pose-sources-left-hand/layers'/(pose+'.png')).convert('RGBA')
    base.save(OUT/'layers'/(pose+'_Body.png'))
    entries.append({'name':pose+'_Body','file':'layers/'+pose+'_Body.png','visible':True})
    for suffix in ['EyesClosed','MouthOpen']:
        item=next(x for x in record['layers'] if x['name']==pose+'_'+suffix)
        saved=job['outputs'][item['save_node']]['images'][0]
        source=ROOT/'design/art-output/live2d-source'/saved['subfolder']/saved['filename']
        image=Image.open(source).convert('RGBA')
        mask=Image.open(ROOT/item['mask']).convert('L')
        assert np.abs(np.asarray(image.getchannel('A'),dtype=np.int16)-np.asarray(mask,dtype=np.int16)).max()<=1
        image.putalpha(mask)
        canvas=Image.new('RGBA',base.size);canvas.paste(image,(offsets[pose],0))
        dest=OUT/'layers'/(pose+'_'+suffix+'.png');canvas.save(dest)
        entries.append({'name':pose+'_'+suffix,'file':'layers/'+dest.name,'visible':True})
manifest={'canvas':{'width':2048,'height':1536},'layers':entries,
          'stage':'3 pose branches, each with a body, blink overlay and mouth overlay',
          'limits':'Synchronous eyes; clothing/hair not yet independently swappable'}
(OUT/'layers.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
spec=importlib.util.spec_from_file_location('acting_psd_packer',ROOT/'tools/live2d/package-layered-psd.py')
packer=importlib.util.module_from_spec(spec);sys.modules[spec.name]=packer;spec.loader.exec_module(packer)
flat=ROOT/'work/live2d/male-master/acting-v2/face-rig/flat-rig.psd'
packer.package(OUT/'layers.json',flat,overwrite=True)
psd=PSDImage.open(flat)
original_layers=list(psd)
for pose in offsets:
    group=Group.new(psd,'Pose'+pose)
    group.opacity=255 if pose=='Neutral' else 0
    for layer in original_layers:
        if layer.name.startswith(pose+'_'):
            layer.move_to_group(group)
            layer.opacity=255 if layer.name.endswith('_Body') else 0
            layer.visible=True
psd.save(OUT/'male-acting-rig.psd')
readback=PSDImage.open(OUT/'male-acting-rig.psd')
assert len(readback)==3 and all(len(group)==3 for group in readback)
checks=[]
for group in readback:
    for layer in group:
        expected=Image.open(OUT/'layers'/(layer.name+'.png')).crop(layer.bbox)
        actual=layer.topil().convert('RGBA')
        assert np.array_equal(np.asarray(expected),np.asarray(actual))
        checks.append({'name':layer.name,'part':group.name,'opacity':layer.opacity,'part_opacity':group.opacity,'pixel_match':True})
(OUT/'verification.json').write_text(json.dumps(checks,indent=2),encoding='utf-8')
board=Image.new('RGB',(1200,900),'#e8e3db');draw=ImageDraw.Draw(board)
for row,pose in enumerate(offsets):
    base=Image.open(OUT/'layers'/(pose+'_Body.png')).convert('RGBA')
    eye=Image.open(OUT/'layers'/(pose+'_EyesClosed.png')).convert('RGBA')
    mouth=Image.open(OUT/'layers'/(pose+'_MouthOpen.png')).convert('RGBA')
    boxes={'Neutral':(910,230,1060,420),'Lean':(1030,295,1180,485),'Point':(830,215,980,410)}
    for col,(label,layers) in enumerate([('Idle',[]),('Blink',[eye]),('Talk',[mouth]),('Both',[eye,mouth])]):
        composite=base.copy()
        for layer in layers: composite=Image.alpha_composite(composite,layer)
        crop=composite.crop(boxes[pose]);crop.thumbnail((270,265))
        board.paste(crop,(col*300+15,row*300+25),crop)
        draw.text((col*300+15,row*300+5),pose+' '+label,fill='black')
board.save(OUT/'face-contact-sheet.png')
print(OUT/'male-acting-rig.psd')
