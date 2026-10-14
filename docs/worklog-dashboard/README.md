# 工数ダッシュボード（ウィジェット）

工数入力（`WorkLogs`）の工数明細を集計して、CRM のホーム画面に出すウィジェット。

- **CRM は読み取りだけ**（COQL）。モジュール・項目・ワークフロー・関数は作らない・変えない・消さない。API 名も変えない
- 見るのは**開いた人の権限で見えるレコード**だけ（自分のレコードしか見えない権限の人には、自分の分だけが出る）
- 項目の整理：[`current-schema.md`](current-schema.md)

## 画面

上に期間と絞り込み（すべてのタブに共通）、その下に数値のタイル、タブで5つの分析を切り替える。
「前期間」は、選んだ期間の直前の同じ日数（例：10/1〜10/14 なら 9/17〜9/30）。期間と一緒に読み込む。

| 部品 | 中身 |
|---|---|
| 期間 | 今月／先月／直近3か月（既定）／今年度（4月始まり）／日付の指定 |
| 絞り込み | **PJ名・工程を複数選択**（検索つき：全角・半角、大文字小文字、空白の違いを無視。スペース区切りの語をすべて含むもの。PJ は JOB NO でも探せる）。「リセット」ですべて外す |
| 数値のタイル | 合計工数（前期間比）／案件以外の割合（受注前も）／入力が足りない日／期限超過のタスク／作業担当者／PJ。下線のあるタイルは押すとそのタブを開く |

| タブ | 中身 |
|---|---|
| 概要・推移 | 期間別（日・週・月）。**色分け**：なし／区分／PJ名／作業担当者／工程で積み上げ（上位7つ＋その他）。担当者別・工程別（2列）、PJ名別（全幅）。表にすると前期間と増減も出る |
| ① 入力状況 | 作業担当者×日の表。1日 8h を基準に色分け（未入力・4h未満・8h未満・8h・8h超・10h超）。担当者ごとに未入力・8h未満・8h超の日数と平均。**PJ名・工程の絞り込みは掛けない**（1日の合計を見るため） |
| ② 期限超過 | ZPタスクの終了日より後に入った工数をタスクごとに。終了日・最後の入力・超過日数・超過後の工数・担当者。Projects 上で完了（Closed）なのに入力が続くものは「ZPで完了」 |
| ④ クロス分析 | PJ名×工程／担当者×PJ名／担当者×工程。値は工数か「行の中の割合」。列は工数の多い12件＋その他 |
| ⑤ 案件以外の割合 | 区分（案件・受注前・案件以外）の割合を担当者別に100%の横棒で。区分の推移（期間別の積み上げ） |

- 絞り込みは、同じ軸の中は「または」、軸どうしは「かつ」
- 担当者・工程・PJ の棒をクリックすると絞り込みに加える（もう一度で外す）。期限超過の PJ名も押すと絞り込む
- 色分けの色は、期間内の全明細で工数の多い順に決める（絞り込みで色が入れ替わらない）

### 決めごと（`app/config.js` で変えられる）

| 項目 | いまの値 |
|---|---|
| 1日の基準時間 | 8h（`standardHoursPerDay`） |
| 休日の見分け | 祝日の表は持たない。**誰も入力していない平日は休日として数えない**（2026-09-21〜23・10-12 を正しく休日と判定した）。今日以降も数えない |
| 区分 | 工程が「その他工数入力」か PJ名に「その他工数入力用」を含む → 案件以外／PJ名が「【受注前】」で始まる → 受注前／それ以外 → 案件 |
| 完了とみなす ZPステータス | `Closed` |

## ファイル

| パス | 中身 |
|---|---|
| `widgets/worklog-dashboard/plugin-manifest.json` | ウィジェットの定義 |
| `widgets/worklog-dashboard/app/config.js` | **CRM の API 名はここだけ**。項目を差し替えるときはここを直す |
| `widgets/worklog-dashboard/app/aggregate.js` | 集計（画面・SDK に依存しない） |
| `widgets/worklog-dashboard/app/ui.js` | 画面の部品（横棒・積み上げの縦棒・表・ツールチップ・凡例） |
| `widgets/worklog-dashboard/app/main.js` | 読み込み・絞り込み・タブ・各分析の描画 |
| `widgets/worklog-dashboard/app/sdk-loader.js` | SDK を同梱していないときだけ `live.zwidgets.com` から読む |
| `scripts/package_widget.py` | アップロード用の ZIP を `dist/worklog-dashboard.zip` に作る |
| `tests/test_widget.py`・`tests/widget/aggregate.test.cjs` | 集計・ZIP の形・API 名が config.js だけにあることのテスト |

