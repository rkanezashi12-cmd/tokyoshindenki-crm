# 未確認の API

公式ドキュメント・実機で確かめないまま実装した箇所を記録する。確かめたら消す（実機で分かった挙動は正本のスキルへ）。

| 箇所 | 何を仮定したか | 確かめる方法 |
|---|---|---|
| `tsd_crm/client.py` `check_api_domain` | トークン応答に `api_domain`（例 `https://www.zohoapis.jp`）が入る。無ければ照合を飛ばす（組織の照合は別にある） | 初回の `exchange-code` で応答のキーを確かめる |
| `tsd_crm/client.py` `access_token` | トークン応答の `expires_in` は秒。無ければ 3000 秒とみなす | 同上 |
| `tsd_crm/client.py` `_send` | 失効したアクセストークンで呼ぶと HTTP 401（`OAUTH_SCOPE_MISMATCH` 以外）。取り直して1回だけ再試行する | キャッシュしたトークンが切れた後に呼んで、返るコードを確かめる |
| `docs/setup.md` 手順1 | Self Client の認可コード発行で、複数の組織に属するユーザーには組織を選ぶ欄が出る | 発行時の画面で確かめる（違っても `tsd_crm` の組織の照合で止まる） |
| `widgets/worklog-dashboard/app/main.js` `coql` | SDK の `ZOHO.CRM.API.coql` の応答は `{data: [...], info: {more_records}}`。0件のときは本文なし（中身の無い値）で返る | 本番でウィジェットを開き、0件の期間と 200 件を超える期間で確かめる |
| `widgets/worklog-dashboard/app/main.js` `boot` | ホーム画面に置いたウィジェットでも `ZOHO.embeddedApp.init()` が解決する（`PageLoad` が来なくても動くよう、両方で起動する） | ホーム画面に置いて開く |
| `docs/worklog-dashboard/README.md`「Zoho への登録」 | ホーム画面のコンポーネントにウィジェットを置ける。どの種類を選べばよいかは未確認 | ウィジェット作成画面の種類の一覧と、ホーム画面のカスタマイズで確かめる |
| `crm/scoring/02_fields_ScoringRules.json`・`03_fields_Contacts.json` | 項目作成の `data_type` に `integer`・`datetime`・`date`・`boolean` が通る（スキルに例が無い。既存項目の GET で返る名前から推定）。`required: true` が効く | 作成後に `GET /crm/v8/settings/fields` で種類と必須を確かめる |
| `crm/scoring/01_module_ScoringRules.json` | `display_field.field_label` に「説明」を渡すと主項目の表示名が「説明」、API 名は `Name` になる（スキル第3章） | 作成後に項目の一覧で確かめる |
