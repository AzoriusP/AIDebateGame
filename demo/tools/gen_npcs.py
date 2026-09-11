#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
《抬杠模拟器》NPC 批量生成流水线（AI-generate 配置阶段用）
==========================================================
配置 NPC 时用 LLM 一次性生成一批候选，供策划审核挑选后进入表格。
运行时游戏不依赖此脚本——它只负责"生产人设候选"。

用法（在 demo/ 目录下）：
    python tools/gen_npcs.py                  # 5 层各生成 3 个 → data/npc_candidates.json
    python tools/gen_npcs.py --tier 2 --n 5   # 只生成第 2 层 5 个
    python tools/gen_npcs.py --out my.csv     # 输出 CSV（可直接用 Excel 审阅）

依赖：本地 Ollama（或任意 OpenAI 兼容 endpoint），默认读 demo/config.json。
"""
import argparse
import json
import re
import sys
import time
import urllib.request
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent

DIM = ["LOGIC", "EVIDENCE", "EMOTION", "UTILITY", "IDENTITY", "AUTHORITY"]
LAYER_DOMAINS = {1: ["家庭", "消费", "养生"], 2: ["职场", "理财", "消费"],
                 3: ["科技", "网络", "社会"], 4: ["法律", "社会", "教育"],
                 5: ["科技", "哲学", "教育"]}
TOKEN_BY_TIER = {1: 420, 2: 380, 3: 340, 4: 300, 5: 280}
ALLOWED = ["LOGIC", "EVIDENCE", "EMOTION", "UTILITY", "IDENTITY", "AUTHORITY"]


def load_llm_conf():
    cfg = json.loads((BASE / "config.json").read_text(encoding="utf-8"))
    base = cfg.get("ollama_base", "http://localhost:11434")
    model = cfg.get("model", cfg.get("npc_model", "qwen3.5:latest"))
    return base, model


def llm_json(messages, base, model, timeout=240):
    """调 Ollama 原生 /api/chat，关闭 thinking，要求 JSON 输出。"""
    body = {"model": model, "messages": messages, "stream": False,
            "think": False, "options": {"temperature": 0.9}, "format": "json"}
    req = urllib.request.Request(base.rstrip("/") + "/api/chat",
                                 data=json.dumps(body).encode("utf-8"),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        resp = json.loads(r.read().decode("utf-8"))
    text = resp["message"]["content"]
    try:
        return json.loads(text)
    except Exception:
        m = re.search(r"\{.*\}", text, re.S)
        if m:
            try:
                return json.loads(m.group(0))
            except Exception:
                pass
    return None


def build_prompt(tier, domains, n, existing_names):
    used = "、".join(existing_names[-8:]) or "（无）"
    return f"""你是游戏 NPC 人设设计师，为《抬杠模拟器》（用文字说服 AI 的辩论游戏）批量创作第 {tier} 层的对手候选。

【难度层 {tier}】该层 token 配额 {TOKEN_BY_TIER[tier]}；可辩领域：{'/'.join(domains)}。人设需多样化且有记忆点（职业、年龄、性格、腔调都要不同，避免和已有角色重复：{used}）。

【每人字段】
- name: 中文名或昵称（2~4 字，好记）
- persona: 一句话定位（如"某赛道上的毒舌教练"）
- background: 2~3 句背景，解释 TA 为什么强烈坚持这类观点
- dimensions: 六维 0-10 整数（LOGIC 逻辑/EVIDENCE 证据/EMOTION 情感/UTILITY 利益/IDENTITY 认同/AUTHORITY 权威），要符合人设且有高低差异
- weakness: 1~3 个最弱维度（其维度值必须 ≤ 3）
- strength: 1~3 个最强维度（其维度值必须 ≥ 7，且与 weakness 不重叠）
- speech_style: 说话风格一句话
- language_habits: 口头禅/口头语（1~2 个，有辨识度）
- rebuttal_style: 被反驳时的惯用招数
- match_domains: 从 {domains} 里选 TA 最熟的 2~3 个领域

【铁律】weakness 里的维度值≤3、strength 里的维度值≥7；一个维度不能同时进 weakness 和 strength；六维数字必须自洽（weakness 是最低的、strength 是最高的）。

