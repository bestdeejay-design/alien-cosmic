#!/usr/bin/env bash
# project-apply.sh — идемпотентное применение PROJECTS-BLUEPRINT к GitHub Project.
#
# Что делает:
#   * приводит опции встроенного поля Status к словарю status:*;
#   * создаёт недостающие custom fields и дополняет single-select опции,
#     сохраняя ID уже используемых опций;
#   * создаёт/обновляет виды: layout, фильтр и порядок видимых полей.
# Что сознательно НЕ делает:
#   * не удаляет лишние опции и карточки;
#   * не задаёт sort/group-by/колонки board/оси roadmap — GitHub GraphQL API
#     не покрывает это надёжно; ручная доводка перечислена в PROJECTS-BLUEPRINT §6;
#   * не синхронизирует labels существующих issues в поля проекта.
#
# Нужна авторизация со scope `project` (или read-only для просмотра плана):
#   gh auth login --scopes project
# Токены в аргументах и файлах не используются и не печатаются.
#
# Использование:
#   docs/project-apply.sh --owner OWNER --number 7
#   docs/project-apply.sh --owner OWNER --number 7 --apply
#   docs/project-apply.sh --owner ORG --number 7 --owner-type organization --apply

set -euo pipefail

OWNER="" NUMBER="" OWNER_TYPE="user" APPLY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --owner) OWNER="${2:-}"; shift 2;;
    --number) NUMBER="${2:-}"; shift 2;;
    --owner-type) OWNER_TYPE="${2:-}"; shift 2;;
    --apply) APPLY=1; shift;;
    -h|--help) sed -n '2,28p' "$0"; exit 0;;
    *) echo "project-apply: неизвестный аргумент: $1" >&2; exit 2;;
  esac
done

[ -n "$OWNER" ] || { echo "project-apply: нужен --owner" >&2; exit 2; }
case "$NUMBER" in ''|*[!0-9]*) echo "project-apply: --number должен быть числом из URL проекта" >&2; exit 2;; esac
case "$OWNER_TYPE" in user|organization) :;; *) echo "project-apply: --owner-type user|organization" >&2; exit 2;; esac
command -v gh >/dev/null 2>&1 || { echo "project-apply: gh CLI не найден" >&2; exit 2; }
command -v jq >/dev/null 2>&1 || { echo "project-apply: jq не найден" >&2; exit 2; }
gh auth status >/dev/null 2>&1 || { echo "project-apply: gh не авторизован" >&2; exit 2; }

gql() { # gql QUERY VARIABLES_JSON -> stdout JSON или ненулевой выход
  local query="$1" vars="${2:-{\}}" response
  if ! response="$(jq -n --arg q "$query" --argjson v "$vars" '{query:$q,variables:$v}' | gh api graphql --input - 2>&1)"; then
    echo "$response" >&2; return 1
  fi
  if printf '%s' "$response" | jq -e '.errors and (.errors | length > 0)' >/dev/null 2>&1; then
    echo "project-apply: GraphQL вернул ошибку. Частая причина — нет scope project/read:project или нет доступа к проекту." >&2
    printf '%s\n' "$response" | jq -r '.errors[]?.message' >&2
    return 1
  fi
  printf '%s' "$response"
}

OWNER_FIELD="user"
[ "$OWNER_TYPE" = "organization" ] && OWNER_FIELD="organization"

PROJECT_Q='query($login:String!,$number:Int!){ owner: __OWNER_FIELD__(login:$login){ project: projectV2(number:$number){ id title url } } }'
PROJECT_Q="${PROJECT_Q/__OWNER_FIELD__/$OWNER_FIELD}"
PROJECT_VARS="$(jq -n --arg login "$OWNER" --argjson number "$NUMBER" '{login:$login,number:$number}')"
if ! PROJECT_RESP="$(gql "$PROJECT_Q" "$PROJECT_VARS")"; then
  echo "project-apply: не удалось открыть проект $OWNER/$NUMBER. Проверьте номер из URL и scope project." >&2; exit 2
