# 東京新電機様 Zoho CRM の API 連携・機能追加

東京新電機株式会社（フラッシュバット溶接機・アプセットバット溶接機の設備メーカー）の Zoho CRM と
API でつなぎ、機能を追加するためのリポジトリ。

具体的な機能・構成はこれから決める。決まったらこのファイルの「構成」に書き足す。

---

## 1. 関連リポジトリ（作業前に参照する）

| リポジトリ | 中身 | いつ見るか |
|---|---|---|
| `rkanezashi12-cmd/zoho-agri-demo` | Zoho のスキル `zoho-crm-build` の**正本** | Zoho の API を叩く前。新しい挙動を追記するとき |
| `rkanezashi12-cmd/tokyoshindenki-bom-widget` | 東京新電機様の既存の開発（Creator の部品表ウィジェット）。`HANDOVER.md` に環境情報・CRM のモジュール/項目の API 名・Deluge 関数・落とし穴がまとまっている | 東京新電機様の環境・既存の作り込みを知りたいとき |

セッションに無ければリポジトリを追加（add_repo）して clone してから読む。

### Zoho のスキル

- `.claude/skills/zoho-crm-build/SKILL.md` は正本（`zoho-agri-demo`）の**写し**。Claude Code が自動で読むためにここへ置いている。
  - Zoho の API で何かを作る・変える前に必ず読む（特に第2章「実行前ガード」と第13章「HTTP メソッド早見表」）
  - 最新にするには `scripts/sync_zoho_skill.sh`（差分の確認だけなら `--check`）。作業の始めに一度確認する
- **この写しを直接書き換えない。** 実機で確かめた新しい挙動は**正本に追記**し（手順は SKILL.md の冒頭）、
  それから `scripts/sync_zoho_skill.sh` で取り込む
- Deluge・Writer 差し込み・Analytics などの一般的な知識は claude.ai の個人スキル `zoho-deluge` にもある

## 2. 環境（tokyoshindenki-bom-widget の HANDOVER.md 時点。変わっていたら直す）

- データセンター：**日本（`.jp`）**。`accounts.zoho.jp` / `www.zohoapis.jp`
- CRM の既存のカスタムモジュール：製造番号台帳 `Machines`、定期点検結果報告書 `Inspection_Reports`、
  修理報告書 `Repair_Reports`、技術調査報告書 `Technical_Reports`（項目の API 名は HANDOVER.md の第3章）
- Zoho Creator（部品表・発注・入荷・在庫・出庫）と Zoho Projects（工程管理）も使う。3製品は製番（JOB番号）で紐付ける

## 3. ルール

1. **外部 API の仕様は記憶に頼らない。** スキル `zoho-crm-build` → 公式ドキュメントの順で確認する。
   確かめていないまま実装した箇所は `docs/unverified-apis.md` に記録する。
2. **書き込みの前に接続先の組織を確かめる**（スキル第2章の実行前ガード）。テナントの取り違えは復旧できない。
3. **お客様の本番 CRM への書き込みはユーザーの指示があるときだけ。** 既存のデータ・項目・レイアウト・ワークフローは
   ユーザーの了承なしに書き換えない。
   - **削除は絶対にしない。** モジュール（オブジェクト）・項目・レイアウト・関連リスト・ワークフロー・関数・
     レコード・選択肢の値、どれも対象。ユーザーに頼まれても API では消さず、UI での作業としてユーザーに渡す
   - **削除と同じ結果になる上書きもしない。** 選択肢の値を減らす PATCH、レイアウトから項目やセクションを外す PATCH、
     既存の値を空にする更新などは、変更前の内容と変更後の内容を示してユーザーの了承を得てから
   - 書き込みの前に、何をどう変えるか（メソッド・パス・本文）を示して了承を得る。1回の了承は、その作業にだけ有効
