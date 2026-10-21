// touch_probe2.mjs — зондирование панели и миникарты на мобильном вьюпорте:
// (а) реальные размеры #minimap-box/#minimap и bitmap;
// (б) панель при выделении рабочего / КЦ / вражеского юнита;
// (в) меню стройки;
// (г) следы «недогруженных элементов» (пустые блоки, обрезка).
import { chromium } from 'playwright';

const BASE = 'http://localhost:8793';
const OUT = '/home/z/my-project/alien-cosmic/tool-results/touch';
const log = (...a) => console.log(...a);

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 3,
  isMobile: true, hasTouch: true,
});
const page = await ctx.newPage();
const errors = [];
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

const dumpPanel = () => page.evaluate(() => {
  const r = (id) => {
    const e = document.getElementById(id);
    if (!e) return null;
    const b = e.getBoundingClientRect();
    return { w: +b.width.toFixed(0), h: +b.height.toFixed(0), x: +b.x.toFixed(0), y: +b.y.toFixed(0),
             styleW: e.style.width || '-', styleH: e.style.height || '-',
             bm: e.tagName === 'CANVAS' ? e.width + 'x' + e.height : undefined };
  };
  return {
    vp: { w: window.innerWidth, h: window.innerHeight },
    panel: r('bottom-panel'), mmBox: r('minimap-box'), mm: r('minimap'),
    selInfo: r('sel-info'), cmdGrid: r('cmd-grid'), cmdTip: r('cmd-tip'),
    uiBottom: window.game.uiBottom, uiTop: window.game.uiTop,
  };
});

log('--- пустая панель ---');
log(JSON.stringify(await dumpPanel(), null, 1));

// Выделяем рабочего тапом.
const pick = async (side, type) => page.evaluate((args) => {
  const g = window.game;
  const u = g.state.units.find((u) => u.side === args.side && (!args.type || u.type === args.type) && !u.dead && !u.garrison);
  if (!u) return null;
  const s = g.worldToScreen(u.x, u.y);
  return { sx: s.x, sy: s.y };
}, { side, type });

let p = await pick('player', 'worker');
await page.touchscreen.tap(p.sx, p.sy);
await page.waitForTimeout(400);
log('--- выбран рабочий ---');
log(JSON.stringify(await dumpPanel(), null, 1));
await page.screenshot({ path: OUT + '/P_worker.png' });

// КЦ.
const cc = await page.evaluate(() => {
  const g = window.game;
  const b = g.state.buildings.find((b) => b.side === 'player' && !b.dead);
  const s = g.worldToScreen(b.x * 32 + b.w * 16, b.y * 32 + b.h * 16);
  return { sx: s.x, sy: s.y };
});
await page.touchscreen.tap(cc.sx, cc.sy);
await page.waitForTimeout(400);
log('--- выбран КЦ ---');
log(JSON.stringify(await dumpPanel(), null, 1));
await page.screenshot({ path: OUT + '/P_cc.png' });

// Враг (если есть на экране — перемотаем камеру к вражеской базе).
await page.evaluate(() => {
  const g = window.game;
  const e = g.state.map.bases.enemy.cc;
  g.centerCamera((e.x + 2) * 32, (e.y + 2) * 32);
});
await page.waitForTimeout(300);
const en = await pick('enemy', null);
if (en) {
  await page.touchscreen.tap(en.sx, en.sy);
  await page.waitForTimeout(300);
  log('--- выбран враг ---');
  await page.screenshot({ path: OUT + '/P_enemy.png' });
}

// Меню стройки (рабочий + кнопка build).
p = await pick('player', 'worker');
await page.touchscreen.tap(p.sx, p.sy);
await page.waitForTimeout(300);
await page.evaluate(() => {
  const g = window.game;
  const btn = document.querySelector('#cmd-grid button[data-cmd="build"], #cmd-grid .cmd-build');
  if (btn) btn.click();
});
await page.waitForTimeout(400);
log('--- меню стройки ---');
log(JSON.stringify(await dumpPanel(), null, 1));
await page.screenshot({ path: OUT + '/P_build.png' });

log('--- ОШИБКИ:', errors.length ? '' : 'нет'); errors.forEach((e) => log(' ', e));
await browser.close();
