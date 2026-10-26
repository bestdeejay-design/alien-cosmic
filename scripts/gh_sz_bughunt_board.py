#!/usr/bin/env python3
"""gh_sz_bughunt_board.py — issue «Полигон r/: баг-лист ханта SZ 26.10» на борде.

Идемпотентен: поиск issue по точному заголовку, статус по текущему значению.
"""
import json, re, subprocess, sys, urllib.request, urllib.parse

OWNER = 'bestdeejay-design'
REPO = f'{OWNER}/alien-cosmic'
GH = 'https://api.github.com'
TITLE = '[ПОЛИГОН r/] Баг-лист ханта SZ 26.10: спам /api/save без профиля, конфликт модалок, тихая неудача сейва'

BODY = '''## Отчёт самостоятельного баг-ханта Super Z (26.10, браузерный прогон + статика)

Метод: Playwright-прогоны полигона `/r/` (десктоп 1360×900 + мобильный 390×844), ловля `pageerror`/`console.error`/`HTTP>=400`, программные и UI-пути. Скрипты: `scripts/ac_sz_bughunt1.mjs`, `scripts/ac_sz_bughunt2.mjs`. Параллельно 27/27 регресса зелёные.

---

### З1 · [P1] Анонимная сессия спамит `/api/save` 400-ми (подтверждено кодом и прогоном)

- **Симптом:** без входа (ник+пин) каждые ~15 с и при закрытии вкладки в консоли
  `Failed to load resource: 400`; сервер получает бессмысленные запросы.
- **Причина:** `r/save-client.js` — `push()`, `pushStats()`, `beaconFlush()` шлют
  `/api/save` с `pin: undefined`, когда профиля нет; сервер (`authPlayer`, save-server.mjs:55)
  отвечает 400 `need nick & pin`; `lastSynced` не обновляется → повтор каждые 15 с
  (+ `pushStats` через 4 с после старта, `visibilitychange`, `pagehide`/`beforeunload`).
- **Фикс (клиент):** без identity НЕ отправлять `/api/save`/`/api/load`
  (кроме `/health` и ручного входа из панели профиля); `beaconFlush` молча пропускает анонима;
  панель статуса честно пишет «войдите в КЦ (U), чтобы сейвы ходили между машинами».
- **Критерий приёмки:** браузерный прогон без профиля — 0 запросов `/api/save` за 30 с
  и чистая консоль; с профилем — 200; повтор прогона `ac_sz_bughunt1.mjs` зелёный.

### З2 · [P2] Конфликт модалок: карточка командира перехватывает клики по капсулам

- **Симптом (подтверждено):** `openCommander` → `showChests` → карточки капсул НЕ кликабельны:
  `#commander-overlay` (z=30) перехватывает pointer events. Escape не закрывает ни одну
  модалку полигона (обработчика нет ни в commander-ui/chests-ui/admin/ui/game).
- **Фикс:** единая политика модалок: открытие новой модалки закрывает предыдущую
  (или запрещает вторую — на выбор реализации), Escape закрывает верхнюю,
  `maybeShowOnEntry` не открывается поверх чужой модалки.
- **Критерий приёмки:** браузерный кейс командир+капсулы — клик проходит; Escape закрывает
  верхнюю модалку; регресс 27/27 зелёный; `check_i18n_keys` зелёный.

### З3 · [P3] Тихая неудача сейва для игрока

- **Симптом:** при отказе сервера ошибка видна только в `status.lastError` (панель профиля).
- **Фикс:** тост при ПЕРВОЙ ошибке пуша («сейв не ушёл на сервер — проверьте связь»),
  не чаще раза в N минут (антифлуд), без спама при каждом тике.

---

### Что проверено и ЗЕЛЁНОЕ (не трогать без причины)

Симы F1–F10 (сдача эрга, кольцо, трюм-грейд, хедер без `{…}`, эвакуация, «к КЦ» = Дом,
агро аванпоста) · wiped при сносе Дома-шаттла (подтверждено живьём) · вскрытие капсулы
живьём (фикс `.hidden` работает) · mobile chest-box скролл (743/844, не уезжает) ·
админка PIN 1234 + все вкладки · save/load/list/delete API с пином · восстановление
сессии рейда из localStorage + страховка `visibilitychange` · 27/27 полный регресс.

### Границы

Все три задачи — в полигоне `r/` (save-client.js, commander-ui.js, chests-ui.js, admin.js,
style.css) + сим/браузер-гейт в `scripts/`. S1 не трогать. Стемп r/ поднять единым
(`?v=`), CSS со стемпом. Локали RU/EN симметрично. Ревью: SZ m1. Порядок с #31
(визуал) — по слову владельца; З1 маленькая, можно вклинить до V-пакета.
'''

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

