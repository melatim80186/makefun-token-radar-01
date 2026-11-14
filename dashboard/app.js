// Token Radar dashboard: renders the board from the embedded data, filters and
// sorts it, shows a detail view per protocol, and generates each farm plan.
// The farm-step generator below is a faithful port of lib/model.ts: same category
// templates, same amounts, same costs and times. Board data schema (embedded by
// main.ts as compact positional rows):
//   cats: category names by index
//   rows: [slug, name, catIdx, chainsPipe (first 3, "|" joined), chainCount,
//          tvl, change_7d|null, age_days|null, multiple, implied, watch 1/0,
//          category_median, peers, growth, maturity, chain]
//   liveTop: [name, category, tvl, symbol] of the largest live-token protocols.

const DATA = __BOARD_DATA_JSON__;

const rows = DATA.rows.map((r, i) => ({
  slug: r[0],
  name: r[1],
  cat: DATA.cats[r[2]] || '',
  chains: r[3] ? r[3].split('|') : [],
  chainCount: r[4],
  tvl: r[5],
  chg: r[6],
  age: r[7],
  mult: r[8],
  impl: r[9],
  watch: r[10] === 1,
  med: r[11],
  peers: r[12],
  growth: r[13],
  maturity: r[14],
  chainF: r[15],
  rank: i + 1,
}));
const maxImpl = rows.length ? rows[0].impl : 1;

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtMoney(v) {
  if (v >= 1e9) return '$' + trimNum(v / 1e9, 2) + 'B';
  if (v >= 1e6) return '$' + trimNum(v / 1e6, 1) + 'M';
  return '$' + Math.round(v / 1000) + 'K';
}

function trimNum(v, dp) {
  const s = v.toFixed(dp);
  return s.replace(/\.?0+$/, '');
}

function fmtAge(age) {
  if (age === null || age === undefined) return '—';
  if (age < 60) return age + 'd';
  if (age < 730) return Math.round(age / 30.44) + ' mo';
  return (age / 365).toFixed(1) + 'y';
}

function fmtChg(c) {
  if (c === null || c === undefined) return '—';
  const s = (c > 0 ? '+' : '') + c.toFixed(1) + '%';
  return '<span class="' + (c >= 0 ? 'up' : 'down') + '">' + s + '</span>';
}

function article(name) {
  const c = (name || '').slice(0, 1).toLowerCase();
  return c === 'a' || c === 'e' || c === 'i' || c === 'o' || c === 'u' ? 'an' : 'a';
}

