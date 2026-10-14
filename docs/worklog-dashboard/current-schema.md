# 工数ダッシュボード：現在のモジュール・項目の整理

2026-10-14 時点。東京新電機様の CRM（東京新電機株式会社・org90001386318）を `python -m tsd_crm` で**読み取りだけ**して整理した。
書き込み・削除はしていない。

## 1. 関係するモジュール

| モジュール（表示名） | API 名 | 種類 | 件数 | 役割 |
|---|---|---|---|---|
| 工数入力 | `WorkLogs` | カスタム | 106 | 1人×1日の工数の入力（ヘッダ）。タブ名「工数入力」 |
| 工数明細 | `WorkLogItems` | サブフォーム（`WorkLogs` の中） | 212 | 1行＝どのタスクに何時間 |
| ZPタスク | `ZPTasks` | カスタム | 787 | Zoho Projects から同期したタスク・サブタスクのマスタ |

つながり：

```
WorkLogs（工数入力：対象日・作業担当者）
  └─ WorkLogItems（工数明細：サブフォーム）
        ├─ Parent_Id → WorkLogs
        └─ ZP_Task  → ZPTasks（プロジェクト名・工程・JOB NO）
```

集計の単位は**工数明細（`WorkLogItems`）の1行**。担当者・日付は親の `WorkLogs`、PJ・工程は `ZPTasks` から取る。

## 2. 項目

### 工数入力 `WorkLogs`（カスタム項目）

| 表示名 | API 名 | 型 | メモ |
|---|---|---|---|
| 工数入力名 | `Name` | 1行 | 主項目 |
| 入力者 | `Owner` | 所有者 | 入力した人。代理入力があり、作業担当者と違うことがある（106件中28件） |
| **対象日** | `Work_Date` | 日付 | **期間別の軸** |
| **作業担当者** | `Staff` | 選択リスト | **担当者別の軸**。選択肢：望月 寛紀／八木 和明／江藤 恵次／瀧浪 美佐子／浅井 久敬／渡邊 聖崇／佐々木 航輝／その他／岡崎 悦郎／渡邉 啓史／渡邉 眞己 |
| 工数明細 | `WorkLogItems` | サブフォーム | 下記 |
| 合計工数(h) | `Total_Hours` | 小数 | 明細の合計（全件で明細合計 814h と一致） |
| 明細件数 | `Item_Count` | 整数 | |
| 重複防止キー | `Work_Key` | 1行 | |
| 備考 | `Remarks` | 複数行 | |

### 工数明細 `WorkLogItems`（サブフォーム）

| 表示名 | API 名 | 型 | メモ |
|---|---|---|---|
| 親データID | `Parent_Id` | ルックアップ → `WorkLogs` | |
| タスク | `ZP_Task` | ルックアップ → `ZPTasks` | 全212行で入っている |
| **工数(h)** | `Hours` | 小数 | **集計する値** |
| 作業内容 | `Item_Remarks` | 1行 | |

### ZPタスク `ZPTasks`（カスタム項目）

