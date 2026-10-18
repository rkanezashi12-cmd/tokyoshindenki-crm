"""東京新電機様の Zoho CRM を操作する CLI。Claude はこれ以外の経路で Zoho を呼ばない。

  python -m tsd_crm org                       接続先の組織を表示（固定前でも使える）
  python -m tsd_crm pin --yes                 表示した組織を接続先として固定（ユーザーの了承後）
  python -m tsd_crm get /crm/v8/settings/modules [--param k=v ...]
  python -m tsd_crm count Machines
  python -m tsd_crm coql "SELECT Name FROM Machines WHERE id is not null LIMIT 5"
  python -m tsd_crm write PUT /crm/v8/Machines/{id} --body '{"data":[{...}],"trigger":[]}' --allow-write
  python -m tsd_crm function-update {id} crm/scoring/functions/x.dg [--allow-write]
                                              関数のコードを更新（--allow-write が無ければ送る内容を見せるだけ）
  python -m tsd_crm exchange-code             認可コード → リフレッシュトークン（.env に保存。手元の端末で使う）
"""

import argparse
import getpass
import json
import os
import sys
import urllib.error
import urllib.parse
from pathlib import Path

from .client import (
    CONFIG_PATH, ENV_FILE, ORG_KEYS, CRMClient, GuardError, ZohoAPIError,
    check_api_domain, check_function_decl, load_config, parse_json, pin_org, read_env_file, urllib_transport,
)

ORG_SHOW = ORG_KEYS + ("zgid", "time_zone", "currency")


def dump(data):
    print(json.dumps(data, ensure_ascii=False, indent=2))


def show_org(org, cfg):
    dump({k: org.get(k) for k in ORG_SHOW})
    expected = cfg["expected_org"]
    if not all(expected.get(k) for k in ORG_KEYS):
        print("\n組織はまだ固定されていません。東京新電機様の組織だとユーザーが了承したら `python -m tsd_crm pin --yes`。",
              file=sys.stderr)
    elif all(str(org.get(k)) == str(expected[k]) for k in ORG_KEYS):
        print("\n固定した組織（東京新電機様）と一致しました。", file=sys.stderr)
    else:
        print("\n★固定した組織と一致しません。この認証情報は使わないでください。", file=sys.stderr)
        sys.exit(3)


def parse_params(pairs):
    params = {}
    for pair in pairs or []:
        key, _, value = pair.partition("=")
        params[key] = value
    return params


def load_body(text):
    path = Path(text)
    if not text.lstrip().startswith(("{", "[")) and path.exists():
        text = path.read_text(encoding="utf-8")
    return json.loads(text)


def set_env_value(name, value, path=ENV_FILE):
    lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    lines = [line for line in lines if not line.startswith(f"{name}=")]
    lines.append(f"{name}={value}")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    path.chmod(0o600)


def exchange_code(cfg):
    names = cfg["credential_env"]
    file_values = read_env_file()
    client_id = os.environ.get(names["client_id"]) or file_values.get(names["client_id"])
    client_secret = os.environ.get(names["client_secret"]) or file_values.get(names["client_secret"])
    if not client_id or not client_secret:
        raise GuardError(f"先に環境変数（または .env）に {names['client_id']} と {names['client_secret']} を設定してください")
    # クラウド環境では端末から入力できないので、環境の設定に入れた認可コードを読む（チャットに貼らせない）
    code = os.environ.get(cfg["grant_code_env"], "").strip()
    if not code:
        code = getpass.getpass("Self Client で発行した認可コード（表示されません）: ").strip()
    body = urllib.parse.urlencode({
        "grant_type": "authorization_code", "client_id": client_id,
        "client_secret": client_secret, "code": code,
    }).encode()
    status, raw = urllib_transport("POST", f"https://{cfg['accounts_host']}/oauth/v2/token",
                                   {"Content-Type": "application/x-www-form-urlencoded"}, body)
    data = parse_json(raw) or {}
    if "refresh_token" not in data:
        raise GuardError(f"交換に失敗しました: {data.get('error') or f'HTTP {status}'}（認可コードの期限は既定10分）")
    check_api_domain(data, cfg)
    set_env_value(names["refresh_token"], data["refresh_token"])
    print(f"{names['refresh_token']} を .env に保存しました。続けて接続先の組織を表示します。\n", file=sys.stderr)
    client = CRMClient(cfg, token_cache_dir=False)
    show_org(client.fetch_org(), cfg)


