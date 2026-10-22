#!/usr/bin/env python3
"""Проверка активности на GitHub: открытые issues, свежие комментарии, PR.
Идемпотентный read-only скрипт. Токен берётся из remote URL (как в gh_board_sync.py)."""
import json
import re
import subprocess
import sys
import urllib.request

REMOTE = subprocess.run(
    ['git', 'remote', 'get-url', 'origin'],
    capture_output=True, text=True, cwd='/home/z/my-project/alien-cosmic'
).stdout.strip()
m = re.search(r'https://([^@]+)@', REMOTE)
TOKEN = m.group(1) if m else None
REPO = 'bestdeejay-design/alien-cosmic'

HEADERS = {
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'zai-board-check',
}
if TOKEN:
    HEADERS['Authorization'] = f'Bearer {TOKEN}'


def req(method, path, body=None):
    url = f'https://api.github.com{path}'
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method, headers=HEADERS)
    try:
        with urllib.request.urlopen(r) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        print(f'  !! HTTP {e.code} on {method} {path}: {e.read().decode()[:200]}')
        return None


print('=== Открытые issues ===')
issues = req('GET', f'/repos/{REPO}/issues?state=open&per_page=30')
if issues:
    for i in issues:
        if 'pull_request' in i:
            kind = 'PR'
        else:
            kind = 'issue'
        print(f"  #{i['number']} [{kind}] {i['state']} | {i['updated_at']} | {i['title'][:70]}")

print()
print('=== Свежие комментарии (последние 10 по всем issues) ===')
all_issues = req('GET', f'/repos/{REPO}/issues?state=all&sort=updated&direction=desc&per_page=15')
events = []
if all_issues:
    for i in all_issues:
        n = i['number']
        cs = req('GET', f'/repos/{REPO}/issues/{n}/comments?per_page=100')
        if cs:
            for c in cs:
                events.append((c['created_at'], n, c['user']['login'], c['body']))
events.sort(reverse=True)
for ts, n, user, body in events[:10]:
    first = body.strip().splitlines()[0][:110] if body.strip() else '(пусто)'
    print(f"  {ts} #{n} @{user}: {first}")

print()
print('=== Открытые PR ===')
prs = req('GET', f'/repos/{REPO}/pulls?state=open&per_page=20')
if prs is not None:
    if not prs:
        print('  (нет открытых PR)')
    for p in prs:
        print(f"  PR #{p['number']} | {p['updated_at']} | {p['title'][:70]} | head={p['head']['ref']}")