fi
PROJECT_ID="$(printf '%s' "$PROJECT_RESP" | jq -r '.data.owner.project.id // empty')"
PROJECT_TITLE="$(printf '%s' "$PROJECT_RESP" | jq -r '.data.owner.project.title // empty')"
[ -n "$PROJECT_ID" ] || { echo "project-apply: проект не найден" >&2; exit 2; }
echo "Проект: $PROJECT_TITLE ($PROJECT_ID)"
[ "$APPLY" -eq 1 ] && echo "Режим: APPLY (будут внесены изменения)" || echo "Режим: план (без --apply ничего не меняю)"

FIELDS_Q='query($id:ID!){ node(id:$id){ ... on ProjectV2 { fields(first:50){ totalCount nodes { ... on ProjectV2Field { id name dataType } ... on ProjectV2SingleSelectField { id name dataType options { id name color description } } ... on ProjectV2IterationField { id name dataType } } } views(first:50){ totalCount nodes { id name layout filter } } } } }'
ID_VARS="$(jq -n --arg id "$PROJECT_ID" '{id:$id}')"
if ! STATE_RESP="$(gql "$FIELDS_Q" "$ID_VARS")"; then exit 2; fi
FIELDS_JSON="$(printf '%s' "$STATE_RESP" | jq -c '.data.node.fields.nodes')"
VIEWS_JSON="$(printf '%s' "$STATE_RESP" | jq -c '.data.node.views.nodes')"
if [ "$(printf '%s' "$STATE_RESP" | jq -r '.data.node.fields.totalCount')" -gt 50 ] || [ "$(printf '%s' "$STATE_RESP" | jq -r '.data.node.views.totalCount')" -gt 50 ]; then
  echo "project-apply: в проекте больше 50 полей или видов; скрипт этот случай сознательно не обрабатывает" >&2; exit 2
fi

STATUS_DESIRED='[
 {"name":"Inbox","color":"BLUE","description":"status:inbox"},
 {"name":"Ready","color":"GREEN","description":"status:ready"},
 {"name":"In progress","color":"YELLOW","description":"status:in-progress"},
 {"name":"Blocked","color":"RED","description":"status:blocked"},
 {"name":"Review","color":"PURPLE","description":"status:review"},
 {"name":"Rejected","color":"RED","description":"status:rejected"},
 {"name":"Done","color":"BLUE","description":"status:done"}
]'

DESIRED_FIELDS='[
 {"name":"Адресат","dataType":"SINGLE_SELECT","options":[
   {"name":"Владелец","color":"ORANGE","description":"to:owner"},
   {"name":"Координатор","color":"BLUE","description":"to:coordinator"},
   {"name":"Арена","color":"PURPLE","description":"to:arena"},
   {"name":"SZ (пул)","color":"GREEN","description":"to:sz-pool"},
   {"name":"SZ-1","color":"GREEN","description":"to:sz-1"},
   {"name":"SZ-2","color":"GREEN","description":"to:sz-2"},
   {"name":"SZ-3","color":"GREEN","description":"to:sz-3"},
   {"name":"SZ-4","color":"GREEN","description":"to:sz-4"},
   {"name":"SZ-5","color":"GREEN","description":"to:sz-5"}]},
 {"name":"Приоритет","dataType":"SINGLE_SELECT","options":[
   {"name":"Critical","color":"RED","description":"priority:critical"},
   {"name":"High","color":"ORANGE","description":"priority:high"},
   {"name":"Medium","color":"YELLOW","description":"priority:medium"},
   {"name":"Low","color":"GREEN","description":"priority:low"}]},
 {"name":"Размер","dataType":"SINGLE_SELECT","options":[
   {"name":"S","color":"GREEN","description":"size:S"},
   {"name":"M","color":"YELLOW","description":"size:M"},
   {"name":"L","color":"RED","description":"size:L"}]},
 {"name":"Фаза","dataType":"SINGLE_SELECT","options":[
   {"name":"Audit","color":"GREEN","description":"phase:audit"},
   {"name":"Research","color":"BLUE","description":"phase:research"},
   {"name":"Conclusion","color":"ORANGE","description":"phase:conclusion"},
   {"name":"Action","color":"RED","description":"phase:action"},
   {"name":"Verify","color":"PURPLE","description":"phase:verify"},
   {"name":"Не применяется","color":"GRAY","description":"size:S или question"}]},
 {"name":"Начата","dataType":"DATE"},
 {"name":"Срок","dataType":"DATE"},
 {"name":"Завершена","dataType":"DATE"},
 {"name":"Итерации правок","dataType":"NUMBER"}
]'

