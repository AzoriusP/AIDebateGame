"""Download the three official Klein 4B workflow weights into the G: project.

Pin revisions, verify publisher LFS SHA-256, and preserve partial downloads.
Uses no Hugging Face client or user-profile cache.
"""
import concurrent.futures
import hashlib
import json
from pathlib import Path
import time
import urllib.request

PROJECT = Path(__file__).resolve().parents[2]
WORK = PROJECT/'work/live2d/male-master/acting-v2'
MODELS = PROJECT/'work/live2d/comfyui/models'
FOLDERS = ['diffusion_models','text_encoders','vae']


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(8*1024*1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def download(spec, folder):
    destination = MODELS/folder/Path(spec['file']).name
    if PROJECT.drive.upper() != 'G:' or not destination.resolve().is_relative_to(PROJECT):
        raise ValueError('Model destination must stay inside the G: project')
    destination.parent.mkdir(parents=True, exist_ok=True)
    expected = spec['metadata']['lfs']['sha256']
    size = spec['metadata']['size']
    url = 'https://huggingface.co/'+spec['repo']+'/resolve/'+spec['revision']+'/'+spec['file']
    if destination.exists():
        if destination.stat().st_size != size or sha256(destination) != expected:
            raise ValueError('Existing model does not match the official hash: '+destination.name)
    else:
        partial = destination.with_suffix('.safetensors.part')
        offset = partial.stat().st_size if partial.exists() else 0
        failures = 0
        while offset < size:
            # Short range requests avoid long-lived CDN connections stalling.
            end = min(size-1,offset+128*1024*1024-1)
            headers = {'User-Agent':'AIDebate-local-model-setup','Range':f'bytes={offset}-{end}'}
            try:
                segment_url = url+f'?download=true&segment={offset}-{end}'
                with urllib.request.urlopen(urllib.request.Request(segment_url,headers=headers),timeout=30) as response:
                    if response.status != 206 or not response.headers.get('Content-Range','').startswith('bytes '+str(offset)+'-'):
                        raise ValueError('Server did not honor the partial download offset')
                    with partial.open('ab' if offset else 'wb') as target:
                        while offset <= end:
                            chunk = response.read(min(8*1024*1024,end+1-offset))
                            if not chunk:
                                raise OSError('Range response ended early')
                            target.write(chunk)
                            offset += len(chunk)
                print(json.dumps({'file':destination.name,'downloaded':offset,'total':size}),flush=True)
            except (TimeoutError,OSError) as error:
                offset = partial.stat().st_size if partial.exists() else 0
                failures += 1
                print(json.dumps({'file':destination.name,'resume_at':offset,'retry':failures,'error':type(error).__name__}),flush=True)
                if failures >= 6:
                    raise
        if partial.stat().st_size != size or sha256(partial) != expected:
            raise ValueError('Download integrity check failed: '+destination.name)
        partial.rename(destination)
    print(json.dumps({'file':destination.name,'verified':True,'bytes':size}),flush=True)
    return {'path':str(destination),'bytes':size,'sha256':expected,'source':url,'verified':True}


def main():
    specs = json.loads((WORK/'klein-download-metadata.json').read_text(encoding='utf-8-sig'))
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        results = list(pool.map(download,specs,FOLDERS))
    (WORK/'klein-model-integrity.json').write_text(json.dumps(results,indent=2),encoding='utf-8')


if __name__ == '__main__':
    main()
