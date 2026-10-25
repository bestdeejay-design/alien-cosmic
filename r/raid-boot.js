// raid-boot.js — ПОЛИГОН /r/: прямой заход в рейдовый режим, минуя лендинг.
// Копия движка Арены (R0-a); движок не меняем — надстройка делает три вещи:
// 1) скрывает рейдовые кнопки топбара (канон владельца: без кнопок);
// 2) эвакуация в мире: клик по кольцу посадки; запуск вылазки — команда КЦ (E);
// 3) сохранение прогресса рейда (сессия корабля-КЦ): localStorage + сейв-сервер.
import { TILE } from './js/config.js';

const RAID_SAVE_KEY = 'ac_raid_session_v1';

for (let i = 0; i < 200 && !(window.game && window.game.state); i++) {
  await new Promise((r) => setTimeout(r, 50));
}
const game = window.game;
if (!game) {
  console.error('[r] game не загрузился');
} else {
  try {
    // 1) Кнопки топбара, связанные с рейдом и рестартом, скрыть (канон: без кнопок).
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

    // 3) Восстановление: сессия корабля из localStorage (сервер подтягивает сейв-клиент).
    const saved = (() => { try { return localStorage.getItem(RAID_SAVE_KEY); } catch { return null; } })();
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

    // 4) Сохранение — правильно и своевременно (v2):
    //    только снапшот домашней базы (home-режим); вылазка в полёте не
    //    сериализуется — перезагрузка возвращает «до вылета», отряд и база целы;
    //    триггеры — события (запуск/финиш вылазки, скрытие вкладки, уход) + таймер-страховка.
    let lastSaved = null;
    const saveNow = (why) => {
      const st = game.state;
      if (!game.raidSession) return;
      if (!st || st.raidMode !== 'home' || st.gameOver) return;
      try {
        // снапшот базы движок обновляет лишь в отдельные моменты — актуализируем сами
        game.syncRaidHomeSnapshot();
        const data = JSON.stringify(game.raidSession);
        if (data === lastSaved) return;
        localStorage.setItem(RAID_SAVE_KEY, data);
        lastSaved = data;
        const nick = localStorage.getItem('ac_save_nick'), pin = localStorage.getItem('ac_save_pin');
        if (nick && pin) {
          fetch(`http://${location.hostname}:8790/api/save`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ player: nick, pin, key: RAID_SAVE_KEY, value: data }),
          }).catch(() => {});
        }
        if (why) console.log('[r] сейв рейда записан:', why);
      } catch (e) { /* приватный режим / переполнение */ }
    };

    const origLaunch = game.launchRaidExpedition.bind(game);
    game.launchRaidExpedition = (draft) => {
      const v = origLaunch(draft);
      if (v && v.ok) setTimeout(() => saveNow('запуск вылазки: база зафиксирована «до вылета»'), 50);
      return v;
    };
    const origFinish = game.finishRaidExpedition.bind(game);
    game.finishRaidExpedition = (outcome) => {
      const r = origFinish(outcome);
      setTimeout(() => saveNow(`вылазка завершена (${outcome})`), 50);
      return r;
    };
    document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow('вкладка скрыта'); });
    addEventListener('pagehide', () => saveNow('уход со страницы'));
    setInterval(() => saveNow('таймер'), 1000);
    saveNow('старт полигона');
  } catch (e) {
    document.title = 'r/ BOOT ERR: ' + e.message;
    console.error('[r] boot error:', e);
  }
}
