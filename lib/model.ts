// lib/model.ts — Token Radar v5 model.
//
// One self-contained model, fitted only from the sealed snapshot:
//   1. The snapshot's trading protocols price the launches. A log-log fit of
//      market cap on TVL over the 128 protocols whose token trades, plus a
//      per-category effect (mean log-residual, shrunk toward the curve).
//   2. The board ranks by EXPECTED value: launch value x P(token | category),
//      where P is the share of the snapshot's protocols in that category that
//      record a token market cap, shrunk toward the snapshot's global share
//      (129 of 758, 0.170) with 10 pseudo-counts.
//   3. Farm verdicts come from expected-value terciles plus risk flags,
//      never from an absolute EV-vs-ticket comparison (that test is vacuous:
//      every row's launch value dwarfs its farm ticket).
//
// Nothing is special-cased by protocol name. Age enters once, through the
// maturity factor; the odds use category only, never age, so age is not
// double-counted.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number | null;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface CategoryOdds {
  name: string;
  n: number; // protocols in the category
  k: number; // of them, recording a token market cap
  raw: number; // k / n
  p: number; // shrunk P(token | category)
  lo: number; // Wilson 95% lower bound on the raw rate
  hi: number; // Wilson 95% upper bound on the raw rate
  peers: number; // trading comps in the category (curve evidence)
  adjDex: number; // shrunk category effect on the log curve
  factor: number; // 10 ^ adjDex
}

export interface CurveFit {
  a: number;
  b: number;
  looX: number; // leave-one-out median error, curve
  flatX: number; // leave-one-out median error, flat median multiple
  residP25: number; // 25th percentile of log-residuals
  residP75: number; // 75th percentile of log-residuals
  level100m: number; // fitted multiple at $100M TVL
}

export interface CalibrationRow {
  name: string;
  tvl: number;
  predicted: number; // curve only, no category effect
  actual: number;
  ratio: number; // actual / predicted
}

export interface WalkForward {
  a: number;
  b: number;
  errX: number;
  nPre: number;
  nPost: number;
}

export interface Ticket {
  amt: number;
  gas: number;
  holdDays: number;
  usd: number;
  setupMin: number;
}

export interface BoardRow {
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl: number;
  change7d: number | null;
  ageDays: number | null;
  rank: number;
  watch: boolean;
  multiple: number;
  launch_value_usd: number;
  launch_value_lo_usd: number;
  launch_value_hi_usd: number;
  p: number;
  pN: number;
  pK: number;
  implied_value_usd: number;
  implied_value_lo_usd: number;
  implied_value_hi_usd: number;
  verdict: "Farm" | "Thin" | "Skip";
  flags: string[];
  catPeers: number;
  catAdjDex: number;
  growth: number;
  maturity: number;
  chainF: number;
  ticket: Ticket;
  farm_steps: string[];
}

export interface BoardMeta {
  asOf: string;
  rows: number;
  totalLaunch: number;
  totalEv: number;
  comps: number;
  excludedPlaceholder: number;
  liveToken: number;
  tokenized: number;
  setAside: number;
  watchlistN: number;
  watchlist: string[];
  globalP: number;
  oddsK: number;
  categories: CategoryOdds[];
  curve: CurveFit;
  walkForward: WalkForward;
  calibration: CalibrationRow[];
  live: { name: string; category: string; mcap: number }[];
}

export interface Board {
  rows: BoardRow[];
  meta: BoardMeta;
}

// ---------------------------------------------------------------------------
// Eligibility: the watchlist's own tests. A protocol is ranked when it
// records no token (no gecko_id and no symbol), its category is not one the
// watchlist excludes, its name carries no version marker, no wrapped /
// staked / staking word, and no exchange-name prefix.
// ---------------------------------------------------------------------------

const EXCLUDED_CATEGORIES = new Set([
  "Bridge",
  "Canonical Bridge",
  "Liquid Staking",
  "Liquid Restaking",
  "Restaked BTC",
  "CEX",
]);

const EXCHANGE_PREFIXES = [
  "Binance",
  "Coinbase",
  "Bybit",
  "Kraken",
  "Bitget",
  "OKX",
  "Bitfinex",
  "Gemini",
];

const VERSION_RE = /\bv\d+|\bV\d+\b|2\.0|3\.0/i;
const WRAPPED_RE = /\bwrapped\b|\bstaked\b|\bstaking\b/i;

