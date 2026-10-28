// ============================================================
// sim_capsule_fit.mjs — P1-фоллоуап (жалоба владельца 27.10.2026, стенд :8806,
// телефон 390×844): «после блока капсул ничего не нажимается» + «блок капсул
// надо переделать: всё должно быть видно без вертикальной прокрутки».
//
// Корень, найденный живым прогоном (playwright, мобильная эмуляция):
//   .chest-box скроллился ЦЕЛИКОМ (max-height + overflow-y:auto), и подвал
//   с кнопкой «На базу» оказывался ЗА нижней кромкой экрана (foot bottom
//   838.9 при box bottom 793). Сам overlay при этом застилал весь экран,
//   а его подложка не была видна (box на всю ширину 390px) — закрыть блок
//   было нечем, и со стороны это выглядело как «невидимый слой, ничего
//   не нажимается», включая клики по базе.
//
// Что доказываем (реальный Chromium, вьюпорт 390×844, isMobile+hasTouch):
//   PASS 1  панель капсул целиком в вьюпорте: box И кнопка «На базу» видимы,
//           страница не имеет вертикального скролла (scrollHeight ≤ innerHeight);
//   PASS 2  кнопка «На базу» реально ловит нажатие в центре своего прямоугольника
//           (document.elementFromPoint === кнопка, а не подложка оверлея);
//   PASS 3  после закрытия капсул ни один оверлей не перекрывает ввод:
//           elementFromPoint в центре экрана — канвас игры;
//   PASS 4  клики доходят до базы: тап по КЦ выделяет его (state.selected).
//
// Запуск: node scripts/sim_capsule_fit.mjs
// (сам поднимает статик :8836 + сейв-сервер :8796 с временной БД)
// ============================================================
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STATIC_PORT = Number(process.env.SIM_STATIC_PORT || 8836);
const API_PORT = Number(process.env.SIM_API_PORT || 8796);
const URL_BASE = `http://127.0.0.1:${STATIC_PORT}`;

const pass = (m) => console.log('PASS ' + m);
const fail = (m) => { console.error('FAIL ' + m); process.exitCode = 1; };

const tmp = mkdtempSync(join(tmpdir(), 'ac-capsule-'));
const procs = [];
const start = (name, args, env) => {
  const p = spawn(process.execPath, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: 'ignore' });
  procs.push(p);
  return p;
};
start('save', ['server/save-server.mjs'], { PORT: String(API_PORT), DB_PATH: join(tmp, 'saves.db') });
start('static', ['server/static.mjs'], { PORT: String(STATIC_PORT), API_PORT: String(API_PORT) });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitHealth() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`${URL_BASE}/health`);
      if (r.ok) return true;
    } catch { /* ещё не поднялся */ }
    await sleep(250);
  }
  return false;
}

try {
  if (!(await waitHealth())) throw new Error('стенд не поднялся (static/save-server)');

  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true, hasTouch: true, deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${URL_BASE}/r/`, { waitUntil: 'load' });

  // ace#4: guest entry is an explicit choice, no automatic simulation startup.
  await page.locator('#auth-close').click();

  // Автопоказ капсул при входе (maybeShowOnEntry, задержка 900 мс).
  await page.waitForSelector('#chest-overlay:not(.hidden)', { timeout: 15000 });
  await sleep(300);

  // PASS 1: панель целиком во вьюпорте, страница без вертикального скролла.
  const geo = await page.evaluate(() => {
    const vp = { w: innerWidth, h: innerHeight };
    const rectIn = (el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
    };
    const box = document.querySelector('.chest-box');
    const close = document.querySelector('#chest-close');
    const closeCenter = (() => {
      const r = close.getBoundingClientRect();
      const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return el ? (el.id === 'chest-close' || close.contains(el) ? 'button' : (el.id || el.tagName)) : 'none';
    })();
    const doc = document.documentElement;
    return {
      vp,
      box: rectIn(box),
      close: rectIn(close),
      closeCenter,
      pageScrollH: Math.max(doc.scrollHeight, document.body.scrollHeight),
      innerH: innerHeight,
    };
  });
  const boxFits = geo.box.top >= 0 && geo.box.bottom <= geo.vp.h && geo.box.left >= 0 && geo.box.right <= geo.vp.w;
  const closeFits = geo.close.top >= 0 && geo.close.bottom <= geo.vp.h;
  const noPageScroll = geo.pageScrollH <= geo.innerH;
  if (!(boxFits && closeFits && noPageScroll)) {
    fail(`панель не вписана в 390×844: box=${JSON.stringify(geo.box)} close=${JSON.stringify(geo.close)} pageScrollH=${geo.pageScrollH}/${geo.innerH}`);
  } else {
    pass('капсулы: панель и кнопка «На базу» целиком в 390×844, без вертикальной прокрутки страницы');
  }

  // PASS 2: кнопка закрытия реально ловит ввод (не перекрыта подложкой).
  if (geo.closeCenter !== 'button') {
    fail(`кнопка «На базу» перекрыта: elementFromPoint = ${geo.closeCenter}`);
  } else {
    pass('капсулы: кнопка «На базу» ловит нажатие (elementFromPoint — кнопка, не подложка)');
  }

  // PASS 3: после закрытия ввод доходит до канваса.
  await page.tap('#chest-close');
  await sleep(500);
  const after = await page.evaluate(() => {
    const chest = document.querySelector('#chest-overlay');
    const cs = chest ? getComputedStyle(chest) : null;
    const el = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    return {
      chestCls: chest ? chest.className : 'absent',
      chestDisplay: cs && cs.display,
      chestPE: cs && cs.pointerEvents,
      center: el ? (el.id || el.tagName) : 'none',
    };
  });
  const hiddenOk = after.chestDisplay === 'none' || after.chestPE === 'none';
  if (!hiddenOk || after.center !== 'game-canvas') {
    fail(`после закрытия капсул ввод перекрыт: display=${after.chestDisplay} pe=${after.chestPE} elementFromPoint=${after.center}`);
  } else {
    pass('капсулы: после закрытия ни один оверлей не перекрывает ввод (elementFromPoint — канвас)');
  }

  // PASS 4: клик по базе выделяет КЦ.
  const ccSel = await page.evaluate(() => {
    const g = window.game, st = g.state;
    const cc = (st.buildings || []).find((b) => !b.dead && b.side === 'player' && b.type === 'cc');
    if (!cc) return { ok: false, why: 'нет КЦ' };
    const s = g.worldToScreen(cc.x, cc.y);
    return { ok: true, x: Math.round(s.x), y: Math.round(s.y), cc };
  });
  if (!ccSel.ok) {
    fail('КЦ не найден на базе — клик по базе не проверить');
  } else {
    const x = Math.min(389, Math.max(0, ccSel.x)), y = Math.min(843, Math.max(60, ccSel.y));
    await page.tap('#game-canvas', { position: { x, y }, timeout: 8000 });
    await sleep(400);
    const sel = await page.evaluate(() => {
      const st = window.game.state;
      const cc = (st.buildings || []).find((b) => !b.dead && b.side === 'player' && b.type === 'cc');
      return !!(cc && cc.selected);
    });
    if (!sel) fail('тап по базе не выделил КЦ (ввод до игры не дошёл)');
    else pass('база: тап по КЦ выделяет командный центр (клики доходят до игры)');
  }

  if (errors.length) fail('ошибки страницы: ' + errors.slice(0, 3).join(' | '));

  await browser.close();
} catch (e) {
  fail(String((e && e.message) || e));
} finally {
  for (const p of procs) { try { p.kill(); } catch { /* */ } }
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
}
if (process.exitCode) process.exit(1);
