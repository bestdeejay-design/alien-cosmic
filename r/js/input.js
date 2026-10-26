// ============================================================
// input.js — управление: выделение кликом и рамкой (ЛКМ), приказы
// (ПКМ: идти/добывать/атаковать/точка сбора), группы
// Ctrl/Shift/Alt+1…9 (двойной тап цифры — прыжок камеры), размещение
// зданий, камера (края экрана, стрелки, колесо / два пальца),
// горячие клавиши панели команд, трекпад-набор (. , Tab H).
// ============================================================
import { TILE, EDGE_MARGIN, EDGE_SCROLL_SPEED, KEY_SCROLL_SPEED, EDGE_PAN_GRACE, BUILDINGS, ZOOM_MIN, ZOOM_MAX } from './config.js?v=10262518';
import { unitAt } from './units.js?v=10262518';
import { buildingAt } from './buildings.js?v=10262518';
import { message } from './i18n.js?v=10262518';

// A1 (аудит владельца 26.10.2026): «не вводятся пин/ник — всю клавиатуру
// перепробовал». Причина: этот же глобальный keydown жрал цифры и буквы, пока
// курсор стоял в поле ввода (#sv-nick, #sv-pin, #adm-pin) — игра забирала
// нажатие себе: цифра уходила в группы, `p` ставила паузу, буквы — в команды.
// Теперь любой ввод в поле неприкосновенен: хоткеи/паузы/стрелки молчат.
export function isTypingTarget(target) {
  if (!target || typeof target !== 'object') return false;
  if (target === globalThis || target === document) return false;
  const tag = String(target.tagName || target.nodeName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if (target.isContentEditable === true) return true;
  return false;
}

export function attachInput(game) {
  const cv = game.canvas;
  const held = new Set();
  game.inputHeld = held;
  let lastGroupTap = { n: -1, t: 0 };

  // Колесо мыши / два пальца на трекпаде — панорама камеры.
  // Прокрутку оверлеев (списки, брифинги, кодекс) и нижней панели
  // не перехватываем: там колесо скроллит контент.
  window.addEventListener('wheel', (e) => {
    if (!game.started) return;
    const st = game.state;
    if (!st || st.gameOver || game.paused) return;
    const t = e.target;
    if (t && t.closest && t.closest('.overlay:not(.hidden), #bottom-panel, #topbar, #cmd-tip')) return;
    e.preventDefault();
    if (e.ctrlKey) return; // щипок на трекпаде: только гасим зум страницы
    const k = e.deltaMode === 1 ? 16 : 1;
    st.camera.x += e.deltaX * k;
    st.camera.y += e.deltaY * k;
    game.clampCam();
  }, { passive: false });

  const screenToWorld = (e) => {
    const r = cv.getBoundingClientRect();
    return game.screenToWorld(e.clientX - r.left, e.clientY - r.top);
  };

  // Pointer-based touch arbitration: tap selects/places, empty drag pans,
  // friendly-unit drag box-selects, pinch zooms around its moving midpoint,
  // and a stationary 450ms press issues the RMB-equivalent order.
  const touchPointers = new Map();
  let touchGesture = null;
  let longPressTimer = null;
  let ignoreCompatMouseUntil = 0;
  let lastTouchPoint = null;
  let lastTouchTap = { t: 0, x: 0, y: 0 };
  const isCompatMouse = (e) => {
    const source = e.sourceCapabilities;
    if (source && typeof source.firesTouchEvents === 'boolean') return source.firesTouchEvents;
    if (performance.now() >= ignoreCompatMouseUntil || !lastTouchPoint) return false;
    return Math.hypot(e.clientX - lastTouchPoint.x, e.clientY - lastTouchPoint.y) <= 24;
  };
  const clearLongPress = () => {
    if (longPressTimer !== null) clearTimeout(longPressTimer);
    longPressTimer = null;
  };
  const localPoint = (e) => {
    const r = cv.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  cv.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    const st = game.state;
    if (!st || !game.started || st.gameOver || game.paused) return;
    if (e.cancelable) e.preventDefault();
    ignoreCompatMouseUntil = performance.now() + 700;
    lastTouchPoint = { x: e.clientX, y: e.clientY };
    const point = localPoint(e);
    touchPointers.set(e.pointerId, point);
    // Хотфикс T2: тач не «оживляет» мышь. Синтетические mouse-события
    // после тача могут попасть в краевую зону (тап по кнопке «старт»
    // внизу экрана) — и камера уезжает вбок/вниз без остановки. Мышь
    // возвращается в сонное состояние (sentinel −1) на всё касание.
    game.mouse.x = -1; game.mouse.y = -1; game.edgeT = 0; game.edgeZone = null;
    try { if (cv.setPointerCapture) cv.setPointerCapture(e.pointerId); } catch { /* capture may be unavailable in embedded browsers */ }

    if (touchPointers.size >= 2) {
      clearLongPress();
      game.box = null;
      st.wallDrag = null;
      const pair = [...touchPointers.entries()].slice(0, 2);
      const a = pair[0][1], b = pair[1][1], mid = midpoint(a, b);
      const z = st.camera.z || 1;
      touchGesture = {
        mode: 'pinch', ids: pair.map(([id]) => id),
        startDistance: Math.max(1, distance(a, b)), startZoom: z,
        anchorWorld: game.screenToWorld(mid.x, mid.y),
      };
      return;
    }

    const world = game.screenToWorld(point.x, point.y);
    st.mouseWorld = world;
    if (st.placing) {
      updatePlacing(st, world);
      // Пакет V (вариант А): жест зеркалит pending-FSM обычного режима —
      // драг >9px станет паном камеры, для этого нужны стартовые координаты.
      touchGesture = { mode: 'placement', id: e.pointerId, start: point, startWorld: world,
        startCameraX: st.camera.x, startCameraY: st.camera.y, startZoom: st.camera.z || 1 };
      return;
    }
    const friendly = unitAt(st, world.x, world.y, 'player');
    touchGesture = {
      mode: 'pending', id: e.pointerId, start: point, startWorld: world,
      startCameraX: st.camera.x, startCameraY: st.camera.y, startZoom: st.camera.z || 1,
      friendly: !!friendly, startedAt: performance.now(),
    };
    longPressTimer = setTimeout(() => {
      if (!touchGesture || touchGesture.mode !== 'pending' || !touchPointers.has(e.pointerId)) return;
      touchGesture.mode = 'context';
      game.box = null;
      game.hooks.issueRMB(touchGesture.startWorld.x, touchGesture.startWorld.y);
      game.sound.ack();
    }, 450);
  }, { passive: false });

  cv.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'touch' || !touchPointers.has(e.pointerId)) return;
    if (e.cancelable) e.preventDefault();
    const point = localPoint(e);
    touchPointers.set(e.pointerId, point);
    const st = game.state;
    if (!st || !touchGesture) return;

    if (touchGesture.mode === 'pinch') {
      if (!touchGesture.ids.includes(e.pointerId)) return;
      const a = touchPointers.get(touchGesture.ids[0]);
      const b = touchPointers.get(touchGesture.ids[1]);
      if (!a || !b) return;
      const mid = midpoint(a, b);
      const z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX,
        touchGesture.startZoom * distance(a, b) / touchGesture.startDistance));
      st.camera.z = z;
      st.camera.x = touchGesture.anchorWorld.x - mid.x / z;
      st.camera.y = touchGesture.anchorWorld.y - mid.y / z;
      game.clampCam();
      return;
    }
    if (touchGesture.id !== e.pointerId) return;
    const dx = point.x - touchGesture.start.x, dy = point.y - touchGesture.start.y;
    const moved = Math.hypot(dx, dy);
    const world = game.screenToWorld(point.x, point.y);
    st.mouseWorld = world;

    if (touchGesture.mode === 'placement') {
      if (moved > 9) {
        // Пакет V (вариант А, MOBILE_BUILD_AUDIT §3.1): перетаскивание в режиме
        // постройки — это ПАН КАМЕРЫ, а не возня призрака со случайной
        // постановкой на отпускание. Призрак замирает на последней плитке,
        // жест переводится в пан (ветка ниже), tryPlace на up не вызывается.
        touchGesture.mode = 'pan';
      } else {
        updatePlacing(st, world);
        return;
      }
    }
    if (touchGesture.mode === 'pending' && moved > 9) {
      clearLongPress();
      if (touchGesture.friendly) {
        touchGesture.mode = 'box';
        game.box = {
          x0: touchGesture.startWorld.x, y0: touchGesture.startWorld.y,
          x1: world.x, y1: world.y,
        };
      } else {
        touchGesture.mode = 'pan';
      }
    }
    if (touchGesture.mode === 'box' && game.box) {
      game.box.x1 = world.x; game.box.y1 = world.y;
    } else if (touchGesture.mode === 'pan') {
      const z = touchGesture.startZoom;
      st.camera.x = touchGesture.startCameraX - dx / z;
      st.camera.y = touchGesture.startCameraY - dy / z;
      game.clampCam();
    }
  }, { passive: false });

  cv.addEventListener('pointerup', (e) => {
    if (e.pointerType !== 'touch' || !touchPointers.has(e.pointerId)) return;
    if (e.cancelable) e.preventDefault();
    const point = localPoint(e);
    lastTouchPoint = { x: e.clientX, y: e.clientY };
    ignoreCompatMouseUntil = performance.now() + 700;
    const st = game.state;
    clearLongPress();
    touchPointers.delete(e.pointerId);
    try { if (cv.hasPointerCapture && cv.hasPointerCapture(e.pointerId)) cv.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    if (!st || !touchGesture) return;

    if (touchGesture.mode === 'pinch') {
      if (touchGesture.ids.includes(e.pointerId)) {
        touchGesture = touchPointers.size ? { mode: 'consumed' } : null;
      }
      return;
    }
    if (touchGesture.id !== e.pointerId) return;
    const world = game.screenToWorld(point.x, point.y);
    if (touchGesture.mode === 'placement' && st.placing) {
      updatePlacing(st, world);
      if (st.placing.tx > -900) game.hooks.tryPlace(st.placing.tx, st.placing.ty);
    } else if (touchGesture.mode === 'pending') {
      const now = performance.now();
      const isDouble = now - lastTouchTap.t < 350 && distance(point, lastTouchTap) < 16;
      lastTouchTap = { t: now, x: point.x, y: point.y };
      touchTap(game, st, world, isDouble);
      game.sound.click();
    } else if (touchGesture.mode === 'box' && game.box) {
      game.box.x1 = world.x; game.box.y1 = world.y;
      boxSelect(game, st, game.box, false);
      game.box = null;
      game.sound.click();
    }
    touchGesture = null;
  }, { passive: false });

  const cancelTouchGesture = (e) => {
    if (e && e.pointerType && e.pointerType !== 'touch') return;
    clearLongPress();
    touchPointers.clear();
    touchGesture = null;
    game.box = null;
  };
  cv.addEventListener('pointercancel', cancelTouchGesture);
  cv.addEventListener('lostpointercapture', cancelTouchGesture);

  window.addEventListener('mousemove', (e) => {
    // Хотфикс T2: синтетические mouse-события тача (compat) не двигают
    // мышь — иначе на телефоне краевой скролл стартует от позиции тапа
    // и не останавливается (позиция мыши больше не обновляется).
    if (isCompatMouse(e)) return;
    game.mouse.x = e.clientX;
    game.mouse.y = e.clientY;
    // Хотфикс L: курсор над UI панели/топбара — краевой скролл молчит.
    // Инсеты уже исключают панели из игровой зоны, это страховка от любого
    // расхождения CSS и инсетов (изменение высоты панелей и т.п.).
    game.overUI = !!(e.target && e.target.closest &&
      e.target.closest('#topbar, #bottom-panel, #cmd-tip, #panel-show, .overlay:not(.hidden)'));
    const st = game.state;
    if (!st) return;
    // Перетаскивание карты СКМ: камера следует за мышью 1:1.
    if (game.pan) {
      st.camera.x = game.pan.cx - (e.clientX - game.pan.sx);
      st.camera.y = game.pan.cy - (e.clientY - game.pan.sy);
      game.clampCam();
    }
    const w = screenToWorld(e);
    st.mouseWorld = w;
    // F.1: тултип остатков кристалла (гейт: только канвас, не во время приказов).
    if (e.target && e.target.id === 'game-canvas' && game.updateCrystalTip &&
        !st.placing && !st.wallDrag && !st.box) game.updateCrystalTip(w.x, w.y);
    if (st.placing) updatePlacing(st, w);
    if (st.wallDrag) {
      st.wallDrag.x1 = Math.max(0, Math.min(st.map.w - 1, Math.floor(w.x / TILE)));
      st.wallDrag.y1 = Math.max(0, Math.min(st.map.h - 1, Math.floor(w.y / TILE)));
    }
    if (game.box) { game.box.x1 = w.x; game.box.y1 = w.y; }
  });

  cv.addEventListener('mousedown', (e) => {
    if (isCompatMouse(e)) { e.preventDefault(); return; }
    const st = game.state;
    if (!st || !game.started || st.gameOver) return;
    const w = screenToWorld(e);
    if (e.button === 0) {
      // Э7: режим «Держать сектор» — клик ставит пост отряду.
      if (st.holdPick) {
        st.holdPick = false;
        cv.style.cursor = '';
        game.hooks.issueHold(w.x, w.y);
        return;
      }
      // Режим атаки-движения: клик отдаёт приказ и выключает режим.
      if (st.attackMoveMode) {
        st.attackMoveMode = false;
        cv.style.cursor = '';
        game.hooks.issueAttackMove(w.x, w.y);
        return;
      }
      if (st.placing) {
        const cfg = BUILDINGS[st.placing.type];
        // П3 (B.7.4): 1×1 тянется линией — старт драга, коммит на mouseup.
        if (cfg.w === 1 && cfg.h === 1) {
          st.wallDrag = { x0: st.placing.tx, y0: st.placing.ty, x1: st.placing.tx, y1: st.placing.ty };
          return;
        }
        game.hooks.tryPlace(st.placing.tx, st.placing.ty);
        return;
      }
      game.box = { x0: w.x, y0: w.y, x1: w.x, y1: w.y };
    } else if (e.button === 2) {
      if (st.holdPick) { st.holdPick = false; cv.style.cursor = ''; return; }
      if (st.attackMoveMode) { st.attackMoveMode = false; cv.style.cursor = ''; return; }
      if (st.wallDrag) { st.wallDrag = null; return; }
      if (st.placing) { st.placing = null; return; }
      game.hooks.issueRMB(w.x, w.y);
    } else if (e.button === 1) {
      // СКМ — «взять» карту и перетащить. Самый прямой способ двигать
      // камеру: зажал — потянул — отпустил.
      e.preventDefault();
      game.pan = { sx: e.clientX, sy: e.clientY, cx: st.camera.x, cy: st.camera.y };
      cv.style.cursor = 'grabbing';
    }
  });

  // Средняя кнопка не должна вызывать системный автоскролл.
  cv.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });

  window.addEventListener('mouseup', (e) => {
    if (isCompatMouse(e)) return;
    if (e.button === 1 && game.pan) {
      game.pan = null;
      cv.style.cursor = '';
      return;
    }
    const st = game.state;
    if (!st) return;
    // П3: отпуск драга линии — одиночный клик ставит один тайл.
    if (e.button === 0 && st.wallDrag) {
      const d = st.wallDrag;
      st.wallDrag = null;
      // Фикс блокера П3: коммит идёт от снимка — поле уже обнулено.
      if (d.x0 === d.x1 && d.y0 === d.y1) game.hooks.tryPlace(d.x0, d.y0);
      else game.commitWallLine(d);
      game.sound.click();
      return;
    }
    if (e.button !== 0 || !game.box) return;
    const box = game.box;
    game.box = null;
    const w = screenToWorld(e);
    box.x1 = w.x; box.y1 = w.y;
    if (Math.abs(box.x1 - box.x0) < 5 && Math.abs(box.y1 - box.y0) < 5) {
      const now = performance.now();
      const dbl = game.lastClick && now - game.lastClick.t < 350 &&
        Math.hypot(w.x - game.lastClick.x, w.y - game.lastClick.y) < 16;
      game.lastClick = { t: now, x: w.x, y: w.y };
      if (dbl && !e.shiftKey) doubleSelect(game, st, w);
      else clickSelect(game, st, w, e.shiftKey);
    } else {
      boxSelect(game, st, box, e.shiftKey);
    }
    game.sound.click();
  });

  // ПКМ — игровые приказы, поэтому контекстное меню отключаем.
  cv.addEventListener('contextmenu', (e) => e.preventDefault());

  window.addEventListener('keydown', (e) => {
    // A1: фокус в поле — клавиатура принадлежит полю, а не игре.
    if (isTypingTarget(e.target)) return;
    const st = game.state;
    if (!st) return;
    if (game.ui.isRaidOverlayOpen && game.ui.isRaidOverlayOpen()) {
      if (e.code === 'Escape') { e.preventDefault(); game.closeRaidLaunch(); }
      return;
    }
    // П3 (B.7.5): в режиме стройки стрелки двигают ПРИЗРАК по тайлам.
    if (e.code.startsWith('Arrow')) {
      if (st.placing) {
        e.preventDefault();
        st.wallDrag = null;
        stepPlacing(st,
          e.code === 'ArrowLeft' ? -1 : e.code === 'ArrowRight' ? 1 : 0,
          e.code === 'ArrowUp' ? -1 : e.code === 'ArrowDown' ? 1 : 0);
        return;
      }
      held.add(e.code); e.preventDefault(); return;
    }
    if (!game.started || st.gameOver || e.repeat) return;

    // Cmd+… целиком отдаём браузеру/macOS (вкладки, перезагрузка и т.п.).
    if (e.metaKey) return;
    // 1…9: выбор группы; Ctrl/Shift/Alt+1…9: назначить группу.
    // На macOS Ctrl+цифру перехватывают Spaces, а Cmd+цифру — вкладки
    // браузера, поэтому рабочим вариантом остаётся Alt+цифра. Двойной
    // тап цифры прыгает камерой к отряду, как в StarCraft.
    const m = e.code.match(/^(?:Digit|Numpad)([1-9])$/);
    if (m) {
      e.preventDefault();
      const n = +m[1];
      if (e.ctrlKey || e.shiftKey || e.altKey) game.hooks.assignGroup(n);
      else {
        game.hooks.selectGroup(n);
        const now = performance.now();
        if (lastGroupTap.n === n && now - lastGroupTap.t < 350) {
          game.hooks.centerOnGroup(n);
        }
        lastGroupTap = { n, t: now };
      }
      return;
    }
    if (e.code === 'Escape') {
      if (game.paused) { game.togglePause(); return; }
      if (st.wallDrag) st.wallDrag = null;
      else if (st.placing) st.placing = null;
      else if (st.holdPick) { st.holdPick = false; cv.style.cursor = ''; }
      else if (st.attackMoveMode) { st.attackMoveMode = false; cv.style.cursor = ''; }
      else if (st.buildMenu) st.buildMenu = false;
      else st.selection = [];
      return;
    }
    // A — атака-движение: следующий ЛКМ шлёт отряд в бой по пути.
    if (e.code === 'KeyA' && !st.placing && !e.ctrlKey && !e.altKey) {
      const combat = st.selection.some((s) => s.kind === 'unit' && s.side === 'player' &&
        !s.dead && !s.garrison && s.cfg.dmg > 0);
      if (combat) {
        st.attackMoveMode = true;
        cv.style.cursor = 'crosshair';
        game.sound.click();
      }
      return;
    }
    if (e.code === 'KeyP' && !e.ctrlKey && !e.altKey) { game.togglePause(); return; }
    // Пакет E.1: V — показать/скрыть командную панель.
    if (e.code === 'KeyV' && !e.ctrlKey && !e.altKey) {
      game.ui.togglePanel(); game.resize(); game.sound.click(); return;
    }
    // П2: зум + / − с якорем под курсором (колесо — панорама, не трогаем).
    if ((e.code === 'Equal' || e.code === 'NumpadAdd' ||
         e.code === 'Minus' || e.code === 'NumpadSubtract') && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      const zin = e.code === 'Equal' || e.code === 'NumpadAdd';
      const r = cv.getBoundingClientRect();
      const mx = game.mouse.x - r.left, my = game.mouse.y - r.top;
      const over = mx >= 0 && my >= 0 && mx < game.cssW && my < game.cssH;
      const z = st.camera.z || 1;
      if (over) game.setZoom(z * (zin ? 1.15 : 1 / 1.15), mx, my);
      else game.setZoom(z * (zin ? 1.15 : 1 / 1.15));
      game.sound.click();
      return;
    }
    // Трекпад-набор: . — свободный рабочий, , — вся армия,
    // Tab — перебор бойцов, H — к последней тревоге. Tab не трогаем
    // на паузе, чтобы не ломать фокус кнопок оверлея.
    if (e.code === 'Period' && !e.ctrlKey && !e.altKey) { game.hooks.cycleIdleWorker(); return; }
    if (e.code === 'Comma' && !e.ctrlKey && !e.altKey) { game.hooks.selectArmy(); return; }
    if (e.code === 'KeyH' && !e.ctrlKey && !e.altKey) { game.hooks.jumpToAlert(); return; }
    if (e.code === 'Tab' && !e.ctrlKey && !e.altKey && !game.paused) {
      e.preventDefault();
      game.hooks.cycleCombat();
      return;
    }
    // П3 (B.7.5): Enter/Space в placing — поставить под призраком.
    if ((e.code === 'Enter' || e.code === 'Space') && st.placing && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      game.hooks.tryPlace(st.placing.tx, st.placing.ty);
      return;
    }
    if (e.code === 'Space' && !e.ctrlKey && !e.altKey) {
      // Пробел — мгновенный прыжок камерой к своей базе (или челноку вылазки).
      e.preventDefault();
      const cc = st.buildings.find((b) => b.side === 'player' && b.type === 'cc' && !b.dead);
      if (cc) { game.centerCamera(cc.x, cc.y); game.sound.click(); }
      else if (st.raidDrop) { game.centerCamera(st.raidDrop.x, st.raidDrop.y); game.sound.click(); }
      return;
    }
    // Хоткеи панели команд (Q/W/E — стройка и производство, B, S).
    if (!e.ctrlKey && !e.altKey && !e.metaKey) game.ui.handleHotkey(e.code);
  });

  window.addEventListener('keyup', (e) => held.delete(e.code));
  window.addEventListener('blur', () => { held.clear(); game.mouse.x = -1; game.edgeT = 0; });
  // Хотфикс L: курсор ушёл за окно — мышь «умерла» (sentinel −1), иначе
  // последняя позиция в краевой зоне панорамировала бы вечно. Гарды —
  // для headless-среды симов (там document.documentElement нет).
  if (typeof document !== 'undefined' && document.documentElement &&
      document.documentElement.addEventListener) {
    document.documentElement.addEventListener('mouseleave', () => {
      game.mouse.x = -1; game.mouse.y = -1; game.edgeT = 0; game.edgeZone = null;
    });
  }
}