输出严格 JSON：{{"npcs": [ {n} 个对象，结构：{{"name","persona","background","dimensions":{{LOGIC,EVIDENCE,EMOTION,UTILITY,IDENTITY,AUTHORITY}},"weakness":[...],"strength":[...],"speech_style","language_habits","rebuttal_style","match_domains":[...]}} ]}}"""


def clean(c):
    """后处理：保证 weakness≤3 / strength≥7 / 不重叠 / 字段齐全。"""
    dims = {k: max(0, min(10, int(v))) for k, v in c.get("dimensions", {}).items()}
    for k in DIM:
        dims.setdefault(k, 5)
    weak = [w.upper() for w in c.get("weakness", []) if w in ALLOWED]
    strong = [s.upper() for s in c.get("strength", []) if s in ALLOWED]
    weak = list(dict.fromkeys(weak))
    strong = [s for s in dict.fromkeys(strong) if s not in weak]
    if not weak:
        weak = ["EMOTION"]
    if not strong:
        strong = ["LOGIC"]
    for w in weak:
        if dims[w] > 3:
            dims[w] = 3
    for s in strong:
        if dims[s] < 7:
            dims[s] = 7
    c["dimensions"] = dims
    c["weakness"] = weak[:3]
    c["strength"] = strong[:3]
    if not c.get("match_domains"):
        c["match_domains"] = LAYER_DOMAINS[tier if "tier" in c else 1][:2]
    for f in ("persona", "background", "speech_style", "language_habits", "rebuttal_style"):
        v = c.get(f)
        if isinstance(v, (list, tuple)):
            if f == "language_habits":
                v = "".join(f"「{x}」" for x in v)
            else:
                v = "、".join(str(x) for x in v)
        c[f] = str(v or "")
    return c


def gen_tier(base, model, tier, n, existing_names):
    domains = LAYER_DOMAINS[tier]
    out = []
    for attempt in range(2):
        obj = llm_json([{"role": "user", "content": build_prompt(tier, domains, n, existing_names)}], base, model)
        items = (obj or {}).get("npcs", [])
        if not items:
            print(f"  L{tier}: LLM 未返回数组，重试..."); time.sleep(1); continue
        for c in items:
            if c.get("name"):
                clean(c)
                c["npc_id"] = f"L{tier}_{chr(65 + len(out))}"
                c["tier"] = tier
                c["token_quota"] = TOKEN_BY_TIER[tier]
                c["drift_personality"] = {"vigilance_mult": round(0.8 + 0.15 * (tier - 1), 2),
                                          "abandon_mult": round(max(0.6, 1.0 - 0.1 * (tier - 1)), 2)}
                c["logic_bias"] = c["dimensions"]["LOGIC"]
                c["emotion_bias"] = c["dimensions"]["EMOTION"]
                out.append(c)
                existing_names.append(c["name"])
        if out:
            break
    return out


def to_csv_row(c):
    d = c["dimensions"]
    return [c["npc_id"], c["name"], c["tier"], c["persona"], c["background"],
            d["LOGIC"], d["EVIDENCE"], d["EMOTION"], d["UTILITY"], d["IDENTITY"], d["AUTHORITY"],
            ";".join(c["weakness"]), ";".join(c["strength"]),
            c["speech_style"], c["language_habits"], c["rebuttal_style"],
            c["drift_personality"]["vigilance_mult"], c["drift_personality"]["abandon_mult"],
            ";".join(c["match_domains"]), c["logic_bias"], c["emotion_bias"], c["token_quota"]]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tier", type=int, default=None)
    ap.add_argument("--n", type=int, default=3, help="每层生成数量")
    ap.add_argument("--out", default=str(BASE / "data" / "npc_candidates.json"))
    args = ap.parse_args()
    base, model = load_llm_conf()
    print(f"模型: {model} @ {base}")
    tiers = [args.tier] if args.tier else sorted(LAYER_DOMAINS)
    # 读取现有 NPC 名，避免重复
    existing = []
    try:
        npcs = json.loads((BASE / "data" / "npcs.json").read_text(encoding="utf-8"))
        existing = [n["name"] for n in npcs]
    except Exception:
        pass
    allc = []
    for tier in tiers:
        print(f"生成 L{tier}（领域：{'/'.join(LAYER_DOMAINS[tier])}）...")
        got = gen_tier(base, model, tier, args.n, existing)
        print(f"  L{tier} 获得 {len(got)} 个候选")
        allc.extend(got)
    if not allc:
        print("未生成任何候选，请检查模型/网络。"); sys.exit(1)
    path = Path(args.out)
    path.write_text(json.dumps(allc, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n已写入 {path}（共 {len(allc)} 个候选）")
    if str(path).lower().endswith(".csv"):
        import csv
        with open(path, "w", newline="", encoding="utf-8-sig") as f:
            w = csv.writer(f)
            w.writerow(["npc_id", "name", "tier", "persona", "background", "logic", "evidence",
                        "emotion", "utility", "identity", "authority", "weakness", "strength",
                        "speech_style", "language_habits", "rebuttal_style", "vigilance_mult",
                        "abandon_mult", "match_domains", "logic_bias", "emotion_bias", "token_quota"])
            for c in allc:
                w.writerow(to_csv_row(c))
        print("已同时输出 CSV 版本（Excel 可审）")


if __name__ == "__main__":
    main()
