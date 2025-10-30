import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { join } from 'path';
import { createWriteStream, promises as fsp } from 'fs';


export function tempPath(ext = '') {
const name = `${Date.now()}-${randomBytes(6).toString('hex')}${ext ? '.' + ext.replace(/^\./, '') : ''}`;
return join(tmpdir(), name);
}


export async function safeUnlink(filePath) {
if (!filePath) return;
try { await fsp.unlink(filePath); } catch {}
}


export function writeStreamToFile(readable, outPath) {
return new Promise((resolve, reject) => {
const ws = createWriteStream(outPath);
readable.pipe(ws);
ws.on('finish', () => resolve(outPath));
ws.on('error', reject);
readable.on('error', reject);
});
}


export async function fileSizeMB(filePath) {
const stat = await fsp.stat(filePath);
return stat.size / (1024 * 1024);
}