// П3: шаг призрака по сетке с клампом (клавиатурная постановка).
export function stepPlacing(st, dx, dy) {
  const cfg = BUILDINGS[st.placing.type];
  st.placing.tx = Math.max(0, Math.min(st.map.w - cfg.w, st.placing.tx + dx));
  st.placing.ty = Math.max(0, Math.min(st.map.h - cfg.h, st.placing.ty + dy));
}

// Призрак здания следует за курсором, привязан к сетке тайлов.
function updatePlacing(st, w) {
  const cfg = BUILDINGS[st.placing.type];
  st.placing.tx = Math.max(0, Math.min(st.map.w - cfg.w, Math.round(w.x / TILE - cfg.w / 2)));
  st.placing.ty = Math.max(0, Math.min(st.map.h - cfg.h, Math.round(w.y / TILE - cfg.h / 2)));
}

export function clickSelect(game, st, w, shift) {
  let picked = unitAt(st, w.x, w.y, 'player');
  let inspect = false;
  if (!picked) {
    const e = unitAt(st, w.x, w.y, 'enemy');
    if (e) { picked = e; inspect = true; }
  }
  if (!picked) {
    const b = buildingAt(st, w.x, w.y);
    if (b) { picked = b; inspect = b.side === 'enemy'; }
  }
  if (!picked) {
    if (!shift) st.selection = [];
    st.buildMenu = false;
    return;
  }
  // Врага можно только осмотреть — приказы на него из выделения не идут.
  if (inspect) { st.selection = [picked]; st.buildMenu = false; return; }
  if (shift) {
    const i = st.selection.indexOf(picked);
    if (i >= 0) st.selection.splice(i, 1);
    else st.selection.push(picked);
  } else {
    st.selection = [picked];
  }
  st.buildMenu = false;
}

