// verify_p1_branch.mjs — браузерная верификация П1 (перекраска №3/№4).
// 1) Меню кампании показывает новые цели. 2) №3: счётчик 0/2500 + победа
// с эпилогом через форс порога. 3) №4: счётчик 0/8 + кольцо зоны на камере.
// 4) pageerrors 0.
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

// Меню кампании: открыть список миссий, строки целей 3/4 (objectiveLabel)
await page.locator('#btn-campaign').click();
await page.waitForTimeout(600);
const menuObjs = await page.evaluate(() => {
  const els = [...document.querySelectorAll('.mc-obj')];
  return els.slice(3, 5).map((e) => e.textContent.trim());
});
console.log('menu-3:', JSON.stringify(menuObjs[0]));
console.log('menu-4:', JSON.stringify(menuObjs[1]));
await page.screenshot({ path: OUT + '/p1_campaign_menu.png' });

// №3 ЭКОНОМИКА: старт через карточку меню, счётчик, форс порога → победа + эпилог
await page.locator('.mission-card').nth(3).click();
await page.waitForTimeout(500);
await page.locator('#btn-brief-go').click();
await page.waitForTimeout(800);
let obj3 = await page.evaluate(() => window.game.objectiveText());
console.log('m3-objective:', JSON.stringify(obj3));
await page.evaluate(() => { window.game.state.stats.mined = 2500; });
await page.waitForTimeout(600);
const end3 = await page.evaluate(() => ({
  title: document.getElementById('end-title').textContent,
  reason: document.getElementById('end-reason').textContent,
  epilogue: document.getElementById('end-epilogue').textContent,
}));
console.log('m3-end:', JSON.stringify(end3));
await page.screenshot({ path: OUT + '/p1_m3_victory.png' });

// №4 ЭВАКУАЦИЯ: «Играть снова» после победы в №3 открывает брифинг №4 (pendingNext)
await page.locator('#btn-again').click();
await page.waitForTimeout(500);
await page.locator('#btn-brief-go').click();
await page.waitForTimeout(600);
await page.evaluate(() => {
  const st = window.game.state;
  st.camera.x = 52.5 * 32 - 800; st.camera.y = 10.5 * 32 - 450;
});
await page.waitForTimeout(700);
const obj4 = await page.evaluate(() => window.game.objectiveText());
console.log('m4-objective:', JSON.stringify(obj4));
await page.screenshot({ path: OUT + '/p1_m4_evaczone.png' });

await browser.close();
if (errors.length) {
  console.log('ОШИБКИ СТРАНИЦЫ:');
  errors.forEach((e) => console.log('  ' + e));
  process.exit(1);
}
console.log('PAGEERRORS: 0');
