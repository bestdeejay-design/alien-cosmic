#!/usr/bin/env python3
"""Issue-операции 26.10 ночь+ (приёмка P3+#36):
1) закрыть #35 (P1/P2/P3 доставлены и приняты) с комментарием-вердиктом;
2) закрыть #36 (З1/З2/З3 в поставке 541177a, FIX-блоки зелёные) с комментарием;
3) открыть новую карточку safe-mode boot + текст тоста З3 (маркер, идемпотентно).
Все шаги идемпотентны: маркеры + листинг + минимальный номер (урок дублей #37–#41)."""
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
MARKER_35 = 'P3-ACCEPT-1026'
MARKER_36 = 'E36-ACCEPT-1026'
MARKER_NEW = 'SAFEMODE-CARD-1026'

HEADERS = {'Accept': 'application/vnd.github+json', 'User-Agent': 'zai-coordinator'}
if TOKEN:
    HEADERS['Authorization'] = f'Bearer {TOKEN}'


def req(method, path, body=None):
    url = f'https://api.github.com{path}'
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method, headers=HEADERS)
    with urllib.request.urlopen(r) as resp:
        return json.loads(resp.read().decode())


def has_marker(issues_comments, marker):
    return any(marker in (c.get('body') or '') for c in issues_comments or [])


# ---------- 1) #35: комментарий + close ----------
c35 = req('GET', f'/repos/{REPO}/issues/35/comments?per_page=100')
if not has_marker(c35, MARKER_35):
    body35 = f"""<!-- {MARKER_35} -->
## Вердикт SZ: #35 выполнен полностью — P1 + P2 + P3 доставлены и приняты

- **P1 «Профиль и вход»** (`0256b23`): клавиатура в полях, ноль сети без профиля, админка только `best`.
- **P2 «Дом»** (`9c88282` + правка по слову владельца `b603840`): аура Г4+ только в рейде и только существам своей расы; лечат хилы (диспетчер КЦ ≤2 авто-хила, тяжелейший первым, без КЦ — само-скан); ремонт — сборщики, включая сборщиков; приказ игрока неприкосновенен.
- **P3** (`3eab3d2` + `541177a`): З2 модалки+Escape (`modals.js`), З3 тост тихой неудачи сейва с антифлудом, кросс-браузер ник+пин (`__saveReady`), R1 фильтр пула хилов по расе, ПКМ-«лечить» (`orderHealSpread`, симметрично ремонту, по GO владельца).
- Регресс SZ на `541177a`: check ✓, i18n 348 RU/EN 1:1 ✓, economy20 ✓, check_r 18 гейтов ✓, 25/25 симов ✓. Слияние в main: `663c30a`.

Закрываю. Хвосты (safe-mode boot, текст тоста) — в новой карточке.
— Super Z (подмена ZCode)"""
    req('POST', f'/repos/{REPO}/issues/35/comments', {'body': body35})
    print('#35: комментарий posted')
else:
    print('#35: маркер уже есть')
i35 = req('GET', f'/repos/{REPO}/issues/35')
if i35.get('state') == 'open':
    req('PATCH', f'/repos/{REPO}/issues/35', {'state': 'closed'})
    print('#35: closed')
else:
    print('#35: уже закрыт')

