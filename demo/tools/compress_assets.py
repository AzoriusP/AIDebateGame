#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""立绘资产管线：PNG 原图 → 统一画框 WebP（主图 + 缩略图）。

设计要点（对齐 docs/frontend-polish-plan.md §2.1 / §3.2）
  · 输出目录 portrait/{char_id}/{state}.webp，主键是 npc_id 而非 tier
  · calm 帧 = 现有立绘 → 美术一张图没出时，表现与今天完全一致（零白屏）
  · 旧 PNG 永不改动/不删除，作为降级链最后一道兜底
  · 幂等：可重复运行，只覆盖 portrait/ 下的产物

用法
  python demo/tools/compress_assets.py              # 全量转换（6 张 → calm + thumb）
  python demo/tools/compress_assets.py --inbox      # 转换 _inbox/{char_id}_{state}.png 增量表情
  python demo/tools/compress_assets.py --report     # 只打印体积报表，不写文件

规格：主图 576x864 q80（≤120KB 硬闸门）｜缩略图 128x192 q78（≤10KB）
零第三方依赖（Pillow 本机已装且自带 WebP），零构建链。
"""
import argparse
import pathlib
import sys

try:
    from PIL import Image, features
except ImportError:
    sys.exit("需要 Pillow：pip install Pillow")

if not features.check("webp"):
    sys.exit("当前 Pillow 不支持 WebP 编码")

SRC = pathlib.Path(__file__).resolve().parents[1] / "static" / "assets"
OUT = SRC / "portrait"
INBOX = SRC / "_inbox"

# npc_id ↔ 旧文件名（当前 5 NPC 与 tier 一一对应；扩到 15 NPC 时在此表追加即可）
LEGACY = {
    "L1_A": "npc_t1.png",
    "L2_A": "npc_t2.png",
    "L3_A": "npc_t3.png",
    "L4_A": "npc_t4.png",
    "L5_A": "npc_t5.png",
    "player": "player.png",
}

PORTRAIT = (576, 864)          # 2:3 竖版，立绘区 CSS 宽度的 2.36x
THUMB = (128, 192)             # 供 48/56px 头像位
Q_MAIN, Q_THUMB = 80, 78
CAP_MAIN, CAP_THUMB = 120 * 1024, 10 * 1024
HEADROOM = 0.06                # 头顶留白 6%（与美术交付说明一致）


def frame(im, size):
    """统一画框：cover 缩放 + 水平居中 + 顶部对齐（保住头部，下巴留边）。

    crossfade 是同一像素位置两张图互淡，4 张画框必须一致，否则会「跳头」。
    """
    sw, sh = size
    s = max(sw / im.width, sh / im.height)
    nw, nh = round(im.width * s), round(im.height * s)
    im = im.resize((nw, nh), Image.LANCZOS)
    left = (nw - sw) // 2
    top = min(round(nh * HEADROOM), max(0, nh - sh))
    return im.crop((left, top, left + sw, top + sh))


def emit(im, dst, size, q, cap, label):
    frame(im, size).save(dst, "WEBP", quality=q, method=6)
    n = dst.stat().st_size
    flag = "  <<< 超上限" if n > cap else ""
    print(f"  {label:28s} {size[0]}x{size[1]:<4d} {n / 1024:7.1f} KB{flag}")
    return n


def convert_legacy(report_only=False):
    total = 0
    for cid, fn in LEGACY.items():
        src = SRC / fn
        if not src.exists():
            print(f"  skip {fn}（不存在）")
            continue
        with Image.open(src) as raw:
            im = raw.convert("RGB")
            d = OUT / cid
            if not report_only:
                d.mkdir(parents=True, exist_ok=True)
                total += emit(im, d / "calm.webp", PORTRAIT, Q_MAIN, CAP_MAIN, f"{cid}/calm.webp")
                total += emit(im, d / "thumb.webp", THUMB, Q_THUMB, CAP_THUMB, f"{cid}/thumb.webp")
            else:
                for name, size, q in (("calm.webp", PORTRAIT, Q_MAIN), ("thumb.webp", THUMB, Q_THUMB)):
                    p = d / name
                    if p.exists():
                        total += p.stat().st_size
                        print(f"  {cid}/{name:10s} {p.stat().st_size / 1024:7.1f} KB")
    return total


def convert_inbox(report_only=False):
    """增量表情：_inbox/{char_id}_{state}.png → portrait/{char_id}/{state}.webp。

    例：L1_A_smug.png → portrait/L1_A/smug.webp
    """
    if not INBOX.exists():
        print(f"  _inbox 不存在（{INBOX}），跳过")
        return 0
    total = 0
    for p in sorted(INBOX.glob("*.png")):
        stem = p.stem
        if "_" not in stem:
            print(f"  skip {p.name}（命名应为 {{char_id}}_{{state}}.png）")
            continue
        cid, st = stem.rsplit("_", 1)
        with Image.open(p) as raw:
            im = raw.convert("RGB")
            d = OUT / cid
            if not report_only:
                d.mkdir(parents=True, exist_ok=True)
                total += emit(im, d / f"{st}.webp", PORTRAIT, Q_MAIN, CAP_MAIN, f"{cid}/{st}.webp")
    return total


def main():
    ap = argparse.ArgumentParser(description="立绘资产压缩管线（PNG → WebP）")
    ap.add_argument("--inbox", action="store_true", help="只转换 _inbox 下的增量表情")
    ap.add_argument("--report", action="store_true", help="只打印体积报表，不写文件")
    a = ap.parse_args()

    print(f"源目录 {SRC}")
    print(f"输出目录 {OUT}")
    total = convert_inbox() if a.inbox else convert_legacy(a.report)
    if not a.inbox and not a.report:
        print("  -- 缩略图与主图已就绪 --")
    print(f"合计 {total / 1024:.1f} KB（主图上硬闸 {CAP_MAIN / 1024:.0f}KB / 缩略图 {CAP_THUMB / 1024:.0f}KB）")
    if total > 600 * 1024:
        print("  ⚠ 总量超过 600KB 预算，检查画框与质量参数")


if __name__ == "__main__":
    main()
