import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { once } from 'node:events';
import { fcManifest, buildFcArchive } from './build.mjs';
import { buildFunctionPayload, cloudCliArguments, deployFc } from './deploy.mjs';

const mockKey = 'mock-model-key-not-a-real-secret';
const mockToken = 'mock-personal-access-token';
const mockEnv = { DASHSCOPE_API_KEY: mockKey, FLATLAY_ACCESS_TOKEN: mockToken };
const mockUrl = 'https://closet-unit-test.cn-beijing.fcapp.run';

async function temporary(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'closet-fc-test-'));
  t.after(async () => {
    assert.ok(path.resolve(directory).startsWith(`${path.resolve(os.tmpdir())}${path.sep}`) && path.basename(directory).startsWith('closet-fc-test-'));
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}

function archiveFiles(bytes) {
  const files = [];
  let offset = 0;
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    const length = bytes.readUInt32LE(offset + 18), nameLength = bytes.readUInt16LE(offset + 26), extraLength = bytes.readUInt16LE(offset + 28);
    const name = bytes.subarray(offset + 30, offset + 30 + nameLength).toString('utf8');
    const start = offset + 30 + nameLength + extraLength;
    files.push({ name, content: bytes.subarray(start, start + length) });
    offset = start + length;
  }
  return files;
}

