# Модульные навыки агентов (`skills/`) — Progressive Disclosure

Вместо загрузки всех регламентов канона на каждом холодном старте координатор подключает каждому саб-агенту **ровно те навыки, которые нужны под задачу** (`scripts/spawn-pack --auto` или `--skills <список>`), а нативные CLI-клиенты автоматически видят их через `.claude/skills/` и `.agents/skills/` (`scripts/install-skills`).

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

## 3. Аудит безопасности и пентест (`security-audit-*`, 7)

Доменный пакет для проверок безопасности игровых и финтех-проектов (паспорт модуля — [docs/modules/security-audit.md](../docs/modules/security-audit.md)). Выдаётся только под задачи аудита/пентеста; **без подписанного scope/RoE работа не начинается** — `security-audit-core` возвращает пакет координатору. Каждая находка — только с доказательствами (PoC, шаги воспроизведения); непроверенное фиксируется в списке «не проверено».

| Навык (`--skills`) | Файл | Автоподбор (`--auto`) | Когда выдавать и что закрывает |
|---|---|---|---|
| `security-audit-core` | [security-audit-core/SKILL.md](./security-audit-core/SKILL.md) | Сигналы текста задачи: пентест, аудит безопасности, уязвимости и т.п. | Всегда первым: scope/RoE-гейт, выбор режима Black/Grey/White, threat model, гейты качества |
| `security-audit-black-box` | [security-audit-black-box/SKILL.md](./security-audit-black-box/SKILL.md) | Явный режим Black Box в задаче | Проверка только по публичной поверхности: recon, внешняя аутентификация, инъекции, бизнес-логика снаружи |
| `security-audit-grey-box` | [security-audit-grey-box/SKILL.md](./security-audit-grey-box/SKILL.md) | Явный режим Grey Box в задаче | Часть доступов — стандартный продаваемый пакет: код виден частично, проверки по чек-листу режима |
| `security-audit-white-box` | [security-audit-white-box/SKILL.md](./security-audit-white-box/SKILL.md) | Явный режим White Box в задаче | Полный доступ (код, схемы, конфиги): статический анализ, логика, доверенные границы |
| `security-audit-gaming` | [security-audit-gaming/SKILL.md](./security-audit-gaming/SKILL.md) | Явные ключевые слова игрового домена (игры, донат, лутбоксы, читы, античит) | Игровые риски: дюп валюты, client-authoritative награды, подделка платежей, RNG, аккаунты/UGC |
| `security-audit-fintech` | [security-audit-fintech/SKILL.md](./security-audit-fintech/SKILL.md) | Явные ключевые слова финтех-домена (платежи, кошельки, KYC/AML, ledger) | Финтех-риски: double spend, вебхуки, IDOR на средства, PII в логах, секреты и API-ключи |
| `security-audit-reporting` | [security-audit-reporting/SKILL.md](./security-audit-reporting/SKILL.md) | Вместе с `security-audit-core` | Сборка отчёта: executive summary, находки с CVSS и P0–P3, план исправлений, retest-сертификат |

Доменные навыки (`-gaming`, `-fintech`) и режимные (`-black-box`, `-grey-box`, `-white-box`) **не входят в `default_skills` ролей** в `schema/bus.json` — они подключаются автоподбором по явным сигналам задачи или вручную через `--skills`, чтобы не грузить сабов не-аудитных задач.

## 4. Нативный автоподхват в CLI и установка в готовый проект

- **В этом репозитории:** `python3 scripts/install-skills` синхронизирует все карточки и навыки в `.claude/agents/`, `.claude/skills/` (Claude Code и совместимые CLI) и `.agents/skills/` (Codex CLI); `scripts/preflight` проверяет нулевой рассинхрон.
- **Раскатка в целевой проектный репозиторий одной командой** (не затирает чужие изменённые файлы без `--force`):
  ```bash
  python3 scripts/install-skills --target /path/to/project --with-harness
  ```
- **Автоподбор навыков и пресет полного аудита (Frontend + API + Backend):**
  ```bash
  python3 scripts/spawn-pack --role executor --auto --labels type:bugfix --radius frontend/App.tsx,api/auth.py --issue 50 ...
  python3 scripts/spawn-pack --preset fullstack-audit --output-dir /tmp/audit-packs
  ```
