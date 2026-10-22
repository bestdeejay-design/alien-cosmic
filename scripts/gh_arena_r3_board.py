#!/usr/bin/env python3
"""gh_arena_r3_board.py — борд-действия после пуша отчётов Арены (A-1/A-3).

Идемпотентен: перед каждым POST/PATCH проверяет состояние (комментарий по
маркеру, статус по текущему значению, закрытие по state).
Действия:
  1. #7  закрыть (A-1 запушен и разобран, A-2 закрыт, A-3 доставлен)
  2. #5  комментарий + статус «На проверке» (ресерч сейвов у владельца)
  3. #25 комментарий + статус «На проверке» (ресерч мультиплеера у владельца)
  4. #16 комментарий (ограничение среды Арены подтверждено; динамика версии готова)
  5. #17 комментарий (credential coupling подтверждён; план GH_TOKEN в CI-пакете)
"""
import json, os, re, subprocess, sys, urllib.request

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

def gql(query, variables=None):
    r = urllib.request.Request(GH + '/graphql', method='POST',
        headers={'Authorization': f'Bearer {TOK}'},
        data=json.dumps({'query': query, 'variables': variables or {}}).encode())
    with urllib.request.urlopen(r) as res:
        d = json.load(res)
    if d.get('errors'):
        sys.exit('GraphQL error: ' + '; '.join(e.get('message', '') for e in d['errors']))
    return d['data']

def has_marker(num, marker):
    cs = req('GET', f'/repos/{REPO}/issues/{num}/comments?per_page=100')
    return any(marker in c.get('body', '') for c in cs)

def comment(num, marker, body):
    if has_marker(num, marker):
        print(f'#{num}: комментарий уже есть')
        return
    req('POST', f'/repos/{REPO}/issues/{num}/comments', {'body': body})
    print(f'#{num}: комментарий добавлен')

def close(num, marker, body):
    comment(num, marker, body)
    it = req('GET', f'/repos/{REPO}/issues/{num}')
    if it.get('state') == 'closed':
        print(f'#{num}: уже закрыт')
    else:
        req('PATCH', f'/repos/{REPO}/issues/{num}', {'state': 'closed'})
        print(f'#{num}: ЗАКРЫТ')

# --- статусы Projects V2 ---
def project_ids():
    data = gql('query($l:String!){user(login:$l){projectsV2(first:20){nodes{id title}}}}', {'l': OWNER})
    p = next(p for p in data['user']['projectsV2']['nodes'] if p['title'] == 'Alien Cosmic — задачи')
    pid = p['id']
    fld = gql('query($id:ID!){node(id:$id){... on ProjectV2{field(name:"Status"){... on ProjectV2SingleSelectField{id options{id name}}}}}}',
              {'id': pid})['node']['field']
    opts = {o['name']: o['id'] for o in fld['options']}
    items = gql('query($id:ID!){node(id:$id){... on ProjectV2{items(first:60){nodes{id content{... on Issue{number}}}}}}}',
                {'id': pid})['node']['items']['nodes']
    by_issue = {n['content']['number']: n['id'] for n in items if n.get('content')}
    return pid, fld['id'], opts, by_issue

def set_status(num, status):
    pid, fid, opts, by_issue = project_ids()
    if num not in by_issue:
        print(f'#{num}: нет на борде — пропускаю'); return
    cur = gql('query($id:ID!){node(id:$id){... on ProjectV2Item{fieldValueByName(name:"Status"){... on ProjectV2ItemFieldSingleSelectValue{name}}}}}',
              {'id': by_issue[num]})['node']['fieldValueByName']
    cur_name = cur['name'] if cur else '(нет)'
    if cur_name == status:
        print(f'#{num}: статус уже «{status}»'); return
    gql('mutation($p:ID!,$i:ID!,$f:ID!,$o:String!){updateProjectV2ItemFieldValue(input:{projectId:$p,itemId:$i,fieldId:$f,value:{singleSelectOptionId:$o}}){projectV2Item{id}}}',
        {'p': pid, 'i': by_issue[num], 'f': fid, 'o': opts[status]})
    print(f'#{num}: «{cur_name}» → «{status}»')

