"""用 6 张拆出的单人图做 IPAdapter 参考，分别重出干净单人立绘。"""
import json, urllib.request, urllib.error, time, pathlib

COMFY = "http://127.0.0.1:8188"
OUT = pathlib.Path(r"G:\WBSpace\AIDebate\design\art-output\regenerated")
OUT.mkdir(exist_ok=True)

POS = "ace attorney, solo, single character, half body portrait, upper body"
NEG = ("chibi, loli, shota, child, elderly, realistic photo, 3d render, multiple people, "
       "group, crowd, two people, many people, lowres, blurry, bad anatomy, extra fingers, "
       "missing fingers, watermark, text, signature, worst quality, low quality")


def build_wf(ref_img, seed):
    return {
        "4": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "animagine-xl-3.1.safetensors"}},
        "5": {"class_type": "EmptyLatentImage", "inputs": {"width": 1024, "height": 1536, "batch_size": 1}},
        "6": {"class_type": "CLIPTextEncode", "inputs": {"text": POS, "clip": ["4", 1]}},
        "7": {"class_type": "CLIPTextEncode", "inputs": {"text": NEG, "clip": ["4", 1]}},
        "11": {"class_type": "IPAdapterUnifiedLoader", "inputs": {"model": ["4", 0], "preset": "PLUS (high strength)"}},
        "13": {"class_type": "LoadImage", "inputs": {"image": ref_img}},
        "14": {"class_type": "IPAdapterAdvanced", "inputs": {"model": ["11", 0], "ipadapter": ["11", 1], "image": ["13", 0],
                "weight": 0.7, "weight_type": "linear", "combine_embeds": "concat", "start_at": 0.0, "end_at": 1.0, "embeds_scaling": "V only"}},
        "9": {"class_type": "LoadImage", "inputs": {"image": "pose_ref.png"}},
        "17": {"class_type": "DWPreprocessor", "inputs": {"image": ["9", 0], "detect_hand": "disable", "detect_body": "enable", "detect_face": "enable"}},
        "8": {"class_type": "ControlNetLoader", "inputs": {"control_net_name": "controlnet-openpose-sdxl-1.0.safetensors"}},
        "10": {"class_type": "ControlNetApplyAdvanced", "inputs": {"positive": ["6", 0], "negative": ["7", 0], "control_net": ["8", 0], "image": ["17", 0], "strength": 0.6, "start_percent": 0.0, "end_percent": 1.0}},
        "3": {"class_type": "KSampler", "inputs": {"model": ["14", 0], "positive": ["10", 0], "negative": ["10", 1], "latent_image": ["5", 0],
                "seed": seed, "steps": 30, "cfg": 6, "sampler_name": "euler_ancestral", "scheduler": "normal", "denoise": 1.0}},
        "15": {"class_type": "VAEDecode", "inputs": {"samples": ["3", 0], "vae": ["4", 2]}},
        "16": {"class_type": "SaveImage", "inputs": {"images": ["15", 0], "filename_prefix": f"reg_{ref_img.split('.')[0]}"}},
    }


def run(ref_img, seed):
    wf = build_wf(ref_img, seed)
    req = urllib.request.Request(COMFY + "/prompt", data=json.dumps({"prompt": wf, "client_id": "ark"}).encode(),
                                 headers={"Content-Type": "application/json"})
    r = json.loads(urllib.request.urlopen(req, timeout=60).read())
    pid = r.get("prompt_id")
    if r.get("node_errors"):
        print(f"  {ref_img}: 节点错误 {r['node_errors']}")
        return
    for _ in range(80):
        time.sleep(4)
        h = json.loads(urllib.request.urlopen(COMFY + f"/history/{pid}", timeout=30).read())
        if pid in h and h[pid].get("status", {}).get("completed"):
            for node in h[pid]["outputs"].values():
                for img in node.get("images", []):
                    fn = img["filename"]
                    data = urllib.request.urlopen(COMFY + "/view?filename=" + fn + "&type=output", timeout=60).read()
                    dst = OUT / f"{ref_img.split('.')[0]}.png"
                    dst.write_bytes(data)
                    print(f"  {ref_img} -> OK ({len(data)//1024}KB)")
            return
        if pid in h and h[pid].get("status", {}).get("status_str") == "error":
            print(f"  {ref_img}: 错误 {str(h[pid].get('status',{}).get('messages',''))[:200]}")
            return
    print(f"  {ref_img}: 超时")


for i in range(1, 7):
    ref = f"ref_{i:02d}.png"
    print(f"[{i}/6] {ref}")
    run(ref, 2026 + i)

print("全部完成")
