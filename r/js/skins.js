// ============================================================
// skins.js — ВИЗУАЛЬНАЯ ЭВОЛЮЦИЯ 20 УРОВНЕЙ (пакет Э5).
//
// Задача владельца: «смена цвета, усиление вида, знаковые цвета» — чтобы по
// одному взгляду на здание было видно, насколько оно прокачано, и чтобы
// Дом-Г2+ читался как дорогая покупка.
//
// Как это устроено: арт каждого здания нарисован кодом с собственными
// палитрами (r/js/buildings.js), поэтому мы НЕ переписываем 20 вариантов на
// каждое здание, а накладываем слой «grade trim» — цветовую фазу + детали:
//
//   Ф1 · СТАЛЬ      ур. 1–4    холодная кромка, ничего лишнего
//   Ф2 · ЗОЛОТО     ур. 5–9    латунная окантовка, растёт число пластин
//   Ф3 · ГРАФИТ     ур. 10–14  тёмный корпус, золото уходит, кромка гаснет
//   Ф4 · НЕОН       ур. 15–19  графит + светящаяся кромка, дорожки огней
//   Ф5 · ПРИЗМА     ур. 20     перелив + двойное свечение + «корона»
//
// Знаковые цвета по типам (язык цвета — один на игру):
//   стена   — серая → золотая → графит → неон   (пример владельца, буквально)
//   КЦ      — янтарь/золото → графит → неон
//   Дом     — фиолет + золото с ПЕРВОГО уровня (дорогая вещь)
//   турель  — бирюза;  казарма — сталь-синий;  завод — оранж;  лаба — фиолет;
//   бункер  — зелёный.
//
// Функция чистая: только ctx и геометрия, никакого состояния игры.
// ============================================================

export const PHASES = Object.freeze([
  { from: 1, to: 4, key: 'steel', name: 'Сталь', trim: '#9fe8de', trim2: '#5c7f86', glow: 0, plates: 0, pips: 1 },
  { from: 5, to: 9, key: 'gold', name: 'Золото', trim: '#f3c579', trim2: '#a2762f', glow: 3, plates: 1, pips: 2 },
  { from: 10, to: 14, key: 'graphite', name: 'Графит', trim: '#3a4048', trim2: '#f3c579', glow: 0, plates: 2, pips: 3 },
  { from: 15, to: 19, key: 'neon', name: 'Неон', trim: '#7df3e2', trim2: '#1b2a33', glow: 8, plates: 3, pips: 4 },
  { from: 20, to: 20, key: 'prism', name: 'Призма', trim: '#c9a7ff', trim2: '#7df3e2', glow: 12, plates: 4, pips: 5 },
]);

// Знаковый цвет типа: [фаза-акцент, «второй» акцент]
const SIGNATURE = {
  wall: { base: '#7d858e', accent: '#f3c579', neon: '#7df3e2' },
  cc: { base: '#f3c579', accent: '#f3c579', neon: '#c5fff1' },
  depot: { base: '#b48ce0', accent: '#f3c579', neon: '#e6c8ff' },
  barracks: { base: '#8fa9c8', accent: '#f3c579', neon: '#a9d8ff' },
  factory: { base: '#e8913a', accent: '#f3c579', neon: '#ffb45e' },
  lab: { base: '#9a7ce0', accent: '#7df3e2', neon: '#c9a7ff' },
  turret: { base: '#7df3e2', accent: '#f3c579', neon: '#a8fff2' },
  bunker: { base: '#7ed9ae', accent: '#f3c579', neon: '#9be29e' },
};

export function phaseOf(level) {
  const L = Math.max(1, Math.min(20, Math.floor(Number(level) || 1)));
  return PHASES.find((p) => L >= p.from && L <= p.to) || PHASES[0];
}

