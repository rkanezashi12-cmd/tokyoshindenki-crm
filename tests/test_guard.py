"""接続先の守りのテスト。Zoho には接続せず、HTTP を偽物に差し替えて確かめる。"""

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from tsd_crm import client as tc
from tsd_crm.client import CRMClient, GuardError, ZohoAPIError

ROOT = Path(__file__).resolve().parent.parent
TSD_ORG = {"id": "111", "domain_name": "org222", "company_name": "東京新電機株式会社",
           "zgid": "222", "time_zone": "Asia/Tokyo", "currency": "JPY"}
OTHER_ORG = {"id": "999", "domain_name": "org888", "company_name": "別の会社",
             "zgid": "888", "time_zone": "Asia/Tokyo", "currency": "JPY"}
CREDS = {"client_id": "cid", "client_secret": "secret", "refresh_token": "rt"}


def make_cfg(pinned=True):
    cfg = json.loads((ROOT / "config" / "zoho_target.json").read_text(encoding="utf-8"))
    if pinned:
        cfg["expected_org"] = {k: TSD_ORG[k] for k in tc.ORG_KEYS}
    return cfg


class FakeZoho:
    def __init__(self, org=TSD_ORG, token_body=None):
        self.org = org
        self.token_body = token_body or {"access_token": "at", "expires_in": 3600,
                                         "api_domain": "https://www.zohoapis.jp"}
        self.calls = []

    def __call__(self, method, url, headers, body):
        self.calls.append((method, url))
        if url == "https://accounts.zoho.jp/oauth/v2/token":
            return 200, json.dumps(self.token_body).encode()
        if not url.startswith("https://www.zohoapis.jp/"):
            raise AssertionError(f"固定外のホストに接続しようとした: {url}")
        if url.endswith("/crm/v8/org"):
            return 200, json.dumps({"org": [self.org]}).encode()
        if url.endswith("/crm/v8/coql"):
            return 204, b""
        return 200, json.dumps({"data": [{"id": "1"}]}).encode()

    def api_calls(self):
        return [c for c in self.calls if "/oauth/" not in c[1]]


def make_client(fake, pinned=True, **kw):
    return CRMClient(make_cfg(pinned), CREDS, transport=fake, token_cache_dir=False, **kw)


class OrgGuardTest(unittest.TestCase):
    def test_reads_after_matching_org(self):
        fake = FakeZoho()
        c = make_client(fake)
        self.assertEqual(c.get("/crm/v8/Machines", {"per_page": 1}), {"data": [{"id": "1"}]})
        self.assertEqual(c.coql("SELECT Name FROM Machines WHERE id is not null"), [])
        # org の照合は1プロセス1回
        self.assertEqual([u for _, u in fake.api_calls()].count("https://www.zohoapis.jp/crm/v8/org"), 1)

    def test_other_org_is_refused_before_any_other_call(self):
        fake = FakeZoho(org=OTHER_ORG)
        c = make_client(fake, allow_write=True)
        for call in (lambda: c.get("/crm/v8/Machines"), lambda: c.coql("SELECT id FROM Machines WHERE id is not null"),
                     lambda: c.write("PUT", "/crm/v8/Machines/1", {"data": []})):
            with self.assertRaises(GuardError):
                call()
        self.assertTrue(all(u.endswith("/crm/v8/org") for _, u in fake.api_calls()))

    def test_one_mismatched_key_is_enough_to_refuse(self):
        fake = FakeZoho(org={**TSD_ORG, "domain_name": "org000"})
        with self.assertRaises(GuardError):
            make_client(fake).get("/crm/v8/Machines")

    def test_unpinned_only_allows_org_lookup(self):
        fake = FakeZoho()
        c = make_client(fake, pinned=False)
        self.assertEqual(c.fetch_org()["company_name"], "東京新電機株式会社")
        with self.assertRaises(GuardError):
            c.get("/crm/v8/Machines")
        self.assertEqual(len(fake.api_calls()), 1)


