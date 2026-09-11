#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""LLM token 消耗探针（只读工具：不改 server.py，只导入并 monkey-patch _chat 采集真实 prompt）

原理：
  1. 复用 server.py 真实的 prompt 构造函数（_judge_system_prompt / _npc_system_prompt /
     _retrospect / _gen_memory / _generate_hint / _concede_line），不做任何估算性重写。
  2. monkey-patch `server._chat`，把每次真实发出的 messages 抓下来，返回桩内容。
  3. 用 new_session + process_message 驱动一整局，得到"每回合 + 附加调用"的真实输入。

换算：中文 1.5 字/token、ASCII 4 字符/token（保守值，报告里给 ±20% 敏感带）。
运行：python tools/token_probe.py
"""
import json
import random
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE))

ZH_CHARS_PER_TOKEN = 1.5
ASCII_CHARS_PER_TOKEN = 4.0
MSG_OVERHEAD = 7      # role/分隔符封装
REPLY_PRIMER = 3      # 回复引导 + 收尾

# 桩输出（模拟真实 LLM 返回长度）
PLAYER_CHARS = 40     # 玩家单条 20~80 字，取中位
NPC_OUT_CHARS = 100   # NPC 单条 60~150 字，取中位
JUDGE_OUT = '{"dimension": "EVIDENCE", "strength": "L2", "confidence": 0.8}'
NPC_OUT = "数" * NPC_OUT_CHARS
RETRO_OUT = 140
MEM_OUT = 50
HINT_OUT = 60

CALLS = []   # [(tag, messages, out_chars)]


def est_tokens(text: str) -> int:
    if not text:
        return 0
    zh = sum(1 for c in text if "\u4e00" <= c <= "\u9fff")
    other = len(text) - zh
    return int(round(zh / ZH_CHARS_PER_TOKEN + other / ASCII_CHARS_PER_TOKEN))


def msgs_tokens(messages) -> int:
    return sum(est_tokens(m.get("content", "") or "") + MSG_OVERHEAD
               for m in messages) + REPLY_PRIMER


def _classify(messages) -> str:
    """按 prompt 特征串区分调用类型（顺序敏感：先长后短）。"""
    blob = "\n".join((m.get("content") or "")[:2000] for m in messages)
    if "【待判定的玩家原话】" in blob:
        return "judge"
    if "刚看完一场辩论" in blob:
        return "retrospect"
    if "用第一人称写一句话" in blob:
        return "memory"
    if "破防认输" in blob:
        return "concede"
    if "玩家现在卡住了" in blob:
        return "hint"
    if "【当前辩论】" in blob:
        return "npc"
    return "other"


def _fake_chat(messages, model, json_mode=False, timeout=180, max_tokens=None):
    tag = _classify(messages)
    out = {"judge": len(JUDGE_OUT), "retrospect": RETRO_OUT, "memory": MEM_OUT,
           "hint": HINT_OUT, "concede": 70, "npc": NPC_OUT_CHARS}.get(tag, 100)
    CALLS.append((tag, [dict(m) for m in messages], out))
    if tag == "judge":
        # 打在 NPC 强项上（+4 自信度、被 100 上限截断），保证对局能跑满目标回合数
        return '{"dimension": "%s", "strength": "L2", "confidence": 0.8}' % JUDGE_DIM
    return "数" * out


def run_game(turns: int, tier: int = 1, hint: bool = True):
    global JUDGE_DIM
    import server as S
    S.LLM_MODE = "openai"          # 走 _chat（mock 模式会跳过 LLM）
    S._chat = _fake_chat
    S.sessions.clear()
    CALLS.clear()
    r = S.new_session(tier=tier, npc_id=None, memory_on=True)
    npc = S.sessions[r["sid"]]["npc"]
    JUDGE_DIM = (npc.get("strength") or ["LOGIC"])[0]
    sid = r["sid"]
    for i in range(turns):
        S.process_message(sid, "据" * PLAYER_CHARS)
        if S.sessions[sid]["result"] != "ONGOING":
            break
    if hint:
        S.hint_session(sid)
    S.timeout_session(sid)          # 强制收尾 → 触发复盘 + 记忆
    return [dict(tag=t, in_tok=msgs_tokens(m), out_tok=est_tokens("数" * o),
                 chars=sum(len(x.get("content") or "") for x in m))
            for t, m, o in CALLS]


JUDGE_DIM = "LOGIC"


def main():
    print("=" * 92)
    print("《辩弈》LLM token 消耗实测探针   （中文 1.5 字/token，ASCII 4 字符/token，含消息封装开销）")
    print("=" * 92)

    summary = {}
    for turns in (10, 15, 20):
        calls = run_game(turns)
        agg = {}
        for c in calls:
            a = agg.setdefault(c["tag"], {"n": 0, "in": 0, "out": 0, "chars": 0})
            a["n"] += 1; a["in"] += c["in_tok"]; a["out"] += c["out_tok"]; a["chars"] += c["chars"]
        print(f"\n--- 单局 {turns} 回合（含局终复盘 + 记忆 + 1 次教练提示）---")
        print(f"{'调用类型':<12}{'次数':>6}{'输入token':>12}{'输出token':>12}"
              f"{'单次输入(均)':>14}{'单次输入字符(均)':>18}")
        for k in ("judge", "npc", "hint", "retrospect", "memory"):
            if k not in agg:
                continue
            a = agg[k]
            print(f"{k:<12}{a['n']:>6}{a['in']:>12}{a['out']:>12}"
                  f"{a['in']//a['n']:>14}{a['chars']//a['n']:>18}")
        ti = sum(a["in"] for a in agg.values())
        to = sum(a["out"] for a in agg.values())
        summary[turns] = {"in": ti, "out": to, "detail": agg}
        print(f"{'合计':<12}{sum(a['n'] for a in agg.values()):>6}{ti:>12}{to:>12}")

    print("\n" + "=" * 92)
    print("汇总：单局 token 消耗")
    print("=" * 92)
    print(f"{'回合数':>6}{'输入 token':>14}{'输出 token':>14}{'合计':>14}{'每回合输入(均)':>16}")
    for t, v in summary.items():
        print(f"{t:>6}{v['in']:>14}{v['out']:>14}{v['in']+v['out']:>14}{v['in']//t:>16}")

    (BASE / "tools" / "token_probe_out.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=1), encoding="utf-8")
    print("\n已写出 demo/tools/token_probe_out.json")


if __name__ == "__main__":
    main()
