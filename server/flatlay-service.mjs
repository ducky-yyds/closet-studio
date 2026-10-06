import { FLATLAY_CATEGORIES, flatlayPrompt, FLATLAY_NEGATIVE_PROMPT } from './flatlay-prompt.mjs';

export const MAX_BODY_BYTES = 12 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_UPSTREAM_JSON_BYTES = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 120_000;
const GENERATION_PATH = '/api/v1/services/aigc/multimodal-generation/generation';
const DEFAULT_ORIGINS = ['localhost', '127.0.0.1'].flatMap(host => [4173, 4174, 4175].map(port => `http://${host}:${port}`));
// Official FAQ documents rotating dashscope-{identifier} public OSS buckets:
// https://help.aliyun.com/zh/model-studio/qwen-image-edit-api
// Support the documented accelerate / cn-region forms while retaining the
// observed four-hex identifier constraint, rather than any OSS bucket wildcard.
const DYNAMIC_RESULT_HOST = /^dashscope-[a-f0-9]{4}\.oss-(?:accelerate|cn-[a-z0-9]+(?:-[a-z0-9]+)*)\.aliyuncs\.com$/;

export class FlatlayError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

function error(status, code, message) { throw new FlatlayError(status, code, message); }

function officialEndpoint(value, provider) {
  const photoroom = provider === 'photoroom';
  const expectedPath = photoroom ? '/v2/edit' : GENERATION_PATH;
  const url = new URL(value || (photoroom ? 'https://image-api.photoroom.com/v2/edit' : `https://dashscope.aliyuncs.com${GENERATION_PATH}`));
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) throw new Error('Invalid endpoint');
  const officialHost = photoroom ? url.hostname === 'image-api.photoroom.com' : (
    ['dashscope.aliyuncs.com', 'dashscope-intl.aliyuncs.com'].includes(url.hostname)
    || /^[a-z0-9-]+\.(?:cn-beijing|ap-southeast-1)\.maas\.aliyuncs\.com$/.test(url.hostname));
  if (!officialHost) throw new Error('Invalid endpoint host');
  if (['', '/'].includes(url.pathname)) url.pathname = expectedPath;
  if (url.pathname !== expectedPath) throw new Error('Invalid endpoint path');
  return url.href;
}

function configuredOrigins(value) {
  if (!value?.trim()) return new Set(DEFAULT_ORIGINS);
  const origins = value.split(',').map(part => part.trim()).filter(Boolean);
  return new Set(origins.map(value => {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash || url.origin === 'null') throw new Error('Invalid origin');
    return url.origin;
  }));
}

// Configuration belongs on the server. This function never exposes a credential.
export function flatlayConfiguration(env = {}, { requireAccessToken = false } = {}) {
  const provider = String(env.FLATLAY_PROVIDER || 'dashscope').toLowerCase();
  const model = provider === 'photoroom' ? 'flat-lay' : String(env.FLATLAY_MODEL || 'qwen-image-edit-plus');
  const apiKey = String((provider === 'photoroom' ? env.PHOTOROOM_API_KEY : env.DASHSCOPE_API_KEY) || '');
  const accessToken = String(env.FLATLAY_ACCESS_TOKEN || '');
  let endpoint, origins, resultHosts;
  let valid = ['photoroom', 'dashscope'].includes(provider) && /^[a-zA-Z0-9._-]{1,100}$/.test(model) && apiKey.length < 4096 && !/[\r\n]/.test(apiKey) && accessToken.length < 4096 && !/[\r\n]/.test(accessToken) && (!requireAccessToken || Boolean(accessToken.trim()));
  try {
    endpoint = officialEndpoint(env.FLATLAY_ENDPOINT, provider);
    origins = configuredOrigins(env.ALLOWED_ORIGINS);
    resultHosts = new Set(String(env.FLATLAY_RESULT_HOSTS || '').split(',').map(host => host.trim().toLowerCase()).filter(Boolean));
    for (const host of resultHosts) if (!/^[a-z0-9-]+\.oss(?:-[a-z0-9-]+)?\.aliyuncs\.com$/.test(host)) throw new Error('Invalid result host');
  } catch { valid = false; }
  return { provider, model, apiKey, accessToken, endpoint, origins: origins || new Set(DEFAULT_ORIGINS), resultHosts: resultHosts || new Set(), enabled: valid && Boolean(apiKey.trim()) };
}

function safePublicMetadata(config) {
  return { enabled: config.enabled, provider: ['photoroom', 'dashscope', 'openai'].includes(config.provider) ? config.provider : 'unsupported', model: /^[a-zA-Z0-9._-]{1,100}$/.test(config.model) ? config.model : 'invalid' };
}

function jsonResponse(body, status, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers } });
}

