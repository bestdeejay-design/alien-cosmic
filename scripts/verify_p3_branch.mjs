// verify_p3_branch.mjs — браузерная верификация П3 (пакет B.7, стройка).
// Зум 0.6 + высокий вьюпорт: вся карта видна, камера не упирается в клампы.
// T1 серии (2 казармы, placing жив) → T2 ЛКМ-драг линии стен (превью+цена,
// round-robin) → T3 бюджетный кламп (100 → 3 секции) → T4 клавиатура
// (стрелки + Enter). pageerrors 0.
import { chromium } from 'playwright';

const BASE = 'http://localhost:8793';
const OUT = '/home/z/my-project/alien-cosmic/tool-results';

const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1500 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.addInitScript(() => localStorage.setItem('terranrts.progress', '14'));
await page.goto(BASE + '/index.html', { waitUntil: 'load' });
await page.waitForTimeout(1200);
await page.locator('#btn-campaign').click();
await page.waitForTimeout(400);
await page.locator('.mission-card').first().click();
await page.waitForTimeout(400);
await page.locator('#btn-brief-go').click();
await page.waitForTimeout(1000);
console.log('started:', await page.evaluate(() => window.game.started));

// --- окружение: зум 0.6 (карта целиком), полосы свободных тайлов ---
const env = await page.evaluate(() => {
  const g = window.game, st = g.state, T = 32, MW = 64;
  st.camera.z = 0.6; g.clampCam();
  st.minerals.player = 2000;
  const cc = st.buildings.find((b) => b.side === 'player' && b.type === 'cc');
  const free = (x, y) => {
    if (x < 0 || y < 0 || x >= MW || y >= MW) return false;
    const i = st.map.idx ? st.map.idx(x, y) : y * MW + x;
    return st.map.terrain[i] === 0 && !st.map.mineralGrid[i] && !st.map.buildingGrid[i] &&
      st.fog.tileExplored(x, y);
  };
  const strip = (y, n) => {
    for (let x0 = 2; x0 + n <= MW - 2; x0++) {
      let ok = true;
      for (let x = x0; x < x0 + n; x++) if (!free(x, y)) { ok = false; x0 = x; break; }
      if (ok) return { y, x0 };
    }
    return null;
  };
  const rows = [];
  const need = [12, 12, 8, 4];
  for (let dy = -10; dy <= 13 && rows.length < 4; dy++) {
    const y = Math.round(cc.y / T) + dy;
    if (y < 2 || y > 61) continue;
    const s = strip(y, need[rows.length]);
    if (s && !rows.some((r) => Math.abs(r.y - y) < 2)) rows.push(s);
  }
  // два места под казармы 3×2 на первой полосе (с зазором)
  const b2 = [];
  if (rows.length) {
    const y = rows[0].y;
    for (let x = rows[0].x0; x < rows[0].x0 + 12 && b2.length < 2; x++) {
      let ok = true;
      for (let dx = 0; dx < 3 && ok; dx++) if (!free(x + dx, y) || !free(x + dx, y + 1)) ok = false;
      if (ok) { b2.push(x); x += 3; }
    }
  }
  const workers = st.units.filter((u) => !u.dead && u.side === 'player' && u.cfg.canBuild);
  return { rows, b2, workers: workers.length };
});
console.log('env:', JSON.stringify(env));
if (env.rows.length < 4 || env.b2.length < 2) { console.log('FAIL: мало свободных полос/мест'); process.exit(1); }

const toScr = (tx, ty) => page.evaluate(({ tx, ty }) => {
  const g = window.game;
  const s = g.worldToScreen(tx * 32 + 16, ty * 32 + 16);
  const r = document.getElementById('game-canvas').getBoundingClientRect();
  return { sx: s.x + r.left, sy: s.y + r.top };
}, { tx, ty });

// --- выделить всех рабочих-строителей ---
await page.evaluate(() => {
  const st = window.game.state;
  st.selection = st.units.filter((u) => !u.dead && u.side === 'player' && u.cfg.canBuild);
});

