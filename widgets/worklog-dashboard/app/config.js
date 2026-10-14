// 工数ダッシュボードが読む CRM のモジュール・項目の API 名。ここ以外に書かない（CLAUDE.md ルール4）。
// 既存の API 名をそのまま使う。モジュール・項目は作らない・変えない（読み取りだけ）。
// 整理：docs/worklog-dashboard/current-schema.md
(function (root) {
  "use strict";

  var CONFIG = {
    // 集計の単位：工数入力（WorkLogs）のサブフォーム「工数明細」の1行
    module: "WorkLogItems",
    fields: {
      hours: "Hours",                          // 工数(h)
      workDate: "Parent_Id.Work_Date",         // 工数入力 > 対象日        … 期間別
      staff: "Parent_Id.Staff",                // 工数入力 > 作業担当者    … 担当者別
      projectId: "ZP_Task.ZP_Project_Id",      // ZPタスク > ZPプロジェクトID（PJ を区別するキー）
      projectName: "ZP_Task.Project_Name",     // ZPタスク > プロジェクト名 … PJ名別
      jobNo: "ZP_Task.JOB_NO",                 // ZPタスク > JOB NO（表示だけ）
      process: "ZP_Task.Task_Name",            // ZPタスク > タスク名     … 工程別
      task: "ZP_Task",                         // 工数明細 > タスク（ルックアップ。{name, id} で返る）… 期限超過をタスクごとにまとめる
      subtask: "ZP_Task.Subtask_Name",         // ZPタスク > サブタスク名
      taskEnd: "ZP_Task.ZP_End_Date",          // ZPタスク > 終了日       … 期限超過
      taskStatus: "ZP_Task.ZP_Status"          // ZPタスク > ZPステータス … 期限超過（完了済みの見分け）
    },
    // ZPステータスのうち「完了」とみなす値
    closedStatuses: ["Closed"],
    // 入力状況：1日の基準時間（h）
    standardHoursPerDay: 8,
    // 案件以外の割合：区分の決め方（上から順に当てはめ、どれにも当たらなければ「案件」）
    categories: {
      indirect: { label: "案件以外", processes: ["その他工数入力"], projectNameIncludes: ["その他工数入力用"] },
      presales: { label: "受注前", projectNamePrefixes: ["【受注前】"] },
      project: { label: "案件" }
    },
    // 推移の積み上げ・クロス表で色・列を分ける上位の数（残りは「その他」にまとめる）
    topN: 7,
    crossMaxCols: 12,
    // COQL：1回200件、OFFSET は 2,000 まで（スキル zoho-crm-build 第10章）
    pageSize: 200,
    maxOffset: 2000,
    // 週の始まり（1＝月曜）
    weekStartsOn: 1,
    // 年度の始まりの月（4＝4月）
    fiscalYearStartMonth: 4
  };

  root.WLD_CONFIG = CONFIG;
  if (typeof module !== "undefined" && module.exports) module.exports = CONFIG;
})(typeof window !== "undefined" ? window : globalThis);
