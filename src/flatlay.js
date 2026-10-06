import { DEFAULT_FLATLAY_SERVICE_URL } from './config.js';

const namespace = encodeURIComponent(new URL('../', import.meta.url).pathname);
const urlKey = `closet-flatlay-url:${namespace}`;
const tokenKey = `closet-flatlay-access:${namespace}`;
const raster = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

export function normalizeServiceUrl(value) {
  const text=String(value||'').trim();
  if(!text)return '';
  let url;try{url=new URL(text);}catch{throw new Error('请填写完整的平铺服务地址，例如 https://closet-ai.example.workers.dev。');}
  const loopback=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  if(url.protocol!=='https:'&&!(url.protocol==='http:'&&loopback))throw new Error('线上平铺服务需使用 HTTPS，本机服务可使用 HTTP。');
  if(url.username||url.password||url.search||url.hash)throw new Error('服务地址不能包含密码、查询参数或访问密钥。');
  return url.href.replace(/\/+$/,'');
}

export function getFlatlayConfig() {
  try{return {url:normalizeServiceUrl(localStorage.getItem(urlKey)??DEFAULT_FLATLAY_SERVICE_URL),token:sessionStorage.getItem(tokenKey)||''};}
  catch{return {url:'',token:''};}
}

export function setFlatlayConfig({url='',token=''}={}) {
  const normalized=normalizeServiceUrl(url);
  const access=String(token||'').trim();
  if(access.length>512||/[\r\n]/.test(access))throw new Error('访问口令格式不正确。');
  if(/^sk-[A-Za-z0-9_-]{10,}/.test(access))throw new Error('这里填写代理服务的访问口令。模型 API Key 应放在后端的密钥设置中。');
  // An explicit blank URL disconnects even when the site has a default proxy.
  localStorage.setItem(urlKey,normalized);
  if(access)sessionStorage.setItem(tokenKey,access);else sessionStorage.removeItem(tokenKey);
  return {url:normalized,token:access};
}

function servicePath(base,path) { return `${base.replace(/\/+$/,'')}/api/${path}`; }

async function request(path,{body,signal,timeout=150000}={}) {
  const config=getFlatlayConfig();
  if(!config.url){const error=new Error('请先在“数据与设置”中连接平铺 AI 服务。');error.code='NOT_CONFIGURED';throw error;}
  const controller=new AbortController(),abort=()=>controller.abort(signal?.reason);
  if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(()=>controller.abort(new DOMException('请求超时','TimeoutError')),timeout);
  try {
    const response=await fetch(servicePath(config.url,path),{method:body?'POST':'GET',credentials:'omit',signal:controller.signal,
      headers:{...(body?{'Content-Type':'application/json'}:{}),...(config.token?{'X-Closet-Token':config.token}:{})},...(body?{body:JSON.stringify(body)}:{})});
    let data;try{data=await response.json();}catch{throw new Error('平铺服务没有返回有效结果，请检查服务地址。');}
    if(!response.ok){const error=new Error(data.error?.message||`平铺服务请求失败（${response.status}）。`);error.code=data.error?.code||'SERVICE_ERROR';throw error;}
    return data;
  }catch(error){
    if(signal?.aborted)throw new DOMException('已取消这次平铺处理。','AbortError');
    if(controller.signal.aborted)throw new Error('平铺处理超时，请稍后检查服务状态再重试。');
    if(error instanceof TypeError)throw new Error('无法连接平铺服务，请检查服务地址、网络及允许访问的站点。');
    throw error;
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}

export async function checkFlatlayService({signal}={}) {
  const result=await request('health',{signal,timeout:15000});
  if(typeof result.enabled!=='boolean')throw new Error('服务状态格式不正确。');
  return result;
}

export async function generateFlatlay(image,{category,targetDescription='',signal,onProgress}={}) {
  if(!raster.test(image))throw new Error('请上传有效的衣物照片。');
  if(!['上装','下装','连衣裙','外套','鞋履','配饰'].includes(category))throw new Error('请选择需要提取的衣物分类。');
  if(String(targetDescription).length>300)throw new Error('目标衣物描述不能超过 300 字。');
  onProgress?.({stage:'generate',message:'AI 正在去除人体并重建平铺衣物，请稍候…',percent:15});
  const result=await request('flatlay',{body:{image,category,targetDescription:String(targetDescription).trim()},signal});
  if(result.kind!=='flatlay'||!raster.test(result.image))throw new Error('服务没有返回平铺衣物图，原图已保留，请重试。');
  if(typeof result.provider!=='string'||result.provider.length>120||typeof result.model!=='string'||result.model.length>160)throw new Error('平铺服务的结果信息不完整。');
  if(result.image===image)throw new Error('服务返回了原图，没有完成平铺重建，请重试。');
  onProgress?.({stage:'generated',message:'平铺衣物图已返回，正在整理透明边缘…',percent:80});
  return result;
}
