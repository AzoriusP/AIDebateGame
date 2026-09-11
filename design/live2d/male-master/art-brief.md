# 男性母模：原画制作规格与表演修订

用户已授权由代理负责美术取舍并继续生产。第一版已完成 13 层 PSD、正式 `.cmo3`、真实 `.moc3` 与五参数绑定，并在浏览器通过检查；完整四状态表情、换装和 NPC 尚未完成。任务数据与生产工具继续遵守 G 盘存储要求。

2026-09-09 新增动作主参考：[视频观察与第二版制作规格](../acting-reference-BV1bb4y1z78w.md)。后续制作以该规格为准：清楚的 3/4 朝向对手，整条手臂向对手伸指；先做站立、前倾质询、转肩伸指三姿态。当前朝镜头伸出的巨大手掌需要重画，第一版文件保留作为流程原型。以下近正面的首版构图与英文提示保留为来源记录，不继续用于第二版构图。

## 保留的设计

以 references/player-style.png 为线条、轮廓和硬边赛璐璐阴影参考；以 references/player-identity.png 保留现有玩家的年轻成年男性身份、黑紫短发、红制服外套、白衬衫、深蓝领带及少量金色点缀。只沿用设计与气质，不照搬旧图的背景、构图、额外手臂和缺损。

旧 male_char/calm.png 虽标冷静，但画面包含头顶多余手臂和彩色背景；只能保留身份与配色参考，不直接作为绑定母稿。parts/transparent 中白衬衫半身像比例清楚，但偏写实、头发与脸合并；可以参考身体比例，不能充当独立层。

## 第一版已使用的原画规格

- 单一成年男性，头顶至腰下完整入画，四周留白；人物偏正面、轻微三分之二角度，两眼可见。
- 冷静、中性嘴形，双臂自然放低，手掌结构正确，禁止头顶手臂、重复手指和额外人物。
- 保持原参考的利落卡通线条与块面阴影，减少织物纹理和写实反光。
- 单色背景，能清楚分离轮廓；不画地面、法庭、光效、文字、装饰框和水印。
- 先通过完整母稿检查，再在同一像素坐标上分层补绘。不能将分别生成的人物或按矩形切片的图当成可拼接层。

## 分层与绑定目标

共同画布、统一锚点。分离后发、前发、脸底、左右眼白/瞳孔/上眼睑、左右眉、嘴、颈、躯干衣服、左右上臂/前臂/手。额头、颈、肩和躯干被遮挡的部分须补全。

第一轮绑定 ParamBreath、ParamEyeLOpen、ParamEyeROpen、ParamMouthOpenY、ParamObjection，并检查头颈和衣服在形变时没有裂缝。异议手势须补绘透视正确的手与袖，不能靠待机手掌旋转冒充。

第二轮在同一母模里增加 2 发型、2 面部外观、2 衣服，每次只切换一个部件，复核四种状态与异议姿势。通过后再接入正式玩家/NPC。

## 第一版原画生成提示（历史记录）

Create one original adult male character model reference for a Japanese courtroom debate adventure game. Use the supplied black-jacket player image only as the visual-style reference for angular facial structure, bold hand-drawn contour lines and restrained hard-edged cel shading. Use the red-uniform image only as the identity and costume reference: young adult man, short black-purple hair, red uniform jacket, white shirt, dark blue tie and small gold accents. Keep his confident but neutral demeanor. Do not import the extra blue arm, background or pose from either reference. Recompose as an almost frontal, slight three-quarter upper-body standing pose, both eyes visible, full hair silhouette and body down past the waist fully inside the image, both arms lowered naturally and both hands anatomically clear. Simple light solid background with clean silhouette separation. Keep generous empty margins. One character, exactly two arms and two hands, no raised arm over the head, no extra limbs, no props, no courtroom, no text or frame. This is a master artwork for later Live2D layer separation, not a finished Live2D rig or a sprite sheet. Do not draw an exploded parts layout.


