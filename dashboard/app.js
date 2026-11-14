// Token Radar dashboard — static, no network. Reads window.RADAR (data.js).
(function () {
  "use strict";
  var R = window.RADAR || null;
  var rowsEl = document.getElementById("rows");
  var boardEl = document.getElementById("board");

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function money(n) {
    return "$" + Math.round(n).toLocaleString("en-US");
  }
  function compact(n) {
    if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
    if (n >= 1e6) return "$" + (n / 1e6).toFixed(1) + "M";
    if (n >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K";
    return money(n);
  }
  function pct(v) {
    if (v === null || v === undefined) return "—";
    var sign = v > 0 ? "+" : "";
    return sign + v.toFixed(1) + "%";
  }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  var state = {
    tab: "early",
    sortKey: "rank",
    sortDir: 1,
    q: "",
    category: "",
    chain: "",
    watchOnly: false,
  };

  function rowValue(row) {
    if (state.tab === "live") {
      return {
        slug: row.slug, name: row.name, rank: row.rank, category: row.category,
        chains: [], tvl_usd: row.tvl_usd, change_7d: null, age_days: null,
        multiple: null, implied_value_usd: row.mcap_usd, mcap_usd: row.mcap_usd,
      };
    }
    return row;
  }

  function currentRows() {
    var list = state.tab === "live"
      ? R.live.map(function (r, i) { return Object.assign({}, r, { rank: i + 1 }); })
      : R.rows;
    return list.filter(function (r) {
      if (state.q) {
        var hay = (r.name + " " + r.slug).toLowerCase();
        if (hay.indexOf(state.q.toLowerCase()) === -1) return false;
      }
      if (state.category && r.category !== state.category) return false;
      if (state.chain && (!r.chains || r.chains.indexOf(state.chain) === -1)) return false;
      if (state.watchOnly && !r.watchlist) return false;
      return true;
    });
  }

  function sortRows(list) {
    var key = state.sortKey, dir = state.sortDir;
    return list.slice().sort(function (a, b) {
      var av = a[key], bv = b[key];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (typeof av === "string") return dir * av.localeCompare(bv);
      return dir * (av - bv);
    });
  }

  function render() {
    if (!R) {
      rowsEl.innerHTML = '<tr><td colspan="7">No radar data loaded.</td></tr>';
      return;
    }
    var list = sortRows(currentRows());
    var html = list.map(function (r) {
      var v = rowValue(r);
      var change = v.change_7d === null || v.change_7d === undefined
        ? '<span>—</span>'
        : '<span class="' + (v.change_7d >= 0 ? "up" : "down") + '">' + pct(v.change_7d) + "</span>";
      var age = v.age_days === null || v.age_days === undefined ? "—" : v.age_days + " d";
      var mult = v.multiple === null || v.multiple === undefined ? "—" : v.multiple.toFixed(4) + "×";
      var watch = r.watchlist ? '<span class="badge">WATCH</span>' : "";
      return "<tr data-slug=\"" + esc(r.slug) + "\">" +
        '<td class="rank">' + v.rank + "</td>" +
        "<td><strong>" + esc(r.name) + "</strong>" + watch + "<br><span style=\"color:var(--muted);font-size:12px\">" + esc(r.slug) + "</span></td>" +
        '<td class="num">' + compact(v.tvl_usd) + "</td>" +
        '<td class="num">' + change + "</td>" +
        '<td class="num">' + age + "</td>" +
        '<td class="num">' + mult + "</td>" +
        '<td class="num"><strong>' + money(v.implied_value_usd) + "</strong></td></tr>";
    }).join("");
    rowsEl.innerHTML = html;
    document.getElementById("empty").hidden = list.length > 0;
    document.getElementById("rowCount").textContent = list.length + " rows shown";
    boardEl.querySelectorAll("thead th").forEach(function (th) {
      th.classList.toggle("sorted", th.getAttribute("data-key") === state.sortKey);
    });
    var lastTh = boardEl.querySelector('thead th[data-key="implied_value_usd"]');
    lastTh.textContent = state.tab === "live" ? "Market cap" : "Implied value";
  }

  function renderMultiples() {
    if (!R) return;
    document.getElementById("multipleRows").innerHTML = R.multiples.map(function (m) {
      return "<tr><td>" + esc(m.category) + "</td>" +
        '<td class="num">' + m.peers + "</td>" +
        '<td class="num">' + (m.median === null ? "—" : m.median.toFixed(4) + "×") + "</td>" +
        '<td class="num"><strong>' + m.multiple.toFixed(4) + "×</strong></td></tr>";
    }).join("");
  }

  function openDetail(slug) {
    var row = null;
    for (var i = 0; i < R.rows.length; i++) {
      if (R.rows[i].slug === slug) { row = R.rows[i]; break; }
    }
    var detail = document.getElementById("detail");
    if (!row) {
      var live = null;
      for (var j = 0; j < R.live.length; j++) {
        if (R.live[j].slug === slug) { live = R.live[j]; break; }
      }
      if (!live) return;
      detail.innerHTML = "<h2>" + esc(live.name) + "</h2><p class=\"sub\">" + esc(live.category) +
        " · token already trades · market cap " + money(live.mcap_usd) + "</p>" +
        "<p>This protocol is set aside in the live view because its token already trades. " +
        "The board ranks protocols that record no token yet.</p>";
      document.getElementById("drawer").hidden = false;
      return;
    }
    var mult = R.multiples.filter(function (m) { return m.category === row.category; })[0];
    var growth = 1 + (clamp(row.change_7d === null ? 0 : row.change_7d, -50, 100) / 100) * 0.5;
    var ageF = 0.6 + (Math.min(row.age_days, 1095) / 1095) * 0.4;
    var chainF = 1 + 0.02 * Math.min(Math.max(row.chains.length - 1, 0), 5);
    var recomputed = Math.max(1, Math.round(row.tvl_usd * row.multiple * growth * ageF * chainF));
    var close = Math.abs(recomputed - row.implied_value_usd) <= Math.max(1, row.implied_value_usd * 0.001);
    var steps = row.farm_steps.map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("");
    detail.innerHTML =
      "<h2>" + esc(row.name) + "</h2>" +
      '<p class="sub">Rank ' + row.rank + " · " + esc(row.category) + " · " +
      esc(row.chains.join(", ")) + (row.watchlist ? ' · <span class="badge">WATCHLIST</span>' : "") + "</p>" +
      '<dl class="kv">' +
      "<div><dt>Implied value</dt><dd>" + money(row.implied_value_usd) + "</dd></div>" +
      "<div><dt>TVL</dt><dd>" + money(row.tvl_usd) + "</dd></div>" +
      "<div><dt>7-day change</dt><dd>" + pct(row.change_7d) + "</dd></div>" +
      "<div><dt>Age</dt><dd>" + row.age_days + " days" + (row.listed_at ? " · since " + esc(row.listed_at) : " · listing date unknown") + "</dd></div>" +
      "<div><dt>Multiple</dt><dd>" + row.multiple.toFixed(4) + "× (" + esc(row.category) + ")</dd></div>" +
      "<div><dt>Chains</dt><dd>" + row.chains.length + "</dd></div>" +
      "</dl>" +
      "<h3>How the number is built</h3>" +
      '<ul class="factors">' +
      "<li>TVL " + money(row.tvl_usd) + "</li>" +
      "<li>Multiple " + row.multiple.toFixed(4) + "× — " + esc(row.category) + ", " +
        (mult ? mult.peers + " tokenized peer" + (mult.peers === 1 ? "" : "s") + ", median ratio " +
        (mult.median === null ? "none" : mult.median.toFixed(4) + "×") : "no peer data") + "</li>" +
      "<li>Growth factor " + growth.toFixed(4) + " — 7-day change " + pct(row.change_7d) + ", halved and clamped</li>" +
      "<li>Age factor " + ageF.toFixed(4) + " — " + row.age_days + " days, 0.6× at launch rising to 1.0× at three years</li>" +
      "<li>Chain factor " + chainF.toFixed(4) + " — " + row.chains.length + " chain" + (row.chains.length === 1 ? "" : "s") + ", 2% per extra chain up to five</li>" +
      "</ul>" +
      '<p class="recompute">Recomputed from the factors above: ' + money(recomputed) +
        (close ? " — the same number board.json carries (within rounding)." : " — differs from board.json; see the model panel.") + "</p>" +
      "<h3>How to farm it — 7 steps</h3><ol>" + steps + "</ol>";
    document.getElementById("drawer").hidden = false;
  }

  function closeDetail() {
    document.getElementById("drawer").hidden = true;
    if (location.hash.indexOf("#p=") === 0) history.replaceState(null, "", location.pathname + location.search);
  }

  function applyHash() {
    var h = location.hash.replace(/^#/, "");
    if (!h) return;
    var params = {};
    h.split("&").forEach(function (part) {
      var kv = part.split("=");
      if (kv.length === 2) params[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1]);
    });
    if (params.tab === "live") setTab("live");
    if (params.category) {
      state.category = params.category;
      document.getElementById("category").value = params.category;
    }
    if (params.chain) {
      state.chain = params.chain;
      document.getElementById("chain").value = params.chain;
    }
    if (params.watch === "1") {
      state.watchOnly = true;
      document.getElementById("watchOnly").checked = true;
    }
    render();
    if (params.p) openDetail(params.p);
  }

  function syncHash() {
    var parts = [];
    if (state.tab === "live") parts.push("tab=live");
    if (state.category) parts.push("category=" + encodeURIComponent(state.category));
    if (state.chain) parts.push("chain=" + encodeURIComponent(state.chain));
    if (state.watchOnly) parts.push("watch=1");
    var hash = parts.length ? "#" + parts.join("&") : "";
    history.replaceState(null, "", location.pathname + location.search + hash);
  }

  function setTab(tab) {
    state.tab = tab;
    document.getElementById("tabEarly").setAttribute("aria-selected", tab === "early" ? "true" : "false");
    document.getElementById("tabLive").setAttribute("aria-selected", tab === "live" ? "true" : "false");
    if (tab === "live") { state.sortKey = "rank"; state.sortDir = 1; }
    render();
  }

  function init() {
    if (!R) {
      document.getElementById("statRows").textContent = "—";
      render();
      return;
    }
    document.getElementById("statRows").textContent = R.rows.length;
    document.getElementById("statTotal").textContent = compact(R.total_implied_value_usd);
    document.getElementById("statMedian").textContent = R.market_median.toFixed(4) + "×";
    document.getElementById("asOf").textContent = R.as_of;

    var catSel = document.getElementById("category");
    var cats = [];
    R.rows.forEach(function (r) { if (cats.indexOf(r.category) === -1) cats.push(r.category); });
    cats.sort().forEach(function (c) {
      var o = document.createElement("option");
      o.value = c; o.textContent = c; catSel.appendChild(o);
    });
    var chainSel = document.getElementById("chain");
    var chains = [];
    R.rows.forEach(function (r) {
      r.chains.forEach(function (ch) { if (chains.indexOf(ch) === -1) chains.push(ch); });
    });
    chains.sort().forEach(function (c) {
      var o = document.createElement("option");
      o.value = c; o.textContent = c; chainSel.appendChild(o);
    });

    document.getElementById("q").addEventListener("input", function (e) {
      state.q = e.target.value; render();
    });
    catSel.addEventListener("change", function (e) {
      state.category = e.target.value; render(); syncHash();
    });
    chainSel.addEventListener("change", function (e) {
      state.chain = e.target.value; render(); syncHash();
    });
    document.getElementById("watchOnly").addEventListener("change", function (e) {
      state.watchOnly = e.target.checked; render(); syncHash();
    });
    document.getElementById("tabEarly").addEventListener("click", function () { setTab("early"); syncHash(); });
    document.getElementById("tabLive").addEventListener("click", function () { setTab("live"); syncHash(); });
    boardEl.querySelectorAll("thead th").forEach(function (th) {
      th.addEventListener("click", function () {
        var key = th.getAttribute("data-key");
        if (state.sortKey === key) state.sortDir = -state.sortDir;
        else { state.sortKey = key; state.sortDir = key === "name" ? 1 : -1; }
        render();
      });
    });
    rowsEl.addEventListener("click", function (e) {
      var tr = e.target.closest("tr[data-slug]");
      if (!tr) return;
      openDetail(tr.getAttribute("data-slug"));
      history.replaceState(null, "", location.pathname + location.search + "#p=" + tr.getAttribute("data-slug"));
    });
    document.getElementById("drawerClose").addEventListener("click", closeDetail);
    window.addEventListener("hashchange", applyHash);

    renderMultiples();
    render();
    applyHash();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
