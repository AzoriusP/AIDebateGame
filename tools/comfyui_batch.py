"""ComfyUI 角色立绘批量生成脚本（SDXL + ControlNet openpose + IPAdapter）。
用法: python tools/comfyui_batch.py [模式]
依赖: 无第三方库（标准库 urllib），ComfyUI 需已启动于 127.0.0.1:8188
"""
import json, time, urllib.request, urllib.parse, pathlib, sys, os

COMFY = "http://127.0.0.1:8188"
OUT = pathlib.Path(__file__).resolve().parents[1] / "design" / "art-output" / "comfyui"
POSE_IMAGE = "pose_ref.png"     # 构图参考图（openpose 用），放 ComfyUI input/ 目录
FACE_IMAGE = "face_ref.png"     # 基准脸参考图（IPAdapter 用），放 ComfyUI input/ 目录

# ---------------- 提示词模板 ----------------
STYLE = ("ace attorney style, thick bold outline, cel shading, flat color, "
         "dramatic expression, half body portrait, clean background, "
         "sharp chin, defined jawline, confident stance, upper body")
NEGATIVE = ("lowres, bad anatomy, bad hands, extra fingers, missing fingers, "
            "watermark, text, signature, blurry, jpeg artifacts, worst quality, "
            "low quality, extra limb, deformed, ugly, cropped, (moe:1.2), (cute:1.2)")

CHARACTERS = {
    "player_male": "young Chinese man, neat short black hair, white shirt, neutral capable look",
    "player_female": "young Chinese woman, neat hair, business casual, neutral capable look",
}

EXPRESSIONS = {   # 玩家 4 档
    "calm": "calm composed neutral expression",
    "tense": "slightly tense worried expression, furrowed brows",
    "anxious": "anxious uneasy expression, sweat drop, nervous",
    "desperate": "desperate cornered expression, wide eyes, panicking",
}

HAIR_STYLES = {
    "hairA": "neat short black hair",
    "hairB": "short side-parted hair",
    "hairC": "slightly long layered hair",
}

OUTFITS = {
    "outfitA": "white shirt and dark trousers",
    "outfitB": "dark blazer over shirt",
    "outfitC": "casual jacket and shirt",
}


def _api(path, data=None, method="GET"):
    url = COMFY + path
    if data is not None:
        req = urllib.request.Request(url, data=json.dumps(data).encode(),
                                     headers={"Content-Type": "application/json"})
    else:
        req = urllib.request.Request(url)
    return json.loads(urllib.request.urlopen(req, timeout=60).read())


def build_workflow(positive, negative, seed=12345, steps=28, cfg=6.5):
    """SDXL + ControlNet(openpose) + IPAdapter 工作流（API 格式）。"""
    return {
        "4": {"class_type": "CheckpointLoaderSimple",
              "inputs": {"ckpt_name": "animagine-xl-3.1.safetensors"}},
        "5": {"class_type": "EmptyLatentImage",
              "inputs": {"width": 1024, "height": 1536, "batch_size": 1}},
        "6": {"class_type": "CLIPTextEncode", "inputs": {"text": positive, "clip": ["4", 1]}},
        "7": {"class_type": "CLIPTextEncode", "inputs": {"text": negative, "clip": ["4", 1]}},
        # ControlNet openpose
        "8": {"class_type": "ControlNetLoader",
              "inputs": {"control_net_name": "controlnet-openpose-sdxl-1.0.safetensors"}},
        "9": {"class_type": "LoadImage", "inputs": {"image": POSE_IMAGE}},
        "10": {"class_type": "ControlNetApplyAdvanced",
               "inputs": {"positive": ["6", 0], "negative": ["7", 0],
                          "control_net": ["8", 0], "image": ["9", 0],
                          "strength": 0.8, "start_percent": 0.0, "end_percent": 1.0}},
        # IPAdapter
        "11": {"class_type": "IPAdapterModelLoader",
               "inputs": {"ipadapter_file": "ip-adapter-plus_sdxl_vit-h.safetensors"}},
        "12": {"class_type": "CLIPVisionLoader", "inputs": {"clip_name": "model.safetensors"}},
        "13": {"class_type": "LoadImage", "inputs": {"image": FACE_IMAGE}},
        "14": {"class_type": "IPAdapterAdvanced",
               "inputs": {"model": ["4", 0], "ipadapter": ["11", 0],
                          "image": ["13", 0], "weight": 0.7, "start_at": 0.0,
                          "end_at": 1.0, "weight_type": "linear"}},
        "3": {"class_type": "KSampler",
              "inputs": {"model": ["14", 0], "positive": ["10", 0], "negative": ["10", 1],
                         "latent_image": ["5", 0], "seed": seed, "steps": steps,
                         "cfg": cfg, "sampler_name": "euler_ancestral",
                         "scheduler": "normal", "denoise": 1.0}},
        "15": {"class_type": "VAEDecode", "inputs": {"samples": ["3", 0], "vae": ["4", 2]}},
        "16": {"class_type": "SaveImage",
               "inputs": {"images": ["15", 0], "filename_prefix": "portrait"}},
    }


def run(positive, negative, seed, tag):
    """提交工作流并阻塞等待结果，下载第一张图。"""
    wf = build_workflow(positive, negative, seed)
    r = _api("/prompt", {"prompt": wf, "client_id": "ark-batch"})
    pid = r["prompt_id"]
    # 轮询 history
    for _ in range(240):
        time.sleep(3)
        h = _api(f"/history/{pid}")
        if pid in h:
            outs = h[pid].get("outputs", {})
            for node in outs.values():
                for img in node.get("images", []):
                    fn = img["filename"]
                    sub = img.get("subfolder", "")
                    data = urllib.request.urlopen(COMFY + "/view?" + urllib.parse.urlencode(
                        {"filename": fn, "subfolder": sub, "type": "output"}), timeout=60).read()
                    OUT.mkdir(parents=True, exist_ok=True)
                    dst = OUT / f"{tag}.png"
                    dst.write_bytes(data)
                    print(f"  ✓ {tag} -> {dst}")
                    return
    print(f"  ✗ 超时: {tag}")


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "base"
    seed = 12345
    OUT.mkdir(parents=True, exist_ok=True)
    if mode == "base":
        for cid, cdesc in CHARACTERS.items():
            run(f"{STYLE}, {cdesc}", NEGATIVE, seed, f"base_{cid}")
    elif mode == "expressions":
        cid = "player_male"
        for st, edesc in EXPRESSIONS.items():
            run(f"{STYLE}, {CHARACTERS[cid]}, {edesc}", NEGATIVE, seed, f"{cid}_{st}")
    elif mode == "hair":
        cid = "player_male"
        for hid, hdesc in HAIR_STYLES.items():
            run(f"{STYLE}, {CHARACTERS[cid]}, {hdesc}, hair wig only", NEGATIVE, seed, f"{cid}_{hid}")
    elif mode == "outfit":
        cid = "player_male"
        for oid, odesc in OUTFITS.items():
            run(f"{STYLE}, {CHARACTERS[cid]}, {odesc}, outfit only", NEGATIVE, seed, f"{cid}_{oid}")
    else:
        print("用法: base | expressions | hair | outfit")


if __name__ == "__main__":
    main()
