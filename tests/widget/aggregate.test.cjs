// 工数ダッシュボードの集計（widgets/worklog-dashboard/app/aggregate.js）のテスト。Zoho には接続しない。
//   node --test tests/widget/aggregate.test.cjs
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const APP = path.join(__dirname, "..", "..", "widgets", "worklog-dashboard", "app");
const CFG = require(path.join(APP, "config.js"));
const A = require(path.join(APP, "aggregate.js"));

function raw(id, hours, date, staff, pid, pname, job, proc, extra) {
  return Object.assign({
    id, Hours: hours, "Parent_Id.Work_Date": date, "Parent_Id.Staff": staff,
    "ZP_Task.ZP_Project_Id": pid, "ZP_Task.Project_Name": pname, "ZP_Task.JOB_NO": job, "ZP_Task.Task_Name": proc
  }, extra || {});
}
const T = (id, name, end, status, sub) => ({
  ZP_Task: { id, name }, "ZP_Task.ZP_End_Date": end, "ZP_Task.ZP_Status": status, "ZP_Task.Subtask_Name": sub || null
});
const ROWS = [
  raw("1", 2, "2026-09-15", "八木 和明", "p1", "シンクロ 電源Box", "CV26031", "本作部品手配", T("t1", "x", "2026-09-30", "In Progress", "機構部品")),
  raw("2", 3, "2026-09-16", "八木 和明", "p2", "カジヤ 溶接機", "WB26040", "設計", T("t2", "x", "2026-09-15", "Closed", "機械設計")),
  raw("3", 4.5, "2026-09-22", "望月 寛紀", "p2", "カジヤ 溶接機", "WB26040", "設計", T("t2", "x", "2026-09-15", "Closed", "機械設計")),
  raw("4", 1, "2026-10-01", "望月 寛紀", "p3", "【望月 寛紀】その他工数入力用", null, "その他工数入力", T("t3", "x", "2033-01-01", "Open")),
  raw("5", 0.5, "2026-10-01", null, null, null, null, null),
  raw("6", 0, "2026-10-01", "八木 和明", "p4", "【受注前】虹技様向けWF", "CE26010", "見積作成", T("t4", "x", "2026-09-30", "In Progress"))
].map((r) => A.normalizeRow(r, CFG));

test("config の項目がすべて COQL に入る", () => {
  const q = A.buildQuery(CFG, "2026-09-01", "2026-09-30", 200);
  for (const f of Object.values(CFG.fields)) assert.ok(q.includes(f), f);
  assert.match(q, /^select .+ from WorkLogItems where Parent_Id\.Work_Date >= '2026-09-01' and Parent_Id\.Work_Date <= '2026-09-30' order by id asc limit 200 offset 200$/);
});

test("COQL に不正な日付は入れない", () => {
  assert.throws(() => A.buildQuery(CFG, "2026-09-01' or id is not null --", "2026-09-30", 0));
  assert.throws(() => A.buildQuery(CFG, "2026-09-01", "2026-09-30", -1));
});

test("平坦キーの行を整形する（空は（未入力））", () => {
  assert.equal(ROWS[0].staff, "八木 和明");
  assert.equal(ROWS[0].project, "p1");
  assert.equal(ROWS[0].projectName, "シンクロ 電源Box");
  assert.equal(ROWS[0].process, "本作部品手配");
  assert.equal(ROWS[4].staff, A.UNKNOWN);
  assert.equal(ROWS[4].project, A.UNKNOWN);
  assert.equal(ROWS[4].process, A.UNKNOWN);
});

test("軸ごとの合計は工数の多い順。その他工数入力用 PJ もそのまま並ぶ", () => {
  const staff = A.groupSum(ROWS, "staff");
  assert.deepEqual(staff.map((g) => [g.label, g.hours, g.count]), [
    ["望月 寛紀", 5.5, 2], ["八木 和明", 5, 3], [A.UNKNOWN, 0.5, 1]
  ]);
  const pj = A.groupSum(ROWS, "project");
  assert.deepEqual(pj.map((g) => [g.label, g.jobNo, g.hours]), [
    ["カジヤ 溶接機", "WB26040", 7.5], ["シンクロ 電源Box", "CV26031", 2],
    ["【望月 寛紀】その他工数入力用", "", 1], [A.UNKNOWN, "", 0.5], ["【受注前】虹技様向けWF", "CE26010", 0]
  ]);
  const proc = A.groupSum(ROWS, "process");
  assert.equal(proc[0].label, "設計");
  assert.equal(proc[0].hours, 7.5);
});

