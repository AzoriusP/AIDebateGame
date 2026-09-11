"""A5 denoise 三档对比图：原图 vs d30 vs d38 vs d42（以 L2_A/desperate 为例）。

用法：python tools/a5_denoise_compare.py
产出：G:/WBSpace/AIDebate/outputs/a5_denoise_compare.png
"""
import os
from PIL import Image, ImageDraw, ImageFont

SRC_CALM = r"G:/WBSpace/AIDebate/demo/static/assets/portrait/L2_A/calm.webp"
GEN = r"G:/WBSpace/AIDebate/outputs/a5_emotions"
OUT = r"G:/WBSpace/AIDebate/outputs/a5_denoise_compare.png"

ITEMS = [
    (SRC_CALM, "原图 calm"),
    (os.path.join(GEN, "L2_A_desperate_d30.png"), "denoise 0.30（表情弱）"),
    (os.path.join(GEN, "L2_A_desperate_d38.png"), "denoise 0.38（推荐？）"),
    (os.path.join(GEN, "L2_A_desperate_d42.png"), "denoise 0.42（表情强/偏漫画）"),
]
CELL_W, CELL_H, PAD, HEAD_H = 300, 450, 14, 38


def main():
    try:
        font = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 16)
        font_t = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 20)
    except Exception:
        font = font_t = ImageFont.load_default()

    avail = [(p, l) for p, l in ITEMS if os.path.isfile(p)]
    W = PAD + (CELL_W + PAD) * len(avail)
    H = HEAD_H + CELL_H + PAD + 40
    sheet = Image.new("RGB", (W, H), (245, 250, 252))
    d = ImageDraw.Draw(sheet)
    d.text((PAD, 8), "L2 林经理 · 被说服 desperate —— denoise 三档对比", fill=(20, 60, 80), font=font_t)

    for i, (p, label) in enumerate(avail):
        x = PAD + i * (CELL_W + PAD)
        y = HEAD_H
        d.rectangle([x, y, x + CELL_W, y + CELL_H], outline=(180, 205, 215))
        im = Image.open(p).convert("RGB")
        s = min(CELL_W / im.width, CELL_H / im.height)
        im = im.resize((int(im.width * s), int(im.height * s)), Image.LANCZOS)
        sheet.paste(im, (x + (CELL_W - im.width) // 2, y + (CELL_H - im.height) // 2))
        d.text((x + 6, y + CELL_H + 8), label, fill=(30, 70, 90), font=font)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    sheet.save(OUT, "PNG")
    print(f"[ok] {OUT} ({sheet.width}x{sheet.height})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
