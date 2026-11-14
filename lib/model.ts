// token-radar-01 v3 — model: board builder + farm-step generator.
// Pure TypeScript: no Node APIs, no network, no hardcoded protocol names.
// The board is derived from the snapshot's own figures only.
// Re-authored in this session from the spec in rebuild-v3/ROUND1.md.

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

export interface ModelFactors {
  category_median: number;
  peers: number;
  market_median: number;
  shrinkage_k: number;
  growth: number;
  maturity: number;
  chain: number;
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
  rank: number;
  watchlist: boolean;
  model: ModelFactors;
  farm_steps: string[];
}

// Categories the house's watchlist rule sets aside: a protocol in one of these
// records no token, but the category itself is a wrapped, staked or bridged product
// of a token that already trades (or an exchange). The same tests decide the board:
// the watchlist is the floor, never the ceiling, and a board may rank protocols the
// watchlist leaves out — but a wrapped/staked/bridged product is not a launch.
export const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

const EXCHANGE_NAMES = new Set([
  'binance',
  'coinbase',
  'bybit',
  'kraken',
  'bitget',
  'okx',
  'bitfinex',
  'gemini',
]);

const VERSION_MARKER = /\s(v\d+|V\d+|\d+\.\d+)\s*$/;

export const SHRINKAGE_K = 3;
export const PEER_RATIO_CAP = 2.0;
export const MULTIPLE_FLOOR = 0.02;

export function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}

export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return NaN;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function isPreToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

function isExcludedProduct(p: SnapshotProtocol): boolean {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return true;
  const name = p.name || '';
  if (VERSION_MARKER.test(name)) return true;
  const words = new Set(name.toLowerCase().split(/\s+/));
  if (words.has('wrapped') || words.has('staked') || words.has('staking')) return true;
  const first = name.toLowerCase().split(' ')[0];
  if (EXCHANGE_NAMES.has(first)) return true;
  return false;
}

/** The board's subjects: the watchlist as given, plus every pre-token protocol
 *  below the floor that is not a wrapped/staked/bridged product. The rule itself
 *  decides the board; no TVL cutoff beyond it, no list of names. */
export function boardSubjects(snap: Snapshot): SnapshotProtocol[] {
  const wl = new Set(snap.watchlist);
  const bySlug = new Map(snap.protocols.map((p) => [p.slug, p]));
  const out: SnapshotProtocol[] = [];
  for (const slug of snap.watchlist) {
    const p = bySlug.get(slug);
    if (p) out.push(p);
  }
  for (const p of snap.protocols) {
    if (wl.has(p.slug)) continue;
    if (!isPreToken(p)) continue;
    if (isExcludedProduct(p)) continue;
    out.push(p);
  }
  return out;
}

function ageDays(asOf: string, listedAt: string | null): { age: number; out: number | null } {
  if (!listedAt) return { age: 365, out: null };
  const day = 86400000;
  const a = Date.parse(asOf + 'T00:00:00Z');
  const b = Date.parse(listedAt + 'T00:00:00Z');
  const age = Math.max(0, Math.round((a - b) / day));
  return { age, out: age };
}

function article(name: string): string {
  const c = (name || '').slice(0, 1).toLowerCase();
  return c === 'a' || c === 'e' || c === 'i' || c === 'o' || c === 'u' ? 'an' : 'a';
}

interface CatPlan {
  step2: string;
  venue: string;
  weekly: string;
}

