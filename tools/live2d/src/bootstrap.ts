// R5 evaluates Core constants while importing model modules. Load Core first.
(async () => {
  const load = (path: string) => new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    const timer = setTimeout(() => { script.remove(); reject(new Error('本地脚本读取超时：' + path)); }, 15000);
    script.src = path;
    script.onload = () => { clearTimeout(timer); resolve(); };
    script.onerror = () => { clearTimeout(timer); script.remove(); reject(new Error('缺少本地文件：' + path)); };
    document.head.append(script);
  });
  try {
    await load('/static/vendor/live2d/5-r.5/live2dcubismcore.min.js');
    if (!(window as any).Live2DCubismCore) throw new Error('Cubism Core 加载后未能初始化');
    await load('/static/vendor/live2d/5-r.5/preview-runtime.js');
  } catch (error) {
    const status = document.getElementById('status');
    if (status) { status.dataset.level = 'error'; status.textContent = (error as Error).message + '\n请完成官方 SDK/Core 安装并重新打开验收台。'; }
  }
})();
