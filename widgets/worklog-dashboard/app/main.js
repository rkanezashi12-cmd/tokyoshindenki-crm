// 工数ダッシュボード（Zoho CRM ウィジェット）。CRM は読み取りだけ（COQL）。書き込み・削除はしない。
(function () {
  "use strict";

  var CFG = window.WLD_CONFIG;
  var A = window.WLD_AGG;

  var DIM_LABEL = { staff: "作業担当者", process: "工程", project: "PJ名" };
  var UNIT_LABEL = { day: "日", week: "週", month: "月" };

  var state = {
    preset: "last3Months",
    from: "",
    to: "",
    unit: "week",
    rows: [],
    loadedFrom: "",
    loadedTo: "",
    filters: { staff: [], project: [], process: [] },
    // 選んだキー → 表示名（期間を変えて行が無くなっても絞り込みの表示に名前を出すため）
    labels: { staff: {}, project: {}, process: {} },
    view: { period: "chart", staff: "chart", process: "chart", project: "chart" },
    loadToken: 0
  };

  var $ = function (id) { return document.getElementById(id); };

  // ---- 共通 ----
  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === "text") e.textContent = attrs[k];
        else if (k === "class") e.className = attrs[k];
        else e.setAttribute(k, attrs[k]);
      });
    }
    (children || []).forEach(function (c) { if (c) e.appendChild(c); });
    return e;
  }
  function svgEl(tag, attrs) {
    var e = document.createElementNS("http://www.w3.org/2000/svg", tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === "text") e.textContent = attrs[k];
      else e.setAttribute(k, attrs[k]);
    });
    return e;
  }
  function fmtH(n) {
    return (Math.round(n * 10) / 10).toLocaleString("ja-JP", { maximumFractionDigits: 1 });
  }
  function pct(n, total) {
    return total > 0 ? (Math.round((n / total) * 1000) / 10).toFixed(1) + "%" : "-";
  }
  function localToday() {
    var d = new Date();
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + "-" + (m < 10 ? "0" : "") + m + "-" + (day < 10 ? "0" : "") + day;
  }

  // SDK は失敗時に Error ではなく生のレスポンスで reject する。中身まで掘って見せる（スキル第11章）
  function describeError(err) {
    try {
      if (!err) return "不明なエラー";
      if (typeof err === "string") return err;
      var d = err.data && err.data[0];
      if (d && (d.code || d.message)) {
        return [d.code, d.message, d.details ? JSON.stringify(d.details) : ""].filter(Boolean).join(" / ");
      }
      if (err.code || err.message) {
        return [err.code, err.message, err.details ? JSON.stringify(err.details) : ""].filter(Boolean).join(" / ");
      }
      return JSON.stringify(err);
    } catch (e) {
      return String(err);
    }
  }

  function setStatus(text) { $("status").textContent = text || ""; }
  function showError(text) {
    var n = $("notice");
    n.innerHTML = "";
    if (text) n.appendChild(el("div", { class: "notice error", role: "alert", text: text }));
  }

  // ---- ツールチップ ----
  var tip = null;
  function showTip(evt, title, lines) {
    tip = tip || $("tip");
    tip.innerHTML = "";
    tip.appendChild(el("div", { class: "tt", text: title }));
    lines.forEach(function (l) { tip.appendChild(el("div", { class: "tm", text: l })); });
    tip.style.display = "block";
    moveTip(evt);
  }
  function moveTip(evt) {
    if (!tip || tip.style.display !== "block") return;
    var x = evt.clientX + 12, y = evt.clientY + 12;
    var w = tip.offsetWidth, h = tip.offsetHeight;
    if (x + w > window.innerWidth - 4) x = evt.clientX - w - 12;
    if (y + h > window.innerHeight - 4) y = evt.clientY - h - 12;
    tip.style.left = Math.max(4, x) + "px";
    tip.style.top = Math.max(4, y) + "px";
  }
  function hideTip() { if (tip) tip.style.display = "none"; }

  // ---- 取得 ----
  function coql(query) {
    return ZOHO.CRM.API.coql({ select_query: query }).then(function (res) {
      // 該当0件は本文なし（HTTP 204）で返る
      if (!res || typeof res !== "object") return { data: [], more: false };
      if (res.status === "error" || (res.data && res.data[0] && res.data[0].status === "error")) throw res;
      return { data: res.data || [], more: !!(res.info && res.info.more_records) };
    });
  }

  // 1つの期間を取り切る。OFFSET 上限に当たったら期間を半分に分けて取り直す
  function fetchRange(from, to, onProgress) {
    var rows = [];
    function page(offset) {
      if (offset >= CFG.maxOffset) {
        var halves = A.splitRange(from, to);
        if (!halves) return Promise.reject(new Error(from + " の明細が多すぎて読み込めません（1日 " + CFG.maxOffset + " 件超）"));
        return fetchRange(halves[0].from, halves[0].to, onProgress).then(function (a) {
          return fetchRange(halves[1].from, halves[1].to, onProgress).then(function (b) { return a.concat(b); });
        });
      }
      return coql(A.buildQuery(CFG, from, to, offset)).then(function (r) {
        rows = rows.concat(r.data);
        onProgress(r.data.length);
        return r.more ? page(offset + CFG.pageSize) : rows;
      });
    }
    return page(0);
  }

  function load() {
    var from = state.from, to = state.to;
    if (!A.isDate(from) || !A.isDate(to) || from > to) {
      showError("期間の指定が正しくありません。");
      return;
    }
    var token = ++state.loadToken;
    var count = 0;
    showError("");
    $("main").classList.add("loading");
    setStatus("読み込み中…");
    var chunks = A.monthChunks(from, to);
    var all = [];
    var p = Promise.resolve();
    chunks.forEach(function (c) {
      p = p.then(function () {
        if (token !== state.loadToken) return;
        return fetchRange(c.from, c.to, function (n) {
          count += n;
          if (token === state.loadToken) setStatus("読み込み中… " + count + " 件");
        }).then(function (rows) { all = all.concat(rows); });
      });
    });
    p.then(function () {
      if (token !== state.loadToken) return;
      var seen = {};
      state.rows = all.filter(function (r) {
        if (seen[r.id]) return false;
        seen[r.id] = 1;
        return true;
      }).map(function (r) { return A.normalizeRow(r, CFG); });
      state.loadedFrom = from;
      state.loadedTo = to;
      setStatus(state.rows.length + " 件の明細（" + from + "〜" + to + "）");
      render();
    }).catch(function (err) {
      if (token !== state.loadToken) return;
      setStatus("");
      showError("工数の読み込みに失敗しました。\n" + describeError(err));
    }).then(function () {
      if (token === state.loadToken) $("main").classList.remove("loading");
    });
  }

  // ---- 描画 ----
  function rememberLabel(dim, key, label) {
    state.labels[dim][key] = label;
  }
  function labelOf(dim, key) {
    return state.labels[dim][key] || key;
  }
  function toggleFilter(dim, key, label) {
    var list = state.filters[dim];
    var i = list.indexOf(key);
    if (i >= 0) list.splice(i, 1);
    else {
      list.push(key);
      rememberLabel(dim, key, label);
    }
    render();
  }
  function clearFilter(dim) {
    state.filters[dim] = [];
    render();
  }

  function renderChips() {
    var box = $("chips");
    box.innerHTML = "";
    var active = 0;
    A.DIMS.forEach(function (dim) {
      var keys = state.filters[dim];
      if (!keys.length) return;
      active++;
      var names = keys.slice(0, 2).map(function (k) { return labelOf(dim, k); }).join("、");
      if (keys.length > 2) names += " 他" + (keys.length - 2) + "件";
      var x = el("button", { type: "button", "aria-label": DIM_LABEL[dim] + "の絞り込みを解除", text: "×" });
      x.addEventListener("click", function () { clearFilter(dim); });
      var chip = el("span", { class: "chip", title: keys.map(function (k) { return labelOf(dim, k); }).join("\n") },
        [el("b", { text: DIM_LABEL[dim] }), el("span", { class: "chip-names", text: names }), x]);
      box.appendChild(chip);
    });
    if (active > 1) {
      var all = el("button", { type: "button", class: "btn btn-sm", text: "すべて解除" });
      all.addEventListener("click", function () {
        state.filters = { staff: [], project: [], process: [] };
        render();
      });
      box.appendChild(all);
    }
  }

  // ---- 複数選択の絞り込み（検索つき） ----
  function MultiSelect(container, dim, title) {
    this.dim = dim;
    this.title = title;
    this.query = "";
    this.btn = el("button", { type: "button", class: "ms-btn", "aria-haspopup": "true", "aria-expanded": "false" });
    this.search = el("input", { type: "search", class: "ms-search", placeholder: title + "を検索（スペース区切りで絞り込み）", "aria-label": title + "を検索" });
    this.count = el("div", { class: "ms-count" });
    var selShown = el("button", { type: "button", class: "btn btn-sm", text: "表示中をすべて選択" });
    var clear = el("button", { type: "button", class: "btn btn-sm", text: "選択を解除" });
    this.list = el("div", { class: "ms-list", role: "group", "aria-label": title });
    this.panel = el("div", { class: "ms-panel", hidden: "hidden" },
      [this.search, el("div", { class: "ms-actions" }, [selShown, clear, this.count]), this.list]);
    this.root = el("div", { class: "ms" }, [this.btn, this.panel]);
    container.appendChild(this.root);

    var self = this;
    this.btn.addEventListener("click", function () { self.isOpen() ? self.close() : self.open(); });
    this.search.addEventListener("input", function () { self.query = self.search.value; self.renderList(); });
    selShown.addEventListener("click", function () {
      self.visible.forEach(function (o) {
        if (state.filters[dim].indexOf(o.key) < 0) {
          state.filters[dim].push(o.key);
          rememberLabel(dim, o.key, o.label);
        }
      });
      self.renderList();
      renderCharts();
    });
    clear.addEventListener("click", function () {
      state.filters[dim] = [];
      self.renderList();
      renderCharts();
    });
    document.addEventListener("mousedown", function (e) {
      if (self.isOpen() && !self.root.contains(e.target)) self.close();
    });
    this.root.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && self.isOpen()) { self.close(); self.btn.focus(); }
    });
    this.visible = [];
  }
  MultiSelect.prototype.isOpen = function () { return !this.panel.hidden; };
  MultiSelect.prototype.open = function () {
    this.panel.hidden = false;
    this.btn.setAttribute("aria-expanded", "true");
    this.renderList();
    this.search.focus();
  };
  MultiSelect.prototype.close = function () {
    this.panel.hidden = true;
    this.btn.setAttribute("aria-expanded", "false");
  };
  // 選択肢：期間内の全明細から（他の絞り込みに関係なく）。工数の多い順。選択済みで期間内に無いものも残す
  MultiSelect.prototype.options = function () {
    var dim = this.dim;
    var opts = A.groupSum(state.rows, dim);
    var seen = {};
    opts.forEach(function (o) { seen[o.key] = 1; });
    state.filters[dim].forEach(function (k) {
      if (!seen[k]) opts.push({ key: k, label: labelOf(dim, k), jobNo: "", hours: 0, count: 0 });
    });
    return opts;
  };
  MultiSelect.prototype.refresh = function () {
    var n = state.filters[this.dim].length;
    this.btn.textContent = "";
    this.btn.appendChild(el("span", { class: "ms-title", text: this.title }));
    this.btn.appendChild(el("span", { class: "ms-value" + (n ? " on" : ""), text: n ? n + "件選択" : "すべて" }));
    this.btn.appendChild(el("span", { class: "ms-caret", "aria-hidden": "true", text: "▾" }));
    if (this.isOpen()) this.renderList();
  };
  MultiSelect.prototype.renderList = function () {
    var self = this, dim = this.dim;
    var selected = {};
    state.filters[dim].forEach(function (k) { selected[k] = 1; });
    var q = this.query;
    var all = this.options();
    this.visible = all.filter(function (o) { return A.matchesSearch([o.label, o.jobNo], q); });
    this.count.textContent = this.visible.length + " / " + all.length + " 件";
    this.list.innerHTML = "";
    if (!this.visible.length) {
      this.list.appendChild(el("div", { class: "empty", text: "見つかりません" }));
      return;
    }
    this.visible.forEach(function (o) {
      var cb = el("input", { type: "checkbox" });
      cb.checked = !!selected[o.key];
      cb.addEventListener("change", function () {
        var list = state.filters[dim], i = list.indexOf(o.key);
        if (cb.checked && i < 0) { list.push(o.key); rememberLabel(dim, o.key, o.label); }
        if (!cb.checked && i >= 0) list.splice(i, 1);
        renderCharts();
      });
      var name = el("span", { class: "ms-name", text: o.label });
      if (o.jobNo) name.appendChild(el("small", { text: " " + o.jobNo }));
      self.list.appendChild(el("label", { class: "ms-item", title: o.label }, [cb, name, el("span", { class: "ms-h", text: fmtH(o.hours) + "h" })]));
    });
  };

  function renderKpis(rows) {
    var t = A.totals(rows);
    var items = [
      ["合計工数", fmtH(t.hours), "h"],
      ["入力のあった日", String(t.days), "日"],
      ["作業担当者", String(t.staff), "人"],
      ["PJ", String(t.projects), "件"]
    ];
    var box = $("kpis");
    box.innerHTML = "";
    items.forEach(function (it) {
      var v = el("div", { class: "v", text: it[1] });
      v.appendChild(el("small", { text: it[2] }));
      box.appendChild(el("div", { class: "kpi" }, [el("div", { class: "k", text: it[0] }), v]));
    });
  }

  function groupTable(groups, total, dim) {
    var head = el("tr", null, [
      el("th", { text: DIM_LABEL[dim] }),
      dim === "project" ? el("th", { text: "JOB NO" }) : null,
      el("th", { class: "n", text: "工数(h)" }),
      el("th", { class: "n", text: "構成比" }),
      el("th", { class: "n", text: "明細" })
    ]);
    var body = el("tbody");
    groups.forEach(function (g) {
      body.appendChild(el("tr", null, [
        el("td", { text: g.label }),
        dim === "project" ? el("td", { text: g.jobNo || "" }) : null,
        el("td", { class: "n", text: fmtH(g.hours) }),
        el("td", { class: "n", text: pct(g.hours, total) }),
        el("td", { class: "n", text: String(g.count) })
      ]));
    });
    return el("table", { class: "t" }, [el("thead", null, [head]), body]);
  }

  function renderGroup(dim) {
    var rows = A.applyFilters(state.rows, state.filters);
    var groups = A.groupSum(rows, dim);
    var total = groups.reduce(function (s, g) { return s + g.hours; }, 0);
    var body = $("body-" + dim);
    body.innerHTML = "";
    $("sub-" + dim).textContent = groups.length ? "（" + groups.length + "件・計 " + fmtH(total) + "h）" : "";
    if (!groups.length) {
      body.appendChild(el("div", { class: "empty", text: "この条件の工数はありません" }));
      return;
    }
    if (state.view[dim] === "table") {
      body.appendChild(groupTable(groups, total, dim));
      return;
    }
    var max = groups[0].hours || 1;
    var list = el("div", { class: "hbars" });
    groups.forEach(function (g) {
      var name = g.label + (g.jobNo ? "（" + g.jobNo + "）" : "");
      var aria = name + " " + fmtH(g.hours) + "時間";
      var label = el("button", { type: "button", class: "hbar-label", "aria-label": aria, text: g.label });
      var fill = el("span", { class: "hbar-fill" });
      // 値ラベルの分（約 56px）を残して棒を伸ばす
      fill.style.width = "calc((100% - 56px) * " + Math.max(g.hours, 0) / max + ")";
      var plot = el("button", { type: "button", class: "hbar-plot", tabindex: "-1", "aria-hidden": "true" },
        [fill, el("span", { class: "hbar-val", text: fmtH(g.hours) + "h" })]);
      var row = el("div", { class: "hbar" }, [label, plot]);
      [label, plot].forEach(function (t) {
        t.addEventListener("click", function () { hideTip(); toggleFilter(dim, g.key, g.label); });
        t.addEventListener("mouseenter", function (e) {
          var lines = [fmtH(g.hours) + " h（" + pct(g.hours, total) + "）", "明細 " + g.count + " 件"];
          if (dim === "project" && g.jobNo) lines.unshift("JOB NO " + g.jobNo);
          showTip(e, g.label, lines);
        });
        t.addEventListener("mousemove", moveTip);
        t.addEventListener("mouseleave", hideTip);
      });
      list.appendChild(row);
    });
    body.appendChild(list);
  }

  // 目盛り：1・2・5 × 10^n の刻みで4本前後
  function niceStep(v) {
    if (v <= 0) return 1;
    var raw = v / 4;
    var p = Math.pow(10, Math.floor(Math.log10(raw)));
    var steps = [1, 2, 5, 10];
    for (var i = 0; i < steps.length; i++) if (raw <= steps[i] * p) return steps[i] * p;
    return 10 * p;
  }

  function renderPeriod() {
    var rows = A.applyFilters(state.rows, state.filters);
    var series = A.seriesByPeriod(rows, state.loadedFrom, state.loadedTo, state.unit, CFG.weekStartsOn);
    var total = series.reduce(function (s, b) { return s + b.hours; }, 0);
    var body = $("body-period");
    body.innerHTML = "";
    $("sub-period").textContent = "（" + UNIT_LABEL[state.unit] + "ごと・計 " + fmtH(total) + "h）";
    if (state.view.period === "table") {
      var tb = el("tbody");
      series.forEach(function (b) {
        tb.appendChild(el("tr", null, [
          el("td", { text: b.from === b.to ? b.from : b.from + "〜" + b.to }),
          el("td", { class: "n", text: fmtH(b.hours) }),
          el("td", { class: "n", text: pct(b.hours, total) })
        ]));
      });
      body.appendChild(el("table", { class: "t" }, [
        el("thead", null, [el("tr", null, [el("th", { text: "期間" }), el("th", { class: "n", text: "工数(h)" }), el("th", { class: "n", text: "構成比" })])]),
        tb
      ]));
      return;
    }
    if (!total) {
      body.appendChild(el("div", { class: "empty", text: "この条件の工数はありません" }));
      return;
    }
    var W = Math.max(body.clientWidth || 600, 300), H = 240;
    var m = { l: 40, r: 8, t: 16, b: 24 };
    var pw = W - m.l - m.r, ph = H - m.t - m.b;
    var step = niceStep(Math.max.apply(null, series.map(function (b) { return b.hours; })));
    var top = step * Math.max(1, Math.ceil(Math.max.apply(null, series.map(function (b) { return b.hours; })) / step));
    var band = pw / series.length;
    var bw = Math.min(24, Math.max(2, band - 2));
    var svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": "期間別工数のグラフ" });
    for (var v = 0; v <= top + 1e-9; v += step) {
      var y = m.t + ph - (v / top) * ph, i = Math.round(v / step);
      svg.appendChild(svgEl("line", { class: i === 0 ? "base" : "gridline", x1: m.l, x2: W - m.r, y1: y, y2: y }));
      svg.appendChild(svgEl("text", { class: "tick", x: m.l - 6, y: y + 4, "text-anchor": "end", text: fmtH(v) }));
    }
    var labelEvery = Math.max(1, Math.ceil(series.length / Math.floor(pw / 48)));
    // 値ラベルは棒の間隔が十分なときだけ（重なるならツールチップと表に任せる）
    var showCaps = band >= 36;
    series.forEach(function (b, idx) {
      var cx = m.l + band * idx + band / 2;
      var h = (b.hours / top) * ph;
      var x = cx - bw / 2, y = m.t + ph - h;
      var hit = svgEl("rect", { class: "hit", x: m.l + band * idx, y: m.t, width: band, height: ph });
      var r = Math.min(4, bw / 2, h);
      // 上端だけ角を丸め、基線側は四角のまま
      var d = h > 0
        ? "M" + x + "," + (m.t + ph) + "V" + (y + r) + "Q" + x + "," + y + " " + (x + r) + "," + y +
          "H" + (x + bw - r) + "Q" + (x + bw) + "," + y + " " + (x + bw) + "," + (y + r) + "V" + (m.t + ph) + "Z"
        : "";
      var col = svgEl("path", { class: "col", d: d });
      svg.appendChild(hit);
      svg.appendChild(col);
      if (showCaps && b.hours > 0) {
        svg.appendChild(svgEl("text", { class: "cap", x: cx, y: y - 4, "text-anchor": "middle", text: fmtH(b.hours) }));
      }
      if (idx % labelEvery === 0) {
        svg.appendChild(svgEl("text", { class: "tick", x: cx, y: H - 6, "text-anchor": "middle", text: b.label }));
      }
      hit.addEventListener("mouseenter", function (e) {
        col.classList.add("hover");
        showTip(e, b.from === b.to ? b.from : b.from + "〜" + b.to, [fmtH(b.hours) + " h"]);
      });
      hit.addEventListener("mousemove", moveTip);
      hit.addEventListener("mouseleave", function () { col.classList.remove("hover"); hideTip(); });
    });
    body.appendChild(el("div", { class: "cols" }, [svg]));
  }

  function syncButtons() {
    Array.prototype.forEach.call(document.querySelectorAll("#presets button"), function (b) {
      b.setAttribute("aria-pressed", String(b.dataset.preset === state.preset));
    });
    Array.prototype.forEach.call(document.querySelectorAll("#units button"), function (b) {
      b.setAttribute("aria-pressed", String(b.dataset.unit === state.unit));
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-view-for]"), function (g) {
      Array.prototype.forEach.call(g.querySelectorAll("button"), function (b) {
        b.setAttribute("aria-pressed", String(b.dataset.view === state.view[g.dataset.viewFor]));
      });
    });
    $("from").value = state.from;
    $("to").value = state.to;
  }

  function render() {
    syncButtons();
    renderCharts();
  }

  // 絞り込みの変更で描き直す部分（開いている絞り込みのパネルには触らない）
  function renderCharts() {
    hideTip();
    renderChips();
    selects.forEach(function (m) { m.refresh(); });
    renderKpis(A.applyFilters(state.rows, state.filters));
    renderPeriod();
    renderGroup("staff");
    renderGroup("process");
    renderGroup("project");
  }

  // ---- 操作 ----
  function applyPreset(name) {
    var r = A.presetRange(name, localToday(), CFG.fiscalYearStartMonth);
    state.preset = name;
    state.from = r.from;
    state.to = r.to;
    syncButtons();
    load();
  }

  function bind() {
    Array.prototype.forEach.call(document.querySelectorAll("#presets button"), function (b) {
      b.addEventListener("click", function () { applyPreset(b.dataset.preset); });
    });
    Array.prototype.forEach.call(document.querySelectorAll("#units button"), function (b) {
      b.addEventListener("click", function () { state.unit = b.dataset.unit; render(); });
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-view-for]"), function (g) {
      Array.prototype.forEach.call(g.querySelectorAll("button"), function (b) {
        b.addEventListener("click", function () { state.view[g.dataset.viewFor] = b.dataset.view; render(); });
      });
    });
    ["from", "to"].forEach(function (id) {
      $(id).addEventListener("change", function () {
        state[id] = $(id).value;
        state.preset = "";
        syncButtons();
      });
    });
    $("reload").addEventListener("click", load);
    var resizeTimer = null;
    window.addEventListener("resize", function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () { if (state.loadedFrom) renderPeriod(); }, 150);
    });
  }

  // ---- 起動 ----
  var selects = [];
  var started = false;
  function start() {
    if (started) return;
    started = true;
    selects = [
      new MultiSelect($("ms-project"), "project", "PJ名"),
      new MultiSelect($("ms-process"), "process", "工程")
    ];
    selects.forEach(function (m) { m.refresh(); });
    bind();
    applyPreset(state.preset);
  }

  function boot() {
    if (typeof ZOHO === "undefined" || !ZOHO.embeddedApp) {
      showError("Zoho のウィジェット SDK を読み込めませんでした。CRM の画面の中で開いているか、ネットワークを確認してください。");
      return;
    }
    ZOHO.embeddedApp.on("PageLoad", start);
    ZOHO.embeddedApp.init().then(start).catch(function (err) {
      showError("ウィジェットの初期化に失敗しました。\n" + describeError(err));
    });
  }

  boot();
})();
