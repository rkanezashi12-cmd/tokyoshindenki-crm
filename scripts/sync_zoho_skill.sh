#!/usr/bin/env bash
# Zoho のスキル（zoho-crm-build）を正本から取り込む。
#
# 正本は rkanezashi12-cmd/zoho-agri-demo の .claude/skills/zoho-crm-build/SKILL.md。
# このリポジトリの .claude/skills/zoho-crm-build/SKILL.md はその写し（Claude Code が自動で読むために置いている）。
#
#   scripts/sync_zoho_skill.sh          # 正本で上書きし、差分を表示する
#   scripts/sync_zoho_skill.sh --check  # 差分があれば表示して終了コード 1（上書きしない）
#
# 正本の場所を変えるときは環境変数で指定する：
#   ZOHO_SKILL_REPO=https://github.com/<owner>/<repo>  ZOHO_SKILL_REF=main
set -euo pipefail

REPO_URL="${ZOHO_SKILL_REPO:-https://github.com/rkanezashi12-cmd/zoho-agri-demo}"
REF="${ZOHO_SKILL_REF:-main}"
SKILL_PATH=".claude/skills/zoho-crm-build"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/$SKILL_PATH"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

git clone --quiet --depth 1 --branch "$REF" "$REPO_URL" "$TMP/src"
SRC="$TMP/src/$SKILL_PATH"
if [[ ! -f "$SRC/SKILL.md" ]]; then
  echo "正本に $SKILL_PATH/SKILL.md が見つかりません: $REPO_URL ($REF)" >&2
  exit 2
fi
COMMIT="$(git -C "$TMP/src" rev-parse --short HEAD)"

if diff -ru "$DEST" "$SRC" >"$TMP/diff.txt"; then
  echo "最新です（正本 $COMMIT）"
  exit 0
fi

if [[ "${1:-}" == "--check" ]]; then
  cat "$TMP/diff.txt"
  echo "正本（$COMMIT）と差分があります。scripts/sync_zoho_skill.sh で取り込んでください" >&2
  exit 1
fi

rm -rf "$DEST"
mkdir -p "$(dirname "$DEST")"
cp -R "$SRC" "$DEST"
cat "$TMP/diff.txt"
echo "正本 $COMMIT の内容で $SKILL_PATH を更新しました。commit してください"
