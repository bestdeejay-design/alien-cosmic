# Версия комплекта канона (ADOPTION §2)

- Апстрим: bestdeejay-design/agents, origin/main **f793de3** (Workflow v2, ADR-0002 «Коллегия саб-агентов со сменой ролей, модульные навыки и механическое принуждение», вариант C утверждён владельцем 03.11.2026)
- Скопировано координатором: 06.11.2026 (раскладка: канон в `workflow/` — зеркало структуры апстрима; проектная конкретизация — `workflow/PROJECT.md`; корневой `AGENTS.md` проекта НЕ перезаписан — он канон владельца, совмещение по ADOPTION §2)
- Новое против f60565d: `agents/` (карточки ролей), `skills/` (модульные навыки + зеркала `.claude/`/`.agents/`), `scripts/{spawn-pack,install-skills,preflight,agent-runner,wait-signal v2.2.7}`, `schema/bus.json`, `.githooks`/`.github` (bus-hygiene, guard-main), тир size:S Fast-Track, 2 волны со сменой ролей на M/L, лестница принуждения (§12 COORDINATOR_RULES)
- Отображение уровней (PROJECT.md §Уровни): test = локальные стенды + ветка test (Pages /test/), staging = ace.dj1.ru/r/ после ревью и полного канона, production = Pages deploy-prod + rsync gostiny-prod-01 после приёмки владельца. Правила уровней соблюдены процессно; rulesets/environments (уровни 2–3 лестницы) НЕ установлены — честный статус: «гейты на дисциплине» (кандидат в задачи)
- Установка: `python3 workflow/scripts/preflight --install-hooks` выполнена в alien-cosmic (локальный уровень 1.5); GitHub Actions хаба (guard-main/bus-hygiene) в alien-cosmic не включены — кандидат в задачи
- Обновление: координатор перечитывает апстрим, rsync-копирует, сохраняя PROJECT.md/CANON_VERSION.md, поднимает SHA здесь

## Расхождения от апстрима f793de3 (project-layer patches)

1. **`scripts/preflight` — скоуп автотестов через `workflow/preflight.json`** (помечено в коде
   «PROJECT-LAYER PATCH (alien-cosmic, база канона f793de3)»). Единственное изменение логики:
   список тестовых файлов собирается по гло́бу `tests/test_*.py` с учётом исключений из
   `preflight.json` (`test_exclude_files` — файлы не запускаются; `test_exclude_ids` —
   точечные исключения отдельных тестов по fnmatch-гло́бу полного id) вместо одного фиксированного
   `discover -p test_*.py`. Без `preflight.json` поведение идентично апстриму.
   Причина: два хаб-теста структурно невыполнимы в проектной раскладке alien-cosmic:
   - `tests/test_documentation.py` (12 errors) — сверяет docs/scripts с BASE-коммитом истории
     **хаба** (`fedec3b8…` в bestdeejay-design/agents), которого в alien-cosmic нет
     (`git show` → 128). Проверки «approved owner decisions» — инварианты истории хаба, не проекта.
   - `tests/test_collegium_and_tooling.py::HooksWorkflowsAndRunnerTests::test_preflight_skip_tests_and_radius_guard`
     (1 failure) — требует чистого worktree всего репозитория (радиус-пробник против `git diff HEAD`);
     в alien-cosmic всегда есть чужие незакоммиченные файлы (design/shots, scripts/harness.mjs, sim_*)
     вне workflow/ → тест падает по состоянию репозитория, а не канона. Остальные 20 тестов модуля проходят.
   Исключённые тесты — кандидат в задачу на адаптацию к проектной раскладке (например,
   перепривязка BASE на снапшот в `workflow/reference-workflow-source.txt`).
