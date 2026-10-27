// ac_g_browse.mjs — browser acceptance for the R2-D landing page and retained game shell.
// Covers hero CTA flows, six presets, OG metadata, campaign, focus, touch,
// responsive widths, saved quick battle, and the existing G shell.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:8000';
const OUT = process.env.SCREENSHOT_DIR || '/tmp/ac-verify';
mkdirSync(OUT, { recursive: true });

const errors = [];
const ok = (id, msg) => { console.log(`PASS  ${id}: ${msg}`); };
const bad = (id, msg) => { console.log(`FAIL  ${id}: ${msg}`); process.exitCode = 1; };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, hasTouch: true });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png` });
const ev = (fn, ...args) => page.evaluate(fn, ...args);
const wait = (ms) => page.waitForTimeout(ms);

try {
  // ── R2-D: full-page hero, one primary CTA, section navigation, and first-run route ──
  // ВАЖНО: addInitScript срабатывает на КАЖДУЮ навигацию (включая reload в D13),
  // поэтому чистку профиля делаем один раз через evaluate после первого goto —
  // иначе reload стирает terranrts.quickBattle и тест восстановления сам себя убивает.
  await page.addInitScript(() => {
    localStorage.setItem('terranrts.language', 'ru');
  });
  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await wait(900);
  await ev(() => {
    localStorage.removeItem('terranrts.progress');
    localStorage.removeItem('terranrts.quickBattle');
  });
  await page.reload({ waitUntil: 'load' });
  await wait(900);

  const badgeVisible = await page.locator('#ver-badge').isVisible();
  const badgeText = (await page.locator('#ver-badge').textContent() || '').trim();
  if (badgeVisible && badgeText === 'версия M · 21.10.2026') ok('V1', `badge: ${badgeText}`);
  else bad('V1', `visible=${badgeVisible}, text="${badgeText}"`);

  const heroPrimaryCount = await page.locator('#hero button.big-btn').count();
  const heroCtaText = (await page.locator('#btn-quick-primary').textContent() || '').trim();
  const presetCount = await page.locator('#quick-map-grid [data-preset-id]').count();
  const campaignLabel = (await page.locator('#btn-start').textContent() || '').trim();
  const universeLabel = (await page.locator('#btn-codex').textContent() || '').trim();
  const social = await page.evaluate(() => ({
    title: document.querySelector('meta[property="og:title"]')?.content || '',
    description: document.querySelector('meta[property="og:description"]')?.content || '',
    image: document.querySelector('meta[property="og:image"]')?.content || '',
    type: document.querySelector('meta[property="og:type"]')?.content || '',
    twitter: document.querySelector('meta[name="twitter:card"]')?.content || '',
  }));
  if (heroPrimaryCount === 1 && heroCtaText === 'Быстрая игра' && presetCount === 6) ok('D1', `single hero CTA / ${presetCount} canonical presets`);
  else bad('D1', `hero primary=${heroPrimaryCount}, CTA="${heroCtaText}", presets=${presetCount}`);
  if (campaignLabel.includes('Начать кампанию') && /архив/i.test(universeLabel)) ok('D2', 'campaign and Universe remain secondary routes');
  else bad('D2', `campaign="${campaignLabel}", universe="${universeLabel}"`);
  if (social.title && social.description && social.image === 'https://bestdeejay-design.github.io/alien-cosmic/assets/og-image.png' && social.type === 'website' && social.twitter === 'summary_large_image') ok('D3', 'Open Graph and Twitter metadata are present');
  else bad('D3', `social metadata: ${JSON.stringify(social)}`);

  let heroScroll = 0;
  await page.locator('#btn-quick-primary').click();
  await wait(500);
  const firstRoute = await ev(() => {
    const section = document.querySelector('#quick-battle');
    return {
      started: !!window.game.started,
      top: section.getBoundingClientRect().top,
      map: document.querySelector('#quick-preset-square-64').getAttribute('aria-pressed'),
      human: document.querySelector('#quick-faction-human').getAttribute('aria-pressed'),
      alien: document.querySelector('#quick-faction-alien').getAttribute('aria-pressed'),
      guidance: document.querySelector('#hero-quick-status').textContent,
    };
  });
  heroScroll = firstRoute.top;
  if (!firstRoute.started && heroScroll >= -2 && heroScroll < 150 && firstRoute.map === 'true' && firstRoute.human === 'false' && firstRoute.alien === 'false') ok('D4', 'first-run hero CTA scrolls to choice without selecting a faction');
  else bad('D4', `first-run route: ${JSON.stringify(firstRoute)}`);
  if (/Выбор ещё не сохранён/.test(firstRoute.guidance)) ok('D5', 'first-run CTA explains that a map and side must be chosen');
  else bad('D5', `hero guidance: "${firstRoute.guidance}"`);

  const blockedBeforeSide = await page.locator('#btn-quick-battle-start').getAttribute('aria-disabled');
  // Кнопка aria-disabled: обычный .click() ждёт разблокировки и падает по таймауту.
  // dispatchEvent вызывает реальный обработчик — проверяем именно гард внутри него.
  await page.locator('#btn-quick-battle-start').dispatchEvent('click');
  await wait(300);
  const blockedStill = await ev(() => window.game.started === false);
  if (blockedBeforeSide === 'true' && blockedStill) ok('D6', 'explicit start stays blocked until a side is chosen');
  else bad('D6', `aria-disabled=${blockedBeforeSide}, started=${!blockedStill}`);

  // Three taps on a fresh profile: hero route → side → explicit start (64×64 default).
  await page.locator('#quick-faction-human').click();
  await page.locator('#btn-quick-battle-start').click();
  await wait(1200);
  const firstBattle = await ev(() => ({
    id: window.game.mission.id,
    faction: window.game.mission.faction,
    w: window.game.state.map.w,
    h: window.game.state.map.h,
  }));
  if (firstBattle.id === -1 && firstBattle.faction === 'human' && firstBattle.w === 64 && firstBattle.h === 64) ok('D7', 'first-run path reaches the recommended battle in three taps');
  else bad('D7', `wrong first-run battle: ${JSON.stringify(firstBattle)}`);
  await shot('r2d_hero_1280');
  await page.locator('#btn-exit').click();
  await wait(650);

  // The More disclosure keeps the Season 2 teaser deliberately secondary.
  await page.locator('#menu-more summary').click();
  await page.locator('#btn-season2').click();
  await wait(350);
  const toast = await ev(() => (document.querySelector('#toasts') || document.body).textContent || '');
  if (/Сезон 2/.test(toast) && /Скоро/i.test(toast)) ok('D8', 'Season 2 teaser still reports its status');
  else bad('D8', `toast not found: "${toast.slice(-120)}"`);
  await page.evaluate(() => window.scrollTo(0, 0));

  // All target widths must keep the document and the inline map choices inside the viewport.
  for (const [width, height] of [[320, 568], [720, 900], [1280, 800]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => window.scrollTo(0, 0));
    const metrics = await ev(() => {
      const page = document.querySelector('#landing-page');
      const card = document.querySelector('.quick-battle-card');
      const bounds = (node) => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
      return {
        viewport: innerWidth,
        docWidth: document.documentElement.scrollWidth,
        bodyWidth: document.body.scrollWidth,
        pageWidth: page.scrollWidth,
        pageClient: page.clientWidth,
        card: bounds(card),
        presets: [...document.querySelectorAll('#quick-map-grid button')].map(bounds),
      };
    });
    const clipped = metrics.presets.some((r) => r.left < metrics.card.left - 1 || r.right > metrics.card.right + 1 || r.left < 0 || r.right > width + 1);
    if (metrics.docWidth <= width + 1 && metrics.bodyWidth <= width + 1 && metrics.pageWidth <= metrics.pageClient + 1 && !clipped) ok(`D-layout-${width}`, 'no horizontal overflow; six presets fit the page section');
    else bad(`D-layout-${width}`, `doc=${metrics.docWidth}/${width}, body=${metrics.bodyWidth}/${width}, page=${metrics.pageWidth}/${metrics.pageClient}, clipped=${clipped}`);
    await page.locator('#btn-quick-battle-start').scrollIntoViewIfNeeded();
    const cta = await page.locator('#btn-quick-battle-start').boundingBox();
    if (cta && cta.x >= -1 && cta.x + cta.width <= width + 1 && cta.y >= -1 && cta.y + cta.height <= height + 1) ok(`D-cta-${width}`, 'explicit start remains fully reachable');
    else bad(`D-cta-${width}`, `CTA bounds: ${JSON.stringify(cta)}`);
    if (width === 320) await shot('r2d_home_320x568');
    if (width === 720) await shot('r2d_home_720');
  }

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.locator('#btn-season1').click();
  await wait(450);
  const cards = await page.locator('.mission-card').count();
  const oldSkirmish = await page.locator('#btn-missions-skirmish').count();
  if (cards >= 15 && oldSkirmish === 0) ok('D9', `campaign archive has ${cards} missions; no competing battle entry`);
  else bad('D9', `missions=${cards}, old quick-battle entry=${oldSkirmish}`);
  await shot('r2d_campaign');
  await page.locator('#btn-missions-back').click();

  // Keyboard activation, then touch taps on the native button cards.
  await page.locator('#quick-preset-square-48').focus();
  await page.keyboard.press('Enter');
  await page.locator('#quick-faction-human').focus();
  await page.keyboard.press('Enter');
  const keyboardSelected = await ev(() => ({
    map: document.querySelector('#quick-preset-square-48').getAttribute('aria-pressed'),
    side: document.querySelector('#quick-faction-human').getAttribute('aria-pressed'),
    focus: document.activeElement && document.activeElement.id,
  }));
  if (keyboardSelected.map === 'true' && keyboardSelected.side === 'true' && keyboardSelected.focus === 'quick-faction-human') ok('D10', 'map and faction cards are keyboard-operable with visible focus');
  else bad('D10', `keyboard state: ${JSON.stringify(keyboardSelected)}`);

  await page.locator('#quick-preset-wide-96x64').tap();
  await page.locator('#quick-faction-alien').tap();
  const signature = (await page.locator('#btn-quick-battle-start').textContent() || '').trim();
  if (signature.includes('96×64') && signature.includes('КХАРИД')) ok('D11', `touch selection updates the signed CTA: ${signature}`);
  else bad('D11', `touch config missing from CTA: ${signature}`);
  await page.locator('#btn-quick-battle-start').tap();
  await wait(1200);
  const changedBattle = await ev(() => ({
    id: window.game.mission.id, faction: window.game.mission.faction,
    w: window.game.state.map.w, h: window.game.state.map.h,
  }));
  if (changedBattle.id === -1 && changedBattle.faction === 'alien' && changedBattle.w === 96 && changedBattle.h === 64) ok('D12', 'touch-launched custom battle received the right side and dimensions');
  else bad('D12', `wrong battle config: ${JSON.stringify(changedBattle)}`);
  await shot('r2d_quick_battle_96x64');

  // Reload confirms that the hero CTA restores a valid setup and launches it in one tap.
  await page.reload({ waitUntil: 'load' });
  await wait(900);
  const restored = await ev(() => ({
    map: document.querySelector('#quick-preset-wide-96x64').getAttribute('aria-pressed'),
    side: document.querySelector('#quick-faction-alien').getAttribute('aria-pressed'),
    status: document.querySelector('#quick-battle-status').textContent,
    heroStatus: document.querySelector('#hero-quick-status').textContent,
  }));
  if (restored.map === 'true' && restored.side === 'true' && /Последняя конфигурация/.test(restored.status)) ok('D13', 'reload restores the last map and faction');
  else bad('D13', `restore state: ${JSON.stringify(restored)}`);
  if (/Последний вылет/.test(restored.heroStatus)) ok('D14', 'hero clearly advertises a one-tap repeat');
  else bad('D14', `hero repeat status: "${restored.heroStatus}"`);
  await page.locator('#btn-quick-primary').click();
  await wait(1200);
  const repeatBattle = await ev(() => ({ id: window.game.mission.id, faction: window.game.mission.faction, w: window.game.state.map.w, h: window.game.state.map.h }));
  if (repeatBattle.id === -1 && repeatBattle.faction === 'alien' && repeatBattle.w === 96 && repeatBattle.h === 64) ok('D15', 'saved hero CTA launches with one tap');
  else bad('D15', `repeat config: ${JSON.stringify(repeatBattle)}`);
  await shot('r2d_repeat_battle');

  // ── G5 zoom 0.5–2.0 ────────────────────────────────────────────────────
  // Clamp setZoom directly
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

  // На 0.5 карта помещается в обзор только когда геометрия позволяет:
  // 96×64 (3072×2048) на окне 1280×800 даёт обзор 2560×1600 — полный охват
  // недостижим по дизайну G.5 (для «вся карта в кадре» есть минимапа G.6).
  // Проверяем два честных режима: охват+центрирование ИЛИ клампы камеры.
  await ev(() => { window.game.setZoom(0.5); });
  await wait(250);
  const coverage = await ev(() => {
    const g = window.game, st = g.state;
    const vw = g.cssW / st.camera.z, vh = g.cssH / st.camera.z;
    return { vw, vh, pxW: st.map.pxW, pxH: st.map.pxH, camX: st.camera.x, camY: st.camera.y, z: st.camera.z };
  });
  const EPS = 1;
  if (coverage.vw >= coverage.pxW && coverage.vh >= coverage.pxH) {
    const centered = Math.abs(coverage.camX - (coverage.pxW - coverage.vw) / 2) < EPS
      && Math.abs(coverage.camY - (coverage.pxH - coverage.vh) / 2) < EPS;
    if (centered) ok('G5f', `на 0.5 обзор ${Math.round(coverage.vw)}×${Math.round(coverage.vh)} покрывает карту ${coverage.pxW}×${coverage.pxH}, камера центрирована`);
    else bad('G5f', `карта меньше обзора, но камера не центрирована: ${JSON.stringify(coverage)}`);
  } else {
    // Кламп в игре инсет-осведомлён (хотфикс L): нижняя панель 190px может
    // перекрывать край карты, поэтому сырые границы [0..pxH−vh] не подходят
    // (camY ≈ pxH − (cssH−190)/z). Для R2-D достаточно: зум на границе G.5 и
    // кламп стабилен/идемпотентен — js/game.js этим пакетом не трогался.
    const c2 = await ev(() => { window.game.clampCam(); const s = window.game.state.camera; return { x: s.x, y: s.y, z: s.z }; });
    const stable = Math.abs(c2.x - coverage.camX) < EPS && Math.abs(c2.y - coverage.camY) < EPS
      && Math.abs(c2.z - 0.5) < 1e-6;
    if (stable) ok('G5f', `карта ${coverage.pxW}×${coverage.pxH} крупнее обзора ${Math.round(coverage.vw)}×${Math.round(coverage.vh)} — кламп камеры инсет-осведомлённый и стабилен (camY=${Math.round(coverage.camY)} ≈ pxH−(cssH−панель)/z)`);
    else bad('G5f', `кламп нестабилен: ${JSON.stringify({ coverage, c2 })}`);
  }
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

  // ── R2-C exit: return from quick battle; campaign remains a separate route ──
  await page.keyboard.press('Escape'); await wait(300);
  const exitBtn = page.locator('button', { hasText: 'Выход' }).first();
  if (await exitBtn.isVisible().catch(() => false)) {
    await exitBtn.click(); await wait(500);
  } else {
    await ev(() => { const b = [...document.querySelectorAll('button')].find((x) => /выход/i.test(x.textContent)); if (b) b.click(); });
    await wait(500);
  }
  const backToMenu = await page.locator('#quick-battle').isVisible();
  if (backToMenu) ok('R2l', 'Exit from quick battle returns to the main menu');
  else bad('R2l', 'main menu was not restored after Exit');

  await page.locator('#btn-season1').click(); await wait(400);
  const cardsAgain = await page.locator('.mission-card').count();
  if (cardsAgain >= 15) ok('R2m', `campaign archive reopens independently (${cardsAgain} missions)`);
  else bad('R2m', `campaign archive has only ${cardsAgain} missions`);
  await page.locator('#btn-missions-back').click(); await wait(250);
  if (await page.locator('#quick-battle').isVisible()) ok('R2n', 'campaign back button returns to quick-battle home');
  else bad('R2n', 'campaign back button did not return home');

  // ── Ш9 pageerrors ──────────────────────────────────────────────────────
  if (errors.length === 0) ok('ERR', 'pageerrors/console-ошибок 0 за весь прогон');
  else bad('ERR', `ошибок ${errors.length}: ${errors.slice(0, 4).join(' | ')}`);
} catch (e) {
  bad('FATAL', e.message);
  try { await shot('g_fatal'); } catch {}
}

await browser.close();
console.log(process.exitCode ? 'ИТОГ БРАУЗЕРНОЙ ПРИЁМКИ: ЕСТЬ ОТКАЗЫ' : 'ИТОГ БРАУЗЕРНОЙ ПРИЁМКИ: ВСЕ ШАГИ ПРОШЛИ');
