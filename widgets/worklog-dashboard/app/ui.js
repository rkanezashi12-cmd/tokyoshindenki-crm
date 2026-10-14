// 画面の部品（DOM・ツールチップ・グラフ）。データの取り方や CRM の項目は知らない。
(function (root) {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };

  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (attrs[k] === undefined || attrs[k] === null) return;
        if (k === "text") e.textContent = attrs[k];
        else if (k === "class") e.className = attrs[k];
        else e.setAttribute(k, attrs[k]);
      });
    }
    (children || []).forEach(function (c) { if (c) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
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
  function signed(n, unit) {
    if (n === null || n === undefined) return "-";
    return (n > 0 ? "+" : n < 0 ? "−" : "±") + fmtH(Math.abs(n)) + (unit || "");
  }
  function changeText(ch) {
    return signed(ch.diff, "h") + (ch.rate === null ? "" : "（" + signed(ch.rate, "%") + "）");
  }
  function mdLabel(date) {
    return (+date.slice(5, 7)) + "/" + (+date.slice(8, 10));
  }
  var DOW = ["日", "月", "火", "水", "木", "金", "土"];

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

  // ---- ツールチップ ----
  var tip = null;
  function showTip(evt, title, lines) {
    tip = tip || $("tip");
    tip.innerHTML = "";
    tip.appendChild(el("div", { class: "tt", text: title }));
    lines.forEach(function (l) { if (l) tip.appendChild(el("div", { class: "tm", text: l })); });
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
  function withTip(node, title, lines) {
    node.addEventListener("mouseenter", function (e) {
      showTip(e, typeof title === "function" ? title() : title, typeof lines === "function" ? lines() : lines);
    });
    node.addEventListener("mousemove", moveTip);
    node.addEventListener("mouseleave", hideTip);
    return node;
  }

  // ---- 凡例 ----
  function legend(items) {
    return el("div", { class: "legend" }, items.map(function (it) {
      return el("span", { class: "legend-item" }, [
        el("span", { class: "sw", style: "background:" + it.color }),
        el("span", { class: "legend-label", text: it.label, title: it.label })
      ]);
    }));
  }

  // ---- 横棒（1系列） ----
  // groups: [{key,label,jobNo,hours,count}], opts: { total, onClick(g), tipLines(g) }
  function hbars(groups, opts) {
    var max = groups.length ? groups[0].hours || 1 : 1;
    var list = el("div", { class: "hbars" });
    groups.forEach(function (g) {
      var name = g.label + (g.jobNo ? "（" + g.jobNo + "）" : "");
      var label = el("button", { type: "button", class: "hbar-label", "aria-label": name + " " + fmtH(g.hours) + "時間", text: g.label });
      var fill = el("span", { class: "hbar-fill" });
      // 値ラベルの分（約 56px）を残して棒を伸ばす
      fill.style.width = "calc((100% - 56px) * " + Math.max(g.hours, 0) / max + ")";
      var plot = el("button", { type: "button", class: "hbar-plot", tabindex: "-1", "aria-hidden": "true" },
        [fill, el("span", { class: "hbar-val", text: fmtH(g.hours) + "h" })]);
      [label, plot].forEach(function (t) {
        if (opts.onClick) t.addEventListener("click", function () { hideTip(); opts.onClick(g); });
        withTip(t, g.label, function () { return opts.tipLines(g); });
      });
      list.appendChild(el("div", { class: "hbar" }, [label, plot]));
    });
    return list;
  }

  // ---- 縦棒（積み上げ可） ----
  function niceStep(v) {
    if (v <= 0) return 1;
    var raw = v / 4;
    var p = Math.pow(10, Math.floor(Math.log10(raw)));
    var steps = [1, 2, 5, 10];
    for (var i = 0; i < steps.length; i++) if (raw <= steps[i] * p) return steps[i] * p;
    return 10 * p;
  }
  // series: [{key,label,from,to,hours,parts:[{key,hours}]}]
  // opts: { width, colorOf(key), nameOf(key), extraLines(bucket) }
  function columns(series, opts) {
    var W = Math.max(opts.width || 600, 300), H = 240;
    var m = { l: 44, r: 8, t: 16, b: 24 };
    var pw = W - m.l - m.r, ph = H - m.t - m.b;
    var maxV = Math.max.apply(null, series.map(function (b) { return b.hours; }).concat([0]));
    var step = niceStep(maxV);
    var top = step * Math.max(1, Math.ceil(maxV / step));
    var band = pw / Math.max(series.length, 1);
    var bw = Math.min(24, Math.max(2, band - 2));
    var svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": opts.aria || "グラフ" });
    for (var v = 0; v <= top + 1e-9; v += step) {
      var y = m.t + ph - (v / top) * ph;
      svg.appendChild(svgEl("line", { class: v === 0 ? "base" : "gridline", x1: m.l, x2: W - m.r, y1: y, y2: y }));
      svg.appendChild(svgEl("text", { class: "tick", x: m.l - 6, y: y + 4, "text-anchor": "end", text: fmtH(v) }));
    }
    var labelEvery = Math.max(1, Math.ceil(series.length / Math.max(1, Math.floor(pw / 48))));
    // 値ラベルは棒の間隔が十分なときだけ（重なるならツールチップと表に任せる）
    var showCaps = band >= 36;
    series.forEach(function (b, idx) {
      var cx = m.l + band * idx + band / 2, x = cx - bw / 2;
      var g = svgEl("g", { class: "colgroup" });
      var base = m.t + ph;
      var visible = b.parts.filter(function (p) { return p.hours > 0; });
      visible.forEach(function (p, pi) {
        var h = (p.hours / top) * ph;
        var yTop = base - h;
        var isTop = pi === visible.length - 1;
        // 積み上げの境目は 2px の隙間（面の色）で区切る。一番上だけ角を丸める
        var gap = pi > 0 ? 2 : 0;
        var y0 = yTop, y1 = base - gap;
        if (y1 - y0 < 0.5) { base = yTop; return; }
        var r = isTop ? Math.min(4, bw / 2, y1 - y0) : 0;
        var d = "M" + x + "," + y1 + "V" + (y0 + r) +
          (r ? "Q" + x + "," + y0 + " " + (x + r) + "," + y0 + "H" + (x + bw - r) + "Q" + (x + bw) + "," + y0 + " " + (x + bw) + "," + (y0 + r)
             : "H" + (x + bw)) + "V" + y1 + "Z";
        g.appendChild(svgEl("path", { class: "bar-seg", d: d, style: "fill:" + opts.colorOf(p.key) }));
        base = yTop;
      });
      var hit = svgEl("rect", { class: "hit", x: m.l + band * idx, y: m.t, width: band, height: ph });
      svg.appendChild(g);
      svg.appendChild(hit);
      if (showCaps && b.hours > 0) {
        svg.appendChild(svgEl("text", { class: "cap", x: cx, y: m.t + ph - (b.hours / top) * ph - 4, "text-anchor": "middle", text: fmtH(b.hours) }));
      }
      if (idx % labelEvery === 0) {
        svg.appendChild(svgEl("text", { class: "tick", x: cx, y: H - 6, "text-anchor": "middle", text: b.label }));
      }
      withTip(hit, b.from === b.to ? b.from : b.from + "〜" + b.to, function () {
        var lines = ["計 " + fmtH(b.hours) + " h"];
        if (b.parts.length > 1) {
          b.parts.slice().reverse().forEach(function (p) {
            if (p.hours > 0) lines.push(opts.nameOf(p.key) + "　" + fmtH(p.hours) + " h（" + pct(p.hours, b.hours) + "）");
          });
        }
        return lines.concat(opts.extraLines ? opts.extraLines(b) : []);
      });
      hit.addEventListener("mouseenter", function () { g.classList.add("hover"); });
      hit.addEventListener("mouseleave", function () { g.classList.remove("hover"); });
    });
    return el("div", { class: "cols" }, [svg]);
  }

  // ---- 表 ----
  // cols: [{label, num, get(row) → 文字列 or Node}]
  function table(cols, rows, cls) {
    var head = el("tr", null, cols.map(function (c) { return el("th", { class: c.num ? "n" : null, text: c.label }); }));
    var body = el("tbody", null, rows.map(function (r) {
      return el("tr", null, cols.map(function (c) {
        var v = c.get(r);
        return el("td", { class: c.num ? "n" : null }, [typeof v === "object" && v ? v : String(v === undefined || v === null ? "" : v)]);
      }));
    }));
    return el("table", { class: "t " + (cls || "") }, [el("thead", null, [head]), body]);
  }

  function empty(text) {
    return el("div", { class: "empty", text: text || "この条件の工数はありません" });
  }

  root.WLD_UI = {
    $: $, el: el, svgEl: svgEl, fmtH: fmtH, pct: pct, signed: signed, changeText: changeText, mdLabel: mdLabel, DOW: DOW,
    describeError: describeError, showTip: showTip, moveTip: moveTip, hideTip: hideTip, withTip: withTip,
    legend: legend, hbars: hbars, columns: columns, table: table, empty: empty
  };
})(window);
