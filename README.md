# Token Radar — pre-token protocols ranked by implied value

A token-launch radar over a sealed DefiLlama snapshot (758 protocols at or
above $5M TVL, 2026-11-14). The board ranks 213 pre-token protocols by the
implied value of the token they may one day issue, and gives each one a
seven-step farm plan. Twenty-four protocols whose token already trades are
set aside in a live view.

## The model (radar-2)

- **Multiple.** A category's FDV/TVL, derived at run time: the median of its
  tokenized protocols' market-cap/TVL ratios, each ratio capped at 2.0x
  first, shrunk toward the market median (0.2138x) with three peers' weight,
  capped at 1.0x and floored at 0.02x. A category with no tokenized peer
  takes the market median. No protocol name is ever special-cased.
- **Implied value.** `TVL × multiple × (1 + ½ of the 7-day TVL change,
  clamped to −50%…+100%) × (0.6 + age up to 3 years × 0.4) × (1 + 2% per
  extra chain, up to five)`, rounded to whole dollars. Unknown age counts
  as 365 days.
- **Board.** All 40 watchlist protocols, plus every rankable pre-token
  protocol below the $50M floor (pre-token, not a CEX, no version marker in
  the name, no whole word wrapped/staked/staking, no exchange-name prefix).
  Above the floor, only watchlist slugs are ranked.
- **Farm plans.** Seven steps per row: two category-aware actions, a
  second-chain move, a weekly multi-chain rotation, quests and points, a
  weekly check-in, and launch readiness. Every step names its cost and
  its time.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Node 22, standard library only. Writes `board.json`, `data.js`,
`dashboard/`, `screenshots/` and `dossier.json` (built last with
`buildDossier`) into the output directory. Deterministic: two runs write
identical bytes.

## The dashboard

Static page, no network. Sortable board (rank, name, TVL, 7-day change,
age, multiple, implied value), search plus category, chain and watchlist
filters, pre-token and live tabs, a detail drawer per protocol with the
full factor breakdown, a recompute check and the seven farm steps, and a
model panel with the formula and the derived-multiples table for all 53
categories. Deep links: `#p=<slug>`, `#category=…`, `#chain=…`,
`#watch=1`, `#tab=live`.

## Results on this snapshot

213 rows scored (173 early, 24 live set aside). Total implied value
$5,383,711,436. Top three: Steakhouse Financial $1,579,675,976, Gauntlet
$940,816,695, Nonce Capital $202,955,084.

Implied values are this radar's own claim from the snapshot's figures.
They do not predict whether or when a token is issued.
