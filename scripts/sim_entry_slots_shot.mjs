// ============================================================
// sim_entry_slots_shot.mjs — Г1-артефакт: скриншоты шага «сторона»
// (телефон 390×844 и десктоп) живым Chromium, по образцу sim_capsule_fit.
//
// Что доказываем:
//   PASS 1  телефон 390×844: шаг «сторона» открыт автоматически (первое
//           касание), обе карточки с бейджами целиком во вьюпорте,
//           страница без вертикального скролла;
//   PASS 2  десктоп 1280×800: обе карточки видны, бейджи читаются.
// Скриншоты складываются в SHOT_DIR (по умолчанию .shots/entry-slots).
//
// Запуск: node scripts/sim_entry_slots_shot.mjs
// ============================================================
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STATIC_PORT = Number(process.env.SIM_STATIC_PORT || 8837);
const API_PORT = Number(process.env.SIM_API_PORT || 8797);
const URL_BASE = `http://127.0.0.1:${STATIC_PORT}`;
const SHOT_DIR = process.env.SHOT_DIR || join(ROOT, '.shots', 'entry-slots');

const pass = (m) => console.log('PASS ' + m);
const fail = (m) => { console.error('FAIL ' + m); process.exitCode = 1; };

const tmp = mkdtempSync(join(tmpdir(), 'ac-slots-'));

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
  mkdirSync(SHOT_DIR, { recursive: true });

  const { chromium } = await import('playwright');
  const browser = await chromium.launch();

  const shoot = async ({ width, height, isMobile, hasTouch, name }) => {
    const ctx = await browser.newContext({
      viewport: { width, height },
      isMobile: !!isMobile, hasTouch: !!hasTouch, deviceScaleFactor: isMobile ? 2 : 1,
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    // Канон полигона — русский интерфейс (raid-boot 25.10): задаём язык ДО
    // загрузки, как у вернувшегося RU-посетителя (иначе свежий браузер стенда
    // с en-US успевает отрисовать оверлей на en: boot не ждёт async setLocale).
    await page.addInitScript(() => { try { localStorage.setItem('terranrts.language', 'ru'); } catch { /* */ } });
    await page.goto(`${URL_BASE}/r/`, { waitUntil: 'load' });
    // Матрица первого экрана (бриф §2.3): без identity и слотов гейт открывает шаг стороны.
    await page.waitForSelector('#auth-body .fac-card.fac-human', { timeout: 15000 });
    await page.waitForSelector('#auth-body .fac-card.fac-alien', { timeout: 5000 });
    await sleep(250);
    const geo = await page.evaluate(() => {
      const vp = { w: innerWidth, h: innerHeight };
      const rectOf = (el) => {
        const r = el.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
      };
      const q = (s) => document.querySelector(s);
      return {
        vp,
        doc: { scrollHeight: document.documentElement.scrollHeight },
        human: rectOf(q('#auth-body .fac-card.fac-human')),
        alien: rectOf(q('#auth-body .fac-card.fac-alien')),
        badgeHuman: (q('#auth-body .fac-card.fac-human .ac-badge') || {}).textContent || '',
        badgeAlien: (q('#auth-body .fac-card.fac-alien .ac-badge') || {}).textContent || '',
        title: (q('#auth-title') || {}).textContent || '',
      };
    });
    const fits = (r) => r.top >= 0 && r.left >= 0 && r.bottom <= geo.vp.h && r.right <= geo.vp.w;
    const noScroll = geo.doc.scrollHeight <= geo.vp.h + 1;
    const bothFit = fits(geo.human) && fits(geo.alien);
    const badges = geo.badgeHuman.trim().length > 0 && geo.badgeAlien.trim().length > 0;
    if (!bothFit || !noScroll || !badges) {
      fail(`${name}: карточки/бейджи/фит — ${JSON.stringify({ bothFit, noScroll, badges, geo })}`);
    } else {
      pass(`${name}: шаг «сторона» целиком во вьюпорте ${geo.vp.w}×${geo.vp.h}, бейджи на обеих карточках, скролла страницы нет`);
    }
    await page.screenshot({ path: join(SHOT_DIR, name + '.png'), fullPage: false });
    if (errors.length) fail(`${name}: ошибки страницы — ${errors.join(' | ')}`);
    await ctx.close();
  };

  await shoot({ width: 390, height: 844, isMobile: true, hasTouch: true, name: 'side-mobile-390x844' });
  await shoot({ width: 1280, height: 800, name: 'side-desktop-1280x800' });

  // ---- Г2-артефакты: экран слотов, панель профиля, экран после выхода ----
  const day = 24 * 3600 * 1000;
  const rec = (nick, side, ccLevel, ageMs) => ({ nick, side, ccLevel, baseId: 'AB12-' + nick, lastPlayed: Date.now() - ageMs });
  const seed = (js) => `try{${js}}catch(e){}`;
  const seedSlots = (recs) => seed(`localStorage.setItem('ac_entry_slots_v1', ${JSON.stringify(JSON.stringify({ slots: recs }))});`);

  const shootSlotsScreen = async ({ recs, name, width, height, isMobile }) => {
    const ctx = await browser.newContext({
      viewport: { width, height }, isMobile: !!isMobile, hasTouch: !!isMobile, deviceScaleFactor: isMobile ? 2 : 1,
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    // Матрица §2.3: identity нет, слоты есть → гейт сам открывает экран слотов.
    await page.addInitScript(seedSlots(recs));
    await page.addInitScript(seed(`localStorage.setItem('terranrts.language','ru');`));
    await page.goto(`${URL_BASE}/r/`, { waitUntil: 'load' });
    await page.waitForSelector('#slots-overlay', { timeout: 15000 });
    await page.waitForSelector('#slots-grid .slot-card', { timeout: 5000 });
    await sleep(300);
    const geo = await page.evaluate(() => {
      const box = document.querySelector('.slots-box');
      const r = box.getBoundingClientRect();
      return {
        cards: document.querySelectorAll('#slots-grid .slot-card').length,
        empty: document.querySelectorAll('#slots-grid .slot-card.is-empty').length,
        guest: !!document.querySelector('#slots-guest'),
        vp: { w: innerWidth, h: innerHeight },
        box: { top: r.top, bottom: r.bottom, left: r.left, right: r.right },
        scroll: document.documentElement.scrollHeight,
      };
    });
    const fits = geo.box.top >= 0 && geo.box.left >= 0 && geo.box.bottom <= geo.vp.h && geo.box.right <= geo.vp.w
      && geo.scroll <= geo.vp.h + 1;
    if (geo.cards !== 8 || !geo.guest || !fits) {
      fail(`${name}: слоты/фит — ${JSON.stringify(geo)}`);
    } else {
      pass(`${name}: экран слотов — 8 карточек (${recs.length} заполненных), гостевая ссылка, влезает в ${geo.vp.w}×${geo.vp.h} без скролла`);
    }
    await page.screenshot({ path: join(SHOT_DIR, name + '.png') });
    if (errors.length) fail(`${name}: ошибки страницы — ${errors.join(' | ')}`);
    await ctx.close();
  };

  await shootSlotsScreen({ recs: [rec('best', 'human', 16, 3600e3), rec('kira', 'alien', 9, day)], name: 'slots-screen-2of8-390x844', width: 390, height: 844, isMobile: true });
  await shootSlotsScreen({ recs: [rec('best', 'human', 16, 3600e3), rec('kira', 'alien', 9, day)], name: 'slots-screen-2of8-desktop', width: 1280, height: 800 });
  await shootSlotsScreen({
    recs: Array.from({ length: 8 }, (_, i) => rec('p' + i, i % 2 ? 'alien' : 'human', 3 + i, (i + 1) * day)),
    name: 'slots-screen-overflow-390x844', width: 390, height: 844, isMobile: true,
  });

  // Панель профиля с сеткой + экран после выхода (живой вход на стенде).
  const shootPanelAndExit = async ({ width, height, isMobile, name }) => {
    const ctx = await browser.newContext({
      viewport: { width, height }, isMobile: !!isMobile, hasTouch: !!isMobile, deviceScaleFactor: isMobile ? 2 : 1,
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(seed(
      `localStorage.setItem('terranrts.language','ru');` +
      `localStorage.setItem('ac_save_nick','best');` +
      `localStorage.setItem('ac_save_pin','1234');` +
      `localStorage.setItem('ac_entry_slots_v1', ${JSON.stringify(JSON.stringify({ slots: [rec('kira', 'alien', 9, day)] }))});`
    ));
    await page.goto(`${URL_BASE}/r/`, { waitUntil: 'load' });
    await page.waitForSelector('#auth-body #auth-next', { timeout: 15000 });
    await page.click('#auth-next');                       // ник предзаполнен ('best')
    await page.waitForSelector('#auth-pad', { timeout: 5000 });
    for (const k of ['1', '2', '3', '4']) await page.click(`#auth-pad [data-key="${k}"]`);
    await page.click('#auth-enter');
    await page.waitForFunction(() => window.game && window.game.started === true, null, { timeout: 20000 });
    await page.evaluate(() => window.showProfilePanel());
    await page.waitForSelector('#sv-slots .slot-card', { timeout: 5000 });
    await sleep(300);
    const geo = await page.evaluate(() => {
      const panel = document.querySelector('#sv-panel');
      const r = panel.getBoundingClientRect();
      return {
        cards: document.querySelectorAll('#sv-slots .slot-card').length,
        youNow: (document.querySelector('#sv-slots .slot-you') || {}).textContent || '',
        vp: { w: innerWidth, h: innerHeight },
        panel: { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width },
        scroll: document.documentElement.scrollHeight,
      };
    });
    const fits = geo.panel.top >= 0 && geo.panel.left >= 0 && geo.panel.bottom <= geo.vp.h && geo.panel.right <= geo.vp.w
      && geo.scroll <= geo.vp.h + 1;
    if (geo.cards !== 8 || !geo.youNow || !fits) {
      fail(`${name}: сетка панели — ${JSON.stringify(geo)}`);
    } else {
      pass(`${name}: панель — 8 карточек, «${geo.youNow}» на текущем, ширина ${Math.round(geo.panel.width)}px, влезает без скролла`);
    }
    await page.screenshot({ path: join(SHOT_DIR, name + '.png') });
    // Выход → экран слотов (новый поток, без reload).
    await page.click('#sv-out');
    await page.waitForSelector('#auth-confirm-yes', { timeout: 5000 });
    await page.click('#auth-confirm-yes');
    await page.waitForSelector('#slots-overlay', { timeout: 5000 });
    await sleep(300);
    const reloaded = await page.evaluate(() => (window.__exitReloads === undefined ? 0 : window.__exitReloads));
    void reloaded;
    await page.screenshot({ path: join(SHOT_DIR, name + '-exit.png') });
    const after = await page.evaluate(() => ({
      url: location.href,
      slots: !!document.querySelector('#slots-overlay'),
      identity: window.__saveIdentity,
    }));
    if (after.slots && !after.identity) pass(`${name}-exit: после выхода — экран слотов, identity закрыта`);
    else fail(`${name}-exit: ${JSON.stringify(after)}`);
    if (errors.length) fail(`${name}: ошибки страницы — ${errors.join(' | ')}`);
    await ctx.close();
  };

  await shootPanelAndExit({ width: 390, height: 844, isMobile: true, name: 'panel-slots-390x844' });
  await shootPanelAndExit({ width: 1280, height: 800, name: 'panel-slots-desktop' });

  await browser.close();
  console.log('SHOTS ' + SHOT_DIR);
} catch (e) {
  fail(String((e && e.message) || e));
} finally {
  for (const p of procs) p.kill('SIGKILL');
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* tmp */ }
}
process.exit(process.exitCode || 0);
