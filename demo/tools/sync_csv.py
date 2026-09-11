#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
《抬杠模拟器》数据表格化工具：npcs.json / topics.json <-> CSV
=============================================================
用法（在 demo/ 目录下）：
    python tools/sync_csv.py export   # JSON -> CSV（策划用 Excel 编辑 CSV）
    python tools/sync_csv.py import   # CSV  -> JSON（改完导回，需重启后端生效）

CSV 用 utf-8-sig 编码，Excel 直接打开不乱码。
"""
import csv
import json
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
DATA = BASE / "data"

DIM_ORDER = ["LOGIC", "EVIDENCE", "EMOTION", "UTILITY", "IDENTITY", "AUTHORITY"]
DIM_COLS = [d.lower() for d in DIM_ORDER]

NPC_HEADER = (["npc_id", "name", "tier", "persona", "background"]
              + DIM_COLS
              + ["weakness", "strength", "speech_style", "language_habits",
                 "rebuttal_style", "vigilance_mult", "abandon_mult",
                 "match_domains", "logic_bias", "emotion_bias", "token_quota"])

TOPIC_HEADER = ["id", "tier", "domain", "topic", "npc_stance", "target_stance", "weakness_hint"]


def npc_to_row(n):
    dims = n.get("dimensions", {})
    row = {
        "npc_id": n.get("npc_id", ""), "name": n.get("name", ""), "tier": n.get("tier", ""),
        "persona": n.get("persona", ""), "background": n.get("background", ""),
        **{c: dims.get(k, "") for k, c in zip(DIM_ORDER, DIM_COLS)},
        "weakness": ";".join(n.get("weakness", [])), "strength": ";".join(n.get("strength", [])),
        "speech_style": n.get("speech_style", ""), "language_habits": n.get("language_habits", ""),
        "rebuttal_style": n.get("rebuttal_style", ""),
        "vigilance_mult": n.get("drift_personality", {}).get("vigilance_mult", ""),
        "abandon_mult": n.get("drift_personality", {}).get("abandon_mult", ""),
        "match_domains": ";".join(n.get("match_domains", [])),
        "logic_bias": n.get("logic_bias", ""), "emotion_bias": n.get("emotion_bias", ""),
        "token_quota": n.get("token_quota", ""),
    }
    return [row.get(h, "") for h in NPC_HEADER]


def row_to_npc(row):
    d = dict(zip(NPC_HEADER, row))
    dims = {k.upper(): int(float(d[c]) if d[c] != "" else 5) for k, c in zip(DIM_ORDER, DIM_COLS)}
    return {
        "npc_id": d["npc_id"], "name": d["name"], "tier": int(float(d["tier"])),
        "persona": d["persona"], "background": d["background"],
        "dimensions": dims,
        "weakness": [x for x in str(d["weakness"]).split(";") if x],
        "strength": [x for x in str(d["strength"]).split(";") if x],
        "logic_bias": int(float(d["logic_bias"])), "emotion_bias": int(float(d["emotion_bias"])),
        "speech_style": d["speech_style"], "language_habits": d["language_habits"],
        "rebuttal_style": d["rebuttal_style"],
        "drift_personality": {
            "vigilance_mult": float(d["vigilance_mult"]), "abandon_mult": float(d["abandon_mult"])},
        "match_domains": [x for x in str(d["match_domains"]).split(";") if x],
        "token_quota": int(float(d["token_quota"])),
    }


def topic_to_row(t):
    return [t.get("id", ""), t.get("tier", ""), t.get("domain", ""), t.get("topic", ""),
            t.get("npc_stance", ""), t.get("target_stance", ""),
            ";".join(t.get("weakness_hint", []))]


def row_to_topic(row):
    d = dict(zip(TOPIC_HEADER, row))
    return {
        "id": d["id"], "tier": int(float(d["tier"])), "domain": d["domain"],
        "topic": d["topic"], "npc_stance": d["npc_stance"], "target_stance": d["target_stance"],
        "weakness_hint": [x for x in str(d["weakness_hint"]).split(";") if x],
    }


def export():
    npcs = json.loads((DATA / "npcs.json").read_text(encoding="utf-8"))
    topics = json.loads((DATA / "topics.json").read_text(encoding="utf-8"))
    with open(DATA / "npcs.csv", "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(NPC_HEADER)
        for n in npcs:
            w.writerow(npc_to_row(n))
    with open(DATA / "topics.csv", "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(TOPIC_HEADER)
        for t in topics:
            w.writerow(topic_to_row(t))
    print(f"已导出 npcs.csv ({len(npcs)} 行) 与 topics.csv ({len(topics)} 行) 到 data/")
    print("用 Excel 编辑后执行 import。")


def import_():
    npcs, topics = [], []
    with open(DATA / "npcs.csv", encoding="utf-8-sig") as f:
        r = csv.DictReader(f)
        if not set(NPC_HEADER).issubset(r.fieldnames or []):
            raise SystemExit("npcs.csv 表头不符，请先 export 再编辑")
        for row in r:
            if row.get("npc_id"):
                npcs.append(row_to_npc([row.get(h, "") for h in NPC_HEADER]))
    with open(DATA / "topics.csv", encoding="utf-8-sig") as f:
        r = csv.DictReader(f)
        if not set(TOPIC_HEADER).issubset(r.fieldnames or []):
            raise SystemExit("topics.csv 表头不符，请先 export 再编辑")
        for row in r:
            if row.get("id"):
                topics.append(row_to_topic([row.get(h, "") for h in TOPIC_HEADER]))
    # 一致性校验：weakness 维 ≤4、strength 维 ≥7
    for n in npcs:
        dims = n["dimensions"]
        for w in n["weakness"]:
            if dims.get(w, 5) > 4:
                dims[w] = 3
                print(f"  [修正] {n['name']} 的软肋 {w} 值>4 -> 3")
        for s in n["strength"]:
            if dims.get(s, 5) < 7:
                dims[s] = 7
                print(f"  [修正] {n['name']} 的强项 {s} 值<7 -> 7")
    (DATA / "npcs.json").write_text(json.dumps(npcs, ensure_ascii=False, indent=2), encoding="utf-8")
    (DATA / "topics.json").write_text(json.dumps(topics, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"已导回 npcs.json ({len(npcs)} 个) 与 topics.json ({len(topics)} 个)。")
    print("注意：请重启后端使改动生效。")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "export":
        export()
    elif cmd == "import":
        import_()
    else:
        print(__doc__)
