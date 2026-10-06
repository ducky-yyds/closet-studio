// U2NetP saliency inference: local model + local ONNX WASM inside a Web Worker.
// See THIRD_PARTY_NOTICES.md for provenance, licensing, and upstream transforms.
export const AI_INFO = Object.freeze({
  name: '本地 AI 自动抠图',
  model: 'U2NetP',
  engine: 'U2NetP · ONNX Runtime',
  sizeText: '首次加载约 17 MB，照片在本机处理',
  modelBytes: 4574861,
  runtimeBytes: 11994490,
  local: true
});

const subscribers = new Set();
const requests = new Map();
let worker;
let preparing;
let prepared = false;
let nextID = 0;
let latestProgress;
let inferenceQueue = Promise.resolve();

function report(onProgress, stage, message, percent) {
  onProgress?.({ stage, message, percent });
}

function abortIfNeeded(signal) {
  if (signal?.aborted) throw new DOMException('已停止这次图片处理。', 'AbortError');
}

function resetWorker(error) {
  worker?.terminate();
  worker = undefined;
  preparing = undefined;
  prepared = false;
  latestProgress = undefined;
  for (const { reject } of requests.values()) reject(error);
  requests.clear();
}

function getWorker() {
  if (worker) return worker;
  if (typeof Worker === 'undefined' || typeof WebAssembly === 'undefined') {
    throw new Error('此浏览器无法运行本地 AI，请使用新版 Chrome、Edge、Safari 或 Firefox。');
  }
  const active = new Worker(new URL('../assets/ai/cutout-worker.js', import.meta.url), { type: 'module' });
  worker = active;
  active.onmessage = ({ data }) => {
    if (active !== worker) return;
    if (data.type === 'progress') {
      latestProgress = { stage: data.stage, message: data.message, percent: data.percent };
      for (const callback of subscribers) callback(latestProgress);
      return;
    }
    const request = requests.get(data.id);
    if (!request) return;
    requests.delete(data.id);
    if (data.type === 'error') {
      const error = new Error(data.message || 'AI 抠图失败，请重试。');
      request.reject(error);
      resetWorker(error);
    } else {
      request.resolve(data);
    }
  };
  active.onerror = event => {
    if (active !== worker) return;
    event.preventDefault();
    resetWorker(new Error('AI 引擎加载失败，请检查网络或刷新页面后重试。'));
  };
  return active;
}

function requestWorker(type, input) {
  return new Promise((resolve, reject) => {
    const id = ++nextID;
    try {
      const active = getWorker();
      requests.set(id, { resolve, reject });
      active.postMessage({ id, type, input }, input ? [input.buffer] : []);
    } catch (error) {
      requests.delete(id);
      reject(error);
    }
  });
}

export async function prepareCutout({ onProgress } = {}) {
  if (prepared) {
    report(onProgress, 'ready', 'AI 抠图引擎已就绪', 60);
    return;
  }
  if (onProgress) {
    subscribers.add(onProgress);
    if (latestProgress) onProgress(latestProgress);
  }
  try {
    preparing ??= requestWorker('prepare').then(() => { prepared = true; }).catch(error => {
      preparing = undefined;
      throw error;
    });
    await preparing;
  } finally {
    if (onProgress) subscribers.delete(onProgress);
  }
}

function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('此浏览器无法处理图片，请更新浏览器后重试。');
  return { canvas, context };
}

async function decodePhoto(source, signal) {
  if (typeof source !== 'string' || !/^data:image\/(?:png|jpe?g|webp|avif|gif);/i.test(source)) {
    throw new Error('请先选择一张有效的衣物照片。');
  }
  abortIfNeeded(signal);
  const image = new Image();
  image.src = source;
  try { await image.decode(); } catch { throw new Error('图片无法读取，请换一张 JPG、PNG 或 WebP 图片。'); }
  abortIfNeeded(signal);
  if (!image.naturalWidth || !image.naturalHeight) throw new Error('图片尺寸无效。');
  return image;
}

function inputTensor(image) {
  const { context } = makeCanvas(320, 320);
  // Transparent source pixels are composited on white for the RGB network;
  // the original source alpha is retained separately in the finished cutout.
  context.fillStyle = '#fff';
  context.fillRect(0, 0, 320, 320);
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, 320, 320);
  const rgba = context.getImageData(0, 0, 320, 320).data;
  let maximum = 1;
  for (let i = 0; i < rgba.length; i += 4) maximum = Math.max(maximum, rgba[i], rgba[i + 1], rgba[i + 2]);
  const size = 320 * 320;
  const input = new Float32Array(size * 3);
  const means = [0.485, 0.456, 0.406];
  const deviations = [0.229, 0.224, 0.225];
  for (let i = 0; i < size; i++) {
    for (let channel = 0; channel < 3; channel++) {
      input[channel * size + i] = (rgba[i * 4 + channel] / maximum - means[channel]) / deviations[channel];
    }
  }
  return input;
}

