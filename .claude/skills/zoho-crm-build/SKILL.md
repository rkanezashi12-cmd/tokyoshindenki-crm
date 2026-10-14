---
name: zoho-crm-build
description: 設計書から Zoho CRM 一式を API で構築するときに必ず参照する。モジュール・項目・レイアウト・関連リスト・タブグループ・Deluge関数・ワークフロー・レコード/Bulk Write・ウィジェットJS SDK の実測リファレンス。「CRMをAPIで構築」「デモ環境構築」「モジュール作成」「項目作成」「タブグループ」「関数作成」「ワークフロー登録」「Bulk Write」「COQL」「ウィジェット」に触れたら参照する。「その操作は API 非対応」と結論しそうなときも必ず先に確認すること。
---

# Zoho CRM ／ API v8 実測リファレンス

設計書から CRM 一式（モジュール・項目・レイアウト・自動化・データ・ウィジェット）を
API で構築した際に実際に叩いた全リクエスト。公式ドキュメントに載っていない挙動を
実機で確認した結果のみを載せている。

## AI への指示：この文書の使い方

- この文書は**実測値のみ**で構成されている。ここに書かれた形と違う推測でリクエストを組み立てないこと。
- 各エンドポイントの「落とし穴」は必ず読むこと。多くは 400 / 500 の直接原因である。
- **書き込み系の前に必ず「実行前ガード」を通すこと（第2章）。** テナント取り違えは復旧できない。
- ここに載っていない API は存在しないと考えるのではなく「未検証」として扱い、
  当て推量の POST を繰り返さず利用者に UI での参照作成を依頼すること（第12章）。
- **作成・更新の前に第13章末尾の「HTTP メソッド早見表」を必ず見ること。規則性が無い。**
- 数百件を超える投入・更新は必ず Bulk Write（第10章）を使うこと。レコード API のループは API クレジットを浪費する。
- プレースホルダは `{module}`＝モジュール API 名、`{dc}`＝データセンター（in/com/jp/eu 等）、
  `{...}`＝実行時に取得する ID。

## この文書の更新（どのプロジェクトからでも）

- **正本は GitHub `rkanezashi12-cmd/zoho-agri-demo` の `.claude/skills/zoho-crm-build/SKILL.md`**。
  claude.ai の個人スキルとして登録したものは、この正本の ZIP をアップロードした写し。
- どのプロジェクトの作業中でも、Zoho の API で**実機で確かめた新しい挙動**（成功した形・エラーの原因・落とし穴）が
  出たら、この文書に追記する。
  1. 作業中のセッションに `zoho-agri-demo` が無ければ、リポジトリを追加（add_repo）して clone する
  2. 該当章に追記する。**推測は書かない**（確かめていないものは第12章「未確定」へ）。末尾の日付を更新する
  3. そのセッションの作業ブランチに commit・push し、利用者に PR の作成を提案する
  4. 利用者に「claude.ai の個人スキルも ZIP で差し替えてください」と伝え、ZIP を作って渡す
     （`cd .claude/skills && zip -r zoho-crm-build.zip zoho-crm-build`）

## 目次

| 章 | 内容 |
|---|---|
| 1 | 前提とスコープ |
| 2 | 認証と実行前ガード ★最重要 |
| 3 | モジュール |
| 4 | 項目 |
| 5 | レイアウト |
| 6 | 関連リスト |
| 7 | タブグループ |
| 8 | 関数（Deluge） |
| 9 | 自動化・ワークフロー |
| 10 | レコードと Bulk Write |
| 11 | ウィジェット JS SDK |
| 12 | 未確定・API 非対応 ★計画時に必読 |
| 13 | 全リクエスト早見表（42本）＋ HTTP メソッド早見表 |

---

## 1. 前提とスコープ

### ホスト（DC 依存）

データセンターによりホストが変わる。ここを間違えると全リクエストが 401 になる。
CRM にログインしたときの URL が `crm.zoho.in` なら `{dc}` は `in`。

| 用途 | ホスト |
|---|---|
| OAuth | `https://accounts.zoho.{dc}` |
| CRM API | `https://www.zohoapis.{dc}` |
| Bulk Write のアップロード | `https://upload.zoho.{dc}/crm/v8/upload` |
| Self Client 作成 | `https://api-console.zoho.{dc}` |

サンドボックスやクラウド VM から実行する場合、外向き通信の許可が要るホストは
`accounts.zoho.{dc}` / `www.zohoapis.{dc}` / `upload.zoho.{dc}` の3つ。
ウィジェット SDK を ZIP に同梱するなら `live.zwidgets.com` も要る。

### Self Client のスコープ

**スコープは認可コード発行時に固定され、後から追加できない**（再発行が必要）。以下を一度で入れる。

```
ZohoCRM.org.READ,
ZohoCRM.settings.ALL,
ZohoCRM.settings.modules.ALL,
ZohoCRM.settings.fields.ALL,
ZohoCRM.settings.layouts.ALL,
ZohoCRM.settings.related_lists.ALL,
ZohoCRM.settings.custom_views.ALL,
ZohoCRM.settings.functions.ALL,
ZohoCRM.settings.workflow_rules.ALL,
ZohoCRM.settings.automation_actions.ALL,
ZohoCRM.settings.roles.ALL,
ZohoCRM.settings.profiles.ALL,
ZohoCRM.users.ALL,
ZohoCRM.modules.ALL,
ZohoCRM.coql.READ,
ZohoCRM.bulk.ALL,
ZohoFiles.files.ALL
```

★ `ZohoCRM.functions.ALL` は「作成済み関数を外部から**実行する**」ためのもので、関数の**作成には使えない**。
作成は `ZohoCRM.settings.functions.ALL`。命名が紛らわしく、混同すると権限エラーの原因が掴めなくなる。

