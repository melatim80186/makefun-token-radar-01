// Token Radar v4 — comps-4 model (pure TS, no Node APIs).
//
// The implied value of a pre-token protocol is priced off the market's own
// curve: the 128 snapshot protocols whose token already trades give a
// log-log fit of market cap on TVL, and each category's effect is its mean
// log-residual, shrunk toward the curve with 4 pseudo-comps. Nothing is
// hardcoded by protocol name or by category: every number below is fitted
// from the sealed snapshot at run time.
//
//   log10(mcap) = a + b * log10(tvl)          (OLS over the 128 comps)
//   multiple    = 10^(a + b*log10(tvl) + adj_category) / tvl
//   implied     = round(tvl * multiple * growth * maturity * chain)
//
// growth   = 1 + clamp(change_7d, -50, 100) / 100 * 0.5   (null -> 0)
// maturity = 0.6 + min(age_days, 1095) / 1095 * 0.4        (null age -> 365d)
// chain    = 1 + 0.02 * min(chains - 1, 5)
//
// Uncertainty: P25/P75 of the comps' actual/predicted ratios, applied to the
// implied value. Validation: exact leave-one-out refit per comp, median
// |log10 error|, against a flat-median-ratio baseline.

export interface Proto {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snap {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Proto[];
  watchlist: string[];
}

export interface CatEffect {
  name: string;
  comps: number;
  rawDex: number;
  adjDex: number;
  factor: number;
}

export interface Fit {
  comps: number;
  excludedPlaceholder: number;
  a: number;
  b: number;
  level100m: number;
  looX: number;
  flatX: number;
  flatRatio: number;
  residP25: number;
  residP75: number;
  effects: CatEffect[];
}

export interface RowModel {
  catPeers: number;
  catAdjDex: number;
  growth: number;
  maturity: number;
  chain: number;
}

export interface Ticket {
  usd: number;
  holdDays: number;
  setupMin: number;
}

export interface BoardRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  multiple: number;
  implied_value_usd: number;
  implied_lo_usd: number;
  implied_hi_usd: number;
  rank: number;
  watchlist: boolean;
  model: RowModel;
  farm_steps: string[];
  ticket: Ticket;
}

export interface BoardMeta {
  rows: number;
  totalImplied: number;
  asOf: string;
  comps: number;
  excludedPlaceholder: number;
  curveA: number;
  curveB: number;
  level100m: number;
  looX: number;
  flatX: number;
  residP25: number;
  residP75: number;
  liveToken: number;
  setAside: number;
  watchlistN: number;
  categories: CatEffect[];
}

export const SHRINK_K = 4;
export const AGE_DEFAULT_DAYS = 365;
export const AGE_CAP_DAYS = 1095;

// ---------------------------------------------------------------- numbers

export function round4(x: number): number {
  return Math.floor(x * 10000 + 0.5) / 10000;
}

export function median(xs: number[]): number {
  const s = [...xs].sort((p, q) => p - q);
  const n = s.length;
  if (n === 0) return 0;
  if (n % 2 === 1) return s[(n - 1) / 2];
  return (s[n / 2 - 1] + s[n / 2]) / 2;
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

function log10(x: number): number {
  return Math.log(x) / Math.LN10;
}

// ---------------------------------------------------------------- eligibility

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

const VERSION_MARKER = /\s+(V\d+|v\d+|\d+\.\d+(\.\d+)?)$/;

export function isPreToken(p: Proto): boolean {
  return p.gecko_id === null && p.symbol === null;
}

export function isEligible(p: Proto): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSION_MARKER.test(p.name)) return false;
  const words = p.name.toLowerCase().split(/[^A-Za-z]+/);
  if (words.includes("wrapped") || words.includes("staked") || words.includes("staking")) return false;
  for (const ex of EXCHANGE_PREFIXES) {
    if (p.name.startsWith(ex)) return false;
  }
  return true;
}

// ---------------------------------------------------------------- comps fit

