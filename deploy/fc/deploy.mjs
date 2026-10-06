import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { access, mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { artifactRoot, projectRoot, buildFcArchive } from './build.mjs';
import { flatlayConfiguration } from '../../server/flatlay-service.mjs';
import { createFcSdkTransport } from './sdk.mjs';

function option(args, name, fallback) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`${name} requires a value.`);
  return args[index + 1];
}

export function buildFunctionPayload(manifest, archive, env, accessToken) {
  if (!Buffer.isBuffer(archive) || !manifest?.function || typeof env?.DASHSCOPE_API_KEY !== 'string' || !env.DASHSCOPE_API_KEY.trim() || /[\r\n]/.test(env.DASHSCOPE_API_KEY) || env.DASHSCOPE_API_KEY.length > 4096) throw new Error('Deployment archive or DASHSCOPE_API_KEY is missing or invalid.');
  if (typeof accessToken !== 'string' || !accessToken || accessToken.length > 512 || /[\r\n]/.test(accessToken) || /^sk-/.test(accessToken)) throw new Error('A valid proxy access token is required.');
  const payload = structuredClone(manifest.function);
  payload.code = { zipFile: archive.toString('base64') };
  payload.environmentVariables.DASHSCOPE_API_KEY = env.DASHSCOPE_API_KEY;
  payload.environmentVariables.FLATLAY_ACCESS_TOKEN = accessToken;
  for (const key of ['FLATLAY_MODEL', 'FLATLAY_ENDPOINT', 'FLATLAY_RESULT_HOSTS']) if (env[key]?.trim()) payload.environmentVariables[key] = env[key];
  if (!flatlayConfiguration(payload.environmentVariables, { requireAccessToken: true }).enabled) throw new Error('The server-side image service configuration is invalid.');
  return payload;
}

export function cloudCliArguments(method, route, { profile = 'closet-fc', region = 'cn-beijing', bodyPath } = {}) {
  if (!['GET', 'POST', 'PUT'].includes(method) || !/^\/2023-03-30\/functions(?:\/[A-Za-z_][A-Za-z0-9_-]{0,63}(?:\/triggers(?:\/[A-Za-z_][A-Za-z0-9_-]{0,127})?)?)?$/.test(route)) throw new Error('Invalid Function Compute operation.');
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(profile) || !/^cn-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(region) || (bodyPath !== undefined && (typeof bodyPath !== 'string' || /[\r\n\0]/.test(bodyPath)))) throw new Error('Invalid cloud CLI configuration.');
  return ['fc', method, route, '--version', '2023-03-30', '--region', region, '--endpoint', `fcv3.${region}.aliyuncs.com`, '--profile', profile, '--secure', '--retry-count', '0', '--read-timeout', '180',
    ...(bodyPath ? ['--header', 'Content-Type=application/json', '--body-file', bodyPath] : [])];
}

function safeCloudCode(stdout, stderr) {
  for (const text of [stdout, stderr]) {
    try {
      const parsed = JSON.parse(text);
      const code = parsed.Code || parsed.code || parsed.error?.Code || parsed.error?.code;
      if (typeof code === 'string' && /^[A-Za-z0-9._-]{1,100}$/.test(code)) return code;
    } catch {}
    for (const code of ['FunctionNotFound', 'TriggerNotFound', 'FunctionAlreadyExists', 'TriggerAlreadyExists', 'AccessDenied', 'InvalidAccessKeyId', 'InvalidSecurityToken.Expired', 'Forbidden']) if (text.includes(code)) return code;
  }
  return 'CLI_FAILURE';
}

async function runCli(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: projectRoot, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', bytes = 0;
    child.once('error', () => reject(Object.assign(new Error('Unable to start the configured Alibaba Cloud CLI.'), { code: 'CLI_START_FAILED' })));
    const collect = (target, chunk) => {
      bytes += chunk.length;
      if (bytes > 8 * 1024 * 1024) { child.kill(); return; }
      if (target === 'stdout') stdout += chunk; else stderr += chunk;
    };
    child.stdout.on('data', chunk => collect('stdout', chunk));
    child.stderr.on('data', chunk => collect('stderr', chunk));
    child.once('close', status => {
      if (status !== 0 || bytes > 8 * 1024 * 1024) {
        const code = safeCloudCode(stdout, stderr);
        reject(Object.assign(new Error(`Cloud CLI operation failed (${code}).`), { code }));
        return;
      }
      try { resolve(JSON.parse(stdout)); }
      catch { reject(Object.assign(new Error('Cloud CLI returned an unexpected response.'), { code: 'INVALID_CLI_RESPONSE' })); }
    });
  });
}

