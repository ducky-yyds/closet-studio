import test from 'node:test';
import assert from 'node:assert/strict';
import { seedState, loadState, saveState } from '../src/data.js';
import {
  escapeHtml, validateBackup, addDiary, removeDiary, deleteItem,
  suggestOutfit, layoutOutfit, statsFor, isRealPhoto, isProcessedPhoto, isCutoutPhoto, isFlatlayPhoto, outfitSuggestionStatus,
} from '../src/model.js';

const copy = value => structuredClone(value);
const emptyState = () => ({ version: 1, items: [], outfits: [], diary: [], settings: { name: '测试衣橱' } });
const garment = (id, properties = {}) => ({ ...seedState().items[0], id, ...properties });
const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRfoAAAAASUVORK5CYII=';
const photo = (id, properties = {}) => garment(id, { image: tinyPng, source: 'photo', cutoutStatus: 'done', imageKind: 'flatlay', imageSource: 'generated', ...properties });
const entry = (itemIds, properties = {}) => ({ id: 'diary-1', date: '2026-10-06', name: '今日穿搭', notes: '', itemIds, ...properties });
const outfit = (items, properties = {}) => ({ id: 'outfit-1', name: '周末搭配', background: '#f3f0e9', elements: layoutOutfit(items), ...properties });

function linkedState() {
  const state = emptyState();
  state.items = [garment('shirt', { wearCount: 3 }), garment('trousers', { category: '下装', wearCount: 7 })];
  state.outfits = [outfit(state.items), outfit([state.items[0]], { id: 'outfit-only-shirt' })];
  state.diary = [entry(['shirt', 'trousers']), entry(['shirt'], { id: 'diary-only-shirt' })];
  return state;
}

test('an empty wardrobe backup remains empty and keeps its name', () => {
  const state = emptyState();
  assert.deepEqual(validateBackup(state), state);
});

test('all 12 sample garments survive a JSON export and import', () => {
  const state = seedState();
  assert.equal(state.items.length, 12);
  assert.deepEqual(validateBackup(JSON.parse(JSON.stringify(state))), state);
});

test('outfit positions and linked diary records survive backup validation', () => {
  const state = linkedState();
  assert.deepEqual(validateBackup(copy(state)), state);
});

test('missing or empty wardrobe names receive a usable default', () => {
  for (const settings of [undefined, null, {}, { name: '' }, { name: '   ' }, { name: 12 }]) {
    const restored = validateBackup({ ...emptyState(), settings });
    assert.equal(restored.settings.name, '我的衣橱');
  }
});

test('invalid backup versions and missing collections are rejected', () => {
  for (const data of [null, [], {}, { ...emptyState(), version: 2 }, { ...emptyState(), items: {} }, { ...emptyState(), outfits: null }, { ...emptyState(), diary: undefined }]) {
    assert.throws(() => validateBackup(data));
  }
});

test('duplicate item, outfit and diary identifiers are rejected', () => {
  for (const collection of ['items', 'outfits', 'diary']) {
    const state = linkedState();
    state[collection].push(copy(state[collection][0]));
    assert.throws(() => validateBackup(state));
  }
});

test('missing identifiers and malformed records are rejected', () => {
  for (const invalid of [null, 42, {}, { ...garment('x'), id: '' }, { ...garment('x'), id: 'x'.repeat(101) }]) {
    assert.throws(() => validateBackup({ ...emptyState(), items: [invalid] }));
  }
});

test('null records and outfit elements yield a readable backup validation error', () => {
  for (const collection of ['items', 'outfits', 'diary']) {
    const state = linkedState();
    state[collection] = [null];
    assert.throws(() => validateBackup(state), /备份/);
  }
  const state = linkedState();
  state.outfits[0].elements = [null];
  assert.throws(() => validateBackup(state), /备份/);
});

test('unsupported image URLs and executable image formats are rejected', () => {
  const unsafeImages = [
    'https://example.com/garment.png',
    '//example.com/garment.png',
    'javascript:alert(1)',
    'data:text/html;base64,PHNjcmlwdD4=',
    'data:image/svg+xml;base64,PHN2Zz4=',
    './assets/garments/../../outside.svg',
    './assets/garments/%2e%2e/%2e%2e/outside.svg',
    './assets/garments/%252e%252e/outside.svg',
    './assets/garments/ivory-knit.svg?outside=1',
    'data:image/png;base64,invalid!base64',
  ];
  for (const image of unsafeImages) {
    assert.throws(() => validateBackup({ ...emptyState(), items: [garment('image-test', { image })] }), image);
  }
});

