"""A5 验收拼图：把 5 NPC x (calm原图 + 3 情绪) 拼成一张对比图。

用法：
  python tools/a5_contact_sheet.py
产出：
  G:/WBSpace/AIDebate/outputs/a5_contact_sheet.png
"""
import os
from PIL import Image, ImageDraw, ImageFont

SRC = r"G:/WBSpace/AIDebate/demo/static/assets/portrait"
GEN = r"G:/WBSpace/AIDebate/outputs/a5_emotions"
OUT = r"G:/WBSpace/AIDebate/outputs/a5_contact_sheet.png"

NPCS = ["L1_A", "L2_A", "L3_A", "L4_A", "L5_A"]
NPCS_CN = {"L1_A": "L1 王阿姨", "L2_A": "L2 林经理", "L3_A": "L3 陈博主",
           "L4_A": "L4 赵律师", "L5_A": "L5 陆教授"}
COLS = [("calm", "冷静（原图）"), ("tense", "动摇 tense"),
        ("anxious", "警觉 anxious"), ("desperate", "被说服 desperate")]
CELL_W, CELL_H = 260, 390          # 单格尺寸（等比例缩小）
PAD = 12
HEAD_H = 34


def load_cell(npc, emo):
    if emo == "calm":
        p = os.path.join(SRC, npc, "calm.webp")
    else:
        p = os.path.join(GEN, f"{npc}_{emo}_masked.png")
        if not os.path.isfile(p):
            p = os.path.join(GEN, f"{npc}_{emo}_img2img.png")
    if not os.path.isfile(p):
        return None
    im = Image.open(p).convert("RGB")
    scale = min(CELL_W / im.width, CELL_H / im.height)
    return im.resize((int(im.width * scale), int(im.height * scale)), Image.LANCZOS)


def main():
    try:
        font = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 15)
        font_h = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 17)
    except Exception:
        font = font_h = ImageFont.load_default()

    total_w = PAD + (CELL_W + PAD) * len(COLS)
    total_h = HEAD_H + (CELL_H + PAD) * len(NPCS) + PAD
    sheet = Image.new("RGB", (total_w, total_h), (245, 250, 252))
    draw = ImageDraw.Draw(sheet)

    # 表头
    for c, (_, label) in enumerate(COLS):
        x = PAD + c * (CELL_W + PAD)
        draw.text((x + 4, 8), label, fill=(30, 70, 90), font=font_h)

    missing = []
    for r, npc in enumerate(NPCS):
        y = HEAD_H + r * (CELL_H + PAD)
        draw.text((6, y + 4), NPCS_CN[npc], fill=(20, 60, 80), font=font_h)
        for c, (emo, _) in enumerate(COLS):
            x = PAD + c * (CELL_W + PAD)
            draw.rectangle([x, y, x + CELL_W, y + CELL_H], outline=(180, 205, 215))
            cell = load_cell(npc, emo)
            if cell is None:
                missing.append(f"{npc}/{emo}")
                draw.text((x + 8, y + CELL_H // 2), "缺图", fill=(200, 90, 90), font=font)
                continue
            sheet.paste(cell, (x + (CELL_W - cell.width) // 2, y + (CELL_H - cell.height) // 2))

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    sheet.save(OUT, "PNG")
    print(f"[ok] {OUT}  ({sheet.width}x{sheet.height})")
    if missing:
        print("[missing]", ", ".join(missing))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
