import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const base = process.env.SMOKE_URL || 'http://127.0.0.1:4173/wardrobe/';
const baseUrl = new URL(base);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
// All fixtures live in a disposable browser context, separate from user data.
const context = await browser.newContext();
const page = await context.newPage();
const pageErrors = [];
context.on('page', opened => opened.on('pageerror', error => pageErrors.push(error.message)));
page.on('pageerror', error => pageErrors.push(error.message));

async function check(name, run) {
  await run();
  console.log(`PASS ${name}`);
}

async function open(url) {
  const opened = await context.newPage();
  await opened.goto(url, { waitUntil: 'networkidle' });
  await opened.waitForSelector('#garment-results .garment-card');
  return opened;
}

try {
  await page.goto(baseUrl.href, { waitUntil: 'networkidle' });
  await page.waitForSelector('#garment-results .garment-card');

  await check('a committed save increments both persisted and caller revisions', async () => {
    const result = await page.evaluate(async () => {
      const data = await import('./src/data.js');
      const next = await data.loadState();
      const revisionBefore = next._revision ?? 0;
      next.settings.name = 'storage fixture: first';
      await data.saveState(next);
      return { revisionBefore, revisionAfter: next._revision, stored: await data.loadState() };
    });
    assert.equal(result.revisionAfter, result.revisionBefore + 1);
    assert.equal(result.stored._revision, result.revisionAfter);
    assert.equal(result.stored.settings.name, 'storage fixture: first');
  });

  await check('a stale save is rejected and cannot overwrite a newer wardrobe', async () => {
    const result = await page.evaluate(async () => {
      const data = await import('./src/data.js');
      const fresh = await data.loadState();
      const stale = structuredClone(fresh);
      const staleRevision = stale._revision;
      fresh.settings.name = 'storage fixture: newer';
      await data.saveState(fresh);
      stale.settings.name = 'storage fixture: stale';
      let failure;
      try { await data.saveState(stale); }
      catch (error) { failure = { code: error.code, message: error.message }; }
      return { failure, staleRevision, revisionAfterFailure: stale._revision, winningRevision: fresh._revision, stored: await data.loadState() };
    });
    assert.equal(result.failure?.code, 'CONFLICT');
    assert.equal(result.revisionAfterFailure, result.staleRevision);
    assert.equal(result.stored.settings.name, 'storage fixture: newer');
    assert.equal(result.stored._revision, result.winningRevision);
  });

  await check('simultaneous saves from two tabs allow one commit and reject one conflict', async () => {
    const second = await open(baseUrl.href);
    const snapshot = await page.evaluate(async () => (await import('./src/data.js')).loadState());
    const fixtures = [
      { ...snapshot, settings: { name: 'storage fixture: tab A' } },
      { ...snapshot, settings: { name: 'storage fixture: tab B' } },
    ];
    const results = await Promise.all([page, second].map((opened, index) => opened.evaluate(async next => {
      const data = await import('./src/data.js');
      try {
        await data.saveState(next);
        return { ok: true, revision: next._revision, name: next.settings.name };
      } catch (error) {
        return { ok: false, revision: next._revision, code: error.code, name: next.settings.name };
      }
    }, fixtures[index])));
    const winner = results.find(result => result.ok);
    const loser = results.find(result => !result.ok);
    assert.equal(results.filter(result => result.ok).length, 1);
    assert.equal(loser.code, 'CONFLICT');
    assert.equal(loser.revision, snapshot._revision);
    assert.equal(winner.revision, snapshot._revision + 1);
    const stored = await page.evaluate(async () => (await import('./src/data.js')).loadState());
    assert.equal(stored.settings.name, winner.name);
    assert.equal(stored._revision, winner.revision);
    await second.close();
  });

  await check('an actual IndexedDB clone error aborts saving without changing either revision', async () => {
    const result = await page.evaluate(async () => {
      const data = await import('./src/data.js');
      const before = await data.loadState();
      const next = structuredClone(before);
      next.settings.name = 'storage fixture: must not persist';
      next.uncloneable = () => {};
      let failure;
      try { await data.saveState(next); }
      catch (error) { failure = { name: error.name, message: error.message }; }
      return { failure, callerRevision: next._revision, before, after: await data.loadState() };
    });
    assert.equal(result.failure?.name, 'DataCloneError');
    assert.equal(result.callerRevision, result.before._revision);
    assert.deepEqual(result.after, result.before);
  });

  await check('legacy records without a revision can be saved once with revision 1', async () => {
    const result = await page.evaluate(async () => {
      const data = await import('./src/data.js');
      const legacy = await data.loadState();
      delete legacy._revision;
      const applicationPath = new URL('../', new URL('./src/data.js', location.href)).pathname;
      await new Promise((resolve, reject) => {
        const request = indexedDB.open(`closet-web:${encodeURIComponent(applicationPath)}`, 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction('state', 'readwrite');
          transaction.objectStore('state').put(legacy, 'current');
          transaction.oncomplete = () => { database.close(); resolve(); };
          transaction.onabort = () => { database.close(); reject(transaction.error); };
        };
      });
      legacy.settings.name = 'storage fixture: legacy migrated';
      await data.saveState(legacy);
      return { revision: legacy._revision, stored: await data.loadState() };
    });
    assert.equal(result.revision, 1);
    assert.equal(result.stored._revision, 1);
    assert.equal(result.stored.settings.name, 'storage fixture: legacy migrated');
  });

  await check('different project paths on the same origin use separate wardrobes', async () => {
    const root = await open(new URL('/', baseUrl).href);
    const result = await root.evaluate(async () => {
      const data = await import('./src/data.js');
      const rootState = await data.loadState();
      const initialName = rootState.settings.name;
      rootState.settings.name = 'storage fixture: origin root';
      await data.saveState(rootState);
      return { initialName, stored: await data.loadState() };
    });
    assert.equal(result.initialName, '我的衣橱');
    assert.equal(result.stored.settings.name, 'storage fixture: origin root');
    const project = await page.evaluate(async () => (await import('./src/data.js')).loadState());
    assert.equal(project.settings.name, 'storage fixture: legacy migrated');
    assert.equal(project._revision, 1);
    await root.close();
  });

  await check('directory and index.html URLs share the same project wardrobe', async () => {
    const explicitIndex = await open(new URL('index.html', baseUrl).href);
    const stored = await explicitIndex.evaluate(async () => (await import('./src/data.js')).loadState());
    assert.equal(stored.settings.name, 'storage fixture: legacy migrated');
    assert.equal(stored._revision, 1);
    await explicitIndex.close();
  });

  assert.deepEqual(pageErrors, []);
  console.log('PASS all browser storage checks completed without page errors');
} finally {
  await context.close();
  await browser.close();
}