#### 構築後に動かすバックエンド用（レコードの読み書きだけ）の最小スコープ（実測）

構築用の上のスコープとは別に、運用で動かすバックエンドには Self Client を分けて次だけを渡した。
カスタムモジュールのレコードの読み書き・COQL・標準モジュールの読み取り・項目設定の読み取りが通った（2026-09、US DC の本番組織）。

```
ZohoCRM.modules.custom.ALL, ZohoCRM.modules.accounts.READ, ZohoCRM.modules.contacts.READ,
ZohoCRM.modules.deals.READ, ZohoCRM.coql.READ, ZohoCRM.users.READ,
ZohoCRM.settings.modules.READ, ZohoCRM.settings.fields.READ, ZohoCRM.org.READ
```

- カスタムモジュールのレコードの取得・更新は `ZohoCRM.modules.custom.ALL` で足りる（`ZohoCRM.modules.ALL` は要らない）
- ★スコープが足りない API を呼ぶと **HTTP 401、`code: OAUTH_SCOPE_MISMATCH`**。アクセストークンを取り直しても直らない
  （リフレッシュトークンに付いたスコープの問題）。スコープを足して認可コードから発行し直す。
  構築用のトークンを流用したバックエンドで、カスタムモジュールのレコード取得がこれで失敗した
- 保存する前に、スコープごとに読み取りの API を1本ずつ試すと取り違えに気づける（件数・COQL・設定の GET など）

---

## 2. 認証と実行前ガード ★最重要

### POST `accounts.zoho.{dc}/oauth/v2/token`（初回のみ）

- 用途：認可コード → リフレッシュトークン
- 形式：`application/x-www-form-urlencoded`
- Body：`grant_type=authorization_code` / `client_id` / `client_secret` / `code`
- **認可コードの有効期限は既定10分。** 取得したらすぐに交換する。

### POST `accounts.zoho.{dc}/oauth/v2/token`（毎回）

- 用途：リフレッシュトークン → アクセストークン
- Body：`grant_type=refresh_token` / `refresh_token` / `client_id` / `client_secret`
- 短時間に連続して叩くと `You have made too many requests continuously` が返る。
  **アクセストークンはプロセス内でキャッシュし、失敗時はバックオフして再試行すること。**
  スクリプトを細かく分けて何度も実行すると、この制限に当たる。
- ★**失敗しても HTTP 200 が返る**（本文が `{"error": "invalid_client"}` など）。
  HTTP ステータスではなく、本文に `access_token` があるかで成否を判定する。

### GET `/crm/v8/org` — 実行前ガード

- スコープ：`ZohoCRM.org.READ`
- 返り値：`org[0]` に `id` / `domain_name` / `zgid` / `company_name` / `time_zone` / `currency`

★「組織 ID」と呼ばれる値は3種類あり、すべて別物。1つだけで照合すると意味を誤解したまま進む。

| キー | 内容 |
|---|---|
| `id` | API 内部の数値 ID（19桁。2組織で確認） |
| `domain_name` | ログイン画面に出る組織ドメイン（既定は `org` ＋数字。`monodemo2` のような独自の名前にもできる） |
| `zgid` | 数値。`domain_name` が既定の形なら `org` を除いた値と同じだが、**独自の名前にした組織では一致しない**。**Bulk Write の `X-CRM-ORG` には GET の `zgid` をそのまま渡す** |

**必須**：書き込み系の前に必ず org を照合すること。
`id` / `domain_name` / `company_name` の3点を突き合わせ、1つでも違えば即座に中断する。
認証情報の取り違えは他テナントの破壊につながり、復旧できない。
あわせて**「認証情報の既定パス」を作らないこと**。接続先を明示しないと動かない状態にする。

**確認**：`time_zone` と `currency` は着手前に必ず確認する。
スケジュール関数の実行時刻、日時項目、通貨項目すべてに影響し、項目を作った後の変更は影響範囲が広い。

### 自前の Web アプリに「Zoho でログイン」を付ける（実測 2026-10-02）

CRM のユーザーだけが使える画面を作るときの形。US DC の本番組織で、CRM のユーザーがログインできた。

- API コンソールで「Server-based Applications」のクライアントを作る。**Authorized Redirect URIs は戻り先の URL と完全に一致させる**
  （Homepage URL と同じ値を入れてしまう取り違えが起きやすい）
- 認可：`GET https://accounts.zoho.{dc}/oauth/v2/auth?scope=ZohoCRM.users.READ,ZohoCRM.org.READ&client_id=…&response_type=code&access_type=online&redirect_uri=…&state=…`
- 交換：`POST https://accounts.zoho.{dc}/oauth/v2/token`（`grant_type=authorization_code`・`client_id`・`client_secret`・`redirect_uri`・`code`）。
  成否は本文の `access_token` の有無で見る（上の節のとおり、失敗も HTTP 200 のことがある）
- 本人の確認：**本人の**アクセストークンで `GET /crm/v8/users?type=CurrentUser` → `users[0]`（`id`・`full_name`・`email`・`status`）と
  `GET /crm/v8/org` → `org[0].id`。org の `id` を自分のバックエンドが接続している組織と突き合わせる。スコープは上の2つで足りた
- `access_type=online` ではリフレッシュトークンは出ない。確認に1回使って捨てればよい（保存しない）

---

## 3. モジュール

```
GET  /crm/v8/settings/modules            全モジュール一覧。既存確認と id の取得
GET  /crm/v8/settings/modules/{module}   単一モジュールの詳細確認
POST /crm/v8/settings/modules            作成（ZohoCRM.settings.modules.CREATE）
```

一覧の返り値：`api_name` / `id` / `plural_label` /
`generated_type`（`default` / `custom` / `webtab_widget` / `linking` / `subform`）