def main(argv=None):
    parser = argparse.ArgumentParser(prog="python -m tsd_crm", description="東京新電機様の Zoho CRM 専用 CLI")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("org", help="接続先の組織を表示する")
    p = sub.add_parser("pin", help="接続先の組織を固定する（ユーザーの了承後）")
    p.add_argument("--yes", action="store_true", help="ユーザーが東京新電機様の組織だと了承した")
    p = sub.add_parser("get", help="GET（読み取り）")
    p.add_argument("path")
    p.add_argument("--param", action="append", metavar="KEY=VALUE")
    p = sub.add_parser("count", help="レコード件数")
    p.add_argument("module")
    p = sub.add_parser("coql", help="COQL（読み取り）")
    p.add_argument("query")
    p = sub.add_parser("write", help="POST / PUT / PATCH（ユーザーの指示があるときだけ）")
    p.add_argument("method", choices=["POST", "PUT", "PATCH"])
    p.add_argument("path")
    p.add_argument("--body", required=True, help="JSON 文字列または JSON ファイルのパス")
    p.add_argument("--param", action="append", metavar="KEY=VALUE")
    p.add_argument("--allow-write", action="store_true")
    p = sub.add_parser("function-update", help="関数のコードを更新する（ユーザーの指示があるときだけ）")
    p.add_argument("function_id")
    p.add_argument("code_file")
    p.add_argument("--allow-write", action="store_true")
    sub.add_parser("exchange-code", help="認可コードをリフレッシュトークンに交換して .env に保存する")
    args = parser.parse_args(argv)

    try:
        cfg = load_config()
        if args.cmd == "exchange-code":
            exchange_code(cfg)
            return
        client = CRMClient(cfg, allow_write=getattr(args, "allow_write", False))
        if args.cmd == "org":
            show_org(client.fetch_org(), cfg)
        elif args.cmd == "pin":
            if not args.yes:
                raise GuardError("ユーザーの了承を得てから --yes を付けて実行してください")
            org = client.fetch_org()
            dump(pin_org(org, CONFIG_PATH))
            print(f"\n{CONFIG_PATH.relative_to(CONFIG_PATH.parent.parent)} に固定しました。commit してください。",
                  file=sys.stderr)
        elif args.cmd == "get":
            dump(client.get(args.path, parse_params(args.param)))
        elif args.cmd == "count":
            dump(client.count(args.module))
        elif args.cmd == "coql":
            dump(client.coql(args.query))
        elif args.cmd == "write":
            dump(client.write(args.method, args.path, load_body(args.body), parse_params(args.param)))
        elif args.cmd == "function-update":
            code = Path(args.code_file).read_text(encoding="utf-8")
            if not args.allow_write:
                # 送らずに、更新先の関数と宣言が合うかだけ確かめて見せる
                current = client.get(f"/crm/{cfg['api_version']}/settings/functions/{args.function_id}")["functions"][0]
                check_function_decl(code, current)
                dump({k: current.get(k) for k in ("id", "api_name", "name", "category", "modified_time")})
                print(f"\n送る内容：上の関数のコードを {args.code_file}（{len(code.splitlines())} 行）に置き換える。"
                      "送るときは --allow-write を付ける", file=sys.stderr)
                return
            dump(client.update_function(args.function_id, code))
    except GuardError as e:
        print(f"中断：{e}", file=sys.stderr)
        sys.exit(2)
    except ZohoAPIError as e:
        print(f"Zoho API エラー：{e}", file=sys.stderr)
        sys.exit(1)
    except urllib.error.URLError as e:
        print(f"Zoho に接続できません：{e.reason}。クラウド環境の Network access で "
              f"{cfg['accounts_host']} と {cfg['api_host']} を許可しているか確かめてください（docs/setup.md）",
              file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