test("絞り込み：同じ軸は「または」、軸どうしは「かつ」。空なら絞り込まない", () => {
  const none = { staff: [], project: [], process: [] };
  assert.equal(A.applyFilters(ROWS, none).length, ROWS.length);
  assert.deepEqual(A.applyFilters(ROWS, { ...none, project: ["p1", "p3"] }).map((r) => r.id), ["1", "4"]);
  assert.deepEqual(A.applyFilters(ROWS, { ...none, project: ["p1", "p2"], process: ["設計"] }).map((r) => r.id), ["2", "3"]);
  assert.deepEqual(A.applyFilters(ROWS, { staff: ["八木 和明"], project: [], process: ["設計"] }).map((r) => r.id), ["2"]);
  assert.deepEqual(A.applyFilters(ROWS, { ...none, process: ["無い工程"] }), []);
});

test("検索：全角・半角、大文字小文字、空白の違いを無視し、語をすべて含むものだけ", () => {
  assert.ok(A.matchesSearch(["日鉄周南　REM用アンコイラ", "CE26004"], "rem"));
  assert.ok(A.matchesSearch(["日鉄周南　REM用アンコイラ", "CE26004"], "日鉄 アンコイラ"));
  assert.ok(A.matchesSearch(["日鉄周南　REM用アンコイラ", "CE26004"], "ｃｅ２６"));
  assert.ok(A.matchesSearch(["日鉄周南　REM用アンコイラ", "CE26004"], "日鉄周南 REM"));
  assert.ok(!A.matchesSearch(["日鉄周南　REM用アンコイラ", "CE26004"], "日鉄 WF"));
  assert.ok(A.matchesSearch(["設計", ""], ""));
  assert.ok(A.matchesSearch(["調整・試運転", ""], "試運転"));
});

test("期間別：日・週（月曜始まり）・月で切れ目なく並ぶ", () => {
  const day = A.seriesByPeriod(ROWS, "2026-09-15", "2026-09-17", "day", 1);
  assert.deepEqual(day.map((b) => [b.key, b.hours]), [["2026-09-15", 2], ["2026-09-16", 3], ["2026-09-17", 0]]);
  const week = A.seriesByPeriod(ROWS, "2026-09-15", "2026-10-01", "week", 1);
  assert.deepEqual(week.map((b) => [b.key, b.from, b.to, b.hours]), [
    ["2026-09-14", "2026-09-15", "2026-09-20", 5],
    ["2026-09-21", "2026-09-21", "2026-09-27", 4.5],
    ["2026-09-28", "2026-09-28", "2026-10-01", 1.5]
  ]);
  const month = A.seriesByPeriod(ROWS, "2026-09-15", "2026-10-13", "month", 1);
  assert.deepEqual(month.map((b) => [b.label, b.hours]), [["2026/9", 9.5], ["2026/10", 1.5]]);
});

test("期間のプリセット（年度は4月始まり）", () => {
  assert.deepEqual(A.presetRange("thisMonth", "2026-10-14", 4), { from: "2026-10-01", to: "2026-10-14" });
  assert.deepEqual(A.presetRange("lastMonth", "2026-03-31", 4), { from: "2026-02-01", to: "2026-02-28" });
  assert.deepEqual(A.presetRange("last3Months", "2026-01-10", 4), { from: "2025-11-01", to: "2026-01-10" });
  assert.deepEqual(A.presetRange("fiscalYear", "2026-10-14", 4), { from: "2026-04-01", to: "2026-10-14" });
  assert.deepEqual(A.presetRange("fiscalYear", "2027-02-01", 4), { from: "2026-04-01", to: "2027-02-01" });
});

test("取得は月ごとに分け、溢れたら半分に分ける", () => {
  assert.deepEqual(A.monthChunks("2026-09-15", "2026-11-03"), [
    { from: "2026-09-15", to: "2026-09-30" }, { from: "2026-10-01", to: "2026-10-31" }, { from: "2026-11-01", to: "2026-11-03" }
  ]);
  assert.deepEqual(A.splitRange("2026-10-01", "2026-10-31"), [
    { from: "2026-10-01", to: "2026-10-16" }, { from: "2026-10-17", to: "2026-10-31" }
  ]);
  assert.equal(A.splitRange("2026-10-01", "2026-10-01"), null);
});

test("合計のタイル", () => {
  assert.deepEqual(A.totals(ROWS), { hours: 11, items: 6, staff: 3, projects: 5, days: 4 });
});

