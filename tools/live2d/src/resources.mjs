// Local model packages cannot fetch remote or parent-directory references.
const PROJECT_MODELS = Object.freeze({
  proof: '/static/assets/live2d/pipeline-proof/proof.model3.json',
  'male-master': '/static/assets/live2d/male-master/male-master.model3.json',
  'male-acting': '/static/assets/live2d/male-acting/male-acting.model3.json',
});
export function projectModelPath(name) {
  return Object.hasOwn(PROJECT_MODELS, name) ? PROJECT_MODELS[name] : null;
}
export function cleanPath(value) {
  if (typeof value !== 'string' || !value || /[\\?#:\u0000-\u001f]/.test(value) || value.startsWith('/')) throw new Error('模型引用必须是包内相对路径：' + value);
  let decoded;
  try { decoded = decodeURIComponent(value); } catch { throw new Error('模型文件名编码无效：' + value); }
  if (decoded !== value && /[\\/:?#%]/.test(decoded)) throw new Error('模型文件名包含编码路径：' + value);
  const pieces = value.split('/');
  if (pieces.some(p => p === '..' || p === '')) throw new Error('模型引用不能越出文件夹：' + value);
  return pieces.filter(p => p !== '.').join('/');
}
export function modelFiles(files) {
  return [...files].filter(file => /\.model3\.json$/i.test(file.webkitRelativePath || file.name));
}
export function folderSource(files, modelFile) {
  const path = modelFile.webkitRelativePath || modelFile.name;
  const base = path.slice(0, path.lastIndexOf('/') + 1);
  const entries = new Map();
  for (const file of files) {
    const key = file.webkitRelativePath || file.name;
    if (entries.has(key)) throw new Error('同名文件冲突：' + key);
    entries.set(key, file);
  }
  return {
    label: path,
    async model() { return modelFile.arrayBuffer(); },
    async asset(relative) {
      const key = base + cleanPath(relative);
      const file = entries.get(key);
      if (!file) throw new Error('所选文件夹缺少：' + key);
      return file.arrayBuffer();
    },
    dispose() {}
  };
}
export function urlSource(path, origin) {
  const url = new URL(path, origin);
  if (url.origin !== new URL(origin).origin || !url.pathname.startsWith('/static/assets/live2d/') || !url.pathname.endsWith('.model3.json') || url.search || url.hash) throw new Error('只允许项目内 /static/assets/live2d/ 模型');
  const base = new URL('.', url);
  const controller = new AbortController();
  async function read(target) {
    const response = await fetch(target, { signal: controller.signal, cache: 'no-store', credentials: 'omit', redirect: 'error' });
    if (!response.ok) throw new Error('文件读取失败（' + response.status + '）：' + target.pathname);
    return response.arrayBuffer();
  }
  return { label: url.pathname, model: () => read(url), asset: ref => read(new URL(cleanPath(ref).split('/').map(encodeURIComponent).join('/'), base)), dispose: () => controller.abort() };
}
export function parseModel(buffer) {
  const manifest = JSON.parse(new TextDecoder().decode(buffer));
  if (manifest.Version !== 3 || !manifest.FileReferences?.Moc || !Array.isArray(manifest.FileReferences.Textures) || !manifest.FileReferences.Textures.length) throw new Error('需要 Cubism 导出的 Version 3 模型清单、Moc 和纹理');
  const refs = manifest.FileReferences;
  cleanPath(refs.Moc);
  refs.Textures.forEach(cleanPath);
  return manifest;
}

export function motionParameterOwnership(curves, eyeIds, lipIds) {
  const parameters = new Set();
  for (const curve of curves || []) {
    if (curve.Target === 'Parameter') parameters.add(curve.Id);
    if (curve.Target === 'Model' && curve.Id === 'EyeBlink') eyeIds.forEach(id => parameters.add(id));
    if (curve.Target === 'Model' && curve.Id === 'LipSync') lipIds.forEach(id => parameters.add(id));
  }
  return parameters;
}