// --- farm-step generator (port of lib/model.ts) ---
const CAT = {
  'Risk Curators': ['Deposit ${amt} into {art} {name} vault on {chain} and keep the shares.', 'vaults', 'a deposit, a vote or a rebalance'],
  'Onchain Capital Allocator': ['Deposit ${amt} into {art} {name} vault on {chain} and keep the shares.', 'vaults', 'a deposit, a withdrawal or a vote'],
  Dexs: ['Swap ${amt} through {name} on {chain} and add ${amt2} of liquidity to its deepest pool.', 'pools', 'a swap, a liquidity add or a vote'],
  Lending: ['Supply ${amt} of stablecoins to {name} on {chain} and borrow ${amt2} against the supply.', 'markets', 'a supply, a borrow or a repayment'],
  'Prediction Market': ['Place ${amt} across two outcomes on {name} on {chain} and leave both positions open.', 'markets', 'a new bet, a cash-out or a vote'],
  CDP: ['Mint ${amt} of the stablecoin by locking collateral in {name} on {chain}.', 'vaults', 'a mint, a repayment or a collateral top-up'],
  'CDP Manager': ['Open a ${amt} vault in {name} on {chain} and manage the collateral ratio weekly.', 'vaults', 'a vault rebalance, a repayment or a top-up'],
  RWA: ['Buy ${amt} of the tokenised asset on {name} on {chain} and hold the receipt.', 'holdings', 'a buy, a redemption or a vote'],
  Yield: ['Deposit ${amt} into the highest-yield {name} vault on {chain}.', 'vaults', 'a deposit, a harvest or a vault switch'],
  'Yield Aggregator': ['Deposit ${amt} into the highest-yield {name} vault on {chain}.', 'vaults', 'a deposit, a harvest or a vault switch'],
  Derivatives: ['Open one small hedged position of ${amt} on {name} on {chain}.', 'positions', 'a hedge, a close or a rebalance'],
  'Basis Trading': ['Open a ${amt} basis position on {name} on {chain} and hold it through one funding cycle.', 'positions', 'a basis open, a close or a roll'],
  Chain: ['Use ${amt} across two apps on {name} on {chain} and keep the wallet active.', 'apps', 'an app use, a swap or a vote'],
  'Staking Pool': ['Stake ${amt} in the {name} pool on {chain} and keep the stake through one epoch.', 'pools', 'a stake, an unstake or a claim'],
  'Liquidity Manager': ['Deposit ${amt} into a {name} managed position on {chain}.', 'positions', 'a deposit, a rebalance or a withdrawal'],
  'Leveraged Farming': ['Open a ${amt} leveraged farm on {name} on {chain} at low leverage.', 'farms', 'a farm open, a harvest or a deleverage'],
  Restaking: ['Restake ${amt} through {name} on {chain} and keep the position through one epoch.', 'positions', 'a restake, a claim or a withdrawal'],
  'Anchor BTC': ['Lock ${amt} of BTC value in {name} on {chain} and hold the receipt.', 'vaults', 'a lock, a mint or a redemption'],
  'Decentralized BTC': ['Lock ${amt} of BTC value in {name} on {chain} and hold the receipt.', 'vaults', 'a lock, a mint or a redemption'],
  CeDeFi: ['Deposit ${amt} into {name} on {chain} and use one of its CeDeFi vaults.', 'vaults', 'a deposit, a vault use or a withdrawal'],
  'Dual-Token Stablecoin': ['Mint ${amt} of the stablecoin pair on {name} on {chain}.', 'vaults', 'a mint, a burn or a swap'],
  'Uncollateralized Lending': ['Lend ${amt} through {name} on {chain} to one borrower pool.', 'pools', 'a lend, a repayment or a claim'],
  'Interest Rate Derivatives': ['Open a ${amt} rate position on {name} on {chain}.', 'positions', 'a rate open, a close or a roll'],
  Insurance: ['Buy ${amt} of cover on {name} on {chain} for one of its listed protocols.', 'policies', 'a cover buy, a claim or a renewal'],
  Farm: ['Deposit ${amt} into the top farm on {name} on {chain}.', 'farms', 'a deposit, a harvest or a farm switch'],
  Payments: ['Send ${amt} through {name} on {chain} and keep the wallet active weekly.', 'payments', 'a payment, a top-up or a vote'],
  'Governance Incentives': ['Lock ${amt} in governance on {name} on {chain} and vote on one proposal.', 'votes', 'a lock, a vote or a claim'],
  'Crypto Card Issuer': ['Spend ${amt} through the {name} card on {chain} and keep the card active.', 'payments', 'a spend, a top-up or a vote'],
  'Stablecoin Wrapper': ['Wrap ${amt} through {name} on {chain} and hold the wrapped balance.', 'balances', 'a wrap, an unwrap or a swap'],
  Indexes: ['Buy ${amt} of the {name} index on {chain} and hold it.', 'holdings', 'a buy, a rebalance or a sale'],
  'Collateral Markets': ['Post ${amt} of collateral on {name} on {chain}.', 'positions', 'a post, a borrow or a withdrawal'],
  'OTC Marketplace': ['Place a ${amt} order on {name} on {chain} and settle it.', 'orders', 'an order, a settlement or a vote'],
  'Cross Chain Bridge': ['Bridge ${amt} through {name} on {chain} and keep the receipt.', 'bridges', 'a bridge, a claim or a swap'],
};
const DEFAULT_CAT = ['Use {name} on {chain} with ${amt} and keep the position open.', 'positions', 'a deposit, a borrow, a swap or a vote'];

function farmSteps(row) {
  const name = row.name;
  const chains = row.chains.length ? row.chains : ['Ethereum'];
  const chain = chains[0];
  const tvl = row.tvl;
  const amt = tvl >= 1e9 ? 150 : tvl >= 1e8 ? 100 : 50;
  const gas = tvl >= 1e9 ? 8 : tvl >= 1e8 ? 6 : 4;
  const ageInternal = row.age === null ? 365 : row.age;
  const hold = ageInternal < 180 ? 30 : ageInternal < 540 ? 45 : 60;
  const plan = CAT[row.cat] || DEFAULT_CAT;
  // Replace only the {amt}/{amt2} placeholders: the "$" in front of them is
  // literal template text ("Deposit ${amt}" -> "Deposit $150"). Replacing the
  // whole "${amt}" token would swallow the dollar sign.
  let step2 = plan[0].split('{amt}').join(String(amt)).split('{amt2}').join('25')
    .split('{name}').join(name).split('{chain}').join(chain).split('{art}').join(article(name));
  step2 += ' Cost: $' + amt + ' of capital and about $' + gas + ' of gas. Time: 15 minutes to set up.';
  const chainClause = chains.length >= 2
    ? ', rotating across two of its chains (' + chains[0] + ' and ' + chains[1] + ')'
    : '';
  return [
    'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. Cost: under $3 of gas for the first transaction. Time: 5 minutes.',
    step2,
    'Move $25 between two of ' + name + "'s " + plan[1] + ', so the wallet shows activity in more than one. Cost: about $25 of activity and $2 of gas. Time: 10 minutes.',
    'Make one qualifying action each week' + chainClause + ', such as ' + plan[2] + '. Cost: about $2 of gas a week. Time: 10 minutes a week.',
    'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot. Cost: the $' + amt + ' stays in the position. Time: ' + hold + ' days.',
    "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes. Cost: no fee to check, and never pay to claim. Time: 10 minutes.",
    'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it. Cost: nothing but the log. Time: 5 minutes.',
  ];
}