test('FC ZIP contains only runtime code and extracts to a working HTTP service with enforced public token and origin', async t => {
  const directory = await temporary(t);
  const built = await buildFcArchive(directory);
  const bytes = await readFile(built.zipPath);
  const files = archiveFiles(bytes);
  assert.deepEqual(files.map(file => file.name), ['entry.mjs', 'server/flatlay-server.mjs', 'server/flatlay-service.mjs', 'server/flatlay-prompt.mjs']);
  assert.equal(bytes.includes(Buffer.from(mockKey)), false);
  assert.equal(bytes.includes(Buffer.from(mockToken)), false);
  for (const file of files) {
    const filename = path.join(directory, 'extracted', file.name);
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, file.content);
  }
  const { createFcServer } = await import(pathToFileURL(path.join(directory, 'extracted', 'entry.mjs')).href);
  const server = createFcServer(mockEnv, { fetchImpl: () => { throw new Error('Offline validation must not call an image provider'); } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const health = await fetch(`${base}/api/health`, { headers: { Origin: 'https://ducky-yyds.github.io' } });
  assert.deepEqual(await health.json(), { enabled: true, provider: 'dashscope', model: 'qwen-image-edit-plus' });
  assert.equal(health.headers.get('Access-Control-Allow-Origin'), 'https://ducky-yyds.github.io');
  const denied = await fetch(`${base}/api/flatlay`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://ducky-yyds.github.io' }, body: '{}' });
  assert.equal(denied.status, 401);
  const foreign = await fetch(`${base}/api/health`, { headers: { Origin: 'https://attacker.example' } });
  assert.equal(foreign.status, 403);
  assert.equal(server.keepAliveTimeout, 86_400_000);
});

test('function payload validates secrets and service endpoint while CLI arguments contain only private filenames', async () => {
  const manifest = await fcManifest();
  const payload = buildFunctionPayload(manifest, Buffer.from('mock ZIP bytes'), mockEnv, mockToken);
  assert.equal(payload.environmentVariables.DASHSCOPE_API_KEY, mockKey);
  assert.equal(payload.environmentVariables.FLATLAY_ACCESS_TOKEN, mockToken);
  assert.equal(manifest.function.environmentVariables.DASHSCOPE_API_KEY, undefined);
  assert.equal(manifest.function.environmentVariables.FLATLAY_ACCESS_TOKEN, undefined);
  const args = cloudCliArguments('POST', '/2023-03-30/functions', { bodyPath: '/private/request.json' });
  assert.ok(args.includes('--body-file'));
  assert.equal(args.join(' ').includes(mockKey), false);
  assert.equal(args.join(' ').includes(mockToken), false);
  assert.throws(() => buildFunctionPayload(manifest, Buffer.from('zip'), {}, mockToken));
  assert.throws(() => buildFunctionPayload(manifest, Buffer.from('zip'), mockEnv, ''));
  assert.throws(() => buildFunctionPayload(manifest, Buffer.from('zip'), { ...mockEnv, FLATLAY_ENDPOINT: 'https://attacker.example' }, mockToken));
  assert.throws(() => cloudCliArguments('DELETE', '/2023-03-30/functions/other'));
  assert.throws(() => cloudCliArguments('POST', '/other/route'));
  assert.throws(() => cloudCliArguments('POST', '/2023-03-30/functions', { profile: 'profile\nsecret' }));
});

for (const scenario of ['create', 'update']) {
  test(`offline ${scenario} uses OAuth CLI profile, creates HTTPS trigger, cleans secret request files and only updates owned functions`, async t => {
    const directory = await temporary(t);
    const manifest = await fcManifest();
    const calls = [];
    const result = await deployFc(['--apply', '--cli', 'mock-aliyun-cli'], mockEnv, { outputDirectory: directory, runCliImpl: async (_executable, args) => {
      const method = args[1], route = args[2];
      const bodyIndex = args.indexOf('--body-file');
      const body = bodyIndex >= 0 ? JSON.parse(await readFile(args[bodyIndex + 1], 'utf8')) : null;
      calls.push({ method, route, body });
      assert.ok(args.includes('closet-fc'));
      assert.equal(args.join(' ').includes(mockKey), false);
      if (method === 'GET' && !route.includes('/triggers/')) {
        if (scenario === 'create') throw Object.assign(new Error('Mock missing function'), { code: 'FunctionNotFound' });
        return structuredClone(manifest.function);
      }
      if (method === 'GET') throw Object.assign(new Error('Mock missing trigger'), { code: 'TriggerNotFound' });
      if (route.endsWith('/triggers')) return { httpTrigger: { urlInternet: mockUrl } };
      return { functionName: manifest.function.functionName };
    } });
    assert.equal(result.url, mockUrl);
    const functionWrite = calls.find(call => ['POST', 'PUT'].includes(call.method) && !call.route.includes('/triggers'));
    assert.equal(functionWrite.method, scenario === 'create' ? 'POST' : 'PUT');
    assert.equal(functionWrite.body.environmentVariables.DASHSCOPE_API_KEY, mockKey);
    assert.equal(functionWrite.body.environmentVariables.FLATLAY_ACCESS_TOKEN, mockToken);
    assert.equal((await readdir(directory)).some(filename => filename.startsWith('.private-')), false);
    const output = await readFile(path.join(directory, 'deployment-result.json'), 'utf8');
    assert.equal(output.includes(mockKey), false);
    assert.equal(output.includes(mockToken), false);
  });
}

test('an existing unrelated function is never overwritten and CLI failures clean private payload files', async t => {
  const directory = await temporary(t);
  const manifest = await fcManifest();
  for (const existing of [
    { ...manifest.function, description: 'Another application' },
    { ...manifest.function, customRuntimeConfig: { command: ['/some/command'], args: ['/code/other.mjs'] } }
  ]) {
    let calls = 0;
    await assert.rejects(deployFc(['--apply'], mockEnv, { outputDirectory: directory, runCliImpl: async (_executable, args) => { calls++; assert.equal(args[1], 'GET'); return existing; } }), failure => failure.code === 'FUNCTION_NAME_CONFLICT');
    assert.equal(calls, 1);
  }
  await assert.rejects(deployFc(['--apply'], mockEnv, { outputDirectory: directory, runCliImpl: async (_executable, args) => {
    if (args[1] === 'GET') throw Object.assign(new Error('Mock missing'), { code: 'FunctionNotFound' });
    throw Object.assign(new Error('Mock deploy error'), { code: 'AccessDenied' });
  } }), failure => failure.code === 'AccessDenied');
  assert.equal((await readdir(directory)).some(filename => filename.startsWith('.private-')), false);
});
