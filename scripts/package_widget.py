"""工数ダッシュボードのウィジェットを、Zoho CRM にアップロードできる ZIP にまとめる。

  python3 scripts/package_widget.py            # dist/worklog-dashboard.zip を作る
  python3 scripts/package_widget.py --fetch-sdk # SDK を live.zwidgets.com から取って同梱する

ZIP の決まり（スキル zoho-crm-build 第11章「パッケージング」）：
- ルート直下に plugin-manifest.json と app/ を置く
- ディレクトリエントリを含める（無いと「Please upload a proper file」）
"""

import argparse
import pathlib
import sys
import urllib.request
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
WIDGET = ROOT / "widgets" / "worklog-dashboard"
DIST = ROOT / "dist"
SDK_URL = "https://live.zwidgets.com/js-sdk/1.2/ZohoEmbededAppSDK.min.js"
SDK_FILE = WIDGET / "app" / "ZohoEmbededAppSDK.min.js"
ALLOWED = {".html", ".css", ".js", ".json", ".png", ".svg"}


def fetch_sdk():
    with urllib.request.urlopen(SDK_URL, timeout=30) as r:
        body = r.read()
    if b"ZOHO" not in body:
        sys.exit("SDK の中身が想定と違います（ZOHO が見つからない）。保存しませんでした。")
    SDK_FILE.write_bytes(body)
    print(f"SDK を同梱しました：{SDK_FILE.relative_to(ROOT)}（{len(body)} バイト）")


def build():
    DIST.mkdir(exist_ok=True)
    out = DIST / "worklog-dashboard.zip"
    files = [WIDGET / "plugin-manifest.json"] + sorted(
        p for p in (WIDGET / "app").rglob("*") if p.is_file() and p.suffix in ALLOWED
    )
    dirs = sorted({p.parent for p in files if p.parent != WIDGET})
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for d in dirs:
            z.writestr(d.relative_to(WIDGET).as_posix() + "/", "")
        for f in files:
            z.write(f, f.relative_to(WIDGET).as_posix())
    names = zipfile.ZipFile(out).namelist()
    print(f"{out.relative_to(ROOT)}：")
    for n in names:
        print("  " + n)
    if not SDK_FILE.exists():
        print("注意：SDK を同梱していません（実行時に live.zwidgets.com から読みます）。"
              "同梱するには --fetch-sdk を付けてください。")


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--fetch-sdk", action="store_true", help="SDK を取ってきて同梱する")
    args = ap.parse_args()
    if args.fetch_sdk:
        fetch_sdk()
    build()


if __name__ == "__main__":
    main()
