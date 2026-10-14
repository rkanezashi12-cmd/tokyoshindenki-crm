# 東京新電機様の Zoho CRM に接続する手順

Claude がこのリポジトリから東京新電機様の CRM を読み書きできるようにする。**東京新電機様以外の Zoho 環境には触れない**ことを最優先にしている。

## しくみ（他の環境に触れないための守り）

| 守り | 場所 | 何を防ぐか |
|---|---|---|
| Zoho の MCP コネクタを使わせない | `.claude/settings.json`（deny）＋ `.claude/hooks/zoho_guard.py` | アカウントに接続済みの他社の Zoho 環境（`Kawahara_CRM_temp` など）を誤って操作すること。名前に `zoho` / `crm` を含む MCP ツールはすべて止める |
| Zoho の API を直接叩かせない | `.claude/hooks/zoho_guard.py` | `curl` などで照合を通さずに呼ぶこと。Zoho への接続は `python -m tsd_crm` だけ |
| 接続先ホストを .jp に固定 | `config/zoho_target.json`・`tsd_crm/client.py` | 他のデータセンターの環境への接続。URL を外から渡せない |
| 専用の認証情報だけ読む | 環境変数 `TSD_ZOHO_*` | 他社用の認証情報を拾うこと。既定の認証情報は持たない |
| 組織の照合（実行前ガード） | `tsd_crm/client.py` | 毎回、最初に `GET /crm/v8/org` を呼び、固定した `id`・`domain_name`・`company_name` と1つでも違えば中断する |
| 書き込みは明示したときだけ・削除はしない | `python -m tsd_crm write ... --allow-write` | 指示の無い書き込み。DELETE は実装していない。書き込みは `logs/writes.log` に記録（本文は残さない） |

## 1. Self Client を作る（東京新電機様の Zoho アカウントで）

1. **東京新電機様の CRM の管理者アカウントで** <https://api-console.zoho.jp> にログインする。
   他社のお客様の Zoho アカウントでログインしていないこと、URL が `.jp` であることを確かめる
2. 「Self Client」を作り、Client ID と Client Secret を控える
3. 「Generate Code」で次のスコープを入れて認可コードを発行する（有効期限は既定10分。すぐ次へ）。
   組織を選ぶ欄が出たら東京新電機様の組織を選ぶ

```
ZohoCRM.org.READ,ZohoCRM.users.READ,ZohoCRM.modules.ALL,ZohoCRM.coql.READ,ZohoCRM.settings.modules.READ,ZohoCRM.settings.fields.READ
```

- レコードの読み書き・COQL・モジュールと項目の設定の読み取りまで。モジュールや項目を API で作る・変えるときは、
  スキル `zoho-crm-build` 第1章の構築用スコープで発行し直す（スコープは後から足せない）

## 2. 認可コードをリフレッシュトークンに交換する（手元の端末で）

チャットに秘密情報を貼らないため、交換は手元の端末で行う。

```bash
git clone https://github.com/rkanezashi12-cmd/tokyoshindenki-crm && cd tokyoshindenki-crm
cat > .env <<'EOF'
TSD_ZOHO_CLIENT_ID=（Client ID）
TSD_ZOHO_CLIENT_SECRET=（Client Secret）
EOF
python3 -m tsd_crm exchange-code     # 認可コードを貼る（画面には出ない）
```

`.env` にリフレッシュトークンが保存され、接続先の組織（`company_name` など）が表示される。
**東京新電機様の組織でなければ、ここで止めて Self Client を作り直す。**（`.env` は commit されない）

## 3. Claude Code のクラウド環境に設定する

クラウド環境の設定（セッションのタイトルバーの環境メニュー → Edit）で：

- **Network access**：Allowed domains に `accounts.zoho.jp` と `www.zohoapis.jp` を追加
  （Bulk Write を使うときは `upload.zoho.jp` も）。手順：<https://code.claude.com/docs/en/cloud-environments#network-access>
- **環境変数**：`.env` の3つ（`TSD_ZOHO_CLIENT_ID`・`TSD_ZOHO_CLIENT_SECRET`・`TSD_ZOHO_REFRESH_TOKEN`）を登録
- 環境の設定は、その環境で開く**すべてのセッションに渡る**。他社の作業と混ざらないよう、
  **東京新電機様専用の環境を作る**ことを勧める

新しいセッションから有効になる。

## 4. 接続先の組織を固定する（最初の1回）

新しいセッションで Claude に「組織を確かめて」と頼む。Claude は `python -m tsd_crm org` で組織を表示し、
ユーザーが東京新電機様の組織だと了承してから `python -m tsd_crm pin --yes` で
`config/zoho_target.json` に固定して commit する。固定するまでは、組織の表示以外の操作はすべて拒否される。

## 使い方

```bash
python -m tsd_crm org                                   # 接続先の確認
python -m tsd_crm get /crm/v8/settings/modules          # 読み取り
python -m tsd_crm count Machines                        # 件数（最も安い）
python -m tsd_crm coql "SELECT Name, Serial_No FROM Machines WHERE id is not null LIMIT 5"
python -m tsd_crm write PUT /crm/v8/Machines/<id> --body '{"data":[{...}],"trigger":[]}' --allow-write
```

テスト（Zoho には接続しない）：`python3 -m unittest -v`
