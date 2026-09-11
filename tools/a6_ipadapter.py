"""A6 IPAdapter 方案：用 calm 原图做身份锚定，txt2img 生成同角色新表情。

与 A5（img2img 局部重绘）的本质区别：
  A5: 在原图上"改"→ 模型倾向重画成它熟悉的脸（动漫化/失真）
  A6: 从零"生成"，但用 IPAdapter 把身份锚定到 calm 原图
      → 风格由提示词控制（复用当初生成 NPC 的 thick paint/cel shading 标签）
      → 眼睛可以正常参与表情，不受 latent mask 限制

用法：
  python tools/a6_ipadapter.py --npc L1_A --emotion desperate
  python tools/a6_ipadapter.py --all
"""
import argparse
import json
import os
import shutil
import time
import urllib.request

COMFY = "http://127.0.0.1:8188"
OUT_DIR = r"G:/WBSpace/AIDebate/outputs/a6_ipadapter"
COMFY_OUTPUT = r"G:/MiniMax-H3/ComfyUI_windows_portable/ComfyUI/output"
CKPT = "animagine-xl-3.1.safetensors"

# 复用当初生成这批 NPC 立绘的风格标签（来自 design/art-output/raw 的文件名）
STYLE = ("thick paint, anime style, cel shading, flat color, bold outline, "
         "half body portrait, mature adult, dark blue background, "
         "detailed realistic face, consistent character identity")

EMOTIONS = {
    "tense":     "shaken expression, furrowed brows, tight pressed lips, uneasy eyes, nervous sweat drop",
    "anxious":   "alert wary expression, raised eyebrows, suspicious narrowed eyes, small cold sweat",
    "desperate": "defeated expression, open mouth, downturned eyebrows, wide shocked eyes, heavy sweat, despair",
}
NEG = ("lowres, bad anatomy, bad hands, extra fingers, watermark, signature, text, "
       "chibi, kawaii, moe, smooth plastic skin, deformed face, blurry, jpeg artifacts, "
       "different person, mismatched identity, multiple characters, red eyes, glowing eyes")

# IPAdapter 预设 / 权重（PLUS FACE 专为人像身份保持）
PRESET = "PLUS FACE (portraits)"
IP_WEIGHT = 0.85

STATE_LABEL = {"tense": "动摇", "anxious": "警觉", "desperate": "被说服"}


def build_workflow(npc, emotion, seed, steps=30, cfg=7.0):
    pos = f"{STYLE}, {EMOTIONS[emotion]}"
    return {
        "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": CKPT}},
        "2": {"class_type": "LoadImage", "inputs": {"image": f"{npc}_face_gray.png", "upload": "image"}},
        "3": {"class_type": "IPAdapterUnifiedLoader",
              "inputs": {"model": ["1", 0], "preset": PRESET}},
        "4": {"class_type": "IPAdapter",
              "inputs": {"model": ["3", 0], "ipadapter": ["3", 1], "image": ["2", 0],
                         "weight": IP_WEIGHT, "start_at": 0.0, "end_at": 1.0,
                         "weight_type": "standard"}},
        "5": {"class_type": "EmptyLatentImage",
              "inputs": {"width": 576, "height": 864, "batch_size": 1}},
        "6": {"class_type": "CLIPTextEncode", "inputs": {"text": pos, "clip": ["1", 1]}},
        "7": {"class_type": "CLIPTextEncode", "inputs": {"text": NEG, "clip": ["1", 1]}},
        "8": {"class_type": "KSampler",
              "inputs": {"model": ["4", 0], "positive": ["6", 0], "negative": ["7", 0],
                         "latent_image": ["5", 0], "seed": seed, "steps": steps, "cfg": cfg,
                         "sampler_name": "euler_ancestral", "scheduler": "normal",
                         "denoise": 1.0}},
        "9": {"class_type": "VAEDecode", "inputs": {"samples": ["8", 0], "vae": ["1", 2]}},
        "10": {"class_type": "SaveImage",
               "inputs": {"images": ["9", 0], "filename_prefix": f"a6_{npc}_{emotion}"}},
    }


def post(url, payload):
    req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def get(url):
    with urllib.request.urlopen(url, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def run_one(npc, emotion, seed, timeout_s=420):
    wf = build_workflow(npc, emotion, seed)
    res = post(f"{COMFY}/prompt", {"prompt": wf})
    pid = res.get("prompt_id")
    if not pid:
        print(f"  [FAIL] {json.dumps(res, ensure_ascii=False)[:400]}")
        return None
    print(f"  [queued] {npc}/{emotion} preset={PRESET} pid={pid[:8]}")
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        time.sleep(3)
        hist = get(f"{COMFY}/history/{pid}")
        if pid in hist:
            e = hist[pid]
            st = e.get("status", {})
            if st.get("status_str") == "error":
                print(f"  [ERROR] {json.dumps(st, ensure_ascii=False)[:500]}")
                return None
            outs = e.get("outputs", {}).get("10", {}).get("images", [])
            if outs:
                img = outs[0]
                src = os.path.join(COMFY_OUTPUT, img.get("subfolder", ""), img["filename"])
                os.makedirs(OUT_DIR, exist_ok=True)
                dst = os.path.join(OUT_DIR, f"{npc}_{emotion}.png")
                shutil.copyfile(src, dst)
                print(f"  [ok] {npc}/{emotion} ({STATE_LABEL.get(emotion,emotion)}) -> {dst}")
                return dst
    print(f"  [TIMEOUT] {npc}/{emotion}")
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--npc", default="L1_A")
    ap.add_argument("--emotion", default="desperate")
    ap.add_argument("--seed", type=int, default=20260910)
    ap.add_argument("--all", action="store_true")
    args = ap.parse_args()
    if args.all:
        for npc in ["L1_A", "L2_A", "L3_A", "L4_A", "L5_A"]:
            for emo in EMOTIONS:
                run_one(npc, emo, args.seed)
    else:
        run_one(args.npc, args.emotion, args.seed)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
