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

  await browser.close();
  console.log('SHOTS ' + SHOT_DIR);
} catch (e) {
  fail(String((e && e.message) || e));
} finally {
  for (const p of procs) p.kill('SIGKILL');
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* tmp */ }
}
process.exit(process.exitCode || 0);
