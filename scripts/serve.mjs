import http from 'node:http';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
function option(name, fallback) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith('--')) {
    throw new Error(`${name} 需要一个值。`);
  }
  return args[index + 1];
}

const root = await realpath(path.resolve(projectRoot, option('--dir', '.')));
const port = Number(option('--port', process.env.PORT ?? '4173'));
const host = option('--host', process.env.HOST ?? '127.0.0.1');
const prefix = option('--base-path', process.env.BASE_PATH ?? 'wardrobe').replace(/^\/+|\/+$/g, '');
if (prefix.split('/').some(segment => segment.startsWith('.') || segment.includes('\\') || segment.includes('?') || segment.includes('#'))) {
  throw new Error('预览子目录需要是普通 URL 路径。');
}
const basePath = prefix ? `/${prefix}/` : '/';
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('端口需要是 0 到 65535 的整数。');

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.wasm': 'application/wasm',
  '.onnx': 'application/octet-stream',
  '.txt': 'text/plain; charset=utf-8'
};

function insideRoot(filename) {
  const relative = path.relative(root, filename);
  return !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

function applicationPath(url) {
  let pathname;
  try {
    // Decode before resolving, so encoded traversal and separators are checked too.
    pathname = decodeURIComponent((url ?? '/').split('?')[0]);
  } catch {
    return null;
  }
  if (pathname.includes('\0') || pathname.includes('\\')) return null;
  if (pathname.split('/').some(segment => segment === '..' || segment.startsWith('.'))) return null;
  if (basePath !== '/' && pathname === basePath.slice(0, -1)) return { redirect: basePath };
  if (basePath !== '/' && pathname.startsWith(basePath)) pathname = `/${pathname.slice(basePath.length)}`;
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const allowed = relative === 'index.html' || relative === 'styles.css'
    || /^src\/.+\.(?:js|mjs|css|json)$/.test(relative)
    || (relative.startsWith('assets/') && Object.hasOwn(mime, path.extname(relative).toLowerCase()));
  return allowed ? { relative } : null;
}

const server = http.createServer(async (request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405, { Allow: 'GET, HEAD' });
    response.end('Method not allowed');
    return;
  }
  const route = applicationPath(request.url);
  if (route?.redirect) {
    response.writeHead(308, { Location: route.redirect });
    response.end();
    return;
  }
  if (!route) {
    response.writeHead(404);
    response.end('Not found');
    return;
  }
  try {
    const requested = path.resolve(root, route.relative);
    if (!insideRoot(requested)) throw new Error('Outside document root');
    const filename = await realpath(requested);
    if (!insideRoot(filename)) throw new Error('Outside document root');
    const resolvedRoute = applicationPath(`/${path.relative(root, filename).split(path.sep).join('/')}`);
    if (!resolvedRoute?.relative) throw new Error('Not an application file');
    const info = await stat(filename);
    if (!info.isFile()) throw new Error('Not a file');
    response.writeHead(200, {
      'Content-Type': mime[path.extname(filename).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': info.size
    });
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    await pipeline(createReadStream(filename), response);
  } catch {
    if (!response.headersSent) {
      response.writeHead(404);
      response.end('Not found');
    } else {
      response.destroy();
    }
  }
});

server.on('error', error => {
  console.error(`预览服务启动失败：${error.message}`);
  process.exitCode = 1;
});
server.listen(port, host, () => {
  const address = server.address();
  console.log(`电子衣柜：http://${host}:${address.port}/`);
  console.log(`GitHub Pages 子目录预览：http://${host}:${address.port}${basePath}`);
});
