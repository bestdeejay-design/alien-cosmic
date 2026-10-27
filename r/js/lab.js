// ============================================================
// lab.js — «лаборатория грейдов»: контрольный лист вида 20 уровней.
//
// Отдельная страница r/lab.html (не влияет на игру): рисует все здания
// на 1…20 грейде и всех юнитов на рангах 0…20 тем же кодом, что и бой.
// Нужна владельцу, чтобы глазами проверить «эволюцию» без запуска рейда.
//
// Изоляция: lab использует только модули r/ (config/buildings/units),
// никакой сети и никаких сохранений — гейт check_r.mjs это разрешает,
// потому что lab.html не подключён в r/index.html.
// ============================================================
import { BUILDINGS, UNITS, TILE } from './config.js?v=10271830';
import { drawBuilding } from './buildings.js?v=10271830';
import { drawUnit } from './units.js?v=10271830';

const BUILD_ORDER = ['cc', 'depot', 'barracks', 'factory', 'lab', 'turret', 'bunker', 'wall'];
const UNIT_ORDER = ['worker', 'marine', 'buggy', 'tank', 'medic', 'flamer', 'arty', 'scout'];
const RU = {
  cc: 'КЦ', depot: 'Дом', barracks: 'Казарма', factory: 'Завод', lab: 'Лаборатория',
  turret: 'Турель', bunker: 'Бункер', wall: 'Стена',
  worker: 'Техник', marine: 'Рейнджер', buggy: 'Скользень', tank: 'Танк', medic: 'Нанит',
  flamer: 'Огнемёт', arty: 'Артиллерия', scout: 'Следопыт',
};
const PHASE_NAME = (L) => (L <= 4 ? 'сталь' : L <= 9 ? 'золото' : L <= 14 ? 'графит' : L <= 19 ? 'неон' : 'призма');
const LEVELS = Array.from({ length: 20 }, (_, i) => i + 1);
const RANKS = Array.from({ length: 21 }, (_, i) => i);

function label(ctx, x, y, text, color, size = 10, align = 'center') {
  ctx.save();
  ctx.fillStyle = color || 'rgba(223,232,234,0.72)';
  ctx.font = `${size}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  ctx.fillText(text, x, y);
  ctx.restore();
}

function frame(ctx, x, y, w, h) {
  ctx.strokeStyle = 'rgba(118,227,215,0.10)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

function setup(canvas, width, height) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const ctx = canvas.getContext('2d');
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return { ctx, dpr };
}

// ---------- Здания: строка = тип, столбец = грейд ----------
function drawBuildingSheet(canvasId, faction) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const CW = 96, CH = 96, ROW_LABEL = 96, FOOT = 14;
  const width = ROW_LABEL + LEVELS.length * CW;
  const height = 20 + BUILD_ORDER.length * (CH + FOOT);
  const { ctx } = setup(canvas, width, height);

  label(ctx, ROW_LABEL / 2, 4, 'грейд →', 'rgba(118,227,215,0.8)', 11);
  for (const L of LEVELS) {
    label(ctx, ROW_LABEL + (L - 0.5) * CW, 4, String(L), L === 20 ? '#c9a7ff' : 'rgba(223,232,234,0.6)', 11);
  }

  BUILD_ORDER.forEach((type, row) => {
    const cfg = BUILDINGS[type];
    if (!cfg) return;
    const top = 20 + row * (CH + FOOT);
    label(ctx, ROW_LABEL - 10, top + CH / 2 - 7, RU[type] || type, 'rgba(223,232,234,0.92)', 12, 'right');
    for (const L of LEVELS) {
      const x0 = ROW_LABEL + (L - 1) * CW;
      const tw = cfg.w || 2, th = cfg.h || 2;
      const wpx = tw * TILE, hpx = th * TILE;
      const s = Math.min((CW - 12) / wpx, (CH - 12) / hpx, 1.1);
      const b = {
        type, level: L, done: true, side: 'player', faction, cfg,
        tx: 0, ty: 0, w: tw, h: th,
        hp: cfg.hp, maxHp: cfg.hp, garrison: [], id: row * 31 + L,
        angle: -Math.PI / 4, progress: 1,
      };
      ctx.save();
      ctx.translate(x0 + (CW - wpx * s) / 2, top + (CH - hpx * s) / 2);
      ctx.scale(s, s);
      try { drawBuilding(ctx, b, false, 0, 0, null); } catch (e) { console.error('здание', type, L, e); }
      ctx.restore();
      frame(ctx, x0, top, CW, CH);
      label(ctx, x0 + CW / 2, top + CH - 1, PHASE_NAME(L), 'rgba(118,227,215,0.33)', 9);
    }
  });
}

// ---------- Юниты: строка = тип, столбец = ранг ----------
function drawUnitSheet(canvasId, faction) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const CW = 76, CH = 76, ROW_LABEL = 96, FOOT = 14;
  const width = ROW_LABEL + RANKS.length * CW;
  const height = 20 + UNIT_ORDER.length * (CH + FOOT);
  const { ctx } = setup(canvas, width, height);

  label(ctx, ROW_LABEL / 2, 4, 'ранг →', 'rgba(118,227,215,0.8)', 11);
  for (const r of RANKS) {
    label(ctx, ROW_LABEL + (r + 0.5) * CW, 4, String(r), r === 20 ? '#c9a7ff' : 'rgba(223,232,234,0.6)', 11);
  }

  UNIT_ORDER.forEach((type, row) => {
    const cfg = UNITS[type];
    if (!cfg) return;
    const top = 20 + row * (CH + FOOT);
    label(ctx, ROW_LABEL - 10, top + CH / 2 - 7, RU[type] || type, 'rgba(223,232,234,0.92)', 12, 'right');
    for (const rank of RANKS) {
      const x0 = ROW_LABEL + rank * CW;
      const isVehicle = !!cfg.vehicle;
      const u = {
        type, side: 'player', faction, cfg,
        x: 0, y: 0, r: isVehicle ? 13 : 10, angle: 0,
        hp: cfg.hp, maxHp: cfg.hp, cd: 0, moving: false, selected: false,
        id: row * 17 + rank, flashT: 0, carrying: 0, order: null,
      };
      ctx.save();
      ctx.translate(x0, top);
      try { drawUnit(ctx, u, CW / 2, CH / 2 + 2, rank); } catch (e) { console.error('юнит', type, rank, e); }
      ctx.restore();
      frame(ctx, x0, top, CW, CH);
      if (rank === 0 || rank === 20) {
        label(ctx, x0 + CW / 2, top + CH - 1, rank === 0 ? 'новобранец' : 'призма',
          rank === 0 ? 'rgba(223,232,234,0.3)' : 'rgba(201,167,255,0.55)', 9);
      }
    }
  });
}

function boot() {
  drawBuildingSheet('b-human', 'human');
  drawBuildingSheet('b-alien', 'alien');
  drawUnitSheet('u-human', 'human');
  drawUnitSheet('u-alien', 'alien');
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
