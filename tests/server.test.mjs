import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, readFile, readdir, copyFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
let fixture, server, port;

function request(url, method = 'GET') {
  return new Promise((resolve, reject) => {
    const call = http.request({ host: '127.0.0.1', port, path: url, method }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString() }));
    });
    call.on('error', reject);
    call.setTimeout(4000, () => call.destroy(new Error('Preview request timed out')));
    call.end();
  });
}

before(async () => {
  fixture = await mkdtemp(path.join(os.tmpdir(), 'wardrobe-tools-'));
  await Promise.all(['src', 'assets/garments', 'assets/ai', 'assets/vendor', 'scripts', 'tests', '.reference', 'node_modules'].map(directory => mkdir(path.join(fixture, directory), { recursive: true })));
  await Promise.all([
    writeFile(path.join(fixture, 'index.html'), '<!doctype html><link rel="stylesheet" href="./styles.css"><script type="module" src="./src/app.js"></script>'),
    writeFile(path.join(fixture, 'styles.css'), 'body { color: black; }'),
    writeFile(path.join(fixture, 'src/app.js'), 'export const ready = true;'),
    writeFile(path.join(fixture, 'assets/garments/test.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>'),
    writeFile(path.join(fixture, 'assets/ai/test.onnx'), 'test model bytes'),
    writeFile(path.join(fixture, 'assets/ai/worker.js'), 'export const model = true;'),
    writeFile(path.join(fixture, 'assets/vendor/runtime.wasm'), Buffer.from([0,97,115,109,1,0,0,0])),
    writeFile(path.join(fixture, 'assets/vendor/runtime.mjs'), 'export const runtime = true;'),
    writeFile(path.join(fixture, 'assets/vendor/LICENSE.txt'), 'test license'),
    writeFile(path.join(fixture, 'assets/private.apk.1'), 'APK reference'),
    writeFile(path.join(fixture, 'assets/.private.json'), '{}'),
    writeFile(path.join(fixture, 'Lookie_Android_reference.apk.1'), 'APK reference'),
    writeFile(path.join(fixture, '.reference/private.json'), '{}'),
    writeFile(path.join(fixture, 'tests/private.test.mjs'), 'private test'),
    writeFile(path.join(fixture, 'node_modules/private.js'), 'private dependency'),
    writeFile(path.join(fixture, 'package.json'), '{}'),
    copyFile(path.join(projectRoot, 'scripts/serve.mjs'), path.join(fixture, 'scripts/serve.mjs')),
    copyFile(path.join(projectRoot, 'scripts/package.mjs'), path.join(fixture, 'scripts/package.mjs'))
  ]);
  server = spawn(process.execPath, [path.join(fixture, 'scripts/serve.mjs'), '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
  port = await new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error(`Preview did not start: ${output}`)), 8000);
    server.once('error', error => { clearTimeout(timeout); reject(error); });
    server.once('exit', code => { clearTimeout(timeout); reject(new Error(`Preview exited early (${code}): ${output}`)); });
    server.stderr.on('data', chunk => { output += chunk; });
    server.stdout.on('data', chunk => {
      output += chunk;
      const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)\//);
      if (match) { clearTimeout(timeout); resolve(Number(match[1])); }
    });
  });
});

after(async () => {
  if (server && server.exitCode === null) {
    const exited = once(server, 'exit');
    server.kill();
    await exited;
  }
  if (fixture) {
    const resolved = path.resolve(fixture);
    const tempRoot = path.resolve(os.tmpdir());
    assert.ok(resolved.startsWith(`${tempRoot}${path.sep}`) && path.basename(resolved).startsWith('wardrobe-tools-'));
    await rm(resolved, { recursive: true, force: true });
  }
});

test('root and GitHub Pages subdirectory serve identical relative application resources', async () => {
  const root = await request('/');
  const subdirectory = await request('/wardrobe/');
  assert.equal(root.status, 200);
  assert.equal(subdirectory.status, 200);
  assert.equal(subdirectory.body, root.body);
  assert.match(root.headers['content-type'], /^text\/html/);
  const redirect = await request('/wardrobe');
  assert.equal(redirect.status, 308);
  assert.equal(redirect.headers.location, '/wardrobe/');
  for (const [resource, type] of [['styles.css', 'text/css'], ['src/app.js', 'text/javascript'], ['assets/garments/test.svg', 'image/svg+xml']]) {
    const response = await request(`/wardrobe/${resource}`);
    assert.equal(response.status, 200, resource);
    assert.ok(response.headers['content-type'].startsWith(type), resource);
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
  }
});

test('reference packages, development files and encoded traversal cannot be served', async () => {
  for (const url of [
    '/Lookie_Android_reference.apk.1', '/assets/private.apk.1', '/assets/.private.json',
    '/.reference/private.json', '/scripts/serve.mjs', '/tests/private.test.mjs',
    '/node_modules/private.js', '/package.json', '/wardrobe/../package.json',
    '/wardrobe/%2e%2e/package.json', '/assets/%2e%2e/package.json',
    '/assets/%2e%2e%5cpackage.json', '/assets/%00.svg', '/assets/%ZZ.svg'
  ]) {
    assert.equal((await request(url)).status, 404, url);
  }
});

test('HEAD reports resource metadata without a body and write methods are rejected', async () => {
  const head = await request('/wardrobe/src/app.js', 'HEAD');
  assert.equal(head.status, 200);
  assert.match(head.headers['content-type'], /^text\/javascript/);
  assert.ok(Number(head.headers['content-length']) > 0);
  assert.equal(head.body, '');
  const post = await request('/wardrobe/', 'POST');
  assert.equal(post.status, 405);
  assert.equal(post.headers.allow, 'GET, HEAD');
});

test('local model, WebAssembly runtime, module worker and licenses serve with the correct MIME types', async () => {
  for(const [file,type] of [['ai/test.onnx','application/octet-stream'],['vendor/runtime.wasm','application/wasm'],['ai/worker.js','text/javascript'],['vendor/runtime.mjs','text/javascript'],['vendor/LICENSE.txt','text/plain']]) {
    const response=await request(`/wardrobe/assets/${file}`);
    assert.equal(response.status,200,file);
    assert.ok(response.headers['content-type'].startsWith(type),file);
  }
});

test('package includes only static application files, excluding APKs, hidden and development files', async () => {
  const build = spawn(process.execPath, [path.join(fixture, 'scripts/package.mjs')], { stdio: ['ignore', 'ignore', 'pipe'] });
  let errorOutput = '';
  build.stderr.on('data', chunk => { errorOutput += chunk; });
  const [code] = await once(build, 'exit');
  assert.equal(code, 0, errorOutput);
  async function listing(directory, prefix = '') {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) files.push(...await listing(path.join(directory, entry.name), relative));
      else files.push(relative);
    }
    return files.sort();
  }
  assert.deepEqual(await listing(path.join(fixture, 'dist')), ['.nojekyll', 'assets/ai/test.onnx', 'assets/ai/worker.js', 'assets/garments/test.svg', 'assets/vendor/LICENSE.txt', 'assets/vendor/runtime.mjs', 'assets/vendor/runtime.wasm', 'index.html', 'src/app.js', 'styles.css']);
  assert.equal(await readFile(path.join(fixture, 'dist/index.html'), 'utf8'), (await request('/')).body);
});
