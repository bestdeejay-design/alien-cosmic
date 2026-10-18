#!/bin/sh
# shots_all.sh — пересборка ВСЕХ скриншот-артефактов (design/shots) одной командой.
# Запуск из корня репо:  sh scripts/shots/shots_all.sh
# Требует: playwright (npm i -D playwright && npx playwright install chromium),
#          Pillow (pip install pillow), python3.
set -e
PORT=${PORT:-8079}
OUT=${OUT:-design/shots}

# 1. Сервер
python3 -m http.server "$PORT" --directory . >/dev/null 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null' EXIT
sleep 1

# 2. Снимки (PNG во временную папку OUT)
GAME_URL="http://localhost:$PORT" OUT="$OUT" node scripts/shots/grids_and_gameplay.mjs
GAME_URL="http://localhost:$PORT/scripts/shots/unit_sheet.html" OUT="$OUT" node scripts/shots/unit_sheet.mjs

# 3. Безпотерный WebP (PNG удаляются)
OUT="$OUT" python3 scripts/shots/to_webp.py
echo "Готово: $OUT"
