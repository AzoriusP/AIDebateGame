# -*- coding: utf-8 -*-
"""思考模式（thinking）开关基准测试。

用项目真实 prompt（judge 判定 / npc 回复）打本地 Ollama，对比 think=True / False 的
输出 token、耗时与内容，评估"关掉思考"能省多少、以及质量掉不掉。

用法：
    python bench_thinking.py --model qwen3.5:latest --repeat 3
    python bench_thinking.py --quick            # 每个任务只跑 1 条，快速探活
"""
import argparse
import json
import sys
import time
import urllib.request

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parents[1]))
import server  # noqa: E402  （导入只为复用真实 prompt 构造函数）

OLLAMA = server.OLLAMA_BASE

JUDGE_CASES = [
    "根据国家统计局的数据，晚婚家庭的子女教育水平反而更高，你这套说法没依据。",
    "被逼着结婚的是你女儿，你忍心吗？",
    "你就是个老顽固，跟你废话没用。",
]

NPC_CASES = [
    "阿姨，结婚早晚是个人选择，凭什么说不结婚就是自私？",
    "你说年轻人自私，可我月薪五千还要还房租，拿什么结婚？你给我出钱啊？",
    "您那套经验是三十年前的，现在房价多少您知道吗？",
]


def call(messages, model, think, max_tokens, temperature=0.7, timeout=600):
    body = {
        "model": model,
        "messages": messages,
        "stream": False,
        "think": bool(think),
        "keep_alive": "30m",
        "options": {"temperature": temperature, "num_predict": int(max_tokens)},
    }
    req = urllib.request.Request(
        OLLAMA.rstrip("/") + "/api/chat",
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    t0 = time.monotonic()
    with urllib.request.urlopen(req, timeout=timeout) as r:
        resp = json.loads(r.read().decode("utf-8"))
    return resp, time.monotonic() - t0


def build_judge(npc, topic, player_text):
    dims = npc.get("dimensions", {})
    sys_prompt = server._judge_system_prompt(npc, topic, dims)
    return [
        {"role": "system", "content": sys_prompt},
        {"role": "user", "content": "【待判定的玩家原话】\n\"" + player_text + "\""},
    ]


def build_npc(npc, topic, player_text, history_tail=()):
    sys_prompt = server._npc_system_prompt(
        npc, topic, confidence=70, beat="反驳",
        recent_self_lines=list(history_tail),
    )
    msgs = [{"role": "system", "content": sys_prompt}]
    msgs.append({"role": "user", "content": player_text})
    return msgs


def run_case(name, messages, model, think, max_tokens):
    resp, dt = call(messages, model, think, max_tokens)
    msg = resp.get("message", {})
    content = server._clean_llm_text(msg.get("content", ""))
    thinking = msg.get("thinking") or ""
    return {
        "task": name,
        "think": think,
        "prompt_tokens": resp.get("prompt_eval_count", 0),
        "output_tokens": resp.get("eval_count", 0),
        "think_chars": len(thinking),
        "content_chars": len(content),
        "seconds": round(dt, 2),
        "content": content[:160],
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=server.NPC_MODEL)
    ap.add_argument("--repeat", type=int, default=3)
    ap.add_argument("--quick", action="store_true")
    ap.add_argument("--max-tokens", type=int, default=1200, help="非思考模式输出上限")
    ap.add_argument("--think-max-tokens", type=int, default=1200, help="思考模式输出上限（思考链+正文共享）")
    args = ap.parse_args()
    if args.quick:
        args.repeat = 1

    npcs = server._NPCS if hasattr(server, "_NPCS") else None
    if npcs is None:
        import pathlib
        npcs = json.loads((pathlib.Path(server.DATA) / "npcs.json").read_text(encoding="utf-8"))
    npc = next((n for n in npcs if n.get("npc_id") == "L1_A"), npcs[0])
    topic = next((t for t in server._TOPICS if t.get("id") == "T101"), server._TOPICS[0]) \
        if hasattr(server, "_TOPICS") and server._TOPICS else None
    if topic is None:
        import pathlib
        topic = json.loads((pathlib.Path(server.DATA) / "topics.json").read_text(encoding="utf-8"))[0]
    topic = dict(topic)
    topic.setdefault("npc_stance", npc.get("stance_bias") == "pro" and "支持" or "反对")

    rows = []
    for i in range(args.repeat):
        for think in (False, True):
            budget = args.think_max_tokens if think else args.max_tokens
            rows.append(run_case("judge", build_judge(npc, topic, JUDGE_CASES[i % len(JUDGE_CASES)]),
                                 args.model, think, budget))
        for think in (False, True):
            budget = args.think_max_tokens if think else args.max_tokens
            hist = ["我吃的盐比你走的路多，年轻人就是被惯坏了。"] if i else []
            rows.append(run_case("npc", build_npc(npc, topic, NPC_CASES[i % len(NPC_CASES)], hist),
                                 args.model, think, budget))
        print(f"[case {i+1}/{args.repeat}] done", flush=True)

    print("\n=== 明细 ===")
    for r in rows:
        print(f"{r['task']:5s} think={str(r['think']):5s} "
              f"in={r['prompt_tokens']:5d} out={r['output_tokens']:5d} "
              f"think_chars={r['think_chars']:5d} body={r['content_chars']:4d} "
              f"{r['seconds']:6.2f}s | {r['content'][:60]}")

    print("\n=== 汇总（均值）===")
    for task in ("judge", "npc"):
        for think in (False, True):
            sub = [r for r in rows if r["task"] == task and r["think"] == think]
            if not sub:
                continue
            n = len(sub)
            print(f"{task:5s} think={str(think):5s} "
                  f"out_tok_avg={sum(r['output_tokens'] for r in sub)/n:8.1f} "
                  f"time_avg={sum(r['seconds'] for r in sub)/n:6.2f}s "
                  f"body_chars_avg={sum(r['content_chars'] for r in sub)/n:6.1f}")

    out = __import__("pathlib").Path(__file__).with_name("bench_thinking_result.json")
    out.write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\n结果已写 {out}")


if __name__ == "__main__":
    main()