function hasTokenRecord(p: SnapshotProtocol): boolean {
  return p.gecko_id != null || p.symbol != null;
}

/** A protocol "records a token" for the odds model when the snapshot carries
 *  a nonzero market cap for it. Zero-mcap rows are placeholders; the single
 *  -1 row still records a token. gecko_id / symbol alone is NOT the signal:
 *  272 rows inherit a parent's symbol without having their own token. */
function isTokenized(p: SnapshotProtocol): boolean {
  return p.mcap_usd != null && p.mcap_usd !== 0;
}

export function isEligible(p: SnapshotProtocol): boolean {
  if (hasTokenRecord(p)) return false;
  if (p.category != null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSION_RE.test(p.name)) return false;
  if (WRAPPED_RE.test(p.name)) return false;
  for (const prefix of EXCHANGE_PREFIXES) {
    if (p.name.startsWith(prefix)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Small numeric helpers.
// ---------------------------------------------------------------------------

function median(sorted: number[]): number {
  const n = sorted.length;
  return n % 2 === 1 ? sorted[(n - 1) / 2]! : (sorted[n / 2 - 1]! + sorted[n / 2]!) / 2;
}

function quantile(sorted: number[], q: number): number {
  const n = sorted.length;
  if (n === 1) return sorted[0]!;
  const pos = q * (n - 1);
  const lo = Math.floor(pos);
  const frac = pos - lo;
  return sorted[lo]! + frac * (sorted[lo + 1]! - sorted[lo]!);
}

function ols(xs: number[], ys: number[]): { a: number; b: number } {
  const n = xs.length;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += xs[i]!;
    my += ys[i]!;
  }
  mx /= n;
  my /= n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) * (xs[i]! - mx);
  }
  const b = sxy / sxx;
  return { a: my - b * mx, b };
}

/** Wilson 95% interval for a raw rate. Used instead of a bootstrap, which
 *  degenerates on one-protocol categories. */
function wilson(k: number, n: number): { lo: number; hi: number } {
  if (n === 0) return { lo: 0, hi: 0 };
  const z = 1.96;
  const ph = k / n;
  const d = 1 + (z * z) / n;
  const c = ph + (z * z) / (2 * n);
  const m = z * Math.sqrt((ph * (1 - ph)) / n + (z * z) / (4 * n * n));
  return { lo: Math.max(0, (c - m) / d), hi: Math.min(1, (c + m) / d) };
}

