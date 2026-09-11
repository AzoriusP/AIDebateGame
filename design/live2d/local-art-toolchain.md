# 项目本地美术工具链实测记录

日期：2026-09-09。本页只记录本轮检查和已生成的工具，不把候选原画或几何测试图算作正式 Live2D 角色。

## 已有工具与模型

`http://127.0.0.1:8188/system_stats` 实际返回 ComfyUI 0.34.0、Python 3.13.14、PyTorch 2.13.0+cu130、RTX 5080 16GB。`/queue` 检查时运行队列和待处理队列均为空。现有服务保持原样，本轮没有提交生图、取消任务、释放其模型或改动它的工作流。

| 项目 | 实际位置或检查结果 |
|---|---|
| Cubism Editor 5.3.04 | 已放置于 `G:\Tools\Live2D\CubismEditor-5.3.04`；`CubismEditor5.exe` 实际文件版本为 `5.3.04`，附带 app、data、license、readme、tools |
| Editor 安装来源文件 | `work/live2d/downloads/Live2D_Cubism_Setup_5.3.04.exe`，247,132,880 字节 |
| Cubism SDK for Web 5-r.5 | 压缩包 `work/live2d/downloads/CubismSdkForWeb-5-r.5.zip`；已解包至 `work/live2d/sdk/CubismSdkForWeb-5-r.5`，包含 Core、Framework、Samples、LICENSE.md |
| ComfyUI 与独立 Python | `G:\MiniMax-H3\ComfyUI_windows_portable` |
| Animagine XL 3.1 | `G:\MiniMax-H3\models\checkpoints\animagine-xl-3.1.safetensors`，6,938,325,776 字节 |
| SDXL OpenPose ControlNet | `G:\MiniMax-H3\models\controlnet\controlnet-openpose-sdxl-1.0.safetensors`，2,502,139,104 字节 |
| CLIP Vision | `G:\MiniMax-H3\models\clip_vision\CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors`，2,528,373,448 字节 |
| IPAdapter Plus SDXL | 工具内 `ComfyUI\models\ipadapter\ip-adapter-plus_sdxl_vit-h.safetensors`，847,517,512 字节 |
| DWPose 权重 | 插件内 `ckpts\yzd-v\DWPose\dw-ll_ucoco_384.onnx` 和 `yolox_l.onnx`，约 351 MB 合计 |
| 节点可用性 | `/object_info` 实际包含 `IPAdapterUnifiedLoader`、`IPAdapterAdvanced`、`DWPreprocessor`、`ControlNetLoader`、`CheckpointLoaderSimple`、`CLIPVisionLoader`、`SaveImage` |
| PSD 打包与独立验证 | 生成使用已有 Python/Pillow；兼容性修复另将 `psd-tools 1.19.0` 与 `attrs 26.1.0` 安装在项目 `work/live2d/psd-compatibility/python-libs` |

本轮在 G 盘工具、下载目录和当前相关进程中未定位到 Krita 或 Photoshop。这不是对整台电脑的穷举结论。现有 Codex Python 运行时位于 C 盘，只读调用 `-B`，不迁移已有运行时，也没有向该位置安装库、保存图像或写字节码。ComfyUI 启动器使用 G 盘独立 Python。

Editor 的通用程序文件位于 G 盘工具目录，项目启动器为 `tools/live2d/start-cubism-editor.ps1`。实际成功启动记录将用户数据设为 `work/live2d/editor-profile`、临时文件设为 `work/live2d/editor-profile/temp`、日志设为 `work/live2d/logs`。程序文件到位与实际导入/导出通过是两个独立检查项；真实操作结果见下方验收记录。

## 项目隔离启动器

入口：`tools/live2d/start-comfyui-live2d.ps1`。在项目根目录执行：

```powershell
.\tools\live2d\start-comfyui-live2d.ps1 -CheckOnly -CoexistIfIdle
```

安装版本的 `main.py --help` 已接受全部实际启动参数。2026-09-09 11:47（香港时间）首次隐藏启动项目专用服务 `http://127.0.0.1:8189`，进程号 47124；11:58 移除 CPU VAE 后为 59716；14:30 改回常规显存策略后当前进程号为 **43952**。`work/live2d/comfyui/launch-plan.json` 的 `started` 为 `true`，保留当前实际参数、目录、进程号与共存检查记录。

