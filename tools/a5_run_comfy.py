"""A5 NPC 情绪图生成：ComfyUI API 局部重绘（只改脸，保身份与画风）。

原理：
  calm 立绘 → VAEEncodeForInpaint(脸部 mask) → KSampler(low denoise) → 新表情图
  低 denoise + 脸部 mask = 保留构图/画风/服装，只替换表情。

用法：
  python tools/a5_run_comfy.py                 # 跑一张 L1_A tense 测试
  python tools/a5_run_comfy.py --all           # 跑全部 5 NPC x 3 情绪
  python tools/a5_run_comfy.py --npc L3_A --emotion anxious --denoise 0.45

输出：
  G:/WBSpace/AIDebate/outputs/a5_emotions/{npc}_{emotion}.png
"""
import argparse
import json
import os
import shutil
import time
import urllib.request

COMFY = "http://127.0.0.1:8188"
OUT_DIR = r"G:/WBSpace/AIDebate/outputs/a5_emotions"
COMFY_OUTPUT = r"G:/MiniMax-H3/ComfyUI_windows_portable/ComfyUI/output"
CKPT = "animagine-xl-3.1.safetensors"

# 情绪 → (英文提示词片段, 中文标签)
EMOTIONS = {
    "tense":     ("shaken, furrowed brows, tight pressed lips, uneasy gaze, nervous sweat drop, defensive", "动摇"),
    "anxious":   ("alert wide eyes, raised eyebrows, wary suspicious look, small cold sweat, tense jaw", "警觉"),
    "desperate": ("defeated expression, open mouth, downturned eyebrows, wide shocked eyes, heavy sweat, despair", "被说服"),
}

STYLE = ("thick bold outline, cel shading, flat color, detailed realistic face, "
         "natural human facial proportions, sharp chin, defined jawline, mature adult")
NEG = ("lowres, bad anatomy, bad hands, extra fingers, watermark, signature, text, "
       "anime, cartoon, chibi, kawaii, cute, moe, smooth plastic skin, "
       "big anime eyes, deformed face, blurry, jpeg artifacts, "
       "red eyes, glowing eyes, heterochromia, colored sclera, "
       "distorted eyes, mismatched pupils, extra pupils, warped mouth, "
       "deformed mouth, exaggerated expression, grotesque, monster, zombie")


