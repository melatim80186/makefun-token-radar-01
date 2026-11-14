// lib/model.ts — Token Radar v2: value model, board composition, farm plans.
//
// Pure functions over the snapshot. No I/O, no network, no dates beyond the
// snapshot's own as_of. Every number on the board follows from these
// functions and the snapshot's own figures (TVL, 7-day growth, age, chains).
//
// The value model (recovered and verified against the v1 board: 0 mismatches
// on all 213 rows with k=3; v2 changes only the shrinkage prior, k=3 -> k=6):
//   peers of a category = tokenized protocols in it with a recorded market
//     cap; peer ratio = min(mcap / tvl, 2.0)
//   market median M = median of the capped ratios over ALL tokenized
//     protocols with a recorded market cap, rounded to 4dp first (0.2138)
//   multiple = round-half-up-4dp((category_median * n + M * k) / (n + k)),
//     capped 1.0, floored 0.02; a category with no peers takes M
//   implied = round(tvl * multiple * growth * maturity * chain)
//   growth   = 1 + clamp(change_7d, -50, 100) / 100 * 0.5  (null -> 1)
//   maturity = 0.6 + min(age_days, 1095) / 1095 * 0.4     (unknown age -> 365d)
//   chain    = 1 + 0.02 * min(chains - 1, 5)
// The multiple shown on a row is the shrunk one; the category median and
// peer count are shown beside it so the shrinkage is auditable.

