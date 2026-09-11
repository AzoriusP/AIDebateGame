(() => {
  // tools/live2d/src/bootstrap.ts
  (async () => {
    const load = (path) => new Promise((resolve, reject) => {
      const script = document.createElement("script");
      const timer = setTimeout(() => {
        script.remove();
        reject(new Error("\u672C\u5730\u811A\u672C\u8BFB\u53D6\u8D85\u65F6\uFF1A" + path));
      }, 15e3);
      script.src = path;
      script.onload = () => {
        clearTimeout(timer);
        resolve();
      };
      script.onerror = () => {
        clearTimeout(timer);
        script.remove();
        reject(new Error("\u7F3A\u5C11\u672C\u5730\u6587\u4EF6\uFF1A" + path));
      };
      document.head.append(script);
    });
    try {
      await load("/static/vendor/live2d/5-r.5/live2dcubismcore.min.js");
      if (!window.Live2DCubismCore) throw new Error("Cubism Core \u52A0\u8F7D\u540E\u672A\u80FD\u521D\u59CB\u5316");
      await load("/static/vendor/live2d/5-r.5/preview-runtime.js");
    } catch (error) {
      const status = document.getElementById("status");
      if (status) {
        status.dataset.level = "error";
        status.textContent = error.message + "\n\u8BF7\u5B8C\u6210\u5B98\u65B9 SDK/Core \u5B89\u88C5\u5E76\u91CD\u65B0\u6253\u5F00\u9A8C\u6536\u53F0\u3002";
      }
    }
  })();
})();
