import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { createFlatlayHandler, flatlayConfiguration, MAX_BODY_BYTES } from './flatlay-service.mjs';

export function createFlatlayServer(env = {}, options = {}) {
  const loopback = !env.FLATLAY_HOST || ['127.0.0.1', 'localhost', '::1'].includes(env.FLATLAY_HOST);
  const serviceOptions = { requireAccessToken: !loopback, ...options };
  const handler = createFlatlayHandler(env, serviceOptions);
  const config = flatlayConfiguration(env, serviceOptions);
  return http.createServer(async (incoming, outgoing) => {
    const controller = new AbortController();
    incoming.on('aborted', () => controller.abort());
    outgoing.on('close', () => { if (!outgoing.writableEnded) controller.abort(); });
    try {
      const headers = new Headers();
      for (const [key, value] of Object.entries(incoming.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
      let body;
      if (!['GET', 'HEAD'].includes(incoming.method)) {
        body = await new Promise((resolve, reject) => {
          const chunks = [];
          let count = 0;
          const maximum = options.maxBodyBytes ?? MAX_BODY_BYTES;
          const tooLarge = () => { chunks.length = 0; reject(Object.assign(new Error('Request too large'), { code: 'BODY_TOO_LARGE' })); };
          if (Number(incoming.headers['content-length']) > maximum) { tooLarge(); incoming.resume(); return; }
          incoming.on('data', chunk => {
            count += chunk.length;
            if (count > maximum) { tooLarge(); return; }
            chunks.push(chunk);
          });
          incoming.once('end', () => resolve(Buffer.concat(chunks)));
          incoming.once('aborted', () => reject(new Error('Request aborted')));
          incoming.once('error', reject);
        });
      }
      const url = `http://127.0.0.1${incoming.url || '/'}`;
      const request = new Request(url, { method: incoming.method, headers, ...(body ? { body } : {}), signal: controller.signal });
      const result = await handler(request);
      if (controller.signal.aborted || outgoing.destroyed) return;
      outgoing.writeHead(result.status, Object.fromEntries(result.headers));
      outgoing.end(Buffer.from(await result.arrayBuffer()));
    } catch (failure) {
      if (controller.signal.aborted || outgoing.destroyed) return;
      const oversized = failure.code === 'BODY_TOO_LARGE';
      const origin = incoming.headers.origin;
      const cors = origin && config.origins.has(origin) ? { 'Access-Control-Allow-Origin': origin } : {};
      outgoing.writeHead(oversized ? 413 : 400, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Origin', ...cors });
      outgoing.end(JSON.stringify({ error: { code: oversized ? 'REQUEST_TOO_LARGE' : 'INVALID_REQUEST', message: oversized ? '图片或请求超过大小限制，请压缩照片后重试。' : '请求格式有误。' } }));
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.FLATLAY_PORT || 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('FLATLAY_PORT 必须是有效端口。');
  const server = createFlatlayServer(process.env);
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  server.listen(port, process.env.FLATLAY_HOST || '127.0.0.1', () => {
    console.log(`衣物平铺代理 http://127.0.0.1:${port} （密钥仅保留在服务端）`);
  });
}
