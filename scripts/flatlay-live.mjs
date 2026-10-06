// Manual, paid-provider smoke test. Never part of npm test or the deployment CI.
// Run only after the owner authorizes the provider and configures the API key.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { createFlatlayHandler } from '../server/flatlay-service.mjs';

if(existsSync('.env'))process.loadEnvFile('.env');
const base=process.env.LIVE_PROXY_URL||'http://127.0.0.1:8787';
const fixture=process.env.LIVE_GARMENT_PHOTO||'artifacts/upload-fixtures/garment-photo.jpg';
const target=path.resolve('artifacts/flatlay-live');
await mkdir(target,{recursive:true});
// Private, ignored artifact: retain the short-lived provider response so a
// transport/validation fix can retry downloading without another paid edit.
// Never print its signed URL or copy it into source/release packages.
const cachePath=path.join(target,'private-provider-response.json');
const health=await fetch(`${base}/api/health`).then(response=>response.json());
if(!health.enabled)throw new Error('The flat-lay service is not configured.');
const photo=await readFile(fixture);
const input={image:`data:image/jpeg;base64,${photo.toString('base64')}`,category:'上装',targetDescription:'照片中人物身上的白色短袖T恤。只保留这件T恤，不要人物、皮肤、手臂、裤子或背景，将完整T恤展开成俯视平铺商品图。'};
const fingerprint=createHash('sha256').update(JSON.stringify({input,provider:health.provider,model:health.model})).digest('hex');
let cached;
if(existsSync(cachePath)&&!process.argv.includes('--new-generation')){
  const envelope=JSON.parse(await readFile(cachePath,'utf8'));
  if(envelope.version!==1||envelope.fingerprint!==fingerprint)throw new Error('Cached result belongs to a different input/configuration. Use --new-generation only if a new paid edit is intended.');
  if(Date.now()-envelope.createdAt>23*60*60*1000)throw new Error('Cached provider URL has expired. Use --new-generation only if a new paid edit is intended.');
  cached=envelope.response;
}
const reusedExistingResult=Boolean(cached);
console.log(JSON.stringify({provider:health.provider,model:health.model,inputBytes:photo.length,request:cached?'reuse existing provider result; no paid edit':'one image edit'}));
const started=Date.now();
const fetchImpl=async (url,options)=>{
  if(options.method==='POST'){
    if(cached)return Response.json(cached);
    const response=await fetch(url,options);
    if(response.ok){
      const data=await response.clone().json();
      if(data.output?.choices?.[0]?.message?.content?.some(part=>typeof part.image==='string')){
        cached=data;
        await writeFile(cachePath,JSON.stringify({version:1,fingerprint,createdAt:Date.now(),response:data}));
      }
    }
    return response;
  }
  for(let attempt=0;;attempt++){
    try{
      const response=await fetch(url,options);
      if(response.status<500||attempt===2)return response;
      await response.body?.cancel();
    }catch(error){if(options.signal.aborted||attempt===2)throw error;}
  }
};
const handle=createFlatlayHandler(process.env,{fetchImpl,onDiagnostic:info=>console.log(JSON.stringify({download:info}))});
const response=await handle(new Request(`${base}/api/flatlay`,{method:'POST',signal:AbortSignal.timeout(150000),
  headers:{'Content-Type':'application/json',Origin:'http://127.0.0.1:4173',...(process.env.FLATLAY_ACCESS_TOKEN?{'X-Closet-Token':process.env.FLATLAY_ACCESS_TOKEN}:{})},
  body:JSON.stringify(input)}));
const result=await response.json();
if(!response.ok){console.log(JSON.stringify({status:response.status,error:result.error,elapsedMs:Date.now()-started}));process.exitCode=1;}
else{
  if(result.kind!=='flatlay'||!/^data:image\/png;base64,/.test(result.image))throw new Error('The proxy did not return a flat-lay PNG.');
  const bytes=Buffer.from(result.image.split(',')[1],'base64');
  await writeFile(path.join(target,'generated-flatlay.png'),bytes);
  await writeFile(path.join(target,'original-photo.jpg'),photo);
  const report={verification:'REAL_PROVIDER_GENERATION',provider:result.provider,model:result.model,bytes:bytes.length,reusedExistingResult,elapsedMs:Date.now()-started,visualReview:'pending'};
  await writeFile(path.join(target,'result.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
}
