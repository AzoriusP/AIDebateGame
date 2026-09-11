# 男性母模源图审查

2026-09-09 11:25（香港时间）。只读检查现有图片、ComfyUI API 与已安装节点源码；本轮没有提交生成、改图、修改用户工作流或重启服务。

**建议用 `G:\WBSpace\AIDebate\design\art-output\male_char\tense.png` 作为修稿母底，`calm.png` 只补充冷静表情与服装设计参考。** `tense.png` 比其他同角色版本少了头顶的额外蓝袖手臂，左右眼仍可辨，红制服/黑紫发和现有玩家身份一致；它尚不能直接作为可拆分的最终母稿。实际目录是 `male_char`，未找到 `male/_char`。

## 哪些能复用

| 实际资源 | 判断 |
|---|---|
| `design/art-output/male_char/tense.png` | 优先母底。1024 × 1536、RGB 无透明度。可保留可见前发、脸颊/耳、红外套胸肩的已画像素，先精确分区再补全遮挡边缘；需放松眉眼和嘴，清理白色背景及彩纸，重制右/下裁断的手臂区域。 |
| `design/art-output/male_char/calm.png` | 同角色冷静表情/配色参考；头顶有独立蓝袖拳头，右/下手部裁断，不能直接作正式静止母模。 |
| `design/art-output/male_char/{anxious,desperate}.png` | 可保留情绪语义参考。网格对比可见眉眼、头部轮廓、发束及衣服位置改变，并有额外蓝袖手臂；不能当作同一模型已经对齐的表情层。 |
| `design/art-output/regenerated/ref_01.png` | 单人红衣造型参考，但侧脸更重、领口/衣服设计不同、手在边缘裁断，不宜把其头或衣服直接拼进 `tense.png`。 |
| `design/art-output/cn_solo_male.png` | 画面明确有第二个人物，前景双手亦不完整；退出母稿候选。 |
| `design/art-output/parts_compose_calm.png` | 有大片背景残留、半透明重影/拼接痕迹，不能复用为正式层。 |
| `design/art-output/parts/transparent/游戏角色发型部件_假发_wig__男性黑色短发发型_只画头发_2026-09-08T05-22-55.png` | 已有真正透明背景的独立发型整片，1024 × 1024；但颜色、笔触、透视与红衣母底不匹配，且没有前/后发拆分。可作备选发型设计，不能直接作为本母模的一键换发层。 |
| `design/art-output/parts/transparent/游戏角色衣物部件_男性白色衬衫加深色长裤_只画衣服部分_不含_2026-09-08T05-23-23.png` | 832 × 1216 RGBA，正面站姿的衣服整片；躯干/两袖未分层，笔触与三分之四红衣母底不同。只保留白衬衫方案参考。 |

现有男性资产里没有发现可直接沿用的分层 PSD、独立眼白/瞳孔/眼睑、嘴内、完整上臂/前臂/指向手。直接可复用的是部分已画可见像素和设计参考，不能把透明整片或图片裁切等同于已完成的 Live2D 层。

## 首轮必须补齐的材料

1. **干净中性母底：** 保留 `tense.png` 的角色身份，修成冷静闭嘴；扩展右侧与腰下构图，画完整双肩和两只可辨的手，清除背景。先出一张合格母底再拆层，不再平行生成四个人物轮廓。
2. **头脸遮挡补绘：** 画全刘海下的额头/眼眉区域、前发后的后发、耳根、下颌和领口后的完整颈部；换发和头部摆动时不能露白洞。
3. **眼口活动层：** 同一张脸拆左右眼白、虹膜/瞳孔、上眼睑/下眼睑、眉毛；嘴内、上下唇分别绘制，闭眼和开口极值需要补画，不从四张表情整图横向裁条。
4. **身体与手臂：** 补全前臂后面的胸腹衣服；左右上臂、前臂、袖口、手分离。另画完整向画面右前方伸指的手/前臂/袖口与肩部过渡；当前掌形不是指向手势，不能依靠旋转就变成食指伸出。
5. **换装材料后置：** 第一套头脸/发型/红衣绑定通过后，再按同一画布和锚点制作第二套三槽外观。白衬衫旧图不作为已验收第二套。

