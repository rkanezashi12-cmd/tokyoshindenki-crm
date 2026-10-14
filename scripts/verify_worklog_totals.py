"""工数の数字の突き合わせ（読み取りだけ）。工数ダッシュボードが集計する明細が、CRM の他の合計と一致するかを見る。

  python3 scripts/verify_worklog_totals.py

確かめること：
  1. 工数明細（WorkLogItems）を月ごとに取り切った件数が、CRM の件数と一致する（取りこぼし・重複が無い）
  2. 明細の工数の合計 ＝ 工数入力（WorkLogs）の「合計工数(h)」の合計 ＝ ZPタスクの「CRM実績工数(h)」の合計
  3. 工数入力1件ごとに、合計工数・明細件数が明細と一致する
  4. ZPタスク1件ごとに、CRM実績工数が明細の合計と一致する

Zoho には `python -m tsd_crm` だけでつなぐ（組織の照合つき。CLAUDE.md ルール8）。書き込みはしない。
一致しないものがあれば終了コード 1。出力にはレコード ID と日付だけを出し、氏名は出さない（ルール6）。
"""

import collections
import datetime
import json
import subprocess
import sys

# この突き合わせで使う CRM の API 名（ウィジェットの分は widgets/worklog-dashboard/app/config.js）
API = {
    "items": "WorkLogItems",        # 工数明細（サブフォーム）
    "item_hours": "Hours",
    "item_parent": "Parent_Id",
    "item_date": "Parent_Id.Work_Date",
    "item_task": "ZP_Task",
    "logs": "WorkLogs",             # 工数入力
    "log_date": "Work_Date",
    "log_total": "Total_Hours",
    "log_count": "Item_Count",
    "tasks": "ZPTasks",             # ZPタスク
    "task_actual": "Actual_Hours",
}
PAGE, MAX_OFFSET = 200, 2000


def tsd(*args):
    r = subprocess.run([sys.executable, "-m", "tsd_crm", *args], capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit("tsd_crm が中断しました：\n" + r.stderr[-800:])
    return r.stdout


def coql_all(select, module, where):
    """where に合う行を 200 件ずつ取り切る。OFFSET の上限を超えたら止める（呼ぶ側で期間を分ける）"""
    rows, offset = [], 0
    while True:
        out = tsd("coql", f"select {select} from {module} where {where} order by id asc limit {PAGE} offset {offset}")
        i, j = out.find("["), out.rfind("]")
        page = json.loads(out[i:j + 1]) if i >= 0 else []
        rows += page
        if len(page) < PAGE:
            return rows
        offset += PAGE
        if offset >= MAX_OFFSET:
            sys.exit(f"{module} の {where} が {MAX_OFFSET} 件を超えました。期間を分けてください")


def count(module):
    out = tsd("count", module)
    return json.loads(out[out.find("{"):out.rfind("}") + 1])["count"]


def months(first, last):
    cur = first.replace(day=1)
    while cur <= last:
        nxt = (cur + datetime.timedelta(days=32)).replace(day=1)
        yield cur, min(nxt - datetime.timedelta(days=1), last)
        cur = nxt


def main():
    a = API
    ok_all = True

    def report(ok, text):
        nonlocal ok_all
        ok_all = ok_all and ok
        print(("OK  " if ok else "NG  ") + text)

    logs = coql_all(f"{a['log_date']}, {a['log_total']}, {a['log_count']}", a["logs"], "id is not null")
    dates = sorted(l[a["log_date"]] for l in logs if l[a["log_date"]])
    if not dates:
        sys.exit("工数入力がありません")
    first, last = datetime.date.fromisoformat(dates[0]), datetime.date.fromisoformat(dates[-1])

    items = []
    for f, t in months(first, last):
        items += coql_all(f"{a['item_hours']}, {a['item_parent']}, {a['item_date']}, {a['item_task']}", a["items"],
                          f"{a['item_date']} >= '{f}' and {a['item_date']} <= '{t}'")
    n_items = count(a["items"])
    print(f"期間 {first}〜{last}　工数入力 {len(logs)} 件　工数明細 {len(items)} 件")

    report(len(items) == n_items, f"明細を月ごとに取った件数 {len(items)} ＝ CRM の件数 {n_items}")
    report(len({i['id'] for i in items}) == len(items), "明細の重複なし")
    empty = [i["id"] for i in items if i[a["item_hours"]] is None]
    if empty:
        print(f"    参考：工数が空の明細 {len(empty)} 件（0h として数える）: {', '.join(empty)}")

    h = lambda v: v or 0
    total = sum(h(i[a["item_hours"]]) for i in items)
    log_total = sum(h(l[a["log_total"]]) for l in logs)
    tasks = coql_all(a["task_actual"], a["tasks"], f"{a['task_actual']} > 0")
    task_total = sum(h(t[a["task_actual"]]) for t in tasks)
    report(abs(total - log_total) < 1e-6, f"明細の合計 {total:g}h ＝ 工数入力の合計工数の合計 {log_total:g}h")
    report(abs(total - task_total) < 1e-6, f"明細の合計 {total:g}h ＝ ZPタスクの CRM実績工数の合計 {task_total:g}h")

    by_log = collections.defaultdict(lambda: [0.0, 0])
    for i in items:
        p = i[a["item_parent"]]["id"]
        by_log[p][0] += h(i[a["item_hours"]])
        by_log[p][1] += 1
    bad = [l for l in logs
           if abs(by_log[l["id"]][0] - h(l[a["log_total"]])) > 1e-6 or by_log[l["id"]][1] != h(l[a["log_count"]])]
    report(not bad, f"工数入力ごとの合計工数・明細件数が明細と一致（不一致 {len(bad)} / {len(logs)} 件）")
    for l in bad:
        print(f"    工数入力 {l['id']}（{l[a['log_date']]}）: 合計工数 {l[a['log_total']]} / 明細 {by_log[l['id']][0]:g}"
              f"　明細件数 {l[a['log_count']]} / {by_log[l['id']][1]}")

    by_task = collections.defaultdict(float)
    for i in items:
        if i[a["item_task"]]:
            by_task[i[a["item_task"]]["id"]] += h(i[a["item_hours"]])
    actual = {t["id"]: h(t[a["task_actual"]]) for t in tasks}
    bad = sorted(k for k in set(actual) | set(by_task) if abs(actual.get(k, 0) - by_task.get(k, 0)) > 1e-6)
    report(not bad, f"ZPタスクごとの CRM実績工数が明細の合計と一致（不一致 {len(bad)} / {len(set(actual) | set(by_task))} 件）")
    for k in bad:
        print(f"    ZPタスク {k}: CRM実績工数 {actual.get(k, 0):g} / 明細 {by_task.get(k, 0):g}")

    print("\nすべて一致しました。" if ok_all else "\n一致しないものがあります。")
    return 0 if ok_all else 1


if __name__ == "__main__":
    sys.exit(main())