Web タブは `generated_type: "webtab_widget"` で、`api_name` は `WebTab1` のような連番になる。
タブグループに追加するときはこの名前を使う。

```json
{
  "modules": [{
    "plural_label": "表示名（複数形）",
    "singular_label": "表示名（単数形）",
    "api_name": "ApiName",
    "profiles": [{ "id": "<profile_id>" }],
    "display_field": { "field_label": "主フィールド名", "data_type": "text" }
  }]
}
```

### 落とし穴

- `api_name` に**アンダースコアは使えない**。連結表記にする（`OrderLines`）。
- `profiles` は必須。`GET /crm/v8/settings/profiles` で先に取得する。
- ラベルは**日本語が通る**（中黒を含んでも可）。ドキュメントの「letters, numbers, spaces のみ」は実態と異なる。
- `Events` `Calls` `Tasks` `Cases` `Solutions` `Vendors` `Quotes` `Invoices` は標準モジュールで予約済み。
- `display_field` で作られる主項目の API 名は **`Name`**（表示名は `display_field.field_label`、文字数 120）。

---

## 4. 項目

```
GET   /crm/v8/settings/fields?module={module}            項目一覧。api_name → id、選択肢の実値確認
POST  /crm/v8/settings/fields?module={module}            作成（ZohoCRM.settings.fields.CREATE）
PATCH /crm/v8/settings/fields/{field_id}?module={module}  更新
```

```json
{ "fields": [
  { "field_label": "表示名", "api_name": "Api_Name",
    "data_type": "text", "length": 100, "required": false },
  { "data_type": "picklist",
    "pick_list_values": [{ "display_value": "値", "actual_value": "値" }] },
  { "data_type": "lookup",
    "lookup": { "module": { "api_name": "TargetModule" },
                "display_label": "参照先に出る関連リスト名" } },
  { "data_type": "autonumber",
    "auto_number": { "start_number": 1, "prefix": "ABC-" } },
  { "data_type": "currency", "decimal_place": 0 },
  { "data_type": "double", "decimal_place": 6 },
  { "data_type": "textarea", "length": 2000, "textarea": { "type": "small" } },
  { "data_type": "textarea", "length": 32000, "textarea": { "type": "large" } },
  { "data_type": "website" },
  { "data_type": "text", "length": 255, "unique": { "case_sensitive": false } },
  { "data_type": "userlookup" },
  { "data_type": "multiselectlookup",
    "multiselectlookup": {
      "connected_details": { "module": { "api_name": "Target" },
                             "field": { "field_label": "逆参照の項目名" } },
      "linking_details": { "module": { "plural_label": "LinkModuleName" } } } }
] }
```

### 落とし穴

- **1リクエスト5項目まで。**
- `api_name` は**明示指定できる**。ドキュメントは「ラベルから自動生成」としか書いていないが、渡せば尊重される。
  日本語ラベル＋英語 API 名を1回で両立できる。
- `lookup` は `lookup.display_label` が**必須**。欠けると `MANDATORY_NOT_FOUND` で**バッチ5件全体が 400** になる。
- ★**400 が返っても一部は作成されていることがある。** 失敗時は必ず現物を GET して確認する。
  件数だけで判断すると、再試行で `DUPLICATE_DATA` が出て混乱する。
- ★★**一部だけ失敗すると HTTP 207** が返り、行ごとの `status` が `success` / `error` になる（成功した行は作成される）。
  **HTTP ステータスだけで成否を判定すると失敗を見落とす**（実害：重複不可の1項目だけ作られていないのに「作成済み」と表示した）。
  行ごとの `status` を必ず見る。行は送った順に並び、`details.json_path`（例 `$.fields[4].unique.case_sensitive`）で原因の場所が分かる。
- 重複不可は `"unique": {"case_sensitive": false}` だけ受け付ける。`true` は `INVALID_DATA`（`supported_values: [false]`）。
- 作成後の GET では `length`・`textarea.type`・`unique` がそのまま返るので、作成後の突き合わせに使える。
  返った文字数：主項目 120、URL（`website`、文字数を指定せず作成）450、複数行（小）2000・（大）32000。
- `Notes` は予約語で `api_name` に使えない（`RESERVED_KEYWORD_NOT_ALLOWED`）。
- `autonumber` のゼロ埋め桁数は API で指定できない（prefix と開始番号のみ）。
- ★**複数選択ルックアップ（`multiselectlookup`）の実物**（2026-10-02、別の本番組織で上の形で作成。スコープは
  `settings.modules.ALL`・`settings.fields.ALL`・`settings.profiles.READ`・`org.READ`）
  - **`linking_details.module.plural_label` は使われなかった。** 中間モジュールの表示名は Zoho が
    「<親モジュールの表示名> X <参照先の表示名>」で付け（例「商談記録 X 顧客担当者」。連絡先の表示名を「顧客担当者」に変えている組織）、
    **API 名は表示名から英数字以外を除いたもの（例 `X`）**になった。中間モジュールの名前・API 名は当てにせず、作成後の項目の設定から読む
  - `connected_details.field.field_label` は使われ、参照先に逆向きの複数選択ルックアップ（API 名は自動。例 `field3`）と関連リストができた
  - 作成後の `GET /settings/fields?module={親}`（`data_type: multiselectlookup`、`length: 200`）の `multiselectlookup`：

    ```json
    { "linking_details": {
        "module": { "plural_label": "商談記録 X 顧客担当者", "api_name": "X", "visibility": 2, "id": "…" },
        "lookup_field": { "api_name": "field3", "field_label": "商談記録", "id": "…" },
        "connected_lookup_field": { "api_name": "field3_1", "field_label": "先方担当者（連絡先）", "id": "…" } },
      "connected_details": {
        "module": { "api_name": "Contacts", "plural_label": "顧客担当者", "id": "…" },
        "field": { "api_name": "field3", "field_label": "商談記録", "id": "…" },
        "layouts": [{ "api_name": "Standard__s", "id": "…" }] } }
    ```

    `lookup_field` は中間モジュールの「親」へのルックアップ、`connected_lookup_field` は「参照先」へのルックアップ。
    レコードに書くときは `connected_lookup_field.api_name` を使う（第10章）
  - 親のレコードの画面では関連リストとして出て、その表示名は **`relatedlist`**（項目の表示名にはならない）