```powershell
.\tools\live2d\start-comfyui-live2d.ps1 -CoexistIfIdle
```

默认启动仍拒绝与已有 8188 并行；显式的 `-CoexistIfIdle` 会间隔两秒检查两次原服务队列、GPU 活动与可用内存，要求队列为空、GPU 使用率不高于 20%、可用显存至少 4 GiB、系统内存至少 8 GiB。此次检查队列均为空，GPU 使用率 5% 和 8%，可用显存 7,252 MiB；8188 保持原样。目标端口已占用时始终退出，不替换进程。此检查仅适用于启动时刻；两个服务的后续任务不会自动互斥，提交前仍需检查 8188 队列并使用单张批次。

共存模式当前使用已安装 CLI 支持的 `--disable-dynamic-vram --reserve-vram 2`，保留 2 GiB 显存余量，继续禁用 pinned memory 与异步 offload。此版本没有 `--normalvram` 参数：不传 `--lowvram`、`--highvram`、`--novram` 即默认 `NORMAL_VRAM`，实际日志已确认。已移除 `--disable-smart-memory`，让内存管理按实际需要卸载。DWPose ONNX 放到 CPU，VAE 使用显卡并由工作流选择 `VAEDecodeTiled`。WDDM 下两个进程的 `/system_stats` 显存值可能不同，不能把新进程显示的空闲量直接当作整卡可用量；应同时参考 `nvidia-smi`。

首次制作已完成 28 步采样，但原 `--cpu-vae` 触发 PyTorch CPU 卷积的 Windows 原生 `access violation`，进程 47124 自行退出。已先将原日志、启动计划与审计保存到 `work/live2d/comfyui/logs/failed-cpu-vae/20260909-115751-422`，再移除该选项并重启；本次维护没有结束其他进程或改动 8188。新服务 `/system_stats`、实际进程命令行均确认无 `--cpu-vae`，`VAEDecodeTiled` 与 `SaveLatent` 节点存在，存储环境复核通过。工作流需保存 latent 后进行分块解码，实际图片结果另行验收。

第二次 28 步采样同样完成，并已保存 `design/art-output/live2d-source/male-master/candidate-01-gpu_00001_.latent`；加载 VAE 时原生崩溃栈位于 `free_memory → model_unload → unpatch_model → torch.nn.Module.to`。日志备份为 `work/live2d/comfyui/logs/failed-unet-offload/20260909-143039-862`，59716 已自行退出。已安装 `model_management.py` 在禁用 smart memory 时将待释放内存设为 `1e32`，会积极卸载模型；移除该开关可减少不必要的搬运，但不能据此认定 PyTorch/驱动的具体根因或保证所有图已修复。

第三次启动前 8188 队列空，整卡可用显存 12,422 MiB、GPU 活动 1%～2%。主任务从原 checkpoint 提取的小型 `animagine-standalone-vae.safetensors` 已被当前 `VAELoader` 列出；项目 `work/live2d/comfyui/models/vae` 是 `--base-directory` 对应的默认搜索目录，无需改共享配置。优先用现成 latent 与独立 VAE 执行最小分块解码，避免加载 UNet 后再次触发同一卸载路径；图片解码结果由制作任务单独验收。

| 数据 | 目录 |
|---|---|
| 上传参考图 | `work/live2d/comfyui/input` |
| 工作流与 ComfyUI 用户配置/数据库 | `work/live2d/comfyui/user` |
| 进程 HOME、USERPROFILE、AppData | `work/live2d/comfyui/profile` 及其子目录 |
| 新候选原画 | `design/art-output/live2d-source` |
| ComfyUI 临时图 | `work/live2d/comfyui/temp/temp`（本安装版本自动追加一次 `temp`） |
| Python 与系统临时文件 | `work/live2d/comfyui/temp` |
| 可配置 HF/PIP/Torch/CUDA/Numba 等缓存 | `work/live2d/comfyui/cache` 各子目录 |
| 启动日志和参数验证 | `work/live2d/comfyui/logs` |

脚本将 ComfyUI 的 base/input/output/temp/user、数据库与进程用户目录全部显式指向 G 盘项目，模型搜索路径写到项目内的新 YAML；不修改工具目录中原来的 `extra_model_paths.yaml`。仅加载现有 IPAdapter 与 ControlNet 辅助插件，禁用远程 API 节点。DWPose 等已有通用推理权重继续从 G 盘工具目录读取，不复制数 GB 模型。默认 Hugging Face/Transformers 离线，避免缺失权重时自动下载；这不等于对第三方插件施加操作系统网络隔离。

