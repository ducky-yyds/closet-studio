export function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

export function statsFor(state) {
  const total = state.items.reduce((sum, item) => sum + Number(item.price || 0), 0);
  const wears = state.items.reduce((sum, item) => sum + Number(item.wearCount || 0), 0);
  return { count: state.items.length, total, wears, unworn: state.items.filter(item => !item.wearCount).length,
    averageCost: wears ? total / wears : null };
}

const validPhoto = image => typeof image === 'string' && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(image);
const validImage = image => validPhoto(image) || (typeof image === 'string' && /^\.\/assets\/garments\/[a-z0-9-]+\.svg$/.test(image));

// Older backups did not store a source. Raster data URLs are their uploaded photos;
// local SVG assets remain demonstrations, even if someone labels them as photos.
export function isRealPhoto(item) {
  return Boolean(item && item.source !== 'demo' && validPhoto(item.image));
}

// Background removal may keep the wearer. Legacy successful cutouts remain
// ordinary cutouts until a garment reconstruction explicitly returns flatlay.
export function isCutoutPhoto(item) {
  return isRealPhoto(item) && item.cutoutStatus === 'done'
    && (item.imageKind === undefined || item.imageKind === 'cutout');
}

export function isFlatlayPhoto(item) {
  return isRealPhoto(item) && item.cutoutStatus === 'done' && item.imageKind === 'flatlay';
}

export function isProcessedPhoto(item) {
  return isFlatlayPhoto(item);
}
const number = (v, max) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max;
const short = (v, max = 200) => typeof v === 'string' && v.length <= max;
const record = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const validDate = value => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
};

