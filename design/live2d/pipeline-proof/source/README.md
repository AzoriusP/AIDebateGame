# Live2D 制作链路验证源稿

`pipeline-proof.psd` 是本项目原创的五层几何测试源图。它已通过真实 Editor 导入、绑定和导出，生成可在网页运行的 Live2D 流程样模。这个几何样模用于验证制作链路，不能替代正式玩家、NPC 或换装验收。

- 画布：512 × 512，RGB 8 位，透明背景。
- 从下到上：`Proof_Body`、`Proof_Head`、`Proof_EyeL`、`Proof_EyeR`、`Proof_ArrowArm`。
- 各层 PNG 保留完整画布，对齐坐标不随图层边界裁切。
- `pipeline-proof.png` 为合成预览；`manifest.json` 记录来源、层边界与 SHA-256。
- 可重复生成：在项目根目录运行 Python `-B tools/live2d/make_pipeline_proof.py`，仅需 Pillow。

源稿通过 Pillow 解析，合成 RGBA 像素完全匹配、五个图层名完整。首次真实 Editor 导入失败后，补入标准 ResolutionInfo 资源并修复图层记录顺序；`tools/live2d/verify_pipeline_psd.py` 再使用独立 psd-tools 逐层解码，确认每层像素和强制重建的合成画面正确。旧版本备份和独立验证报告在 `work/live2d/psd-compatibility`。

**真实 Editor 导入已通过。** 主任务在 Live2D Cubism Editor 5.3.04 FREE 中成功导入修复后的 PSD，确认五个图层与合成图正确，并保存真实源工程 `design/live2d/pipeline-proof/proof.cmo3`。成功导入日志为 `work/live2d/logs/cubism-editor-20260909-034305-888.stdout.log`，记录 ImageResources 32 字节、LayerAndMaskInfo 334220 字节、ImageData 1048578 字节。已验收 PSD 的 SHA-256 为 `5c217b9ec7f7adebe23392680da9e868e5c2bffaf64102151955b7fa9051bf45`。

**绑定、图集与嵌入用导出也已通过。** 主任务在同一 Editor 5.3.04 FREE 中完成下列关键形态，生成 1024 × 1024 图集，并保存源工程和真实运行模型。

| 已实现参数 | 范围 / 默认值 | 实际绑定 |
|---|---|---|
| `ParamBreath` | 0～1 / 0 | `Proof_Body` 身体呼吸形变 |
| `ParamEyeLOpen` | 0～1 / 1 | `Proof_EyeL` 从压平闭眼到睁眼 |
| `ParamEyeROpen` | 0～1 / 1 | `Proof_EyeR` 从压平闭眼到睁眼 |
| `ParamObjection` | 0～1 / 0 | `Proof_ArmPivot` 旋转变形器以 65°→0° 控制 `Proof_ArrowArm` 指向 |

真实源工程为 `design/live2d/pipeline-proof/proof.cmo3`；运行文件在 `demo/static/assets/live2d/pipeline-proof`：`proof.moc3`（17,792 字节）、`proof.model3.json`、`proof.cdi3.json`、`proof.1024/texture_00.png`。源 PSD 生成脚本不创建 `.moc3` 或 `.cmo3`；这些模型文件来自真实 Editor 操作。

`work/live2d/proof-core-audit.json` 记录官方 Core 审计通过：5 个网格、28 个参数，其中上述 4 个参数具有有效关键形态和实际顶点变化。网页 `/static/live2d-preview.html` 已实际渲染样模，四参数检测通过，并目检闭眼、指向及 1.6 秒动作播放后回位。

几何测试通过代表制作与播放链路已跑通。正式角色仍需完整补绘、眼口拆分、衣袖/手臂层、三类可替换外观和对应绑定；本样模没有验收换发、换脸或换装。

重新运行 `make_pipeline_proof.py` 会重建源图并重置 `manifest.json` 中的制作验收元数据。重跑前应保留已验收的 manifest，并对适用阶段重新验证。本次验收补录没有修改或重新生成 PSD。

PSD 写入依据：[Adobe Photoshop File Formats Specification](https://www.adobe.com/devnet-apps/photoshop/fileformatashtml/)。
