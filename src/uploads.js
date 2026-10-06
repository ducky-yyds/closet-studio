export const MAX_FILES = 30;
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_BATCH_BYTES = 100 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function imageFileError(file) {
  if (!file || !IMAGE_TYPES.has(file.type)) return '请选择 JPG、PNG 或 WebP 图片。';
  if (!file.size) return '图片文件为空，无法读取。';
  if (file.size > MAX_FILE_BYTES) return '单张图片不能超过 20 MB。';
  return '';
}

export function fileKey(file) {
  return `${file.name}|${file.size}|${file.lastModified || 0}`;
}

export function inspectFiles(files, currentFiles = []) {
  const accepted = [], rejected = [], duplicates = [];
  const keys = new Set(currentFiles.map(fileKey));
  let count = currentFiles.length, bytes = currentFiles.reduce((sum,file)=>sum+file.size,0);
  for (const file of files) {
    const error = imageFileError(file);
    if (error) { rejected.push({ file, error }); continue; }
    const key = fileKey(file);
    if (keys.has(key)) { duplicates.push(file); continue; }
    if (count >= MAX_FILES) { rejected.push({ file, error: '每批最多上传 30 张图片。' }); continue; }
    if (bytes + file.size > MAX_BATCH_BYTES) { rejected.push({ file, error: '每批照片合计不能超过 100 MB。' }); continue; }
    keys.add(key); accepted.push(file); count++; bytes += file.size;
  }
  return { accepted, rejected, duplicates };
}

export function photoName(filename) {
  return String(filename || '新衣物').replace(/\.[^.]+$/, '').trim().slice(0, 80) || '新衣物';
}

export function guessCategory(name) {
  if (/连衣裙|洋装|dress/i.test(name)) return '连衣裙';
  if (/风衣|外套|夹克|西装|大衣|coat|jacket|blazer/i.test(name)) return '外套';
  if (/裤|半裙|短裙|长裙|jeans|pants|trousers|skirt/i.test(name)) return '下装';
  if (/鞋|靴|sneaker|loafer|shoe|boot/i.test(name)) return '鞋履';
  if (/包|围巾|帽|腰带|项链|bag|scarf|hat|belt/i.test(name)) return '配饰';
  return '上装';
}
