#!/usr/bin/env node
// ============================================================
// ob_walkthrough.mjs — живая верификация QA-пачки онбординга
// (ace#25, дефекты №1–№15 кроме №14; ace#35 idle-старт; ace#36 шаг 4 двухфазный).
// Прогоны на живом стенде (python3 -m http.server 8852 в game/r):
//   A  полный walkthrough (телефон 390×844): все 8 шагов тапами,
//      проверки тумана, подсказок и тапабельности,
//      pageerror=0; 4а меню → 4б карточка Дома → 4в свободный выбор места;
//      шаг 6: выбор казармы и найм → ознакомительный грейд +
//      чип «Далее» → роадмап
//   D  ace#38: reload на 6б → resume сразу в 6б (чип/выделение/каллаут
//      восстановлены), далее до финала
//   B  нетерпеливый скип на легенде → kindness-автодобыча (ace#35)
//   C  повтор легенды: «Пропустить» закрывает ТОЛЬКО легенду
//   G  ace#37 Волна 2: prefers-reduced-motion (пульс погашен, дырка статично
//      видима) + luma-гейт dim на шагах 1 и 4а (падение luma вне дырки ≤ 28%)
//   F  5× флейк-тест первого тапа шага 1 (допуск 0/5 сбоев)
//   H  ace#41 GATE п.6: JIT-подсказка меню — однократно, флаг ac_ob_menu_hint_v1,
//      reload глушит; плюс в A: роадмап-хвост (последняя строка ≥30px над
//      футером), шаттл-тост вторым ≥1.7с, objective про турели,
//      ergNeeded не ожидается при старте 500 (ace#41 п.2)
//   E  reload до найма; I — reload при стройке и ручное возобновление
// Запуск: node scripts/ob_walkthrough.mjs [базовый-URL] [сценарий A|B|C|D|E|F|G|H|I]
// OB_TOUCH=1 — настоящие pointer/touch события; OB_WIDTH/OB_HEIGHT — размер окна;
// OB_RUNS — количество проходов A; OB_SPOT=near — первое доступное вместо дальнего места. PLAYWRIGHT_DIR и CHROMIUM_PATH опциональны.
// ============================================================
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
// kotel-форма: PLAYWRIGHT_DIR → локальный node_modules → homebrew-фолбэк (котёл самодостаточен)
let chromium;
try {
  ({ chromium } = require(process.env.PLAYWRIGHT_DIR ? process.env.PLAYWRIGHT_DIR + '/playwright' : 'playwright'));
} catch {
  ({ chromium } = require('/opt/homebrew/lib/node_modules/@playwright/test/node_modules/playwright'));
}

const BASE = process.argv[2] || 'http://localhost:8852/index.html';
const failures = [];
const fail = (name, msg) => { failures.push(name); console.log(`FAIL  ${name}: ${msg}`); };
const pass = (name, msg) => console.log(`PASS  ${name}${msg ? ': ' + msg : ''}`);
const assert = (c, name, msg) => { if (!c) fail(name, msg); return !!c; };

async function clickUI(page, selector) {
  if (process.env.OB_TOUCH === '1') await page.locator(selector).tap();
  else await page.click(selector);
}

// ---------- снимок состояния игры одним вызовом ----------
const snap = (page) => page.evaluate(async () => {
  const g = window.game;
  const st = g.state;
  const ccB = st.buildings.find((b) => !b.dead && b.side === 'player' && b.type === 'cc');
  const pb = st.map.bases.player.cc;
  const ccx = ccB ? (ccB.tx + ccB.w / 2) * 32 : (pb.x + 2) * 32;
  const ccy = ccB ? (ccB.ty + ccB.h / 2) * 32 : (pb.y + 2) * 32;
  const camX = st.camera.x + g.viewW() / 2, camY = st.camera.y + g.viewH() / 2;
  const ccDistTiles = Math.hypot(camX - ccx, camY - ccy) / 32;
  // тёмный туман: доля почти-чёрных пикселей в центральном прямоугольнике канваса
  let fogFrac = -1;
  try {
    const c = document.getElementById('game-canvas');
    const ctx = c.getContext('2d');
    const w = c.width, h = c.height;
    const im = ctx.getImageData(w * 0.3 | 0, h * 0.3 | 0, w * 0.4 | 0, h * 0.4 | 0).data;
    let dark = 0, total = 0;
    for (let i = 0; i < im.length; i += 16) { // каждый 4-й пиксель
      total++;
      if (im[i] < 14 && im[i + 1] < 14 && im[i + 2] < 16) dark++;
    }
    fogFrac = total ? dark / total : -1;
  } catch { /* канвас мог не отрисоваться */ }
  const holeEl = document.getElementById('ob-hole');
  const hole = holeEl ? {
    w: parseFloat(holeEl.style.width) || 0, h: parseFloat(holeEl.style.height) || 0,
    x: parseFloat(holeEl.style.left) || 0, y: parseFloat(holeEl.style.top) || 0,
    act: holeEl.classList.contains('ob-hole-act'),
  } : null;
  const calloutEl = document.querySelector('.ob-callout');
  const callout = calloutEl ? {
    text: calloutEl.classList.contains('is-on') ? calloutEl.textContent : '',
    display: getComputedStyle(calloutEl).display,
  } : { text: '', display: 'none' };
  // карвы: ни одна dim-полоса не накрывает миникарту/зум
  const overlap = (sel) => {
    const z = document.querySelector(sel);
    if (!z) return null;
    const zr = z.getBoundingClientRect();
    const dims = [...document.querySelectorAll('.ob-dim')];
    for (const d of dims) {
      const dr = d.getBoundingClientRect();
      if (!dr.width || !dr.height) continue;
      if (dr.left < zr.right && zr.left < dr.right && dr.top < zr.bottom && zr.top < dr.bottom) return true;
    }
    return false;
  };
  const bar = st.buildings.find((b) => !b.dead && b.side === 'player' && b.type === 'barracks');
  return {
    step: g.onboarding ? g.onboarding.step : -1,
    active: g.onboarding ? !!g.onboarding.active : false,
    done: g.onboarding ? !!g.onboarding.done : false,
    skipped: g.onboarding ? !!g.onboarding.skipped : false,
    ccDistTiles, fogFrac, hole, callout,
    minerals: st.minerals.player,
    placing: !!st.placing,
    buildMenu: !!st.buildMenu,
    selIsCC: st.selection.length === 1 && st.selection[0] === ccB,
    selDev: !!document.querySelector('#sel-info .sel-dev'),
    roadmapOpen: !!document.querySelector('#cc-roadmap-overlay'),
    obRoadmapClass: document.body.classList.contains('ob-roadmap-open'),
    mmOverlap: overlap('#minimap-box'),
    zoomOverlap: overlap('#zoom-controls'),
    chipTop: (() => { const ch = document.getElementById('sel-count'); if (!ch) return null; const sr = document.querySelector('.ob-skip'); if (!sr) return null; const cr = ch.getBoundingClientRect(); const kr = sr.getBoundingClientRect(); return (cr.top < kr.bottom && kr.top < cr.bottom && cr.left < kr.right && kr.left < cr.right) ? 'overlap' : 'ok'; })(),
    barDone: bar ? !!bar.done : false,
    // ace#38: под-фазы шага 6 — 6а найм / 6б грейд+чип «Далее».
    sub6b: g.onboarding ? !!g.onboarding.sub6b : false,
    selIsBar: (() => {
      const b = st.buildings.find((x) => !x.dead && x.side === 'player' && x.type === 'barracks' && x.done);
      return !!b && st.selection.length === 1 && st.selection[0] === b;
    })(),
    nextChip: (() => {
      const b = document.getElementById('ob-next');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { display: getComputedStyle(b).display, text: b.textContent,
        w: r.width, h: r.height, x: r.left, y: r.top };
    })(),
    barracksCount: st.buildings.filter((b) => !b.dead && b.side === 'player' && b.type === 'barracks').length,
    depotCount: st.buildings.filter((b) => !b.dead && b.side === 'player' && b.type === 'depot').length,
    marines: st.units.filter((u) => !u.dead && u.side === 'player' && u.type === 'marine').length,
    objective: (document.getElementById('res-objective') || {}).textContent || '',
    chestOpen: (() => { const o = document.getElementById('chest-overlay'); return !!(o && !o.classList.contains('hidden')); })(),
    crystals: (st.map.crystals || []).filter((c) => c.amount > 0)
      .map((c) => ({ x: (c.tx + 0.5) * 32, y: (c.ty + 0.5) * 32,
        d: Math.hypot((c.tx + 0.5) * 32 - camX, (c.ty + 0.5) * 32 - camY) }))
      .sort((a2, b2) => a2.d - b2.d),
    worker: (() => { const u = st.units.find((x) => !x.dead && !x.garrison && x.side === 'player' && x.type === 'worker'); return u ? { x: u.x, y: u.y } : null; })(),
    workers: st.units.filter((x) => !x.dead && !x.garrison && x.side === 'player' && x.type === 'worker')
      .map((u) => ({ x: u.x, y: u.y, order: u.order && u.order.kind })),
  };
});

