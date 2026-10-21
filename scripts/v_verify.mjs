// v_verify.mjs — сквозная приёмка пакета Q (политика жестов страницы) в браузере:
// (1) meta-ограничения зума в index.html;
// (2) инвариант touch-action: НИ ОДИН видимый элемент не имеет цепочки,
//     разрешающей double-tap или pinch — и в меню, и в бою, на двух контекстах
//     (десктоп 1400×900 и тач 390×844 dpr3);
// (3) gesturestart/gesturechange отменяются (iOS-гвард);
// (4) вертикальный нативный скролл жив (меню — прокрутка страницы);
// (5) кнопка «Перезагрузить экран»: confirm → location.reload.
// Запуск: поднять http://localhost:8793 (python3 -m http.server 8793), node scripts/v_verify.mjs
import { chromium } from 'playwright';

const BASE = 'http://localhost:8793';
const log = (...a) => console.log(...a);
const errors = [];
let failed = 0;
const ok = (m) => log('  ✓ ' + m);
const bad = (m) => { failed = 1; log('  ✗ ' + m); };

// Инвариант эффективного touch-action (пересечение по цепочке, MDN):
// double-tap разрешён только цепочкой из сплошных 'auto'; pinch — если каждый
// элемент цепочки допускает pinch-zoom; pan-y — если ни один не запрещает.
function audit(panySelectors) {
  const DT = (v) => v === 'auto';
  const PINCH = (v) => v === 'auto' || /pinch-zoom/.test(v);
  const PANY = (v) => v === 'auto' || v === 'manipulation' || /pan-y/.test(v);
  const label = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '');
  const dtZones = [], pinchZones = [];
  let checked = 0;
  for (const el of document.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    if (r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    checked++;
    let d = true, p = true, e = el;
    while (e && e.nodeType === 1) {
      const v = getComputedStyle(e).touchAction;
      d = d && DT(v); p = p && PINCH(v);
      if (!d && !p) break;
      e = e.parentElement;
    }
    if (d && dtZones.length < 5) dtZones.push(label(el));
    if (p && pinchZones.length < 5) pinchZones.push(label(el));
  }
  // вертикальный пан — точечно на назначенных скролл-целях (канвас/миникарта
  // с touch-action:none исключены сознательно: их жесты игровые, не нативные)
  const panyBroken = [];
  for (const sel of panySelectors) {
    const el = document.querySelector(sel);
    if (!el) { panyBroken.push(sel + ' (не найден)'); continue; }
    let py = true, e = el;
    while (e && e.nodeType === 1) {
      const v = getComputedStyle(e).touchAction;
      py = py && PANY(v);
      if (!py) break;
      e = e.parentElement;
    }
    if (!py) panyBroken.push(sel);
  }
  // синтетический iOS-жест: слушатель должен отменять
  const gs = new Event('gesturestart', { cancelable: true });
  const gc = new Event('gesturechange', { cancelable: true });
  document.dispatchEvent(gs); document.dispatchEvent(gc);
  const meta = document.querySelector('meta[name="viewport"]');
  return {
    checked, dtZones, pinchZones, panyBroken,
    html: getComputedStyle(document.documentElement).touchAction,
    meta: meta ? meta.getAttribute('content') : '',
    gestureBlocked: gs.defaultPrevented && gc.defaultPrevented,
    scrollY: window.scrollY,
  };
}

async function bootBattle(page) {
  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await page.evaluate(() => localStorage.setItem('terranrts.language', 'ru'));
  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(600);
  await page.locator('#btn-quick-primary').click();
  await page.waitForTimeout(250);
  await page.locator('#quick-faction-human').click();
  await page.waitForTimeout(250);
  await page.locator('#btn-quick-battle-start').click();
  await page.waitForTimeout(1000);
}

async function checkAudit(page, state, expectMeta, panyTargets = []) {
  const a = await page.evaluate(audit, panyTargets);
  log(`  [${state}] checked=${a.checked} html=${a.html} gestureBlocked=${a.gestureBlocked}`);
  if (a.dtZones.length) bad(`${state}: double-tap зоны остались: ${a.dtZones.join(', ')}`);
  else ok(`${state}: double-tap зон нет`);
  if (a.pinchZones.length) bad(`${state}: pinch зоны остались: ${a.pinchZones.join(', ')}`);
  else ok(`${state}: pinch зон нет`);
  if (a.panyBroken.length) bad(`${state}: вертикальный пан сломан у: ${a.panyBroken.join(', ')}`);
  else if (panyTargets.length) ok(`${state}: вертикальный пан жив на ${panyTargets.join(', ')}`);
  if (a.html !== 'manipulation') bad(`${state}: html touch-action=${a.html}`);
  if (!a.gestureBlocked) bad(`${state}: gesturestart/gesturechange не отменяются`);
  else ok(`${state}: iOS-гвард жестов активен`);
  if (expectMeta && !(a.meta.includes('maximum-scale=1') && a.meta.includes('user-scalable=no')))
    bad(`${state}: meta без maximum-scale=1/user-scalable=no: ${a.meta}`);
}

