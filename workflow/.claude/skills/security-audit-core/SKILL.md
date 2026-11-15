---
name: security-audit-core
description: Ядро аудита и пинтеста игровых и финтех-проектов — выбор Black/Grey/White Box, scope, RoE, процесс и гейты качества
---

# Навык: Ядро аудита и пинтеста (`security-audit-core`)

Используй этот навык **всегда** при любой проверке безопасности: сначала scope и разрешение,
потом режим, потом проверки. Без подписанного scope/RoE — стоп.

## Обязательный порядок

1. Прочитай [support/03-process-and-rules.md](support/03-process-and-rules.md) и [support/templates/scope-authorization-roe.md](support/templates/scope-authorization-roe.md).
   Нет разрешения — не начинай, верни координатору.
2. Выбери режим по [support/01-methodology.md](support/01-methodology.md): Black (только публичное), Grey (часть доступов),
   White (полный код). Зафиксируй режим и домен в пакете.
3. Подключи режимный навык (`security-audit-black-box` / `-grey-box` / `-white-box`),
   доменный (`security-audit-gaming` / `-fintech`) и `security-audit-reporting` для отчёта.
4. Построй карту поверхности и threat model, затем план по чек-листу режима + домена.
5. Каждую находку — по [support/templates/finding.md](support/templates/finding.md) с доказательствами.
   Нет шагов воспроизведения — нет находки; непроверенное — в список «не проверено».

## Запреты

- Не атаковать вне scope, не трогать третьих лиц, без DoS/деструкции/эксфильтрации сверх PoC.
- Не выдумывать находки, не класть секреты/PII открытым текстом, не менять код клиента (read-only).
- Не подменять пинтест сканером; сканер — инструмент, а не методология.

## Гейты качества

- Чек-лист режима + домена пройден или «не проверено» с причинами.
- CVSS + бизнес-приоритет (P0–P3) по каждой находке.
- Независимое ревью не автором; отчёт по [support/templates/final-report.md](support/templates/final-report.md).
- Стоп-условия и coordinated disclosure — по [support/03-process-and-rules.md](support/03-process-and-rules.md).
