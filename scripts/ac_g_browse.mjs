// ac_g_browse.mjs — browser acceptance for the R2-C menu and retained G shell.
// Covers six inline presets, one-action restore, campaign separation, focus,
// touch, responsive widths, season teaser, zoom, panel geometry and repair.
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
  // ── R2-C: main menu, first-run guidance, campaign, and responsive shell ──
  await page.addInitScript(() => {
    localStorage.setItem('terranrts.language', 'ru');
    localStorage.removeItem('terranrts.progress');
  });
  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await wait(1000);

  const badgeVisible = await page.locator('#ver-badge').isVisible();
  const badgeText = (await page.locator('#ver-badge').textContent() || '').trim();
  if (badgeVisible && badgeText === 'версия L · 21.10.2026') ok('V1', `badge: ${badgeText}`);
  else bad('V1', `visible=${badgeVisible}, text="${badgeText}"`);

  const quickVisible = await page.locator('#quick-battle').isVisible();
  const presetCount = await page.locator('#quick-map-grid [data-preset-id]').count();
  const campaignLabel = (await page.locator('#btn-start').textContent() || '').trim();
  const s2Teaser = await page.locator('#btn-season2.season-teaser').count();
  const universeLabel = (await page.locator('#btn-codex').textContent() || '').trim();
  if (quickVisible && presetCount === 6 && campaignLabel.includes('Начать кампанию')) ok('R2a', `quick battle visible with ${presetCount} presets; campaign label is separate`);
  else bad('R2a', `quick=${quickVisible}, presets=${presetCount}, campaign="${campaignLabel}"`);
  if (s2Teaser === 1 && universeLabel === 'Вселенная') ok('R2b', `secondary links: Season 2 teaser / ${universeLabel}`);
  else bad('R2b', `teaser=${s2Teaser}, universe="${universeLabel}"`);

  const blockedBeforeSide = await page.locator('#btn-quick-battle-start').getAttribute('aria-disabled');
  const firstGuidance = (await page.locator('#quick-battle-status').textContent() || '').trim();
  if (blockedBeforeSide === 'true' && firstGuidance.includes('64×64')) ok('R2c', 'first run recommends 64×64 and waits for an explicit side');
  else bad('R2c', `aria-disabled=${blockedBeforeSide}, guidance="${firstGuidance}"`);
  await page.locator('#btn-quick-battle-start').click();
  const blockedStill = await ev(() => window.game.started === false);
  if (blockedStill) ok('R2d', 'CTA does not start without a faction');
  else bad('R2d', 'battle started with no faction');

  await page.locator('#btn-season2').click();
  await wait(350);
  const toast = await ev(() => (document.querySelector('#toasts') || document.body).textContent || '');
  if (/Сезон 2/.test(toast) && /Скоро/i.test(toast)) ok('R2e', 'Season 2 teaser still shows its toast');
  else bad('R2e', `toast not found: "${toast.slice(-120)}"`);
  await shot('r2_home_1280');

  for (const [width, height] of [[320, 568], [720, 900], [1280, 800]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => { const box = document.querySelector('#overlay .menu-box'); if (box) box.scrollTop = 0; });
    const metrics = await ev(() => {
      const menu = document.querySelector('#overlay .menu-box');
      const bounds = (node) => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
      return {
        viewport: innerWidth,
        docWidth: document.documentElement.scrollWidth,
        menu: bounds(menu),
        menuClient: menu.clientWidth,
        menuScroll: menu.scrollWidth,
        presets: [...document.querySelectorAll('#quick-map-grid button')].map(bounds),
      };
    });
    const clipped = metrics.presets.some((r) => r.left < metrics.menu.left - 1 || r.right > metrics.menu.right + 1 || r.left < 0 || r.right > width + 1);
    if (metrics.docWidth <= width + 1 && metrics.menuScroll <= metrics.menuClient + 1 && !clipped) ok(`R2-layout-${width}`, `no horizontal overflow; six preset cards fit`);
    else bad(`R2-layout-${width}`, `doc=${metrics.docWidth}/${width}, menu=${metrics.menuScroll}/${metrics.menuClient}, clipped=${clipped}`);
    await page.locator('#btn-quick-battle-start').scrollIntoViewIfNeeded();
    const cta = await page.locator('#btn-quick-battle-start').boundingBox();
    if (cta && cta.x >= -1 && cta.x + cta.width <= width + 1 && cta.y >= -1 && cta.y + cta.height <= height + 1) ok(`R2-cta-${width}`, 'CTA can be reached fully inside the viewport');
    else bad(`R2-cta-${width}`, `CTA bounds: ${JSON.stringify(cta)}`);
    if (width === 320) await shot('r2_home_320x568');
    if (width === 720) await shot('r2_home_720');
  }

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(() => { const box = document.querySelector('#overlay .menu-box'); if (box) box.scrollTop = 0; });
  await page.locator('#btn-season1').click();
  await wait(450);
  const cards = await page.locator('.mission-card').count();
  const oldSkirmish = await page.locator('#btn-missions-skirmish').count();
  if (cards >= 15 && oldSkirmish === 0) ok('R2f', `campaign archive has ${cards} missions; no competing battle entry`);
  else bad('R2f', `missions=${cards}, old quick-battle entry=${oldSkirmish}`);
  await shot('r2_campaign');
  await page.locator('#btn-missions-back').click();

  // Keyboard activation, then actual touch taps on the native button cards.
  await page.locator('#quick-preset-square-48').focus();
  await page.keyboard.press('Enter');
  await page.locator('#quick-faction-human').focus();
  await page.keyboard.press('Enter');
  const keyboardSelected = await ev(() => ({
    map: document.querySelector('#quick-preset-square-48').getAttribute('aria-pressed'),
    side: document.querySelector('#quick-faction-human').getAttribute('aria-pressed'),
    focus: document.activeElement && document.activeElement.id,
  }));
  if (keyboardSelected.map === 'true' && keyboardSelected.side === 'true' && keyboardSelected.focus === 'quick-faction-human') ok('R2g', 'map and faction cards are keyboard-operable with visible focus');
  else bad('R2g', `keyboard state: ${JSON.stringify(keyboardSelected)}`);

  await page.locator('#quick-preset-wide-96x64').tap();
  await page.locator('#quick-faction-alien').tap();
  const signature = (await page.locator('#btn-quick-battle-start').textContent() || '').trim();
  if (signature.includes('96×64') && signature.includes('КХАРИД')) ok('R2h', `touch selection updates the signed CTA: ${signature}`);
  else bad('R2h', `touch config missing from CTA: ${signature}`);
  await page.locator('#btn-quick-battle-start').tap();
  await wait(1600);
  const firstBattle = await ev(() => ({
    id: window.game.mission.id,
    faction: window.game.mission.faction,
    w: window.game.state.map.w,
    h: window.game.state.map.h,
  }));
  if (firstBattle.id === -1 && firstBattle.faction === 'alien' && firstBattle.w === 96 && firstBattle.h === 64) ok('R2i', 'touch-launched battle received the correct faction and 96×64 dimensions');
  else bad('R2i', `wrong battle config: ${JSON.stringify(firstBattle)}`);
  await shot('r2_quick_battle_96x64');

  // Reload confirms that the last played setup is ready for a one-tap launch.
  await page.reload({ waitUntil: 'load' });
  await wait(850);
  const restored = await ev(() => ({
    map: document.querySelector('#quick-preset-wide-96x64').getAttribute('aria-pressed'),
    side: document.querySelector('#quick-faction-alien').getAttribute('aria-pressed'),
    status: document.querySelector('#quick-battle-status').textContent,
  }));
  if (restored.map === 'true' && restored.side === 'true' && /Последняя конфигурация/.test(restored.status)) ok('R2j', 'reload restores the last map and faction');
  else bad('R2j', `restore state: ${JSON.stringify(restored)}`);
  await page.locator('#btn-quick-battle-start').tap();
  await wait(1500);
  const repeatBattle = await ev(() => ({ id: window.game.mission.id, faction: window.game.mission.faction, w: window.game.state.map.w, h: window.game.state.map.h }));
  if (repeatBattle.id === -1 && repeatBattle.faction === 'alien' && repeatBattle.w === 96 && repeatBattle.h === 64) ok('R2k', 'restored setup launches with one action');
  else bad('R2k', `repeat config: ${JSON.stringify(repeatBattle)}`);
  await shot('r2_repeat_battle');

  await page.setViewportSize({ width: 1600, height: 1500 });
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

  // At 0.5 the 96×64 world should fit the viewport when the 1280px wide layout allows it.
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