const TILE = 32;
async function clickWorld(page, wx, wy, btn = 'left') {
  const p = await page.evaluate(([x, y]) => {
    const c = document.getElementById('game-canvas');
    const r = c.getBoundingClientRect();
    const s = window.game.worldToScreen(x, y);
    return { x: r.left + s.x, y: r.top + s.y };
  }, [wx, wy]);
  if (process.env.OB_TOUCH === '1') await page.touchscreen.tap(p.x, p.y);
  else {
    await page.mouse.click(p.x, p.y, { button: btn });
    // kotel-гигиена пробы: сценарий ace#46 ставит Дом у самого края экрана
    // (freeSpot away-from-guide), оставшийся курсор попадает в 26px краевую
    // зону и после EDGE_PAN_GRACE включает канонный edge-scroll (хотфикс L) —
    // камера «уезжает» при длинных ожиданиях и ломает тапы по устаревшим
    // экранным координатам. Уводим указатель в центр: инвариант
    // «постановка не прыгает камерой» это не маскирует (пан — не от постановки).
    const vp = page.viewportSize();
    await page.mouse.move(Math.round(vp.width / 2), Math.round(vp.height / 2));
  }
}
async function dblWorld(page, wx, wy) {
  const p = await page.evaluate(([x, y]) => {
    const c = document.getElementById('game-canvas');
    const r = c.getBoundingClientRect();
    const s = window.game.worldToScreen(x, y);
    return { x: r.left + s.x, y: r.top + s.y };
  }, [wx, wy]);
  // двойной клик «руками»: игра мерит свой интервал (350мс) на mouseup —
  // штатный dblclick под нагрузкой снапшота может разъезжаться.
  if (process.env.OB_TOUCH === '1') {
    await page.touchscreen.tap(p.x, p.y);
    await page.waitForTimeout(120);
    await page.touchscreen.tap(p.x, p.y);
  } else {
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(120);
    await page.mouse.click(p.x, p.y);
  }
}
// свободный тайл рядом с КЦ для постановки здания (через живой canPlace).
// XREV-8 (предсуществующий дефект проходки на main 9131534): баннер тревоги —
// живой HUD над канвой у верхней кромки; тап по тайлу под ним открывает
// карточку командира вместо постановки. Цель обязана быть реально тапабельной:
// верхний elementFromPoint в точке — канва.
async function freeSpot(page, w, h, farFromCc = false) {
  return page.evaluate(async ([bw, bh, away]) => {
    const B = await import('./js/buildings.js?v=11030130');
    const st = window.game.state;
    const cc = st.buildings.find((b) => !b.dead && b.side === 'player' && b.type === 'cc');
    const cx = cc.tx, cy = cc.ty;
    const cv = document.getElementById('game-canvas');
    const spots = [];
    for (let r = 3; r < 12; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const tx = cx + dx, ty = cy + dy;
        if (tx < 1 || ty < 1 || tx + bw >= st.map.w - 1 || ty + bh >= st.map.h - 1) continue;
        let explored = true;
        for (let y = ty; y < ty + bh && explored; y++)
          for (let x = tx; x < tx + bw && explored; x++)
            if (!st.fog.tileExplored(x, y)) explored = false;
        if (!explored) continue;
        if (!B.canPlace(st.map, tx, ty, bw, bh) || !B.zoneAllows(st, tx, ty, bw, bh)) continue;
        const scr = window.game.worldToScreen((tx + bw / 2) * 32, (ty + bh / 2) * 32);
        const cvr = cv.getBoundingClientRect();
        const top = document.elementFromPoint(cvr.left + scr.x, cvr.top + scr.y);
        if (top !== cv) continue; // вне экрана или под HUD — тап не дойдёт
        const spot = { x: (tx + bw / 2) * 32, y: (ty + bh / 2) * 32, distance: Math.hypot(tx + bw / 2 - (cc.tx + cc.w / 2), ty + bh / 2 - (cc.ty + cc.h / 2)) };
        if (!away) return spot;
        spots.push(spot);
      }
    }
    return spots.sort((a, b) => b.distance - a.distance)[0] || null;
  }, [w, h, farFromCc]);
}
async function cmdClick(page, code) {
  const btn = page.locator('#cmd-grid [data-code="' + code + '"]');
  await btn.waitFor({ state: 'visible', timeout: 5000 });
  if (process.env.OB_TOUCH === '1') {
    const r = await btn.boundingBox();
    await page.touchscreen.tap(r.x + r.width / 2, r.y + r.height / 2);
  } else await btn.click();
  await page.waitForTimeout(250);
}
// ace#36 «детский бар»: каждый каллаут — ≤1 строка на 390px
// (одна строка 13px×1.35 + паддинги ≈ 36px; две строки — уже ≥52px).
async function assertOneLine(page, name) {
  const h = await page.evaluate(() => {
    const c = document.querySelector('.ob-callout');
    if (!c || !c.classList.contains('is-on')) return -1;
    return c.getBoundingClientRect().height;
  });
  assert(h > 0 && h <= 44, name, `каллаут выше одной строки: ${h}px`);
}
async function waitStep(page, step, name, timeout = 30000) {
  try {
    await page.waitForFunction((s) => window.game.onboarding && window.game.onboarding.step === s, step, { timeout });
    await page.waitForTimeout(350); // кадр rAF: дырка/каллаут успевают отрисоваться
    return true;
  } catch { return assert(false, name, `шаг ${step} не наступил (текущий: ${(await snap(page)).step})`); }
}
async function checkStepCommon(page, name, s, { maxCcDist = Infinity } = {}) {
  const v = await snap(page);
  assert(v.ccDistTiles <= maxCcDist, name, `камера ${v.ccDistTiles.toFixed(1)} тайлов от КЦ (лимит ${maxCcDist})`);
  if (v.fogFrac >= 0 && Number(process.env.OB_WIDTH || 390) <= 640) assert(v.fogFrac < 0.4, name, `тёмный туман ${Math.round(v.fogFrac * 100)}% центра`);
  assert(v.mmOverlap === false, name, 'dim накрывает миникарту (нет карва)');
  assert(v.zoomOverlap === false, name, 'dim накрывает зум-контролы (нет карва)');
  return v;
}

