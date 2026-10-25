// raid-boot.js — ПОЛИГОН /r/: прямой заход в рейдовый режим, минуя лендинг.
// Копия движка Арены (R0-a); сам движок не меняем — только автозапуск и
// УБИРАЕМ рейдовые кнопки топбара (решение владельца 25.10: никакого UI,
// всё через строения и юниты).
import { TILE } from './js/config.js';

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
  // 3) Автозапуск домашнего рейд-режима.
  if (!game.started) {
    game.startRaidHome('human');
    window.dispatchEvent(new Event('ac-vv-check'));
    console.log('[r] полигон: рейд-хоум запущен; запуск вылазки — выделить корабль-КЦ → «Запуск» (E), эвакуация — клик по кольцу посадки');
  }
}