`work/live2d/comfyui/process-environment-audit.json` 已读取实际进程并核对 32 项相关环境变量：存储路径与配置通过；ComfyUI 仅给 CUDA 分配器选项追加了 `backend:cudaMallocAsync`，没有更改存储目录。已实际出现 `user/comfyui.db`、`user/comfyui.db.lock` 与 `cache/matplotlib/fontlist-v3.11.0.json`。该证据覆盖已配置路径和本次启动产物，不宣称是整机文件写入追踪。

`work/live2d/comfyui/service-audit.json` 已核对 8189 的 `/system_stats`、`/object_info` 和队列：IPAdapter、ControlNet、标准图像输入/保存、蒙版补绘、合成、扩图、采样与分块 VAE 节点均可用。客户端入口为 `http://127.0.0.1:8189`，API 使用 `/prompt`、`/history` 与 `/ws?clientId=...`。标准 `LoadImage` 从项目 input 读取，标准 `SaveImage` 写项目 `design/art-output/live2d-source`，无需 KJ 或 WebSocket 保存插件。本次环境启动没有提交生图。

工作流应使用节点列出的确切权重名：`animagine-xl-3.1.safetensors`、`CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors`、`ip-adapter-plus_sdxl_vit-h.safetensors`、`controlnet-openpose-sdxl-1.0.safetensors`。IPAdapter Unified Loader 选择 `PLUS (high strength)`。DWPose 必须显式选择已有 `dw-ll_ucoco_384.onnx` 和 `yolox_l.onnx`；其默认 pose 文件为本地未安装的 torchscript 版本，不能沿用默认触发下载。

参数依据是已安装的 `ComfyUI/comfy/cli_args.py`、`main.py`、`folder_paths.py` 和 `utils/extra_config.py`，没有套用旧版本网上教程中的参数。

## 从原画到分层文件

现有 ComfyUI 链路可以生成候选原画和局部编辑结果，不能直接生成 Cubism 骨骼或自动完成分层补绘。相同 seed、OpenPose、IPAdapter 可以作为构图和身份约束，但不能保证像素对齐、结构一致或自由拼接。旧 `design/comfyui-workflow.md` 与 `tools/gen_male_char.py` 中关于固定 seed 保证骨架匹配的承诺应视为废弃。

正式制作顺序：

1. 从项目已有的合格人物设计中选一张母稿，只解决该角色的整体造型、手臂构图和多余肢体。
2. 在同一画布分离头发、脸底、左右眼部、嘴、颈、衣服、上臂、前臂和手势，补全遮挡区。每层 PNG 保存完整相同画布。
3. 将真正独立的可见像素层存入 RGB 8 位 PSD。PSD 内只有整张合成图不合格；只把旧图按矩形切开也不合格。
4. 在 Cubism Editor 导入、自动/手动网格、变形器、参数关键形态、纹理图集，再导出真实 `.moc3` 与 `.model3.json`。
5. 在 Web Core 实际加载并观察网格、眼睛开合、呼吸和动作后，才认定制模链路通过。随后扩展换装、正式人物、NPC。

## 本轮已完成的分层输入证明

`design/live2d/pipeline-proof/source/pipeline-proof.psd` 为原创几何测试图，512 × 512、RGB 8 位、透明背景，五个独立普通栅格层。合成 PNG、各层 PNG、层边界和 SHA-256 清单放在同目录。

