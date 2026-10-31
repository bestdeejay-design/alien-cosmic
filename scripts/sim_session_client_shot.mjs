// ============================================================
// sim_session_client_shot.mjs — Г2-артефакт: скриншоты С2 «реестр сессий»
// (баннер зрителя, блок «Мои сессии» в панели) живым Chromium, по образцу
// sim_entry_slots_shot/sim_capsule_fit.
//
// Сервер С2 НЕ нужен: сетевые вызовы перехватываются page.route и мокаются
// строго по контракту entry-audit/DESIGN_BRIEF_C2.md §1 (клиент против мока).
//
//   PASS x4  телефон 390×844 и десктоп 1280×800: баннер зрителя с устройством
//            и кнопками; панель профиля с блоком «Мои сессии» (карточки в
//            языке панели); страница не скроллится (канон [22]).
// Скриншоты: .shots/session-client/*.png
//
// Запуск: node scripts/sim_session_client_shot.mjs
// ============================================================
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STATIC_PORT = Number(process.env.SIM_STATIC_PORT || 8843);
const URL_BASE = `http://127.0.0.1:${STATIC_PORT}`;
const SHOT_DIR = process.env.SHOT_DIR || join(ROOT, '.shots', 'session-client');

const pass = (m) => console.log('PASS ' + m);
const fail = (m) => { console.error('FAIL ' + m); process.exitCode = 1; };

const tmp = mkdtempSync(join(tmpdir(), 'ac-s2-shot-'));
const procs = [];
const start = (name, args, env) => {
  const p = spawn(process.execPath, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: 'ignore' });
  procs.push(p);
  return p;
};
// Только статика: /api и /health перехватывает playwright (мок по контракту).
start('static', ['server/static.mjs'], { PORT: String(STATIC_PORT) });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitStatic() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`${URL_BASE}/r/index.html`);
      if (r.ok) return true;
    } catch { /* ещё не поднялся */ }
    await sleep(250);
  }
  return false;
}

// Мок сервера по контракту §1 (в рамках одной страницы).
function mockContract(page) {
  const rows = new Map(); // sessionId → {player, device, status, lastSeen}
  let uuidN = 0;
  const json = (data, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(data) });
  const displace = (player, device) => {
    for (const r of rows.values()) if (r.player === player) r.status = 'paused';
    const id = 'sid-' + (++uuidN) + '-aaaa-bbbb-cccc-dddddddddddd';
    rows.set(id, { player, device, status: 'active', lastSeen: Date.now() });
    return id;
  };
  return Promise.all([
    page.route('**/health', (route) => route.fulfill(json({ ok: true, players: 1, records: 2, version: 7, sessions: true }))),
    page.route('**/api/**', async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      const p = url.pathname;
      let body = {};
      try { body = req.postDataJSON(); } catch { /* GET */ }
      const token = (body && body.sessionToken) || req.headers()['x-session-token'] || '';
      if (p === '/api/session/start') {
        const hadActive = [...rows.values()].some((r) => r.player === body.player && r.status === 'active');
        const id = displace(body.player, body.device || '');
        return route.fulfill(json({ ok: true, sessionId: id, player: body.player, displaced: hadActive, active: true }));
      }
      if (p === '/api/session/beat') {
        const row = rows.get(token);
        const active = [...rows.values()].find((r) => r.player === body.player && r.status === 'active');
        if (row && row.status === 'active') return route.fulfill(json({ ok: true, lastSeen: Date.now(), status: 'active' }));
        if (active) return route.fulfill(json({ ok: false, error: 'active elsewhere', activeElsewhere: true, active: { device: active.device, lastSeen: active.lastSeen } }, 409));
        return route.fulfill(json({ ok: true, status: 'none' }));
      }
      if (p === '/api/session/end') {
        const row = rows.get(token);
        if (row) row.status = 'paused';
        return route.fulfill(json({ ok: true, status: 'paused' }));
      }
      if (p === '/api/sessions') {
        const list = [...rows.entries()]
          .filter(([, r]) => r.player === url.searchParams.get('player'))
          .map(([id, r]) => ({ sessionId: id, device: r.device, status: r.status, created: 1, lastSeen: r.lastSeen, current: id === token }))
          .sort((a, b) => ((a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1)) || (b.lastSeen - a.lastSeen));
        return route.fulfill(json({ ok: true, player: url.searchParams.get('player'), sessions: list }));
      }
      if (p === '/api/load') {
        if (body.key === '__check__') {
          if (body.pin !== '1234') return route.fulfill(json({ ok: false, error: 'nick taken, wrong pin' }), 403);
          return route.fulfill(json({ ok: true, player: 'best', registered: false }));
        }
        return route.fulfill(json({ ok: false, error: 'not found' })); // пустое облако → новая база
      }
      if (p === '/api/save') {
        // К-3: write-owner enforcement — токен чужой/paused при живой active → 409.
        const row = token ? rows.get(token) : null;
        const active = [...rows.values()].find((r) => r.player === body.player && r.status === 'active');
        if (row && row.status === 'active') {
          if (row.lastSeen !== undefined) row.lastSeen = Date.now();
          return route.fulfill(json({ ok: true, ts: Date.now(), player: body.player }));
        }
        if (active) return route.fulfill(json({ ok: false, error: 'active elsewhere', activeElsewhere: true, active: { device: active.device, lastSeen: active.lastSeen } }, 409));
        return route.fulfill(json({ ok: true, ts: Date.now(), player: body.player }));
      }
      if (p === '/api/list') return route.fulfill(json({ ok: true, records: [] }));
      return route.fulfill(json({ ok: true }));
    }),
  ]);
}

