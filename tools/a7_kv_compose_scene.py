"""A7d 人物入场景 KV：抠好的立绘站进科技风大厅（左右对峙构图）。

与 A7c 的区别：角色不再是"卡片"，而是真正站在场景里（带落地阴影 + 青色轮廓光）。

用法：
  python tools/a7_kv_compose_scene.py
"""
import argparse
import os
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = r"G:/WBSpace/AIDebate"
W, H = 1920, 1080

INK = (13, 59, 74)
CYAN = (26, 159, 189)
CYAN_L = (69, 214, 200)
WHITE = (255, 255, 255)
FONTS = [r"C:/Windows/Fonts/msyhbd.ttc", r"C:/Windows/Fonts/msyh.ttc", r"C:/Windows/Fonts/simhei.ttf"]


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


def outline(im, color=(120, 235, 245, 190), width=3):
    """给透明立绘加轮廓光（科技感 + 与背景分离）。"""
    a = im.split()[3]
    edge = a.filter(ImageFilter.MaxFilter(width * 2 + 1)).filter(ImageFilter.GaussianBlur(1.2))
    ring = Image.new("RGBA", im.size, (0, 0, 0, 0))
    ring.paste(Image.new("RGBA", im.size, color), (0, 0), edge)
    ring.alpha_composite(im)
    return ring


def ground_shadow(w, h):
    """椭圆落地阴影。"""
    sh = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(sh)
    d.ellipse([0, 0, w - 1, h - 1], fill=(16, 48, 66, 130))
    return sh.filter(ImageFilter.GaussianBlur(16))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bg", default=os.path.join(ROOT, "outputs/kv_scene_tech/light/light_91423.png"))
    ap.add_argument("--out", default=os.path.join(ROOT, "outputs/kv_main_scene.png"))
    a = ap.parse_args()

    canvas = Image.open(a.bg).convert("RGB").resize((W, H), Image.LANCZOS).convert("RGBA")
    canvas.alpha_composite(Image.new("RGBA", (W, H), (255, 255, 255, 48)))

    # 左侧柔光（保文字）
    gm = Image.new("L", (W, 1))
    for x in range(W):
        t = min(1.0, max(0.0, (x - 480) / 560))
        gm.putpixel((x, 0), int(228 * (1 - t)))
    canvas.alpha_composite(Image.composite(Image.new("RGBA", (W, H), WHITE + (255,)),
                                           Image.new("RGBA", (W, H), (0, 0, 0, 0)),
                                           gm.resize((W, H))))

    # ── 角色：左右对峙 ──
    # 只放对手，不放玩家（玩家是"你"，不出现在画面里）
    # 间距要够：王阿姨伸出的手（立绘右缘）不能被陆教授压住
    cast = [
        ("outputs/cutout/npc_l1.png", 662, 600, 300),     # 王阿姨 · L1（最弱）
        ("outputs/cutout/npc_l5.png", 1424, 596, 300),    # 陆教授 · L5（最强）
    ]
    for path, x, h, _ in cast:
        p = os.path.join(ROOT, path)
        if not os.path.isfile(p):
            print("[skip]", path)
            continue
        im = fit_h(Image.open(p).convert("RGBA"), h)
        # 落地阴影
        sw, sh_ = int(im.width * 0.82), 46
        sh = ground_shadow(sw, sh_)
        canvas.alpha_composite(sh, (x + (im.width - sw) // 2, 1080 - sh_ // 2 - 8))
        canvas.alpha_composite(outline(im), (x, 1080 - h))

    d = ImageDraw.Draw(canvas)

    # ── 文字 ──
    d.rectangle([92, 80, 98, 118], fill=CYAN)
    d.text((116, 78), "2026 腾讯游戏创作大赛", font=font(26), fill=INK + (245,))
    d.text((116, 112), "TENCENT GAME AWARDS 2026", font=font(15), fill=(70, 110, 128, 215))

    title = "抬杠模拟器"
    ft = font(140)
    ty = 250
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(glow).text((118, ty), title, font=ft, fill=CYAN_L + (115,),
                              stroke_width=18, stroke_fill=CYAN_L + (100,))
    canvas.alpha_composite(glow.filter(ImageFilter.GaussianBlur(20)))
    d = ImageDraw.Draw(canvas)
    d.text((118, ty), title, font=ft, fill=INK + (255,))

    d.text((126, ty + 178), "ARGUMENT  SIMULATOR", font=font(28), fill=CYAN + (255,))
    d.line([(126, ty + 230), (640, ty + 230)], fill=CYAN_L, width=5)

    d.text((126, ty + 262), "你用自己的话讲道理，", font=font(32), fill=INK + (250,))
    d.text((126, ty + 312), "AI 当裁判给你打分。", font=font(32), fill=INK + (250,))
    d.text((126, ty + 362), "说到对手会顶嘴、会记仇。", font=font(32), fill=INK + (250,))

    tags = [("AI 游戏赛道", CYAN), ("AI 原生子赛道", CYAN), ("Web · 点开即玩", (32, 150, 120))]
    tx = 126
    for text, color in tags:
        f = font(21)
        w = d.textlength(text, font=f)
        d.rounded_rectangle([tx, ty + 428, tx + w + 32, ty + 428 + 44], radius=5,
                            outline=color + (195,), width=2, fill=WHITE + (205,))
        d.text((tx + 16, ty + 438), text, font=f, fill=color + (255,))
        tx += w + 28 + 15

    # 角色名签（立在人物脚下）
    for path, x, h, _ in cast:
        name = {"outputs/cutout/npc_l1.png": "王阿姨 · L1 街坊型",
                "outputs/cutout/npc_l5.png": "陆教授 · L5 权威型"}.get(path)
        if not name:
            continue
        f = font(22)
        w = d.textlength(name, font=f)
        cx = x + 24
        d.rounded_rectangle([cx, 1080 - 58, cx + w + 32, 1080 - 12], radius=5,
                            fill=WHITE + (230,), outline=CYAN + (175,), width=2)
        d.text((cx + 16, 1080 - 51), name, font=f, fill=INK + (255,))

    d.text((W - 470, 60), "AI 原生子赛道 · 参赛作品", font=font(20), fill=(40, 90, 108, 205))

    canvas.convert("RGB").save(a.out, "PNG")
    print("[ok]", a.out, canvas.size)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