### 項目更新（PATCH）

用途：選択肢の表示名・並び順・確度の変更など

```json
{ "fields": [{ "pick_list_values": [
    { "id": "...", "actual_value": "...", "display_value": "...",
      "sequence_number": 1, "probability": 10 }
]}] }
```

- **PUT は `INVALID_REQUEST_METHOD`。PATCH を使う。**
- 既存データがある選択肢を作り直すとレコード移行が要る。
  `actual_value` を変えず `display_value` だけ差し替えると、**移行ゼロで表示名を変えられる**。

> ★商談のステージ構成（ステージ名・確度）を変えたい場合、パイプライン API の構造は未確定（第12章）。
> **未設定の組織では、この PATCH で `Stage` 選択肢を直接編集するのが確実な方法。**

---

## 5. レイアウト

```
GET   /crm/v8/settings/layouts?module={module}             layout_id の取得、セクション構成の確認
PATCH /crm/v8/settings/layouts/{layout_id}?module={module}  セクションの作成・改名、項目の移動
```

`layout_id` は検証ルール・レイアウトルール・パイプラインのクエリでも必要になる。最初に取得しておく。

```javascript
// 新規セクションを作り、項目を入れる
{ "layouts": [{ "sections": [{
    "display_label": "セクション名",
    "fields": [{ "id": "<field_id>" }]
}] }] }

// 既存セクションに追加／改名は id を指定
{ "layouts": [{ "sections": [{
    "id": "<section_id>", "display_label": "新しい名前"
}] }] }
```

### 落とし穴

- 変更するセクションだけ送ればよい（全体を送る必要はない）。
- 項目の操作は1リクエスト5件まで。既存セクションに追加するときは `id` 必須。
- ★**項目を新しいセクションに入れると元のセクションから移動する**（コピーではない）。

---

## 6. 関連リスト

```
GET /crm/v8/settings/related_lists?module={module}        一覧
GET /crm/v8/settings/related_lists/{id}?module={module}    個別（表示列が見られる）
PUT /crm/v8/settings/related_lists?module={module}         並び順・表示列の変更
```

一覧の返り値：`id` / `api_name`（`relatedlist`, `relatedlist1`…）/ `display_label` /
`sequence_number`（文字列）/ `type` / `customize_fields`
個別 GET では上記に加えて `module`（子モジュール）と `fields[]`（表示列）。

```javascript
// 並び順
{ "related_lists": [{ "id": "...", "sequence_number": 20 }] }

// 表示列（api_name は「子モジュール側」の項目）
{ "related_lists": [{ "id": "...", "fields": [
    { "api_name": "Field_A", "id": "...", "sequence_number": 1 }
]}] }
```

### 落とし穴

- **一覧 GET には `fields`（表示列）が含まれない。** 列を見るには個別 GET が必要。
- `sequence_number` は**文字列で返る**。比較や加算の前に `int()` する。
- **PATCH は不可。PUT を使う。** 成功時は HTTP 207 で行ごとに結果が返る。
- ★**ルックアップから自動生成された関連リストは、既定で Name と Email しか表示されない。**
  実用に耐えないので必ず列を設定する。
- `sequence_number` には上限があり、超えると `NOT_ALLOWED: Max number allowed is N`。
- 指定した列の後ろに既定列が残ることがある。

---

## 7. タブグループ

```
GET  /crm/v8/settings/tab_groups        一覧
POST /crm/v8/settings/tab_groups        作成
PUT  /crm/v8/settings/tab_groups/{id}   更新（モジュールの追加・削除）
GET  /crm/v8/settings/profiles          profile_id の取得
GET  /crm/v8/users?type=AllUsers        ownerlookup / userlookup 用のユーザー ID
```

返り値：`id` / `name` / `default` / `visible` / `profiles[]` / `modules[]`。
`id: "0"` の All Tabs が既定グループ。ここに載っているモジュール＝タブとして存在するもの。

```json
{ "tab_groups": [{
    "name": "GroupName",
    "modules": [{ "api_name": "...", "id": "..." }],
    "profiles": [{ "id": "..." }]
}] }
```

### 落とし穴

- **名前に非 ASCII 文字は使えない**（`INVALID_DATA: Name should not contain …`）。日本語名は UI で付ける。
- `Feeds` は全グループに自動付与されるが、**入力に含めると `NOT_ALLOWED`**。payload から除外する。
  **PUT で GET の結果をそのまま送り返すとこれを踏む。**
- ★**Administrator 以外のプロファイル割当は反映されない。** HTTP 200 が返るのに `profiles` に入らない。
  UI か、ユーザー API の既定タブグループで対応する。

---

## 8. 関数（Deluge）

### ★前提：組織で最初の1本は UI でしか作れない

API で作ろうとすると `CANNOT_PROCESS: initial function creation is restricted to administrators`。
**着手前に、設定 → 開発者スペース → 関数 で中身が空の関数を1本作ってもらうこと。** 以降は API で流せる。
クライアント環境で構築する場合、この依頼を最初のチェックリストに入れる。