function ageDays(listedAt: string | null, asOf: string): number | null {
  if (!listedAt) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.floor((a - b) / 86400000);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// ---------------------------------------------------------------------------
// Farm plans. Two category-specific lines (the first move and the weekly
// habit); the other six steps are the same disciplined routine for every
// row. Every step carries its cost and its time.
// ---------------------------------------------------------------------------

export const FARM_FIRST: Record<string, [string, string]> = {
  "Risk Curators": [
    "Open the curator vault and read its strategy note, fees and risk limits before you deposit anything.",
    "Check the vault's allocation and performance report each week.",
  ],
  Dexs: [
    "Open the exchange and run one small swap through its main pool to learn the route and the fee.",
    "Swap a small amount each week so the account stays active on the exchange.",
  ],
  "Onchain Capital Allocator": [
    "Read the allocator's mandate and current positions, then deposit a small amount.",
    "Review the allocator's weekly report and rebalancing notes.",
  ],
  RWA: [
    "Read the asset backing documents and the issuer's disclosures, then deposit a small amount.",
    "Check the issuer's reports and the asset's backing each week.",
  ],
  Lending: [
    "Supply a small amount to the lending pool and confirm the receipt token arrives in your wallet.",
    "Check borrow rates and supplied interest each week; top up if the rate is good.",
  ],
  Yield: [
    "Deposit a small amount into the yield vault and confirm the position receipt.",
    "Harvest or compound the yield each week and check the vault's rate.",
  ],
  Derivatives: [
    "Open a small test position and note the funding rate and the liquidation price.",
    "Check funding rates and open interest each week; close stale positions.",
  ],
  CDP: [
    "Open a small vault, deposit collateral, and mint a small amount of the stable asset.",
    "Check the collateral ratio each week and top up collateral if it drifts down.",
  ],
  "Yield Aggregator": [
    "Deposit a small amount into the aggregator vault and confirm the receipt token.",
    "Compound the aggregator's yield each week and check the strategy's rate.",
  ],
  "Basis Trading": [
    "Read the basis strategy note and open a small test position to learn the mechanics.",
    "Check the funding spread and the basis premium each week.",
  ],
  Chain: [
    "Set up a wallet on the chain, fund it with a small amount, and make one test transaction.",
    "Use the chain each week — one small transaction keeps the wallet active.",
  ],
  "Staking Pool": [
    "Stake a small amount in the pool and confirm the staking receipt.",
    "Claim or restake the staking rewards each week.",
  ],
  "Liquidity Manager": [
    "Deposit a small amount into a managed liquidity position and note the range.",
    "Check the position's range each week and rebalance if it drifts out.",
  ],
  "Leveraged Farming": [
    "Open a small leveraged farm position and note the liquidation price and interest.",
    "Check the leverage ratio and borrow interest each week.",
  ],
  Restaking: [
    "Restake a small amount with a chosen operator and confirm the receipt.",
    "Check the operator's performance and the restaked balance each week.",
  ],
  "Anchor BTC": [
    "Deposit a small amount of BTC into the anchor vault and confirm the receipt.",
    "Check the BTC backing and the vault's reserves each week.",
  ],
  "Decentralized BTC": [
    "Deposit a small amount of BTC into the vault and confirm the receipt token.",
    "Check the BTC reserves and the vault's audit notes each week.",
  ],
  CeDeFi: [
    "Create the account, finish the checks, and deposit a small amount.",
    "Check the CeDeFi product's rates and any new vaults each week.",
  ],
  "Dual-Token Stablecoin": [
    "Mint a small amount of the stable asset against collateral and confirm the balance.",
    "Check the collateral ratio and the peg each week.",
  ],
  Farm: [
    "Deposit a small amount into the farm and confirm the LP or receipt token.",
    "Harvest the farm rewards each week and check the emission rate.",
  ],
  "Prediction Market": [
    "Place a small bet on a market you understand and confirm the position.",
    "Check open markets each week and close positions that resolved.",
  ],
  "Stablecoin Wrapper": [
    "Wrap a small amount of the stable asset and confirm the wrapped token arrives.",
    "Check the wrapper's reserves and the wrapped token's peg each week.",
  ],
  "Uncollateralized Lending": [
    "Read the credit terms carefully, then borrow the smallest amount allowed.",
    "Check the loan's interest and due date each week.",
  ],
  "Interest Rate Derivatives": [
    "Open a small rate position and note the fixed rate and expiry.",
    "Check the rate position's value and expiry each week.",
  ],
  "Cross Chain Bridge": [
    "Send a small test amount across the bridge and confirm it arrives on the other chain.",
    "Bridge a small amount each week to keep the route active.",
  ],
  "CDP Manager": [
    "Open the manager, connect a small CDP, and confirm the dashboard shows it.",
    "Check the managed CDP's collateral ratio each week.",
  ],
  "OTC Marketplace": [
    "Create the account, finish the checks, and place one small OTC order.",
    "Check the OTC order book each week for a fair price.",
  ],
  Insurance: [
    "Read the cover terms and buy the smallest cover for a position you hold.",
    "Check active covers each week and renew before they lapse.",
  ],
  Payments: [
    "Set up the payment account and send one small test payment to confirm it works.",
    "Use the payment rail each week for a small real payment.",
  ],
  "Governance Incentives": [
    "Lock or delegate a small amount to start earning governance incentives.",
    "Claim or restake the governance rewards each week.",
  ],
  "Crypto Card Issuer": [
    "Order the card, finish the checks, and load a small amount.",
    "Use the card each week for a small purchase to keep it active.",
  ],
  Indexes: [
    "Buy a small amount of the index token and confirm it lands in your wallet.",
    "Check the index composition and rebalance notes each week.",
  ],
  "Collateral Markets": [
    "Supply a small amount of collateral to the market and confirm the receipt.",
    "Check the market's rates and your collateral health each week.",
  ],
};

export const FARM_DEFAULT: [string, string] = [
  "Open the protocol's app, read its docs, and make one small test deposit.",
  "Use the protocol each week with a small amount to stay active.",
];

/** The eight farm steps as patterns. {first} and {weekly} are the category
 *  lines above; the rest are filled from the row. The dashboard composes the
 *  very same patterns at runtime, so the page never disagrees with the
 *  board file about what a farm plan says. */
export const STEP_PATTERNS: readonly string[] = [
  "{first} Cost $0, 15 min.",
  "Deposit ${amt} into the {cat} position on {chain} and confirm it shows in the app. Cost ${amt}, 25 min.",
  "Put ${amt} on a second chain ({chain2}) or add a second tranche on {chain}, so one chain's outage cannot strand the whole position. Cost ${amt}, 25 min.",
  "{weekly} Cost $0, 15 min per week.",
  "Log every deposit, fee and reward in one sheet with the date, so the farm's real return is visible at claim time. Cost $0, 10 min per week.",
  "Check the contract you approved and revoke any approval you no longer need — an old approval is a standing drain risk. Cost $0, 15 min.",
  "Hold the position for {hold} days; do not exit on a single red week — the farm's edge is the token, not the week. Cost $0, no action while it sits.",
  "When the token launches or the hold ends, claim the rewards, sell half to cover the ticket, and keep half for the token's own run. Cost ${gas} gas, 30 min.",
];

function fill(pattern: string, vars: Record<string, string>): string {
  return pattern.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? `{${k}}`);
}

