// ac_p5_reshoot.mjs — досъёмка двух кадров чек-листа Арены (туман/призрак):
// p5_m13_eye_re — ромб над КЦ форта с открытым туманом + HUD-цель
// p5_m5_zone_ghost — пунктир полей + красный призрак турели ВНЕ зоны
import { chromium } from 'playwright';

const BASE = 'http://localhost:8793';
const OUT = '/tmp/ac-branch/tool-results';
const errors = [];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1500 } });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

await page.addInitScript(() => localStorage.setItem('terranrts.progress', '14'));
const startCard = async (idx) => {
  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(900);
  await page.locator('#btn-campaign').click();
  await page.waitForTimeout(350);
  await page.locator('.mission-card').nth(idx).click();
  await page.waitForTimeout(350);
  await page.locator('#btn-brief-go').click();
  await page.waitForTimeout(1200);
};

// --- p5_m13_eye_re: №13, ромб над КЦ форта с открытым туманом ---
await startCard(13);
await page.evaluate(() => {
  const st = window.game.state;
  st.fog.explored.fill(1);
  const cc = st.buildings.find((b) => b.side === 'enemy' && b.type === 'cc' && !b.dead);
  // visible пересчитывается каждый тик из юнитов — подводим бойца отряда
  // к КЦ: fog сам пометит тайлы видимыми (fog.js: spotted) и КЦ отрисуется
  const u = st.units.find((x) => x.side === 'player' && !x.dead);
  u.x = (cc.tx + cc.w + 0.6) * 32; u.y = (cc.ty + cc.h - 0.5) * 32;
  u.prevX = u.x; u.prevY = u.y; u.order = { kind: 'idle' }; u.moving = false;
  st.camera.x = cc.tx * 32 + cc.w * 16 - 800;
  st.camera.y = cc.ty * 32 + cc.h * 16 - 600;
  window.game.clampCam();
});
await page.waitForTimeout(700); // тик тумана: visible→spotted на КЦ
await page.screenshot({ path: `${OUT}/p5_m13_eye_re.png` });
const eyeHud = await page.evaluate(() => window.game.objectiveText());
console.log('eye HUD:', eyeHud);

// --- p5_m5_zone_ghost: №5, призрак турели вне священных полей (красный) ---
await startCard(5);
await page.evaluate(() => { window.game.state.minerals.player = 99999; });
await page.evaluate(() => { window.game.state.fog.explored.fill(1); });
// placing — объект {type, tx, ty} (input.js); призрак в тайл (34,30) — вне
// полей {3,4,16,16}; камера (16,12) — в кадре и зона, и призрак
await page.evaluate(() => {
  const st = window.game.state;
  st.placing = { type: 'turret', tx: 34, ty: 30 };
  st.camera.x = 16 * 32; st.camera.y = 12 * 32; window.game.clampCam();
});
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/p5_m5_zone_ghost.png` });
const ghost = await page.evaluate(() => {
  const st = window.game.state;
  return { placing: st.placing && st.placing.type, tx: st.placing && st.placing.tx, ty: st.placing && st.placing.ty };
});
console.log('ghost:', JSON.stringify(ghost));

console.log('errors:', errors.length, errors.join(' | '));
await browser.close();
process.exit(errors.length ? 1 : 0);
