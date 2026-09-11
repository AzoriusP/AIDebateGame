# 本地 Cubism Web 制作验收台

页面：`http://127.0.0.1:8790/static/live2d-preview.html`（服务端口按实际启动值）。

使用官方 Cubism SDK for Web **5-r.5**、同包 Core **06.00.0001** 和 R5 Framework。下载归档、来源地址、SHA256 记录在 `vendor/sources.json`。Core 文件和许可说明已经放入 `demo/static/vendor/live2d/5-r.5`；完整下载保留于项目 `work/live2d`。所有新增任务文件及 npm 缓存都在 G 盘项目内。

## 构建

现有 Node 是电脑已安装的运行时；本工具没有安装新的 C 盘软件。PowerShell 在项目根目录运行：

```powershell
$env:TEMP = 'G:\WBSpace\AIDebate\work\live2d\tmp'
$env:TMP = $env:TEMP
npm.cmd ci --prefix tools/live2d --cache G:/WBSpace/AIDebate/work/live2d/npm-cache --ignore-scripts --no-audit --no-fund
node tools/live2d/node_modules/typescript/bin/tsc --project tools/live2d/tsconfig.json
node tools/live2d/build.mjs
node --test tools/live2d/test/*.test.mjs
```

源码 `src/preview.ts` 编译到 `demo/static/vendor/live2d/5-r.5/preview-runtime.js`，引导脚本 `src/bootstrap.ts` 编译到 `demo/static/live2d-preview.js`。引导先加载 Core，再加载 Framework，避免 R5 模块在顶层读取尚不存在的 Core 常量。固定官方 Framework 源码不修改；Shader 文件随构建复制到同源静态目录。此验收页不会修改游戏角色清单，也不会默认加载官方示例人物。

## 当前流程样模

项目原创的几何样模已在 **Cubism Editor 5.3.04 FREE** 中完成网格和参数绑定，并实际导出到 `demo/static/assets/live2d/pipeline-proof/`。`proof.moc3` 为 17,792 字节，包含 **5 个网格、28 个参数**；其中呼吸、左右眼、异议这四个参数已经检测出有效形变。它用于证明分层 PSD → Editor 制模 → MOC3 导出 → Web 播放的流程，尚不代表玩家/NPC 美术、独立换装或完整人物演出已完成。

运行 `node tools/live2d/package-proof.mjs` 已为真实导出加入 `EyeBlink` 分组和原创的 **1.6 秒 `Objection` 动作**：`ParamObjection` 从 0 抬到 1，停顿后回到 0，不循环。打包保留原始模型清单备份，不改写 MOC3 或纹理。该动作已通过固定 R5 的 `CubismMotionJson.hasConsistency()` 和 `CubismMotion.create(..., true)` 检查。

独立 Core 检测结果见 [proof-core-audit.json](../../work/live2d/proof-core-audit.json)。Core 06.00.0001 一致性检查通过，设置 min/max 后的实际网格变化如下；MOC3 审计前后 SHA256 相同。

| 参数 | 范围 / 默认值 | 变化网格 | 最大顶点差 |
|---|---|---|---:|
| `ParamBreath` | 0…1 / 0 | `Proof_Body` | 0.021514 |
| `ParamEyeLOpen` | 0…1 / 1 | `Proof_EyeL` | 0.069171 |
| `ParamEyeROpen` | 0…1 / 1 | `Proof_EyeR` | 0.069171 |
| `ParamObjection` | 0…1 / 0 | `Proof_ArrowArm` | 0.296240 |

复跑只读 Core 检测：`node work/live2d/audit-proof-core.mjs`。上述顶点差使用 Core 模型坐标单位；每个参数只改变表中对应网格。

## 验收操作

1. 将真正 Editor 导出的 `.moc3`、纹理和 `.model3.json` 放进 `demo/static/assets/live2d/pipeline-proof/`，清单名为 `proof.model3.json`。点击“加载项目流程样模”。也可选完整本地导出文件夹，通过 File API 读取，不上传。
2. 载入成功时读取真实 Core 的网格、参数、部件、动作及表情数量；没有动作或表情时对应按钮禁用。
3. 点击“检测四个核心参数”。分别设 `ParamBreath`、`ParamEyeLOpen`、`ParamEyeROpen`、`ParamObjection` 的 min/max，调用 Core update，比较 Drawable 顶点和 opacity。结果直接显示在页面。检测不经过呼吸、表情和物理合成，结束后恢复原值。
4. 拖动参数后会固定该值；取消勾选恢复动画接管。动作优先于程序呼吸/眨眼；包括 motion 中 Model/EyeBlink 与 Model/LipSync 映射到的参数。手动固定参数优先级最高。
5. 播放模型导出清单中的动作；异议按钮只在 `Objection` 或“异议”动作存在时启用。一次播放后回到当前状态。参数变化不自动证明画面质量合格，需肉眼检查。
6. 验证暂停、窗口缩放、后台恢复、卸载重载、缺失文件提示。WebGL 丢失恢复时清理 R5 静态 shader cache，需重新加载模型。

## 已完成检查及边界（2026-09-09）

- TypeScript 校验和完整构建通过；资源路径/本地读取/拒绝假清单/动作参数所有权回归测试通过。
- 实际项目 MOC3 已通过同包 Core 一致性及四参数有效性检测，结果均为 PASS。
- 网页已实际显示这个项目几何样模，页面“检测四个核心参数”的四项检测均为 PASS。
- 浏览器已验证缺失项目 `.model3.json` 时显示 404 中文提示并保持可重试。
- 浏览器视觉检查通过：左右眼参数设为最小值时双眼闭成细线；`ParamObjection` 设为最大值时手臂进入指向姿态。实际播放 `Objection` 的参数采样为 `[0.676, 0.806, 0.936, 1]`；在指向姿态暂停后，间隔检查 `ParamObjection = 1`、`ParamBreath = 0.01` 保持不变，继续后动作结束并回到 `ParamObjection = 0`。
- 模型卸载后重新加载成功，并再次执行四参数绑定检测，全部 PASS。
- 冷静、紧张、焦虑、绝望按钮逐一切换后，所选按钮的 `aria-pressed` 均为 `true`，页面呼吸读数持续变化。这验证状态控制和呼吸参数驱动，尚不代表四套人物表情已经制作。
- 本轮浏览器检查的控制台 warning/error 记录为空。证据见 [浏览器验收记录](../../work/live2d/browser-proof-verification.json) 和 [指向姿态截图](../../outputs/live2d-proof-point.png)。
- 文件夹导入、WebGL 丢失恢复、移动端布局及长时间稳定性尚未实测；窗口缩放与后台恢复也尚未记为通过。
- 样模目前没有表情文件、换装 Parts 或正式人物美术，不能据此宣称四种人物表情、三槽换装及玩家/NPC 接入已经完成。
- Browser 的目录 filechooser 自动化在设置 SDK 示例目录时未返回，已中断；没有用官方示例作为项目制作成功证据。本地文件夹导入的解析单元测试通过，完整选择器行为待进一步验收。