const CAT: Record<string, CatPlan> = {
  'Risk Curators': {
    step2: 'Deposit ${amt} into {art} {name} vault on {chain} and keep the shares.',
    venue: 'vaults',
    weekly: 'a deposit, a vote or a rebalance',
  },
  'Onchain Capital Allocator': {
    step2: 'Deposit ${amt} into {art} {name} vault on {chain} and keep the shares.',
    venue: 'vaults',
    weekly: 'a deposit, a withdrawal or a vote',
  },
  Dexs: {
    step2: 'Swap ${amt} through {name} on {chain} and add ${amt2} of liquidity to its deepest pool.',
    venue: 'pools',
    weekly: 'a swap, a liquidity add or a vote',
  },
  Lending: {
    step2: 'Supply ${amt} of stablecoins to {name} on {chain} and borrow ${amt2} against the supply.',
    venue: 'markets',
    weekly: 'a supply, a borrow or a repayment',
  },
  'Prediction Market': {
    step2: 'Place ${amt} across two outcomes on {name} on {chain} and leave both positions open.',
    venue: 'markets',
    weekly: 'a new bet, a cash-out or a vote',
  },
  CDP: {
    step2: 'Mint ${amt} of the stablecoin by locking collateral in {name} on {chain}.',
    venue: 'vaults',
    weekly: 'a mint, a repayment or a collateral top-up',
  },
  'CDP Manager': {
    step2: 'Open a ${amt} vault in {name} on {chain} and manage the collateral ratio weekly.',
    venue: 'vaults',
    weekly: 'a vault rebalance, a repayment or a top-up',
  },
  RWA: {
    step2: 'Buy ${amt} of the tokenised asset on {name} on {chain} and hold the receipt.',
    venue: 'holdings',
    weekly: 'a buy, a redemption or a vote',
  },
  Yield: {
    step2: 'Deposit ${amt} into the highest-yield {name} vault on {chain}.',
    venue: 'vaults',
    weekly: 'a deposit, a harvest or a vault switch',
  },
  'Yield Aggregator': {
    step2: 'Deposit ${amt} into the highest-yield {name} vault on {chain}.',
    venue: 'vaults',
    weekly: 'a deposit, a harvest or a vault switch',
  },
  Derivatives: {
    step2: 'Open one small hedged position of ${amt} on {name} on {chain}.',
    venue: 'positions',
    weekly: 'a hedge, a close or a rebalance',
  },
  'Basis Trading': {
    step2: 'Open a ${amt} basis position on {name} on {chain} and hold it through one funding cycle.',
    venue: 'positions',
    weekly: 'a basis open, a close or a roll',
  },
  Chain: {
    step2: 'Use ${amt} across two apps on {name} on {chain} and keep the wallet active.',
    venue: 'apps',
    weekly: 'an app use, a swap or a vote',
  },
  'Staking Pool': {
    step2: 'Stake ${amt} in the {name} pool on {chain} and keep the stake through one epoch.',
    venue: 'pools',
    weekly: 'a stake, an unstake or a claim',
  },
  'Liquidity Manager': {
    step2: 'Deposit ${amt} into a {name} managed position on {chain}.',
    venue: 'positions',
    weekly: 'a deposit, a rebalance or a withdrawal',
  },
  'Leveraged Farming': {
    step2: 'Open a ${amt} leveraged farm on {name} on {chain} at low leverage.',
    venue: 'farms',
    weekly: 'a farm open, a harvest or a deleverage',
  },
  Restaking: {
    step2: 'Restake ${amt} through {name} on {chain} and keep the position through one epoch.',
    venue: 'positions',
    weekly: 'a restake, a claim or a withdrawal',
  },
  'Anchor BTC': {
    step2: 'Lock ${amt} of BTC value in {name} on {chain} and hold the receipt.',
    venue: 'vaults',
    weekly: 'a lock, a mint or a redemption',
  },
  'Decentralized BTC': {
    step2: 'Lock ${amt} of BTC value in {name} on {chain} and hold the receipt.',
    venue: 'vaults',
    weekly: 'a lock, a mint or a redemption',
  },
  CeDeFi: {
    step2: 'Deposit ${amt} into {name} on {chain} and use one of its CeDeFi vaults.',
    venue: 'vaults',
    weekly: 'a deposit, a vault use or a withdrawal',
  },
  'Dual-Token Stablecoin': {
    step2: 'Mint ${amt} of the stablecoin pair on {name} on {chain}.',
    venue: 'vaults',
    weekly: 'a mint, a burn or a swap',
  },
  'Uncollateralized Lending': {
    step2: 'Lend ${amt} through {name} on {chain} to one borrower pool.',
    venue: 'pools',
    weekly: 'a lend, a repayment or a claim',
  },
  'Interest Rate Derivatives': {
    step2: 'Open a ${amt} rate position on {name} on {chain}.',
    venue: 'positions',
    weekly: 'a rate open, a close or a roll',
  },
  Insurance: {
    step2: 'Buy ${amt} of cover on {name} on {chain} for one of its listed protocols.',
    venue: 'policies',
    weekly: 'a cover buy, a claim or a renewal',
  },
  Farm: {
    step2: 'Deposit ${amt} into the top farm on {name} on {chain}.',
    venue: 'farms',
    weekly: 'a deposit, a harvest or a farm switch',
  },
  Payments: {
    step2: 'Send ${amt} through {name} on {chain} and keep the wallet active weekly.',
    venue: 'payments',
    weekly: 'a payment, a top-up or a vote',
  },
  'Governance Incentives': {
    step2: 'Lock ${amt} in governance on {name} on {chain} and vote on one proposal.',
    venue: 'votes',
    weekly: 'a lock, a vote or a claim',
  },
  'Crypto Card Issuer': {
    step2: 'Spend ${amt} through the {name} card on {chain} and keep the card active.',
    venue: 'payments',
    weekly: 'a spend, a top-up or a vote',
  },
  'Stablecoin Wrapper': {
    step2: 'Wrap ${amt} through {name} on {chain} and hold the wrapped balance.',
    venue: 'balances',
    weekly: 'a wrap, an unwrap or a swap',
  },
  Indexes: {
    step2: 'Buy ${amt} of the {name} index on {chain} and hold it.',
    venue: 'holdings',
    weekly: 'a buy, a rebalance or a sale',
  },
  'Collateral Markets': {
    step2: 'Post ${amt} of collateral on {name} on {chain}.',
    venue: 'positions',
    weekly: 'a post, a borrow or a withdrawal',
  },
  'OTC Marketplace': {
    step2: 'Place a ${amt} order on {name} on {chain} and settle it.',
    venue: 'orders',
    weekly: 'an order, a settlement or a vote',
  },
  'Cross Chain Bridge': {
    step2: 'Bridge ${amt} through {name} on {chain} and keep the receipt.',
    venue: 'bridges',
    weekly: 'a bridge, a claim or a swap',
  },
};

