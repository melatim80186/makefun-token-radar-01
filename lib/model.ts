// lib/model.ts — radar-2: implied token value and farm plans for pre-token protocols.
//
// The model reads only the sealed snapshot's own figures (TVL, 7-day change,
// listing age, chain count, and the market caps of tokens that already trade).
// No protocol name is ever special-cased: every number below is derived at
// run time from the snapshot, and every farm plan is generated from the
// protocol's category and chains.

export interface SnapshotProtocol {
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
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface CategoryMultiple {
  category: string;
  peers: number;
  median: number | null;
  multiple: number;
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  category: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number;
  listed_at: string | null;
  multiple: number;
  implied_value_usd: number;
  watchlist: boolean;
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string;
  tvl_usd: number;
  mcap_usd: number;
}

export interface BoardResult {
  rows: BoardRow[];
  live: LiveRow[];
  multiples: CategoryMultiple[];
  marketMedian: number;
  totalImplied: number;
  issues: string[];
}

// ---------------------------------------------------------------------------
// Small numeric helpers
// ---------------------------------------------------------------------------

export function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) throw new Error("median of no values");
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Round to four decimal places; multiples are stored and used rounded. */
export function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

// ---------------------------------------------------------------------------
// The market multiple: what a token is worth per dollar of TVL
// ---------------------------------------------------------------------------

/** A protocol's FDV/TVL ratio, when it records a token with a market cap. */
export function peerRatio(p: SnapshotProtocol): number | null {
  if (p.mcap_usd === null || p.tvl_usd <= 0) return null;
  const ratio = p.mcap_usd / p.tvl_usd;
  // Zero and negative caps carry no signal (dead or unpriced tokens).
  return ratio > 0 ? ratio : null;
}

/**
 * Derive the multiple for every category in the snapshot.
 *
 * Each tokenized protocol contributes its FDV/TVL ratio, capped at 2.0x
 * first (uncapped ratios reach 400x on micro-TVL tokens and would wreck the
 * median). A category's multiple is the median of its capped peer ratios,
 * shrunk toward the market median with three peers' weight, then capped at
 * 1.0x and floored at 0.02x. A category with no tokenized peer takes the
 * market median. The market median is the median ratio across all tokenized
 * protocols. Multiples are rounded to four decimals and the rounded value
 * is the one the implied value uses.
 */
export function deriveMultiples(
  protocols: SnapshotProtocol[],
): { marketMedian: number; multiples: CategoryMultiple[] } {
  const ratios = protocols
    .map(peerRatio)
    .filter((r): r is number => r !== null);
  const marketMedian = medianOf(ratios);

  const byCategory = new Map<string, number[]>();
  for (const p of protocols) {
    const r = peerRatio(p);
    if (r === null) continue;
    const cat = p.category ?? "Uncategorized";
    const list = byCategory.get(cat) ?? [];
    list.push(Math.min(r, 2.0));
    byCategory.set(cat, list);
  }

  const categories = [...new Set(protocols.map((p) => p.category ?? "Uncategorized"))].sort();
  const multiples: CategoryMultiple[] = categories.map((category) => {
    const peers = byCategory.get(category) ?? [];
    if (peers.length === 0) {
      return { category, peers: 0, median: null, multiple: round4(marketMedian) };
    }
    const median = medianOf(peers);
    const shrunk = (peers.length * median + 3 * marketMedian) / (peers.length + 3);
    const multiple = round4(clamp(shrunk, 0.02, 1.0));
    return { category, peers: peers.length, median: round4(median), multiple };
  });

  return { marketMedian, multiples };
}

// ---------------------------------------------------------------------------
// Implied value
// ---------------------------------------------------------------------------

/** Whole days between the snapshot date and the day tracking began. */
export function ageDays(listedAt: string | null, asOf: string): number {
  if (listedAt === null) return 365; // unknown age counts as one year
  const listed = Date.parse(listedAt + "T00:00:00Z");
  const asOfMs = Date.parse(asOf + "T00:00:00Z");
  const days = Math.round((asOfMs - listed) / 86400000);
  return Math.max(0, days);
}

