"""生产 1 个男性角色的 4 档表情（同 seed + 同 ControlNet pose = 骨架匹配）。
calm 兼作 base。IPAdapter 用单人参考图锁风格。
"""
import json, urllib.request, time, pathlib

COMFY = "http://127.0.0.1:8188"
OUT = pathlib.Path(r"G:\WBSpace\AIDebate\design\art-output\male_char")
OUT.mkdir(exist_ok=True)

BASE_POS = "ace attorney, solo, single person, young male defense attorney, half body portrait, upper body"
NEG = ("chibi, loli, shota, child, elderly, realistic photo, 3d render, multiple people, group, crowd, "
       "two people, many people, lowres, blurry, bad anatomy, extra fingers, missing fingers, "
       "watermark, text, signature, worst quality, low quality")

EXPR = {
    "calm": "calm composed neutral expression",
    "tense": "slightly tense worried expression, furrowed brows",
    "anxious": "anxious uneasy expression, nervous, sweat drop on face",
    "desperate": "desperate cornered expression, wide eyes, panicking",
}
SEED = 20260


def build_wf(ref, pos, seed):
    return {
        "4": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "animagine-xl-3.1.safetensors"}},
        "5": {"class_type": "EmptyLatentImage", "inputs": {"width": 1024, "height": 1536, "batch_size": 1}},
        "6": {"class_type": "CLIPTextEncode", "inputs": {"text": pos, "clip": ["4", 1]}},
        "7": {"class_type": "CLIPTextEncode", "inputs": {"text": NEG, "clip": ["4", 1]}},
        "11": {"class_type": "IPAdapterUnifiedLoader", "inputs": {"model": ["4", 0], "preset": "PLUS (high strength)"}},
        "13": {"class_type": "LoadImage", "inputs": {"image": ref}},
        "14": {"class_type": "IPAdapterAdvanced", "inputs": {"model": ["11", 0], "ipadapter": ["11", 1], "image": ["13", 0],
                "weight": 0.7, "weight_type": "linear", "combine_embeds": "concat", "start_at": 0.0, "end_at": 1.0, "embeds_scaling": "V only"}},
        "9": {"class_type": "LoadImage", "inputs": {"image": "pose_ref.png"}},
        "17": {"class_type": "DWPreprocessor", "inputs": {"image": ["9", 0], "detect_hand": "disable", "detect_body": "enable", "detect_face": "enable"}},
        "8": {"class_type": "ControlNetLoader", "inputs": {"control_net_name": "controlnet-openpose-sdxl-1.0.safetensors"}},
        "10": {"class_type": "ControlNetApplyAdvanced", "inputs": {"positive": ["6", 0], "negative": ["7", 0], "control_net": ["8", 0], "image": ["17", 0], "strength": 0.6, "start_percent": 0.0, "end_percent": 1.0}},
        "3": {"class_type": "KSampler", "inputs": {"model": ["14", 0], "positive": ["10", 0], "negative": ["10", 1], "latent_image": ["5", 0],
                "seed": seed, "steps": 30, "cfg": 6, "sampler_name": "euler_ancestral", "scheduler": "normal", "denoise": 1.0}},
        "15": {"class_type": "VAEDecode", "inputs": {"samples": ["3", 0], "vae": ["4", 2]}},
        "16": {"class_type": "SaveImage", "inputs": {"images": ["15", 0], "filename_prefix": "male_char"}},
    }


def run(tag, pos, seed):
    wf = build_wf("ref_01.png", pos, seed)
    req = urllib.request.Request(COMFY + "/prompt", data=json.dumps({"prompt": wf, "client_id": "ark"}).encode(),
                                 headers={"Content-Type": "application/json"})
    r = json.loads(urllib.request.urlopen(req, timeout=60).read())
    pid = r.get("prompt_id")
    for _ in range(80):
        time.sleep(4)
        h = json.loads(urllib.request.urlopen(COMFY + f"/history/{pid}", timeout=30).read())
        if pid in h and h[pid].get("status", {}).get("completed"):
            for node in h[pid]["outputs"].values():
                for img in node.get("images", []):
                    data = urllib.request.urlopen(COMFY + "/view?filename=" + img["filename"] + "&type=output", timeout=60).read()
                    (OUT / f"{tag}.png").write_bytes(data)
                    print(f"  {tag} -> OK ({len(data)//1024}KB)")
            return
        if pid in h and h[pid].get("status", {}).get("status_str") == "error":
            print(f"  {tag}: 错误 {str(h[pid].get('status',{}).get('messages',''))[:200]}")
            return
    print(f"  {tag}: 超时")


for tag, edesc in EXPR.items():
    print(f"[{tag}]")
    run(tag, f"{BASE_POS}, {edesc}", SEED)

print("男性角色 4 表情完成")
