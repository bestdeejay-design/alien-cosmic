#!/usr/bin/env python3
"""#47: перенос бэклога Expedition на борд «Alien Cosmic — задачи» (Projects V2 №3).

Идемпотентен: card-add по issue id, статус по item id; существующие не дублируются.
Токен — из `gh auth token` (не из git remote, см. issue #17).
"""
import json
import subprocess
import sys

PROJECT = 'PVT_kwHODogAO84BoIAE'
STATUS_FIELD = 'PVTSSF_lAHODogAO84BoIAEzhmpgdA'


def gql(query, variables=None):
    out = subprocess.run(
        ['gh', 'api', 'graphql', '-f', 'query=' + query]
        + sum([['-f', f'{k}={v}'] for k, v in (variables or {}).items()], []),
        capture_output=True, text=True)
    if out.returncode:
        sys.exit(out.stderr)
    data = json.loads(out.stdout)
    if data.get('errors'):
        sys.exit(json.dumps(data['errors'], ensure_ascii=False))
    return data['data']


def issue_node(num):
    d = gql('query{repository(owner:"bestdeejay-design",name:"alien-cosmic")'
            '{issue(number:%d){id title state}}}' % num)
    it = d['repository']['issue']
    if it['state'] == 'CLOSED':
        return None
    return it['id']


def on_board():
    d = gql('query{user(login:"bestdeejay-design"){projectV2(number:3)'
            '{items(first:100){nodes{id content{... on Issue{number}}}}}}}')
    return {n['content']['number']: n['id']
            for n in d['user']['projectV2']['items']['nodes']
            if n.get('content')}


def set_status(item_id, option):
    d = gql('query{user(login:"bestdeejay-design"){projectV2(number:3)'
            '{field(name:"Status"){... on ProjectV2SingleSelectField{'
            'options{id name}}}}}}')
    opts = {o['name']: o['id']
            for o in d['user']['projectV2']['field']['options']}
    gql('mutation($p:ID!,$i:ID!,$f:ID!,$v:String!){updateProjectV2ItemFieldValue'
        '(input:{projectId:$p,itemId:$i,fieldId:$f,value:'
        '{singleSelectOptionId:$v}}){projectV2Item{id}}}',
        {'p': PROJECT, 'i': item_id, 'f': STATUS_FIELD, 'v': opts[option]})


def add_card(num, status):
    iid = issue_node(num)
    if not iid:
        print(f'#{num}: закрыт, пропускаю')
        return
    items = on_board()
    if num in items:
        set_status(items[num], status)
        print(f'#{num}: уже на борде, статус → {status}')
        return
    d = gql('mutation($p:ID!,$c:ID!){addProjectV2ItemById(input:'
            '{projectId:$p,contentId:$c}){item{id}}}',
            {'p': PROJECT, 'c': iid})
    item_id = d['addProjectV2ItemById']['item']['id']
    set_status(item_id, status)
    print(f'#{num}: карточка добавлена, статус {status}')


if __name__ == '__main__':
    plan = [
        (45, 'Ждёт'),      # Expedition P1 — ждём аудиты Арены/SZ
        (44, 'Бэклог'),    # большой запрос владельца (грейд сборщиков + визуал 2.0)
        (43, 'Бэклог'),    # масштаб цен в админке
        (42, 'Бэклог'),    # safe-mode boot + тост З3
        (49, 'Бэклог'),    # lovii-БД: публичный https
        (48, 'Ждёт'),      # Дом Г1–Г10 — ждёт правок владельца
        (33, 'Бэклог'),    # баг-лист ханта SZ
        (27, 'Бэклог'),    # система уровней
        (17, 'Бэклог'),    # токен из env
        (8,  'Бэклог'),    # баг-хант
        (5,  'Бэклог'),    # сейвы партии V3
    ]
    for num, status in plan:
        try:
            add_card(num, status)
        except SystemExit as e:
            print(f'#{num}: ошибка: {e}')