export function growthFactor(change7d: number | null): number {
  const change = clamp(change7d ?? 0, -50, 100);
  return 1 + (change / 100) * 0.5;
}

export function ageFactor(age: number): number {
  return 0.6 + (Math.min(age, 1095) / 1095) * 0.4;
}

export function chainFactor(chainCount: number): number {
  return 1 + 0.02 * Math.min(Math.max(chainCount - 1, 0), 5);
}

/**
 * implied = round(tvl x multiple x growth x age x chains), at least $1.
 * Growth counts half its 7-day move (clamped to -50%..+100%); age counts
 * from 0.6x at launch to 1.0x at three years; each extra chain up to five
 * adds 2%.
 */
export function impliedValue(
  p: SnapshotProtocol,
  multiple: number,
  asOf: string,
): number {
  const age = ageDays(p.listed_at, asOf);
  const value = Math.round(
    p.tvl_usd *
      multiple *
      growthFactor(p.change_7d) *
      ageFactor(age) *
      chainFactor(p.chains.length),
  );
  return Math.max(1, value);
}

// ---------------------------------------------------------------------------
// Board composition
// ---------------------------------------------------------------------------

const VERSION_MARKER = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_NAMES = [
  "Binance",
  "Coinbase",
  "Bybit",
  "Kraken",
  "Bitget",
  "OKX",
  "Bitfinex",
  "Gemini",
];

/** Records no token: both the CoinGecko id and the ticker are null. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

/**
 * Rankable below the floor: pre-token, not a centralised exchange, no
 * version marker in the name, no whole word wrapped/staked/staking, and no
 * exchange-name prefix. Above the floor only watchlist slugs are ranked,
 * so the wrapped and staked giants (WBTC, staked ETH, bridged dollars)
 * never reach the board.
 */
