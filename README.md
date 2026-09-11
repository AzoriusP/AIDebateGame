# 《辩弈》AIDebate — Web AI 辩论游戏

单人 Web 辩论游戏：玩家与 5 层天梯、5 个 NPC 进行辩论，由 LLM 担任裁判、NPC 与调度。
后端为单文件 Python（标准库，零第三方依赖），前端为原生 HTML/JS/CSS。

## 固定主角与录屏版本（2026-09-10）

仅主角使用 Live2D，NPC 使用静态演出图。创建角色与换装已取消；账号登录直接进入大厅。主角基础三姿势、呼吸、眨眼与口型已导出，完整情绪、受打击及胜负收尾仍在制作。

- [当前制作范围与验收标准](design/recording-protagonist-scope.md)
- [主角模型说明](design/live2d/male-master/acting-v2/README.md)
- [美术资源审计](outputs/character-asset-audit.md)

隔离试玩：`python -B demo/tools/run_character_review.py --port 8792`，访问 `http://127.0.0.1:8792/`，使用本地 mock 数据。

回归检查：`node --test demo/tests/character-runtime.test.cjs demo/tests/frontend-lifecycle.test.js`。资源验收：`node demo/tools/validate_character_assets.mjs --require-live2d`；此选项仅强制主角提供模型，NPC 允许静态资源。

## 目录

- `demo/` — 可运行 DEMO（后端 `server.py` + 前端 `static/` + 数据 `data/`）
- `design/` — 设计文档（GDD、美术圣经、角色系统）
- `docs/` — 架构、选型、GTM、发布计划
- `tools/` — 美术/资源处理脚本

## 本地运行

```bash
cd demo
cp config.example.json config.json   # 填入你的 API Key
# llm_mode: "openai" 接云端 API；"ollama" 接本地；"mock" 纯规则兜底
python server.py
# 打开 http://localhost:8787
```

### 接入腾讯云 TokenHub HY4（推荐）

`config.json` 关键字段（注意 `openai_base` **不带 /v1**，后端会自动拼接）：

```json
{
  "llm_mode": "openai",
  "openai_base": "https://tokenhub.tencentmaas.com",
  "openai_api_key": "sk-xxxxxxxx",
  "openai_model": "hy4-preview"
}
```

## 部署

见 `docs/` 与轻量云部署方案。生产环境建议：反向代理 + 域名 + ICP 备案；
未备案时可用 `公网IP:端口` 直接对外（需开放对应防火墙端口）。

> 注意：仓库只包含 Web 运行时实际使用的立绘、头像与 Live2D 资源；
> 设计源图、备选图片与生成过程文件不入库。
