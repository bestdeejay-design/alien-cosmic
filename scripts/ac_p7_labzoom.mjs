// ac_p7_labzoom.mjs — точный кадр лабы врага №14 (иконки закрытых tech).
import { chromium } from 'playwright';
const BASE = 'http://localhost:8793';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1500 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript(() => localStorage.setItem('terranrts.progress', '14'));
await page.goto(BASE + '/index.html', { waitUntil: 'load' });
await page.waitForTimeout(900);
await page.locator('#btn-campaign').click();
await page.waitForTimeout(350);
await page.locator('.mission-card').nth(14).click();
await page.waitForTimeout(350);
await page.locator('#btn-brief-go').click();
await page.waitForTimeout(1400);
const info = await page.evaluate(async () => {
  const B = await import('./js/buildings.js');
  const g = window.game, st = g.state;
  st.minerals.enemy = 99999;
  const e = st.map.bases.enemy.cc;
  let spot = null;
  for (let dy = 10; dy >= -12 && !spot; dy--) // южнее КЦ — запас экрана вверх под 4 слота
    for (let dx = -12; dx <= 12; dx++)
      if (B.canPlace(st.map, e.x + dx, e.y + dy, 3, 3)) { spot = [e.x + dx, e.y + dy]; break; }
  const lab = B.placeBuildingCmd(st, 'enemy', 'lab', spot[0], spot[1], []);
  lab.done = true; lab.hp = lab.maxHp;
  st.fog.explored.fill(1);
  const u = st.units.find((t) => t.side === 'player' && !t.dead);
  if (u) {
    u.x = lab.x; u.y = lab.y + 10;
    u.order = { kind: 'idle' }; u.moving = false; // не уходит добывать — тайл остаётся видимым
  }
  st.camera.x = lab.x - g.viewW() / 2;
  st.camera.y = lab.y - g.viewH() / 2;
  g.clampCam();
  return { tx: lab.tx, ty: lab.ty, x: lab.x, y: lab.y, camx: st.camera.x, camy: st.camera.y,
    screenX: lab.x - st.camera.x, screenY: lab.y - st.camera.y, done: lab.done, res: lab.res };
});
console.log('LAB:', JSON.stringify(info));
await page.waitForTimeout(2600);
const res = await page.evaluate(() => {
  const lab = window.game.state.buildings.find((b) => b.side === 'enemy' && b.type === 'lab' && !b.dead);
  return { res: lab.res ? { lvl: lab.res.lvl, key: lab.res.key, t: lab.res.t, total: lab.res.total } : null,
    camx: window.game.state.camera.x, camy: window.game.state.camera.y };
});
console.log('RES:', JSON.stringify(res));
await page.screenshot({ path: '/tmp/p7_lab_probe.png' });
console.log('ERRORS:', errors.length, errors.join(' | '));
await browser.close();