export function isRankableBelowFloor(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category === "CEX") return false;
  if (VERSION_MARKER.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  for (const ex of EXCHANGE_NAMES) {
    if (p.name === ex || p.name.startsWith(ex + " ")) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Farm plans: seven concrete steps per row
// ---------------------------------------------------------------------------

interface CategoryActions {
  first: string;
  second: string;
}

const CATEGORY_ACTIONS: Record<string, CategoryActions> = {
  "AI Agents": {
    first: "run the agent with a $100 starter stake",
    second: "delegate a second $50 to another agent task",
  },
  "Algo-Stables": {
    first: "mint $100 of the algorithmic stable with collateral",
    second: "provide $50 of the stable to its deepest pool",
  },
  "Anchor BTC": {
    first: "deposit $100 of BTC into the anchor vault",
    second: "loop a second $50 of BTC through the vault",
  },
  "Basis Trading": {
    first: "open a $100 delta-neutral basis position",
    second: "roll the basis trade into the next funding window",
  },
  Bridge: {
    first: "bridge $100 across its route and back",
    second: "bridge a second $50 through a different route",
  },
  CDP: {
    first: "open a small collateralised debt position with $100 of collateral",
    second: "mint $50 of its stable asset and repay half of it",
  },
  "CDP Manager": {
    first: "open a $100 managed CDP position",
    second: "adjust the position's collateral ratio once",
  },
  CEX: {
    first: "trade $100 of volume through the venue",
    second: "place a second $50 limit order",
  },
  "Canonical Bridge": {
    first: "bridge $100 through the canonical route",
    second: "bridge a second $50 back the other way",
  },
  CeDeFi: {
    first: "deposit $100 into its CeDeFi vault",
    second: "move $50 into a second CeDeFi strategy",
  },
  Chain: {
    first: "bridge $100 onto the chain and use its flagship app",
    second: "stake $50 with a validator on the chain",
  },
  "Collateral Management": {
    first: "deposit $100 of collateral into the manager",
    second: "rebalance the collateral mix with a $50 move",
  },
  "Collateral Markets": {
    first: "supply $100 of collateral to the market",
    second: "borrow $50 against the collateral and repay it",
  },
  "Cross Chain Bridge": {
    first: "bridge $100 across two of its supported chains",
    second: "bridge a second $50 on a different chain pair",
  },
  "Crypto Card Issuer": {
    first: "order the card and spend $100 through it",
    second: "top the card up with a second $50",
  },
  DOR: {
    first: "deposit $100 into the decentralised options reserve",
    second: "write a second $50 options position",
  },
  "Decentralized AI": {
    first: "run a $100 inference or compute job on the network",
    second: "stake $50 toward a second compute job",
  },
  "Decentralized BTC": {
    first: "deposit $100 of BTC into the decentralised vault",
    second: "mint $50 of its BTC-backed asset",
  },
  Derivatives: {
    first: "open a $100 perpetual position",
    second: "hedge it with a $50 position the other way",
  },
  Dexs: {
    first: "swap $100 through its deepest pool",
    second: "add $50 of liquidity to that pool",
  },
  "Dual-Token Stablecoin": {
    first: "mint $100 of the stable with collateral",
    second: "stake $50 of the paired governance token",
  },
  Farm: {
    first: "deposit $100 into its highest-TVL farm",
    second: "compound the farm rewards back in",
  },
  "Governance Incentives": {
    first: "lock $100 of tokens to earn governance incentives",
    second: "vote on a live proposal with the locked position",
  },
  Indexes: {
    first: "buy $100 of the index token",
    second: "mint a second $50 of the index directly",
  },
  Insurance: {
    first: "buy $100 of cover for a position you hold",
    second: "provide $50 of underwriting capital to a cover pool",
  },
  "Interest Rate Derivatives": {
    first: "open a $100 fixed-rate position",
    second: "swap $50 of floating exposure to fixed",
  },
  Launchpad: {
    first: "stake $100 to join its next launch allocation",
    second: "commit $50 to a second launch on the pad",
  },
  Lending: {
    first: "supply $100 of collateral to the lending market",
    second: "borrow $50 against it and repay it within the week",
  },
  "Leveraged Farming": {
    first: "open a $100 leveraged farm position",
    second: "add $50 of collateral to the same farm",
  },
  "Liquid Restaking": {
    first: "restake $100 of liquid staking tokens",
    second: "restake a second $50 into another operator",
  },
  "Liquid Staking": {
    first: "stake $100 and hold the liquid staking token",
    second: "use $50 of the staking token in a DeFi pool",
  },
  "Liquidity Manager": {
    first: "deposit $100 into a managed liquidity vault",
    second: "rebalance the vault range with a $50 move",
  },
  "NFT Marketplace": {
    first: "list or buy a $100 NFT through the marketplace",
    second: "make a second $50 offer on a listed item",
  },
  "OTC Marketplace": {
    first: "complete a $100 OTC trade on the venue",
    second: "post a second $50 OTC listing",
  },
  "Onchain Capital Allocator": {
    first: "deposit $100 into an allocator vault",
    second: "split a second $50 across another allocator strategy",
  },
  Options: {
    first: "buy a $100 call or put on the options desk",
    second: "sell a $50 covered option against a holding",
  },
  "Options Vault": {
    first: "deposit $100 into the options vault",
    second: "roll the vault position into the next epoch",
  },
  Payments: {
    first: "pay $100 through its payment rail",
    second: "set up a second $50 recurring payment",
  },
  "Prediction Market": {
    first: "place a $100 prediction on an open market",
    second: "trade a second $50 position on the same market",
  },
  Privacy: {
    first: "shield $100 through its privacy pool",
    second: "withdraw $50 from the pool to a fresh address",
  },
  RWA: {
    first: "buy $100 of its tokenised real-world asset",
    second: "hold the position through one yield distribution",
  },
  "Reserve Currency": {
    first: "bond $100 into the reserve",
    second: "stake $50 of the reserve token",
  },
  "Restaked BTC": {
    first: "restake $100 of BTC through the protocol",
    second: "delegate a second $50 to another restaking operator",
  },
  Restaking: {
    first: "restake $100 through the protocol",
    second: "restake a second $50 with a different operator",
  },
  "Risk Curators": {
    first: "deposit $100 into a curated vault",
    second: "allocate a second $50 to a different curator vault",
  },
  "Stablecoin Issuer": {
    first: "mint $100 of the stablecoin with collateral",
    second: "hold $50 of the stable in its savings vault",
  },
  "Stablecoin Wrapper": {
    first: "wrap $100 of stablecoins through the protocol",
    second: "unwrap and re-wrap $50 to confirm the flow",
  },
  "Staking Pool": {
    first: "stake $100 in the pool",
    second: "compound a second $50 of rewards back in",
  },
  Synthetics: {
    first: "mint $100 of a synthetic asset",
    second: "trade $50 of the synthetic on its market",
  },
  "Token Locker": {
    first: "lock $100 of tokens in a vesting locker",
    second: "create a second $50 lock with a longer cliff",
  },
  "Uncollateralized Lending": {
    first: "open a $100 credit line with the protocol",
    second: "repay and re-draw $50 of the line",
  },
  Yield: {
    first: "deposit $100 into its highest-TVL vault",
    second: "compound the vault yield back into the position",
  },
  "Yield Aggregator": {
    first: "deposit $100 into the aggregator's top strategy",
    second: "move $50 into a second strategy it routes to",
  },
};

const DEFAULT_ACTIONS: CategoryActions = {
  first: "use the protocol's core product with a $100 starter position",
  second: "deepen the position with a second $50 interaction",
};

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function chainList(chains: string[], count: number): string {
  return chains.slice(0, count).join(", ");
}

/**
 * Seven steps: two category-aware actions, a second-chain move, a weekly
 * multi-chain rotation, quests and points, a weekly check-in, and launch
 * readiness. Every step names its cost and its time, and runs 20-600 chars.
 */
export function farmStepsFor(
  name: string,
  category: string,
  chains: string[],
): string[] {
  const actions = CATEGORY_ACTIONS[category] ?? DEFAULT_ACTIONS;
  const home = chains[0] ?? "Ethereum";
  const away = chains[1] ?? null;
  const rotation = chains.length > 1 ? chainList(chains, 3) : home;
  const steps: string[] = [
    `${capitalise(actions.first)} for ${name} on ${home}. Cost: about $2-5 in gas plus the $100 position. Time: 20 minutes.`,
    `${capitalise(actions.second)} for ${name} on ${home}. Cost: about $1-3 in gas plus a $50 top-up. Time: 15 minutes.`,
  ];
  if (away) {
    steps.push(
      `Open the same starter position for ${name} on ${away} so your activity spans two chains. Cost: about $2-5 in gas plus a $100 position. Time: 20 minutes.`,
    );
  } else {
    steps.push(
      `Add a second asset to your ${name} position on ${home} so the position is not a single token. Cost: about $1-3 in gas plus a $50 top-up. Time: 15 minutes.`,
    );
  }
  steps.push(
    `Each week, rotate a $50 slice of your ${name} position across ${rotation} to keep activity on every chain it runs on. Cost: about $2-5 in gas per move. Time: 15 minutes a week.`,
    `Work through ${name}'s quests, points tasks and community calls for the week and record any points you earn. Cost: $0-2 in gas. Time: 30 minutes a week.`,
    `Once a week, check ${name}'s TVL, your points balance and any announcement, and rebalance if the position drifted. Cost: $0 to look. Time: 10 minutes a week.`,
    `Stay ready for a token launch: keep the ${name} position open, hold $10 of ${home} gas in the wallet, and watch for an official launch post. Cost: $0 unless you move funds. Time: 5 minutes.`,
  );
  return steps;
}

// ---------------------------------------------------------------------------
// Build + validate the board
// ---------------------------------------------------------------------------

export function buildBoard(snapshot: Snapshot): BoardResult {
  const { marketMedian, multiples } = deriveMultiples(snapshot.protocols);
  const multipleByCategory = new Map(multiples.map((m) => [m.category, m.multiple]));
  const watchlist = new Set(snapshot.watchlist);
  const floor = snapshot.floor_usd;

  const early = snapshot.protocols.filter(
    (p) => watchlist.has(p.slug) || (p.tvl_usd < floor && isRankableBelowFloor(p)),
  );

  const scored = early.map((p) => ({
    protocol: p,
    implied: impliedValue(p, multipleByCategory.get(p.category ?? "Uncategorized")!, snapshot.as_of),
  }));
  scored.sort((a, b) => b.implied - a.implied || a.protocol.slug.localeCompare(b.protocol.slug));

  const rows: BoardRow[] = scored.map((s, i) => {
    const p = s.protocol;
    return {
      slug: p.slug,
      name: p.name,
      rank: i + 1,
      category: p.category ?? "Uncategorized",
      chains: [...p.chains],
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      age_days: ageDays(p.listed_at, snapshot.as_of),
      listed_at: p.listed_at,
      multiple: multipleByCategory.get(p.category ?? "Uncategorized")!,
      implied_value_usd: s.implied,
      watchlist: watchlist.has(p.slug),
      farm_steps: farmStepsFor(p.name, p.category ?? "Uncategorized", p.chains),
    };
  });

  const tokenized = snapshot.protocols
    .filter((p) => p.mcap_usd !== null)
    .sort((a, b) => b.mcap_usd! - a.mcap_usd! || a.slug.localeCompare(b.slug))
    .slice(0, 24);
  const live: LiveRow[] = tokenized.map((p) => ({
    slug: p.slug,
    name: p.name,
    category: p.category ?? "Uncategorized",
    tvl_usd: p.tvl_usd,
    mcap_usd: p.mcap_usd!,
  }));

  const totalImplied = rows.reduce((sum, r) => sum + r.implied_value_usd, 0);
  const issues = validateBoard(rows, snapshot);
  return { rows, live, multiples, marketMedian, totalImplied, issues };
}

/** Every gate-shaped check the program itself enforces before writing. */
export function validateBoard(rows: BoardRow[], snapshot: Snapshot): string[] {
  const issues: string[] = [];
  const slugs = new Set(snapshot.protocols.map((p) => p.slug));
  if (rows.length < 100 || rows.length > 4000) {
    issues.push(`board has ${rows.length} rows, outside 100-4000`);
  }
  const seen = new Set<string>();
  rows.forEach((r, i) => {
    if (!slugs.has(r.slug)) issues.push(`row ${i + 1}: slug ${r.slug} is not in the snapshot`);
    if (seen.has(r.slug)) issues.push(`row ${i + 1}: slug ${r.slug} appears twice`);
    seen.add(r.slug);
    if (r.rank !== i + 1) issues.push(`row ${i + 1}: rank is ${r.rank}, expected ${i + 1}`);
    if (!Number.isInteger(r.implied_value_usd) || r.implied_value_usd <= 0) {
      issues.push(`row ${i + 1}: implied value ${r.implied_value_usd} is not a positive whole number`);
    }
    if (i > 0 && r.implied_value_usd > rows[i - 1].implied_value_usd) {
      issues.push(`row ${i + 1}: implied value rises above rank ${i}`);
    }
    if (!r.name) issues.push(`row ${i + 1}: empty name`);
    if (r.farm_steps.length !== 7) {
      issues.push(`row ${i + 1}: ${r.farm_steps.length} farm steps, expected 7`);
    }
    r.farm_steps.forEach((s, j) => {
      const len = s.trim().length;
      if (len < 20 || len > 600) {
        issues.push(`row ${i + 1} step ${j + 1}: ${len} chars, outside 20-600`);
      }
    });
  });
  const values = new Set(rows.map((r) => r.implied_value_usd));
  if (rows.length > 1 && values.size === 1) {
    issues.push("every row carries the same implied value, so the board ranks nothing");
  }
  if (values.size !== rows.length) {
    issues.push(`${rows.length - values.size} rows share an implied value with another row`);
  }
  const missing = snapshot.watchlist.filter((s) => !seen.has(s));
  if (missing.length > 0) {
    issues.push(`watchlist slugs missing from the board: ${missing.join(", ")}`);
  }
  return issues;
}
