> 2026-09-10 范围已调整：固定一个 Live2D 主角、NPC 静态演出、取消创角与换装。以 `design/recording-protagonist-scope.md` 为准。下文中的共享 NPC 模型和多外观要求仅作历史记录。

# Live2D 角色接入契约

日期：2026-09-09。本文取代旧角色方案中“分层 sprite + CSS transform 等于共享骨骼”“大幅动作以后再议”的技术结论。交付目标是玩家与 NPC 使用真实 Live2D Cubism 模型，玩家可独立换脸、发型与衣服，并能表演四种心理状态和向前指的“我有异议”。

## 当前事实与验收边界

初次审查时，项目是原生 HTML/JavaScript 前端和 Python 服务端。已有角色资源是 PNG/WebP，未发现项目内的 `.moc3`、`.model3.json`、Cubism Core 或 Cubism Web Framework。局部检查 G 盘常用工具和下载目录也未发现现成安装包；这不等于穷举整台电脑。

现有整图可以继续作为过渡立绘、人物设计参考和四种表情参考。将整图裁成头与身体、让 CSS 平移/缩放或更换整张表情，不会产生可眨眼、可弯手臂的 Live2D 模型。不能以占位 JSON、改后缀的图片、伪造 MOC3 文件或官方示例人物宣称本项目角色已经完成。

