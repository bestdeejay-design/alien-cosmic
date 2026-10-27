#!/usr/bin/env python3
"""Issue #43: админка «Масштаб цен» не применяется (баг владельца 26.10, репро SZ).
Идемпотентен: маркер + листинг, дубль не создаём (урок #37–#41)."""
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
MARKER = 'ECON-ADMIN-BUG-1026'

HEADERS = {'Accept': 'application/vnd.github+json', 'User-Agent': 'zai-coordinator'}
if TOKEN:
    HEADERS['Authorization'] = f'Bearer {TOKEN}'


def req(method, path, body=None):
    url = f'https://api.github.com{path}'
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method, headers=HEADERS)
    with urllib.request.urlopen(r) as resp:
        return json.loads(resp.read().decode())


issues = req('GET', f'/repos/{REPO}/issues?state=all&per_page=100')
exists = [i for i in issues if MARKER in (i.get('body') or '')]
if exists:
    print(f'карточка уже существует: #{exists[0]["number"]} — не создаём дубль')
    raise SystemExit(0)

title = 'Админка: «Масштаб цен» не применяется — admin.js пишет ac_econ_scale, economy.js читает только ?econ= (репро SZ, фича сломана с Э6)'
body = f"""<!-- {MARKER} -->
## Жалоба владельца (26.10, ночь)

«а настройки цен в админке? …я не понимаю но настройка не работает» — выставляет масштаб,
жмёт «Применить и перезагрузить», цены не меняются.

## Репро SZ (подтверждено вживую, `scripts/ac_sz_econ_admin_check.mjs`)

- Т1: без настроек `ECON_SCALE = 1` — норма.
- **Т2 (сценарий владельца): `localStorage['ac_econ_scale']='0.5'` → перезагрузка →
  `ECON_SCALE` остаётся `1`. БАГ.**
- Т3: `?econ=0.1` в адресе — работает (`ECON_SCALE = 0.1`).
- Т4: localStorage + URL → берётся URL (сам приоритет честный, но localStorage вообще не читается).

## Корень

Админка (Э6, `admin.js`) пишет `localStorage['ac_econ_scale']` (`ECON_KEY`) и перезагружает
страницу; **`economy.js: readScale()` читает ТОЛЬКО `?econ=` из URL и никогда не смотрит в
localStorage** — потребителя ключа в коде нет вовсе (проверено grep). Диагностика в админке
показывает значение из localStorage — таблица врёт, «Масштаб цен: 0.5×» при реально
действующей 1×. Фича родилась сломанной: панель добавлена в Э6 позже экономики Э1+Э2, связку
не сделали; регресс приёмки Э-серии этого не ловил.

## Спека (P2, маленькая — можно одной поставкой с #42)

1. `readScale()`: приоритет `?econ=` (как заявлено в подсказке админки), затем
   `localStorage['ac_econ_scale']`, затем 1. Клампы: URL — как сейчас (0.01–100),
   localStorage — диапазон слайдера 0.02–2.
2. Диагностика: показывать **фактически действующий** `ECON_SCALE`; если сработал
   URL-override — пометить («0.1× (из адреса)»), чтобы таблица не врала.
3. Самопроверка: гейт в `check_r` — выставить LS → reload → `ECON_SCALE` == заданному; с
   `?econ=` → приоритет URL; чистый LS без URL → 1. (Этот класс багов больше не проходит
   приёмку молча.)

— Super Z (подмена ZCode)"""
created = req('POST', f'/repos/{REPO}/issues', {'title': title, 'body': body})
print(f'карточка создана: #{created["number"]}')
