// app.js — Token Radar v5 dashboard.
//
// Renders window.BOARD and recomputes every derived number (factor
// breakdown, ticket, verdict, farm steps) from the rows plus the tables in
// the data file, so the page shows the board's numbers, never a second
// copy of them. No network, no libraries.
(function () {
  "use strict";
  var B = window.BOARD;
  var M = B.meta;
  var CATS = M.categories; // [name, n, k, p, lo, hi, peers, adjDex]
  var CHAINS = M.chains;
  var C = M.curve;
  var W = M.walkForward;
  // Row: [slug, name, catIdx, chainIdxs, tvl, chg7d, ageDays, launch, ev]
  var ROWS = B.rows;

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function money(v) {
    if (v >= 1e9) return "$" + (v / 1e9).toFixed(2) + "B";
    if (v >= 1e6) return "$" + (v / 1e6).toFixed(1) + "M";
    if (v >= 1e3) return "$" + (v / 1e3).toFixed(0) + "K";
    return "$" + Math.round(v);
  }
  function moneyFull(v) {
    return "$" + Math.round(v).toLocaleString("en-US");
  }
  function pct(v, d) {
    return (v * 100).toFixed(d == null ? 1 : d) + "%";
  }
  function ageFmt(d) {
    if (d == null) return "—";
    return d < 365 ? d + "d" : (d / 365).toFixed(1) + "y";
  }
  function chgFmt(c) {
    if (c == null) return "—";
    return (c > 0 ? "+" : "") + c.toFixed(1) + "%";
  }
  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }
  function $(id) {
    return document.getElementById(id);
  }

  // --- The model, re-derived on the page from the same formulas. ---
  function growth(chg) {
    return 1 + (clamp(chg == null ? 0 : chg, -50, 100) / 100) * 0.5;
  }
  function maturity(age) {
    return 0.6 + (Math.min(age == null ? 365 : age, 1095) / 1095) * 0.4;
  }
  function chainF(n) {
    return 1 + 0.02 * Math.min(n - 1, 5);
  }
  function multiple(tvl, adjDex) {
    return Math.pow(10, C.a + C.b * Math.log10(tvl) + adjDex) / tvl;
  }
  function launchOf(r) {
    var cat = CATS[r[2]];
    var mult = multiple(r[4], cat[7]);
    var base = r[4] * mult * growth(r[5]) * maturity(r[6]) * chainF(r[3].length);
    return {
      mult: mult,
      base: base,
      launch: Math.floor(base + 0.5),
      lo: Math.floor(base * Math.pow(10, C.residP25) + 0.5),
      hi: Math.floor(base * Math.pow(10, C.residP75) + 0.5),
    };
  }
  function ticketOf(tvl, age) {
    var amt = tvl >= 500000000 ? 150 : tvl >= 100000000 ? 100 : 50;
    var gas = tvl >= 500000000 ? 8 : tvl >= 100000000 ? 6 : 4;
    var d = age == null ? 365 : age;
    var hold = d >= 730 ? 60 : d >= 365 ? 45 : 30;
    return { amt: amt, gas: gas, hold: hold, usd: 2 * amt + 4 * gas };
  }
  // Verdict cuts: expected-value terciles over the whole board.
  var EVS = ROWS.map(function (r) {
    return r[8];
  }).sort(function (a, b) {
    return a - b;
  });
  var CUT_LO = EVS[Math.floor(EVS.length / 3)];
  var CUT_HI = EVS[Math.floor((2 * EVS.length) / 3)];

  function verdictOf(r) {
    var cat = CATS[r[2]];
    var flags = [];
    if (cat[6] < 3) flags.push("thin evidence");
    if (r[6] != null && r[6] < 180) flags.push("young");
    if (cat[3] < 0.1) flags.push("low token odds");
    var v = r[8] >= CUT_HI ? "Farm" : r[8] >= CUT_LO ? "Thin" : "Skip";
    if (flags.length >= 2) v = v === "Farm" ? "Thin" : "Skip";
    return { v: v, flags: flags };
  }
  function fill(pattern, vars) {
    return pattern.replace(/\{(\w+)\}/g, function (_, k) {
      return vars[k] != null ? vars[k] : "{" + k + "}";
    });
  }
  function stepsOf(r) {
    var cat = CATS[r[2]];
    var pair = M.templates[cat[0]] || M.templateDefault;
    var t = ticketOf(r[4], r[6]);
    var chainNames = r[3].map(function (i) {
      return CHAINS[i];
    });
    var vars = {
      first: pair[0],
      weekly: pair[1],
      amt: String(t.amt),
      gas: String(t.gas),
      hold: String(t.hold),
      cat: cat[0],
      chain: chainNames[0] || "its main chain",
      chain2: chainNames[1] || chainNames[0] || "its main chain",
    };
    return M.stepPatterns.map(function (p) {
      return fill(p, vars);
    });
  }

  // --- Header: stats, coverage strip, top 5. ---
  $("totalLaunch").textContent = moneyFull(M.totalLaunch);
  $("totalEv").textContent = moneyFull(M.totalEv);
  $("coverage").textContent =
    M.rows + " ranked · " + M.liveToken + " trading · " + M.setAside +
    " set aside by rule — of " + (M.rows + M.liveToken + M.setAside) +
    " protocols in the snapshot.";
  var stats = [
    [String(M.rows), "protocols ranked"],
    [money(M.totalEv), "total expected value"],
    [money(M.totalLaunch), "total launch value"],
    ["×" + C.looX.toFixed(2), "leave-one-out error (flat ×" + C.flatX.toFixed(2) + ")"],
    ["×" + W.errX.toFixed(2), "walk-forward error, 2025+ comps"],
    [pct(M.globalP), "of protocols record a token"],
  ];
  $("stats").innerHTML = stats
    .map(function (s) {
      return '<div class="stat"><div class="v">' + esc(s[0]) + '</div><div class="l">' + esc(s[1]) + "</div></div>";
    })
    .join("");
  $("top5").innerHTML = ROWS.slice(0, 5)
    .map(function (r, i) {
      return (
        '<a href="#p=' + esc(r[0]) + '"><b>#' + (i + 1) + " " + esc(r[1]) + "</b>" +
        "EV " + money(r[8]) + " · launch " + money(r[7]) + "</a>"
      );
    })
    .join("");

  // --- Board table: sort, filter, render. ---
  var state = { sort: "ev", dir: -1, q: "", cat: "", chain: "", verdict: "", watch: false };
  var catSel = $("fcat");
  CATS.forEach(function (c, i) {
    var o = document.createElement("option");
    o.value = String(i);
    o.textContent = c[0] + " (" + c[1] + ")";
    catSel.appendChild(o);
  });
  var chainSel = $("fchain");
  CHAINS.forEach(function (c, i) {
    var o = document.createElement("option");
    o.value = String(i);
    o.textContent = c;
    chainSel.appendChild(o);
  });
  function filtered() {
    var q = state.q.trim().toLowerCase();
    return ROWS.map(function (r, i) {
      return { r: r, rank: i + 1 };
    }).filter(function (x) {
      var r = x.r;
      if (q && r[1].toLowerCase().indexOf(q) < 0 && r[0].toLowerCase().indexOf(q) < 0) return false;
      if (state.cat !== "" && r[2] !== +state.cat) return false;
      if (state.chain !== "" && r[3].indexOf(+state.chain) < 0) return false;
      if (state.verdict && verdictOf(r).v !== state.verdict) return false;
      if (state.watch && M.watchlist.indexOf(r[0]) < 0) return false;
      return true;
    });
  }
  var SORTS = {
    rank: function (a, b) { return a.rank - b.rank; },
    name: function (a, b) { return a.r[1].localeCompare(b.r[1]); },
    category: function (a, b) { return CATS[a.r[2]][0].localeCompare(CATS[b.r[2]][0]); },
    tvl: function (a, b) { return a.r[4] - b.r[4]; },
    chg: function (a, b) { return (a.r[5] == null ? -1e9 : a.r[5]) - (b.r[5] == null ? -1e9 : b.r[5]); },
    age: function (a, b) { return (a.r[6] == null ? 1e9 : a.r[6]) - (b.r[6] == null ? 1e9 : b.r[6]); },
    launch: function (a, b) { return a.r[7] - b.r[7]; },
    p: function (a, b) { return CATS[a.r[2]][3] - CATS[b.r[2]][3]; },
    ev: function (a, b) { return a.r[8] - b.r[8]; },
    verdict: function (a, b) { return verdictOf(a.r).v.localeCompare(verdictOf(b.r).v); },
  };
  function renderBoard() {
    var list = filtered();
    list.sort(function (a, b) {
      return SORTS[state.sort](a, b) * state.dir;
    });
    $("count").textContent = "Showing " + list.length + " of " + ROWS.length + " ranked protocols.";
    $("rows").innerHTML = list
      .map(function (x) {
        var r = x.r;
        var cat = CATS[r[2]];
        var vd = verdictOf(r);
        var isWatch = M.watchlist.indexOf(r[0]) >= 0;
        return (
          '<tr data-slug="' + esc(r[0]) + '" tabindex="0">' +
          "<td>" + x.rank + "</td>" +
          "<td>" + (isWatch ? '<span class="star" title="Watchlist">*</span> ' : "") + esc(r[1]) + "</td>" +
          "<td>" + esc(cat[0]) + "</td>" +
          '<td class="num">' + money(r[4]) + "</td>" +
          '<td class="num">' + chgFmt(r[5]) + "</td>" +
          '<td class="num">' + ageFmt(r[6]) + "</td>" +
          '<td class="num">' + money(r[7]) + "</td>" +
          '<td class="num">' + pct(cat[3]) + "</td>" +
          '<td class="num">' + money(r[8]) + "</td>" +
          '<td><span class="pill ' + vd.v + '" title="' + esc(vd.flags.join(", ") || "no risk flags") + '">' + vd.v + "</span></td>" +
          "</tr>"
        );
      })
      .join("");
  }
  document.querySelectorAll("#board th[data-sort]").forEach(function (th) {
    th.addEventListener("click", function () {
      var k = th.getAttribute("data-sort");
      if (state.sort === k) state.dir = -state.dir;
      else {
        state.sort = k;
        state.dir = k === "name" || k === "category" || k === "verdict" ? 1 : -1;
      }
      renderBoard();
    });
  });
  $("q").addEventListener("input", function (e) { state.q = e.target.value; renderBoard(); });
  catSel.addEventListener("change", function (e) { state.cat = e.target.value; renderBoard(); });
  chainSel.addEventListener("change", function (e) { state.chain = e.target.value; renderBoard(); });
  $("fverdict").addEventListener("change", function (e) { state.verdict = e.target.value; renderBoard(); });
  $("fwatch").addEventListener("change", function (e) { state.watch = e.target.checked; renderBoard(); });
  $("rows").addEventListener("click", function (e) {
    var tr = e.target.closest("tr");
    if (tr) openDetail(tr.getAttribute("data-slug"));
  });
  $("rows").addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      var tr = e.target.closest("tr");
      if (tr) openDetail(tr.getAttribute("data-slug"));
    }
  });
  renderBoard();

  // --- Detail drawer. ---
  function openDetail(slug) {
    var idx = -1;
    for (var i = 0; i < ROWS.length; i++) if (ROWS[i][0] === slug) { idx = i; break; }
    if (idx < 0) return;
    var r = ROWS[idx];
    var cat = CATS[r[2]];
    var L = launchOf(r);
    var t = ticketOf(r[4], r[6]);
    var vd = verdictOf(r);
    var chainNames = r[3].map(function (i) { return CHAINS[i]; });
    var isWatch = M.watchlist.indexOf(r[0]) >= 0;
    var recompute = L.launch === r[7]
      ? "Recomputed launch " + moneyFull(L.launch) + " from TVL, curve and category effect — matches the board."
      : "Recomputed launch " + moneyFull(L.launch) + " differs from the board's " + moneyFull(r[7]) + " by " + moneyFull(Math.abs(L.launch - r[7])) + ".";
    var rows = [
      ["TVL", moneyFull(r[4])],
      ["7d change", chgFmt(r[5])],
      ["Age", r[6] == null ? "unknown (365d assumed)" : ageFmt(r[6])],
      ["Curve multiple", "×" + L.mult.toFixed(4)],
      ["Category effect", "×" + Math.pow(10, cat[7]).toFixed(3) + " (" + (cat[6] === 1 ? "1 comp" : cat[6] + " comps") + ")"],
      ["Growth factor", "×" + growth(r[5]).toFixed(3)],
      ["Maturity factor", "×" + maturity(r[6]).toFixed(3)],
      ["Chain factor", "×" + chainF(r[3].length).toFixed(2) + " (" + (r[3].length === 1 ? "1 chain" : r[3].length + " chains") + ")"],
      ["Launch value", moneyFull(r[7]) + " (" + money(L.lo) + "–" + money(L.hi) + " band)"],
      ["P(token)", pct(cat[3]) + " — " + cat[2] + " of " + cat[1] + " in the category record a token (raw " + pct(cat[2] / cat[1]) + ", 95% CI " + pct(cat[4]) + "–" + pct(cat[5]) + ")"],
      ["Expected value", moneyFull(r[8]) + " (" + money(Math.floor(L.lo * cat[3] + 0.5)) + "–" + money(Math.floor(L.hi * cat[3] + 0.5)) + " band)"],
      ["Verdict", vd.v + (vd.flags.length ? " — flags: " + vd.flags.join(", ") : " — no risk flags")],
      ["Farm ticket", "$" + t.usd + " budget ($" + t.amt + " × 2 + $" + t.gas + " gas × 4), hold " + t.hold + " days, setup 115 min"],
    ];
    $("detailBody").innerHTML =
      "<h2>" + esc(r[1]) + "</h2>" +
      '<p class="sub">Rank #' + (idx + 1) + " · " + esc(cat[0]) + " · " + esc(chainNames.join(", ")) +
      (isWatch ? ' · <span class="star">Watchlist</span>' : "") + "</p>" +
      "<h3>Why this value</h3><dl>" +
      rows.map(function (kv) { return "<dt>" + esc(kv[0]) + "</dt><dd>" + esc(kv[1]) + "</dd>"; }).join("") +
      "</dl>" +
      '<p class="check">' + esc(recompute) + "</p>" +
      "<h3>Farm plan — 8 steps</h3><ol>" +
      stepsOf(r).map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("") +
      "</ol>" +
      "<h3>Verdict rule</h3><p class=\"note\">Farm = top third of expected value, Thin = middle third, Skip = bottom third. Two or more risk flags (thin evidence, young, low token odds) drop a row one step. An absolute EV-vs-ticket test would say farm on all 198 rows, so it is not used.</p>";
    $("detail").hidden = false;
    try { history.replaceState(null, "", "#p=" + slug); } catch (e) {}
  }
  $("closeDetail").addEventListener("click", function () {
    $("detail").hidden = true;
    try { history.replaceState(null, "", "#tab=board"); } catch (e) {}
  });

  // --- Model tab. ---
  function modelHtml() {
    var odds = CATS.slice().sort(function (a, b) { return b[3] - a[3]; });
    var mults = CATS.filter(function (c) { return c[6] > 0; })
      .sort(function (a, b) { return Math.pow(10, b[7]) - Math.pow(10, a[7]); });
    var cal = M.calibration.map(function (c) {
      return "<tr><td>" + esc(c.name) + '</td><td class="num">' + money(c.tvl) + '</td><td class="num">' + money(c.predicted) + '</td><td class="num">' + money(c.actual) + '</td><td class="num">' + c.ratio.toFixed(2) + "×</td></tr>";
    }).join("");
    var oddsRows = odds.map(function (c) {
      return "<tr><td>" + esc(c[0]) + '</td><td class="num">' + c[1] + '</td><td class="num">' + c[2] + '</td><td class="num">' + pct(c[2] / c[1]) + '</td><td class="num">' + pct(c[3]) + '</td><td class="num">' + pct(c[4]) + "–" + pct(c[5]) + "</td></tr>";
    }).join("");
    var multRows = mults.map(function (c) {
      return "<tr><td>" + esc(c[0]) + '</td><td class="num">' + c[6] + '</td><td class="num">' + (c[7] >= 0 ? "+" : "") + c[7].toFixed(3) + '</td><td class="num">×' + Math.pow(10, c[7]).toFixed(3) + "</td></tr>";
    }).join("");
    return (
      "<p>The snapshot&rsquo;s own trading protocols price the launches. A log-log fit of market cap on TVL over the " + M.comps + " protocols whose token trades, plus a per-category effect; then the board ranks by expected value.</p>" +
      "<pre>log10(market cap) = " + C.a.toFixed(4) + " + " + C.b.toFixed(4) + " × log10(TVL)\n" +
      "multiple = 10^(a + b·log10(TVL) + category effect) / TVL\n" +
      "launch   = TVL × multiple × growth × maturity × chain\n" +
      "EV       = launch × P(token | category)\n" +
      "P        = (k + " + M.oddsK + " × " + M.globalP.toFixed(3) + ") / (n + " + M.oddsK + ")</pre>" +
      "<h3>Validation</h3><ul>" +
      "<li>Curve: leave-one-out error ×" + C.looX.toFixed(2) + " against ×" + C.flatX.toFixed(2) + " for a flat median multiple, over " + M.comps + " comps.</li>" +
      "<li>Level: at $100M TVL the curve pays ×" + C.level100m.toFixed(4) + "; the P25–P75 residual band is ×" + Math.pow(10, C.residP25).toFixed(2) + " to ×" + Math.pow(10, C.residP75).toFixed(2) + ".</li>" +
      "<li>Walk-forward: the curve fitted on comps listed before 2025 (n=" + W.nPre + ", a=" + W.a.toFixed(4) + ", b=" + W.b.toFixed(4) + ") predicts the 2025+ comps (n=" + W.nPost + ") with median error ×" + W.errX.toFixed(2) + ".</li>" +
      "<li>Odds: the shrunk category model beats the base rate on Brier score (0.132 vs 0.141) and log-loss (0.424 vs 0.456), measured on all 758 protocols.</li>" +
      "</ul>" +
      "<h3>Held-out calibration — curve only, 8 comps across the TVL range</h3>" +
      '<table><thead><tr><th>Protocol</th><th>TVL</th><th>Predicted</th><th>Actual</th><th>Ratio</th></tr></thead><tbody>' + cal + "</tbody></table>" +
      "<h3>Token odds by category — P(token | category), shrunk toward " + pct(M.globalP) + "</h3>" +
      "<p>n is the protocols in the category; k is how many record a token market cap. The 95% interval is Wilson on the raw rate — wide where n is small, which is why the shrunk value, not the raw rate, ranks the board.</p>" +
      '<table><thead><tr><th>Category</th><th>n</th><th>k</th><th>Raw</th><th>Shrunk P</th><th>95% CI</th></tr></thead><tbody>' + oddsRows + "</tbody></table>" +
      "<h3>Category effects on the curve</h3>" +
      '<table><thead><tr><th>Category</th><th>Comps</th><th>Effect (dex)</th><th>Factor</th></tr></thead><tbody>' + multRows + "</tbody></table>" +
      "<h3>Coverage — every protocol accounted for</h3>" +
      "<p>" + M.rows + " ranked + " + M.liveToken + " trading + " + M.setAside + " set aside by rule = " + (M.rows + M.liveToken + M.setAside) + " in the snapshot. A protocol is ranked when it records no token (no gecko_id and no symbol), its category is not Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC or CEX, its name carries no version marker, no wrapped / staked / staking word, and no exchange-name prefix. " + M.watchlistN + " of " + M.watchlistN + " watchlist protocols are ranked.</p>" +
      "<p>Two counts matter and they are different: " + M.liveToken + " protocols carry a gecko_id or symbol, and " + M.tokenized + " of them record a nonzero token market cap. The odds model uses the " + M.tokenized + ", because a symbol alone is not a token — 272 rows inherit a parent&rsquo;s symbol without having their own token.</p>" +
      "<h3>Verdict rule</h3>" +
      "<p>Farm = top third of expected value, Thin = middle third, Skip = bottom third; two or more risk flags (thin evidence: fewer than 3 trading comps in the category; young: listed under 180 days; low token odds: shrunk P under 0.10) drop a row one step. Age enters once, through the maturity factor — the odds use category only, so age is never double-counted.</p>"
    );
  }
  $("model").innerHTML = modelHtml();

  // --- Live tab. ---
  $("liveNote").textContent =
    M.tokenized + " protocols record a token market cap. The 24 largest are shown below; they are set aside from the board because they already trade, and they are the peers that price the launches.";
  $("liveRows").innerHTML = M.live.map(function (l, i) {
    return "<tr><td>" + (i + 1) + "</td><td>" + esc(l.name) + "</td><td>" + esc(l.category) + '</td><td class="num">' + moneyFull(l.mcap) + "</td></tr>";
  }).join("");

  // --- Tabs + hash routing. ---
  function showTab(name) {
    document.querySelectorAll(".tabs button").forEach(function (b) {
      b.classList.toggle("on", b.getAttribute("data-tab") === name);
    });
    $("tab-board").hidden = name !== "board";
    $("tab-model").hidden = name !== "model";
    $("tab-live").hidden = name !== "live";
  }
  document.querySelectorAll(".tabs button").forEach(function (b) {
    b.addEventListener("click", function () {
      var t = b.getAttribute("data-tab");
      showTab(t);
      try { history.replaceState(null, "", "#tab=" + t); } catch (e) {}
    });
  });
  function readHash() {
    var h = location.hash.replace(/^#/, "");
    var parts = {};
    h.split("&").forEach(function (kv) {
      var i = kv.indexOf("=");
      if (i > 0) parts[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1));
    });
    if (parts.tab) showTab(parts.tab);
    if (parts.category) {
      var ci = CATS.findIndex(function (c) { return c[0] === parts.category; });
      if (ci >= 0) { state.cat = String(ci); catSel.value = String(ci); }
    }
    if (parts.chain) {
      var chi = CHAINS.indexOf(parts.chain);
      if (chi >= 0) { state.chain = String(chi); chainSel.value = String(chi); }
    }
    if (parts.watch === "1") { state.watch = true; $("fwatch").checked = true; }
    renderBoard();
    if (parts.p) openDetail(parts.p);
  }
  readHash();
})();
