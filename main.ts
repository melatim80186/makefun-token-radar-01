// Token Radar v4 — entrypoint (Node 22, stdlib only).
//
// Reads the sealed snapshot, builds the comps-4 board with lib/model.ts and
// writes the graded outputs:
//
//   <out>/board.json        the ranked board (meta + 198 rows)
//   <out>/dashboard/        index.html + app.css + app.js + data.js
//   <out>/screenshots/      the three dashboard screenshots (copied)
//   <out>/dossier.json      buildDossier output over dashboard + screenshots
//
// Run from the repo root:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
//
// The run is deterministic: no clock, no randomness, no network. Running it
// twice writes the same bytes.

import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDossier } from "./vendor/makefun-board.ts";
import { buildBoard, type Snap } from "./lib/model.ts";

const repoRoot = dirname(fileURLToPath(import.meta.url));

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  if (i >= 0 && i + 1 < process.argv.length) return process.argv[i + 1];
  return fallback;
}

const inputPath = arg("--input", "/input/snapshot.json");
const outDir = resolve(
  arg("--output", process.env.MAKEFUN_OUTPUT_DIR ?? "/output")
);

const snap = JSON.parse(readFileSync(inputPath, "utf8")) as Snap;
const { rows, meta } = buildBoard(snap);

// ---- self-checks (the gate's shape, checked before anything is written)
if (rows.length < 100 || rows.length > 4000) {
  throw new Error(`board has ${rows.length} rows, outside 100-4000`);
}
rows.forEach((r, i) => {
  if (r.rank !== i + 1) throw new Error(`rank break at ${r.slug}`);
  if (i > 0 && r.implied_value_usd > rows[i - 1].implied_value_usd) {
    throw new Error(`implied rises at rank ${r.rank}`);
  }
  if (r.farm_steps.length < 3 || r.farm_steps.length > 12) {
    throw new Error(`farm_steps count ${r.farm_steps.length} at ${r.slug}`);
  }
  for (const s of r.farm_steps) {
    const t = s.trim();
    if (t.length < 20 || t.length > 600) {
      throw new Error(`farm step length ${t.length} at ${r.slug}`);
    }
  }
});
const watchCovered = rows.filter((r) => r.watchlist).length;
if (watchCovered !== snap.watchlist.length) {
  throw new Error(`watchlist ${watchCovered}/${snap.watchlist.length}`);
}
if (new Set(rows.map((r) => r.implied_value_usd)).size === 1) {
  throw new Error("all implied values identical — not a ranking");
}

// ---- compact positional rows for the dashboard (keeps the dossier small)
// [slug, name, catIdx, chainsJoined, tvl, chg, age, mult, imp, watch]
// The P25-P75 band is NOT stored per row: the page recomputes it as
// imp x residP25 / residP75 from meta (the same ratios board.json used).
const catNames: string[] = [];
const catIndex = new Map<string, number>();
for (const r of rows) {
  const c = r.category ?? "(none)";
  if (!catIndex.has(c)) {
    catIndex.set(c, catNames.length);
    catNames.push(c);
  }
}
const compactRows = rows.map((r) => [
  r.slug,
  r.name,
  catIndex.get(r.category ?? "(none)") as number,
  r.chains.join("|"),
  r.tvl_usd,
  r.change_7d,
  r.age_days,
  r.multiple,
  r.implied_value_usd,
  r.watchlist ? 1 : 0,
]);
// [name, comps, rawDex, adjDex, factor] per comps category (sorted by name).
const compactCats = meta.categories.map((c) => [
  c.name,
  c.comps,
  c.rawDex,
  c.adjDex,
  c.factor,
]);
// Farm ticket per row is NOT stored: the page recomputes it from the row's
// own TVL tier and age with the same tierOf/holdDaysOf rules (see app.js).
// Live-token protocols set aside, top 12 by mcap (name, category, tvl, mcap).
const liveTop = snap.protocols
  .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0)
  .sort((a, b) => (b.mcap_usd as number) - (a.mcap_usd as number))
  .slice(0, 12)
  .map((p) => [p.name, p.category ?? "(none)", p.tvl_usd, p.mcap_usd]);

const boardData = {
  meta: {
    rows: meta.rows,
    totalImplied: meta.totalImplied,
    asOf: meta.asOf,
    comps: meta.comps,
    excludedPlaceholder: meta.excludedPlaceholder,
    curveA: meta.curveA,
    curveB: meta.curveB,
    level100m: meta.level100m,
    looX: meta.looX,
    flatX: meta.flatX,
    residP25: meta.residP25,
    residP75: meta.residP75,
    liveToken: meta.liveToken,
    setAside: meta.setAside,
    watchlistN: meta.watchlistN,
  },
  cats: catNames,
  effects: compactCats,
  liveTop,
  rows: compactRows,
};

// ---- write outputs
mkdirSync(outDir, { recursive: true });
mkdirSync(join(outDir, "dashboard"), { recursive: true });
mkdirSync(join(outDir, "screenshots"), { recursive: true });
writeFileSync(
  join(outDir, "board.json"),
  JSON.stringify({ meta, rows }, null, 2) + "\n",
  "utf8"
);
writeFileSync(
  join(outDir, "dashboard", "data.js"),
  "window.BOARD=" + JSON.stringify(boardData) + ";\n",
  "utf8"
);
for (const f of ["index.html", "app.css", "app.js"]) {
  cpSync(join(repoRoot, "dashboard", f), join(outDir, "dashboard", f));
}
const shotsDir = join(repoRoot, "screenshots");
if (existsSync(shotsDir)) {
  cpSync(shotsDir, join(outDir, "screenshots"), { recursive: true });
}
const dossier = buildDossier(outDir, { text_max_bytes: 65536 });
writeFileSync(join(outDir, "dossier.json"), dossier);

// Dossier text must fit whole: buildDossier cuts files past the cap and
// leaves a "[Cut at" line instead of failing, so detect the cut itself.
const parsed = JSON.parse(new TextDecoder().decode(dossier)) as {
  text?: string;
};
const textBytes = parsed.text
  ? new TextEncoder().encode(parsed.text).length
  : -1;
if (textBytes > 65536 || (parsed.text ?? "").includes("[Cut at")) {
  throw new Error(
    `dossier text cut or over cap (${textBytes} B) — dashboard source must fit whole under 65536`
  );
}

console.log(
  `${rows.length} rows scored (${meta.watchlistN} watchlist, ${
    rows.length - meta.watchlistN
  } early, ${meta.liveToken} live set aside)`
);
console.log(
  `total implied $${meta.totalImplied.toLocaleString("en-US")} | ` +
    `curve log10(mcap) = ${meta.curveA} + ${meta.curveB} * log10(tvl) | ` +
    `level @ $100M ${meta.level100m}x | LOO x${meta.looX} vs flat x${meta.flatX}`
);
console.log(
  "top 3: " +
    rows
      .slice(0, 3)
      .map((r) => `${r.name} $${r.implied_value_usd.toLocaleString("en-US")}`)
      .join(" / ")
);
console.log(
  `dossier ${dossier.length} B, text ${textBytes} B (cap 65536), ` +
    `dashboard files copied, screenshots copied`
);
