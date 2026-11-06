#!/usr/bin/env python3
"""Мок `gh` для поведенческих тестов scripts/wait-signal (tests/test_wait_signal.py).

Эмулирует только подмножество gh api, которое использует wait-signal:
  gh auth status
  gh api -i URL [--jq EXPR] [-H "If-None-Match: ..."]   (условные чтения)
  gh api URL --jq EXPR                                   (labels / claim-выборки)
  gh api URL -f body=... --jq .id                        (POST комментария)
  gh api -X PATCH URL -f "labels[]=..."                  (перевод labels)
  gh api -X DELETE repos/.../issues/comments/ID          (откат своего claim)

Состояние и сценарий передаются через env:
  WS_MOCK_STATE    — путь к JSON-состоянию (мок читает И пишет: POST/PATCH/DELETE,
                     счётчики вызовов, число отданных 304);
  WS_MOCK_SCENARIO — путь к JSON-сценарию (только читается):
    {
      "issue_404": true,                       # чтение issue отвечает 404
      "fail_once": ["comments?per_page"],      # URL-подстроки: первый вызов — HTTP 502
      "race": {"on_query": 2, "created_at": ..., "first": "✋ CLAIM ..."}
                                               # на N-м claim-запросе впрыснуть чужой
                                               # комментарий (гонка претендентов)
    }
Сетевые ответы имитируются заголовком HTTP/2 и кодом выхода, как у реального gh
(304 и ошибки — ненулевой выход, статус читается из заголовков).
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
from datetime import datetime, timezone

STATE_PATH = os.environ["WS_MOCK_STATE"]
SCENARIO_PATH = os.environ.get("WS_MOCK_SCENARIO", "")


def load(path, default):
    if path and os.path.exists(path):
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    return default


def save_state(state):
    with open(STATE_PATH, "w", encoding="utf-8") as fh:
        json.dump(state, fh, ensure_ascii=False)


def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def respond_200(headers_mode, etag, body):
    if headers_mode:
        sys.stdout.write(
            "HTTP/2 200\r\ncontent-type: application/json\r\n"
            f'etag: "{etag}"\r\n\r\n{body}'
        )
    else:
        sys.stdout.write(body)
    return 0


def respond_status(headers_mode, status, exit_code):
    if headers_mode:
        sys.stdout.write(f"HTTP/2 {status}\r\ncontent-type: application/json\r\n\r\n")
    return exit_code


def main():
    state = load(STATE_PATH, {
        "labels": [], "updated_at": "", "body_first": "",
        "comments": [], "checks": {"total_count": 0, "runs": []},
        "next_id": 101, "calls": 0, "not_modified_served": 0, "fail_left": {},
    })
    scenario = load(SCENARIO_PATH, {})
    argv = sys.argv[1:]

    if argv[:2] == ["auth", "status"]:
        return 0
    if argv[:1] != ["api"]:
        sys.stderr.write("mock gh: поддержан только gh api\n")
        return 2

    headers_mode = False
    method = "GET"
    url = ""
    jq = ""
    if_none_match = ""
    fields = []  # (key, value)
    rest = argv[1:]
    i = 0
    while i < len(rest):
        arg = rest[i]
        if arg == "-i":
            headers_mode = True
        elif arg == "-X":
            method = rest[i + 1]
            i += 1
        elif arg == "-H":
            if rest[i + 1].lower().startswith("if-none-match:"):
                if_none_match = rest[i + 1].split(":", 1)[1].strip()
            i += 1
        elif arg == "--jq":
            jq = rest[i + 1]
            i += 1
        elif arg == "-f":
            fields.append(rest[i + 1])
            i += 1
        elif arg == "-F":
            fields.append(rest[i + 1])
            i += 1
        elif not arg.startswith("-") and not url:
            url = arg
        i += 1
    if not fields and method == "GET" and jq and not headers_mode:
        pass  # обычное чтение с --jq

    state["calls"] += 1

    # --- временный сбой: первый вызов по URL-подстроке отвечает 502 ---
    for needle in scenario.get("fail_once", []):
        key = f"fail:{needle}"
        left = state["fail_left"].get(key, 1)
        if needle in url and left > 0:
            state["fail_left"][key] = left - 1
            save_state(state)
            return respond_status(headers_mode, 502, 18)

    # --- POST комментария (claim) ---
    if method == "GET" and fields and url.endswith("/comments"):
        body = dict(f.split("=", 1) for f in fields).get("body", "")
        first = body.split("\n")[0]
        cid = state["next_id"]
        state["next_id"] += 1
        state["comments"].append({"id": cid, "created_at": now_iso(), "first": first})
        save_state(state)
        sys.stdout.write(json.dumps({"id": cid}))
        return 0
    if method == "POST" and fields:
        body = dict(f.split("=", 1) for f in fields).get("body", "")
        first = body.split("\n")[0]
        cid = state["next_id"]
        state["next_id"] += 1
        state["comments"].append({"id": cid, "created_at": now_iso(), "first": first})
        save_state(state)
        sys.stdout.write(json.dumps({"id": cid}))
        return 0

    # --- PATCH labels ---
    if method == "PATCH":
        labels = [f.split("=", 1)[1] for f in fields if f.startswith("labels[]=")]
        if labels:
            state["labels"] = labels
            state["updated_at"] = now_iso()
            save_state(state)
        sys.stdout.write("{}")
        return 0

    # --- DELETE своего claim-комментария ---
    if method == "DELETE":
        cid = int(url.rstrip("/").split("/")[-1])
        state["comments"] = [c for c in state["comments"] if c["id"] != cid]
        save_state(state)
        sys.stdout.write("{}")
        return 0

    m_issue = url.split("?")[0]
    parts = m_issue.split("/")
    query = url.split("?")[1] if "?" in url else ""

    # --- чтение claim-выборок: sort=created&direction=desc ---
    if "sort=created&direction=desc" in query:
        comments = sorted(state["comments"], key=lambda c: c["created_at"], reverse=True)
        race = scenario.get("race")
        if race and state["calls"] >= race["on_query"] and "CLAIM" in jq:
            if not any(c["first"] == race["first"] for c in state["comments"]):
                state["comments"].append({
                    "id": state["next_id"], "created_at": race["created_at"],
                    "first": race["first"],
                })
                state["next_id"] += 1
                comments = sorted(state["comments"], key=lambda c: c["created_at"], reverse=True)
        if "RECLAIMED" in jq:
            hits = [c["created_at"] for c in comments if c["first"].startswith("♻️ RECLAIMED")]
            sys.stdout.write(hits[0] if hits else "")
            save_state(state)
            return 0
        # CLAIM-выборка: .[-1] по desc-порядку — самый ранний (олдейший) claim
        hits = [(c["created_at"], c["first"]) for c in comments if c["first"].startswith("✋ CLAIM")]
        if not hits:
            sys.stdout.write("")
        elif '.created_at + "\\t"' in jq:
            sys.stdout.write(f"{hits[-1][0]}\t{hits[-1][1]}")
        else:
            sys.stdout.write(hits[-1][1])
        save_state(state)
        return 0

    # --- само issue ---
    if m_issue.endswith(f"/issues/{parts[-1]}") and "comments" not in m_issue:
        if scenario.get("issue_404"):
            return respond_status(headers_mode, 404, 1)
        if not headers_mode and "[.labels[].name] | join(\",\")" in jq:
            sys.stdout.write(",".join(state["labels"]))
            return 0
        body = (
            f"LABELS\t{','.join(state['labels'])}\n"
            f"UPDATED\t{state['updated_at']}\n"
            f"FIRST\t{state['body_first']}\n"
        )
        return conditional(headers_mode, if_none_match, state, body, m_issue)

    # --- комментарии, постранично (per_page=100&page=N, asc по created_at) ---
    if "/comments" in m_issue:
        comments = sorted(state["comments"], key=lambda c: c["created_at"])
        page = int(dict(p.split("=", 1) for p in query.split("&")).get("page", "1"))
        chunk = comments[(page - 1) * 100: page * 100]
        body = "".join(f"{c['created_at']}\t{c['first']}\n" for c in chunk)
        return conditional(headers_mode, if_none_match, state, body, f"{m_issue}?p{page}")

    # --- check-runs коммита, постранично ---
    if "/check-runs" in m_issue:
        runs = state["checks"]["runs"]
        page = int(dict(p.split("=", 1) for p in query.split("&")).get("page", "1"))
        chunk = runs[(page - 1) * 100: page * 100]
        body = f"TOTAL\t{state['checks']['total_count']}\n" + "".join(
            f"{r['status']}\t{r['conclusion']}\t{r['updated_at']}\n" for r in chunk
        )
        return conditional(headers_mode, if_none_match, state, body, f"{m_issue}?p{page}")

    sys.stderr.write(f"mock gh: URL не поддержан: {url}\n")
    return 2


def conditional(headers_mode, if_none_match, state, body, key):
    etag = hashlib.md5(body.encode()).hexdigest()[:16]
    if if_none_match and if_none_match.strip('"') == etag:
        state["not_modified_served"] += 1
        save_state(state)
        return respond_status(headers_mode, 304, 22)
    state.setdefault("etags", {})[key] = etag
    save_state(state)
    return respond_200(headers_mode, etag, body)


if __name__ == "__main__":
    sys.exit(main())
