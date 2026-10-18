# CRM訪問スコアリング

船井総研の「CRM訪問スコアリング機能 実装仕様書」（2026-07-21 版 1.0）を東京新電機様の CRM に入れる。
SalesIQ から入る「訪問」の閲覧ページ URL をルールと照らして、見込み客・担当者（`Contacts`）に点数を足し、
30日訪問が無ければ 25% ずつ減らす。

## 仕様書からの変更（2026-10-18 に決めたこと）

| 仕様書 | 東京新電機様 | 理由 |
|---|---|---|
| 顧客担当者の「顧客タイプ区分名」で対象を絞る | **使わない**。すべてのルールが全員に効く | この組織に該当の項目が無く、今回は要らない |
| スコアリングルールの「属性区分」 | **作らない** | 同上 |
| 主項目（名前） | 「説明」を主項目にする（API 名 `Name`） | ルールの中身が URL だけでは分からないため、必ず書いてもらう |
| 問合せ者・名刺（`Leads`）の訪問 | 対象外 | |
| `WebVisitLog`・`IPCompany` | 触らない（インテントセールス用。今は動いていない。削除しない） | |

## CRM に作るもの（API 名はここと `crm/scoring/*.json` だけに書く）

スコアリングルール（新しいモジュール `ScoringRules`）

| 表示名 | API 名 | 種類 | 中身 |
|---|---|---|---|
| 説明 | `Name` | 1行テキスト（主項目） | ルールのメモ（例「FAQ 閲覧」） |
| スコアリング対象 | `Scoring_Target` | 選択リスト | 「閲覧したURLが」だけ |
| 値 | `Match_Value` | 1行テキスト（255文字） | 判定する URL |
| 条件 | `Match_Condition` | 選択リスト | を含むとき／を含まないとき／と等しい／と等しくない |
| 点数 | `Points` | 整数 | 条件が成り立ったときに足す点数 |

見込み客・担当者（`Contacts`）に足す項目

| 表示名 | API 名 | 種類 |
|---|---|---|
| CRM訪問スコア | `CRM_Visit_Score` | 整数 |
| スコア計算済み日時 | `Score_Calculated_At` | 日時 |
| スコア減衰日 | `Score_Decay_Date` | 日付 |
| スコア保有 | `Has_Score` | チェックボックス |

既存の項目・レイアウト・ワークフローは変えない。削除はしない。

## 手順

| # | 作業 | 方法 | 状況 |
|---|---|---|---|
| 1 | 構築用の権限で認証情報を作り直す | ユーザー（下の「認証情報」） | |
| 2 | プロファイルを読み、モジュールを作る `POST /crm/v8/settings/modules`（`01_module_ScoringRules.json`） | `tsd_crm write`（了承を得てから） | |
| 3 | スコアリングルールに項目を作る `POST /crm/v8/settings/fields?module=ScoringRules`（`02_…`） | 同上 | |
| 4 | Contacts に項目を作る `POST /crm/v8/settings/fields?module=Contacts`（`03_…`） | 同上 | |
| 5 | 作った項目がレイアウトのどこに入ったか確かめる。足りなければ Contacts のレイアウトに「CRM訪問スコア」のセクションを足す（PATCH。中身を見せて了承を得てから） | `tsd_crm` | |
| 6 | 関数2本（加算・減衰）を仕様書から直して登録 | 画面（`tsd_crm` は multipart に未対応） | |
| 7 | ワークフロー（最後の訪問日時が更新されたとき → 加算関数。引数 contactId） | 画面のみ（引数の割り当ては API 非対応） | |
| 8 | 減衰関数のスケジュール（毎日 2:00） | 画面のみ（API 非対応） | |
| 9 | 管理用4項目を一般ユーザーには読み取り専用にする | 画面 | |
| 10 | ルールを入れ、仕様書 9.2 のテスト（減衰は DRY_RUN=true から） | 一緒に | |

## 認証情報（構築用）

`docs/setup.md` の手順1・3と同じやり方で、認可コードを次のスコープで発行し直す（スコープは後から足せない）。

```
ZohoCRM.org.READ,ZohoCRM.users.READ,ZohoCRM.modules.ALL,ZohoCRM.coql.READ,ZohoCRM.settings.modules.ALL,ZohoCRM.settings.fields.ALL,ZohoCRM.settings.layouts.ALL,ZohoCRM.settings.profiles.READ,ZohoCRM.settings.related_lists.READ,ZohoCRM.settings.functions.ALL,ZohoCRM.settings.workflow_rules.READ,ZohoCRM.settings.automation_actions.READ
```

今の読み取り用の権限をすべて含むので、工数ダッシュボードの突き合わせ（`scripts/verify_worklog_totals.py`）もそのまま動く。
