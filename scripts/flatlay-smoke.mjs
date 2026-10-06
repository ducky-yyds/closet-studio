// Mocked proxy integration checks only. This does not call an AI provider or
// verify model fidelity, removal of a wearer, or recovery of hidden fabric.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const base = process.env.SMOKE_URL || 'http://127.0.0.1:4173/wardrobe/';
const output = path.resolve('artifacts/flatlay');
const fixture = path.resolve(process.env.GARMENT_PHOTO || 'artifacts/upload-fixtures/garment-photo.jpg');
const proxyBase = 'https://closet-flatlay.test';
const proxyToken = 'mock-proxy-access-token';
// A provided photograph is used when available; a tiny synthetic PNG is enough
// for these mocked protocol/UI checks in a fresh checkout. Neither proves AI quality.
let photo;
try { photo=await readFile(fixture); }
catch { photo=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'); }
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, acceptDownloads: true });
const page = await context.newPage();
const checks = [], issues = [], posts = [], forbiddenRequests = [], localInferenceRequests = [];
let behavior = 'success', mockImage = '', releaseDelayed, topId, bottomId;
const action = (name, opened = page) => opened.locator(`[data-action="${name}"]`).filter({ visible: true }).first();
const navigate = (name, opened = page) => opened.locator(`a[href="#${name}"]`).filter({ visible: true }).first().click();
const rows = (opened = page) => opened.locator('.batch-row');
const field = (row, name) => row.locator(`[data-upload-field="${name}"]`);
const state = () => page.evaluate(async () => (await import('./src/data.js')).loadState());
const upload = name => ({ name, mimeType: 'image/jpeg', buffer: photo });
const targetInput = (opened = page) => opened.locator('#item-form [name="targetDescription"]');

async function check(name, run) {
  const started = performance.now();
  try {
    await run();
    checks.push({ name, passed: true, milliseconds: Math.round(performance.now() - started) });
    console.log(`PASS ${name}`);
  } catch (error) {
    checks.push({ name, passed: false, error: error.stack, milliseconds: Math.round(performance.now() - started) });
    throw error;
  }
}

async function installMock(openedContext) {
  await openedContext.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== new URL(base).origin && url.origin !== proxyBase) {
      forbiddenRequests.push({ url: request.url(), method: request.method() });
      await route.abort('blockedbyclient');
      return;
    }
    if (/\.(onnx|wasm)(\?|$)/.test(url.pathname)) localInferenceRequests.push(request.url());
    if (url.origin !== proxyBase) { await route.continue(); return; }
    const headers = {
      'Access-Control-Allow-Origin': new URL(base).origin,
      'Access-Control-Allow-Headers': 'Content-Type, X-Closet-Token',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Content-Type': 'application/json',
    };
    if (request.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers }); return; }
    if (url.pathname === '/api/health') {
      await route.fulfill({ status: 200, headers, body: JSON.stringify({ enabled: true, provider: 'mock', model: 'mock-fixture' }) });
      return;
    }
    if (url.pathname !== '/api/flatlay' || request.method() !== 'POST') {
      await route.fulfill({ status: 404, headers, body: JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Unknown mocked endpoint' } }) });
      return;
    }
    const record = { body: request.postDataJSON(), token: request.headers()['x-closet-token'], behavior };
    posts.push(record);
    if (behavior === 'delayed') await new Promise(resolve => { releaseDelayed = resolve; });
    if (behavior === 'failure') {
      await route.fulfill({ status: 502, headers, body: JSON.stringify({ error: { code: 'UPSTREAM_FAILED', message: '模拟图像服务失败，请重试。' } }) });
      return;
    }
    await route.fulfill({ status: 200, headers, body: JSON.stringify({ image: mockImage, kind: behavior === 'cutout' ? 'cutout' : 'flatlay', provider: 'mock', model: 'mock-fixture' }) }).catch(() => {});
  });
}

async function drop(selector, files, opened = page) {
  const transfer = await opened.evaluateHandle(files => {
    const dataTransfer = new DataTransfer();
    for (const file of files) {
      const bytes = Uint8Array.from(atob(file.base64), character => character.charCodeAt(0));
      dataTransfer.items.add(new File([bytes], file.name, { type: file.type, lastModified: 1234 }));
    }
    return { dataTransfer };
  }, files.map(file => ({ name: file.name, type: file.mimeType, base64: file.buffer.toString('base64') })));
  await opened.locator(selector).dispatchEvent('drop', transfer);
  await transfer.dispose();
}

