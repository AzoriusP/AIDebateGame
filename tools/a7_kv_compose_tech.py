"""A7c 科技风 KV 合成：浅冰蓝场景 + 深青文字 + 角色卡（贴合游戏实装 UI）。

游戏 UI 色：--bg-deep #d9f1f7（浅冰蓝）/ 青色强调 / 网格底纹
本脚本用「浅底 + 深青字 + 青边卡片」，风格对齐 theme.css。

用法：
  python tools/a7_kv_compose_tech.py
  python tools/a7_kv_compose_tech.py --bg outputs/kv_scene_tech/light/light_91423.png
"""
import argparse
import os
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = r"G:/WBSpace/AIDebate"
ASSETS = os.path.join(ROOT, "demo/static/assets")
W, H = 1920, 1080

INK = (13, 59, 74)        # 深青（主文字）
CYAN = (26, 159, 189)     # 青（强调）
CYAN_L = (69, 214, 200)   # 亮青
WHITE = (255, 255, 255)
PANEL = (255, 255, 255)

FONTS = [r"C:/Windows/Fonts/msyhbd.ttc", r"C:/Windows/Fonts/msyh.ttc",
         r"C:/Windows/Fonts/simhei.ttf"]


def font(size, idx=0):
    for p in FONTS[idx:]:
        if os.path.isfile(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                continue
    return ImageFont.load_default()


def fit_h(im, h):
    s = h / im.height
    return im.resize((int(im.width * s), h), Image.LANCZOS)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bg", default=os.path.join(ROOT, "outputs/kv_scene_tech/light/light_91423.png"))
    ap.add_argument("--out", default=os.path.join(ROOT, "outputs/kv_main_tech.png"))
    a = ap.parse_args()

    # ① 底图铺满 + 轻微提亮（浅色风格不做压暗）
    bg = Image.open(a.bg).convert("RGB").resize((W, H), Image.LANCZOS)
    canvas = bg.convert("RGBA")
    canvas.alpha_composite(Image.new("RGBA", (W, H), (255, 255, 255, 62)))

    # ② 左侧白色柔光（保证深青文字可读）
    gm = Image.new("L", (W, 1))
    for x in range(W):
        t = min(1.0, max(0.0, (x - 520) / 620))
        gm.putpixel((x, 0), int(235 * (1 - t)))
    canvas.alpha_composite(Image.composite(Image.new("RGBA", (W, H), WHITE + (255,)),
                                           Image.new("RGBA", (W, H), (0, 0, 0, 0)),
                                           gm.resize((W, H))))

    d = ImageDraw.Draw(canvas)

    # ③ 赛事包装
    d.rectangle([92, 80, 98, 118], fill=CYAN)
    d.text((116, 78), "2026 腾讯游戏创作大赛", font=font(26), fill=INK + (240,))
    d.text((116, 112), "TENCENT GAME AWARDS 2026", font=font(15), fill=(70, 110, 128, 210))

    # ④ 主标题（科技风：无衬线粗体 + 青色发光）
    title = "抬杠模拟器"
    ft = font(150)
    ty = 296
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(glow).text((122, ty), title, font=ft, fill=CYAN_L + (110,),
                              stroke_width=18, stroke_fill=CYAN_L + (95,))
    canvas.alpha_composite(glow.filter(ImageFilter.GaussianBlur(20)))
    d = ImageDraw.Draw(canvas)
    d.text((122, ty), title, font=ft, fill=INK + (255,))

    d.text((130, ty + 190), "ARGUMENT  SIMULATOR", font=font(30), fill=CYAN + (255,))
    d.line([(130, ty + 244), (706, ty + 244)], fill=CYAN_L, width=5)

    # ⑤ 定位
    d.text((130, ty + 276), "你用自己的话讲道理，AI 当裁判给你打分。", font=font(34), fill=INK + (250,))
    d.text((130, ty + 328), "用有限的几句话，说到对手会顶嘴、会记仇。", font=font(34), fill=INK + (250,))

    # ⑥ 标签
    tags = [("AI 游戏赛道", CYAN), ("AI 原生子赛道", CYAN), ("Web · 点开即玩", (32, 150, 120))]
    tx = 130
    for text, color in tags:
        f = font(22)
        w = d.textlength(text, font=f)
        d.rounded_rectangle([tx, ty + 398, tx + w + 34, ty + 398 + 46], radius=5,
                            outline=color + (190,), width=2, fill=WHITE + (200,))
        d.text((tx + 17, ty + 409), text, font=f, fill=color + (255,))
        tx += w + 30 + 16

    # ⑦ 右侧角色卡（白卡 + 青边）
    player_fb = os.path.join(ROOT, "抬杠模拟器-参赛介绍/assets/player_calm.png")
    chars = [
        (player_fb, "你", "玩家 · Live2D"),
        (os.path.join(ASSETS, "portrait/L1_A/anxious.webp"), "王阿姨", "L1 街坊型"),
        (os.path.join(ASSETS, "portrait/L5_A/tense.webp"), "陆教授", "L5 权威型"),
    ]
    CW_, CH_, gap = 262, 396, 26
    x0 = W - 110 - (CW_ * 3 + gap * 2)
    y0 = 292
    for i, (p, name, tag) in enumerate(chars):
        x = x0 + i * (CW_ + gap)
        if not os.path.isfile(p):
            continue
        card = Image.new("RGBA", (CW_, CH_), (0, 0, 0, 0))
        cd = ImageDraw.Draw(card)
        cd.rounded_rectangle([0, 0, CW_ - 1, CH_ - 1], radius=10, fill=WHITE + (238,))
        canvas.alpha_composite(card, (x, y0))
        portrait = fit_h(Image.open(p).convert("RGB"), CH_ - 62)
        canvas.alpha_composite(portrait.convert("RGBA"), (x + (CW_ - portrait.width) // 2, y0 + 56))
        d = ImageDraw.Draw(canvas)
        d.rounded_rectangle([x, y0, x + CW_ - 1, y0 + CH_ - 1], radius=10,
                            outline=CYAN + (170,), width=2)
        d.text((x + 16, y0 + 16), name, font=font(25), fill=INK + (255,))
        # 底部白条承载标签，避免被立绘暗部吞掉
        d.rounded_rectangle([x + 1, y0 + CH_ - 46, x + CW_ - 2, y0 + CH_ - 2],
                            radius=8, fill=WHITE + (238,))
        d.text((x + 16, y0 + CH_ - 38), tag, font=font(17), fill=CYAN + (255,))
        d.text((x + 16, y0 + 17), name, font=font(25), fill=INK + (255,))

    # ⑧ 右下角
    d.text((W - 470, H - 74), "AI 原生子赛道 · 参赛作品", font=font(20), fill=(40, 90, 108, 200))

    canvas.convert("RGB").save(a.out, "PNG")
    print("[ok]", a.out, canvas.size)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
