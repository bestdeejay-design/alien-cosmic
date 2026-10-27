// verify_p2_branch.mjs — браузерная верификация П2 (пакет A, UX).
// Поток: старт миссии №0 → зум +/− → клик по КЦ (контур+HP+портрет) →
// ПКМ-точка сбора (флажок) → выход в меню. pageerrors 0.
import { chromium } from 'playwright';

const BASE = 'http://localhost:8793';
const OUT = '/home/z/my-project/alien-cosmic/tool-results';

const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1.5 });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.addInitScript(() => localStorage.setItem('terranrts.progress', '14'));
await page.goto(BASE + '/index.html', { waitUntil: 'load' });
await page.waitForTimeout(1200);

// Старт миссии №0 (поток проверен в П1)
await page.locator('#btn-season1').click();
await page.waitForTimeout(500);
await page.locator('.mission-card').first().click();
await page.waitForTimeout(500);
await page.locator('#btn-brief-go').click();
await page.waitForTimeout(1000);
console.log('started:', await page.evaluate(() => window.game.started));

// Камера на КЦ + мышь на канвас (для якоря зума)
const ccScreen = await page.evaluate(() => {
  const g = window.game;
  const cc = g.state.buildings.find((b) => b.side === 'player' && b.type === 'cc');
  g.centerCamera(cc.x, cc.y);
  const s = g.worldToScreen(cc.x, cc.y);
  const r = document.getElementById('game-canvas').getBoundingClientRect();
  return { sx: s.x + r.left, sy: s.y + r.top, rectTop: r.top };
});
await page.mouse.move(ccScreen.sx, ccScreen.sy);
await page.waitForTimeout(300);
await page.screenshot({ path: OUT + '/p2_base_z1.png' });

// Зум: + + − (якорь под курсором)
const zoomSeq = [];
for (const key of ['Equal', 'Equal', 'Minus']) {
  await page.keyboard.press(key);
  await page.waitForTimeout(250);
  zoomSeq.push(await page.evaluate(() => window.game.state.camera.z));
}
console.log('zoom-seq [1.15, 1.3225, 1.15]:', JSON.stringify(zoomSeq));
await page.screenshot({ path: OUT + '/p2_zoom_in.png' });

// Клик по КЦ → выделение, портрет, панель
await page.mouse.click(ccScreen.sx, ccScreen.sy);
await page.waitForTimeout(400);
const selInfo = await page.evaluate(() => {
  const cc = window.game.state.buildings.find((b) => b.side === 'player' && b.type === 'cc');
  const port = document.querySelector('.portrait');
  return {
    selected: !!cc.selected,
    portrait: port ? { w: port.width, h: port.height } : null,
    selName: document.querySelector('.sel-name') ? document.querySelector('.sel-name').textContent : '',
  };
});
console.log('sel-info:', JSON.stringify(selInfo));
await page.screenshot({ path: OUT + '/p2_building_selected.png' });

// ПКМ правее-ниже КЦ → флажок сбора
const rallyScreen = await page.evaluate(() => {
  const g = window.game;
  const cc = g.state.buildings.find((b) => b.side === 'player' && b.type === 'cc');
  const s = g.worldToScreen(cc.x + 5 * 32, cc.y + 3 * 32);
  const r = document.getElementById('game-canvas').getBoundingClientRect();
  return { sx: s.x + r.left, sy: s.y + r.top };
});
await page.mouse.click(rallyScreen.sx, rallyScreen.sy, { button: 'right' });
await page.waitForTimeout(300);
console.log('rally:', JSON.stringify(await page.evaluate(() => {
  const cc = window.game.state.buildings.find((b) => b.side === 'player' && b.type === 'cc');
  return cc.rally ? { x: Math.round(cc.rally.x), y: Math.round(cc.rally.y) } : null;
})));
await page.screenshot({ path: OUT + '/p2_rally_flag.png' });

// Выход в меню
await page.locator('#btn-exit').click();
await page.waitForTimeout(500);
console.log('exit:', JSON.stringify(await page.evaluate(() => ({
  visible: [...document.querySelectorAll('.overlay')].filter((o) => !o.classList.contains('hidden')).map((o) => o.id),
  started: window.game.started,
}))));

await browser.close();
if (errors.length) {
  console.log('ОШИБКИ СТРАНИЦЫ:');
  errors.forEach((e) => console.log('  ' + e));
  process.exit(1);
}
console.log('PAGEERRORS: 0');