// Гейт входа: свежий браузер (или reload) — экран выбора стороны/слотов → «гость».
async function guestGate(page) {
  for (let i = 0; i < 60; i++) {
    if (await page.evaluate(() => window.game && window.game.started)) return;
    const which = await page.evaluate(() => {
      const foot = document.getElementById('auth-foot-guest');
      if (foot && foot.getBoundingClientRect().width) return '#auth-foot-guest';
      const sg = document.getElementById('slots-guest');
      if (sg && sg.getBoundingClientRect().width) return '#slots-guest';
      return null;
    });
    if (which) { await clickUI(page, which); await page.waitForTimeout(300); continue; }
    await page.waitForTimeout(500);
  }
}

// clearStorage=false — НЕ чистить localStorage на каждый документ (ace#38,
// сценарий D: reload должен восстановить рейд того же гостя — токен в
// localStorage переживает перезагрузку; чистящий init-скрипт его бы стёр).
async function freshPage(browser, errors, ctxOpts = {}, clearStorage = true) {
  const ctx = await browser.newContext({ viewport: { width: Number(process.env.OB_WIDTH || 390), height: Number(process.env.OB_HEIGHT || 844) }, ...(process.env.OB_TOUCH === '1' ? { hasTouch: true, isMobile: true } : {}), ...ctxOpts });
  if (clearStorage) {
    await ctx.addInitScript(() => { try { localStorage.clear(); sessionStorage.clear();
      localStorage.setItem('terranrts.language', 'ru'); } catch {} });
  }
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(BASE);
  await guestGate(page);
  await page.waitForFunction(() => window.game && window.game.started &&
    window.game.onboarding && document.getElementById('ob-legend'), null, { timeout: 30000 });
  return { ctx, page };
}