export function fitCurve(snap: Snap): Fit {
  const comps = snap.protocols.filter(
    (p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0
  );
  const excludedPlaceholder = snap.protocols.filter(
    (p) => p.mcap_usd !== null && p.mcap_usd <= 0
  ).length;
  const n = comps.length;
  const xs = comps.map((p) => log10(p.tvl_usd));
  const ys = comps.map((p) => log10(p.mcap_usd as number));
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) * (xs[i] - mx);
    sxy += (xs[i] - mx) * (ys[i] - my);
  }
  const b = sxy / sxx;
  const a = my - b * mx;
  const resid = ys.map((y, i) => y - (a + b * xs[i]));

  // Category effects: mean residual, shrunk toward 0 with SHRINK_K pseudo-comps.
  const byCat = new Map<string, number[]>();
  comps.forEach((p, i) => {
    const c = p.category === null ? "(none)" : p.category;
    if (!byCat.has(c)) byCat.set(c, []);
    byCat.get(c)!.push(resid[i]);
  });
  const effects: CatEffect[] = [];
  for (const [name, rs] of [...byCat.entries()].sort((p, q) => (p[0] < q[0] ? -1 : 1))) {
    const sum = rs.reduce((s, r) => s + r, 0);
    const raw = sum / rs.length;
    const adj = sum / (rs.length + SHRINK_K);
    effects.push({
      name,
      comps: rs.length,
      rawDex: round4(raw),
      adjDex: round4(adj),
      factor: round4(Math.pow(10, adj)),
    });
  }

  // Exact leave-one-out refit per comp (closed-form OLS sums).
  const sx = xs.reduce((s, x) => s + x, 0);
  const sy = ys.reduce((s, y) => s + y, 0);
  const sxxRaw = xs.reduce((s, x) => s + x * x, 0);
  const sxyRaw = xs.reduce((s, x, i) => s + x * ys[i], 0);
  const looErrs: number[] = [];
  for (let i = 0; i < n; i++) {
    const nn = n - 1;
    const mxx = (sx - xs[i]) / nn;
    const myy = (sy - ys[i]) / nn;
    const bb =
      (sxyRaw - xs[i] * ys[i] - nn * mxx * myy) /
      (sxxRaw - xs[i] * xs[i] - nn * mxx * mxx);
    const aa = myy - bb * mxx;
    looErrs.push(Math.abs(ys[i] - (aa + bb * xs[i])));
  }
  const looX = Math.pow(10, median(looErrs));

  // Flat baseline: the median mcap/tvl ratio, same comps.
  const ratios = comps.map((p) => (p.mcap_usd as number) / p.tvl_usd);
  const flatRatio = median(ratios);
  const flatErrs = comps.map((p) =>
    Math.abs(log10((p.mcap_usd as number) / (flatRatio * p.tvl_usd)))
  );
  const flatX = Math.pow(10, median(flatErrs));

  // Residual-ratio quantiles for the P25-P75 band (indices n/4 and 3n/4).
  const rr = resid.map((r) => Math.pow(10, r)).sort((p, q) => p - q);
  const residP25 = rr[Math.floor(n / 4)];
  const residP75 = rr[Math.floor((3 * n) / 4)];

  return {
    comps: n,
    excludedPlaceholder,
    a,
    b,
    level100m: Math.pow(10, a + b * 8) / 1e8,
    looX,
    flatX,
    flatRatio,
    residP25,
    residP75,
    effects,
  };
}

// ---------------------------------------------------------------- factors

export function ageDays(listedAt: string | null, asOf: string): number | null {
  if (listedAt === null) return null;
  const t0 = Date.parse(listedAt + "T00:00:00Z");
  const t1 = Date.parse(asOf + "T00:00:00Z");
  return Math.round((t1 - t0) / 86400000);
}

export function factors(p: Proto, asOf: string): {
  age: number | null;
  growth: number;
  maturity: number;
  chain: number;
} {
  const age = ageDays(p.listed_at, asOf);
  const effAge = age === null ? AGE_DEFAULT_DAYS : age;
  const chg = p.change_7d === null ? 0 : p.change_7d;
  return {
    age,
    growth: 1 + (clamp(chg, -50, 100) / 100) * 0.5,
    maturity: 0.6 + (Math.min(effAge, AGE_CAP_DAYS) / AGE_CAP_DAYS) * 0.4,
    chain: 1 + 0.02 * Math.min(p.chains.length - 1, 5),
  };
}

