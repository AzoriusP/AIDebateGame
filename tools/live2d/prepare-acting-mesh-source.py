"""Extract true eye/mouth sprites and prepare painted skin behind them in ComfyUI."""
import hashlib,json,shutil,urllib.request
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw
from scipy import ndimage as ndi
ROOT=Path(__file__).resolve().parents[2]
ART=ROOT/'design/art-output/live2d-source/male-master/acting-v2'
WORK=ROOT/'work/live2d/male-master/acting-v2/mesh-source'
INPUT=ROOT/'work/live2d/comfyui/input'
WORK.mkdir(parents=True,exist_ok=True)
CASES={
 'Neutral':('klein-neutral-02','neutral',[(727,274),(790,279),(798,286),(783,310),(730,306)],[(761,357),(793,356),(791,383),(762,382)],(725,314,45,30)),
 'Lean':('klein-lean-02','lean',[(833,343),(887,350),(900,354),(890,373),(831,370)],[(839,421),(889,421),(891,437),(837,438)],(817,374,45,25)),
 'Point':('klein-point-left-01','point',[(603,253),(658,260),(676,263),(666,290),(602,286)],[(626,341),(671,342),(670,370),(626,371)],(595,292,42,30))
}
def feature_mask(source,box):
    rgb=np.asarray(Image.open(source).convert('RGB'))
    x0,y0,x1,y1=box
    dark=rgb[y0:y1,x0:x1].min(axis=2)<130
    labels,_=ndi.label(dark)
    candidates=[]
    for label in range(1,labels.max()+1):
        component=ndi.binary_fill_holes(labels==label)
        candidates.append((int(component.sum()),component))
    selected=max(candidates,key=lambda x:x[0])[1]
    raw=np.zeros(rgb.shape[:2],dtype=bool);raw[y0:y1,x0:x1]=selected
    # Keep ink AA plus a narrow painted rim; no new drawing is introduced.
    raw=ndi.binary_dilation(raw,iterations=2)
    alpha=ndi.gaussian_filter(raw.astype(float),.5)
    return np.rint(alpha*255).astype(np.uint8),raw
graph={};counter=0;outputs=[]
def node(kind,**inputs):
    global counter
    counter+=1;k=str(counter);graph[k]={'class_type':kind,'inputs':inputs};return [k,0]
def load(path):
    name='mesh-source-'+path.name;shutil.copyfile(path,INPUT/name)
    return node('LoadImage',image=name)
def mask_load(path):return node('ImageToMask',image=load(path),channel='red')
def save_rgba(image,mask,name):
    rgba=node('JoinImageWithAlpha',image=image,alpha=node('InvertMask',mask=mask))
    saved=node('SaveImage',images=rgba,filename_prefix='male-master/acting-v2-mesh-source/'+name)
    outputs.append({'name':name,'save_node':saved[0]})
for pose,(tag,short,eye_polygon,mouth_polygon,cheek_box) in CASES.items():
    source=ART/(tag+'_00002_.png');source_node=load(source)
    erase=np.zeros((1536,1536),bool)
    for suffix,polygon in [('Eye',eye_polygon),('MouthClosed',mouth_polygon)]:
        authored=Image.new('L',(1536,1536));ImageDraw.Draw(authored).polygon(polygon,fill=255)
        raw=np.asarray(authored)>0;erase |= raw
        mask=np.rint(ndi.gaussian_filter(raw.astype(float),.7)*255).astype(np.uint8)
        path=WORK/(pose+'_'+suffix+'.mask.png');Image.fromarray(mask).save(path)
        save_rgba(source_node,mask_load(path),pose+'_'+suffix)
    eraser=ndi.gaussian_filter(ndi.binary_dilation(erase,iterations=1).astype(float),1)
    silhouette=ROOT/'work/live2d/male-master/acting-v2/silhouettes-left-hand'/(pose+'.png')
    interior=ndi.distance_transform_edt(np.asarray(Image.open(silhouette))>127)
    eraser *= np.clip((interior-5)/2,0,1)
    path=WORK/(pose+'_erase.mask.png');Image.fromarray(np.rint(eraser*255).astype(np.uint8)).save(path)
    # Clone already-painted cheek skin only under the separated features.
    # This prevents changed generated jaw/brow contours leaking into the base.
    cx,cy,cw,ch=cheek_box
    skin=node('ImageCrop',image=source_node,x=cx,y=cy,width=cw,height=ch)
    skin=node('ImageScale',image=skin,width=1536,height=1536,upscale_method='bicubic',crop='disabled')
    body=node('ImageCompositeMasked',destination=source_node,source=skin,x=0,y=0,resize_source=False,mask=mask_load(path))
    save_rgba(body,mask_load(silhouette),pose+'_Body')
mouth_source=ART/'klein-neutral-face-01_00002_.png'
mask,_=feature_mask(mouth_source,(754,334,804,372))
path=WORK/'MouthOpen.mask.png';Image.fromarray(mask).save(path)
save_rgba(load(mouth_source),mask_load(path),'MouthOpen')
req=urllib.request.Request('http://127.0.0.1:8189/prompt',data=json.dumps({'prompt':graph,'client_id':'aidebate-acting-mesh-source'}).encode(),headers={'Content-Type':'application/json'})
with urllib.request.urlopen(req,timeout=30) as r:submission=json.load(r)
(WORK/'submission.json').write_text(json.dumps({'prompt':graph,'outputs':outputs,'submission':submission},indent=2),encoding='utf-8')
print(json.dumps(submission))
