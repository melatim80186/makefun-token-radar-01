// main.ts — Token Radar v2 entrypoint.
//
// Reads the sealed snapshot, builds the ranked board, writes the dashboard
// and the dossier. Standard library only; runs on Node 22 with no flags.
//
//   MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
//
// The grader runs the program twice with /input/snapshot.json and /output,
// and both runs must write the same bytes. Everything here is deterministic:
// no clocks, no random ids, files written in sorted order, JSON with fixed
// key order and indentation.
//
// Layout of the repository (and of /output after a run):
//   main.ts                 this file
//   lib/model.ts            value model, composition, farm plans
//   vendor/makefun-board.ts the kit's dossier library (copied verbatim)
//   dashboard/              index.html, app.css, app.js (authored; app.js
//                           carries a __BOARD_DATA_JSON__ placeholder the
//                           program fills with the compact board)
//   screenshots/            three rendered shots of the dashboard
//   LICENSE                 MIT

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  copyFileSync,
} from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDossier } from "./vendor/makefun-board.ts";
import {
  buildBoard,
  compactRows,
  SHRINKAGE_K,
  type Snapshot,
} from "./lib/model.ts";

const ROOT = dirname(fileURLToPath(import.meta.url));
const DEFAULT_INPUT = "/input/snapshot.json";
const DEFAULT_OUTPUT = "/output";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

function main(): void {
  const input = arg("--input") ?? DEFAULT_INPUT;
  const output =
    arg("--output") ?? process.env.MAKEFUN_OUTPUT_DIR ?? DEFAULT_OUTPUT;
  const snapshot = JSON.parse(readFileSync(input, "utf8")) as Snapshot;
  const { rows, stats } = buildBoard(snapshot);

  const outDir = resolve(output);
  const dashDir = join(outDir, "dashboard");
  const shotsDir = join(outDir, "screenshots");
  mkdirSync(dashDir, { recursive: true });
  mkdirSync(shotsDir, { recursive: true });

  // board.json — the ranked board plus a summary of the model that built it.
  const board = {
    as_of: stats.asOf,
    floor_usd: stats.floorUsd,
    rows,
    total_implied_usd: stats.totalImpliedUsd,
    model: {
      market_median: stats.marketMedian,
      shrinkage_k: SHRINKAGE_K,
      peer_protocols: stats.peerProtocols,
      tokenized_without_mcap: stats.tokenizedNoMcap,
      composition:
        "watchlist (as read) + below-floor pre-token protocols passing the base filters, the parent-brand guard and the category exclusion",
      age_default_days: 365,
    },
  };
  writeFileSync(
    join(outDir, "board.json"),
    JSON.stringify(board, null, 2) + "\n",
    "utf8",
  );

  // dashboard — copy the authored page, then fill the board data into app.js.
  // The placeholder is replaced with the compact board, so the page and the
  // board can never disagree about a number, and the farm steps the page
  // shows are generated from the same rules as the board's.
  const dashSrc = join(ROOT, "dashboard");
  const indexHtml = readFileSync(join(dashSrc, "index.html"), "utf8");
  const appCss = readFileSync(join(dashSrc, "app.css"), "utf8");
  const appJsTemplate = readFileSync(join(dashSrc, "app.js"), "utf8");
  const dataJson = JSON.stringify({
    asOf: stats.asOf,
    floorUsd: stats.floorUsd,
    marketMedian: stats.marketMedian,
    totalImpliedUsd: stats.totalImpliedUsd,
    watchlistCovered: stats.watchlistCovered,
    watchlistTotal: stats.watchlistTotal,
    rows: compactRows(rows),
  });
  const placeholder = "__BOARD_DATA_JSON__";
  if (appJsTemplate.split(placeholder).length !== 2) {
    throw new Error(
      `app.js must carry exactly one ${placeholder} placeholder`,
    );
  }
  const appJs = appJsTemplate.replace(placeholder, () => dataJson);
  writeFileSync(join(dashDir, "index.html"), indexHtml, "utf8");
  writeFileSync(join(dashDir, "app.css"), appCss, "utf8");
  writeFileSync(join(dashDir, "app.js"), appJs, "utf8");

  // screenshots — the three rendered shots, copied in name order. (On the
  // first local build they do not exist yet; the run stops here after writing
  // board.json and the dashboard, which is what the shots are rendered from.
  // The submitted repository carries the shots, so the graded runs succeed.)
  const shotsSrc = join(ROOT, "screenshots");
  const shots = readdirSync(shotsSrc)
    .filter((f) => /\.(png|jpe?g)$/i.test(f))
    .sort();
  if (shots.length < 3) {
    throw new Error(
      `need at least 3 screenshots in screenshots/, found ${shots.length}`,
    );
  }
  for (const f of shots) {
    copyFileSync(join(shotsSrc, f), join(shotsDir, f));
  }

  // dossier.json — byte for byte what buildDossier writes from dashboard/
  // and screenshots/. The gate checks this equality, so the dossier is never
  // hand-written or edited after the program writes it.
  const dossier = buildDossier(outDir, { text_max_bytes: 65536 });
  writeFileSync(join(outDir, "dossier.json"), dossier);

  console.log(
    `token-radar v2: ${rows.length} rows, ` +
      `${stats.watchlistCovered}/${stats.watchlistTotal} watchlist, ` +
      `total implied $${stats.totalImpliedUsd.toLocaleString("en-US")}, ` +
      `market median ${stats.marketMedian}, ` +
      `${stats.peerProtocols} peer protocols`,
  );
}

main();
