// 工数ダッシュボード（Zoho CRM ウィジェット）。CRM は読み取りだけ（COQL）。書き込み・削除はしない。
(function () {
  "use strict";

  var CFG = window.WLD_CONFIG;
  var A = window.WLD_AGG;
  var U = window.WLD_UI;
  var $ = U.$, el = U.el, fmtH = U.fmtH, pct = U.pct;

  var DIM_LABEL = { staff: "作業担当者", process: "工程", project: "PJ名", category: "区分" };
  var UNIT_LABEL = { day: "日", week: "週", month: "月" };
  var CAT_LABELS = [CFG.categories.project.label, CFG.categories.presales.label, CFG.categories.indirect.label];
  var SLOTS = ["var(--c1)", "var(--c2)", "var(--c3)", "var(--c4)", "var(--c5)", "var(--c6)", "var(--c7)"];
  var OTHER_COLOR = "var(--c-other)";

  var state = {
    preset: "last3Months",
    from: "",
    to: "",
    unit: "week",
    stackBy: "",
    tab: "overview",
    cross: "project:process",
    crossMode: "hours",
    rows: [],          // 期間内の明細
    prevRows: [],      // 前期間（直前の同じ日数）の明細
    loadedFrom: "",
    loadedTo: "",
    prevFrom: "",
    prevTo: "",
    filters: { staff: [], project: [], process: [] },
    // 選んだキー → 表示名（期間を変えて行が無くなっても絞り込みの表示に名前を出すため）
    labels: { staff: {}, project: {}, process: {} },
    view: { period: "chart", staff: "chart", process: "chart", project: "chart" },
    loadToken: 0
  };

  function localToday() {
    var d = new Date();
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + "-" + (m < 10 ? "0" : "") + m + "-" + (day < 10 ? "0" : "") + day;
  }
  function setStatus(text) { $("status").textContent = text || ""; }
  function showError(text) {
    var n = $("notice");
    n.innerHTML = "";
    if (text) n.appendChild(el("div", { class: "notice error", role: "alert", text: text }));
  }
  function filtered(rows) { return A.applyFilters(rows, state.filters); }
  // 入力状況は1日の合計を見るので、担当者の絞り込みだけ掛ける
  function staffOnly(rows) {
    return A.applyFilters(rows, { staff: state.filters.staff, project: [], process: [] });
  }

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

  // 期間と前期間をまとめて取り、あとで日付で分ける
  function load() {
    var from = state.from, to = state.to;
    if (!A.isDate(from) || !A.isDate(to) || from > to) {
      showError("期間の指定が正しくありません。");
      return;
    }
    var prev = A.previousRange(from, to);
    var token = ++state.loadToken;
    var count = 0;
    showError("");
    $("main").classList.add("loading");
    setStatus("読み込み中…");
    var all = [];
    var p = Promise.resolve();
    A.monthChunks(prev.from, to).forEach(function (c) {
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
      var rows = all.filter(function (r) {
        if (seen[r.id]) return false;
        seen[r.id] = 1;
        return true;
      }).map(function (r) { return A.normalizeRow(r, CFG); });
      state.rows = A.splitByRange(rows, from, to);
      state.prevRows = A.splitByRange(rows, prev.from, prev.to);
      state.loadedFrom = from;
      state.loadedTo = to;
      state.prevFrom = prev.from;
      state.prevTo = prev.to;
      setStatus(state.rows.length + " 件の明細（" + from + "〜" + to + "）／前期間 " + prev.from + "〜" + prev.to);
      render();
    }).catch(function (err) {
      if (token !== state.loadToken) return;
      setStatus("");
      showError("工数の読み込みに失敗しました。\n" + U.describeError(err));
    }).then(function () {
      if (token === state.loadToken) $("main").classList.remove("loading");
    });
  }

  // ---- 絞り込み ----
  function rememberLabel(dim, key, label) { state.labels[dim][key] = label; }
  function labelOf(dim, key) { return state.labels[dim][key] || key; }
  function toggleFilter(dim, key, label) {
    var list = state.filters[dim];
    var i = list.indexOf(key);
    if (i >= 0) list.splice(i, 1);
    else {
      list.push(key);
      rememberLabel(dim, key, label);
    }
    renderAll();
  }
  function clearFilter(dim) {
    state.filters[dim] = [];
    renderAll();
  }
  // 絞り込みをすべて外す（期間・日週月・グラフ／表の切り替えはそのまま）
  function resetFilters() {
    state.filters = { staff: [], project: [], process: [] };
    selects.forEach(function (m) { m.reset(); });
    renderAll();
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
      box.appendChild(el("span", { class: "chip", title: keys.map(function (k) { return labelOf(dim, k); }).join("\n") },
        [el("b", { text: DIM_LABEL[dim] }), el("span", { class: "chip-names", text: names }), x]));
    });
    $("reset-filters").disabled = active === 0;
  }

  // 複数選択の絞り込み（検索つき）
  function MultiSelect(container, dim, title) {
    this.dim = dim;
    this.title = title;
    this.query = "";
    this.visible = [];
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
      renderAll(true);
    });
    clear.addEventListener("click", function () {
      state.filters[dim] = [];
      self.renderList();
      renderAll(true);
    });
    document.addEventListener("mousedown", function (e) {
      if (self.isOpen() && !self.root.contains(e.target)) self.close();
    });
    this.root.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && self.isOpen()) { self.close(); self.btn.focus(); }
    });
  }
  MultiSelect.prototype.reset = function () {
    this.query = "";
    this.search.value = "";
    this.close();
  };
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
  };
  MultiSelect.prototype.renderList = function () {
    var self = this, dim = this.dim;
    var selected = {};
    state.filters[dim].forEach(function (k) { selected[k] = 1; });
    var all = this.options();
    var q = this.query;
    this.visible = all.filter(function (o) { return A.matchesSearch([o.label, o.jobNo], q); });
    this.count.textContent = this.visible.length + " / " + all.length + " 件";
    this.list.innerHTML = "";
    if (!this.visible.length) {
      this.list.appendChild(U.empty("見つかりません"));
      return;
    }
    this.visible.forEach(function (o) {
      var cb = el("input", { type: "checkbox" });
      cb.checked = !!selected[o.key];
      cb.addEventListener("change", function () {
        var list = state.filters[dim], i = list.indexOf(o.key);
        if (cb.checked && i < 0) { list.push(o.key); rememberLabel(dim, o.key, o.label); }
        if (!cb.checked && i >= 0) list.splice(i, 1);
        renderAll(true);
      });
      var name = el("span", { class: "ms-name", text: o.label });
      if (o.jobNo) name.appendChild(el("small", { text: " " + o.jobNo }));
      self.list.appendChild(el("label", { class: "ms-item", title: o.label }, [cb, name, el("span", { class: "ms-h", text: fmtH(o.hours) + "h" })]));
    });
  };

  // ---- 色（絞り込みで色が変わらないよう、期間内の全明細の上位で決める） ----
  function colorScheme(dim) {
    if (!dim) return { keys: [], colorOf: function () { return "var(--c1)"; }, nameOf: function () { return "工数"; } };
    if (dim === "category") {
      return {
        keys: CAT_LABELS,
        colorOf: function (k) { return SLOTS[CAT_LABELS.indexOf(k)] || OTHER_COLOR; },
        nameOf: function (k) { return k === A.OTHER ? "その他" : k; }
      };
    }
    var keys = A.topKeys(state.rows, dim, CFG.topN);
    var names = {};
    A.groupSum(state.rows, dim).forEach(function (g) { names[g.key] = g.label; });
    return {
      keys: keys,
      colorOf: function (k) { var i = keys.indexOf(k); return i >= 0 ? SLOTS[i] : OTHER_COLOR; },
      nameOf: function (k) { return k === A.OTHER ? "その他" : names[k] || labelOf(dim, k) || k; }
    };
  }
  function legendFor(scheme, series) {
    var used = {};
    series.forEach(function (b) { b.parts.forEach(function (p) { if (p.hours > 0) used[p.key] = 1; }); });
    var keys = scheme.keys.concat([A.OTHER]).filter(function (k) { return used[k]; });
    return U.legend(keys.map(function (k) { return { label: scheme.nameOf(k), color: scheme.colorOf(k) }; }));
  }

  // ---- 数値のタイル ----
  function renderKpis() {
    var rows = filtered(state.rows), prevRows = filtered(state.prevRows);
    var t = A.totals(rows), pt = A.totals(prevRows);
    var share = A.categoryShare(rows, CAT_LABELS).all;
    var indirect = share.parts[CFG.categories.indirect.label] || 0;
    var presales = share.parts[CFG.categories.presales.label] || 0;
    var m = A.dailyMatrix(staffOnly(state.rows), state.loadedFrom, state.loadedTo, CFG.standardHoursPerDay, localToday());
    var lacking = m.staff.reduce(function (a, s) { return a + s.missing + s.short; }, 0);
    var missing = m.staff.reduce(function (a, s) { return a + s.missing; }, 0);
    var od = A.overdueTasks(rows);
    var odHours = od.reduce(function (a, x) { return a + x.hours; }, 0);
    var items = [
      { k: "合計工数", v: fmtH(t.hours), u: "h", sub: "前期間比 " + U.changeText(A.change(t.hours, pt.hours)) },
      { k: "案件以外の割合", v: pct(indirect, t.hours).replace("%", ""), u: "%", sub: "受注前 " + pct(presales, t.hours), tab: "share" },
      { k: "入力が足りない日", v: String(lacking), u: "人日", sub: "うち未入力 " + missing + " 人日（8h未満を含む）", tab: "input" },
      { k: "期限超過のタスク", v: String(od.length), u: "件", sub: "超過後の工数 " + fmtH(odHours) + "h", tab: "overdue" },
      { k: "作業担当者", v: String(t.staff), u: "人", sub: "入力のあった日 " + t.days + " 日" },
      { k: "PJ", v: String(t.projects), u: "件", sub: "前期間 " + pt.projects + " 件" }
    ];
    var box = $("kpis");
    box.innerHTML = "";
    items.forEach(function (it) {
      var v = el("div", { class: "v", text: it.v });
      v.appendChild(el("small", { text: it.u }));
      var kids = [el("div", { class: "k", text: it.k }), v, el("div", { class: "s", text: it.sub })];
      var tile = it.tab
        ? el("button", { type: "button", class: "kpi link", title: "「" + tabName(it.tab) + "」を開く" }, kids)
        : el("div", { class: "kpi" }, kids);
      if (it.tab) tile.addEventListener("click", function () { setTab(it.tab); });
      box.appendChild(tile);
    });
  }

  // ---- 概要：横棒（担当者・工程・PJ） ----
  function renderGroup(dim) {
    var rows = filtered(state.rows);
    var groups = A.groupSum(rows, dim);
    var prev = {};
    A.groupSum(filtered(state.prevRows), dim).forEach(function (g) { prev[g.key] = g.hours; });
    var total = groups.reduce(function (s, g) { return s + g.hours; }, 0);
    var body = $("body-" + dim);
    body.innerHTML = "";
    $("sub-" + dim).textContent = groups.length ? "（" + groups.length + "件・計 " + fmtH(total) + "h）" : "";
    if (!groups.length) {
      body.appendChild(U.empty());
      return;
    }
    if (state.view[dim] === "table") {
      var cols = [{ label: DIM_LABEL[dim], get: function (g) { return g.label; } }];
      if (dim === "project") cols.push({ label: "JOB NO", get: function (g) { return g.jobNo; } });
      cols = cols.concat([
        { label: "工数(h)", num: true, get: function (g) { return fmtH(g.hours); } },
        { label: "構成比", num: true, get: function (g) { return pct(g.hours, total); } },
        { label: "前期間(h)", num: true, get: function (g) { return fmtH(prev[g.key] || 0); } },
        { label: "増減", num: true, get: function (g) { return U.changeText(A.change(g.hours, prev[g.key] || 0)); } },
        { label: "明細", num: true, get: function (g) { return g.count; } }
      ]);
      body.appendChild(U.table(cols, groups));
      return;
    }
    body.appendChild(U.hbars(groups, {
      onClick: function (g) { toggleFilter(dim, g.key, g.label); },
      tipLines: function (g) {
        var lines = [fmtH(g.hours) + " h（" + pct(g.hours, total) + "）", "明細 " + g.count + " 件",
          "前期間 " + fmtH(prev[g.key] || 0) + " h → " + U.changeText(A.change(g.hours, prev[g.key] || 0))];
        if (dim === "project" && g.jobNo) lines.unshift("JOB NO " + g.jobNo);
        return lines;
      }
    }));
  }

  // ---- ③ 期間別（積み上げ）。前期間の合計も添える ----
  function renderPeriodInto(bodyId, subId, dim, rows, viewKey) {
    var scheme = colorScheme(dim);
    var series = dim
      ? A.stackedSeries(rows, state.loadedFrom, state.loadedTo, state.unit, CFG.weekStartsOn, dim, scheme.keys)
      : A.seriesByPeriod(rows, state.loadedFrom, state.loadedTo, state.unit, CFG.weekStartsOn).map(function (b) {
          b.parts = [{ key: "all", hours: b.hours }];
          return b;
        });
    var total = series.reduce(function (s, b) { return s + b.hours; }, 0);
    var prevTotal = A.totals(filtered(state.prevRows)).hours;
    var body = $(bodyId);
    body.innerHTML = "";
    $(subId).textContent = "（" + UNIT_LABEL[state.unit] + "ごと・計 " + fmtH(total) + "h／前期間 " + fmtH(prevTotal) + "h）";
    if (viewKey && state.view[viewKey] === "table") {
      var keys = dim ? scheme.keys.concat([A.OTHER]).filter(function (k) {
        return series.some(function (b) { return b.parts.some(function (p) { return p.key === k && p.hours > 0; }); });
      }) : [];
      var cols = [{ label: "期間", get: function (b) { return b.from === b.to ? b.from : b.from + "〜" + b.to; } }]
        .concat(keys.map(function (k) {
          return { label: scheme.nameOf(k), num: true, get: function (b) {
            var p = b.parts.filter(function (x) { return x.key === k; })[0];
            return fmtH(p ? p.hours : 0);
          } };
        }))
        .concat([{ label: "計(h)", num: true, get: function (b) { return fmtH(b.hours); } },
                 { label: "構成比", num: true, get: function (b) { return pct(b.hours, total); } }]);
      body.appendChild(U.table(cols, series));
      return;
    }
    if (!total) {
      body.appendChild(U.empty());
      return;
    }
    if (dim) body.appendChild(legendFor(scheme, series));
    body.appendChild(U.columns(series, {
      width: body.clientWidth,
      colorOf: scheme.colorOf,
      nameOf: scheme.nameOf,
      aria: "期間別工数のグラフ"
    }));
  }

  // ---- ① 入力状況 ----
  function cellClass(day, h, std) {
    if (day.kind !== "work") return "off";
    if (h === 0) return "miss";
    if (h < std / 2) return "s2";
    if (h < std) return "s1";
    if (h === std) return "ok";
    return h > std + 2 ? "o2" : "o1";
  }
  function renderInput() {
    var std = CFG.standardHoursPerDay;
    var m = A.dailyMatrix(staffOnly(state.rows), state.loadedFrom, state.loadedTo, std, localToday());
    var body = $("body-input");
    body.innerHTML = "";
    $("note-input").textContent = "1日 " + std + "h を基準に色分けしています。PJ名・工程の絞り込みは掛かりません（1日の合計を見るため）。" +
      "誰も入力していない平日は休日として数えず、今日以降も数えません。";
    $("legend-input").innerHTML = "";
    $("legend-input").appendChild(el("div", { class: "legend" }, [
      ["miss", "未入力（平日）"], ["s2", std / 2 + "h未満"], ["s1", std + "h未満"], ["ok", std + "h"],
      ["o1", std + "h超"], ["o2", (std + 2) + "h超"], ["off", "休日・土日・今日以降"]
    ].map(function (x) {
      return el("span", { class: "legend-item" }, [el("span", { class: "sw cell-" + x[0] }), el("span", { text: x[1] })]);
    })));
    var lacking = m.staff.reduce(function (a, s) { return a + s.missing + s.short; }, 0);
    $("sub-input").textContent = "（" + m.staff.length + "人・平日 " + m.days.filter(function (d) { return d.kind === "work"; }).length + " 日・足りない " + lacking + " 人日）";
    if (!m.staff.length) {
      body.appendChild(U.empty());
      return;
    }
    var head = el("tr", null, [el("th", { class: "sticky", text: "作業担当者" })]
      .concat([["未入力", "日"], [std + "h未満", "日"], [std + "h超", "日"], ["平均", "h/日"]].map(function (x) {
        return el("th", { class: "n sum", text: x[0] });
      }))
      .concat(m.days.map(function (d) {
        return el("th", { class: "day d" + d.dow + (d.kind !== "work" ? " offh" : "") }, [el("div", { text: U.mdLabel(d.date) }), el("div", { text: U.DOW[d.dow] })]);
      })));
    var rows = m.staff.map(function (s) {
      var tr = el("tr", null, [
        el("th", { class: "sticky", text: s.name }),
        el("td", { class: "n sum" + (s.missing ? " warn" : ""), text: String(s.missing) }),
        el("td", { class: "n sum", text: String(s.short) }),
        el("td", { class: "n sum", text: String(s.over) }),
        el("td", { class: "n sum", text: fmtH(s.avg) })
      ]);
      m.days.forEach(function (d) {
        var h = s.cells[d.date];
        var cls = cellClass(d, h, std);
        var td = el("td", { class: "cell cell-" + cls, text: cls === "miss" ? "未" : h ? fmtH(h) : "" });
        U.withTip(td, s.name + "　" + d.date + "（" + U.DOW[d.dow] + "）", [
          h ? fmtH(h) + " h" : "入力なし",
          d.kind === "holiday" ? "誰も入力していない平日（休日扱い）" : d.kind === "today" ? "今日以降（数えない）" : d.kind === "weekend" ? "土日" : ""
        ]);
        tr.appendChild(td);
      });
      return tr;
    });
    body.appendChild(el("table", { class: "heat input" }, [el("thead", null, [head]), el("tbody", null, rows)]));
  }

  // ---- ② 期限超過 ----
  function renderOverdue() {
    var list = A.overdueTasks(filtered(state.rows));
    var body = $("body-overdue");
    body.innerHTML = "";
    var hours = list.reduce(function (a, x) { return a + x.hours; }, 0);
    $("sub-overdue").textContent = "（" + list.length + "件・超過後の工数 計 " + fmtH(hours) + "h）";
    if (!list.length) {
      body.appendChild(U.empty("この条件で終了日を過ぎた工数はありません"));
      return;
    }
    body.appendChild(U.table([
      { label: "PJ名", get: function (t) {
        var b = el("button", { type: "button", class: "linklike", text: t.projectName, title: "この PJ で絞り込む" });
        b.addEventListener("click", function () { toggleFilter("project", t.project, t.projectName); });
        return b;
      } },
      { label: "JOB NO", get: function (t) { return t.jobNo; } },
      { label: "工程 > サブタスク", get: function (t) { return t.process + (t.subtask ? " > " + t.subtask : ""); } },
      { label: "ZPの状態", get: function (t) {
        return t.closed ? el("span", { class: "badge badge-closed", text: "ZPで完了" }) : el("span", { class: "muted", text: t.status || "" });
      } },
      { label: "終了日", get: function (t) { return t.end; } },
      { label: "最後の入力", get: function (t) { return t.lastDate; } },
      { label: "超過日数", num: true, get: function (t) { return t.daysOver + " 日"; } },
      { label: "超過後の工数", num: true, get: function (t) { return fmtH(t.hours) + " h"; } },
      { label: "担当者", get: function (t) { return t.staff.join("、"); } }
    ], list, "overdue"));
  }

  // ---- ④ クロス分析 ----
  function heatLevel(v, max) {
    if (!v) return 0;
    var r = v / max;
    return r > 0.6 ? 4 : r > 0.35 ? 3 : r > 0.15 ? 2 : 1;
  }
  function renderCross() {
    var parts = state.cross.split(":"), rowDim = parts[0], colDim = parts[1];
    var x = A.crossTab(filtered(state.rows), rowDim, colDim, CFG.crossMaxCols);
    var body = $("body-cross");
    body.innerHTML = "";
    $("sub-cross").textContent = "（行 " + x.rows.length + "・列 " + x.cols.length + "・計 " + fmtH(x.hours) + "h）";
    if (!x.rows.length) {
      body.appendChild(U.empty());
      return;
    }
    var rowPct = state.crossMode === "rowpct";
    var max = 0;
    x.rows.forEach(function (r) {
      x.cols.forEach(function (c) {
        var v = r.cells[c.key] || 0;
        max = Math.max(max, rowPct ? (r.hours ? v / r.hours : 0) : v);
      });
    });
    var head = el("tr", null, [el("th", { class: "sticky", text: DIM_LABEL[rowDim] + " ＼ " + DIM_LABEL[colDim] })]
      .concat(x.cols.map(function (c) { return el("th", { class: "colh", title: c.label }, [el("span", { text: c.label })]); }))
      .concat([el("th", { class: "n", text: "計(h)" })]));
    var rows = x.rows.map(function (r) {
      var tr = el("tr", null, [el("th", { class: "sticky", title: r.label + (r.jobNo ? "（" + r.jobNo + "）" : ""), text: r.label })]);
      x.cols.forEach(function (c) {
        var v = r.cells[c.key] || 0;
        var shown = rowPct ? (r.hours ? v / r.hours : 0) : v;
        var td = el("td", { class: "cell q" + heatLevel(shown, max), text: v ? (rowPct ? Math.round(shown * 100) + "%" : fmtH(v)) : "" });
        if (v) U.withTip(td, r.label + " × " + c.label, [fmtH(v) + " h", "行の中の割合 " + pct(v, r.hours), "列の中の割合 " + pct(v, c.hours)]);
        tr.appendChild(td);
      });
      tr.appendChild(el("td", { class: "n total", text: fmtH(r.hours) }));
      return tr;
    });
    var foot = el("tr", { class: "foot" }, [el("th", { class: "sticky", text: "計(h)" })]
      .concat(x.cols.map(function (c) { return el("td", { class: "n total", text: fmtH(c.hours) }); }))
      .concat([el("td", { class: "n total", text: fmtH(x.hours) })]));
    body.appendChild(el("table", { class: "heat cross" }, [el("thead", null, [head]), el("tbody", null, rows.concat([foot]))]));
  }

  // ---- ⑤ 案件以外の割合 ----
  function renderShare() {
    var rows = filtered(state.rows);
    var s = A.categoryShare(rows, CAT_LABELS);
    var prev = A.categoryShare(filtered(state.prevRows), CAT_LABELS);
    var ind = CFG.categories.indirect.label, pre = CFG.categories.presales.label;
    var scheme = colorScheme("category");
    $("note-share").textContent = "区分の決め方：工程が「" + CFG.categories.indirect.processes.join("・") + "」か PJ名に「" +
      CFG.categories.indirect.projectNameIncludes.join("・") + "」を含む → " + ind + "／PJ名が「" +
      CFG.categories.presales.projectNamePrefixes.join("・") + "」で始まる → " + pre + "／それ以外 → " + CFG.categories.project.label + "。";
    $("legend-share").innerHTML = "";
    $("legend-share").appendChild(U.legend(CAT_LABELS.map(function (l) { return { label: l, color: scheme.colorOf(l) }; })));
    $("sub-share").textContent = "（全体：" + ind + " " + pct(s.all.parts[ind], s.all.hours) + "・" + pre + " " + pct(s.all.parts[pre], s.all.hours) +
      "／前期間 " + ind + " " + pct(prev.all.parts[ind] || 0, prev.all.hours) + "）";
    var body = $("body-share");
    body.innerHTML = "";
    if (!s.all.hours) {
      body.appendChild(U.empty());
    } else {
      var list = [s.all].concat(s.staff.sort(function (a, b) {
        return (b.parts[ind] / (b.hours || 1)) - (a.parts[ind] / (a.hours || 1));
      }));
      var wrap = el("div", { class: "share" });
      list.forEach(function (o, i) {
        var bar = el("div", { class: "sbar" });
        CAT_LABELS.forEach(function (l) {
          var v = o.parts[l] || 0;
          if (!v) return;
          var seg = el("span", { class: "sseg", style: "flex-grow:" + v + ";background:" + scheme.colorOf(l) });
          var p = Math.round((v / o.hours) * 100);
          if (p >= 12) seg.appendChild(el("span", { class: "slabel", text: p + "%" }));
          U.withTip(seg, o.name + "：" + l, [fmtH(v) + " h（" + pct(v, o.hours) + "）"]);
          bar.appendChild(seg);
        });
        wrap.appendChild(el("div", { class: "srow" + (i === 0 ? " all" : "") }, [
          el("div", { class: "sname", text: o.name, title: o.name }),
          bar,
          el("div", { class: "sval", text: ind + " " + pct(o.parts[ind] || 0, o.hours) + "・計 " + fmtH(o.hours) + "h" })
        ]));
      });
      body.appendChild(wrap);
    }
    renderPeriodInto("body-share-trend", "sub-share-trend", "category", rows, null);
  }

  // ---- タブ ----
  var TABS = ["overview", "input", "overdue", "cross", "share"];
  function tabName(t) { return $("tab-" + t).textContent; }
  function setTab(t) {
    state.tab = t;
    renderAll();
    $("tab-" + t).focus();
  }
  function syncTabs() {
    TABS.forEach(function (t) {
      var on = t === state.tab;
      $("tab-" + t).setAttribute("aria-selected", String(on));
      $("tab-" + t).tabIndex = on ? 0 : -1;
      $("panel-" + t).hidden = !on;
    });
  }

  function syncButtons() {
    function press(sel, attr, val) {
      Array.prototype.forEach.call(document.querySelectorAll(sel), function (b) {
        b.setAttribute("aria-pressed", String(b.dataset[attr] === val));
      });
    }
    press("#presets button", "preset", state.preset);
    press("#units button", "unit", state.unit);
    press("#cross-kind button", "cross", state.cross);
    press("#cross-mode button", "mode", state.crossMode);
    Array.prototype.forEach.call(document.querySelectorAll("[data-view-for]"), function (g) {
      Array.prototype.forEach.call(g.querySelectorAll("button"), function (b) {
        b.setAttribute("aria-pressed", String(b.dataset.view === state.view[g.dataset.viewFor]));
      });
    });
    $("stack-by").value = state.stackBy;
    $("from").value = state.from;
    $("to").value = state.to;
  }

  // keepPanels：開いている絞り込みのパネルの中身は描き直さない（チェック中にフォーカスが飛ばないように）
  function renderAll(keepPanels) {
    U.hideTip();
    syncButtons();
    syncTabs();
    renderChips();
    selects.forEach(function (m) {
      m.refresh();
      if (!keepPanels && m.isOpen()) m.renderList();
    });
    if (!state.loadedFrom) return;
    renderKpis();
    if (state.tab === "overview") {
      renderPeriodInto("body-period", "sub-period", state.stackBy, filtered(state.rows), "period");
      renderGroup("staff");
      renderGroup("process");
      renderGroup("project");
    } else if (state.tab === "input") renderInput();
    else if (state.tab === "overdue") renderOverdue();
    else if (state.tab === "cross") renderCross();
    else if (state.tab === "share") renderShare();
  }
  function render() { renderAll(); }

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
    function each(sel, fn) { Array.prototype.forEach.call(document.querySelectorAll(sel), fn); }
    each("#presets button", function (b) { b.addEventListener("click", function () { applyPreset(b.dataset.preset); }); });
    each("#units button", function (b) { b.addEventListener("click", function () { state.unit = b.dataset.unit; render(); }); });
    each("#cross-kind button", function (b) { b.addEventListener("click", function () { state.cross = b.dataset.cross; render(); }); });
    each("#cross-mode button", function (b) { b.addEventListener("click", function () { state.crossMode = b.dataset.mode; render(); }); });
    each("[data-view-for]", function (g) {
      Array.prototype.forEach.call(g.querySelectorAll("button"), function (b) {
        b.addEventListener("click", function () { state.view[g.dataset.viewFor] = b.dataset.view; render(); });
      });
    });
    each(".tabs [role=tab]", function (b) {
      b.addEventListener("click", function () { setTab(b.dataset.tab); });
      b.addEventListener("keydown", function (e) {
        var i = TABS.indexOf(state.tab);
        if (e.key === "ArrowRight") { e.preventDefault(); setTab(TABS[(i + 1) % TABS.length]); }
        if (e.key === "ArrowLeft") { e.preventDefault(); setTab(TABS[(i + TABS.length - 1) % TABS.length]); }
      });
    });
    $("stack-by").addEventListener("change", function () { state.stackBy = $("stack-by").value; render(); });
    ["from", "to"].forEach(function (id) {
      $(id).addEventListener("change", function () {
        state[id] = $(id).value;
        state.preset = "";
        syncButtons();
      });
    });
    $("reload").addEventListener("click", load);
    $("reset-filters").addEventListener("click", resetFilters);
    var resizeTimer = null;
    window.addEventListener("resize", function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () { if (state.loadedFrom) render(); }, 150);
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
    bind();
    renderAll();
    applyPreset(state.preset);
  }

  function boot() {
    if (typeof ZOHO === "undefined" || !ZOHO.embeddedApp) {
      showError("Zoho のウィジェット SDK を読み込めませんでした。CRM の画面の中で開いているか、ネットワークを確認してください。");
      return;
    }
    ZOHO.embeddedApp.on("PageLoad", start);
    ZOHO.embeddedApp.init().then(start).catch(function (err) {
      showError("ウィジェットの初期化に失敗しました。\n" + U.describeError(err));
    });
  }

  boot();
})();
