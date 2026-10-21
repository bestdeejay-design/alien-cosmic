// ac_hotfix4_fullscreen.mjs — browser verification for hotfix M2:
// stale panel insets after fullscreen/orientation jumps left the map edge
// unreachable until the panel was toggled. Fix: fullscreenchange /
// orientationchange listeners + ResizeObserver on #bottom-panel / #topbar.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:8000';
const OUT = process.env.SCREENSHOT_DIR || '/tmp/ac-hotfix4';
mkdirSync(OUT, { recursive: true });

const errors = [];
const ok = (id, msg) => { console.log(`PASS  ${id}: ${msg}`); };
const bad = (id, msg) => { console.log(`FAIL  ${id}: ${msg}`); process.exitCode = 1; };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, hasTouch: true });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

const ev = (fn, ...args) => page.evaluate(fn, ...args);
const wait = (ms) => page.waitForTimeout(ms);
const raf2 = () => ev(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const EPS = 1;

try {
  // ── boot: RU, saved quick battle 96×64 → one-tap start ──
  await page.addInitScript(() => { localStorage.setItem('terranrts.language', 'ru'); });
  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await wait(900);
  await ev(() => {
    localStorage.removeItem('terranrts.progress');
    localStorage.setItem('terranrts.quickBattle', JSON.stringify({ presetId: 'wide-96x64', faction: 'human' }));
  });
  await page.reload({ waitUntil: 'load' });
  await wait(900);
  await page.locator('#btn-quick-primary').click();
  await wait(1200);
  const started = await ev(() => !!window.game.started);
  if (started) ok('B0', 'quick battle started');
  else { bad('B0', 'battle did not start'); throw new Error('boot failed'); }

  // ── F1: fullscreen-like viewport jump → insets must be FRESH ──
  // Старый код: resize-событие обрабатывается до рефлоу панели → инсеты
  // устаревшие, край карты недостижим без передёргивания панели.
  await page.setViewportSize({ width: 1600, height: 900 });
  await raf2(); await wait(350);
  const fresh = await ev(() => {
    const g = window.game;
    const p = document.getElementById('bottom-panel').offsetHeight;
    const t = document.getElementById('topbar').offsetHeight;
    return { uiBottom: g.uiBottom, uiTop: g.uiTop, panelH: p, topbarH: t };
  });
  if (Math.abs(fresh.uiBottom - fresh.panelH) <= EPS && Math.abs(fresh.uiTop - fresh.topbarH) <= EPS)
    ok('F1', `после скачка 1280×800 → 1600×900 инсеты свежие: uiBottom=${fresh.uiBottom} (панель ${fresh.panelH}), uiTop=${fresh.uiTop} (топбар ${fresh.topbarH})`);
  else bad('F1', `инсеты устарели: uiBottom=${fresh.uiBottom} vs ${fresh.panelH}, uiTop=${fresh.uiTop} vs ${fresh.topbarH}`);

  // ── F2: нижний край карты достижим и виден ровно над панелью ──
  const edge = await ev(() => {
    const g = window.game, st = g.state;
    st.camera.z = 1;
    st.camera.x = st.map.pxW / 2;
    st.camera.y = 1e9;            // «утопить» камеру за карту
    g.clampCam();
    const bottomScreenY = (st.map.pxH - st.camera.y) * st.camera.z; // экранная Y нижней кромки карты
    return { camY: st.camera.y, bottomScreenY, cssH: g.cssH, uiBottom: g.uiBottom, pxH: st.map.pxH };
  });
  const camYMax = edge.pxH - (edge.cssH - edge.uiBottom) / 1;
  if (Math.abs(edge.camY - camYMax) <= EPS && Math.abs(edge.bottomScreenY - (edge.cssH - edge.uiBottom)) <= EPS)
    ok('F2', `кламп пустил камеру до camY=${edge.camY.toFixed(1)}; нижняя кромка карты на экранной Y=${edge.bottomScreenY.toFixed(1)} = cssH−панель (${edge.cssH - edge.uiBottom}) — край виден над панелью`);
  else bad('F2', `край недостижим/невиден: camY=${edge.camY.toFixed(1)}, ждали ${camYMax.toFixed(1)}; кромка Y=${edge.bottomScreenY.toFixed(1)}, ждали ${(edge.cssH - edge.uiBottom).toFixed(1)}`);

  // ── F3: события fullscreenchange/orientationchange не ломают состояние ──
  await ev(() => {
    document.dispatchEvent(new Event('fullscreenchange'));
    window.dispatchEvent(new Event('orientationchange'));
  });
  await raf2(); await wait(150);
  const afterEvents = await ev(() => {
    const g = window.game;
    const p = document.getElementById('bottom-panel').offsetHeight;
    return { uiBottom: g.uiBottom, panelH: p, started: g.started, errs: 0 };
  });
  if (Math.abs(afterEvents.uiBottom - afterEvents.panelH) <= EPS && afterEvents.started)
    ok('F3', `fullscreenchange/orientationchange обработаны без побочек: uiBottom=${afterEvents.uiBottom} (панель ${afterEvents.panelH}), партия жива`);
  else bad('F3', `после событий: uiBottom=${afterEvents.uiBottom} vs ${afterEvents.panelH}, started=${afterEvents.started}`);

  // ── F4: RO домеряет инсеты при фактическом росте панели (механизм фикса) ──
  // Панель растёт по содержимому (G.6) асинхронно — имитируем рост и требуем,
  // чтобы uiBottom догнал БЕЗ передёргивания панели (раньше именно это и был баг).
  await ev(() => { document.getElementById('bottom-panel').style.height = '520px'; });
  await raf2(); await wait(200);
  const grown = await ev(() => ({
    uiBottom: window.game.uiBottom,
    panelH: document.getElementById('bottom-panel').offsetHeight,
    camY: window.game.state.camera.y,
  }));
  if (Math.abs(grown.uiBottom - 520) <= EPS)
    ok('F4', `панель выросла до ${grown.panelH}px → uiBottom=${grown.uiBottom} без передёргивания (RO домерил), кламп поджал камеру camY=${grown.camY.toFixed(1)}`);
  else bad('F4', `RO не сработал: панель ${grown.panelH}px, uiBottom=${grown.uiBottom}`);
  await page.screenshot({ path: `${OUT}/hf4_panel_grown.png` });

  await ev(() => { document.getElementById('bottom-panel').style.height = ''; });
  await raf2(); await wait(200);
  const back = await ev(() => ({
    uiBottom: window.game.uiBottom,
    panelH: document.getElementById('bottom-panel').offsetHeight,
  }));
  if (Math.abs(back.uiBottom - back.panelH) <= EPS)
    ok('F5', `панель вернулась к ${back.panelH}px → uiBottom=${back.uiBottom} — обратимый двусторонний домер`);
  else bad('F5', `после снятия роста: uiBottom=${back.uiBottom} vs ${back.panelH}`);
  await page.screenshot({ path: `${OUT}/hf4_after.png` });

  // ── регресс-флажок: поворот-джамп в узкий портрет не роняет страницу ──
  await page.setViewportSize({ width: 390, height: 844 });
  await raf2(); await wait(300);
  const portrait = await ev(() => {
    const g = window.game;
    const p = document.getElementById('bottom-panel').offsetHeight;
    return { uiBottom: g.uiBottom, panelH: p, started: g.started };
  });
  if (portrait.started && Math.abs(portrait.uiBottom - portrait.panelH) <= EPS)
    ok('F6', `портрет 390×844: инсеты свежие (uiBottom=${portrait.uiBottom}/${portrait.panelH}), партия жива`);
  else bad('F6', `портрет: uiBottom=${portrait.uiBottom} vs ${portrait.panelH}, started=${portrait.started}`);

} catch (e) {
  bad('FATAL', String(e && e.message || e));
} finally {
  await browser.close();
}

if (errors.length) { console.log('PAGE ERRORS:'); errors.forEach((x) => console.log('  ' + x)); process.exitCode = 1; }
else console.log('0 pageerror / 0 console error');
console.log(process.exitCode ? 'HOTFIX4: ЕСТЬ ПРОВАЛЫ' : 'HOTFIX4: ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ');
