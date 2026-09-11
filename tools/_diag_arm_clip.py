# -*- coding: utf-8 -*-
"""生成「玩家手臂被裁切」诊断图：左=画布占位实况，右=逐列像素占用 + 触发条件。"""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = r"G:/WBSpace/AIDebate"
SRC = os.path.join(ROOT, "outputs", "player-live2d-canvas-raw.png")
OUT = os.path.join(ROOT, "outputs", "player-arm-clip-diagnosis.png")

FONTS = [r"C:/Windows/Fonts/msyh.ttc", r"C:/Windows/Fonts/msyhbd.ttc",
         r"C:/Windows/Fonts/simhei.ttf", r"C:/Windows/Fonts/simsun.ttc"]
def font(size, bold=False):
    order = ([FONTS[1], FONTS[0], FONTS[2]] if bold else FONTS)
    for p in order:
        if os.path.exists(p):
            try: return ImageFont.truetype(p, size)
            except Exception: pass
    return ImageFont.load_default()

F_T = font(29, True); F_H = font(16, True); F_M = font(13); F_S = font(12); F_N = font(19, True)
INK = (24, 28, 38); GREY = (112, 120, 134)
RED = (214, 48, 49); BLUE = (28, 104, 190); GREEN = (26, 140, 96); ORANGE = (208, 124, 16)
BG = (255, 255, 255); LINE = (206, 212, 222)

# ---------- 读画布 + 逐列占用 ----------
cv = Image.open(SRC).convert("RGB")
W, H = cv.size
px = cv.load()
ink = lambda x, y: (255 - px[x, y][0]) + (255 - px[x, y][1]) + (255 - px[x, y][2]) > 24
cols = [sum(1 for y in range(H) if ink(x, y)) for x in range(W)]
nz = [x for x, c in enumerate(cols) if c > 0]
last_c = max(nz); col0 = cols[0]

# ---------- 布局 ----------
SCALE = 1.28
CW, CH = int(W * SCALE), int(H * SCALE)
PAD = 72; GAP = 96
CY0 = 120
OCC = CY0 + CH + 12              # 占用条
ARR = CY0 + CH + 68              # translateX 箭头
FOOT = CY0 + CH + 116            # 结论区
NL = 6
TOTAL_H = FOOT + NL * 22 + 34

RP_X = PAD + CW + GAP            # 右栏起点
CHART_W = W; CHART_H = 200
RP_W = max(CHART_W + 24, 430)
TOTAL_W = RP_X + RP_W + PAD

img = Image.new("RGB", (TOTAL_W, TOTAL_H), BG)
d = ImageDraw.Draw(img)

d.text((PAD, 16), "为什么「手臂被裁切」—— 玩家立绘画布占用诊断", font=F_T, fill=INK)
d.text((PAD, 52), "实测：1920×918 视口 / 玩家卡 412×600 / canvas 412×600 / DPR 1", font=F_S, fill=GREY)

# ============ 左：画布实况 ============
img.paste(cv.resize((CW, CH), Image.LANCZOS), (PAD, CY0))
d.rectangle([PAD, CY0, PAD + CW - 1, CY0 + CH - 1], outline=LINE, width=2)

shift_px = int(round(W * 0.10 * SCALE))
card_left = PAD - shift_px
d.line([card_left, CY0 - 14, card_left, CY0 + CH], fill=GREEN, width=3)
d.text((card_left, CY0 - 32), "卡片左边界", font=F_H, fill=GREEN)
d.line([PAD, CY0 - 14, PAD, CY0 + CH], fill=RED, width=4)
d.text((PAD + 8, CY0 + 10), "画布第 0 列 = 手臂被硬切处", font=F_H, fill=RED)

# 占用条
d.rectangle([PAD, OCC, PAD + int(last_c * SCALE), OCC + 14], fill=(203, 224, 245))
d.rectangle([PAD + int(last_c * SCALE), OCC, PAD + CW, OCC + 14], fill=(238, 240, 244))
d.text((PAD, OCC + 20), "角色内容仅占 0–%d px（左起 %.0f%%）" % (last_c, 100.0 * (last_c + 1) / W), font=F_M, fill=BLUE)
d.text((PAD + int(last_c * SCALE) + 10, OCC + 20), "右侧 %d px 全空" % (W - last_c - 1), font=F_M, fill=GREY)

# translateX 箭头
d.line([card_left, ARR, PAD, ARR], fill=ORANGE, width=2)
for xx in (card_left, PAD):
    d.line([xx, ARR - 6, xx, ARR + 6], fill=ORANGE, width=2)
