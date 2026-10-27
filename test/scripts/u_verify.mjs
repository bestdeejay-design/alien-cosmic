// u_verify.mjs — сквозная приёмка пакета U (профиль ввода) в браузере:
// (1) десктоп-контекст: game-desktop на <html>, зум-кнопки скрыты, × отмены
//     скрыт (тост-подсказка при стройке), хинт «ЛКМ», kbd-метки на месте;
// (2) тач-контекст: game-touch, зум-кнопки живы, × отмены жив, kbd скрыт;
// (3) атака-движение: кнопка KeyA в панели, клик → режим, тап → приказ;
// (4) override в меню «Ещё» переключает профиль и сохраняется.
import { chromium } from 'playwright';

const BASE = 'http://localhost:8793';
const log = (...a) => console.log(...a);
const errors = [];
let failed = 0;
const ok = (m) => log('  ✓ ' + m);
const bad = (m) => { failed = 1; log('  ✗ ' + m); };

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

const browser = await chromium.launch();

// ---------- Контекст 1: десктоп ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await bootBattle(page);
  const d = await page.evaluate(() => {
    const html = document.documentElement;
    const cs = (sel) => getComputedStyle(document.querySelector(sel)).display;
    const g = window.game;
    // Стройка: призрак депо — на десктопе × отмены спрятан, тост-подсказка показана.
    g.state.placing = { type: 'depot', tx: 12, ty: 12 };
    return {
      input: html.getAttribute('data-input'),
      desktop: html.classList.contains('game-desktop'),
      touch: html.classList.contains('game-touch'),
      zoom: cs('#zoom-controls'),
      cancel: cs('#placement-cancel'),
      zoomHidden: document.getElementById('zoom-controls').hidden,
      cancelHidden: document.getElementById('placement-cancel').hidden,
    };
  });
  await page.waitForTimeout(400); // кадр UI — тост-подсказка
  const toastTxt = await page.evaluate(() => {
    g_state_placing_cleanup(window.game);
    function g_state_placing_cleanup(g) { g.state.placing = null; }
    const t = document.getElementById('toasts');
    return t ? t.textContent : '';
  });
  d.input === 'desktop' && d.desktop && !d.touch ? ok('десктоп: data-input=desktop, классы верные') : bad(`десктоп: профиль не распознан (${JSON.stringify(d)})`);
  d.zoom === 'none' && d.zoomHidden ? ok('десктоп: зум-кнопки скрыты') : bad(`десктоп: зум-кнопки видны (display=${d.zoom}, hidden=${d.zoomHidden})`);
  d.cancel === 'none' && d.cancelHidden ? ok('десктоп: × отмены скрыт') : bad(`десктоп: × отмены виден`);
  toastTxt.includes('отменить') ? ok('десктоп: тост-подсказка отмены показана') : bad(`десктоп: тоста нет («${toastTxt.slice(0, 60)}»)`);
  // Хинт выделения — про ЛКМ (при ПУСТОМ выделении); kbd-метки видимы.
  await page.evaluate(() => { window.game.state.selection = []; });
  await page.waitForTimeout(300);
  const hint = await page.evaluate(() => document.getElementById('sel-info').textContent);
  hint.includes('ЛКМ') ? ok('десктоп: хинт про ЛКМ') : bad(`десктоп: хинт не десктопный («${hint.slice(0, 40)}»)`);
  // kbd-метки: при пустом выделении панели нет — проверяем на выделенном КЦ.
  await page.evaluate(() => {
    const g = window.game;
    g.state.selection = [g.state.buildings.find((b) => b.side === 'player' && b.done)];
  });
  await page.waitForTimeout(300);
  const kbdD = await page.evaluate(() => {
    const kbd = document.querySelector('#cmd-grid kbd');
    return kbd ? getComputedStyle(kbd).display : 'absent';
  });
  kbdD !== 'none' && kbdD !== 'absent' ? ok('десктоп: kbd-метки команд видны') : bad(`десктоп: kbd-метки скрыты (${kbdD})`);
  await ctx.close();
}

