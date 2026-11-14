// token-radar-01 v3 — entrypoint.
// Reads the sealed snapshot, builds the ranked board, writes the dashboard's data
// into /output, copies dashboard/ and screenshots/ to /output, and writes
// /output/dossier.json with buildDossier from vendor/makefun-board.ts.
// Re-authored in this session from the spec in rebuild-v3/ROUND1.md.
//
// Run: mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBoard } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';
import type { Snapshot } from './lib/model.ts';

const root = dirname(fileURLToPath(import.meta.url));

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

const inputPath =
  argValue('--input') ??
  process.env.MAKEFUN_INPUT ??
  (existsSync('/input/snapshot.json') ? '/input/snapshot.json' : 'input/snapshot.json');
const outDir =
  argValue('--output') ?? process.env.MAKEFUN_OUTPUT_DIR ?? 'out';

const snap = JSON.parse(readFileSync(inputPath, 'utf8')) as Snapshot;
const { rows, marketMedian, totalImplied, liveTokenCount, liveTokenTop } = buildBoard(snap);

// Self-checks: a bad board fails loudly here, never silently.
if (rows.length < 100) throw new Error(`board too small: ${rows.length} rows`);
for (let i = 0; i < rows.length; i++) {
  if (rows[i].rank !== i + 1) throw new Error(`rank break at ${i}`);
  if (i > 0 && rows[i].implied_value_usd > rows[i - 1].implied_value_usd) {
    throw new Error(`implied value rises at rank ${rows[i].rank}`);
  }
  if (rows[i].farm_steps.length < 3 || rows[i].farm_steps.length > 12) {
    throw new Error(`farm_steps count at rank ${rows[i].rank}`);
  }
  for (const s of rows[i].farm_steps) {
    if (s.trim().length < 20 || s.trim().length > 600) {
      throw new Error(`farm step length at rank ${rows[i].rank}`);
    }
  }
}
const watchCovered = rows.filter((r) => r.watchlist).length;
if (watchCovered !== snap.watchlist.length) {
  throw new Error(`watchlist coverage ${watchCovered}/${snap.watchlist.length}`);
}

mkdirSync(join(outDir, 'dashboard'), { recursive: true });
mkdirSync(join(outDir, 'screenshots'), { recursive: true });

// board.json: the ranked board, plus the model's headline numbers.
writeFileSync(
  join(outDir, 'board.json'),
  JSON.stringify({
    rows,
    meta: {
      market_median: marketMedian,
      shrinkage_k: 3,
      rows: rows.length,
      total_implied_usd: totalImplied,
      as_of: snap.as_of,
    },
  }),
);

// Dashboard data, compact positional rows so the dossier's source text stays
// whole under its 65,536-byte cap. Schema (decoded in dashboard/app.js):
//   cats: category names by index
//   rows: [slug, name, catIdx, chainsPipe (first 3, "|" joined), chainCount,
//          tvl, change_7d|null, age_days|null, multiple, implied, watch 1/0,
//          category_median, peers, growth, maturity, chain]
//   liveTop: [name, category, tvl, symbol] of the largest live-token protocols,
//   shown set aside, never ranked.
const cats: string[] = [];
const catIdx = new Map<string, number>();
for (const r of rows) {
  const c = r.category ?? '';
  if (!catIdx.has(c)) {
    catIdx.set(c, cats.length);
    cats.push(c);
  }
}
const compactRows = rows.map((r) => [
  r.slug,
  r.name,
  catIdx.get(r.category ?? '') ?? 0,
  r.chains.slice(0, 3).join('|'),
  r.chains.length,
  r.tvl_usd,
  r.change_7d,
  r.age_days,
  r.multiple,
  r.implied_value_usd,
  r.watchlist ? 1 : 0,
  r.model.category_median,
  r.model.peers,
  r.model.growth,
  r.model.maturity,
  r.model.chain,
]);
const data = {
  cats,
  M: marketMedian,
  k: 3,
  total: totalImplied,
  liveCount: liveTokenCount,
  liveTop: liveTokenTop.map((p) => [p.name, p.category ?? '', p.tvl_usd, p.symbol ?? '']),
  rows: compactRows,
};
const dataJson = JSON.stringify(data);

const indexHtml = readFileSync(join(root, 'dashboard', 'index.html'), 'utf8');
const appCss = readFileSync(join(root, 'dashboard', 'app.css'), 'utf8');
let appJs = readFileSync(join(root, 'dashboard', 'app.js'), 'utf8');
const placeholderCount = appJs.split('__BOARD_DATA_JSON__').length - 1;
if (placeholderCount !== 1) {
  throw new Error(`__BOARD_DATA_JSON__ appears ${placeholderCount} times in app.js (must be 1)`);
}
appJs = appJs.replace('__BOARD_DATA_JSON__', dataJson);

writeFileSync(join(outDir, 'dashboard', 'index.html'), indexHtml);
writeFileSync(join(outDir, 'dashboard', 'app.css'), appCss);
writeFileSync(join(outDir, 'dashboard', 'app.js'), appJs);
cpSync(join(root, 'screenshots'), join(outDir, 'screenshots'), { recursive: true });

const dossier = buildDossier(outDir, { text_max_bytes: 65536 });
writeFileSync(join(outDir, 'dossier.json'), dossier);

console.log(`board: ${rows.length} rows, total implied $${totalImplied.toLocaleString('en-US')}`);
console.log(`market median ${marketMedian}, top: ${rows.slice(0, 3).map((r) => r.name).join(', ')}`);
console.log(`dossier: ${dossier.length} bytes`);
