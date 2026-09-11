"""Place the approved painted closed lid on both eyes via ComfyUI nodes.

The line artwork comes from local inpainting. This script creates its control
mask and aligns/mirrors that artwork; it does not draw replacement character art.
"""
from pathlib import Path
import json,shutil,urllib.request
from PIL import Image,ImageDraw
ROOT=Path(__file__).resolve().parents[2]
IN=ROOT/'work/live2d/comfyui/input';WORK=ROOT/'work/live2d/male-master'
mask=Image.new('L',(4096,6144),0)
pts=[(434,306),(437,299),(445,292),(451,291),(460,292),(471,296),(480,300),(482,303),(474,303),(459,299),(449,299),(440,305)]
ImageDraw.Draw(mask).polygon([(x*4,y*4) for x,y in pts],fill=255)
mask=mask.resize((1024,1536),Image.Resampling.LANCZOS)
mask.save(WORK/'masks/closed-lid-r-v1.png');mask.save(IN/'closed-lid-r-mask.png')
for name,source in [('closed-lid-source','candidate-03-closed-talk_00002_.png'),('closed-lid-base','candidate-03-face-base_00002_.png')]:
    shutil.copyfile(ROOT/'design/art-output/live2d-source/male-master'/source,IN/(name+'.png'))
g={
 '1':{'class_type':'LoadImage','inputs':{'image':'closed-lid-source.png'}},
 '2':{'class_type':'LoadImage','inputs':{'image':'closed-lid-base.png'}},
 '3':{'class_type':'LoadImage','inputs':{'image':'closed-lid-r-mask.png'}},
 '4':{'class_type':'ImageToMask','inputs':{'image':['3',0],'channel':'red'}},
 '5':{'class_type':'ImageCompositeMasked','inputs':{'destination':['2',0],'source':['1',0],'x':0,'y':0,'resize_source':False,'mask':['4',0]}},
 '6':{'class_type':'ImageCrop','inputs':{'image':['1',0],'x':430,'y':288,'width':56,'height':24}},
 '7':{'class_type':'ImageCrop','inputs':{'image':['3',0],'x':430,'y':288,'width':56,'height':24}},
 '8':{'class_type':'ImageFlip','inputs':{'image':['6',0],'flip_method':'y-axis: horizontally'}},
 '9':{'class_type':'ImageFlip','inputs':{'image':['7',0],'flip_method':'y-axis: horizontally'}},
 '10':{'class_type':'ImageToMask','inputs':{'image':['9',0],'channel':'red'}},
 '11':{'class_type':'ImageCompositeMasked','inputs':{'destination':['5',0],'source':['8',0],'x':535,'y':291,'resize_source':False,'mask':['10',0]}},
 '12':{'class_type':'SaveImage','inputs':{'images':['11',0],'filename_prefix':'male-master/closed-lids-aligned'}},
}
request=urllib.request.Request('http://127.0.0.1:8189/prompt',data=json.dumps({'prompt':g,'client_id':'aidebate-male-master'}).encode(),headers={'Content-Type':'application/json'})
with urllib.request.urlopen(request,timeout=30) as r:submission=json.load(r)
(WORK/'closed-lids-aligned.prompt.json').write_text(json.dumps({'prompt':g,'submission':submission},indent=2),encoding='utf-8')
print(submission)
