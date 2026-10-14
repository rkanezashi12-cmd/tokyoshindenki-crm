// 集計の純粋関数（画面・SDK に依存しない）。tests/widget/aggregate.test.mjs で確かめる。
// 日付は "YYYY-MM-DD" の文字列で持ち、計算は UTC で行う（時差で日がずれないように）。
(function (root) {
  "use strict";

  var UNKNOWN = "（未入力）";
  var DIMS = ["staff", "project", "process"];

  // ---- 日付 ----
  function parseDate(s) {
    var p = String(s).split("-");
    return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
  }
  function fmtDate(d) {
    var m = d.getUTCMonth() + 1, day = d.getUTCDate();
    return d.getUTCFullYear() + "-" + (m < 10 ? "0" : "") + m + "-" + (day < 10 ? "0" : "") + day;
  }
  function addDays(s, n) {
    var d = parseDate(s);
    d.setUTCDate(d.getUTCDate() + n);
    return fmtDate(d);
  }
  function startOfWeek(s, weekStartsOn) {
    var d = parseDate(s);
    var diff = (d.getUTCDay() - weekStartsOn + 7) % 7;
    return addDays(s, -diff);
  }
  function startOfMonth(s) {
    return s.slice(0, 8) + "01";
  }
  function endOfMonth(s) {
    var d = parseDate(startOfMonth(s));
    d.setUTCMonth(d.getUTCMonth() + 1);
    d.setUTCDate(0);
    return fmtDate(d);
  }
  function addMonths(s, n) {
    var d = parseDate(startOfMonth(s));
    d.setUTCMonth(d.getUTCMonth() + n);
    return fmtDate(d);
  }

  // 期間のプリセット。today は "YYYY-MM-DD"
  function presetRange(name, today, fiscalYearStartMonth) {
    switch (name) {
      case "thisMonth":
        return { from: startOfMonth(today), to: today };
      case "lastMonth": {
        var lm = addMonths(today, -1);
        return { from: lm, to: endOfMonth(lm) };
      }
      case "last3Months":
        return { from: addMonths(today, -2), to: today };
      case "fiscalYear": {
        var y = +today.slice(0, 4), m = +today.slice(5, 7);
        var fy = m >= fiscalYearStartMonth ? y : y - 1;
        var mm = (fiscalYearStartMonth < 10 ? "0" : "") + fiscalYearStartMonth;
        return { from: fy + "-" + mm + "-01", to: today };
      }
      default:
        throw new Error("unknown preset: " + name);
    }
  }

  // 取得を月ごとに分ける（COQL の OFFSET 上限 2,000 を超えにくくする）
  function monthChunks(from, to) {
    var out = [], cur = from;
    while (cur <= to) {
      var end = endOfMonth(cur);
      if (end > to) end = to;
      out.push({ from: cur, to: end });
      cur = addDays(end, 1);
    }
    return out;
  }

  // 期間を半分に分ける（1か月で 2,000 件を超えたとき用）
  function splitRange(from, to) {
    var days = Math.round((parseDate(to) - parseDate(from)) / 86400000);
    if (days < 1) return null;
    var mid = addDays(from, Math.floor(days / 2));
    return [{ from: from, to: mid }, { from: addDays(mid, 1), to: to }];
  }

  // ---- COQL ----
  function selectFields(cfg) {
    var f = cfg.fields;
    return [f.hours, f.workDate, f.staff, f.projectId, f.projectName, f.jobNo, f.process];
  }
  function isDate(s) {
    return /^\d{4}-\d{2}-\d{2}$/.test(s);
  }
  function buildQuery(cfg, from, to, offset) {
    if (!isDate(from) || !isDate(to)) throw new Error("日付の形式が不正です");
    if (!(offset >= 0)) throw new Error("offset が不正です");
    var d = cfg.fields.workDate;
    return "select " + selectFields(cfg).join(", ") +
      " from " + cfg.module +
      " where " + d + " >= '" + from + "' and " + d + " <= '" + to + "'" +
      " order by id asc limit " + cfg.pageSize + " offset " + offset;
  }

  // ---- 行の整形 ----
  function text(v) {
    if (v === null || v === undefined) return "";
    if (typeof v === "object") return String(v.name || "");
    return String(v).trim();
  }
  // 区分（案件／受注前／案件以外）。config.categories の上から順に当てはめる
  function categoryOf(projectName, process, cats) {
    var ind = cats.indirect, pre = cats.presales;
    if ((ind.processes || []).indexOf(process) >= 0) return ind.label;
    if ((ind.projectNameIncludes || []).some(function (w) { return projectName.indexOf(w) >= 0; })) return ind.label;
    if ((pre.projectNamePrefixes || []).some(function (w) { return projectName.indexOf(w) === 0; })) return pre.label;
    return cats.project.label;
  }

  // COQL の2階層参照は "Parent.Field" という平坦なキーで返る（スキル第10章）
  function normalizeRow(raw, cfg) {
    var f = cfg.fields;
    var projectName = text(raw[f.projectName]);
    var projectId = text(raw[f.projectId]);
    var process = text(raw[f.process]) || UNKNOWN;
    return {
      id: String(raw.id),
      hours: Number(raw[f.hours]) || 0,
      date: text(raw[f.workDate]),
      staff: text(raw[f.staff]) || UNKNOWN,
      project: projectId || projectName || UNKNOWN,
      projectName: projectName || UNKNOWN,
      jobNo: text(raw[f.jobNo]),
      process: process,
      category: categoryOf(projectName, process, cfg.categories)
    };
  }

  // ---- 絞り込み・集計 ----
  // filters: { staff: [key...], project: [key...], process: [key...] }（空＝絞り込まない。同じ軸の中は「または」）
  function applyFilters(rows, filters) {
    var active = DIMS.filter(function (dim) { return filters[dim] && filters[dim].length; });
    if (!active.length) return rows;
    var sets = {};
    active.forEach(function (dim) {
      sets[dim] = {};
      filters[dim].forEach(function (k) { sets[dim][k] = 1; });
    });
    return rows.filter(function (r) {
      for (var i = 0; i < active.length; i++) {
        if (!sets[active[i]][r[active[i]]]) return false;
      }
      return true;
    });
  }

  // 検索用の正規化：全角・半角をそろえ（NFKC）、大文字小文字と空白の違いを無視する
  function normalizeText(s) {
    var t = String(s || "");
    if (t.normalize) t = t.normalize("NFKC");
    return t.toLowerCase().replace(/\s+/g, "");
  }
  // 空白で区切った語をすべて含むか（名前・JOB NO のどちらに含まれてもよい）
  function matchesSearch(texts, query) {
    var words = String(query || "").split(/[\s\u3000]+/).map(normalizeText).filter(Boolean);
    if (!words.length) return true;
    var hay = texts.map(normalizeText).join("\n");
    return words.every(function (w) { return hay.indexOf(w) >= 0; });
  }

  function round1(n) {
    return Math.round(n * 10) / 10;
  }

  // 軸ごとの合計。工数の多い順（同じなら名前順）
  function groupSum(rows, dim) {
    var map = {};
    rows.forEach(function (r) {
      var k = r[dim];
      if (!map[k]) {
        map[k] = {
          key: k,
          label: dim === "project" ? r.projectName : k,
          jobNo: dim === "project" ? r.jobNo : "",
          hours: 0,
          count: 0
        };
      }
      map[k].hours += r.hours;
      map[k].count += 1;
    });
    return Object.keys(map).map(function (k) {
      map[k].hours = round1(map[k].hours);
      return map[k];
    }).sort(function (a, b) {
      return b.hours - a.hours || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0);
    });
  }

  function bucketStart(date, unit, weekStartsOn) {
    if (unit === "day") return date;
    if (unit === "week") return startOfWeek(date, weekStartsOn);
    if (unit === "month") return startOfMonth(date);
    throw new Error("unknown unit: " + unit);
  }
  function nextBucket(start, unit) {
    if (unit === "day") return addDays(start, 1);
    if (unit === "week") return addDays(start, 7);
    return addMonths(start, 1);
  }
  function bucketLabel(start, unit) {
    var m = +start.slice(5, 7), d = +start.slice(8, 10);
    if (unit === "month") return start.slice(0, 4) + "/" + m;
    if (unit === "week") return m + "/" + d + "週";
    return m + "/" + d;
  }

  // 期間別：from〜to を切れ目なく並べ、入力の無い区間は 0 にする
  function seriesByPeriod(rows, from, to, unit, weekStartsOn) {
    var sums = {};
    rows.forEach(function (r) {
      if (!r.date) return;
      var k = bucketStart(r.date, unit, weekStartsOn);
      sums[k] = (sums[k] || 0) + r.hours;
    });
    var out = [];
    for (var cur = bucketStart(from, unit, weekStartsOn); cur <= to; cur = nextBucket(cur, unit)) {
      var end = addDays(nextBucket(cur, unit), -1);
      out.push({
        key: cur,
        label: bucketLabel(cur, unit),
        from: cur < from ? from : cur,
        to: end > to ? to : end,
        hours: round1(sums[cur] || 0)
      });
    }
    return out;
  }

  // ---- 前の期間 ----
  function daysBetween(from, to) {
    return Math.round((parseDate(to) - parseDate(from)) / 86400000) + 1;
  }
  // 直前の同じ日数
  function previousRange(from, to) {
    var n = daysBetween(from, to);
    return { from: addDays(from, -n), to: addDays(from, -1) };
  }
  function splitByRange(rows, from, to) {
    return rows.filter(function (r) { return r.date >= from && r.date <= to; });
  }
  // 前の期間との差。前が 0 のときは率を出さない
  function change(cur, prev) {
    var diff = round1(cur - prev);
    return { diff: diff, rate: prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : null };
  }

  // ---- 色を割り当てる上位のキー（絞り込みで色が変わらないよう、期間内の全明細で決める） ----
  function topKeys(rows, dim, n) {
    return groupSum(rows, dim).slice(0, n).map(function (g) { return g.key; });
  }

  // ---- ③ 推移の積み上げ ----
  // keys の順に積み、残りは OTHER にまとめる
  var OTHER = "__other__";
  function stackedSeries(rows, from, to, unit, weekStartsOn, dim, keys) {
    var known = {};
    keys.forEach(function (k) { known[k] = 1; });
    var sums = {};
    rows.forEach(function (r) {
      if (!r.date) return;
      var b = bucketStart(r.date, unit, weekStartsOn);
      var k = known[r[dim]] ? r[dim] : OTHER;
      sums[b] = sums[b] || {};
      sums[b][k] = (sums[b][k] || 0) + r.hours;
    });
    return seriesByPeriod([], from, to, unit, weekStartsOn).map(function (b) {
      var s = sums[b.key] || {};
      var parts = keys.concat([OTHER]).map(function (k) { return { key: k, hours: round1(s[k] || 0) }; });
      b.parts = parts;
      b.hours = round1(parts.reduce(function (a, p) { return a + p.hours; }, 0));
      return b;
    });
  }

  // ---- ① 入力状況（担当者×日） ----
  function dayOfWeek(date) {
    return parseDate(date).getUTCDay();
  }
  // 列：平日すべて＋入力のあった土日。誰も入力していない平日は休日とみなして数えない。today 以降は数えない
  function dailyMatrix(rows, from, to, standard, today) {
    var byStaff = {}, dayTotal = {};
    rows.forEach(function (r) {
      if (!r.date || r.date < from || r.date > to) return;
      byStaff[r.staff] = byStaff[r.staff] || {};
      byStaff[r.staff][r.date] = (byStaff[r.staff][r.date] || 0) + r.hours;
      dayTotal[r.date] = (dayTotal[r.date] || 0) + r.hours;
    });
    var days = [];
    for (var d = from; d <= to; d = addDays(d, 1)) {
      var dow = dayOfWeek(d), weekend = dow === 0 || dow === 6;
      if (weekend && !dayTotal[d]) continue;
      var kind = d >= today ? "today" : weekend ? "weekend" : dayTotal[d] ? "work" : "holiday";
      days.push({ date: d, dow: dow, kind: kind });
    }
    var staff = Object.keys(byStaff).sort().map(function (name) {
      var cells = byStaff[name], s = { name: name, cells: {}, total: 0, workDays: 0, missing: 0, short: 0, over: 0 };
      days.forEach(function (day) {
        var h = round1(cells[day.date] || 0);
        s.cells[day.date] = h;
        s.total += h;
        if (day.kind !== "work") return;
        s.workDays += 1;
        if (h === 0) s.missing += 1;
        else if (h < standard) s.short += 1;
        else if (h > standard) s.over += 1;
      });
      s.total = round1(s.total);
      s.avg = s.workDays ? round1(s.total / s.workDays) : 0;
      return s;
    });
    return { days: days, staff: staff };
  }

  // ---- ④ クロス表 ----
  // 列は工数の多い順に maxCols まで、残りは OTHER
  function crossTab(rows, rowDim, colDim, maxCols) {
    var cols = groupSum(rows, colDim);
    var shown = cols.slice(0, maxCols), rest = cols.slice(maxCols);
    var colKey = {};
    shown.forEach(function (c) { colKey[c.key] = c.key; });
    var outCols = shown.map(function (c) { return { key: c.key, label: c.label, hours: c.hours }; });
    if (rest.length) {
      outCols.push({ key: OTHER, label: "その他（" + rest.length + "件）", hours: round1(rest.reduce(function (a, c) { return a + c.hours; }, 0)) });
    }
    var outRows = groupSum(rows, rowDim).map(function (g) {
      return { key: g.key, label: g.label, jobNo: g.jobNo, hours: g.hours, cells: {} };
    });
    var idx = {};
    outRows.forEach(function (r) { idx[r.key] = r; });
    rows.forEach(function (r) {
      var c = colKey[r[colDim]] !== undefined ? r[colDim] : OTHER;
      var row = idx[r[rowDim]];
      row.cells[c] = (row.cells[c] || 0) + r.hours;
    });
    outRows.forEach(function (r) {
      Object.keys(r.cells).forEach(function (k) { r.cells[k] = round1(r.cells[k]); });
    });
    return { rows: outRows, cols: outCols, hours: round1(outRows.reduce(function (a, r) { return a + r.hours; }, 0)) };
  }

  // ---- ⑤ 区分の割合（担当者ごと＋全体） ----
  function categoryShare(rows, labels) {
    function blank(name) {
      var o = { name: name, hours: 0, parts: {} };
      labels.forEach(function (l) { o.parts[l] = 0; });
      return o;
    }
    var all = blank("全体"), by = {};
    rows.forEach(function (r) {
      var s = by[r.staff] = by[r.staff] || blank(r.staff);
      [all, s].forEach(function (o) {
        o.hours += r.hours;
        o.parts[r.category] = (o.parts[r.category] || 0) + r.hours;
      });
    });
    function fin(o) {
      o.hours = round1(o.hours);
      Object.keys(o.parts).forEach(function (k) { o.parts[k] = round1(o.parts[k]); });
      return o;
    }
    var staff = Object.keys(by).map(function (k) { return fin(by[k]); });
    return { all: fin(all), staff: staff };
  }

  function totals(rows) {
    var staff = {}, project = {}, days = {}, h = 0;
    rows.forEach(function (r) {
      h += r.hours;
      staff[r.staff] = 1;
      project[r.project] = 1;
      if (r.date) days[r.date] = 1;
    });
    return {
      hours: round1(h),
      items: rows.length,
      staff: Object.keys(staff).length,
      projects: Object.keys(project).length,
      days: Object.keys(days).length
    };
  }

  var API = {
    UNKNOWN: UNKNOWN,
    DIMS: DIMS,
    addDays: addDays,
    startOfWeek: startOfWeek,
    presetRange: presetRange,
    monthChunks: monthChunks,
    splitRange: splitRange,
    buildQuery: buildQuery,
    normalizeRow: normalizeRow,
    applyFilters: applyFilters,
    normalizeText: normalizeText,
    matchesSearch: matchesSearch,
    groupSum: groupSum,
    seriesByPeriod: seriesByPeriod,
    totals: totals,
    OTHER: OTHER,
    categoryOf: categoryOf,
    daysBetween: daysBetween,
    previousRange: previousRange,
    splitByRange: splitByRange,
    change: change,
    topKeys: topKeys,
    stackedSeries: stackedSeries,
    dailyMatrix: dailyMatrix,
    crossTab: crossTab,
    categoryShare: categoryShare,
    isDate: isDate
  };
  root.WLD_AGG = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : globalThis);