// --- rendering ---
const $ = (id) => document.getElementById(id);
const state = { q: '', cat: '', chain: '', minTvl: 0, sortKey: 'rank', sortDir: 1, live: false };

function chainsLabel(row) {
  const shown = row.chains.slice(0, 3).join(', ');
  const extra = row.chainCount - row.chains.length;
  return shown + (extra > 0 ? ' +' + extra : '');
}

function renderBoard() {
  const body = $('board-body');
  let list = rows.slice();
  if (state.q) {
    const q = state.q.toLowerCase();
    list = list.filter((r) =>
      r.name.toLowerCase().includes(q) || r.cat.toLowerCase().includes(q) ||
      r.chains.join(' ').toLowerCase().includes(q) || r.slug.includes(q));
  }
  if (state.cat) list = list.filter((r) => r.cat === state.cat);
  if (state.chain) list = list.filter((r) => r.chains.includes(state.chain));
  if (state.minTvl) list = list.filter((r) => r.tvl >= state.minTvl);
  const key = state.sortKey;
  const dir = state.sortDir;
  list.sort((a, b) => {
    let d = 0;
    if (key === 'rank' || key === 'impl') d = a.impl - b.impl;
    else if (key === 'name') d = a.name.localeCompare(b.name);
    else if (key === 'tvl') d = a.tvl - b.tvl;
    else if (key === 'chg') d = (a.chg ?? -999) - (b.chg ?? -999);
    else if (key === 'age') d = (a.age ?? -1) - (b.age ?? -1);
    else if (key === 'mult') d = a.mult - b.mult;
    return key === 'rank' ? d * dir : -d * dir;
  });
  if (key === 'rank' && dir === 1) list = rows.filter((r) => list.includes(r));
  body.innerHTML = list.map((r) => {
    const barW = Math.max(4, Math.round((r.impl / maxImpl) * 120));
    return '<tr data-slug="' + esc(r.slug) + '">' +
      '<td class="rank">' + r.rank + '</td>' +
      '<td><div class="pname">' + esc(r.name) +
      '<span class="badge' + (r.watch ? '' : ' early') + '">' + (r.watch ? 'Watchlist' : 'Early') + '</span></div>' +
      '<div class="psub">' + esc(r.cat) + ' on ' + esc(chainsLabel(r)) + '</div></td>' +
      '<td class="num">' + fmtMoney(r.tvl) + '</td>' +
      '<td class="num">' + fmtChg(r.chg) + '</td>' +
      '<td class="num">' + fmtAge(r.age) + '</td>' +
      '<td class="num">' + r.mult.toFixed(4) + '&times;</td>' +
      '<td class="num"><span class="bar" style="width:' + barW + 'px"></span>' + fmtMoney(r.impl) + '</td>' +
      '<td><span class="dot">&#9679; no token</span></td></tr>';
  }).join('');
  $('row-count').textContent = list.length + ' rows shown';
  body.querySelectorAll('tr').forEach((tr) => {
    tr.addEventListener('click', () => showDetail(tr.getAttribute('data-slug')));
  });
}

function renderLiveInto(tbodyId) {
  const tb = $(tbodyId);
  tb.innerHTML = DATA.liveTop.map((p) =>
    '<tr><td><div class="pname">' + esc(p[0]) + '</div></td>' +
    '<td>' + esc(p[1]) + '</td>' +
    '<td class="num">' + fmtMoney(p[2]) + '</td>' +
    '<td>' + esc(p[3] || '—') + '</td></tr>').join('');
}

