// unit_sheet.mjs — детальный лист юнитов (design/shots/units-sheet-5-states-2x.png
// -> lossless WebP через scripts/shots/to_webp.py)
// Запуск из корня репо:
//   python3 -m http.server 8079 &
//   node scripts/shots/unit_sheet.mjs
// ENV: GAME_URL (default http://localhost:8079/scripts/shots/unit_sheet.html),
//      OUT (default design/shots), SCALE (default 2)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const GAME_URL = process.env.GAME_URL || 'http://localhost:8079/scripts/shots/unit_sheet.html';
const OUT = process.env.OUT || 'design/shots';
const SCALE = Number(process.env.SCALE || 2);
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 2020 }, deviceScaleFactor: SCALE });
await page.goto(GAME_URL);
await page.waitForFunction('window.__U_DONE__ === true', { timeout: 10000 });
await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}/units-sheet-5-states-2x.png` });
await browser.close();
console.log(`saved ${OUT}/units-sheet-5-states-2x.png`);
