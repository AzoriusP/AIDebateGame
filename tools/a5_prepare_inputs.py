"""A5 准备：把 NPC calm 立绘转成 ComfyUI 可读 PNG，并生成脸部局部重绘 mask。

用法：
  python tools/a5_prepare_inputs.py

产出（写入 ComfyUI/input/）：
  {npc}_calm.png      —— 576x864 RGB，从 portrait/{npc}/calm.webp 转来
  face_mask_{npc}.png —— 576x864 灰度，脸部区域纯白(255)，其余纯黑(0)
"""
import os
import sys
from PIL import Image, ImageDraw

SRC_ROOT = r"G:/WBSpace/AIDebate/demo/static/assets/portrait"
COMFY_INPUT = r"G:/MiniMax-H3/ComfyUI_windows_portable/ComfyUI/input"
NPCS = ["L1_A", "L2_A", "L3_A", "L4_A", "L5_A"]

# 脸部重绘区域（576x864 画布）—— 必须按 NPC 定制，且【必须避开眼睛】。
#
# 教训链：
#   v1 整脸大椭圆 + denoise 0.5 → 被动漫模型重画成糊脸
#   v2 5 NPC 用同一组坐标 → L3 mask 盖到衣领（衣服变色）、L5 mask 盖在鼻梁（表情没变化）
#   v3 含眼睛的 mask + denoise 0.5 → 「非人类」：眉毛变粗黑（毛毛虫）、眼睛瞪大变形、
#      瞳孔错位、动漫大眼。根因：animagine 是动漫底模，会把「表情」理解成「动漫夸张五官」，
#      而眼睛是人脸识别度最高的部位，一动就假。
#
# v4 策略：mask 只覆盖【眉毛】+【嘴】，**眼睛完全不进 mask** → 靠原图眼睛保「人味」，
#          眉毛与嘴负责表达情绪。denoise 可保持 0.5+，因为改动区不含高风险器官。
# 每项 = [(眉毛区), (嘴部)]，(left, top, right, bottom)
FACE_REGIONS_BY_NPC = {
    "L1_A": [(185, 170, 415, 210), (240, 340, 385, 405)],
    "L2_A": [(185, 160, 400, 203), (215, 350, 340, 405)],
    "L3_A": [(200, 175, 365, 213), (205, 300, 330, 352)],
    "L4_A": [(175, 180, 385, 217), (190, 355, 325, 410)],
    "L5_A": [(180, 205, 425, 243), (205, 395, 345, 452)],
}
FACE_REGIONS = [(195, 155, 425, 200), (235, 305, 385, 385)]   # 兜底
FEATHER = 8                       # mask 边缘羽化（越小越硬；太大会在贴回时留半透明鬼影）

# 【眼睛保护带】—— 生成 mask 时用纯黑挖掉这些区域，保证眼睛在数学上不可能被重绘。
#   教训：眉毛区下沿若伸进眼睛（实测 L1/L2/L4 都发生），眼周会被 latent mask 扩散波及，
#   结果是「眼睛变形/瞳孔位移」→ 大王反馈的「眼睛太恐怖」。
#   宁可牺牲眉毛上沿的一部分，也要把眼睛带完全锁死。
EYE_PROTECT = {
    "L1_A": (178, 200, 430, 290),
    "L2_A": (172, 195, 408, 278),
    "L3_A": (182, 205, 400, 298),   # 墨镜镜片区
    "L4_A": (162, 210, 418, 302),
    "L5_A": (178, 238, 438, 342),   # 眼镜后的眼睛
}


def build_face_mask(size, regions=None, feather=FEATHER, protect=None):
    """白 = 重绘区，黑 = 保留区。
    先画眉毛/嘴（白），再用纯黑挖掉眼睛保护带 —— 双眼绝不被重绘。"""
    from PIL import ImageFilter
    regions = regions or FACE_REGIONS
    w, h = size
    mask = Image.new("L", (w, h), 0)
    draw = ImageDraw.Draw(mask)
    for box in regions:
        draw.ellipse(box, fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(feather))
    if protect:
        # 羽化之后再挖，且用硬边（不再羽化），确保眼睛区域绝对干净
        cut = Image.new("L", (w, h), 0)
        cd = ImageDraw.Draw(cut)
        for box in protect:
            cd.ellipse(box, fill=255)
        cut = cut.filter(ImageFilter.GaussianBlur(10))
        mask = Image.composite(Image.new("L", (w, h), 0), mask, cut)
    return mask


def main():
    os.makedirs(COMFY_INPUT, exist_ok=True)
    missing = []
    for npc in NPCS:
        src = os.path.join(SRC_ROOT, npc, "calm.webp").replace("\\", "/")
        if not os.path.isfile(src):
            missing.append(src)
            continue
        im = Image.open(src).convert("RGB")
        dst = os.path.join(COMFY_INPUT, f"{npc}_calm.png")
        im.save(dst, "PNG")
        mask = build_face_mask(im.size, FACE_REGIONS_BY_NPC.get(npc),
                               protect=[EYE_PROTECT[npc]] if npc in EYE_PROTECT else None)
        mask_path = os.path.join(COMFY_INPUT, f"face_maskv2_{npc}.png")
        mask.save(mask_path, "PNG")
        print(f"[ok] {npc}: {im.size} -> {dst} + {mask_path}")
    if missing:
        print("[need] 仍有 5 张标准立绘未生成（当前已在用）：")
        for m in missing:
            print("   ", m)
        print("  → 先把这 5 张 calm 放进 portrait/{npc}/calm.webp，再重跑本脚本")
    return 0


if __name__ == "__main__":
    sys.exit(main())
