#!/usr/bin/env python3
"""gh_capsule_fix_board.py — регистрация на борде фикса капсул Арены (0aeb8a4).

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

# --- статус: остаётся «На проверке» (приёмка владельца в силе, фикс её часть) ---
iid = item_id_for(NUM)
if not iid:
    print(f'#{NUM}: item на борде не найден, статус не ставлю')
else:
    cur = gql('query($id:ID!){node(id:$id){... on ProjectV2Item{fieldValueByName(name:"Status"){... on ProjectV2ItemFieldSingleSelectValue{name}}}}}',
              {'id': iid})['node']['fieldValueByName']
    cur_name = cur['name'] if cur else '(нет)'
    if cur_name == 'На проверке':
        print(f'#{NUM}: статус уже «На проверке» — ок, приёмка владельца в силе')
    else:
        gql('mutation($p:ID!,$i:ID!,$f:ID!,$o:String!){updateProjectV2ItemFieldValue(input:{projectId:$p,itemId:$i,fieldId:$f,value:{singleSelectOptionId:$o}}){projectV2Item{id}}}',
            {'p': PID, 'i': iid, 'f': FID, 'o': OPTS['На проверке']})
        print(f'#{NUM}: «{cur_name}» → «На проверке»')

# --- комментарий с маркером ---
marker = 'CAPSULE-FIX-MERGED'
cs = req('GET', f'/repos/{REPO}/issues/{NUM}/comments?per_page=100')
if any(marker in c.get('body', '') for c in cs):
    print(f'#{NUM}: комментарий уже есть')
else:
    body = (
        '**Фикс капсул Арены слит в main** (merge `3d87301`, диапазон `a31f6d0..0aeb8a4`, ветка '
        '`arena/f4defd20`). Закрывает жалобу владельца 26.10 «не нажимается ежедневная капсула».\n\n'
        '**Причина:** в `r/style.css` существовало только `.overlay.hidden`, а панели капсул и '
        'админки переключаются обычным классом `hidden` — экран награды рисовался ПОД списком, '
        'кнопка «Забрать и продолжить» уезжала за экран (на телефоне гарантированно). Награда '
        'при этом выдавалась. Тот же механизм ломал PIN-гейт админки.\n\n'
        '**Содержание фикса:** утилита `.hidden { display:none !important }` · скролл `.chest-box` '
        '(телефон-first, max-height + overflow) · отклик `.is-opening` на тап · ошибки `claimChest` '
        'видны игроку (try/catch + тост «Не удалось вскрыть: …») · гейты `[12]` (.hidden обязана '
        'быть, если JS её использует) и `[13]` (единый стемп `?v=` во всём r/, CSS тоже со стемпом, '
        'симы берут стемп из `scripts/stamp.mjs`) — класс ошибок закрыт статически.\n\n'
        '**Ревью Super Z:** база ветки = `a31f6d0` (кончик Э-серии, в main) — корректная; S1 не '
        'тронут (дифф только `r/`, `scripts/`, `design/QA_AND_PLAY.md`); массовая правка '
        'r/js/*.js — только стемп `?v=10262512`, логика не тронута. Регресс на слиянии '
        '**26/26 зелёный**: check_r (13 гейтов, вкл. [12]/[13]), check_i18n_keys, economy20, '
        '5 симов полигона + check, smoke, 17 симов, audit_move, minimap, u/v verify.\n\n'
        '**Приёмка владельца:** вскрыть ежедневную капсулу в полигоне `/r/` — окно награды с '
        'кнопкой «Забрать и продолжить» должно показываться поверх списка. Статус — «На проверке».')
    req('POST', f'/repos/{REPO}/issues/{NUM}/comments', {'body': f'<!-- {marker} -->\n\n{body}'})
    print(f'#{NUM}: комментарий добавлен')

print('готово')
