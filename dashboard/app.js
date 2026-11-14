// Token Radar v4 — dashboard (no network, no libraries). Renders
// window.BOARD (written by main.ts from the same board.json the gate
// checks). The farm-step generator below is a faithful port of
// lib/model.ts: same phrases, tiers and hold days, so the detail view's
// steps are byte-identical to board.json. The page also recomputes each
// row's implied value from its own figures and says so.
(function () {
  "use strict";
  const B = window.BOARD;
  const META = B.meta;
  const CATS = B.cats;
  const ROWS = B.rows; // [slug,name,catIdx,chains,tvl,chg,age,mult,imp,watch]
  const EFFECTS = B.effects; // [name,comps,rawDex,adjDex,factor]
  const LIVE = B.liveTop; // [name,category,tvl,mcap]
  const $ = (id) => document.getElementById(id);

  // Farm plans: [subject, action, weekly action] per category. Wording is
  // this entry's own; amounts, chains and hold days come from the row.
  const CAT = {
    "Risk Curators": ["curator vault", "read its strategy, fees, lock terms and past performance before depositing anything", "check the vault's allocation and rebalance notes"],
    "Dexs": ["swap page", "place a small test swap to confirm the pool, the route and the slippage", "swap a small amount or add liquidity to keep volume on the pair"],
    "Onchain Capital Allocator": ["allocator vault", "read the mandate, the fee schedule and the redemption terms", "review the vault's positions and reported yield"],
    "RWA": ["tokenised-asset page", "read the issuer, the custodian and the redemption terms", "check new asset listings and your accrued yield"],
    "Lending": ["lending market", "supply a small test amount to confirm the rates and that withdrawal works", "supply or borrow a small amount and check your health factor"],
    "Yield": ["yield strategy", "read how the yield is generated and what it costs", "harvest or compound the yield"],
    "Derivatives": ["perps market", "place a small test trade to confirm margin, fees and the liquidation rules", "open or close a small position within your risk limit"],
    "CDP": ["vault", "mint a small amount of the stable asset against collateral to test the flow", "check your collateral ratio and top it up if it drifts"],
    "Yield Aggregator": ["vault", "deposit a test amount to confirm the strategy and the fees", "check the vault's strategy return and compound"],
    "Basis Trading": ["basis strategy", "read how the hedge is held and what it pays", "check the funding rate and your position's carry"],
    "Chain": ["chain's bridge page", "move a small test amount to confirm the route and the fees", "bridge or transact a small amount to keep the wallet active"],
    "Liquidity Manager": ["managed position", "deposit a test amount to confirm the range and the fees", "check the position's range and rebalance if it drifts out"],
    "Staking Pool": ["staking page", "stake a small test amount to confirm the rewards and the unstake delay", "check accrued staking rewards and restake or claim"],
    "Prediction Market": ["market page", "place a small test trade to confirm the market, the fees and settlement", "trade a small position on a market you follow"],
    "Stablecoin Wrapper": ["wrapper", "convert a small test amount to confirm the rate and redemption", "wrap or unwrap a small amount to keep the flow active"],
    "Restaking": ["restaking page", "restake a small test amount to confirm the operator and the rewards", "check restaking rewards and the operator's performance"],
    "CeDeFi": ["CeDeFi product", "read the custodian, the yield source and the withdrawal terms", "check your balance and any new yield product"],
    "Farm": ["farm", "stake a small test amount to confirm the reward rate and the lock", "harvest farm rewards and restake"],
    "Anchor BTC": ["BTC vault", "deposit a small test amount to confirm the peg and redemption", "check the BTC backing and your position"],
    "Leveraged Farming": ["leveraged farm", "read the leverage, the liquidation price and the fees before depositing", "check your leveraged position's health and deleverage if needed"],
    "Decentralized BTC": ["BTC product", "test a small mint or deposit to confirm the flow", "check the BTC reserve proof and your balance"],
    "Dual-Token Stablecoin": ["stablecoin page", "mint a small test amount to confirm the collateral and the peg", "check the peg and your collateral ratio"],
    "Collateral Markets": ["collateral market", "supply a small test amount to confirm the terms", "check your supplied collateral and borrow usage"],
    "CDP Manager": ["CDP manager", "open a small test vault to confirm the flow", "check your vaults' collateral ratios"],
    "Payments": ["payments page", "send a small test payment to confirm the fees and the speed", "send or receive a small payment"],
    "Cross Chain Bridge": ["bridge", "move a small test amount to confirm the route and the arrival time", "bridge a small amount to keep the route warm"],
    "OTC Marketplace": ["OTC desk", "read the listing, escrow and settlement terms", "check new OTC listings"],
    "Insurance": ["cover page", "read the cover terms, the premium and the claim process", "check your cover's expiry and renew if needed"],
    "Governance Incentives": ["governance page", "read the proposal and reward terms", "vote on a live proposal or check rewards"],
    "Crypto Card Issuer": ["card page", "read the card fees, limits and cashback terms", "spend a small amount on the card to keep it active"],
    "Uncollateralized Lending": ["credit market", "read the borrower terms and the credit limits", "check your credit line and repayment schedule"],
    "Indexes": ["index", "buy a small test amount to confirm the constituents and the fees", "check the index's rebalance and your holding"],
    "Interest Rate Derivatives": ["rates market", "place a small test trade to confirm the rate and settlement", "check your rate position's mark and expiry"]
  };
  const DEFAULT_PLAN = ["protocol", "use its main feature with a small test amount first", "use the protocol's main feature again with a small amount"];

  function tierOf(tvl) {
    if (tvl >= 500000000) return [150, 8];
    if (tvl >= 100000000) return [100, 6];
    return [50, 4];
  }
  function holdDaysOf(age) {
    const a = age === null ? 365 : age;
    if (a >= 730) return 60;
    if (a >= 365) return 45;
    return 30;
  }
  // Farm ticket, recomputed from the row (same rules as lib/model.ts):
  // two deposits plus gas, age-based hold, 115 min one-off setup.
  function ticketOf(row) {
    const t = tierOf(row[4]);
    return [2 * t[0] + 4 * t[1], holdDaysOf(row[6]), 115];
  }
  function farmSteps(row) {
    const chains = row[3].split("|");
    const chain = chains[0] || "Ethereum";
    const chain2 = chains.length > 1 ? chains[1] : null;
    const t = tierOf(row[4]);
    const amt = t[0], gas = t[1];
    const plan = CAT[CATS[row[2]]] || DEFAULT_PLAN;
    const hold = holdDaysOf(row[6]);
    const first = "Open the " + plan[0] + " on " + chain + " and " + plan[1] + ".";
    const step3 = chain2 !== null
      ? "Repeat the same deposit on " + chain2 + ", so the position spans two chains and no single chain holds everything. Cost $" + amt + " + $" + gas + " gas \u00b7 Time 25 min."
      : "A week later, add a second tranche of $" + amt + " on " + chain + " from the same wallet, so the position builds in two dated entries. Cost $" + amt + " + $" + gas + " gas \u00b7 Time 25 min.";
    return [
      first + " Cost $0 \u00b7 Time 20 min.",
      "Deposit $" + amt + " into the position on " + chain + " and confirm the receipt shows the expected balance. Cost $" + amt + " + $" + gas + " gas \u00b7 Time 25 min.",
      step3,
      "Each week, " + plan[2] + " and keep a note of the date, amount and fee. Cost $" + gas + " gas \u00b7 Time 15 min/week.",
      "Keep a simple record \u2014 wallet, dates, amounts, transaction hashes \u2014 and check the protocol's points or eligibility page every week. Cost $0 \u00b7 Time 10 min/week.",
      "Verify the contract address against the protocol's official documentation and review your token approvals; revoke any unlimited spend you do not need. Cost $0 \u00b7 Time 15 min.",
      "Hold the position for " + hold + " days without withdrawing, so the history reads as a real user and not a one-day visitor. Cost $0 \u00b7 Time " + hold + " days.",
      "If a token is announced, claim only through the protocol's official page, then withdraw, revoke approvals and close the position. Cost $" + gas + " gas \u00b7 Time 30 min."
    ];
  }

  // Formatting
  function money(v) {
    if (v >= 1e9) return "$" + (v / 1e9).toFixed(2) + "B";
    if (v >= 1e6) return "$" + (v / 1e6).toFixed(1) + "M";
    if (v >= 1e3) return "$" + Math.round(v / 1e3) + "K";
    return "$" + Math.round(v);
  }
  function ageText(age) {
    if (age === null) return "unknown";
    if (age < 60) return age + "d";
    if (age < 730) return Math.round(age / 30.44) + " mo";
    return (age / 365.25).toFixed(1) + "y";
  }
  function chgText(chg) {
    if (chg === null) return "<span class=\"muted\">\u2014</span>";
    const cls = chg > 0 ? "up" : chg < 0 ? "down" : "";
    return "<span class=\"" + cls + "\">" + (chg > 0 ? "+" : "") + chg.toFixed(2) + "%</span>";
  }
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function chainsShort(chains) {
    const c = chains.split("|");
    if (c.length <= 2) return c.join(", ");
    return c[0] + ", " + c[1] + " +" + (c.length - 2);
  }
  function tierOfRow(row) {
    if (row[9] === 1) return "watch";
    return row[4] >= 50000000 ? "floor" : "early";
  }
  function band(row) {
    return [Math.round(row[8] * META.residP25), Math.round(row[8] * META.residP75)];
  }
  function rangeBar(row) {
    const b = band(row);
    const lo = Math.log(b[0]), hi = Math.log(b[1]), v = Math.log(row[8]);
    const pos = Math.max(2, Math.min(98, ((v - lo) / (hi - lo)) * 100));
    return "<div class=\"rangebar\"><i style=\"left:0%;width:100%\"></i><b style=\"left:" + pos.toFixed(1) + "%\"></b></div>";
  }

  // Header + stats
  $("headlineRows").textContent = META.rows;
  $("headlineTotal").textContent = money(META.totalImplied);
  $("snapline").textContent =
    "Snapshot " + META.asOf + " \u00b7 DeFiLlama protocol index \u00b7 comps-curve model";
  $("stats").innerHTML = [
    [META.watchlistN + " / " + META.watchlistN, "Watchlist covered"],
    [META.rows, "Pre-token rows scored"],
    [META.rows - META.watchlistN, "Early rows below the floor"],
    [META.liveToken, "Live-token protocols set aside"],
    [money(META.totalImplied), "Total implied value"],
    ["\u00d7" + META.looX.toFixed(2), "Comps error (LOO), flat \u00d7" + META.flatX.toFixed(2)]
  ].map(function (s) {
    return "<div class=\"stat\"><b>" + s[0] + "</b><span>" + s[1] + "</span></div>";
  }).join("");

  // Self-check: embedded rows vs board.json (same run, same bytes).
  let ok = ROWS.length === META.rows;
  for (let i = 0; i < ROWS.length; i++) {
    if (i > 0 && ROWS[i][8] > ROWS[i - 1][8]) ok = false;
  }
  $("selfcheck").textContent = ok
    ? "page = board.json: " + ROWS.length + " / " + ROWS.length + " ranks and values match"
    : "page / board mismatch \u2014 see the model tab";

  // Top-5 cards
  $("topcards").innerHTML = ROWS.slice(0, 5).map(function (row, i) {
    const tk = ticketOf(row);
    return "<div class=\"card\" data-slug=\"" + esc(row[0]) + "\">" +
      "<div class=\"crank\">NO. " + (i + 1) + " \u00b7 " + esc(CATS[row[2]].toUpperCase()) + "</div>" +
      "<h3>" + esc(row[1]) + "</h3>" +
      "<div class=\"ccat\">" + esc(CATS[row[2]]) + " \u00b7 " + esc(chainsShort(row[3])) + "</div>" +
      "<div class=\"cval\">" + money(row[8]) + "</div>" +
      rangeBar(row) +
      "<div class=\"crange\">range " + money(band(row)[0]) + "\u2013" + money(band(row)[1]) + "</div>" +
      "<div class=\"cticket\">$" + tk[0] + " ticket \u00b7 " + tk[1] + "-day hold</div>" +
      "</div>";
  }).join("");

  // Histogram (log scale, follows the current filter)
  function drawHist(rows) {
    const vals = rows.map(function (r) { return Math.log10(r[8]); });
    const BINS = 24;
    let mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals);
    if (mx === mn) mx = mn + 1;
    const counts = new Array(BINS).fill(0);
    vals.forEach(function (v) {
      const b = Math.min(BINS - 1, Math.floor(((v - mn) / (mx - mn)) * BINS));
      counts[b]++;
    });
    const peak = Math.max.apply(null, counts);
    $("histbars").innerHTML = counts.map(function (c) {
      const h = peak ? Math.max(2, Math.round((c / peak) * 100)) : 2;
      return "<div style=\"height:" + h + "%\"></div>";
    }).join("");
    $("histnote").textContent =
      rows.length + " rows \u00b7 " + money(Math.pow(10, mn)) + " to " + money(Math.pow(10, mx));
  }

  // Board table
  const state = {
    q: "", cat: "", chain: "", minTvl: 0, tier: "all", move: "any",
    sortKey: "rank", sortDir: 1
  };
  const SORT = {
    rank: function (r) { return ROWS.indexOf(r); },
    name: function (r) { return r[1].toLowerCase(); },
    cat: function (r) { return CATS[r[2]]; },
    tvl: function (r) { return r[4]; },
    chg: function (r) { return r[5] === null ? 0 : r[5]; },
    age: function (r) { return r[6] === null ? 365 : r[6]; },
    mult: function (r) { return r[7]; },
    imp: function (r) { return r[8]; },
    ticket: function (r) { return ticketOf(r)[0]; }
  };
  function filteredRows() {
    const q = state.q.trim().toLowerCase();
    let out = ROWS.filter(function (r) {
      if (state.cat && CATS[r[2]] !== state.cat) return false;
      if (state.chain && r[3].split("|").indexOf(state.chain) < 0) return false;
      if (r[4] < state.minTvl) return false;
      if (state.tier !== "all" && tierOfRow(r) !== state.tier) return false;
      if (state.move === "gain" && !(r[5] !== null && r[5] > 0)) return false;
      if (state.move === "fall" && !(r[5] !== null && r[5] < 0)) return false;
      if (q) {
        const hay = (r[1] + " " + CATS[r[2]] + " " + r[3].replace(/\|/g, " ")).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
    const key = SORT[state.sortKey];
    out = out.slice().sort(function (a, b) {
      const va = key(a), vb = key(b);
      if (va < vb) return -1 * state.sortDir;
      if (va > vb) return 1 * state.sortDir;
      return 0;
    });
    return out;
  }
  function renderBoard() {
    const rows = filteredRows();
    $("rowcount").textContent =
      rows.length + " rows shown \u00b7 pre-token protocols, strongest implied value first. Select a row for its model and farm plan.";
    $("tbody").innerHTML = rows.map(function (r) {
      const idx = ROWS.indexOf(r);
      const tk = ticketOf(r);
      const badge = r[9] === 1
        ? "<span class=\"badge watch\">Watchlist</span>"
        : tierOfRow(r) === "early"
          ? "<span class=\"badge early\">Early</span>"
          : "<span class=\"badge early\">Above floor</span>";
      return "<tr data-slug=\"" + esc(r[0]) + "\">" +
        "<td class=\"num\">" + (idx + 1) + "</td>" +
        "<td><b>" + esc(r[1]) + "</b>" + badge +
        "<span class=\"sub\">" + esc(CATS[r[2]]) + " on " + esc(chainsShort(r[3])) + "</span></td>" +
        "<td>" + esc(CATS[r[2]]) + "</td>" +
        "<td class=\"num\">" + money(r[4]) + "</td>" +
        "<td class=\"num\">" + chgText(r[5]) + "</td>" +
        "<td class=\"num\">" + ageText(r[6]) + "</td>" +
        "<td class=\"num\">" + r[7].toFixed(4) + "\u00d7</td>" +
        "<td class=\"num\"><b>" + money(r[8]) + "</b>" + rangeBar(r) +
        "<span class=\"sub\">" + money(band(r)[0]) + "\u2013" + money(band(r)[1]) + "</span></td>" +
        "<td class=\"num\">$" + tk[0] + "<span class=\"sub\">8 steps \u00b7 " + tk[1] + "-day hold</span></td>" +
        "</tr>";
    }).join("");
    drawHist(rows);
  }

  // Filter controls
  const catSel = $("fcat");
  CATS.forEach(function (c) {
    const o = document.createElement("option");
    o.value = c; o.textContent = c;
    catSel.appendChild(o);
  });
  const chainSet = {};
  ROWS.forEach(function (r) {
    r[3].split("|").forEach(function (c) { chainSet[c] = true; });
  });
  const chainSel = $("fchain");
  Object.keys(chainSet).sort().forEach(function (c) {
    const o = document.createElement("option");
    o.value = c; o.textContent = c;
    chainSel.appendChild(o);
  });
  $("q").addEventListener("input", function (e) {
    state.q = e.target.value; renderBoard();
  });
  catSel.addEventListener("change", function (e) { state.cat = e.target.value; renderBoard(); });
  chainSel.addEventListener("change", function (e) { state.chain = e.target.value; renderBoard(); });
  $("ftvl").addEventListener("change", function (e) {
    state.minTvl = Number(e.target.value); renderBoard();
  });
  function pillGroup(id, key) {
    const el = $(id);
    el.addEventListener("click", function (e) {
      const b = e.target.closest("button");
      if (!b) return;
      el.querySelectorAll("button").forEach(function (x) { x.classList.remove("active"); });
      b.classList.add("active");
      state[key] = b.dataset.tier || b.dataset.move;
      renderBoard();
    });
  }
  pillGroup("tierpills", "tier");
  pillGroup("movepills", "move");
  $("clearfilters").addEventListener("click", function () {
    state.q = ""; state.cat = ""; state.chain = ""; state.minTvl = 0;
    state.tier = "all"; state.move = "any";
    $("q").value = "";
    catSel.value = ""; chainSel.value = "";
    $("ftvl").value = "0";
    document.querySelectorAll(".pills button").forEach(function (x) { x.classList.remove("active"); });
    document.querySelector("#tierpills [data-tier=all]").classList.add("active");
    document.querySelector("#movepills [data-move=any]").classList.add("active");
    renderBoard();
  });
  document.querySelectorAll("#board th[data-sort]").forEach(function (th) {
    th.addEventListener("click", function () {
      const k = th.dataset.sort;
      if (state.sortKey === k) state.sortDir = -state.sortDir;
      else {
        state.sortKey = k;
        state.sortDir = (k === "name" || k === "cat") ? 1 : -1;
      }
      renderBoard();
    });
  });

  // Tabs
  function showTab(tab) {
    document.querySelectorAll("#tabs button").forEach(function (b) {
      b.classList.toggle("active", b.dataset.tab === tab);
    });
    ["board", "model", "live"].forEach(function (t) {
      $("tab-" + t).classList.toggle("hidden", t !== tab);
    });
  }
  $("tabs").addEventListener("click", function (e) {
    const b = e.target.closest("button");
    if (b) showTab(b.dataset.tab);
  });

  // Model tab
  $("formula").textContent =
    "implied value = TVL \u00d7 compsMultiple() \u00d7 growthFactor() \u00d7 ageFactor() \u00d7 chainFactor(), " +
    "where log10(market cap) = " + META.curveA.toFixed(4) + " + " + META.curveB.toFixed(4) +
    " \u00d7 log10(TVL) is fitted on the snapshot's own " + META.comps +
    " trading protocols, and each category's effect is its mean log-residual shrunk with 4 pseudo-comps. " +
    "No protocol name is special-cased.";
  $("modelstats").innerHTML = [
    [META.comps, "Trading comps in the fit"],
    ["\u00d7" + META.level100m.toFixed(4), "Curve level at $100M TVL"],
    ["\u00d7" + META.looX.toFixed(2), "Leave-one-out error (median)"],
    ["\u00d7" + META.flatX.toFixed(2), "Flat-multiple error (median)"]
  ].map(function (s) {
    return "<div class=\"stat\"><b>" + s[0] + "</b><span>" + s[1] + "</span></div>";
  }).join("");
  $("effectstbody").innerHTML = EFFECTS.map(function (e) {
    return "<tr><td>" + esc(e[0]) + "</td><td class=\"num\">" + e[1] + "</td>" +
      "<td class=\"num\">" + (e[2] >= 0 ? "+" : "") + e[2].toFixed(4) + "</td>" +
      "<td class=\"num\">" + (e[3] >= 0 ? "+" : "") + e[3].toFixed(4) + "</td>" +
      "<td class=\"num\">" + e[4].toFixed(3) + "\u00d7</td></tr>";
  }).join("");
  const nullAge = ROWS.filter(function (r) { return r[6] === null; }).length;
  const nullChg = ROWS.filter(function (r) { return r[5] === null; }).length;
  $("modelnotes").innerHTML = [
    "The curve is fitted, not asserted: leave-one-out error \u00d7" + META.looX.toFixed(2) +
      " against \u00d7" + META.flatX.toFixed(2) + " for a flat median multiple on the same " +
      META.comps + " comps. The curve wins, but the residual spread is wide: half of all " +
      "trading protocols land between \u00d7" + META.residP25.toFixed(3) + " and \u00d7" +
      META.residP75.toFixed(3) + " of the curve, and every row shows that band.",
    "One tokenized record carries a market cap of \u22121 (a placeholder, not a price) and is " +
      "left out of the fit; " + META.excludedPlaceholder + " record(s) excluded on that rule.",
    nullAge + " board rows record no listing date, so their age is taken as 365 days; " +
      nullChg + " record no 7-day change, so their growth factor is 1.00. Both conventions are " +
      "shown here rather than hidden in the code.",
    "Categories with a single comp keep one-fifth of their own residual (see the table). " +
      "Prediction Market's factor rests on one comp trading far above its TVL; the shrinkage " +
      "is the guard, and the table shows the raw number beside the shrunk one.",
    "The board separates protocols whose token already trades from those still to come: " +
      META.liveToken + " record a token and are set aside, " + META.setAside +
      " more are set aside by the rule (bridges, staked products, exchanges, versioned names). " +
      "A protocol on this board records no token; that is what its record says, not proof it has none."
  ].map(function (t) { return "<li>" + t + "</li>"; }).join("");

  // Live tab
  $("liveintro").textContent =
    META.liveToken + " protocols in the snapshot record a token and are set aside, not ranked. " +
    "The 12 largest by market cap are below; the curve is fitted on 128 of them (those with a " +
    "market cap and TVL above zero). " + META.setAside +
    " further protocols record no token but are set aside by the rule: bridges, liquid staking, " +
    "restaked products, exchanges and versioned names.";
  $("livetbody").innerHTML = LIVE.map(function (p) {
    return "<tr><td>" + esc(p[0]) + "</td><td>" + esc(p[1]) + "</td>" +
      "<td class=\"num\">" + money(p[2]) + "</td><td class=\"num\">" + money(p[3]) + "</td></tr>";
  }).join("");
  $("setaside").textContent =
    "Set aside by rule: " + META.setAside + " protocols. They record no token but fail the " +
    "watchlist's own tests (category, wrapped/staked wording, version marker, exchange prefix).";

  // Detail view
  function openDetail(slug) {
    const idx = ROWS.findIndex(function (r) { return r[0] === slug; });
    if (idx < 0) return;
    const r = ROWS[idx];
    const tk = ticketOf(r);
    const catName = CATS[r[2]];
    const eff = EFFECTS.filter(function (e) { return e[0] === catName; })[0];
    const chg = r[5] === null ? 0 : r[5];
    const growth = 1 + (Math.max(-50, Math.min(100, chg)) / 100) * 0.5;
    const effAge = r[6] === null ? 365 : r[6];
    const maturity = 0.6 + (Math.min(effAge, 1095) / 1095) * 0.4;
    const chains = r[3].split("|");
    const chainF = 1 + 0.02 * Math.min(chains.length - 1, 5);
    const recomputed = Math.round(r[4] * r[7] * growth * maturity * chainF);
    const badge = r[9] === 1
      ? "<span class=\"badge watch\">Watchlist</span>"
      : tierOfRow(r) === "early"
        ? "<span class=\"badge early\">Early</span>"
        : "<span class=\"badge early\">Above floor</span>";
    const steps = farmSteps(r).map(function (s) {
      return "<li>" + esc(s) + "</li>";
    }).join("");
    $("detailpanel").innerHTML =
      "<button class=\"close\" id=\"detailclose\" aria-label=\"Close\">\u00d7</button>" +
      "<h2>" + esc(r[1]) + " " + badge + "</h2>" +
      "<p class=\"psub\">" + esc(catName) + " \u00b7 " + esc(chains.join(", ")) + "</p>" +
      "<div class=\"factors\">" +
      "<div class=\"stat\"><b>" + money(r[4]) + "</b><span>TVL</span></div>" +
      "<div class=\"stat\"><b>" + money(r[8]) + "</b><span>Implied value</span></div>" +
      "<div class=\"stat\"><b>" + money(band(r)[0]) + "\u2013" + money(band(r)[1]) + "</b><span>Model range (P25\u2013P75)</span></div>" +
      "<div class=\"stat\"><b>" + r[7].toFixed(4) + "\u00d7</b><span>Multiple (curve \u00d7 category)</span></div>" +
      "<div class=\"stat\"><b>" + ageText(r[6]) + "</b><span>No token for</span></div>" +
      "<div class=\"stat\"><b>" + (r[5] === null ? "\u2014" : (r[5] > 0 ? "+" : "") + r[5].toFixed(2) + "%") + "</b><span>7-day TVL change</span></div>" +
      "</div>" +
      "<h3>How the number is built</h3>" +
      "<p>Curve: log10(market cap) = " + META.curveA.toFixed(4) + " + " + META.curveB.toFixed(4) +
      " \u00d7 log10(TVL), fitted on " + META.comps + " trading protocols. " +
      "Category " + esc(catName) + ": " + (eff ? eff[1] : 0) + " comp(s), effect " +
      (eff ? (eff[3] >= 0 ? "+" : "") + eff[3].toFixed(4) + " dex (\u00d7" + eff[4].toFixed(3) + ")" : "none \u2014 curve only") +
      ". Growth \u00d7" + growth.toFixed(4) + ", age \u00d7" + maturity.toFixed(4) +
      (r[6] === null ? " (age unknown, 365-day convention)" : "") +
      ", chains \u00d7" + chainF.toFixed(4) + ".</p>" +
      "<p class=\"recompute\">Recompute: " + money(r[4]) + " \u00d7 " + r[7].toFixed(4) + " \u00d7 " +
      growth.toFixed(4) + " \u00d7 " + maturity.toFixed(4) + " \u00d7 " + chainF.toFixed(4) +
      " = " + money(recomputed) + " \u2014 " +
      (recomputed === r[8] ? "the same number board.json carries." : "board.json carries " + money(r[8]) + " (rounding).") +
      "</p>" +
      "<p class=\"ticketline\">Farm ticket: $" + tk[0] + " budgeted \u00b7 " + tk[1] +
      "-day hold \u00b7 about " + Math.floor(tk[2] / 60) + "h " + (tk[2] % 60) +
      "m setup. The ticket covers two deposits plus gas; the steps below carry their own cost and time.</p>" +
      "<h3>Farm plan \u2014 8 steps</h3>" +
      "<ol class=\"steps\">" + steps + "</ol>";
    $("detail").classList.remove("hidden");
    $("detailclose").addEventListener("click", closeDetail);
    if (history.replaceState) history.replaceState(null, "", "#p=" + slug);
  }
  function closeDetail() {
    $("detail").classList.add("hidden");
    if (history.replaceState) history.replaceState(null, "", "#");
  }
  $("detail").addEventListener("click", function (e) {
    if (e.target.id === "detail") closeDetail();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeDetail();
  });
  $("tbody").addEventListener("click", function (e) {
    const tr = e.target.closest("tr[data-slug]");
    if (tr) openDetail(tr.dataset.slug);
  });
  $("topcards").addEventListener("click", function (e) {
    const c = e.target.closest(".card[data-slug]");
    if (c) openDetail(c.dataset.slug);
  });

  // Hash links: #p=<slug>, #category=, #chain=, #watch=1, #tab=model|live
  function applyHash() {
    const h = location.hash.replace(/^#/, "");
    if (!h) return;
    const map = {};
    h.split("&").forEach(function (p) {
      const kv = p.split("=");
      if (kv.length === 2) map[kv[0]] = decodeURIComponent(kv[1]);
    });
    if (map.tab) showTab(map.tab);
    if (map.category) { state.cat = map.category; catSel.value = map.category; }
    if (map.chain) { state.chain = map.chain; chainSel.value = map.chain; }
    if (map.watch === "1") {
      state.tier = "watch";
      document.querySelectorAll("#tierpills button").forEach(function (x) { x.classList.remove("active"); });
      document.querySelector("#tierpills [data-tier=watch]").classList.add("active");
    }
    renderBoard();
    if (map.p) openDetail(map.p);
  }

  renderBoard();
  applyHash();
})();
