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

  // Пакет V (Ф1): favicon-проводка — ссылки в head, файлы отвечают 200.
  log('=== Пакет V (Ф1): favicon ===');
  const fav = await page.evaluate(async () => {
    const links = [...document.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]')];
    const loads = [];
    for (const l of links) { try { const r = await fetch(l.href); loads.push(r.ok); } catch { loads.push(false); } }
    return {
      n: links.length,
      svg: !!document.querySelector('link[rel="icon"][type="image/svg+xml"]'),
      apple: !!document.querySelector('link[rel="apple-touch-icon"]'),
      theme: (document.querySelector('meta[name="theme-color"]') || {}).content || '',
      all200: loads.length > 0 && loads.every(Boolean),
    };
  });
  if (fav.svg && fav.apple && fav.theme === '#071218' && fav.all200 && fav.n >= 3)
    ok(`Ф1: favicon-проводка жива (${fav.n} ссылок, все 200, theme-color на месте)`);
  else bad('Ф1: проводка сломана: ' + JSON.stringify(fav));

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

  // Пакет V (М1): мини-карта шире на десктопе — новый лимит 200 вместо 168,
  // и full-bleed: бокс прижат к левому/нижнему краю панели.
  log('=== Пакет V (М1): мини-карта шире и без отступов на десктопе ===');
  const mm = await page.evaluate(() => {
    const b = document.getElementById('minimap-box').getBoundingClientRect();
    const p = document.getElementById('bottom-panel').getBoundingClientRect();
    return { w: Math.round(b.width), left: Math.round(b.left - p.left), bottom: Math.round(p.bottom - b.bottom) };
  });
  if (mm.w >= 190) ok(`М1: мини-карта ${mm.w}px (>168 старого лимита, цель 200)`);
  else bad(`М1: мини-карта узкая (${mm.w}px) — лимит не применился`);
  if (mm.left <= 1 && mm.bottom <= 1) ok(`М1: бокс прижат к углу (left=${mm.left}px, bottom=${mm.bottom}px)`);
  else bad(`М1: отступы на десктопе: left=${mm.left}px, bottom=${mm.bottom}px`);

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
  // Фикс флейка (ре-аудит 27.10, 27b7055..eb5aa94): раньше сверяли minerals===7777,
  // но за 400 мс ожидания успевает тикнуть экономика (+16: «7793») — отмена
  // РАБОТАЛА, а проба падала. Детерминированный критерий: restart() создаёт
  // НОВЫЙ объект state (game.restart → newGame), поэтому «партия жива» =
  // ссылка на state не поменялась.
  await page.evaluate(() => {
    window.game.state.minerals.player = 7777;
    window.__stRef = window.game.state;
  });
  let rmsg = null;
  page.once('dialog', (d) => { rmsg = d.message(); d.dismiss(); });
  await page.evaluate(() => document.getElementById('btn-restart').click());
  await page.waitForTimeout(400);
  if (rmsg && rmsg.length > 10) ok('«Заново» открыл confirm: ' + rmsg.slice(0, 44) + '…');
  else bad('«Заново» молчит — confirm не открылся');
  const alive = await page.evaluate(() => ({
    same: window.game.state === window.__stRef,
    m: window.game.state.minerals.player,
  }));
  if (alive.same) ok(`отмена подтверждения: партия жива (тот же state, minerals=${alive.m} — тики экономики не в счёт)`);
  else bad(`отмена не сработала: партия сброшена (minerals=${alive.m})`);
  page.once('dialog', (d) => d.accept());
  await page.evaluate(() => document.getElementById('btn-restart').click());
  await page.waitForTimeout(600);
  const m2 = await page.evaluate(() => ({ same: window.game.state === window.__stRef, m: window.game.state.minerals.player }));
  if (!m2.same && m2.m !== 7777) ok(`подтверждение: партия перезапущена (minerals=${m2.m}, state новый)`);
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

  // Пакет V (М1): full-bleed — на мобильном (≤720, wrap-раскладка) бокс
  // прижат к ВЕРХНЕМУ левому углу панели.
  log('=== Пакет V (М1): full-bleed мини-карты на таче ===');
  const flush = await page.evaluate(() => {
    const b = document.getElementById('minimap-box').getBoundingClientRect();
    const p = document.getElementById('bottom-panel').getBoundingClientRect();
    return { left: Math.round(b.left - p.left), top: Math.round(b.top - p.top) };
  });
  if (flush.left <= 1 && flush.top <= 1)
    ok(`М1: бокс прижат к углу (left=${flush.left}px, top=${flush.top}px)`);
  else bad(`М1: отступы вокруг мини-карты остались: left=${flush.left}px, top=${flush.top}px`);

  // Пакет V (вариант А): драг в placement панит камеру (без постановки),
  // тап ставит здание ровно в тапнутую точку.
  log('=== Пакет V (А): пан в режиме постройки на таче ===');
  const pl = await page.evaluate(async () => {
    const g = window.game, st = g.state, TILE = 32;
    const Bm = await import('./js/buildings.js');
    const cv = document.getElementById('game-canvas');
    const fire = (ev, x, y) => cv.dispatchEvent(new PointerEvent(ev,
      { pointerType: 'touch', pointerId: 1, clientX: x, clientY: y, bubbles: true, cancelable: true }));
    const w = st.units.find((u) => u.side === 'player' && u.type === 'worker' && !u.dead && !u.garrison);
    if (!w) return { err: 'нет рабочего' };
    st.selection = [w];
    st.minerals.player = 5000;
    st.placing = { type: 'depot', tx: -999, ty: -999 };
    let spot = null;
    for (let d = 3; d < 14 && !spot; d++)
      for (const [dx, dy] of [[d, 0], [0, d], [d, d], [-d, 0]]) {
        const x = w.x + dx * TILE, y = w.y + dy * TILE;
        const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
        if (st.map.crystals.some((c) => c.tx === tx && c.ty === ty && c.amount > 0)) continue;
        if (st.buildings.some((b) => !b.dead && tx >= b.tx - 1 && tx <= b.tx + b.w && ty >= b.ty - 1 && ty <= b.ty + b.h)) continue;
        if (!Bm.canPlace(st.map, tx, ty, 2, 2) || !Bm.zoneAllows(st, tx, ty, 2, 2)) continue;
        if (!st.fog.tileExplored(tx, ty)) continue;
        spot = { x, y };
        break;
      }
    if (!spot) return { err: 'нет места' };
    const s = g.worldToScreen(spot.x, spot.y);
    const bx0 = st.buildings.length;
    const camX0 = st.camera.x;
    fire('pointerdown', s.x, s.y);
    fire('pointermove', s.x - 60, s.y);
    const camX1 = st.camera.x;
    fire('pointerup', s.x - 60, s.y);
    const afterDrag = st.buildings.length - bx0;
    fire('pointerdown', s.x - 60, s.y);
    fire('pointerup', s.x - 60, s.y);
    await new Promise((r) => setTimeout(r, 150));
    const b = st.buildings[st.buildings.length - 1];
    return {
      camDelta: Math.round(camX1 - camX0),
      afterDrag,
      placed: st.buildings.length - bx0,
      near: b ? Math.abs(b.tx * TILE - spot.x) < 64 && Math.abs(b.ty * TILE - spot.y) < 64 : false,
    };
  });
  if (pl.err) bad('Пакет V (А): стенд не собран: ' + pl.err);
  else {
    if (pl.camDelta > 30) ok(`Пакет V (А): драг в placement панит камеру (+${pl.camDelta}px мира)`);
    else bad(`Пакет V (А): камера не поехала (delta=${pl.camDelta}px)`);
    if (pl.afterDrag === 0) ok('Пакет V (А): драг НЕ ставит здание (случайных построек нет)');
    else bad(`Пакет V (А): драг поставил здание (${pl.afterDrag}) — вариант А сломан`);
    if (pl.placed === 1 && pl.near) ok('Пакет V (А): тап после пана ставит здание в тапнутую точку');
    else bad(`Пакет V (А): тап не поставил здание (placed=${pl.placed}, near=${pl.near})`);
  }

  // Пакет W (М1.2): боковая панель — бокс заполняет колонку целиком,
  // «мёртвая полоса» между боксом и игровой областью исчезает
  // (репорт владельца: скрин 22.10 13:07, зазор ~58pt при колонке 236).
  log('=== Пакет W (М1.2): бокс мини-карты = ширина колонки (panel-left) ===');
  await page.evaluate(async () => {
    const ui = await import('./js/ui.js');
    ui.setPanelPos('left');
    ui.refreshLayout(window.game);
  });
  await page.waitForTimeout(180);
  const fill = await page.evaluate(() => {
    const b = document.getElementById('minimap-box').getBoundingClientRect();
    const p = document.getElementById('bottom-panel').getBoundingClientRect();
    return { gap: Math.round(p.right - b.right), bw: Math.round(b.width), cw: Math.round(p.width) };
  });
  if (fill.gap <= 2 && fill.bw >= fill.cw - 4)
    ok(`М1.2: бокс ${fill.bw}px в колонке ${fill.cw}px, зазор справа ${fill.gap}px`);
  else bad(`М1.2: мёртвая полоса осталась: бокс ${fill.bw}px / колонка ${fill.cw}px / зазор ${fill.gap}px`);
  await page.evaluate(async () => {
    const ui = await import('./js/ui.js');
    ui.setPanelPos('bottom');
    ui.refreshLayout(window.game);
  });

  // Пакет W (Н2): аварийная перезагрузка дублирована в паузу — с телефона
  // «Ещё» на лендинге не найти. Confirm-контракт тот же, что у «Ещё»/«Заново».
  log('=== Пакет W (Н2): «Перезагрузить экран» в паузе ===');
  const pz = await page.evaluate(() => {
    const btn = document.getElementById('btn-pause-reload');
    return { hasBtn: !!btn, label: btn ? btn.textContent.trim() : '' };
  });
  if (pz.hasBtn && pz.label.length > 3) ok(`Н2: кнопка в паузе на месте («${pz.label.slice(0, 30)}»)`);
  else bad('Н2: кнопки перезагрузки в паузе нет');
  await page.evaluate(() => { if (!window.game.paused) window.game.togglePause(); });
  await page.waitForTimeout(150);
  let pmsg = null;
  page.once('dialog', (d) => { pmsg = d.message(); d.dismiss(); });
  await page.evaluate(() => document.getElementById('btn-pause-reload').click());
  await page.waitForTimeout(400);
  if (pmsg && pmsg.length > 10) ok('Н2: confirm открыт из паузы: ' + pmsg.slice(0, 40) + '…');
  else bad('Н2: confirm из паузы не открылся');
  await page.evaluate(() => { if (window.game.paused) window.game.togglePause(); });

  // Пакет X (П1): тач-пик тултипа транзиентен — репорт владельца 22.10:
  // «описание юнита не уходит долго или совсем не уходит, висит, мешает».
  log('=== Пакет X (П1): тач-тултип гаснет (тап мимо / таймер / disabled) ===');
  const tip = await page.evaluate(async () => {
    const st = window.game.state;
    const ui = await import('./js/ui.js');
    const cv = document.getElementById('game-canvas');
    const fireTouch = (el, x, y) => el.dispatchEvent(new PointerEvent('pointerdown',
      { pointerType: 'touch', pointerId: 7, clientX: x, clientY: y, bubbles: true, cancelable: true }));
    const tipShown = () => document.getElementById('cmd-tip')?.classList.contains('show') || false;
    st.placing = null; st.wallDrag = null; // гигиена: снять постановку блока (А)
    const worker = st.units.find((u) => u.side === 'player' && u.type === 'worker' && !u.dead && !u.garrison);
    if (!worker) return { err: 'нет рабочего' };
    st.selection = [worker];
    st.buildMenu = true;
    await new Promise((r) => setTimeout(r, 350)); // пересборка панели по сигнатуре
    const btn = [...document.querySelectorAll('#cmd-grid .cmd')]
      .find((b) => b.isConnected && b.querySelector('.cmd-cost')); // команда с ценой (не тоггл)
    if (!btn) return { err: 'нет команд с ценой в меню стройки' };
    const r = btn.getBoundingClientRect();
    // 1) touch-пик показан…
    fireTouch(btn, r.left + r.width / 2, r.top + r.height / 2);
    const shown1 = tipShown();
    // 2) …тап мимо (канвас) гасит мгновенно (capture-слушатель).
    fireTouch(cv, Math.round(innerWidth / 2), Math.round(innerHeight / 2));
    const hiddenByTapAway = !tipShown();
    // 3) …повторный пик гаснет авто-таймером (5 c, ждём 5.6 c).
    fireTouch(btn, r.left + r.width / 2, r.top + r.height / 2);
    const shown2 = tipShown();
    await new Promise((r2) => setTimeout(r2, 5600));
    const hiddenByTimer = !tipShown();
    // 4) disabled-команда: причина показана и гаснет тапом мимо (не вечна).
    //    Герметично: пауза замораживает тики (шахтёры не вернут минералы),
    //    пересборку панели зовём напрямую через экспорт ui.update.
    st.minerals.player = 0;
    window.game.paused = true;
    st.selection = [worker];
    st.buildMenu = true;
    ui.update(window.game);
    const btn2 = [...document.querySelectorAll('#cmd-grid .cmd')]
      .find((b) => b.isConnected && b.querySelector('.cmd-cost'));
    if (!btn2) {
      window.game.paused = false;
      return { err: 'нет costed-кнопки после герметичной пересборки' };
    }
    const r2 = btn2.getBoundingClientRect();
    fireTouch(btn2, r2.left + r2.width / 2, r2.top + r2.height / 2); // tipTouchLast = true
    btn2.click(); // бедная команда → showTip(reason) + взвод таймера
    const reasonShown = tipShown();
    fireTouch(cv, Math.round(innerWidth / 2), Math.round(innerHeight / 2));
    const reasonHidden = !tipShown();
    window.game.paused = false;
    st.minerals.player = 5000;
    st.buildMenu = false;
    ui.update(window.game);
    return { shown1, hiddenByTapAway, shown2, hiddenByTimer, reasonShown, reasonHidden };
  });
  if (tip.err) bad('Пакет X (П1): стенд не собран: ' + tip.err);
  else {
    if (tip.shown1) ok('П1: touch-пик по кнопке панели показан');
    else bad('П1: touch-пик не показан');
    if (tip.shown1 && tip.hiddenByTapAway) ok('П1: тап мимо гасит тултип мгновенно');
    else bad('П1: тап мимо НЕ гасит тултип');
    if (tip.shown2 && tip.hiddenByTimer) ok('П1: авто-скрытие по таймеру (≤5.6 c) работает');
    else bad(`П1: таймер не погасил (shown2=${tip.shown2}, hiddenByTimer=${tip.hiddenByTimer})`);
    if (tip.reasonShown && tip.reasonHidden) ok('П1: причина недоступности показана и гаснет тапом мимо');
    else bad(`П1: disabled-причина (shown=${tip.reasonShown}, hidden=${tip.reasonHidden})`);
  }
}

