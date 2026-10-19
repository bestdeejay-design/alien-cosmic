// ac_hotfix_browse.mjs — браузерная проверка хотфикса формулировки №3:
// брифинг «Соберите 2500 эрга», HUD «Собрано 0/2500», pageerrors 0.
import { chromium } from 'playwright';

const BASE = 'http://localhost:8793';
const OUT = '/home/z/my-project/alien-cosmic/tool-results';

const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1500 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.addInitScript(() => localStorage.setItem('terranrts.progress', '14'));
await page.goto(BASE + '/index.html', { waitUntil: 'load' });
await page.waitForTimeout(1200);
await page.locator('#btn-campaign').click();
await page.waitForTimeout(400);

// Карточка со стокпайлом (MISSIONS[3] «Рудник-7», UI «Миссия 4») — по тексту цели
const cards = page.locator('.mission-card');
const n = await cards.count();
console.log('cards:', n);
let stockIdx = -1;
for (let i = 0; i < n; i++) {
  const t = await cards.nth(i).innerText();
  if (/Соберите 2500 эрга/.test(t)) { stockIdx = i; break; }
}
console.log('stockpile card index:', stockIdx);
if (stockIdx < 0) throw new Error('карточка «Соберите 2500 эрга» не найдена');
await cards.nth(stockIdx).click();
await page.waitForTimeout(400);
const briefText = await page.locator('#brief-panel, .brief, body').first().innerText();
const briefHas = /Соберите\s+2500\s+эрга/.test(briefText);
const briefOld = /Накопите/.test(briefText);
console.log('brief: соберите2500эрга=', briefHas, 'старое_накопите=', briefOld);
await page.screenshot({ path: OUT + '/hf3_briefing.png' });

// В бой, проверяем HUD
await page.locator('#btn-brief-go').click();
await page.waitForTimeout(1500);
const hud = await page.evaluate(() => {
  const st = window.game.state;
  return { obj: window.game.objectiveText(), started: st.started };
});
console.log('HUD objective:', JSON.stringify(hud.obj));
const hudOk = /Собрано\s+0\/2500/.test(hud.obj) && !/Накоплено/.test(hud.obj);
console.log('HUD: собрано0/2500=', hudOk);
await page.screenshot({ path: OUT + '/hf3_hud.png' });

// Симулируем добычу через state (без честной 20-сек добычи): поднимаем счётчик
const after = await page.evaluate(() => {
  const g = window.game;
  g.state.stats.mined = 1200;
  return g.objectiveText();
});
console.log('HUD after mined=1200:', JSON.stringify(after));
const midOk = /Собрано\s+1200\/2500/.test(after);
await page.waitForTimeout(400); // дождаться RAF, чтобы скрин показал 1200/2500
await page.screenshot({ path: OUT + '/hf3_hud_mid.png' });

console.log('ИТОГ:', { briefHas, briefOld, hudOk, midOk, pageerrors: errors.length });
if (errors.length) console.log('ERRORS:', errors.join(' | '));
await browser.close();
process.exit(briefHas && !briefOld && hudOk && midOk && errors.length === 0 ? 0 : 1);
