// app.js — Token Radar dashboard.
// The board data is injected by main.ts (it replaces the data placeholder in
// this file with the compact board). The page renders the board, the detail
// view and the multiples table, and regenerates each protocol's farm plan
// client-side with the same generator the board was built with, so the page
// and board.json can never disagree about a plan.
//
// Compact row layout:
// [rank, slug, name, category, chains, tvl, implied, change_7d, age_days,
//  multiple, peers, category_median, growth, maturity, chain]

const BOARD_DATA = __BOARD_DATA_JSON__;

const META = {
  asOf: BOARD_DATA.asOf,
  floorUsd: BOARD_DATA.floorUsd,
  marketMedian: BOARD_DATA.marketMedian,
  totalImpliedUsd: BOARD_DATA.totalImpliedUsd,
  watchlistCovered: BOARD_DATA.watchlistCovered,
  watchlistTotal: BOARD_DATA.watchlistTotal,
};
const ROWS = BOARD_DATA.rows.map((r) => ({
  rank: r[0], slug: r[1], name: r[2], category: r[3], chains: r[4],
  tvl: r[5], implied: r[6], chg: r[7], age: r[8], mult: r[9], peers: r[10],
  median: r[11], growth: r[12], maturity: r[13], chain: r[14],
}));

// --- Farm plans: the same generator as lib/model.ts farmSteps() -----------
function farmCapital(tvl) {
  if (tvl >= 1000000000) return 150;
  if (tvl >= 100000000) return 100;
  return 50;
}
function farmHoldDays(age) {
  if (age === null || age === undefined) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}