// ---------- сценарий A: полный walkthrough ----------
// mode: 'normal' — как есть; 'reload6b' — на 6б перезагрузка страницы
// (ace#38 resume-канон шага 6) с продолжением до финала.
async function scenarioA(browser, tag, mode = 'normal') {
  const MODE = mode;
  const errors = [];
  const { ctx, page } = await freshPage(browser, errors, {}, !MODE.startsWith('reload'));
  const S = (m) => `${tag}/${m}`;
  try {
    let v = await snap(page);
    assert(!v.chestOpen, S('№8-капсулы'), 'капсулы открылись поверх легенды');
    // шаг 0 → 1
    await clickUI(page, '.ob-legend-next');
    if (!await waitStep(page, 1, S('шаг1'))) return;
    v = await checkStepCommon(page, S('шаг1'), 1);
    assert(v.callout.text.length > 0, S('шаг1-каллаут'), 'каллаут пуст');
    assert(v.callout.text === 'Тапните сборщика', S('шаг1-текст'), 'каллаут: ' + v.callout.text);
    assert(v.hole && v.hole.w > 0, S('шаг1-дырка'), 'дырка не нарисована');
    await assertOneLine(page, S('шаг1-строка'));
    // ace#35: стартовые сборщики СТОЯТ у КЦ (order=idle) — авто-добычи нет.
    assert(v.workers.length === 2 && v.workers.every((q) => q.order === 'idle'),
      S('№A-idle-старт'), 'сборщики не стоят: ' + JSON.stringify(v.workers.map((q) => q.order)));
    // №1 тап по сборщику — первый тап должен работать (флейк-тест живой ветки)
    const w = v.worker;
    assert(w, S('шаг1'), 'нет сборщика');
    await clickWorld(page, w.x, w.y);
    if (!await waitStep(page, 2, S('шаг2'))) return;
    v = await checkStepCommon(page, S('шаг2'), 2);
    assert(v.callout.text === 'Двойной тап — выделить всех', S('шаг2-каллаут'), 'каллаут: ' + v.callout.text);
    await assertOneLine(page, S('шаг2-строка'));
    assert(!v.chestOpen, S('№8-капсулы'), 'капсулы открылись во время онбординга (шаг 2)');
    // №12: 4 повторных тапа в шаге 1 ниже (сценарий F); здесь двойной тап → 3
    await dblWorld(page, w.x, w.y);
    await page.waitForTimeout(700);
    if ((await snap(page)).step !== 3) {
      const dbg = await page.evaluate(() => ({
        step: window.game.onboarding.step,
        lastClick: window.game.lastClick,
        sel: window.game.state.selection.map((x) => x.type),
        workerScr: (() => {
          const st = window.game.state;
          const u = st.units.find((x) => !x.dead && !x.garrison && x.side === 'player' && x.type === 'worker');
          const c = document.getElementById('game-canvas').getBoundingClientRect();
          const s = window.game.worldToScreen(u.x, u.y);
          return { x: c.left + s.x, y: c.top + s.y, wx: u.x, wy: u.y };
        })(),
      }));
      console.log('DBG3', JSON.stringify(dbg));
    }
    if (!await waitStep(page, 3, S('шаг3'))) return;
    v = await checkStepCommon(page, S('шаг3'), 3, { maxCcDist: 12 });
    // ace#35: каллаут шага 3 — «зачем» показывают флоаты «+эрг» над сборщиком.
    assert(v.callout.text === 'Кристалл: тап или ПКМ для добычи', S('шаг3-каллаут'), 'каллаут: ' + v.callout.text);
    await assertOneLine(page, S('шаг3-строка'));
    assert(v.hole && v.hole.w > 0, S('шаг3-дырка'), 'дырка кристалла не нарисована');
    // №1: автосбор не должен был закрыть шаг; ручной приказ → 4
    await page.waitForTimeout(600); // автосбор стартового отряда успел бы сработать
    v = await snap(page);
    if (!assert(v.step === 3, S('№1-автосбор'), 'шаг 3 закрылся без приказа игрока')) return;
    const cr = v.crystals[0];
    assert(cr, S('шаг3'), 'нет кристаллов');
    // На узком touch-экране кристалл может оказаться под кнопкой зума.
    // Игрок сдвигает карту, не нажимая закрывающий цель HUD.
    const crystalHit = await page.evaluate(({x,y}) => {
      const cv = document.getElementById('game-canvas'), r = cv.getBoundingClientRect();
      const p = window.game.worldToScreen(x,y);
      return document.elementFromPoint(r.left+p.x,r.top+p.y) === cv;
    }, cr);
    if (!crystalHit && process.env.OB_TOUCH === '1') {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', {type:'touchStart', touchPoints:[{x:25,y:300}]});
      await cdp.send('Input.dispatchTouchEvent', {type:'touchMove', touchPoints:[{x:25,y:180}]});
      await cdp.send('Input.dispatchTouchEvent', {type:'touchEnd', touchPoints:[]});
      await cdp.detach();
    }
    await clickWorld(page, cr.x, cr.y, 'right');
    if (!await waitStep(page, 4, S('шаг4'))) return;
    v = await checkStepCommon(page, S('шаг4'), 4);
    // ace#36: 4а — спотлайт кнопки «Строить» нижней панели, каллаут-глагол.
    assert(v.callout.text === 'Откройте постройки', S('шаг4а-каллаут'), 'каллаут: ' + v.callout.text);
    assert(v.hole && v.hole.w > 0, S('шаг4а-дырка'), 'дырка на кнопке стройки не нарисована');
    await assertOneLine(page, S('шаг4а-строка'));
    // 4б — меню открыто: спотлайт карточки Дома.
    await cmdClick(page, 'KeyB');
    v = await snap(page);
    assert(v.buildMenu, S('шаг4б'), 'меню стройки не открылось');
    assert(v.callout.text === 'Выберите Дом-шаттл', S('шаг4б-каллаут'), 'каллаут: ' + v.callout.text);
    assert(v.hole && v.hole.w > 0, S('шаг4б-дырка'), 'дырка на карточке Дома не нарисована');
    await assertOneLine(page, S('шаг4б-строка'));
    // 4в — свободное планирование: никакой предложенной точки.
    await cmdClick(page, 'KeyW');
    v = await snap(page);
    assert(v.placing, S('шаг4в'), 'placing не начался');
    assert(v.callout.text.includes('Выберите место для шаттла') && v.callout.text.includes('Оставьте место вокруг КЦ') && v.callout.text.includes('и проход к кристаллам'), S('шаг4в-каллаут'), 'нет совета: ' + v.callout.text);
    assert(v.callout.text.includes(process.env.OB_TOUCH === '1' ? 'Сдвиньте карту · тап — поставить' : 'Зажмите колесо мыши и сдвиньте'), S('шаг4в-управление'), 'нет подсказки управления: ' + v.callout.text);
    assert(v.hole && v.hole.w === 0 && v.hole.h === 0, S('шаг4в-нет-маркера'), 'нельзя предлагать фиксированную точку');
    const placementUi = await page.evaluate(() => {
      const c = document.querySelector('.ob-callout'), skip = document.querySelector('.ob-skip');
      const a = c.getBoundingClientRect(), b = skip.getBoundingClientRect();
      return { overlap: a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom,
        inScreen: a.left >= 0 && a.top >= 0 && a.right <= innerWidth && a.bottom <= innerHeight,
        hit: getComputedStyle(c).pointerEvents };
    });
    assert(!placementUi.overlap && placementUi.inScreen && placementUi.hit === 'none', S('подсказка-доступна'), JSON.stringify(placementUi));
    if (process.env.OB_SCREENSHOT) await page.screenshot({path: process.env.OB_SCREENSHOT});
    // Нажимаем на заведомо недопустимый участок, доступный на экране.
    const blocked = await page.evaluate(async () => {
      const B = await import('./js/buildings.js?v=11030130');
      const g = window.game, st = g.state, cv = document.getElementById('game-canvas');
      const r = cv.getBoundingClientRect(), cc = st.buildings.find(b => !b.dead && b.type === 'cc' && b.side === 'player');
      for (let dy = -12; dy <= 12; dy++) for (let dx = -12; dx <= 12; dx++) {
        const tx = cc.tx + dx, ty = cc.ty + dy;
        if (tx < 1 || ty < 1 || tx + 2 >= st.map.w - 1 || ty + 2 >= st.map.h - 1 || B.canPlace(st.map, tx, ty, 2, 2)) continue;
        const x = (tx + 1) * 32, y = (ty + 1) * 32, s = g.worldToScreen(x,y);
        if (document.elementFromPoint(r.left + s.x, r.top + s.y) === cv) return {x,y};
      }
      return null;
    });
    if (assert(blocked, S('занятое-место'), 'нет видимого недопустимого участка')) {
      await clickWorld(page, blocked.x, blocked.y);
      await page.waitForTimeout(300);
      assert((await snap(page)).placing, S('ошибка-не-отменяет'), 'после неудачного размещения пропал призрак');
    }
    // Перед выбором игрок может осмотреть карту, не размещая постройку.
    const panBefore = await page.evaluate(() => ({x: window.game.state.camera.x, y: window.game.state.camera.y, n: window.game.state.buildings.length}));
    const viewW = Number(process.env.OB_WIDTH || 390), viewH = Number(process.env.OB_HEIGHT || 844);
    const x0 = Math.round(viewW * .75), x1 = Math.round(viewW * .35), y = Math.round(viewH * .4);
    const canPan = await page.evaluate(({x0,x1,y}) => [x0,x1].every(x => document.elementFromPoint(x, y)?.id === 'game-canvas'), {x0,x1,y});
    assert(canPan, S('панорама-доступна'), 'точку жеста перекрыл интерфейс');
    if (canPan) {
      if (process.env.OB_TOUCH === '1') {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x: x0, y}]});
        await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x: x1, y}]});
        await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
        await cdp.detach();
      } else {
        await page.mouse.move(x0, y); await page.mouse.down({button: 'middle'});
        await page.mouse.move(x1, y, {steps: 5}); await page.mouse.up({button: 'middle'});
      }
      const panAfter = await page.evaluate(() => ({x: window.game.state.camera.x, y: window.game.state.camera.y, n: window.game.state.buildings.length, placing: !!window.game.state.placing, hole: parseFloat(document.querySelector('#ob-hole').style.width), ping: document.querySelector('#ob-ping').classList.contains('is-on')}));
      assert(panAfter.x !== panBefore.x && panAfter.n === panBefore.n && panAfter.placing && panAfter.hole === 0 && !panAfter.ping, S('обзор-без-стройки'), JSON.stringify({panBefore,panAfter}));
    }
    const far = process.env.OB_SPOT !== 'near';
    const spotD = await freeSpot(page, 2, 2, far);
    assert(spotD && (!far || spotD.distance >= 4), S('свободный-выбор'), 'нет видимого допустимого места в стороне от КЦ: ' + JSON.stringify(spotD));
    if (!assert(spotD, S('шаг4'), 'нет свободного места под Дом')) return;
    console.log(`  Дом: ${Math.round(spotD.x/32-1)},${Math.round(spotD.y/32-1)}; расстояние от КЦ ${spotD.distance.toFixed(1)} тайла`);
    const beforePlace = await page.evaluate(() => ({x: window.game.state.camera.x, y: window.game.state.camera.y}));
    await clickWorld(page, spotD.x, spotD.y);
    if (!await waitStep(page, 5, S('шаг5'))) return;
    const afterPlace = await page.evaluate(() => ({x: window.game.state.camera.x, y: window.game.state.camera.y}));
    assert(Math.hypot(afterPlace.x-beforePlace.x, afterPlace.y-beforePlace.y) < 2, S('камера-осталась'), JSON.stringify({beforePlace,afterPlace}));
    assert(await page.evaluate(({x, y}) => window.game.state.buildings.some(b => !b.dead && b.side === 'player' && b.type === 'depot' && b.tx === Math.round(x / 32 - b.w / 2) && b.ty === Math.round(y / 32 - b.h / 2)), spotD), S('дом-на-выбранном-месте'), 'Дом появился не в выбранном месте');
    v = await snap(page);
    assert(!v.placing, S('№5-serial'), 'серийный placing не снят после постановки');
    v = await checkStepCommon(page, S('шаг5'), 5);
    // каллаут: императивный; денежный fallback «Добывайте эрг» при нормальном
    // старте (ace#41: RAID_STARTER_MINERALS=500) не должен появляться
    assert(v.callout.text === 'Постройте казарму для бойцов',
      S('№7-каллаут5'), 'каллаут (ergNeeded не ожидается при старте 500): ' + v.callout.text);
    await assertOneLine(page, S('шаг5-строка'));
    // добрать до ≥210 (казарма 150 + marine 50 + запас): рабочие уже копают
    const t0 = Date.now();
    while ((await snap(page)).minerals < 210) {
      if (Date.now() - t0 > 90000) return assert(false, S('шаг5-экономика'), 'не добыли 210 эрга за 90с');
      await page.waitForTimeout(1000);
    }
    // ждём императивный каллаут (деньги есть → дырка на кнопке меню)
    await page.waitForFunction(() => {
      const c = document.querySelector('.ob-callout');
      return c && c.textContent === 'Постройте казарму для бойцов';
    }, null, { timeout: 30000 });
    await cmdClick(page, 'KeyB');
    await cmdClick(page, 'KeyE');
    const spotB = await freeSpot(page, 3, 2);
    assert(spotB, S('шаг5'), 'нет места под казарму');
    await clickWorld(page, spotB.x, spotB.y);
    v = await snap(page);
    assert(!v.placing, S('№5-serial'), 'серийный placing не снят (казарма)');
    if (MODE === 'reload5') {
      // pagehide сохраняет настоящее состояние стройки и текущий шаг.
      await page.reload(); await guestGate(page);
      await page.waitForFunction(() => window.game && window.game.started && window.game.onboarding && window.game.onboarding.active, null, { timeout: 60000 });
      await page.waitForTimeout(1500);
      v = await snap(page);
      assert(v.barracksCount === 1 && v.step === 5, S('reload-стройка'), 'казарма или шаг стройки потеряны: ' + JSON.stringify(v));
      assert(v.callout.text === 'Зажмите казарму или нажмите ПКМ', S('reload-подсказка'), 'нет подсказки возобновления: ' + v.callout.text);
      await assertOneLine(page, S('reload-подсказка-строка'));
      const pos = await page.evaluate(() => { const b = window.game.state.buildings.find(x => !x.dead && x.type === 'barracks' && x.side === 'player'); const r = document.getElementById('game-canvas').getBoundingClientRect(), p = window.game.worldToScreen((b.tx + b.w / 2) * 32, (b.ty + b.h / 2) * 32); return {x: r.left + p.x, y: r.top + p.y}; });
      if (process.env.OB_TOUCH === '1') {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x: pos.x, y: pos.y}]});
        await page.waitForTimeout(650);
        await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
        await cdp.detach();
      } else await page.mouse.click(pos.x, pos.y, { button: 'right' });
      await page.waitForTimeout(400);
      assert(await page.evaluate(() => window.game.state.units.some(u => u.type === 'worker' && u.order && u.order.kind === 'build' && u.order.target.type === 'barracks')), S('reload-приказ'), 'приказ достроить не принят');
    }
    // №6: waiting-каллаут с прогрессом
    await page.waitForFunction(() => {
      const c = document.querySelector('.ob-callout');
      return c && c.classList.contains('is-on') && /Казарма строится/.test(c.textContent);
    }, null, { timeout: 12000 }).catch(() => {});
    v = await snap(page);
    if (!assert(/Казарма строится… \d+%/.test(v.callout.text), S('№6-waiting'), 'нет прогресса: "' + v.callout.text + '"')) return;
    const pct1 = parseInt(v.callout.text.replace(/\D+/g, ''), 10) || 0;
    await page.waitForTimeout(2500);
    v = await snap(page);
    const pct2 = parseInt((v.callout.text.match(/\d+/) || ['0'])[0], 10) || 0;
    assert(pct2 >= pct1, S('№6-прогресс'), `прогресс не растёт: ${pct1}→${pct2}`);
    if (!await waitStep(page, 6, S('шаг6'), 40000)) return;
    v = await checkStepCommon(page, S('шаг6'), 6);
    if (MODE === 'reload6a') {
      await page.reload(); await guestGate(page);
      await page.waitForFunction(() => window.game && window.game.started && window.game.onboarding && window.game.onboarding.active, null, { timeout: 60000 });
      await page.waitForTimeout(1500);
      v = await snap(page);
      assert(v.step === 6 && !v.sub6b && (!v.nextChip || v.nextChip.display === 'none'), S('reload-до-найма'), 'после reload найм ошибочно засчитан');
    }
    // Игрок сам выбирает казарму, после чего видит команду найма.
    if (MODE !== 'reload6a') assert(v.callout.text === 'Выберите казарму', S('шаг6а-выбор'), 'каллаут: ' + v.callout.text);
    const barPos = await page.evaluate(() => { const b = window.game.state.buildings.find(b => !b.dead && b.side === 'player' && b.type === 'barracks' && b.done); return { x: (b.tx + b.w / 2) * 32, y: (b.ty + b.h / 2) * 32 }; });
    if (!v.selIsBar) await clickWorld(page, barPos.x, barPos.y);
    await page.waitForTimeout(500);
    v = await snap(page);
    assert(v.callout.text === 'Казарма готова: наймите бойца', S('шаг6а-каллаут'), 'каллаут: ' + v.callout.text);
    await assertOneLine(page, S('шаг6а-строка'));
    assert(v.hole && v.hole.w > 0, S('шаг6а-дырка'), 'дырка 6а (KeyQ/казарма) не нарисована');
    assert(v.sub6b === false, S('шаг6а-guard'), '6б включился без найма');
    assert(v.selIsBar, S('шаг6а-выделение'), '6а не удерживает выделение казармы');
    await page.screenshot({ path: '/tmp/g38-6a.png' });
    // добрать до ≥50 на marine, если потратились
    let t1 = Date.now();
    while ((await snap(page)).minerals < 50) {
      if (Date.now() - t1 > 60000) return assert(false, S('шаг6-экономика'), 'не добыли 50 на marine');
      await page.waitForTimeout(1000);
    }
    await cmdClick(page, 'KeyQ');
    // ace#38 6б: шаг ОСТАЁТСЯ 6, включается под-фаза грейда + чип «Далее».
    await page.waitForFunction(() => window.game.onboarding &&
      window.game.onboarding.sub6b === true, null, { timeout: 10000 })
      .catch(() => {});
    v = await snap(page);
    assert(v.step === 6 && v.sub6b, S('шаг6б'), `ожидали 6б, шаг ${v.step}, sub6b=${v.sub6b}`);
    assert(v.callout.text === 'Грейд улучшает казарму',
      S('шаг6б-каллаут'), 'каллаут: ' + v.callout.text);
    await assertOneLine(page, S('шаг6б-строка'));
    assert(v.selIsBar, S('шаг6б-выделение'), '6б не удерживает выделение казармы');
    // Снятие выделения сохраняется; подсказка ведёт обратно к казарме.
    await page.evaluate(() => { window.game.state.selection = []; });
    await page.waitForTimeout(400);
    v = await snap(page);
    assert(!v.selIsBar, S('выбор-игрока'), 'онбординг перехватил выбор игрока');
    assert(v.callout.text === 'Выберите казарму' && v.hole && v.hole.w > 0,
      S('подсказка-казармы'), 'нет подсказки выбора казармы');
    await clickWorld(page, barPos.x, barPos.y);
    await page.waitForTimeout(500);
    // чип «Далее»: отдельный элемент, ≥44px, тапабелен, один.
    const chip = await page.evaluate(() => {
      const b = document.getElementById('ob-next');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { display: getComputedStyle(b).display, text: b.textContent, w: r.width, h: r.height,
        hit: hit ? (hit.id || String(hit.className)) : 'null' };
    });
    assert(chip && chip.display !== 'none' && chip.text === 'Далее',
      S('шаг6б-чип'), 'чип «Далее» не показан: ' + JSON.stringify(chip));
    assert(chip.w >= 44 && chip.h >= 44, S('чип-44'), `чип меньше 44px: ${chip.w}x${chip.h}`);
    assert(chip.hit === 'ob-next', S('чип-тап'), 'elementFromPoint чипа: ' + chip.hit);
    await page.screenshot({ path: '/tmp/g38-6b.png' });
    if (MODE === 'reload6b') {
      // ace#38 resume-канон: reload на 6б → сразу 6б (казарма построена),
      // чип/выделение/каллаут восстановлены.
      await page.reload();
      await guestGate(page);
      await page.waitForFunction(() => window.game && window.game.started &&
        window.game.onboarding && window.game.onboarding.active, null, { timeout: 60000 });
      await page.waitForTimeout(1500);
      const r6 = await snap(page);
      assert(r6.step === 6 && r6.sub6b, S('reload-6б'), `resume: step=${r6.step} sub6b=${r6.sub6b}`);
      assert(r6.selIsBar, S('reload-выделение'), 'resume 6б не выделил казарму программно');
      assert(r6.callout.text === 'Грейд улучшает казарму',
        S('reload-каллаут'), 'каллаут: ' + r6.callout.text);
      assert(r6.nextChip && r6.nextChip.display !== 'none', S('reload-чип'), 'resume 6б без чипа');
      pass(S('reload-на-6б'), 'resume сразу в 6б: чип/выделение/каллаут на месте');
    }
    await clickUI(page, '#ob-next'); // единственный выход из шага 6
    if (!await waitStep(page, 7, S('шаг7'))) return;
    // №2: камера на КЦ, КЦ выделен, панель с «Развитие»
    v = await checkStepCommon(page, S('шаг7'), 7, { maxCcDist: 12 });
    assert(v.selIsCC, S('№2а-КЦ'), 'КЦ не выделен программно');
    assert(v.callout.text === 'Откройте Развитие КЦ', S('№7-каллаут7'), 'каллаут: ' + v.callout.text);
    await assertOneLine(page, S('шаг7-строка'));
    if (!assert(v.selDev, S('№2в-selDev'), 'блока .sel-dev нет в панели')) return;
    assert(v.hole && v.hole.act, S('№2б-дырка'), 'дырка шага 7 не интерактивна');
    // тап в дырку → роадмап
    await page.mouse.click(v.hole.x + v.hole.w / 2, v.hole.y + v.hole.h / 2);
    await page.waitForTimeout(700);
    v = await snap(page);
    if (!assert(v.roadmapOpen, S('№2б-роадмап'), 'тап в дырку не открыл роадмап')) return;
    assert(v.obRoadmapClass && v.callout.display === 'none', S('№13-гвард'), 'поверх роадмапа рисуется онбординг');
    // ace#41 GATE п.1: хвост роадмапа читаем — 20 строк; при полном скролле
    // низ ПОСЛЕДНЕЙ строки ≥30px выше верха липкого футера (fade 30px не
    // съедает «КЦ 19–20»; спейсер-маржин 44px, не паддинг/88vh — KICK п.1).
    const tail = await page.evaluate(() => {
      const box = document.querySelector('.cc-roadmap-box');
      if (!box) return null;
      const foot = box.querySelector('.cc-roadmap-foot');
      const rows = box.querySelectorAll('.cc-roadmap-row');
      const last = rows[rows.length - 1];
      box.scrollTop = box.scrollHeight; // полный скролл вниз
      return new Promise((res) => setTimeout(() => {
        const fr = foot.getBoundingClientRect();
        const lr = last.getBoundingClientRect();
        const lvl20 = (last.textContent || '').trim();
        res({ rows: rows.length, gap: Math.round(fr.top - lr.bottom), lvl20,
          footH: Math.round(fr.height) });
      }, 200));
    });
    assert(tail, S('роадмап-бокс'), 'бокс роадмапа не найден');
    assert(tail.rows === 20, S('роадмап-строки'), 'строк роадмапа: ' + tail.rows);
    assert(/КЦ\s*20|20$/.test(tail.lvl20) || tail.lvl20.includes('20'),
      S('роадмап-последняя'), 'последняя строка не «КЦ 20»: ' + tail.lvl20);
    assert(tail.gap >= 30, S('роадмап-хвост'),
      `низ последней строки лишь ${tail.gap}px выше верха футера (<30 — fade съедает КЦ 19–20)`);
    // №13: кнопка «Закрыть» доступна (кламп боксом)
    const closeOk = await page.evaluate(() => {
      const b = document.querySelector('.cc-roadmap-foot button');
      if (!b) return false;
      const r = b.getBoundingClientRect();
      return r.width > 0 && r.bottom <= innerHeight + 1 && r.top >= -1; // достижим скроллом/в кадре
    });
    assert(closeOk, S('№13-закрыть'), 'кнопка «Закрыть» недостижима');
    await clickUI(page, '.cc-roadmap-foot button');
    if (!await waitStep(page, 8, S('финал'))) return;
    // ace#41 GATE п.5: финал — ДВА тоста: «База ваша» первым, легенда шаттла
    // ВТОРЫМ, ≥1.7с спустя (антиспам ui.js — интервал 1600мс, стек 3).
    const toasts = () => page.evaluate(() =>
      [...document.querySelectorAll('#toasts .toast')].map((x) => x.textContent));
    await page.waitForTimeout(600);
    let ts = await toasts();
    assert(ts.some((x) => x.includes('База ваша')), S('тост1'),
      'первый тост финала не показан: ' + JSON.stringify(ts));
    assert(!ts.some((x) => x.includes('Дом-шаттл')), S('шаттл-не-рано'),
      'шаттл-тост появился раньше 1.7с: ' + JSON.stringify(ts));
    await page.waitForTimeout(1900);
    ts = await toasts();
    assert(ts.some((x) => x.includes('Дом-шаттл — единственный путь в экспедиции за ресурсами')),
      S('шаттл-тост'), 'шаттл-тоста нет после 2.5с: ' + JSON.stringify(ts));
    // №10: objective финала держится (ace#41 п.4: текст ведёт к обороне — «турели»)
    v = await snap(page);
    assert(v.objective === 'Поднимите КЦ до ур. 2 — откроет турели',
      S('№10-objective'), 'objective: "' + v.objective + '"');
    assert(/турел/.test(v.objective), S('№10-objective-турели'), 'objective без «турел»: ' + v.objective);
    assert(v.done && !v.active, S('финал-флаги'), 'done/active неверны');
    // №15: чип/скип геометрия (чек на живом шаге — чип появляется при 2+ выделении)
    assert(errors.filter((e) => !/favicon|save|Сервер|net::|Failed to fetch|ERR/.test(e)).length === 0,
      S('pageerror'), errors.join(' | '));
    pass(tag, 'полный walkthrough 8 шагов чисто');
  } catch (e) {
    fail(tag, 'исключение: ' + e.message);
  } finally {
    await ctx.close();
  }
}

