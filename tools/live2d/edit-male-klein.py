"""Use the official local Klein 4B reference-edit workflow for character art.

Weights, source references, prompts, receipts and outputs remain in the G:
project. This produces candidate paintings, not PSD layers or a Cubism rig.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import urllib.request

PROJECT = Path(__file__).resolve().parents[2]
WORK = PROJECT/'work/live2d/male-master/acting-v2'
INPUT = PROJECT/'work/live2d/comfyui/input'
OUTPUT = PROJECT/'design/art-output/live2d-source'


def request(path, payload=None):
    data = None if payload is None else json.dumps(payload).encode('utf-8')
    with urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:8189'+path,data=data,
            headers={'Content-Type':'application/json'}),timeout=45) as response:
        return json.load(response)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--reference', action='append', required=True, help='Ordered project image references')
    parser.add_argument('--prompt-file', required=True)
    parser.add_argument('--tag', required=True)
    parser.add_argument('--seed', type=int, default=2026091020)
    parser.add_argument('--size', type=int, choices=[1024,1536], default=1536)
    parser.add_argument('--text-device', choices=['cpu','default'], default='cpu',
                        help='CPU avoids this Windows runtime crashing while offloading the large text encoder')
    parser.add_argument('--prepare-only', action='store_true')
    args = parser.parse_args()
    if PROJECT.drive.upper() != 'G:' or not args.tag.replace('-','').isalnum():
        raise ValueError('Use the G: project and a simple tag')
    if not 1 <= len(args.reference) <= 3:
        raise ValueError('Use one to three ordered references')
    paths = [(PROJECT/raw).resolve() for raw in args.reference]
    prompt_path = (PROJECT/args.prompt_file).resolve()
    if not all(path.is_relative_to(PROJECT) and path.is_file() for path in [*paths,prompt_path]):
        raise ValueError('All inputs must be existing files in the project')
    prompt = prompt_path.read_text(encoding='utf-8-sig').strip()
    if not prompt:
        raise ValueError('Prompt cannot be empty')
    INPUT.mkdir(parents=True, exist_ok=True)
    WORK.mkdir(parents=True, exist_ok=True)
    record_path = WORK/(args.tag+'.klein.json')
    if record_path.exists():
        raise ValueError('Use a new tag to preserve existing production receipts')
    graph = {
        '1': {'class_type':'UNETLoader','inputs':{'unet_name':'flux-2-klein-4b-fp8.safetensors','weight_dtype':'default'}},
        '2': {'class_type':'CLIPLoader','inputs':{'clip_name':'qwen_3_4b.safetensors','type':'flux2','device':args.text_device}},
        '3': {'class_type':'VAELoader','inputs':{'vae_name':'flux2-vae.safetensors'}},
        '4': {'class_type':'CLIPTextEncode','inputs':{'text':prompt,'clip':['2',0]}},
        '5': {'class_type':'ConditioningZeroOut','inputs':{'conditioning':['4',0]}},
        '6': {'class_type':'EmptyFlux2LatentImage','inputs':{'width':args.size,'height':args.size,'batch_size':1}},
        '7': {'class_type':'RandomNoise','inputs':{'noise_seed':args.seed}},
        '8': {'class_type':'KSamplerSelect','inputs':{'sampler_name':'euler'}},
        '9': {'class_type':'Flux2Scheduler','inputs':{'steps':4,'width':args.size,'height':args.size}},
    }
    positive, negative = ['4',0], ['5',0]
    references = []
    for index,path in enumerate(paths):
        base = 20+index*5
        name = 'klein-'+args.tag+'-ref-'+str(index+1)+path.suffix
        shutil.copyfile(path,INPUT/name)
        graph[str(base)] = {'class_type':'LoadImage','inputs':{'image':name}}
        graph[str(base+1)] = {'class_type':'ImageScaleToTotalPixels','inputs':{
            'image':[str(base),0],'upscale_method':'lanczos','megapixels':1.0,'resolution_steps':16}}
        graph[str(base+2)] = {'class_type':'VAEEncode','inputs':{'pixels':[str(base+1),0],'vae':['3',0]}}
        graph[str(base+3)] = {'class_type':'ReferenceLatent','inputs':{'conditioning':positive,'latent':[str(base+2),0]}}
        graph[str(base+4)] = {'class_type':'ReferenceLatent','inputs':{'conditioning':negative,'latent':[str(base+2),0]}}
        positive,negative = [str(base+3),0],[str(base+4),0]
        references.append({'index':index+1,'path':str(path),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
    graph['10'] = {'class_type':'CFGGuider','inputs':{'model':['1',0],'positive':positive,'negative':negative,'cfg':1.0}}
    graph['11'] = {'class_type':'SamplerCustomAdvanced','inputs':{'noise':['7',0],'guider':['10',0],'sampler':['8',0],'sigmas':['9',0],'latent_image':['6',0]}}
    graph['12'] = {'class_type':'SaveLatent','inputs':{'samples':['11',0],'filename_prefix':'male-master/acting-v2/'+args.tag}}
    graph['13'] = {'class_type':'VAEDecodeTiled','inputs':{'samples':['12',0],'vae':['3',0],'tile_size':512,'overlap':64,'temporal_size':64,'temporal_overlap':8}}
    graph['14'] = {'class_type':'SaveImage','inputs':{'images':['13',0],'filename_prefix':'male-master/acting-v2/'+args.tag}}
    record = {'stage':'candidate image; visual review pending','references':references,'settings':vars(args),'prompt':graph,
              'workflow_basis':'Comfy-Org/workflow_templates image_flux2_klein_image_edit_4b_distilled.json',
              'model_integrity_record':str(WORK/'klein-model-integrity.json')}
    record_path.write_text(json.dumps(record,ensure_ascii=False,indent=2),encoding='utf-8')
    if not args.prepare_only:
        integrity = json.loads((WORK/'klein-model-integrity.json').read_text(encoding='utf-8'))
        if len(integrity) != 3 or not all(item.get('verified') and Path(item['path']).is_relative_to(PROJECT) and
                                          Path(item['path']).stat().st_size == item['bytes'] for item in integrity):
            raise ValueError('Verified project model files are required')
        argv = request('/system_stats')['system']['argv']
        if '--output-directory' not in argv or Path(argv[argv.index('--output-directory')+1]).resolve() != OUTPUT.resolve():
            raise ValueError('Expected project-isolated ComfyUI output')
        record['submission'] = request('/prompt',{'prompt':graph,'client_id':'aidebate-klein-acting'})
        record_path.write_text(json.dumps(record,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'record':str(record_path),'submission':record.get('submission')},ensure_ascii=False))


if __name__ == '__main__':
    main()