// Полный стиль уровня: чем красить и сколько деталей рисовать.
export function levelStyle(type, level) {
  const L = Math.max(1, Math.min(20, Math.floor(Number(level) || 1)));
  const phase = phaseOf(L);
  const sig = SIGNATURE[type] || SIGNATURE.wall;
  // Внутри фазы насыщенность растёт: 1-й уровень фазы бледнее, последний ярче.
  const span = Math.max(1, phase.to - phase.from);
  const k = (L - phase.from) / span; // 0…1
  const mix = (hex, alpha) => hexToRgba(hex, alpha);
  let trim = phase.trim;
  let trim2 = phase.trim2;
  // «Золото уходит в графит»: на фазе графита доля золота падает к концу фазы.
  if (phase.key === 'graphite') trim2 = mix('#f3c579', 0.25 + 0.55 * (1 - k));
  if (phase.key === 'prism') { trim = sig.neon; trim2 = '#f3c579'; }
  return {
    level: L,
    phase: phase.key,
    phaseName: phase.name,
    trim,
    trim2,
    accent: sig.accent,
    signature: sig.base,
    glow: phase.glow + Math.round(2 * k),
    plates: phase.plates,
    pips: phase.pips,
    alpha: 0.32 + 0.5 * k + (phase.key === 'steel' ? 0 : 0.08),
    bright: k,
  };
}

export function levelColor(type, level) {
  const st = levelStyle(type, level);
  if (st.phase === 'graphite') return '#9aa4ad';
  return st.phase === 'prism' ? '#c9a7ff' : st.trim;
}

function hexToRgba(hex, a) {
  const h = String(hex).replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
}