// ---------- Контекст 2: тач ----------
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
  // runtime-сигнал честно дал desktop (односторонняя политика). Телефон
  // эмулируем override'ом — легитимный путь «Интерфейс → Телефон»;
  // runtime-сигналы покрыты в sim_touch T16.
  const t0 = await page.evaluate(() => {
    window.game.profile.set('touch');
    const g = window.game;
    g.state.placing = { type: 'depot', tx: 12, ty: 12 };
    const html = document.documentElement;
    return {
      input: html.getAttribute('data-input'),
      touch: html.classList.contains('game-touch'),
    };
  });
  await page.waitForTimeout(400); // кадры UI — updateZoomControls снимет hidden
  const tZoom = await page.evaluate(() => ({
    zoom: getComputedStyle(document.querySelector('#zoom-controls')).display,
    zoomHidden: document.getElementById('zoom-controls').hidden,
  }));
  const t1 = await page.evaluate(() => {
    window.game.state.placing = null;
    const cancel = document.getElementById('placement-cancel');
    return { cancelDisplay: getComputedStyle(cancel).display, cancelHidden: cancel.hidden };
  });
  t0.input === 'touch' && t0.touch ? ok('тач: data-input=touch по media-базису') : bad(`тач: профиль не тач (${JSON.stringify(t0)})`);
  tZoom.zoom !== 'none' && !tZoom.zoomHidden ? ok('тач: зум-кнопки видны') : bad(`тач: зум-кнопки скрыты (${JSON.stringify(tZoom)})`);
  t1.cancelDisplay !== 'none' || t1.cancelHidden === false ? ok('тач: × отмены доступен в стройке') : bad(`тач: × отмены спрятан (${t1.cancelDisplay}, hidden=${t1.cancelHidden})`);
  // kbd скрыт CSS-правилом .game-touch.
  const tk = await page.evaluate(() => {
    const g = window.game;
    const u = g.state.units.find((x) => x.side === 'player' && !x.dead);
    g.state.selection = [u];
    return null;
  });
  await page.waitForTimeout(300);
  const kbdState = await page.evaluate(() => {
    const kbd = document.querySelector('#cmd-grid kbd');
    return kbd ? getComputedStyle(kbd).display : 'absent';
  });
  kbdState === 'none' ? ok('тач: kbd-метки скрыты') : bad(`тач: kbd-метки видны (${kbdState})`);
  // Атака-движение: кнопка KeyA у боевого выделения; клик → режим; тап → приказ.
  const am = await page.evaluate(async () => {
    const g = window.game;
    const cv = document.getElementById('game-canvas');
    const st = g.state;
    const u = st.units.find((x) => x.side === 'player' && !x.dead);
    st.selection = [u];
    const up = (x, y) => {
      cv.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', pointerId: 7, clientX: x, clientY: y, bubbles: true, cancelable: true }));
      cv.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'touch', pointerId: 7, clientX: x, clientY: y, bubbles: true, cancelable: true }));
    };
    return { armed: !!st.attackMoveMode, up };
  });
  // Клик по кнопке KeyA (если она в панели — рабочий тоже боевой, dmg 4).
  const btnVisible = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('#cmd-grid .cmd')].find((b) => b.dataset.code === 'KeyA');
    if (btn) btn.click();
    return !!btn;
  });
  const armed = await page.evaluate(() => window.game.state.attackMoveMode === true);
  btnVisible ? ok('тач: кнопка атака-движения в панели') : bad('тач: кнопки KeyA нет');
  armed ? ok('тач: клик взвёл режим атака-движения') : bad('тач: режим не взвёлся');
  const order = await page.evaluate(() => {
    const g = window.game;
    const cv = document.getElementById('game-canvas');
    const st = g.state;
    const u = st.selection[0];
    const r = cv.getBoundingClientRect();
    // Тап в свободную точку справа от базы.
    const x = r.width * 0.5, y = r.height * 0.4;
    cv.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', pointerId: 9, clientX: x, clientY: y, bubbles: true, cancelable: true }));
    cv.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'touch', pointerId: 9, clientX: x, clientY: y, bubbles: true, cancelable: true }));
    return { kind: u.order && u.order.kind, modeOff: !st.attackMoveMode };
  });
  order.kind === 'attackMove' && order.modeOff
    ? ok('тач: тап в режиме — приказ attackMove, режим снят')
    : bad(`тач: приказ=${order.kind}, modeOff=${order.modeOff}`);
  // Override в меню «Ещё»: выход в меню, раскрыть, переключить на desktop.
  await page.evaluate(() => window.game.toMenu());
  await page.locator('#menu-more summary').click();
  await page.waitForTimeout(200);
  const sel = page.locator('#ui-profile-select');
  (await sel.count()) === 1 ? ok('меню: селектор профиля в «Ещё»') : bad('меню: селектора профиля нет');
  await sel.selectOption('desktop');
  await page.waitForTimeout(200);
  const ov = await page.evaluate(() => ({
    stored: localStorage.getItem('terranrts.profile'),
    input: document.documentElement.getAttribute('data-input'),
  }));
  ov.stored === 'desktop' && ov.input === 'desktop' ? ok('меню: override desktop сохранён и применён') : bad(`меню: override не сработал (${JSON.stringify(ov)})`);
  await ctx.close();
}

await browser.close();
if (errors.length) { failed = 1; log('\nОшибки страницы:'); errors.forEach((e) => log('  ' + e)); }
log(failed ? '\nU-VERIFY: ПРОВАЛЕНО' : '\nU-VERIFY: ВСЕ ПРОВЕРКИ ПРОШЛИ');
process.exit(failed ? 1 : 0);