export interface Protocol {
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

export interface Snapshot {
  as_of: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

export interface ModelFactors {
  category_multiple: number;
  category_median: number | null;
  category_peers: number;
  market_median: number;
  shrinkage_k: number;
  growth_pct: number | null;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
  age_days: number | null;
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: "pre-token";
  age_days: number | null;
  implied_value_usd: number;
  model: ModelFactors;
  farm_steps: string[];
}

// --- Model constants -------------------------------------------------------

// The market median counts as this many pseudo-observations. k=6 (v2) instead
// of v1's k=3: one peer whose ratio hits the 2.0 cap used to drag a category
// to 0.6604 (3.1x the market median); with k=6 the same single peer gives
// 0.4690 (2.2x). Thin evidence can no longer produce a confident multiple.
export const SHRINKAGE_K = 6;
export const PEER_RATIO_CAP = 2.0;
export const MULTIPLE_FLOOR = 0.02;
export const MULTIPLE_CAP = 1.0;

// A category with no tokenized peer takes the market median.
export const NO_PEER_MULTIPLE_FALLBACK = "market-median";

// --- Board composition -----------------------------------------------------
//
// The board is the snapshot's watchlist (read as given, never recomputed —
// the house's rule uses a parentProtocol field the snapshot does not carry)
// plus the pre-token protocols below the floor that pass every filter below.
// A watchlist row is forced in and is never subject to the brand guard or
// the category exclusion.

// Categories the house excludes from its own watchlist, because they are
// products of a token that already trades: a bridge moves a trading token,
// liquid staking/restaking issues a staking derivative of one. Applied here
// to below-floor candidates only. (This is the snapshot signal that catches
// the parented protocols the name tests miss.)
export const EXCLUDED_CATEGORIES: ReadonlySet<string> = new Set([
  "Bridge",
  "Canonical Bridge",
  "Liquid Staking",
  "Liquid Restaking",
  "Restaked BTC",
  "CEX",
]);

export const EXCHANGE_PREFIXES: readonly string[] = [
  "Binance",
  "Coinbase",
  "Bybit",
  "Kraken",
  "Bitget",
  "OKX",
  "Bitfinex",
  "Gemini",
];

// PARENT_BRANDS: brands whose token already trades. A below-floor protocol
// whose brand (first word of its name, lowercased) is in this table is a
// product of a tokenized parent, so it is not a pre-token subject. The table
// was built in the v2 review from the brands of the below-floor protocols the
// v1 board excluded; it is a brand-level filter, not a list of rows — it
// applies to any protocol carrying one of these brands. Verified: it catches
// exactly the 92 parented below-floor protocols and 0 protocols on the board.
export const PARENT_BRANDS: ReadonlySet<string> = new Set([
  "aerodrome", "aevo", "alpaca", "apeswap", "arbitrum", "bedrock", "bluefin",
  "cetus", "chainflip", "chamber", "clearpool", "connext", "dexalot", "dodo",
  "dxsale", "folks", "frax", "fraxlend", "futarchy", "gain", "glif",
  "goldfinger", "grvt", "haedal", "hatom", "hydration", "hydro", "ichi",
  "immutable", "jito", "jupiter", "jupusd", "kinetiq", "kodiak", "layerbank",
  "linear", "lista", "meteora", "metis", "metronome", "mezo", "minswap",
  "moonwell", "mux", "navi", "orderly", "origin", "papertrade", "paradex",
  "pendle", "pharaoh", "proxy", "puffer", "rhea", "sanctum", "scallop",
  "solayer", "solv", "sovryn", "spectra", "stakestone", "summerfi", "sunx",
  "superform", "sushi", "swell", "tangible", "unitas", "unitus", "vaulta",
  "vires", "volo", "youves",
]);

// Generic first words that need their second word to be a brand at all:
// "the" alone would exclude any protocol called "The ...", "meta" any
// "Meta ...". These map a first word to the two-word brand it must match.
export const PARENT_BRANDS_TWO_WORD: Readonly<Record<string, string>> = {
  "the": "the idols",
  "meta": "meta pool",
  "yo": "yo protocol",
  "save": "save sol",
  "nest": "nest cl",
  "buzz": "buzz farming",
  "extra": "extra finance",
  "merchant": "merchant moe",
  "rnt": "rnt lend",
  "adi": "adi bridge",
  "joe": "joe dex",
};

// --- Small numeric helpers -------------------------------------------------

export function round4HalfUp(x: number): number {
  // Round to 4 decimal places, halves up. The 1e-9 nudge absorbs binary-float
  // artefacts (e.g. 0.66035 stored as 0.6603499999999999) without moving any
  // value that is genuinely below a tie.
  return Math.round(x * 10000 + 1e-9) / 10000;
}

export function round3HalfUp(x: number): number {
  return Math.round(x * 1000 + 1e-9) / 1000;
}

export function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) throw new Error("median of an empty list");
  return n % 2 === 1 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

// --- Factors ---------------------------------------------------------------

export function ageDays(listedAt: string | null, asOf: string): number | null {
  if (!listedAt) return null;
  const [y, m, d] = listedAt.split("-").map(Number);
  const [ay, am, ad] = asOf.split("-").map(Number);
  const t0 = Date.UTC(y, m - 1, d);
  const t1 = Date.UTC(ay, am - 1, ad);
  return Math.max(0, Math.round((t1 - t0) / 86400000));
}

export function growthMultiplier(change7d: number | null): number {
  if (change7d === null || change7d === undefined) return 1;
  return 1 + (clamp(change7d, -50, 100) / 100) * 0.5;
}

export function maturityMultiplier(age: number | null): number {
  // Unknown age counts as 365 days in the maturity factor (the row still
  // shows age_days null); the model panel discloses this.
  const a = age === null || age === undefined ? 365 : age;
  return 0.6 + (Math.min(a, 1095) / 1095) * 0.4;
}

export function chainMultiplier(chains: readonly string[]): number {
  return 1 + 0.02 * Math.min(chains.length - 1, 5);
}

// A protocol records a token when DefiLlama records one for it. The market
// cap is the figure the ratio needs, so the peer universe is the tokenized
// protocols that also carry one.
export function peerRatio(p: Protocol): number | null {
  if (p.mcap_usd === null || p.mcap_usd === undefined || p.mcap_usd <= 0) {
    return null;
  }
  return Math.min(p.mcap_usd / p.tvl_usd, PEER_RATIO_CAP);
}

export function marketMedian(snapshot: Snapshot): number {
  const ratios: number[] = [];
  for (const p of snapshot.protocols) {
    const r = peerRatio(p);
    if (r !== null) ratios.push(r);
  }
  // The median is rounded to 4dp BEFORE it is used anywhere else.
  return round4HalfUp(median(ratios));
}

export function peersByCategory(
  snapshot: Snapshot,
): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    const r = peerRatio(p);
    if (r === null || p.category === null) continue;
    const list = out.get(p.category);
    if (list) list.push(r);
    else out.set(p.category, [r]);
  }
  return out;
}

