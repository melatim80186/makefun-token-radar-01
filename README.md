# Token Radar — pre-token protocols ranked by expected value

[![make.fun](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/melatim80186/makefun-token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/melatim80186/makefun-token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01)

198 protocols record no token. Priced off the market's own curve, their
launches would be worth $2.00B — but a launch is only worth something if a
token ever appears. This board ranks by **expected value**: launch value
times the share of the protocol's category that already records a token.
Total expected value: $279.6M. One program, Node 22 stdlib only, `main.ts`
at the repo root: it reads the sealed DefiLlama snapshot (758 protocols
≥ $5M TVL, floor $50M, watchlist 40), fits the model, scores the board and
writes `board.json` + the dashboard + `dossier.json`.

## The model

The snapshot's own trading protocols price the launches. A log-log fit of
market cap on TVL over the 128 protocols whose token trades:

```
log10(market cap) = 3.0247 + 0.5223 * log10(TVL)
```

Each category's effect is its mean log-residual against that curve, shrunk
toward the curve with 4 pseudo-comps. Then the odds: for each category, the
share of the snapshot's protocols in it that record a token market cap
(129 of 758 overall, 0.170), shrunk toward that global share with 10
pseudo-counts. The ranking value is the expected value:

```
multiple = 10^(a + b*log10(TVL) + category effect) / TVL
launch   = TVL * multiple * growth * maturity * chain
EV       = launch * P(token | category)
growth   = 1 + clamp(change_7d, -50, 100) / 100 * 0.5
maturity = 0.6 + min(age, 1095) / 1095 * 0.4   (unknown age = 365 days)
chain    = 1 + 0.02 * min(chains - 1, 5)
```

Age enters once, through maturity; the odds use category only, so age is
never double-counted. No protocol name is special-cased.

Validation, measured on the snapshot's own figures: leave-one-out error
×3.40 against ×5.07 for a flat median multiple; walk-forward (curve fitted
on comps listed before 2025, tested on 2025+ comps) ×3.08; the shrunk
category odds beat the base rate on Brier score (0.132 vs 0.141) and
log-loss (0.424 vs 0.456). Every row carries its P25–P75 band, so the
uncertainty is shown, not hidden.

## The board

198 rows: the 40 watchlist protocols plus every other pre-token protocol
that passes the watchlist's own tests (not a bridge, staked or CEX product;
no version marker, wrapped/staked wording or exchange prefix). 416 protocols
record a token and are set aside; 144 more are set aside by the rule. Each
row carries an 8-step farm plan with cost and time on every step, a farm
ticket (budget, hold days, setup time), and a verdict — Farm, Thin or Skip —
from expected-value terciles plus risk flags (thin evidence, young, low
token odds). An absolute EV-vs-ticket test would say farm on all 198 rows,
so it is not used.

## The dashboard

A research-note page: the finding up front, stat cards, the five biggest
expected values, a sortable/filterable board with a detail view per protocol
(factor breakdown, recompute check, farm plan), a model tab with the full
odds and category-effects tables plus the walk-forward and calibration
tables, and an already-trading tab. No network. Run it:

```
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Run twice: the outputs are byte-identical.

This board does not predict whether or when a token is issued. Its implied
values are the entry's own claim, never one make.fun makes.