生成入口为 `tools/live2d/make_pipeline_proof.py`。脚本按 [Adobe PSD 格式规范](https://www.adobe.com/devnet-apps/photoshop/fileformatashtml/) 写出普通栅格层，不调用生图，也不伪造 Cubism 文件。Pillow 解码确认合成 RGBA 像素完全一致和五个层名完整。

首次真实 Editor 导入失败后，已修复两个问题：为图像资源区添加标准 72 dpi ResolutionInfo（ID 1005）；将 PSD 图层记录改为从下到上，修复头层遮住眼睛的堆叠错误。旧 PSD 与 manifest 保留在 `work/live2d/psd-compatibility`。新增 `tools/live2d/verify_pipeline_psd.py` 使用独立 `psd-tools 1.19.0` 逐层解码和强制重建合成，确认每层像素、可见性、堆叠顺序和最终画面正确；报告为该目录下 `independent-validation.json`。随后已完成真实 Editor 重试并通过。

此测试图故意使用简单几何头、身体、椭圆眼睛和箭头臂，以分开检验“编辑器能否导入和导出”和“正式角色美术是否合格”。它不冒充玩家、NPC 或通过美术验收的角色。真实 Editor 导入、四参数绑定、图集、运行用导出和网页播放均已通过；正式美术及换装不在本几何样模的验收范围内。

## 真实 Editor 导入与 G 盘存储核对

主任务已在 **Live2D Cubism Editor 5.3.04 FREE** 中成功导入最终 PSD，确认五个图层及合成图正确，完成四参数关键形态、1024 × 1024 纹理图集，保存真实 `.cmo3` 并导出运行模型。已验收 PSD 哈希为 `5c217b9ec7f7adebe23392680da9e868e5c2bffaf64102151955b7fa9051bf45`，本次补录没有重新生成或修改 PSD。

| 已核对项目 | 实际证据 |
|---|---|
| Editor 程序 | `G:\Tools\Live2D\CubismEditor-5.3.04` |
| 项目启动器 | `G:\WBSpace\AIDebate\tools\live2d\start-cubism-editor.ps1` |
| 成功启动配置 | `work/live2d/logs/cubism-launch-20260909-034305-888.json` |
| 用户、Documents、Desktop、AppData 和临时目录 | 均位于 `G:\WBSpace\AIDebate\work\live2d\editor-profile` 下；启动配置同时指定 Java `user.home`、`java.io.tmpdir` 和环境变量 |
| 成功导入日志 | `work/live2d/logs/cubism-editor-20260909-034305-888.stdout.log` |
| 资源区与图层区读取 | 日志 `Read ImageResources:32`、`Read LayerAndMaskInfo:334220`、`Read ImageData:1048578` |
| PSD 源文件 | `G:\WBSpace\AIDebate\design\live2d\pipeline-proof\source\pipeline-proof.psd`，1,382,860 字节 |
| 已保存可编辑源工程 | `G:\WBSpace\AIDebate\design\live2d\pipeline-proof\proof.cmo3`，绑定与导出完成后本次核对时 51,192 字节 |
| 真实运行模型 | `G:\WBSpace\AIDebate\demo\static\assets\live2d\pipeline-proof\proof.moc3`，17,792 字节 |
| 模型及显示清单 | 同目录的 `proof.model3.json`、`proof.cdi3.json` |
| 纹理图集 | 同目录 `proof.1024/texture_00.png`，1024 × 1024 |
| 官方 Core 审计 | `work/live2d/proof-core-audit.json`；Core `06.00.0001`、MOC version 6、5 个网格、28 个参数、4 个必需参数绑定均通过 |
| 网页实测 | `/static/live2d-preview.html` 已实际渲染；四参数检测通过，闭眼、指向和 1.6 秒动作回位已目检 |

四项实际绑定为：`ParamBreath`（0～1，默认 0）驱动身体；`ParamEyeLOpen`、`ParamEyeROpen`（0～1，默认 1）压平对应眼睛形成闭合；`ParamObjection`（0～1，默认 0）通过 `Proof_ArmPivot` 旋转变形器的 65°→0° 关键形态带动箭头臂。其余 24 个默认参数不因存在于清单就视为已有绑定；Core 审计中的 Parts 数为 0，不能据此宣称换装通过。

重新运行 `tools/live2d/make_pipeline_proof.py` 会重建源资产，并重置源目录 `manifest.json` 的 Editor/Core/网页验收元数据。重跑前应保留已验收记录，并对适用阶段重新验证。正式角色制作从后续分层原画和换装母模继续，本轮没有将几何样模替换为正式玩家或 NPC。

2026-09-09 03:54（香港时间）只读复查了原 C 盘基线的三个路径：`C:\Users\王鼎元\AppData\Roaming\Live2D`、`C:\Users\王鼎元\AppData\Local\Live2D`、`C:\Users\王鼎元\.Live2D`。三个路径均仍不存在，与启动前一致；结果写入 `work/live2d/c-drive-after-psd-import.json`。这项结论只覆盖这三个明确路径，不冒充整块 C 盘的写入审计。
