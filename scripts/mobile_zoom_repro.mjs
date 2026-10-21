// mobile_zoom_repro.mjs — репродукция пары мобильных багов владельца (22.10):
// (1) «правая четверть экрана делает невидимыми юниты/строения»;
// (2) «двойной тап зумит страницу до максимума, при открытой панели выхода нет».
// Гипотеза: одна связка — страница зумится (double-tap/pinch на поверхностях
// без touch-action), а игра (канвас fixed inset:0 + window.innerWidth) живёт в
// layout viewport и не знает о visual viewport → правая часть канваса за краем.
// Метод: CDP Emulation.setPageScaleFactor (детерминированный зум) + аудит
// эффективного touch-action всех видимых элементов (где может сработать
// double-tap / pinch) + скриншоты-пары до/после.
import { chromium } from 'playwright';

const BASE = 'http://localhost:8793';
const OUT = '/home/z/my-project/alien-cosmic/tool-results/mobile';
const log = (...a) => console.log(...a);
const errors = [];

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 3,
  isMobile: true, hasTouch: true,
});
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto(BASE + '/index.html', { waitUntil: 'load' });
await page.evaluate(() => localStorage.setItem('terranrts.language', 'ru'));
await page.goto(BASE + '/index.html', { waitUntil: 'load' });
await page.waitForTimeout(600);
await page.locator('#btn-quick-primary').click();
await page.waitForTimeout(250);
await page.locator('#quick-faction-human').click();
await page.waitForTimeout(250);
await page.locator('#btn-quick-battle-start').click();
await page.waitForTimeout(1100);

const metrics = () => page.evaluate(() => {
  const vv = window.visualViewport;
  const c = document.getElementById('game-canvas');
  const r = c.getBoundingClientRect();
  return {
    innerW: window.innerWidth, innerH: window.innerHeight,
    vvW: vv ? +vv.width.toFixed(1) : null, vvH: vv ? +vv.height.toFixed(1) : null,
    vvScale: vv ? +vv.scale.toFixed(3) : null,
    vvOffset: vv ? { l: +vv.offsetLeft.toFixed(1), t: +vv.offsetTop.toFixed(1) } : null,
    canvasRect: { w: +r.width.toFixed(1), h: +r.height.toFixed(1), x: +r.left.toFixed(1), y: +r.top.toFixed(1) },
    canvasBacking: { w: c.width, h: c.height },
    gameCss: { w: window.game.cssW, h: window.game.cssH },
    scrollW: document.scrollingElement.scrollWidth,
    scrollX: window.scrollX, scrollY: window.scrollY,
  };
});

log('=== ЭТАП 1: базовые метрики (зум=1) ===');
const m1 = await metrics();
log(JSON.stringify(m1, null, 1));

// Ставим камеру к правому краю карты: команда HQ в команде строит depot —
// проще прыгнуть камерой к правому краю мира через game.setCamera? Используем
// прямой доступ: centerCamera на правый край карты.
await page.evaluate(() => {
  const g = window.game, st = g.state;
  const wx = st.map.pxW - 60, wy = st.map.pxH / 2;
  g.centerCamera(wx, wy);
});
await page.waitForTimeout(400);
await page.screenshot({ path: OUT + '/Z1_scale1_rightedge.png' });
log('✓ скриншот при зуме=1, камера у правого края → ' + OUT + '/Z1_scale1_rightedge.png');

log('=== ЭТАП 2: page zoom 1.4 (эмуляция двойного тапа) ===');
const cdp = await ctx.newCDPSession(page);
await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1.4 });
await page.waitForTimeout(500);
const m2 = await metrics();
log(JSON.stringify(m2, null, 1));
await page.screenshot({ path: OUT + '/Z2_scale14_rightedge.png' });
log('✓ скриншот при зуме=1.4 → ' + OUT + '/Z2_scale14_rightedge.png');

