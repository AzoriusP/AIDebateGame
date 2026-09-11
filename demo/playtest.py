#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
《辩弈》数值推演脚本（不依赖 LLM，纯数值模拟）
==============================================
测算 5 个 NPC 的通关回合数与 token 紧张度，辅助数值校准。
用法：python playtest.py
"""
import json
from pathlib import Path

BASE = Path(__file__).resolve().parent
NPCS = json.loads((BASE / "data" / "npcs.json").read_text(encoding="utf-8"))

DIM_LABELS = {"LOGIC": "逻辑", "EVIDENCE": "证据", "EMOTION": "情感",
              "UTILITY": "利益", "IDENTITY": "认同", "AUTHORITY": "权威"}

# 对齐 server.py 的 CONFIDENCE_DELTA / token 经济
DELTA = {
    "weak":   {"L3": -40, "L2": -20, "L1": -8},
    "normal": {"L3": -18, "L2": -9,  "L1": -3},
    "strong": {"L3": +8,  "L2": +4,  "L1": 0},
    "L0": 0,
}
TOKEN_BASE = 20
TOKEN_FREE = 60
TOKEN_PER_CHAR = 1
TOKEN_L0_PENALTY = 10
ARG_LEN = 50  # 假设平均论点 50 字 → 未超 60 字免费线，仅扣底扣

def run(npc, strategy):
    """strategy(turn) -> (delta_conf, is_l0)。返回 (回合数, 剩余token, 是否说服成功)。"""
    conf = 100
    token = npc["token_quota"]
    turns = 0
    l0_streak = 0
    base_cost = TOKEN_BASE
    while conf > 0 and token > 0 and turns < 20:
        turns += 1
        delta, is_l0 = strategy(turns)
        cost = base_cost + max(0, ARG_LEN - TOKEN_FREE) * TOKEN_PER_CHAR
        if is_l0:
            cost += TOKEN_L0_PENALTY
            l0_streak += 1
            if l0_streak >= 2:
                base_cost = TOKEN_BASE * 2
        else:
            l0_streak = 0
            base_cost = TOKEN_BASE
        conf = max(0, conf + delta)
        token -= cost
    return turns, int(token), conf <= 0

STRATEGIES = {
    "全L3命中": lambda t: (DELTA["weak"]["L3"], False),
    "全L2命中": lambda t: (DELTA["weak"]["L2"], False),
    "L2/L0交替": lambda t: (DELTA["weak"]["L2"], False) if t % 2 == 1 else (0, True),
    "打强项L2": lambda t: (DELTA["strong"]["L2"], False),
}

print("=" * 88)
print("《辩弈》数值推演 — 5 层天梯通关回合 / token 余量（论点按 50 字计）")
print("=" * 88)
for n in NPCS:
    weak = "、".join(DIM_LABELS[k] for k in n["weakness"])
    strong = "、".join(DIM_LABELS[k] for k in n["strength"])
    print(f"\n■ L{n['tier']} {n['name']}（token {n['token_quota']}）软肋[{weak}] 强项[{strong}]")
    for sname, strat in STRATEGIES.items():
        turns, token, win = run(n, strat)
        tag = "胜" if win else "败"
        print(f"   {sname:<10} → {turns:>2} 回合，余 token {token:>4}，{tag}")
    # 关键指标：全 L2 命中的 token 余量（越接近 0 越极限）
    _, token_l2, _ = run(n, STRATEGIES["全L2命中"])
    stress = "极限" if token_l2 < 30 else ("紧张" if token_l2 < 80 else "宽松")
    print(f"   ▶ 全 L2 命中余 token {token_l2} → 难度感：{stress}")
print("\n" + "=" * 88)
print("校准提示：token 余量 < 30 意味着玩家几乎不能失误；> 150 则挑战感不足。")
print("=" * 88)