// --- T1: серии — две казармы подряд, placing жив; бригада перераспределяется ---
const rA = env.rows[0];
await page.evaluate(({ tx, ty }) => { window.game.centerCamera(tx * 32, ty * 32); window.game.clampCam(); }, { tx: rA.x0 + 6, ty: rA.y });
await page.evaluate(() => { window.game.state.placing = { type: 'barracks', tx: -1000, ty: -1000 }; });
const a1 = await toScr(env.b2[0] + 1, rA.y);
await page.mouse.move(a1.sx, a1.sy);
await page.waitForTimeout(150);
await page.mouse.click(a1.sx, a1.sy);
await page.waitForTimeout(400);
const t1a = await page.evaluate(() => {
  const st = window.game.state;
  const rax = st.buildings.filter((x) => x.type === 'barracks' && !x.dead);
  window.__site = rax[rax.length - 1] || null;
  const crew = window.__site
    ? st.units.filter((u) => !u.dead && u.order && u.order.kind === 'build' && u.order.target === window.__site).length
    : -1;
  return { placing: !!st.placing, n: rax.length, crew };
});
const a2 = await toScr(env.b2[1] + 1, rA.y);
await page.mouse.move(a2.sx, a2.sy);
await page.waitForTimeout(150);
await page.mouse.click(a2.sx, a2.sy);
await page.waitForTimeout(400);
const t1b = await page.evaluate(() => {
  const st = window.game.state;
  const rax = st.buildings.filter((x) => x.type === 'barracks' && !x.dead);
  const site2 = rax[rax.length - 1] || null;
  const cnt = (s) => s ? st.units.filter((u) => !u.dead && u.order && u.order.kind === 'build' && u.order.target === s).length : -1;
  return { placing: !!st.placing, n: rax.length, crew2: cnt(site2), crew1: cnt(window.__site) };
});
console.log('T1 serial: ' + JSON.stringify(t1a) + ' → ' + JSON.stringify(t1b) + ' (рабочих ' + env.workers + ')');
await page.screenshot({ path: OUT + '/p3_serial.png' });
await page.mouse.click(a2.sx, a2.sy, { button: 'right' }); // выход из серии
await page.waitForTimeout(200);

// --- T2: ЛКМ-драг линии стен: превью + цена, коммит round-robin ---
const rB = env.rows[1];
await page.evaluate(({ tx, ty }) => { window.game.centerCamera(tx * 32, ty * 32); window.game.clampCam(); }, { tx: rB.x0 + 5, ty: rB.y });
await page.evaluate(() => { window.game.state.minerals.player = 2000; window.game.state.placing = { type: 'wall', tx: -1000, ty: -1000 }; });
const b1 = await toScr(rB.x0, rB.y);
await page.mouse.move(b1.sx, b1.sy);
await page.waitForTimeout(150);
await page.mouse.down();
await page.waitForTimeout(100);
const downDiag = await page.evaluate(({ sx, sy }) => ({
  drag: !!window.game.state.wallDrag,
  el: (document.elementFromPoint(sx, sy) || {}).id || (document.elementFromPoint(sx, sy) || {}).tagName,
}), b1);
for (let i = 1; i <= 10; i++) {
  const p = await toScr(rB.x0 + i, rB.y);
  await page.mouse.move(p.sx, p.sy);
}
await page.waitForTimeout(200);
const prev = await page.evaluate(() => {
  const g = window.game, st = g.state;
  if (!st.wallDrag) return { drag: false, tiles: -1, skipped: -1 };
  return { drag: true, tiles: g.wallLineTiles().tiles.length, skipped: g.wallLineTiles().skipped };
});
await page.screenshot({ path: OUT + '/p3_wall_preview.png' });
await page.mouse.up();
await page.waitForTimeout(400);
const t2 = await page.evaluate(() => {
  const st = window.game.state;
  const walls = st.buildings.filter((x) => x.type === 'wall' && !x.dead);
  const cnt = (bb) => st.units.filter((u) => !u.dead && u.order && u.order.kind === 'build' && u.order.target === bb).length;
  return { walls: walls.length, withCrew: walls.filter((w) => cnt(w) > 0).length,
    maxCrew: Math.max(0, ...walls.map(cnt)), drag: !!st.wallDrag, min: st.minerals.player,
    placing: !!st.placing };
});
console.log('T2 line: down=' + JSON.stringify(downDiag) + ' превью=' + JSON.stringify(prev) + ' | коммит=' + JSON.stringify(t2));
await page.screenshot({ path: OUT + '/p3_wall_line.png' });
await page.mouse.click(b1.sx, b1.sy, { button: 'right' });
await page.waitForTimeout(200);