```
GET  /crm/v8/settings/functions        既存関数の一覧と id 取得（冪等判定に使う）
POST /crm/v8/settings/functions        作成（ZohoCRM.settings.functions.CREATE）
PUT  /crm/v8/settings/functions/{id}   コードと説明の更新
```

作成・更新とも **`multipart/form-data`**。パートは `metadata`（テキスト＝JSON 文字列）と `code`（ファイル＝`.ds`）。

```json
// metadata パートの中身
{ "functions": [{
    "name": "fn example",
    "api_name": "fn_example",
    "runtime": "Deluge 1.0",
    "category": "Automation",
    "description": "..."
}] }
```

`category` は `Button` / `Automation` / `Schedule` / `Related List` / `Standalone` / `Validation Rule`。

```javascript
// code パート（.ds）の1行目はカテゴリ付きの宣言
void automation.fn_example(String rec_id) { ... }
void schedule.fn_nightly() { ... }
```

### 落とし穴

- 関数宣言は「**関数名を小文字化しスペースを `_` に置換したもの**」＋カテゴリ名前空間。
- Deluge は作成と同時に**自動 publish** される（Java / Node / Python は publish オブジェクトが要る）。
- 更新は **PATCH は `INVALID_REQUEST_METHOD`。PUT を使う。**
- 更新の payload から **`api_name` を外すこと**（`NOT_ALLOWED: Api name update is not allowed`）。

### API 構築時に踏んだ Deluge の罠

| 症状 | 原因と対処 |
|---|---|
| `Improper Statement` | `{"k": v}` は Map ではなく **List リテラル**。`Map()` + `put()` で組む |
| `Operator >= is not valid for TEXT expression` | テキスト型に比較演算子は使えない。`"yyyy-MM"` の比較は `replaceAll("-","").toLong()` で数値化する |
| COQL が使えない | `zoho.crm.coql()` は**存在しない**。Connection を作り `invokeurl` で `/crm/v8/coql` を叩く。必要スコープは `ZohoCRM.coql.READ` |
| `while` が動かない | 使えない。固定リストの `for each` + `break` でページングする |
| ワークフローが起動しない | `createRecord` / `updateRecord` は trigger 省略時に**起動しない**（REST とは逆）。Map の `"trigger"` キーに List を入れて渡す |
| レコードが取れず null | `getRecordById` は `{"approved":"both"}` を付けないと承認待ちレコードを返さない |

### Deluge から外部 API（自前のバックエンドなど）を呼ぶ（実測）

- `invokeurl` に `parameters: <Map>.toString()` と、`Content-Type: application/json` と独自ヘッダー（例 `X-API-Key`）を入れた
  Map を `headers` に渡すと、JSON 本文として届く（FastAPI でそのまま受け取れた）
- `detailed:true` を付けると応答が Map になり、`responseCode`（数値。`!= 200` で比べられる）と
  `responseText`（本文の文字列。`.toString().toMap()` で読める）が取れる。HTTP エラーの判定に使う
- ワークフローから呼ぶ関数の引数（`String rec_id`）に、画面で「<モジュール> Id」を割り当てると、レコード ID が文字列で届く
- API キーなどは CRM の変数に置き、`zoho.crm.getOrgVariable("<API 名>")` で読む。コードとログには出さない
- `zoho.crm.getRecordById` で読んだ日時項目（datetime）を `toString()` して外部 API に渡すと、タイムゾーン込みの正しい時刻として
  読めた（開始日時 18:00 の記録で、UTC で動く外部のサーバーが日本時間 18:00 として解釈した。オフセット付きの文字列で取れている）

---

## 9. 自動化・ワークフロー

★**関数もタスクも associative アクション。** 先にアクションとして登録し、その ID をワークフローから参照する
**2段構え**になる。Deluge 関数の ID をワークフローに直接渡しても通らない。

### 手順1-a：Deluge 関数を「アクション」として登録

```
POST /crm/v8/settings/automation/functions
```

```json
{ "functions": [{
    "name": "アクション名",
    "description": "...",
    "module": { "api_name": "{module}", "id": "..." },
    "language": "deluge",
    "feature_type": "workflow",
    "function": { "id": "<Deluge関数のID>" }
}] }
```

- ★`feature_type: "workflow"` が無いと `INTERNAL_ERROR` (500) になる。**必須項目として報告されないので気づきにくい。**
- ★★**引数マッピングは API で設定できない。レスポンスにも出ない。**
  未設定だと関数が record id を受け取れず、**黙って何もせず終了する**。作成後に UI で確認・設定が要る。
  自動構築の完了報告にこれを含めないと、デモ本番で「何も起きない」事故になる。

### 手順1-b：タスク生成アクションの登録

```
POST /crm/v8/settings/automation/tasks
```

```json
{ "tasks": [{
    "name": "アクション名",
    "module": { "api_name": "{module}", "id": "..." },
    "feature_type": "workflow",
    "field_mappings": [
      { "field": { "api_name": "Subject", "id": "..." },
        "type": "static", "value": "件名" },
      { "field": { "api_name": "Due_Date", "id": "..." },
        "type": "execution_time",
        "value": { "period": "days", "unit": "7",
                   "trigger_field": "${!{module}.Created_Time}", "sign": "plus" } }
    ]
}] }
```

- 日付項目は `static` ではなく **`execution_time` のみ**。
- `field.id` は `GET /crm/v8/settings/fields?module=Tasks` で取得する。

### 手順2：ルール本体

```
POST /crm/v8/settings/automation/workflow_rules
```

