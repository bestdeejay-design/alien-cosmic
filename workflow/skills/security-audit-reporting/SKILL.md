---
name: security-audit-reporting
description: Отчётность аудита и пинтеста — executive summary, технические находки с доказательствами, CVSS, план исправлений и retest-сертификат
---

# Навык: Отчётность (`security-audit-reporting`)

Используй при сборке результата. Клиент платит за понятный результат, а не за «мы проверили».

## Обязательный состав

1. **Executive summary** ([../security-audit-core/support/templates/executive-summary.md](../security-audit-core/support/templates/executive-summary.md)) — 2–4 страницы бизнес-языком.
2. **Технический отчёт** ([../security-audit-core/support/templates/final-report.md](../security-audit-core/support/templates/final-report.md)) — методология, scope, карта, находки, «не проверено», ограничения.
3. **Находки** ([../security-audit-core/support/templates/finding.md](../security-audit-core/support/templates/finding.md)) — шаги воспроизведения, факт vs ожидание, влияние, CVSS + P0–P3, рекомендация.
4. **План исправлений** ([../security-audit-core/support/templates/remediation-plan.md](../security-audit-core/support/templates/remediation-plan.md)) — по приоритету, с ответственными и проверкой.
5. **Retest-сертификат** ([../security-audit-core/support/templates/retest-certificate.md](../security-audit-core/support/templates/retest-certificate.md)) — статусы: исправлено/частично/не исправлено.

## Правила

- Нет доказательств — нет находки. Гипотезы — в «не проверено / требует проверки».
- Секреты/PII в отчёте — только маски/хеши. Доказательства: скриншоты, логи, запросы, версии/коммиты, даты.
- CVSS фиксируй вектором и баллом; итоговый приоритет = max(CVSS, бизнес-влияние).
- Ограничения обязательны: дата/версия снимка, что не проверено, «не гарантирует отсутствие уязвимостей».
- Независимое ревью не автором до сдачи; вердикт — по точной версии отчёта.
