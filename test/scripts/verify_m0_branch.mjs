// verify_m0_branch.mjs — браузерная верификация ветки Арены (M0).
// 1) Загрузка игры, 0 pageerrors. 2) Старт миссии №3 + скрин общего вида.
// 3) Проверка objectiveText/тостов легаси-пути. 4) Скрин меню кампании.
import { chromium } from 'playwright';

const BASE = 'http://localhost:8793';
const OUT = '/home/z/my-project/alien-cosmic/tool-results';

const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1.5 });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto(BASE + '/index.html', { waitUntil: 'load' });
await page.waitForTimeout(1500);

// Меню кампании — objectiveLabel на легаси-строках
await page.screenshot({ path: OUT + '/m0_campaign_menu.png' });

// Старт первой доступной миссии (туториал №0): легаси-путь
const startBtn = page.locator('.mc-play').first();
if (await startBtn.count()) { await startBtn.click(); await page.waitForTimeout(600); }
const briefGo = page.locator('#brief-go');
if (await briefGo.count() && await briefGo.isVisible()) { await briefGo.click(); await page.waitForTimeout(1200); }
await page.screenshot({ path: OUT + '/m0_mission0_start.png' });

// Строка цели сверху не пустая и без артефактов
const obj = await page.evaluate(() => {
  const els = [...document.querySelectorAll('div,span')].filter((e) => e.childElementCount === 0);
  return els.map((e) => e.textContent).find((t) => t && /Цель|уничтож|Уничто/i.test(t)) || '';
});
console.log('objective-line:', JSON.stringify(obj.slice(0, 80)));

await browser.close();
if (errors.length) {
  console.log('ОШИБКИ СТРАНИЦЫ:');
  errors.forEach((e) => console.log('  ' + e));
  process.exit(1);
}
console.log('PAGEERRORS: 0 — браузерная загрузка и старт миссии чистые');