4. **CRM の API 名は1か所（設定ファイルなど）にまとめ、コードに散らばらせない。**
5. **秘密情報（クライアント ID・シークレット・リフレッシュトークン）はリポジトリに含めない。** `.env` は commit しない。
6. ログにトークン・個人情報を出さない。
7. Zoho の API で**実機で確かめた新しい挙動**は、正本のスキル（`zoho-agri-demo`）に追記する。
8. **東京新電機様以外の Zoho 環境には絶対に触れない。** このアカウントには他社の Zoho 環境の MCP コネクタ
   （`Kawahara_CRM_temp` など）もつながっている。Zoho への接続は **`python -m tsd_crm` だけ**を使い、
   Zoho の MCP コネクタ・`curl` などでの直接呼び出し・`tsd_crm` を通さない自作スクリプトは使わない
   （`.claude/settings.json` とフック `.claude/hooks/zoho_guard.py` で止めている。外さない）。
   `tsd_crm` が組織の不一致で中断したら、回避せずにユーザーに報告する。

## 4. 構成

| パス | 中身 |
|---|---|
| `tsd_crm/` | 東京新電機様の CRM 専用クライアント（標準ライブラリのみ）。`python -m tsd_crm --help` |
| `config/zoho_target.json` | 接続先（.jp のホスト・認証情報の環境変数名・固定した組織）。秘密情報は入れない |
| `.claude/settings.json`・`.claude/hooks/zoho_guard.py` | Zoho の MCP コネクタと Zoho への直接の呼び出しを止める |
| `tests/` | 守りのテスト（Zoho には接続しない）。`python3 -m unittest -v` |
| `docs/setup.md` | 接続の手順（Self Client・スコープ・クラウド環境の設定・組織の固定） |
| `widgets/worklog-dashboard/` | 工数ダッシュボード（ホーム画面用ウィジェット）。CRM の API 名は `app/config.js` だけ。`docs/worklog-dashboard/README.md` |
| `scripts/package_widget.py` | ウィジェットをアップロード用の ZIP（`dist/`）にまとめる |
| `crm/scoring/` | CRM訪問スコアリングで CRM に送る本文（モジュール・項目）と Deluge 関数（`functions/`）。API 名はここと `docs/scoring/README.md` だけ |
| `scripts/verify_worklog_totals.py` | 工数の数字の突き合わせ（読み取りのみ）。明細の合計を工数入力の合計工数・ZPタスクの CRM実績工数と比べる |

- 認証情報：環境変数 `TSD_ZOHO_CLIENT_ID`・`TSD_ZOHO_CLIENT_SECRET`・`TSD_ZOHO_REFRESH_TOKEN`（手元では `.env`）
- `tsd_crm` は呼ぶたびに最初に `GET /crm/v8/org` で組織を照合する。組織を固定する前は `org` 以外を拒否する。
  固定（`pin --yes`）は**ユーザーが東京新電機様の組織だと了承してから**
- 書き込みは `write ... --allow-write`（ユーザーの指示があるときだけ）。DELETE は無い
- 関数のコードの更新は `function-update <関数の id> <.dg ファイル> --allow-write`。`--allow-write` 無しなら送らずに更新先を見せるだけ。
  コードの1行目の宣言（カテゴリー・API 名）が更新先の関数と違えば中断する
- 機能が決まったら、ここに書き足す

### 機能

- **工数ダッシュボード**：工数入力（`WorkLogs`）の工数明細（サブフォーム `WorkLogItems`）を、作業担当者別・PJ名別・工程別（ZPタスクのタスク名）・期間別（日／週／月）に集計してホーム画面に出す。
  CRM は読み取りだけ。既存のワークフロー・関数が動いているため、API 名は変えない
- **CRM訪問スコアリング**（構築中）：SalesIQ の訪問の閲覧 URL をスコアリングルール（新モジュール `ScoringRules`）と照らして見込み客・担当者（`Contacts`）に点数を足し、30日訪問が無ければ減らす。
  船井総研の仕様書から「顧客タイプ区分名」「属性区分」を外したもの。手順と状況は `docs/scoring/README.md`
