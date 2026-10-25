// raid-boot.js — ПОЛИГОН /r/: прямой заход в рейдовый режим, минуя лендинг.
// Копия движка Арены (R0-a); движок не меняем — надстройка делает три вещи:
// 1) скрывает рейдовые кнопки топбара (канон владельца: без кнопок);
// 2) эвакуация в мире: клик по кольцу посадки;
// 3) СОХРАНЕНИЕ ПРОГРЕССА РЕЙДА (сессия корабля-КЦ) — localStorage + сейв-сервер.
import { TILE } from './js/config.js';

const RAID_SAVE_KEY = 'ac_raid_session_v1';

for (let i = 0; i < 200 && !(window.game && window.game.state); i++) {
  await new Promise((r) => setTimeout(r, 50));
}
const game = window.game;
if (!game) { console.error('[r] game не загрузился'); }
else {
  // 1) Скрыть кнопки топбара, связанные с рейдом и рестартом (канон: без кнопок).
  for (const id of ['btn-raid-action', 'btn-restart']) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  }

  // 2) Эвакуация в мире: клик по кольцу посадки в вылазке = triggerRaidEvac.
  const canvas = document.getElementById('game-canvas') || document.querySelector('canvas');
  if (canvas) {
    canvas.addEventListener('click', (e) => {
      const st = game.state;
      if (!st || st.raidMode !== 'expedition' || st.gameOver) return;
      const pad = st.raidDrop;
      if (!pad) return;
      const r = canvas.getBoundingClientRect();
      const w = game.screenToWorld(e.clientX - r.left, e.clientY - r.top);
      if (Math.hypot(w.x - pad.x * TILE, w.y - pad.y * TILE) <= (pad.r || 4) * TILE) {
        game.triggerRaidEvac();
      }
    }, true);
  }

  // 3) Сохранение прогресса рейда: сессия корабля (рейд-секв, подарки, план базы)
  //    сериализуется целиком. Приоритет: localStorage → сервер → новая база.
  const saved = (() => {
    try { return localStorage.getItem(RAID_SAVE_KEY); } catch { return null; }
  })();
  if (saved && !game.started) {
    try {
      game.raidSession = JSON.parse(saved);
      console.log('[r] сессия рейда восстановлена из сохранения');
    } catch (e) { console.warn('[r] сейв рейда повреждён, стартуем заново', e); }
  }
  if (!game.started) {
    game.startRaidHome('human');
    window.dispatchEvent(new Event('ac-vv-check'));
    console.log('[r] полигон: рейд-хоум запущен; запуск вылазки — выделить корабль-КЦ → «Запуск» (E), эвакуация — клик по кольцу посадки');
  }

  // Запись: снапшот домашней базы актуализируется сам (syncRaidHomeSnapshot
  // зовётся движком в home-режиме), нам достаточно периодически сериализовать.
  let lastSaved = null;
  const saveNow = () => {
    if (!game.raidSession) return;
    try {
      const data = JSON.stringify(game.raidSession);
      if (data === lastSaved) return;
      localStorage.setItem(RAID_SAVE_KEY, data);
      lastSaved = data;
      // тот же ник+пин, что у сейв-клиента прогресса
      const nick = localStorage.getItem('ac_save_nick'), pin = localStorage.getItem('ac_save_pin');
      if (nick && pin) {
        fetch(`http://${location.hostname}:8790/api/save`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ player: nick, pin, key: RAID_SAVE_KEY, value: data }),
        }).catch(() => {});
      }
    } catch (e) { /* приватный режим / переполнение */ }
  };
  setInterval(saveNow, 2000);
  addEventListener('beforeunload', saveNow);
}