function articleFor(name) {
  return /^[aeiou]/i.test(name.trim()) ? "an" : "a";
}
const STEP2 = {
  "Risk Curators": "vault", "Onchain Capital Allocator": "vault",
  "Yield": "yield-vault", "Yield Aggregator": "yield-vault",
  "Farm": "farm", "Liquidity Manager": "managed",
  "Anchor BTC": "deposit", "CeDeFi": "deposit",
  "Crypto Card Issuer": "deposit", "Decentralized BTC": "deposit",
  "Governance Incentives": "deposit",
  "Lending": "supply", "Collateral Markets": "supply",
  "Uncollateralized Lending": "supply",
  "Dexs": "liquidity", "Indexes": "liquidity", "Leveraged Farming": "liquidity",
  "Basis Trading": "margin", "Derivatives": "margin",
  "Interest Rate Derivatives": "margin",
  "CDP": "mint-stable",
  "Dual-Token Stablecoin": "mint-stable-asset",
  "Stablecoin Wrapper": "mint-stable-asset",
  "Chain": "bridge-chain", "Insurance": "cover", "Payments": "payment",
  "Prediction Market": "predict", "RWA": "mint-yield-asset",
  "Restaking": "stake", "Staking Pool": "stake",
};
const STEP3 = {
  "Risk Curators": "vault-move", "Onchain Capital Allocator": "vault-move",
  "Yield": "harvest", "Yield Aggregator": "harvest",
  "Farm": "rebalance", "Liquidity Manager": "rebalance",
  "Anchor BTC": "generic", "CeDeFi": "generic", "Chain": "generic",
  "Crypto Card Issuer": "generic", "Decentralized BTC": "generic",
  "Governance Incentives": "generic",
  "CDP": "borrow", "Lending": "borrow", "Collateral Markets": "borrow",
  "Uncollateralized Lending": "borrow",
  "Dexs": "swap-pool", "Indexes": "swap-pool", "Leveraged Farming": "swap-pool",
  "Basis Trading": "hedge", "Derivatives": "hedge",
  "Interest Rate Derivatives": "hedge",
  "Dual-Token Stablecoin": "swap-stable", "Stablecoin Wrapper": "swap-stable",
  "Insurance": "cover2", "Payments": "payment2",
  "Prediction Market": "predict2", "RWA": "rwa-redeem",
  "Restaking": "stake2", "Staking Pool": "stake2",
};
function step2Text(kind, name, chain0, cap, gas) {
  const cost = " Cost: $" + cap + " of capital and about $" + gas +
    " of gas. Time: 15 minutes to set up.";
  switch (kind) {
    case "vault": return "Deposit $" + cap + " into " + articleFor(name) + " " + name + " vault on " + chain0 + " and keep the shares." + cost;
    case "yield-vault": return "Deposit $" + cap + " into " + name + "'s highest-yield vault on " + chain0 + " and keep the shares." + cost;
    case "farm": return "Deposit $" + cap + " into " + name + "'s main farm on " + chain0 + " and keep the position staked." + cost;
    case "managed": return "Deposit $" + cap + " into " + articleFor(name) + " " + name + " managed position on " + chain0 + " and keep it open." + cost;
    case "deposit": return "Deposit $" + cap + " of USDC into " + name + " on " + chain0 + " and keep the position open." + cost;
    case "supply": return "Supply $" + cap + " of USDC to " + name + " on " + chain0 + " and keep the position open." + cost;
    case "liquidity": return "Provide $" + cap + " of liquidity to " + name + "'s main pool on " + chain0 + " and keep the position open." + cost;
    case "margin": return "Deposit $" + cap + " of USDC as margin on " + name + " and open one small hedged position." + cost;
    case "mint-stable": return "Mint $" + cap + " of the stablecoin by locking collateral in " + name + " on " + chain0 + "." + cost;
    case "mint-stable-asset": return "Mint or deposit $" + cap + " of the stable asset through " + name + " on " + chain0 + "." + cost;
    case "bridge-chain": return "Bridge $" + cap + " onto the chain " + name + " secures and use one of its apps." + cost;
    case "cover": return "Buy $" + cap + " of cover from " + name + " on " + chain0 + " and keep the policy active." + cost;
    case "payment": return "Send one $" + cap + " payment through " + name + " on " + chain0 + " and keep the receipt." + cost;
    case "predict": return "Fund $" + cap + " and place one market position on " + name + "." + cost;
    case "mint-yield-asset": return "Mint $" + cap + " of the protocol's yield-bearing asset on " + chain0 + " and hold it." + cost;
    case "stake": return "Stake $" + cap + " of the chain's staking asset through " + name + " and keep the receipt token." + cost;
    default: return "Deposit $" + cap + " of USDC into " + name + " on " + chain0 + " and keep the position open." + cost;
  }
}
function step3Text(kind, name) {
  const cost = " Cost: about $25 of activity and $2 of gas. Time: 10 minutes.";
  switch (kind) {
    case "vault-move": return "Move $25 between two of " + name + "'s vaults, so the wallet shows activity in more than one." + cost;
    case "harvest": return "Claim or compound the yield once, so the wallet shows a harvest from " + name + "." + cost;
    case "rebalance": return "Rebalance the position once, so the wallet shows a second transaction on " + name + "." + cost;
    case "generic": return "Make one more qualifying action of a different kind than the first on " + name + "." + cost;
    case "borrow": return "Borrow $25 against the supply and repay it a week later, so the wallet shows both sides of " + name + "." + cost;
    case "swap-pool": return "Swap $25 through the same pool once, so the wallet shows a trade as well as liquidity on " + name + "." + cost;
    case "hedge": return "Close the hedge and open a fresh one, so the wallet shows two round trips on " + name + "." + cost;
    case "swap-stable": return "Swap $25 of the stable asset through " + name + "'s own route." + cost;
    case "cover2": return "Open a second small cover on another pool of " + name + "." + cost;
    case "payment2": return "Make a second $25 payment to a different address through " + name + "." + cost;
    case "predict2": return "Settle one market and open another, so the wallet shows two positions on " + name + "." + cost;
    case "rwa-redeem": return "Redeem a small part of the yield asset and re-mint it through " + name + "." + cost;
    case "stake2": return "Delegate a second small stake through " + name + " and keep both receipts." + cost;
    default: return "Make one more qualifying action of a different kind than the first on " + name + "." + cost;
  }
}
function farmSteps(row) {
  const cap = farmCapital(row.tvl);
  const gas = cap === 150 ? 8 : 4;
  const hold = farmHoldDays(row.age);
  const chain0 = row.chains[0] || "its chain";
  const kind2 = STEP2[row.category] || "deposit";
  const kind3 = STEP3[row.category] || "generic";
  const step4 = row.chains.length >= 2
    ? "Make one qualifying action each week, rotating across two of its chains (" + row.chains[0] + " and " + row.chains[1] + "), such as a deposit, a borrow, a swap or a vote. Cost: about $2 of gas a week. Time: 10 minutes a week."
    : "Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote. Cost: about $2 of gas a week. Time: 10 minutes a week.";
  return [
    "Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. Cost: under $3 of gas for the first transaction. Time: 5 minutes.",
    step2Text(kind2, row.name, chain0, cap, gas),
    step3Text(kind3, row.name),
    step4,
    "Hold the position for at least " + hold + " days so the activity is counted in more than one snapshot. Cost: the $" + cap + " stays in the position. Time: " + hold + " days.",
    "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes. Cost: no fee to check, and never pay to claim. Time: 10 minutes.",
    "Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it. Cost: nothing but the log. Time: 5 minutes.",
  ];
}

