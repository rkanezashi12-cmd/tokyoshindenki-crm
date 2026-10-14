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
   ユーザーの了承なしに書き換えない。削除はしない。
4. **CRM の API 名は1か所（設定ファイルなど）にまとめ、コードに散らばらせない。**
5. **秘密情報（クライアント ID・シークレット・リフレッシュトークン）はリポジトリに含めない。** `.env` は commit しない。
6. ログにトークン・個人情報を出さない。
7. Zoho の API で**実機で確かめた新しい挙動**は、正本のスキル（`zoho-agri-demo`）に追記する。

## 4. 構成

（未定。機能が決まったら書く）
