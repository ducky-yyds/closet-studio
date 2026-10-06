# 衣间 · 网页电子衣橱

参考 Lookie 的衣物管理、搭配和穿搭记录，制作的独立网页版电子衣柜。支持手机和电脑，可部署到 GitHub Pages。

## 目前的功能

- 拖拽或一次选择多张穿着照片，指定目标衣物后，调用 AI 图像编辑重建为平铺展示图，支持暂停、重试、原图对比和批量入库。
- 上传衣物照片，填写分类、颜色、季节、风格和价格，搜索、筛选和收藏衣物。
- 在搭配画布里组合自己的衣物，拖动、缩放和旋转，保存搭配或导出 PNG 图片。
- 自动搭配仅使用已确认的平铺衣物图，按季节、风格、颜色协调和穿着次数组合；在日历里记录穿搭并更新穿着次数。
- 查看衣橱构成、价值和穿着统计，导出、导入完整 JSON 备份。

照片支持 JPG、PNG、WebP，每张最大 20 MB，每批最多 30 张、合计最多 100 MB。上传先在本机缩放到最长边 1200 像素并预览，不会立即向云端发送。先选择提取的分类（上装、外套、下装等），必要时填写目标描述，再点击生成。生成图需确认“无人、只含目标衣物、平铺完整、细节相符”后才会用于默认自动搭配。

平铺重建使用独立的图像编辑代理，按用户选择默认接阿里云百炼 Qwen 图像编辑，另保留 Photoroom Flat Lay 可选适配。编辑指令要求去掉人体、背景和穿着姿势，按可见衣物重建俯视平铺图。遮挡部位属于 AI 补全，应检查图案、Logo、纽扣与款式；接口成功并不保证细节完全相同。原图同时保留，可对比、还原或重新生成。失败项不会冒充成功结果，重试可能再次收费。

旧版 U2NetP 背景分割只去除显著主体的背景，可能保留人体，**不会被标为平铺图**。旧照片和备份仍可读取。这个本地模型只用于图像编辑已返回平铺图后的透明边缘整理；已透明的结果会跳过这一步。模型和 ONNX Web Runtime 共约 17 MB，与静态网页一起部署。

衣物照片、原图和记录保存在当前浏览器的 **IndexedDB**。只有主动点击生成时，原图才会经你配置的代理发送给 AI 服务商；代理不保存图片。不同站点来源或项目路径各自隔离。更换设备、浏览器或部署网址时，请导出备份再导入迁移。清理网站数据也会删除衣柜，建议定期导出备份。备份包含个人照片和衣物信息，不包含代理访问口令，请避免上传到公开仓库。

多个标签页同时修改时，过期页面的保存会被拒绝，并提示重新操作，避免覆盖另一页刚保存的资料。

第一次打开会加入 12 件插画示例，可用于手动搭配体验，**不会参与自动搭配**。默认自动搭配需要当前季节已确认的平铺上装和下装，或平铺连衣裙。旧版照片保留；点击衣橱中的“生成平铺图”可重新处理。导入备份会先显示数量，再确认**替换**当前衣橱。导入最大 100 MB，支持最多 3000 件衣物、3000 套搭配和 20000 条穿搭记录。

平铺图生成需要图像编辑服务的 API Key，由用户选择服务、确认调用并配置后才能使用。API Key 只在后端 `.env` 或 Worker secret 中；前端设置只填写代理地址和个人访问口令。未连接服务时可以保存原图，不能声称已去人或已生成平铺图。自动搭配仍为本地组合算法。账户云同步、真人试穿和淘宝订单同步未接入。

## 连接平铺 AI

已使用配置好的百炼密钥完成真实 API 实测：人物穿着的白色短袖 T 恤被重建为完整的无人平铺图，再通过浏览器本地 ONNX 整理为透明 PNG。真实结果已通过网页预览、确认和入库流程，原图保留，确认后的照片可参与自动搭配。这是一张样图的验证；原图看不见的领标等细节由模型补全，不能据此保证所有照片的保真效果。自动测试仍使用模拟接口，和真实生成验证分别记录。