// --- Formatting ------------------------------------------------------------
function fmtMoney(n) {
  if (n >= 1000000000) return "$" + (n / 1000000000).toFixed(2) + "B";
  if (n >= 1000000) return "$" + (n / 1000000).toFixed(n >= 100000000 ? 0 : 1) + "M";
  if (n >= 1000) return "$" + (n / 1000).toFixed(0) + "K";
  return "$" + n;
}
function fmtPct(c) {
  if (c === null || c === undefined) return "—";
  return (c >= 0 ? "+" : "") + c.toFixed(1) + "%";
}
function fmtAge(a) {
  if (a === null || a === undefined) return "unknown";
  return a + "d";
}
function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// --- State -----------------------------------------------------------------
let sortKey = "rank";
let sortDir = 1;
const $ = (id) => document.getElementById(id);

function filteredRows() {
  const q = $("q").value.trim().toLowerCase();
  const cat = $("cat").value;
  let rows = ROWS.filter((r) => {
    if (cat && r.category !== cat) return false;
    if (q && !(r.name.toLowerCase().includes(q) ||
      r.slug.includes(q) || r.category.toLowerCase().includes(q))) return false;
    return true;
  });
  const key = sortKey;
  const dir = sortDir;
  rows = rows.slice().sort((a, b) => {
    let d = 0;
    if (key === "rank") d = a.rank - b.rank;
    else if (key === "implied") d = b.implied - a.implied;
    else if (key === "tvl") d = b.tvl - a.tvl;
    else if (key === "age") d = (b.age === null ? -1 : b.age) - (a.age === null ? -1 : a.age);
    else if (key === "name") d = a.name.localeCompare(b.name);
    else if (key === "category") d = a.category.localeCompare(b.category);
    else if (key === "mult") d = b.mult - a.mult;
    return d * (key === "rank" ? 1 : dir);
  });
  return rows;
}

function renderBoard() {
  const rows = filteredRows();
  const tb = $("rows");
  tb.innerHTML = rows.map((r) => (
    "<tr data-slug=\"" + esc(r.slug) + "\">" +
    "<td class=\"rank num\">" + r.rank + "</td>" +
    "<td class=\"name\">" + esc(r.name) + "<small>" + esc(r.slug) + "</small></td>" +
    "<td>" + esc(r.category) + "</td>" +
    "<td>" + esc(r.chains.slice(0, 3).join(", ")) + (r.chains.length > 3 ? " +" + (r.chains.length - 3) : "") + "</td>" +
    "<td class=\"num\">" + fmtMoney(r.tvl) + "</td>" +
    "<td class=\"num\">" + fmtPct(r.chg) + "</td>" +
    "<td class=\"num\">" + fmtAge(r.age) + "</td>" +
    "<td class=\"num imp\">" + fmtMoney(r.implied) + "</td>" +
    "<td class=\"num mult\">" + r.mult.toFixed(4) + "×</td>" +
    "</tr>"
  )).join("");
  $("count").textContent = rows.length + " of " + ROWS.length +
    " protocols · click a row for its detail and farm plan.";
  tb.querySelectorAll("tr").forEach((tr) => {
    tr.addEventListener("click", () => { location.hash = "#p=" + tr.dataset.slug; });
  });
}

