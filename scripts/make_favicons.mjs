// make_favicons.mjs — пакет V (Ф1): PNG-фолбэки и apple-touch-icon из SVG-марки.
//   assets/favicon.svg       → assets/favicon-32.png, assets/favicon-48.png (прозрачные углы)
//   assets/favicon-apple.svg → assets/apple-touch-icon.png 180×180 (full-bleed, iOS маскирует сам)
// Превью обоих вариантов марки (ромб / монограмма) — на светлом и тёмном фоне.
// Запуск: node scripts/make_favicons.mjs
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const A = (f) => path.join(root, 'assets', f);
const log = (...a) => console.log(...a);

// Full-bleed вариант для apple-touch: тот же ромб, но без скругления фона
// (iOS накладывает свою маску; прозрачность и свои скругления запрещены гайдами).
const appleSvg = fs.readFileSync(A('favicon.svg'), 'utf8')
  .replace('rx="14"', 'rx="0"')
  .replace('url(#bg)', 'url(#bg)') // гардант: id не менялся
  .replace('favicon.svg', 'favicon-apple.svg');
fs.writeFileSync(A('favicon-apple.svg'), appleSvg);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 64, height: 64 }, deviceScaleFactor: 1 });

async function shot(svgFile, size, out) {
  await page.setViewportSize({ width: size, height: size });
  await page.goto('file://' + A(svgFile));
  await page.screenshot({ path: A(out), omitBackground: true });
  log(`✓ ${out} (${size}×${size})`);
}

await shot('favicon.svg', 32, 'favicon-32.png');
await shot('favicon.svg', 48, 'favicon-48.png');
await shot('favicon-apple.svg', 180, 'apple-touch-icon.png');

// Превью двух вариантов для владельца: ряд иконок на тёмном и светом фоне.
// (file://-картинки грузятся только с file://-страницы, поэтому HTML — во временный файл.)
const prevHtml = `<!DOCTYPE html><html><body style="margin:0;display:flex;gap:20px;align-items:center;justify-content:center;height:100vh;font:12px/1.5 system-ui;color:#9ab8b4">
  <div style="display:flex;gap:16px;align-items:center;padding:20px;border-radius:14px;background:#071218">
    <img src="../../../assets/favicon.svg" width="112" height="112">
    <img src="../../../assets/favicon-alt.svg" width="112" height="112">
  </div>
  <div style="display:flex;gap:16px;align-items:center;padding:20px;border-radius:14px;background:#f2f5f4">
    <img src="../../../assets/favicon.svg" width="112" height="112">
    <img src="../../../assets/favicon-alt.svg" width="112" height="112">
  </div>
</body></html>`;
const prevPath = path.join(root, 'design', 'shots', 'v', '_fav_preview.html');
fs.writeFileSync(prevPath, prevHtml);
const prev = await browser.newPage({ viewport: { width: 620, height: 220 }, deviceScaleFactor: 2 });
await prev.goto('file://' + prevPath);
await prev.waitForTimeout(300);
await prev.screenshot({ path: path.join(root, 'design', 'shots', 'v', 'favicon_variants.png') });
fs.unlinkSync(prevPath);
log('✓ design/shots/v/favicon_variants.png');

await browser.close();
log('ИТОГ MAKE_FAVICONS: OK');
