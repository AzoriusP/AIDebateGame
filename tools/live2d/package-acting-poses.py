"""Package extracted pose references; this deliberately does not claim a rig.

Normalize Comfy alpha round-trip and translate whole poses onto a shared canvas.
No source painting pixels are redrawn, stretched or recolored.
"""
import hashlib
import argparse
import json
from pathlib import Path
import shutil
import urllib.request
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT/'work/live2d/male-master'
OUT = ROOT/'design/live2d/male-master/acting-v2/pose-sources'
WEB = ROOT/'demo/static/assets/acting-v2'
OFFSETS = {'Neutral':216, 'Lean':222, 'Point':355}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--left-hand', action='store_true', help='Package the corrected anatomical-left pointing pose separately')
    args = parser.parse_args()
    out = OUT.parent/'pose-sources-left-hand' if args.left_hand else OUT
    offsets = {**OFFSETS, 'Point':256} if args.left_hand else OFFSETS
    tag = 'acting-v2-left-hand-cutouts' if args.left_hand else 'acting-v2-pose-cutouts'
    record = json.loads((WORK/(tag+'.extraction.json')).read_text(encoding='utf-8'))
    with urllib.request.urlopen('http://127.0.0.1:8189/history/'+record['submission']['prompt_id'], timeout=20) as response:
        history = json.load(response)[record['submission']['prompt_id']]
    if history['status']['status_str'] != 'success':
        raise RuntimeError('Comfy extraction did not succeed')
    out.mkdir(parents=True, exist_ok=True); WEB.mkdir(parents=True, exist_ok=True)
    (out/'layers').mkdir(exist_ok=True)
    layers, receipts = [], []
    for item in record['layers']:
        descriptor = history['outputs'][item['save_node']]['images'][0]
        source = ROOT/'design/art-output/live2d-source'/descriptor['subfolder']/descriptor['filename']
        image = Image.open(source).convert('RGBA')
        mask = Image.open(ROOT/item['mask']).convert('L')
        delta = int(np.abs(np.asarray(image.getchannel('A'), dtype=np.int16)-np.asarray(mask, dtype=np.int16)).max())
        rgb_delta = int(np.abs(np.asarray(image.convert('RGB'), dtype=np.int16)-np.asarray(Image.open(ROOT/item['image']).convert('RGB'), dtype=np.int16)).max())
        if delta > 1 or rgb_delta > 1:
            raise ValueError('Unexpected extraction round-trip change')
        image.putalpha(mask)
        canvas = Image.new('RGBA', (2048, 1536))
        # Paste without a mask to preserve straight RGB and exact alpha bytes.
        canvas.paste(image, (offsets[item['name']], 0))
        dest = out/'layers'/(item['name']+'.png')
        web_name = 'Point-left.png' if args.left_hand and item['name']=='Point' else dest.name
        canvas.save(dest); shutil.copyfile(dest, WEB/web_name)
        layers.append({'name':item['name']+'_PoseReference', 'file':'layers/'+dest.name, 'visible':item['name']=='Neutral'})
        receipts.append({'name':item['name'], 'source':item['image'], 'source_sha256':item['source_sha256'],
                         'translation_xy':[offsets[item['name']],0], 'scale':1, 'output_sha256':hashlib.sha256(dest.read_bytes()).hexdigest(),
                         'max_alpha_roundtrip_correction':delta, 'max_rgb_roundtrip_delta':rgb_delta, 'bounds':canvas.getchannel('A').getbbox()})
    manifest = {'canvas':{'width':2048,'height':1536}, 'layers':layers,
                'stage':'pose reference board; three complete poses, NOT segmented rig parts',
                'pointing_hand':'anatomical LEFT; right arm lowered' if args.left_hand else 'superseded: wrong arm, see left-hand correction',
                'registration':'Approximate lower-pelvis center at x=896. Translation only; head/shoulder keypoints remain pose-specific.',
                'remaining':['color consistency','semantic layers and hidden surfaces','eyes/mouth variants','Cubism binding','real export and runtime integration']}
    (out/'layers.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    (out/'provenance.json').write_text(json.dumps(receipts, indent=2), encoding='utf-8')
    print(out/'layers.json')

if __name__ == '__main__':
    main()
