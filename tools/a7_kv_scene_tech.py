"""A7b 科技风 KV 场景底图：贴合游戏 UI 的「冰蓝科幻」主题（浅底 + 青色 + 网格）。

游戏实装 UI 色：--bg-deep #d9f1f7（浅冰蓝）、青色强调、网格底纹。
本脚本生成与之同族的空场景（不含人物，人物后置抠图合成）。

用法：
  python tools/a7_kv_scene_tech.py --style light --n 3
  python tools/a7_kv_scene_tech.py --style dark  --n 3
"""
import argparse
import json
import os
import shutil
import time
import urllib.request

COMFY = "http://127.0.0.1:8188"
COMFY_OUTPUT = r"G:/MiniMax-H3/ComfyUI_windows_portable/ComfyUI/output"
OUT_ROOT = r"G:/WBSpace/AIDebate/outputs/kv_scene_tech"
CKPT = "animagine-xl-3.1.safetensors"
W, H = 1344, 768

STYLES = {
    # 贴合游戏实装的浅冰蓝科幻
    "light": (
        "bright futuristic courtroom interior, empty room no people, "
        "light icy blue and white color scheme, glass and chrome surfaces, "
        "cyan glowing accent lines, holographic translucent panels, "
        "clean tech grid floor with soft reflections, minimal sci-fi architecture, "
        "tall glass columns, airy bright atmosphere, volumetric light beams, "
        "symmetrical composition, wide shot, "
        "thick paint, anime style, cel shading, bold outline, flat color, "
        "game key visual background, clean high key lighting"),
    # 深色科技风变体
    "dark": (
        "futuristic courtroom interior at night, empty room no people, "
        "deep navy background with cyan neon holographic displays, "
        "glowing tech grid floor, glass panels, rim lighting, "
        "sci-fi minimal architecture, dramatic atmosphere, "
        "symmetrical composition, wide shot, "
        "thick paint, anime style, cel shading, bold outline, flat color, "
        "game key visual background"),
}
NEG = ("people, person, human, character, figure, silhouette, crowd, face, eyes, hands, "
       "text, letters, word, watermark, signature, logo, "
       "lowres, blurry, jpeg artifacts, messy, cluttered, oversaturated")


def build(style, seed):
    return {
        "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": CKPT}},
        "5": {"class_type": "EmptyLatentImage", "inputs": {"width": W, "height": H, "batch_size": 1}},
        "6": {"class_type": "CLIPTextEncode", "inputs": {"text": STYLES[style], "clip": ["1", 1]}},
        "7": {"class_type": "CLIPTextEncode", "inputs": {"text": NEG, "clip": ["1", 1]}},
        "8": {"class_type": "KSampler",
              "inputs": {"model": ["1", 0], "positive": ["6", 0], "negative": ["7", 0],
                         "latent_image": ["5", 0], "seed": seed, "steps": 32, "cfg": 7.5,
                         "sampler_name": "euler_ancestral", "scheduler": "normal", "denoise": 1.0}},
        "9": {"class_type": "VAEDecode", "inputs": {"samples": ["8", 0], "vae": ["1", 2]}},
        "10": {"class_type": "SaveImage",
               "inputs": {"images": ["9", 0], "filename_prefix": f"kvtech_{style}_{seed}"}},
    }


def post(url, payload):
    req = urllib.request.Request(url, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


def get(url):
    with urllib.request.urlopen(url, timeout=30) as r:
        return json.loads(r.read().decode())


def run(style, seed, timeout_s=300):
    res = post(f"{COMFY}/prompt", {"prompt": build(style, seed)})
    pid = res.get("prompt_id")
    if not pid:
        print(f"  [FAIL] {json.dumps(res, ensure_ascii=False)[:280]}")
        return None
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        time.sleep(3)
        hist = get(f"{COMFY}/history/{pid}")
        if pid in hist:
            e = hist[pid]
            if e.get("status", {}).get("status_str") == "error":
                print(f"  [ERROR] {json.dumps(e['status'], ensure_ascii=False)[:280]}")
                return None
            outs = e.get("outputs", {}).get("10", {}).get("images", [])
            if outs:
                src = os.path.join(COMFY_OUTPUT, outs[0].get("subfolder", ""), outs[0]["filename"])
                d = os.path.join(OUT_ROOT, style)
                os.makedirs(d, exist_ok=True)
                dst = os.path.join(d, f"{style}_{seed}.png")
                shutil.copyfile(src, dst)
                print(f"  [ok] {style} seed={seed} -> {dst}")
                return dst
    print(f"  [TIMEOUT] {style} {seed}")
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--style", default="light", choices=list(STYLES))
    ap.add_argument("--n", type=int, default=3)
    ap.add_argument("--seed", type=int, default=91001)
    a = ap.parse_args()
    for i in range(a.n):
        run(a.style, a.seed + i * 211)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
