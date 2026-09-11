"""A5 脸部特写拼图：把生成图的脸部区域裁切放大，用于检查「非人类感」的具体成因。

用法：python tools/a5_face_zoom.py
产出：G:/WBSpace/AIDebate/outputs/a5_face_zoom.png
"""
import os
from PIL import Image, ImageDraw, ImageFont

SRC = r"G:/WBSpace/AIDebate/demo/static/assets/portrait"
GEN = r"G:/WBSpace/AIDebate/outputs/a5_emotions"
OUT = r"G:/WBSpace/AIDebate/outputs/a5_face_zoom.png"

# 每个 NPC 的脸部裁切框（与原图 576x864 画布对应）
FACE_CROP = {
    "L1_A": (140, 90, 460, 420),
    "L2_A": (160, 100, 450, 400),
    "L3_A": (150, 120, 430, 350),
    "L4_A": (150, 100, 450, 410),
    "L5_A": (130, 90, 460, 470),
}
NPCS = list(FACE_CROP.keys())
EMOS = [("calm", "原图"), ("tense", "动摇"), ("anxious", "警觉"), ("desperate", "被说服")]
CELL_W, CELL_H, PAD, HEAD_H = 220, 300, 10, 30


def cell(npc, emo, base):
    if emo == "calm":
        p = os.path.join(SRC, npc, "calm.webp")
    else:
        p = os.path.join(base, f"{npc}_{emo}_masked.png")
    if not os.path.isfile(p):
        return None
    im = Image.open(p).convert("RGB")
    x0, y0, x1, y1 = FACE_CROP[npc]
    im = im.crop((x0, y0, x1, y1))
    s = min(CELL_W / im.width, CELL_H / im.height)
    return im.resize((int(im.width * s), int(im.height * s)), Image.LANCZOS)


def sheet(base, out, tag):
    try:
        f = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 14)
        ft = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 18)
    except Exception:
        f = ft = ImageFont.load_default()
    W = PAD + (CELL_W + PAD) * len(EMOS)
    H = HEAD_H + (CELL_H + PAD) * len(NPCS) + PAD
    sh = Image.new("RGB", (W, H), (245, 250, 252))
    d = ImageDraw.Draw(sh)
    d.text((PAD, 6), f"脸部特写 · {tag}", fill=(20, 60, 80), font=ft)
    for c, (_, label) in enumerate(EMOS):
        d.text((PAD + c * (CELL_W + PAD) + 4, HEAD_H - 20), label, fill=(60, 100, 120), font=f)
    for r, npc in enumerate(NPCS):
        y = HEAD_H + r * (CELL_H + PAD)
        d.text((2, y + 4), npc, fill=(20, 60, 80), font=f)
        for c, (emo, _) in enumerate(EMOS):
            x = PAD + c * (CELL_W + PAD)
            d.rectangle([x, y, x + CELL_W, y + CELL_H], outline=(185, 208, 218))
            cc = cell(npc, emo, base)
            if cc:
                sh.paste(cc, (x + (CELL_W - cc.width) // 2, y + (CELL_H - cc.height) // 2))
    sh.save(out, "PNG")
    print(f"[ok] {out} ({sh.width}x{sh.height})")


if __name__ == "__main__":
    sheet(GEN, OUT, "当前版（masked denoise 0.5）")
