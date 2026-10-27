#!/usr/bin/env python3
"""Комментарий в issue #35: GO владельца на ПКМ-лечение, P3 финализирована.
Идемпотентен: ищет свой маркер среди комментариев перед постингом."""
import json
import re
import subprocess
import urllib.request
from pathlib import Path

REMOTE = subprocess.run(
    ['git', 'remote', 'get-url', 'origin'],
    capture_output=True, text=True,
    cwd=str(Path(__file__).resolve().parent.parent)
).stdout.strip()
m = re.search(r'https://([^@]+)@', REMOTE)
TOKEN = m.group(1) if m else None
REPO = 'bestdeejay-design/alien-cosmic'
ISSUE = 35
MARKER = 'HEAL-RMB-GO-1026'

HEADERS = {'Accept': 'application/vnd.github+json', 'User-Agent': 'zai-coordinator'}
if TOKEN:
    HEADERS['Authorization'] = f'Bearer {TOKEN}'


def req(method, path, body=None):
    url = f'https://api.github.com{path}'
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method, headers=HEADERS)
    with urllib.request.urlopen(r) as resp:
        return json.loads(resp.read().decode())


comments = req('GET', f'/repos/{REPO}/issues/{ISSUE}/comments?per_page=100')
if any(MARKER in (c.get('body') or '') for c in comments or []):
    print('OK: маркер уже есть, дубль не постим (идемпотентно)')
    raise SystemExit(0)

body = f"""## Решение владельца 26.10 (поздний вечер): ПКМ «лечить» — GO

Ответ получен дословно: **«да — всё делаем симметрично»**. Пункт добавлен в объём P3.

**Состав P3 (финализирован, одна поставка):**
- [ ] З2 (#33): конфликт модалок + Escape
- [ ] З3 (#33): тост тихой неудачи сейва с антифлудом
- [ ] Кросс-браузер ник+пин (база видна из другого браузера)
- [ ] R1: фильтр пула хилов по расе цели в `updateAutoHeal`
- [ ] **ПКМ-приказ хилу «лечить»** — симметрично ремонту по ПКМ: ветка в `orderRightClick` после B3, `orderHeal(auto:false)` для хилов выделения, не-хилы — `orderMove`, раскладка — зеркало `orderRepairSpread` (G.4), при «нельзя лечить» — тихое движение. Без новых кнопок (канон «всё через мир»).

База — свежий `origin/main` (кончик `6ea27e7`), стемп единым, поставка = письмо с диапазоном.
Полная спека ПКМ-лечения — в `design/ARENA_MAILBOX.md`, письмо «2026-10-26 · 2».

<!-- {MARKER} -->
"""

req('POST', f'/repos/{REPO}/issues/{ISSUE}/comments', {'body': body})
print(f'OK: комментарий с маркером {MARKER} отправлен в issue #{ISSUE}')
