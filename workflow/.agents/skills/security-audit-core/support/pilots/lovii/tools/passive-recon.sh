#!/usr/bin/env bash
# Пассивная разведка <client> staging: только безопасные GET/HEAD/OPTIONS.
# Никаких инъекций, переборов, отправки форм и изменяющих запросов.
#
# Запуск (со своей машины, где есть доступ к staging):
#   bash security-audit/pilots/<client>/tools/passive-recon.sh
#   bash .../passive-recon.sh --hosts app-staging,b2b-staging --out ./recon-out
#
# Требуется: curl. openssl — опционально (для срока сертификата).
# Скрипт делает не больше 40 запросов с паузой 1.2 с и не трогает прод по умолчанию.

set -uo pipefail

HOSTS="app-staging,b2b-staging,api-staging"
TARGET_HOST="${RECON_TARGET_HOST:-b2b.example.com}"
UA="${RECON_UA:-<client>-audit-passive/1.0 (owner-authorized)}"
OUT="./recon-$(date +%Y%m%d-%H%M%S)"
PAUSE=1.2
MAX_REQ=40

while [[ $# -gt 0 ]]; do
  case "$1" in
    --hosts) HOSTS="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    --pause) PAUSE="$2"; shift 2 ;;
    -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
    *) echo "неизвестный аргумент: $1" >&2; exit 2 ;;
  esac
done

command -v curl >/dev/null || { echo "нужен curl" >&2; exit 1; }

mkdir -p "$OUT/raw"
REPORT="$OUT/report.md"
: > "$REPORT"
REQ=0

log() { printf '%s\n' "$*" >> "$REPORT"; }
hr()  { log ""; }
section() { hr; log "## $*"; hr; }

# safe_get <url> <tag> — GET без следования редиректам; код пишется в raw/<tag>.code
safe_get() {
  local url="$1" tag="$2" code
  if [[ $REQ -ge $MAX_REQ ]]; then
    log "- [пропущено: лимит запросов] \`$url\`"
    echo "000" > "$OUT/raw/${tag}.code"
    return 0
  fi
  REQ=$((REQ+1))
  code="$(curl -sS -m 20 -A "$UA" \
        -D "$OUT/raw/${tag}.headers" -o "$OUT/raw/${tag}.body" \
        -w '%{http_code}' "$url" 2>"$OUT/raw/${tag}.err" || true)"
  echo "${code:-000}" > "$OUT/raw/${tag}.code"
  sleep "$PAUSE"
}

code_of() { cat "$OUT/raw/$1.code" 2>/dev/null || echo "000"; }

log "# Пассивная разведка <client> staging"
log ""
log "- Дата: $(date -u '+%Y-%m-%d %H:%M UTC')"
log "- Хосты: \`$HOSTS\`"
log "- Метод: только GET/HEAD/OPTIONS, без изменения данных"
log "- Ограничение: максимум $MAX_REQ запросов, пауза ${PAUSE}s"
log ""
log "> Это черновик наблюдений, **не находки**. Выводы делает аудитор после проверки."
hr

IFS=',' read -ra HOSTLIST <<< "$HOSTS"