test('empty outfit and diary records are rejected while an empty wardrobe is valid', () => {
  const emptyOutfit = linkedState();
  emptyOutfit.outfits[0].elements = [];
  assert.throws(() => validateBackup(emptyOutfit));
  const emptyDiary = linkedState();
  emptyDiary.diary[0].itemIds = [];
  assert.throws(() => validateBackup(emptyDiary));
  assert.doesNotThrow(() => validateBackup(emptyState()));
});

test('uploaded raster data images remain importable', () => {
  const state = { ...emptyState(), items: [garment('uploaded', { image: tinyPng })] };
  assert.equal(validateBackup(state).items[0].image, tinyPng);
});

test('legacy backups retain all clothes and infer uploaded photos without new metadata', () => {
  const legacySample = garment('old-sample');
  delete legacySample.source;
  const legacyUpload = garment('old-photo', { image: tinyPng });
  delete legacyUpload.source;
  const state = { ...emptyState(), items: [legacySample, legacyUpload] };
  const restored = validateBackup(copy(state));
  assert.deepEqual(restored, state);
  assert.equal(isRealPhoto(restored.items[0]), false);
  assert.equal(isRealPhoto(restored.items[1]), true);
  assert.equal(isProcessedPhoto(restored.items[1]), false);
  assert.equal(outfitSuggestionStatus(restored.items).code, 'not_processed');
});

