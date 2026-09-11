// Pull the catalog from a running Signal Map server and write it into
// catalog/<CC>.json (one file per country, GLOBAL for channels without one).
// Re-running is safe: output is sorted by id, so git shows only real changes.
//
//   node scripts/import-from-server.mjs [http://127.0.0.1:4200]
import fs from 'node:fs';
import path from 'node:path';
import { CATALOG, writeChannels } from './lib.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:4200';
const RUNTIME_FIELDS = new Set(['ok', 'oki', 'okAt', 'why']); // health verdicts live in region/, not here
const EXCLUDED = new Set(['IL']); // never published, in any country file

const res = await fetch(`${BASE}/api/tv`, { signal: AbortSignal.timeout(180_000) });
if (!res.ok) throw new Error(`${BASE}/api/tv → HTTP ${res.status}`);
const { items } = await res.json();

const clean = (obj) => {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (RUNTIME_FIELDS.has(k)) continue;
    if (v === '' || v === 0 || v === false || v == null) continue;
    if (Array.isArray(v) && !v.length) continue;
    out[k] = v;
  }
  return out;
};

const byCountry = new Map();
for (const it of items) {
  if (EXCLUDED.has(String(it.c || '').toUpperCase())) continue;
  const ch = clean(it);
  ch.streams = (it.streams || []).map(clean).filter((s) => s.u);
  const cc = /^[A-Z]{2}$/.test(it.c || '') ? it.c : 'GLOBAL';
  if (!byCountry.has(cc)) byCountry.set(cc, []);
  byCountry.get(cc).push(ch);
}

// Verdicts written by scripts/verify.mjs live in the catalog; a re-import must not erase them.
const prior = new Map();
for (const f of fs.existsSync(CATALOG) ? fs.readdirSync(CATALOG).filter((x) => x.endsWith('.json')) : []) {
  try { for (const c of JSON.parse(fs.readFileSync(path.join(CATALOG, f), 'utf8'))) if (c.ok !== undefined) prior.set(c.id, { ok: c.ok, okAt: c.okAt }); } catch { /* skip */ }
}
for (const list of byCountry.values()) for (const ch of list) { const p = prior.get(ch.id); if (p) Object.assign(ch, p); }

fs.mkdirSync(CATALOG, { recursive: true });
let total = 0;
for (const [cc, list] of [...byCountry].sort()) {
  writeChannels(path.join(CATALOG, `${cc}.json`), list);
  total += list.length;
}
console.log(`wrote ${total} channels into ${byCountry.size} files under catalog/`);
