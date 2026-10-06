import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const vendor = path.join(root, 'assets/vendor/onnxruntime');
const modelDir = path.join(root, 'assets/ai');
const version = '1.23.2';
const modelSource = 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx';
const modelMD5 = '8e83ca70e441ab06c318d82300c84806';
const runtimeFiles = ['ort.wasm.bundle.min.mjs', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm'];

await mkdir(vendor, { recursive: true });
await mkdir(modelDir, { recursive: true });
const installed = JSON.parse(await readFile(path.join(root, 'node_modules/onnxruntime-web/package.json'), 'utf8'));
if (installed.version !== version) throw new Error(`Install onnxruntime-web@${version} before vendoring.`);
for (const name of runtimeFiles) {
  await copyFile(path.join(root, 'node_modules/onnxruntime-web/dist', name), path.join(vendor, name));
}

async function download(url) {
  // curl honours the workstation's HTTPS proxy settings on older Node builds.
  // Fail within a bounded time instead of hanging on a blocked upstream host.
  try {
    const { stdout } = await promisify(execFile)(process.platform === 'win32' ? 'curl.exe' : 'curl',
      ['--fail', '--location', '--connect-timeout', '15', '--max-time', url.endsWith('.onnx') ? '600' : '90', '--silent', '--show-error', url],
      { encoding: 'buffer', maxBuffer: 30 * 1024 * 1024 });
    return stdout;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const response = await fetch(url, { signal: AbortSignal.timeout(90000) });
    if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
    return Buffer.from(await response.arrayBuffer());
  }
}

let model;
try { model = await readFile(path.join(modelDir, 'u2netp.onnx')); } catch { /* Download below. */ }
if (!model || createHash('md5').update(model).digest('hex') !== modelMD5) {
  model = await download(modelSource);
  if (createHash('md5').update(model).digest('hex') !== modelMD5) throw new Error('U2NetP checksum does not match the upstream model.');
  await writeFile(path.join(modelDir, 'u2netp.onnx'), model);
}

async function ensureNotice(filename, source, mirror) {
  try { if ((await readFile(filename)).length > 0) return; } catch { /* Fetch missing license. */ }
  let notice;
  try { notice = await download(source); } catch { notice = await download(mirror); }
  await writeFile(filename, notice);
}
await ensureNotice(path.join(modelDir, 'LICENSE-U2NET.txt'),
  'https://raw.githubusercontent.com/xuebinqin/U-2-Net/master/LICENSE',
  'https://cdn.jsdelivr.net/gh/xuebinqin/U-2-Net@master/LICENSE');
await ensureNotice(path.join(vendor, 'LICENSE.txt'),
  `https://raw.githubusercontent.com/microsoft/onnxruntime/v${version}/LICENSE`,
  `https://cdn.jsdelivr.net/gh/microsoft/onnxruntime@v${version}/LICENSE`);
await ensureNotice(path.join(vendor, 'ThirdPartyNotices.txt'),
  `https://raw.githubusercontent.com/microsoft/onnxruntime/v${version}/ThirdPartyNotices.txt`,
  `https://cdn.jsdelivr.net/gh/microsoft/onnxruntime@v${version}/ThirdPartyNotices.txt`);

const files = [];
for (const filename of [...runtimeFiles.map(name => path.join(vendor, name)), path.join(modelDir, 'u2netp.onnx')]) {
  const bytes = await readFile(filename);
  files.push({ path: path.relative(root, filename).split(path.sep).join('/'), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
await writeFile(path.join(modelDir, 'manifest.json'), JSON.stringify({ model: 'U2NetP', modelSource, modelMD5, runtimeVersion: version, files }, null, 2) + '\n');
console.log(`Vendored local AI assets (${(files.reduce((total, file) => total + file.bytes, 0) / 1e6).toFixed(1)} MB).`);
