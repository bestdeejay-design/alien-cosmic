# AGENT PACKET — как запускать агента на <client>

> Короткая инструкция: что подставить агенту, в каком порядке, где остановиться.

## Состав пакета

| Файл | Роль | Зачем |
|---|---|---|
| [01-intake-filled.md](01-intake-filled.md) | контекст | что за проект, что болит, где TBD |
| [02-scope-roe-draft.md](02-scope-roe-draft.md) | **гейт** | без подписи агент не начинает активные проверки |
| [03-surface-map.md](03-surface-map.md) | карта | что видно снаружи |
| [04-threat-model.md](04-threat-model.md) | приоритеты | что атаковать первым |
| [05-audit-pack.md](05-audit-pack.md) | AUDIT_PACK | инварианты и точки слома |
| [06-spec-pack.md](06-spec-pack.md) | SPEC_PACK | конкретный план по чек-листам |
| [07-reviewer-kick.md](07-reviewer-kick.md) | контроль | ловушки и красные флаги |
| [09-questions-for-owner.md](09-questions-for-owner.md) | открытые вопросы | что мешает старту |
| [tools/passive-recon.sh](tools/passive-recon.sh) | инструмент | безопасная пассивная разведка staging |

## Навыки (skills) для сессии

- `security-audit-core` — scope/RoE-гейт, выбор режима, quality gates.
- `security-audit-grey-box` (+ `security-audit-black-box` для фазы 1).
- `security-audit-fintech` — деньги, ledger, вебхуки, баллы.
- `security-audit-reporting` — отчёт, находки, retest.

## Среда

Тестируем **staging**: `staging.example.com`, `b2b-staging.example.com`, `api-staging.example.com`
(моки банка и касс). Прод — только пассивное чтение публичных страниц.
Боевые платежи в пилоте запрещены.

Первый шаг на машине с доступом к staging:

```bash
bash security-audit/pilots/<client>/tools/passive-recon.sh
# результат: ./recon-<дата>/report.md + raw/
```

Скрипт делает ≤40 запросов с паузой, только GET/HEAD/OPTIONS. Это разведка, а не пинтест.

## Порядок запуска

1. Агент читает [06-ai-agent-protocol.md](../../06-ai-agent-protocol.md) и проверяет гейт scope/RoE.
2. Если гейт не пройден — **только** пассивная разведка и вопросы владельцу ([09](09-questions-for-owner.md)),
   без активных запросов.
3. Гейт пройден → фаза 0 (проверка среды staging) → фаза 1 (Black Box) → REVIEWER_KICK → фаза 2 (Grey Box).
4. Каждая находка сразу в [finding.md](../../templates/finding.md), не «потом соберу».
5. Финал: отчёт + план + retest, независимое ревью не тем же агентом.

## Роли (канон)

`auditor` (read-only карта) → `researcher` (план) → `executor` (проверки) → `reviewer` (контроль).
Ревьювер не автор отчёта. См. `agents/README.md` (описания ролей).

## Стоп-правила для агента

- Нет подписи scope → нет активных действий.
- Не подтверждено, что платёжный флоу на staging замокан → никаких транзакций.
- Обнаружены реальные ПДн или боевые ключи на staging → стоп и уведомление.
- Найден доступ к реальным PII/деньгам сверх scope → стоп и уведомление владельца.
- Сервис деградирует → стоп.
