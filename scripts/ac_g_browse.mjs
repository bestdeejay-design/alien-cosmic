// ac_g_browse.mjs — браузерная приёмка V (бейдж версии) + G «Комфорт и сезоны»
// по чек-листу Арены и требованиям владельца.
// Ш1 главное меню (H): #ver-badge «версия H · 20.10.2026», кнопки Сезон 1 / Сезон 2 · СКОРО.  g_main_seasons
// Ш2 Сезон 2 → тост «Сезон 2 — сюжетные миссии. Скоро.»                                  g_season2_soon
// Ш3 Сезон 1 → карточки миссий + «Быстрый бой».                                          g_missions
// Ш4 скирмиш: #sk-size 48/64/80/96, #sk-shape 3 формы, #sk-dims 96×64, старт 96-wide.    g_skirmish_cfg, g_skirmish_96x64
// Ш5 зум: клампы 0.5–2.0 (setZoom + живые клавиши +/−), обзор 96-карты целиком на 0.5.   g_zoom_min, g_zoom_max
// Ш6 G.2 панель справа: base в центре ВИДИМОЙ области (панель обзор не ест).             g_panel_right_base
// Ш7 G.4 ПКМ-ремонт: 4 техника на цель — чинят ≤2, излишек добывает.
// Ш8 назад: скирмиш ↔ миссии ↔ меню.
// pageerrors 0.
import { chromium } from 'playwright';

const BASE = 'http://localhost:8793';
const OUT = '/home/z/my-project/ac-verify/tool-results';

