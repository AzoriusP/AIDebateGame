# 母稿到透明层：本地最短路径核对

2026-09-09 11:53（香港时间）。本次仅查阅 Qwen / Comfy 官方资料、只读本机代码和资源状态；没有下载权重、提交任务或修改服务。

**本轮建议继续“精确部件蒙版 → 现有 Animagine 局部补绘遮挡区 → 原坐标合回 → 透明 PNG/PSD”。**Qwen-Image-Layered 能生成 RGBA 层与遮挡补全候选，但不能指定每层必须是哪一个 Live2D 部件；当前共存资源下也不是最快的已验证路径。

## Qwen-Image-Layered 的能力边界

Qwen 官方明确支持可变层数及递归拆分，但提示词描述的是整幅图，包括部分被遮住的内容；它不能明确控制各层语义。因此“分成 18 层，分别为前发、后发、左右眼、眉、嘴”不是这个模型提供的确定性接口。生成的遮挡内容也仍需人工检查。来源：[Qwen 官方 README](https://github.com/QwenLM/Qwen-Image-Layered/blob/main/README.md)。

Comfy 原生实现输出同一宽高的 RGBA 图像批次。原始批次有 `layers + 1` 项，第 0 项是重建整图；模板用 `LatentCut`（t 轴，index 1）去掉第 0 项，再把各层拆成批次。层序来自批次索引，没有部件语义标签；VAE 输出四通道 alpha。应先验证这些层重组等于生成的重建图，再比较重建图与输入母稿；不能假定原像素完全保留。来源：[Comfy 官方 Layered 工作流](https://docs.comfy.org/tutorials/image/qwen/qwen-image-layered)。

官方建议 640 分辨率桶，高分辨率可用 1024；这不是承诺保留任意源稿的原始像素尺寸。各层相互同尺寸、同坐标；若需回到更大的母稿画布，必须统一记录缩放和偏移，不单独裁紧各层。递归时只处理选定层，并保留原层级位置。官方代码可见 [Comfy Qwen 节点](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_extras/nodes_qwen.py)。

## 可核对的官方权重

选择 Comfy 官方提供的 mixed FP8 主模型，保留敏感层较高精度。以下为官方 LFS 指针的精确字节数，不是峰值内存估计。

| 用途 | 文件 | 字节 / 约 GB | 许可与来源 |
|---|---|---:|---|
| 分层扩散模型 | qwen_image_layered_fp8mixed.safetensors | 20,533,591,821 / 20.53 GB | Apache-2.0；[Comfy 官方文件](https://huggingface.co/Comfy-Org/Qwen-Image-Layered_ComfyUI/blob/main/split_files/diffusion_models/qwen_image_layered_fp8mixed.safetensors) |
| 文本/视觉编码器 | qwen_2.5_vl_7b_fp8_scaled.safetensors | 9,384,670,680 / 9.38 GB | Apache-2.0 仓库；[Comfy Qwen 官方文件](https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/blob/main/split_files/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors) |
| RGBA VAE | qwen_image_layered_vae.safetensors | 253,816,616 / 0.254 GB | Apache-2.0；[Comfy 官方文件](https://huggingface.co/Comfy-Org/Qwen-Image-Layered_ComfyUI/blob/main/split_files/vae/qwen_image_layered_vae.safetensors) |
| 合计 | 三个必要权重 | **30,172,079,117 / 30.17 GB，约 28.10 GiB** | 不含运行时、激活与加载副本 |

对应 SHA-256：

- 主模型：`e68c406b1bc08c97382a46dce6ed46699bc18a0f50422d97952ee4e8b63ad50a`
- 编码器：`cb5636d852a0ea6a9075ab1bef496c0db7aef13c02350571e388aea959c5c0b4`
- VAE：`c5320595fc61859ccdd0282184208f7b781c983b8ce4c6bc3e7723a807d3d28d`

官方工作流目前链接的编码器放在 HunyuanVideo 重打包仓库；上表的 Qwen 仓库提供字节数及 SHA-256 完全相同的文件，并明确标注 Apache-2.0。采用后者可避免把 Hunyuan 仓库整体许可误写成这个 Qwen 编码器的来源许可。原始 Qwen Layered 与 Qwen2.5-VL-7B 也标注 Apache-2.0：[Layered](https://huggingface.co/Qwen/Qwen-Image-Layered)、[编码器上游](https://huggingface.co/Qwen/Qwen2.5-VL-7B-Instruct)。

普通 BF16 主模型约 40.9 GB，不选它。Comfy Qwen 仓库另有 6.11 GB 的 NVFP4 编码器，但已核对的 Layered 示例使用 FP8 编码器；仅更换编码器也不能使 20.53 GB 主模型全驻留 16 GB 显存。该选项不是本轮必需研究范围。

## 5080 与当前共存状态

本机只读快照：RTX 5080 总显存 16,303 MiB，已用 8,938 MiB，可用 7,040 MiB；系统可见内存 49,678,940 KiB（约 47.4 GiB），空闲 12,898,636 KiB（约 12.3 GiB）。G 盘空闲约 2.20 TB。数值会随主任务变化。

结论是**存在官方 FP8 + Comfy CPU 卸载的技术路径，但当前状态没有实测运行保证**。主模型本身大于全卡显存，必然需要卸载；当前仅约 7 GiB 空闲显存、12.3 GiB 空闲 RAM，不足以宽松容纳其 CPU 权重、编码器与激活工作集。不能把下载体积等同峰值 RAM，也不能从“支持 lowvram”推导出此共存配置必然能跑。官方同样提醒 Layered 推理慢；未找到 Qwen/Comfy 对“5080 16GB，另一个服务占 8GB”的容量或耗时保证。[Comfy 官方低显存说明](https://docs.comfy.org/troubleshooting/overview)。

现有 8189 已使用 `--disable-dynamic-vram --lowvram --reserve-vram 2 --cpu-vae --disable-smart-memory`，本次只读核对 `work/live2d/comfyui/launch-plan.json`，没有改动。以后若单独做 Layered 实验，先为该任务腾出 GPU/RAM，再使用这个 G 盘隔离服务，单张、640 桶、2–3 层、官方采样配置起跑；观察真实峰值和耗时后才增加层数/分辨率。把约 30 GiB 可用 RAM 作为有余量的试验起点属于工程建议，不是官方最低配置。不得为此擅自停用其他服务。

未来试验的最小交付是：保留重建整图 + 所有 RGBA 层 + 层序清单，记录加载峰值/耗时，并比较复合图与母稿。若它只能拆出“人物/背景”而不能拆到眼眉口，立即回到精确蒙版，不把增加层数或递归次数当成能完成 18 层的保证。现在不下载这三个权重。

## 现有 Animagine 局部补绘是否足够

**足以作为本轮 18 层中遮挡修补的候选生成工具，不能代替精确分层或保证美术合格。**普通 SDXL/Animagine 通过蒙版噪声约束进行补绘，输出仍是 RGB；alpha 由部件轮廓蒙版负责，前发后面的额头、衣领下面的颈、袖口后的前臂由局部补绘和人工修线补全。大幅改变手势的指向手需单独补绘和结构验收。

官方 Comfy 的基础 inpaint 流程使用图像、VAE 和蒙版，支持控制重绘区域；专用 inpaint 模型可能有更自然的衔接，但这不是必须先新增模型才能做任何补绘的限制。[官方 Inpainting 文档](https://docs.comfy.org/tutorials/basic/inpaint)。对当前 Animagine 的具体结果只能通过实际图像判断，不能以相同 seed 保证身份或像素一致。

本轮最短操作：

1. 固定母稿像素尺寸；按实际轮廓制作 18 个部件保留蒙版，记录层序与锚点。现有可见像素从母稿原位保留。
2. 每次只补一个遮挡区，选紧凑 ROI 并带邻近上下文。ROI 尺寸对齐 8 或 64，记录相对完整画布的 x/y，防止 VAE 自动裁切改变锚点。
3. 用 `VAEEncodeForInpaint → KSampler → VAEDecode` 取得候选，或对已有合理底色使用 `VAEEncode → SetLatentNoiseMask → KSampler`。缺失内容与小幅修线采用不同 denoise，依据实际结果调整。
4. 解码后只把明确的补绘区域合回原母稿坐标；区外直接用原始像素。仅依赖 latent mask 仍可能让 VAE 重建改变区外颜色或边缘。
5. 最后应用部件 alpha，输出完整相同画布的 PNG；重新叠合检查母稿恢复情况，再对部件做小幅位移检查隐藏区是否有洞。
6. 将验收后的真实 RGBA 层交给现有 `tools/live2d/package-layered-psd.py`，再做 Cubism 导入验证。

本机代码检查发现两处必须明确的约定：`VAEEncodeForInpaint` 白色 mask 表示重绘，并会把不满足 VAE 压缩倍数的图居中裁切；`JoinImageWithAlpha` 内部使用 `1 - mask`，所以若手工蒙版是白色保留像素，传给此节点前需反相。源代码位于现有 G 盘 ComfyUI 的 `nodes.py` 与 `comfy_extras/nodes_compositing.py`，本次只读检查，没有执行图像处理。

“能生成补绘候选”与“已经得到可用层”分开验收。优先推进现有母稿和 18 层，不让 30 GB 新模型成为本轮制模链路的新前置条件。