// ---------- Контекст 3: тач, пакет R — visualViewport-устойчивость ----------
{
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 3,
    isMobile: true, hasTouch: true,
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await bootBattle(page);

  log('=== Пакет R: следование за visualViewport (системный зум) ===');
  // Обычный масштаб: режим молчит (реальный vv, scale=1).
  const idle = await page.evaluate(() => {
    window.dispatchEvent(new Event('ac-vv-check'));
    return { cls: document.documentElement.className };
  });
  if (!/vv-follow/.test(idle.cls)) ok('R: обычный масштаб — режим следования молчит');
  else bad('R: vv-follow включился без зума: ' + idle.cls);

  // Системный зум: фейковый vv (веб не может вызвать настоящий iOS-зум —
  // подмена + тест-хук ac-vv-check повторяют контракт vv-события).
  const zoom = await page.evaluate(() => {
    const fake = {
      scale: 1.6, width: 300, height: 700, offsetLeft: 40, offsetTop: 60,
      addEventListener() {},
    };
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: fake });
    window.dispatchEvent(new Event('ac-vv-check'));
    const rect = (sel) => {
      const b = document.querySelector(sel).getBoundingClientRect();
      return { l: +b.left.toFixed(1), t: +b.top.toFixed(1), r: +b.right.toFixed(1), b: +b.bottom.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) };
    };
    const toasts1 = document.querySelectorAll('#toasts .toast').length;
    const allToasts = [...document.querySelectorAll('#toasts .toast')].map((t) => t.textContent).join(' | ');
    window.dispatchEvent(new Event('ac-vv-check')); // повторный вход — тост не дублируется
    return {
      cls: document.documentElement.className,
      canvas: rect('#game-canvas'), topbar: rect('#topbar'), panel: rect('#bottom-panel'),
      toasts1, toasts2: document.querySelectorAll('#toasts .toast').length, allToasts,
      flag: localStorage.getItem('ac_vv_hint_v1'),
      gameW: window.game.cssW, gameH: window.game.cssH,
    };
  });
  await page.screenshot({ path: 'design/shots/r/vv_follow.png' });
  if (/vv-follow/.test(zoom.cls)) ok('R: класс vv-follow включён при scale>1.01');
  else bad('R: нет класса vv-follow');
  const cvz = zoom.canvas;
  if (Math.abs(cvz.l - 40) <= 1 && Math.abs(cvz.t - 60) <= 1 && Math.abs(cvz.w - 300) <= 1 && Math.abs(cvz.h - 700) <= 1)
    ok(`R: канвас = видимая область (40,60 300×700), cssW/H=${zoom.gameW}×${zoom.gameH}`);
  else bad(`R: канвас не следует: ${JSON.stringify(cvz)}, cssW/H=${zoom.gameW}×${zoom.gameH}`);
  const tb = zoom.topbar;
  if (Math.abs(tb.l - 40) <= 1 && Math.abs(tb.t - 60) <= 1 && Math.abs(tb.w - 300) <= 1)
    ok('R: топбар внутри видимой области');
  else bad(`R: топбар вне видимой области: ${JSON.stringify(tb)}`);
  const pn = zoom.panel;
  if (Math.abs(pn.b - 760) <= 2 && Math.abs(pn.l - 40) <= 1 && Math.abs(pn.w - 300) <= 1)
    ok(`R: командная панель прижата к низу видимой области (bottom=${pn.b})`);
  else bad(`R: командная панель не прижата к видимой области: ${JSON.stringify(pn)}`);
  if (zoom.toasts1 >= 1 && zoom.toasts1 === zoom.toasts2) ok('R: подсказка показана один раз (повторный вход не дублирует)');
  else bad(`R: подсказка (toasts1=${zoom.toasts1}, toasts2=${zoom.toasts2})`);
  if (/щипка|щипок/.test(zoom.allToasts)) ok('R: текст подсказки честный («верните масштаб щипка», без обещания авто-выхода)');
  else bad('R: текст подсказки не содержит «щипка»: ' + zoom.allToasts);
  if (zoom.flag === '1') ok('R: флаг одноразовости в localStorage');
  else bad('R: нет флага ac_vv_hint_v1');

  // Возврат масштаба: режим снят, геометрия вернулась к layout viewport.
  const reset = await page.evaluate(() => {
    window.visualViewport.scale = 1;
    window.dispatchEvent(new Event('ac-vv-check'));
    const b = document.getElementById('game-canvas').getBoundingClientRect();
    return {
      cls: document.documentElement.className,
      canvas: { l: +b.left.toFixed(1), t: +b.top.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) },
      varX: document.documentElement.style.getPropertyValue('--vv-x') || '',
    };
  });
  await page.screenshot({ path: 'design/shots/r/vv_normal.png' });
  if (!/vv-follow/.test(reset.cls)) ok('R: после возврата scale=1 режим снят');
  else bad('R: режим следования не снялся');
  if (!reset.varX) ok('R: --vv-* переменные очищены');
  else bad('R: переменные не очищены: ' + reset.varX);
  const cvr = reset.canvas;
  if (Math.abs(cvr.l) <= 1 && Math.abs(cvr.t) <= 1 && Math.abs(cvr.w - 390) <= 1 && Math.abs(cvr.h - 844) <= 1)
    ok('R: канвас вернулся к layout viewport (0,0 390×844)');
  else bad(`R: канвас не вернулся: ${JSON.stringify(cvr)}`);
  await ctx.close();
}

log('=== pageerrors ===');
log(errors.length ? errors.join('\n') : 'нет');
if (errors.length) failed = 1;
await browser.close();
console.log(failed ? '\nИТОГ V_VERIFY: ЕСТЬ ПРОВАЛЫ' : '\nИТОГ V_VERIFY: ВСЕ ПРОВЕРКИ ПРОШЛИ');
process.exitCode = failed ? 1 : 0;
