#!/usr/bin/env python3
"""Закрытие issues с комментарием (утилита поставки).

Использование: python3 scripts/gh_close_issues.py 14 15
Токен берётся из git remote origin (как в gh_board_setup.py).
Комментарий задаётся переменной окружения CLOSE_COMMENT (один на все).
"""
import json
import os
import re
import sys
import urllib.request

GH = 'https://api.github.com'
OWNER = 'bestdeejay-design'
REPO = 'alien-cosmic'


def token():
    # токен живёт в remote origin (см. инструкцию gh_board_setup.py);
    # безавторизационные запросы к API упираются в rate limit
    url = os.popen('git remote get-url origin').read().strip()
    m = re.search(r'//([^@]+)@', url)
    if not m:
        sys.exit('нет токена в remote origin')
    return m.group(1)


def req(method, path, body=None):
    r = urllib.request.Request(GH + path, method=method,
        headers={'Authorization': f'Bearer {token()}', 'Accept': 'application/vnd.github+json'},
        data=json.dumps(body).encode() if body is not None else None)
    with urllib.request.urlopen(r) as res:
        raw = res.read()
        return json.loads(raw) if raw else {}


def main():
    comment = os.environ.get('CLOSE_COMMENT', '').strip()
    if not comment:
        sys.exit('задай CLOSE_COMMENT="..."')
    for num in sys.argv[1:]:
        base = f'/repos/{OWNER}/{REPO}/issues/{num}'
        issue = req('GET', base)
        if issue.get('state') == 'closed':
            print(f'#{num} уже закрыт — пропуск')
            continue
        # идемпотентность: такой же комментарий мог уйти в прошлой попытке
        if not any((c.get('body') or '').strip() == comment
                   for c in req('GET', base + '/comments?per_page=100')):
            req('POST', base + '/comments', {'body': comment})
        req('PATCH', base, {'state': 'closed'})
        print(f'#{num} закрыт с комментарием')


if __name__ == '__main__':
    main()
