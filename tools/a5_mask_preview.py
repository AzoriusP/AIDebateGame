"""A5 mask 标定预览：把 mask 区域半透明叠加在原图上，用于核对坐标是否对准嘴/眉。

用法：python tools/a5_mask_preview.py
产出：G:/WBSpace/AIDebate/outputs/a5_mask_preview.png
     每行 = 一个 NPC，三列：[原图] [mask 叠加] [生成图 desperate]
"""
import os
import sys
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from a5_prepare_inputs import FACE_REGIONS_BY_NPC, build_face_mask  # noqa: E402

SRC = r"G:/WBSpace/AIDebate/demo/static/assets/portrait"
GEN = r"G:/WBSpace/AIDebate/outputs/a5_emotions"
OUT = r"G:/WBSpace/AIDebate/outputs/a5_mask_preview.png"
NPCS = ["L1_A", "L2_A", "L3_A", "L4_A", "L5_A"]

# 只显示脸部区域，便于看清对准
CROP = {"L1_A": (120, 60, 480, 400), "L2_A": (140, 80, 470, 420),
        "L3_A": (130, 100, 450, 360), "L4_A": (130, 80, 470, 420),
        "L5_A": (110, 70, 480, 480)}
PAD, HEAD_H = 10, 34


def main():
    try:
        f = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 14)
        ft = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 17)
    except Exception:
        f = ft = ImageFont.load_default()

    # 标定模式：原图叠加「坐标网格(每50px)」+ mask 红区，便于读出准确像素坐标
    grid_step = 50
    cols = [f"① 原图 + 坐标网格(每{grid_step}px) + mask红区", "② 当前生成图(desperate)"]
    CELL_W, CELL_H = 430, 470
    W = PAD + (CELL_W + PAD) * 2
    H = HEAD_H + (CELL_H + PAD) * len(NPCS)
    sh = Image.new("RGB", (W, H), (248, 250, 252))
    d = ImageDraw.Draw(sh)
    d.text((PAD, 8), "mask 标定（网格=原图绝对像素坐标）—— 红区应恰好盖住「眉毛」「嘴」，不含眼睛",
           fill=(20, 60, 80), font=ft)
    for c, label in enumerate(cols):
        d.text((PAD + c * (CELL_W + PAD) + 4, HEAD_H - 18), label, fill=(60, 100, 120), font=f)

    for r, npc in enumerate(NPCS):
        y = HEAD_H + r * (CELL_H + PAD)
        d.text((2, y + 4), npc, fill=(20, 60, 80), font=f)
        base = Image.open(os.path.join(SRC, npc, "calm.webp")).convert("RGB")
        box = CROP[npc]

        # ① 网格 + mask 叠加
        grid = base.copy()
        gd = ImageDraw.Draw(grid)
        for gx in range(0, base.width, grid_step):
            gd.line([(gx, 0), (gx, base.height)], fill=(0, 170, 190), width=1)
            gd.text((gx + 2, 2), str(gx), fill=(0, 130, 150))
        for gy in range(0, base.height, grid_step):
            gd.line([(0, gy), (base.width, gy)], fill=(0, 170, 190), width=1)
            gd.text((2, gy + 2), str(gy), fill=(0, 130, 150))
        mask = build_face_mask(base.size, FACE_REGIONS_BY_NPC.get(npc))
        red = Image.new("RGB", base.size, (235, 30, 30))
        grid = Image.composite(red, grid, mask.point(lambda v: int(v * 0.5)))
        crops = [grid.crop(box)]

        # ② 生成图
        gp = os.path.join(GEN, f"{npc}_desperate_masked.png")
        crops.append(Image.open(gp).convert("RGB").crop(box) if os.path.isfile(gp) else None)

        for c, im in enumerate(crops):
            x = PAD + c * (CELL_W + PAD)
            d.rectangle([x, y, x + CELL_W, y + CELL_H], outline=(190, 210, 220))
            if im is None:
                continue
            s = min(CELL_W / im.width, CELL_H / im.height)
            im = im.resize((int(im.width * s), int(im.height * s)), Image.LANCZOS)
            sh.paste(im, (x + (CELL_W - im.width) // 2, y + (CELL_H - im.height) // 2))

    sh.save(OUT, "PNG")
    print(f"[ok] {OUT} ({sh.width}x{sh.height})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
