"""Submit a local masked art repair; restore original pixels outside the mask.

White in the mask means repaint. Candidate output still needs visual review.
Source art and mask must be aligned project PNGs with dimensions divisible by 8.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import urllib.request
from PIL import Image

PROJECT = Path(__file__).resolve().parents[2]
WORK = PROJECT/'work/live2d/male-master'
INPUT = PROJECT/'work/live2d/comfyui/input'

def inside(raw):
    path = Path(raw).resolve()
    if path.drive.upper() != 'G:' or not path.is_relative_to(PROJECT):
        raise ValueError('Inputs must remain in the G: project')
    return path

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('image');p.add_argument('mask');p.add_argument('--tag',required=True)
    p.add_argument('--positive',required=True);p.add_argument('--negative',default='bad anatomy, low quality, blurry, text, watermark')
    p.add_argument('--seed',type=int,default=2026090910);p.add_argument('--denoise',type=float,default=.85)
    p.add_argument('--roi',type=int,nargs=4,metavar=('X','Y','W','H'),help='Enlarge an aligned crop for a small facial repair')
    p.add_argument('--resolution',type=int,default=768)
    p.add_argument('--prepare-only',action='store_true')
    args=p.parse_args()
    if not args.tag.replace('-','').isalnum() or not 0<args.denoise<=1:
        raise ValueError('Invalid tag or denoise')
    source,mask=inside(args.image),inside(args.mask)
    with Image.open(source) as a, Image.open(mask) as b:
        if a.format!='PNG' or b.format!='PNG' or a.size!=b.size or any(n%8 for n in a.size):
            raise ValueError('PNG source and mask must have identical dimensions divisible by 8')
        if b.convert('L').getextrema()[1]==0:
            raise ValueError('The repaint mask is empty')
        if args.roi:
            x,y,w,h=args.roi
            if min(x,y)<0 or min(w,h)<8 or any(n%8 for n in [w,h,args.resolution]) or x+w>a.width or y+h>a.height:
                raise ValueError('ROI must fit source and use dimensions divisible by 8')
    source_name=args.tag+'-source.png'; mask_name=args.tag+'-mask.png'
    INPUT.mkdir(parents=True,exist_ok=True);WORK.mkdir(parents=True,exist_ok=True)
    shutil.copyfile(source,INPUT/source_name);shutil.copyfile(mask,INPUT/mask_name)
    graph={
        '1':{'class_type':'CheckpointLoaderSimple','inputs':{'ckpt_name':'animagine-xl-3.1.safetensors'}},
        '2':{'class_type':'VAELoader','inputs':{'vae_name':'animagine-standalone-vae.safetensors'}},
        '3':{'class_type':'LoadImage','inputs':{'image':source_name}},
        '4':{'class_type':'LoadImage','inputs':{'image':mask_name}},
        '5':{'class_type':'ImageToMask','inputs':{'image':['4',0],'channel':'red'}},
        '6':{'class_type':'CLIPTextEncode','inputs':{'clip':['1',1],'text':args.positive}},
        '7':{'class_type':'CLIPTextEncode','inputs':{'clip':['1',1],'text':args.negative}},
        '8':{'class_type':'VAEEncodeForInpaint','inputs':{'pixels':['3',0],'vae':['2',0],'mask':['5',0],'grow_mask_by':6}},
        '9':{'class_type':'KSampler','inputs':{'model':['1',0],'positive':['6',0],'negative':['7',0],
             'latent_image':['8',0],'seed':args.seed,'steps':28,'cfg':6,'sampler_name':'euler_ancestral','scheduler':'normal','denoise':args.denoise}},
        '10':{'class_type':'SaveLatent','inputs':{'samples':['9',0],'filename_prefix':'male-master/'+args.tag}},
        '11':{'class_type':'VAEDecodeTiled','inputs':{'samples':['10',0],'vae':['2',0],
              'tile_size':512,'overlap':64,'temporal_size':64,'temporal_overlap':8}},
        '12':{'class_type':'ImageCompositeMasked','inputs':{'destination':['3',0],'source':['11',0],
              'x':0,'y':0,'resize_source':False,'mask':['5',0]}},
        '13':{'class_type':'SaveImage','inputs':{'images':['12',0],'filename_prefix':'male-master/'+args.tag}},
    }
    if args.roi:
        x,y,w,h=args.roi
        for base,node in [(20,'3'),(22,'4')]:
            graph[str(base)]={'class_type':'ImageCrop','inputs':{'image':[node,0],'x':x,'y':y,'width':w,'height':h}}
            graph[str(base+1)]={'class_type':'ImageScale','inputs':{'image':[str(base),0],'width':args.resolution,'height':args.resolution,'upscale_method':'lanczos','crop':'disabled'}}
        graph['24']={'class_type':'ImageToMask','inputs':{'image':['23',0],'channel':'red'}}
        graph['8']['inputs'].update({'pixels':['21',0],'mask':['24',0]})
        graph['25']={'class_type':'ImageScale','inputs':{'image':['11',0],'width':w,'height':h,'upscale_method':'lanczos','crop':'disabled'}}
        graph['26']={'class_type':'ImageToMask','inputs':{'image':['22',0],'channel':'red'}}
        graph['12']['inputs'].update({'source':['25',0],'x':x,'y':y,'mask':['26',0]})
    record={'source':str(source),'mask':str(mask),'source_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),
            'mask_sha256':hashlib.sha256(mask.read_bytes()).hexdigest(),'seed':args.seed,'roi':args.roi,'mask_semantics':'white=repaint',
            'unmasked_pixels':'restored by ImageCompositeMasked; verify saved PNG before promotion','prompt':graph}
    if not args.prepare_only:
        with urllib.request.urlopen('http://127.0.0.1:8189/system_stats',timeout=15) as response:
            argv=json.load(response)['system']['argv']
        expected=PROJECT/'design/art-output/live2d-source'
        if '--output-directory' not in argv or Path(argv[argv.index('--output-directory')+1]).resolve()!=expected.resolve():
            raise ValueError('Expected project-isolated ComfyUI output')
        req=urllib.request.Request('http://127.0.0.1:8189/prompt',data=json.dumps({'prompt':graph,'client_id':'aidebate-male-master'}).encode(),headers={'Content-Type':'application/json'})
        with urllib.request.urlopen(req,timeout=30) as response:
            record['submission']=json.load(response)
    path=WORK/(args.tag+'.inpaint.json')
    path.write_text(json.dumps(record,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'record':str(path),'submission':record.get('submission'),'prepared':args.prepare_only}))

if __name__=='__main__':
    main()
