# AGENTS — быстрый вход (≤ 60 строк, Progressive Disclosure)

> Не читай весь репозиторий «на всякий случай». Загружай только свою роль, свою задачу
> и назначенные навыки (`ADR-0002`). Секреты в репо, issues и письма не класть никогда.

## 1. Холодный старт (строго по порядку)

1. `git fetch origin --prune && git status -sb` — работай только в ветке поставки от свежего `origin/main` (никогда не на `main`). Активируй защиту: `python3 scripts/preflight --install-hooks`.
2. Нет назначенного issue со `status:ready` и твоим `to:*` (или `to:sz-pool` для роя) — **работы нет**: спроси координатора или вернись в ожидание (`scripts/agent-runner` / `scripts/wait-signal`).
3. Прочитай **только**: бриф своего issue → карточку своей роли в [`agents/`](./agents/README.md) → выданные навыки в [`skills/`](./skills/README.md) → файлы внутри радиуса задачи.

## 2. Как устроена работа по ролям и тирам (`S / M / L`)

- **Координатор** обязан собирать пакеты саб-агентов через `scripts/spawn-pack` (`--auto` или `--skills`, для полного 3-слойного аудита проекта — `--preset fullstack-audit`), выдавать им роли ([`agents/`](./agents/README.md)) и навыки ([`skills/`](./skills/README.md)); нативный автоподхват в CLI (`.claude/`, `.agents/`) и раскатку в проект обеспечивает `scripts/install-skills` ([протокол коллегии](./agents/collegium.md)).
- **`size:S` (Fast-Track Дуэт, 1 волна):** без паузы на предварительный `GATE OPEN`. Свежий `executor` со скиллом делает мини-аудит + код + `python3 scripts/preflight` → свежий `reviewer` (не автор) проверяет и даёт `🔎 VERDICT` на точный `sha7`.
- **`size:M` и `size:L` (Коллегия 4 сабов + 2 волны со сменой ролей):**
  1. До кода: `auditor` (`AUDIT_PACK`) + `researcher` (`SPEC_PACK`) + `reviewer` (`REVIEWER_KICK` — ловушки отказа) → гейт `CONCLUSION` у координатора.
  2. Волна 1: **всегда свежий** `executor` пишет код → все 4 роли параллельно проверяют работу со своих сторон задачи.
  3. Волна 2 (смена ролей `executor ↔ reviewer`): бывший ревьювер руками в коде закрывает замечания и пишет стресс-тесты, а бывший исполнитель ревьюит дифф Волны 2. Никто никогда не аппрувит свой коммит.

## 3. Справочники по требованию (открывай только при необходимости)

- Статус и правила верхнего уровня: [STATUS.md](./STATUS.md), [PROTOCOL.md](./PROTOCOL.md), [WORKFLOW.md](./WORKFLOW.md), [BOARD.md](./BOARD.md), [BUS.md](./BUS.md), [OPS.md](./OPS.md).
- Детальные регламенты варианта C и внедрение в проекты: [docs/README.md](./docs/README.md), [docs/AGENTS.md](./docs/AGENTS.md), [docs/ADOPTION.md](./docs/ADOPTION.md).
- Единый машинный словарь меток и маркеров: `schema/bus.json`; предполётная самопроверка перед каждым пушем: `python3 scripts/preflight`.
