"""用 yolox 检测 ipadapter_v1.png 里所有人（降阈值），按 bbox 裁剪单人图。"""
import sys
sys.path.insert(0, r"G:\MiniMax-H3\ComfyUI_windows_portable\ComfyUI\custom_nodes\comfyui_controlnet_aux\src")
from custom_controlnet_aux.dwpose.dw_onnx.cv_ox_det import multiclass_nms, demo_postprocess, preprocess
import onnxruntime as ort
import cv2
import numpy as np
import pathlib

DET = r"G:\MiniMax-H3\ComfyUI_windows_portable\ComfyUI\custom_nodes\comfyui_controlnet_aux\ckpts\yzd-v\DWPose\yolox_l.onnx"
IMG = r"G:\WBSpace\AIDebate\design\art-output\ipadapter_v1.png"
OUT = pathlib.Path(r"G:\WBSpace\AIDebate\design\art-output\split")
OUT.mkdir(exist_ok=True)


def detect_persons(session, oriImg, score_thr=0.2):
    input_shape = (640, 640)
    img, ratio = preprocess(oriImg, input_shape)
    inp = img[None].astype(np.float32)
    output = session.run(None, {session.get_inputs()[0].name: inp})
    predictions = demo_postprocess(output[0], input_shape)[0]
    boxes = predictions[:, :4]
    scores = predictions[:, 4:5] * predictions[:, 5:]
    boxes_xyxy = np.ones_like(boxes)
    boxes_xyxy[:, 0] = boxes[:, 0] - boxes[:, 2] / 2.
    boxes_xyxy[:, 1] = boxes[:, 1] - boxes[:, 3] / 2.
    boxes_xyxy[:, 2] = boxes[:, 0] + boxes[:, 2] / 2.
    boxes_xyxy[:, 3] = boxes[:, 1] + boxes[:, 3] / 2.
    boxes_xyxy /= ratio
    dets = multiclass_nms(boxes_xyxy, scores, nms_thr=0.45, score_thr=0.03)
    if dets is None:
        return [], []
    fb, fs, fc = dets[:, :4], dets[:, 4], dets[:, 5]
    mask = (fs > score_thr) & (fc == 0)
    return fb[mask], fs[mask]


def main():
    det = ort.InferenceSession(DET, providers=["CPUExecutionProvider"])
    img = cv2.imread(IMG)
    h, w = img.shape[:2]
    boxes, scores = detect_persons(det, img)
    print(f"检测到 {len(boxes)} 人")
    # 按 x 排序（从左到右）
    order = np.argsort(boxes[:, 0])
    for i, idx in enumerate(order):
        x1, y1, x2, y2 = boxes[idx]
        # 扩 15% 边距
        cw, ch = x2 - x1, y2 - y1
        x1 = max(0, int(x1 - cw * 0.15)); y1 = max(0, int(y1 - ch * 0.1))
        x2 = min(w, int(x2 + cw * 0.15)); y2 = min(h, int(y2 + ch * 0.05))
        crop = img[y1:y2, x1:x2]
        dst = OUT / f"person_{i+1:02d}.png"
        cv2.imwrite(str(dst), crop)
        print(f"  人物{i+1}: bbox=[{int(x1)},{int(y1)},{int(x2)},{int(y2)}] score={scores[idx]:.2f} -> {dst.name}")


if __name__ == "__main__":
    main()