def gql(query, variables=None):
    r = urllib.request.Request(GH + '/graphql', method='POST',
        headers={'Authorization': f'Bearer {TOK}'},
        data=json.dumps({'query': query, 'variables': variables or {}}).encode())
    with urllib.request.urlopen(r) as res:
        d = json.load(res)
    if d.get('errors'):
        sys.exit('GraphQL error: ' + '; '.join(e.get('message', '') for e in d['errors']))
    return d['data']

# --- идемпотентный поиск issue: search API (листинги застывают — аномалия 26.10) ---
found = None
s = req('GET', '/search/issues?q=' + urllib.parse.quote(f'repo:{REPO} in:title "{TITLE}"') + '&per_page=5')
if s.get('total_count'):
    for it in s.get('items', []):
        if it.get('title') == TITLE and 'pull_request' not in it:
            found = it
            break

if found:
    NUM = found['number']
    print(f'#{NUM}: issue уже есть ({found["state"]})')
else:
    it = req('POST', f'/repos/{REPO}/issues', {'title': TITLE, 'body': BODY, 'labels': []})
    NUM = it['number']
    print(f'#{NUM}: issue создан')

# --- борд ---
data = gql('query($l:String!){user(login:$l){projectsV2(first:20){nodes{id title}}}}', {'l': OWNER})
p = next(p for p in data['user']['projectsV2']['nodes'] if p['title'] == 'Alien Cosmic — задачи')
pid = p['id']
fld = gql('query($id:ID!){node(id:$id){... on ProjectV2{field(name:"Status"){... on ProjectV2SingleSelectField{id options{id name}}}}}}',
          {'id': pid})['node']['field']
FID = fld['id']
OPTS = {o['name']: o['id'] for o in fld['options']}

iid = None
d = gql('query($n:Int!){user(login:"' + OWNER + '"){repository(name:"alien-cosmic"){issue(number:$n){projectItems(first:10){nodes{id project{id}}}}}}}', {'n': NUM})
for n in d['user']['repository']['issue']['projectItems']['nodes']:
    if n['project']['id'] == pid:
        iid = n['id']
        break

if not iid:
    m = gql('mutation($p:ID!,$c:ID!){addProjectV2ItemById(input:{projectId:$p,contentId:$c}){item{id}}}',
            {'p': pid, 'c': found and found.get('node_id') or req('GET', f'/repos/{REPO}/issues/{NUM}')['node_id']})
    iid = m['addProjectV2ItemById']['item']['id']
    print(f'#{NUM}: добавлен на борд')

cur = gql('query($id:ID!){node(id:$id){... on ProjectV2Item{fieldValueByName(name:"Status"){... on ProjectV2ItemFieldSingleSelectValue{name}}}}}',
          {'id': iid})['node']['fieldValueByName']
cur_name = cur['name'] if cur else '(нет)'
if cur_name == 'Бэклог':
    print(f'#{NUM}: статус уже «Бэклог»')
else:
    gql('mutation($p:ID!,$i:ID!,$f:ID!,$o:String!){updateProjectV2ItemFieldValue(input:{projectId:$p,itemId:$i,fieldId:$f,value:{singleSelectOptionId:$o}}){projectV2Item{id}}}',
        {'p': pid, 'i': iid, 'f': FID, 'o': OPTS['Бэклог']})
    print(f'#{NUM}: «{cur_name}» → «Бэклог»')

print('готово')