## 読み込みのしかた

工数明細のサブフォーム（`WorkLogItems`）に COQL を投げ、親（`Parent_Id.`）とタスク（`ZP_Task.`）の項目をドット記法で一緒に取る。

```sql
select Hours, Parent_Id.Work_Date, Parent_Id.Staff, ZP_Task.ZP_Project_Id,
       ZP_Task.Project_Name, ZP_Task.JOB_NO, ZP_Task.Task_Name,
       ZP_Task, ZP_Task.Subtask_Name, ZP_Task.ZP_End_Date, ZP_Task.ZP_Status
from WorkLogItems
where Parent_Id.Work_Date >= '2026-10-01' and Parent_Id.Work_Date <= '2026-10-31'
order by id asc limit 200 offset 0
```

- 期間を**月ごと**に分けて取り、1か月の中は 200 件ずつページを送る
- 1か月で 2,000 件（OFFSET の上限）を超えたら、その期間を半分に分けて取り直す
- この COQL（ドット記法の WHERE・`order by id` とページ送り、ルックアップ `ZP_Task` が `{name, id}` で返ること）は 2026-10-14 に `tsd_crm` で実機の CRM に投げて確かめた
- 期間と前期間をまとめて取り、日付で分ける

## Zoho への登録（UI 作業）

ウィジェットの登録は API ではできない（スキル第12章）。管理者が画面で行う。

### 1. ZIP を作る

```bash
python3 scripts/package_widget.py --fetch-sdk   # SDK を同梱する（ネットにつながる手元の PC で）
python3 scripts/package_widget.py               # 同梱しない場合（実行時に live.zwidgets.com から読む）
```

SDK は同梱するのが確実（スキル第11章）。クラウドの作業環境からは `live.zwidgets.com` に出られなかったため、
いまの ZIP には入っていない。

### 2. ウィジェットを作る

1. 設定 → 開発者向けハブ → ウィジェット → 「ウィジェットを作成」
2. 名前：工数ダッシュボード／ホスティング：Zoho／ファイル：`dist/worklog-dashboard.zip`
3. **Index Page は `/index.html`**（`/app/index.html` にすると「Page Not Found」。スキル第11章）
4. 種類：**ホーム画面に置ける種類を選ぶ**（下の「未確認」を参照）。**種類は後から変えられない**

### 3. ホーム画面に置く

ホーム → ホーム画面のカスタマイズ → コンポーネントの追加 → ウィジェット → 「工数ダッシュボード」。
SDK を同梱しない ZIP（実行時に `live.zwidgets.com` から読む）で表示できた（2026-10-14、東京新電機様の本番 CRM）。
既定のホーム画面を全員に配るのは管理者ではできず、利用者ごとの設定になるという報告がある（未確認）。

### 未確認（登録のときに確かめる）

- ウィジェットの**どの種類**がホーム画面のコンポーネントとして選べるか
  （Zoho のヘルプには「ホーム画面にはダッシュボード・カスタムビュー・ウィジェットを置ける」とあるが、種類の名前までは確かめていない）
- ホーム画面の枠の高さは決まっていて、枠そのものはスクロールしなかった（2026-10-14、PJ名別が途中で切れた）。
  ページの中（body）をスクロールさせる作りにして、下まで届くようにした
- 確かめたら、正本のスキル（`zoho-agri-demo`）の第11章に書き足す

## 開発

```bash
python3 -m unittest -v                          # すべてのテスト（Zoho には接続しない）
node --test tests/widget/aggregate.test.cjs     # 集計だけ
```

手元で画面を見るときは、`app/` を別の場所に写し、`ZohoEmbededAppSDK.min.js` として
`ZOHO.embeddedApp.init()` と `ZOHO.CRM.API.coql()` を返す偽物を置いて `index.html` を開く。
