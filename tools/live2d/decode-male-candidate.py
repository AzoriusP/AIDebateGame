"""Decode a saved project latent with only the standalone local VAE loaded."""
import argparse
import json
from pathlib import Path
import urllib.request

project = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--latent',default='candidate-01-gpu.latent')
parser.add_argument('--tag',default='candidate-01-decoded')
args = parser.parse_args()
if Path(args.latent).name != args.latent or not args.tag.replace('-','').isalnum():
    raise ValueError('Use simple project input filenames and tags')
graph = {
    '1':{'class_type':'VAELoader','inputs':{'vae_name':'animagine-standalone-vae.safetensors'}},
    '2':{'class_type':'LoadLatent','inputs':{'latent':args.latent}},
    '3':{'class_type':'VAEDecodeTiled','inputs':{'samples':['2',0],'vae':['1',0],
         'tile_size':512,'overlap':64,'temporal_size':64,'temporal_overlap':8}},
    '4':{'class_type':'SaveImage','inputs':{'images':['3',0],'filename_prefix':'male-master/'+args.tag}},
}
work = project / 'work/live2d/male-master'
(work/(args.tag+'.decode.json')).write_text(json.dumps(graph,indent=2),encoding='utf-8')
request = urllib.request.Request('http://127.0.0.1:8189/prompt',
    data=json.dumps({'prompt':graph,'client_id':'aidebate-male-master'}).encode(),
    headers={'Content-Type':'application/json'})
with urllib.request.urlopen(request,timeout=30) as response:
    result = json.load(response)
(work/(args.tag+'.decode-submission.json')).write_text(json.dumps(result,indent=2),encoding='utf-8')
print(json.dumps(result))