const DEFAULT_CAT: CatPlan = {
  step2: 'Use {name} on {chain} with ${amt} and keep the position open.',
  venue: 'positions',
  weekly: 'a deposit, a borrow, a swap or a vote',
};

export function farmSteps(
  p: SnapshotProtocol,
  ageInternal: number,
): string[] {
  const name = p.name;
  const cat = p.category ?? '';
  const chains = p.chains.length > 0 ? p.chains : ['Ethereum'];
  const chain = chains[0];
  const tvl = p.tvl_usd;
  const amt = tvl >= 1000000000 ? 150 : tvl >= 100000000 ? 100 : 50;
  const gas = tvl >= 1000000000 ? 8 : tvl >= 100000000 ? 6 : 4;
  const hold = ageInternal < 180 ? 30 : ageInternal < 540 ? 45 : 60;
  const plan = CAT[cat] ?? DEFAULT_CAT;
  // Replace only the {amt}/{amt2} placeholders: the "$" in front of them is
  // literal template text ("Deposit ${amt}" -> "Deposit $150"). Replacing the
  // whole "${amt}" token would swallow the dollar sign.
  let step2 = plan.step2
    .replaceAll('{amt}', String(amt))
    .replaceAll('{amt2}', '25')
    .replaceAll('{name}', name)
    .replaceAll('{chain}', chain)
    .replaceAll('{art}', article(name));
  step2 += ` Cost: $${amt} of capital and about $${gas} of gas. Time: 15 minutes to set up.`;
  const chainClause =
    chains.length >= 2
      ? `, rotating across two of its chains (${chains[0]} and ${chains[1]})`
      : '';
  return [
    'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. Cost: under $3 of gas for the first transaction. Time: 5 minutes.',
    step2,
    `Move $25 between two of ${name}'s ${plan.venue}, so the wallet shows activity in more than one. Cost: about $25 of activity and $2 of gas. Time: 10 minutes.`,
    `Make one qualifying action each week${chainClause}, such as ${plan.weekly}. Cost: about $2 of gas a week. Time: 10 minutes a week.`,
    `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot. Cost: the $${amt} stays in the position. Time: ${hold} days.`,
    "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes. Cost: no fee to check, and never pay to claim. Time: 10 minutes.",
    'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it. Cost: nothing but the log. Time: 5 minutes.',
  ];
}