async function login(page) {
  // Матрица §2.3: identity засеяна → шаг ника с предзаполненным ником.
  await page.waitForSelector('#auth-body #auth-next', { timeout: 15000 });
  await page.click('#auth-next');
  await page.waitForSelector('#auth-pad', { timeout: 5000 });
  for (const k of ['1', '2', '3', '4']) await page.click(`#auth-pad [data-key="${k}"]`);
  await page.click('#auth-enter');
  await page.waitForFunction(() => {
    const o = document.querySelector('#auth-overlay');
    return window.game && window.game.started && (!o || o.classList.contains('hidden'));
  }, null, { timeout: 20000 });
}

const geoCheck = (geo, name) => {
  const fits = geo.rect.top >= 0 && geo.rect.left >= 0 && geo.rect.bottom <= geo.vp.h && geo.rect.right <= geo.vp.w;
  const noScroll = geo.scroll <= geo.vp.h + 1;
  if (!fits || !noScroll) fail(`${name}: элемент во вьюпорте=${fits}, страница без скролла=${noScroll} — ${JSON.stringify(geo)}`);
  else pass(`${name}: целиком во вьюпорте ${geo.vp.w}×${geo.vp.h}, страница не скроллится (канон [22])`);
};

try {
  if (!(await waitStatic())) throw new Error('стенд не поднялся (static)');
  mkdirSync(SHOT_DIR, { recursive: true });
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();

  const shoot = async ({ width, height, isMobile, name }) => {
    const ctx = await browser.newContext({
      viewport: { width, height },
      isMobile: !!isMobile, hasTouch: !!isMobile, deviceScaleFactor: isMobile ? 2 : 1,
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(() => { try { localStorage.setItem('terranrts.language', 'ru'); } catch { /* */ } });
    // identity засеяна: boot-гейт откроет шаг ника (матрица §2.3).
    await page.addInitScript(() => {
      try { localStorage.setItem('ac_save_nick', 'best'); localStorage.setItem('ac_save_pin', '1234'); } catch { /* */ }
    });
    await mockContract(page);
    console.log(`[${name}] goto…`);
    await page.goto(`${URL_BASE}/r/`, { waitUntil: 'load', timeout: 45000 });
    console.log(`[${name}] loaded, login…`);
    await login(page);
    console.log(`[${name}] logged in`);

    // «Другое устройство» входит → наш push получает 409 → баннер зрителя.
    await page.evaluate(async () => {
      await fetch('/api/session/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ player: 'best', pin: '1234', device: 'Safari · iPhone' }),
      });
      const g = window.game;
      g.state.minerals.player = 777;
      g.syncRaidHomeSnapshot();
      localStorage.setItem('ac_raid_session_v1', JSON.stringify(g.raidSession));
      await window.__saveApi.pushKey('ac_raid_session_v1');
    });
    await page.waitForSelector('#sv-viewer-banner', { timeout: 10000 });
    console.log(`[${name}] banner shown`);
    await sleep(400);
    let geo = await page.evaluate(() => {
      const r = document.querySelector('#sv-viewer-banner').getBoundingClientRect();
      return {
        vp: { w: innerWidth, h: innerHeight },
        rect: { top: r.top, bottom: r.bottom, left: r.left, right: r.right },
        scroll: document.documentElement.scrollHeight,
        title: document.querySelector('#sv-viewer-banner .sv-viewer-title').textContent,
        device: document.querySelector('#sv-viewer-device').textContent,
        refresh: !!document.querySelector('#sv-viewer-refresh'),
        claim: !!document.querySelector('#sv-viewer-claim'),
        paused: window.game.paused,
      };
    });
    if (!/Сессия продолжена на другом устройстве/.test(geo.title) || !/Safari · iPhone/.test(geo.device)
      || !geo.refresh || !geo.claim || !geo.paused) {
      fail(`${name} баннер: тексты/кнопки/пауза — ${JSON.stringify(geo)}`);
    } else {
      pass(`${name} баннер: устройство + «Обновить»/«Забрать сессию», игра на паузе`);
    }
    geoCheck(geo, `${name} баннер`);
    await page.screenshot({ path: join(SHOT_DIR, name + '-viewer-banner.png'), fullPage: false });

    // Панель профиля с блоком «Мои сессии» (третий блок).
    await page.evaluate(() => window.showProfilePanel());
    await page.waitForSelector('#sv-sess-list', { timeout: 10000 });
    await sleep(400);
    geo = await page.evaluate(() => {
      const el = document.querySelector('#sv-sessions');
      const r = el.getBoundingClientRect();
      return {
        vp: { w: innerWidth, h: innerHeight },
        rect: { top: r.top, bottom: r.bottom, left: r.left, right: r.right },
        scroll: document.documentElement.scrollHeight,
        html: el.innerHTML,
        cards: document.querySelectorAll('#sv-sessions .sess-card').length,
      };
    });
    const h = geo.html;
    const okPanel = /Мои сессии/.test(h) && /Safari · iPhone/.test(h) && /Chrome · macOS/.test(h)
      && /Это вы/.test(h) && /в сети/.test(h) && /на паузе/.test(h) && /Обновить список/.test(h) && geo.cards >= 2;
    if (!okPanel) fail(`${name} панель: блок сессий неполный — ${h.slice(0, 300)}`);
    else pass(`${name} панель: «Мои сессии» — active первым, «Это вы», статусы, «Обновить список»`);
    geoCheck(geo, `${name} панель`);
    await page.screenshot({ path: join(SHOT_DIR, name + '-panel-sessions.png'), fullPage: false });
    if (errors.length) fail(`${name}: ошибки страницы — ${errors.join(' | ')}`);
    await ctx.close();
  };

  await shoot({ width: 390, height: 844, isMobile: true, name: 'mobile-390x844' });
  await shoot({ width: 1280, height: 800, name: 'desktop-1280x800' });

  await browser.close();
  console.log('sim_session_client_shot: скриншоты в ' + SHOT_DIR);
} catch (e) {
  fail(String((e && e.stack) || e));
} finally {
  for (const p of procs) p.kill();
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
}
