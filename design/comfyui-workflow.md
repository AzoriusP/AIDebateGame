# ComfyUI 角色立绘工作流（SDXL · 逆转裁判风格 · 拼装对齐）

**文责**：Ark｜日期 2026-09-08
**环境**：ComfyUI 0.34.0 portable @ `G:\MiniMax-H3\ComfyUI_windows_portable`，RTX 5080 16GB，torch cu130
**模型目录**：`G:\MiniMax-H3\models\`（extra_model_paths.yaml 已指向）
**目标**：解决「头发/衣服大小位置不一致」的拼装错位 + 「风格不像逆转裁判」两大问题

---

## 0. 两大问题的根因与解法

| 问题 | 根因 | 解法（本工作流） |
|---|---|---|
| 部件大小/位置不一致 | 每次生图构图随机 | **ControlNet openpose 锁构图**：所有部件用同一张 pose 骨骼参考图，头/身体位置固定 |
| 风格不像逆转裁判 | 无动漫风格模型 + 无风格约束 | **Animagine XL 3.1**（日式动漫）+ 逆转裁判式提示词（厚描边/赛璐璐/夸张 pose） |
| 多表情/多部件不是同一人 | 无身份锁定 | **IPAdapter plus**：一张基准脸，锁所有变体的角色身份 |

---

## 1. 工作流架构（节点链路）

```
CheckpointLoader(animagine-xl-3.1)
  ├─ CLIPTextEncode(positive)  ← 逆转裁判风格 + 角色描述
  ├─ CLIPTextEncode(negative)  ← 低质量/水印/坏手
  ├─ EmptyLatentImage(1024×1536, 2:3竖版)  ← 统一画布
  ├─ ControlNet: Loader(openpose) + DWPose(构图参考图) → ControlNetApply(strength≈0.8)
  ├─ IPAdapter: Loader(ip-adapter-plus) + CLIPVision + LoadImage(基准脸) → IPAdapterApply(weight≈0.7)
  └─ KSampler(seed, steps≈28, cfg≈6.5, sampler=euler_ancestral, scheduler=normal)
       → VAEDecode → SaveImage
```

**关键约束（对齐铁律）**：
- 所有部件**同一画布 1024×1536**、同一张 pose 参考图 → 头固定在画布上方 1/4、身体在下方 3/4。
- 表情/发型/衣服变体只改提示词，**不动 seed、不动 ControlNet 参考图、不动 IPAdapter 基准脸** → 保证「同一个人、同一构图、只换局部」。

---

## 2. 提示词模板（逆转裁判风格）

### 2.1 风格前缀（所有图共用，锁死逆转裁判感）
```
ace attorney style, thick bold outline, cel shading, flat color,
dramatic expression, half body portrait, clean background,
sharp chin, defined jawline, confident stance
```
> 「ace attorney style」Animagine XL 认不认不确定，但配合 thick outline + cel shading + dramatic 能逼近。若跑出来偏日系美少女，加强 `thick outline, sharp angles, mature`，弱化 `cute, moe`。

### 2.2 negative（共用）
```
lowres, bad anatomy, bad hands, extra fingers, missing fingers,
watermark, text, signature, blurry, jpeg artifacts, worst quality,
low quality, extra limb, deformed, ugly, cropped
```

### 2.3 角色描述（按 NPC 人设填）
| 角色 | 描述块 |
|---|---|
| 王阿姨 | `60 year old Chinese retired woman, short curly hair, floral blouse, warm shrewd eyes, market auntie` |
| 林经理 | `40 year old Chinese man, slicked hair, business suit, sharp calculating eyes, manager` |
| 玩家(男) | `young Chinese man, neat short hair, white shirt, neutral capable look` |

---

## 3. 参数表（起步值，需微调）

| 参数 | 值 | 说明 |
|---|---|---|
| 画布 | 1024×1536（2:3） | 统一，后处理缩到 576×864 |
| steps | 28 | 质量/速度平衡 |
| cfg | 6.5 | Animagine 推荐区间 |
| sampler/scheduler | euler_ancestral / normal | 稳定出动漫 |
| ControlNet strength | 0.75–0.85 | 太高锁死姿态僵硬，太低漂移 |
| IPAdapter weight | 0.6–0.75 | 太高同质化，太低不像本人 |
| seed | 固定同一个 | 所有变体共用，保证可复现 |

---

## 4. 部件生成清单（批量）

**先做「玩家男」样板验证对齐**，通过后铺开：

| 批次 | 内容 | 张数 | 变体方式 |
|---|---|---|---|
| 1 基准脸 | 玩家男 base（faceA，默认发型衣服） | 1 | 提示词 |
| 2 表情 | faceA × 4 表情（从容/紧张/焦虑/绝望） | 4 | 只改表情词，同 seed |
| 3 发型 | 3 款发型（假发 sprite） | 3 | 只改发型词 |
| 4 衣服 | 3 款衣服（衣服 sprite） | 3 | 只改衣服词 |
| 5 换脸 | faceB / faceC | 2 | 换脸描述词 |

**验收**：批次 1–2 出来后，拼装 base+发型+衣服，查「头发盖在头顶、衣服合身、脸是同一人」，对齐 OK 再铺女性。

---

## 5. 使用步骤

1. 启动：双击 `G:\MiniMax-H3\run_h3.bat`（沿用 MiniMax 启动参数，图片生成同样适用）
2. 浏览器开 `http://127.0.0.1:8188`，拖入 workflow JSON
3. 准备两张参考图：①构图参考图（一张理想半身立绘 pose）②基准脸（角色头像）
4. 改提示词 → Queue Prompt → 出图 → 拼装验收
5. 后处理：出图 → rembg 抠透明（或 LayerDiffuse 出 alpha）→ 缩 576×864 → 转 webp → 入 `demo/static/assets/parts/`

