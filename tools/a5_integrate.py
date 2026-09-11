"""A5 接入游戏：表情图 → webp 落盘 + 更新 characters.json 的 portraits。

关键：前端 normalizeEmotion 会把中文情绪映射成英文别名，且 NPC 侧常用
smug / shaken / defeated 三个键（见 character-performance.js 的 ALIASES）。
所以 portraits 必须同时写「基础键 + 别名键」，否则取图失败会静默回退到 calm：

    calm / tense / anxious / desperate          ← 基础键（玩家侧情绪档位）
    smug→calm / shaken→tense / defeated→desperate ← NPC 侧别名键

用法：
  python tools/a5_integrate.py            # 正式接入（会备份 characters.json）
  python tools/a5_integrate.py --dry-run  # 只看计划，不写文件
"""
import argparse
import json
import os
import shutil
from PIL import Image

GEN = r"G:/WBSpace/AIDebate/outputs/a5_emotions"
CHAR_DIR = r"G:/WBSpace/AIDebate/demo/static"
PORTRAIT_DIR = r"G:/WBSpace/AIDebate/demo/static/assets/portrait"
CHARS_JSON = os.path.join(CHAR_DIR, "characters.json")

NPCS = ["L1_A", "L2_A", "L3_A", "L4_A", "L5_A"]
# 生成的模式后缀（当前用 masked）
SRC_SUFFIX = "_masked.png"
# 新表情 → 对应的基础键
NEW_STATES = {"tense": "tense", "anxious": "anxious", "desperate": "desperate"}
# 别名键 → 落到的实际文件（前端 normalizeEmotion 产物）
ALIAS_OF = {"smug": "calm", "shaken": "tense", "defeated": "desperate"}

WEBP_QUALITY = 88
WEBP_METHOD = 6


def convert(npc, state, src_png):
    im = Image.open(src_png).convert("RGB")
    dst = os.path.join(PORTRAIT_DIR, npc, f"{state}.webp")
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    im.save(dst, "WEBP", quality=WEBP_QUALITY, method=WEBP_METHOD)
    return dst


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    with open(CHARS_JSON, encoding="utf-8") as f:
        data = json.load(f)

    plan = []
    for npc in NPCS:
        for state in NEW_STATES:
            src = os.path.join(GEN, f"{npc}_{state}{SRC_SUFFIX}")
            if not os.path.isfile(src):
                plan.append((npc, state, None, "缺源图"))
                continue
            plan.append((npc, state, src, "待转换"))

    print("=== 转换计划 ===")
    for npc, state, src, note in plan:
        print(f"  {npc}/{state:10s} {note}  {os.path.basename(src) if src else ''}")
    missing = [p for p in plan if p[2] is None]
    if missing:
        print(f"\n[中止] {len(missing)} 张源图缺失，先跑 a5_run_comfy.py --all")
        return 1

    if args.dry_run:
        print("\n[dry-run] 未写任何文件")
        return 0

    # 备份
    bak = CHARS_JSON + ".bak"
    shutil.copyfile(CHARS_JSON, bak)
    print(f"\n[备份] {bak}")

    # 1) 转换 webp
    for npc, state, src, _ in plan:
        dst = convert(npc, state, src)
        print(f"[webp] {dst}")

    # 2) 更新 portraits
    for npc in NPCS:
        node = data["characters"][npc]
        ports = node.setdefault("portraits", {})
        for state in NEW_STATES:
            ports[state] = f"/static/assets/portrait/{npc}/{state}.webp"
        # 别名键 → 指向实际存在的图
        for alias, target in ALIAS_OF.items():
            ports[alias] = ports.get(target) or f"/static/assets/portrait/{npc}/{target}.webp"

    # 3) 玩家也补别名键（保持一致；玩家端口走 Live2D，portraits 为降级用）
    pnode = data["characters"].get("player")
    if pnode:
        pports = pnode.setdefault("portraits", {})
        for alias, target in ALIAS_OF.items():
            if target in pports:
                pports.setdefault(alias, pports[target])

    with open(CHARS_JSON, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"\n[更新] {CHARS_JSON}")
    for npc in NPCS:
        print(f"  {npc}: {sorted(data['characters'][npc]['portraits'].keys())}")
    print("\n[下一步] 重启后端（若改过 data/），刷新页面验证 NPC 情绪切换")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