// Проверка: правая полоса (запретная зона) в CSS-пикселях мира.
const cut = await page.evaluate(() => {
  const vv = window.visualViewport;
  const hiddenCss = window.innerWidth - vv.width; // сколько layout-px за правым краем
  return { hiddenCss, share: +(hiddenCss / window.innerWidth * 100).toFixed(1) };
});
log(`правая невидимая полоса: ${cut.hiddenCss}px = ${cut.share}% ширины`);

log('=== ЭТАП 3: реагирует ли игра на зум (resize/профиль) ===');
const react = await page.evaluate(() => ({
  gameCssW: window.game.cssW,           // если игра «увидела» зум — стало бы ~278
  canvasStyleW: document.getElementById('game-canvas').style.width,
}));
log(JSON.stringify(react), ' ← игра НЕ пересчиталась, если cssW=390');

await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });

log('=== ЭТАП 4: аудит touch-action — где может сработать double-tap/pinch ===');
const audit = await page.evaluate(() => {
  const DT = (v) => v === 'auto'; // double-tap zoom разрешён только цепочкой auto
  const PINCH = (v) => v === 'auto' || v === 'manipulation' || v === 'pinch-zoom' || /pinch-zoom/.test(v);
  const path = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    if (el.classList && el.classList.length) s += '.' + [...el.classList].slice(0, 2).join('.');
    return s;
  };
  const out = { doubleTapZones: [], pinchZones: [], totalChecked: 0 };
  const all = document.querySelectorAll('*');
  for (const el of all) {
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) continue;
    if (r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) continue;
    out.totalChecked++;
    // эффективный touch-action = пересечение по цепочке до viewport
    let dt = true, pinch = true, el_ = el;
    while (el_ && el_ !== document.documentElement) {
      const v = getComputedStyle(el_).touchAction;
      dt = dt && DT(v); pinch = pinch && PINCH(v);
      if (!dt && !pinch) break;
      el_ = el_.parentElement;
    }
    // html тоже учитываем
    const hv = getComputedStyle(document.documentElement).touchAction;
    dt = dt && DT(hv); pinch = pinch && PINCH(hv);
    const rec = { p: path(el), w: Math.round(r.width), h: Math.round(r.height), area: Math.round(r.width * r.height) };
    if (dt) out.doubleTapZones.push(rec);
    if (pinch) out.pinchZones.push(rec);
  }
  out.doubleTapZones.sort((a, b) => b.area - a.area);
  out.pinchZones.sort((a, b) => b.area - a.area);
  out.doubleTapZones = out.doubleTapZones.slice(0, 12);
  out.pinchZones = out.pinchZones.slice(0, 12);
  return out;
});
log('checked:', audit.totalChecked);
log('DOUBLE-TAP зоны (top по площади):', JSON.stringify(audit.doubleTapZones, null, 1));
log('PINCH зоны (top по площади):', JSON.stringify(audit.pinchZones, null, 1));

log('=== ЭТАП 5: реальный двойной тап по самой большой auto-зоне ===');
if (audit.doubleTapZones.length) {
  const z = audit.doubleTapZones[0];
  const box = await page.evaluate((p) => {
    // находим элемент по пути
    const els = [...document.querySelectorAll('*')];
    const el = els.find((e) => {
      let s = e.tagName.toLowerCase();
      if (e.id) s += '#' + e.id;
      if (e.classList && e.classList.length) s += '.' + [...e.classList].slice(0, 2).join('.');
      return s === p.p;
    });
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, z);
  if (box) {
    await page.touchscreen.tap(box.x, box.y);
    await page.waitForTimeout(120);
    await page.touchscreen.tap(box.x, box.y);
    await page.waitForTimeout(500);
    const sc = await page.evaluate(() => window.visualViewport ? +window.visualViewport.scale.toFixed(3) : null);
    log(`двойной тап по ${z.p}: visualViewport.scale = ${sc} (1 = зум не сработал, >1 = воспроизведён)`);
  }
} else {
  log('auto-зон нет — double-tap зум заблокирован всюду');
}

log('=== errors ===');
log(errors.length ? errors.join('\n') : 'нет');
await browser.close();
