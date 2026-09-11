"""从 4 表情整图拆分 Live2D 式分层部件（头/身体），补全到统一 576x864 画布。
用 calm 的关键点坐标拆分全部 4 表情的头部件，保证骨架一致。
"""
import sys
sys.path.insert(0, r"G:\MiniMax-H3\ComfyUI_windows_portable\ComfyUI\custom_nodes\comfyui_controlnet_aux\src")
from custom_controlnet_aux.dwpose.wholebody import Wholebody
from PIL import Image
from rembg import remove, new_session
import pathlib
import cv2

DET = r"G:\MiniMax-H3\ComfyUI_windows_portable\ComfyUI\custom_nodes\comfyui_controlnet_aux\ckpts\yzd-v\DWPose\yolox_l.onnx"
POSE = r"G:\MiniMax-H3\ComfyUI_windows_portable\ComfyUI\custom_nodes\comfyui_controlnet_aux\ckpts\yzd-v\DWPose\dw-ll_ucoco_384.onnx"
SRC = pathlib.Path(r"G:\WBSpace\AIDebate\demo\static\assets\portrait\player")
OUT = pathlib.Path(r"G:\WBSpace\AIDebate\demo\static\assets\parts")
CW, CH = 576, 864
STATES = ["calm", "tense", "anxious", "desperate"]

wb = Wholebody(det_model_path=DET, pose_model_path=POSE)
session = new_session("u2net")


def locate(img):
    """用 DWPose 检测关键点，返回 (neck_x, head_top, head_bottom, body_top)。"""
    h, w = img.shape[:2]
    kp = wb(img)
    if kp is None or len(kp) == 0:
        return w // 2, 0, h // 2, h // 2
    k = kp[0]
    nose = k[0][:2] if len(k) > 0 else None
    neck = k[1][:2] if len(k) > 1 else None
    l_sho = k[5][:2] if len(k) > 5 else None
    r_sho = k[6][:2] if len(k) > 6 else None
    # 稳健：双肩中点定 x，min 肩 y 定分界
    if l_sho is not None and r_sho is not None:
        neck_x = int((l_sho[0] + r_sho[0]) / 2)
        shoulder_y = int(min(l_sho[1], r_sho[1]))
    else:
        neck_x = int(neck[0]) if neck is not None else (int(nose[0]) if nose is not None else w // 2)
        shoulder_y = int(neck[1]) if neck is not None else h // 2
    nose_y = int(nose[1]) if nose is not None else h // 3
    neck_y = nose_y + int((shoulder_y - nose_y) * 0.85)
    head_top = 0
    head_bottom = min(h, neck_y + int(neck_y * 0.20))
    body_top = max(0, neck_y - int(neck_y * 0.15))
    return neck_x, head_top, head_bottom, body_top


def main():
    # 用 calm 定位
    cal = cv2.imread(str(SRC / "calm.webp"))
    neck_x, head_top, head_bottom, body_top = locate(cal)
    head_w = neck_y = head_bottom - head_top
    head_l = max(0, neck_x - head_w // 2)
    head_r = min(CW, neck_x + head_w // 2)
    print(f"定位: neck_x={neck_x} head=[{head_l},{head_top},{head_r},{head_bottom}] body_top={body_top}")

    # 拆 4 表情的头部件
    (OUT / "head").mkdir(parents=True, exist_ok=True)
    (OUT / "body").mkdir(parents=True, exist_ok=True)
    for st in STATES:
        src = SRC / f"{st}.webp"
        if not src.exists():
            continue
        im = Image.open(src).convert("RGBA")
        head_crop = im.crop((head_l, head_top, head_r, head_bottom))
        head_cut = remove(head_crop, session=session)
        head_full = Image.new("RGBA", (CW, CH), (0, 0, 0, 0))
        head_full.paste(head_cut, (head_l, head_top))
        head_full.save(OUT / "head" / f"faceA_{st}.webp", "WEBP", quality=85, method=6)
        print(f"  head faceA_{st}.webp OK")

    # body 拆 1 次（calm）
    im = Image.open(SRC / "calm.webp").convert("RGBA")
    body_crop = im.crop((0, body_top, CW, CH))
    body_cut = remove(body_crop, session=session)
    body_full = Image.new("RGBA", (CW, CH), (0, 0, 0, 0))
    body_full.paste(body_cut, (0, body_top))
    body_full.save(OUT / "body" / "male.webp", "WEBP", quality=85, method=6)
    print("  body male.webp OK")


if __name__ == "__main__":
    main()