export function validateBackup(data) {
  if (!data || data.version !== 1 || !Array.isArray(data.items) || !Array.isArray(data.outfits) || !Array.isArray(data.diary)) throw new Error('备份格式不正确，请选择衣间导出的 JSON 文件。');
  if (data.items.length > 3000 || data.outfits.length > 3000 || data.diary.length > 20000) throw new Error('备份记录过多，暂时无法导入。');
  const unique = records => {
    const ids = new Set();
    for (const value of records) {
      if (!record(value) || !short(value.id, 100) || !value.id || ids.has(value.id)) return false;
      ids.add(value.id);
    }
    return true;
  };
  if (![data.items, data.outfits, data.diary].every(unique)) throw new Error('备份包含重复或缺失的记录编号。');
  for (const item of data.items) {
    if (!short(item.name, 80) || !item.name.trim() || !['上装','下装','连衣裙','外套','鞋履','配饰'].includes(item.category) || !/^#[a-f\d]{6}$/i.test(item.color) || !short(item.colorName, 30) || !Array.isArray(item.seasons) || !item.seasons.every(s => ['春','夏','秋','冬'].includes(s)) || !short(item.style, 30) || !short(item.brand, 80) || !short(item.notes, 2000) || !short(item.createdAt, 60) || !Number.isFinite(Date.parse(item.createdAt)) || !number(item.price, 10000000) || !number(item.wearCount, 1000000) || !Number.isInteger(item.wearCount) || typeof item.favorite !== 'boolean' || !validImage(item.image)) throw new Error('备份中的衣物记录不完整或包含不支持的图片。');
    if ((item.source !== undefined && !['photo', 'demo'].includes(item.source)) || (item.source === 'photo' && !validPhoto(item.image)) || (item.cutoutStatus !== undefined && !['done', 'original'].includes(item.cutoutStatus)) || (item.cutoutStatus !== undefined && !isRealPhoto(item)) || (item.originalImage !== undefined && !validPhoto(item.originalImage))) throw new Error('备份中的照片来源、抠图状态或原始图片不正确。');
    if ((item.imageKind !== undefined && (!['original', 'cutout', 'flatlay'].includes(item.imageKind) || !isRealPhoto(item)))
      || (item.imageSource !== undefined && (!['local', 'generated'].includes(item.imageSource) || !isRealPhoto(item)))
      || (item.imageProvider !== undefined && !short(item.imageProvider, 120))
      || (item.imageModel !== undefined && !short(item.imageModel, 160))
      || (item.processedAt !== undefined && (!short(item.processedAt, 60) || !Number.isFinite(Date.parse(item.processedAt))))) throw new Error('备份中的平铺图片类型、来源或处理信息不正确。');
  }
  const itemIds = new Set(data.items.map(item => item.id));
  for (const outfit of data.outfits) {
    if (!short(outfit.name, 80) || !outfit.name.trim() || !/^#[a-f\d]{6}$/i.test(outfit.background) || !Array.isArray(outfit.elements) || !outfit.elements.length || outfit.elements.length > 30 || !outfit.elements.every(el => record(el) && itemIds.has(el.itemId) && number(el.x, 640) && number(el.y, 700) && number(el.width, 600) && el.width >= 50 && typeof el.rotation === 'number' && Number.isFinite(el.rotation) && Math.abs(el.rotation) <= 180 && number(el.z, 10000))) throw new Error('备份中的搭配记录不完整。');
  }
  for (const entry of data.diary) {
    if (!validDate(entry.date) || !short(entry.name, 80) || !entry.name.trim() || !short(entry.notes, 2000) || !Array.isArray(entry.itemIds) || !entry.itemIds.length || new Set(entry.itemIds).size !== entry.itemIds.length || !entry.itemIds.every(id => itemIds.has(id))) throw new Error('备份中的穿搭日记不完整。');
  }
  return { version: 1, items: data.items, outfits: data.outfits, diary: data.diary, settings: { name: short(data.settings?.name, 30) && data.settings.name.trim() ? data.settings.name : '我的衣橱' } };
}

export function deleteItem(state, id) {
  const next = structuredClone(state);
  next.items = next.items.filter(item => item.id !== id);
  next.outfits = next.outfits.map(outfit => ({ ...outfit, elements: outfit.elements.filter(el => el.itemId !== id) })).filter(outfit => outfit.elements.length);
  next.diary = next.diary.map(entry => ({ ...entry, itemIds: entry.itemIds.filter(itemId => itemId !== id) })).filter(entry => entry.itemIds.length);
  return next;
}

export function addDiary(state, entry) {
  const next = structuredClone(state);
  entry = { ...entry, itemIds: [...new Set(entry.itemIds)].filter(id => next.items.some(item => item.id === id)) };
  if (!entry.itemIds.length || !validDate(entry.date)) throw new Error('请选择衣物和有效日期。');
  next.diary.push(entry);
  next.items.forEach(item => { if (entry.itemIds.includes(item.id)) item.wearCount += 1; });
  return next;
}

export function removeDiary(state, id) {
  const entry = state.diary.find(entry => entry.id === id);
  if (!entry) return state;
  const next = structuredClone(state);
  next.diary = next.diary.filter(entry => entry.id !== id);
  next.items.forEach(item => { if (entry.itemIds.includes(item.id)) item.wearCount = Math.max(0, item.wearCount - 1); });
  return next;
}

function photoPool(items, season, photoMode) {
  if (!['processed', 'photos'].includes(photoMode)) throw new TypeError('不支持的照片搭配模式。');
  return items.filter(photoMode === 'processed' ? isProcessedPhoto : isRealPhoto)
    .filter(item => !item.seasons.length || item.seasons.includes(season));
}

function hasOutfitBase(items) {
  const categories = new Set(items.map(item => item.category));
  return categories.has('连衣裙') || (categories.has('上装') && categories.has('下装'));
}

export function outfitSuggestionStatus(items, { season = '秋', photoMode = 'processed' } = {}) {
  const photoCount = items.filter(isRealPhoto).length;
  const processedCount = items.filter(isProcessedPhoto).length;
  const pool = photoPool(items, season, photoMode);
  const counts = { photoCount, processedCount, eligibleCount: pool.length };
  if (!photoCount) return { ...counts, code: 'no_photos', message: '先上传自己的衣服照片，生成平铺图后就能自动搭配。' };
  if (photoMode === 'processed' && !processedCount) return { ...counts, code: 'not_processed', message: '已有衣服照片，请先生成平铺图，去除人体并准备平铺服装，再自动搭配。' };
  if (!pool.length) return { ...counts, code: 'season_mismatch', message: `还没有适合${season}季的${photoMode === 'processed' ? '平铺' : ''}衣服照片，请调整季节或衣物信息。` };
  if (!hasOutfitBase(pool)) return { ...counts, code: 'incomplete', message: `请准备${photoMode === 'processed' ? '平铺的' : ''}上装和下装，或一件连衣裙，才能组成完整穿搭。` };
  return { ...counts, code: 'ready', message: photoMode === 'processed' ? '已准备好，可以使用真实衣服的平铺图自动搭配。' : '已准备好，可以使用真实衣服照片自动搭配。' };
}

function colorParts(color) {
  const values = [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16) / 255);
  const high = Math.max(...values), low = Math.min(...values), delta = high - low;
  const [r, g, b] = values;
  const lightness = (high + low) / 2;
  const saturation = delta ? delta / (1 - Math.abs(2 * lightness - 1)) : 0;
  let hue = !delta ? 0 : high === r ? ((g - b) / delta) % 6 : high === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  hue = (hue * 60 + 360) % 360;
  return { hue, neutral: saturation < 0.2 || lightness < 0.18 || lightness > 0.88 };
}

function colorHarmony(first, second) {
  const a = colorParts(first.color), b = colorParts(second.color);
  if (a.neutral || b.neutral) return 1.5;
  const difference = Math.min(Math.abs(a.hue - b.hue), 360 - Math.abs(a.hue - b.hue));
  return difference <= 45 ? 1.3 : difference >= 150 ? 1 : 0.2;
}

// Always return the actual wardrobe objects so the canvas keeps their processed
// images and identifiers. No illustrated sample can fill a missing category.
export function suggestOutfit(items, { season = '秋', style = '全部风格', photoMode = 'processed' } = {}, random = Math.random) {
  const pool = photoPool(items, season, photoMode);
  if (!hasOutfitBase(pool)) return [];
  const ranked = pool.map(item => ({ item, score: (style === '全部风格' || item.style === style ? 4 : 0) + 2 / (item.wearCount + 1) + random() * 0.65 }));
  // Limit pair comparisons for large wardrobes while retaining strong choices.
  const choices = category => ranked.filter(value => value.item.category === category).sort((a, b) => b.score - a.score).slice(0, 24);
  let base = [], bestScore = -Infinity;
  for (const top of choices('上装')) {
    for (const bottom of choices('下装')) {
      const score = (top.score + bottom.score) / 2 + colorHarmony(top.item, bottom.item) + (top.item.style === bottom.item.style ? 0.6 : 0);
      if (score > bestScore) { base = [top.item, bottom.item]; bestScore = score; }
    }
  }
  for (const dress of choices('连衣裙')) {
    if (dress.score + 1.5 > bestScore) { base = [dress.item]; bestScore = dress.score + 1.5; }
  }
  const pick = category => choices(category).map(value => ({ ...value, score: value.score + base.reduce((sum, item) => sum + colorHarmony(value.item, item), 0) / base.length + (base.some(item => item.style === value.item.style) ? 0.6 : 0) }))
    .sort((a, b) => b.score - a.score)[0]?.item;
  return [...base, ...(['秋', '冬', '春'].includes(season) ? [pick('外套')] : []), pick('鞋履'), pick('配饰')].filter(Boolean);
}

export function layoutOutfit(items) {
  const positions = { '上装': [265, 190, 260], '下装': [265, 440, 285], '连衣裙': [270, 335, 430], '外套': [465, 250, 225], '鞋履': [460, 575, 200], '配饰': [120, 560, 160] };
  return items.map((item, index) => { const [x,y,width] = positions[item.category] || [320,350,220]; return { itemId: item.id, x, y, width, rotation: 0, z: index }; });
}