Cubism 以 ArtMesh 网格、旋转/曲面变形器和参数驱动图像形变。它有可复用的绑定结构，但不是把任意图片挂上同一套 Spine 骨骼就能通用。共享成立的条件是模型在制作时采用相同参数 ID、范围、默认值、方向和视觉含义，并为每种外观制作对应形变。官方明确说明相同参数 ID 有利于共享动画数据。[术语与变形器](https://docs.live2d.com/en/cubism-editor-manual/glossary/)、[参数与动画复用](https://docs.live2d.com/en/cubism-editor-manual/parameter/)

## 目标接入方案：保留当前项目，单独增加模型渲染器

服务端继续提供对局数据和同源 `/static/` 文件。Cubism SDK for Web 编译成独立浏览器脚本，玩家、NPC 各持有自己的模型实例和透明 WebGL 画布，接收现有游戏状态。两个实例共享资源缓存、状态定义和动作文件，不共享正在变化的参数值。无需因角色动画重写 Python 服务或迁移游戏引擎。

本次实际已实现的是立绘控制器：`create`、`setCharacter`、`setEmotion`、`setSpeaking`、`setMotionEnabled`、`playObjection`、`pause`、`reset`、`destroy`，以及独立的表现参数驱动器。它还没有 Cubism SDK、WebGL 模型渲染或 `setAppearance` 换装实现。当前 `playObjection` 只接收语义与参数事件，返回 false 表示没有播放真实手臂画面。后续在这套接口后增加 Cubism 渲染器与外观选择接口。

目标模型加载完成前、失败时或 WebGL 不可用时展示同角色的整图立绘。当前立绘异步切换已经带请求序号，旧角色/旧状态的迟到资源不能覆盖新状态；实际模型渲染器也必须保持这一性质。页面隐藏时暂停更新；销毁时取消动画循环并释放纹理和模型。

官方 Web 模型加载路径从 `.model3.json` 读取模型、贴图和关联文件，再建立渲染器。新版本功能、Core 和导出格式要成套固定版本；本次查询的官方稳定版本是 Cubism 5 SDK for Web R5，示例更新顺序已使用 `CubismUpdateScheduler`。接入时跟随所固定版本的完整更新流程，避免同时复制多个版本的参数更新代码。[Web 模型加载](https://docs.live2d.com/en/cubism-sdk-manual/model-web/)、[官方 Web Samples](https://github.com/Live2D/CubismWebSamples)、[版本记录](https://github.com/Live2D/CubismWebSamples/releases)

## 一套母模与外观部件

首套母模应先完成一种体型和固定半身构图。在同一 `.cmo3` 中制作可替换的脸、发型、服装 Parts；每款部件绑定到相同的头、颈、躯干和手臂变形器结构。NPC 由相同母模派生或固定选择部件。体型、侧脸角度差异过大的 NPC 可有独立模型，但必须符合共享参数协议；同名参数不保证未经调校就产生相同观感。

不要将“脸”做成附带头发的整张头图，也不要将“衣服”做成附带手的整件躯干。建议美术层结构：

| 区域 | 必须可独立制作的内容 | 目的 |
|---|---|---|
| 头与脸 | 脸底、耳、颈，左右眉、眼白、瞳孔、上下眼睑，嘴内/上下唇 | 真正闭眼、视线、口型和情绪形变 |
| 发型 | 后发、前发、左右侧发及需要摆动的发束 | 换发型时保持正确前后遮挡和发丝物理 |
| 躯干与衣服 | 衣服躯干、领口、左右袖，露出的皮肤分离 | 呼吸带动胸肩，衣服随手臂运动 |
| 手臂与手 | 左右上臂、前臂、手；待机和指向姿态的替换图 | 异议动作有真实姿态变化 |
| 覆盖补绘 | 头发下的额头、衣领下的颈、手臂后面的衣服 | 形变或换装时不出现缺口 |

发型和衣服是“部件集合”，不是每个选择只对应一个图片。运行时以外观目录把某个选项映射到多个 Parts ID，隐藏同类其他选项并显示该集合。物理、表情和姿态动画不得覆盖外观选择；在统一更新流程明确部件透明度的所有权。

异议动作需要向前指的手、前臂透视、袖子和肩胸姿态，不能从自然下垂手臂整图中凭空拉伸出来。可用预制指向 Parts + 旋转变形器和网格形变完成“蓄势—伸指—停顿—收回”；有强透视变化时切换预绘手臂姿态比过度拉伸更稳定。导出时包含所有待切换的隐藏 Parts，姿态动画为涉及的 Parts 写出明确初始值，避免同时出现两只右手。[官方姿态切换方法](https://docs.live2d.com/en/cubism-editor-manual/change-pose/)

## 共享参数协议：debate-humanoid-v1

以下为制模目标，尚未有真实母模通过验收，不能据此声称任何现有 PNG 已具备这些参数。正式冻结前应由实现与首个模型共同验证。`ParamObjection` 和外观 Parts ID 是本项目约定，不是 Live2D 官方标准。

| 参数 | 范围 / 默认值 | 共用含义 |
|---|---|---|
| `ParamAngleX/Y/Z` | -30…30 / 0 | 头左右转、抬低、倾斜；沿官方方向约定 |
| `ParamBodyAngleX/Y/Z` | -10…10 / 0 | 躯干转动与倾斜；不同模型保持方向一致 |
| `ParamEyeLOpen/ROpen` | 0…1 / 1 | 左右眼闭合到自然睁开 |
| `ParamEyeBallX/Y` | -1…1 / 0 | 视线水平和垂直偏移 |
| `ParamBrowLY/RY` | -1…1 / 0 | 左右眉高低 |
| `ParamBrowLForm/RForm` | -1…1 / 0 | 左右眉形；母模定义紧张/悲观形态 |
| `ParamMouthOpenY` | 0…1 / 0 | 闭嘴到张嘴，供说话幅度控制 |
| `ParamMouthForm` | -1…1 / 0 | 悲观到微笑的嘴形 |
| `ParamBreath` | 0…1 / 0 | 呼吸周期中的胸肩变化 |
| `ParamObjection` | 0…1 / 0 | 自然姿势到完整伸指；需实际绑定与动作验证 |

标准参数来源：[官方标准参数表](https://docs.live2d.com/en/cubism-editor-manual/standard-parameter-list/)。如果某款脸需要额外参数，应加入显式映射或升级契约，不能在未知参数缺失时静默认定效果完成。模型参数清单需要在 Core 载入后核对 ID、范围和默认值，不能只根据 JSON 文件名判断。

外观目录应提供 `face`、`hair`、`outfit` 三个独立槽位。例如发型选项映射到 `PartHairAFront`、`PartHairABack`；衣服选项同时映射到躯干与左右袖。每个槽位至少两个外观通过眨眼、呼吸和伸指验收后，才能证明换装架构有效。一个母模的预置 Parts 可重用动作；之后任意新画的 PNG 仍须进编辑器做网格和绑定。

## 情绪、呼吸、眨眼与异议的合成

四个玩法状态统一为 `calm`（冷静/现有从容）、`anxious`（焦虑）、`tense`（紧张）、`desperate`（绝望）。情绪定义只决定脸部姿态、身体基调和呼吸/眨眼设置，游戏数值仍由原有规则决定。NPC 的得意、从容、动摇、被说服保留其游戏含义，通过明确映射进入模型表现层。

本次保留原玩法门槛：剩余 token 比例 ≥75% 从容，≥50% 紧张，≥35% 焦虑，否则绝望。验收台测试呼吸周期分别为 4.2 / 2.6 / 1.7 / 1.15 秒；只是待真实母模调校的表现配置，未展示成已完成的角色呼吸动画。

可以先以冷静较平缓、紧张幅度受抑、焦虑较急、绝望低头且节律不稳定作为美术调试方向；这些是演出选择，不是医学诊断或固定生理规则。实际周期、幅度和眨眼间隔在首套模型预览中调校，不把任意数值当作最终效果。

呼吸由 `CubismBreath` 或同等参数驱动实现，眨眼由 `CubismEyeBlink` 控制，`.model3.json` 的 `EyeBlink` 分组列出左右眼开合参数。四种情绪可用 `.exp3.json` 或明确定义的参数目标；异议用一次性的 `.motion3.json`。各层需要明确优先级：异议覆盖相关躯干/手臂参数，情绪继续控制允许叠加的表情，眨眼作用于眼部开合，说话作用于嘴部开合；动作结束平滑回到当前情绪。不要让每帧 idle、随机眼神或拖拽覆盖正在播放的伸指动作，也不要每帧重启动作。[呼吸](https://docs.live2d.com/en/cubism-sdk-manual/breath/)、[自动眨眼](https://docs.live2d.com/en/cubism-sdk-manual/autoeyeblink/)

## 实际需要交付的文件

| 内容 | 文件 | 来源与检查 |
|---|---|---|
| 可继续编辑的母模 | 分层 PSD、`.cmo3`；动画工程 `.can3` | 保存完整源文件，修脸/衣服和绑定依赖它们 |
| 可运行模型 | `.moc3` | 由 Cubism Editor 导出；不是 JSON，不允许伪造 |
| 模型清单 | `.model3.json` | `FileReferences` 指向真实模型和所有贴图 |
| 纹理 | 纹理图集 `.png` | 保留透明度，纹理编号与清单一致 |
| 动作 | `.motion3.json` | 至少有完整异议动作，状态 idle 可程序控制 |
| 表情 | `.exp3.json` | 若使用表情文件实现状态，四种状态完整 |
| 可选/按使用提供 | `.physics3.json`、`.pose3.json`、`.cdi3.json` 等 | 一旦清单引用就必须随包存在 |

`.moc3`、`.model3.json` 和贴图由 Cubism Editor 的嵌入式导出流程产出。`.cdi3.json` 不是编译模型的替代物；编辑器源文件也不能直接拿给 Web SDK 播放。[嵌入式资源导出](https://docs.live2d.com/en/cubism-editor-manual/export-moc3-motion3-files/)

Core 必须从 [Live2D 官方 Web SDK 下载页面](https://www.live2d.com/en/sdk/download/web/) 取得。官方 GitHub 的 Framework/Samples 不包含 Core。开发/生产对应 `live2dcubismcore.js` / `live2dcubismcore.min.js`；按实际 SDK 包和版本使用，不能假设另有必须下载的独立 WASM。页面也提供 Core 托管地址；发布时固定版本，避免使用会自动变化的 Latest。Core 使用 Live2D Proprietary Software License，Framework/Samples 使用 Live2D Open Software License；保留随包许可说明。开发试验无初始费用，发行前按实际主体与用途核实适用条款，普通个人/小规模企业和可扩展应用的规则不同。[官方 Core 文件说明](https://github.com/Live2D/CubismWebSamples/blob/develop/Core/README.md)、[发行许可说明](https://www.live2d.com/en/sdk/license/)

## 清单与本地验收

`demo/static/characters.json` 的 `version` 为 1，`characters` 按角色 ID 登记。每个角色有 `label`、`renderer`、状态到图片的 `portraits` 和本地 `fallback`。真实模型到位后才增加：

```json
{
  "live2d": {
    "model": "/static/assets/live2d/player/player.model3.json",
    "contract": "debate-humanoid-v1"
  }
}
```

路径是结构示例，当前不存在时不能加入生产清单。仅准备好接入代码时，`renderer: "portrait"` 明确表示仍在使用立绘。顶层 `live2d` 配置为空不表示 SDK 已经安装。

无依赖验收工具只读资源，默认将 JSON 报告写到标准输出：

```powershell
node demo/tools/validate_character_assets.mjs
node demo/tools/validate_character_assets.mjs --require-live2d
node demo/tools/validate_character_assets.mjs --report G:\WBSpace\AIDebate\work\character-assets-report.json
```

`--manifest PATH`、`--static-root PATH` 可指定测试清单和资产根目录。返回码 0 为声明的文件检查通过，1 为验收失败，2 为命令/运行错误。`--require-live2d` 要求清单中每个角色都有实际模型；仅有立绘时必须失败。工具检查所有声明的图片与 fallback、model3 的版本和必需引用，递归检查 `FileReferences` 中的 Moc/Textures/Motions/Expressions/Physics/Pose/DisplayInfo/Sound 和扩展文件引用，同时检查 JSON 可解析、路径不越出 static、符号链接不越界、MOC3 文件头与基本二进制特征。

静态工具通过不等于 Cubism 模型可用：它无法验证全部二进制一致性、网格、遮罩、参数绑定或画面质量。最终必须由对应 Core 真正加载，并完成如下验收：

1. 玩家和 NPC 都在实际对局中渲染，模型/纹理/动作请求没有缺失。
2. 四种心理状态可反复切换，呼吸与真实闭眼可见，快速切换不回跳旧状态。
3. 三种外观槽位独立切换，换衣不换脸，换发不改变眼睛位置，无重复手臂和穿帮。
4. 玩家触发异议时完整伸指，停顿后回到当前心理状态，NPC 同一动作契约可播放。
5. 角色更换、窗口缩放、浏览器后台恢复、关闭动画和资源失败均有可靠行为。

## 制作顺序与完成定义

先复用现有合格整图作为可玩版本的立绘，再完成一套母模需要的分层补绘、网格/变形器绑定、四状态、伸指动作、三槽各两款外观。母模经过 Cubism Editor 导出及真实 Web 运行验收后，再扩展其他 NPC 和外观数量。

代码可以自动完成状态控制、资源清单/加载、外观映射、动作调度、眨眼与呼吸参数、校验和回退。生图可以提供新的可拆分设计与补绘素材。可变形网格、遮罩、变形器层级、关键形态和 `.moc3` 编译导出，仍需要真实 Cubism 制模工具流程；不能用继续生成更多整图替代这一步。完整交付必须同时包含模型资产与对局里的动作效果。
