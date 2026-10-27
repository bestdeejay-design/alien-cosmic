#!/usr/bin/env python3
"""gh_issue36_board.py — карточка #36 на борд «Alien Cosmic — задачи», статус «К работе».
Идемпотентен: item ищется по issue-ноде, статус ставится по текущему значению."""
import json, re, subprocess, sys, urllib.request

OWNER = 'bestdeejay-design'
REPO = f'{OWNER}/alien-cosmic'
GH = 'https://api.github.com'
NUM = 36

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
        headers={'Authorization': f'Bearer {TOK}', 'Accept': 'application/vnd.github+json'},
        data=json.dumps({'query': query, 'variables': variables or {}}).encode())
    with urllib.request.urlopen(r) as res:
        d = json.loads(res.read())
    if 'errors' in d: raise RuntimeError(json.dumps(d['errors'], ensure_ascii=False))
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

def issue_node(num):
    d = gql('query($n:Int!){user(login:"' + OWNER + '"){repository(name:"alien-cosmic"){issue(number:$n){id title}}}}', {'n': num})
    return d['user']['repository']['issue']

def set_status(item, status_name):
    d = gql('mutation($p:ID!,$i:ID!,$f:ID!,$v:String!){updateProjectV2ItemFieldValue(input:{projectId:$p,itemId:$i,fieldId:$f,value:{singleSelectOptionId:$v}}){projectV2Item{id}}}',
            {'p': PID, 'i': item, 'f': FID, 'v': OPTS[status_name]})
    return bool(d.get('projectV2Item', {}).get('id'))

item = item_id_for(NUM)
created = False
if not item:
    node = issue_node(NUM)
    d = gql('mutation($p:ID!,$c:ID!){addProjectV2ItemById(input:{projectId:$p,contentId:$c}){item{id}}}',
            {'p': PID, 'c': node['id']})
    item = d['addProjectV2ItemById']['item']['id']
    created = True
    print(f'OK: карточка #{NUM} добавлена на борд (item {item})')
else:
    print(f'OK: карточка #{NUM} уже на борде (item {item})')

if set_status(item, 'К работе'):
    print(f'OK: статус #{NUM} → «К работе»')
