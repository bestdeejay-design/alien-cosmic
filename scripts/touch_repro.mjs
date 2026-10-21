// touch_repro.mjs — воспроизведение мобильных багов владельца:
// (1) тап = сброс выделения, приказ не отдаётся;
// (2) камера уезжает вниз при старте;
// (3) не все элементы юнитов/строений прогружаются.
// Эмуляция: 390x844, isMobile+hasTouch (совместимые mouse-события как на телефоне).
import { chromium } from 'playwright';

const BASE = 'http://localhost:8793';
const OUT = '/home/z/my-project/alien-cosmic/tool-results/touch';
const errors = [];
const log = (...a) => console.log(...a);

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 3,
  isMobile: true, hasTouch: true,
});
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto(BASE + '/index.html', { waitUntil: 'load' });
await page.waitForTimeout(900);
await page.locator('#btn-quick-primary').click();
await page.waitForTimeout(350);
await page.locator('#quick-faction-human').click();
await page.waitForTimeout(350);
await page.locator('#btn-quick-battle-start').click();
await page.waitForTimeout(1200);

// Сэмплер камеры.
const cam = () => page.evaluate(() => {
  const g = window.game;
  return { x: +g.state.camera.x.toFixed(1), y: +g.state.camera.y.toFixed(1), z: g.state.camera.z,
           mouse: { ...g.mouse }, overUI: !!g.overUI, edgeT: +(g.edgeT || 0).toFixed(2),
           edgeZone: g.edgeZone || null };
});

log('--- ЭТАП A: камера без касаний (4 c) ---');
for (let i = 0; i < 8; i++) { log(`t=${(i * 0.5).toFixed(1)}`, JSON.stringify(await cam())); await page.waitForTimeout(500); }
await page.screenshot({ path: OUT + '/A_start.png' });

log('--- ЭТАП B: тап в центр канваса (выделение рабочего) ---');
// Ищем своего рабочего и его экранные координаты.
const wpos = await page.evaluate(() => {
  const g = window.game;
  const w = g.state.units.find((u) => u.side === 'player' && u.type === 'worker' && !u.dead && !u.garrison);
  if (!w) return null;
  const s = g.worldToScreen(w.x, w.y);
  return { sx: s.x, sy: s.y, wx: w.x, wy: w.y };
});
log('worker screen:', JSON.stringify(wpos));
if (wpos) {
  await page.touchscreen.tap(wpos.sx, wpos.sy);
  await page.waitForTimeout(400);
  log('after tap worker:', JSON.stringify(await page.evaluate(() => ({
    sel: window.game.state.selection.length, kind: window.game.state.selection[0] ? window.game.state.selection[0].type : null }))));
  // Камера после тапа (компат-mousemove устанавливает game.mouse?).
  for (let i = 0; i < 6; i++) { log(`t+${(i * 0.5).toFixed(1)}`, JSON.stringify(await cam())); await page.waitForTimeout(500); }
}

log('--- ЭТАП C: тап по пустой земле при выделении (баг 1?) ---');
const res = await page.evaluate(() => {
  const g = window.game;
  const s = g.worldToScreen(g.state.camera.x + 120, g.state.camera.y + 120);
  return { sx: s.x, sy: s.y };
});
await page.touchscreen.tap(res.sx, res.sy);
await page.waitForTimeout(400);
log('after tap ground:', JSON.stringify(await page.evaluate(() => ({
  sel: window.game.state.selection.length }))), '(ожидание игрока: приказ > 0 юнитов, факт: ?)');

log('--- ЭТАП D: тап у нижней кромки игровой зоны (баг 2?) ---');
const bot = await page.evaluate(() => ({ x: window.innerWidth / 2, y: window.innerHeight - (window.game.uiBottom || 0) - 12 }));
await page.touchscreen.tap(bot.x, bot.y);
await page.waitForTimeout(300);
for (let i = 0; i < 8; i++) { log(`t+${(i * 0.5).toFixed(1)}`, JSON.stringify(await cam())); await page.waitForTimeout(500); }

log('--- ЭТАП E: элементы юнитов/строений (баг 3) ---');
await page.evaluate(() => { window.game.setZoom(2.0); });
await page.waitForTimeout(600);
await page.screenshot({ path: OUT + '/E_zoom2.png' });
const drawProbe = await page.evaluate(() => {
  const g = window.game, st = g.state;
  const stVisible = st.units.filter((u) => !u.dead && u.x > st.camera.x && u.x < st.camera.x + g.viewW() && u.y > st.camera.y && u.y < st.camera.y + g.viewH());
  return { unitsOnScreen: stVisible.length, total: st.units.length, bld: st.buildings.length,
           fogDone: !!st.fog };
});
log('drawProbe:', JSON.stringify(drawProbe));
await page.evaluate(() => { window.game.setZoom(0.5); window.game.centerCamera(
  (window.game.state.map.bases.player.cc.x + 2) * 32, (window.game.state.map.bases.player.cc.y + 2) * 32); });
await page.waitForTimeout(600);
await page.screenshot({ path: OUT + '/E_zoom05.png' });

log('--- ОШИБКИ СТРАНИЦЫ:', errors.length ? '' : 'нет');
for (const e of errors) log('  ', e);
await browser.close();