class HostAndWriteGuardTest(unittest.TestCase):
    def test_absolute_url_and_non_crm_path_are_refused(self):
        c = make_client(FakeZoho())
        for path in ("https://www.zohoapis.com/crm/v8/org", "//www.zohoapis.com/crm/v8/org", "/oauth/v2/token"):
            with self.assertRaises(GuardError):
                c.get(path)

    def test_config_pointing_to_other_dc_is_refused(self):
        with tempfile.TemporaryDirectory() as d:
            cfg = make_cfg()
            cfg["api_host"] = "www.zohoapis.com"
            path = Path(d) / "c.json"
            path.write_text(json.dumps(cfg))
            with self.assertRaises(GuardError):
                tc.load_config(path)

    def test_token_for_other_dc_is_refused(self):
        fake = FakeZoho(token_body={"access_token": "at", "api_domain": "https://www.zohoapis.com"})
        with self.assertRaises(GuardError):
            make_client(fake).get("/crm/v8/Machines")
        self.assertEqual(fake.api_calls(), [])

    def test_token_error_with_http_200_is_failure(self):
        fake = FakeZoho(token_body={"error": "invalid_client"})
        with self.assertRaises(GuardError):
            make_client(fake).fetch_org()

    def test_write_needs_allow_write_and_delete_is_never_sent(self):
        fake = FakeZoho()
        with self.assertRaises(GuardError):
            make_client(fake).write("PUT", "/crm/v8/Machines/1", {"data": []})
        c = make_client(fake, allow_write=True)
        with self.assertRaises(GuardError):
            c.write("DELETE", "/crm/v8/Machines/1", None)
        self.assertFalse(any(m == "DELETE" for m, _ in fake.calls))
        with tempfile.TemporaryDirectory() as d, mock.patch.object(tc, "WRITE_LOG", Path(d) / "w.log"):
            c.write("PUT", "/crm/v8/Machines/1", {"data": [{"Name": "x"}], "trigger": []})
            log = (Path(d) / "w.log").read_text()
        self.assertIn("PUT\t/crm/v8/Machines/1\tHTTP 200", log)
        self.assertNotIn("Name", log)

    def test_scope_mismatch_is_not_retried(self):
        class Scope(FakeZoho):
            def __call__(self, method, url, headers, body):
                if url.endswith("/Machines"):
                    self.calls.append((method, url))
                    return 401, json.dumps({"code": "OAUTH_SCOPE_MISMATCH"}).encode()
                return super().__call__(method, url, headers, body)
        fake = Scope()
        with self.assertRaises(ZohoAPIError):
            make_client(fake).get("/crm/v8/Machines")
        self.assertEqual([u for _, u in fake.calls].count("https://www.zohoapis.jp/crm/v8/Machines"), 1)

    def test_pin_refuses_to_overwrite_other_org(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "c.json"
            path.write_text(json.dumps(make_cfg(pinned=False)))
            tc.pin_org(TSD_ORG, path)
            tc.pin_org(TSD_ORG, path)  # 同じ組織なら何度でも可
            with self.assertRaises(GuardError):
                tc.pin_org(OTHER_ORG, path)
            self.assertEqual(json.loads(path.read_text())["expected_org"]["id"], "111")


class HookTest(unittest.TestCase):
    def run_hook(self, tool, tool_input):
        res = subprocess.run([sys.executable, str(ROOT / ".claude" / "hooks" / "zoho_guard.py")],
                             input=json.dumps({"tool_name": tool, "tool_input": tool_input}),
                             capture_output=True, text=True)
        return res.returncode

    def test_blocks_zoho_mcp_and_direct_calls(self):
        for tool in ("mcp__Kawahara_CRM_temp__ZohoCRM_getModules", "mcp__Zoho_CRM__updateRecords",
                     "mcp__ZohoCRM__ZohoCRM_getRecords", "mcp__Some_New_Zoho__getRecords"):
            self.assertEqual(self.run_hook(tool, {}), 2, tool)
        self.assertEqual(self.run_hook("Bash", {"command": "curl -s https://www.zohoapis.jp/crm/v8/org"}), 2)
        self.assertEqual(self.run_hook("Bash", {"command": "python3 -c 'import urllib; ... zohoapis.com'"}), 2)
        self.assertEqual(self.run_hook("WebFetch", {"url": "https://accounts.zoho.com/oauth/v2/token"}), 2)

    def test_allows_normal_work(self):
        self.assertEqual(self.run_hook("Bash", {"command": "python -m tsd_crm org"}), 0)
        self.assertEqual(self.run_hook("Bash", {"command": "grep -rn zohoapis.jp tsd_crm"}), 0)
        self.assertEqual(self.run_hook("Bash", {"command": "python3 - <<'EOF'\n# https://www.zohoapis.jp を文書に書く\nEOF"}), 0)
        self.assertEqual(self.run_hook("WebFetch", {"url": "https://www.zoho.com/crm/developer/docs/api/v8/"}), 0)
        self.assertEqual(self.run_hook("mcp__github__get_file_contents", {}), 0)


if __name__ == "__main__":
    unittest.main()