// ---------------------------------------------------------------- farm plans

export interface CatPlan {
  first: string;
  weekly: string;
}

// One entry per board category: the mechanism-specific first move and the
// weekly action. Phrasing is the entry's own; amounts, chains and hold days
// come from the row's own figures.
export const CAT_PLAN: Record<string, CatPlan> = {
  "Risk Curators": {
    first: "Open the curator vault on {chain} and read its strategy, fees, lock terms and past performance before depositing anything.",
    weekly: "check the vault's allocation and rebalance notes",
  },
  Dexs: {
    first: "Open the swap page on {chain} and place a small test swap to confirm the pool, the route and the slippage.",
    weekly: "swap a small amount or add liquidity to keep volume on the pair",
  },
  "Onchain Capital Allocator": {
    first: "Open the allocator vault on {chain} and read the mandate, the fee schedule and the redemption terms.",
    weekly: "review the vault's positions and reported yield",
  },
  RWA: {
    first: "Open the tokenised-asset page on {chain} and read the issuer, the custodian and the redemption terms.",
    weekly: "check new asset listings and your accrued yield",
  },
  Lending: {
    first: "Open the lending market on {chain} and supply a small test amount to confirm the rates and that withdrawal works.",
    weekly: "supply or borrow a small amount and check your health factor",
  },
  Yield: {
    first: "Open the yield strategy on {chain} and read how the yield is generated and what it costs.",
    weekly: "harvest or compound the yield",
  },
  Derivatives: {
    first: "Open the perps market on {chain} and place a small test trade to confirm margin, fees and the liquidation rules.",
    weekly: "open or close a small position within your risk limit",
  },
  CDP: {
    first: "Open the vault on {chain} and mint a small amount of the stable asset against collateral to test the flow.",
    weekly: "check your collateral ratio and top it up if it drifts",
  },
  "Yield Aggregator": {
    first: "Open the vault on {chain} and deposit a test amount to confirm the strategy and the fees.",
    weekly: "check the vault's strategy return and compound",
  },
  "Basis Trading": {
    first: "Open the basis strategy on {chain} and read how the hedge is held and what it pays.",
    weekly: "check the funding rate and your position's carry",
  },
  Chain: {
    first: "Open the chain's bridge page on {chain} and move a small test amount to confirm the route and the fees.",
    weekly: "bridge or transact a small amount to keep the wallet active",
  },
  "Liquidity Manager": {
    first: "Open the managed position on {chain} and deposit a test amount to confirm the range and the fees.",
    weekly: "check the position's range and rebalance if it drifts out",
  },
  "Staking Pool": {
    first: "Open the staking page on {chain} and stake a small test amount to confirm the rewards and the unstake delay.",
    weekly: "check accrued staking rewards and restake or claim",
  },
  "Prediction Market": {
    first: "Open the market page on {chain} and place a small test trade to confirm the market, the fees and settlement.",
    weekly: "trade a small position on a market you follow",
  },
  "Stablecoin Wrapper": {
    first: "Open the wrapper on {chain} and convert a small test amount to confirm the rate and redemption.",
    weekly: "wrap or unwrap a small amount to keep the flow active",
  },
  Restaking: {
    first: "Open the restaking page on {chain} and restake a small test amount to confirm the operator and the rewards.",
    weekly: "check restaking rewards and the operator's performance",
  },
  CeDeFi: {
    first: "Open the CeDeFi product on {chain} and read the custodian, the yield source and the withdrawal terms.",
    weekly: "check your balance and any new yield product",
  },
  Farm: {
    first: "Open the farm on {chain} and stake a small test amount to confirm the reward rate and the lock.",
    weekly: "harvest farm rewards and restake",
  },
  "Anchor BTC": {
    first: "Open the BTC vault on {chain} and deposit a small test amount to confirm the peg and redemption.",
    weekly: "check the BTC backing and your position",
  },
  "Leveraged Farming": {
    first: "Open the leveraged farm on {chain} and read the leverage, the liquidation price and the fees before depositing.",
    weekly: "check your leveraged position's health and deleverage if needed",
  },
  "Decentralized BTC": {
    first: "Open the BTC product on {chain} and test a small mint or deposit to confirm the flow.",
    weekly: "check the BTC reserve proof and your balance",
  },
  "Dual-Token Stablecoin": {
    first: "Open the stablecoin page on {chain} and mint a small test amount to confirm the collateral and the peg.",
    weekly: "check the peg and your collateral ratio",
  },
  "Collateral Markets": {
    first: "Open the collateral market on {chain} and supply a small test amount to confirm the terms.",
    weekly: "check your supplied collateral and borrow usage",
  },
  "CDP Manager": {
    first: "Open the CDP manager on {chain} and open a small test vault to confirm the flow.",
    weekly: "check your vaults' collateral ratios",
  },
  Payments: {
    first: "Open the payments page on {chain} and send a small test payment to confirm the fees and the speed.",
    weekly: "send or receive a small payment",
  },
  "Cross Chain Bridge": {
    first: "Open the bridge on {chain} and move a small test amount to confirm the route and the arrival time.",
    weekly: "bridge a small amount to keep the route warm",
  },
  "OTC Marketplace": {
    first: "Open the OTC desk on {chain} and read the listing, escrow and settlement terms.",
    weekly: "check new OTC listings",
  },
  Insurance: {
    first: "Open the cover page on {chain} and read the cover terms, the premium and the claim process.",
    weekly: "check your cover's expiry and renew if needed",
  },
  "Governance Incentives": {
    first: "Open the governance page on {chain} and read the proposal and reward terms.",
    weekly: "vote on a live proposal or check rewards",
  },
  "Crypto Card Issuer": {
    first: "Open the card page on {chain} and read the card fees, limits and cashback terms.",
    weekly: "spend a small amount on the card to keep it active",
  },
  "Uncollateralized Lending": {
    first: "Open the credit market on {chain} and read the borrower terms and the credit limits.",
    weekly: "check your credit line and repayment schedule",
  },
  Indexes: {
    first: "Open the index on {chain} and buy a small test amount to confirm the constituents and the fees.",
    weekly: "check the index's rebalance and your holding",
  },
  "Interest Rate Derivatives": {
    first: "Open the rates market on {chain} and place a small test trade to confirm the rate and settlement.",
    weekly: "check your rate position's mark and expiry",
  },
};

