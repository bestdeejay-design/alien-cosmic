# RESEARCH — лучшие практики: что взять извне, что не брать

> Дата: 27.10.2026. Статус: research/draft, не канон.
> Вопрос ресёрча: есть ли у схемы «координатор + агенты + GitHub Issues + labels +
> гейты + окружения» подтверждённые внешние образцы, и что они делают иначе.
> Ответ коротко: схема — сложившийся паттерн, а не изобретение. Ниже — 7 направлений
> с источниками и вердиктом «брать / адаптировать / не брать» для нашего общего слоя.

---

## 1. GitHub Issues как протокол координации агентов

Практика «issues = шина координации» описана как устойчивый паттерн: агенты на разных
машинах и платформах координируются через worklist, сессии, коммиты и issues, причём
агенты рутинно ревьюят работу друг друга при переключении между ними
[1](https://www.infoworld.com/article/4224587/the-agent-coordination-protocol-hiding-in-plain-sight-github-issues.html).
GitHub прямо развивает это направление: Agentic Workflows (gh-aw) компилирует Markdown-описания
автоматизаций в обычные GitHub Actions, агент по умолчанию read-only, а записи выполняются
только через валидируемые safe-outputs отдельными job'ами с ограниченными правами
[3](https://github.com/github/gh-aw).
Официальный блог GitHub о мультиагентных воркфлоу подчёркивает главное: как только агенты
трогают связанные задачи, они начинают делать неявные допущения о состоянии, порядке и
валидации — нужны явные инструкции, форматы данных и интерфейсы между стадиями
[4](https://github.blog/ai-and-ml/generative-ai/multi-agent-workflows-often-fail-heres-how-to-engineer-ones-that-dont/).

Внутри экосистемы gh-aw уже есть рабочие роли-паттерны: Issue Arborist (связывает sub-issues),
Issue Monster (диспетчер, назначает задачи по одной), Mergefest (подтягивает main в PR-ветки)
[4](https://github.github.io/gh-aw/blog/2026-01-13-meet-the-workflows-issue-management/) —
имена другие, но это ровно наши «координатор / диспетчер / интегратор».

**Вердикт: брать как подтверждение архитектуры, не как зависимость.** Наш воркфлоу должен
работать на чистом GitHub (issues + labels + PR) без обязательного gh-aw. gh-aw и подобные
оркестраторы — кандидат на автоматизацию *позже* (авто-разблокировка depends-on, авто-launch-пакеты),
когда ручной процесс обкатан. Прототип в `reference-workflow-source.txt` (§§ «Аналоги»)
приходит к тому же выводу по Issue-Orchestrator / Bram / Gas Town — аудит с этим согласен.

**Важная деталь из практики label-машин:** взаимоисключающие статусные labels нуждаются
в документированной машине состояний и в ремонте дрейфа, когда labels разошлись с
последним доверенным комментарием; переходы рекомендуют делать одной атомарной заменой
`--remove-label OLD --add-label NEW` [17](https://github.com/glennfaison/github-agent-workflow/issues/22).
Это прямо закрывает наш риск Р1 (комбинаторный взрыв) — правилом «ровно один status,
ровно один phase» и процедурой label-repair у координатора.

## 2. Один владелец стадии, явные контракты артефактов

Обобщение работающих мультиагентных систем на GitHub: линейный пайплайн, где каждая стадия —
label, у каждой стадии один владелец, завершение стадии = смена label (этот вывод уже есть
в стенограмме прототипа, и внешний блог GitHub его подтверждает требованием явных
интерфейсов между стадиями [4](https://github.blog/ai-and-ml/generative-ai/multi-agent-workflows-often-fail-heres-how-to-engineer-ones-that-dont/)).
Продвинутая форма — task graph с явными чекпоинтами: каждый узел декларирует роль,
разрешённые инструменты, входной и выходной контракты, бюджет и нужно ли одобрение человека
перед продолжением [1](https://github.com/orgs/community/discussions/185990).

**Вердикт: брать.** Наш ARCA — частный случай: стадии audit/research/conclusion/action,
владелец перехода в action — только координатор. В финальный комплект добавить то,
чего прототипу не хватает: входной/выходной контракт каждой фазы одной таблицей
(уже частично есть в KNOWLEDGE_BASE прототипа) и бюджет фазы (лимит «1 экран» — зародыш бюджета).

## 3. Сначала исследование и план, потом код (Explore → Plan → код)

Anthropic официально рекомендует для Claude Code цикл Explore, Plan, Implement, Commit
и прямо предупреждает: «давать агенту сразу писать код — получать код, решающий не ту задачу»;
план при этом должен быть самодостаточным: файлы и интерфейсы, что вне скоупа, и шаг
сквозной проверки в конце [6](https://www.augmentcode.com/guides/claude-code-spec-driven-development).
Та же мысль в spec-driven практиках: итерация по плану до состояния «негде двусмысленности»,
только потом исполнение; и обратная граница — если дифф описывается одним предложением,
план/спеку пропускают [3](https://felipefontoura.com/articles/what-is-spec-driven-development/).
JetBrains описывает тот же приём со стороны Junie: сначала `requirements.md` → `plan.md`,
«вы просите AI сначала думать, а не сразу кодить» [19](https://blog.jetbrains.com/junie/2025/10/how-to-use-a-spec-driven-approach-for-coding-with-ai/).

**Вердикт: брать, это внешняя валидация ARCA и размеров S/M/L.** ARCA = Explore (AUDIT)
+ Plan (RESEARCH+CONCLUSION) + Implement (ACTION) + Commit, завёрнутые в labels и гейт.
Граница Anthropic «дифф одним предложением — без плана» совпадает с нашим size:S.
Следствие для шаблонов: в CONCLUSION обязательно поле сквозной проверки
(«как докажу, что работает») — в прототипе его нет, добавить (см. варианты, C-решение по C13).

## 4. Инструкция агента: коротко, в репозитории, с прогрессивным раскрытием

Конвенция AGENTS.md принята десятками тысяч проектов как файл инструкций именно для агента
(README — для человека, AGENTS.md — для агента) [1](https://www.matthewswong.com/en/blog/agentic-coding-workflow-best-practices/).
Практики сходятся: файл должен быть коротким (рекомендации — до ~200 строк; раздутые файлы
агент начинает игнорировать), а детали выносить в linked-документы, которые подгружаются
по мере надобности (progressive disclosure) [4](https://mac.install.guide/ai/agent-instructions/best-practices),
[14](https://nyosegawa.com/en/posts/coding-agent-workflow-2026/).
Разделять надо долговечные конвенции репозитория (где что лежит, как проверять, границы)
и намерение текущей задачи (живёт в issue/PR); склеивание транскриптов в «память» вредит
будущим сессиям [6](https://www.claudeworkshop.com/research/agentic-coding-governance-20260516-0456).
И ключевое: инструкции бывают недетерминированные (модель читает и решает) и детерминированные
(хуки, deny-правила, CI, гейты) — для запретов нужен второй тип, где платформа позволяет
[3](https://code.claude.com/docs/en/best-practices).

**Вердикт: брать как форму финальной документации.** Отсюда спецификация в
[AGENT-DOCS-SPEC.md](./AGENT-DOCS-SPEC.md): короткий корневой `AGENTS.md` (маршрут чтения,
не энциклопедия) + `docs/AGENT_RULES.md` / `COORDINATOR_RULES.md` / `KNOWLEDGE_BASE.md`
как раскрываемые детали. Ни в коем случае не один файл на 2452 строки.

## 5. Ветки и окружения: промоутить артефакт, а не слияние

DORA (крупнейшая программа исследований поставки ПО) стабильно находит trunk-based development
ключевым предиктором высокой производительности: короткие ветки (ориентир — меньше суток),
частая интеграция в trunk, main всегда пригоден к деплою [5](https://dora.dev/capabilities/trunk-based-development/).
Длинные ветки коррелируют с ростом конфликтов, времени поставки и доли неудачных изменений;
создатель GitFlow сам не рекомендует его для непрерывно поставляемых продуктов
[1](https://dev.to/acestus/trunk-based-development-vs-git-flow-2kb5).
Отдельно в аудитах ветвлений антипаттерном называют цепочку веток dev→staging→prod со
слияниями: ветки расходятся, и однажды staging «догоняют» в main с непроверенным кодом;
лучше «build once, promote the artifact» — продвигать тот же коммит/артефакт через окружения
[13](https://www.pixelseed.net/git-branching-strategy-best-practices-gitflow-vs-trunk-based-development-for-dev-teams).

**Вердикт: адаптировать.** Общий слой (по решению владельца) не называет веток вообще:
уровни test/staging/production — это *гейты над одним и тем же коммитом*, а не ветки,
сливаемые по цепочке. Проектный слой выбирает механику: trunk + теги/релизы, GitHub Flow,
или ветки окружений — но обязан показать, что в production попадает тот же SHA,
что прошёл staging. Для нашей команды с редкими релизами и приёмкой владельца
полный trunk-based не навязываем — навязываем инвариант «один SHA сквозь уровни».

## 6. Гейты платформы: protection, CODEOWNERS, environments

GitHub разделяет два разных гейта: branch protection/rulesets гейтят *слияние*,
а environment protection rules гейтят *деплой* уже после слияния: required reviewers
(до 6, достаточно одного approve), опция prevent self-review, wait timer, ограничение
веток/тегов, которым разрешён деплой в окружение [6](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments),
[1](https://sph.sh/en/posts/github-environments-approval-gates/).
CODEOWNERS сам по себе только *запрашивает* ревью и ничего не блокирует; блокировка появляется
только в связке с branch protection «Require review from Code Owners» [7](https://www.resumelens.org/blog/github/github-codeowners-branch-protection).
Практические рекомендации сходятся: required checks + strict (ветка актуальна перед слиянием),
CODEOWNERS на чувствительные пути (`.github/workflows/`, infra, auth), отдельный явный hotfix-путь
вместо разовых исключений [2](https://learn.programmingline.com/learn/cicd/cicd-branch-protection-required-checks),
[10](https://learn.github.com/product-guides/github-actions/succeed-long-term/implement-deployment-controls-and-environment-protection).
Для агентских конфигураций отдельно рекомендуют защищать сами файлы инструкций агентов
(AGENTS.md и подобные) правилами с обязательным человеческим ревью [19](https://github.com/orgs/community/discussions/193359).

**Вердикт: брать как детерминированную половину воркфлоу.** В общем слое фиксируем
*требования к гейтам* (production: required reviewer ≠ автор, prevent self-review,
только принятые коммиты; регламенты и `.github/` — под CODEOWNERS владельца/координатора),
а конкретные настройки — проектный слой в UI GitHub. В этом docs-only репозитории
применимый минимум: CODEOWNERS на `PROTOCOL.md`, `WORKFLOW.md`, `docs/` + правило
«direct push в main запрещён процессом» до настройки protection владельцем.

## 7. ADR и живая документация модулей

Консенсус по ADR: одно решение — один короткий файл в репозитории рядом с кодом;
принятый ADR неизменяем, изменение = новый ADR со статусом superseded и взаимными ссылками;
обязательны контекст, решение и особенно последствия, включая отвергнутые альтернативы
[4](https://martinfowler.com/bliki/ArchitectureDecisionRecord.html),
[3](https://learn.microsoft.com/en-us/azure/well-architected/architect-role/architecture-decision-record),
[9](https://techdebt.best/architectural-decisions/).
AWS добавляет процессную рамку: ревью ADR малой группой и проверка, что код на ревью
не нарушает принятые ADR [18](https://docs.aws.amazon.com/pdfs/prescriptive-guidance/latest/architectural-decision-records/architectural-decision-records.pdf).

**Вердикт: брать шаблон прототипа почти как есть** (он совпадает с каноном: статус/дата/issue,
контекст, варианты, решение, последствия), с двумя правками: добавить поле «Supersedes /
Superseded by» и явный запрет редактировать accepted ADR. Паспорта модулей внешнему канону
не противоречат (это «живой» компаньон неизменяемых ADR: паспорт переписывается под
текущую реальность, ADR хранит историю «почему»). Пару «паспорт (что сейчас) + ADR (почему так)»
и фиксируем в вариантах.

---

## Сводная таблица: практика → наше решение

| # | Практика извне | Берём? | Куда ложится |
|---|---|---|---|
| 1 | Issues как шина координации, labels как состояния | Да | WORKFLOW-VARIANTS, вариант C: labels — канон |
| 2 | Автоматизация оркестрации (gh-aw, safe-outputs) | Позже | Не блокирует ручной процесс; кандидат после обкатки варианта C |
| 3 | Одна стадия — один владелец перехода | Да | Гейт `phase:action` и `status:done` — только координатор (с приёмкой владельца, см. C5) |
| 4 | Explore→Plan→Implement→Commit; план пропускают для односложных диффов | Да | ARCA + размеры S/M/L |
| 5 | AGENTS.md короткий + progressive disclosure; запреты — детерминированно, где можно | Да | AGENT-DOCS-SPEC.md |
| 6 | Trunk-based / «build once, promote artifact» | Адаптировать | Абстрактные уровни-гейты; инвариант одного SHA |
| 7 | Environments: required reviewers, prevent self-review; CODEOWNERS+protection | Да (требования) | Общий слой — требования, проектный — настройки UI |
| 8 | ADR неизменяемы, supersede вместо правок | Да | Шаблон ADR в финальном комплекте |
| 9 | Label-машина: единственность статуса + ремонт дрейфа | Да | Правила labels в варианте C |