d.text((card_left, ARR - 22), "translateX(10%)=41.2px 空档（CSS 硬编码）", font=F_M, fill=ORANGE)

# ============ 右：逐列占用曲线 ============
rx = RP_X + 46
ry = CY0
d.text((RP_X, 60), "逐列像素占用（共 412 列）", font=F_H, fill=INK)
d.text((RP_X, 82), "第 0 列已贴边 %d 像素 → 轮廓被切断的典型特征" % col0, font=F_S, fill=RED)
d.line([rx, ry, rx, ry + CHART_H], fill=LINE, width=1)
d.line([rx, ry + CHART_H, rx + CHART_W, ry + CHART_H], fill=LINE, width=1)
ymax = max(cols)
for x in range(W):
    h = int(cols[x] / ymax * (CHART_H - 4))
    if h <= 0: continue
    c = RED if x < 7 else (BLUE if x <= last_c else (222, 226, 234))
    d.rectangle([rx + x, ry + CHART_H - h, rx + x, ry + CHART_H - 1], fill=c)
d.line([rx, ry - 4, rx, ry + CHART_H], fill=RED, width=2)
d.text((rx + 4, ry - 22), "x=0 硬切", font=F_S, fill=RED)
d.line([rx + last_c, ry + 20, rx + last_c, ry + CHART_H], fill=BLUE, width=2)
d.text((rx + last_c + 5, ry + 16), "x=%d 内容结束" % last_c, font=F_S, fill=BLUE)
d.text((rx - 40, ry - 10), "%d" % ymax, font=F_S, fill=GREY)
d.text((rx - 14, ry + CHART_H - 6), "0", font=F_S, fill=GREY)

# 触发条件盒
bx, by = RP_X, ry + CHART_H + 54
d.rectangle([bx, by, bx + RP_W - 6, by + 210], outline=LINE, width=1)
d.text((bx + 14, by + 12), "裁切触发条件（a = 卡片宽 / 高）", font=F_H, fill=INK)
rows = [
    ("a ≥ 0.82", "模型横向容得下 → 零裁切", GREEN),
    ("a ≤ 0.81", "必然横向超框 → 左右硬切", RED),
    ("实测 309×254", "a = 1.216 → 零裁切 ✓", GREEN),
    ("实测 412×600", "a = 0.687 → 超框 19.3%", RED),
]
for i, (k, v, c) in enumerate(rows):
    y = by + 42 + i * 24
    d.text((bx + 14, y), k, font=F_M, fill=c)
    d.text((bx + 110, y), v, font=F_M, fill=INK)
d.text((bx + 14, by + 152), "逐姿势左切：Neutral 15px / Lean 27px / Point 40px", font=F_M, fill=ORANGE)
d.text((bx + 14, by + 174), "三个姿势最左端的轮廓都是手臂 → 被切的一定是胳膊", font=F_M, fill=ORANGE)

# ============ 结论 ============
d.line([PAD, FOOT - 22, TOTAL_W - PAD, FOOT - 22], fill=(230, 234, 242), width=1)
lines = [
    ("取景公式", "scale = min(1.82×宽高比/包围盒宽, 1.82/包围盒高) × zoom ；zoom = clamp(1.08, 1.48, 0.9/宽高比)", INK),
    ("实算", "宽高比 0.687 → zoom 1.3107 → scale 2.0828 → sx 3.0331 / sy 2.0828（与浏览器实测矩阵四位小数吻合）", INK),
    ("超框", "横向画出 1.82 × 1.3107 = 2.385 NDC，而画布只有 2.0 → 超框 19.3%，约合左右各 40px", RED),
    ("可见区间", "模型 x ∈ [−0.2972, +0.3622]；内容 x ∈ [−0.3607, +0.4258] → 左边界外溢 0.0635", RED),
    ("取景枢轴", "包围盒取「全部 12 个 drawable 的并集」→ 中心 x=+0.0326 被 Point 姿势的伸手指钉住，Neutral/Lean 被整体推左", ORANGE),
    ("叠加伤害", "cards.css 的 translateX(10%) 把画布右移 41.2px → 切线不再贴卡片左缘，而是悬在卡内 41px 处，看起来像被竖着剜掉一条", ORANGE),
]
for i, (k, v, c) in enumerate(lines):
    y = FOOT + i * 22
    d.text((PAD, y), k, font=F_H, fill=c)
    d.text((PAD + 96, y + 1), v, font=F_M, fill=INK)

img.save(OUT)
print("saved:", OUT, img.size)
print("content cols", 0, "-", last_c, "| col0 ink =", col0, "| ymax =", ymax)