async function proxyToken(env, outputDirectory) {
  if (env.FLATLAY_ACCESS_TOKEN?.trim()) return { token: env.FLATLAY_ACCESS_TOKEN.trim(), tokenFile: null };
  const tokenFile = path.join(outputDirectory, 'closet-access-token.txt');
  try { return { token: (await readFile(tokenFile, 'utf8')).trim(), tokenFile }; }
  catch (failure) { if (failure.code !== 'ENOENT') throw new Error('Unable to read the private proxy token file.'); }
  const token = randomBytes(32).toString('base64url');
  await writeFile(tokenFile, `${token}\n`, { flag: 'wx', mode: 0o600 });
  return { token, tokenFile };
}

// Secrets exist in private request files only while the CLI is running.
// Never inherit child output: Function Compute responses may contain env values.
export async function deployFc(args = [], env = process.env, { runCliImpl = runCli, outputDirectory = artifactRoot } = {}) {
  const built = await buildFcArchive(outputDirectory);
  if (!args.includes('--apply')) return { applied: false, zipPath: built.zipPath, sha256: built.sha256, functionName: built.manifest.function.functionName, region: built.manifest.region };
  const profile = option(args, '--profile', 'closet-fc');
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(profile)) throw new Error('Invalid CLI profile name.');
  const defaultExecutable = path.join(projectRoot, 'artifacts', 'tools', 'aliyun-cli', 'aliyun.exe');
  let fallbackExecutable = 'aliyun';
  try { await access(defaultExecutable); fallbackExecutable = defaultExecutable; } catch {}
  const executable = option(args, '--cli', env.ALIYUN_CLI_PATH || fallbackExecutable);
  const region = built.manifest.region;
  const transport = option(args, '--transport', 'sdk');
  if (!['sdk', 'cli'].includes(transport)) throw new Error('Invalid deployment transport.');
  const execute = transport === 'sdk' && runCliImpl === runCli ? await createFcSdkTransport({ profile, region, env, securityTokenQuery: args.includes('--security-token-query'), fcTokenHeader: args.includes('--fc-security-token-header') }) : runCliImpl;
  const name = built.manifest.function.functionName;
  const route = `/2023-03-30/functions/${encodeURIComponent(name)}`;
  const triggerRoute = `${route}/triggers/${encodeURIComponent(built.manifest.trigger.triggerName)}`;
  const { token, tokenFile } = await proxyToken(env, outputDirectory);
  const payload = buildFunctionPayload(built.manifest, await readFile(built.zipPath), env, token);
  const temporaryFiles = [];
  async function call(method, route, body) {
    let bodyPath;
    if (body) {
      bodyPath = path.join(outputDirectory, `.private-${randomBytes(8).toString('hex')}.json`);
      await writeFile(bodyPath, JSON.stringify(body), { flag: 'wx', mode: 0o600 });
      temporaryFiles.push(bodyPath);
    }
    return execute(executable, cloudCliArguments(method, route, { profile, region, bodyPath }));
  }
  try {
    let exists = true;
    try {
      const existing = await call('GET', route);
      if (existing.description !== built.manifest.function.description || !Array.isArray(existing.customRuntimeConfig?.args) || existing.customRuntimeConfig.args.length !== 1 || existing.customRuntimeConfig.args[0] !== '/code/entry.mjs') {
        throw Object.assign(new Error('A different function already uses this name; refusing to overwrite it.'), { code: 'FUNCTION_NAME_CONFLICT' });
      }
    } catch (failure) { if (failure.code === 'FunctionNotFound') exists = false; else throw failure; }
    if (exists) {
      const { functionName: _name, ...update } = payload;
      await call('PUT', route, update);
    } else await call('POST', '/2023-03-30/functions', payload);
    let triggerExists = true;
    try { await call('GET', triggerRoute); } catch (failure) { if (failure.code === 'TriggerNotFound') triggerExists = false; else throw failure; }
    const trigger = built.manifest.trigger;
    let result;
    if (triggerExists) {
      const { triggerName: _name, triggerType: _type, ...update } = trigger;
      result = await call('PUT', triggerRoute, update);
    } else result = await call('POST', `${route}/triggers`, trigger);
    const url = result.httpTrigger?.urlInternet;
    const parsedUrl = new URL(url || 'invalid:');
    if (parsedUrl.protocol !== 'https:' || !parsedUrl.hostname.endsWith('.fcapp.run')) throw new Error('Function deployed, but the HTTPS trigger address needs verification in the console.');
    const output = { applied: true, region, functionName: name, url: parsedUrl.href.replace(/\/$/, ''), zipPath: built.zipPath, sha256: built.sha256, tokenFile };
    await writeFile(path.join(outputDirectory, 'deployment-result.json'), `${JSON.stringify(output, null, 2)}\n`);
    return output;
  } finally {
    for (const filename of temporaryFiles) await unlink(filename).catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await deployFc(process.argv.slice(2)))); }
  catch (failure) {
    console.error(failure.code && /^[A-Za-z0-9._-]{1,100}$/.test(failure.code) ? `FC deployment failed (${failure.code}).` : failure.message);
    process.exitCode = 1;
  }
}