```json
{ "workflow_rules": [{
  "name": "ルール名",
  "description": "...",
  "module": { "api_name": "{module}", "id": "..." },
  "execute_when": {
    "type": "create_or_edit",
    "details": { "trigger_module": { "api_name": "{module}", "id": "..." },
                 "repeat": true }
  },
  "conditions": [{
    "sequence_number": 1,
    "criteria_details": {
      "criteria": { "group_operator": "and", "group": [{
          "comparator": "equal",
          "field": { "api_name": "Status", "id": "..." },
          "type": "value", "value": "確定" }] },
      "relational_criteria": null
    },
    "instant_actions": { "actions": [
      { "type": "functions", "id": "<アクションID>" },
      { "type": "tasks",     "id": "<アクションID>" }
    ] }
  }]
}] }
```

- `execute_when.type` は `create` / `edit` / `create_or_edit` / `field_update`。**edit 系では `repeat` が必須。**
- 条件なしの場合は `"criteria": null`。
- ★`id` に Deluge 関数の ID を直接渡すと `This given actionid seems to be invalid`。必ず**アクション ID** を渡す。

### 確認系

```
GET /crm/v8/settings/automation/workflow_rules        一覧（条件もアクションも返さない）
GET /crm/v8/settings/automation/workflow_rules/{id}   ★構造の確認に最も有効
GET /crm/v8/settings/automation/functions?module=     登録済み関数アクション一覧（冪等判定）
GET /crm/v8/settings/automation/tasks?module=         登録済みタスクアクション一覧（冪等判定）
```

UI で1本作って個別 GET を読むと、組み立て方が確定する。構造が分からないときはまずこれ。

---

## 10. レコードと Bulk Write

### COQL

```
POST /crm/v8/coql        スコープ: ZohoCRM.coql.READ
Body: {"select_query": "SELECT ... FROM {module} WHERE ... LIMIT n OFFSET m"}
```

- **WHERE 句は必須。** 全件なら `where id is not null`。
- 1回 200 件、**OFFSET 上限 2,000**。それ以上は Bulk Read へ。
- **JOIN 不可。** 2階層までのドット記法は可。
- ★2階層参照は `"Parent.Field"` という**平坦なキー**で返る（ネストしたオブジェクトではない）。
  `row.Parent.Field` と書くと**エラーも出ずに空になる**。
- ルックアップ項目そのものは `{name, id}` の辞書で返る。
- 該当0件のときは **HTTP 204（本文なし）**。
- 日本語の部分一致 `where (Account_Name like '%アイシン%' or …)` は動いた（2026-10-02、実測）。
  or を3つ以上つなぐときは、2つずつかっこでくくった `((A or B) or (C or D))` の形で動かしている（くくらない形は未確認）

### レコード API

```
GET /crm/v8/{module}/actions/count       ★件数のみ取得。検証はこれが最も安い
GET /crm/v8/{module}?fields=A,B&per_page=200&page=N   項目を絞った一覧。info.more_records で継続判定
```

**全件 GET のページングで数えないこと。クレジットの無駄。**

```
PUT /crm/v8/{module}/{id}      Body: {"data": [{...}], "trigger": []}   1件の更新（実測）
```

- `"trigger": []` を付けると、条件に合うワークフロー（「作成または編集」・繰り返し実行）も起動しなかった。
  バックエンドからの書き戻しで、ワークフロー → 関数 → バックエンド の再発火を防げる
- ★存在しないモジュール API 名で GET すると **HTTP 400、`code: INVALID_MODULE`**。
- ★**複数選択ルックアップへの書き込み**（2026-10-02、実測）：親のレコードの作成で
  `{"<複数選択ルックアップの API 名>": [{"<linking_details.connected_lookup_field.api_name>": {"id": "<参照先のレコード ID>"}}]}`。
  3件を1回の作成で紐づけられた。スコープは `ZohoCRM.modules.custom.ALL` と参照先の `READ`（`ZohoCRM.modules.contacts.READ`）で足りた。
  中間モジュールは `GET /settings/modules` に `generated_type: linking` で出て、`GET /settings/fields?module=<中間>` には
  親と参照先へのルックアップが2つ出る（`ZohoCRM.settings.modules.READ`・`settings.fields.READ` で読めた）
  カスタムモジュールの API 名にアンダースコアは入らない（`Meeting_Records` ではなく `MeetingRecords`。第3章）

### Bulk Write（数百件を超える投入・更新はこれ）

レコード API は 100 件/リクエスト。900 件なら 9 コール必要だが、Bulk Write は件数に関係なく 3〜4 コールで済む。

```
POST https://upload.zoho.{dc}/crm/v8/upload
     形式:   multipart/form-data、パート名 file、中身は CSV を入れた ZIP
     ヘッダ: Authorization: Zoho-oauthtoken …
             feature: bulk-write
             X-CRM-ORG: {zgid}
     返り値: details.file_id
     スコープ: ZohoFiles.files.ALL
```

★`X-CRM-ORG` は数値の `org_id` ではなく **`zgid`**。
間違えると**本文が空の 400** が返り、原因が分からない。

```
POST /crm/bulk/v8/write
```

```json
{ "operation": "update",         // insert | update | upsert
  "resource": [{
    "type": "data",
    "module": { "api_name": "{module}" },
    "file_id": "...",
    "find_by": "id",             // リソース単位
    "field_mappings": [
      { "api_name": "id", "index": 0 },
      { "api_name": "Lookup_Field", "index": 1, "find_by": "id" },
      { "api_name": "Picklist_Field", "index": 2 }
    ]
  }] }
```

- ★★**パス順は `/crm/bulk/v8/write`。`/crm/v8/bulk/write` だと `INVALID_REQUEST_METHOD`。**
- `find_by` は**リソース単位とルックアップ項目の両方**に必要。
  ただし選択肢やテキスト項目に付けると `INVALID_FIELD_NAME`。付ける対象を選別すること。
- ZIP には**ディレクトリエントリを含める**。珍しい拡張子は弾かれることがある。