// ---------- сценарий G (ace#37 Волна 2): reduced-motion + luma-гейт dim ----------
// (а) prefers-reduced-motion: пульс гасится, дырка остаётся статично видимой;
// (б) luma-гейт шага 1: падение luma вне дырки при dim ≤ 25%+3pp (скриншотный
//     замер: canvas getImageData не видит DOM-оверлей — меряем композитный кадр);
// (в) edge шага 4а (вся карта под dim): тот же luma-гейт.
const LUMA_MAX_DROP_PCT = 28; // спека ≤25% + 3pp epsilon (шум пульса/антиалиасинга)
async function shotLuma(page) {
  const buf = await page.screenshot();
  const b64 = buf.toString('base64');
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await new Promise((res) => { img.onload = res; });
    const cv = document.createElement('canvas');
    cv.width = img.width; cv.height = img.height;
    const cx = cv.getContext('2d');
    cx.drawImage(img, 0, 0);
    const W = img.width, H = img.height;
    // зона вне дырки: кадр без топбара (≤58px), нижней панели (≥H−130) и
    // прямоугольника дырки (+26px запас на glow/outline — их свот вклад не меряем)
    const holeEl = document.querySelector('.ob-hole');
    const hr = holeEl ? holeEl.getBoundingClientRect() : null;
    const y0 = 58, y1 = Math.max(y0 + 40, H - 130);
    const d = cx.getImageData(0, y0, W, y1 - y0).data;
    const inHole = (x, y) => hr && x > hr.left - 26 && x < hr.right + 26 && y > hr.top - 26 && y < hr.bottom + 26;
    let s = 0, n = 0;
    for (let y = y0; y < y1; y += 8) for (let x = 0; x < W; x += 8) {
      if (inHole(x, y)) continue;
      const i = ((y - y0) * W + x) * 4; // буфер ImageData начинается с y0
      s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      n++;
    }
    if (!n || !isFinite(s / n)) return -1; // сломанный замер — гейт отстоит
    return s / n;
  }, b64);
}
// luma-гейт: базовая линия — dim гасится прозрачным инжектом, затем штатный alpha
// из custom prop. Инжект через inline style — CSS каскад не правится.
async function lumaGate(page, name, shotPath) {
  const setA = (a) => page.evaluate((al) => {
    document.querySelectorAll('.ob-dim').forEach((el) => { el.style.background = 'rgba(4, 12, 16, ' + al + ')'; });
  }, a);
  await setA('0');
  await page.waitForTimeout(300);
  const L0 = await shotLuma(page);
  await page.evaluate(() => {
    const probe = document.querySelector('.ob-dim');
    if (!probe) return;
    probe.style.background = '';
    const m = getComputedStyle(probe).backgroundColor.match(/(?:, |,)([\d.]+)\)$/);
    const a = m ? m[1] : '.35';
    document.querySelectorAll('.ob-dim').forEach((el) => { el.style.background = 'rgba(4, 12, 16, ' + a + ')'; });
  });
  await page.waitForTimeout(300);
  const L1 = await shotLuma(page);
  if (shotPath) await page.screenshot({ path: shotPath });
  // снять инжект — вернуть CSS-каскад
  await page.evaluate(() => {
    document.querySelectorAll('.ob-dim').forEach((el) => { el.style.background = ''; });
  });
  if (!assert(L0 >= 0 && L1 >= 0, name, `сломанный замер: L0=${L0} L1=${L1}`)) return;
  const drop = ((L0 - L1) / L0) * 100;
  const ok = assert(drop <= LUMA_MAX_DROP_PCT, name,
    `падение luma вне дырки ${drop.toFixed(1)}% > допуска ${LUMA_MAX_DROP_PCT}% (L0=${L0.toFixed(1)} L1=${L1.toFixed(1)})`);
  if (ok) pass(name, `падение luma ${drop.toFixed(1)}% ≤ ${LUMA_MAX_DROP_PCT}%`);
}
async function scenarioG(browser) {
  const errors = [];
  const { ctx, page } = await freshPage(browser, errors, { reducedMotion: 'reduce' });
  const S = (m) => `G ${m}`;
  try {
    // (а) reduced-motion: пульс погашен, дырка статично видима
    await clickUI(page, '.ob-legend-next');
    if (!await waitStep(page, 1, S('шаг1'))) return;
    await page.waitForTimeout(600);
    const rm = await page.evaluate(() => {
      const h = document.querySelector('.ob-hole');
      if (!h) return { hole: false };
      const cs = getComputedStyle(h);
      const r = h.getBoundingClientRect();
      return {
        hole: true, animName: cs.animationName, animDur: cs.animationDuration,
        w: Math.round(r.width), hgt: Math.round(r.height),
        borderOn: cs.borderColor !== 'rgba(0, 0, 0, 0)', shadowOn: cs.boxShadow !== 'none',
      };
    });
    if (assert(rm.hole, S('RM-дырка'), 'дырка не найдена')) {
      assert(rm.animName === 'none' && rm.animDur === '0s', S('RM-пульс-погашен'),
        `анимация жива: ${rm.animName}/${rm.animDur}`);
      assert(rm.w > 0 && rm.hgt > 0 && rm.borderOn && rm.shadowOn, S('RM-статик-видима'),
        `дырка не видима без пульса: ${JSON.stringify(rm)}`);
      await page.screenshot({ path: '/tmp/w2-reduced-motion.png' });
      pass(S('RM reduced-motion'), 'пульс погашен, дырка статично видима');
    }
    // (б) luma-гейт шага 1
    await lumaGate(page, S('Luma-шаг1'), '/tmp/w2-step1-luma.png');
    // (в) edge шага 4а: честный путь 1→2→3→4 (вся карта под dim, дырка на «Строить»)
    const v = await snap(page);
    const w = v.worker;
    if (!assert(w, S('шаг1'), 'нет сборщика')) return;
    await clickWorld(page, w.x, w.y);
    if (!await waitStep(page, 2, S('шаг2'))) return;
    await dblWorld(page, w.x, w.y);
    if (!await waitStep(page, 3, S('шаг3'))) return;
    const v3 = await snap(page);
    const cr = v3.crystals[0];
    if (!assert(cr, S('шаг3'), 'нет кристаллов')) return;
    await clickWorld(page, cr.x, cr.y, 'right');
    if (!await waitStep(page, 4, S('шаг4'))) return;
    await assertOneLine(page, S('шаг4а-строка'));
    await lumaGate(page, S('Luma-шаг4а'), '/tmp/w2-step4a-luma.png');
    assert(errors.filter((e) => !/favicon|save|Сервер|net::|Failed to fetch|ERR/.test(e)).length === 0,
      S('pageerror'), errors.join(' | '));
    pass('G reduced-motion + luma-гейт dim', 'все ассерты зелёные');
  } catch (e) {
    fail('G', 'исключение: ' + e.message);
  } finally {
    await ctx.close();
  }
}