const browser = await chromium.launch();

// ---------- Контекст 1: десктоп ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  // Меню (первая загрузка, локаль ещё дефолт — meta не зависит от локали).
  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(700);
  log('=== Меню (десктоп): meta + инвариант + скролл ===');
  await checkAudit(page, 'menu-desktop', true, ['body']);

  // Нативный вертикальный скролл страницы в меню жив.
  await page.evaluate(() => window.scrollTo({ top: 700, behavior: 'instant' }));
  await page.waitForTimeout(120);
  const sy = await page.evaluate(() => window.scrollY);
  if (sy > 300) ok(`меню-скролл жив (scrollY=${sy})`); else bad(`меню-скролл не работает (scrollY=${sy})`);

  // Кнопка «Перезагрузить экран»: confirm → reload. Диалог обрабатываем
  // канонично (page.once до клика), клик шлём из JS — проверяем wiring,
  // а не хит-геометрию деталей-раскрывашки.
  log('=== Кнопка «Перезагрузить экран» ===');
  await page.locator('#menu-more summary').click();
  await page.waitForTimeout(200);
  const marker = 'qmark-' + Date.now();
  await page.evaluate((m) => { window.MARK_Q = m; }, marker);
  let dialogMsg = null;
  page.once('dialog', (d) => { dialogMsg = d.message(); d.accept(); });
  await page.evaluate(() => document.getElementById('btn-reload-screen').click());
  await page.waitForLoadState('load');
  await page.waitForTimeout(500);
  if (dialogMsg && dialogMsg.length > 10) ok('confirm-диалог открыт: ' + dialogMsg.slice(0, 40) + '…');
  else bad('confirm-диалог не открылся (wiring сломан?)');
  const mark = await page.evaluate(() => window.MARK_Q);
  if (mark === undefined) ok('страница перезагрузилась (маркер потерян)');
  else bad('перезагрузки не было (маркер жив: ' + mark + ')');

  // Бой.
  await bootBattle(page);
  log('=== Бой (десктоп): инвариант ===');
  await checkAudit(page, 'battle-desktop', false, ['#sel-info']);

  // Пакет S, инвариант S8 (перманентная проба репро zoom_buildings):
  // при z=0.5 здание ПРАВЕЕ экранной границы W (но в пределах vw=W/z)
  // обязано рисоваться — клиллинг зданий по vw/vh, не по W/H.
  log('=== Пакет S: клиллинг зданий при z=0.5 (S8-инвариант) ===');
  await page.evaluate(async () => {
    const g = window.game, st = g.state, TILE = 32;
    const Bm = await import('./js/buildings.js');
    st.minerals.player = 9000;
    const cc = st.buildings.find((b) => b.side === 'player' && b.type === 'cc' && !b.dead);
    // недострой-депо у базы (контроль слева)
    const putNear = () => {
      for (let d = 4; d < 12; d++) for (const [dx, dy] of [[d, 6], [-d, 6], [6, d], [6, -d]]) {
        const tx = cc.tx + dx, ty = cc.ty + dy;
        if (Bm.canPlace(st.map, tx, ty, 3, 2)) return Bm.placeBuildingCmd(st, 'player', 'depot', tx, ty, []);
      }
      return null;
    };
    window.__depotL = putNear();
    // камера/зум СНАЧАЛА — мёртвый сектор ищем от фактической камеры
    st.camera.z = 0.5;
    st.camera.x = 0; st.camera.y = (cc.ty - 4) * TILE;
    g.clampCam();
    const z = st.camera.z || 1, W = g.cssW, camX = st.camera.x;
    // депо строго в мёртвом секторе старого клиллинга (cam.x+W, cam.x+vw)
    let R = null;
    for (let ty = 3; ty < 58 && !R; ty++) for (let tx = 2; tx < 58 && !R; tx++) {
      const bx = tx * TILE;
      if (bx <= camX + W + 40 || bx >= camX + W / z - 100) continue;
      if (Bm.canPlace(st.map, tx, ty, 3, 2)) R = Bm.placeBuildingCmd(st, 'player', 'depot', tx, ty, []);
    }
    // вертикаль: подводим камеру к ряду депо — иначе скан может выбрать
    // строку вне видимой полосы и проба станет недостоверной
    if (R) { st.camera.y = R.ty * TILE - 80; g.clampCam(); }
    window.__depotR = R;
  });
  await page.waitForTimeout(400);
  const s8 = await page.evaluate(() => {
    const g = window.game, st = g.state, cv = document.getElementById('game-canvas');
    const ctx2 = cv.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const cam = st.camera, z = cam.z || 1, TILE = 32;
    const W = g.cssW, vw = W / z;
    const grey = (d) => Math.abs(d[0] - d[1]) < 26 && Math.abs(d[1] - d[2]) < 26 && d[0] > 25 && d[0] < 205;
    const probe1 = (b) => {
      if (!b) return null;
      const bx = b.tx * TILE, by = b.ty * TILE, bw = b.w * TILE, bh = b.h * TILE;
      const x0 = Math.max(0, ((bx - cam.x) * z * dpr) | 0), y0 = Math.max(0, ((by - cam.y) * z * dpr) | 0);
      const x1 = Math.min(cv.width, ((bx - cam.x + bw) * z * dpr) | 0), y1 = Math.min(cv.height, ((by - cam.y + bh) * z * dpr) | 0);
      if (x1 - x0 < 4 || y1 - y0 < 4) return { onScreen: false, px: -1, sx: Math.round((bx - cam.x) * z), sy: Math.round((by - cam.y) * z) };
      const img = ctx2.getImageData(x0, y0, x1 - x0, y1 - y0).data;
      let n = 0;
      for (let i = 0; i < img.length; i += 16) { if (grey([img[i], img[i + 1], img[i + 2]])) n++; }
      return { onScreen: true, px: n, sx: Math.round((bx - cam.x) * z), sy: Math.round((by - cam.y) * z) };
    };
    return { W: Math.round(W), vw: Math.round(vw), L: probe1(window.__depotL), R: probe1(window.__depotR) };
  });
  if (!s8.R) bad('S8-стенд: депо в мёртвом секторе не поставлено (скан пуст)');
  else if (!s8.R.onScreen) bad(`S8-стенд: депо вне экрана (screenX=${s8.R.sx}/${s8.W}, screenY=${s8.R.sy})`);
  else if (s8.R.px > 30) ok(`S8-инвариант: здание за экранной границей W видно при z=0.5 (screenX=${s8.R.sx}/${s8.W}, px=${s8.R.px})`);
  else bad(`S8-инвариант сломан: здание в мёртвом секторе не нарисовано (screenX=${s8.R.sx}/${s8.W}, px=${s8.R.px})`);
  if (s8.L && s8.L.onScreen && s8.L.px > 30) ok(`контроль слева жив (px=${s8.L.px})`);
  else bad('S8-стенд: контрольное депо слева не видно — проба недостоверна');

  // Пакет S, баг 5: «Заново» в хедере спрашивает подтверждение (Р2а — оба профиля).
  log('=== Пакет S: «Заново» с подтверждением ===');
  await page.evaluate(() => { window.game.state.minerals.player = 7777; });
  let rmsg = null;
  page.once('dialog', (d) => { rmsg = d.message(); d.dismiss(); });
  await page.evaluate(() => document.getElementById('btn-restart').click());
  await page.waitForTimeout(400);
  if (rmsg && rmsg.length > 10) ok('«Заново» открыл confirm: ' + rmsg.slice(0, 44) + '…');
  else bad('«Заново» молчит — confirm не открылся');
  const m1 = await page.evaluate(() => window.game.state.minerals.player);
  if (m1 === 7777) ok('отмена подтверждения: партия жива (минералы не сброшены)');
  else bad(`отмена не сработала: партия сброшена (minerals=${m1})`);
  page.once('dialog', (d) => d.accept());
  await page.evaluate(() => document.getElementById('btn-restart').click());
  await page.waitForTimeout(600);
  const m2 = await page.evaluate(() => window.game.state.minerals.player);
  if (m2 !== 7777) ok(`подтверждение: партия перезапущена (minerals=${m2})`);
  else bad('рестарт не выполнился после подтверждения');
}

// ---------- Контекст 2: тач (iPhone-эмуляция) ----------
{
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 3,
    isMobile: true, hasTouch: true,
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await bootBattle(page);
  // Playwright не эмулирует pointer:coarse, а клики старта идут мышью —
  // runtime-сигнал честно дал desktop (см. u_verify). Профиль тача задаём
  // override'ом — легитимный путь «Интерфейс → Телефон».
  await page.evaluate(() => window.game.profile.set('touch'));
  await page.waitForTimeout(200);
  log('=== Бой (тач): инвариант ===');
  await checkAudit(page, 'battle-touch', false, ['#sel-info']);
  const cls = await page.evaluate(() => document.documentElement.className);
  if (/game-touch/.test(cls)) ok('тач-контекст: game-touch жив (санити пакета U)');
  else bad('тач-контекст: game-touch потерян: ' + cls);
}

log('=== pageerrors ===');
log(errors.length ? errors.join('\n') : 'нет');
if (errors.length) failed = 1;
await browser.close();
console.log(failed ? '\nИТОГ V_VERIFY: ЕСТЬ ПРОВАЛЫ' : '\nИТОГ V_VERIFY: ВСЕ ПРОВЕРКИ ПРОШЛИ');
process.exitCode = failed ? 1 : 0;
