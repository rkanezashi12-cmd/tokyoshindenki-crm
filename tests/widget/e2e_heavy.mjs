// 工数ダッシュボードを実際のブラウザで動かす結合テスト（架空のデータ。Zoho には接続しない）
//   node tests/widget/e2e_heavy.mjs
// 確かめること：200件を超えるページ送り・1か月 2,000件超（OFFSET 上限）の期間分割で取りこぼしが無いこと、
// 合計の表示、前期間にデータが無いときの表示、絞り込み（作業担当者・工程）、リセット。Playwright が無ければ何もせず終わる（終了コード 0）。
import path from "node:path";
import { execSync } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";

let chromium;
try {
  const root = execSync("npm root -g").toString().trim();
  ({ chromium } = await import(pathToFileURL(path.join(root, "playwright", "index.mjs")).href));
} catch (e) {
  console.log("SKIP: playwright が見つかりません");
  process.exit(0);
}
const here = path.dirname(fileURLToPath(import.meta.url));
const page = "file://" + path.join(here, "..", "..", "widgets", "worklog-dashboard", "app", "index.html");
const exe = process.env.PW_CHROMIUM || "/opt/pw-browsers/chromium";

// 9月 2,450件（分割が必要）、10月 450件（ページ送り）。ID は本番と同じく文字列
const mock = () => {
  const rows = []; let id = 0;
  const add = (date, h, i) => rows.push({ id: "1377200001" + String(1000000 + (++id)), Hours: h, "Parent_Id.Work_Date": date,
    "Parent_Id.Staff": "担当" + (i % 7), "ZP_Task.ZP_Project_Id": "p" + (i % 30), "ZP_Task.Project_Name": "PJ" + (i % 30),
    "ZP_Task.JOB_NO": "J" + (i % 30), "ZP_Task.Task_Name": "工程" + (i % 9) });
  for (let i = 0; i < 2450; i++) add("2026-09-" + String(1 + (i % 30)).padStart(2, "0"), 0.5 + (i % 4) * 0.25, i);
  for (let i = 0; i < 450; i++) add("2026-10-" + String(1 + (i % 14)).padStart(2, "0"), i === 0 ? null : 1, i);
  window.__maxOffset = 0;
  window.ZOHO = { embeddedApp: { on() {}, init: () => Promise.resolve() }, CRM: { API: { coql(o) {
    const m = o.select_query.match(/>= '([\d-]+)' and .* <= '([\d-]+)' order by id asc limit (\d+) offset (\d+)$/);
    const lim = +m[3], off = +m[4];
    window.__maxOffset = Math.max(window.__maxOffset, off);
    if (off > 2000) return Promise.reject({ data: [{ code: "LIMIT_EXCEEDED", message: "offset > 2000" }] });
    const f = rows.filter((r) => r["Parent_Id.Work_Date"] >= m[1] && r["Parent_Id.Work_Date"] <= m[2]);
    const pg = f.slice(off, off + lim);
    return Promise.resolve(pg.length ? { data: pg, info: { more_records: off + lim < f.length } } : "");
  } } } };
};

const fails = [];
const eq = (name, got, exp) => { if (JSON.stringify(got) !== JSON.stringify(exp)) fails.push(`${name}: ${JSON.stringify(got)} ≠ ${JSON.stringify(exp)}`); };
const b = await chromium.launch({ executablePath: exe });
try {
  const ctx = await b.newContext({ timezoneId: "Asia/Tokyo" });
  const p = await ctx.newPage();
  await p.clock.setFixedTime(new Date("2026-10-14T10:00:00+09:00"));
  await p.addInitScript(mock);
  const errors = []; p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(page);
  await p.waitForFunction(() => /件の明細|失敗/.test(document.body.textContent), null, { timeout: 60000 });
  const r = await p.evaluate(() => ({
    status: document.getElementById("status").textContent.split("（")[0],
    total: (document.querySelector("#kpis .kpi .v") || {}).textContent || "",
    prev: (document.querySelector("#kpis .kpi .s") || {}).textContent || "",
    notice: document.getElementById("notice").textContent,
    maxOffset: window.__maxOffset
  }));
  // 9月：0.5,0.75,1,1.25 の繰り返し 2,450件 = 612.5×... を独立に計算
  let sep = 0; for (let i = 0; i < 2450; i++) sep += 0.5 + (i % 4) * 0.25;
  eq("読み込んだ件数", r.status, "2900 件の明細");
  eq("合計工数", r.total, (Math.round((sep + 449) * 10) / 10).toLocaleString("ja-JP") + "h");
  eq("OFFSET は上限未満", r.maxOffset < 2000, true);
  eq("前期間にデータが無いときの表示", r.prev.startsWith("前期間のデータなし"), true);
  eq("エラー表示なし", r.notice, "");
  if (fails.length) throw new Error("読み込みの段階で失敗");
  // 絞り込み：工程0 だけ
  await p.click("#ms-process .ms-btn");
  await p.fill("#ms-process .ms-search", "工程0");
  await p.click("#ms-process .ms-item >> nth=0");
  let p0 = 0; for (let i = 0; i < 2450; i++) if (i % 9 === 0) p0 += 0.5 + (i % 4) * 0.25;
  for (let i = 1; i < 450; i++) if (i % 9 === 0) p0 += 1;
  eq("工程0 で絞り込んだ合計", await p.evaluate(() => document.querySelector("#kpis .kpi .v").textContent),
    (Math.round(p0 * 10) / 10).toLocaleString("ja-JP") + "h");
  // 絞り込み：作業担当者（担当3）を追加。工程0 かつ 担当3
  await p.keyboard.press("Escape");
  await p.click("#ms-staff .ms-btn");
  eq("作業担当者の選択肢の数", await p.evaluate(() => document.querySelectorAll("#ms-staff .ms-item").length), 7);
  await p.fill("#ms-staff .ms-search", "担当3");
  await p.click("#ms-staff .ms-item >> nth=0");
  await p.keyboard.press("Escape");
  let ps = 0; for (let i = 0; i < 2450; i++) if (i % 9 === 0 && i % 7 === 3) ps += 0.5 + (i % 4) * 0.25;
  for (let i = 1; i < 450; i++) if (i % 9 === 0 && i % 7 === 3) ps += 1;
  eq("工程0 かつ 担当3 の合計", await p.evaluate(() => document.querySelector("#kpis .kpi .v").textContent),
    (Math.round(ps * 10) / 10).toLocaleString("ja-JP") + "h");
  eq("絞り込みの表示に作業担当者", await p.evaluate(() => document.getElementById("chips").textContent.includes("作業担当者担当3")), true);
  // 入力状況は作業担当者の絞り込みだけ掛かる（1行だけになる）
  await p.click("#tab-input");
  eq("入力状況の行（担当3だけ）", await p.evaluate(() => [...document.querySelectorAll("#body-input tbody tr th")].map((e) => e.textContent)), ["担当3"]);
  await p.click("#tab-overview");
  // リセットで作業担当者も外れる
  await p.click("#reset-filters");
  eq("リセット後の作業担当者ボタン", await p.evaluate(() => document.querySelector("#ms-staff .ms-value").textContent), "すべて");
  eq("画面のエラー", errors, []);
} catch (e) {
  if (!fails.length) throw e;
} finally {
  await b.close();
}
if (fails.length) { console.error("NG\n" + fails.join("\n")); process.exit(1); }
console.log("OK: 結合テスト（2,900件・分割・ページ送り・絞り込み）");
