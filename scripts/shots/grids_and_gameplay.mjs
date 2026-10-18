// grids_and_gameplay.mjs — все игровые/сеточные скриншоты разом.
// Кладёт в OUT: units-game-scale-1x, units-detail-4x, buildings-grid-2x,
// gameplay-menu, gameplay-start-units, gameplay-attackmove-dashes,
// gameplay-6s-later, buildings-in-game-1/2 (.webp, lossless).
// Запуск из корня репо:
//   python3 -m http.server 8079 &
//   node scripts/shots/grids_and_gameplay.mjs
// ENV: GAME_URL (default http://localhost:8079/index.html), OUT, SCALE (default 2)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const ROOT = process.env.GAME_URL || 'http://localhost:8079';
const OUT = process.env.OUT || 'design/shots';
const SCALE = Number(process.env.SCALE || 2);
mkdirSync(OUT, { recursive: true });
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png` });

const browser = await chromium.launch();

// ---- 1. Сетка юнитов: игровой масштаб (1x) и детальный (4x) ----
{
  const page = await browser.newPage({ viewport: { width: 1260, height: 560 } });
  await page.goto(`${ROOT}/scripts/shots/unit_grid.html`);
  await page.waitForFunction('window.__GRID_DONE__ === true', { timeout: 10000 });
  await page.waitForTimeout(1000);
  await shot(page, 'units-game-scale-1x');
  await page.close();
  const p4 = await browser.newPage({ viewport: { width: 1260, height: 560 }, deviceScaleFactor: 4 });
  await p4.goto(`${ROOT}/scripts/shots/unit_grid.html`);
  await p4.waitForFunction('window.__GRID_DONE__ === true', { timeout: 10000 });
  await p4.waitForTimeout(1000);
  await shot(p4, 'units-detail-4x');
  await p4.close();
}

// ---- 2. Сетка зданий (2x) ----
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: 2 });
  await page.goto(`${ROOT}/scripts/shots/building_grid.html`);
  await page.waitForFunction('window.__B_DONE__ === true', { timeout: 10000 });
  await page.waitForTimeout(1000);
  await shot(page, 'buildings-grid-2x');
  await page.close();
}

// ---- 3. Геймплей: меню, старт, attack-move с пунктирами, +6 с ----
{
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1.5 });
  await page.goto(`${ROOT}/index.html`);
  await page.waitForTimeout(2000);
  await shot(page, 'gameplay-menu');
  await page.getByText('Быстрый старт — миссия 1').click();
  await page.waitForTimeout(2500);
  await page.mouse.move(330, 470);
  await page.mouse.down();
  await page.mouse.move(560, 680, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(600);
  await shot(page, 'gameplay-start-units');
  await page.keyboard.down('a');
  await page.mouse.click(1200, 300);
  await page.keyboard.up('a');
  await page.waitForTimeout(1500);
  await shot(page, 'gameplay-attackmove-dashes');
  await page.waitForTimeout(6000);
  await shot(page, 'gameplay-6s-later');
  await page.close();
}

// ---- 4. Геймплей с отстроенными зданиями (2 кадра) ----
{
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1.5 });
  await page.goto(`${ROOT}/index.html`);
  await page.waitForTimeout(2000);
  await page.getByText('Быстрый старт — миссия 1').click();
  await page.waitForTimeout(2000);
  await page.evaluate(async () => {
    const st = window.game.state;
    st.minerals.player = 99999;
    const B = await import('./js/buildings.js');
    const base = st.map.bases.player.center;
    const list = [
      ['depot', base.x + 6, base.y + 2],
      ['barracks', base.x + 5, base.y + 5],
      ['turret', base.x + 2, base.y + 6],
      ['bunker', base.x + 5, base.y - 4],
      ['factory', base.x + 8, base.y - 3],
      ['lab', base.x + 9, base.y + 4],
      ['wall', base.x + 3, base.y + 8],
      ['wall', base.x + 4, base.y + 8],
      ['wall', base.x + 5, base.y + 8],
    ];
    let n = 0;
    for (const [type, tx, ty] of list) {
      const b = B.placeBuildingCmd(st, 'player', type, tx, ty, []);
      if (b) { b.progress = 1; b.done = true; b.hp = b.maxHp; b.cd = 0; n++; }
    }
    window.__BUILT_N__ = n;
  });
  await page.waitForFunction('(window.__BUILT_N__ || 0) >= 8', { timeout: 8000 });
  await page.waitForTimeout(1500);
  await shot(page, 'buildings-in-game-1');
  await page.evaluate(async () => {
    const st = window.game.state;
    const t = st.buildings.find((b) => b.type === 'turret' && b.side === 'player');
    if (t) { t.angle = 2.2; t.cd = 0.35; }
  });
  await page.waitForTimeout(2500);
  await shot(page, 'buildings-in-game-2');
  await page.close();
}

await browser.close();
console.log(`saved 9 shots -> ${OUT}/`);