function applyMask(image, result) {
  let minimum = Infinity;
  let maximum = -Infinity;
  for (const value of result.pixels) { minimum = Math.min(minimum, value); maximum = Math.max(maximum, value); }
  const range = maximum - minimum;
  if (!Number.isFinite(range) || range < 1e-6) throw new Error('AI 没有识别到清晰的衣物，请换一张衣物与背景分明的照片。');
  const mask = makeCanvas(result.width, result.height);
  const maskPixels = mask.context.createImageData(result.width, result.height);
  for (let i = 0; i < result.pixels.length; i++) {
    const alpha = Math.round(Math.max(0, Math.min(1, (result.pixels[i] - minimum) / range)) * 255);
    maskPixels.data[i * 4] = 255;
    maskPixels.data[i * 4 + 1] = 255;
    maskPixels.data[i * 4 + 2] = 255;
    maskPixels.data[i * 4 + 3] = alpha;
  }
  mask.context.putImageData(maskPixels, 0, 0);

  const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const working = makeCanvas(width, height);
  working.context.imageSmoothingQuality = 'high';
  working.context.drawImage(image, 0, 0, width, height);
  working.context.globalCompositeOperation = 'destination-in';
  working.context.drawImage(mask.canvas, 0, 0, width, height);
  working.context.globalCompositeOperation = 'source-over';

  const pixels = working.context.getImageData(0, 0, width, height);
  let left = width, top = height, right = -1, bottom = -1;
  let foreground = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4 + 3;
      const alpha = pixels.data[offset];
      // Remove very weak residual saliency without hardening the clothing edge.
      if (alpha < 10) { pixels.data[offset] = 0; continue; }
      if (alpha > 32) {
        left = Math.min(left, x); top = Math.min(top, y);
        right = Math.max(right, x); bottom = Math.max(bottom, y);
      }
      if (alpha > 128) foreground++;
    }
  }
  if (right < left || foreground < width * height * 0.002) {
    throw new Error('AI 没有识别到清晰的衣物，请换一张衣物完整、背景简单的照片。');
  }
  working.context.putImageData(pixels, 0, 0);
  const cropWidth = right - left + 1;
  const cropHeight = bottom - top + 1;
  const padding = Math.max(12, Math.round(Math.max(cropWidth, cropHeight) * 0.035));
  const paddedWidth = cropWidth + padding * 2;
  const paddedHeight = cropHeight + padding * 2;
  const outputScale = Math.min(1, 1200 / Math.max(paddedWidth, paddedHeight));
  const output = makeCanvas(Math.max(1, Math.round(paddedWidth * outputScale)), Math.max(1, Math.round(paddedHeight * outputScale)));
  output.context.imageSmoothingQuality = 'high';
  output.context.drawImage(working.canvas, left, top, cropWidth, cropHeight,
    padding * outputScale, padding * outputScale, cropWidth * outputScale, cropHeight * outputScale);
  return output.canvas.toDataURL('image/png');
}

export async function removeBackground(source, { onProgress, signal } = {}) {
  abortIfNeeded(signal);
  report(onProgress, 'decode', '正在读取衣物照片…', 2);
  const image = await decodePhoto(source, signal);
  await prepareCutout({ onProgress: progress => { if (!signal?.aborted) onProgress?.(progress); } });
  abortIfNeeded(signal);
  const previous = inferenceQueue;
  let release;
  inferenceQueue = new Promise(resolve => { release = resolve; });
  try {
    await previous;
    abortIfNeeded(signal);
    // An earlier failed inference may have reset the worker while queued.
    if (!prepared) await prepareCutout({ onProgress });
    abortIfNeeded(signal);
    report(onProgress, 'infer', 'AI 正在识别衣物并去除背景…', 68);
    const input = inputTensor(image);
    const result = await requestWorker('infer', input);
    // Inference itself is not abortable. Discard a result from a closed dialog.
    abortIfNeeded(signal);
    report(onProgress, 'finish', '正在保留衣物边缘并生成透明照片…', 92);
    const cutout = applyMask(image, result);
    abortIfNeeded(signal);
    report(onProgress, 'done', 'AI 抠图完成', 100);
    return cutout;
  } finally {
    release();
  }
}