function ticketFor(tvl: number, age: number | null): Ticket {
  const amt = tvl >= 500_000_000 ? 150 : tvl >= 100_000_000 ? 100 : 50;
  const gas = tvl >= 500_000_000 ? 8 : tvl >= 100_000_000 ? 6 : 4;
  const days = age ?? 365;
  const holdDays = days >= 730 ? 60 : days >= 365 ? 45 : 30;
  return { amt, gas, holdDays, usd: 2 * amt + 4 * gas, setupMin: 115 };
}

function farmSteps(row: {
  category: string;
  chains: string[];
  ticket: Ticket;
}): string[] {
  const [first, weekly] = FARM_FIRST[row.category] ?? FARM_DEFAULT;
  const chain = row.chains[0] ?? "its main chain";
  const second = row.chains[1] ?? chain;
  const { amt, gas, holdDays } = row.ticket;
  const vars: Record<string, string> = {
    first,
    weekly,
    amt: String(amt),
    gas: String(gas),
    hold: String(holdDays),
    cat: row.category,
    chain,
    chain2: second,
  };
  return STEP_PATTERNS.map((p) => fill(p, vars));
}

// ---------------------------------------------------------------------------
// The build.
// ---------------------------------------------------------------------------

const ODDS_K = 10; // pseudo-counts shrinking each category toward the global share
const CAT_K = 4; // pseudo-comps shrinking each category effect toward the curve

