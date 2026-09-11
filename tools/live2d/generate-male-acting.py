"""Generate separately controlled acting candidates with the existing G: ComfyUI.

The original stand-only generator remains reproducible. Pose guides are joint
conditioning, not character artwork or a guarantee of matching layer anchors.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import runpy
import shutil

from PIL import Image, ImageDraw, ImageOps

PROJECT = Path(__file__).resolve().parents[2]
WORK = PROJECT / 'work/live2d/male-master/acting-v2'
INPUT = PROJECT / 'work/live2d/comfyui/input'
OUTPUT = PROJECT / 'design/art-output/live2d-source'
SIZE = (1536, 1536)
DEFAULT_REFERENCE = 'design/art-output/live2d-source/male-master/candidate-03-hands_00002_.png'
BASE = (
    '1boy, solo, male focus, (mature adult man:1.2), 25 years old, defense attorney, '
    'character sprite, ace attorney, sharp angular face, masculine face, short black hair, '
    'subtle purple hair highlights, side part, purple eyes, '
    '(red blazer:1.4), red long-sleeved uniform jacket buttoned at the waist, single gold waist button, '
    'thin gold lapel trim, small gold breast badge, white collared shirt, dark blue necktie, dark navy trousers, '
    '(three-quarter view facing right:1.4), looking to the right, head turned right, '
    'waist-up, cowboy shot, '
    'natural adult proportions, full hair and both hands within frame, generous margins, '
    '(plain light gray background:1.6), simple background, isolated character, '
    'clean bold black contour lineart, angular flat cel shading, flat colors, crisp edges, '
    'restrained hard shadows, original courtroom game character, '
    'masterpiece, best quality, very aesthetic, highres, '
)
POSE_PROMPTS = {
    'neutral': 'standing upright, calm attentive expression, closed mouth, shoulders relaxed, both arms lowered at sides, hands visible beside hips, loosely clenched hands',
    'lean': 'leaning forward toward the right, tense questioning expression, furrowed brows, closed mouth, shoulders forward, both arms lowered with lightly clenched hands, no desk',
    'point': '(pointing to the right:1.5), (one arm fully extended sideways to the right:1.4), straight elbow, side view of pointing hand, index finger extended, other fingers curled, arm almost horizontal, shoulder turned forward, assertive serious expression, closed mouth, other arm lowered',
}
NEGATIVE = (
    'worst quality, low quality, lowres, blurry, photo, photorealistic, 3d, painterly, '
    'watercolor, sketch, texture, noisy shading, chibi, child, boyish, long hair, '
    'multiple people, 2boys, extra person, extra head, extra arms, extra hands, '
    'extra fingers, missing fingers, fused fingers, bad hands, bad anatomy, '
    'hand on head, arm over head, hands behind back, cropped head, cropped hair, cropped hands, out of frame, '
    '(looking at viewer:1.3), (pointing at viewer:1.5), giant foreground hand, extreme foreshortening, '
    '(close-up:1.5), portrait, face focus, giant head, multiple eyes, double face, '
    'front view, back view, looking left, scenery, courtroom, desk, table, paper, '
    'confetti, ribbons, frame, border, abstract background, speed lines, aura, '
    'blue jacket, purple jacket, school uniform, waistcoat, vest, long shirt, gray shirt, white trousers, '
    'skirt, coat tails, shoulder armor, skinny, smiling, text, watermark, logo, signature, weapon, props'
)
LIMBS = [(2,3),(2,6),(3,4),(4,5),(6,7),(7,8),(2,9),(9,10),
         (10,11),(2,12),(12,13),(13,14),(2,1),(1,15),(15,17),(1,16),(16,18)]
COLORS = [(255,0,0),(255,85,0),(255,170,0),(255,255,0),(170,255,0),
          (85,255,0),(0,255,0),(0,255,85),(0,255,170),(0,255,255),
          (0,170,255),(0,85,255),(0,0,255),(85,0,255),(170,0,255),
          (255,0,255),(255,0,170),(255,0,85)]


def joints_for(pose):
    joints = [(665,330),(585,490),(420,510),(375,810),(380,1165),
              (690,515),(730,825),(740,1180),(455,1120),(460,1700),None,
              (645,1120),(650,1700),None,(610,302),(650,304),(560,320),None]
    if pose == 'point':
        joints[5:8] = [(670,500),(975,440),(1235,375)]
    elif pose == 'lean':
        for index in [0,1,2,5,14,15,16]:
            x, y = joints[index]
            joints[index] = (x+95, y+85)
        joints[3:5] = [(445,900),(455,1205)]
        joints[6:8] = [(825,900),(840,1220)]
    return joints


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pose', choices=POSE_PROMPTS, required=True)
    parser.add_argument('--tag', required=True)
    parser.add_argument('--seed', type=int, default=2026091001)
    parser.add_argument('--reference', default=DEFAULT_REFERENCE)
    parser.add_argument('--face-crop', type=int, nargs=4, default=[300,48,448,448], metavar=('X','Y','W','H'))
    parser.add_argument('--identity-weight', type=float, default=.6)
    parser.add_argument('--style-weight', type=float, default=.3)
    parser.add_argument('--control-strength', type=float, default=1.0)
    parser.add_argument('--size', type=int, choices=[1024,1536], default=1536)
    parser.add_argument('--pose-guide', help='Project pose-conditioning PNG, with body/hand landmarks only')
    parser.add_argument('--prepare-only', action='store_true')
    args = parser.parse_args()
    if PROJECT.drive.upper() != 'G:' or not args.tag.replace('-','').replace('_','').isalnum():
        raise ValueError('Use the G: project and a simple tag')
    reference = (PROJECT / args.reference).resolve()
    if not reference.is_relative_to(PROJECT):
        raise ValueError('Reference must be in this project')
    x,y,w,h = args.face_crop
    with Image.open(reference) as source:
        if min(x,y) < 0 or min(w,h) < 1 or x+w > source.width or y+h > source.height:
            raise ValueError('Face crop is outside the reference')
    if not all(0 <= v <= 2 for v in (args.identity_weight,args.style_weight,args.control_strength)):
        raise ValueError('Conditioning weights must be between 0 and 2')
    WORK.mkdir(parents=True, exist_ok=True)
    INPUT.mkdir(parents=True, exist_ok=True)
    record_path = WORK / (args.tag+'.json')
    if record_path.exists():
        raise ValueError('Use a new tag; existing production records are preserved')
    source_name = 'acting-v2-'+args.tag+'-identity.png'
    pose_name = 'acting-v2-'+args.tag+'-pose.png'
    shutil.copyfile(reference, INPUT/source_name)
    joints = [None if joint is None else tuple(round(v*args.size/SIZE[0]) for v in joint)
              for joint in joints_for(args.pose)]
    canvas = (args.size,args.size)
    pose_image = Image.new('RGB', canvas, 'black')
    draw = ImageDraw.Draw(pose_image)
    for (a,b), color in zip(LIMBS, COLORS):
        if joints[a-1] is not None and joints[b-1] is not None:
            draw.line([joints[a-1],joints[b-1]], fill=tuple(int(v*.6) for v in color), width=8)
    for joint, color in zip(joints, COLORS):
        if joint is not None:
            jx,jy = joint
            draw.ellipse((jx-4,jy-4,jx+4,jy+4), fill=color)
    external_guide = None
    if args.pose_guide:
        external_guide = (PROJECT/args.pose_guide).resolve()
        if not external_guide.is_relative_to(PROJECT):
            raise ValueError('Pose guide must be in this project')
        with Image.open(external_guide) as control_image:
            fitted = ImageOps.contain(control_image.convert('RGB'), (args.size,round(args.size*.8)), Image.Resampling.NEAREST)
        pose_image = Image.new('RGB', canvas, 'black')
        pose_image.paste(fitted, ((args.size-fitted.width)//2,round(args.size*.13)))
        joints = None
    pose_image.save(INPUT/pose_name)
    legacy = runpy.run_path(str(PROJECT/'tools/live2d/generate-male-master.py'))
    graph = legacy['workflow'](args.seed,args.tag)
    graph['2']['inputs'].update(width=canvas[0],height=canvas[1])
    graph['3']['inputs']['text'] = BASE+POSE_PROMPTS[args.pose]
    graph['4']['inputs']['text'] = NEGATIVE
    graph['6']['inputs']['image'] = source_name
    graph['7']['inputs'].update(x=x,y=y,width=w,height=h)
    graph['8']['inputs'].update(weight=args.identity_weight,end_at=.8)
    graph['9']['inputs']['image'] = source_name
    graph['10']['inputs'].update(weight=args.style_weight,end_at=.9)
    graph['11']['inputs']['image'] = pose_name
    graph['13']['inputs'].update(strength=args.control_strength)
    graph['14']['inputs']['model'] = ['10',0]
    for node in ['15','17']:
        graph[node]['inputs']['filename_prefix'] = 'male-master/acting-v2/'+args.tag
    record = {'stage':'candidate only; visual review required', 'pose':args.pose,
              'reference':str(reference),'reference_sha256':hashlib.sha256(reference.read_bytes()).hexdigest(),
              'face_crop':args.face_crop,'canvas':canvas,'joint_guide':joints,
              'external_pose_guide':str(external_guide) if external_guide else None,
              'pose_sha256':hashlib.sha256((INPUT/pose_name).read_bytes()).hexdigest(),
              'settings':vars(args),'prompt':graph}
    record_path.write_text(json.dumps(record,ensure_ascii=False,indent=2),encoding='utf-8')
    if not args.prepare_only:
        request = legacy['request']
        argv = request('/system_stats')['system']['argv']
        if '--output-directory' not in argv or Path(argv[argv.index('--output-directory')+1]).resolve() != OUTPUT.resolve():
            raise ValueError('Expected G: project-isolated ComfyUI output')
        record['submission'] = request('/prompt', {'prompt':graph,'client_id':'aidebate-acting-v2'})
        record_path.write_text(json.dumps(record,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'record':str(record_path),'submission':record.get('submission')},ensure_ascii=False))


if __name__ == '__main__':
    main()
