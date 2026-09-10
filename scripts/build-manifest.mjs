// Write manifest.json: a content hash per chunk so apps fetch only what
// changed, plus an immutable base URL pinned to the commit that holds the
// chunks (jsDelivr caches commit URLs forever, so chunks are never stale).
//
//   node scripts/build-manifest.mjs --sha <commit> [--repo user/name]
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, CATALOG, REGION, listJson, hash8 } from './lib.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const sha = arg('--sha', 'main');
const repo = arg('--repo', 'kumbre35-rgb/signal-map-data');

const index = (dir) => {
  const out = {};
  for (const f of listJson(dir)) out[path.basename(f, '.json')] = hash8(fs.readFileSync(path.join(dir, f), 'utf8'));
  return out;
};
const counts = {};
for (const f of listJson(CATALOG)) counts[path.basename(f, '.json')] = JSON.parse(fs.readFileSync(path.join(CATALOG, f), 'utf8')).length;

const manifest = {
  built: new Date().toISOString(),
  base: `https://cdn.jsdelivr.net/gh/${repo}@${sha}/`,
  chunks: index(CATALOG),
  region: index(REGION),
  counts,
};
fs.writeFileSync(path.join(ROOT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`manifest.json → ${Object.keys(manifest.chunks).length} chunks, ${Object.keys(manifest.region).length} region files, base ${manifest.base}`);
