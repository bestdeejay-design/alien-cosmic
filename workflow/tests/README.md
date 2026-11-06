# Воспроизводимые проверки

Проверки ниже относятся к предложенному диффу поверх базы
`fedec3b8702f71ab89c10294158858b5f7c5520e`. Нужны Python 3, Git, Bash и PyYAML;
для повторной выборки labels — `gh` с доступом на чтение. В этом запуске были
Python 3.11.2, Git 2.39.5 и PyYAML 6.0.3. Установка в отдельный временный каталог:

```sh
python3 -m pip install --target /tmp/agents-docs-pyyaml -r tests/requirements.txt
export PYTHONPATH=/tmp/agents-docs-pyyaml
export PYTHONDONTWRITEBYTECODE=1
python3 -m unittest discover -s tests -p 'test_*.py' -v
for script in scripts/wait-signal docs/create-labels.sh docs/project-apply.sh; do
  bash -n "$script" || exit 1
done
git diff --check
git diff --cached --check
```

15 тестов проверяют конкретные инварианты C и текущие изменения: в том числе
неизменность решений владельца и скриптов, неизменность отобранной истории, локальный
поднабор схемы форм, отсутствие closing keywords в действующих шаблонах и маршруты
после копирования комплекта `docs/` в синтетический проект. Это не установщик и не
проверка внедрения в реальный проект. Проверка незатирания касается текста инструкции,
а не исполнения автоматизированного merge. Код теста — `test_documentation.py`.
Дополнительно `test_collegium_and_tooling.py` покрывает Workflow v2 (`ADR-0002`):
единую схему `schema/bus.json` (52 labels + 21 маркер + тиры `S/M/L`), компактность
`AGENTS.md` и 11 модулей `skills/*/SKILL.md`, нативную синхронизацию `.claude/` +
`.agents/` и безопасную раскатку в целевой проект через `scripts/install-skills`,
Delegation Enforcer `scripts/spawn-pack` (включая `--auto`, `--preset fullstack-audit`,
`REVIEWER_KICK` и 2-ю волну со сменой ролей), `scripts/preflight`, `.githooks/pre-push`,
`.github/workflows/*.yml`, фильтрацию/ETag в `scripts/agent-runner` и обработку
`skipped`/`neutral` проверок в `scripts/wait-signal`.

## Поведенческие тесты wait-signal: `test_wait_signal.py`

`scripts/wait-signal` больше не сверяется побайтово с исторической базой: эта
проверка v2.1.0 зафиксирована в [VALIDATION-2026-11-03.md](../docs/VALIDATION-2026-11-03.md),
а актуальное поведение покрывается поведенческими тестами. `test_documentation.py`
оставляет byte-match только для `docs/create-labels.sh` и `docs/project-apply.sh`.

Запуск (без сети, без `gh`, ~45–50 секунд):

```sh
python3 -I -m unittest discover -s tests -p 'test_*.py'
```

Механика: `tests/mock_gh.py` — подменный `gh`, который тест копирует во
временный каталог в `PATH` и который эмулирует подмножество `gh api`,
используемое скриптом: условные чтения с `-i`/ETag/304, постраничные комментарии
(per_page=100&page=N), постраничные check-runs, claim-выборки
(`sort=created&direction=desc`), POST claim-комментария, PATCH labels, DELETE
своего комментария. Состояние (labels, комментарии, checks, счётчики 304)
и сценарий (404, временный HTTP-сбой, впрыск чужого claim в гонке) живут в
JSON во временных каталогах; крупные наборы вынесены в фикстуры
`tests/fixtures/json/wait-signal-*.json` (101 комментарий, 150 check-runs).

Покрываемые сценарии: словарные маркеры (11 имён через `--match`) и негативы
(`NOTDONE`, `DONEISH`, `DONE2`, `DONE-ish`, `NEEDS-HUMAN-ISH`, `CLAIMED-vs-CLAIM`
не матчатся); пагинация комментариев (маркер на №101 из 101); пагинация checks
(150/150 → CI-сигнал; total=0 → сигнала нет); 404 issue → код 2; временный
HTTP-сбой → поллинг продолжается до сигнала; 304 при повторных поллингах;
claim: CLAIMED (labels ready → in-progress + `to:*`), BUSY по чужому CLAIM
(код 3), BUSY с упоминанием ♻️ RECLAIMED в in-progress, RESUME своего
независшего claim, LOST в гонке с более ранним чужим claim.

Ограничения: мок проверяет поведение скрипта на подмножестве API GitHub, а не
сам GitHub; реальные гонки, rate limit и GraphQL не покрываются. `sleep 3`
арбитража claim исполняется реально, поэтому тесты claim занимают несколько секунд каждый.

## Полный перечень категорий docs-регресса: A/B

Скрипт инвентаризирует все Markdown-файлы, включая историю, плюс issue forms. Одна
и та же зафиксированная выборка names labels используется для базы и ветки:

```sh
BASE=fedec3b8702f71ab89c10294158858b5f7c5520e
BASE_DIR=$(mktemp -d)
git archive "$BASE" | tar -x -C "$BASE_DIR"
LABELS=tests/fixtures/labels-2026-11-03.json
python3 tests/regression.py --root "$BASE_DIR" --labels-json "$LABELS" --output /tmp/agents-base.json
printf 'baseline exit: %s\n' "$?"
python3 tests/regression.py --root . --labels-json "$LABELS" --output /tmp/agents-current.json
printf 'candidate exit: %s\n' "$?"
python3 tests/check_core_labels.py --root "$BASE_DIR" --labels-json "$LABELS"
python3 tests/check_core_labels.py --root . --labels-json "$LABELS"
```

Для буквального сравнения сохранена read-only выборка 62 имён, полученная командой
`gh label list --limit 1000 --json name` 03.11.2026. Чтобы сравнить с текущим
состоянием GitHub, запиши новый вывод в отдельный временный файл и передай его вместо
`LABELS`. Никакой label не создаётся: `check_core_labels.py` сначала проверяет
закреплённый SHA скрипта создания labels, затем запускает его с подменённым `gh`,
который лишь записывает имена во временный файл. При другом SHA проверка откажется
исполнять скрипт до нового рассмотрения.

`regression.py` выводит пять категорий из C §4.9: внутренние ссылки, известные
имена проекта, синтаксис и поднабор схемы YAML, кандидаты labels, потенциальные
плейсхолдеры. Полные места и тексты — в JSON-файлах `/tmp/agents-base.json` и
`/tmp/agents-current.json`; содержимое необходимо просмотреть в контексте. Код
завершится с 1 при найденных совпадениях имени, неподтверждённых labels, битых
ссылках или ошибках формы: это консервативный результат, не утверждение, что
каждое совпадение — реальный дефект. При отсутствии файла labels проверка также
не считается успешной. Сравнение и классификация приведены в отчёте валидации.

Ограничения инструмента: ссылки проверяются для обычной inline-синтаксики Markdown
вне code fences и inline-кода; якоря, reference links, HTML и внешние адреса не
разбираются. Греп имён проверяет известный полевой кейс, а не все возможные имена.
Распознавание labels и плейсхолдеров лексическое: исторические альтернативы,
обозначения-переменные и примеры форм могут давать кандидатов, но не являются
автоматически текущими задачами без владельца. Проверить контекст обязан человек.
Локальный YAML-парсер проверяет выбранные типы и обязательные поля, но не весь
серверный валидатор GitHub. Это не реальные субагенты, живые проекты, гонки,
серверный UI, деплой или независимое ревью.
