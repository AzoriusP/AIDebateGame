> 2026-09-10：已取消换装与 NPC 模型；当前目标为固定主角的完整录屏演出。详见 `design/recording-protagonist-scope.md`。

# 男性三姿势 Live2D：基础动画绑定

更新：2026-09-09。**已在 Cubism Editor 5.3.04 FREE 中完成基础绑定，保存可编辑模型并导出真实 MOC；网页已接入。**

## 打开与使用

预览：http://127.0.0.1:8790/static/live2d-preview.html?source=male-acting

点击“我有异议！”：前倾准备后切入角色自身的左手伸指，保持至点击“结束发言 · 收手”。保持期间呼吸、眨眼和说话口型独立运行。可以手动选择站姿、前倾、左手指人，或暂停、继续。状态按钮调整呼吸与眨眼节律，尚不代表四种完整情绪表情。

## 当前交付

- 可编辑模型：`male-acting.cmo3`。
- 导入 PSD：`mesh-rig-source/male-acting-rig.psd`；12 个网格源层、三个姿态文件夹，画布 2048×1536。
- 运行包：`G:/WBSpace/AIDebate/demo/static/assets/live2d/male-acting/`，含 MOC、2048 图集、model3、pose3、参数清单和呼吸/眨眼/说话三个 motion3。
- 绑定审计：`G:/WBSpace/AIDebate/work/live2d/male-master/acting-v2/core-audit.json`。
- 运行包哈希：同工作目录 `runtime-package.json`。

## 实际绑定范围

| 参数/部件 | 已实现 |
|---|---|
| ParamBreath | 一个公共 Warp 带动全部 12 个网格轻微呼吸 |
| ParamEyeROpen | 三姿态近侧眼睛开合，远侧被遮挡眼未独立绑定 |
| ParamMouthOpenY | 三姿态闭口/开口层切换；自动说话使用两档口型 |
| PoseNeutral / PoseLean / PosePoint | 姿态互斥显示；异议进入、保持、退出由预览控制器管理 |

模型保留 27 个默认参数，**仅上述三个参数有有效绑定**。三姿态各含 Body、Eye、MouthClosed、MouthOpen。编辑源文件为便于检查保留多个姿态可见；运行包 pose3 默认只显示站姿。编辑时可在 Parts 中单独显示所需姿态。

左手稿使用 `klein-point-left-01_00002_.png`：左臂由画面右肩向右伸出，右臂下垂，胸前领带露出。站姿与前倾分别源自 `klein-neutral-02_00002_.png` 和 `klein-lean-02_00002_.png`。没有翻转整个人物。

## 验证与边界

官方 Core 校验 MOC 完整性、实际顶点/透明度变化及 54 组姿态与眼嘴呼吸组合，均通过。控制器测试包含持续保持、重复触发、打断和姿态互斥。浏览器已实际加载并显示新模型。

这是可继续制作的基础动画版本：姿态之间采用短促切帧，尚无连续肩肘运动；头发、面部、服装尚不能独立替换。眉形、完整情绪、其他手势、胜负收尾与完整对局演出仍需制作。衣色、袖口与局部手部细节仍需统一。

旧 `pose-sources/` 与错误手侧 `klein-point-04` 仅留档。`pose-sources-left-hand/` 是完整关键姿态原画包；当前绑定使用 `mesh-rig-source/`。早期 `rig-source/` 面部试拆存在重影，未用于最终模型。

旧 `male-master.cmo3` / `male-master.moc3` 保留；新版本通过 `source=male-acting` 单独选择。
