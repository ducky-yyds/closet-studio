import os from 'node:os';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import FC from '@alicloud/fc20230330';
import OpenApi from '@alicloud/openapi-client';
import Tea from '@alicloud/tea-util';

export function credentialFromEnvironment(env = {}) {
  const accessKeyId = env.ALIBABA_CLOUD_ACCESS_KEY_ID;
  const accessKeySecret = env.ALIBABA_CLOUD_ACCESS_KEY_SECRET;
  const securityToken = env.ALIBABA_CLOUD_SECURITY_TOKEN;
  if (![accessKeyId, accessKeySecret, securityToken].some(value => typeof value === 'string' && value.trim())) return null;
  if ([accessKeyId, accessKeySecret].some(value => typeof value !== 'string' || !value.trim() || /[\r\n]/.test(value)) || (securityToken && (typeof securityToken !== 'string' || /[\r\n]/.test(securityToken)))) throw Object.assign(new Error('Standard RAM cloud credentials are incomplete or invalid.'), { code: 'CLOUD_CREDENTIAL_MISSING' });
  return { accessKeyId, accessKeySecret, ...(securityToken?.trim() ? { securityToken } : {}) };
}

export function credentialFromProfile(configuration, name, now = Date.now()) {
  const profile = configuration?.profiles?.find(value => value.name === name);
  if (!profile || !['OAuth', 'StsToken'].includes(profile.mode)) throw Object.assign(new Error('The selected OAuth/STS CLI profile is unavailable.'), { code: 'OAUTH_PROFILE_MISSING' });
  const credential = { accessKeyId: profile.access_key_id, accessKeySecret: profile.access_key_secret, securityToken: profile.sts_token };
  if (Object.values(credential).some(value => typeof value !== 'string' || !value || /[\r\n]/.test(value))) throw Object.assign(new Error('Temporary OAuth credentials are incomplete.'), { code: 'OAUTH_CREDENTIAL_MISSING' });
  if (profile.sts_expiration && Number(profile.sts_expiration) * 1000 <= now + 60_000) throw Object.assign(new Error('Temporary OAuth credentials have expired; refresh the existing CLI profile.'), { code: 'OAUTH_CREDENTIAL_EXPIRED' });
  return credential;
}

export async function createFcSdkTransport({ profile = 'closet-fc', region = 'cn-beijing', configPath = path.join(os.homedir(), '.aliyun', 'config.json'), credential, env = process.env, securityTokenQuery = false, fcTokenHeader = false, accountId } = {}) {
  credential ||= credentialFromEnvironment(env);
  if (!credential) {
    let configuration;
    try { configuration = JSON.parse(await readFile(configPath, 'utf8')); }
    catch { throw Object.assign(new Error('Unable to load the existing OAuth CLI profile.'), { code: 'OAUTH_PROFILE_UNREADABLE' }); }
    credential = credentialFromProfile(configuration, profile);
  }
  if (accountId !== undefined && !/^\d{6,32}$/.test(accountId)) throw new Error('Invalid Function Compute account endpoint.');
  const config = new OpenApi.Config({ ...credential, type: credential.securityToken ? 'sts' : 'access_key', regionId: region, endpoint: accountId ? `${accountId}.${region}.fc.aliyuncs.com` : `fcv3.${region}.aliyuncs.com`, protocol: 'HTTPS',
    ...((securityTokenQuery || fcTokenHeader) ? { globalParameters: new OpenApi.GlobalParameters({
      ...(securityTokenQuery ? { queries: { SecurityToken: credential.securityToken } } : {}),
      ...(fcTokenHeader ? { headers: { 'x-fc-security-token': credential.securityToken } } : {})
    }) } : {}) });
  const client = new FC.default(config);
  const runtime = new Tea.RuntimeOptions({ autoretry: false, maxAttempts: 1, readTimeout: 180_000, connectTimeout: 15_000 });
  return async function sdkTransport(_executable, args) {
    const method = args[1], route = args[2];
    const name = /^\/2023-03-30\/functions\/([^/]+)/.exec(route)?.[1];
    const triggerName = /\/triggers\/([^/]+)$/.exec(route)?.[1];
    const bodyIndex = args.indexOf('--body-file');
    const body = bodyIndex >= 0 ? JSON.parse(await readFile(args[bodyIndex + 1], 'utf8')) : null;
    try {
      let response;
      if (method === 'GET' && triggerName) response = await client.getTriggerWithOptions(name, triggerName, {}, runtime);
      else if (method === 'GET') response = await client.getFunctionWithOptions(name, new FC.GetFunctionRequest({}), {}, runtime);
      else if (route.includes('/triggers')) {
        if (method === 'POST') response = await client.createTriggerWithOptions(name, new FC.CreateTriggerRequest({ body: new FC.CreateTriggerInput(body) }), {}, runtime);
        else response = await client.updateTriggerWithOptions(name, triggerName, new FC.UpdateTriggerRequest({ body: new FC.UpdateTriggerInput(body) }), {}, runtime);
      } else {
        const properties = { ...body, code: new FC.InputCodeLocation(body.code), customRuntimeConfig: new FC.CustomRuntimeConfig(body.customRuntimeConfig) };
        if (method === 'POST') response = await client.createFunctionWithOptions(new FC.CreateFunctionRequest({ body: new FC.CreateFunctionInput(properties) }), {}, runtime);
        else response = await client.updateFunctionWithOptions(name, new FC.UpdateFunctionRequest({ body: new FC.UpdateFunctionInput(properties) }), {}, runtime);
      }
      return response.body;
    } catch (failure) {
      const missingToken = /missing parameter SecurityToken/i.test(String(failure.message || ''));
      const code = missingToken ? 'SDK_SECURITY_TOKEN_MISSING' : typeof failure.code === 'string' && /^[A-Za-z0-9._-]{1,100}$/.test(failure.code) ? failure.code : 'SDK_FAILURE';
      throw Object.assign(new Error(`Function Compute SDK operation failed (${code}).`), { code });
    }
  };
}
