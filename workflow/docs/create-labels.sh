#!/usr/bin/env bash
# create-labels.sh — идемпотентное создание ядра labels варианта C.
# Источник словаря: docs/KNOWLEDGE_BASE.md §1. Менять labels — только правкой
# одновременно: KNOWLEDGE_BASE.md, этот скрипт, .github/ISSUE_TEMPLATE/*.yml.
# Использование:  bash docs/create-labels.sh            (текущий репозиторий gh)
#                 bash docs/create-labels.sh owner/repo (явный репозиторий)
set -euo pipefail

REPO="${1:-}"
GH=(gh)
if [[ -n "$REPO" ]]; then GH=(gh --repo "$REPO"); fi

create() { # name color description
  "${GH[@]}" label create "$1" --color "$2" --description "$3" --force >/dev/null
  echo "label: $1"
}

# status:* — где задача (ровно один)
create "status:inbox"       "C5DEF5" "Статус: создана, не обработана координатором"
create "status:ready"       "0E8A16" "Статус: бриф полон, можно брать в работу"
create "status:in-progress" "FBCA04" "Статус: исполнитель работает"
create "status:blocked"     "D93F0B" "Статус: ждёт зависимость или ответ на question"
create "status:review"      "6F42C1" "Статус: поставка сдана, на проверке или приёмке"
create "status:done"        "1D76DB" "Статус: принято (координатор после приёмки)"
create "status:rejected"    "B60205" "Статус: возвращено на правки (счётчик итераций у координатора)"

# phase:* — фаза ARCA, только size M/L (ровно один)
create "phase:audit"      "BFE5BF" "Фаза ARCA: аудит радиуса"
create "phase:research"   "BFD4F2" "Фаза ARCA: варианты решения"
create "phase:conclusion" "F9D0C4" "Фаза ARCA: решение, ждёт гейта координатора"
create "phase:action"     "E11D21" "Фаза ARCA: гейт открыт координатором, можно менять файлы"
create "phase:verify"     "5319E7" "Фаза ARCA: поставка сдана, идёт ревью"

# agent:* — какая функция нужна (ровно один)
for role in coordinator researcher architect coder reviewer qa devops; do
  create "agent:$role" "7057FF" "Функция задачи: $role (не конкретный адресат)"
done

# to:* — кто конкретно делает следующее действие (ровно один на открытой задаче;
# на done/отмене снимается). agent:* отвечает «что делать», to:* — «кому сейчас».
create "to:owner"      "1F6FEB" "Текущий адресат: владелец (решение, запуск, приёмка)"
create "to:coordinator" "1F6FEB" "Текущий адресат: координатор"
create "to:arena"       "1F6FEB" "Текущий адресат: внешний исполнитель Арена"
create "to:sz-pool"     "1F6FEB" "Текущий адресат: любой свободный SZ, ждёт claim"
for n in 1 2 3 4 5; do
  create "to:sz-$n" "1F6FEB" "Текущий адресат: конкретный SZ-$n"
done

# type:* — что это (ровно один)
create "type:feature"  "A2EEEF" "Тип: новая функциональность"
create "type:bugfix"   "D73A4A" "Тип: исправление"
create "type:research" "0075CA" "Тип: исследование без поставки кода"
create "type:decision" "8A6D3B" "Тип: решение, оформляется ADR"
create "type:test"     "F9A825" "Тип: тестирование / проверка уровня"
create "type:docs"     "0B6E99" "Тип: документация"
create "type:infra"    "434343" "Тип: инфраструктура, CI, процессные файлы"
create "type:debt"     "795548" "Тип: устранение записанного техдолга"
create "type:question" "D876E3" "Тип: вопрос, блокирующий или уточняющий задачу"

# size:* — размер церемонии (ровно один; ставит только координатор)
create "size:S" "C2E0C6" "Размер S: дифф одним предложением, мини-аудит + conclusion одним комментарием"
create "size:M" "FEF2C0" "Размер M: внутри одного модуля, полный ARCA в issue"
create "size:L" "F9C6C6" "Размер L: несколько модулей или интерфейсы, ARCA + ADR"

# priority:* (ровно один)
create "priority:critical" "B60205" "Приоритет: critical"
create "priority:high"     "D93F0B" "Приоритет: high"
create "priority:medium"   "FBCA04" "Приоритет: medium"
create "priority:low"      "0E8A16" "Приоритет: low"

# env:* — потолок поставки (ровно один)
create "env:test"       "7ED3B2" "Потолок поставки: уровень test"
create "env:staging"    "F5A623" "Потолок поставки: уровень staging"
create "env:production" "E11D21" "Потолок поставки: уровень production"

# Флаги (открытая группа)
create "external"         "9E7BFF" "Флаг: исполнителя запускает владелец вручную"
create "launch-ready"     "00A6A6" "Флаг: launch-пакет опубликован, ждём запуска владельцем"
create "blocked-external" "8B5CF6" "Флаг: блокер — внешний агент или ручной запуск владельца"
create "needs-human"      "FF7A00" "Флаг: нужно решение или приёмка владельца"
create "has-pr"           "2B6CB0" "Флаг: есть связанный PR"

echo "OK: ядро labels варианта C синхронизировано (см. docs/KNOWLEDGE_BASE.md §1)."