const DEFAULT_PLAN: CatPlan = {
  first: "Open the protocol on {chain} and use its main feature with a small test amount first.",
  weekly: "use the protocol's main feature again with a small amount",
};

export function tierOf(tvl: number): { amt: number; gas: number } {
  if (tvl >= 500_000_000) return { amt: 150, gas: 8 };
  if (tvl >= 100_000_000) return { amt: 100, gas: 6 };
  return { amt: 50, gas: 4 };
}

export function holdDaysOf(age: number | null): number {
  const a = age === null ? AGE_DEFAULT_DAYS : age;
  if (a >= 730) return 60;
  if (a >= 365) return 45;
  return 30;
}

// One-off setup minutes: steps 1, 2, 3, 6, 8 (20 + 25 + 25 + 15 + 30).
export const SETUP_MIN = 115;

export function farmTicket(p: Proto, asOf: string): Ticket {
  const { amt, gas } = tierOf(p.tvl_usd);
  return {
    usd: 2 * amt + 4 * gas,
    holdDays: holdDaysOf(ageDays(p.listed_at, asOf)),
    setupMin: SETUP_MIN,
  };
}

export function farmSteps(p: Proto, asOf: string): string[] {
  const chain = p.chains[0] ?? "Ethereum";
  const chain2 = p.chains.length > 1 ? p.chains[1] : null;
  const { amt, gas } = tierOf(p.tvl_usd);
  const plan = (p.category !== null && CAT_PLAN[p.category]) || DEFAULT_PLAN;
  const age = ageDays(p.listed_at, asOf);
  const hold = holdDaysOf(age);
  const first = plan.first.replace("{chain}", chain);
  const step3 =
    chain2 !== null
      ? `Repeat the same deposit on ${chain2}, so the position spans two chains and no single chain holds everything. Cost $${amt} + $${gas} gas \u00b7 Time 25 min.`
      : `A week later, add a second tranche of $${amt} on ${chain} from the same wallet, so the position builds in two dated entries. Cost $${amt} + $${gas} gas \u00b7 Time 25 min.`;
  return [
    `${first} Cost $0 \u00b7 Time 20 min.`,
    `Deposit $${amt} into the position on ${chain} and confirm the receipt shows the expected balance. Cost $${amt} + $${gas} gas \u00b7 Time 25 min.`,
    step3,
    `Each week, ${plan.weekly} and keep a note of the date, amount and fee. Cost $${gas} gas \u00b7 Time 15 min/week.`,
    `Keep a simple record \u2014 wallet, dates, amounts, transaction hashes \u2014 and check the protocol's points or eligibility page every week. Cost $0 \u00b7 Time 10 min/week.`,
    `Verify the contract address against the protocol's official documentation and review your token approvals; revoke any unlimited spend you do not need. Cost $0 \u00b7 Time 15 min.`,
    `Hold the position for ${hold} days without withdrawing, so the history reads as a real user and not a one-day visitor. Cost $0 \u00b7 Time ${hold} days.`,
    `If a token is announced, claim only through the protocol's official page, then withdraw, revoke approvals and close the position. Cost $${gas} gas \u00b7 Time 30 min.`,
  ];
}

