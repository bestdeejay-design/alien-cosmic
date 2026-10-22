#!/usr/bin/env python3
"""gh_comment_dedupe.py — удаление дубликатов комментариев борда (инцидент маркеров).

Причина: маркер идемпотентности был только в коде скрипта, не в теле комментария —
проверка его не находила и POST повторялся. Оставляем самый ранний комментарий каждой
сигнатуры (первая строка), остальные удаляем. После чистки скрипты переведены на
<!-- MARKER --> в теле.
"""
import json, re, subprocess, sys, urllib.request

OWNER = 'bestdeejay-design'
REPO = f'{OWNER}/alien-cosmic'
GH = 'https://api.github.com'

def token():
    u = subprocess.run(['git', 'remote', 'get-url', 'origin'], capture_output=True, text=True).stdout.strip()
    m = re.match(r'https://(?:[^:]+:)?([^@]+)@github\.com/', u)
    if not m: sys.exit('нет токена в remote')
    return m.group(1)

TOK = token()

def req(method, path, body=None):
    r = urllib.request.Request(GH + path, method=method,
        headers={'Authorization': f'Bearer {TOK}', 'Accept': 'application/vnd.github+json'},
        data=json.dumps(body).encode() if body is not None else None)
    with urllib.request.urlopen(r) as res:
        raw = res.read()
        return json.loads(raw) if raw else {}

def sig(body):
    b = re.sub(r'<!--.*?-->', '', body, flags=re.S).strip()
    return ' '.join(b.split('\n')[0].split())[:80]

total_del = 0
for num in (5, 25, 16, 17):
    cs = req('GET', f'/repos/{REPO}/issues/{num}/comments?per_page=100')
    seen = {}
    for c in sorted(cs, key=lambda x: x['created_at']):
        s = sig(c['body'])
        if s in seen:
            req('DELETE', f'/repos/{REPO}/issues/comments/{c["id"]}')
            total_del += 1
            print(f'#{num}: удалён дубликат {c["id"]} ({c["created_at"]}) — {s[:50]}')
        else:
            seen[s] = c['id']
    print(f'#{num}: осталось {len(seen)} уникальных')

print(f'\nудалено всего: {total_del}')