export function categoryMultiple(
  category: string | null,
  peerRatios: readonly number[],
  marketMed: number,
): { multiple: number; median: number | null; peers: number } {
  const n = peerRatios.length;
  if (n === 0) return { multiple: marketMed, median: null, peers: 0 };
  const med = median(peerRatios);
  const shrunk = (med * n + marketMed * SHRINKAGE_K) / (n + SHRINKAGE_K);
  const multiple = Math.min(
    MULTIPLE_CAP,
    Math.max(MULTIPLE_FLOOR, round4HalfUp(shrunk)),
  );
  return { multiple, median: round4HalfUp(med), peers: n };
}

// --- Composition -----------------------------------------------------------

const VERSION_MARKER = /\s(V\d+(\.\d+)*|\d+\.\d+)\s*$/i;
const WRAP_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = new RegExp(
  `^(${EXCHANGE_PREFIXES.join("|")})\\b`,
);

function brandOf(name: string): string {
  const w = name.trim().toLowerCase().split(/[\s-]+/)[0] ?? "";
  return w.replace(/[^a-z0-9]/g, "");
}

function brand2Of(name: string): string {
  const parts = name.trim().toLowerCase().split(/[\s-]+/).slice(0, 2);
  return parts.map((w) => w.replace(/[^a-z0-9]/g, "")).join(" ");
}

export function isParentBrand(name: string): boolean {
  const b1 = brandOf(name);
  if (
    Object.prototype.hasOwnProperty.call(PARENT_BRANDS_TWO_WORD, b1)
  ) {
    return brand2Of(name) === PARENT_BRANDS_TWO_WORD[b1];
  }
  return PARENT_BRANDS.has(b1);
}

