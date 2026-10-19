// ac_p8_addenda.mjs — два уточнённых скрина приёмки П8:
// 1) p8_chapters — секция «Главы Хроники» с прокруткой к карточкам;
// 2) p8_m18_menu — меню стройки №18: без Казармы и Завода (banBuild).
import { chromium } from 'playwright';

const BASE = 'http://localhost:8793';
const OUT = '/tmp/ac-branch/tool-results';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1500 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('dialog', (d) => d.accept());

// 1) главы с прокруткой
await page.goto(BASE + '/index.html', { waitUntil: 'load' });
await page.evaluate(() => localStorage.setItem('terranrts.progress', '15'));
await page.goto(BASE + '/index.html', { waitUntil: 'load' });
await page.waitForTimeout(900);
await page.locator('#btn-campaign').click();
await page.waitForTimeout(400);
await page.evaluate(() => {
  const nums = [...document.querySelectorAll('.mc-num')];
  const g = nums.find((b) => /ГЛАВА 1/i.test(b.textContent));
  if (g) g.scrollIntoView({ block: 'start' });
  const box = document.querySelector('#mission-overlay .overlay-box');
  if (box) box.scrollTop = box.scrollTop; // фолбэк
});
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/p8_chapters.png` });
console.log('PASS p8_chapters: секция глав с прокруткой');

// 2) №18 меню без казармы/завода
await page.goto(BASE + '/index.html', { waitUntil: 'load' });
await page.evaluate(() => localStorage.setItem('terranrts.progress', '18'));
await page.goto(BASE + '/index.html', { waitUntil: 'load' });
await page.waitForTimeout(900);
await page.locator('#btn-campaign').click();
await page.waitForTimeout(350);
await page.locator('.mission-card').nth(17).click();
await page.waitForTimeout(350);
await page.locator('#btn-brief-go').click();
await page.waitForTimeout(1400);
const opened = await page.evaluate(() => {
  const st = window.game.state;
  const w = st.units.find((u) => u.side === 'player' && !u.dead && u.type === 'worker');
  if (!w) return false;
  st.selection = [w];
  st.buildMenu = true;
  return true;
});
if (!opened) { console.log('FAIL p8_m18_menu: рабочий не найден'); process.exit(1); }
await page.waitForTimeout(400);
const t = await page.evaluate(() => document.body.innerText);
if (/Казарма/.test(t) || /Завод/.test(t)) { console.log('FAIL p8_m18_menu: Казарма/Завод видны'); process.exit(1); }
if (!/Турель/.test(t)) { console.log('FAIL p8_m18_menu: меню не открыто'); process.exit(1); }
await page.screenshot({ path: `${OUT}/p8_m18_menu.png` });
console.log('PASS p8_m18_menu: сетка без Казармы/Завода');

await browser.close();
console.log('pageerrors: ' + errors.length);
if (errors.length) process.exit(1);