// Хотфикс T1 (тап-приказ): семантика одиночного тача-тапа.
// Тап по своему юниту — выделение (двойной — все такие же на экране);
// по своему зданию — выделение. По врагу/земле/кристаллу при активном
// выделении — приказ (эквивалент ПКМ), выделение сохраняется.
// Двойной тап по пустому — снять выделение. Без выделения — как было:
// осмотр врага, иначе пустой тап.
function touchTap(game, st, w, dbl) {
  // Пакет U: тап в режиме атака-движения — приказ и выход из режима
  // (зеркало ЛКМ-пути десктопа). Драг/пинч режим не съедают: тапили — значит приказ.
  if (st.holdPick) {
    st.holdPick = false;
    game.canvas.style.cursor = '';
    game.hooks.issueHold(w.x, w.y);
    return;
  }
  if (st.attackMoveMode) {
    st.attackMoveMode = false;
    game.canvas.style.cursor = '';
    game.hooks.issueAttackMove(w.x, w.y);
    return;
  }
  const ownUnit = unitAt(st, w.x, w.y, 'player');
  if (ownUnit) {
    if (dbl) doubleSelect(game, st, w);
    else clickSelect(game, st, w, false);
    touchHintOnce(game);
    return;
  }
  const b = buildingAt(st, w.x, w.y);
  if (b && b.side === 'player') {
    clickSelect(game, st, w, false); // двойной тап на здании смысла не меняет
    touchHintOnce(game);
    return;
  }
  const hasUnits = st.selection.some((s) => s.kind === 'unit' && s.side === 'player' && !s.dead);
  const hasBld = st.selection.length === 1 && st.selection[0].kind === 'building' &&
    st.selection[0].side === 'player' && !st.selection[0].dead;
  if (hasUnits || hasBld) {
    const enemy = unitAt(st, w.x, w.y, 'enemy');
    if (dbl && !enemy) {
      st.selection = []; st.buildMenu = false; // двойной тап по пустому — снять
      return;
    }
    game.hooks.issueRMB(w.x, w.y); // идти/атака/добыча/ремонт/точка сбора
    touchHintOnce(game);
    return;
  }
  clickSelect(game, st, w, false); // без выделения — как раньше
}

