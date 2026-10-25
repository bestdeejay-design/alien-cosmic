#!/usr/bin/env python3
"""gh_audit2_board.py — регистрация на борде второго цикла аудита механик Арены (eeba9a6).

Идемпотентен: комментарий по маркеру, статус по текущему значению.
"""
import json, re, subprocess, sys, urllib.request

OWNER = 'bestdeejay-design'
REPO = f'{OWNER}/alien-cosmic'
GH = 'https://api.github.com'
NUM = 28

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
    return pid, fld['id'], {o['name']: o['id'] for o in fld['options']}

PID, FID, OPTS = project_ids()

def item_id_for(num):
    d = gql('query($n:Int!){user(login:"' + OWNER + '"){repository(name:"alien-cosmic"){issue(number:$n){projectItems(first:10){nodes{id project{id}}}}}}}',
            {'n': num})
    for n in d['user']['repository']['issue']['projectItems']['nodes']:
        if n['project']['id'] == PID:
            return n['id']
    return None

# --- статус: остаётся «На проверке» ---
iid = item_id_for(NUM)
if not iid:
    print(f'#{NUM}: item на борде не найден, статус не ставлю')
else:
    cur = gql('query($id:ID!){node(id:$id){... on ProjectV2Item{fieldValueByName(name:"Status"){... on ProjectV2ItemFieldSingleSelectValue{name}}}}}',
              {'id': iid})['node']['fieldValueByName']
    cur_name = cur['name'] if cur else '(нет)'
    if cur_name == 'На проверке':
        print(f'#{NUM}: статус уже «На проверке» — ок')
    else:
        gql('mutation($p:ID!,$i:ID!,$f:ID!,$o:String!){updateProjectV2ItemFieldValue(input:{projectId:$p,itemId:$i,fieldId:$f,value:{singleSelectOptionId:$o}}){projectV2Item{id}}}',
            {'p': PID, 'i': iid, 'f': FID, 'o': OPTS['На проверке']})
        print(f'#{NUM}: «{cur_name}» → «На проверке»')

# --- комментарий с маркером ---
marker = 'AUDIT2-MERGED'
cs = req('GET', f'/repos/{REPO}/issues/{NUM}/comments?per_page=100')
if any(marker in c.get('body', '') for c in cs):
    print(f'#{NUM}: комментарий уже есть')
else:
    body = (
        '**Второй цикл аудита механик Арены слит в main** (merge `e929997`, диапазон '
        '`0aeb8a4..eeba9a6`, ветка `arena/f4defd20`, коммиты `8f3eeb7` + `eeba9a6`).\n\n'
        '**1. «Аванпост не воюет»:** охране давали `orderMove` в центр занятого КЦ — путь '
        'недостижим, юнит навсегда застревал в `move` и не сканировал цели. Фикс: точка сбора '
        '`nearestFreeTileAround`; бойцы без приказа (idle) отвечают нападающему через '
        '`damageEntity`, приказы игрока не тронуты.\n\n'
        '**2. Сдача эрга в Дом-шаттл:** путь к площадке считался в тайлах, `pathToPoint` ждёт '
        'пиксели — рабочие уходили в (0,0); приём строго по нарисованному кольцу `pad.r`; хедер '
        'вылазки «трюм/ёмкость, места Дома» без сырых `{max}/{cap}`; эвакуация клампится по '
        'грейду Дома (не константа 3000).\n\n'
        '**3. Отсек Дома = десант:** `countHomeRoster` считает отсек (бункер — нет): «Собрать '
        'всех» больше не даёт пустую консоль; `captureHomeBaseDTO` фильтрует `garrison === b`; '
        'hydrate восстанавливает отсек — **армия, оставленная дома, больше молча не пропадает**.\n\n'
        '**4. Дом-шаттл:** площадка едет с ним (M); снос Дома завершает вылазку (wiped/evac).\n\n'
        '**Ревью Super Z:** база = `0aeb8a4` (корректная); S1 не тронут (r/ | scripts/ | design/); '
        'стемп `?v=10262514` единый; локали RU/EN +1 ключ симметрично. Новый сим `sim_raid_field` '
        '(F1–F10) + гейт `[14]` в `check_r`. Регресс на слиянии **27/27 зелёный** (check_r 14 '
        'гейтов, check_i18n_keys, economy20, 23 сима, check, smoke, audit_move, minimap, u/v verify).\n\n'
        '**Приёмка владельца:** охрана аванпоста отвечает, сборщики сдают эрг в Дом-шаттл, '
        'армия дома возвращается из вылазки. Статус — «На проверке».')
    req('POST', f'/repos/{REPO}/issues/{NUM}/comments', {'body': f'<!-- {marker} -->\n\n{body}'})
    print(f'#{NUM}: комментарий добавлен')

print('готово')
