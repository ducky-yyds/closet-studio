import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_FILES, MAX_FILE_BYTES, MAX_BATCH_BYTES, inspectFiles, imageFileError, photoName } from '../src/uploads.js';

const picture = (name, properties = {}) => ({ name, type: 'image/jpeg', size: 1024, lastModified: 1234, ...properties });

test('mixed dropped files keep valid images and report each unsupported or unreadable file', () => {
  const valid = [picture('shirt.jpg'), picture('coat.png', { type: 'image/png' }), picture('jeans.webp', { type: 'image/webp' })];
  const invalid = [
    picture('notes.txt', { type: 'text/plain' }), picture('picture.svg', { type: 'image/svg+xml' }),
    picture('photo.gif', { type: 'image/gif' }), picture('directory', { type: '' }),
    picture('empty.jpg', { size: 0 }), picture('too-large.jpg', { size: MAX_FILE_BYTES + 1 }),
  ];
  const result = inspectFiles([invalid[0], valid[0], ...invalid.slice(1), ...valid.slice(1)]);
  assert.deepEqual(result.accepted, valid);
  assert.deepEqual(result.rejected.map(record => record.file), invalid);
  assert.ok(result.rejected.every(record => typeof record.error === 'string' && record.error.length > 0));
  assert.deepEqual(result.duplicates, []);
});

test('one 20 MB image is accepted and an extra byte is rejected before decoding', () => {
  assert.equal(imageFileError(picture('limit.jpg', { size: MAX_FILE_BYTES })), '');
  assert.ok(imageFileError(picture('over-limit.jpg', { size: MAX_FILE_BYTES + 1 })));
  assert.ok(imageFileError(null));
});

test('file duplicates in the current queue and same drop are omitted without consuming capacity', () => {
  const shirt = picture('shirt.jpg'), jeans = picture('jeans.jpg');
  const current = [shirt], incoming = [shirt, jeans, { ...jeans }, picture('coat.jpg')];
  const currentSnapshot = structuredClone(current), incomingSnapshot = structuredClone(incoming);
  const result = inspectFiles(incoming, current);
  assert.deepEqual(result.accepted.map(file => file.name), ['jeans.jpg', 'coat.jpg']);
  assert.deepEqual(result.duplicates, [shirt, incoming[2]]);
  assert.deepEqual(result.rejected, []);
  assert.deepEqual(current, currentSnapshot);
  assert.deepEqual(incoming, incomingSnapshot);
});

test('different images sharing a filename remain separate when size or modification time differs', () => {
  const old = picture('photo.jpg');
  const changedSize = picture('photo.jpg', { size: old.size + 1 });
  const changedTime = picture('photo.jpg', { lastModified: old.lastModified + 1 });
  assert.deepEqual(inspectFiles([changedSize, changedTime], [old]).accepted, [changedSize, changedTime]);
});

test('the 30 image limit includes existing rows and rejects only excess new files', () => {
  const current = Array.from({ length: MAX_FILES - 1 }, (_, index) => picture(`existing-${index}.jpg`));
  const accepted = picture('last.jpg'), excess = picture('excess.jpg');
  const result = inspectFiles([current[0], accepted, excess], current);
  assert.deepEqual(result.accepted, [accepted]);
  assert.deepEqual(result.duplicates, [current[0]]);
  assert.deepEqual(result.rejected.map(record => record.file), [excess]);
});

test('the total memory budget accepts exactly 100 MB and rejects an additional image', () => {
  const current = Array.from({ length: MAX_BATCH_BYTES / MAX_FILE_BYTES - 1 }, (_, index) => picture(`large-${index}.jpg`, { size: MAX_FILE_BYTES }));
  const exactLimit = picture('last-large.jpg', { size: MAX_FILE_BYTES });
  const extra = picture('extra.jpg', { size: 1 });
  const result = inspectFiles([exactLimit, extra], current);
  assert.deepEqual(result.accepted, [exactLimit]);
  assert.deepEqual(result.rejected.map(record => record.file), [extra]);
});

test('an image exceeding the remaining batch budget does not prevent a later smaller image', () => {
  const current = Array.from({ length: 5 }, (_, index) => picture(`large-${index}.jpg`, { size: MAX_FILE_BYTES - 100 }));
  const overBudget = picture('over-budget.jpg', { size: 501 });
  const fits = picture('fits.jpg', { size: 500 });
  const result = inspectFiles([overBudget, fits], current);
  assert.deepEqual(result.accepted, [fits]);
  assert.deepEqual(result.rejected.map(record => record.file), [overBudget]);
});

test('default metadata removes only the final extension, keeps Unicode and has a usable bounded name', () => {
  assert.equal(photoName('我的白衬衫.正面.jpg'), '我的白衬衫.正面');
  assert.equal(photoName(' .png'), '新衣物');
  assert.equal(photoName(''), '新衣物');
  assert.equal(photoName(`${'衣'.repeat(100)}.jpg`).length, 80);
});
