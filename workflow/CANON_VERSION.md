# Версия комплекта канона (ADOPTION §2)

- Апстрим: hub-репо канона (адрес — `project.json` → `project.repo`), origin/main
  **841794a** (комплект D+: ADR-0003 «стерильное ядро + проектный оверлей», #170
  owner-guard «репозиторий закрыт по умолчанию», #169 «серверные Actions сняты с хаба»;
  предыдущая база копии — f793de3/ADR-0002)
- Скопировано координатором: **15.11.2026**, rsync в `workflow/` (режим B), с
  сохранением проектного слоя: `project.json`, `PROJECT.md`, этот файл
- Против f793de3 новое: ADR-0003 — имена сабов/проектов/доменов вынесены из ядра в
  оверлей (`project.json` + стерильный `PROJECT.md` по шаблону), `schema/bus.json`
  → 46 базовых меток (`to:owner|coordinator|pool` + roster-паттерн), архив хаба в
  `docs/history/` (не копируется), `tests/regression.py` = автоматический Гейт
  Чистоты в preflight; #170 — pre-push замок владельца (`scripts/guard`, закрыт по
  умолчанию) + запрет прямых пушей в main; #169 — серверные Actions хаба сняты;
  #168/#167/#166 — дедупликация CLAIM/SPEC_PACK/REVIEWER_KICK/Fast-Track, починка
  нумерации BUS; #165 — canon fingerprint в квитанции preflight; #164 — preflight
  требует phase:action на size:M/L; #162 — `CLAUDE.md` точка входа; #159 — метка
  шины `to:infra`; новые скиллы security-audit (black/white/grey-box, fintech,
  gaming, reporting) + `scripts/{guard,custodian,board_link,project_overlay}`
- Проектный оверлей создан: `workflow/project.json` (roster и префиксы
  веток — см. файл; состав: внешний изолированный исполнитель + пул
  direct_gh-исполнителей)
- Отображение уровней (PROJECT.md §5): test = локальные стенды + ветка test
  (Pages /test/); staging = игровой домен после ревью и полного регресса;
  production = Pages deploy-prod + rsync prod-сервера после приёмки владельца.
  rulesets/environments НЕ установлены — честный статус: «гейты на дисциплине»
- Хуки: `core.hooksPath=.githooks` в проекте указывает на несуществующий каталог
  корня (workflow/.githooks не подключён) — замок #170 и запрет пуша в main в
  проекте НЕ активны механически (работа по корневому AGENTS.md: координатор
  пишет в main). Подключение `workflow/.githooks` = отдельное решение владельца
  (конфликтует с практикой док-коммитов координатора в main)

## Верификация копии 15.11.2026

- Гейт Чистоты: 0 нарушений (PROJECT.md стерилен, имена — только в project.json)
- Гейты labels/префиксов/маркеров: зелёные с проектным оверлеем
- Автотесты preflight: **135/137**, 2 структурных красных (не регресс копии):
  1. `test_field_lessons…reference-workflow-source.txt` — файл-маркер перемещён в
     `docs/history/` апстримом; в режиме B ожидание «файла не существует»
     фактически выполняется, тест падает только на способ проверки (файл удалён,
     версия комплекта живёт здесь)
  2. `test_github_workflows_parse…ci.yml` — фолбэк Режима B находит собственные
     Actions проекта (check/deploy-prod/deploy-test) и требует хаб-имена
     ci/bus-hygiene/guard-main — непереносим в проект со своей автоматикой.
     Кандидат в issue апстрима (адаптация фолбэка на parse любых workflow)
- Старый механизм исключений `workflow/preflight.json` упразднён апстримом
  (preflight его больше не читает) — файл удалён; оба исключения старой базы
  (`test_documentation`, radius-guard) в новой базе зелёные — канон стал
  переносимым (ADR-0003), что и подтверждает прогон

## Обновление (регламент PROJECT.md §6)

fetch апстрима → diff от SHA выше → rsync (exclude `docs/history`, сохранение
проектного слоя) → поднять SHA и список нового здесь → preflight → коммит в main.