# ---------- 2) #36: комментарий + close ----------
c36 = req('GET', f'/repos/{REPO}/issues/36/comments?per_page=100')
if not has_marker(c36, MARKER_36):
    body36 = f"""<!-- {MARKER_36} -->
## Вердикт SZ: #36 выполнен — З1/З2/З3 в поставке `541177a`, слита в main (`663c30a`)

- **З1 (P1) эвакуация без дедлока:** отсек = на борту (`boardHouseGarrison` флеш в `raidBoarded`), `aliveLeft` по полевым, press 1 снимает приказы у ВСЕХ полевых (`orderEvacHold`, вкл. стоявших в кольце с добычей — репро-находка подтверждена), **press 2 = ВСЕГДА взлёт** (канон владельца; `boardRingNow` без удержания 2с, отчёт честно показывает «на борту n/sent»). Веток «отмена»/«финальный сбор» нет.
- **З2 (P1) лимит = трюм Дома:** `raidHoldFull()` в трёх точках решения (жила / вылет за добычей / после сдачи) → `parkWorkerAtShuttle()`: рейс к площадке, idle, `evacWait`, тост «отряд собрался у челнока — ждёт эвакуации»; авто-логика не выдёргивает, приказ игрока снимает флаг.
- **З3 (P2) консоль честная:** трюм Дома по `HOUSE_LEVELS.cargo` вместо «эрг на карте» (×1.2 убран), только доступные тиры, `errTierRange` без хардкода чисел.
- Регресс SZ: check_r 18 гейтов (вкл. новые sim_evac36 G1–G8) ✓, 25/25 симов ✓; репро SZ `ac_sz_evac_repro.mjs` FIX-блоки — зелёные. Отдельно проверено SZ: код сейва/boot здоров (5/5 сценариев `ac_sz_saveboot_repro.mjs`), «игра не открывается» у владельца = смерть стенда e2b (502), не код.

Закрываю. Защитный хвост (safe-mode boot) — в новой карточке.
— Super Z (подмена ZCode)"""
    req('POST', f'/repos/{REPO}/issues/36/comments', {'body': body36})
    print('#36: комментарий posted')
else:
    print('#36: маркер уже есть')
i36 = req('GET', f'/repos/{REPO}/issues/36')
if i36.get('state') == 'open':
    req('PATCH', f'/repos/{REPO}/issues/36', {'state': 'closed'})
    print('#36: closed')
else:
    print('#36: уже закрыт')

# ---------- 3) новая карточка: safe-mode boot + текст тоста ----------
issues = req('GET', f'/repos/{REPO}/issues?state=all&per_page=100')
exists = [i for i in issues if MARKER_NEW in (i.get('body') or '')]
if exists:
    print(f'карточка уже существует: #{exists[0]["number"]} — не создаём дубль')
else:
    title = 'Хвост сейвов: safe-mode boot (битый restore не должен давать тёмный экран) + тост З3 с успокоением про локальный прогресс'
    body = f"""<!-- {MARKER_NEW} -->
## Контекст

Приёмка P3+#36 (`541177a`, merge `663c30a`) закрыла З1–З3. Инцидент владельца 26.10 («нажал
сохранить — игра не открывается») разобран SZ: код сейва здоров (репро `ac_sz_saveboot_repro.mjs`
5/5, старый сейв → новый код — чисто), реальная причина — смерть стенда e2b (502). Из инцидента —
два хвоста-защиты (P2, не блокеры, в ближайшую свободную поставку):

## З1 · safe-mode boot

Сейчас исключение при восстановлении `raidSession` (валидный JSON, кривое содержимое — краевые
случаи, не пойманные репро) проваливается во внешний catch `raid-boot.js` → тёмный экран,
title «r/ BOOT ERR» — для игрока неотличимо от «игра сломалась».

Спека:
- отдельный try/catch вокруг восстановления сессии в `raid-boot.js`;
- при ошибке: стереть битную сессию (localStorage + при возможности серверный ключ), стартовать
  новую базу, тост «сейв повреждён — база начата заново» (новый ключ `ui.boot.saveCorrupted`,
  RU/EN симметрично), в консоль — деталь ошибки для отладки;
- самопроверка: битый JSON, JSON с мусором (NaN/Infinity/чужие типы), усечённая сессия — boot
  всегда приходит в играбельный home.

## З2 · тост З3 — «не пугай, когда сервер просто лежит»

Текст «Сохранение не удалось: сервер недоступен» читается как потеря прогресса (инцидент
владельца — показателен: он решил, что сейв сломал игру). Спека: при ошибке сети добавить хвост
«прогресс сохранён в этом браузере и уйдёт на сервер при следующей связи»; 403 «чужой пин»
оставить как есть (там потеря реальная). RU/EN симметрично.

— Super Z (подмена ZCode)"""
    created = req('POST', f'/repos/{REPO}/issues', {'title': title, 'body': body,
                  'labels': []})
    n = created['number']
    print(f'карточка создана: #{n}')
    # Борд «К работе» ведётся в design/ARENA_MAILBOX_STATUS.md — главный канон в репо.
