"""東京新電機様の Zoho CRM だけに接続するクライアント。

守り（どれか1つでも外すと他社の環境に触れうる）：
- 接続先のホストは config/zoho_target.json の .jp のホストに固定する。URL を外から渡せない
- 認証情報は TSD_ZOHO_* の環境変数（無ければ .env）からだけ読む。既定の認証情報は持たない
- どの API を呼ぶ前にも GET /crm/v8/org で組織を照合し、id・domain_name・company_name が
  1つでも違えば中断する。組織を固定する前は org の確認以外を拒否する
- 書き込みは allow_write=True のときだけ。DELETE は実装しない
- 関数のコードの更新（update_function）は、コードの宣言が更新先の関数の api_name・カテゴリーと
  一致するときだけ送る（別の関数を上書きしないため）
"""

import hashlib
import json
import os
import re
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = ROOT / "config" / "zoho_target.json"
ENV_FILE = ROOT / ".env"
WRITE_LOG = ROOT / "logs" / "writes.log"
ORG_KEYS = ("id", "domain_name", "company_name")
WRITE_METHODS = ("POST", "PUT", "PATCH")
MODULE_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]*$")
FUNCTION_DECL_RE = re.compile(r"^\s*\w+\s+([A-Za-z_]+)\.([A-Za-z0-9_]+)\s*\(")


class GuardError(RuntimeError):
    """接続先・権限の守りに引っかかった。中断する。"""


class ZohoAPIError(RuntimeError):
    def __init__(self, status, body):
        self.status = status
        self.body = body
        code = body.get("code") if isinstance(body, dict) else None
        super().__init__(f"HTTP {status} {code or ''} {json.dumps(body, ensure_ascii=False)[:500]}")


def load_config(path=CONFIG_PATH):
    cfg = json.loads(Path(path).read_text(encoding="utf-8"))
    dc = cfg["dc"]
    # 設定ファイルの書き換えで他の DC に向かないよう、ホストを DC から組み立てた値と突き合わせる
    if dc != "jp" or cfg["accounts_host"] != f"accounts.zoho.{dc}" or cfg["api_host"] != f"www.zohoapis.{dc}":
        raise GuardError("config/zoho_target.json の接続先が東京新電機様（.jp）ではありません")
    return cfg


def read_env_file(path=ENV_FILE):
    values = {}
    path = Path(path)
    if not path.exists():
        return values
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def load_credentials(cfg, environ=None, env_file=ENV_FILE):
    environ = os.environ if environ is None else environ
    file_values = read_env_file(env_file)
    creds, missing = {}, []
    for key, name in cfg["credential_env"].items():
        value = environ.get(name) or file_values.get(name)
        if value:
            creds[key] = value
        else:
            missing.append(name)
    if missing:
        raise GuardError(f"認証情報がありません: {', '.join(missing)}（手順は docs/setup.md）")
    return creds


def urllib_transport(method, url, headers, body):
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            return res.status, res.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def parse_json(raw):
    if not raw:
        return None
    try:
        return json.loads(raw)
    except ValueError:
        return {"raw": raw.decode("utf-8", "replace")[:500]}


