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
    // ВЛАДЕЛЕЦ 25.10: на этапе рейдов интерфейс полигона — русский.
    try {
      if (!localStorage.getItem('terranrts.language')) {
        localStorage.setItem('terranrts.language', 'ru');
        if (window.i18nSetLocale) window.i18nSetLocale('ru');
      }
    } catch { /* */ }
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

    // 3) Восстановление: сначала localStorage, при отсутствии — сервер
    //    (профиль ник+пин) ЧЕРЕЗ ЕДИНЫЙ КЛИЕНТ СЕЙВА (save-client.js):
    //    один путь для кампании и базы рейда, один канал (same-origin /api).
    //    Так база ходит за игроком между машинами и браузерами.
    for (let i = 0; i < 60 && !window.__saveApi; i++) await new Promise((r) => setTimeout(r, 50));
    // C1 (кросс-браузер, P3/#35): дождаться СВЕРКИ профиля. Раньше boot читал
    // localStorage сразу после появления __saveApi — то есть ДО pull, стартовал
    // новую базу и первым же сейвом затирал серверный прогресс владельца.
    if (window.__saveReady) {
      try {
        await Promise.race([
          window.__saveReady,
          new Promise((r) => setTimeout(r, 4000)),
        ]);
      } catch { /* сверка не удалась — работаем на локальных данных */ }
    }
    const saveApi = window.__saveApi || null;
    // P1 (#45): БАЗА ДО СТАРТА. При входе в профиль сначала тянем снапшот
    // (индикатор прогресса, таймаут 10 с, «Повторить», офлайн-фолбэк) и только
    // потом поднимаем симуляцию. Раньше boot стартовал «новую базу» и первым
    // сейвом затирал серверный прогресс — это и был баг №1 «вход не даёт КЦ-16».
    let gateStarted = false;
    let gateTriedNet = false;
    if (saveApi && saveApi.identity && typeof saveApi.authGate === 'function' && !game.started) {
      try {
        const gate = await saveApi.authGate(game);
        gateStarted = !!(gate && gate.applied && gate.applied.applied);
        // Гейт уже сходил в сеть (успешно или нет). Повторный pullKey ниже —
        // второй такой же запрос; при офлайне он ещё и висит до таймаута,
        // поэтому сеть второй раз не трогаем (итерация 2 ревью #45).
        gateTriedNet = gate && gate.source !== 'anon';
        console.log('[r] гейт входа: источник=' + (gate && gate.source) + ', применил снапшот=' + gateStarted);
      } catch (e) { console.warn('[r] гейт входа не отработал — падаем на локальный сейв', e); }
    }
    let saved = (() => { try { return localStorage.getItem(RAID_SAVE_KEY); } catch { return null; } })();
    if (!saved && saveApi && saveApi.identity && !gateTriedNet) {
      saved = await saveApi.pullKey(RAID_SAVE_KEY);
      if (saved) console.log('[r] сессия рейда восстановлена с сервера');
    }
    if (saved && !game.started) {   // гейт уже поднял базу — не перезапускаем
      try {
        game.raidSession = JSON.parse(saved);
        console.log('[r] сессия рейда восстановлена из сохранения');
      } catch (e) { console.warn('[r] сейв рейда повреждён, стартуем заново', e); }
    }
    // База поднимается ОДИН раз: если гейт входа уже применил снапшот —
    // не перезапускаем её (иначе «до вылета» снова станет пустой базой).
    if (!game.started) {
      try {
        game.startRaidHome('human');
      } catch (e) {
        // З1 (#42, safe-mode boot): валидный JSON с кривым содержимым больше
        // не проваливается во внешний catch (тёмный экран, «r/ BOOT ERR»).
        // Стираем битую сессию и стартуем новую базу — boot всегда приходит
        // в играбельный home; серверный ключ перезапишется первым же сейвом.
        console.error('[r] сейв рейда повреждён — safe-mode: начинаем новую базу', e);
        game.raidSession = null;
        try { localStorage.removeItem(RAID_SAVE_KEY); } catch { /* */ }
        try {
          const { t } = await import('./js/i18n.js?v=10271845');
          if (game.ui && typeof game.ui.toast === 'function') {
            game.ui.toast(t('ui.boot.saveCorrupted'), 'warn', 5200);
          }
        } catch { /* без тоста — но игра всё равно стартует */ }
        game.startRaidHome('human');
      }
    }
    if (game.started) {
      // Э6: капсулы снабжения — тянем серверный топ/подарки и показываем
      // карточки при входе (не кнопка в топбаре, а карточки на экране).
      try {
        const chestsUi = await import('./js/chests-ui.js?v=10271845');
        chestsUi.registerChestCommand(game);
        await chestsUi.hydrateFromServer(game);
        chestsUi.maybeShowOnEntry(game);
      } catch (e) { console.warn('[r] капсулы не поднялись', e); }
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
        // Толчок на сервер — через общий клиент (он знает канал и профиль).
        if (saveApi && saveApi.identity) saveApi.pushKey(RAID_SAVE_KEY);
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
    setInterval(() => saveNow('таймер'), 1500);
    saveNow('старт полигона');
  } catch (e) {
    document.title = 'r/ BOOT ERR: ' + e.message;
    console.error('[r] boot error:', e);
  }
}
