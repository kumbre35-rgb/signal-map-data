// Replace dead links with working ones, using verdicts from a running Signal
// Map server (which probes every stream from this machine). Run after
// `npm run import`, then review `git diff` and commit.
//
//   node scripts/heal.mjs [http://127.0.0.1:4200]
//
// Three fixes, in order of confidence:
//   1. reorder  — the channel is online, but only via a later alternate; move
//                 the working link first so the app stops trying a dead one.
//   2. borrow   — the channel is dead, but the same station (same name and
//                 country) is online under another source; add that working
//                 link in front of the dead ones.
//   3. drop     — links the probe classed "blocked" point at addresses that
//                 are not publicly reachable at all; they never work anywhere.
import path from 'node:path';
import { CATALOG, listJson, readJson, writeChannels } from './lib.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:4200';
const GEO = new Set(['region-slate']); // dead here, not dead — leave alone

const res = await fetch(`${BASE}/api/tv`, { signal: AbortSignal.timeout(180_000) });
if (!res.ok) throw new Error(`${BASE}/api/tv → HTTP ${res.status}`);
const verdict = new Map((await res.json()).items.map((it) => [it.id, it]));

/** "Geo News HD" and "GEO NEWS (Pakistan)" should meet. */
const norm = (n) => String(n || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/\b(hd|sd|fhd|uhd|4k|1080p|720p)\b/g, ' ')
  .replace(/[^a-z0-9]+/g, ' ').trim();

// Index: name|country → working streams from channels that are online here.
const alive = new Map();
for (const v of verdict.values()) {
  if (v.ok !== 1 || !v.streams?.length) continue;
  const key = `${norm(v.n)}|${v.c || ''}`;
  if (norm(v.n).length < 3) continue;
  const s = v.streams[v.oki || 0];
  if (!alive.has(key)) alive.set(key, []);
  alive.get(key).push({ u: s.u, ...(s.ua ? { ua: s.ua } : {}), ...(s.ref ? { ref: s.ref } : {}), t: `via ${v.src}` });
}

const stats = { reorder: 0, borrow: 0, dropped: 0, files: 0 };
const examples = [];
for (const f of listJson(CATALOG)) {
  const file = path.join(CATALOG, f);
  const list = readJson(file);
  let touched = false;
  for (const ch of list) {
    const v = verdict.get(ch.id);
    if (!v || !ch.streams?.length) continue;
    const urls = new Set(ch.streams.map((s) => s.u));

    if (v.ok === 1 && v.oki > 0 && v.oki < ch.streams.length) {
      const [good] = ch.streams.splice(v.oki, 1);
      ch.streams.unshift(good);
      stats.reorder++; touched = true;
      continue;
    }
    if (v.ok !== 0 || GEO.has(v.why)) continue;

    const key = `${norm(ch.n)}|${ch.c || ''}`;
    const donors = (alive.get(key) || []).filter((d) => !urls.has(d.u));
    if (donors.length) {
      ch.streams.unshift(...donors.slice(0, 2));
      stats.borrow++; touched = true;
      if (examples.length < 6) examples.push(`${ch.n} [${ch.c}]  ← ${donors[0].t}`);
    }
    if (v.why === 'blocked') {
      const before = ch.streams.length;
      ch.streams = ch.streams.filter((s) => donors.some((d) => d.u === s.u) || !/^https?:\/\/(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|localhost|0\.0\.0\.0|\[?::1)/i.test(s.u));
      if (ch.streams.length !== before) { stats.dropped += before - ch.streams.length; touched = true; }
    }
  }
  if (touched) { writeChannels(file, list); stats.files++; }
}

console.log(`reordered ${stats.reorder} channels (working alternate moved first)`);
console.log(`borrowed a working link for ${stats.borrow} dead channels from another source`);
console.log(`dropped ${stats.dropped} unreachable private-address links`);
console.log(`${stats.files} country files changed`);
if (examples.length) console.log('e.g.\n  ' + examples.join('\n  '));