test('original images and flatlay metadata survive export, import and restoring the original', () => {
  const originalImage = 'data:image/jpeg;base64,/9j/2Q==';
  const state = { ...emptyState(), items: [photo('flatlay', { originalImage, imageProvider: 'custom', imageModel: 'garment-image-editor', processedAt: '2026-10-06T00:00:00Z' })] };
  const restored = validateBackup(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(restored, state);
  assert.equal(isProcessedPhoto(restored.items[0]), true);
  restored.items[0].image = restored.items[0].originalImage;
  restored.items[0].cutoutStatus = 'original';
  restored.items[0].imageKind = 'original';
  restored.items[0].imageSource = 'local';
  assert.doesNotThrow(() => validateBackup(restored));
  assert.equal(restored.items[0].image, originalImage);
  assert.equal(isRealPhoto(restored.items[0]), true);
  assert.equal(isProcessedPhoto(restored.items[0]), false);
});

test('older successful background cutouts survive backups without becoming flatlay clothes', () => {
  const oldTop = photo('old-person-top', { seasons: [] });
  delete oldTop.imageKind;
  delete oldTop.imageSource;
  const cutoutBottom = photo('person-bottom', { imageKind: 'cutout', imageSource: 'local', category: '下装', seasons: [] });
  const state = { ...emptyState(), items: [oldTop, cutoutBottom] };
  const restored = validateBackup(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(restored, state);
  assert.ok(restored.items.every(isRealPhoto));
  assert.ok(restored.items.every(isCutoutPhoto));
  assert.ok(restored.items.every(item => !isFlatlayPhoto(item) && !isProcessedPhoto(item)));
  assert.deepEqual(suggestOutfit(restored.items), []);
  assert.deepEqual(suggestOutfit(restored.items, { photoMode: 'photos' }, () => 0).map(item => item.id), ['old-person-top', 'person-bottom']);
  assert.match(outfitSuggestionStatus(restored.items).message, /生成平铺图/);
});

test('a generated image is ready for flatlay outfits only when its returned kind is flatlay and processing completed', () => {
  const generatedCutout = photo('generated-person', { imageKind: 'cutout' });
  const unfinishedFlatlay = photo('unfinished-flatlay', { cutoutStatus: 'original' });
  const flatlay = photo('flatlay');
  assert.equal(isCutoutPhoto(generatedCutout), true);
  assert.equal(isFlatlayPhoto(generatedCutout), false);
  assert.equal(isFlatlayPhoto(unfinishedFlatlay), false);
  assert.equal(isFlatlayPhoto(flatlay), true);
  assert.equal(isCutoutPhoto(flatlay), false);
  for (const image of ['./assets/garments/ivory-knit.svg', 'https://example.com/garment.png']) {
    assert.equal(isFlatlayPhoto({ ...flatlay, image }), false);
  }
  assert.equal(isFlatlayPhoto({ ...flatlay, source: 'demo' }), false);
});

test('invalid flatlay image types, sources and unbounded processing metadata are rejected', () => {
  for (const properties of [
    { imageKind: 'segmented' }, { imageKind: null }, { imageSource: 'api' }, { imageSource: null },
    { imageProvider: 'x'.repeat(121) }, { imageProvider: {} }, { imageModel: 'x'.repeat(161) }, { imageModel: 123 },
    { processedAt: 'not-a-date' }, { processedAt: null }, { processedAt: 'x'.repeat(61) },
  ]) {
    assert.throws(() => validateBackup({ ...emptyState(), items: [photo('invalid-flatlay', properties)] }));
  }
  assert.throws(() => validateBackup({ ...emptyState(), items: [garment('demo-flatlay', { imageKind: 'flatlay' })] }));
});

test('invalid photo sources, cutout states and unsafe original images are rejected', () => {
  for (const properties of [
    { source: 'api' }, { source: null }, { source: 'photo', image: './assets/garments/ivory-knit.svg' },
    { cutoutStatus: 'processing' }, { cutoutStatus: null }, { source: 'demo' },
    { originalImage: null }, { originalImage: 'https://api.example.com/result.png' },
    { originalImage: 'blob:https://example.com/image' }, { originalImage: 'data:image/svg+xml;base64,PHN2Zz4=' },
    { originalImage: './assets/garments/ivory-knit.svg' }, { originalImage: 'data:image/png;base64,invalid!base64' },
  ]) {
    assert.throws(() => validateBackup({ ...emptyState(), items: [photo('bad-photo', properties)] }));
  }
});

test('unsafe color values and unsupported garment categories or seasons are rejected', () => {
  for (const properties of [
    { color: '#ffffff;position:fixed' }, { color: 'red' },
    { category: '全部' }, { category: '<script>' },
    { seasons: ['雨季'] }, { seasons: '秋' }, { favorite: 'true' },
    { name: '' }, { name: '   ' }, { name: 'x'.repeat(81) }, { notes: 'x'.repeat(2001) },
    { createdAt: 'not-a-date' },
  ]) {
    assert.throws(() => validateBackup({ ...emptyState(), items: [garment('invalid-item', properties)] }));
  }
});

test('prices and wear counts must be finite, nonnegative and within their limits', () => {
  for (const properties of [
    { price: -1 }, { price: Infinity }, { price: NaN }, { price: 10_000_001 }, { price: '99' },
    { wearCount: -1 }, { wearCount: 1.5 }, { wearCount: Infinity }, { wearCount: 1_000_001 }, { wearCount: '1' },
  ]) {
    assert.throws(() => validateBackup({ ...emptyState(), items: [garment('numeric-item', properties)] }));
  }
  assert.doesNotThrow(() => validateBackup({ ...emptyState(), items: [garment('zero-item', { price: 0, wearCount: 0 })] }));
});

test('oversized record collections are rejected before import', () => {
  for (const [collection, size] of [['items', 3001], ['outfits', 3001], ['diary', 20001]]) {
    assert.throws(() => validateBackup({ ...emptyState(), [collection]: Array(size).fill({}) }));
  }
});

test('the supported 20,000 diary records validate and a duplicate near the end is found', () => {
  const state = { ...emptyState(), items: [garment('shirt')] };
  state.diary = Array.from({ length: 20_000 }, (_, index) => entry(['shirt'], { id: `entry-${index}` }));
  assert.equal(validateBackup(state).diary.length, 20_000);
  state.diary.at(-1).id = state.diary[0].id;
  assert.throws(() => validateBackup(state), /重复/);
});

test('outfit elements must reference existing garments and valid canvas geometry', () => {
  const valid = linkedState();
  for (const properties of [
    { itemId: 'missing' }, { x: -1 }, { x: 641 }, { y: 701 },
    { width: 49 }, { width: 601 }, { rotation: 181 }, { rotation: Infinity }, { z: 10001 },
  ]) {
    const state = copy(valid);
    Object.assign(state.outfits[0].elements[0], properties);
    assert.throws(() => validateBackup(state));
  }
  const badColor = copy(valid);
  badColor.outfits[0].background = 'url(javascript:alert(1))';
  assert.throws(() => validateBackup(badColor));
});

test('diary backup dates obey the real calendar, including leap years', () => {
  for (const date of ['2026-02-29', '2026-04-31', '2026-13-01', '2026-00-01', '2026-10-00', '06/10/2026']) {
    const state = linkedState();
    state.diary[0].date = date;
    assert.throws(() => validateBackup(state), date);
  }
  const state = linkedState();
  state.diary[0].date = '2024-02-29';
  assert.doesNotThrow(() => validateBackup(state));
});

test('diary backups reject duplicate or missing garment references', () => {
  for (const itemIds of [['shirt', 'shirt'], ['missing'], ['shirt', 'missing']]) {
    const state = linkedState();
    state.diary[0].itemIds = itemIds;
    assert.throws(() => validateBackup(state));
  }
});

test('HTML in imported text is escaped for attribute and text rendering', () => {
  const payload = '<img src=x onerror="alert(1)"> & \'text\'';
  const result = escapeHtml(payload);
  assert.equal(result, '&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;text&#39;');
});

test('adding a diary entry increments each selected garment once without mutating the input', () => {
  const state = linkedState();
  const before = copy(state);
  const next = addDiary(state, entry(['shirt', 'trousers'], { id: 'new-entry' }));
  assert.deepEqual(next.items.map(item => item.wearCount), [4, 8]);
  assert.equal(next.diary.length, 3);
  assert.deepEqual(state, before);
});

test('duplicate diary garment IDs are deduplicated and unknown IDs are ignored', () => {
  const state = linkedState();
  const incoming = entry(['shirt', 'shirt', 'missing', 'trousers', 'trousers'], { id: 'deduplicated' });
  const before = copy(incoming);
  const next = addDiary(state, incoming);
  assert.deepEqual(next.diary.at(-1).itemIds, ['shirt', 'trousers']);
  assert.deepEqual(next.items.map(item => item.wearCount), [4, 8]);
  assert.deepEqual(incoming, before);
});

test('adding diary entries with no surviving garments or impossible dates fails', () => {
  const state = linkedState();
  for (const invalid of [entry([]), entry(['missing']), entry(['shirt'], { date: '2026-02-30' })]) {
    assert.throws(() => addDiary(state, invalid));
  }
  assert.equal(state.diary.length, 2);
});

test('multiple outfits recorded on one date count as separate wears', () => {
  const state = { ...emptyState(), items: [garment('shirt', { wearCount: 0 })] };
  const first = addDiary(state, entry(['shirt'], { id: 'morning' }));
  const second = addDiary(first, entry(['shirt'], { id: 'evening' }));
  assert.equal(second.items[0].wearCount, 2);
  assert.equal(second.diary.length, 2);
  assert.equal(new Set(second.diary.map(record => record.date)).size, 1);
});

test('removing a diary entry reverses its counted wears and leaves other records intact', () => {
  const state = linkedState();
  const before = copy(state);
  const withEntry = addDiary(state, entry(['shirt', 'trousers'], { id: 'new-entry' }));
  assert.deepEqual(removeDiary(withEntry, 'new-entry'), before);
  assert.deepEqual(state, before);
});

test('removing unknown diary IDs is harmless and wear counts cannot become negative', () => {
  const state = linkedState();
  assert.deepEqual(removeDiary(state, 'absent'), state);
  state.items.forEach(item => { item.wearCount = 0; });
  const next = removeDiary(state, 'diary-1');
  assert.deepEqual(next.items.map(item => item.wearCount), [0, 0]);
});

test('deleting a garment removes its outfit and diary references and drops empty records', () => {
  const state = linkedState();
  const before = copy(state);
  const next = deleteItem(state, 'shirt');
  assert.deepEqual(next.items.map(item => item.id), ['trousers']);
  assert.equal(next.items[0].wearCount, 7);
  assert.deepEqual(next.outfits.map(record => record.id), ['outfit-1']);
  assert.deepEqual(next.outfits[0].elements.map(element => element.itemId), ['trousers']);
  assert.deepEqual(next.diary.map(record => record.id), ['diary-1']);
  assert.deepEqual(next.diary[0].itemIds, ['trousers']);
  assert.deepEqual(state, before);
  assert.doesNotThrow(() => validateBackup(next));
});

test('deleting the final garment leaves a valid empty backup', () => {
  const state = linkedState();
  const next = deleteItem(deleteItem(state, 'shirt'), 'trousers');
  assert.equal(next.items.length, 0);
  assert.equal(next.outfits.length, 0);
  assert.equal(next.diary.length, 0);
  assert.doesNotThrow(() => validateBackup(next));
});

test('seasonal suggestions include only compatible or all-season garments', () => {
  const items = [
    photo('summer-top', { category: '上装', seasons: ['夏'] }),
    photo('winter-top', { category: '上装', seasons: ['冬'] }),
    photo('all-bottom', { category: '下装', seasons: [] }),
    photo('summer-coat', { category: '外套', seasons: ['夏'] }),
    photo('winter-coat', { category: '外套', seasons: ['冬'] }),
    photo('all-shoes', { category: '鞋履', seasons: [] }),
  ];
  assert.deepEqual(suggestOutfit(items, { season: '夏' }, () => 0).map(item => item.id), ['summer-top', 'all-bottom', 'all-shoes']);
  assert.deepEqual(suggestOutfit(items, { season: '冬' }, () => 0).map(item => item.id), ['winter-top', 'all-bottom', 'winter-coat', 'all-shoes']);
});

test('recommendations prefer the selected style and less-worn garments on equal random scores', () => {
  const items = [
    photo('wrong-style', { style: '休闲', wearCount: 0, seasons: [] }),
    photo('matching-worn', { style: '通勤', wearCount: 30, seasons: [] }),
    photo('matching-new', { style: '通勤', wearCount: 0, seasons: [] }),
    photo('bottom', { category: '下装', style: '通勤', seasons: [] }),
  ];
  const picked = suggestOutfit(items, { season: '秋', style: '通勤' }, () => 0);
  assert.equal(picked[0].id, 'matching-new');
  assert.equal(picked[1].id, 'bottom');
});

test('a dress is a complete base when no top and bottom pair exists', () => {
  const dress = photo('dress', { category: '连衣裙', seasons: ['夏'] });
  assert.deepEqual(suggestOutfit([dress], { season: '夏' }, () => 0).map(item => item.id), ['dress']);
  assert.deepEqual(suggestOutfit([], { season: '夏' }, () => 0), []);
  assert.deepEqual(suggestOutfit([photo('shoe', { category: '鞋履', seasons: [] })], {}, () => 0), []);
});

test('automatic suggestions keep actual flatlay garment images and exclude cutouts with wearers and demonstration art', () => {
  const processedTop = photo('real-top', { seasons: [] });
  const processedBottom = photo('real-bottom', { category: '下装', seasons: [] });
  const originalDress = photo('original-dress', { category: '连衣裙', cutoutStatus: 'original', seasons: [], wearCount: 0 });
  const wearerDress = photo('wearer-dress', { category: '连衣裙', imageKind: 'cutout', seasons: [], wearCount: 0 });
  const oldWearerCoat = photo('old-wearer-coat', { category: '外套', imageKind: undefined, seasons: [], wearCount: 0 });
  const items = [...seedState().items, processedTop, processedBottom, originalDress, wearerDress, oldWearerCoat];
  const before = copy(items);
  const picked = suggestOutfit(items, {}, () => 0);
  assert.deepEqual(picked.map(item => item.id), ['real-top', 'real-bottom']);
  assert.ok(picked.every(isProcessedPhoto));
  assert.strictEqual(picked[0], processedTop);
  assert.strictEqual(picked[1], processedBottom);
  assert.equal(picked[0].image, processedTop.image);
  assert.equal(picked[1].image, processedBottom.image);
  assert.deepEqual(items, before);
  assert.deepEqual(suggestOutfit(seedState().items), []);
  assert.deepEqual(suggestOutfit(seedState().items, { photoMode: 'photos' }), []);
});

test('unprocessed and legacy photos remain available in explicit photos mode', () => {
  const oldTop = photo('old-top', { seasons: [] });
  delete oldTop.source;
  delete oldTop.cutoutStatus;
  const originalBottom = photo('original-bottom', { category: '下装', seasons: [], cutoutStatus: 'original' });
  const items = [...seedState().items, oldTop, originalBottom];
  assert.deepEqual(suggestOutfit(items), []);
  assert.deepEqual(suggestOutfit(items, { photoMode: 'photos' }, () => 0).map(item => item.id), ['old-top', 'original-bottom']);
});

test('a missing clothing category is never replaced by an illustrated sample', () => {
  const items = [...seedState().items, photo('real-top', { seasons: [] }), photo('real-shoes', { category: '鞋履', seasons: [] })];
  assert.deepEqual(suggestOutfit(items), []);
  assert.equal(outfitSuggestionStatus(items).code, 'incomplete');
  assert.match(outfitSuggestionStatus(items).message, /上装和下装|连衣裙/);
});

test('suggestion readiness explains missing uploads, flatlay generation, seasonal choices and complete outfits', () => {
  assert.equal(outfitSuggestionStatus(seedState().items).code, 'no_photos');
  const unprocessed = [photo('original', { cutoutStatus: 'original', seasons: [] })];
  assert.equal(outfitSuggestionStatus(unprocessed).code, 'not_processed');
  const summerDress = [photo('dress', { category: '连衣裙', seasons: ['夏'] })];
  assert.equal(outfitSuggestionStatus(summerDress, { season: '冬' }).code, 'season_mismatch');
  const ready = outfitSuggestionStatus(summerDress, { season: '夏' });
  assert.equal(ready.code, 'ready');
  assert.equal(ready.photoCount, 1);
  assert.equal(ready.processedCount, 1);
  assert.equal(ready.eligibleCount, 1);
});

test('recommendations compare color harmony across full top and bottom combinations', () => {
  const items = [
    photo('blue-top', { color: '#0000ff', seasons: [] }),
    photo('clashing-bottom', { category: '下装', color: '#00ff00', seasons: [] }),
    photo('neutral-bottom', { category: '下装', color: '#ffffff', seasons: [] }),
  ];
  assert.deepEqual(suggestOutfit(items, {}, () => 0).map(item => item.id), ['blue-top', 'neutral-bottom']);
});

test('a dress can beat a mismatched top and bottom pair for the requested style', () => {
  const items = [
    photo('top', { style: '运动', seasons: [] }),
    photo('bottom', { category: '下装', style: '运动', seasons: [] }),
    photo('dress', { category: '连衣裙', style: '通勤', seasons: [] }),
  ];
  assert.deepEqual(suggestOutfit(items, { style: '通勤' }, () => 0).map(item => item.id), ['dress']);
});

test('recommendation layout produces positions accepted by backup import', () => {
  const state = { ...emptyState(), items: [photo('shirt'), photo('bottom', { category: '下装' })] };
  const picked = suggestOutfit(state.items, { season: '秋' }, () => 0);
  state.outfits = [outfit(picked)];
  assert.ok(picked.length >= 2);
  assert.doesNotThrow(() => validateBackup(state));
  assert.deepEqual(state.outfits[0].elements.map(element => element.z), picked.map((_, index) => index));
});

test('cost statistics use total recorded purchase value divided by total garment wears', () => {
  const state = { ...emptyState(), items: [
    garment('one', { price: 100, wearCount: 2 }),
    garment('two', { price: 200, wearCount: 3 }),
    garment('unworn', { price: 50, wearCount: 0 }),
  ] };
  assert.deepEqual(statsFor(state), { count: 3, total: 350, wears: 5, unworn: 1, averageCost: 70 });
  assert.equal(state.items[0].price / state.items[0].wearCount, 50);
  assert.equal(statsFor(addDiary(state, entry(['unworn']))).averageCost, 350 / 6);
});

test('zero recorded wears produce no cost value instead of Infinity or NaN', () => {
  assert.deepEqual(statsFor(emptyState()), { count: 0, total: 0, wears: 0, unworn: 0, averageCost: null });
  assert.equal(statsFor({ ...emptyState(), items: [garment('new', { price: 99, wearCount: 0 })] }).averageCost, null);
});

test('storage failures are explicit when IndexedDB is unavailable', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  Object.defineProperty(globalThis, 'indexedDB', { value: undefined, configurable: true });
  try {
    await assert.rejects(loadState(), /存储/);
    await assert.rejects(saveState(emptyState()), /存储/);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'indexedDB', descriptor);
    else delete globalThis.indexedDB;
  }
});