async function openEditor(name, opened = page, drag = false) {
  await action('add-item', opened).click();
  await opened.locator('#item-form [name="name"]').fill(name);
  if (drag) await drop('[data-upload-drop="single"]', [upload(`${name}.jpg`)], opened);
  else await opened.locator('#item-photo').setInputFiles(upload(`${name}.jpg`));
  await opened.waitForFunction(() => document.querySelector('#item-form')?.dataset.photoBusy !== 'true'
    && document.querySelector('#photo-preview img')?.src.startsWith('data:image/'));
  return opened.locator('#item-form');
}

async function configure(opened = page) {
  await navigate('settings', opened);
  await opened.locator('#flatlay-settings-form [name="url"]').fill(proxyBase);
  await opened.locator('#flatlay-settings-form [name="token"]').fill(proxyToken);
  await opened.locator('#flatlay-settings-form button[type="submit"]').click();
  await navigate('wardrobe', opened);
}

async function idleSingle() {
  await page.waitForFunction(() => document.querySelector('#item-form')?.dataset.photoBusy !== 'true', null, { timeout: 15_000 });
}

async function prepared(opened = page) {
  await opened.waitForFunction(() => {
    const current = [...document.querySelectorAll('.batch-row')];
    return current.length > 0 && current.every(row => !['queued', 'reading', 'processing'].includes(row.dataset.status));
  }, null, { timeout: 15_000 });
}