// Одноразовая подсказка жестов: игроку на телефоне нужно знать, что
// тап теперь отдаёт приказы, а снять выделение можно двойным тапом.
function touchHintOnce(game) {
  if (game.touchHintShown) return;
  game.touchHintShown = true;
  if (game.ui && game.ui.toast && game.state) {
    game.ui.toast(message('touchOrders', game.state.factions.player));
  }
}

// Двойной клик/двойной тап по юниту — выделить всех таких же на экране.
// Решает «в толпе сложно рассортировать»: один двойной клик собирает
// всех рейнджеров (или дронов, или бастионов) в выделение.
function doubleSelect(game, st, w) {
  const u = unitAt(st, w.x, w.y, 'player');
  if (!u) {
    st.selection = [];
    st.buildMenu = false;
    return;
  }
  const x0 = st.camera.x, y0 = st.camera.y;
  const x1 = x0 + game.viewW(), y1 = y0 + game.viewH();
  const same = st.units.filter((o) => !o.dead && !o.garrison && o.side === 'player' &&
    o.type === u.type && o.x >= x0 && o.x <= x1 && o.y >= y0 && o.y <= y1);
  st.selection = same.length ? same : [u];
  st.buildMenu = false;
  game.sound.click();
}

export function boxSelect(game, st, box, shift) {
  const x0 = Math.min(box.x0, box.x1), x1 = Math.max(box.x0, box.x1);
  const y0 = Math.min(box.y0, box.y1), y1 = Math.max(box.y0, box.y1);
  const inR = (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
  // Приоритет юнитам; если юнитов нет — берём одно здание.
  // Сидящие в бункере (u.garrison) не выделяются — они «внутри».
  let picked = st.units.filter((u) => !u.dead && !u.garrison && u.side === 'player' && inR(u.x, u.y));
  if (!picked.length) {
    picked = st.buildings.filter((b) => !b.dead && b.side === 'player' &&
      b.tx * TILE < x1 && (b.tx + b.w) * TILE > x0 &&
      b.ty * TILE < y1 && (b.ty + b.h) * TILE > y0).slice(0, 1);
  }
  if (shift) {
    const set = new Set(st.selection);
    for (const p of picked) { if (set.has(p)) set.delete(p); else set.add(p); }
    picked = [...set];
  }
  st.selection = picked;
  st.buildMenu = false;
}

// Камера: стрелки, СКМ-перетаскивание, мышь у края игровой области.
// Края считаются внутри игровой зоны: над верхней/нижней панелями UI
// краевой скролл не срабатывает — иначе наведение на кнопки уводило
// камеру в сторону (главная причина «неудобно двигать карту»).
export function updateCamera(game, dt) {
  const st = game.state;
  if (!st) return;
  const held = game.inputHeld;
  let dx = 0, dy = 0;
  if (held.has('ArrowLeft')) dx -= 1;
  if (held.has('ArrowRight')) dx += 1;
  if (held.has('ArrowUp')) dy -= 1;
  if (held.has('ArrowDown')) dy += 1;

  if (dx || dy) {
    st.camera.x += dx * KEY_SCROLL_SPEED * dt;
    st.camera.y += dy * KEY_SCROLL_SPEED * dt;
    game.edgeT = 0; game.edgeZone = null; // хотфикс L: стрелки — без краевых зон
  } else if (!game.pan && game.started && !st.gameOver && game.mouse.x >= 0 && !game.overUI) {
    const m = game.mouse, M = EDGE_MARGIN;
    const w = window.innerWidth, h = window.innerHeight;
    const top = game.uiTop || 0, bot = game.uiBottom || 0;
    const L = game.uiLeft || 0, R = game.uiRight || 0;
    // Курсор в игровой зоне (вне панелей E.1); края считаются от неё.
    const inPlay = m.x > L && m.x < w - R && m.y > top && m.y < h - bot;
    // Хотфикс L: какие краевые зоны активны — для grace и индикатора на экране.
    const zL = inPlay && m.x < L + M, zR = inPlay && m.x > w - R - M;
    const zT = inPlay && m.y < top + M, zB = inPlay && m.y > h - bot - M;
    game.edgeZone = (zL || zR || zT || zB) ? { l: zL, r: zR, t: zT, b: zB } : null;
    if (game.edgeZone) {
      // Хотфикс L: пан стартует после EDGE_PAN_GRACE непрерывного пребывания
      // в зоне — проход к панели через 26-пиксельную полосу камеру не тянет.
      game.edgeT = (game.edgeT || 0) + dt;
      if (game.edgeT >= EDGE_PAN_GRACE) {
        if (zL) st.camera.x -= EDGE_SCROLL_SPEED * dt;
        else if (zR) st.camera.x += EDGE_SCROLL_SPEED * dt;
        if (zT) st.camera.y -= EDGE_SCROLL_SPEED * dt;
        else if (zB) st.camera.y += EDGE_SCROLL_SPEED * dt;
      }
    } else {
      game.edgeT = 0;
    }
  } else {
    // Хотфикс L: над UI / при перетаскивании / без мыши зоны гаснут.
    game.edgeT = 0; game.edgeZone = null;
  }
  game.clampCam();
}