class CRMClient:
    def __init__(self, cfg=None, creds=None, *, allow_write=False, transport=None, token_cache_dir=None):
        self.cfg = cfg or load_config()
        self.creds = creds or load_credentials(self.cfg)
        self.allow_write = allow_write
        self._transport = transport or urllib_transport
        self._token = None
        self._token_exp = 0.0
        self._org_verified = False
        self._cache_file = None
        if token_cache_dir is not False:
            base = Path(token_cache_dir or os.environ.get("XDG_CACHE_HOME") or Path.home() / ".cache") / "tsd_crm"
            key = hashlib.sha256(
                f"{self.cfg['accounts_host']}|{self.creds['client_id']}|{self.creds['refresh_token']}".encode()
            ).hexdigest()[:24]
            self._cache_file = base / f"token-{key}.json"

    # ---- 認証 ----

    def _read_token_cache(self):
        if not self._cache_file or not self._cache_file.exists():
            return
        try:
            data = json.loads(self._cache_file.read_text())
        except ValueError:
            return
        if data.get("expires_at", 0) > time.time() + 60:
            self._token, self._token_exp = data["access_token"], data["expires_at"]

    def _write_token_cache(self):
        if not self._cache_file:
            return
        self._cache_file.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(self._cache_file, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as f:
            json.dump({"access_token": self._token, "expires_at": self._token_exp}, f)

    def _drop_token(self):
        self._token, self._token_exp = None, 0.0
        if self._cache_file and self._cache_file.exists():
            self._cache_file.unlink()

    def access_token(self):
        if self._token and self._token_exp > time.time() + 60:
            return self._token
        self._read_token_cache()
        if self._token:
            return self._token
        body = urllib.parse.urlencode({
            "grant_type": "refresh_token",
            "refresh_token": self.creds["refresh_token"],
            "client_id": self.creds["client_id"],
            "client_secret": self.creds["client_secret"],
        }).encode()
        url = f"https://{self.cfg['accounts_host']}/oauth/v2/token"
        headers = {"Content-Type": "application/x-www-form-urlencoded"}
        for attempt in range(4):
            status, raw = self._transport("POST", url, headers, body)
            data = parse_json(raw) or {}
            # 失敗しても HTTP 200 が返るので、本文の access_token の有無で判定する（スキル第2章）
            if "access_token" in data:
                check_api_domain(data, self.cfg)
                self._token = data["access_token"]
                self._token_exp = time.time() + int(data.get("expires_in", 3000))
                self._write_token_cache()
                return self._token
            error = str(data.get("error") or data.get("error_description") or f"HTTP {status}")
            if "too many requests" in json.dumps(data).lower() and attempt < 3:
                time.sleep(5 * 2 ** attempt)
                continue
            raise GuardError(f"アクセストークンを取得できません: {error}")
        raise GuardError("アクセストークンを取得できません（再試行の上限）")

    # ---- リクエスト ----

    def _url(self, path, params=None):
        if "://" in path or not path.lstrip("/").startswith("crm/"):
            raise GuardError(f"パスは /crm/ から始まる相対パスだけ受け付けます: {path}")
        url = f"https://{self.cfg['api_host']}/{path.lstrip('/')}"
        if params:
            url += ("&" if "?" in url else "?") + urllib.parse.urlencode(params)
        return url

    def _send(self, method, path, params=None, body=None, *, raw=None, content_type=None):
        url = self._url(path, params)
        data = None if body is None else json.dumps(body, ensure_ascii=False).encode()
        if raw is not None:
            data = raw
        for attempt in range(2):
            headers = {"Authorization": f"Zoho-oauthtoken {self.access_token()}"}
            if data is not None:
                headers["Content-Type"] = content_type or "application/json"
            status, raw = self._transport(method, url, headers, data)
            parsed = parse_json(raw)
            code = parsed.get("code") if isinstance(parsed, dict) else None
            # キャッシュしたトークンが失効していたら1回だけ取り直す。スコープ不足は取り直しても直らない
            if status == 401 and code != "OAUTH_SCOPE_MISMATCH" and attempt == 0:
                self._drop_token()
                continue
            if status >= 400:
                raise ZohoAPIError(status, parsed)
            return status, parsed

    def fetch_org(self):
        _, data = self._send("GET", f"/crm/{self.cfg['api_version']}/org")
        return data["org"][0]

    def verify_org(self):
        """実行前ガード。固定した組織と1つでも違えば GuardError。"""
        if self._org_verified:
            return
        expected = self.cfg["expected_org"]
        if not all(expected.get(k) for k in ORG_KEYS):
            raise GuardError(
                "接続先の組織がまだ固定されていません。`python -m tsd_crm org` で組織を確かめ、"
                "ユーザーが東京新電機様の組織だと了承してから `python -m tsd_crm pin --yes` を実行してください"
            )
        org = self.fetch_org()
        diffs = [f"{k}: 期待 {expected[k]!r} / 実際 {org.get(k)!r}" for k in ORG_KEYS
                 if str(org.get(k)) != str(expected[k])]
        if diffs:
            raise GuardError("接続先が東京新電機様の組織ではありません。中断します（" + "、".join(diffs) + "）")
        self._org_verified = True

    def get(self, path, params=None):
        self.verify_org()
        return self._send("GET", path, params)[1]

    def count(self, module):
        if not MODULE_RE.match(module):
            raise GuardError(f"モジュールの API 名が不正です: {module}")
        return self.get(f"/crm/{self.cfg['api_version']}/{module}/actions/count")

    def coql(self, query):
        """読み取り専用。該当0件（HTTP 204）は空のリストを返す。"""
        self.verify_org()
        _, data = self._send("POST", f"/crm/{self.cfg['api_version']}/coql", body={"select_query": query})
        return (data or {}).get("data", [])

    def write(self, method, path, body, params=None):
        method = method.upper()
        if method == "DELETE":
            raise GuardError("削除はこのクライアントでは行いません（CLAUDE.md ルール3）")
        if method not in WRITE_METHODS:
            raise GuardError(f"書き込みのメソッドは {', '.join(WRITE_METHODS)} のどれかです: {method}")
        if not self.allow_write:
            raise GuardError("書き込みは許可されていません。ユーザーの指示があるときだけ --allow-write を付けます")
        self.verify_org()
        try:
            status, data = self._send(method, path, params, body)
        except ZohoAPIError as e:
            self._log_write(method, path, e.status)
            raise
        self._log_write(method, path, status)
        return data

    def update_function(self, function_id, code):
        """関数のコードを更新する（PUT multipart。スキル第8章）。名前・カテゴリー・説明は今の値のまま送る。"""
        if not str(function_id).isdigit():
            raise GuardError(f"関数の id は数字だけです: {function_id}")
        if not self.allow_write:
            raise GuardError("書き込みは許可されていません。ユーザーの指示があるときだけ --allow-write を付けます")
        path = f"/crm/{self.cfg['api_version']}/settings/functions/{function_id}"
        current = self.get(path)["functions"][0]
        check_function_decl(code, current)
        # api_name は送らない（更新できず NOT_ALLOWED になる。スキル第8章）
        meta = {"functions": [{k: current[k] for k in ("name", "runtime", "category", "description")
                               if current.get(k) is not None}]}
        raw, content_type = build_function_multipart(meta, code, f"{current['api_name']}.ds")
        try:
            status, data = self._send("PUT", path, raw=raw, content_type=content_type)
        except ZohoAPIError as e:
            self._log_write("PUT", path, e.status)
            raise
        self._log_write("PUT", path, status)
        return data

    def _log_write(self, method, path, status):
        # 本文（個人情報を含みうる）とトークンは残さない
        WRITE_LOG.parent.mkdir(exist_ok=True)
        org = self.cfg["expected_org"]["id"]
        stamp = datetime.now(timezone.utc).isoformat(timespec="seconds")
        with WRITE_LOG.open("a", encoding="utf-8") as f:
            f.write(f"{stamp}\torg={org}\t{method}\t{path}\tHTTP {status}\n")


def check_api_domain(token_response, cfg):
    """トークンの応答に api_domain があれば、固定した API ホストと一致するか確かめる。"""
    api_domain = token_response.get("api_domain")
    if api_domain and api_domain.rstrip("/") != f"https://{cfg['api_host']}":
        raise GuardError(f"認証情報のデータセンターが違います（api_domain={api_domain}）。東京新電機様は .jp です")


def check_function_decl(code, function):
    """コードの1行目の宣言（例 void automation.add_x(Int id)）が更新先の関数と一致するか確かめる。"""
    first = next((line for line in code.splitlines() if line.strip()), "")
    m = FUNCTION_DECL_RE.match(first)
    if not m:
        raise GuardError(f"コードの1行目が関数の宣言ではありません: {first[:80]}")
    category, api_name = m.group(1).lower(), m.group(2)
    expected = (str(function.get("category", "")).lower().replace(" ", ""), function.get("api_name"))
    if (category, api_name) != expected:
        raise GuardError(f"コードの宣言（{category}.{api_name}）が更新先の関数（{expected[0]}.{expected[1]}）と違います。中断します")


def build_function_multipart(meta, code, filename):
    """metadata（JSON 文字列）と code（.ds ファイル）の2パートを組む。"""
    boundary = "tsdcrm" + secrets.token_hex(12)
    parts = [
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"metadata\"\r\n"
        f"Content-Type: application/json\r\n\r\n{json.dumps(meta, ensure_ascii=False)}\r\n",
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"code\"; filename=\"{filename}\"\r\n"
        f"Content-Type: application/octet-stream\r\n\r\n{code}\r\n",
        f"--{boundary}--\r\n",
    ]
    return "".join(parts).encode("utf-8"), f"multipart/form-data; boundary={boundary}"


def pin_org(org, path=CONFIG_PATH):
    """org の識別子を設定ファイルに固定する。別の組織で固定済みなら拒否する。"""
    cfg = json.loads(Path(path).read_text(encoding="utf-8"))
    current = cfg["expected_org"]
    new = {k: str(org[k]) for k in ORG_KEYS}
    if any(current.get(k) for k in ORG_KEYS) and current != new:
        raise GuardError(f"別の組織で固定済みです（{current}）。固定を変えるのはユーザーが手で行います")
    cfg["expected_org"] = new
    Path(path).write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return new
