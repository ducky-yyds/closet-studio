import { mkdir, readdir, lstat, copyFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const destination = path.resolve(root, 'dist');
// The directory removed by this script is always the project's own dist folder.
if (path.dirname(destination) !== path.resolve(root) || path.basename(destination) !== 'dist') {
  throw new Error('打包目录必须是项目内的 dist。');
}
const assetExtensions = new Set([
  '.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.ico',
  '.woff', '.woff2', '.ttf', '.otf', '.mp4', '.webm', '.json',
  '.js', '.mjs', '.wasm', '.onnx', '.txt'
]);
const moduleExtensions = new Set(['.js', '.mjs', '.css', '.json']);

async function copyDirectory(relative, allowedExtensions) {
  const source = path.join(root, relative);
  const info = await lstat(source);
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`不能打包非普通目录：${relative}`);
  await mkdir(path.join(destination, relative), { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const child = path.join(relative, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`不能打包符号链接：${child}`);
    if (entry.isDirectory()) {
      await copyDirectory(child, allowedExtensions);
    } else if (entry.isFile() && allowedExtensions.has(path.extname(entry.name).toLowerCase())) {
      await copyFile(path.join(root, child), path.join(destination, child));
    }
  }
}

for (const filename of ['index.html', 'styles.css']) {
  const info = await lstat(path.join(root, filename));
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`缺少应用文件：${filename}`);
}
try {
  const existing = await lstat(destination);
  if (existing.isSymbolicLink() || !existing.isDirectory()) throw new Error('dist 必须是项目内的普通目录。');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
await rm(destination, { recursive: true, force: true });
await mkdir(destination);
for (const filename of ['index.html', 'styles.css']) {
  await copyFile(path.join(root, filename), path.join(destination, filename));
}
await copyDirectory('src', moduleExtensions);
await copyDirectory('assets', assetExtensions);
await writeFile(path.join(destination, '.nojekyll'), '');
console.log('已打包到 dist：仅包含网页、样式、应用代码和静态资源。');
