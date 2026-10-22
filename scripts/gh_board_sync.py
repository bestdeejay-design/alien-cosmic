#!/usr/bin/env python3
"""Синхронизация борда «Alien Cosmic — задачи» (Projects V2, projects/3).

Команды:
  python3 scripts/gh_board_sync.py status                 — все карточки и статусы
  python3 scripts/gh_board_sync.py set 19 "На проверке"   — статус карточки issue
  python3 scripts/gh_board_sync.py comment 19 "текст..."  — комментарий к issue
  python3 scripts/gh_board_sync.py open "титул" "тело"    — новый issue

Токен берётся из git remote origin (как в gh_board_setup.py).
"""
import json
import os
import re
import sys
import urllib.request

GH = 'https://api.github.com'
OWNER = 'bestdeejay-design'
REPO = 'alien-cosmic'
PROJECT_NUMBER = 3
STATUSES = ['Бэклог', 'К работе', 'В работе', 'На проверке', 'Ждёт', 'Готово']


def token():
    url = os.popen('git remote get-url origin').read().strip()
    m = re.search(r'//([^@]+)@', url)
    if not m:
        sys.exit('нет токена в remote origin')
    return m.group(1)


def req(method, path, body=None):
    r = urllib.request.Request(GH + path, method=method,
        headers={'Authorization': f'Bearer {token()}', 'Accept': 'application/vnd.github+json'},
        data=json.dumps(body).encode() if body is not None else None)
    with urllib.request.urlopen(r) as res:
        raw = res.read()
        return json.loads(raw) if raw else {}


def gql(query, variables=None):
    r = urllib.request.Request('https://api.github.com/graphql', method='POST',
        headers={'Authorization': f'Bearer {token()}'},
        data=json.dumps({'query': query, 'variables': variables or {}}).encode())
    with urllib.request.urlopen(r) as res:
        out = json.loads(res.read())
    if out.get('errors'):
        sys.exit('GraphQL: ' + json.dumps(out['errors'], ensure_ascii=False))
    return out['data']


def project_items():
    q = '''
    query($n:Int!){
      user(login:"%s"){ projectV2(number:$n){
        items(first:60){ nodes{
          id
          content{ ... on Issue{ number title state url } }
          fieldValues(first:10){ nodes{
            ... on ProjectV2ItemFieldSingleSelectValue{ name field{ ... on ProjectV2FieldCommon{ name } } } }
          }
        } }
      } }
    }''' % OWNER
    return gql(q, {'n': PROJECT_NUMBER})['user']['projectV2']['items']['nodes']


def status_field():
    q = '''query{ user(login:"%s"){ projectV2(number:%d){
      field(name:"Status"){ ... on ProjectV2SingleSelectField{
        id options{ id name } } } } } }''' % (OWNER, PROJECT_NUMBER)
    return gql(q)['user']['projectV2']['field']


def project_id():
    q = 'query{ user(login:"%s"){ projectV2(number:%d){ id } } }' % (OWNER, PROJECT_NUMBER)
    return gql(q)['user']['projectV2']['id']


def set_status(issue_num, status_name):
    if status_name not in STATUSES:
        sys.exit(f'статус должен быть из {STATUSES}')
    item = next((i for i in project_items()
                 if i['content'] and i['content'].get('number') == int(issue_num)), None)
    if not item:
        sys.exit(f'карточка #{issue_num} не найдена на борде')
    field = status_field()
    opt = next(o for o in field['options'] if o['name'] == status_name)
    gql('''mutation($p:ID!,$i:ID!,$f:ID!,$v:String!){
      updateProjectV2ItemFieldValue(input:{projectId:$p,itemId:$i,fieldId:$f,
        value:{singleSelectOptionId:$v}}){ projectV2Item{ id } } }''',
        {'p': project_id(), 'i': item['id'], 'f': field['id'], 'v': opt['id']})
    print(f'#{issue_num}: статус -> {status_name}')


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'status'
    if cmd == 'status':
        for it in project_items():
            if not it.get('content'):
                continue
            st = next((fv['name'] for fv in it['fieldValues']['nodes']
                       if fv.get('field') and fv['field']['name'] == 'Status'), '—')
            c = it['content']
            print(f"#{c['number']:<3} [{st}] {c['title']} ({c['state']})")
    elif cmd == 'set':
        set_status(sys.argv[2], sys.argv[3])
    elif cmd == 'comment':
        num, body = sys.argv[2], sys.argv[3]
        req('POST', f'/repos/{OWNER}/{REPO}/issues/{num}/comments', {'body': body})
        print(f'#{num}: комментарий добавлен')
    elif cmd == 'open':
        iss = req('POST', f'/repos/{OWNER}/{REPO}/issues',
                  {'title': sys.argv[2], 'body': sys.argv[3]})
        print(f"создан #{iss['number']}: {iss['title']}")
    else:
        sys.exit(__doc__)


if __name__ == '__main__':
    main()
