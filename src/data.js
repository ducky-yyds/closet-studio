export const CATEGORIES = ['全部', '上装', '下装', '连衣裙', '外套', '鞋履', '配饰'];

export const COLORS = [
  { name: '米白', value: '#eee9dd' },
  { name: '白色', value: '#ffffff' },
  { name: '黑色', value: '#262626' },
  { name: '灰色', value: '#9c9b98' },
  { name: '蓝色', value: '#56758e' },
  { name: '卡其', value: '#b7a084' },
  { name: '棕色', value: '#765440' },
  { name: '绿色', value: '#7e8d75' },
  { name: '粉色', value: '#d9b5b0' },
  { name: '红色', value: '#a85952' },
  { name: '黄色', value: '#d3b567' },
  { name: '紫色', value: '#a895b6' },
];

export const SEASONS = ['春', '夏', '秋', '冬'];
export const STYLES = ['日常', '通勤', '休闲', '运动', '约会'];

export function uid() {
  return globalThis.crypto?.randomUUID?.()
    ?? `item-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function today() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

const DATABASE_NAME = `closet-web:${encodeURIComponent(new URL('../', import.meta.url).pathname)}`;
const STORE_NAME = 'state';
const STATE_KEY = 'current';
let databasePromise;

function openDatabase() {
  if (!globalThis.indexedDB) {
    return Promise.reject(new Error('此浏览器无法使用本地衣橱存储，请在普通浏览模式下打开。'));
  }
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => {
        database.close();
        databasePromise = undefined;
      };
      resolve(database);
    };
    request.onerror = () => {
      databasePromise = undefined;
      reject(request.error ?? new Error('无法打开本地衣橱存储。'));
    };
    request.onblocked = () => {
      databasePromise = undefined;
      reject(new Error('本地衣橱存储被其他页面占用，请关闭其他衣橱页面后重试。'));
    };
  });
  return databasePromise;
}

export async function loadState() {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const request = transaction.objectStore(STORE_NAME).get(STATE_KEY);
    let result = null;
    request.onsuccess = () => { result = request.result ?? null; };
    request.onerror = () => reject(request.error ?? new Error('无法读取本地衣橱。'));
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error ?? new Error('无法读取本地衣橱。'));
    transaction.onabort = () => reject(transaction.error ?? new Error('本地衣橱读取已中止。'));
  });
}

export async function saveState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new TypeError('保存的衣橱状态必须是对象。');
  }
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(STATE_KEY);
    let failure;
    let committedRevision;
    request.onerror = () => { failure = request.error; };
    request.onsuccess = () => {
      const storedRevision = request.result?._revision ?? 0;
      const expectedRevision = state._revision ?? 0;
      if (storedRevision !== expectedRevision) {
        failure = new Error('衣橱已在另一个页面更新，请刷新后重试。');
        failure.code = 'CONFLICT';
        transaction.abort();
        return;
      }
      committedRevision = storedRevision + 1;
      try {
        const write = store.put({ ...state, _revision: committedRevision }, STATE_KEY);
        write.onerror = () => { failure = write.error; };
      } catch (error) {
        failure = error;
        transaction.abort();
      }
    };
    transaction.oncomplete = () => {
      state._revision = committedRevision;
      resolve();
    };
    transaction.onerror = () => reject(failure ?? transaction.error ?? new Error('无法保存本地衣橱。'));
    transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('本地衣橱保存已中止。'));
  });
}

export function seedState() {
  const createdAt = today();
  const samples = [
    ['ivory-knit', '云朵针织衫', '上装', '#eee9dd', '米白', ['春', '秋', '冬'], '日常', 299, 12, true],
    ['cotton-shirt', '柔白棉质衬衫', '上装', '#ffffff', '白色', ['春', '夏', '秋'], '通勤', 239, 8, false],
    ['straight-jeans', '水洗直筒牛仔裤', '下装', '#56758e', '蓝色', ['春', '秋', '冬'], '休闲', 359, 16, true],
    ['tailored-trousers', '垂感西装长裤', '下装', '#9c9b98', '灰色', ['春', '秋', '冬'], '通勤', 329, 6, false],
    ['pleated-skirt', '奶茶百褶半裙', '下装', '#b7a084', '卡其', ['春', '夏', '秋'], '约会', 279, 0, false],
    ['black-dress', '经典小黑裙', '连衣裙', '#262626', '黑色', ['春', '夏', '秋'], '约会', 459, 0, true],
    ['trench-coat', '砂色长款风衣', '外套', '#b7a084', '卡其', ['春', '秋'], '通勤', 699, 7, true],
    ['blazer', '松弛感西装外套', '外套', '#765440', '棕色', ['春', '秋', '冬'], '通勤', 499, 5, false],
    ['white-sneakers', '轻盈白色运动鞋', '鞋履', '#ffffff', '白色', ['春', '夏', '秋', '冬'], '休闲', 399, 21, true],
    ['loafers', '巧克力乐福鞋', '鞋履', '#765440', '棕色', ['春', '秋', '冬'], '通勤', 529, 9, false],
    ['shoulder-bag', '焦糖色肩背包', '配饰', '#765440', '棕色', ['春', '夏', '秋', '冬'], '日常', 399, 18, true],
    ['striped-scarf', '暖调条纹围巾', '配饰', '#eee9dd', '米白', ['秋', '冬'], '日常', 169, 5, false],
  ];

  return {
    version: 1,
    items: samples.map(([asset, name, category, color, colorName, seasons, style, price, wearCount, favorite]) => ({
      id: `sample-${asset}`,
      name,
      category,
      color,
      colorName,
      seasons,
      style,
      brand: '',
      price,
      wearCount,
      favorite,
      source: 'demo',
      image: `./assets/garments/${asset}.svg`,
      createdAt,
      notes: '示例单品，可以编辑或删除，再添加你自己的衣物。',
    })),
    outfits: [],
    diary: [],
    settings: { name: '我的衣橱' },
  };
}