test("区分：その他工数入力は「案件以外」、【受注前】は「受注前」、残りは「案件」", () => {
  assert.deepEqual(ROWS.map((r) => r.category), ["案件", "案件", "案件", "案件以外", "案件", "受注前"]);
  assert.equal(A.categoryOf("【八木 和明】その他工数入力用", "設計", CFG.categories), "案件以外");
});

test("前の期間：直前の同じ日数。差と率（前が0なら率なし）", () => {
  assert.deepEqual(A.previousRange("2026-10-01", "2026-10-14"), { from: "2026-09-17", to: "2026-09-30" });
  assert.deepEqual(A.previousRange("2026-09-01", "2026-09-30"), { from: "2026-08-02", to: "2026-08-31" });
  assert.deepEqual(A.change(120, 100), { diff: 20, rate: 20 });
  assert.deepEqual(A.change(5, 0), { diff: 5, rate: null });
  assert.deepEqual(A.splitByRange(ROWS, "2026-09-16", "2026-09-22").map((r) => r.id), ["2", "3"]);
});

test("③ 推移の積み上げ：上位のキーごとに積み、残りは「その他」", () => {
  const keys = A.topKeys(ROWS, "staff", 1);
  assert.deepEqual(keys, ["望月 寛紀"]);
  const s = A.stackedSeries(ROWS, "2026-09-15", "2026-10-01", "week", 1, "staff", keys);
  assert.deepEqual(s.map((b) => [b.key, b.parts.map((p) => [p.key, p.hours]), b.hours]), [
    ["2026-09-14", [["望月 寛紀", 0], [A.OTHER, 5]], 5],
    ["2026-09-21", [["望月 寛紀", 4.5], [A.OTHER, 0]], 4.5],
    ["2026-09-28", [["望月 寛紀", 1], [A.OTHER, 0.5]], 1.5]
  ]);
});

test("① 入力状況：平日と入力のあった土日、誰も入力しない平日は休日、今日以降は数えない", () => {
  const rows = [
    raw("a", 8, "2026-10-05", "A", "p", "P", "", "設計"),       // 月 8h
    raw("b", 5, "2026-10-06", "A", "p", "P", "", "設計"),       // 火 5h（不足）
    raw("c", 9, "2026-10-06", "B", "p", "P", "", "設計"),       // 火 B 9h（超過）
    raw("d", 3, "2026-10-10", "A", "p", "P", "", "設計"),       // 土 3h
    raw("e", 8, "2026-10-12", "B", "p", "P", "", "設計")        // 月（今日）
  ].map((r) => A.normalizeRow(r, CFG));
  // 10/7〜10/9 は誰も入力していない → 休日扱い
  const m = A.dailyMatrix(rows, "2026-10-05", "2026-10-12", 8, "2026-10-12");
  assert.deepEqual(m.days.map((d) => [d.date, d.kind]), [
    ["2026-10-05", "work"], ["2026-10-06", "work"], ["2026-10-07", "holiday"], ["2026-10-08", "holiday"],
    ["2026-10-09", "holiday"], ["2026-10-10", "weekend"], ["2026-10-12", "today"]
  ]);
  const a = m.staff.find((s) => s.name === "A"), b = m.staff.find((s) => s.name === "B");
  assert.deepEqual([a.workDays, a.missing, a.short, a.over, a.total, a.avg], [2, 0, 1, 0, 16, 8]);
  assert.deepEqual([b.workDays, b.missing, b.short, b.over, b.total], [2, 1, 0, 1, 17]);
});

test("④ クロス表：列は上位まで、残りは「その他」。行の合計と一致", () => {
  const x = A.crossTab(ROWS, "staff", "project", 2);
  assert.deepEqual(x.cols.map((c) => [c.key, c.hours]), [["p2", 7.5], ["p1", 2], [A.OTHER, 1.5]]);
  const m = x.rows.find((r) => r.key === "望月 寛紀");
  assert.deepEqual(m.cells, { p2: 4.5, [A.OTHER]: 1 });
  assert.equal(x.hours, 11);
});

test("⑤ 区分の割合：担当者ごとと全体", () => {
  const s = A.categoryShare(ROWS, ["案件", "受注前", "案件以外"]);
  assert.deepEqual(s.all.parts, { "案件": 10, "受注前": 0, "案件以外": 1 });
  assert.deepEqual(s.staff.find((x) => x.name === "望月 寛紀").parts, { "案件": 4.5, "受注前": 0, "案件以外": 1 });
});