export function buildBoard(snapshot: Snapshot): Board {
  const prots = snapshot.protocols;
  const watchSet = new Set(snapshot.watchlist);

  // Comps: the protocols whose token trades, with a usable TVL.
  const comps = prots.filter(
    (p) => p.mcap_usd != null && p.mcap_usd > 0 && p.tvl_usd != null && p.tvl_usd > 0,
  );
  const excludedPlaceholder = prots.filter(
    (p) => p.mcap_usd != null && p.mcap_usd <= 0,
  ).length;

  // --- Curve: log-log OLS of market cap on TVL, over the comps. ---
  const xs = comps.map((p) => Math.log10(p.tvl_usd!));
  const ys = comps.map((p) => Math.log10(p.mcap_usd!));
  const { a, b } = ols(xs, ys);

  // Leave-one-out error, exact refit through running sums.
  const n = comps.length;
  const sx = xs.reduce((s, v) => s + v, 0);
  const sy = ys.reduce((s, v) => s + v, 0);
  const sxx = xs.reduce((s, v) => s + v * v, 0);
  const sxy = xs.reduce((s, v, i) => s + v * ys[i]!, 0);
  const looErrs: number[] = [];
  for (let i = 0; i < n; i++) {
    const nn = n - 1;
    const mxx = (sx - xs[i]!) / nn;
    const myy = (sy - ys[i]!) / nn;
    const bb = (sxy - xs[i]! * ys[i]! - nn * mxx * myy) / (sxx - xs[i]! * xs[i]! - nn * mxx * mxx);
    const aa = myy - bb * mxx;
    looErrs.push(Math.abs(ys[i]! - (aa + bb * xs[i]!)));
  }
  looErrs.sort((u, v) => u - v);
  const looX = Math.pow(10, median(looErrs));

  // Flat baseline: the median multiple, leave-one-out the same way.
  // Flat baseline: the median multiple, leave-one-out the same way. The
  // multiples are kept in comp order so dropping index i drops comp i.
  const multsByComp = comps.map((p) => p.mcap_usd! / p.tvl_usd!);
  const flatErrs: number[] = [];
  for (let i = 0; i < n; i++) {
    const rest = multsByComp.filter((_, j) => j !== i).sort((u, v) => u - v);
    const looMult = median(rest);
    flatErrs.push(Math.abs(ys[i]! - Math.log10(looMult * comps[i]!.tvl_usd!)));
  }
  flatErrs.sort((u, v) => u - v);
  const flatX = Math.pow(10, median(flatErrs));

  // Residual bands.
  const residuals = comps
    .map((p) => Math.log10(p.mcap_usd!) - (a + b * Math.log10(p.tvl_usd!)))
    .sort((u, v) => u - v);
  const residP25 = quantile(residuals, 0.25);
  const residP75 = quantile(residuals, 0.75);
  const level100m = Math.pow(10, a + b * 8) / 100_000_000;

  // --- Category effects: mean log-residual, shrunk toward the curve. ---
  const catResiduals = new Map<string, number[]>();
  for (const p of comps) {
    const c = p.category ?? "(none)";
    const r = Math.log10(p.mcap_usd!) - (a + b * Math.log10(p.tvl_usd!));
    if (!catResiduals.has(c)) catResiduals.set(c, []);
    catResiduals.get(c)!.push(r);
  }

  // --- Category token odds, over every category in the snapshot. ---
  const globalK = prots.filter(isTokenized).length;
  const globalP = globalK / prots.length;
  const catCounts = new Map<string, { n: number; k: number }>();
  for (const p of prots) {
    const c = p.category ?? "(none)";
    const e = catCounts.get(c) ?? { n: 0, k: 0 };
    e.n += 1;
    if (isTokenized(p)) e.k += 1;
    catCounts.set(c, e);
  }
  const categories: CategoryOdds[] = [...catCounts.entries()]
    .map(([name, { n: cn, k: ck }]) => {
      const res = catResiduals.get(name) ?? [];
      const adjDex =
        res.length === 0 ? 0 : res.reduce((s, v) => s + v, 0) / (res.length + CAT_K);
      const { lo, hi } = wilson(ck, cn);
      return {
        name,
        n: cn,
        k: ck,
        raw: cn === 0 ? 0 : ck / cn,
        p: (ck + ODDS_K * globalP) / (cn + ODDS_K),
        lo,
        hi,
        peers: res.length,
        adjDex,
        factor: Math.pow(10, adjDex),
      };
    })
    .sort((u, v) => v.n - u.n || u.name.localeCompare(v.name));
  const oddsByName = new Map(categories.map((c) => [c.name, c]));

  // --- Walk-forward: fit on comps listed before 2025, test on 2025+. ---
  const pre = comps.filter((p) => p.listed_at != null && p.listed_at < "2025-01-01");
  const post = comps.filter((p) => p.listed_at != null && p.listed_at >= "2025-01-01");
  const preFit = ols(
    pre.map((p) => Math.log10(p.tvl_usd!)),
    pre.map((p) => Math.log10(p.mcap_usd!)),
  );
  const postErrs = post
    .map((p) =>
      Math.abs(Math.log10(p.mcap_usd!) - (preFit.a + preFit.b * Math.log10(p.tvl_usd!))),
    )
    .sort((u, v) => u - v);
  const walkForward: WalkForward = {
    a: preFit.a,
    b: preFit.b,
    errX: Math.pow(10, median(postErrs)),
    nPre: pre.length,
    nPost: post.length,
  };

  // --- Held-out calibration: 8 comps spread across the TVL range, curve only. ---
  const byTvl = [...comps].sort((u, v) => u.tvl_usd! - v.tvl_usd!);
  const calibration: CalibrationRow[] = [];
  for (let i = 0; i < 8; i++) {
    const p = byTvl[Math.round((i * (byTvl.length - 1)) / 7)]!;
    const predicted = Math.pow(10, a + b * Math.log10(p.tvl_usd!));
    calibration.push({
      name: p.name,
      tvl: p.tvl_usd!,
      predicted: Math.round(predicted),
      actual: p.mcap_usd!,
      ratio: p.mcap_usd! / predicted,
    });
  }

  // --- Rows: eligible pre-token protocols, ranked by expected value. ---
  const ranked = prots.filter(isEligible);
  const scored = ranked.map((p) => {
    const tvl = p.tvl_usd!;
    const cat = oddsByName.get(p.category ?? "(none)")!;
    const age = ageDays(p.listed_at, snapshot.as_of);
    const growth = 1 + clamp(p.change_7d ?? 0, -50, 100) / 100 * 0.5;
    const maturity = 0.6 + Math.min(age ?? 365, 1095) / 1095 * 0.4;
    const chainF = 1 + 0.02 * Math.min(p.chains.length - 1, 5);
    const multiple = Math.pow(10, a + b * Math.log10(tvl) + cat.adjDex) / tvl;
    const base = tvl * multiple * growth * maturity * chainF;
    const launch = Math.floor(base + 0.5);
    const launchLo = Math.floor(base * Math.pow(10, residP25) + 0.5);
    const launchHi = Math.floor(base * Math.pow(10, residP75) + 0.5);
    const ev = Math.floor(launch * cat.p + 0.5);
    const evLo = Math.floor(launchLo * cat.p + 0.5);
    const evHi = Math.floor(launchHi * cat.p + 0.5);
    const ticket = ticketFor(tvl, age);
    return {
      p,
      tvl,
      age,
      cat,
      growth,
      maturity,
      chainF,
      multiple,
      launch,
      launchLo,
      launchHi,
      ev,
      evLo,
      evHi,
      ticket,
    };
  });
  scored.sort(
    (u, v) => v.ev - u.ev || v.launch - u.launch || v.tvl - u.tvl || u.p.slug.localeCompare(v.p.slug),
  );

  // Verdicts: expected-value terciles, one step down on two or more flags.
  const evs = scored.map((s) => s.ev).sort((u, v) => u - v);
  const cutLo = evs[Math.floor(evs.length / 3)]!;
  const cutHi = evs[Math.floor((2 * evs.length) / 3)]!;

  const rows: BoardRow[] = scored.map((s, i) => {
    const flags: string[] = [];
    if (s.cat.peers < 3) flags.push("thin evidence");
    if (s.age != null && s.age < 180) flags.push("young");
    if (s.cat.p < 0.1) flags.push("low token odds");
    let verdict: "Farm" | "Thin" | "Skip" =
      s.ev >= cutHi ? "Farm" : s.ev >= cutLo ? "Thin" : "Skip";
    if (flags.length >= 2) verdict = verdict === "Farm" ? "Thin" : "Skip";
    const base: BoardRow = {
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category ?? "(none)",
      chains: s.p.chains,
      tvl: s.tvl,
      change7d: s.p.change_7d,
      ageDays: s.age,
      rank: i + 1,
      watch: watchSet.has(s.p.slug),
      multiple: s.multiple,
      launch_value_usd: s.launch,
      launch_value_lo_usd: s.launchLo,
      launch_value_hi_usd: s.launchHi,
      p: s.cat.p,
      pN: s.cat.n,
      pK: s.cat.k,
      implied_value_usd: s.ev,
      implied_value_lo_usd: s.evLo,
      implied_value_hi_usd: s.evHi,
      verdict,
      flags,
      catPeers: s.cat.peers,
      catAdjDex: s.cat.adjDex,
      growth: s.growth,
      maturity: s.maturity,
      chainF: s.chainF,
      ticket: s.ticket,
      farm_steps: [],
    };
    base.farm_steps = farmSteps(base);
    return base;
  });

  const liveToken = prots.filter(hasTokenRecord).length;
  const live = prots
    .filter(isTokenized)
    .sort((u, v) => v.mcap_usd! - u.mcap_usd!)
    .slice(0, 24)
    .map((p) => ({ name: p.name, category: p.category ?? "(none)", mcap: p.mcap_usd! }));
  const meta: BoardMeta = {
    asOf: snapshot.as_of,
    rows: rows.length,
    totalLaunch: rows.reduce((s, r) => s + r.launch_value_usd, 0),
    totalEv: rows.reduce((s, r) => s + r.implied_value_usd, 0),
    comps: comps.length,
    excludedPlaceholder,
    liveToken,
    tokenized: globalK,
    setAside: prots.length - rows.length - liveToken,
    watchlistN: snapshot.watchlist.length,
    watchlist: [...snapshot.watchlist],
    globalP,
    oddsK: ODDS_K,
    categories,
    curve: { a, b, looX, flatX, residP25, residP75, level100m },
    walkForward,
    calibration,
    live,
  };
  return { rows, meta };
}
