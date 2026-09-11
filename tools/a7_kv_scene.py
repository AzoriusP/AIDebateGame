"""A7 宣传 KV 底图生成：空的法庭对峙场景（16:9），供后续合成角色与标题。

思路：立绘质量够用，缺的是「氛围底图 + 标题处理」。
      底图生成空场景（不生成人物，避免角色不一致），人物用我们自己的立绘合成。

用法：
  python tools/a7_kv_scene.py                 # 生成 4 张候选
  python tools/a7_kv_scene.py --n 6 --seed 100
"""
import argparse
import json
import os
import shutil
import time
import urllib.request

COMFY = "http://127.0.0.1:8188"
OUT_DIR = r"G:/WBSpace/AIDebate/outputs/kv_scene"
COMFY_OUTPUT = r"G:/MiniMax-H3/ComfyUI_windows_portable/ComfyUI/output"
CKPT = "animagine-xl-3.1.safetensors"

# 沿用已验证的项目画风标签（thick paint / cel shading）
POS = ("empty courtroom interior, no people, dramatic spotlight from above, "
       "dark navy blue and gold color scheme, wooden judge bench, witness stand, "
       "tall classical columns, polished floor with reflection, "
       "cinematic wide angle, symmetrical composition, volumetric light beams, "
       "deep shadows, atmospheric, dramatic tension, "
       "thick paint, anime style, cel shading, flat color, bold outline, "
       "game key visual background, 16:9")
NEG = ("people, person, human, character, figure, silhouette, crowd, face, eyes, "
       "text, letters, watermark, signature, logo, lowres, blurry, jpeg artifacts, "
       "cute, chibi, kawaii, oversaturated, messy")

W, H = 1344, 768   # 16:9


def build(seed):
    return {
        "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": CKPT}},
        "5": {"class_type": "EmptyLatentImage",
              "inputs": {"width": W, "height": H, "batch_size": 1}},
        "6": {"class_type": "CLIPTextEncode", "inputs": {"text": POS, "clip": ["1", 1]}},
        "7": {"class_type": "CLIPTextEncode", "inputs": {"text": NEG, "clip": ["1", 1]}},
        "8": {"class_type": "KSampler",
              "inputs": {"model": ["1", 0], "positive": ["6", 0], "negative": ["7", 0],
                         "latent_image": ["5", 0], "seed": seed, "steps": 30, "cfg": 7.0,
                         "sampler_name": "euler_ancestral", "scheduler": "normal",
                         "denoise": 1.0}},
        "9": {"class_type": "VAEDecode", "inputs": {"samples": ["8", 0], "vae": ["1", 2]}},
        "10": {"class_type": "SaveImage",
               "inputs": {"images": ["9", 0], "filename_prefix": f"kvscene_{seed}"}},
    }


def post(url, payload):
    req = urllib.request.Request(url, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


def get(url):
    with urllib.request.urlopen(url, timeout=30) as r:
        return json.loads(r.read().decode())


def run(seed, timeout_s=300):
    res = post(f"{COMFY}/prompt", {"prompt": build(seed)})
    pid = res.get("prompt_id")
    if not pid:
        print(f"  [FAIL seed={seed}] {json.dumps(res, ensure_ascii=False)[:300]}")
        return None
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        time.sleep(3)
        hist = get(f"{COMFY}/history/{pid}")
        if pid in hist:
            e = hist[pid]
            if e.get("status", {}).get("status_str") == "error":
                print(f"  [ERROR seed={seed}] {json.dumps(e['status'], ensure_ascii=False)[:300]}")
                return None
            outs = e.get("outputs", {}).get("10", {}).get("images", [])
            if outs:
                src = os.path.join(COMFY_OUTPUT, outs[0].get("subfolder", ""), outs[0]["filename"])
                os.makedirs(OUT_DIR, exist_ok=True)
                dst = os.path.join(OUT_DIR, f"kv_scene_{seed}.png")
                shutil.copyfile(src, dst)
                print(f"  [ok] seed={seed} -> {dst}")
                return dst
    print(f"  [TIMEOUT seed={seed}]")
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=4)
    ap.add_argument("--seed", type=int, default=77001)
    a = ap.parse_args()
    for i in range(a.n):
        run(a.seed + i * 137)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
