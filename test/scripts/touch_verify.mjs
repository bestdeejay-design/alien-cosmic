// touch_verify.mjs — сквозная приёмка хотфикса T на мобильном вьюпорте:
// (1) тап по рабочему → выделение; тап по земле → приказ, выделение живо;
// (2) двойной тап по пустому → снять выделение;
// (3) синтетический mousemove тача не двигает камеру;
// (4) тач-подсказка в панели вместо ЛКМ/ПКМ.
import { chromium } from 'playwright';

const BASE = 'http://localhost:8793';
const OUT = '/home/z/my-project/alien-cosmic/tool-results/touch';
const log = (...a) => console.log(...a);
const errors = [];

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 3,
  isMobile: true, hasTouch: true,
});
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto(BASE + '/index.html', { waitUntil: 'load' });
await page.evaluate(() => localStorage.setItem('terranrts.language', 'ru'));
await page.goto(BASE + '/index.html', { waitUntil: 'load' });
await page.waitForTimeout(800);
await page.locator('#btn-quick-primary').click();
await page.waitForTimeout(300);
await page.locator('#quick-faction-human').click();
await page.waitForTimeout(300);
await page.locator('#btn-quick-battle-start').click();
await page.waitForTimeout(1200);

// (3) старт: мышь спит, камера стоит даже с синтетикой у нижней кромки.
const drift = await page.evaluate(async () => {
  const g = window.game;
  g.sleepMouse();
  const cv = document.getElementById('game-canvas');
  let caps = null;
  try { caps = new InputDeviceCapabilities({ firesTouchEvents: true }); } catch { caps = undefined; }
  cv.dispatchEvent(new MouseEvent('mousemove', { clientX: 195, clientY: 830,
    ...(caps ? { sourceCapabilities: caps } : {}) }));
  const y0 = g.state.camera.y;
  await new Promise((r) => setTimeout(r, 2000));
  return { y0, y1: g.state.camera.y, mouse: { ...g.mouse } };
});
log('(3) дрифт:', JSON.stringify(drift), drift.y0 === drift.y1 && drift.mouse.x === -1 ? 'OK' : 'FAIL');

// (1) тап по рабочему → выделение; тап по земле → приказ.
const res = await page.evaluate(() => {
  const g = window.game;
  const w = g.state.units.find((u) => u.side === 'player' && u.type === 'worker' && !u.dead && !u.garrison);
  const s1 = g.worldToScreen(w.x, w.y);
  let spot = null;
  for (let d = 3; d < 12 && !spot; d++) {
    for (const [dx, dy] of [[d, 0], [-d, 0], [0, d], [0, -d]]) {
      const x = w.x + dx * 32, y = w.y + dy * 32;
      if (!g.state.map.crystals.some((c) => c.amount > 0 && Math.abs((c.tx + 0.5) * 32 - x) < 40 && Math.abs((c.ty + 0.5) * 32 - y) < 40) &&
          !g.state.buildings.some((b) => !b.dead && x > b.tx * 32 - 20 && x < (b.tx + b.w) * 32 + 20 && y > b.ty * 32 - 20 && y < (b.ty + b.h) * 32 + 20)) {
        spot = { x, y }; break;
      }
    }
  }
  return { s1, spot, wx: w.x, wy: w.y };
});
await page.touchscreen.tap(res.s1.x, res.s1.y);
await page.waitForTimeout(350);
const sel1 = await page.evaluate(() => window.game.state.selection.length);
const s2 = await page.evaluate((r) => window.game.worldToScreen(r.spot.x, r.spot.y), res);
await page.touchscreen.tap(s2.x, s2.y);
await page.waitForTimeout(350);
const after = await page.evaluate(() => {
  const g = window.game;
  const w = g.state.units.find((u) => u.side === 'player' && u.type === 'worker' && !u.dead && !u.garrison);
  return { sel: g.state.selection.length, order: w.order.kind };
});
log('(1) селект после тапа по юниту:', sel1, '; после тапа по земле:', JSON.stringify(after),
    sel1 === 1 && after.sel === 1 && after.order === 'move' ? 'OK' : 'FAIL');

// (2) двойной тап по пустому — снять выделение.
const s3 = await page.evaluate((r) => window.game.worldToScreen(r.spot.x + 50, r.spot.y + 40), res);
await page.touchscreen.tap(s3.x, s3.y);
await page.touchscreen.tap(s3.x + 2, s3.y + 3);
await page.waitForTimeout(300);
const sel2 = await page.evaluate(() => window.game.state.selection.length);
log('(2) после двойного тапа по пустому: sel =', sel2, sel2 === 0 ? 'OK' : 'FAIL');

// (4) тач-подсказка в пустой панели.
const hint = await page.evaluate(() => (document.getElementById('sel-info') || {}).textContent || '');
log('(4) подсказка:', hint.includes('Тап') && hint.includes('Долгое нажатие') ? 'тач-вариант OK' : 'FAIL: ' + hint.slice(0, 80));

await page.screenshot({ path: OUT + '/V_after_fix.png' });
log('ошибки страницы:', errors.length ? '' : 'нет'); errors.forEach((e) => log(' ', e));
await browser.close();
