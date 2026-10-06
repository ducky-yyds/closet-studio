import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import { createFlatlayHandler, flatlayConfiguration, validateFlatlayInput } from '../server/flatlay-service.mjs';
import { createFlatlayServer } from '../server/flatlay-server.mjs';
import worker from '../worker/src/index.mjs';

const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const png = Buffer.from(pngBase64, 'base64');
const input = { image: `data:image/png;base64,${pngBase64}`, category: '上装', targetDescription: '照片中的蓝色衬衫' };
const privateKey = 'mock-private-provider-key';
const personalToken = 'mock-private-access-token';
const photoroomEnv = { FLATLAY_PROVIDER: 'photoroom', PHOTOROOM_API_KEY: privateKey };
const dashscopeEnv = { FLATLAY_PROVIDER: 'dashscope', DASHSCOPE_API_KEY: privateKey };
const resultUrl = 'https://dashscope-result-sz.oss-cn-shenzhen.aliyuncs.com/result.png?Expires=123&Signature=private-signed-download';

function request(body = input, options = {}) {
  return new Request('http://proxy.local/api/flatlay', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:4173', ...options.headers },
    body: typeof body === 'string' ? body : JSON.stringify(body), signal: options.signal
  });
}

const noNetwork = () => { throw new Error('An invalid request unexpectedly reached the network'); };

function dashscopeMock(url = resultUrl) {
  let calls = 0;
  return async (endpoint, options) => {
    calls++;
    if (calls === 1) return Response.json({ output: { choices: [{ message: { content: [{ image: url }] } }] } });
    assert.equal(endpoint, url);
    assert.equal(options.headers.Authorization, undefined);
    assert.equal(options.redirect, 'error');
    return new Response(png, { headers: { 'Content-Type': 'image/png' } });
  };
}

test('health is read-only and never exposes provider keys, tokens or configured endpoints', async () => {
  for (const env of [{}, photoroomEnv, dashscopeEnv, { ...photoroomEnv, FLATLAY_ACCESS_TOKEN: personalToken }]) {
    const handle = createFlatlayHandler(env, { fetchImpl: noNetwork });
    const response = await handle(new Request('http://proxy.local/api/health'));
    const content = await response.text();
    assert.deepEqual(JSON.parse(content), { enabled: Boolean(env.PHOTOROOM_API_KEY||env.DASHSCOPE_API_KEY), provider: env.FLATLAY_PROVIDER||'dashscope', model: env.FLATLAY_PROVIDER==='photoroom'?'flat-lay':'qwen-image-edit-plus' });
    assert.ok(!content.includes(privateKey) && !content.includes(personalToken) && !content.includes('image-api'));
    assert.equal((await handle(new Request('http://proxy.local/api/health', { method: 'POST' }))).status, 405);
  }
});

test('unconfigured, unsupported and invalid endpoint services reject before network access', async () => {
  for (const env of [{}, { FLATLAY_PROVIDER: 'openai', OPENAI_API_KEY: privateKey }, { ...photoroomEnv, FLATLAY_ENDPOINT: 'http://127.0.0.1:8765' }, { ...photoroomEnv, FLATLAY_ENDPOINT: 'https://attacker.example/v2/edit' }, { ...photoroomEnv, ALLOWED_ORIGINS: '*' }]) {
    const handle = createFlatlayHandler(env, { fetchImpl: noNetwork });
    assert.equal((await handle(request())).status, 503);
    assert.equal(flatlayConfiguration(env).enabled, false);
  }
});

