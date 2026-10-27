#!/usr/bin/env python3
"""gh_decisions_board.py — решения владельца 23.10 по всем 12 пунктам на борд.

Идемпотентен: комментарии по маркерам, статусы по текущему значению,
закрытия с проверкой state, новая карточка по поиску титула.
Для #26 статус ставится через projectItems issue (обход застывших листингов).
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

def gql(query, variables=None):
    r = urllib.request.Request(GH + '/graphql', method='POST',
        headers={'Authorization': f'Bearer {TOK}'},
        data=json.dumps({'query': query, 'variables': variables or {}}).encode())
    with urllib.request.urlopen(r) as res:
        d = json.load(res)
    if d.get('errors'):
        sys.exit('GraphQL error: ' + '; '.join(e.get('message', '') for e in d['errors']))
    return d['data']

def project_ids():
    data = gql('query($l:String!){user(login:$l){projectsV2(first:20){nodes{id title}}}}', {'l': OWNER})
    p = next(p for p in data['user']['projectsV2']['nodes'] if p['title'] == 'Alien Cosmic — задачи')
    pid = p['id']
    fld = gql('query($id:ID!){node(id:$id){... on ProjectV2{field(name:"Status"){... on ProjectV2SingleSelectField{id options{id name}}}}}}',
              {'id': pid})['node']['field']
    opts = {o['name']: o['id'] for o in fld['options']}
    items = gql('query($id:ID!){node(id:$id){... on ProjectV2{items(first:100){nodes{id content{... on Issue{number}}}}}}}',
                {'id': pid})['node']['items']['nodes']
    by_issue = {n['content']['number']: n['id'] for n in items if n.get('content')}
    return pid, fld['id'], opts, by_issue

PID, FID, OPTS, BY_ISSUE = project_ids()

def item_id_for(num):
    """item id из листинга, при промахе — через projectItems issue (обход аномалии листингов)."""
    if num in BY_ISSUE:
        return BY_ISSUE[num]
    d = gql('query($n:Int!){user(login:"' + OWNER + '"){repository(name:"alien-cosmic"){issue(number:$n){projectItems(first:10){nodes{id project{id}}}}}}}',
            {'n': num})
    for n in d['user']['repository']['issue']['projectItems']['nodes']:
        if n['project']['id'] == PID:
            return n['id']
    return None

def set_status(num, st):
    iid = item_id_for(num)
    if not iid:
        print(f'#{num}: item на борде не найден, статус «{st}» не ставлю')
        return
    cur = gql('query($id:ID!){node(id:$id){... on ProjectV2Item{fieldValueByName(name:"Status"){... on ProjectV2ItemFieldSingleSelectValue{name}}}}}',
              {'id': iid})['node']['fieldValueByName']
    cur_name = cur['name'] if cur else '(нет)'
    if cur_name == st:
        print(f'#{num}: статус уже «{st}»')
        return
    gql('mutation($p:ID!,$i:ID!,$f:ID!,$o:String!){updateProjectV2ItemFieldValue(input:{projectId:$p,itemId:$i,fieldId:$f,value:{singleSelectOptionId:$o}}){projectV2Item{id}}}',
        {'p': PID, 'i': iid, 'f': FID, 'o': opts_id(st)})
    print(f'#{num}: «{cur_name}» → «{st}»')

def opts_id(name):
    if name not in OPTS:
        sys.exit(f'нет опции статуса «{name}» (есть: {sorted(OPTS)})')
    return OPTS[name]

def comment(num, marker, body):
    cs = req('GET', f'/repos/{REPO}/issues/{num}/comments?per_page=100')
    if any(marker in c.get('body', '') for c in cs):
        print(f'#{num}: комментарий уже есть')
        return
    req('POST', f'/repos/{REPO}/issues/{num}/comments', {'body': f'<!-- {marker} -->\n\n{body}'})
    print(f'#{num}: комментарий добавлен')

def close(num):
    i = req('GET', f'/repos/{REPO}/issues/{num}')
    if i['state'] == 'closed':
        print(f'#{num}: уже закрыт')
        return
    req('PATCH', f'/repos/{REPO}/issues/{num}', {'state': 'closed'})
    print(f'#{num}: закрыт')

def add_to_board(num):
    if item_id_for(num):
        print(f'#{num}: уже на борде')
        return
    res = gql('query($n:Int!){user(login:"' + OWNER + '"){repository(name:"alien-cosmic"){issue(number:$n){id}}}}',
              {'n': num})
    iid = res['user']['repository']['issue']['id']
    gql('mutation($p:ID!,$c:ID!){addProjectV2ItemById(input:{projectId:$p,contentId:$c}){item{id}}}',
        {'p': PID, 'c': iid})
    print(f'#{num}: добавлен на борд')

# --- 1. #26 S2 M1: возвращена владельцем на переделку ---
comment(26, 'S2M1-OWNER-REWORK',
    '**Владелец сыграл миссию и вернул её Арене на переделку** (23.10). Детали переделки — '
    'брифом владельца (передаст Z.ai или напишет сам); до брифа по S2 шагов не делать. '
    'Статус → «К работе».')
set_status(26, 'К работе')

# --- 2. #22 фавиконка: принята с правкой «ромб с точкой» ---
comment(22, 'FAVICON-DOT-TWEAK',
    '**Принято владельцем с правкой** (23.10): марка — **ромб с точкой**. Правку делает Z.ai '
    'следующим пакетом (favicon.svg + PNG-фолбэки + apple-touch пересобрать от новой марки). '
    'Статус → «К работе».')
set_status(22, 'К работе')

# --- 3. #24 X-тултип: принято, закрываем ---
comment(24, 'X-TOOLTIP-ACCEPTED',
    '**Принято владельцем** (мобильная приёмка 23.10: «вроде всё ок»). Закрываю; правки — '
    'новым баг-репортом.')
set_status(24, 'Готово')
close(24)

# --- 4. #4/R visualViewport: принято, закрываем ---
comment(4, 'R-VV-ACCEPTED',
    '**Принято владельцем** (мобильная приёмка 23.10, вместе с #24: «вроде всё ок»). Закрываю; '
    'правки — новым баг-репортом.')
set_status(4, 'Готово')
close(4)

# --- 5. #25 ресерч рейдов: решения владельца — трек закрыт решениями ---
comment(25, 'RAID-DECISIONS-V1',
    '**Решения владельца 23.10 по шести открытым вопросам (канон):**\n\n'
    '1. **Корабль-КЦ** — постоянная база (не экспедиционный транспорт)\n'
    '2. **Стартовый отряд** — разовый подарок (не комплект на каждый рейд)\n'
    '3. **Матчмейкинг** — в рамках системы уровней; систему уровней будем разрабатывать '
    '(заведена отдельная карточка в бэклоге)\n'
    '4. **Кап офлайн-добычи** — пока не вводим: решим, когда поймём уровень ущерба (по данным тестов)\n'
    '5. **Trust-порог** не фиксируем заранее — определим по результатам тестов\n'
    '6. **Backend** — полная автономная станция на чужом сервере: самодостаточный сервис '
    '(логика + данные внутри), деплой на стороннем хостинге, минимум внешних зависимостей\n\n'
    'Ресерч-трек A-3 закрыт решениями владельца. R0 (локальный raid-loop) стартует по явному '
    'GO владельца; исполнитель — отдельное его решение. Карточка остаётся открытой как эпик рейдов.')
set_status(25, 'Готово')

# --- 6. #5 сейвы: решения владельца ---
comment(5, 'SAVES-DECISIONS-V1',
    '**Решения владельца 23.10 (канон):** сейвы — **на сервере** (не локально); точность '
    'восстановления — **полная**. Слоты/история — уточняется у владельца (допишу отдельным '
    'комментарием).\n\n'
    '**Следствие по фазировке:** отдельного локального трека S0 больше нет — серверные сейвы '
    'полной точности входят в вертикаль R1 (API+DB). Канон trust domains (A-3 v2) остаётся: '
    'клиент не решает за сервер, DTO/schemaVersion переиспользуем.')
set_status(5, 'Готово')

# --- 7. новая карточка: система уровней ---
TITLE = 'Система уровней (базы/игрока) — новый продуктовый трек (матчмейкинг в рамках уровней)'
items = req('GET', f'/repos/{REPO}/issues?state=open&per_page=100')
num27 = next((i['number'] for i in items if i['title'].strip() == TITLE), None)
if num27:
    print(f'issue уже есть: #{num27}')
else:
    body = (
        '**Новый продуктовый трек** (решение владельца 23.10, п.3 рейд-канона): матчмейкинг '
        'рейдов — **в рамках системы уровней**; систему уровней будем разрабатывать.\n\n'
        'Ожидает проработки: что является уровнем (базы/игрока/рейда), шкала и рост, как уровень '
        'влияет на матчмейкинг и диапазоны атак. Блокирует финальный дизайн матчмейкинга R0/R1.\n\n'
        'Статус: **Бэклог**. Приоритет и рамки определит владелец при GO на R0.'
    )
    r = req('POST', f'/repos/{REPO}/issues', {'title': TITLE, 'body': body})
    num27 = r['number']
    print(f'issue создан: #{num27}')
add_to_board(num27)
set_status(num27, 'Бэклог')

print('готово')
