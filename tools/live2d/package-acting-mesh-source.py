"""Package Comfy-extracted painted layers, including pose-local eye/mouth meshes."""
import importlib.util,json,sys,urllib.request
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw
ROOT=Path(__file__).resolve().parents[2]
WORK=ROOT/'work/live2d/male-master/acting-v2/mesh-source'
OUT=ROOT/'design/live2d/male-master/acting-v2/mesh-rig-source'
OUT.mkdir(parents=True,exist_ok=True);(OUT/'layers').mkdir(exist_ok=True)
record=json.loads((WORK/'submission.json').read_text())
with urllib.request.urlopen('http://127.0.0.1:8189/history/'+record['submission']['prompt_id'],timeout=20) as r:
    job=json.load(r)[record['submission']['prompt_id']]
assert job['status']['status_str']=='success'
sources={}
for item in record['outputs']:
    saved=job['outputs'][item['save_node']]['images'][0]
    path=ROOT/'design/art-output/live2d-source'/saved['subfolder']/saved['filename']
    sources[item['name']]=Image.open(path).convert('RGBA')
offsets={'Neutral':216,'Lean':222,'Point':256}
entries=[];mouth_original=sources['MouthOpen'];mouth_sprite=mouth_original.crop(mouth_original.getchannel('A').getbbox())
for pose,offset in offsets.items():
    for suffix in ['Body','Eye','MouthClosed','MouthOpen']:
        canvas=Image.new('RGBA',(2048,1536))
        if suffix=='MouthOpen':
            box=sources[pose+'_MouthClosed'].getchannel('A').getbbox()
            width=min(34,box[2]-box[0]);height=round(mouth_sprite.height*width/mouth_sprite.width)
            sprite=mouth_sprite.resize((width,height),Image.Resampling.LANCZOS)
            center={'Neutral':(779,365),'Lean':(868,429),'Point':(652,351)}[pose]
            canvas.paste(sprite,(offset+center[0]-width//2,center[1]-height//2))
        else:canvas.paste(sources[pose+'_'+suffix],(offset,0))
        name=pose+'_'+suffix;canvas.save(OUT/'layers'/(name+'.png'))
        entries.append({'name':name,'file':'layers/'+name+'.png','visible':True})
manifest={'canvas':{'width':2048,'height':1536},'layers':entries,
          'stage':'3 pose branches with independently extracted eye, closed mouth and open mouth; 12 art meshes',
          'limits':'Eye mesh is the visible near eye; occluded far eye retained in body. Outfit and hair remain in pose branch.'}
(OUT/'layers.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
spec=importlib.util.spec_from_file_location('mesh_psd_packer',ROOT/'tools/live2d/package-layered-psd.py')
packer=importlib.util.module_from_spec(spec);sys.modules[spec.name]=packer;spec.loader.exec_module(packer)
flat=WORK/'flat.psd';packer.package(OUT/'layers.json',flat,overwrite=True)
sys.path.insert(0,str(ROOT/'work/live2d/psd-compatibility/python-libs'))
from psd_tools import PSDImage
from psd_tools.api.layers import Group
psd=PSDImage.open(flat);pixels=list(psd)
for pose in offsets:
    group=Group.new(psd,'Pose'+pose);group.opacity=255 if pose=='Neutral' else 0
    for layer in pixels:
        if layer.name.startswith(pose+'_'):
            layer.move_to_group(group);layer.opacity=0 if layer.name.endswith('_MouthOpen') else 255
psd.save(OUT/'male-acting-rig.psd')
board=Image.new('RGB',(1200,900),'#e8e3db');draw=ImageDraw.Draw(board)
boxes={'Neutral':(910,230,1060,420),'Lean':(1030,295,1180,485),'Point':(830,215,980,410)}
for row,pose in enumerate(offsets):
    layers={s:Image.open(OUT/'layers'/(pose+'_'+s+'.png')).convert('RGBA') for s in ['Body','Eye','MouthClosed','MouthOpen']}
    for col,(blink,talk) in enumerate([(False,False),(True,False),(False,True),(True,True)]):
        composite=layers['Body'].copy();eye=layers['Eye']
        if blink:
            box=eye.getchannel('A').getbbox();sprite=eye.crop(box).resize((box[2]-box[0],3),Image.Resampling.LANCZOS)
            eye=Image.new('RGBA',eye.size);eye.paste(sprite,(box[0],(box[1]+box[3])//2-1))
        composite=Image.alpha_composite(composite,eye)
        composite=Image.alpha_composite(composite,layers['MouthOpen' if talk else 'MouthClosed'])
        crop=composite.crop(boxes[pose]);crop.thumbnail((270,265))
        board.paste(crop,(col*300+15,row*300+25),crop)
        draw.text((col*300+15,row*300+5),pose+' '+str((blink,talk)),fill='black')
board.save(OUT/'face-contact-sheet.png')
readback=PSDImage.open(OUT/'male-acting-rig.psd');assert len(readback)==3 and all(len(g)==4 for g in readback)
checks=[]
for g in readback:
    for layer in g:
        expected=np.asarray(Image.open(OUT/'layers'/(layer.name+'.png')).crop(layer.bbox))
        assert np.array_equal(expected,np.asarray(layer.topil().convert('RGBA')))
        checks.append({'name':layer.name,'part':g.name,'opacity':layer.opacity,'part_opacity':g.opacity,'pixels_verified':True})
(OUT/'verification.json').write_text(json.dumps(checks,indent=2),encoding='utf-8')
print(OUT/'male-acting-rig.psd')
