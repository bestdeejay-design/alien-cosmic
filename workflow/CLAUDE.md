# CLAUDE.md — точка входа для Claude Code

> Тонкий указатель, а не регламент. Полные правила — в [AGENTS.md](./AGENTS.md)
> (холодный старт, роли, тиры). Не дублируй их здесь.

- **Канон:** [AGENTS.md](./AGENTS.md) → [PROTOCOL.md](./PROTOCOL.md) → [WORKFLOW.md](./WORKFLOW.md) → [BUS.md](./BUS.md).
- **Роли саб-агентов:** [agents/README.md](./agents/README.md) (`auditor`, `researcher`, `executor`, `reviewer`).
- **Навыки:** [skills/README.md](./skills/README.md) (18 навыков, progressive disclosure — грузи только выданные).
- **Проверка перед пушем:** `python3 scripts/preflight` и `python3 scripts/install-skills --check`.
- **Словарь меток и маркеров:** `schema/bus.json` (машинный источник).
