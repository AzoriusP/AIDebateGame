"""Declare the first facial-rig artwork layers, in PSD bottom-to-top order."""
from pathlib import Path
import json
ROOT=Path(__file__).resolve().parents[2]
ART='design/art-output/live2d-source/male-master/'
MASK='work/live2d/male-master/masks/'
layers=[]
def layer(name,mask,source='candidate-03-hands_00002_.png',visible=True):
    layers.append({'name':name,'image':ART+source,'mask':MASK+mask+'.png','visible':visible})
layer('OutfitA_Body','semantic-body-v1')
layer('FaceA_Base','semantic-head-v1','candidate-03-face-base_00002_.png')
layer('FaceA_EyeROpen','eye-r-open-v1')
layer('FaceA_EyeLOpen','eye-l-open-v1')
layer('FaceA_BrowR','brow-r-v1')
layer('FaceA_BrowL','brow-l-v1')
layer('FaceA_MouthClosed','mouth-closed-wide-v1')
layer('FaceA_EyeRClosed','eye-r-open-v1','closed-lids-aligned_00001_.png',False)
layer('FaceA_EyeLClosed','eye-l-open-v1','closed-lids-aligned_00001_.png',False)
layer('FaceA_MouthOpen','mouth-open-v1','candidate-03-mouth-open_00002_.png',False)
layer('HairA_Front','semantic-hair-v1')
out=ROOT/'work/live2d/male-master/facial-rig-v1.manifest.json'
out.write_text(json.dumps({'canvas':{'width':1024,'height':1536},'layers':layers},indent=2),encoding='utf-8')
print(out)
