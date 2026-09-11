"""Submit original male master-art candidates to the project's local ComfyUI.

All references, pose conditioning, prompts, receipts and generated PNGs stay in
the G: project. This creates candidate artwork, never a PSD or a Cubism model.
The OpenPose control is an authored joint guide, not character artwork.
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import shutil
import urllib.request
from PIL import Image, ImageDraw

PROJECT = Path(__file__).resolve().parents[2]
WORK = PROJECT / "work/live2d/male-master"
INPUT = PROJECT / "work/live2d/comfyui/input"
SIZE = (1024, 1536)
POSITIVE = (
    "1boy, solo, male focus, (mature adult man:1.3), 25 years old, defense attorney, "
    "character sprite, ace attorney, sharp angular face, masculine face, "
    "short black hair, subtle purple hair highlights, side part, purple eyes, "
    "(red blazer:1.4), red uniform jacket, small gold lapel pin, white collared shirt, "
    "dark blue necktie, black trousers, standing, cowboy shot, "
    "almost front view, slight three-quarter view, both eyes visible, "
    "broad shoulders, arms at sides, relaxed hands, calm neutral expression, closed mouth, "
    "(plain white background:1.8), simple background, isolated character, centered, "
    "clean black lineart, flat cel shading, flat colors, crisp edges, restrained shading, "
    "masterpiece, best quality, very aesthetic, highres"
)
NEGATIVE = (
    "worst quality, low quality, lowres, blurry, photo, photorealistic, 3d, "
    "painterly, watercolor, sketch, texture, noisy shading, chibi, child, boyish, ahoge, long hair, "
    "multiple people, 2boys, extra person, extra head, extra arms, extra hands, "
    "extra fingers, missing fingers, fused fingers, bad hands, bad anatomy, "
    "raised arms, hand on head, arm over head, crossed arms, bent elbow, "
    "cropped head, cropped hair, cropped hands, out of frame, close-up, "
    "angry, open mouth, shouting, teeth, looking back, profile, "
    "scenery, courtroom, paper, confetti, ribbons, frame, border, (abstract background:1.4), speed lines, aura, "
    "waistcoat, vest, blue jacket, purple jacket, school uniform, skinny, "
    "text, watermark, logo, signature, weapon, props"
)

def request(path, payload=None):
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    req = urllib.request.Request("http://127.0.0.1:8189" + path, data=data,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=45) as response:
        return json.load(response)

def prepare():
    if PROJECT.drive.upper() != "G:":
        raise ValueError("Production files must remain in the G: project")
    INPUT.mkdir(parents=True, exist_ok=True)
    WORK.mkdir(parents=True, exist_ok=True)
    for source, name in [
        ("design/art-output/male_char/tense.png", "male-identity.png"),
        ("design/art-output/raw/_ref_player_nowm.png", "male-style.png"),
    ]:
        shutil.copyfile(PROJECT / source, INPUT / name)
    # Standard OpenPose 18-body ordering, matching the installed auxiliary
    # package's open_pose/util.py draw_bodypose limb and RGB color convention.
    joints = [(520,330),(512,495),(300,515),(240,815),(235,1160),
              (724,515),(780,815),(785,1160),(400,1110),(405,1720),None,
              (625,1110),(620,1720),None,(485,308),(555,308),(442,330),(602,330)]
    limbs = [(2,3),(2,6),(3,4),(4,5),(6,7),(7,8),(2,9),(9,10),
             (10,11),(2,12),(12,13),(13,14),(2,1),(1,15),(15,17),(1,16),(16,18)]
    colors = [(255,0,0),(255,85,0),(255,170,0),(255,255,0),(170,255,0),
              (85,255,0),(0,255,0),(0,255,85),(0,255,170),(0,255,255),
              (0,170,255),(0,85,255),(0,0,255),(85,0,255),(170,0,255),
              (255,0,255),(255,0,170),(255,0,85)]
    pose = Image.new("RGB", SIZE, "black")
    draw = ImageDraw.Draw(pose)
    for (a,b), color in zip(limbs, colors):
        if joints[a-1] is not None and joints[b-1] is not None:
            draw.line([joints[a-1],joints[b-1]], fill=tuple(int(v*.6) for v in color), width=8)
    for joint, color in zip(joints, colors):
        if joint is not None:
            x,y = joint
            draw.ellipse((x-4,y-4,x+4,y+4), fill=color)
    pose.save(INPUT / "male-neutral-pose-v2.png")
    (WORK / "pose-guide.json").write_text(json.dumps({"canvas":SIZE,"joints":joints,
        "purpose":"authored neutral pose conditioning only; not a pixel-alignment guarantee"},indent=2),encoding="utf-8")

def workflow(seed, tag):
    return {
      "1":{"class_type":"CheckpointLoaderSimple","inputs":{"ckpt_name":"animagine-xl-3.1.safetensors"}},
      "2":{"class_type":"EmptyLatentImage","inputs":{"width":SIZE[0],"height":SIZE[1],"batch_size":1}},
      "3":{"class_type":"CLIPTextEncode","inputs":{"text":POSITIVE,"clip":["1",1]}},
      "4":{"class_type":"CLIPTextEncode","inputs":{"text":NEGATIVE,"clip":["1",1]}},
      "5":{"class_type":"IPAdapterUnifiedLoader","inputs":{"model":["1",0],"preset":"PLUS (high strength)"}},
      "6":{"class_type":"LoadImage","inputs":{"image":"male-identity.png"}},
      "7":{"class_type":"ImageCrop","inputs":{"image":["6",0],"width":780,"height":850,"x":90,"y":40}},
      "8":{"class_type":"IPAdapterAdvanced","inputs":{"model":["5",0],"ipadapter":["5",1],"image":["7",0],"weight":0.2,"weight_type":"linear","combine_embeds":"concat","start_at":0.0,"end_at":0.7,"embeds_scaling":"V only"}},
      "9":{"class_type":"LoadImage","inputs":{"image":"male-style.png"}},
      "10":{"class_type":"IPAdapterAdvanced","inputs":{"model":["8",0],"ipadapter":["5",1],"image":["9",0],"weight":0.25,"weight_type":"style transfer","combine_embeds":"concat","start_at":0.0,"end_at":0.9,"embeds_scaling":"V only"}},
      "11":{"class_type":"LoadImage","inputs":{"image":"male-neutral-pose-v2.png"}},
      "12":{"class_type":"ControlNetLoader","inputs":{"control_net_name":"controlnet-openpose-sdxl-1.0.safetensors"}},
      "13":{"class_type":"ControlNetApplyAdvanced","inputs":{"positive":["3",0],"negative":["4",0],"control_net":["12",0],"image":["11",0],"strength":1.0,"start_percent":0.0,"end_percent":0.85}},
      "14":{"class_type":"KSampler","inputs":{"model":["8",0],"positive":["13",0],"negative":["13",1],"latent_image":["2",0],"seed":seed,"steps":28,"cfg":6.5,"sampler_name":"euler_ancestral","scheduler":"normal","denoise":1.0}},
      "15":{"class_type":"SaveLatent","inputs":{"samples":["14",0],"filename_prefix":"male-master/"+tag}},
      "16":{"class_type":"VAEDecodeTiled","inputs":{"samples":["15",0],"vae":["18",0],"tile_size":512,"overlap":64,"temporal_size":64,"temporal_overlap":8}},
      "17":{"class_type":"SaveImage","inputs":{"images":["16",0],"filename_prefix":"male-master/"+tag}},
      "18":{"class_type":"VAELoader","inputs":{"vae_name":"animagine-standalone-vae.safetensors"}},
    }

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seed",type=int,default=2026090901)
    parser.add_argument("--tag",default="candidate-01")
    parser.add_argument("--prepare-only",action="store_true")
    args = parser.parse_args()
    if not args.tag.replace("-","").replace("_","").isalnum():
        raise ValueError("tag must be a simple filename component")
    prepare()
    graph = workflow(args.seed,args.tag)
    path = WORK / (args.tag+".prompt.json")
    path.write_text(json.dumps(graph,ensure_ascii=False,indent=2),encoding="utf-8")
    if args.prepare_only:
        print(json.dumps({"prepared":str(path)})); return
    stats = request("/system_stats")
    argv = stats.get("system",{}).get("argv",[])
    expected = str(PROJECT / "design/art-output/live2d-source")
    if "--output-directory" not in argv or Path(argv[argv.index("--output-directory")+1]).resolve() != Path(expected).resolve():
        raise ValueError("The local server must write art into this project's G: output directory")
    response = request("/prompt",{"prompt":graph,"client_id":"aidebate-male-master"})
    receipt = {"candidate":args.tag,"seed":args.seed,"prompt_file":str(path),"submission":response,
               "server":"http://127.0.0.1:8189","stage":"candidate artwork; visual inspection pending"}
    (WORK/(args.tag+".submission.json")).write_text(json.dumps(receipt,indent=2),encoding="utf-8")
    print(json.dumps(receipt,ensure_ascii=False))

if __name__ == "__main__":
    main()
