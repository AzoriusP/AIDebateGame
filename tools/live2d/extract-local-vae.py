"""Extract the existing checkpoint's VAE for a small independent decode job.

No weights are downloaded or changed. Cloned tensors have independent storage;
the source checkpoint is closed before the standalone file is written.
"""
import hashlib
import json
from pathlib import Path
from safetensors import safe_open
from safetensors.torch import save_file

project = Path(__file__).resolve().parents[2]
source = Path('G:/MiniMax-H3/models/checkpoints/animagine-xl-3.1.safetensors')
output = project / 'work/live2d/comfyui/models/vae/animagine-standalone-vae.safetensors'
if project.drive.upper() != 'G:':
    raise RuntimeError('This task must stay on G:')
output.parent.mkdir(parents=True, exist_ok=True)
prefix = 'first_stage_model.'
with safe_open(source, framework='pt', device='cpu') as archive:
    weights = {key[len(prefix):]:archive.get_tensor(key).clone().contiguous()
               for key in archive.keys() if key.startswith(prefix)}
if not weights or 'decoder.conv_out.weight' not in weights:
    raise RuntimeError('Expected the original SDXL VAE tensors')
save_file(weights, str(output), metadata={'source':str(source),'operation':'exact tensor extraction; unchanged values'})
receipt = {'source':str(source),'output':str(output),'tensors':len(weights),
           'bytes':output.stat().st_size,'sha256':hashlib.sha256(output.read_bytes()).hexdigest()}
(output.parent/'extraction.json').write_text(json.dumps(receipt,indent=2),encoding='utf-8')
print(json.dumps(receipt))