def build_workflow(npc, emotion, denoise, seed, steps=28, cfg=6.5, mode="masked"):
    """mode=masked  ：SetLatentNoiseMask 局部重绘 + ImageCompositeMasked 贴回原图
                     → 非脸部像素 100% 保留原图，一致性最好（推荐）
       mode=img2img ：全图低 denoise 微调（会整体降质，仅备选）
       mode=inpaint ：VAEEncodeForInpaint（已知会色彩污染，保留仅作对照）"""
    pos = f"{STYLE}, {EMOTIONS[emotion][0]}"
    wf = {
        "1": {"class_type": "CheckpointLoaderSimple",
              "inputs": {"ckpt_name": CKPT}},
        "2": {"class_type": "LoadImage",
              "inputs": {"image": f"{npc}_calm.png", "upload": "image"}},
        "6": {"class_type": "CLIPTextEncode",
              "inputs": {"text": pos, "clip": ["1", 1]}},
        "7": {"class_type": "CLIPTextEncode",
              "inputs": {"text": NEG, "clip": ["1", 1]}},
    }

    if mode == "masked":
        wf["3"] = {"class_type": "LoadImage",
                   "inputs": {"image": f"face_maskv2_{npc}.png", "upload": "image"}}
        wf["4"] = {"class_type": "ImageToMask",
                   "inputs": {"image": ["3", 0], "channel": "red"}}
        wf["5"] = {"class_type": "VAEEncode",
                   "inputs": {"pixels": ["2", 0], "vae": ["1", 2]}}
        wf["5b"] = {"class_type": "SetLatentNoiseMask",
                    "inputs": {"samples": ["5", 0], "mask": ["4", 0]}}
        latent = ["5b", 0]
    elif mode == "inpaint":
        wf["3"] = {"class_type": "LoadImage",
                   "inputs": {"image": f"face_maskv2_{npc}.png", "upload": "image"}}
        wf["4"] = {"class_type": "ImageToMask",
                   "inputs": {"image": ["3", 0], "channel": "red"}}
        wf["5"] = {"class_type": "VAEEncodeForInpaint",
                   "inputs": {"pixels": ["2", 0], "vae": ["1", 2],
                              "mask": ["4", 0], "grow_mask_by": 8}}
        latent = ["5", 0]
    else:
        wf["5"] = {"class_type": "VAEEncode",
                   "inputs": {"pixels": ["2", 0], "vae": ["1", 2]}}
        latent = ["5", 0]

    wf["8"] = {"class_type": "KSampler",
               "inputs": {"model": ["1", 0], "positive": ["6", 0], "negative": ["7", 0],
                          "latent_image": latent, "seed": seed, "steps": steps,
                          "cfg": cfg, "sampler_name": "euler_ancestral",
                          "scheduler": "normal", "denoise": denoise}}
    wf["9"] = {"class_type": "VAEDecode",
               "inputs": {"samples": ["8", 0], "vae": ["1", 2]}}

    if mode == "masked":
        # 关键：把重绘结果按 mask 贴回【原图】，非脸部像素保持原始精度
        wf["11"] = {"class_type": "ImageCompositeMasked",
                    "inputs": {"destination": ["2", 0], "source": ["9", 0],
                               "x": 0, "y": 0, "resize_source": False,
                               "mask": ["4", 0]}}
        wf["10"] = {"class_type": "SaveImage",
                    "inputs": {"images": ["11", 0],
                               "filename_prefix": f"a5_{npc}_{emotion}"}}
    else:
        wf["10"] = {"class_type": "SaveImage",
                    "inputs": {"images": ["9", 0],
                               "filename_prefix": f"a5_{npc}_{emotion}"}}
    return wf


def post(url, payload):
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def get(url):
    with urllib.request.urlopen(url, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def run_one(npc, emotion, denoise, seed, mode="img2img", timeout_s=300):
    wf = build_workflow(npc, emotion, denoise, seed, mode=mode)
    res = post(f"{COMFY}/prompt", {"prompt": wf})
    pid = res.get("prompt_id")
    if not pid:
        print(f"  [FAIL] 提交失败: {json.dumps(res, ensure_ascii=False)[:300]}")
        return None
    print(f"  [queued] {npc}/{emotion} mode={mode} prompt_id={pid[:8]} denoise={denoise}")
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        time.sleep(3)
        hist = get(f"{COMFY}/history/{pid}")
        if pid in hist:
            entry = hist[pid]
            status = entry.get("status", {})
            if status.get("status_str") == "error":
                print(f"  [ERROR] {json.dumps(status, ensure_ascii=False)[:400]}")
                return None
            outs = entry.get("outputs", {}).get("10", {}).get("images", [])
            if outs:
                img = outs[0]
                src = os.path.join(COMFY_OUTPUT, img.get("subfolder", ""), img["filename"])
                os.makedirs(OUT_DIR, exist_ok=True)
                dst = os.path.join(OUT_DIR, f"{npc}_{emotion}_{mode}.png")
                shutil.copyfile(src, dst)
                print(f"  [ok] {npc}/{emotion} ({EMOTIONS[emotion][1]}) -> {dst}")
                return dst
    print(f"  [TIMEOUT] {npc}/{emotion}")
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--npc", default="L1_A")
    ap.add_argument("--emotion", default="tense")
    ap.add_argument("--denoise", type=float, default=0.6)
    ap.add_argument("--seed", type=int, default=20260910)
    ap.add_argument("--mode", default="masked", choices=["masked", "img2img", "inpaint"])
    ap.add_argument("--all", action="store_true")
    args = ap.parse_args()

    npcs = ["L1_A", "L2_A", "L3_A", "L4_A", "L5_A"]
    if args.all:
        for npc in npcs:
            for emo in EMOTIONS:
                run_one(npc, emo, args.denoise, args.seed, args.mode)
    else:
        run_one(args.npc, args.emotion, args.denoise, args.seed, args.mode)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
