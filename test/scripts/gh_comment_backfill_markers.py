#!/usr/bin/env python3
"""gh_comment_backfill_markers.py — добавление <!-- MARKER --> в уже существующие
комментарии борда (после дедупликации), чтобы скрипты стали по-настоящему
идемпотентными. Идемпотентен сам: маркер не добавляется дважды."""
import json, re, subprocess, sys, urllib.request

OWNER = 'bestdeejay-design'
REPO = f'{OWNER}/alien-cosmic'
GH = 'https://api.github.com'

MARKERS = {  # issue -> [(comment_id, marker)] — по списку после gh_comment_dedupe.py
    7:  'A-1-ACCEPTED-5d78c20',
    5:  'A3-RESEARCH-DELIVERED|A3-V2-NO-CHANGE',
    25: 'A3-RESEARCH-DELIVERED|A3-V2-ASYNC-RAID',
    16: 'ARENA-ENV-CONFIRMED',
    17: 'CREDENTIAL-COUPLING-CONFIRMED',
}

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

def first_line(body):
    b = re.sub(r'<!--.*?-->', '', body, flags=re.S).strip()
    return ' '.join(b.split('\n')[0].split())[:60]

for num, spec in MARKERS.items():
    want = spec.split('|')
    cs = req('GET', f'/repos/{REPO}/issues/{num}/comments?per_page=100')
    by_fl = {}
    for c in cs:
        if '<!--' in c['body']:
            continue  # уже размечен
        fl = first_line(c['body'])
        by_fl[fl] = c
    for marker in want:
        match = next((c for fl, c in by_fl.items() if fl.startswith(marker.split('-')[0].lower()) or True), None)
        # сопоставляем по содержимому: маркер описывает свежий комментарий первого вида
        pass
    # проще: размечаем по порядку — сколько want, столько неразмеченных последних добавленных нами
    untagged = [c for c in cs if '<!--' not in c['body']]
    # связываем маркеры с комментариями по ключевым словам первой строки
    KEY = {
        'A-1-ACCEPTED-5d78c20': 'A-1 принят',
        'A3-RESEARCH-DELIVERED': 'Ресерч A-3',
        'A3-V2-NO-CHANGE': 'Уточнение направления (async raid) не меняет',
        'A3-V2-ASYNC-RAID': 'Направление обновлено',
        'ARENA-ENV-CONFIRMED': 'Ограничение среды',
        'CREDENTIAL-COUPLING-CONFIRMED': 'Подтверждено A-1',
    }
    for marker in want:
        kw = KEY[marker]
        c = next((c for c in untagged if kw.lower() in c['body'].lower()), None)
        if not c:
            print(f'#{num}: для {marker} не найден комментарий — пропуск')
            continue
        if marker in c['body']:
            print(f'#{num}: {marker} уже в теле'); continue
        req('PATCH', f'/repos/{REPO}/issues/comments/{c["id"]}',
            {'body': f'<!-- {marker} -->\n\n{c["body"]}'})
        untagged.remove(c)
        print(f'#{num}: {marker} → коммент {c["id"]}')
print('готово')