test('Photoroom sends original image as multipart and requests real clothing flat lay, returning validated binary PNG', async () => {
  let calls = 0;
  const handle = createFlatlayHandler(photoroomEnv, { fetchImpl: async (endpoint, options) => {
    calls++;
    assert.equal(endpoint, 'https://image-api.photoroom.com/v2/edit');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers['x-api-key'], privateKey);
    assert.equal(options.headers['Content-Type'], undefined);
    assert.equal(options.redirect, 'error');
    const form = options.body;
    assert.ok(form instanceof FormData);
    assert.equal(form.get('flatLay.mode'), 'ai.auto');
    assert.equal(form.get('flatLay.size'), 'SQUARE_HD');
    assert.equal(form.get('removeBackground'), 'true');
    assert.equal(form.get('export.format'), 'png');
    assert.equal(form.get('imageFile').type, 'image/png');
    assert.deepEqual(Buffer.from(await form.get('imageFile').arrayBuffer()), png);
    const prompt = form.get('flatLay.prompt');
    assert.match(prompt, /上装/);
    assert.match(prompt, /蓝色衬衫/);
    assert.match(prompt, /彻底移除所有人物和人体/);
    assert.match(prompt, /俯视平铺正面/);
    assert.match(prompt, /合理补全/);
    assert.match(prompt, /背景透明/);
    return new Response(png, { headers: { 'Content-Type': 'image/png' } });
  } });
  const response = await handle(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { image: input.image, kind: 'flatlay', provider: 'photoroom', model: 'flat-lay' });
  assert.equal(calls, 1);
});

test('DashScope sends documented one-image edit protocol and downloads an allowed result without credentials', async () => {
  let calls = 0;
  const handle = createFlatlayHandler(dashscopeEnv, { fetchImpl: async (endpoint, options) => {
    calls++;
    if (calls === 1) {
      assert.equal(endpoint, 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation');
      assert.equal(options.headers.Authorization, `Bearer ${privateKey}`);
      assert.equal(options.redirect, 'error');
      const payload = JSON.parse(options.body);
      assert.equal(payload.model, 'qwen-image-edit-plus');
      assert.equal(payload.input.messages.length, 1);
      assert.equal(payload.input.messages[0].content.length, 2);
      assert.deepEqual(payload.input.messages[0].content[0], { image: input.image });
      assert.match(payload.input.messages[0].content[1].text, /纯白/);
      assert.equal(payload.parameters.n, 1);
      assert.equal(payload.parameters.prompt_extend, false);
      assert.equal(payload.parameters.watermark, false);
      assert.equal(payload.parameters.size, '1024*1024');
      return Response.json({ output: { choices: [{ message: { content: [{ image: resultUrl }] } }] } });
    }
    assert.equal(endpoint, resultUrl);
    assert.equal(options.headers.Authorization, undefined);
    return new Response(png);
  } });
  const response = await handle(request());
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.image, input.image);
  assert.equal(result.kind, 'flatlay');
  assert.equal(result.provider, 'dashscope');
  assert.equal(calls, 2);
  assert.ok(!JSON.stringify(result).includes('Signature'));
});

test('DashScope official workspace bases and legacy model options are accepted', () => {
  for (const endpoint of ['https://dashscope-intl.aliyuncs.com', 'https://workspace123.cn-beijing.maas.aliyuncs.com', 'https://workspace123.ap-southeast-1.maas.aliyuncs.com']) {
    const config = flatlayConfiguration({ ...dashscopeEnv, FLATLAY_ENDPOINT: endpoint });
    assert.equal(config.enabled, true);
    assert.match(config.endpoint, /\/api\/v1\/services\/aigc\/multimodal-generation\/generation$/);
  }
});