```
GET /crm/bulk/v8/write/{job_id}
    返り値: status → ADDED → INPROGRESS → COMPLETED
```

非同期。投入直後は `ADDED`。数十秒待ってから確認する。

---

## 11. ウィジェット JS SDK

### ★最重要：SDK の URL

正しい URL は `https://live.zwidgets.com/js-sdk/1.2/ZohoEmbededAppSDK.min.js`。
**`live.zohocdn.com` は誤り。** 読み込めないと `ZOHO` が未定義になり `ZOHO.embeddedApp.on` で例外が飛ぶ。
結果、**画面が「読み込み中」のまま無言で固まる。**
14KB で自己完結しているので **ZIP に同梱するのが確実。**

### 主な呼び出しと注意点

| 呼び出し | 注意点 |
|---|---|
| `ZOHO.embeddedApp.on("PageLoad", fn)` / `ZOHO.embeddedApp.init()` | 関連リスト型は `data.EntityId` に親レコード ID が入る。**Web タブ型では入らない** |
| `ZOHO.CRM.API.getRecord({Entity, RecordID})` | 関連リスト型の `PageLoad` で受け取った ID でそのまま開いている記録を読める（2026-10-06、別の本番組織で実測）。応答は `{data: [記録]}`、ルックアップは `{name, id}` |
| `ZOHO.CRM.API.coql({select_query})` | REST の COQL と同じ制約（WHERE 必須、200件、OFFSET 2000、平坦キー） |
| `ZOHO.CRM.API.insertRecord({Entity, APIData, Trigger})` | `APIData` は配列可（最大100件）。**null を渡さずキーごと落とす** |
| `ZOHO.CRM.API.updateRecord({Entity, APIData, Trigger})` | ★`RecordID` ではなく **`APIData` の中の `id`** で対象を決める。入れないと `MANDATORY_NOT_FOUND {"api_name":"id"}` |
| `ZOHO.CRM.API.deleteRecord({Entity, RecordID})` | こちらは `RecordID`。**`updateRecord` と流儀が違う** |
| `ZOHO.CRM.UI.Record.open({Entity, RecordID})` | ID が空だと「アクセスできないビュー」という無関係に見えるエラーになる。レコード ID は18桁で、**数値化すると桁落ちするので文字列で扱い**、呼ぶ前に形式を検証する |

### ★必須：エラーハンドリング

**SDK は失敗時に `Error` ではなく生のレスポンスで reject する。**
`String(err)` すると `[object Object]` になり原因が完全に消える。
**`err.data[0].code` / `message` / `details` まで掘って表示する共通関数を必ず作ること。**
これが無いとデバッグの往復が跳ね上がる。

### パッケージング

- ZIP の**ルート直下**に `plugin-manifest.json` と `app/` を置く。解凍して再圧縮すると階層が増えて弾かれる
- ZIP に**ディレクトリエントリを含める**。無いと `Please upload a proper file`
- 珍しい拡張子は弾かれる（`.geojson` で発生）。`.json` などに変える
- ウィジェットは「**1エントリ＝1画面**」。ただし同じ ZIP を複数エントリで使い回せる（Index Page だけ変える）
- **種類（Web タブ／関連リスト／ボタン）は後から変更できない**
- ★**ホスティング：Zoho の Index Page は `app/` からの相対パス**（2026-10-06、別の本番組織の関連リスト型で実測）。
  ZIP の `app/index.html` なら **`/index.html`**。`/app/index.html` にすると、枠の中に Zoho の「Page Not Found」が出る。
  `plugin-manifest.json` の `url` は `/app/index.html` のままで受け付けられた（Zoho の説明でも、zet のひな形は manifest が `/app/widget.html`、Index Page が `/widget.html`）
- 置き場所の確かめ方：ウィジェットの編集画面の「ベースURL」＋`/main.js` を新しいタブで開くと、ZIP の `app/main.js` の中身が出る
- **Index Page を直したあと、ブラウザのキャッシュを消すまで「Page Not Found」が出続けた**（再読み込みだけで直るかは未確認）。
  設定を変えても画面が変わらないときは、まずキャッシュを消す
- 外部ライブラリは CDN 参照でなく同梱する。CSP で弾かれるリスクを消せる

---

## 12. 未確定・API 非対応 ★計画時に必読

ここに挙げたものは**当て推量で POST を繰り返さないこと。**
UI での参照作成を依頼するか、UI 作業として計画に組み込む。

| 対象 | 状況 |
|---|---|
| 検証ルール | `GET/POST /crm/v8/settings/validation_rules?module=X&layout_id=Y` は存在する。必須項目は `field` → `conditions` → `conditions[].primary_condition` → `conditions[].alert`（オブジェクトではなくテキスト）と判明したが、**全て揃えても `INTERNAL_ERROR`。構造未確定** |
| レイアウトルール | **v9 のみ**（v8 は `API_NOT_SUPPORTED`）。`GET /crm/v9/settings/layout_rules?module=X` は 200。個別 GET には `layout_id` が必須。**作成の構造は未確定** |
| パイプライン | `GET /crm/v8/settings/pipeline?layout_id=X`。**未設定の組織では 204。その場合は `Stage` 選択肢を直接編集する（第4章の PATCH）** |
| スケジュール登録 | **API 非対応。UI 作業。組織あたりアクティブ10件まで** |
| ブループリント | **API 非対応**（レコードの遷移実行 API はあるが、定義の作成は不可） |
| Web タブ／ウィジェット登録 | **API 非対応。UI 作業** |
| 関連リスト型ウィジェットの高さ（`ZOHO.CRM.UI.Resize({height})`） | 呼んでも枠の中に縦のスクロールバーが出た（2026-10-06）。関連リスト型で効くのか・高さに上限があるのかは未確定。中身は枠の中でスクロールできる作りにしておく |
| ワークフローの引数マッピング | **API 非対応。作成後に UI で設定が必要** |
| タブグループのプロファイル割当 | Administrator 以外は 200 が返るのに反映されない |