function tokenMatches(actual, expected) {
  if (typeof actual !== 'string' || actual.length > 4096) return false;
  let difference = actual.length ^ expected.length;
  for (let index = 0; index < Math.max(actual.length, expected.length); index++) difference |= (actual.charCodeAt(index) || 0) ^ (expected.charCodeAt(index) || 0);
  return difference === 0;
}

async function readBytes(message, maximum, tooLargeCode = 'REQUEST_TOO_LARGE') {
  const length = Number(message.headers.get('content-length'));
  if (Number.isFinite(length) && length > maximum) error(413, tooLargeCode, '图片或请求超过大小限制，请压缩照片后重试。');
  if (!message.body) return new Uint8Array();
  const reader = message.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximum) {
        await reader.cancel().catch(() => {});
        error(413, tooLargeCode, '图片或请求超过大小限制，请压缩照片后重试。');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

function imageMime(bytes) {
  if (bytes.length >= 45 && [137,80,78,71,13,10,26,10].every((value, index) => bytes[index] === value)) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 8, hasHeader = false, hasPixels = false;
    while (offset + 12 <= bytes.length) {
      const length = view.getUint32(offset);
      if (offset + length + 12 > bytes.length) return null;
      const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
      if (!hasHeader) {
        if (type !== 'IHDR' || length !== 13) return null;
        const width = view.getUint32(offset + 8), height = view.getUint32(offset + 12);
        if (!width || !height || width > 32768 || height > 32768 || width * height > 100_000_000) return null;
        hasHeader = true;
      }
      if (type === 'IDAT') hasPixels = true;
      if (type === 'IEND') return hasHeader && hasPixels && length === 0 && offset + 12 === bytes.length ? 'image/png' : null;
      offset += length + 12;
    }
    return null;
  }
  if (bytes.length >= 6 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 && bytes.at(-2) === 255 && bytes.at(-1) === 217) return 'image/jpeg';
  if (bytes.length >= 20 && bytes[0] === 82 && bytes[1] === 73 && bytes[2] === 70 && bytes[3] === 70 && bytes[8] === 87 && bytes[9] === 69 && bytes[10] === 66 && bytes[11] === 80) {
    if (new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true) + 8 === bytes.length) return 'image/webp';
  }
  return null;
}

function bytesToBase64(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32_768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  return btoa(binary);
}

export function validateFlatlayInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) error(400, 'INVALID_REQUEST', '请提交衣物图片和类别。');
  if (!FLATLAY_CATEGORIES.includes(input.category)) error(400, 'CATEGORY_REQUIRED', '请先选择目标衣物类别。');
  if (input.targetDescription !== undefined && (typeof input.targetDescription !== 'string' || input.targetDescription.length > 300)) error(400, 'INVALID_DESCRIPTION', '目标衣物说明最多 300 字。');
  if (typeof input.image !== 'string') error(400, 'INVALID_IMAGE', '请上传 PNG、JPEG 或 WebP 图片。');
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(input.image);
  if (!match || match[2].length % 4 !== 0) error(400, 'INVALID_IMAGE', '请上传 PNG、JPEG 或 WebP 图片。');
  if (match[2].length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) error(413, 'IMAGE_TOO_LARGE', '单张照片不能超过 10 MB。');
  let binary;
  try { binary = atob(match[2]); } catch { error(400, 'INVALID_IMAGE', '图片数据不完整，请重新上传。'); }
  if (binary.length > MAX_IMAGE_BYTES) error(413, 'IMAGE_TOO_LARGE', '单张照片不能超过 10 MB。');
  if (btoa(binary) !== match[2]) error(400, 'INVALID_IMAGE', '图片数据不完整，请重新上传。');
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  if (imageMime(bytes) !== match[1]) error(400, 'INVALID_IMAGE', '图片内容与文件类型不符，请重新上传。');
  return { image: input.image, bytes, mime: match[1], category: input.category, targetDescription: input.targetDescription?.trim() || '' };
}

export function photoroomRequest(input) {
  const form = new FormData();
  const suffix = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[input.mime];
  form.set('imageFile', new Blob([input.bytes], { type: input.mime }), `garment.${suffix}`);
  form.set('flatLay.mode', 'ai.auto');
  form.set('flatLay.size', 'SQUARE_HD');
  form.set('flatLay.prompt', flatlayPrompt(input.category, input.targetDescription, true));
  form.set('removeBackground', 'true');
  form.set('export.format', 'png');
  return form;
}

export function dashscopeRequest(input, config) {
  const parameters = { n: 1, negative_prompt: FLATLAY_NEGATIVE_PROMPT, watermark: false };
  if (config.model !== 'qwen-image-edit') { parameters.prompt_extend = false; parameters.size = '1024*1024'; }
  return { model: config.model, input: { messages: [{ role: 'user', content: [{ image: input.image }, { text: flatlayPrompt(input.category, input.targetDescription) }] }] }, parameters };
}

