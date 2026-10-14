# 工数ダッシュボード（ウィジェット）

工数入力（`WorkLogs`）の工数明細を集計して、CRM のホーム画面に出すウィジェット。

- **CRM は読み取りだけ**（COQL）。モジュール・項目・ワークフロー・関数は作らない・変えない・消さない。API 名も変えない
- 見るのは**開いた人の権限で見えるレコード**だけ（自分のレコードしか見えない権限の人には、自分の分だけが出る）
- 項目の整理：[`current-schema.md`](current-schema.md)

## 画面

| 部品 | 中身 |
|---|---|
| 期間 | 今月／先月／直近3か月（既定）／今年度（4月始まり）／日付の指定 |
| 絞り込み | **PJ名・工程を複数選択**できる。検索つき（全角・半角、大文字小文字、空白の違いを無視。スペース区切りの語をすべて含むもの。PJ は JOB NO でも探せる） |
| 数値のタイル | 合計工数・入力のあった日・作業担当者の数・PJ の数 |
| 期間別工数 | 縦棒（全幅）。**日・週（月曜始まり）・月**を切り替え |
| 作業担当者別工数／工程別工数 | 横棒を2列に並べる。工数の多い順。工程＝ZPタスクの**タスク名** |
| PJ名別工数 | 横棒（全幅）。「【氏名】その他工数入力用」も他の PJ と同じように並べる |

- 「リセット」で絞り込みをすべて外す（期間・日週月・グラフ／表の切り替えはそのまま）
- 絞り込みは、同じ軸の中は「または」、軸どうしは「かつ」。すべてのグラフと数値に掛かる
- 担当者・工程・PJ の棒をクリックすると、その値を絞り込みに加える（もう一度クリックで外す）。上の欄に選んでいるものが出て、×で外せる
- 絞り込みの選択肢は、期間内の明細から作る（工数の多い順・工数つき）
- どのグラフも「表」に切り替えられる（工数・構成比・明細の件数）
- 棒に重ねるとツールチップ（工数・構成比・明細の件数、PJ は JOB NO）

## ファイル

| パス | 中身 |
|---|---|
| `widgets/worklog-dashboard/plugin-manifest.json` | ウィジェットの定義 |
| `widgets/worklog-dashboard/app/config.js` | **CRM の API 名はここだけ**。項目を差し替えるときはここを直す |
| `widgets/worklog-dashboard/app/aggregate.js` | 集計（画面・SDK に依存しない） |
| `widgets/worklog-dashboard/app/main.js` | 読み込み・描画・操作 |
| `widgets/worklog-dashboard/app/sdk-loader.js` | SDK を同梱していないときだけ `live.zwidgets.com` から読む |
| `scripts/package_widget.py` | アップロード用の ZIP を `dist/worklog-dashboard.zip` に作る |
| `tests/test_widget.py`・`tests/widget/aggregate.test.cjs` | 集計・ZIP の形・API 名が config.js だけにあることのテスト |

## 読み込みのしかた

工数明細のサブフォーム（`WorkLogItems`）に COQL を投げ、親（`Parent_Id.`）とタスク（`ZP_Task.`）の項目をドット記法で一緒に取る。

```sql
select Hours, Parent_Id.Work_Date, Parent_Id.Staff, ZP_Task.ZP_Project_Id,
       ZP_Task.Project_Name, ZP_Task.JOB_NO, ZP_Task.Task_Name
from WorkLogItems
where Parent_Id.Work_Date >= '2026-10-01' and Parent_Id.Work_Date <= '2026-10-31'
order by id asc limit 200 offset 0
```

- 期間を**月ごと**に分けて取り、1か月の中は 200 件ずつページを送る
- 1か月で 2,000 件（OFFSET の上限）を超えたら、その期間を半分に分けて取り直す
- この COQL（ドット記法の WHERE・`order by id` とページ送り）は 2026-10-14 に `tsd_crm` で実機の CRM に投げて確かめた

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