# --- 1. #7 закрыть ---
close(7, 'A-1-ACCEPTED-5d78c20',
'**A-1 принят, A-2 закрыт ранее, A-3 доставлен — закрываю синк-трекинг.**\n\n'
'- Отчёт A-1 запушен (arena/aacf3ebb @ 1346c86), разобран: главная находка P0 (гейт W→X) '
'подтверждена и была починена `6629cae` (динамические проверки версии) до её пуша; полный '
'регресс X зелёный.\n'
'- Doc-sweep по статус-дрейфам сделан в `5d78c20` (TOOLTIP/ADAPTIVE/R3A/MISSION_TYPES/TASK_CI), '
'плюс живая статус-карточка `design/ARENA_MAILBOX_STATUS.md`.\n'
'- A-3 (сейвы #5 + мультиплеер #25) принят, вопросы владельцу переданы → отдельные карточки.\n\n'
'Ответ Арене: письмо 22.10 в `ARENA_MAILBOX.md` (коммит 5d78c20).')

# --- 2. #5 сейвы → На проверке ---
comment(5, 'A3-RESEARCH-DELIVERED',
'**Ресерч A-3 по сейвам доставлен Арени** (`design/ARENA_RESEARCH_SAVE_MULTIPLAYER.md`, '
'arena/aacf3ebb @ 1a835b8, спот-проверки 4/4 сошлись). Суть:\n\n'
'- Хранилище: IndexedDB для снимков/истории (`SaveRepository`), настройки остаются в '
'localStorage; миграция `terranrts.progress` (индекс → стабильный mission ID).\n'
'- Сериализация: whitelist-DTO (`SaveEnvelope`), НЕ `JSON.stringify(state)` — в стейте циклы, '
'ссылки, canvas-кэши, module-level nextId.\n'
'- Фазировка: S0 контракт/схема (1–2д) → S1 прогресс+результаты (3–6д) → S2 точный снимок '
'партии (6–12д, самый рискованный) → S3 устойчивость (3–7д).\n\n'
'**Вопросы владельцу (решают скоуп):** локальные сейвы vs облако (рек.: локально, экспорт '
'позже); точное восстановление тика vs чекпоинт (рек.: точно в ручном, окно потери в '
'autosave); 1 autosave + 3 ручных слота / история 50 результатов — достаточно ли.')
set_status(5, 'На проверке')

# --- 3. #25 мультиплеер → На проверке ---
comment(25, 'A3-RESEARCH-DELIVERED',
'**Ресерч A-3 по мультиплееру доставлен Арени** (тот же док, глава 2). Суть:\n\n'
'- MVP: дружеский 1v1 Quick Battle по коду комнаты, без рейтинга/античита/кампании.\n'
'- Архитектура: lockstep только после M0-спайка детерминизма (10k+ тиков, два мира, '
'canonical hash, затем Chromium vs Safari); иначе host-authoritative state-sync.\n'
'- Транспорт: WSS-релей комнат (Workers+Durable Objects или небольшой VPS) — отдельно от '
'модели симуляции; WebRTC/TURN — позже по замерам.\n'
'- Важно: `check.mjs` запрещает WebSocket — сетевой трек требует явного GO владельца и '
'осознанного изменения гейта.\n\n'
'**Вопросы владельцу:** 1v1 vs co-op (рек.: 1v1); допустим ли честно обозначенный '
'peer/host-authoritative MVP; reconnect-политика (пауза + короткое окно vs полный '
'rejoin); хостинг/бюджет/регион; платформенный минимум приёмки.')
set_status(25, 'На проверке')

# --- 4. #16 CI ---
comment(16, 'ARENA-ENV-CONFIRMED',
'Ограничение среды Арены подтверждено её A-1: Playwright/токены в её песочнице недоступны, '
'браузерный слой (u_verify/v_verify) она повторить не может. План раннера это учитывает: '
'статический слой — везде, браузерный — в поддерживающей среде. Первый шаг уже сделан: '
'`check.mjs`/`sim_p1` читают версию динамически (6629cae) — находка Арены. Замечание '
'«T20–T23 статика, runtime-пара в v_verify» будет отражено в CI-доке.')

# --- 5. #17 токены ---
comment(17, 'CREDENTIAL-COUPLING-CONFIRMED',
'Подтверждено A-1 Арены: `gh_*.py` читают токен из userinfo у `origin` — в поддерживающем '
'checkout URL с токеном, в чистом (её песочница, CI) скрипты немы. План: в CI-пакете '
'переход на `GH_TOKEN`/`gh auth token`, без печати токена и без вшивания в URL/логи/артефакты. '
'В игровой код и гейт не входит.')

print('\nборд-действия завершены')