test('CORS accepts exact configured origins and rejects unknown, null and prefix-lookalike origins', async () => {
  const handle = createFlatlayHandler({ ...photoroomEnv, ALLOWED_ORIGINS: 'https://ducky-yyds.github.io' }, { fetchImpl: noNetwork });
  for (const origin of ['https://ducky-yyds.github.io.attacker.example', 'https://attacker.example', 'null', 'http://127.0.0.1:4173']) {
    const response = await handle(new Request('http://proxy.local/api/health', { headers: { Origin: origin } }));
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  }
  const response = await handle(new Request('http://proxy.local/api/health', { headers: { Origin: 'https://ducky-yyds.github.io' } }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://ducky-yyds.github.io');
  assert.equal(response.headers.get('Vary'), 'Origin');
});

test('preflight permits only POST JSON and closet token headers', async () => {
  const handle = createFlatlayHandler(photoroomEnv, { fetchImpl: noNetwork });
  const headers = { Origin: 'http://127.0.0.1:4173', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,x-closet-token' };
  const response = await handle(new Request('http://proxy.local/api/flatlay', { method: 'OPTIONS', headers }));
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('Access-Control-Allow-Methods'), 'POST');
  assert.equal((await handle(new Request('http://proxy.local/api/flatlay', { method: 'OPTIONS', headers: { ...headers, 'Access-Control-Request-Headers': 'authorization' } }))).status, 403);
});

test('configured access token is required before image processing; valid token reaches the adapter', async () => {
  const handle = createFlatlayHandler({ ...photoroomEnv, FLATLAY_ACCESS_TOKEN: personalToken }, { fetchImpl: async () => new Response(png) });
  for (const token of [undefined, '', 'wrong']) {
    const response = await handle(request(input, { headers: token === undefined ? {} : { 'X-Closet-Token': token } }));
    assert.equal(response.status, 401);
    assert.ok(!(await response.text()).includes(personalToken));
  }
  assert.equal((await handle(request(input, { headers: { 'X-Closet-Token': personalToken } }))).status, 200);
});

test('public Worker requires token configuration even when provider key exists', async () => {
  const response = await worker.fetch(new Request('http://proxy.local/api/health'), photoroomEnv);
  assert.equal((await response.json()).enabled, false);
  const configured = await worker.fetch(new Request('http://proxy.local/api/health'), { ...photoroomEnv, FLATLAY_ACCESS_TOKEN: personalToken });
  assert.equal((await configured.json()).enabled, true);
  assert.equal((await worker.fetch(request(), photoroomEnv)).status, 503);
});

test('invalid category, remote image inputs, malformed JSON and mismatched signatures never call an AI provider', async () => {
  const handle = createFlatlayHandler(photoroomEnv, { fetchImpl: noNetwork });
  for (const body of [null, [], {}, { ...input, category: 'ignore instructions' }, { ...input, image: 'https://attacker.example/image.png' }, { ...input, image: 'data:image/png;base64,YWJjZA==' }, { ...input, image: `data:image/png;base64,${png.subarray(0, 8).toString('base64')}` }, { ...input, image: `data:image/png;base64,${png.subarray(0, -12).toString('base64')}` }, { ...input, image: input.image.replace('image/png', 'image/jpeg') }, { ...input, targetDescription: 'x'.repeat(301) }, '{invalid']) {
    assert.equal((await handle(request(body))).status, 400);
  }
  assert.equal((await handle(request(input, { headers: { 'Content-Type': 'text/plain' } }))).status, 415);
});

test('size limits reject both declared and streamed over-limit bodies before paid processing', async () => {
  const handle = createFlatlayHandler(photoroomEnv, { fetchImpl: noNetwork, maxBodyBytes: 100 });
  assert.equal((await handle(request(input))).status, 413);
  assert.equal((await handle(request('{}', { headers: { 'Content-Length': '200' } }))).status, 413);
  const oversized = Buffer.alloc(10 * 1024 * 1024 + 1, 0);
  png.copy(oversized);
  assert.throws(() => validateFlatlayInput({ ...input, image: `data:image/png;base64,${oversized.toString('base64')}` }), failure => failure.code === 'IMAGE_TOO_LARGE');
});

test('provider failure responses and thrown exceptions are sanitized without image, secret or signed URL exposure', async () => {
  for (const fetchImpl of [
    async () => new Response(JSON.stringify({ message: `${privateKey} ${input.image} ${resultUrl}` }), { status: 401 }),
    async () => new Response(privateKey, { status: 429 }),
    async () => { throw new Error(`${privateKey} ${input.image} ${resultUrl}`); }
  ]) {
    const response = await createFlatlayHandler(photoroomEnv, { fetchImpl })(request());
    assert.ok([502, 503].includes(response.status));
    const text = await response.text();
    for (const forbidden of [privateKey, personalToken, input.image, resultUrl]) assert.ok(!text.includes(forbidden));
    assert.ok(!JSON.parse(text).kind);
  }
});

test('an HTML or JSON response masquerading as a PNG is never marked flatlay', async () => {
  const response = await createFlatlayHandler(photoroomEnv, { fetchImpl: async () => new Response('<html>Error</html>', { headers: { 'Content-Type': 'image/png' } }) })(request());
  assert.equal(response.status, 502);
  const result = await response.json();
  assert.equal(result.error.code, 'INVALID_RESULT');
  assert.equal(result.kind, undefined);
});

test('DashScope refuses private-address, credential, foreign and nonstandard-port result URLs before download', async () => {
  for (const url of [
    'https://127.0.0.1/image.png', 'https://169.254.169.254/latest/meta-data', 'https://attacker.example/image.png',
    'https://user:password@dashscope-result-sz.oss-cn-shenzhen.aliyuncs.com/image.png', 'https://dashscope-result-sz.oss-cn-shenzhen.aliyuncs.com:8443/image.png',
    'https://dashscope-a717.oss-cn-beijing.aliyuncs.com.evil.example/image.png', 'https://fake-dashscope-a717.oss-cn-beijing.aliyuncs.com/image.png',
    'https://dashscope-a71.oss-cn-beijing.aliyuncs.com/image.png', 'https://dashscope-a7170.oss-cn-beijing.aliyuncs.com/image.png',
    'https://dashscope-a71g.oss-cn-beijing.aliyuncs.com/image.png', 'https://dashscope-a717-suffix.oss-cn-beijing.aliyuncs.com/image.png',
    'https://dashscope-c72b.oss-cn-hangzhou.aliyuncs.com.evil.example/image.png', 'https://dashscope-c72b.oss-cn--shanghai.aliyuncs.com/image.png',
    'https://dashscope-66f3.oss-accelerate.aliyuncs.com.evil.example/image.png', 'https://dashscope-66f3.oss-accelerate-internal.aliyuncs.com/image.png',
    'https://dashscope-c72b.oss-cn-internal-beijing.aliyuncs.com/image.png', 'https://dashscope-result-bj.oss-cn-beijing-internal.aliyuncs.com/image.png',
    'https://dashscope-c72b.oss-cn-beijing-internal.aliyuncs.com/image.png', 'https://arbitrary-bucket.oss-cn-beijing.aliyuncs.com/image.png',
    'https://user:password@dashscope-a717.oss-cn-beijing.aliyuncs.com/image.png', 'https://dashscope-a717.oss-cn-beijing.aliyuncs.com:8443/image.png',
    'http://dashscope-a717.oss-cn-beijing.aliyuncs.com:443/image.png', 'ftp://dashscope-a717.oss-cn-beijing.aliyuncs.com/image.png'
  ]) {
    let calls = 0;
    const response = await createFlatlayHandler(dashscopeEnv, { fetchImpl: async () => { calls++; return Response.json({ output: { choices: [{ message: { content: [{ image: url }] } }] } }); } })(request());
    assert.equal(response.status, 502, url);
    assert.equal(calls, 1, url);
  }
});

test('DashScope accepts documented rotating four-hex regional and accelerate OSS buckets and upgrades only approved HTTP results to HTTPS without credentials', async () => {
  for (const host of [
    'dashscope-a717.oss-cn-beijing.aliyuncs.com', 'dashscope-c72b.oss-cn-hangzhou.aliyuncs.com',
    'dashscope-a718.oss-cn-beijing.aliyuncs.com', 'dashscope-0000.oss-cn-hangzhou.aliyuncs.com',
    'dashscope-66f3.oss-accelerate.aliyuncs.com', 'dashscope-7c2c.oss-cn-shenzhen.aliyuncs.com',
    'dashscope-2522.oss-cn-shanghai.aliyuncs.com', 'dashscope-0484.oss-cn-zhangjiakou.aliyuncs.com',
    'dashscope-result-sz.oss-cn-shenzhen.aliyuncs.com'
  ]) {
    for (const protocol of ['http:', 'https:']) {
      const returnedUrl = `${protocol}//${host}/generated.png?Expires=123&Signature=mock-signed-image`;
      const expectedDownload = returnedUrl.replace(/^http:/, 'https:');
      let calls = 0;
      const response = await createFlatlayHandler(dashscopeEnv, { fetchImpl: async (url, options) => {
        calls++;
        if (calls === 1) return Response.json({ output: { choices: [{ message: { content: [{ image: returnedUrl }] } }] } });
        assert.equal(url, expectedDownload);
        assert.equal(options.method, 'GET');
        assert.equal(options.redirect, 'error');
        const headers = new Headers(options.headers);
        assert.equal(headers.has('Authorization'), false);
        assert.equal(headers.has('x-api-key'), false);
        assert.equal(headers.has('X-Closet-Token'), false);
        return new Response(png);
      } })(request());
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.kind, 'flatlay');
      assert.equal(result.image, input.image);
      assert.equal(calls, 2);
      assert.equal(JSON.stringify(result).includes('Signature'), false);
    }
  }
});

test('DashScope rejects result download redirects instead of following a target URL', async () => {
  let calls = 0;
  const response = await createFlatlayHandler(dashscopeEnv, { fetchImpl: async (_url, options) => {
    calls++;
    if (calls === 1) return Response.json({ output: { choices: [{ message: { content: [{ image: 'https://dashscope-a717.oss-cn-beijing.aliyuncs.com/result.png' }] } }] } });
    assert.equal(options.redirect, 'error');
    assert.equal(new Headers(options.headers).has('Authorization'), false);
    return new Response(null, { status: 302, headers: { Location: 'https://169.254.169.254/latest/meta-data' } });
  } })(request());
  assert.equal(response.status, 502);
  const result = await response.json();
  assert.equal(result.error.code, 'RESULT_DOWNLOAD_FAILED');
  assert.equal(result.kind, undefined);
  assert.equal(calls, 2);
});

test('DashScope downloads approved exact additional OSS bucket only, with redirect rejection', async () => {
  const extra = 'https://approved-result.oss-cn-beijing.aliyuncs.com/image.png';
  const response = await createFlatlayHandler({ ...dashscopeEnv, FLATLAY_RESULT_HOSTS: 'approved-result.oss-cn-beijing.aliyuncs.com' }, { fetchImpl: dashscopeMock(extra) })(request());
  assert.equal(response.status, 200);
});

test('upstream timeout aborts the provider request and returns a bounded error', async () => {
  let aborted = false;
  const response = await createFlatlayHandler(photoroomEnv, { timeoutMs: 15, fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => { aborted = true; reject(new DOMException('Aborted', 'AbortError')); });
  }) })(request());
  assert.equal(response.status, 504);
  assert.equal((await response.json()).error.code, 'UPSTREAM_TIMEOUT');
  assert.equal(aborted, true);
});

