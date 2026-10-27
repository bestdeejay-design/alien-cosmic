#!/usr/bin/env bash
# lovii-setup.sh — установка БД прогресса Alien Cosmic на машину lovii.
# Запуск на lovii из корня проекта:  bash server/lovii-setup.sh
# Скрипт: проверяет Node, поднимает сейв-сервер :8790, ставит cloudflared,
# открывает туннель и печатает ПУБЛИЧНЫЙ HTTPS-АДРЕС БД (вставить в игру).
set -e
cd "$(dirname "$0")/.."
echo "== Alien Cosmic: БД на lovii =="

# 1) Node.js
if ! command -v node >/dev/null; then
  echo "Node.js не найден. Поставь LTS с https://nodejs.org и запусти скрипт снова."
  exit 1
fi
echo "Node: $(node --version)"

# 2) Сейв-сервер (фоном, лог в /tmp)
if lsof -i :8790 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Сейв-сервер уже работает на :8790"
else
  echo "Запускаю сейв-сервер :8790…"
  nohup node server/save-server.mjs > /tmp/ac-save-server.log 2>&1 &
  sleep 1
fi
curl -s http://localhost:8790/health && echo

# 3) cloudflared
if ! command -v cloudflared >/dev/null; then
  echo "Ставлю cloudflared…"
  if command -v brew >/dev/null; then
    brew install cloudflared
  elif command -v apt-get >/dev/null; then
    curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o /tmp/cf.deb && sudo dpkg -i /tmp/cf.deb
  else
    echo "Не нашёл пакетный менеджер. Скачай cloudflared вручную: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
    exit 1
  fi
fi

# 4) Туннель (быстрый, адрес меняется при перезапуске)
echo ""
echo "==============================================="
echo "АДРЕС ТВОЕЙ БД (вставить в игру: КЦ → Профиль → «сервер БД»):"
cloudflared tunnel --url http://localhost:8790 2>&1 | grep --line-buffered -o 'https://[a-z0-9-]*\.trycloudflare\.com'
echo "==============================================="
echo "Окно не закрывать: туннель и есть доступ к БД. Ctrl+C = остановить."