function rr(ctx, x, y, w, h, r) {
  const rad = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

// ------------------------------------------------------------
// Слой поверх готового арта здания. Вызывать ПОСЛЕ отрисовки корпуса,
// но ДО полосок HP/статусов (они должны быть сверху).
// px,py,w,h — экранная геометрия корпуса; t — время для анимации.
// ------------------------------------------------------------
export function drawGradeTrim(ctx, b, px, py, w, h, time) {
  if (!b || !b.done || !b.cfg) return;
  const L = Math.max(1, Math.min(20, b.level || 1));
  if (L <= 1) return; // Г1 — чистый базовый арт, без слоёв
  const st = levelStyle(b.type, L);
  const t = time || 0;
  const pad = 3;
  ctx.save();

  // 1) Кромка фазы: тонкая рамка по корпусу.
  ctx.globalAlpha = st.alpha;
  ctx.strokeStyle = st.trim;
  ctx.lineWidth = L >= 15 ? 2 : 1.4;
  if (st.glow > 0) { ctx.shadowColor = st.trim; ctx.shadowBlur = st.glow * 0.6; }
  rr(ctx, px + pad, py + pad, w - pad * 2, h - pad * 2, 7);
  ctx.stroke();
  ctx.shadowBlur = 0;

  // 2) Угловые пластины: их число = фаза (0…4). Дорогой вид = больше металла.
  const plate = Math.min(14, 6 + w * 0.03);
  for (let i = 0; i < st.plates; i++) {
    const corner = i % 4;
    const cx = px + (corner === 1 || corner === 2 ? w - plate - pad : pad);
    const cy = py + (corner >= 2 ? h - plate - pad : pad);
    ctx.globalAlpha = 0.5 + 0.25 * st.bright;
    ctx.fillStyle = st.trim2;
    rr(ctx, cx, cy, plate, plate, 2.5);
    ctx.fill();
    ctx.globalAlpha = 0.65;
    ctx.strokeStyle = st.trim;
    ctx.lineWidth = 1;
    rr(ctx, cx + 1, cy + 1, plate - 2, plate - 2, 2);
    ctx.stroke();
    // Заклёпка на пластине — «кованый» металл у высоких уровней.
    if (L >= 8) {
      ctx.globalAlpha = 0.8;
      ctx.fillStyle = '#0c1014';
      ctx.beginPath();
      ctx.arc(cx + plate / 2, cy + plate / 2, 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 3) Дорожка огней по низу (неон/призма): медленно бегущий блик.
  if (L >= 12) {
    const dots = Math.min(10, 3 + Math.floor(w / 22));
    const step = (w - pad * 2) / (dots + 1);
    for (let i = 0; i < dots; i++) {
      const phase = (t * 1.6 + i * 0.45) % (Math.PI * 2);
      const on = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(phase));
      ctx.globalAlpha = on * 0.85;
      ctx.fillStyle = st.trim;
      if (st.glow > 0) { ctx.shadowColor = st.trim; ctx.shadowBlur = 5; }
      ctx.beginPath();
      ctx.arc(px + pad + step * (i + 1), py + h - pad - 2.5, 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  // 4) Маркеры уровня: до 5 «пипсов» снизу справа (читаются даже на телефоне).
  const pipR = 1.8, gap = 5.5;
  for (let i = 0; i < st.pips; i++) {
    ctx.globalAlpha = 0.55 + 0.3 * st.bright;
    ctx.fillStyle = i === st.pips - 1 ? st.trim : st.trim2;
    ctx.beginPath();
    ctx.arc(px + w - pad - 5 - i * gap, py + h - pad - 4, pipR, 0, Math.PI * 2);
    ctx.fill();
  }

  // 5) Флагманская «корона» на 20 уровне — треугольные шипы по верхней кромке.
  if (L >= 20) {
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = st.trim;
    ctx.shadowColor = st.trim2; ctx.shadowBlur = 10;
    for (let i = 0; i < 3; i++) {
      const cx = px + w * (0.3 + i * 0.2);
      ctx.beginPath();
      ctx.moveTo(cx - 3.5, py + pad + 1);
      ctx.lineTo(cx, py - 4);
      ctx.lineTo(cx + 3.5, py + pad + 1);
      ctx.closePath();
      ctx.fill();
    }
    ctx.shadowBlur = 0;
  }

  // 6) Особый акцент Дома: он должен читаться как дорогая покупка СРАЗУ.
  if (b.type === 'depot') {
    ctx.globalAlpha = 0.75;
    ctx.strokeStyle = '#f3c579';
    ctx.lineWidth = 1.2;
    rr(ctx, px + pad + 2, py + pad + 2, w - (pad + 2) * 2, h - (pad + 2) * 2, 5);
    ctx.stroke();
    // «Замок» трюма: маленький ромб по центру верха.
    const dx = px + w / 2, dy = py + pad + 4;
    ctx.fillStyle = '#f3c579';
    ctx.beginPath();
    ctx.moveTo(dx, dy - 3.2); ctx.lineTo(dx + 3.2, dy);
    ctx.lineTo(dx, dy + 3.2); ctx.lineTo(dx - 3.2, dy);
    ctx.closePath(); ctx.fill();
  }

  ctx.restore();
}

// ------------------------------------------------------------
// Шевроны ранга для юнитов (ранг = изученные технологии, 0…20).
// Рисуются над корпусом: 1 шеврон = ранг 1–4, 2 = 5–9, 3 = 10–14,
// 4 = 15–19, «звезда» = 20.
// ------------------------------------------------------------
export function drawRankMark(ctx, x, y, rank, color) {
  const r = Math.max(0, Math.min(20, Math.floor(Number(rank) || 0)));
  if (!r) return;
  const groups = r >= 20 ? 4 : r >= 15 ? 4 : r >= 10 ? 3 : r >= 5 ? 2 : 1;
  const star = r >= 20;
  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = color || '#f3c579';
  ctx.lineWidth = 1.3;
  for (let i = 0; i < groups; i++) {
    const yy = y - i * 3;
    ctx.beginPath();
    ctx.moveTo(x - 3, yy + 1.6);
    ctx.lineTo(x, yy - 0.6);
    ctx.lineTo(x + 3, yy + 1.6);
    ctx.stroke();
  }
  if (star) {
    ctx.fillStyle = color || '#f3c579';
    ctx.beginPath();
    ctx.arc(x, y + 4.5, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