| 表示名 | API 名 | 型 | メモ |
|---|---|---|---|
| タスク表示名 | `Name` | 1行 | 主項目 |
| **プロジェクト名** | `Project_Name` | 1行 | **PJ名別の軸** |
| JOB NO | `JOB_NO` | 1行 | 製番。「その他工数入力用」PJ は空 |
| ZPプロジェクトID | `ZP_Project_Id` | 1行 | PJ を一意に識別するならこちら |
| PJステータス | `Project_Status` | 1行 | 完了済み／進行中／開始前 |
| タスクリスト名 | `Task_List_Name` | 1行 | WB装置・CE・CV基板・修理・General など（製品・部門の区分に近い） |
| **タスク名** | `Task_Name` | 1行 | 設計・組立・調整・試運転・部品手配 など。**工程の候補**。サブタスクの行には親タスク名が入る |
| サブタスク名 | `Subtask_Name` | 1行 | 機械設計・電気設計・配線 など。タスク直下の行は空 |
| 階層区分 | `Task_Level` | 選択リスト | タスク／サブタスク |
| 階層の深さ | `Depth` | 整数 | 0＝タスク、1＝サブタスク |
| 予定工数(h) | `Planned_Hours` | 小数 | |
| CRM実績工数(h) | `Actual_Hours` | 小数 | CRM の工数入力の合計（全件で 814h、明細と一致） |
| ZP実績工数(h) | `ZP_Logged_Hours` | 小数 | Zoho Projects 側で記録した工数 |
| 開始日／終了日 | `ZP_Start_Date`／`ZP_End_Date` | 日付 | |
| 担当者名(ZP) | `ZP_Owner_Name` | 1行 | ZP 上の担当者（作業した人ではない） |
| 担当ユーザー | `Assignee` | ユーザー | **全件空** |
| 工数入力対象／有効／完了フラグ | `Is_Loggable`／`Is_Active`／`Is_Completed` | チェック | |
| ZPステータス | `ZP_Status` | 1行 | |
| その他 | `ZP_Task_Id`・`ZP_Parent_Task_Id`・`ZP_Root_Task_Id`・`ZP_Task_Prefix`・`ZP_Task_Name`・`Percent_Complete`・`Last_Synced_At`・`Actual_Updated_At`・`Sync_Note` | | 同期用 |

## 3. 4つの軸と取り元

| 見たい内容 | 取り元 | 現在のデータ（明細212行・計 814h、2026-09-15〜10-13） |
|---|---|---|
| 作業担当者別 | `WorkLogs.Staff` | 7名（八木 138h／浅井 126h／渡邊 123h／望月 122h／江藤 106h／佐々木 101h／瀧浪 98h） |
| PJ名別 | `ZPTasks.Project_Name`（＋`JOB_NO`） | 40 PJ。最大は日鉄周南 REM用アンコイラ 83h |
| 工程別 | `ZPTasks.Task_Name`（案。下記の確認事項） | 27種。その他工数入力 137h／組立 105.5h／設計 87h … |
| 期間別 | `WorkLogs.Work_Date` | 約1か月分 |

1回の COQL で4軸すべてが取れることを確かめた（読み取りのみ）：

```sql
select Hours, Parent_Id.Work_Date, Parent_Id.Staff,
       ZP_Task.Project_Name, ZP_Task.JOB_NO, ZP_Task.Task_List_Name,
       ZP_Task.Task_Name, ZP_Task.Subtask_Name
from WorkLogItems where id is not null limit 200
```

サブフォームのモジュール（`WorkLogItems`）を直接 FROM に書け、親（`Parent_Id.`）とルックアップ先（`ZP_Task.`）の項目をドット記法で取れた。

## 4. 気づいた点（ダッシュボードの設計に効くもの）

- **担当者は `Staff` を使う。** `Owner`（入力者）は代理入力で別人になっている。`ZPTasks.Assignee` は全件空。
- **「【氏名】その他工数入力用」PJ が各担当者に1つずつある**（計137h、全体の17%）。JOB NO は空。PJ名別では「その他」にまとめるか、分けて出すかを決める。
- **PJ名の表記ゆれ**：全角スペースと半角スペースが混在（例「日鉄周南　REM用アンコイラ」と「日鉄周南 REM用WF本体SV教育全込」）。別の PJ なので問題は無いが、名前で寄せる処理はしない（`ZP_Project_Id` で区別する）。
- **予定工数に極端な値**：「その他工数入力用」のタスクの予定工数が 62,112h。予実を出す場合はこれらを除く。
- 件数は今のところ少ない（明細212行）が、COQL は1回200件・OFFSET 2,000 まで。1年分（推定2,500行前後）で上限に近づくので、期間で絞って取る作りにする。

## 5. 今回読めなかったもの

接続の認可（スコープ）に含まれていないため、次は `OAUTH_SCOPE_MISMATCH` で読めなかった：

- レイアウト（`/settings/layouts`）
- ワークフロー（`/settings/automation/workflow_rules`）
- タブグループ（`/settings/tab_groups`）

ダッシュボードの作成自体には不要（ウィジェットは閲覧者の権限でレコードを読む）。既存のワークフローを確認したい場合は、スコープを足してリフレッシュトークンを取り直す。
