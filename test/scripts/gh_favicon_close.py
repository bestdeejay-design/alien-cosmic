#!/usr/bin/env python3
"""gh_favicon_close.py — закрытие #22 (фавиконка) по решению владельца 23.10.

Владелец: «фавиконка уже стоит» — текущая марка V-пакета и есть «ромб с точкой»
(бирюзовый ромб + точка-сигнал в favicon.svg), правка не требуется.
Идемпотентен: комментарий по маркеру, статус по текущему значению, закрытие по state.
"""
import json, re, subprocess, sys, urllib.request

OWNER = 'bestdeejay-design'
REPO = f'{OWNER}/alien-cosmic'
GH = 'https://api.github.com'
NUM = 22

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

# --- статус → «Готово» ---
iid = item_id_for(NUM)
if not iid:
    print(f'#{NUM}: item на борде не найден, статус не ставлю')
else:
    cur = gql('query($id:ID!){node(id:$id){... on ProjectV2Item{fieldValueByName(name:"Status"){... on ProjectV2ItemFieldSingleSelectValue{name}}}}}',
              {'id': iid})['node']['fieldValueByName']
    cur_name = cur['name'] if cur else '(нет)'
    if cur_name == 'Готово':
        print(f'#{NUM}: статус уже «Готово»')
    else:
        gql('mutation($p:ID!,$i:ID!,$f:ID!,$o:String!){updateProjectV2ItemFieldValue(input:{projectId:$p,itemId:$i,fieldId:$f,value:{singleSelectOptionId:$o}}){projectV2Item{id}}}',
            {'p': PID, 'i': iid, 'f': FID, 'o': OPTS['Готово']})
        print(f'#{NUM}: «{cur_name}» → «Готово»')

# --- комментарий с маркером ---
marker = 'FAVICON-ACCEPTED-CLOSED'
cs = req('GET', f'/repos/{REPO}/issues/{NUM}/comments?per_page=100')
if any(marker in c.get('body', '') for c in cs):
    print(f'#{NUM}: комментарий уже есть')
else:
    body = (
        '**Принято владельцем, закрываю** (23.10). Уточнение владельца: «фавиконка уже стоит» — '
        'марка V-пакета уже является «ромбом с точкой» (`assets/favicon.svg`: бирюзовый '
        'сигнальный ромб + точка-пульс в центре + янтарная точка-спутник), отдельная правка '
        'не требуется. Поставлено: favicon.svg + favicon-32/48.png + apple-touch-icon.png + '
        'theme-color. Регресс V зелёный, приёмка владельца получена.')
    req('POST', f'/repos/{REPO}/issues/{NUM}/comments', {'body': f'<!-- {marker} -->\n\n{body}'})
    print(f'#{NUM}: комментарий добавлен')

# --- закрытие ---
i = req('GET', f'/repos/{REPO}/issues/{NUM}')
if i['state'] == 'closed':
    print(f'#{NUM}: уже закрыт')
else:
    req('PATCH', f'/repos/{REPO}/issues/{NUM}', {'state': 'closed'})
    print(f'#{NUM}: закрыт')

print('готово')
