"""Author silhouette control masks for the reviewed Klein pose candidates.

Source RGB remains immutable. These masks extract full poses, not rig parts.
The explicit pocket seeds are specific to these exact source hashes/images.
"""
import hashlib
import argparse
import json
from pathlib import Path
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT/'work/live2d/male-master/acting-v2'
ART = ROOT/'design/art-output/live2d-source/male-master/acting-v2'
CASES = [('Neutral', 'klein-neutral-02', [(490, 960)]),
         ('Lean', 'klein-lean-02', [(460, 920), (870, 1020)]),
         ('Point', 'klein-point-04', [])]

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--left-hand', action='store_true', help='Use the user-corrected anatomical-left pointing source')
    args = parser.parse_args()
    cases = CASES if not args.left_hand else [*CASES[:2], ('Point', 'klein-point-left-01', [(410, 980)])]
    output = WORK/('silhouettes-left-hand' if args.left_hand else 'silhouettes')
    output.mkdir(parents=True, exist_ok=True)
    layers, reports = [], []
    for name, tag, pockets in cases:
        source = ART/(tag+'_00002_.png')
        before = hashlib.sha256(source.read_bytes()).hexdigest()
        rgb = np.asarray(Image.open(source).convert('RGB'), dtype=np.float32)
        h, w = rgb.shape[:2]
        left = ndi.gaussian_filter1d(np.median(rgb[:, :80], axis=1), 25, axis=0)
        right = ndi.gaussian_filter1d(np.median(rgb[:, -80:], axis=1), 25, axis=0)
        x = np.linspace(0, 1, w)[None, :, None]
        background = left[:, None, :]*(1-x)+right[:, None, :]*x
        distance = np.linalg.norm(rgb-background, axis=2)
        labels, _ = ndi.label(distance < 48)
        selected = set(np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]])))
        for sx, sy in pockets:
            if labels[sy, sx] == 0:
                raise ValueError(f'{name}: background pocket seed is not background')
            selected.add(int(labels[sy, sx]))
        selected.discard(0)
        foreground = ~np.isin(labels, list(selected))
        fg_labels, _ = ndi.label(foreground)
        sizes = np.bincount(fg_labels.ravel()); sizes[0] = 0
        foreground = fg_labels == int(np.argmax(sizes))
        alpha = ndi.gaussian_filter(foreground.astype(np.float32), .48)
        alpha[alpha < .015] = 0; alpha[alpha > .985] = 1
        mask = np.rint(alpha*255).astype(np.uint8)
        mask_path = output/(name+'.png')
        Image.fromarray(mask).save(mask_path)
        contour = ndi.binary_dilation(foreground)^ndi.binary_erosion(foreground)
        diagnostic = rgb*(.35+.65*alpha[..., None])
        diagnostic[contour] = [0, 255, 90]
        Image.fromarray(np.uint8(diagnostic)).save(output/(name+'.contour.png'))
        bbox = Image.fromarray(mask).getbbox()
        assert before == hashlib.sha256(source.read_bytes()).hexdigest()
        reports.append({'name':name, 'source_sha256':before, 'mask_sha256':hashlib.sha256(mask_path.read_bytes()).hexdigest(),
                        'bounds':bbox, 'source_rgb_changed':False, 'pocket_seeds':pockets, 'visual_review':'pending'})
        layers.append({'name':name, 'image':source.relative_to(ROOT).as_posix(),
                       'mask':mask_path.relative_to(ROOT).as_posix(), 'visible':name == 'Neutral'})
    manifest = 'pose-extraction-left-hand.json' if args.left_hand else 'pose-extraction.json'
    (WORK/manifest).write_text(json.dumps({'layers':layers}, indent=2), encoding='utf-8')
    (output/'audit.json').write_text(json.dumps(reports, indent=2), encoding='utf-8')
    print(json.dumps(reports))

if __name__ == '__main__':
    main()
