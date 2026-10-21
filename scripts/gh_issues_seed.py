#!/usr/bin/env python3
# gh_issues_seed.py — посев задач репозитория в GitHub Issues (пакет Q, 22.10).
# Токен берётся из git remote (никогда не печатается и не коммитится).
# Скоуп repo — достаточно для issues/labels; Projects-борд — scripts/gh_board_setup.py.
import json, subprocess, sys, urllib.request

REPO = 'bestdeejay-design/alien-cosmic'
API = f'https://api.github.com/repos/{REPO}'

def token():
    u = subprocess.run(['git', 'remote', 'get-url', 'origin'], capture_output=True, text=True).stdout.strip()
    import re
    m = re.match(r'https://(?:[^:]+:)?([^@]+)@github\.com/', u)
    if not m: sys.exit('нет токена в remote')
    return m.group(1)

def req(method, path, body=None):
    r = urllib.request.Request(API + path, method=method,
        headers={'Authorization': f'Bearer {token()}', 'Accept': 'application/vnd.github+json'},
        data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(r) as res:
            return json.load(res)
    except urllib.error.HTTPError as e:
        print(f'HTTP {e.code}: {e.read().decode()[:300]}'); sys.exit(1)

# --- labels (создать, если нет) ---
existing = {l['name'] for l in req('GET', '/labels?per_page=100')}
LABELS = {
    'agent/zai':   ('делает Z.ai',       '1d76db'),
    'agent/arena': ('делает Арена',      '6f42c1'),
    'agent/owner': ('делает владелец',   'e99695'),
    'area/mobile': ('мобильная версия',  '0e8a16'),
}
for name, (desc, color) in LABELS.items():
    if name in existing: print(f'label ok: {name}')
    else: req('POST', '/labels', {'name': name, 'description': desc, 'color': color}); print(f'label создан: {name}')

# --- issues ---
AUDIT = 'design/MOBILE_VIEWPORT_AUDIT.md'
ISSUES = [
  dict(title='[Q] Политика жестов страницы — зум-ловушка закрыта (пакет Q поставлен)',
       labels=['agent/zai', 'area/mobile'], state='closed',
       body='Репорт владельца: правые 20–25% экрана «невидимы» + двойной тап зумит страницу без выхода.\n\n'
            'Корень (одна связка): страница зумится (effective touch-action auto на 10+ поверхностях), игра живёт в layout viewport, канвас touch-action:none блокирует щипок-назад.\n\n'
            'Поставлено в пакете Q (adb261f):\n'
            '- html{touch-action:manipulation} + body>*{pan-y} — зум страницы невозможен\n'
            '- gesturestart/change preventDefault — iOS Safari (meta игнорирует)\n'
            '- meta maximum-scale=1, user-scalable=no — Android-страховка\n'
            '- кнопка «Перезагрузить экран» в «Ещё» (аварийный люк)\n\n'
            f'Аудит: {AUDIT} · Приёмка: scripts/v_verify.mjs · Регресс полностью зелёный. Версия Q.'),
  dict(title='[R] visualViewport-устойчивость: игра следует за видимой областью (V2)',
       labels=['agent/zai', 'area/mobile'],
       body='Второй шаг из аудита ' + AUDIT + ' (§6 V2).\n\n'
            'Даже при закрытом зуме страницы остаются неблокируемые вебом зумы: системный iOS Zoom (три пальца) и AA-зум Safari.\n\n'
            'Сделать:\n'
            '- подписка visualViewport resize/scroll\n'
            '- при scale>1.01 канвас и HUD следуют за видимой областью (offsetLeft/Top/width/height)\n'
            '- одноразовый тост «Масштаб страницы изменён»\n'
            '- тесты на двух контекстах + CDP pageScaleFactor\n\n'
            'Оценка: ~80–120 строк + тесты. Пакет R.'),
  dict(title='Сейвы партии (V3) — продуктовый трек, нужен отдельный аудит',
       labels=['agent/zai'],
       body='Из ' + AUDIT + ' (§6 V3): полноценные сейвы партии (сериализация юнитов/зданий/тумана/путей/ИИ/экономики) как фича пауз-меню «Сохранить/Загрузить».\n\n'
            'НЕ делать как костыль от зума — причина закрыта пакетом Q. Перед кодом: аудит состояния (что сериализуемо детерминированно), формат сейва, совместимость между версиями.'),
  dict(title='Верификация пакета Q на телефоне: зум закрыт, скролл жив, играбельный щипок жив',
       labels=['agent/owner', 'area/mobile'],
       body='Чек-лист с телефона (iOS/Android):\n\n'
            '- [ ] двойной тап по любому месту (панели, фон, меню) НЕ зумит страницу\n'
            '- [ ] щипок двумя пальцами НЕ зумит страницу\n'
            '- [ ] меню и длинные списки скроллятся как раньше\n'
            '- [ ] играбельный зум мира жив: щипок по канвасу и кнопки +/- в тач-профиле\n'
            '- [ ] правый край карты достигается паном камеры, юниты видны\n'
            '- [ ] «Ещё» → «Перезагрузить экран» работает (подтверждение → перезагрузка)\n\n'
            'Если что-то не так — прислать модель телефона/браузера и что именно.'),
  dict(title='Синк ветки Арены: дельта пакетов T / U / Q',
       labels=['agent/arena'],
       body='Арена отсутствует с 21.10 (после письма H.1). При возвращении — по правилам почты читать ZAI_MAILBOX с начала задачи.\n\n'
            'Дельта синка: пакет T (6eee47f, тач-семантика), пакет U (c70113b, ScreenProfile — профиль ввода), пакет Q (adb261f, жесты страницы).\n'
            'НОВЫЙ модуль: js/profile.js. Твои раскладки E.1/M2/G.6 не тронуты; body>* pan-y действует только на топ-контейнеры.\n'
            'Письма с деталями: design/ZAI_MAILBOX.md, записи от 22.10.'),
  dict(title='Баг-хант «поиграть и сломать» — мобильный и десктоп-проход',
       labels=['agent/owner', 'agent/zai'],
       body='Трек качества, обсуждавшийся ранее: целевой прогон всех миссий + стыки систем.\n\n'
            'Фокус-зоны: тач-жесты × авторемонт-надстройка, профиль ввода (переключение Авто/Телефон/Компьютер на живых устройствах), новая политика жестов на Android.\n\n'
            'Формат: владелец играет и репортит → аудіт → ресерч → варианты → код (процесс как у пакета Q).'),
]

created = {}
for it in ISSUES:
    st = it.pop('state', 'open')
    r = req('POST', '/issues', it)
    created[r['number']] = (it['title'], st)
    print(f"issue #{r['number']}: {it['title']}")
    if st == 'closed':
        req('PATCH', f"/issues/{r['number']}", {'state': 'closed'})
        req('POST', f"/issues/{r['number']}/comments",
            {'body': 'Поставлено коммитом adb261f (main, 22.10.2026). Приёмка: scripts/v_verify.mjs, полный регресс зелёный.'})
print('\nГОТОВО: задачи в GitHub Issues')
