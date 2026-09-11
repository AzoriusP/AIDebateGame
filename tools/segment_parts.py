"""rembg 抠图：把 ImageGen 生成的灰底部件图抠成透明背景。
用法: python tools/segment_parts.py [输入目录]
依赖: rembg + onnxruntime（装在本项目 venv）
"""
import pathlib
import sys

try:
    from rembg import remove, new_session
except ImportError:
    print("缺少 rembg，先安装：pip install rembg onnxruntime")
    sys.exit(1)

from PIL import Image

SRC = pathlib.Path(__file__).resolve().parents[1] / "design" / "art-output" / "parts"
DST = SRC / "transparent"


def main():
    pngs = sorted(SRC.glob("*.png"))
    if not pngs:
        print(f"无输入图：{SRC}")
        return
    DST.mkdir(exist_ok=True)
    session = new_session("u2net")  # 通用抠图模型，首次运行会下载 ~170MB
    for f in pngs:
        im = Image.open(f).convert("RGBA")
        out = remove(im, session=session)
        # 把透明结果存为 PNG（保留 alpha）
        dst = DST / f.name
        out.save(dst)
        # 统计透明占比
        import numpy as np
        a = out.getchannel("A")
        transparent = (np.array(a) < 10).mean()
        print(f"  {f.name[:30]}... 透明占比 {transparent:.1%} -> {dst.name}")


if __name__ == "__main__":
    main()