function renderDetail(slug) {
  const r = ROWS.find((x) => x.slug === slug);
  const el = $("detail");
  if (!r) { el.hidden = true; $("boardWrap").hidden = false; return; }
  const steps = farmSteps(r);
  el.innerHTML =
    "<button class=\"back\" id=\"backBtn\" type=\"button\">← Back to the board</button>" +
    "<h2>" + esc(r.name) + " <small>#" + r.rank + "</small></h2>" +
    "<p class=\"meta\">" + esc(r.category) + " · " + esc(r.chains.join(", ")) +
    " · TVL " + fmtMoney(r.tvl) + " · 7d " + fmtPct(r.chg) +
    " · age " + fmtAge(r.age) + "</p>" +
    "<h3>Implied value: " + fmtMoney(r.implied) + "</h3>" +
    "<div class=\"kv\">" +
    "<div><span>Category multiple</span><b>" + r.mult.toFixed(4) + "×</b></div>" +
    "<div><span>Category peer median</span><b>" + (r.median === null ? "—" : r.median.toFixed(4) + "×") + "</b></div>" +
    "<div><span>Tokenized peers</span><b>" + r.peers + "</b></div>" +
    "<div><span>Market median</span><b>" + META.marketMedian.toFixed(4) + "×</b></div>" +
    "<div><span>Growth</span><b>×" + r.growth.toFixed(3) + "</b></div>" +
    "<div><span>Maturity</span><b>×" + r.maturity.toFixed(4) + "</b></div>" +
    "<div><span>Chains</span><b>×" + r.chain.toFixed(2) + "</b></div>" +
    "</div>" +
    "<h3>How to farm it</h3><ol>" +
    steps.map((s) => "<li>" + esc(s) + "</li>").join("") +
    "</ol>";
  el.hidden = false;
  $("boardWrap").hidden = true;
  $("backBtn").addEventListener("click", () => { location.hash = ""; });
}

function renderMultTable() {
  const byCat = {};
  for (const r of ROWS) {
    if (!byCat[r.category]) {
      byCat[r.category] = { peers: r.peers, median: r.median, mult: r.mult };
    }
  }
  const cats = Object.keys(byCat).sort((a, b) => byCat[b].mult - byCat[a].mult);
  document.querySelector("#multTable tbody").innerHTML = cats.map((c) => (
    "<tr><td>" + esc(c) + "</td><td class=\"num\">" + byCat[c].peers + "</td>" +
    "<td class=\"num\">" + (byCat[c].median === null ? "—" : byCat[c].median.toFixed(4) + "×") + "</td>" +
    "<td class=\"num\">" + byCat[c].mult.toFixed(4) + "×</td></tr>"
  )).join("");
}

function renderStats() {
  $("stats").innerHTML =
    "<b>" + ROWS.length + "</b> protocols · watchlist <b>" +
    META.watchlistCovered + "/" + META.watchlistTotal + "</b> · " +
    "total implied <b>" + fmtMoney(META.totalImpliedUsd) + "</b><br>" +
    "snapshot " + esc(META.asOf) + " · market median <b>" +
    META.marketMedian.toFixed(4) + "×</b> · shrinkage prior k = 6";
  $("asof").textContent = META.asOf;
  $("mmed").textContent = META.marketMedian.toFixed(4) + "×";
}

function route() {
  const h = location.hash || "";
  const m = h.match(/^#p=([\w-]+)/);
  if (m) { renderDetail(m[1]); return; }
  $("detail").hidden = true;
  $("boardWrap").hidden = false;
  const c = h.match(/^#category=(.+)/);
  if (c) {
    const cat = decodeURIComponent(c[1]);
    if ([...$("cat").options].some((o) => o.value === cat)) $("cat").value = cat;
  }
  renderBoard();
}

function init() {
  const cats = [...new Set(ROWS.map((r) => r.category))].sort();
  for (const c of cats) {
    const o = document.createElement("option");
    o.value = c; o.textContent = c;
    $("cat").appendChild(o);
  }
  $("q").addEventListener("input", renderBoard);
  $("cat").addEventListener("change", renderBoard);
  $("sort").addEventListener("change", () => {
    const v = $("sort").value;
    if (v === "rank") { sortKey = "rank"; sortDir = 1; }
    else { sortKey = v; sortDir = 1; }
    renderBoard();
  });
  document.querySelectorAll("#board th[data-k]").forEach((th) => {
    th.addEventListener("click", () => {
      const k = th.dataset.k;
      if (sortKey === k) sortDir = -sortDir;
      else { sortKey = k; sortDir = k === "rank" ? 1 : 1; }
      renderBoard();
    });
  });
  $("modelToggle").addEventListener("click", () => {
    const m = $("model");
    m.hidden = !m.hidden;
    if (!m.hidden) renderMultTable();
  });
  window.addEventListener("hashchange", route);
  renderStats();
  renderMultTable();
  route();
}

init();
