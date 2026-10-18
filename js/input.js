// ============================================================
// input.js — управление: выделение кликом и рамкой (ЛКМ), приказы
// (ПКМ: идти/добывать/атаковать/точка сбора), группы
// Ctrl/Shift/Alt+1…9 (двойной тап цифры — прыжок камеры), размещение
// зданий, камера (края экрана, стрелки, колесо / два пальца),
// горячие клавиши панели команд, трекпад-набор (. , Tab H).
// ============================================================
import { TILE, MAP_W, MAP_H, WORLD_W, WORLD_H, EDGE_MARGIN, EDGE_SCROLL_SPEED, KEY_SCROLL_SPEED, BUILDINGS } from './config.js';
import { unitAt } from './units.js';
import { buildingAt } from './buildings.js';

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
    return {
      x: e.clientX - r.left + game.state.camera.x,
      y: e.clientY - r.top + game.state.camera.y,
    };
  };

  window.addEventListener('mousemove', (e) => {
    game.mouse.x = e.clientX;
    game.mouse.y = e.clientY;
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
    if (st.placing) updatePlacing(st, w);
    if (game.box) { game.box.x1 = w.x; game.box.y1 = w.y; }
  });

  cv.addEventListener('mousedown', (e) => {
    const st = game.state;
    if (!st || !game.started || st.gameOver) return;
    const w = screenToWorld(e);
    if (e.button === 0) {
      // Режим атаки-движения: клик отдаёт приказ и выключает режим.
      if (st.attackMoveMode) {
        st.attackMoveMode = false;
        cv.style.cursor = '';
        game.hooks.issueAttackMove(w.x, w.y);
        return;
      }
      if (st.placing) { game.hooks.tryPlace(st.placing.tx, st.placing.ty); return; }
      game.box = { x0: w.x, y0: w.y, x1: w.x, y1: w.y };
    } else if (e.button === 2) {
      if (st.attackMoveMode) { st.attackMoveMode = false; cv.style.cursor = ''; return; }
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
    if (e.button === 1 && game.pan) {
      game.pan = null;
      cv.style.cursor = '';
      return;
    }
    const st = game.state;
    if (e.button !== 0 || !st || !game.box) return;
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
    const st = game.state;
    if (!st) return;
    if (e.code.startsWith('Arrow')) { held.add(e.code); e.preventDefault(); return; }
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
      if (st.placing) st.placing = null;
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
    if (e.code === 'Space' && !e.ctrlKey && !e.altKey) {
      // Пробел — мгновенный прыжок камерой к своей базе.
      e.preventDefault();
      const cc = st.buildings.find((b) => b.side === 'player' && b.type === 'cc' && !b.dead);
      if (cc) { game.centerCamera(cc.x, cc.y); game.sound.click(); }
      return;
    }
    // Хоткеи панели команд (Q/W/E — стройка и производство, B, S).
    if (!e.ctrlKey && !e.altKey && !e.metaKey) game.ui.handleHotkey(e.code);
  });

  window.addEventListener('keyup', (e) => held.delete(e.code));
  window.addEventListener('blur', () => held.clear());
}

// Призрак здания следует за курсором, привязан к сетке тайлов.
function updatePlacing(st, w) {
  const cfg = BUILDINGS[st.placing.type];
  st.placing.tx = Math.max(0, Math.min(MAP_W - cfg.w, Math.round(w.x / TILE - cfg.w / 2)));
  st.placing.ty = Math.max(0, Math.min(MAP_H - cfg.h, Math.round(w.y / TILE - cfg.h / 2)));
}

function clickSelect(game, st, w, shift) {
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
  const x1 = x0 + game.cssW, y1 = y0 + game.cssH;
  const same = st.units.filter((o) => !o.dead && !o.garrison && o.side === 'player' &&
    o.type === u.type && o.x >= x0 && o.x <= x1 && o.y >= y0 && o.y <= y1);
  st.selection = same.length ? same : [u];
  st.buildMenu = false;
  game.sound.click();
}

function boxSelect(game, st, box, shift) {
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
  } else if (!game.pan && game.started && !st.gameOver && game.mouse.x >= 0) {
    const m = game.mouse, M = EDGE_MARGIN;
    const w = window.innerWidth, h = window.innerHeight;
    const top = game.uiTop || 0, bot = game.uiBottom || 0;
    const inPlay = m.y > top && m.y < h - bot; // курсор в игровой зоне
    if (inPlay) {
      if (m.x < M) st.camera.x -= EDGE_SCROLL_SPEED * dt;
      else if (m.x > w - M) st.camera.x += EDGE_SCROLL_SPEED * dt;
      if (m.y < top + M) st.camera.y -= EDGE_SCROLL_SPEED * dt;
      else if (m.y > h - bot - M) st.camera.y += EDGE_SCROLL_SPEED * dt;
    }
  }
  game.clampCam();
}