1. 参考 [代理说明](server/README.md)，复制 `.env.example` 为 `.env`，在本机填写 `DASHSCOPE_API_KEY`，默认模型为 `qwen-image-edit-plus`、北京接口；新加坡地域需设置匹配的接口地址。不要把密钥发到聊天或填进网页。
2. 运行 `npm run dev:api`，默认代理地址为 `http://127.0.0.1:8787`。没有密钥时服务状态为未启用，生成请求不会访问外部服务。
3. 在网页“数据与设置”填写代理地址、访问口令，保存后检查连接，再上传并生成。
4. 发布到 GitHub Pages 后，需另外部署 `worker/` 中的代理，并配置允许的站点、服务商密钥和访问口令；静态 Pages 无法运行后端。只有用户确定账号与服务后才部署。

开发者手动实测可运行 `node scripts/flatlay-live.mjs`，默认读取 `artifacts/upload-fixtures/garment-photo.jpg`，或用 `LIVE_GARMENT_PHOTO` 指定 JPG 原图。首次运行会调用付费图像编辑 API，产物和临时下载响应仅写入被 Git 忽略的 `artifacts/flatlay-live/`；有缓存时只重试下载，`--new-generation` 才重新生成。不要公开临时响应中的签名链接。`node scripts/flatlay-live-reuse.mjs --model qwen-image-edit-plus` 复用已经生成的真实图片检查浏览器透明处理和确认入库，不再次调用服务商。它们均不进入普通测试或发布 CI。

AI 资源出处、版本、许可证与校验信息见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。已包含可直接部署的模型与 WASM；通常无需再次下载。需要更新资源时先安装固定版本依赖，再运行 `node scripts/vendor-ai.mjs`。

## 在电脑上运行

安装 Node.js 22 或以上版本，打开项目目录：

```sh
npm install
npm run dev
```

打开 <http://127.0.0.1:4173/>。也可用 <http://127.0.0.1:4173/wardrobe/> 验证 GitHub Pages 的子目录访问。

```sh
npm test
npm run build
npm run preview
```

启动预览后，可运行 `npm run test:browser` 检查平铺接口、确认门槛、拖拽、多图入库、失败重试、搭配和手机交互；它使用明确的模拟 API，不访问真实服务，也不验证生成质量。`npm run test:storage` 检查存储并发保护。浏览器测试使用独立会话，需要本机 Chrome。

`npm run build` 将应用复制到 `dist/`。安装包、参考文件、测试和开发依赖不会进入网页发布包。项目使用相对资源路径，既可以放在用户主页根目录，也可以放在 `/仓库名/` 子目录。

预览服务可以指定目录、端口和 Pages 路径：

```sh
npm run preview -- --port 4174 --base-path my-wardrobe
```

## 发布到 GitHub Pages

1. 将本项目放入自己的 GitHub 仓库，提交 `package-lock.json`、源代码和 `.github/workflows/pages.yml`。不要提交 `node_modules/`、APK 或个人衣柜备份。
2. 在仓库的 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。
3. 推送到 `main` 或 `master`，或者到 **Actions** 页面手动运行 **Deploy wardrobe to GitHub Pages**。
4. 工作流成功后，在 **Settings → Pages** 或部署记录中打开发布网址。项目仓库通常是 `https://用户名.github.io/仓库名/`；`用户名.github.io` 仓库通常使用根网址。

工作流先测试、打包，再发布 `dist/`，使用 GitHub 自带的 `GITHUB_TOKEN`，不需要在应用里配置 GitHub 令牌。

若已有 GitHub 主页，可把 `dist/` 内的文件放入主页仓库的某个子目录，再沿用原来的发布流程。现有主页仓库的根页面和工作流应根据其结构合并。

部署说明依据：[GitHub Pages 自定义工作流](https://docs.github.com/zh/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)、[选择发布来源](https://docs.github.com/zh/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)。

## 项目结构

```text
index.html                 页面入口
styles.css                 页面样式
src/                       浏览器应用模块
assets/                    静态图片和图标
scripts/serve.mjs          本地预览服务
scripts/package.mjs        静态发布包生成器
tests/                     自动化测试
.github/workflows/pages.yml GitHub Pages 发布流程
```

这是独立实现的网页应用，与 Lookie 官方没有关联。参考 APK 只用于了解功能，不会包含在发布包中。
