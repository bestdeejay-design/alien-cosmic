// ac_show_obstacles.mjs — SZ: живая демонстрация владельцу поставки Арены
// «ЛОКАЦИИ: преграды сделаны явными» (merge 0a6bf63 из ветки df2e6fd6):
//   1) скалы — два слоя (щебневая подошва во весь тайл + гранёный валун);
//   2) флора — читаемый куст только на проходимой земле;
//   3) призрак постройки — красные тайлы + кресты на преградах.
// Стенд: PORT=8815 node server/static.mjs (без POLYGON=1 → корень = основная игра).
// Скриншоты: /home/z/my-project/download/arena_obstacles_view/
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = 'http://localhost:8815';
const OUT = '/home/z/my-project/download/arena_obstacles_view';
mkdirSync(OUT, { recursive: true });

const errors = [];
const ok = (id, msg) => console.log(`PASS  ${id}: ${msg}`);
const bad = (id, msg) => console.log(`FAIL  ${id}: ${msg}`);
const step = async (id, fn) => { try { await fn(); } catch (e) { bad(id, String((e && e.message) || e)); } };
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png` }).catch(() => {});

let target = null; // выбранный валун для крупного плана

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

// 1. Открыть игру
await step('open', async () => {
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForFunction(() => window.game, null, { timeout: 15000 });
  ok('open', 'страница и window.game на месте');
});

// 2. Войти в стычку за HELIOS (мимо сломанного ввода профиля — T1)
await step('skirmish', async () => {
  await page.evaluate(() => window.game.startSkirmish('human'));
  await page.waitForFunction(() => window.game.started && window.game.state, null, { timeout: 15000 });
  await page.waitForTimeout(1200);
  ok('skirmish', 'стычка за HELIOS запущена');
});

// 3. Открыть ландшафт (демо), выбрать валун с соседями, центрировать камеру
await step('rocks', async () => {
  const info = await page.evaluate(() => {
    const st = window.game.state, m = st.map, f = st.fog, T_ROCK = 2;
    // демо-режим: вся карта разведана и без затемнения (патч только в этой сессии)
    f.explored.fill(1);
    f.recompute = () => { f.visible.fill(1); f.dirty = true; };
    f.recompute(st);
    const isRock = (x, y) => x >= 0 && y >= 0 && x < m.w && y < m.h && m.terrain[m.idx(x, y)] === T_ROCK;
    // кандидаты — в безопасной зоне карты (камера не упрётся в клампы)
    const cands = [];
    for (let y = 16; y <= 36; y++)
      for (let x = 18; x <= 45; x++)
        if (isRock(x, y)) {
          let n = 0;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (isRock(x + dx, y + dy)) n++;
          cands.push({ x, y, n });
        }
    if (!cands.length) throw new Error('в безопасной зоне нет скал');
    cands.sort((a, b) => b.n - a.n || Math.hypot(a.x - 32, a.y - 26) - Math.hypot(b.x - 32, b.y - 26));
    const t = cands[0];
    const z = 1.4;
    st.camera.z = z;
    st.camera.x = (t.x + 0.5) * 32 - innerWidth / 2 / z;
    st.camera.y = (t.y + 0.5) * 32 - innerHeight / 2 / z;
    const totalRocks = (() => { let c = 0; for (let y = 2; y < m.h - 2; y++) for (let x = 2; x < m.w - 2; x++) if (isRock(x, y)) c++; return c; })();
    return { t, totalRocks };
  });
  target = info.t;
  await page.waitForTimeout(500);
  await shot(page, '1_rocks_terrain');
  ok('rocks', `валун (${target.x},${target.y}) с ${target.n} соседями в центре кадра; всего скал на карте ${info.totalRocks}; зум 1.4`);
});

// 4. Призрак фабрики 3×3 НАД валуном → красные тайлы + кресты
await step('ghost_rock', async () => {
  const t = await page.evaluate((tgt) => {
    const st = window.game.state;
    const sx = ((tgt.x + 0.5) * 32 - st.camera.x) * st.camera.z;
    const sy = ((tgt.y + 0.5) * 32 - st.camera.y) * st.camera.z;
    const inSafe = sx > 260 && sy > 260 && sx < innerWidth - 360 && sy < innerHeight - 360;
    return { x: tgt.x, y: tgt.y, sx, sy, inSafe };
  }, target);
  if (!t.inSafe) throw new Error(`валун ушёл из безопасной зоны экрана: ${JSON.stringify(t)}`);
  await page.evaluate(() => { window.game.state.placing = { type: 'factory', tx: -999, ty: -999 }; });
  await page.mouse.move(t.sx, t.sy);
  await page.waitForTimeout(400);
  await shot(page, '2_ghost_on_rock');
  ok('ghost_rock', `фабрика 3×3 над валуном (${t.x},${t.y}) — красные тайлы + кресты`);
});

// 5. Призрак на чистой земле 3×3 → обычный (не красный) — для контраста
await step('ghost_ground', async () => {
  const t = await page.evaluate(() => {
    const st = window.game.state, m = st.map, T_GROUND = 0;
    for (let y = 2; y < m.h - 2; y++)
      for (let x = 2; x < m.w - 2; x++) {
        let free = true;
        for (let dy = 0; dy < 3 && free; dy++)
          for (let dx = 0; dx < 3; dx++)
            if (m.terrain[m.idx(x + dx, y + dy)] !== T_GROUND) { free = false; break; }
        if (free) {
          const sx = ((x + 1.5) * 32 - st.camera.x) * st.camera.z;
          const sy = ((y + 1.5) * 32 - st.camera.y) * st.camera.z;
          if (sx > 260 && sy > 260 && sx < innerWidth - 360 && sy < innerHeight - 360) return { x, y, sx, sy };
        }
      }
    return null;
  });
  if (!t) throw new Error('чистая земля 3×3 в кадре не найдена');
  await page.mouse.move(t.sx, t.sy);
  await page.waitForTimeout(400);
  await shot(page, '3_ghost_on_ground');
  ok('ghost_ground', `фабрика на чистой земле (${t.x},${t.y}) — призрак без красного`);
});

// 6. Showcase-вьюер юнитов и зданий (design/sprite-kit.html) — из той же поставки #31
await step('spritekit', async () => {
  await page.goto(BASE + '/design/sprite-kit.html', { waitUntil: 'load' });
  await page.waitForTimeout(1800);
  await shot(page, '4_sprite_kit_top');
  ok('spritekit', 'showcase-вьюер юнитов/зданий открыт');
});

console.log('---');
console.log(`ошибок страницы: ${errors.length}`);
errors.slice(0, 5).forEach((e) => console.log('  ' + e));
await browser.close();