export interface BoardResult {
  rows: BoardRow[];
  marketMedian: number;
  totalImplied: number;
  liveTokenCount: number;
  liveTokenTop: { name: string; category: string | null; tvl_usd: number; symbol: string | null }[];
}

/** Build the ranked board from the snapshot. */
export function buildBoard(snap: Snapshot): BoardResult {
  const subjects = boardSubjects(snap);
  const wl = new Set(snap.watchlist);

  // Peer ratios: tokenized protocols (mcap recorded) in each category.
  const byCategory = new Map<string, number[]>();
  const allRatios: number[] = [];
  for (const p of snap.protocols) {
    const m = p.mcap_usd;
    const t = p.tvl_usd;
    if (m === null || m <= 0 || !t || t <= 0) continue;
    const r = Math.min(m / t, PEER_RATIO_CAP);
    const key = p.category ?? '';
    const arr = byCategory.get(key) ?? [];
    arr.push(r);
    byCategory.set(key, arr);
    allRatios.push(r);
  }
  const marketMedian = round4(median(allRatios));

  const rows: BoardRow[] = [];
  for (const p of subjects) {
    const key = p.category ?? '';
    const peerRatios = byCategory.get(key) ?? [];
    const n = peerRatios.length;
    const catMedian = n > 0 ? round4(median(peerRatios)) : marketMedian;
    let multiple = n === 0 ? marketMedian : round4((catMedian * n + marketMedian * SHRINKAGE_K) / (n + SHRINKAGE_K));
    if (multiple < MULTIPLE_FLOOR) multiple = MULTIPLE_FLOOR;
    const chg = p.change_7d;
    const growth = 1 + Math.max(-50, Math.min(100, chg === null ? 0 : chg)) / 100 * 0.5;
    const { age, out } = ageDays(snap.as_of, p.listed_at);
    const maturity = 0.6 + (Math.min(age, 1095) / 1095) * 0.4;
    const chainF = 1 + 0.02 * Math.min(p.chains.length - 1, 5);
    const implied = Math.round(p.tvl_usd * multiple * growth * maturity * chainF);
    rows.push({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: chg,
      age_days: out,
      multiple,
      implied_value_usd: implied,
      rank: 0,
      watchlist: wl.has(p.slug),
      model: {
        category_median: catMedian,
        peers: n,
        market_median: marketMedian,
        shrinkage_k: SHRINKAGE_K,
        growth: round4(growth),
        maturity: round4(maturity),
        chain: round4(chainF),
      },
      farm_steps: farmSteps(p, age),
    });
  }

  rows.sort(
    (a, b) =>
      b.implied_value_usd - a.implied_value_usd ||
      b.tvl_usd - a.tvl_usd ||
      (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0),
  );
  rows.forEach((r, i) => {
    r.rank = i + 1;
  });

  const totalImplied = rows.reduce((s, r) => s + r.implied_value_usd, 0);
  const live = snap.protocols.filter((p) => !isPreToken(p));
  const liveTop = [...live]
    .sort((a, b) => b.tvl_usd - a.tvl_usd)
    .slice(0, 12)
    .map((p) => ({ name: p.name, category: p.category, tvl_usd: p.tvl_usd, symbol: p.symbol }));

  return { rows, marketMedian, totalImplied, liveTokenCount: live.length, liveTokenTop: liveTop };
}
