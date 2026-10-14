# 未確認の API

公式ドキュメント・実機で確かめないまま実装した箇所を記録する。確かめたら消す（実機で分かった挙動は正本のスキルへ）。

| 箇所 | 何を仮定したか | 確かめる方法 |
|---|---|---|
| `tsd_crm/client.py` `check_api_domain` | トークン応答に `api_domain`（例 `https://www.zohoapis.jp`）が入る。無ければ照合を飛ばす（組織の照合は別にある） | 初回の `exchange-code` で応答のキーを確かめる |
| `tsd_crm/client.py` `access_token` | トークン応答の `expires_in` は秒。無ければ 3000 秒とみなす | 同上 |
| `tsd_crm/client.py` `_send` | 失効したアクセストークンで呼ぶと HTTP 401（`OAUTH_SCOPE_MISMATCH` 以外）。取り直して1回だけ再試行する | キャッシュしたトークンが切れた後に呼んで、返るコードを確かめる |
| `docs/setup.md` 手順1 | Self Client の認可コード発行で、複数の組織に属するユーザーには組織を選ぶ欄が出る | 発行時の画面で確かめる（違っても `tsd_crm` の組織の照合で止まる） |