## 现有 ComfyUI 能做到什么

11:20～11:25 读取 `8188/system_stats` 与 `/queue`：服务为 ComfyUI 0.34.0 / RTX 5080 16GB，队列为空。已有 Animagine XL 3.1、IPAdapter Plus、CLIP Vision、SDXL OpenPose 和 DWPose ONNX 权重；无需为一次蒙版补绘重新下载大模型。`/object_info` 实际注册了 `VAEEncodeForInpaint`、`InpaintModelConditioning`、`SetLatentNoiseMask`、`GrowMask`、`ImageCompositeMasked` 等节点。

因此可在同一母底上尝试**指定蒙版的局部补绘**，将未遮罩部分从原图重新合成回去，保存补绘候选和蒙版，之后精确拆层。现有检查没有证明 Animagine 的遮挡补绘质量合格，也没有发现其能直接输出已补全遮挡的角色分层 PSD。

节点列表里的 `ByteDanceSeedreamLayerSeparationNode` 属于 `partner/image/ByteDance`，是外部服务能力；本方案不调用。虽有 `EmptyQwenImageLayeredLatentImage`，但实际 UNET 列表只有 MiniMax H3，未发现 Qwen Image Layered 的本地权重；存在节点不等于该流程可本地运行。

## G 盘项目输入/输出：已确认的接口边界

- **标准 `LoadImage` 不能直接读项目绝对路径。** 已装版本的 `VALIDATE_INPUTS` 调用 `exists_annotated_filepath`，经 `realpath` 和目录边界检查限制在 input 内；也不能用指向项目外的连接绕过。
- **`LoadImagesFromFolderKJ` 已注册且源码明确接受绝对 `folder`。** 可指向项目内仅放本次源图的文件夹，`image_load_cap=1`、`start_index=0`、宽高使用源图实际值（1024 × 1536），避免自动缩放/裁切。蒙版也可放独立项目目录读取。该接口无需上传到共享 input 或改变用户前端工作流。
- **`SaveImageWebsocket` 已注册且源码不落盘。** 它通过 WebSocket 推送 PNG，前 8 字节分别为消息类型和图片格式；客户端接收后可直接写入 `G:\WBSpace\AIDebate\design\art-output\live2d-source`。图片本身不含工作流元数据，需把提交 JSON、seed、模型名和蒙版路径另存项目工作目录。应只接收本次 `prompt_id` 对应任务的输出，防止收进其他任务预览。
- **`SaveImageKJ` 也可直接存项目。** 已装源码对绝对 `output_folder` 使用该目录保存；普通 `SaveImage` 和 `SaveImageWithAlpha` 仍受共享 output 限制。可输出 RGB 候选与独立蒙版，随后在项目内装配透明层，不把标准输出路径越界当成方案。
- **缓存边界尚不能通过单次提交保证。** 8188 的启动参数没有项目 base/input/output/user 设置；只读 API 不提供运行进程的完整缓存环境。已检查的 `run_h3.bat` 把可配置缓存指向共享 G 盘工具缓存，而非本项目。上述 KJ/WS 路径解决任务输入/输出，但没有证明运行中的 8188 会把所有新增缓存也隔离进项目；若用户要求连新增推理缓存都必须在项目内，需由主任务采用已准备的项目隔离启动配置，不能宣称当前服务已经完全满足。

本节依据的是实际 `/object_info` 与已安装 `folder_paths.py`、`ComfyUI-KJNodes/nodes/image_nodes.py`、`custom_nodes/websocket_image_save.py`，没有提交推理。完整缓存启动路径见 `design/live2d/local-art-toolchain.md`。
