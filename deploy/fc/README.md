# 阿里云函数计算国内代理

此包只运行衣物平铺代理，复用 `server/`，网页发布在 `https://ducky-yyds.github.io/closet-studio/`。函数名称 `closet-flatlay`，北京地域，`custom.debian12`，512 MiB / 0.5 vCPU，单实例并发 1，函数超时 180 秒；AI 请求仍为 120 秒。原始 HTTP 路径直接保留，无需修改前端接口。

默认来源固定为 `https://ducky-yyds.github.io`，必须设置 `FLATLAY_ACCESS_TOKEN` 才启用生成。百炼 Key 只在函数环境变量中。ZIP 仅包含四个运行文件，不包含 `.env`、衣物图片、网页、模型或凭据。部署脚本默认只打包，只有显式 `--apply` 才调用云 API。

## 浏览器授权与自动部署

推荐阿里云 CLI 3.3.0 及以上的 [OAuth 认证](https://help.aliyun.com/zh/cli/oauth-credentials)：无需聊天传递长期 AccessKey。账号管理员首次在 [RAM 控制台](https://ram.console.aliyun.com/) 的“集成管理 → OAuth 应用（公测）→ 第三方应用”安装 `official-cli`，在应用详情的“允许访问的身份”添加部署身份；该身份需有创建、更新 FC 函数和 HTTP 触发器的权限。

```powershell
# 此命令必须交互运行，自动打开浏览器；也可手动打开 CLI 输出的登录链接。
.\artifacts\tools\aliyun-cli\aliyun.exe configure --mode OAuth --profile closet-fc
# 登录站点默认中国站；默认地域填 cn-beijing，语言填 zh。
```

授权成功后，在工作区根目录运行：

```powershell
node deploy/fc/build.mjs
# 默认命令只准备代码包，不读模型密钥，不调用云 API。
node deploy/fc/deploy.mjs

# 允许实际部署时使用：Node 将 .env 注入进程，不把内容放入命令参数。
node --env-file=.env deploy/fc/deploy.mjs --apply --profile closet-fc
```

脚本默认查找 `artifacts/tools/aliyun-cli/aliyun.exe`，其次为 PATH 中的 `aliyun`；可用 `--cli` 指定可执行文件路径。凭据由 CLI OAuth profile 管理，脚本不读取 CLI 凭据。部署通过 [FC 3.0 官方 API](https://help.aliyun.com/zh/functioncompute/api-fc-2023-03-30-createfunction) 的 REST 请求实现，官方 [CLI `--body-file`](https://www.alibabacloud.com/help/en/cli/command-line-options) 保证模型 Key 和访问口令不出现在命令参数中。私有请求文件仅暂存在 Git 忽略的 `artifacts/fc/`，完成后删除；CLI 原始响应与错误不打印，避免平台返回环境变量值。

若 `.env` 没有访问口令，脚本生成随机口令并存到本机 `artifacts/fc/closet-access-token.txt`，不会打印口令。部署成功的 HTTPS 地址记录在 `artifacts/fc/deployment-result.json`，网页“数据与设置”填写该地址及口令；模型 Key 不填到网页。

## 控制台 ZIP 备用方案

1. 运行打包命令，获得 `artifacts/fc/closet-flatlay-fc.zip`。
2. 登录 [函数计算控制台](https://fc.console.aliyun.com/)，北京地域创建 Web 函数 `closet-flatlay`，运行时选择 `custom.debian12`，上传 ZIP。
3. 添加官方公共层 `Nodejs22` 版本 3，ARN 为 `acs:fc:cn-beijing:official:layers/Nodejs22/versions/3`。层的[官方说明](https://github.com/awesome-fc/awesome-layers/blob/main/docs/Nodejs22/README.md) 指定 Node 在 `/opt/nodejs22/bin`。启动命令 `/opt/nodejs22/bin/node`，参数 `/code/entry.mjs`，监听端口 9000。
4. 内存 512 MiB、CPU 0.5、磁盘 512 MiB、并发 1、超时 180 秒，允许访问公网。公共环境变量参考 `manifest.json`；另在平台环境变量中填入 `DASHSCOPE_API_KEY` 和自定 `FLATLAY_ACCESS_TOKEN`。
5. 创建 HTTP 触发器，允许 GET、POST、OPTIONS，平台鉴权选匿名，开启公网。应用自身仍要求口令。使用触发器提供的 HTTPS 地址。

## 验证

先访问 `HTTPS地址/api/health`，应返回 `enabled:true`。网页连接检查、错误口令拦截、CORS 预检都不调用百炼；实际生成照片可能收费。没有云账号授权时，本地校验不会冒充上线成功。

实现参考官方 [自定义运行时要求](https://www.alibabacloud.com/help/en/functioncompute/principles-1)、[函数配置](https://help.aliyun.com/zh/functioncompute/api-fc-2023-03-30-struct-createfunctioninput)、[HTTP 触发器配置](https://help.aliyun.com/zh/functioncompute/api-fc-2023-03-30-struct-httptriggerconfig) 和 [FC 3.0 公网接入点](https://help.aliyun.com/en/functioncompute/api-fc-2023-03-30-endpoint)。HTTP 服务按平台要求监听 `0.0.0.0:9000` 并允许连接复用。
