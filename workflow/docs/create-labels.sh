#!/usr/bin/env bash
# create-labels.sh — идемпотентное создание ядра labels варианта C.
# Единый машинный источник словаря: schema/bus.json (ADR-0002), сверяется
# гейтом scripts/preflight (KNOWLEDGE_BASE.md §1 и §6). Менять labels — только
# правкой одновременно: schema/bus.json, KNOWLEDGE_BASE.md, этот скрипт,
# .github/ISSUE_TEMPLATE/*.yml.
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
create "status:inbox"       "C5DEF5" "Создана, не обработана координатором"
create "status:ready"       "0E8A16" "Бриф полон, можно брать в работу"
create "status:in-progress" "FBCA04" "Исполнитель работает"
create "status:blocked"     "D93F0B" "Ждёт зависимость или ответ на question"
create "status:review"      "6F42C1" "Поставка сдана, на проверке или приёмке"
create "status:done"        "1D76DB" "Принято (координатор после приёмки)"
create "status:rejected"    "B60205" "Возвращено на правки (счётчик N/2)"

# phase:* — фаза ARCA, только size M/L (ровно один)
create "phase:audit"      "BFE5BF" "Фаза ARCA: аудит радиуса"
create "phase:research"   "BFD4F2" "Фаза ARCA: варианты решения"
create "phase:conclusion" "F9D0C4" "Фаза ARCA: решение, ждёт гейта координатора"
create "phase:action"     "E11D21" "Фаза ARCA: гейт открыт координатором, можно менять файлы"
create "phase:verify"     "5319E7" "Фаза ARCA: поставка сдана, идёт ревью"

# agent:* — какая функция нужна (ровно один)
for role in coordinator researcher architect coder reviewer qa devops; do
  create "agent:$role" "7057FF" "Функция задачи: $role"
done

# to:* — кто конкретно делает следующее действие (ровно один на открытой задаче;
# на done/отмене снимается). В ядре канона только универсальные роли управления и пула;
# конкретные узлы to:<id> создаются из ростера проектного слоя (project.json).
create "to:owner"       "1F6FEB" "Текущий адресат: владелец"
create "to:coordinator" "1F6FEB" "Текущий адресат: координатор"
create "to:pool"        "1F6FEB" "Текущий адресат: общий пул свободных исполнителей, ждёт claim"

# type:* — что это (ровно один)
create "type:feature"  "A2EEEF" "Новая функциональность"
create "type:bugfix"   "D73A4A" "Исправление"
create "type:research" "0075CA" "Исследование без поставки кода"
create "type:decision" "8A6D3B" "Решение, оформляется ADR"
create "type:test"     "F9A825" "Тестирование / проверка уровня"
create "type:docs"     "0B6E99" "Документация"
create "type:infra"    "434343" "Инфраструктура, CI, процессные файлы"
create "type:debt"     "795548" "Устранение записанного техдолга"
create "type:question" "D876E3" "Вопрос, блокирующий или уточняющий задачу"

# size:* — размер церемонии (ровно один; ставит только координатор)
create "size:S" "C2E0C6" "1–2 файла, без смены интерфейсов, однопроходный Fast-Track дуэт"
create "size:M" "FEF2C0" "Внутри одного модуля, коллегия 4 сабов + 2-я волна со сменой ролей"
create "size:L" "F9C6C6" "Несколько модулей или интерфейсы, ARCA + ADR + 2 волны со сменой ролей"

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
create "external"         "9E7BFF" "Исполнителя запускает владелец вручную"
create "launch-ready"     "00A6A6" "Launch-пакет опубликован, ждём запуска владельцем"
create "blocked-external" "8B5CF6" "Блокер — внешний агент или ручной запуск владельца"
create "needs-human"      "FF7A00" "Нужно решение или приёмка владельца"
create "has-pr"           "2B6CB0" "Есть связанный PR"

# Опциональный проектный ростер узлов из project.json (ADR-0003)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CANON_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OVERLAY_SCRIPT="$CANON_ROOT/scripts/project_overlay.py"
if [[ -f "$OVERLAY_SCRIPT" ]] && { [[ -n "${AGENT_PROJECT_CONFIG:-}" ]] || [[ -f "$CANON_ROOT/project.json" ]] || { [[ "$(basename "$CANON_ROOT")" == "workflow" ]] && [[ -f "$CANON_ROOT/../project.json" ]]; }; }; then
  while IFS=$'\t' read -r _lbl_name _lbl_color _lbl_desc; do
    [[ -n "$_lbl_name" ]] || continue
    create "$_lbl_name" "$_lbl_color" "$_lbl_desc"
  done < <(python3 "$OVERLAY_SCRIPT" --root "$CANON_ROOT" --emit-labels-tsv)
fi

echo "OK: ядро labels варианта C синхронизировано (см. docs/KNOWLEDGE_BASE.md §1)."