function resultUrl(value, config) {
  let url;
  try { url = new URL(value); } catch { error(502, 'INVALID_RESULT', 'AI 服务没有返回可用的衣物图片。'); }
  const hostAllowed = DYNAMIC_RESULT_HOST.test(url.hostname)
    || /^dashscope-result(?:-[a-z0-9-]+)?\.oss(?:-[a-z0-9-]+)?\.aliyuncs\.com$/.test(url.hostname)
    || config.resultHosts.has(url.hostname);
  const internalStorage = (url.hostname.split('.')[1] || '').split('-').includes('internal');
  // Validate before changing protocol: changing http:443 to https: would hide
  // the originally nonstandard HTTP port in URL.port.
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port || !hostAllowed || internalStorage) error(502, 'INVALID_RESULT', 'AI 服务返回的图片地址不受信任。');
  // Some official OSS results use an HTTP signed URL. Fetch those bytes only
  // over HTTPS after the exact official storage host has already been checked.
  if(hostAllowed && url.protocol==='http:')url.protocol='https:';
  if (url.protocol !== 'https:') error(502, 'INVALID_RESULT', 'AI 服务返回的图片地址不受信任。');
  return url.href;
}

function upstreamStatus(status) {
  if ([401, 403].includes(status)) error(502, 'UPSTREAM_AUTH', 'AI 服务鉴权失败，请联系管理员检查服务端密钥。');
  if (status === 429) error(503, 'UPSTREAM_LIMIT', 'AI 服务暂时繁忙或额度不足，请稍后重试。');
  error(502, 'UPSTREAM_FAILED', 'AI 图像处理失败，请稍后重试。');
}

async function generateFlatlay(input, config, fetchImpl, signal, onDiagnostic) {
  signal.throwIfAborted();
  if (config.provider === 'photoroom') {
    const result = await fetchImpl(config.endpoint, { method: 'POST', headers: { 'x-api-key': config.apiKey, Accept: 'image/png' }, body: photoroomRequest(input), signal, redirect: 'error' });
    if (!result.ok) { await result.body?.cancel().catch(() => {}); upstreamStatus(result.status); }
    const bytes = await readBytes(result, MAX_IMAGE_BYTES, 'RESULT_TOO_LARGE');
    if (imageMime(bytes) !== 'image/png') error(502, 'INVALID_RESULT', 'AI 服务没有返回可用的 PNG 衣物图片。');
    return { image: `data:image/png;base64,${bytesToBase64(bytes)}`, kind: 'flatlay', provider: config.provider, model: config.model };
  }
  const upstream = await fetchImpl(config.endpoint, { method: 'POST', headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(dashscopeRequest(input, config)), signal, redirect: 'error' });
  if (!upstream.ok) { await upstream.body?.cancel().catch(() => {}); upstreamStatus(upstream.status); }
  let result;
  try { result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBytes(upstream, MAX_UPSTREAM_JSON_BYTES, 'UPSTREAM_TOO_LARGE'))); }
  catch (failure) { if (failure instanceof FlatlayError) throw failure; error(502, 'INVALID_RESULT', 'AI 服务没有返回可用的衣物图片。'); }
  if (result.code) {
    if (['InvalidApiKey', 'InvalidAccessKeyId', 'AccessDenied'].includes(result.code)) upstreamStatus(401);
    if (String(result.code).toLowerCase().includes('throttl')) upstreamStatus(429);
    upstreamStatus(502);
  }
  const image = result.output?.choices?.[0]?.message?.content?.find(part => typeof part.image === 'string')?.image;
  if (!image) error(502, 'INVALID_RESULT', 'AI 服务没有返回可用的衣物图片。');
  if(onDiagnostic){try{const url=new URL(image);onDiagnostic({protocol:url.protocol,hostname:url.hostname.endsWith('.aliyuncs.com')?url.hostname:'unrecognized-result-host'});}catch{onDiagnostic({protocol:'invalid',hostname:'invalid'});}}
  signal.throwIfAborted();
  const downloaded = await fetchImpl(resultUrl(image, config), { method: 'GET', signal, redirect: 'error', headers: { Accept: 'image/png,image/jpeg,image/webp' } });
  if (!downloaded.ok) { await downloaded.body?.cancel().catch(() => {}); error(502, 'RESULT_DOWNLOAD_FAILED', '生成的衣物图片下载失败，请重试。'); }
  const bytes = await readBytes(downloaded, MAX_IMAGE_BYTES, 'RESULT_TOO_LARGE');
  const mime = imageMime(bytes);
  if (!mime) error(502, 'INVALID_RESULT', 'AI 服务返回的图片格式不受支持。');
  return { image: `data:${mime};base64,${bytesToBase64(bytes)}`, kind: 'flatlay', provider: config.provider, model: config.model };
}

