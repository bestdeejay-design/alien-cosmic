// ============================================================
// repro_stuck.mjs — регрессия застреваний Alien Cosmic.
// Требования: playwright (`npm i playwright` + `npx playwright install
// chromium`) и локальный сервер с игрой. По умолчанию ожидает
// http://localhost:8079/index.html — переопредели переменной GAME_URL.
//
//   T1. Здание на маршруте: юнит идёт через карту, на пути ставят
//       депо — юнит обязан перестроить путь и дойти до цели.
//   T2. Стройка на юнитах: здание ставят прямо на стоящих рабочих —
//       через 3 c все обязаны быть снаружи корпусов (выселение).
//   T3. Толпа: группа идёт через карту — ни один не «замирает
//       навсегда»: у всех прогресс к цели.
//   T4. Юнит внутри корпуса (наследие старого бага): выталкивание
//       за 1 c возвращает его на свободную клетку.
//
// Запуск: GAME_URL=http://localhost:8079/index.html node scripts/repro_stuck.mjs
// ============================================================
import { chromium } from 'playwright';

const URL = process.env.GAME_URL || 'http://localhost:8079/index.html';
const results = [];
const errors = [];
function record(stage, ok, detail) {
  results.push({ stage, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${stage} — ${detail}`);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.goto(URL, { waitUntil: 'load' });
await page.waitForTimeout(500);
await page.click('#btn-start');
await page.waitForTimeout(900);

// ---------- T1. Здание на маршруте ----------
const t1 = await page.evaluate(async () => {
  const st = window.game.state;
  const TILE = 32, MAP_W = 64;
  const explore = (tx, ty) => {
    if (tx >= 0 && ty >= 0 && tx < MAP_W && ty < MAP_W) st.fog.explored[ty * MAP_W + tx] = 1;
  };
  const w = st.units.find((u) => u.side === 'player' && u.type === 'worker' && !u.garrison);
  st.selection = [w];
  window.game.hooks.stopSelected();
  const start = { x: w.x, y: w.y };
  const stx = (start.x / TILE) | 0, sty = (start.y / TILE) | 0;
  const cx = (st.map.bases.player.center.x < 32) ? 32 : 30;
  const cy = (st.map.bases.player.center.y < 32) ? 32 : 30;
  // Коридор: направление со свободными тайлами на 2..13 (с допуском ±1).
  const corridorFree = (dx, dy) => {
    for (let d = 2; d <= 13; d++) {
      const tx = stx + dx * d, ty = sty + dy * d;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        if (st.map.blockedAt(tx + ox, ty + oy)) return false;
      }
    }
    return true;
  };
  const DIRS = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
  let dir = null;
  for (const [dx, dy] of DIRS) {
    const away = (stx + dx * 8 - cx) * dx + (sty + dy * 8 - cy) * dy; // от центра
    if (corridorFree(dx, dy) && away > 0) { dir = [dx, dy]; break; }
  }
  if (!dir) for (const [dx, dy] of DIRS) if (corridorFree(dx, dy)) { dir = [dx, dy]; break; }
  if (!dir) return { ok: false, why: 'нет свободного коридора', placed: 0 };
  const gx = stx + dir[0] * 12, gy = sty + dir[1] * 12;
  const goal = { x: (gx + 0.5) * TILE, y: (gy + 0.5) * TILE };
  // Разведаем весь коридор (чтобы плейс депо был разрешён).
  for (let d = 0; d <= 14; d++) {
    for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) {
      explore(stx + dir[0] * d + ox, sty + dir[1] * d + oy);
    }
  }
  st.fog.dirty = true;
  st.minerals.player += 500;
  st.selection = [w];
  window.game.hooks.issueRMB(goal.x, goal.y);
  await new Promise((r) => setTimeout(r, 900));
  const u2 = st.units.find((u) => u.id === w.id);
  // Строитель — другой рабочий: tryPlace берёт строителей из выделения,
  // а путешественник обязан сохранить приказ «идти к цели».
  const other = st.units.find((u) => u.side === 'player' && u.type === 'worker' &&
    !u.garrison && u.id !== w.id);
  st.selection = other ? [other] : [];
  // Ставим депо прямо на маршрут в 4 и 6 тайлах впереди.
  let placed = 0;
  for (const ahead of [4, 6]) {
    const tx = stx + dir[0] * ahead, ty = sty + dir[1] * ahead;
    const spotFree = (x, y) => {
      for (let j = y; j < y + 2; j++) for (let i = x; i < x + 2; i++) {
        if (st.map.blockedAt(i, j)) return false;
      }
      return true;
    };
    for (const off of [[0, 0], [dir[1], dir[0]], [-dir[1], -dir[0]]]) {
      if (spotFree(tx - 1 + off[0], ty - 1 + off[1])) {
        window.game.hooks.beginPlace('depot');
        window.game.hooks.tryPlace(tx - 1 + off[0], ty - 1 + off[1]);
        const cnt = st.buildings.filter((b) => b.side === 'player' && b.type === 'depot').length;
        if (cnt > placed) { placed = cnt; break; }
      }
    }
  }
  const deadline = performance.now() + 28000;
  let arrived = false, stuck = false;
  let bestD = Math.hypot(goal.x - u2.x, goal.y - u2.y), sinceBest = 0;
  while (performance.now() < deadline) {
    const u = st.units.find((x) => x.id === w.id);
    if (!u || u.dead) { stuck = true; break; }
    const d = Math.hypot(goal.x - u.x, goal.y - u.y);
    if (d <= TILE * 1.6) { arrived = true; break; }
    if (d < bestD - 1) { bestD = d; sinceBest = 0; } else sinceBest += 0.25;
    if (sinceBest > 12) { stuck = true; break; } // 12 c без нового лучшего приближения
    await new Promise((r) => setTimeout(r, 250));
  }
  return { ok: arrived && !stuck, arrived, stuck, placed: Math.max(0, placed) };
});
record('T1. здание на маршруте — дошёл с перестроением пути', t1.ok,
  `arrived=${t1.arrived}, stuck=${t1.stuck}, депо на пути=${t1.placed}`);

// ---------- T2. Стройка на юнитах ----------
const t2 = await page.evaluate(async () => {
  const st = window.game.state;
  const TILE = 32;
  const workers = st.units.filter((u) => u.side === 'player' && u.type === 'worker' && !u.garrison).slice(0, 3);
  if (workers.length < 2) return { ok: false, why: 'мало рабочих' };
  // Ищем свободный 2×2 под депо в стороне от базы.
  const spotFree = (x, y) => {
    for (let j = y; j < y + 2; j++) for (let i = x; i < x + 2; i++) {
      if (st.map.blockedAt(i, j) || !st.fog.tileExplored(i, j)) return false;
    }
    return true;
  };
  let spot = null;
  const bx = st.map.bases.player.center.x, by = st.map.bases.player.center.y;
  outer:
  for (let r = 4; r < 20; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const x = bx + dx, y = by + dy;
      if (x > 1 && y > 1 && x < 61 && y < 61 && spotFree(x, y)) { spot = { x, y }; break outer; }
    }
  }
  if (!spot) return { ok: false, why: 'нет места под депо' };
  // Разведаем площадку, иначе плейс запрещён.
  for (let j = spot.y - 1; j <= spot.y + 2; j++)
    for (let i = spot.x - 1; i <= spot.x + 2; i++) st.fog.explored[j * 64 + i] = 1;
  st.fog.dirty = true;
  // Ставим рабочих прямо в центр будущей площадки (симуляция «здание на юнитах»).
  const ccx = (spot.x + 1) * TILE, ccy = (spot.y + 1) * TILE;
  for (let i = 0; i < workers.length; i++) {
    workers[i].x = ccx + i * 4 - 4; workers[i].y = ccy;
    workers[i].prevX = workers[i].x; workers[i].prevY = workers[i].y;
  }
  st.selection = [];
  // Строитель — рабочий НЕ с площадки (плейс требует выделенного рабочего).
  const builder = st.units.find((u) => u.side === 'player' && u.type === 'worker' &&
    !u.garrison && !workers.includes(u));
  if (builder) {
    window.game.hooks.stopSelected();
    st.selection = [builder];
  }
  window.game.hooks.beginPlace('depot');
  window.game.hooks.tryPlace(spot.x, spot.y);
  const depotNew = st.buildings.filter((b) => b.side === 'player' && b.type === 'depot').pop();
  if (!depotNew || depotNew.tx !== spot.x) {
    const toasts = [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' | ');
    return { ok: false, why: 'плейс не прошёл: ' + (toasts || '?') };
  }
  // Через 3 c все трое обязаны быть снаружи всех зданий и живы.
  await new Promise((r) => setTimeout(r, 3000));
  const inside = (u) => st.buildings.some((b) => {
    if (b.dead) return false;
    return u.x > b.tx * TILE - 1 && u.x < (b.tx + b.w) * TILE + 1 &&
           u.y > b.ty * TILE - 1 && u.y < (b.ty + b.h) * TILE + 1;
  });
  const res = workers.map((w0) => {
    const u = st.units.find((x) => x.id === w0.id);
    return { alive: u && !u.dead, outside: u ? !inside(u) : false };
  });
  return { ok: res.every((r2) => r2.alive && r2.outside), res };
});
record('T2. стройка на юнитах — все выселены и живы', t2.ok,
  t2.why || t2.res.map((r) => `${r.alive ? 'жив' : 'погиб'}/${r.outside ? 'снаружи' : 'ВНУТРИ!'}`).join(', '));

// ---------- T3. Толпа через карту ----------
const t3 = await page.evaluate(async () => {
  const st = window.game.state;
  const TILE = 32;
  // Досыпаем рабочих мгновенно (через очередь КЦ с нулевым временем).
  const cc = st.buildings.find((b) => b.side === 'player' && b.type === 'cc' && b.done);
  for (let i = 0; i < 5; i++) {
    window.game.hooks.train(cc, 'worker');
    cc.queue[cc.queue.length - 1].t = 0.05;
  }
  await new Promise((r) => setTimeout(r, 1500));
  const group = st.units.filter((u) => u.side === 'player' && u.type === 'worker' && !u.garrison).slice(0, 8);
  st.selection = group;
  // Цель — противоположный угол базы (13+ тайлов пути).
  const bx = st.map.bases.player.center.x, by = st.map.bases.player.center.y;
  const gx = bx < 32 ? (bx + 15) : (bx - 15);
  const gy = by < 32 ? (by + 15) : (by - 15);
  const goal = { x: (gx + 0.5) * TILE, y: (gy + 0.5) * TILE };
  window.game.hooks.issueRMB(goal.x, goal.y);
  const startD = new Map(group.map((u) => [u.id, Math.hypot(goal.x - u.x, goal.y - u.y)]));
  const deadline = performance.now() + 30000;
  let worst = 0; // худшая доля пройденного пути 0..1
  while (performance.now() < deadline) {
    let done = 0;
    for (const u0 of group) {
      const u = st.units.find((x) => x.id === u0.id);
      if (!u || u.dead) { done++; continue; }
      const d0 = startD.get(u.id);
      const d = Math.hypot(goal.x - u.x, goal.y - u.y);
      const progress = 1 - d / (d0 || 1);
      if (progress > worst) worst = progress;
      if (d <= TILE * 2) done++;
    }
    if (done >= group.length - 1) break;
    await new Promise((r) => setTimeout(r, 300));
  }
  return { ok: worst > 0.85, worst: Math.round(worst * 100), n: group.length };
});
record('T3. толпа через карту — общий прогресс', t3.ok,
  `худший прогресс ${t3.worst}% из ${t3.n} юнитов`);

// ---------- T4. Юнит внутри корпуса ----------
const t4 = await page.evaluate(async () => {
  const st = window.game.state;
  const TILE = 32;
  const cc = st.buildings.find((b) => b.side === 'player' && b.type === 'cc' && b.done);
  const w = st.units.find((u) => u.side === 'player' && u.type === 'worker' && !u.garrison);
  if (!cc || !w) return { ok: false };
  w.x = cc.x; w.y = cc.y; w.prevX = w.x; w.prevY = w.y;
  await new Promise((r) => setTimeout(r, 1000));
  const u = st.units.find((x) => x.id === w.id);
  const outside = !(u.x > cc.tx * TILE && u.x < (cc.tx + cc.w) * TILE &&
                    u.y > cc.ty * TILE && u.y < (cc.ty + cc.h) * TILE);
  const free = !st.map.blockedAt((u.x / TILE) | 0, (u.y / TILE) | 0);
  return { ok: u && !u.dead && outside && free, outside, free };
});
record('T4. юнит внутри корпуса — вытолкнут на свободную клетку', t4.ok,
  `снаружи=${t4.outside}, клетка свободна=${t4.free}`);

await browser.close();
const fails = results.filter((r) => !r.ok).length;
console.log(`\nИТОГ: ${results.length - fails}/${results.length} PASS`);
if (errors.length) { console.log('Ошибки страницы:'); errors.forEach((e) => console.log('  ' + e)); }
process.exit(fails || errors.length ? 1 : 0);
