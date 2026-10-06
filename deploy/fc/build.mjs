import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

export const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
export const artifactRoot = path.join(projectRoot, 'artifacts', 'fc');
const includedFiles = [
  ['deploy/fc/entry.mjs', 'entry.mjs'],
  ['server/flatlay-server.mjs', 'server/flatlay-server.mjs'],
  ['server/flatlay-service.mjs', 'server/flatlay-service.mjs'],
  ['server/flatlay-prompt.mjs', 'server/flatlay-prompt.mjs']
];

export async function fcManifest() {
  return JSON.parse(await readFile(new URL('./manifest.json', import.meta.url), 'utf8'));
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// A small dependency-free, deterministic STORE ZIP writer. Only the four
// explicitly listed source files can enter the deployment archive.
function zipFiles(files) {
  const localParts = [], centralParts = [];
  let offset = 0;
  for (const { name, bytes } of files) {
    const filename = Buffer.from(name, 'utf8');
    const checksum = crc32(bytes);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6);
    header.writeUInt16LE(33, 12); // 1980-01-01, for repeatable ZIPs.
    header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(bytes.length, 18);
    header.writeUInt32LE(bytes.length, 22);
    header.writeUInt16LE(filename.length, 26);
    localParts.push(header, filename, bytes);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(33, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(bytes.length, 20);
    central.writeUInt32LE(bytes.length, 24);
    central.writeUInt16LE(filename.length, 28);
    central.writeUInt32LE(0x81a40000, 38); // Unix regular file, mode 0644.
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, filename);
    offset += header.length + filename.length + bytes.length;
  }
  const directory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, directory, end]);
}

export async function buildFcArchive(output = artifactRoot) {
  const files = await Promise.all(includedFiles.map(async ([source, name]) => ({ name, bytes: await readFile(path.join(projectRoot, source)) })));
  const archive = zipFiles(files);
  await mkdir(output, { recursive: true });
  const zipPath = path.join(output, 'closet-flatlay-fc.zip');
  const sha256 = createHash('sha256').update(archive).digest('hex');
  await writeFile(zipPath, archive);
  const manifest = await fcManifest();
  await writeFile(path.join(output, 'deployment-public.json'), `${JSON.stringify({ ...manifest, archive: { filename: path.basename(zipPath), sha256, files: files.map(file => file.name), bytes: archive.length } }, null, 2)}\n`);
  return { zipPath, sha256, bytes: archive.length, files: files.map(file => file.name), manifest };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await buildFcArchive();
  console.log(JSON.stringify({ zipPath: result.zipPath, sha256: result.sha256, bytes: result.bytes, files: result.files }));
}
