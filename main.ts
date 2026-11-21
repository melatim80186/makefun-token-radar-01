// main.ts — Token Radar v5 entry point. Node 22 stdlib only, no network.
// Reads the sealed DefiLlama snapshot, builds the board (comps curve +
// category token odds, ranked by expected value), writes board.json, the
// dashboard data, copies the dashboard + screenshots, and writes the
// dossier. Deterministic: two runs produce byte-identical outputs.
//
//   MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FARM_DEFAULT,
  FARM_FIRST,
  STEP_PATTERNS,
  buildBoard,
  type Snapshot,
} from "./lib/model.ts";
import { buildDossier } from "./vendor/makefun-board.ts";

const root = dirname(fileURLToPath(import.meta.url));

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] != null ? process.argv[i + 1]! : fallback;
}

const inputPath = arg("--input", "/input/snapshot.json");
const outDir =
  process.env.MAKEFUN_OUTPUT_DIR ?? arg("--output", "/output");

function fail(message: string): never {
  throw new Error(`main.ts: ${message}`);
}

function main(): void {
  if (!existsSync(inputPath)) fail(`snapshot not found: ${inputPath}`);
  const snapshot = JSON.parse(readFileSync(inputPath, "utf-8")) as Snapshot;
  const board = buildBoard(snapshot);
  const { rows, meta } = board;

  // --- Board validation: fail loudly rather than hand in a bad board. ---
  if (rows.length < 100) fail(`only ${rows.length} rows, need at least 100`);
  const evs = rows.map((r) => r.implied_value_usd);
  if (new Set(evs).size === 1) fail("all implied values are equal");
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    if (r.rank !== i + 1) fail(`row ${r.slug} has rank ${r.rank}, expected ${i + 1}`);
    if (i > 0 && r.implied_value_usd > rows[i - 1]!.implied_value_usd)
      fail(`implied value rises at rank ${r.rank}: ${r.implied_value_usd} after ${rows[i - 1]!.implied_value_usd}`);
    if (r.implied_value_usd <= 0 || r.launch_value_usd <= 0) fail(`row ${r.slug} has a non-positive value`);
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12)
      fail(`row ${r.slug} has ${r.farm_steps.length} farm steps`);
    for (const step of r.farm_steps) {
      const t = step.trim();
      if (t.length < 20 || t.length > 600)
        fail(`row ${r.slug} has a farm step of ${t.length} chars`);
    }
  }
  const watchMissing = snapshot.watchlist.filter((s) => !rows.some((r) => r.slug === s));
  if (watchMissing.length > 0)
    fail(`watchlist not fully covered: missing ${watchMissing.join(", ")}`);

  mkdirSync(outDir, { recursive: true });
  mkdirSync(join(outDir, "dashboard"), { recursive: true });
  mkdirSync(join(outDir, "screenshots"), { recursive: true });

  // board.json: the full board, one object per row, fixed key order.
  const boardJson = `${JSON.stringify(board, null, 2)}\n`;
  if (Buffer.byteLength(boardJson, "utf-8") > 8 * 1024 * 1024)
    fail("board.json exceeds 8 MiB");
  writeFileSync(join(outDir, "board.json"), boardJson);

  // dashboard/data.js: compact arrays the page renders and recomputes from.
  // The page re-derives the factor breakdown, the ticket, the verdict and
  // the farm steps from these rows plus the tables below, so the numbers it
  // shows are the board's numbers, not a second copy of them.
  const chains = [...new Set(rows.flatMap((r) => r.chains))].sort();
  const chainIdx = new Map(chains.map((c, i) => [c, i]));
  const catIdx = new Map(meta.categories.map((c, i) => [c.name, i]));
  const payload = {
    meta: {
      asOf: meta.asOf,
      rows: meta.rows,
      totalLaunch: meta.totalLaunch,
      totalEv: meta.totalEv,
      comps: meta.comps,
      liveToken: meta.liveToken,
      tokenized: meta.tokenized,
      setAside: meta.setAside,
      watchlistN: meta.watchlistN,
      watchlist: meta.watchlist,
      globalP: meta.globalP,
      oddsK: meta.oddsK,
      curve: meta.curve,
      walkForward: meta.walkForward,
      calibration: meta.calibration,
      live: meta.live,
      categories: meta.categories.map((c) => [
        c.name,
        c.n,
        c.k,
        c.p,
        c.lo,
        c.hi,
        c.peers,
        c.adjDex,
      ]),
      chains,
      templates: FARM_FIRST,
      templateDefault: FARM_DEFAULT,
      stepPatterns: STEP_PATTERNS,
    },
    rows: rows.map((r) => [
      r.slug,
      r.name,
      catIdx.get(r.category) ?? -1,
      r.chains.map((c) => chainIdx.get(c) ?? -1),
      r.tvl,
      r.change7d,
      r.ageDays,
      r.launch_value_usd,
      r.implied_value_usd,
    ]),
  };
  cpSync(join(root, "dashboard"), join(outDir, "dashboard"), { recursive: true });
  writeFileSync(
    join(outDir, "dashboard", "data.js"),
    `window.BOARD = ${JSON.stringify(payload)};\n`,
  );
  cpSync(join(root, "screenshots"), join(outDir, "screenshots"), { recursive: true });

  // dossier.json, with a guard: the run must fail if any dashboard source
  // was cut from the dossier text.
  const dossier = buildDossier(outDir, { text_max_bytes: 65536 });
  const dossierText = (JSON.parse(Buffer.from(dossier).toString("utf-8")) as { text: string })
    .text;
  if (dossierText.includes("[Cut at") || dossierText.includes("lines not shown.]"))
    fail("dossier text was cut — the dashboard source does not fit in 65,536 bytes");
  writeFileSync(join(outDir, "dossier.json"), Buffer.from(dossier));

  const textBytes = Buffer.byteLength(dossierText, "utf-8");
  console.log(
    `token-radar v5: ${rows.length} rows, total launch $${meta.totalLaunch.toLocaleString("en-US")}, ` +
      `total EV $${meta.totalEv.toLocaleString("en-US")}, top ${rows
        .slice(0, 3)
        .map((r) => r.slug)
        .join(", ")}`,
  );
  console.log(
    `curve a=${meta.curve.a.toFixed(4)} b=${meta.curve.b.toFixed(4)} LOO x${meta.curve.looX.toFixed(2)} ` +
      `flat x${meta.curve.flatX.toFixed(2)} walk-forward x${meta.walkForward.errX.toFixed(2)}`,
  );
  console.log(
    `dossier ${dossier.length} bytes, text ${textBytes} bytes (cap 65,536), ` +
      `board.json ${Buffer.byteLength(boardJson, "utf-8")} bytes`,
  );
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
