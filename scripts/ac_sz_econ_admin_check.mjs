// ac_sz_econ_admin_check.mjs — проверка бага владельца: «настройка цен в админке не работает».
// Гипотеза SZ: admin.js пишет localStorage['ac_econ_scale'], economy.js:readScale() читает
// только ?econ= из URL → настройка админки не применяется никогда (фича родилась сломанной).
// Сервер: PORT=8823 POLYGON=1 node server/static.mjs (main после merge 663c30a).
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://127.0.0.1:8823';
const ok = (id, msg) => console.log(`PASS  ${id}: ${msg}`);
const bad = (id, msg) => console.log(`FAIL  ${id}: ${msg}`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });

const bootUp = async (url) => {
  await page.goto(url, { waitUntil: 'load' });
  for (let i = 0; i < 80 && !(await page.evaluate(() => !!(window.game && window.game.started))); i++) {
    await page.waitForTimeout(100);
  }
  return page.evaluate(() => !!(window.game && window.game.started));
};
const readScale = () => page.evaluate(async () => {
  // тот же URL-квери, что у импорта игры → попадаем в тот же экземпляр модуля
  const html = await (await fetch('/r/index.html')).text();
  const m = html.match(/\?v=([0-9A-Za-z._-]+)/);
  const mod = await import(`./js/economy.js?v=${m ? m[1] : 'x'}`);
  return mod.ECON_SCALE;
});
const samplePrice = () => page.evaluate(async () => {
  const html = await (await fetch('/r/index.html')).text();
  const m = html.match(/\?v=([0-9A-Za-z._-]+)/);
  const mod = await import(`./js/economy.js?v=${m ? m[1] : 'x'}`);
  return mod.ccGradeCost ? mod.ccGradeCost(2) : (mod.GRADE_COSTS ? JSON.stringify(mod.GRADE_COSTS).slice(0, 80) : 'n/a');
});

// --- Т1: baseline без настроек ---
if (await bootUp(`${BASE}/r/`)) ok('T1.boot', 'полигон поднялся');
else { bad('T1.boot', 'не поднялся'); await browser.close(); process.exit(1); }
const s1 = await readScale();
console.log(`INFO  T1: ECON_SCALE без настроек = ${s1} (ожидаемо 1)`);
const p1 = await samplePrice();

// --- Т2: СЦЕНАРИЙ ВЛАДЕЛЬЦА — выставить масштаб в админке (localStorage) и перезагрузиться ---
await page.evaluate(() => localStorage.setItem('ac_econ_scale', '0.5'));
await page.reload({ waitUntil: 'load' });
for (let i = 0; i < 80 && !(await page.evaluate(() => !!(window.game && window.game.started))); i++) await page.waitForTimeout(100);
const s2 = await readScale();
const p2 = await samplePrice();
console.log(`INFO  T2: после «админка 0.5× + перезагрузка» ECON_SCALE = ${s2}, цена КЦ-2: было ${p1} → стало ${p2}`);
if (s2 === 0.5) ok('T2.admin-scale', 'масштаб админки ПРИМЕНЯЕТСЯ');
else bad('T2.admin-scale', '*** БАГ ПОДТВЕРЖДЁН: масштаб из админки игнорируется (остаётся 1) ***');

// --- Т3: URL-параметр ?econ= работает (канон «?econ= имеет приоритет») ---
if (await bootUp(`${BASE}/r/?econ=0.1`)) {
  const s3 = await readScale();
  console.log(`INFO  T3: с ?econ=0.1 ECON_SCALE = ${s3}`);
  if (s3 === 0.1) ok('T3.url-param', 'URL-параметр работает');
  else bad('T3.url-param', `URL-параметр тоже не работает?! (${s3})`);
} else bad('T3.boot', 'полигон с ?econ= не поднялся');

// --- Т4: приоритет — и localStorage, и URL → URL сильнее ---
await page.evaluate(() => localStorage.setItem('ac_econ_scale', '0.5'));
if (await bootUp(`${BASE}/r/?econ=0.1`)) {
  const s4 = await readScale();
  console.log(`INFO  T4: localStorage=0.5 + ?econ=0.1 → ECON_SCALE = ${s4} (канон: URL приоритетнее = 0.1)`);
}
await page.evaluate(() => localStorage.removeItem('ac_econ_scale'));
await browser.close();
