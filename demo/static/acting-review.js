const poses = {
  Neutral: ['站立倾听：角色侧身面向右方，双臂自然放低', '站姿用于确认人物身份、服装与基础比例。'],
  Lean: ['前倾质询：角色压低头颈、身体前倾，目光朝向右方', '头颈与肩胸共同前倾。衣服颜色偏鲜，需要向站姿统一。'],
  Point: ['左手伸指异议：角色左臂朝右方伸出，右手自然垂下', '已按参考改为角色左手伸指、右臂放低。胸前领带保持露出；服装色彩和袖口细节仍待统一。']
};
const poseImage = document.getElementById('pose-image');
poseImage.addEventListener('error', () => { document.getElementById('load-error').hidden = false; });
poseImage.addEventListener('load', () => { document.getElementById('load-error').hidden = true; });
for (const button of document.querySelectorAll('[data-pose]')) {
  button.addEventListener('click', () => {
    const key = button.dataset.pose;
    if (!Object.hasOwn(poses, key)) return;
    poseImage.src = `/static/assets/acting-v2/${key === 'Point' ? 'Point-left' : key}.png`;
    poseImage.alt = poses[key][0];
    document.getElementById('pose-note').textContent = poses[key][1];
    for (const choice of document.querySelectorAll('[data-pose]')) choice.setAttribute('aria-pressed', String(choice === button));
  });
}
for (const button of document.querySelectorAll('[data-bg]')) {
  button.addEventListener('click', () => {
    document.getElementById('stage').className = 'stage ' + button.dataset.bg;
    for (const choice of document.querySelectorAll('[data-bg]')) choice.setAttribute('aria-pressed', String(choice === button));
  });
}
