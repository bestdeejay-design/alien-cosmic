# Модульные навыки агентов (`skills/`) — Progressive Disclosure

Вместо загрузки ~25 000 токенов всех регламентов на каждом холодном старте координатор подключает каждому саб-агенту **ровно те навыки, которые нужны под задачу** (`scripts/spawn-pack --auto` или `--skills <список>`), а нативные CLI-клиенты автоматически видят их через `.claude/skills/` и `.agents/skills/` (`scripts/install-skills`).

## 1. Процессные и защитные навыки ядра (5)

| Навык (`--skills`) | Файл | Кому выдавать обязательно | Когда подключать дополнительно |
|---|---|---|---|
| `subagent-collegium` | [subagent-collegium/SKILL.md](./subagent-collegium/SKILL.md) | Координатор, `auditor`, `researcher` | Любая задача `size:M` / `size:L`, сборка коллегии и 2-й волны со сменой ролей |
| `clean-execution` | [clean-execution/SKILL.md](./clean-execution/SKILL.md) | Свежий `executor` (Волна 1 и Волна 2) | Любое изменение кода, скриптов, тестов или шаблонов |
| `adversarial-review` | [adversarial-review/SKILL.md](./adversarial-review/SKILL.md) | `reviewer` (до кода и после кода) | Выдача `REVIEWER_KICK`, независимая проверка диффа, вердикт по `sha7` |
| `bus-delivery` | [bus-delivery/SKILL.md](./bus-delivery/SKILL.md) | Любой узел, сдающий работу в GitHub | `wait-signal --claim`, `size:S` Fast-Track, письмо `📬 DELIVERED` / `docs/MAIL.md` |
| `data-migration` | [data-migration/SKILL.md](./data-migration/SKILL.md) | `auditor`, `executor`, `reviewer` | Любая смена схем БД/JSON, сохранений, формул пересчёта, валидаторов |

## 2. Прикладные инженерные навыки и сквозной аудит (6)

| Навык (`--skills`) | Файл | Автоподбор (`--auto`) | Что закрывает на практике |
|---|---|---|---|
| `fullstack-audit` | [fullstack-audit/SKILL.md](./fullstack-audit/SKILL.md) | `--preset fullstack-audit` или межслойный аудит `FE + API + BE` | Сквозной 3-слойный read-only аудит готового проекта с проверкой стыков и матрицей `P0/P1/P2` |
| `root-cause-debugging` | [root-cause-debugging/SKILL.md](./root-cause-debugging/SKILL.md) | `type:bugfix` или сигналы бага/гонки/сбоя | Запрет лечения симптома: минимальный репро, трассировка сквозь слои, A/B на базе |
| `edge-case-testing` | [edge-case-testing/SKILL.md](./edge-case-testing/SKILL.md) | `type:test`, `agent:qa`, ревьювер, Волна 2 | Матрица пограничных входов, пагинации `>100`, кодов ошибок, идемпотентности и стресс-тестов |
| `minimal-safe-refactor` | [minimal-safe-refactor/SKILL.md](./minimal-safe-refactor/SKILL.md) | `type:debt` или рефакторинг/расчистка кода | Характеризационные тесты до правок, разделение структуры и логики, ноль мёртвого кода |
| `ui-render-verification` | [ui-render-verification/SKILL.md](./ui-render-verification/SKILL.md) | Файлы/текст Frontend/UI (`.tsx`, `.vue`, `.css` и др.) | 5 состояний экрана, защита двойного клика, живая геометрия `1440px` и `375px`, 0 ошибок консоли |
| `cli-and-api-robustness` | [cli-and-api-robustness/SKILL.md](./cli-and-api-robustness/SKILL.md) | Файлы/текст API, Backend, CLI, `type:infra` | Валидация границ, объектные права (`IDOR`), транзакции, таймауты, `ETag`/`429`, чистые коды выхода |

## 3. Нативный автоподхват в CLI и установка в готовый проект

- **В этом репозитории:** `python3 scripts/install-skills` синхронизирует все карточки и навыки в `.claude/agents/`, `.claude/skills/` (Claude Code / ZCode) и `.agents/skills/` (Codex CLI); `scripts/preflight` проверяет нулевой рассинхрон.
- **Раскатка в целевой проектный репозиторий одной командой** (не затирает чужие изменённые файлы без `--force`):
  ```bash
  python3 scripts/install-skills --target /path/to/project --with-harness
  ```
- **Автоподбор навыков и пресет полного аудита (Frontend + API + Backend):**
  ```bash
  python3 scripts/spawn-pack --role executor --auto --labels type:bugfix --radius frontend/App.tsx,api/auth.py --issue 50 ...
  python3 scripts/spawn-pack --preset fullstack-audit --output-dir /tmp/audit-packs
  ```
