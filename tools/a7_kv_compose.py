"""A7 宣传 KV 合成：法庭场景底图 + 角色卡片 + 设计标题 + 赛事包装。

产出 1920x1080 横版 KV（赛事提交用主视觉）。

用法：
  python tools/a7_kv_compose.py
  python tools/a7_kv_compose.py --bg outputs/kv_scene/kv_scene_77138.png --out outputs/kv_main.png
"""
import argparse
import os
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = r"G:/WBSpace/AIDebate"
ASSETS = os.path.join(ROOT, "demo/static/assets")
W, H = 1920, 1080

# —— 配色（与 PPT / 游戏 UI 同族）——
BG_DEEP = (14, 18, 38)
GOLD = (245, 192, 78)
RED = (255, 59, 78)
CYAN = (69, 214, 200)
WHITE = (247, 244, 236)

FONTS = [
    r"C:/Windows/Fonts/STZHONGS.TTF",   # 华文中宋
    r"C:/Windows/Fonts/simhei.ttf",     # 黑体
    r"C:/Windows/Fonts/msyh.ttc",       # 雅黑
]


def font(size, idx=0):
    for p in FONTS[idx:]:
        if os.path.isfile(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                continue
    return ImageFont.load_default()


def load_portrait(path, box_h):
    im = Image.open(path).convert("RGB")
    s = box_h / im.height
    return im.resize((int(im.width * s), box_h), Image.LANCZOS)


def rounded_card(canvas, xywh, radius=8, fill=(255, 255, 255), outline=GOLD, width=2):
    x, y, w, h = xywh
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.rounded_rectangle([0, 0, w - 1, h - 1], radius=radius, fill=fill)
    canvas.alpha_composite(layer, (x, y))
    ImageDraw.Draw(canvas).rounded_rectangle([x, y, x + w - 1, y + h - 1], radius=radius, outline=outline, width=width)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bg", default=os.path.join(ROOT, "outputs/kv_scene/kv_scene_77138.png"))
    ap.add_argument("--out", default=os.path.join(ROOT, "outputs/kv_main.png"))
    a = ap.parse_args()

    # ① 底图：铺满 + 压暗
    bg = Image.open(a.bg).convert("RGB").resize((W, H), Image.LANCZOS)
    bg = Image.blend(bg, Image.new("RGB", (W, H), BG_DEEP), 0.42)
    canvas = bg.convert("RGBA")

    # ② 左侧压暗渐变（保证文字可读）
    grad = Image.new("L", (W, 1))
    for x in range(W):
        t = min(1.0, max(0.0, (x - 700) / 700))
        grad.putpixel((x, 0), int(210 * (1 - t)))
    grad = grad.resize((W, H))
    canvas.alpha_composite(Image.composite(Image.new("RGBA", (W, H), BG_DEEP + (255,)),
                                           Image.new("RGBA", (W, H), (0, 0, 0, 0)), grad))

    # ③ 底部压暗
    g2 = Image.new("L", (1, H))
    for y in range(H):
        t = min(1.0, max(0.0, (y - 620) / 420))
        g2.putpixel((0, y), int(160 * t))
    canvas.alpha_composite(Image.composite(Image.new("RGBA", (W, H), BG_DEEP + (255,)),
                                           Image.new("RGBA", (W, H), (0, 0, 0, 0)),
                                           g2.resize((W, H))))

    d = ImageDraw.Draw(canvas)

    # ④ 赛事包装（左上）
    d.rectangle([92, 78, 98, 116], fill=GOLD)
    d.text((116, 76), "2026 腾讯游戏创作大赛", font=font(26, 2), fill=(247, 244, 236, 235))
    d.text((116, 110), "TENCENT GAME AWARDS 2026", font=font(15, 2), fill=(200, 200, 210, 170))

    # ⑤ 主标题
    title = "抬杠模拟器"
    f_title = font(148)
    ty = 300
    # 发光
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(glow).text((124, ty), title, font=f_title, fill=GOLD + (70,),
                              stroke_width=16, stroke_fill=GOLD + (60,))
    canvas.alpha_composite(glow.filter(ImageFilter.GaussianBlur(18)))
    d = ImageDraw.Draw(canvas)
    d.text((124, ty), title, font=f_title, fill=WHITE, stroke_width=3, stroke_fill=(60, 44, 10))

    d.text((132, ty + 186), "ARGUMENT SIMULATOR", font=font(30, 2), fill=GOLD + (215,))
    d.line([(132, ty + 238), (700, ty + 238)], fill=RED, width=4)

    # ⑥ 一句话定位
    d.text((132, ty + 268), "你用自己的话讲道理，AI 当裁判给你打分。", font=font(34, 2), fill=(247, 244, 236, 240))
    d.text((132, ty + 318), "用有限的几句话，说到对手服气。", font=font(34, 2), fill=(247, 244, 236, 240))

    # ⑦ 标签
    tags = [("AI 游戏赛道", GOLD), ("AI 原生子赛道", GOLD), ("Web · 点开即玩", CYAN)]
    tx = 132
    for text, color in tags:
        f = font(22, 2)
        w = d.textlength(text, font=f)
        d.rounded_rectangle([tx, ty + 386, tx + w + 34, ty + 386 + 44], radius=4,
                            outline=color + (170,), width=1, fill=(255, 255, 255, 14))
        d.text((tx + 17, ty + 396), text, font=f, fill=color + (235,))
        tx += w + 30 + 16

    # ⑧ 右侧角色卡片（3 张）
    # 注：player 的 portraits 已被移除（玩家改走纯 Live2D），用 assets 里的最后一版副本
    PLAYER_FALLBACK = os.path.join(ROOT, "抬杠模拟器-参赛介绍/assets/player_calm.png")
    chars = [
        (PLAYER_FALLBACK, "你", "玩家 · Live2D"),
        (os.path.join(ASSETS, "portrait/L1_A/anxious.webp"), "王阿姨", "L1 街坊型"),
        (os.path.join(ASSETS, "portrait/L5_A/tense.webp"), "陆教授", "L5 权威型"),
    ]
    CW_, CH_ = 252, 380
    gap = 26
    total = CW_ * 3 + gap * 2
    x0 = W - 120 - total
    y0 = 300
    for i, (p, name, tag) in enumerate(chars):
        x = x0 + i * (CW_ + gap)
        if not os.path.isfile(p):
            continue
        portrait = load_portrait(p, CH_ - 54)
        card = Image.new("RGBA", (CW_, CH_), (0, 0, 0, 0))
        card.paste(portrait, ((CW_ - portrait.width) // 2, 0))
        canvas.alpha_composite(card, (x, y0 + 54))
        rounded_card(canvas, (x, y0, CW_, CH_), radius=8, fill=(10, 14, 30, 150),
                     outline=GOLD + (150,), width=2)
        d = ImageDraw.Draw(canvas)
        d.text((x + 14, y0 + 14), name, font=font(24, 2), fill=WHITE + (245,))
        d.text((x + 14, y0 + CH_ - 34), tag, font=font(17, 2), fill=GOLD + (200,))

    # ⑨ 右下角信息位
    d.text((W - 460, H - 72), "AI 原生子赛道 · 参赛作品", font=font(20, 2), fill=(247, 244, 236, 175))

    canvas.convert("RGB").save(a.out, "PNG")
    print("[ok]", a.out, canvas.size)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
