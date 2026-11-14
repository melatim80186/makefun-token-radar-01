# Token Radar — pre-token protocols ranked by implied value

A token-launch radar over a sealed DefiLlama snapshot (758 protocols,
2026-11-14). The board ranks 198 pre-token protocols by the implied value
of the token they may one day issue, and gives each one a seven-step farm
plan. 416 protocols whose token already trades are set aside, never ranked.

## The model

- **Multiple.** A category's benchmark, derived at run time: the median of
  its tokenized protocols' market-cap/TVL ratios, each ratio capped at 2.0x
  first, shrunk toward the market median (0.2138x) with a prior weight of
  k = 3, floored at 0.02x, with no upper cap. A category with no tokenized
  peer takes the market median. No protocol name is ever special-cased.
  Thin evidence is stated plainly: Risk Curators rests on 1 peer (its ratio
  is capped at 2.0x), so its multiple is pulled most of the way toward the
  market median.
- **Implied value.** `TVL × multiple × (1 + ½ of the 7-day TVL change,
  clamped to −50%…+100%) × (0.6 + age up to 3 years × 0.4) × (1 + 2% per
  extra chain, up to five)`, rounded to whole dollars. Unknown age counts
  as 365 days.
- **Board.** All 40 watchlist protocols, plus every eligible pre-token
  protocol below the $50M floor: pre-token, not a bridge, liquid staking,
  liquid restaking, restaked-BTC or CEX protocol, no version marker in the
  name, no whole word wrapped/staked/staking, no exchange-name prefix.
  Above the floor, only watchlist slugs are ranked.
- **Farm plans.** Seven steps per row, generated from the snapshot's own
  figures: a category-specific action with a TVL-tier amount ($150/$100/$50
  of capital, about $8/$6/$4 of gas), a move across two of the protocol's
  venues, a weekly qualifying action rotating across two of its chains, a
  hold of 30/45/60 days by age, a warning to claim only from the
  protocol's own published link, and a farm log. Every step names its cost
  and its time.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Node 22, standard library only. Writes `board.json`, `dashboard/`,
`screenshots/` and `dossier.json` (built last with `buildDossier`) into
the output directory. Deterministic: two runs write identical bytes.

## The dashboard

Static page, no network. Stat cards (watchlist coverage, rows, early rows,
live-token protocols set aside, total implied value, median benchmark
multiple), sortable board (rank, name, TVL, 7-day change, age, multiple,
implied value), search plus category, chain and minimum-TVL filters,
pre-token and live-token pills, a detail view per protocol with the full
factor breakdown and the seven farm steps, a model panel with the formula
and the thin-evidence notes, and an Already trading tab listing the
largest live-token protocols set aside. Deep links: `#detail=<slug>`,
`#filter=<category>`.

## Results on this snapshot

198 rows scored (40 watchlist, 158 early; 416 live-token protocols set
aside). Total implied value $7,372,697,816. Top three: Steakhouse
Financial $1,579,675,976, Sentora Curator $1,462,331,560, Gauntlet
$940,816,695.

Implied values are this radar's own claim from the snapshot's figures.
They do not predict whether or when a token is issued.
