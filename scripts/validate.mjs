// Refuse to publish a broken catalog. A typo here would break every app at
// once, so this runs in CI before the manifest is built.
import path from 'node:path';
import { CATALOG, REGION, listJson, readJson } from './lib.mjs';

const errors = [];
const err = (file, msg) => errors.push(`${file}: ${msg}`);
const ids = new Map();

for (const f of listJson(CATALOG)) {
  const cc = path.basename(f, '.json');
  let list;
  try { list = readJson(path.join(CATALOG, f)); } catch (e) { err(f, `not valid JSON — ${e.message}`); continue; }
  if (!Array.isArray(list)) { err(f, 'must be a JSON array of channels'); continue; }
  list.forEach((ch, i) => {
    const where = `${f} #${i + 1}${ch?.id ? ` (${ch.id})` : ''}`;
    if (!ch || typeof ch !== 'object') return err(where, 'not an object');
    if (typeof ch.id !== 'string' || !ch.id) return err(where, 'missing "id"');
    if (ids.has(ch.id)) err(where, `duplicate id, also in ${ids.get(ch.id)}`); else ids.set(ch.id, f);
    if (typeof ch.n !== 'string' || !ch.n) err(where, 'missing "n" (name)');
    if (cc !== 'GLOBAL' && ch.c !== cc) err(where, `"c" is ${JSON.stringify(ch.c)} but file is ${cc}.json`);
    if (!Array.isArray(ch.streams)) return err(where, '"streams" must be an array (use [] for embed-only channels)');
    ch.streams.forEach((s, j) => {
      if (!s || typeof s.u !== 'string') return err(where, `streams[${j}] missing "u"`);
      if (!/^(https?|rtmp|rtsp|srt|mmsh?):\/\/\S+$/i.test(s.u)) err(where, `streams[${j}] bad url ${s.u}`);
    });
  });
}

for (const f of listJson(REGION)) {
  let r;
  try { r = readJson(path.join(REGION, f)); } catch (e) { err(`region/${f}`, `not valid JSON — ${e.message}`); continue; }
  for (const id of r.dead || []) if (!ids.has(id)) err(`region/${f}`, `dead: unknown channel ${id}`);
  for (const [id, i] of Object.entries(r.prefer || {})) {
    if (!ids.has(id)) err(`region/${f}`, `prefer: unknown channel ${id}`);
    else if (!Number.isInteger(i) || i < 0) err(`region/${f}`, `prefer[${id}] must be a stream index`);
  }
}

if (errors.length) {
  console.error(`✖ ${errors.length} problem(s):\n` + errors.slice(0, 50).map((e) => '  ' + e).join('\n') + (errors.length > 50 ? `\n  …and ${errors.length - 50} more` : ''));
  process.exit(1);
}
console.log(`✔ ${ids.size} channels in ${listJson(CATALOG).length} catalog files, ${listJson(REGION).length} region files — all good`);