// Uses only Web APIs so both the Node server and Cloudflare Worker share the same checks.
export function createFlatlayHandler(env = {}, { fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS, maxBodyBytes = MAX_BODY_BYTES, requireAccessToken = false, onDiagnostic } = {}) {
  const config = flatlayConfiguration(env, { requireAccessToken });
  return async function handleFlatlay(request) {
    const headers = { Vary: 'Origin' };
    const origin = request.headers.get('Origin');
    if (origin && !config.origins.has(origin)) return jsonResponse({ error: { code: 'ORIGIN_DENIED', message: '此网页尚未获准访问图像处理服务。' } }, 403, headers);
    if (origin) headers['Access-Control-Allow-Origin'] = origin;
    const pathname = new URL(request.url).pathname;
    if (!['/api/flatlay', '/api/health'].includes(pathname)) return jsonResponse({ error: { code: 'NOT_FOUND', message: '接口不存在。' } }, 404, headers);
    if (request.method === 'OPTIONS') {
      const method = request.headers.get('Access-Control-Request-Method');
      const requestedHeaders = request.headers.get('Access-Control-Request-Headers')?.split(',').map(value => value.trim().toLowerCase()).filter(Boolean) || [];
      const allowedMethod = pathname === '/api/health' ? 'GET' : 'POST';
      if (!origin || method !== allowedMethod || requestedHeaders.some(header => !['content-type', 'x-closet-token'].includes(header))) return jsonResponse({ error: { code: 'PREFLIGHT_DENIED', message: '不支持此跨域请求。' } }, 403, headers);
      return new Response(null, { status: 204, headers: { ...headers, 'Access-Control-Allow-Methods': allowedMethod, 'Access-Control-Allow-Headers': 'Content-Type, X-Closet-Token', 'Access-Control-Max-Age': '600' } });
    }
    if (pathname === '/api/health' && request.method === 'GET') return jsonResponse(safePublicMetadata(config), 200, headers);
    if (request.method !== (pathname === '/api/health' ? 'GET' : 'POST')) return jsonResponse({ error: { code: 'METHOD_NOT_ALLOWED', message: '不支持此请求方法。' } }, 405, { ...headers, Allow: pathname === '/api/health' ? 'GET, OPTIONS' : 'POST, OPTIONS' });
    let timer;
    let abortListener;
    let timedOut = false;
    try {
      if (!['photoroom', 'dashscope'].includes(config.provider)) error(503, 'PROVIDER_UNSUPPORTED', '此图像服务提供方尚未接入。');
      if (!config.enabled) error(503, 'CONFIG_MISSING', 'AI 平铺服务尚未配置，请联系管理员接入图像编辑服务。');
      if (config.accessToken && !tokenMatches(request.headers.get('X-Closet-Token'), config.accessToken)) error(401, 'AUTH_REQUIRED', '请填写图像处理服务访问口令。');
      if (!/^application\/json(?:\s*;|\s*$)/i.test(request.headers.get('Content-Type') || '')) error(415, 'UNSUPPORTED_CONTENT_TYPE', '请使用 JSON 格式提交图片。');
      let input;
      try { input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBytes(request, maxBodyBytes))); }
      catch (failure) { if (failure instanceof FlatlayError) throw failure; error(400, 'INVALID_JSON', '请求数据格式有误，请重新上传。'); }
      input = validateFlatlayInput(input);
      const controller = new AbortController();
      abortListener = () => controller.abort();
      if (request.signal.aborted) controller.abort();
      else request.signal.addEventListener('abort', abortListener, { once: true });
      timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
      const result = await generateFlatlay(input, config, fetchImpl, controller.signal, onDiagnostic);
      return jsonResponse(result, 200, headers);
    } catch (failure) {
      if (timedOut) return jsonResponse({ error: { code: 'UPSTREAM_TIMEOUT', message: 'AI 处理超过两分钟，请稍后重试。' } }, 504, headers);
      if (request.signal.aborted) return jsonResponse({ error: { code: 'CLIENT_ABORTED', message: '图像处理已取消。' } }, 499, headers);
      if (failure instanceof FlatlayError) return jsonResponse({ error: { code: failure.code, message: failure.message } }, failure.status, headers);
      // Never return an upstream exception/message: it may contain credentials or signed URLs.
      return jsonResponse({ error: { code: 'UPSTREAM_FAILED', message: 'AI 图像处理服务连接失败，请稍后重试。' } }, 502, headers);
    } finally {
      clearTimeout(timer);
      if (abortListener) request.signal.removeEventListener('abort', abortListener);
    }
  };
}