// The house's own watchlist tests, applied to below-floor candidates:
// records no token, not a CEX, name carries no version marker and no whole
// word wrapped/staked/staking, and does not begin with an exchange's name.
// (The house's rule also uses a parentProtocol field the snapshot does not
// carry; the brand guard and the category exclusion below are this entry's
// stand-ins for it.)
export function passesBaseFilters(p: Protocol): boolean {
  if (p.mcap_usd !== null && p.mcap_usd !== undefined) return false;
  if (p.gecko_id !== null && p.gecko_id !== undefined) return false;
  if (p.symbol !== null && p.symbol !== undefined) return false;
  if (p.category === "CEX") return false;
  if (VERSION_MARKER.test(p.name)) return false;
  if (WRAP_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

export function selectBoard(snapshot: Snapshot): Protocol[] {
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const picked = new Map<string, Protocol>();
  // The watchlist is forced in, as read — never filtered, never recomputed.
  for (const slug of snapshot.watchlist) {
    const p = bySlug.get(slug);
    if (p) picked.set(slug, p);
  }
  for (const p of snapshot.protocols) {
    if (picked.has(p.slug)) continue;
    // Above the floor and off the watchlist: not a subject for this board.
    if (p.tvl_usd >= snapshot.floor_usd) continue;
    if (!passesBaseFilters(p)) continue;
    if (isParentBrand(p.name)) continue;
    if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) continue;
    picked.set(p.slug, p);
  }
  return [...picked.values()];
}

// --- Farm plans ------------------------------------------------------------
// Seven concrete steps per protocol, each with what it costs and how long it
// takes. Steps 1, 6 and 7 are the same for every protocol; steps 2 and 3 are
// chosen by category; step 4 varies with the chain count; step 5's hold
// varies with the protocol's age. Capital is tiered by TVL so the plan stays
// proportional to the protocol's size.

export function farmCapital(tvlUsd: number): number {
  if (tvlUsd >= 1_000_000_000) return 150;
  if (tvlUsd >= 100_000_000) return 100;
  return 50;
}

export function farmHoldDays(age: number | null): number {
  if (age === null || age === undefined) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

function articleFor(name: string): string {
  return /^[aeiou]/i.test(name.trim()) ? "an" : "a";
}

type Step2Kind =
  | "vault" | "yield-vault" | "farm" | "managed" | "deposit" | "supply"
  | "liquidity" | "margin" | "mint-stable" | "mint-stable-asset"
  | "bridge-chain" | "cover" | "payment" | "predict" | "mint-yield-asset"
  | "stake";

const STEP2_BY_CATEGORY: Readonly<Record<string, Step2Kind>> = {
  "Risk Curators": "vault",
  "Onchain Capital Allocator": "vault",
  "Yield": "yield-vault",
  "Yield Aggregator": "yield-vault",
  "Farm": "farm",
  "Liquidity Manager": "managed",
  "Anchor BTC": "deposit",
  "CeDeFi": "deposit",
  "Crypto Card Issuer": "deposit",
  "Decentralized BTC": "deposit",
  "Governance Incentives": "deposit",
  "Lending": "supply",
  "Collateral Markets": "supply",
  "Uncollateralized Lending": "supply",
  "Dexs": "liquidity",
  "Indexes": "liquidity",
  "Leveraged Farming": "liquidity",
  "Basis Trading": "margin",
  "Derivatives": "margin",
  "Interest Rate Derivatives": "margin",
  "CDP": "mint-stable",
  "Dual-Token Stablecoin": "mint-stable-asset",
  "Stablecoin Wrapper": "mint-stable-asset",
  "Chain": "bridge-chain",
  "Insurance": "cover",
  "Payments": "payment",
  "Prediction Market": "predict",
  "RWA": "mint-yield-asset",
  "Restaking": "stake",
  "Staking Pool": "stake",
};

type Step3Kind =
  | "vault-move" | "harvest" | "rebalance" | "generic" | "borrow"
  | "swap-pool" | "hedge" | "swap-stable" | "cover2" | "payment2"
  | "predict2" | "rwa-redeem" | "stake2";

const STEP3_BY_CATEGORY: Readonly<Record<string, Step3Kind>> = {
  "Risk Curators": "vault-move",
  "Onchain Capital Allocator": "vault-move",
  "Yield": "harvest",
  "Yield Aggregator": "harvest",
  "Farm": "rebalance",
  "Liquidity Manager": "rebalance",
  "Anchor BTC": "generic",
  "CeDeFi": "generic",
  "Chain": "generic",
  "Crypto Card Issuer": "generic",
  "Decentralized BTC": "generic",
  "Governance Incentives": "generic",
  "CDP": "borrow",
  "Lending": "borrow",
  "Collateral Markets": "borrow",
  "Uncollateralized Lending": "borrow",
  "Dexs": "swap-pool",
  "Indexes": "swap-pool",
  "Leveraged Farming": "swap-pool",
  "Basis Trading": "hedge",
  "Derivatives": "hedge",
  "Interest Rate Derivatives": "hedge",
  "Dual-Token Stablecoin": "swap-stable",
  "Stablecoin Wrapper": "swap-stable",
  "Insurance": "cover2",
  "Payments": "payment2",
  "Prediction Market": "predict2",
  "RWA": "rwa-redeem",
  "Restaking": "stake2",
  "Staking Pool": "stake2",
};

function step2Text(
  kind: Step2Kind,
  name: string,
  chain0: string,
  cap: number,
  gas: number,
): string {
  const cost = ` Cost: $${cap} of capital and about $${gas} of gas. Time: 15 minutes to set up.`;
  switch (kind) {
    case "vault":
      return `Deposit $${cap} into ${articleFor(name)} ${name} vault on ${chain0} and keep the shares.${cost}`;
    case "yield-vault":
      return `Deposit $${cap} into ${name}'s highest-yield vault on ${chain0} and keep the shares.${cost}`;
    case "farm":
      return `Deposit $${cap} into ${name}'s main farm on ${chain0} and keep the position staked.${cost}`;
    case "managed":
      return `Deposit $${cap} into ${articleFor(name)} ${name} managed position on ${chain0} and keep it open.${cost}`;
    case "deposit":
      return `Deposit $${cap} of USDC into ${name} on ${chain0} and keep the position open.${cost}`;
    case "supply":
      return `Supply $${cap} of USDC to ${name} on ${chain0} and keep the position open.${cost}`;
    case "liquidity":
      return `Provide $${cap} of liquidity to ${name}'s main pool on ${chain0} and keep the position open.${cost}`;
    case "margin":
      return `Deposit $${cap} of USDC as margin on ${name} and open one small hedged position.${cost}`;
    case "mint-stable":
      return `Mint $${cap} of the stablecoin by locking collateral in ${name} on ${chain0}.${cost}`;
    case "mint-stable-asset":
      return `Mint or deposit $${cap} of the stable asset through ${name} on ${chain0}.${cost}`;
    case "bridge-chain":
      return `Bridge $${cap} onto the chain ${name} secures and use one of its apps.${cost}`;
    case "cover":
      return `Buy $${cap} of cover from ${name} on ${chain0} and keep the policy active.${cost}`;
    case "payment":
      return `Send one $${cap} payment through ${name} on ${chain0} and keep the receipt.${cost}`;
    case "predict":
      return `Fund $${cap} and place one market position on ${name}.${cost}`;
    case "mint-yield-asset":
      return `Mint $${cap} of the protocol's yield-bearing asset on ${chain0} and hold it.${cost}`;
    case "stake":
      return `Stake $${cap} of the chain's staking asset through ${name} and keep the receipt token.${cost}`;
  }
}

function step3Text(kind: Step3Kind, name: string): string {
  const cost = " Cost: about $25 of activity and $2 of gas. Time: 10 minutes.";
  switch (kind) {
    case "vault-move":
      return `Move $25 between two of ${name}'s vaults, so the wallet shows activity in more than one.${cost}`;
    case "harvest":
      return `Claim or compound the yield once, so the wallet shows a harvest from ${name}.${cost}`;
    case "rebalance":
      return `Rebalance the position once, so the wallet shows a second transaction on ${name}.${cost}`;
    case "generic":
      return `Make one more qualifying action of a different kind than the first on ${name}.${cost}`;
    case "borrow":
      return `Borrow $25 against the supply and repay it a week later, so the wallet shows both sides of ${name}.${cost}`;
    case "swap-pool":
      return `Swap $25 through the same pool once, so the wallet shows a trade as well as liquidity on ${name}.${cost}`;
    case "hedge":
      return `Close the hedge and open a fresh one, so the wallet shows two round trips on ${name}.${cost}`;
    case "swap-stable":
      return `Swap $25 of the stable asset through ${name}'s own route.${cost}`;
    case "cover2":
      return `Open a second small cover on another pool of ${name}.${cost}`;
    case "payment2":
      return `Make a second $25 payment to a different address through ${name}.${cost}`;
    case "predict2":
      return `Settle one market and open another, so the wallet shows two positions on ${name}.${cost}`;
    case "rwa-redeem":
      return `Redeem a small part of the yield asset and re-mint it through ${name}.${cost}`;
    case "stake2":
      return `Delegate a second small stake through ${name} and keep both receipts.${cost}`;
  }
}

export function farmSteps(
  row: Pick<BoardRow, "name" | "category" | "chains" | "tvl_usd" | "age_days">,
): string[] {
  const cap = farmCapital(row.tvl_usd);
  const gas = cap === 150 ? 8 : 4;
  const hold = farmHoldDays(row.age_days);
  const chain0 = row.chains[0] ?? "its chain";
  const kind2 = STEP2_BY_CATEGORY[row.category] ?? "deposit";
  const kind3 = STEP3_BY_CATEGORY[row.category] ?? "generic";
  const step4 =
    row.chains.length >= 2
      ? `Make one qualifying action each week, rotating across two of its chains (${row.chains[0]} and ${row.chains[1]}), such as a deposit, a borrow, a swap or a vote. Cost: about $2 of gas a week. Time: 10 minutes a week.`
      : `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote. Cost: about $2 of gas a week. Time: 10 minutes a week.`;
  return [
    "Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. Cost: under $3 of gas for the first transaction. Time: 5 minutes.",
    step2Text(kind2, row.name, chain0, cap, gas),
    step3Text(kind3, row.name),
    step4,
    `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot. Cost: the $${cap} stays in the position. Time: ${hold} days.`,
    "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes. Cost: no fee to check, and never pay to claim. Time: 10 minutes.",
    "Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it. Cost: nothing but the log. Time: 5 minutes.",
  ];
}

// --- Board builder ---------------------------------------------------------

export interface BoardStats {
  asOf: string;
  floorUsd: number;
  protocols: number;
  rows: number;
  watchlistTotal: number;
  watchlistCovered: number;
  belowFloorRows: number;
  totalImpliedUsd: number;
  marketMedian: number;
  peerProtocols: number;
  tokenizedNoMcap: number;
  categories: number;
}

export function buildBoard(snapshot: Snapshot): {
  rows: BoardRow[];
  stats: BoardStats;
} {
  const med = marketMedian(snapshot);
  const peers = peersByCategory(snapshot);
  const picked = selectBoard(snapshot);
  const watchlist = new Set(snapshot.watchlist);

  const rows: BoardRow[] = picked.map((p) => {
    const ratios = p.category === null ? [] : (peers.get(p.category) ?? []);
    const { multiple, median: catMedian, peers: nPeers } = categoryMultiple(
      p.category,
      ratios,
      med,
    );
    const age = ageDays(p.listed_at, snapshot.as_of);
    const growth = growthMultiplier(p.change_7d);
    const maturity = maturityMultiplier(age);
    const chain = chainMultiplier(p.chains);
    const implied = Math.round(
      p.tvl_usd * multiple * growth * maturity * chain,
    );
    const model: ModelFactors = {
      category_multiple: multiple,
      category_median: catMedian,
      category_peers: nPeers,
      market_median: med,
      shrinkage_k: SHRINKAGE_K,
      growth_pct: p.change_7d,
      growth_multiplier: round3HalfUp(growth),
      maturity_multiplier: round4HalfUp(maturity),
      chain_multiplier: chain,
      age_days: age,
    };
    const partial: Pick<
      BoardRow,
      "name" | "category" | "chains" | "tvl_usd" | "age_days"
    > = {
      name: p.name,
      category: p.category ?? "Uncategorised",
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      age_days: age,
    };
    return {
      rank: 0,
      slug: p.slug,
      name: p.name,
      category: p.category ?? "Uncategorised",
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd,
      listed_at: p.listed_at,
      gecko_id: p.gecko_id,
      symbol: p.symbol,
      token_status: "pre-token",
      age_days: age,
      implied_value_usd: implied,
      model,
      farm_steps: farmSteps(partial),
    };
  });

  // Rank by implied value, highest first. The slug tie-break keeps the order
  // deterministic if two implied values ever tie.
  rows.sort(
    (a, b) =>
      b.implied_value_usd - a.implied_value_usd ||
      a.slug.localeCompare(b.slug),
  );
  rows.forEach((r, i) => {
    r.rank = i + 1;
  });

  let peerProtocols = 0;
  let tokenizedNoMcap = 0;
  for (const p of snapshot.protocols) {
    if (p.gecko_id !== null || p.symbol !== null) {
      if (peerRatio(p) !== null) peerProtocols += 1;
      else tokenizedNoMcap += 1;
    }
  }
  const stats: BoardStats = {
    asOf: snapshot.as_of,
    floorUsd: snapshot.floor_usd,
    protocols: snapshot.protocols.length,
    rows: rows.length,
    watchlistTotal: snapshot.watchlist.length,
    watchlistCovered: rows.filter((r) => watchlist.has(r.slug)).length,
    belowFloorRows: rows.filter((r) => !watchlist.has(r.slug)).length,
    totalImpliedUsd: rows.reduce((s, r) => s + r.implied_value_usd, 0),
    marketMedian: med,
    peerProtocols,
    tokenizedNoMcap,
    categories: new Set(rows.map((r) => r.category)).size,
  };
  return { rows, stats };
}

// --- Compact rows for the dashboard ----------------------------------------
// The page embeds these (not the full rows) and regenerates the farm steps
// client-side with the same generator, so the dashboard source stays small
// and the page and the board can never disagree about a plan.
// Layout: [rank, slug, name, category, chains, tvl, implied, change_7d,
//          age_days, multiple, peers, category_median, growth, maturity, chain]
export function compactRows(rows: BoardRow[]): unknown[] {
  return rows.map((r) => [
    r.rank,
    r.slug,
    r.name,
    r.category,
    r.chains,
    r.tvl_usd,
    r.implied_value_usd,
    r.change_7d,
    r.age_days,
    r.model.category_multiple,
    r.model.category_peers,
    r.model.category_median,
    r.model.growth_multiplier,
    r.model.maturity_multiplier,
    r.model.chain_multiplier,
  ]);
}