const errors = [];
const ok = (id, msg) => { console.log(`PASS  ${id}: ${msg}`); };
const bad = (id, msg) => { console.log(`FAIL  ${id}: ${msg}`); process.exitCode = 1; };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1500 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png` });
const ev = (fn, ...args) => page.evaluate(fn, ...args);
const wait = (ms) => page.waitForTimeout(ms);

try {
  // ── Ш1 главное меню: бейдж версии + сезоны ─────────────────────────────
  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await wait(1000);

  const badgeVisible = await page.locator('#ver-badge').isVisible();
  const badgeText = (await page.locator('#ver-badge').textContent() || '').trim();
  if (badgeVisible && badgeText === 'версия H · 20.10.2026') ok('V1', `бейдж видим, текст «${badgeText}»`);
  else bad('V1', `бейдж visible=${badgeVisible}, текст=«${badgeText}»`);

  const s1 = (await page.locator('#btn-season1').textContent() || '').trim();
  const s2 = (await page.locator('#btn-season2').textContent() || '').trim();
  if (s1.includes('Сезон 1') && s2.includes('Сезон 2') && s2.includes('СКОРО')) ok('G6a', `кнопки: «${s1}» / «${s2}»`);
  else bad('G6a', `кнопки: «${s1}» / «${s2}»`);
  const s2Ghost = await page.locator('#btn-season2.ghost-btn.season-soon').count();
  if (s2Ghost === 1) ok('G6b', 'Сезон 2 — ghost-кнопка season-soon (визуально заглушка)');
  else bad('G6b', `season-soon ghost = ${s2Ghost}, ожидалась 1`);
  await shot('g_main_seasons');

  // ── Ш2 Сезон 2 → тост «Скоро» ──────────────────────────────────────────
  await page.locator('#btn-season2').click();
  await wait(400);
  const toast = await ev(() => {
    const t = document.querySelector('#toasts') || document.body;
    return (t.textContent || '');
  });
  if (/Сезон 2/.test(toast) && /Скоро/i.test(toast)) ok('G6c', `тост: «…${toast.match(/Сезон 2[^«"]*/i)?.[0]?.slice(0, 60)}…»`);
  else bad('G6c', `тост не найден: «${toast.slice(-160)}»`);
  await shot('g_season2_soon');

  // ── Ш3 Сезон 1 → миссии ────────────────────────────────────────────────
  await page.locator('#btn-season1').click();
  await wait(450);
  const cards = await page.locator('.mission-card').count();
  const skBtnVisible = await page.locator('#btn-missions-skirmish').isVisible();
  if (cards >= 15 && skBtnVisible) ok('G6d', `миссий ${cards}, «Быстрый бой» рядом`);
  else bad('G6d', `миссий ${cards}, skirmish visible=${skBtnVisible}`);
  await shot('g_missions');

  // ── Ш4 скирмиш: конфиг + старт 96-wide ─────────────────────────────────
  await page.locator('#btn-missions-skirmish').click();
  await wait(450);
  const skVisible = await page.locator('#skirmish-overlay').isVisible();
  const sizeOpts = await page.locator('#sk-size option').allTextContents();
  const shapeOpts = await page.locator('#sk-shape option').allTextContents();
  if (skVisible && sizeOpts.join(',') === '48,64,80,96' && shapeOpts.length === 3) ok('G5a', `размеры [${sizeOpts}], форм ${shapeOpts.length}`);
  else bad('G5a', `skVisible=${skVisible} sizes=[${sizeOpts}] shapes=${shapeOpts.length}`);

  await page.locator('#sk-size').selectOption('96');
  await page.locator('#sk-shape').selectOption('wide');
  await wait(200);
  const dims = (await page.locator('#sk-dims').textContent() || '').trim();
  if (dims === '96×64') ok('G5b', `#sk-dims live: ${dims} (short = 96/3*2)`);
  else bad('G5b', `#sk-dims = «${dims}», ждали «96×64»`);
  await shot('g_skirmish_cfg');

  await page.locator('#btn-skirmish-human').click();
  await wait(1600);
  const mapDims = await ev(() => { const st = window.game.state; return { w: st.map.w, h: st.map.h }; });
  if (mapDims.w === 96 && mapDims.h === 64) ok('G5c', `карта скирмиша ${mapDims.w}×${mapDims.h} живая`);
  else bad('G5c', `карта ${mapDims.w}×${mapDims.h}, ждали 96×64`);
  await shot('g_skirmish_96x64');

  // ── Ш5 зум 0.5–2.0 ─────────────────────────────────────────────────────
  // клампы setZoom напрямую
  await ev(() => { window.game.setZoom(0.001); });
  const zMin = await ev(() => window.game.state.camera.z);
  await ev(() => { window.game.setZoom(99); });
  const zMax = await ev(() => window.game.state.camera.z);
  if (Math.abs(zMin - 0.5) < 1e-6 && Math.abs(zMax - 2.0) < 1e-6) ok('G5d', `клампы setZoom: ${zMin}…${zMax}`);
  else bad('G5d', `клампы: min=${zMin} max=${zMax}, ждали 0.5/2.0`);

  // живые клавиши: − до дна, + до потолка
  await ev(() => { window.game.setZoom(1); });
  for (let i = 0; i < 12; i++) await page.keyboard.press('Minus');
  const zKeyMin = await ev(() => window.game.state.camera.z);
  for (let i = 0; i < 20; i++) await page.keyboard.press('Equal');
  const zKeyMax = await ev(() => window.game.state.camera.z);
  if (Math.abs(zKeyMin - 0.5) < 1e-6 && Math.abs(zKeyMax - 2.0) < 1e-6) ok('G5e', `клавиши −/+: ${zKeyMin}…${zKeyMax}`);
  else bad('G5e', `клавиши: ${zKeyMin}…${zKeyMax}, ждали 0.5/2.0`);

  // на 0.5 вся 96×64 влезает в обзор (96 тайлов * 32px = 3072px ≤ 1600/0.5 = 3200)
  await ev(() => { window.game.setZoom(0.5); });
  await wait(250);
  const coverage = await ev(() => {
    const g = window.game, st = g.state;
    const vw = g.cssW / st.camera.z, vh = g.cssH / st.camera.z;
    return { vw, vh, pxW: st.map.pxW, pxH: st.map.pxH, camX: st.camera.x, camY: st.camera.y };
  });
  if (coverage.vw >= coverage.pxW && coverage.vh >= coverage.pxH) {
    ok('G5f', `на 0.5 обзор ${Math.round(coverage.vw)}×${Math.round(coverage.vh)} покрывает карту ${coverage.pxW}×${coverage.pxH} (камера центрируется)`);
  } else bad('G5f', `обзор ${Math.round(coverage.vw)}×${Math.round(coverage.vh)} < карта ${coverage.pxW}×${coverage.pxH}`);
  await shot('g_zoom_min');
  await ev(() => { window.game.setZoom(2.0); });
  await wait(250);
  await shot('g_zoom_max');

  // ── Ш6 G.2: панель справа, база в центре ВИДИМОЙ области ───────────────
  await page.locator('#panel-pos').click(); await wait(250); // низ → слева
  await page.locator('#panel-pos').click(); await wait(250); // слева → справа
  await ev(() => { window.dispatchEvent(new Event('resize')); });
  await wait(300);
  const panelState = await ev(() => {
    const g = window.game;
    return {
      cls: document.body.className,
      right: g.uiRight || 0, left: g.uiLeft || 0, top: g.uiTop || 0, bottom: g.uiBottom || 0,
      cssW: g.cssW, cssH: g.cssH,
    };
  });
  if (panelState.cls.includes('panel-right') && panelState.right > 100) {
    ok('G2a', `body.panel-right, инсеты R=${panelState.right} L=${panelState.left} T=${panelState.top}`);
  } else bad('G2a', `классы «${panelState.cls}», инсеты R=${panelState.right}`);

  // центр камеры в центре карты → точный центр ВИДИМОЙ области (без клампа),
  // затем прыжок к КЦ: КЦ видим и НЕ под панелью (координаты зданий — пиксели)
  const baseInfo = await ev(() => {
    const st = window.game.state;
    const g = window.game;
    const cx = st.map.pxW / 2, cy = st.map.pxH / 2;
    g.centerCamera(cx, cy);
    const p1 = g.worldToScreen(cx, cy);
    const cc = st.buildings.find((b) => b.side === 'player' && b.type === 'cc' && !b.dead);
    if (!cc) return null;
    const wx = cc.x + (cc.w || 4) * 16, wy = cc.y + (cc.h || 3) * 16;
    g.centerCamera(wx, wy);
    const p2 = g.worldToScreen(wx, wy);
    return {
      centerSx: p1.x, centerSy: p1.y,
      visCenterX: (g.uiLeft + (g.cssW - g.uiLeft - g.uiRight) / 2),
      visCenterY: (g.uiTop + (g.cssH - g.uiTop - g.uiBottom) / 2),
      ccSx: p2.x, ccSy: p2.y,
      panelLeftEdge: g.cssW - g.uiRight,
      visTop: g.uiTop, visBottom: g.cssH - g.uiBottom,
    };
  });
  if (!baseInfo) {
    bad('G2b', 'КЦ игрока не найден на карте скирмиша');
  } else {
    const dx = Math.abs(baseInfo.centerSx - baseInfo.visCenterX);
    const dy = Math.abs(baseInfo.centerSy - baseInfo.visCenterY);
    const ccVisible = baseInfo.ccSx >= 0 && baseInfo.ccSx < baseInfo.panelLeftEdge - 8
      && baseInfo.ccSy >= baseInfo.visTop && baseInfo.ccSy <= baseInfo.visBottom;
    if (dx < 3 && dy < 3 && ccVisible) {
      ok('G2b', `центр карты точно в центре видимой области (dx=${Math.round(dx)} dy=${Math.round(dy)}); КЦ на экране (${Math.round(baseInfo.ccSx)}, ${Math.round(baseInfo.ccSy)}) — панель с ${Math.round(baseInfo.panelLeftEdge)}, КЦ не под ней`);
    } else {
      bad('G2b', `dx=${Math.round(dx)} dy=${Math.round(dy)} ccVisible=${ccVisible} (КЦ ${Math.round(baseInfo.ccSx)}, ${Math.round(baseInfo.ccSy)})`);
    }
  }
  await shot('g_panel_right_base');

  // ── Ш7 G.4: ПКМ-ремонт — 4 техника, чинят ≤2, излишек добывает ────────
  // Приказ ПКМ идёт через mousedown button:2 → issueRMB (contextmenu только
  // preventDefault). Выделение — st.selection (st.sel у движка нет).
  const repairSpread = await ev(() => {
    const g = window.game, st = g.state;
    const cc = st.buildings.find((b) => b.side === 'player' && b.type === 'cc' && !b.dead);
    if (!cc) return { err: 'нет КЦ' };
    cc.hp = cc.maxHp * 0.4; // повреждаем свой КЦ
    const workers = st.units.filter((u) => u.side === 'player' && !u.dead && u.type === 'worker').slice(0, 4);
    if (workers.length < 4) return { err: `техников ${workers.length}` };
    st.selection = workers;
    workers.forEach((u) => { u.selected = true; });
    // x/y здания — центр в пикселях; клик точно в него гарантированно
    // внутри футпринта (b.tx/b.ty — тайлы, buildingAt ищет по ним)
    const wx = cc.x, wy = cc.y;
    const wts = g.worldToScreen(wx, wy);
    const r = document.getElementById('game-canvas').getBoundingClientRect();
    const sx = wts.x + r.left, sy = wts.y + r.top;
    window.game.mouse.x = wts.x; window.game.mouse.y = wts.y;
    const cv = document.getElementById('game-canvas');
    cv.dispatchEvent(new MouseEvent('mousedown', {
      clientX: sx, clientY: sy, bubbles: true, cancelable: true, button: 2, buttons: 2,
    }));
    cv.dispatchEvent(new MouseEvent('contextmenu', {
      clientX: sx, clientY: sy, bubbles: true, cancelable: true, button: 2, buttons: 2,
    }));
    return { ordered: workers.length, zoom: st.camera.z, ordersAfter: workers.map((u) => (u.order && u.order.kind) || 'idle'), over: !!st.over };
  });
  await wait(1400);
  if (repairSpread.err) {
    bad('G4a', `этап постановки: ${repairSpread.err}`);
  } else {
    console.log(`      [diag] zoom=${repairSpread.zoom} ordersAfter=[${repairSpread.ordersAfter}] over=${repairSpread.over}`);
    const orders = await ev(() => {
      const st = window.game.state;
      return st.units
        .filter((u) => u.side === 'player' && !u.dead && u.type === 'worker')
        .map((u) => (u.order && u.order.kind) || 'idle');
    });
    const rep = orders.filter((k) => k === 'repair').length;
    const gath = orders.filter((k) => k === 'gather').length;
    if (rep >= 1 && rep <= 2 && rep + gath >= 3) {
      ok('G4a', `4 техника ПКМ на КЦ: чинят ${rep} (кап 2), добывают ${gath}, прочее [${orders.join(',')}]`);
    } else {
      bad('G4a', `чинят ${rep}, добывают ${gath}, все: [${orders.join(',')}] — ждали ≤2 ремонтников`);
    }
  }

  // ── Ш8 назад: скирмиш → миссии, выход → меню ──────────────────────────
  await page.keyboard.press('Escape'); await wait(300);
  // кнопка Выход в хедере — по тексту
  const exitBtn = page.locator('button', { hasText: 'Выход' }).first();
  if (await exitBtn.isVisible().catch(() => false)) {
    await exitBtn.click(); await wait(500);
  } else {
    await ev(() => { const b = [...document.querySelectorAll('button')].find((x) => /выход/i.test(x.textContent)); if (b) b.click(); });
    await wait(500);
  }
  const backToMenu = await page.locator('#btn-season1').isVisible();
  if (backToMenu) ok('G6e', 'Выход из скирмиша → меню с сезонами');
  else bad('G6e', 'после Выхода меню с сезонами не показано');

  await page.locator('#btn-season1').click(); await wait(400);
  await page.locator('#btn-missions-skirmish').click(); await wait(400);
  await page.locator('#btn-skirmish-back').click(); await wait(400);
  const cardsAgain = await page.locator('.mission-card').count();
  if (cardsAgain >= 15) ok('G6f', 'миссии ⇄ скирмиш: «← Назад» возвращает к карточкам');
  else bad('G6f', `после Назада карточек ${cardsAgain}`);

  // ── Ш9 pageerrors ──────────────────────────────────────────────────────
  if (errors.length === 0) ok('ERR', 'pageerrors/console-ошибок 0 за весь прогон');
  else bad('ERR', `ошибок ${errors.length}: ${errors.slice(0, 4).join(' | ')}`);
} catch (e) {
  bad('FATAL', e.message);
  try { await shot('g_fatal'); } catch {}
}

await browser.close();
console.log(process.exitCode ? 'ИТОГ БРАУЗЕРНОЙ ПРИЁМКИ: ЕСТЬ ОТКАЗЫ' : 'ИТОГ БРАУЗЕРНОЙ ПРИЁМКИ: ВСЕ ШАГИ ПРОШЛИ');