for h in "${HOSTLIST[@]}"; do
  h="$(echo "$h" | tr -d ' ')"
  [[ -z "$h" ]] && continue
  section "Хост: $h"

  safe_get "https://$h/" "${h}-root"
  code="$(code_of "${h}-root")"
  log "- GET / → HTTP \`$code\`"

  if [[ -s "$OUT/raw/${h}-root.headers" ]]; then
    log "- Заголовки ответа:"
    log '```'
    sed -e 's/\r$//' "$OUT/raw/${h}-root.headers" | head -n 40 | sed 's/^/  /' >> "$REPORT"
    log '```'

    log "- Проверка типовых заголовков:"
    for hdr in strict-transport-security content-security-policy x-frame-options \
               x-content-type-options referrer-policy permissions-policy x-robots-tag; do
      if grep -qi "^${hdr}:" "$OUT/raw/${h}-root.headers"; then
        val="$(grep -i "^${hdr}:" "$OUT/raw/${h}-root.headers" | head -n1 | cut -d: -f2- | sed 's/^ *//' | tr -d '\r')"
        log "  - \`$hdr\`: есть — \`${val:0:120}\`"
      else
        log "  - \`$hdr\`: **нет** (наблюдение, оценить в контексте)"
      fi
    done

    log "- Утечки версий:"
    for leak in '^server:' '^x-powered-by:' '^x-aspnet' '^x-generator:'; do
      if grep -qi "$leak" "$OUT/raw/${h}-root.headers"; then
        log "  - \`$(grep -i "$leak" "$OUT/raw/${h}-root.headers" | head -n1 | tr -d '\r' | cut -c1-120)\`"
      fi
    done
  fi

  if [[ -s "$OUT/raw/${h}-root.err" ]]; then
    log "- Ошибка curl:"
    log '```'
    head -n 3 "$OUT/raw/${h}-root.err" | sed 's/^/  /' >> "$REPORT"
    log '```'
  fi

  if command -v openssl >/dev/null; then
    end="$(echo | timeout 15 openssl s_client -servername "$h" -connect "$h:443" 2>/dev/null \
           | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)"
    [[ -n "$end" ]] && log "- TLS-сертификат действует до: \`$end\`"
  fi

  for path in robots.txt sitemap.xml .well-known/security.txt; do
    tag="${h}-$(echo "$path" | tr '/.' '--')"
    safe_get "https://$h/$path" "$tag"
    c="$(code_of "$tag")"
    size=0
    [[ -f "$OUT/raw/${tag}.body" ]] && size="$(wc -c < "$OUT/raw/${tag}.body" | tr -d ' ')"
    log "- /$path → HTTP \`$c\`, ${size} байт"
    if [[ "$c" == "200" && ${size} -gt 0 && ${size} -lt 3000 ]]; then
      log '```'
      head -n 25 "$OUT/raw/${tag}.body" | sed 's/^/  /' >> "$REPORT"
      log '```'
    fi
  done

  if [[ $REQ -lt $MAX_REQ ]]; then
    REQ=$((REQ+1))
    curl -sS -m 15 -o /dev/null -D "$OUT/raw/${h}-options.headers" -X OPTIONS \
         -w '%{http_code}' "https://$h/" > "$OUT/raw/${h}-options.code" 2>/dev/null || true
    sleep "$PAUSE"
    allow="$(grep -i '^allow:' "$OUT/raw/${h}-options.headers" 2>/dev/null | cut -d: -f2- | tr -d '\r' | sed 's/^ *//')"
    log "- OPTIONS / → HTTP \`$(code_of "${h}-options")\`; Allow: \`${allow:-не указан}\`"
  fi

  hr
done

section "Хранилище фото (b2b): проверка листинга каталога"
safe_get "https://${TARGET_HOST}/storage/merchants/" 'storage-merchants-dir'
c="$(code_of 'storage-merchants-dir')"
log "- GET /storage/merchants/ → HTTP \`$c\`"
log "- 403/404 — нормально; **200 со списком файлов** — повод проверить права."
if [[ "$c" == "200" && -s "$OUT/raw/storage-merchants-dir.body" ]]; then
  log '```'
  head -n 15 "$OUT/raw/storage-merchants-dir.body" | sed 's/^/  /' >> "$REPORT"
  log '```'
fi

hr
log "## Что дальше"
log ""
log "1. Пришли \`report.md\` и папку \`raw/\` — разберём и отделим наблюдения от находок."
log "2. Дальше по плану: [06-spec-pack.md](../06-spec-pack.md), фаза 1 (Black Box по staging)."
log "3. Перед фазой 2 нужны тестовые аккаунты — [09-questions-for-owner.md](../09-questions-for-owner.md)."

echo "Готово: $REPORT (запросов: $REQ)"
echo "Сырые ответы: $OUT/raw"
