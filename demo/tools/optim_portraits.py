"""把现有 6 张 PNG 转成统一画框的 WebP 立绘 + 缩略图。
用法: python demo/tools/optim_portraits.py   (幂等，可重复跑)
"""
import pathlib
from PIL import Image

SRC = pathlib.Path(__file__).resolve().parents[1] / "static" / "assets"
OUT = SRC / "portrait"
# npc_id <-> 旧文件名（当前 5 NPC 与 tier 一一对应；扩到 15 NPC 时在此表追加）
LEGACY = {"L1_A": "npc_t1.png", "L2_A": "npc_t2.png", "L3_A": "npc_t3.png",
          "L4_A": "npc_t4.png", "L5_A": "npc_t5.png", "player": "player.png"}
PORTRAIT, THUMB, Q = (576, 864), (128, 192), 80
CAP = 120 * 1024          # 单张硬上限


def frame(im, size):
    """统一画框：cover 缩放 + 水平居中 + 顶部对齐(保留头部)。"""
    sw, sh = size
    s = max(sw / im.width, sh / im.height)
    nw, nh = round(im.width * s), round(im.height * s)
    im = im.resize((nw, nh), Image.LANCZOS)
    left = (nw - sw) // 2
    top = min(round(nh * 0.06), max(0, nh - sh))   # 头顶留白 6%
    return im.crop((left, top, left + sw, top + sh))


def main():
    OUT.mkdir(exist_ok=True)
    for cid, fn in LEGACY.items():
        src = SRC / fn
        if not src.exists():
            print(f"  skip {fn} (不存在)")
            continue
        im = Image.open(src).convert("RGB")
        (OUT / cid).mkdir(parents=True, exist_ok=True)
        for name, size, q in (("calm.webp", PORTRAIT, Q), ("thumb.webp", THUMB, 78)):
            dst = OUT / cid / name
            frame(im, size).save(dst, "WEBP", quality=q, method=6)
            kb = dst.stat().st_size / 1024
            flag = "  [WARN 超上限]" if name == "calm.webp" and dst.stat().st_size > CAP else ""
            print(f"  {cid}/{name:10s} {size[0]}x{size[1]}  {kb:6.1f} KB{flag}")


if __name__ == "__main__":
    main()
