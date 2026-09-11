# G 盘角色引用图编辑流程

本流程生产姿态候选原画，不自动创建 Cubism 骨骼或导出模型。全部任务数据在 `G:\WBSpace\AIDebate`。

## 已验证的运行配置

ComfyUI 0.34.0，项目隔离服务 `127.0.0.1:8189`，使用既有 G 盘便携 Python。启动入口 `start-comfyui-live2d.ps1 -CoexistIfIdle`；不要结束或占用另一项工作的 8188 服务。

使用 FLUX.2 Klein 4B distilled FP8、Qwen3 4B 文本编码器和 FLUX2 VAE。三文件位于项目 `work/live2d/comfyui/models`，完整 SHA256 已按发布者 LFS 元数据校验，记录见 `work/live2d/male-master/acting-v2/klein-model-integrity.json`。下载和恢复逻辑见 `download-klein-models.py`，无需重复下载。

采用官方 Comfy-Org Klein 4B 引用图编辑工作图结构：引用图编码、ReferenceLatent、4 步 Euler、CFG 1、分块 VAE 解码。1536×1536 输出；引用图缩放到约 1MP 供模型编码，原始参考文件不改写。

**文本编码器必须保持 `--text-device cpu`（默认）。** 此台 Windows 环境在默认 GPU 编码后卸载大型文本编码器时发生原生访问冲突，服务退出。改用 CPU 编码后，站姿、前倾及多轮伸指已实际成功。失败日志保存到 `work/live2d/comfyui/logs/failed-klein-offload-01`；不要仅因显存充足就恢复默认 GPU 路径。

示例（从项目根目录执行；每次使用新 tag）：

```powershell
$env:TEMP='G:\WBSpace\AIDebate\work\live2d\temp'
$env:TMP=$env:TEMP
& 'G:\MiniMax-H3\ComfyUI_windows_portable\python_embeded\python.exe' -B tools/live2d/edit-male-klein.py `
  --reference design/art-output/live2d-source/male-master/acting-v2/klein-neutral-02_00002_.png `
  --prompt-file work/live2d/male-master/acting-v2/klein-lean-strong-prompt.txt `
  --tag NEW-UNIQUE-TAG --seed 2026091090
```

脚本提交任务后返回任务 ID，不代表出图完成。检查服务 history 的 success 状态和实际 PNG，再做目视验收。输出在 `design/art-output/live2d-source/male-master/acting-v2`；完整工作图、提示、引用图 SHA 和提交信息在 `work/live2d/male-master/acting-v2/*.klein.json`。引用图可重复指定 1–3 张，顺序须与提示一致。

## 透明底与姿态源包

用户已纠正第三姿态为角色左手伸指。当前版本使用 `prepare-acting-silhouettes.py --left-hand`、`pose-extraction-left-hand.json`、提取 tag `acting-v2-left-hand-cutouts`，再用 `package-acting-poses.py --left-hand` 收集到 `pose-sources-left-hand/`。该模式保留前两姿态原像素，第三项输出 `Point-left.png`；默认不带参数的步骤只用于复现已作废的旧右臂稿。

1. `prepare-acting-silhouettes.py` 为指定获选图生成掩码；它的背景空隙种子只适用于这三张源图，换图后必须重查。
2. `extract-male-layers.py work/live2d/male-master/acting-v2/pose-extraction.json --tag acting-v2-pose-cutouts` 通过 ComfyUI 提取透明 PNG。
3. `package-acting-poses.py` 收集成功提取，校验往返误差，平移到公共画布并复制到原画对照页资源目录。
4. `package-layered-psd.py` 根据 `design/live2d/male-master/acting-v2/pose-sources/layers.json` 打包 PSD。默认不覆盖既有 PSD；新一批应使用新目录和文件名。

现有提取脚本对同名 tag 的回执会覆盖；重做时请使用新 tag，并同步收集脚本的输入，避免丢失制作记录。全局引用图编辑也可能改变衣服色彩或细节；本次获选三稿仍保留这些待修问题，不能批量自动批准。

## 发布者来源与许可留档

- [官方 Klein 工作流说明](https://docs.comfy.org/tutorials/flux/flux-2-klein)
- [BFL Klein 4B FP8](https://huggingface.co/black-forest-labs/FLUX.2-klein-4b-fp8)：Apache 2.0。
- [BFL 对 FLUX2 autoencoder 的许可说明](https://github.com/black-forest-labs/flux2#flux2-autoencoder)：VAE 为 Apache 2.0；不要把同仓库生成模型的许可与 VAE 混淆。

发布者文档、Apache 2.0 文本和来源元数据均保存于 `work/live2d/licenses/klein-4b`。未购买服务或订阅，未下载 9B 或 dev 生成模型。

## Cubism 基础绑定交接（2026-09-09）

当前导入源：`design/live2d/male-master/acting-v2/mesh-rig-source/male-acting-rig.psd`，由 `prepare-acting-mesh-source.py` 与 `package-acting-mesh-source.py` 制作。三组各含 Body、Eye、MouthClosed、MouthOpen。Cubism 编辑源为同级 `male-acting.cmo3`。

编辑源使用公共呼吸 Warp、近侧眼开合与嘴层透明度关键点。重新导出到 `demo/static/assets/live2d/male-acting/` 后，在项目根目录依次运行：

```powershell
node tools/live2d/audit-male-acting.mjs
node tools/live2d/package-male-acting.mjs
```

第一步验证当前 MOC 的实际绑定，第二步要求相同文件哈希，再补齐默认姿态、眼嘴分组和三个 motion3 文件。预览代码修改后，在 `tools/live2d` 中运行 `node build.mjs`；测试为 `node --test test/*.test.mjs`。所有产物与回执保存在 G 盘项目内。
