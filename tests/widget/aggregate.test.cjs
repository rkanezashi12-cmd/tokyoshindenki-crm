// 工数ダッシュボードの集計（widgets/worklog-dashboard/app/aggregate.js）のテスト。Zoho には接続しない。
//   node --test tests/widget/aggregate.test.cjs
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const APP = path.join(__dirname, "..", "..", "widgets", "worklog-dashboard", "app");
const CFG = require(path.join(APP, "config.js"));
const A = require(path.join(APP, "aggregate.js"));

function raw(id, hours, date, staff, pid, pname, job, proc) {
  return {
    id, Hours: hours, "Parent_Id.Work_Date": date, "Parent_Id.Staff": staff,
    "ZP_Task.ZP_Project_Id": pid, "ZP_Task.Project_Name": pname, "ZP_Task.JOB_NO": job, "ZP_Task.Task_Name": proc
  };
}
const ROWS = [
  raw("1", 2, "2026-09-15", "八木 和明", "p1", "シンクロ 電源Box", "CV26031", "本作部品手配"),
  raw("2", 3, "2026-09-16", "八木 和明", "p2", "カジヤ 溶接機", "WB26040", "設計"),
  raw("3", 4.5, "2026-09-22", "望月 寛紀", "p2", "カジヤ 溶接機", "WB26040", "設計"),
  raw("4", 1, "2026-10-01", "望月 寛紀", "p3", "【望月 寛紀】その他工数入力用", null, "その他工数入力"),
  raw("5", 0.5, "2026-10-01", null, null, null, null, null)
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
    ["望月 寛紀", 5.5, 2], ["八木 和明", 5, 2], [A.UNKNOWN, 0.5, 1]
  ]);
  const pj = A.groupSum(ROWS, "project");
  assert.deepEqual(pj.map((g) => [g.label, g.jobNo, g.hours]), [
    ["カジヤ 溶接機", "WB26040", 7.5], ["シンクロ 電源Box", "CV26031", 2],
    ["【望月 寛紀】その他工数入力用", "", 1], [A.UNKNOWN, "", 0.5]
  ]);
  const proc = A.groupSum(ROWS, "process");
  assert.equal(proc[0].label, "設計");
  assert.equal(proc[0].hours, 7.5);
});

test("絞り込みは自分の軸を除いて掛ける", () => {
  const f = { staff: "八木 和明", project: null, process: "設計" };
  assert.deepEqual(A.applyFilters(ROWS, f, null).map((r) => r.id), ["2"]);
  assert.deepEqual(A.applyFilters(ROWS, f, "staff").map((r) => r.id), ["2", "3"]);
  assert.deepEqual(A.applyFilters(ROWS, f, "process").map((r) => r.id), ["1", "2"]);
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
  assert.deepEqual(A.totals(ROWS), { hours: 11, items: 5, staff: 3, projects: 4, days: 4 });
});