// --- T3: бюджетный кламп: 100 минералов, драг на 8 → 3 секции ---
const rC = env.rows[2];
await page.evaluate(({ tx, ty }) => { window.game.centerCamera(tx * 32, ty * 32); window.game.clampCam(); }, { tx: rC.x0 + 4, ty: rC.y });
// рабочих — в дальний угол ДО входа в placing (иначе RMB отменит режим)
const walk = await toScr(rC.x0 + 4, rC.y);
await page.mouse.click(walk.sx, walk.sy, { button: 'right' });
await page.waitForTimeout(200);
await page.evaluate(() => {
  const st = window.game.state;
  st.minerals.player = 100;
  st.placing = { type: 'wall', tx: -1000, ty: -1000 };
});
const c1 = await toScr(rC.x0, rC.y);
await page.mouse.move(c1.sx, c1.sy);
await page.waitForTimeout(150);
await page.mouse.down();
for (let i = 1; i <= 7; i++) {
  const p = await toScr(rC.x0 + i, rC.y);
  await page.mouse.move(p.sx, p.sy);
}
await page.mouse.up();
await page.waitForTimeout(400);
const t3 = await page.evaluate(() => {
  const st = window.game.state;
  return { min: st.minerals.player, placing: !!st.placing };
});
console.log('T3 clamp: ' + JSON.stringify(t3) + ' (ожидалось min=10, placing=true)');
await page.mouse.click(c1.sx, c1.sy, { button: 'right' });
await page.waitForTimeout(200);

// --- T4: клавиатура — стрелки двигают призрак, Enter ставит, серия жива ---
const rD = env.rows[3];
await page.evaluate(({ tx, ty }) => { window.game.centerCamera(tx * 32, ty * 32); window.game.clampCam(); }, { tx: rD.x0 + 5, ty: rD.y });
await page.evaluate(() => {
  const st = window.game.state;
  st.minerals.player = 500;
  st.placing = { type: 'wall', tx: -1000, ty: -1000 };
});
const d1 = await toScr(rD.x0 + 2, rD.y);
await page.mouse.move(d1.sx, d1.sy);
await page.waitForTimeout(150);
const ghost0 = await page.evaluate(() => {
  const p = window.game.state.placing;
  return { tx: p.tx, ty: p.ty };
});
for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
await page.waitForTimeout(150);
await page.keyboard.press('Enter');
await page.waitForTimeout(400);
const t4 = await page.evaluate((g0) => {
  const st = window.game.state;
  const walls = st.buildings.filter((x) => x.type === 'wall' && !x.dead)
    .map((x) => ({ tx: x.tx, ty: x.ty }));
  const at = walls.some((w) => w.tx === g0.tx + 3 && w.ty === g0.ty);
  return { at, placing: !!st.placing,
    placingPos: st.placing ? { tx: st.placing.tx, ty: st.placing.ty } : null,
    ghost: g0, walls, sel: st.selection.length, min: st.minerals.player };
}, ghost0);
console.log('T4 keyboard: призрак(' + ghost0.tx + ',' + ghost0.ty + ') +3 → ' + JSON.stringify(t4));
await page.screenshot({ path: OUT + '/p3_keyboard.png' });
await page.keyboard.press('Escape');
await page.waitForTimeout(200);

await browser.close();
const okT1 = t1a.placing && t1a.n === 1 && t1a.crew === env.workers &&
  t1b.placing && t1b.n === 2 && t1b.crew2 === env.workers;
const okT2 = downDiag.drag && prev.drag && prev.tiles === 11 && t2.walls === 11 &&
  t2.withCrew === env.workers && t2.maxCrew <= 5 && !t2.drag && t2.min === 1670;
const okT3 = t3.min === 10 && t3.placing;
const okT4 = t4.at && t4.placing;
console.log('ИТОГ: T1=' + okT1 + ' T2=' + okT2 + ' T3=' + okT3 + ' T4=' + okT4);
if (errors.length) {
  console.log('ОШИБКИ СТРАНИЦЫ:');
  errors.forEach((e) => console.log('  ' + e));
  process.exit(1);
}
if (!(okT1 && okT2 && okT3 && okT4)) process.exit(1);
console.log('PAGEERRORS: 0');
