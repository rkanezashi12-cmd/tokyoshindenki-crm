#!/usr/bin/env python3
"""PreToolUse フック：東京新電機様以外の Zoho 環境に触れる経路を塞ぐ。

このリポジトリでは Zoho への接続は `python -m tsd_crm`（組織を照合してから呼ぶ）だけに限る。
- Zoho / CRM の MCP コネクタ（アカウントに接続済みの他社の環境につながっている）は使わせない
- Bash や WebFetch で Zoho の API・認証のホストを直接叩かせない（公式ドキュメントの閲覧は可）
終了コード 2 で止めると、stderr の文が Claude に返る。
"""

import json
import re
import sys

ZOHO_API_HOST = re.compile(
    r"(zohoapis\.[a-z.]+|zohomcp\.[a-z.]+|"
    r"(accounts|upload|crm|crmplus|api-console|projectsapi|creator|creatorapp|workdrive)\.zoho\.[a-z.]+)",
    re.I,
)
# 文書の編集などで Zoho のホスト名を書くだけのコマンドは通し、通信する道具と一緒のときだけ止める
NETWORK_IN_SHELL = re.compile(
    r"\b(curl|wget|httpie|xh|nc|ncat|telnet|aria2c)\b|s_client|urllib|requests\.|http\.client|httpx"
    r"|fetch\(|axios|Invoke-WebRequest|Invoke-RestMethod",
    re.I,
)
MCP_ZOHO = re.compile(r"zoho|crm", re.I)


def block(reason):
    print(reason, file=sys.stderr)
    sys.exit(2)


def main():
    event = json.load(sys.stdin)
    tool = event.get("tool_name", "")
    tool_input = event.get("tool_input") or {}

    if tool.startswith("mcp__") and MCP_ZOHO.search(tool):
        block(
            f"{tool} は使えません。このリポジトリでは Zoho の MCP コネクタを使いません"
            "（他社の Zoho 環境につながっている可能性があり、組織を照合できないため）。"
            "東京新電機様の CRM には `python -m tsd_crm` で接続してください。"
        )
    if tool == "WebFetch" and ZOHO_API_HOST.search(str(tool_input.get("url", ""))):
        block("Zoho の API・認証のホストは WebFetch で開けません。`python -m tsd_crm` を使ってください。")
    if tool == "Bash":
        command = str(tool_input.get("command", ""))
        if ZOHO_API_HOST.search(command) and NETWORK_IN_SHELL.search(command):
            block(
                "Zoho の API・認証のホストを直接呼ぶコマンドは止めました。"
                "組織の照合（実行前ガード）を通すため `python -m tsd_crm` を使ってください。"
            )


if __name__ == "__main__":
    main()
