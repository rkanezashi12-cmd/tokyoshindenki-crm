"""工数ダッシュボードのウィジェット：集計の JS テスト（node）を unittest から走らせ、ZIP の形を確かめる。Zoho には接続しない。"""

import pathlib
import shutil
import subprocess
import sys
import unittest
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent


class WidgetTest(unittest.TestCase):
    @unittest.skipUnless(shutil.which("node"), "node が無い")
    def test_aggregate_js(self):
        r = subprocess.run(["node", "--test", str(ROOT / "tests" / "widget" / "aggregate.test.cjs")], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)

    def test_package_layout(self):
        subprocess.run([sys.executable, str(ROOT / "scripts" / "package_widget.py")], check=True, capture_output=True)
        names = zipfile.ZipFile(ROOT / "dist" / "worklog-dashboard.zip").namelist()
        self.assertIn("plugin-manifest.json", names)
        self.assertIn("app/", names)  # ディレクトリエントリ
        for f in ("app/index.html", "app/main.js", "app/config.js", "app/aggregate.js", "app/style.css", "app/sdk-loader.js"):
            self.assertIn(f, names)
        self.assertFalse(any(n.startswith("worklog-dashboard/") for n in names))  # 階層が増えていない

    def test_api_names_only_in_config(self):
        # CLAUDE.md ルール4：CRM の API 名は config.js にまとめる
        app = ROOT / "widgets" / "worklog-dashboard" / "app"
        for f in ("main.js", "aggregate.js"):
            src = (app / f).read_text(encoding="utf-8")
            for name in ("WorkLogItems", "Parent_Id", "ZP_Task", "Work_Date", "Task_Name", "Project_Name"):
                self.assertNotIn(name, src, f"{f} に {name}")


if __name__ == "__main__":
    unittest.main()
