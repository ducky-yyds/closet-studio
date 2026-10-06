// Run the neural network away from the UI. This file and all runtime/model
// dependencies are served by the same static site; there are no API requests.
import * as ort from '../vendor/onnxruntime/ort.wasm.bundle.min.mjs';

ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;
ort.env.wasm.wasmPaths = new URL('../vendor/onnxruntime/', import.meta.url).href;
ort.env.logLevel = 'error';

let session;
let preparation;

function progress(stage, message, percent) {
  self.postMessage({ type: 'progress', stage, message, percent });
}

async function loadModel() {
  progress('download', '正在加载本地 AI 模型…', 8);
  const response = await fetch(new URL('./u2netp.onnx', import.meta.url));
  if (!response.ok) throw new Error(`模型加载失败（${response.status}），请检查网页资源后重试。`);
  const expected = Number(response.headers.get('content-length')) || 4574861;
  let model;
  if (response.body) {
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.byteLength;
      progress('download', '正在加载本地 AI 模型…', Math.min(48, 8 + size / expected * 40));
    }
    model = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { model.set(chunk, offset); offset += chunk.byteLength; }
  } else {
    model = new Uint8Array(await response.arrayBuffer());
  }
  progress('initialize', '正在启动 AI 抠图引擎，首次使用稍需等待…', 52);
  session = await ort.InferenceSession.create(model, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
    executionMode: 'sequential'
  });
  progress('ready', 'AI 抠图引擎已就绪', 60);
}

async function prepare() {
  if (session) return;
  preparation ??= loadModel().catch(error => { preparation = undefined; throw error; });
  await preparation;
}

self.onmessage = async ({ data }) => {
  const { id, type } = data;
  try {
    await prepare();
    if (type === 'prepare') {
      self.postMessage({ type: 'result', id });
      return;
    }
    if (type !== 'infer') throw new Error('未知的 AI 处理请求。');
    const tensor = new ort.Tensor('float32', data.input, [1, 3, 320, 320]);
    const outputs = await session.run({ [session.inputNames[0]]: tensor }, [session.outputNames[0]]);
    const result = outputs[session.outputNames[0]];
    const pixels = new Float32Array(result.data);
    const dims = result.dims;
    self.postMessage({ type: 'result', id, pixels, width: dims[dims.length - 1], height: dims[dims.length - 2] }, [pixels.buffer]);
    for (const output of Object.values(outputs)) output.dispose();
    tensor.dispose();
  } catch (error) {
    self.postMessage({ type: 'error', id, message: error.message || String(error) });
  }
};
