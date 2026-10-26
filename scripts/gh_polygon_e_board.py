#!/usr/bin/env python3
"""gh_polygon_e_board.py — регистрация на борде слияния Э-серии Арены (полигон r/).

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

# --- статус → «На проверке» ---
iid = item_id_for(NUM)
if not iid:
    print(f'#{NUM}: item на борде не найден, статус не ставлю')
else:
    cur = gql('query($id:ID!){node(id:$id){... on ProjectV2Item{fieldValueByName(name:"Status"){... on ProjectV2ItemFieldSingleSelectValue{name}}}}}',
              {'id': iid})['node']['fieldValueByName']
    cur_name = cur['name'] if cur else '(нет)'
    if cur_name == 'На проверке':
        print(f'#{NUM}: статус уже «На проверке»')
    else:
        gql('mutation($p:ID!,$i:ID!,$f:ID!,$o:String!){updateProjectV2ItemFieldValue(input:{projectId:$p,itemId:$i,fieldId:$f,value:{singleSelectOptionId:$o}}){projectV2Item{id}}}',
            {'p': PID, 'i': iid, 'f': FID, 'o': OPTS['На проверке']})
        print(f'#{NUM}: «{cur_name}» → «На проверке»')

# --- комментарий с маркером ---
marker = 'POLYGON-E-SERIES-MERGED'
cs = req('GET', f'/repos/{REPO}/issues/{NUM}/comments?per_page=100')
if any(marker in c.get('body', '') for c in cs):
    print(f'#{NUM}: комментарий уже есть')
else:
    body = (
        '**Э-серия Арены слита в main** (merge `fde8980`, диапазон `5a67f23..a31f6d0`, ветка '
        '`arena/f4defd20`). Полигон `r/` — канон возврата рейдов соблюдён: S1 не тронут, '
        'изменения только в `r/`, `scripts/`, `server/`, `design/`.\n\n'
        '**Содержание:** Э1+Э2 экономика рейдов на 20 уровней (грейды, правила КЦ, ранги юнитов, '
        '20 тиров, один канал сохранения) · Э3 поздняя кривая цен с 11 ур. + элитное условие КЦ '
        '(по решениям владельца 25.10) · Э4+Э5 изоляция хранилища r/ от S1, Дом как отсек, лут '
        'с чужого КЦ и перегруз, вид 20 уровней · Э6 капсулы снабжения + админка (рейтинг, '
        'ручные подарки, пауза) · Э7 командир КЦ (капитан→генерал) и оборона базы · Э7 ч.2 '
        'приказы отрядам (держать сектор / к КЦ / снять), трофеи после отражения, настройки '
        'входящих рейдов в админке.\n\n'
        '**Ревью Super Z** (подмена ZCode по запросу владельца): база ветки = кончик main '
        '(памятка соблюдена); S1 не тронут; на ветке зелёное ВСЁ — её гейт `check_r` '
        '(изоляция полигона), `check_i18n_keys` (346 ключей RU/EN), `economy20` (баланс-'
        'инварианты), 5 её симов (r_raid20/squad/commander/chests_ui/skins) + полный регресс '
        '(check, smoke, 17 симов, audit_move, minimap, u/v verify); после слияния гейт зелёный.\n\n'
        '**Доки поставки:** design/ECONOMY_20.md, design/COMMANDER.md, design/ADMIN_AND_CHESTS.md, '
        'design/QA_AND_PLAY.md, r/README.md. Открытие: `/` отдаёт 302 на `/r/` при POLYGON=1.\n\n'
        '**Приёмка владельца:** полигон рейдов — экономика 20 уровней, капсулы, командир, '
        'приказы отрядам, трофеи, админка. Статус → «На проверке».')
    req('POST', f'/repos/{REPO}/issues/{NUM}/comments', {'body': f'<!-- {marker} -->\n\n{body}'})
    print(f'#{NUM}: комментарий добавлен')

print('готово')