merge_options() { # CURRENT_JSON DESIRED_JSON
  jq -n --argjson current "${1:-[]}" --argjson desired "$2" '
    ($current // []) as $c
    | ($c | map({key:.name, value:.}) | from_entries) as $by
    | ([ $desired[] | . + (if $by[.name] then {id:$by[.name].id} else {} end) ]
       + [ $c[] | select(.name as $n | ($desired | map(.name) | index($n)) == null) ])'
}

options_differ() { # CURRENT_JSON MERGED_JSON
  local a b
  a="$(printf '%s' "${1:-[]}" | jq -c '[.[] | {name,color}]')"
  b="$(printf '%s' "$2" | jq -c '[.[] | {name,color}]')"
  [ "$a" != "$b" ]
}

update_field_options() { # FIELD_ID OPTIONS_JSON LABEL
  local vars resp
  vars="$(jq -n --arg fieldId "$1" --argjson opts "$2" '{fieldId:$fieldId,opts:$opts}')"
  if ! resp="$(gql 'mutation($fieldId:ID!,$opts:[ProjectV2SingleSelectFieldOptionInput!]){ updateProjectV2Field(input:{fieldId:$fieldId,singleSelectOptions:$opts}){ projectV2Field { ... on ProjectV2SingleSelectField { id name } } } }' "$vars")"; then
    echo "project-apply: не удалось обновить опции поля $3" >&2; exit 2
  fi
  echo "  обновлены опции: $3"
}

# --- Status: привести опции, ничего не удаляя ---
STATUS_FIELD="$(printf '%s' "$FIELDS_JSON" | jq -c '[.[] | select(.name=="Status")][0] // empty')"
if [ -z "$STATUS_FIELD" ]; then
  echo "project-apply: встроенное поле Status не найдено; остановитесь и проверьте проект вручную" >&2; exit 2
fi
STATUS_ID="$(printf '%s' "$STATUS_FIELD" | jq -r '.id')"
STATUS_CURRENT="$(printf '%s' "$STATUS_FIELD" | jq -c '.options // []')"
STATUS_MERGED="$(merge_options "$STATUS_CURRENT" "$STATUS_DESIRED")"
if options_differ "$STATUS_CURRENT" "$STATUS_MERGED"; then
  echo "Status: нужно привести опции к словарю status:* (лишние опции не удаляю)"
  [ "$APPLY" -eq 1 ] && update_field_options "$STATUS_ID" "$STATUS_MERGED" "Status" || true
else
  echo "Status: опции уже соответствуют словарю"
fi

# --- Custom fields ---
CREATE_FIELD_Q='mutation($projectId:ID!,$name:String!,$dataType:ProjectV2CustomFieldType!,$opts:[ProjectV2SingleSelectFieldOptionInput!]){ createProjectV2Field(input:{projectId:$projectId,name:$name,dataType:$dataType,singleSelectOptions:$opts}){ projectV2Field { ... on ProjectV2Field { id name } ... on ProjectV2SingleSelectField { id name } } } }'
while IFS= read -r field; do
  fname="$(printf '%s' "$field" | jq -r '.name')"
  ftype="$(printf '%s' "$field" | jq -r '.dataType')"
  existing="$(printf '%s' "$FIELDS_JSON" | jq -c --arg n "$fname" '[.[] | select(.name==$n)][0] // empty')"
  if [ -z "$existing" ]; then
    echo "Поле создать: $fname ($ftype)"
    if [ "$APPLY" -eq 1 ]; then
      opts="$(printf '%s' "$field" | jq -c '.options // null')"
      vars="$(jq -n --arg projectId "$PROJECT_ID" --arg name "$fname" --arg dataType "$ftype" --argjson opts "$opts" '{projectId:$projectId,name:$name,dataType:$dataType,opts:$opts}')"
      if ! resp="$(gql "$CREATE_FIELD_Q" "$vars")"; then echo "project-apply: не удалось создать поле $fname" >&2; exit 2; fi
      echo "  создано: $fname"
    fi
  else
    echo "Поле уже есть: $fname"
    if [ "$ftype" = "SINGLE_SELECT" ]; then
      current="$(printf '%s' "$existing" | jq -c '.options // []')"
      desired="$(printf '%s' "$field" | jq -c '.options // []')"
      merged="$(merge_options "$current" "$desired")"
      if options_differ "$current" "$merged"; then
        echo "  опции нужно дополнить (ID существующих сохраняю)"
        [ "$APPLY" -eq 1 ] && update_field_options "$(printf '%s' "$existing" | jq -r '.id')" "$merged" "$fname" || true
      fi
    fi
  fi
done <<EOF_FIELDS
$(printf '%s' "$DESIRED_FIELDS" | jq -c '.[]')
EOF_FIELDS

# После полей перечитать карту ID: новые поля нужны видам.
if ! STATE_RESP="$(gql "$FIELDS_Q" "$ID_VARS")"; then exit 2; fi
FIELDS_JSON="$(printf '%s' "$STATE_RESP" | jq -c '.data.node.fields.nodes')"
VIEWS_JSON="$(printf '%s' "$STATE_RESP" | jq -c '.data.node.views.nodes')"
FIELD_MAP="$(printf '%s' "$FIELDS_JSON" | jq -c 'map({key:.name,value:.id}) | from_entries')"

DESIRED_VIEWS='[
 {"name":"01 Контроль","layout":"TABLE_LAYOUT","filter":"is:issue is:open","visible":["Title","Status","Адресат","Приоритет","Labels","Фаза","Размер","Начата","Срок","Updated","Linked pull requests","Parent issue","Sub-issues progress","Repository"]},
 {"name":"02 Мне — решения и приёмка","layout":"TABLE_LAYOUT","filter":"is:issue is:open label:\"to:owner\"","visible":["Title","Status","Приоритет","Labels","Срок","Updated","Linked pull requests","Repository"]},
 {"name":"03 По адресатам","layout":"TABLE_LAYOUT","filter":"is:issue is:open -label:\"status:blocked\"","visible":["Title","Status","Адресат","Приоритет","Labels","Фаза","Начата","Срок","Updated","Linked pull requests"]},
 {"name":"04 Сроки и зависания","layout":"TABLE_LAYOUT","filter":"is:issue is:open","visible":["Title","Status","Адресат","Приоритет","Начата","Срок","Updated","Labels","Linked pull requests"]},
 {"name":"05 Блокеры и вопросы","layout":"TABLE_LAYOUT","filter":"is:issue is:open label:\"status:blocked\"","visible":["Title","Status","Адресат","Labels","Начата","Updated","Parent issue","Repository"]},
 {"name":"06 Roadmap","layout":"ROADMAP_LAYOUT","filter":"is:issue is:open","visible":["Title","Status","Адресат","Приоритет","Начата","Срок","Labels"]},
 {"name":"07 Завершено","layout":"TABLE_LAYOUT","filter":"is:issue is:closed label:\"status:done\"","visible":["Title","Status","Адресат","Приоритет","Labels","Created","Начата","Завершена","Closed","Linked pull requests","Repository"]},
 {"name":"08 Доска","layout":"BOARD_LAYOUT","filter":"is:issue is:open","visible":["Title","Status","Приоритет","Адресат","Срок","Labels","Linked pull requests"]}
]'

