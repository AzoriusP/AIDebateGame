# -*- coding: utf-8 -*-
"""云端思考模式开关验证（腾讯 tokenhub / hy4-preview / glm-5.3-flash）。

目的：确认「关闭思考」的参数形态在本项目实际用的云端接口上是否生效，
以及 reasoning_tokens 到底占多少。只打少量请求，成本可忽略。

用法： python bench_thinking_cloud.py
"""
import json
import sys
import time
import urllib.request

sys.stdout.reconfigure(encoding="utf-8")

BASE = "https://tokenhub.tencentmaas.com/v1/chat/completions"
KEY = "sk-itZfFmYA3Vyj2uPdX4CVDgpzaRkXlXlkBfh7SDia7ZeR7FpF"

NPC_PROMPT = (
    "你是王阿姨，市井热心的退休大妈，在和玩家辩论「年轻人就该早点结婚生孩子」。\n"
    "玩家说：阿姨，结婚早晚是个人选择，凭什么说不结婚就是自私？\n"
    "用2~3句口语化中文强硬回怼，带情绪，每句不超过25字，不超过80字。"
)
JUDGE_PROMPT = (
    "判定玩家这句话属于哪个维度（LOGIC/EVIDENCE/EMOTION/UTILITY/IDENTITY/AUTHORITY/NULL）"
    "以及强度 L0~L3，只输出 JSON。\n"
    "话题：年轻人就该早点结婚生孩子。\n"
    "玩家原话：「根据国家统计局的数据，晚婚家庭的子女教育水平反而更高。」"
)


def run(tag, model, prompt, extra=None, max_tokens=None, timeout=200):
    body = {"model": model, "messages": [{"role": "user", "content": prompt}], "stream": False}
    if max_tokens:
        body["max_tokens"] = max_tokens
    if extra:
        body.update(extra)
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        BASE, data=data,
        headers={"Content-Type": "application/json", "Authorization": "Bearer " + KEY},
    )
    t0 = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            j = json.loads(r.read().decode("utf-8", "replace"))
        dt = time.monotonic() - t0
    except Exception as e:
        print(f"[{tag}] ERR {time.monotonic()-t0:.1f}s {repr(e)[:160]}")
        return None
    msg = j.get("choices", [{}])[0].get("message", {}) or {}
    usage = j.get("usage", {}) or {}
    det = usage.get("completion_tokens_details", {}) or {}
    content = msg.get("content") or ""
    reasoning = msg.get("reasoning_content") or ""
    print(f"[{tag}] {dt:5.1f}s model={model} "
          f"prompt_tok={usage.get('prompt_tokens')} out_tok={usage.get('completion_tokens')} "
          f"reasoning_tok={det.get('reasoning_tokens')} reason_chars={len(reasoning)} "
          f"body_chars={len(content)}")
    print("    body:", content[:110].replace("\n", " "))
    return {"tag": tag, "model": model, "seconds": round(dt, 1),
            "prompt_tokens": usage.get("prompt_tokens"), "out_tokens": usage.get("completion_tokens"),
            "reasoning_tokens": det.get("reasoning_tokens"), "body_chars": len(content),
            "body": content[:200]}


def judge_only():
    """只跑判定任务对照：判定这种短分类任务，思考到底值不值。"""
    rows = []
    rows.append(run("hy4 judge thinking.enabled", "hy4-preview", JUDGE_PROMPT,
                    extra={"thinking": {"type": "enabled"}}, max_tokens=2400))
    rows.append(run("hy4 judge thinking.disabled", "hy4-preview", JUDGE_PROMPT,
                    extra={"thinking": {"type": "disabled"}}, max_tokens=400))
    rows.append(run("glm judge effort=low", "glm-5.3-flash", JUDGE_PROMPT,
                    extra={"reasoning_effort": "low"}, max_tokens=600))
    rows.append(run("glm judge effort=high", "glm-5.3-flash", JUDGE_PROMPT,
                    extra={"reasoning_effort": "high"}, max_tokens=1200))
    rows = [r for r in rows if r]
    out = __import__("pathlib").Path(__file__).with_name("bench_thinking_cloud_judge.json")
    out.write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\n结果已写 {out}")


def main():
    if "--only-judge" in sys.argv:
        return judge_only()
    rows = []
    # A/B/C：hy4-preview 三种思考设置
    rows.append(run("hy4 默认(不传thinking)", "hy4-preview", NPC_PROMPT, max_tokens=1200))
    rows.append(run("hy4 thinking.disabled", "hy4-preview", NPC_PROMPT,
                    extra={"thinking": {"type": "disabled"}}, max_tokens=1200))
    rows.append(run("hy4 thinking.enabled", "hy4-preview", NPC_PROMPT,
                    extra={"thinking": {"type": "enabled"}}, max_tokens=2400))
    rows.append(run("hy4 enable_thinking=False", "hy4-preview", NPC_PROMPT,
                    extra={"enable_thinking": False}, max_tokens=1200))
    # D：judge 短任务对照
    rows.append(run("hy4 judge disabled", "hy4-preview", JUDGE_PROMPT,
                    extra={"thinking": {"type": "disabled"}}, max_tokens=400))
    # E：glm-5.3-flash（只能 enabled，用 reasoning_effort 控深度）
    rows.append(run("glm-5.3-flash effort=low", "glm-5.3-flash", NPC_PROMPT,
                    extra={"reasoning_effort": "low"}, max_tokens=1200))
    rows.append(run("glm-5.3-flash effort=high", "glm-5.3-flash", NPC_PROMPT,
                    extra={"reasoning_effort": "high"}, max_tokens=2400))

    rows = [r for r in rows if r]
    out = __import__("pathlib").Path(__file__).with_name("bench_thinking_cloud_result.json")
    out.write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\n结果已写 {out}")


if __name__ == "__main__":
    main()
