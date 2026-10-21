#!/usr/bin/env python3
# gh_board_setup.py — создание GitHub Projects-борда «Alien Cosmic — задачи» одним запуском.
#
# ТРЕБОВАНИЕ: токен из git remote должен иметь скоуп project (владелец добавляет за
# минуту: github.com/settings/tokens → Regenerate → отметить «project», repo/workflow сохранить).
# Токен читается из remote, не печатается и не коммитится.
#
# Что делает:
#   1. создаёт Project V2 у владельца + русские статусы (Бэклог/К работе/В работе/На проверке/Ждёт/Готово)
#   2. добавляет все issues репозитория в борд
#   3. расставляет статусы по маппингу ниже
#   4. прописывает правила ведения в readme борда
# Идемпотентен: повторный запуск не дублирует.
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
        return json.load(res)

def gql(query, variables=None):
    r = urllib.request.Request(GH + '/graphql', method='POST',
        headers={'Authorization': f'Bearer {TOK}'},
        data=json.dumps({'query': query, 'variables': variables or {}}).encode())
    with urllib.request.urlopen(r) as res:
        d = json.load(res)
    if d.get('errors'):
        msgs = '; '.join(e.get('message', '')[:160] for e in d['errors'])
        if 'INSUFFICIENT_SCOPES' in msgs:
            sys.exit('НЕТ СКОУПА project. Добавь его: https://github.com/settings/tokens → '
                     'Regenerate token → отметить project (repo/workflow оставить). Потом перезапусти.')
        sys.exit('GraphQL error: ' + msgs)
    return d['data']

# 1. identity + существующие проекты (идемпотентность)
data = gql('query($l:String!){user(login:$l){id projectsV2(first:20){nodes{id title}}}}', {'l': OWNER})
uid = data['user']['id']
existing = [p for p in data['user']['projectsV2']['nodes'] if p['title'] == 'Alien Cosmic — задачи']
if existing:
    pid = existing[0]['id']; print('борд уже существует — донастраиваю')
else:
    pid = gql('mutation($o:String!){createProjectV2(input:{ownerId:$o,title:"Alien Cosmic — задачи"}){projectV2{id}}}',
              {'o': uid})['createProjectV2']['projectV2']['id']
    print('борд создан')

# 2. поле Status + русские опции
fields = gql('query($n:Int!){view{id field(input:{name:"Status"}){... on ProjectV2SingleSelectField{id options{id name}}}}}', None)
fld = gql('query($id:ID!){node(id:$id){... on ProjectV2{field(input:{name:"Status"}){... on ProjectV2SingleSelectField{id options{id name}}}}}}',
          {'id': pid})['node']['field']
status_id = fld['id']
opts = {o['name']: o['id'] for o in fld['options']}
WANT = ['Бэклог', 'К работе', 'В работе', 'На проверке', 'Ждёт', 'Готово']
missing = [w for w in WANT if w not in opts]
if missing:
    new_options = [{'name': n} for n in WANT]
    gql('mutation($f:ID!,$o:[ProjectV2SingleSelectOptionInput!]!){updateProjectV2Field(input:{fieldId:$f,singleSelectOptions:$o}){projectV2Field{... on ProjectV2SingleSelectField{options{name}}}}}',
        {'f': status_id, 'o': new_options})
    fld = gql('query($id:ID!){node(id:$id){... on ProjectV2{field(input:{name:"Status"}){... on ProjectV2SingleSelectField{id options{id name}}}}}}',
              {'id': pid})['node']['field']
    opts = {o['name']: o['id'] for o in fld['options']}
print('статусы готовы:', ', '.join(opts))

# 3. issues в борд
items = gql('query($n:Int!){repository(owner:"%s",name:"%s"){issues(first:$n,states:[OPEN,CLOSED],orderBy:{field:CREATED_AT,direction:ASC}){nodes{number id title}}}}'
            % (OWNER, 'alien-cosmic'), {'n': 50})['repository']['issues']['nodes']
proj_items = gql('query($id:ID!){node(id:$id){... on ProjectV2{items(first:50){nodes{content{... on Issue{id}}}}}}}',
                 {'id': pid})['node']['items']['nodes']
linked = {n['content']['id'] for n in proj_items if n.get('content') and n['content'].get('id')}
STATUS_MAP = {  # по номерам из gh_issues_seed.py; новые — по ключевым словам в заголовке
    3: 'Готово', 4: 'К работе', 5: 'Бэклог', 6: 'В работе', 7: 'Ждёт', 8: 'Бэклог',
}
for it in items:
    iid, num = it['id'], it['number']
    if iid not in linked:
        gql('mutation($p:ID!,$c:ID!){addProjectV2ItemById(input:{projectId:$p,contentId:$c}){item{id}}}',
            {'p': pid, 'c': iid})
        print(f'добавлен в борд: #{num}')
    st = STATUS_MAP.get(num)
    if st and st in opts:
        gql('mutation($p:ID!,$i:ID!,$f:ID!,$s:String!){updateProjectV2ItemField(input:{projectId:$p,itemId:$i,fieldId:$f,value:{singleSelectOptionId:$s}}){projectV2Item{id}}}',
            {'p': pid, 'i': iid, 'f': status_id, 's': opts[st]})

# 4. readme борда — правила ведения
readme = """**Alien Cosmic — задачи** · канбан двух агентов и владельца

Колонки: Бэклог → К работе → В работе → На проверке → Ждёт → Готово.

- **Z.ai** ставит статусы сам; пакет = ветка main, коммит с префиксом `package X:`.
- **Арена** работает через ветки arena/* и письма; статусы за неё двигает Z.ai по её письмам, пока у неё нет токена с project-скоупом.
- **Владелец** двигает что угодно — борд не канон, канон это main; борд = видно «кто чем занят».
- Каждый issue = одна задача; детали и письма — в design/ZAI_MAILBOX.md / ARENA_MAILBOX.md, аудит-документы — в design/.
- Автоматизация: `scripts/gh_issues_seed.py` (посев задач), `scripts/gh_board_setup.py` (этот борд, идемпотентен)."""
gql('mutation($p:ID!,$r:String!){updateProjectV2(input:{projectId:$p,readme:$r}){projectV2{id}}}',
    {'p': pid, 'r': readme})

url = f'https://github.com/users/{OWNER}/projects'
print('\nГОТОВО. Борд:', url, '→ «Alien Cosmic — задачи»')
