# 分层 PNG → 普通栅格 PSD

`package-layered-psd.py` 将共用画布的 PNG 图层打包为真正的分层 PSD，供 Cubism Editor 导入。它沿用已成功导入 Editor 的流程样模 PSD 格式，保留 72 dpi ResolutionInfo，并增加隐藏层及 Unicode 图层名支持。此工具不绑定变形器、不生成 MOC3，也不修改输入图片。

## 输入清单

```json
{
  "canvas": { "width": 2048, "height": 2048 },
  "layers": [
    { "name": "Body", "file": "Body.png", "visible": true },
    { "name": "Head", "file": "Head.png", "visible": true },
    { "name": "Outfit_B_备选", "file": "Outfit_B.png", "visible": false }
  ]
}
```

- `layers` 按**从底到顶**排列，至少 2 层，层名必须唯一。未填写 `visible` 时默认为 `true`；填写时必须是 JSON 布尔值。
- 所有文件必须是**同画布尺寸、8 位 RGBA、单帧 PNG**，每层至少包含一个 alpha 大于 0 的像素。不会自动把 RGB、索引色或 16 位图片转换后混入。
- PNG 相对路径以清单所在目录为基准，也可填写 G 盘项目内绝对路径。清单、PNG 和输出必须解析到 `G:\WBSpace\AIDebate` 内；外部路径或指向项目外的链接会被拒绝。
- 隐藏的备用头发、脸或服装仍作为完整独立图层保存，但不加入预览和 PSD 的合成图。

## 执行

依赖 Pillow，当前使用已有的 G 盘 Python。将清单和路径换为实际角色路径：

```powershell
& 'G:/MiniMax-H3/ComfyUI_windows_portable/python_embeded/python.exe' -B `
  tools/live2d/package-layered-psd.py `
  'G:/WBSpace/AIDebate/design/live2d/male-master/source/layers.json' `
  --output 'G:/WBSpace/AIDebate/design/live2d/male-master/source/male-master.psd'
```

以上角色路径是使用示例。可运行的检查清单位于 `work/live2d/male-master/psd-packer-check/layers.json`。

输出三个文件：

| 文件 | 内容 |
|---|---|
| `male-master.psd` | 独立普通栅格层、RGBA、可见性与原画布坐标 |
| `male-master.preview.png` | 仅合成可见层 |
| `male-master.layers.json` | 输入来源、图层顺序/可见性/边界、尺寸、SHA256 |

默认裁去每层完全透明的外围区域，并用 PSD 层坐标保留原位置。`--no-crop` 保存整画布图层矩形。已存在的输出默认拒绝覆盖；确定要重打包时加 `--overwrite`。无效输入在任何输出写入前拒绝。

## 独立验证结果

2026-09-09，使用项目已有的 `psd-tools`，以原流程样模的五张 PNG 加一层隐藏的重复 Body 验证。隐藏 Body 放在最上层，打开后会遮住部分头与手臂，确保测试能够识别错误合成。

**全部通过：**裁切与整画布两个 PSD 变体、12 次独立逐层像素和恢复坐标比较、Unicode 层名、原始可见性、仅可见层的 PSD 合成/解码重合成/PNG 预览；启用隐藏层后，两种变体均产生预期像素变化。7 类非法输入在写出前被拒绝。原始五张 PNG 的哈希未变化。

- [验证报告](../../work/live2d/male-master/psd-packer-check/validation.json)
- [裁切 PSD](../../work/live2d/male-master/psd-packer-check/proof-with-hidden.psd)
- [可见层预览](../../work/live2d/male-master/psd-packer-check/proof-with-hidden.preview.png)
- [解码后启用隐藏层的对照](../../work/live2d/male-master/psd-packer-check/proof-with-hidden.decoder-hidden-enabled.png)

每个正式人物 PSD 仍需在真实 Cubism Editor 中检查导入、层名、叠放和遮挡，再开始制模。
