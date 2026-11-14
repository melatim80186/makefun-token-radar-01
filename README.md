# Token Radar — pre-token protocols ranked by implied value

Entry for make.fun competition **token-radar-01** ("Build the best token launch radar").

## What it does

`main.ts` (Node 22, standard library only) reads the sealed DefiLlama snapshot
(`/input/snapshot.json`), scores every protocol on the watchlist plus every rankable
pre-token protocol below the watchlist floor, and writes the ranked board to
`/output/board.json`, the dashboard's data to `/output/data.js`, and the judge's
summary to `/output/dossier.json` (via `vendor/makefun-board.ts`).

## The model (radar-2)

Implied value is a model, not a promise — and no protocol name is ever special-cased:

```
implied = round(tvl_usd x multiple(category) x growth x maturity x chains)
```

- **multiple(category)**: the category's own FDV/TVL — the median `mcap_usd / tvl_usd`
  of the protocols in that category whose token already trades, each peer ratio capped
  at 2.0x first, shrunk toward the whole market median (0.2138) with 3 peers' worth of
  weight, capped at 1.0 and floored at 0.02. A category with no tokenized peer takes the
  market median. Derived from the snapshot at run time; nothing is hardcoded.
- **growth**: `1 + clamp(change_7d, -50, 100) / 100 x 0.5`
- **maturity**: `0.6 + min(age_days, 1095) / 1095 x 0.4` (unknown age: 365 days)
- **chains**: `1 + 0.02 x min(chains - 1, 5)`

## The board

**213 rows** — all 40 watchlist slugs plus 173 rankable pre-token protocols below the
$50M floor. Total implied value **$5,383,711,436**. Top 3: Steakhouse Financial
($1.58B), Gauntlet ($941M), Nonce Capital ($203M). Every row carries a 7-step farm plan
derived from the protocol's own category, chains, TVL and age.

Above the floor, only watchlist slugs are ranked: the house already left the wrapped
and staked products out (WBTC, Binance staked ETH, USDT0), and the snapshot names no
parent protocol to second-guess that with. The 24 largest live-token protocols are set
aside with their market caps, never mixed into the ranking.

## The dashboard

`dashboard/` is a static page with no network: a sortable, searchable, filterable board
(category / chain / watchlist-only / pre-token vs live tabs), a detail drawer per
protocol (full factor breakdown, a recompute check against `board.json`, and the 7-step
farm plan), and the model panel with the formula and the full derived-multiples table
(53 categories, peers and medians shown).

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Deterministic: two runs produce byte-identical output. Screenshots in `screenshots/`
(board, detail view, filtered view) are 1440x1000 renders of this dashboard.

## License

MIT.