test('browser cancellation propagates to the provider fetch', async () => {
  const controller = new AbortController();
  let started;
  const hasStarted = new Promise(resolve => { started = resolve; });
  let aborted = false;
  const result = createFlatlayHandler(photoroomEnv, { fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
    started();
    signal.addEventListener('abort', () => { aborted = true; reject(new DOMException('Aborted', 'AbortError')); });
  }) })(request(input, { signal: controller.signal }));
  await hasStarted;
  controller.abort();
  assert.equal((await result).status, 499);
  assert.equal(aborted, true);
});

test('Node HTTP adapter serves health, proxies JSON, and enforces the body cap', async t => {
  const server = createFlatlayServer(photoroomEnv, { fetchImpl: async () => new Response(png), maxBodyBytes: 1024 });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const health = await fetch(`${base}/api/health`);
  assert.equal((await health.json()).enabled, true);
  const processed = await fetch(`${base}/api/flatlay`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  assert.equal(processed.status, 200);
  assert.equal((await processed.json()).kind, 'flatlay');
  const oversized = await fetch(`${base}/api/flatlay`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:4173' }, body: 'x'.repeat(2048) });
  assert.equal(oversized.status, 413);
  assert.equal(oversized.headers.get('Access-Control-Allow-Origin'), 'http://127.0.0.1:4173');
});

test('Node client disconnection aborts an in-flight upstream call', async t => {
  let resolveAborted;
  const aborted = new Promise(resolve => { resolveAborted = resolve; });
  let resolveStarted;
  const started = new Promise(resolve => { resolveStarted = resolve; });
  const server = createFlatlayServer(photoroomEnv, { fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
    resolveStarted();
    signal.addEventListener('abort', () => { resolveAborted(); reject(new DOMException('Aborted', 'AbortError')); });
  }) });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const call = http.request({ host: '127.0.0.1', port: server.address().port, path: '/api/flatlay', method: 'POST', headers: { 'Content-Type': 'application/json' } });
  call.on('error', () => {});
  call.end(JSON.stringify(input));
  await started;
  call.destroy();
  await aborted;
});

test('Node public listen configuration requires an access token', async t => {
  const server = createFlatlayServer({ ...photoroomEnv, FLATLAY_HOST: '0.0.0.0' }, { fetchImpl: noNetwork });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/health`);
  assert.equal((await response.json()).enabled, false);
});
