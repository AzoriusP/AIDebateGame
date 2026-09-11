"""Extract existing artwork through semantic masks using ComfyUI RGBA nodes.

Manifest: {"layers":[{"name":"Name","image":"project/path.png",
"mask":"project/mask.png"}]}. White in each mask keeps source artwork.
This never fabricates hidden anatomy; repaired sources must be supplied first.
"""
import argparse, hashlib, json, shutil, urllib.request
from pathlib import Path
from PIL import Image

ROOT=Path(__file__).resolve().parents[2]
INPUT=ROOT/'work/live2d/comfyui/input'
WORK=ROOT/'work/live2d/male-master'
def local(raw):
    p=(ROOT/raw).resolve()
    if p.drive.upper()!='G:' or not p.is_relative_to(ROOT): raise ValueError('Project paths required')
    return p
def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('manifest');parser.add_argument('--tag',required=True)
    args=parser.parse_args()
    if not args.tag.replace('-','').isalnum():raise ValueError('Invalid tag')
    manifest=local(args.manifest)
    data=json.loads(manifest.read_text(encoding='utf-8-sig'))
    graph={};records=[]
    for i,item in enumerate(data['layers']):
        name=item['name']
        if not name.replace('_','').replace('-','').isalnum():raise ValueError('Invalid layer name')
        source,mask=local(item['image']),local(item['mask'])
        with Image.open(source) as a,Image.open(mask) as b:
            if a.size!=b.size:raise ValueError('Canvas mismatch')
        for role,path in [('image',source),('mask',mask)]:
            shutil.copyfile(path,INPUT/(args.tag+'-'+name+'-'+role+'.png'))
        n=lambda offset:str(i*6+offset)
        graph[n(1)]={'class_type':'LoadImage','inputs':{'image':args.tag+'-'+name+'-image.png'}}
        graph[n(2)]={'class_type':'LoadImage','inputs':{'image':args.tag+'-'+name+'-mask.png'}}
        graph[n(3)]={'class_type':'ImageToMask','inputs':{'image':[n(2),0],'channel':'red'}}
        graph[n(4)]={'class_type':'InvertMask','inputs':{'mask':[n(3),0]}}
        graph[n(5)]={'class_type':'JoinImageWithAlpha','inputs':{'image':[n(1),0],'alpha':[n(4),0]}}
        graph[n(6)]={'class_type':'SaveImage','inputs':{'images':[n(5),0],'filename_prefix':f'male-master/{args.tag}/{name}'}}
        records.append({**item,'save_node':n(6),'source_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'mask_sha256':hashlib.sha256(mask.read_bytes()).hexdigest()})
    with urllib.request.urlopen('http://127.0.0.1:8189/system_stats',timeout=15) as r:argv=json.load(r)['system']['argv']
    if Path(argv[argv.index('--output-directory')+1]).resolve()!=ROOT/'design/art-output/live2d-source':raise ValueError('Wrong Comfy output directory')
    request=urllib.request.Request('http://127.0.0.1:8189/prompt',data=json.dumps({'prompt':graph,'client_id':'aidebate-male-master'}).encode(),headers={'Content-Type':'application/json'})
    with urllib.request.urlopen(request,timeout=30) as r:submission=json.load(r)
    receipt=WORK/(args.tag+'.extraction.json')
    receipt.write_text(json.dumps({'layers':records,'prompt':graph,'submission':submission},ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'receipt':str(receipt),'submission':submission}))
if __name__=='__main__':main()