UPDATE_VIEW_Q='mutation($viewId:ID!,$name:String!,$layout:ProjectV2ViewLayout!,$filter:String!,$ids:[ID!]!){ updateProjectV2View(input:{viewId:$viewId,name:$name,layout:$layout,filter:$filter,configuration:{visibleFieldIds:$ids}}){ projectV2View { id name } } }'
CREATE_VIEW_Q='mutation($projectId:ID!,$name:String!,$layout:ProjectV2ViewLayout!,$ids:[ID!]!){ createProjectV2View(input:{projectId:$projectId,name:$name,layout:$layout,configuration:{visibleFieldIds:$ids}}){ projectV2View { id name } } }'

while IFS= read -r view; do
  vname="$(printf '%s' "$view" | jq -r '.name')"
  vlayout="$(printf '%s' "$view" | jq -r '.layout')"
  vfilter="$(printf '%s' "$view" | jq -r '.filter')"
  visible="$(printf '%s' "$view" | jq -c '.visible')"
  ids="$(jq -n --argjson map "$FIELD_MAP" --argjson names "$visible" '[ $names[] | $map[.] // empty ]')"
  missing="$(jq -n --argjson map "$FIELD_MAP" --argjson names "$visible" '[ $names[] | select($map[.] == null) ]')"
  [ "$missing" != "[]" ] && echo "Вид $vname: не найдены поля $missing — пропускаю их в видимости" >&2
  existing_id="$(printf '%s' "$VIEWS_JSON" | jq -r --arg n "$vname" '[.[] | select(.name==$n)][0].id // empty')"
  if [ -z "$existing_id" ]; then
    echo "Вид создать: $vname ($vlayout)"
    if [ "$APPLY" -eq 1 ]; then
      vars="$(jq -n --arg projectId "$PROJECT_ID" --arg name "$vname" --arg layout "$vlayout" --argjson ids "$ids" '{projectId:$projectId,name:$name,layout:$layout,ids:$ids}')"
      if ! resp="$(gql "$CREATE_VIEW_Q" "$vars")"; then echo "project-apply: не удалось создать вид $vname" >&2; exit 2; fi
      existing_id="$(printf '%s' "$resp" | jq -r '.data.createProjectV2View.projectV2View.id')"
      echo "  создан: $vname"
    fi
  else
    echo "Вид уже есть: $vname"
  fi
  if [ "$APPLY" -eq 1 ] && [ -n "$existing_id" ]; then
    vars="$(jq -n --arg viewId "$existing_id" --arg name "$vname" --arg layout "$vlayout" --arg filter "$vfilter" --argjson ids "$ids" '{viewId:$viewId,name:$name,layout:$layout,filter:$filter,ids:$ids}')"
    if ! resp="$(gql "$UPDATE_VIEW_Q" "$vars")"; then echo "project-apply: не удалось обновить вид $vname" >&2; exit 2; fi
    echo "  обновлён layout/filter/видимые поля: $vname"
  fi
done <<EOF_VIEWS
$(printf '%s' "$DESIRED_VIEWS" | jq -c '.[]')
EOF_VIEWS

echo
if [ "$APPLY" -eq 1 ]; then
  echo "Готово по API. Осталась ручная доводка из PROJECTS-BLUEPRINT §6: сортировки, группировки, колонки Board, оси Roadmap, workflows и README проекта."
else
  echo "Это был план без изменений. Для применения повторите с --apply, затем выполните ручную доводку из PROJECTS-BLUEPRINT §6."
fi