---

## 6. 已知风险

- **R1** ComfyUI 0.34 与插件兼容性：IPAdapter_plus / Advanced-ControlNet 需在 ComfyUI 0.34 下正常加载，启动时看 custom_nodes 报错。
- **R2** Animagine XL 对「ace attorney style」理解有限 → 风格靠 thick outline + cel shading 硬凑，可能需要一张逆转裁判参考图做 IPAdapter 风格迁移（备选）。
- **R3** openpose 对「半身立绘」的手部检测可能不稳 → 半身立绘可不检测手，锁头/肩位置即可。
- **R4** 首次加载 6.5GB 模型到显存慢 → 用 run_h3.bat 的 `--disable-pinned-memory` 参数已处理。

---

## 7. 定稿方案（2026-09-09 大王确认）

**风格锁定 = IPAdapter 锁参考图 + 轻量提示词**（纯提示词堆风格已证明走不通）：

| 组件 | 定稿 |
|---|---|
| 参考图 | 大王提供的《逆转裁判》群像插画，放 `ComfyUI/input/aa_ref.png` |
| IPAdapter | `IPAdapterUnifiedLoader` preset `PLUS (high strength)` + `IPAdapterAdvanced` weight **0.85** |
| positive | `ace attorney, single character, young defense attorney, half body portrait, upper body`（**轻，不堆 masterpiece/dramatic**） |
| negative | `chibi, loli, shota, child, elderly, realistic photo, 3d render, lowres, blurry, bad anatomy, extra fingers, missing fingers, watermark, text, signature, worst quality, low quality` |
| 尺寸/采样 | 1024×1536 / steps 30 / cfg 6 / euler_ancestral |

**已验证的节点连接（API 格式，避免再踩坑）**：
- `IPAdapterUnifiedLoader` 输入 `model:["4",0]`，输出 **[11,0]=MODEL、[11,1]=IPADAPTER**
- `IPAdapterAdvanced` 输入 `model:["11",0]`、`ipadapter:["11",1]`（**不是 [11,0]**）、`image:["13",0]`、`weight`、`weight_type:"linear"`、`combine_embeds:"concat"`、`start_at:0.0`、`end_at:1.0`、`embeds_scaling:"V only"`
- CLIP Vision 模型文件名**必须** `CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors`（放 `G:\MiniMax-H3\models\clip_vision\`）

**捏人规格（大王定稿）**：性别 2 × 脸 5（青年，不分性别）× 发 5 × 衣 5 = **250 组合**；公用一套骨架，动画通用。

**下一步**：ControlNet openpose 锁构图（`comfyui_controlnet_aux` 提供 DWPose）→ 批量 75 张部件（2 base + 5 脸 + 5 发 + 5 衣，各含表情变体）。
