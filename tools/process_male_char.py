"""把男性角色 4 表情处理成透明 webp，入库 demo/static/assets/portrait/player/。
流程：rembg 抠透明 -> 缩 576x864(2:3) -> webp q80
"""
import pathlib
from PIL import Image
from rembg import remove, new_session
import numpy as np

SRC = pathlib.Path(r"G:\WBSpace\AIDebate\design\art-output\male_char")
DST = pathlib.Path(r"G:\WBSpace\AIDebate\demo\static\assets\portrait\player")
DST.mkdir(parents=True, exist_ok=True)

STATES = ["calm", "tense", "anxious", "desperate"]
W, H = 576, 864

session = new_session("u2net")


def frame(im):
    """2:3 画框：cover 缩放 + 水平居中 + 顶部对齐。"""
    s = max(W / im.width, H / im.height)
    nw, nh = round(im.width * s), round(im.height * s)
    im = im.resize((nw, nh), Image.LANCZOS)
    left = (nw - W) // 2
    top = min(round(nh * 0.06), max(0, nh - H))
    return im.crop((left, top, left + W, top + H))


for st in STATES:
    src = SRC / f"{st}.png"
    if not src.exists():
        print(f"  skip {st} (不存在)")
        continue
    im = Image.open(src).convert("RGBA")
    cut = remove(im, session=session)  # 抠透明
    a = np.array(cut.getchannel("A"))
    print(f"  {st}: 抠图后透明占比 {(a<30).mean():.1%}")
    framed = frame(cut)
    dst = DST / f"{st}.webp"
    framed.save(dst, "WEBP", quality=80, method=6)  # 保留 RGBA alpha
    print(f"  {st} -> {dst.name} ({dst.stat().st_size//1024}KB)")

print("完成")
