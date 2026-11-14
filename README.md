# Token Radar — pre-token protocols priced off the market's own curve

198 protocols record no token. Priced off the market's own curve, their
launches would be worth $2.00B. One program, Node 22 stdlib only, `main.ts`
at the repo root: it reads the sealed DefiLlama snapshot (758 protocols
≥ $5M TVL, floor $50M, watchlist 40), fits the comps curve, scores the board
and writes `board.json` + the dashboard + `dossier.json`.

## The model (comps-4)

The snapshot's own trading protocols price the launches. A log-log fit of
market cap on TVL over the 128 protocols whose token trades:

```
log10(market cap) = 3.0247 + 0.5223 * log10(TVL)
```

Each category's effect is its mean log-residual against that curve, shrunk
toward the curve with 4 pseudo-comps, so a category with one comp keeps
one-fifth of its own residual. No protocol name is special-cased and nothing
is hardcoded by category.

```
multiple = 10^(a + b*log10(TVL) + category effect) / TVL
implied  = round(TVL * multiple * growth * maturity * chain)
growth   = 1 + clamp(change_7d, -50, 100) / 100 * 0.5
maturity = 0.6 + min(age, 1095) / 1095 * 0.4   (unknown age = 365 days)
chain    = 1 + 0.02 * min(chains - 1, 5)
```

Validation, measured on the same 128 comps: leave-one-out error ×3.40
against ×4.86 for a flat median multiple. Every row carries its P25–P75
range from the comps' residual distribution, so the band is shown, not hidden.

## The board

198 rows: the 40 watchlist protocols plus every other pre-token protocol
that passes the watchlist's own tests (not a bridge, staked or CEX product;
no version marker, wrapped/staked wording or exchange prefix). 416 protocols
record a token and are set aside; 144 more are set aside by the rule. Each
row carries an 8-step farm plan with cost and time on every step, and a farm
ticket (budget, hold days, setup time).

## The dashboard

A research-note page: the finding up front, stat cards, the five biggest
launches, a distribution chart, a sortable/filterable board with a detail
view per protocol (factor breakdown, recompute check, farm plan), a model
tab with the full category-effects table, and an already-trading tab. No
network. Run it:

```
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Run twice: the outputs are byte-identical.
