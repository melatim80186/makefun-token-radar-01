// main.ts — token-radar-01 entrypoint (Node 22, standard library only).
//
// Reads the sealed snapshot at --input (a file, or a directory holding
// snapshot.json), builds the radar-2 board, and writes /output:
//   board.json    the ranked board (213 rows)
//   data.js       window.RADAR for the dashboard
//   dashboard/    the static dashboard, copied from ./dashboard
//   screenshots/  the three screenshots, copied from ./screenshots
//   dossier.json  built last with buildDossier from vendor/makefun-board.ts
//
// The output directory comes from MAKEFUN_OUTPUT_DIR, or --output, or "out".
// The program refuses to write when the board fails validation or when
// fewer than three screenshots are staged.

import {
  cpSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { buildBoard, type Snapshot } from "./lib/model.ts";
import { buildDossier } from "./vendor/makefun-board.ts";

const ROOT = fileURLToPath(new URL(".", import.meta.url));

function parseArgs(argv: string[]): { input: string; output: string } {
  let input = "";
  let output = process.env.MAKEFUN_OUTPUT_DIR ?? "out";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--input" && i + 1 < argv.length) input = argv[++i];
    else if (argv[i].startsWith("--input=")) input = argv[i].slice("--input=".length);
    else if (argv[i] === "--output" && i + 1 < argv.length) output = argv[++i];
    else if (argv[i].startsWith("--output=")) output = argv[i].slice("--output=".length);
  }
  if (!input) throw new Error("usage: node main.ts --input <snapshot.json or directory>");
  return { input, output };
}

function loadSnapshot(input: string): Snapshot {
  let file = input;
  if (!file.endsWith(".json")) file = join(input, "snapshot.json");
  const raw = readFileSync(file, "utf8");
  const snapshot = JSON.parse(raw) as Snapshot;
  if (!Array.isArray(snapshot.protocols) || !Array.isArray(snapshot.watchlist)) {
    throw new Error(`${file} is not a token-radar snapshot`);
  }
  return snapshot;
}

function main(): void {
  const { input, output } = parseArgs(process.argv.slice(2));
  const snapshot = loadSnapshot(input);
  const board = buildBoard(snapshot);
  if (board.issues.length > 0) {
    for (const issue of board.issues) console.error(`board issue: ${issue}`);
    throw new Error(`refusing to write: ${board.issues.length} board issue(s)`);
  }

  const outDir = join(ROOT, output);
  mkdirSync(join(outDir, "dashboard"), { recursive: true });
  mkdirSync(join(outDir, "screenshots"), { recursive: true });

  // The ranked board, with its model metadata, pretty-printed for readers.
  const boardDoc = {
    as_of: snapshot.as_of,
    floor_usd: snapshot.floor_usd,
    row_count: board.rows.length,
    watchlist_covered: snapshot.watchlist.length,
    live_set_aside: board.live.length,
    total_implied_value_usd: board.totalImplied,
    market_median: board.marketMedian,
    multiples: board.multiples,
    live: board.live,
    rows: board.rows,
  };
  writeFileSync(join(outDir, "board.json"), JSON.stringify(boardDoc, null, 2) + "\n");

  // The dashboard's data, loaded by index.html as ../data.js. It lives
  // beside the dashboard directory, not inside it, so the dossier's text
  // stays under its cap and shows the dashboard's source whole.
  const radar = {
    as_of: snapshot.as_of,
    floor_usd: snapshot.floor_usd,
    market_median: board.marketMedian,
    total_implied_value_usd: board.totalImplied,
    multiples: board.multiples,
    rows: board.rows,
    live: board.live,
  };
  writeFileSync(join(outDir, "data.js"), `window.RADAR = ${JSON.stringify(radar)};\n`);

  // The dashboard and the screenshots, copied verbatim from the repo.
  cpSync(join(ROOT, "dashboard"), join(outDir, "dashboard"), { recursive: true });
  const shots = readdirSync(join(ROOT, "screenshots"))
    .filter((f) => /\.(png|jpe?g)$/i.test(f) && !f.startsWith("."))
    .sort();
  if (shots.length < 3) {
    throw new Error(`refusing to write: only ${shots.length} screenshot(s) staged, need at least 3`);
  }
  cpSync(join(ROOT, "screenshots"), join(outDir, "screenshots"), { recursive: true });

  // The dossier is built last, from the finished dashboard and screenshots.
  const dossier = buildDossier(outDir, {
    text_max_bytes: 65536,
    screenshots: { max: 4, max_bytes: 524288 },
    dashboard: { max_files: 400, max_bytes: 4194304 },
  });
  writeFileSync(join(outDir, "dossier.json"), Buffer.from(dossier));

  const early = board.rows.length - snapshot.watchlist.length;
  console.log(`${board.rows.length} rows scored (${early} early, ${board.live.length} live set aside)`);
  const top3 = board.rows.slice(0, 3)
    .map((r) => `${r.rank}. ${r.name} $${r.implied_value_usd.toLocaleString("en-US")}`)
    .join(", ");
  console.log(`top 3: ${top3}`);
}

main();
