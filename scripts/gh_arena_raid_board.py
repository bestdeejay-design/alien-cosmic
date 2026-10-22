#!/usr/bin/env python3
"""gh_arena_raid_board.py — регистрация на борде уточнения направления A-3 (async raid).

Идемпотентен: комментарий по маркеру, статус не меняется (остаётся «На проверке»).
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

def comment(num, marker, body):
    cs = req('GET', f'/repos/{REPO}/issues/{num}/comments?per_page=100')
    if any(marker in c.get('body', '') for c in cs):
        print(f'#{num}: комментарий уже есть'); return
    req('POST', f'/repos/{REPO}/issues/{num}/comments', {'body': body})
    print(f'#{num}: комментарий добавлен')

comment(25, 'A3-V2-ASYNC-RAID',
'**Направление обновлено владельцем — async raid (ресерч v2 принят).**\n\n'
'Защитник офлайн: набег идёт на снимок его сохранённой базы, отчёт и урон приходят позже. '
'Live 1v1/lockstep/WSS/WebRTC для MVP НЕ нужны; фазировка R0–R4 заменила M0–M3:\n'
'- R0 локальный loop (база-корабль/КЦ, seeded bot-target, tier-1–5, 8–15д)\n'
'- R1 persistent vertical slice (API+DB, snapshot+одноразовый raid ticket, атомарный '
'settlement loot/damage, 15–30д)\n'
'- R2 закрытая alpha одного диапазона (8–15д) → R3 рост мира → R4 живой бой (опционально)\n\n'
'Канон-граница: локальный сейв и серверное состояние базы — разные trust domains; '
'локальный импорт/откат не меняет онлайн-ресурсы. Сетевой запрет в check.mjs остаётся — '
'MVP-клиент без сети, backend отдельный сервис.\n\n'
'**Осталось решить владельцу:** роль корабля-КЦ; отряд разовый vs на каждый рейд; '
'диапазоны+матчмейкинг; кап офлайн-добычи; trust-модель (bot-only / alpha с малыми '
'наградами / replay-валидация); backend бюджет/регион.\n\n'
'Ресерч влиты в main (merge 2eac75e, письмо f4b73c9 в ARENA_MAILBOX.md). Статус остаётся '
'«На проверке». R0 и сейвы S0 независимы — возможен отдельный GO по каждому.')

comment(5, 'A3-V2-NO-CHANGE',
'Уточнение направления (async raid) не меняет сейвовый трек: глава 1 ресерча и фазировка '
'S0–S3 без изменений (см. `design/ARENA_RESEARCH_SAVE_MULTIPLAYER.md` на main). Вопросы '
'владельцу прежние: локально vs облако; точность восстановления vs чекпоинт; 1 autosave '
'+ 3 ручных слота / история 50 результатов.')
print('готово')
