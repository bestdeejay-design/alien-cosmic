// v_shots.mjs — пакет V (М1): скриншот-верификация панели на 4 позициях
// (bottom/left/right/top — full-bleed мини-карты в каждой) + мобильные
// портрет/ландшафт. Результаты: design/shots/v/*.png
// Запуск: поднять http://localhost:8793, node scripts/v_shots.mjs
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'http://localhost:8793';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(root, 'design', 'shots', 'v');
const log = (...a) => console.log(...a);

async function bootBattle(page) {
  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await page.evaluate(() => localStorage.setItem('terranrts.language', 'ru'));
  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(500);
  await page.locator('#btn-quick-primary').click();
  await page.waitForTimeout(250);
  await page.locator('#quick-faction-human').click();
  await page.waitForTimeout(250);
  await page.locator('#btn-quick-battle-start').click();
  await page.waitForTimeout(1000);
}

const browser = await chromium.launch();

// ---------- Десктоп 1400×900: 4 позиции панели ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  await bootBattle(page);
  for (const pos of ['bottom', 'left', 'right', 'top']) {
    if (pos !== 'bottom') {
      // цикл: bottom → left → right → top
      await page.evaluate(() => window.game.ui && document.getElementById('panel-pos').click());
      await page.waitForTimeout(350);
    }
    await page.screenshot({ path: path.join(OUT, `panel_${pos}.png`) });
    log(`✓ panel_${pos}.png`);
  }
  await ctx.close();
}

// ---------- Тач 390×844 портрет + 844×390 ландшафт ----------
for (const [name, vp] of [['mobile_portrait', { width: 390, height: 844 }], ['mobile_landscape', { width: 844, height: 390 }]]) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await bootBattle(page);
  await page.evaluate(() => window.game.profile.set('touch'));
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  log(`✓ ${name}.png`);
  await ctx.close();
}

await browser.close();
log('ИТОГ V_SHOTS: OK');
