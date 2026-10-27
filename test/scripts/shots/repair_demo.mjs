// repair_demo.mjs — скрин-история авто-ремонта в настоящей игре.
// Кадры: (1) подбитый танк + idle-рабочий, (2) рабочий варит — искры,
// (3) полный HP, рабочий ушёл добывать. Общий план + крупный (клип
// считается по ЖИВОЙ камере в момент кадра — интро миссии её двигает).
// Запуск из корня репо (сервер уже поднят):
//   GAME_URL=http://localhost:8079 OUT=design/shots/repair node scripts/shots/repair_demo.mjs
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const ROOT = process.env.GAME_URL || 'http://localhost:8079';
const OUT = process.env.OUT || 'design/shots/repair';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1.5 });
await page.goto(`${ROOT}/index.html`);
await page.waitForTimeout(2000);
await page.getByText('Быстрый старт — миссия 1').click();
await page.waitForTimeout(2500);

// Сцена: idle-рабочий рядом с подбитым танком. Ручки на окно — для клипов.
await page.evaluate(async () => {
  const st = window.game.state;
  st.minerals.player = 99999;
  const U = await import('./js/units.js');
  const base = st.map.bases.player.center;
  const w = U.spawnUnit(st, 'player', 'worker', (base.x + 3.5) * 32, (base.y + 4.5) * 32);
  const t = U.spawnUnit(st, 'player', 'tank', (base.x + 5.5) * 32, (base.y + 5.5) * 32);
  t.hp = 60; // 60/260 — «после рейда»
  window.__SCENE__ = { w, t };
});
await page.waitForFunction('!!window.__SCENE__');

// Кадр с центровкой камеры на танке + клип по фактической камере.
async function frames(name) {
  const rect = await page.evaluate(() => {
    const { t } = window.__SCENE__;
    const st = window.game.state;
    window.game.centerCamera(t.x, t.y);
    const sx = t.x - st.camera.x, sy = t.y - st.camera.y;
    const cx = Math.min(Math.max(sx, 260), 1340);
    const cy = Math.min(Math.max(sy, 190), 500); // ниже — панель подсказки
    return { x: cx - 240, y: cy - 170, width: 480, height: 340 };
  });
  await page.waitForTimeout(350); // камера применится в рендере
  await page.screenshot({ path: `${OUT}/${name}.png` });
  await page.screenshot({ path: `${OUT}/${name}-zoom.png`, clip: rect });
}

await frames('repair-1-idle-and-damaged');
await page.waitForTimeout(3500);
await frames('repair-2-fixing');
// Ждём честного финала: полный HP танка.
await page.waitForFunction('window.__SCENE__.t.hp >= window.__SCENE__.t.maxHp', null, { timeout: 40000 });
await frames('repair-3-done');

await browser.close();
console.log(`Готово: ${OUT}`);