// ---------- сценарий B: нетерпеливый скип ----------
async function scenarioB(browser) {
  const errors = [];
  const { ctx, page } = await freshPage(browser, errors);
  try {
    await clickUI(page, '.ob-skip');
    await page.waitForTimeout(400);
    const v = await snap(page);
    assert(v.done && v.skipped && !v.active, 'B-скип', 'флаги скипа неверны');
    // ace#35: скип тура → kindness-автодобыча: стоявшие сборщики получили
    // gather (программный приказ на ближайший разведанный кристалл).
    await page.waitForTimeout(600); // кадр-два: приказ уже выдан, путь строится
    const b2 = await snap(page);
    assert(b2.workers.length === 2 && b2.workers.every((q) => q.order === 'gather'),
      'B-автодобыча', 'после скипа сборщики не добыча: ' + JSON.stringify(b2.workers.map((q) => q.order)));
    pass('B нетерпеливый скип', 'done+skipped, оверлей снят, сборщики отправлены добывать');
  } catch (e) { fail('B', e.message); } finally { await ctx.close(); }
}

// ---------- сценарий C: повтор легенды ----------
async function scenarioC(browser) {
  const errors = [];
  const { ctx, page } = await freshPage(browser, errors);
  try {
    await clickUI(page, '.ob-skip'); // скипнуть онбординг
    await page.waitForTimeout(300);
    await page.evaluate(async () => {
      const OB = await import('./js/onboarding.js?v=11030130');
      OB.showLegendAgain(window.game);
    });
    await page.waitForTimeout(300);
    let v = await snap(page);
    assert(v.done && v.skipped, 'C-флаги', 'повтор легенды тронул флаги');
    const skipVisible = await page.evaluate(() => {
      const b = document.querySelector('.ob-skip');
      return b && b.classList.contains('is-on') && getComputedStyle(b).display !== 'none';
    });
    assert(skipVisible, 'C-скип-кнопка', 'у повторной легенды нет «Пропустить»');
    await clickUI(page, '.ob-skip'); // №9: должна закрыть ТОЛЬКО легенду
    await page.waitForTimeout(400);
    v = await snap(page);
    assert(v.done && v.skipped, '№9-флаги', 'скип повторной легенды изменил флаги');
    const legendGone = await page.evaluate(() => {
      const l = document.getElementById('ob-legend');
      return !l || !l.classList.contains('is-on');
    });
    assert(legendGone, 'C-легенда-закрыта', 'легенда не закрылась');
    pass('C повтор легенды', 'скип закрыл только легенду, флаги не тронуты');
  } catch (e) { fail('C', e.message); } finally { await ctx.close(); }
}

