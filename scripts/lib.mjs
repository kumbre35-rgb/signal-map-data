import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CATALOG = path.join(ROOT, 'catalog');
export const REGION = path.join(ROOT, 'region');

export const listJson = (dir) => fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json') && !f.startsWith('_')).sort() : [];
export const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
export const hash8 = (text) => createHash('sha256').update(text).digest('hex').slice(0, 8);

/** One channel per line: readable in the GitHub editor, one-line git diffs. */
export function writeChannels(file, items) {
  items.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  fs.writeFileSync(file, '[\n' + items.map((it) => JSON.stringify(it)).join(',\n') + '\n]\n');
}
