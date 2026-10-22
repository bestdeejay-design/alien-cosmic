#!/usr/bin/env python3
"""gh_s2m1_board.py — регистрация на борде прототипа S2 M1 (Арена, ab69a7c).

Идемпотентен: issue создаётся по поиску титула, комментарий по маркеру,
статус ставится по текущему значению («На проверке»).
"""
import json, re, subprocess, sys, urllib.request

OWNER = 'bestdeejay-design'
REPO = f'{OWNER}/alien-cosmic'
GH = 'https://api.github.com'
TITLE = 'S2 M1 «Чужие на пороге» — прототип миссии Сезона 2 (Арена) — на приёмке'

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

def find_issue():
    """Ищем issue по точному титулу среди открытых (идемпотентность создания)."""
    items = req('GET', f'/repos/{REPO}/issues?state=open&per_page=100')
    for i in items:
        if i['title'].strip() == TITLE:
            return i['number']
    return None

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

# --- 1. issue: найти или создать ---
num = find_issue()
if num:
    print(f'issue уже есть: #{num}')
else:
    body = (
        '**Поставка Арены** (пуш `ab69a7c` в `arena/aacf3ebb-alien-cosmic`, 22.10, без письма).\n\n'
        'Прототип первой миссии Сезона 2 «Чужие на пороге» (фракция кхарид, сценарная — без базы врага):\n'
        '- `js/season2.js` — сценарный модуль: патруль капитана Рейна по маршруту, улики/тропы, '
        'стелс на тропах, шум-приманка, ловушка, финал «Рейн опускает оружие»\n'
        '- герой Тха-Рисса: аура (обзор +2, урон +15%, ремонт ×1.5, R8 тайлов); капитан Рейн (человеческий герой)\n'
        '- интеграции: fog (обзор ауры), units (стелс/ceasefire/ауры), ui (иконки, брифинг с лендинга, вторичные цели в экране итогов), локали ru/en\n'
        '- `scripts/sim_season2.mjs` вшит в гейт как проверка [11]\n\n'
        '**Верификация Z.ai:** на ветке — sim_season2/smoke/15 симов/audit/minimap/u/v зелёные; '
        'гейт [6] и sim_p1 P1.8 были красные из старой базы Арены (хардкод версии до 6629cae), '
        'sim_shell S4 — промах Арены. При слиянии: конфликтов нет, S4 починен, '
        'ПОЛНЫЙ регресс на результате — всё зелёное.\n\n'
        '**⚠ Процесс:** S2 начата Артой без kickoff-письма (канон нарушен). Влито как ПРОТОТИП '
        'на приёмку; судьба S2-трека (развивать / заморозить до kickoff) — слово владельца.\n\n'
        'Слияние: merge в main, письмо в ARENA_MAILBOX.md (23.10), статус-карточка обновлена.'
    )
    r = req('POST', f'/repos/{REPO}/issues', {'title': TITLE, 'body': body})
    num = r['number']
    print(f'issue создан: #{num}')

# --- 2. на борд + статус ---
pid, fid, opts, by_issue = project_ids()
if num in by_issue:
    print(f'#{num}: уже на борде')
else:
    res = gql('query($n:Int!){user(login:"' + OWNER + '"){repository(name:"alien-cosmic"){issue(number:$n){id}}}}',
              {'n': num})
    iid = res['user']['repository']['issue']['id']
    gql('mutation($p:ID!,$c:ID!){addProjectV2ItemById(input:{projectId:$p,contentId:$c}){item{id}}}',
        {'p': pid, 'c': iid})
    print(f'#{num}: добавлен на борд')
    # перечитать items после добавления
    pid, fid, opts, by_issue = project_ids()

st = 'На проверке'
cur = gql('query($id:ID!){node(id:$id){... on ProjectV2Item{fieldValueByName(name:"Status"){... on ProjectV2ItemFieldSingleSelectValue{name}}}}}',
          {'id': by_issue[num]})['node']['fieldValueByName']
cur_name = cur['name'] if cur else '(нет)'
if cur_name == st:
    print(f'#{num}: статус уже «{st}»')
else:
    gql('mutation($p:ID!,$i:ID!,$f:ID!,$o:String!){updateProjectV2ItemFieldValue(input:{projectId:$p,itemId:$i,fieldId:$f,value:{singleSelectOptionId:$o}}){projectV2Item{id}}}',
        {'p': pid, 'i': by_issue[num], 'f': fid, 'o': opts[st]})
    print(f'#{num}: «{cur_name}» → «{st}»')

# --- 3. комментарий с маркером ---
marker = 'S2M1-DELIVERED-MERGED'
cs = req('GET', f'/repos/{REPO}/issues/{num}/comments?per_page=100')
if any(marker in c.get('body', '') for c in cs):
    print(f'#{num}: комментарий уже есть')
else:
    body = (
        '**Слияние в main выполнено** (без конфликтов; S4 sim_shell починен на слиянии). '
        'ПОЛНЫЙ регресс на результате — зелёный: гейт с `sim_season2` [11], smoke, 18 симов, '
        'audit_move, minimap_view, u_verify, v_verify.\n\n'
        '**Что смотреть владельцу:** кнопка «Сезон 2 · Миссия 1» на лендинге → брифинг → «Чужие на пороге». '
        'Играть за кхарид: улики Следопытом → перехват патруля до подхода к гнезду; шум выдаёт позицию '
        '(можно заманить к ловушке у кристального тупика); финал — подвести Тха-Риссу к капитану Рейну.\n\n'
        '**Решение владельца:** 1) приёмка прототипа; 2) судьба S2-трека — развивать по плану '
        'или заморозить до kickoff-письма. До слова владельца следующий шаг по S2 не делается.'
    )
    req('POST', f'/repos/{REPO}/issues/{num}/comments', {'body': f'<!-- {marker} -->\n\n{body}'})
    print(f'#{num}: комментарий добавлен')

print('готово')