// ---------- сценарий F: 5× первый тап шага 1 ----------
async function scenarioF(browser) {
  let ok = 0;
  for (let i = 0; i < 5; i++) {
    const errors = [];
    const { ctx, page } = await freshPage(browser, errors);
    try {
      await clickUI(page, '.ob-legend-next');
      await page.waitForFunction(() => window.game.onboarding.step === 1, null, { timeout: 8000 });
      const w = await page.evaluate(() => {
        const st = window.game.state;
        const u = st.units.find((x) => !x.dead && !x.garrison && x.side === 'player' && x.type === 'worker');
        const c = document.getElementById('game-canvas').getBoundingClientRect();
        const s = window.game.worldToScreen(u.x, u.y);
        return { x: c.left + s.x, y: c.top + s.y };
      });
      await page.mouse.click(w.x, w.y); // СРАЗУ, без пауз — флейк-ветка
      await page.waitForFunction(() => window.game.onboarding.step === 2, null, { timeout: 5000 });
      ok++;
    } catch { /* флейк */ }
    await ctx.close();
  }
  assert(ok === 5, 'F-флейк-5x', `первый тап сработал только в ${ok}/5`);
  pass('F 5× первый тап шага 1', `${ok}/5`);
}

// ---------- сценарий H (ace#41 GATE п.6): JIT-подсказка меню ----------
// Пост-тур handoff: первое открытие меню «Строить» ПОСЛЕ тура → один тост
// «Серые карточки откроются с уровнем КЦ» + флаг ac_ob_menu_hint_v1;
// повторное открытие — тоста НЕТ; reload → флаг живёт → тоста НЕТ.
async function scenarioH(browser) {
  const errors = [];
  // clearStorage=false: init-скрипт freshPage чистит localStorage на КАЖДОМ
  // документе — стёр бы флаг при reload. Свежий контекст и так пуст.
  const { ctx, page } = await freshPage(browser, errors, {}, false);
  const S = (m) => `H ${m}`;
  const jitCount = async () => (await page.evaluate(() =>
    [...document.querySelectorAll('#toasts .toast')].map((x) => x.textContent)))
    .filter((x) => x.includes('Серые карточки')).length;
  const selectWorker = () => page.evaluate(() => {
    const st = window.game.state;
    const w = st.units.find((u) => !u.dead && !u.garrison && u.side === 'player' && u.type === 'worker');
    if (!w) return false;
    st.selection = [w]; // детерминизм: тап по бегущему сборщику флейкует
    return true;
  });
  try {
    await page.evaluate(() => { try { localStorage.setItem('ac_dbltap_hint_v1', '1'); } catch {} });
    await clickUI(page, '.ob-skip'); // тур скипнут → гвард (done||skipped) открыт
    await page.waitForTimeout(500);
    assert(await jitCount() === 0, S('до-меню'), 'JIT-тост до первого открытия меню');
    assert(await selectWorker(), S('воркер'), 'нет сборщика после скипа');
    await page.waitForTimeout(300); // кадр: кнопка «Строить» отрисовалась
    await cmdClick(page, 'KeyB');
    let v = await snap(page);
    assert(v.buildMenu, S('меню'), 'меню стройки не открылось');
    assert(await jitCount() === 1, S('JIT-один'),
      'первое открытие меню без JIT-тоста (или задвоило): ' + await jitCount());
    const flag = await page.evaluate(() => localStorage.getItem('ac_ob_menu_hint_v1'));
    assert(flag === '1', S('JIT-флаг'), 'флаг ac_ob_menu_hint_v1 не выставлен: ' + flag);
    await page.screenshot({ path: '/tmp/ob2w1-jit.png' });
    // повторное открытие меню — ВТОРОГО тоста нет
    await page.evaluate(() => { window.game.state.buildMenu = false; });
    await page.waitForTimeout(300);
    await cmdClick(page, 'KeyB');
    v = await snap(page);
    assert(v.buildMenu, S('меню-2'), 'меню не открылось повторно');
    assert(await jitCount() === 1, S('JIT-однократность'), 'JIT-тост задублировался');
    // reload: флаг переживает перезагрузку → тоста нет
    await page.reload();
    await guestGate(page);
    await page.waitForFunction(() => window.game && window.game.started, null, { timeout: 60000 });
    await page.waitForTimeout(1500); // гидрация рейда асинхронна (как в сценарии D)
    // капсулы могут автопоказаться при входе (модал = пауза, cmd-grid пуст) —
    // закрываем как пользователь: Escape закрывает верхнюю модалку (modals.js).
    for (let i = 0; i < 3; i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(250); }
    assert(await jitCount() === 0, S('reload-до'), 'JIT-тост после reload до открытия меню');
    // гидрация может заменить state ПОСЛЕ программного выделения — ретраи
    let opened = false;
    for (let i = 0; i < 8 && !opened; i++) {
      assert(await selectWorker(), S('воркер-2'), 'нет сборщика после reload');
      await page.waitForTimeout(350);
      await cmdClick(page, 'KeyB');
      opened = (await snap(page)).buildMenu;
    }
    assert(opened, S('меню-3'), 'меню после reload не открылось (8 попыток select+KeyB)');
    await page.waitForTimeout(600); // кадр-два: тост успел бы появиться
    assert(await jitCount() === 0, S('reload-нет-тоста'), 'после reload JIT-тост показался снова');
    assert(errors.filter((e) => !/favicon|save|Сервер|net::|Failed to fetch|ERR/.test(e)).length === 0,
      S('pageerror'), errors.join(' | '));
    pass('H JIT-подсказка меню: один раз, флаг выставлен, reload глушит');
  } catch (e) { fail('H', e.message); } finally { await ctx.close(); }
}

const ONLY = process.argv[3] || '';
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] } : {});
try {
  if (!ONLY || ONLY === 'A') {
    const runs = Math.max(1, Number(process.env.OB_RUNS || 3));
    for (let i = 1; i <= runs; i++) await scenarioA(browser, `A${i} полный walkthrough`);
  }
  if (!ONLY || ONLY === 'D') await scenarioA(browser, 'D reload-на-6б', 'reload6b');
  if (ONLY === 'E') await scenarioA(browser, 'E reload-до-найма', 'reload6a');
  if (ONLY === 'I') await scenarioA(browser, 'I reload-во-время-стройки', 'reload5');
  if (!ONLY || ONLY === 'B') await scenarioB(browser);
  if (!ONLY || ONLY === 'C') await scenarioC(browser);
  if (!ONLY || ONLY === 'G') await scenarioG(browser);
  if (!ONLY || ONLY === 'F') await scenarioF(browser);
  if (!ONLY || ONLY === 'H') await scenarioH(browser);
} finally {
  await browser.close();
}
if (failures.length) {
  console.log('\nИТОГ: FAIL — ' + failures.join(', '));
  process.exit(1);
}
console.log('\nИТОГ: PASS — все прогоны чисто');