async function noOverflow(opened = page) {
  const dimensions = await opened.evaluate(() => ({ visible: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  assert.ok(dimensions.scroll <= dimensions.visible, JSON.stringify(dimensions));
}

async function saveSingle(name) {
  await page.locator('#item-form button[type="submit"]').click();
  await page.waitForFunction(() => !document.querySelector('dialog'));
  return (await state()).items.find(item => item.name === name);
}

page.on('pageerror', error => issues.push(error.message));
await installMock(context);

try {
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.locator('#garment-results .garment-card').first().waitFor();
  mockImage = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 160;
    const drawing = canvas.getContext('2d');
    drawing.fillStyle = '#385e87'; drawing.fillRect(55, 35, 50, 95); drawing.fillRect(30, 40, 100, 35);
    drawing.clearRect(68, 34, 24, 12);
    return canvas.toDataURL('image/png');
  });
  await writeFile(path.join(output, 'mock-flatlay.png'), Buffer.from(mockImage.split(',')[1], 'base64'));

  await check('unconfigured upload keeps the original and makes no cloud or local model requests', async () => {
    const before = posts.length;
    await openEditor('未配置原图', page, true);
    assert.match(await page.locator('#photo-status').innerText(), /原图|选择|配置|平铺/);
    const button = action('ai-flatlay');
    if (!await button.isDisabled()) await button.click();
    await idleSingle();
    assert.equal(posts.length, before);
    assert.deepEqual(localInferenceRequests, []);
    assert.equal(await action('confirm-flatlay').count(), 0);
    await action('close-dialog').click();
  });

  await check('proxy settings remain outside exported wardrobe data', async () => {
    await configure();
    const stored = await state();
    assert.equal(JSON.stringify(stored).includes(proxyToken), false);
    const storage = await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } }));
    assert.equal(JSON.stringify(storage.local).includes(proxyToken), false, 'Proxy access token must stay in session storage');
    assert.equal(JSON.stringify(storage.session).includes(proxyToken), true);
    const exported = page.waitForEvent('download');
    await action('export-backup').click();
    const download = await exported;
    const filename = path.join(output, 'backup-without-credentials.json');
    await download.saveAs(filename);
    const contents = await readFile(filename, 'utf8');
    assert.equal(contents.includes(proxyToken), false);
    assert.equal(contents.includes(proxyBase), false);
  });

  await check('single generation sends the original, chosen category and target; confirmation gates recommendations', async () => {
    const count = (await state()).items.length, before = posts.length;
    await openEditor('确认后的真实上衣');
    await page.locator('#item-form [name="category"]').selectOption('上装');
    await targetInput().fill('照片中的白色短袖上衣');
    const original = await page.locator('#photo-preview img').getAttribute('src');
    assert.equal(posts.length, before);
    await action('ai-flatlay').click();
    await action('confirm-flatlay').waitFor();
    await idleSingle();
    assert.equal(posts.length, before + 1);
    assert.equal(posts.at(-1).body.image, original);
    assert.equal(posts.at(-1).body.category, '上装');
    assert.equal(posts.at(-1).body.targetDescription, '照片中的白色短袖上衣');
    assert.equal(posts.at(-1).token, proxyToken);
    assert.equal(await page.locator('#photo-preview img').getAttribute('src'), mockImage);
    assert.equal(await page.locator('#item-form button[type="submit"]').isDisabled(), true, 'Unconfirmed AI candidates cannot be saved');
    assert.equal((await state()).items.length, count, 'A pending candidate should not persist');
    const pendingEligible = await page.evaluate(async image => {
      const model = await import('./src/model.js');
      return model.isProcessedPhoto({ source: 'photo', image, cutoutStatus: 'done', imageKind: 'flatlay-pending' });
    }, mockImage);
    assert.equal(pendingEligible, false);
    await page.screenshot({ path: path.join(output, 'single-pending-mock.png'), fullPage: true });
    await action('confirm-flatlay').click();
    const item = await saveSingle('确认后的真实上衣');
    assert.equal(item.imageKind, 'flatlay'); assert.equal(item.imageSource, 'generated');
    assert.equal(item.originalImage, original); assert.equal(item.image, mockImage);
    assert.equal(await page.evaluate(async item => (await import('./src/model.js')).isProcessedPhoto(item), item), true);
    topId = item.id;
  });

  await check('a corrupt replacement upload keeps a pending candidate unsavable until it is confirmed', async () => {
    const before = posts.length, count = (await state()).items.length;
    await openEditor('损坏重传仍须确认');
    await page.locator('#item-form [name="category"]').selectOption('外套');
    const original = await page.locator('#photo-preview img').getAttribute('src');
    await action('ai-flatlay').click(); await action('confirm-flatlay').waitFor(); await idleSingle();
    assert.equal(await page.locator('#item-form button[type="submit"]').isDisabled(), true);
    await page.locator('#item-photo').setInputFiles({ name: '损坏替换.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('corrupt JPEG fixture') });
    await page.waitForFunction(() => document.querySelector('#item-form')?.dataset.photoBusy !== 'true'
      && /无法读取|损坏/.test(document.querySelector('#photo-status')?.textContent || ''));
    assert.equal(await page.locator('#item-form button[type="submit"]').isDisabled(), true, 'Reading failure must not bypass review');
    assert.equal(await page.locator('#photo-preview img').getAttribute('src'), mockImage);
    assert.equal(posts.length, before + 1); assert.equal((await state()).items.length, count);
    assert.equal(await action('confirm-flatlay').isVisible(), true);
    await action('confirm-flatlay').click();
    assert.equal(await page.locator('#item-form button[type="submit"]').isDisabled(), false);
    const item = await saveSingle('损坏重传仍须确认');
    assert.equal(item.imageKind, 'flatlay'); assert.equal(item.image, mockImage); assert.equal(item.originalImage, original);
  });

  await check('a failed proxy call retains the original and never substitutes a local cutout', async () => {
    const before = posts.length;
    behavior = 'failure';
    await openEditor('失败保留原图');
    const original = await page.locator('#photo-preview img').getAttribute('src');
    await action('ai-flatlay').click();
    await page.waitForFunction(() => /失败|重试/.test(document.querySelector('#photo-status')?.textContent || ''));
    await idleSingle();
    assert.equal(posts.length, before + 1, 'Failed generation must require an explicit retry');
    assert.equal(await page.locator('#photo-preview img').getAttribute('src'), original);
    assert.equal(await action('confirm-flatlay').count(), 0);
    assert.deepEqual(localInferenceRequests, []);
    await action('close-dialog').click(); behavior = 'success';
  });

  await check('a proxy response labelled cutout is rejected instead of being accepted as flat lay', async () => {
    behavior = 'cutout';
    await openEditor('错误类型拒绝');
    const original = await page.locator('#photo-preview img').getAttribute('src');
    await action('ai-flatlay').click();
    await page.waitForFunction(() => /失败|平铺|结果/.test(document.querySelector('#photo-status')?.textContent || '')
      && document.querySelector('#item-form')?.dataset.photoBusy !== 'true');
    assert.equal(await page.locator('#photo-preview img').getAttribute('src'), original);
    assert.equal(await action('confirm-flatlay').count(), 0);
    await action('close-dialog').click(); behavior = 'success';
  });

  await check('changing a single candidate category invalidates the previous confirmation', async () => {
    await openEditor('分类变更失效');
    await action('ai-flatlay').click(); await action('confirm-flatlay').waitFor();
    await action('confirm-flatlay').click();
    await page.locator('#item-form [name="category"]').selectOption('外套');
    const item = await saveSingle('分类变更失效');
    assert.notEqual(item.imageKind, 'flatlay');
    assert.equal(await page.evaluate(async item => (await import('./src/model.js')).isProcessedPhoto(item), item), false);
  });

  await check('batch uploads prepare without calling AI; only selected rows generate and await review', async () => {
    const before = posts.length;
    await action('batch-open').click();
    await drop('[data-upload-drop="batch"]', [upload('批量下装.jpg'), upload('未选择外套.jpg')]);
    await prepared();
    assert.equal(await page.locator('.batch-row[data-status="prepared"]').count(), 2);
    assert.equal(posts.length, before);
    const firstId = await rows().nth(0).getAttribute('data-id'), secondId = await rows().nth(1).getAttribute('data-id');
    const first = page.locator(`.batch-row[data-id="${firstId}"]`), second = page.locator(`.batch-row[data-id="${secondId}"]`);
    await field(first, 'category').selectOption('下装'); await field(first, 'name').fill('确认后的真实下装');
    await field(second, 'selected').uncheck();
    const original = await first.locator('.batch-thumbnail img').getAttribute('src');
    await action('batch-generate').click();
    await page.locator(`.batch-row[data-id="${firstId}"][data-status="review"]`).waitFor();
    assert.equal(posts.length, before + 1);
    assert.equal(posts.at(-1).body.category, '下装'); assert.equal(posts.at(-1).body.image, original);
    assert.equal(await second.getAttribute('data-status'), 'prepared');
    assert.equal(await action('batch-save').isDisabled(), true);
    await first.locator('[data-action="batch-row-confirm"]').click();
    assert.equal(await first.getAttribute('data-status'), 'ready');
    await action('batch-save').click();
    await page.waitForFunction(() => !document.querySelector('.batch-row[data-status="ready"]'));
    const item = (await state()).items.find(item => item.name === '确认后的真实下装');
    assert.equal(item.imageKind, 'flatlay'); assert.equal(item.image, mockImage); assert.equal(item.originalImage, original);
    assert.equal((await state()).items.some(item => item.name === '未选择外套'), false);
    bottomId = item.id;
    await action('close-dialog').click();
  });

  await check('batch title edits preserve results; changing the category or target invalidates them', async () => {
    await action('batch-open').click();
    await page.locator('#batch-files').setInputFiles([upload('批量变更.jpg')]); await prepared();
    const id = await rows().first().getAttribute('data-id'), row = page.locator(`.batch-row[data-id="${id}"]`);
    await action('batch-generate').click(); await page.locator(`.batch-row[data-id="${id}"][data-status="review"]`).waitFor();
    await row.locator('[data-action="batch-row-confirm"]').click();
    await field(row, 'name').fill('变更后重新生成');
    assert.equal(await row.getAttribute('data-status'), 'ready', 'The wardrobe title is not part of the AI request');
    const before = posts.length;
    await field(row, 'category').selectOption('外套');
    assert.equal(await row.getAttribute('data-status'), 'prepared');
    assert.equal(await action('batch-save').isDisabled(), true);
    assert.equal(posts.length, before, 'A metadata change must not trigger a paid call');
    await action('batch-generate').click(); await page.locator(`.batch-row[data-id="${id}"][data-status="review"]`).waitFor();
    assert.equal(posts.at(-1).body.category, '外套');
    await field(row, 'targetDescription').fill('只要蓝色外套，移除里面的白衬衫');
    assert.equal(await row.getAttribute('data-status'), 'prepared');
    assert.equal(await action('batch-save').isDisabled(), true);
    assert.equal(posts.length, before + 1, 'Changing the target must await an explicit generation request');
    await action('close-dialog').click();
  });

  await check('failed batch rows have bounded attempts and preserve metadata on explicit retry', async () => {
    behavior = 'failure';
    await action('batch-open').click(); await page.locator('#batch-files').setInputFiles([upload('失败批量.jpg')]); await prepared();
    const id = await rows().first().getAttribute('data-id'), row = page.locator(`.batch-row[data-id="${id}"]`);
    await field(row, 'name').fill('重试保留元信息'); await field(row, 'category').selectOption('下装');
    const before = posts.length;
    await action('batch-generate').click(); await page.locator(`.batch-row[data-id="${id}"][data-status="error"]`).waitFor();
    assert.equal(posts.length, before + 1);
    assert.equal(await action('batch-save').isDisabled(), true);
    behavior = 'success'; await row.locator('[data-action="batch-row-retry"]').click();
    await page.locator(`.batch-row[data-id="${id}"][data-status="review"]`).waitFor();
    assert.equal(posts.length, before + 2); assert.equal(posts.at(-1).body.category, '下装');
    assert.equal(await field(row, 'name').inputValue(), '重试保留元信息');
    await action('close-dialog').click();
  });

  await check('closing an in-flight single or batch aborts and cannot overwrite a new editor', async () => {
    const before = await state();
    for (const mode of ['single', 'batch']) {
      behavior = 'delayed'; releaseDelayed = undefined;
      if (mode === 'single') { await openEditor('取消单件'); await action('ai-flatlay').click(); }
      else { await action('batch-open').click(); await page.locator('#batch-files').setInputFiles([upload('取消批量.jpg')]); await prepared(); await action('batch-generate').click(); }
      await page.waitForFunction(() => document.querySelector('#item-form')?.dataset.photoBusy === 'true'
        || !!document.querySelector('.batch-row[data-status="processing"]'));
      assert.equal(typeof releaseDelayed, 'function');
      await action('close-dialog').click();
      await action('add-item').click(); await page.locator('#item-form [name="name"]').fill(`新的${mode}编辑器`);
      releaseDelayed(); behavior = 'success';
      await page.waitForTimeout(100);
      assert.equal(await page.locator('#item-form [name="name"]').inputValue(), `新的${mode}编辑器`);
      assert.equal(await action('confirm-flatlay').count(), 0);
      await action('close-dialog').click();
    }
    assert.deepEqual(await state(), before);
  });

  await check('automatic outfit suggestions contain only confirmed flat lay wardrobe images', async () => {
    await action('start-suggestion').click();
    await page.locator('#suggestion-form button[type="submit"]').click();
    await page.waitForFunction(() => !document.querySelector('dialog'));
    const stored = await state();
    const names = await page.locator('.canvas-element img').evaluateAll(images => images.map(image => image.alt));
    const used = names.map(name => stored.items.find(item => item.name === name)?.id);
    assert.ok(used.includes(topId), 'Confirmed top was not used'); assert.ok(used.includes(bottomId), 'Confirmed bottom was not used');
    assert.ok(used.every(id => stored.items.find(item => item.id === id)?.imageKind === 'flatlay'));
    await page.screenshot({ path: path.join(output, 'confirmed-outfit-mock.png'), fullPage: true });
    await navigate('wardrobe');
  });

  await check('mobile upload, review and settings fit the 390px screen without horizontal overflow', async () => {
    const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await installMock(mobileContext);
    try {
      const mobile = await mobileContext.newPage(); mobile.on('pageerror', error => issues.push(`mobile: ${error.message}`));
      await mobile.goto(base, { waitUntil: 'networkidle' }); await configure(mobile);
      await action('batch-open', mobile).click();
      await mobile.locator('#batch-files').setInputFiles([upload('手机上衣.jpg'), upload('手机下装.jpg')]); await prepared(mobile);
      await noOverflow(mobile);
      assert.equal(await mobile.locator('.batch-row').evaluateAll(current => current.some(row => row.scrollWidth > row.clientWidth)), false);
      await action('batch-generate', mobile).click();
      await mobile.waitForFunction(() => document.querySelectorAll('.batch-row[data-status="review"]').length === 2);
      await noOverflow(mobile); await mobile.screenshot({ path: path.join(output, 'mobile-review-mock.png'), fullPage: true });
      await action('close-dialog', mobile).click(); await openEditor('手机单件', mobile); await noOverflow(mobile);
      await mobile.screenshot({ path: path.join(output, 'mobile-single-mock.png'), fullPage: true });
    } finally { await mobileContext.close(); }
  });

  await check('no uncaught page exceptions, provider network calls or silent local inference', async () => {
    assert.deepEqual(issues, []); assert.deepEqual(forbiddenRequests, []); assert.deepEqual(localInferenceRequests, []);
  });
} catch (error) {
  console.error(error.stack); await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {}); process.exitCode = 1;
} finally {
  releaseDelayed?.();
  const report = {
    verification: 'MOCK_PROXY_UI_ONLY',
    limitation: 'No external AI API was called. These checks verify upload, request shape, error handling, review gating, storage and layout only. They do not verify wearer removal, garment fidelity or flat lay generation quality.',
    base, fixture, checks, issues, forbiddenRequests, localInferenceRequests,
    requests: posts.map(({ body, token, behavior }) => ({ category: body.category, targetDescription: body.targetDescription, originalDataUrlProvided: /^data:image\//.test(body.image), accessTokenPresent: Boolean(token), behavior })),
  };
  await writeFile(path.join(output, 'results.json'), JSON.stringify(report, null, 2));
  await context.close(); await browser.close();
  console.log(`Mock-only flat lay results: ${path.join(output, 'results.json')}`);
}