### 定石

構造が公開されていない API は、**UI で最小の1本を作ってもらい `GET .../{id}` で実物の JSON を読む。**
同じ形を組み立てれば残りは API で流せる。
**3〜4回の探索で当たらなければ止めること。**

---

## 13. 全リクエスト早見表

実際に使用した 42 本。`{dc}` 以外は `https://www.zohoapis.{dc}` 配下。

| # | METHOD | PATH | 用途 |
|---|---|---|---|
| 1 | POST | `accounts.zoho.{dc}/oauth/v2/token` | 認可コード→リフレッシュトークン |
| 2 | POST | `accounts.zoho.{dc}/oauth/v2/token` | アクセストークン取得 |
| 3 | GET | `/crm/v8/org` | **実行前ガード** |
| 4 | GET | `/crm/v8/settings/modules` | モジュール一覧 |
| 5 | GET | `/crm/v8/settings/modules/{module}` | モジュール詳細 |
| 6 | POST | `/crm/v8/settings/modules` | モジュール作成 |
| 7 | GET | `/crm/v8/settings/fields?module=` | 項目一覧 |
| 8 | POST | `/crm/v8/settings/fields?module=` | 項目作成（5件まで） |
| 9 | PATCH | `/crm/v8/settings/fields/{id}?module=` | 項目更新 |
| 10 | GET | `/crm/v8/settings/layouts?module=` | レイアウト取得 |
| 11 | PATCH | `/crm/v8/settings/layouts/{id}?module=` | セクション編集 |
| 12 | GET | `/crm/v8/settings/related_lists?module=` | 関連リスト一覧 |
| 13 | GET | `/crm/v8/settings/related_lists/{id}?module=` | 表示列の確認 |
| 14 | PUT | `/crm/v8/settings/related_lists?module=` | 並び順・表示列 |
| 15 | GET | `/crm/v8/settings/tab_groups` | タブグループ一覧 |
| 16 | POST | `/crm/v8/settings/tab_groups` | タブグループ作成 |
| 17 | PUT | `/crm/v8/settings/tab_groups/{id}` | タブグループ更新 |
| 18 | GET | `/crm/v8/settings/profiles` | プロファイル ID 取得 |
| 19 | GET | `/crm/v8/users?type=AllUsers` | ユーザー ID 取得 |
| 20 | GET | `/crm/v8/settings/functions` | 関数一覧 |
| 21 | POST | `/crm/v8/settings/functions` | 関数作成（multipart） |
| 22 | PUT | `/crm/v8/settings/functions/{id}` | 関数更新（multipart） |
| 23 | GET | `/crm/v8/settings/automation/functions?module=` | 関数アクション一覧 |
| 24 | POST | `/crm/v8/settings/automation/functions` | 関数アクション登録 |
| 25 | GET | `/crm/v8/settings/automation/tasks?module=` | タスクアクション一覧 |
| 26 | POST | `/crm/v8/settings/automation/tasks` | タスクアクション登録 |
| 27 | GET | `/crm/v8/settings/automation/workflow_rules` | ルール一覧（条件は出ない） |
| 28 | GET | `/crm/v8/settings/automation/workflow_rules/{id}` | **構造確認に最有効** |
| 29 | POST | `/crm/v8/settings/automation/workflow_rules` | ルール作成 |
| 30 | GET | `/crm/v8/settings/validation_rules?module=&layout_id=` | 検証ルール一覧 |
| 31 | POST | `/crm/v8/settings/validation_rules?module=&layout_id=` | 検証ルール作成（構造未確定） |
| 32 | GET | `/crm/v9/settings/layout_rules?module=` | レイアウトルール（v9のみ） |
| 33 | GET | `/crm/v9/settings/layout_rules/{id}?module=&layout_id=` | 同 個別取得 |
| 34 | GET | `/crm/v8/settings/pipeline?layout_id=` | パイプライン確認 |
| 35 | POST | `/crm/v8/coql` | クエリ |
| 36 | GET | `/crm/v8/{module}` | レコード一覧 |
| 37 | GET | `/crm/v8/{module}/actions/count` | **件数のみ（最も安い）** |
| 38 | POST | `/crm/v8/{module}` | レコード作成（100件まで） |
| 39 | PUT | `/crm/v8/{module}/{record_id}` | レコード更新 |
| 40 | POST | `upload.zoho.{dc}/crm/v8/upload` | Bulk Write アップロード |
| 41 | POST | `/crm/bulk/v8/write` | **Bulk Write ジョブ投入** |
| 42 | GET | `/crm/bulk/v8/write/{job_id}` | ジョブ状態確認 |

## HTTP メソッド早見表

**規則性がない。これで何度も 400 を食う。**

| 対象 | 作成 | 更新 |
|---|---|---|
| モジュール | POST | PATCH |
| 項目 | POST | PATCH（**PUT 不可**） |
| レイアウト | — | PATCH |
| タブグループ | POST | PUT |
| 関連リスト | — | PUT（**PATCH 不可**） |
| 関数 | POST | PUT（multipart／`api_name` を外す） |
| ワークフロー | POST | PUT |
| レコード | POST | PUT |

---

*Zoho CRM API v8（一部 v9）実測リファレンス ／ 2026-10 時点 ／
記載の挙動は Enterprise エディションでの実測（2026-09・2026-10 の追記分は別の本番組織で実測。エディションは未確認）。
エディションや設定により差異が出る可能性がある。*