function showDetail(slug) {
  const r = rows.find((x) => x.slug === slug);
  if (!r) return;
  document.querySelectorAll('.tabpanel').forEach((s) => { s.hidden = true; });
  $('tab-detail').hidden = false;
  $('d-name').textContent = '#' + r.rank + ' ' + r.name;
  $('d-sub').textContent = r.cat + ' on ' + chainsLabel(r) + ' · TVL ' + fmtMoney(r.tvl) +
    ' · no token for ' + fmtAge(r.age) + (r.watch ? ' · Watchlist' : ' · Early');
  const f = [
    ['Multiple', r.mult.toFixed(4) + '×'],
    ['Category median', r.med.toFixed(4) + '×'],
    ['Peers', String(r.peers)],
    ['Market median', DATA.M.toFixed(4) + '×'],
    ['Growth', '×' + r.growth.toFixed(4)],
    ['Maturity', '×' + r.maturity.toFixed(4)],
    ['Chain reach', '×' + r.chainF.toFixed(2)],
    ['Implied value', fmtMoney(r.impl)],
  ];
  $('d-factors').innerHTML = f.map((x) =>
    '<div class="factor"><b>' + esc(x[1]) + '</b><span>' + esc(x[0]) + '</span></div>').join('');
  $('d-steps').innerHTML = farmSteps(r).map((s) => '<li>' + esc(s) + '</li>').join('');
  window.scrollTo(0, 0);
}

function showTab(name) {
  document.querySelectorAll('.tabpanel').forEach((s) => { s.hidden = true; });
  $('tab-' + name).hidden = false;
  document.querySelectorAll('.tab').forEach((b) => {
    b.classList.toggle('active', b.getAttribute('data-tab') === name);
  });
}

function init() {
  const watchN = rows.filter((r) => r.watch).length;
  $('stat-watchlist').textContent = watchN + ' / ' + watchN;
  $('stat-rows').textContent = String(rows.length);
  $('stat-early').textContent = String(rows.length - watchN);
  $('stat-live').textContent = String(DATA.liveCount);
  $('stat-total').textContent = fmtMoney(DATA.total);
  $('stat-median').textContent = DATA.M.toFixed(4) + '×';
  $('m-numbers').textContent = rows.length + ' pre-token rows, ' + watchN + ' of them the watchlist; market median ' +
    DATA.M.toFixed(4) + '×; shrinkage prior k = ' + DATA.k + '.';
  $('t-count').textContent = String(DATA.liveCount);

  const cats = [...new Set(rows.map((r) => r.cat))].sort();
  $('f-cat').innerHTML = '<option value="">All categories</option>' +
    cats.map((c) => '<option>' + esc(c) + '</option>').join('');
  const chains = [...new Set(rows.flatMap((r) => r.chains))].sort();
  $('f-chain').innerHTML = '<option value="">All chains</option>' +
    chains.map((c) => '<option>' + esc(c) + '</option>').join('');

  renderLiveInto('live-body');
  renderLiveInto('t-body');
  renderBoard();

  $('q').addEventListener('input', (e) => { state.q = e.target.value; renderBoard(); });
  $('f-cat').addEventListener('change', (e) => { state.cat = e.target.value; renderBoard(); });
  $('f-chain').addEventListener('change', (e) => { state.chain = e.target.value; renderBoard(); });
  $('f-tvl').addEventListener('change', (e) => { state.minTvl = Number(e.target.value); renderBoard(); });
  $('clear-filters').addEventListener('click', () => {
    state.q = ''; state.cat = ''; state.chain = ''; state.minTvl = 0;
    $('q').value = ''; $('f-cat').value = ''; $('f-chain').value = ''; $('f-tvl').value = '0';
    renderBoard();
  });
  $('pill-pre').addEventListener('click', () => {
    state.live = false;
    $('pill-pre').classList.add('active');
    $('pill-live').classList.remove('active');
    $('board').hidden = false;
    $('live-list').hidden = true;
  });
  $('pill-live').addEventListener('click', () => {
    state.live = true;
    $('pill-live').classList.add('active');
    $('pill-pre').classList.remove('active');
    $('board').hidden = true;
    $('live-list').hidden = false;
  });
  document.querySelectorAll('th[data-sort]').forEach((th) => {
    th.addEventListener('click', () => {
      const k = th.getAttribute('data-sort');
      if (state.sortKey === k) state.sortDir = -state.sortDir;
      else { state.sortKey = k; state.sortDir = 1; }
      renderBoard();
    });
  });
  document.querySelectorAll('.tab').forEach((b) => {
    b.addEventListener('click', () => showTab(b.getAttribute('data-tab')));
  });
  $('d-back').addEventListener('click', () => showTab('board'));

  const hash = window.location.hash || '';
  const dm = hash.match(/#detail=([\w-]+)/);
  if (dm) { showDetail(dm[1]); return; }
  const fm = hash.match(/#filter=(.+)/);
  if (fm) {
    const cat = decodeURIComponent(fm[1]);
    state.cat = cat;
    $('f-cat').value = cat;
    renderBoard();
  }
}

document.addEventListener('DOMContentLoaded', init);