// ---------------------------------------------------------------- board

export function buildBoard(snap: Snap): { rows: BoardRow[]; meta: BoardMeta } {
  const fit = fitCurve(snap);
  const effectByCat = new Map(fit.effects.map((e) => [e.name, e.adjDex]));
  const watch = new Set(snap.watchlist);
  const subjects = snap.protocols.filter(
    (p) => watch.has(p.slug) || isEligible(p)
  );
  const rows: BoardRow[] = subjects.map((p) => {
    const f = factors(p, snap.as_of);
    const catKey = p.category === null ? "(none)" : p.category;
    const adj = effectByCat.get(catKey) ?? 0;
    const base = Math.pow(10, fit.a + fit.b * log10(p.tvl_usd) + adj);
    const multiple = round4(base / p.tvl_usd);
    const implied = Math.round(
      p.tvl_usd * multiple * f.growth * f.maturity * f.chain
    );
    return {
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      age_days: f.age,
      multiple,
      implied_value_usd: implied,
      implied_lo_usd: Math.round(implied * fit.residP25),
      implied_hi_usd: Math.round(implied * fit.residP75),
      rank: 0,
      watchlist: watch.has(p.slug),
      model: {
        catPeers:
          fit.effects.find((e) => e.name === catKey)?.comps ?? 0,
        catAdjDex: round4(adj),
        growth: round4(f.growth),
        maturity: round4(f.maturity),
        chain: round4(f.chain),
      },
      farm_steps: farmSteps(p, snap.as_of),
      ticket: farmTicket(p, snap.as_of),
    };
  });
  rows.sort((x, y) => {
    if (y.implied_value_usd !== x.implied_value_usd)
      return y.implied_value_usd - x.implied_value_usd;
    if (y.tvl_usd !== x.tvl_usd) return y.tvl_usd - x.tvl_usd;
    return x.slug < y.slug ? -1 : 1;
  });
  rows.forEach((r, i) => {
    r.rank = i + 1;
  });
  const liveToken = snap.protocols.filter(
    (p) => p.gecko_id !== null || p.symbol !== null
  ).length;
  const meta: BoardMeta = {
    rows: rows.length,
    totalImplied: rows.reduce((s, r) => s + r.implied_value_usd, 0),
    asOf: snap.as_of,
    comps: fit.comps,
    excludedPlaceholder: fit.excludedPlaceholder,
    curveA: round4(fit.a),
    curveB: round4(fit.b),
    level100m: round4(fit.level100m),
    looX: round4(fit.looX),
    flatX: round4(fit.flatX),
    residP25: round4(fit.residP25),
    residP75: round4(fit.residP75),
    liveToken,
    setAside: snap.protocols.length - liveToken - rows.length,
    watchlistN: snap.watchlist.length,
    categories: fit.effects,
  };
  return { rows, meta };
}
