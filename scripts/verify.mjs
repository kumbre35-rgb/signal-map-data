// Live-verify one country's links right now, from this machine, through the
// local Signal Map server's deep probe (manifest → variant → segment):
//
//   node scripts/verify.mjs IN [http://127.0.0.1:4200] [concurrency]
//
// For every channel in catalog/<CC>.json:
//   • each link is probed; working links move to the front, dead ones stay
//     behind them (a later run may find them back);
//   • a channel with no working link borrows one from the same station listed
//     under another source, but only after that link is probed live too;
//   • the verdict is written into the catalog as "ok": 1|0 and "okAt", so the
//     app can show LIVE / OFF and sort dead channels last without a server.
//
// Verdicts are from wherever this runs. A stream that is geo-blocked here but
// fine in the country itself will be marked 0 — the trade-off of a single
// vantage point. Review `git diff --stat`, then commit.
import path from 'node:path';
import { CATALOG, listJson, readJson, writeChannels } from './lib.mjs';

const CC = (process.argv[2] || '').toUpperCase();
const BASE = process.argv[3] || 'http://127.0.0.1:4200';
const CONC = Number(process.argv[4] || 8);
if (!/^[A-Z]{2}$|^GLOBAL$/.test(CC)) { console.error('usage: node scripts/verify.mjs <CC> [server] [concurrency]'); process.exit(2); }

const file = path.join(CATALOG, `${CC}.json`);
const list = readJson(file);
const norm = (n) => String(n || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/\b(hd|sd|fhd|uhd|4k|1080p|720p)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();

const cache = new Map(); // url -> verdict, so a link shared by two channels is probed once
async function probe(s) {
  if (cache.has(s.u)) return cache.get(s.u);
  const q = new URLSearchParams({ u: s.u }); if (s.ua) q.set('ua', s.ua); if (s.ref) q.set('ref', s.ref);
  let v;
  try { v = await (await fetch(`${BASE}/api/probe?${q}`, { signal: AbortSignal.timeout(90_000) })).json(); }
  catch (e) { v = { ok: 0, why: 'probe-' + (e.name || 'error') }; }
  cache.set(s.u, v);
  return v;
}
async function pool(items, fn) {
  let i = 0, done = 0; const t0 = Date.now();
  const tick = () => { done++; if (done % 50 === 0 || done === items.length) console.log(`  ${done}/${items.length}  ${((Date.now() - t0) / 1000).toFixed(0)}s`); };
  await Promise.all(Array.from({ length: Math.min(CONC, items.length) }, async () => { while (i < items.length) { const it = items[i++]; await fn(it); tick(); } }));
}

// 1. Probe every link of every channel.
console.log(`${CC}: ${list.length} channels, ${list.reduce((a, c) => a + c.streams.length, 0)} links — probing (concurrency ${CONC})…`);
const stats = { reordered: 0, borrowed: 0, live: 0, dead: 0, wasLive: 0 };
await pool(list, async (ch) => {
  const verdicts = [];
  for (const s of ch.streams.slice(0, 5)) verdicts.push(await probe(s));
  ch._v = verdicts;
});

// 2. Donors for dead channels: same station name, any country, any source.
const byName = new Map();
for (const f of listJson(CATALOG)) for (const c of readJson(path.join(CATALOG, f))) {
  const k = norm(c.n); if (k.length < 3 || !c.streams?.length) continue;
  if (!byName.has(k)) byName.set(k, []); byName.get(k).push(c);
}
const now = Date.now();
const deadOnes = [];
for (const ch of list) {
  const good = [], bad = [];
  ch.streams.forEach((s, i) => ((ch._v[i] && ch._v[i].ok) ? good : bad).push(s));
  if (ch.ok === 1) stats.wasLive++;
  if (good.length) {
    if (ch.streams[0] !== good[0]) stats.reordered++;
    ch.streams = [...good, ...bad];
    ch.ok = 1; ch.okAt = now;
  } else deadOnes.push(ch);
  delete ch._v;
}
console.log(`dead after probing own links: ${deadOnes.length} — looking for the same station elsewhere…`);
await pool(deadOnes, async (ch) => {
  const own = new Set(ch.streams.map((s) => s.u));
  const donors = (byName.get(norm(ch.n)) || []).filter((c) => c.id !== ch.id).flatMap((c) => c.streams.slice(0, 2).map((s) => ({ ...s, t: `via ${c.src}` }))).filter((s) => !own.has(s.u)).slice(0, 4);
  for (const d of donors) {
    const v = await probe(d);
    if (v.ok) { ch.streams.unshift({ u: d.u, ...(d.ua ? { ua: d.ua } : {}), ...(d.ref ? { ref: d.ref } : {}), t: d.t }); ch.ok = 1; ch.okAt = now; stats.borrowed++; return; }
  }
  ch.ok = 0; ch.okAt = now;
});

for (const ch of list) (ch.ok === 1 ? stats.live++ : stats.dead++);
writeChannels(file, list);
console.log(`\n${CC}: ${stats.live} channels live, ${stats.dead} dead (were marked live before: ${stats.wasLive})`);
console.log(`  ${stats.reordered} reordered to a working link first, ${stats.borrowed} dead channels revived with a verified link from another source`);
console.log(`  wrote catalog/${CC}.json — review with git diff --stat, then commit`);
