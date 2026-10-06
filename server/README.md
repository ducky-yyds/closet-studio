# 真实衣物平铺代理

浏览器本地背景分割无法去掉人体并补全被遮挡的衣物。此代理将原始照片交给生成式图像编辑模型，只保留选定单品，重建为俯视平铺商品图。遮挡部分是模型根据可见信息合理补全，不能保证与实物完全一致。

按用户选择，默认提供方为阿里云百炼 `qwen-image-edit-plus`，通过 `DASHSCOPE_API_KEY` 启用。[官方 API](https://help.aliyun.com/zh/model-studio/qwen-image-edit-api) 请求为单轮 `input.messages`、一张图片、一条严格移除人体并平铺衣物的指令、`parameters.n=1`，关闭提示词扩写和水印，输出 `1024*1024` 纯白背景 PNG。浏览器随后整理透明背景。默认北京接口，新加坡地域需通过 `FLATLAY_ENDPOINT` 设置匹配地址。

Photoroom 专用 [Flat Lay API](https://docs.photoroom.com/image-editing-api-plus-plan/flat-lay) 保留为可选适配。使用 `FLATLAY_PROVIDER=photoroom` 和 `PHOTOROOM_API_KEY` 启用，代理发送 `flatLay.mode=ai.auto` 等参数，返回 PNG。该能力可能收费，代码不会自动调用或部署。

Node 22 及以上可运行：

```powershell
Copy-Item .env.example .env
# 编辑 .env，填写 DASHSCOPE_API_KEY、Origin 白名单和个人口令。
node --env-file=.env server/flatlay-server.mjs
```

API 密钥始终只在服务端环境变量中；不要填写到前端，不要提交 `.env`。代理不保存图片、不打印图片或密钥。服务端请求上游时禁止重定向；结果下载只接受官方 DashScope 结果 OSS 域名，实际下载一律使用 HTTPS。[官方 API 文档的访问域名白名单 FAQ](https://help.aliyun.com/zh/model-studio/qwen-image-edit-api) 说明结果存储桶会动态变化，因此默认支持 `dashscope-[四位十六进制字符].oss-accelerate.aliyuncs.com` 和同类 `oss-cn-<地域>` 公网域名，并保留旧 `dashscope-result` 桶规则。拒绝内部域名、凭据、非标准端口和伪装后缀；其他额外官方 OSS 存储桶可通过 `FLATLAY_RESULT_HOSTS` 精确配置。

- `GET /api/health` 返回 `{enabled,provider,model}`；未配置时 `enabled:false`。
- `POST /api/flatlay` 接受 JSON `{image:PNG/JPEG/WebP dataURL,category,targetDescription?:string}`；成功返回 `{image:dataURL,kind:"flatlay",provider,model}`。
- 错误返回 `{error:{code,message}}`，未配置为 HTTP 503；超时为 504；密钥或上游错误正文不会返回浏览器。
- 只接受 Origin 白名单。默认仅本机 4173、4174、4175；使用 GitHub Pages 时将完整站点 Origin 加入 `ALLOWED_ORIGINS`。
- 设置 `FLATLAY_ACCESS_TOKEN` 后，请求必须带 `X-Closet-Token`。Worker 和 Node 公网监听必须设置口令才能启用服务，以限制付费调用；本机监听可选。
- 单张原始图片最多 10 MiB，整个 JSON 请求最多 12 MiB。Base64 会增加体积，接近上限的原图需先压缩。单次请求只生成一张图，120 秒超时；浏览器取消会中止代理连接。

`worker/src/index.mjs` 复用完全相同的服务逻辑，可部署到 Cloudflare Worker。修改 `worker/wrangler.jsonc` 的 Origin 后，使用 Wrangler 的 secret 管理填入 `DASHSCOPE_API_KEY` 和必需的 `FLATLAY_ACCESS_TOKEN`；不要把密钥填进 `vars`。GitHub Pages 只托管网页，无法独立运行此代理。公网 Node 托管可运行同一服务，设置 `FLATLAY_HOST=0.0.0.0`、托管要求的 `FLATLAY_PORT`，并通过平台环境变量配置密钥、口令和来源。

已用百炼 `qwen-image-edit-plus` 完成一张真实穿着照片的生成、下载和视觉检查；人物及原背景去除，T 恤完整平铺。浏览器本地 ONNX 再把白背景整理为透明 PNG，已验证确认入库和保留原图。模型对原图不可见的领标进行了补全，应由使用者核对，单张实测不代表所有款式都能精确复原。

测试使用注入的模拟 fetch，不调用真实 API：

```powershell
node --test tests/flatlay-server.test.mjs
```

## 阿里云函数计算

国内公网代理的部署入口和说明位于 [deploy/fc/README.md](../deploy/fc/README.md)。可用阿里云 CLI OAuth 浏览器授权后自动部署，或上传不含密钥的 ZIP 到控制台。配置使用 Nodejs22 官方公共层、`0.0.0.0:9000`、180 秒函数超时、固定 GitHub Pages Origin 和必需的个人访问口令。脚本在显式 `--apply` 前只准备部署包，不调用云 API。
