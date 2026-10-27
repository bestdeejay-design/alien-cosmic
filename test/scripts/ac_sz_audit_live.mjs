// ac_sz_audit_live.mjs — живая проверка находок аудита SZ (26.10, владелец:
// тишина без профиля / пин-формы / гейт админки / Дом-лечение / ремонт сборщиков).
// Стенд: POLYGON=1 PORT=8806 static.mjs + save-server :8790.
// Каждая проверка T* = гипотеза код-аудита; PASS = баг подтверждён живьём.
import { chromium } from 'playwright';

const BASE = 'http://localhost:8806';
const errors = [];
const steps = [];
const ok = (id, msg) => { steps.push(`PASS  ${id}: ${msg}`); console.log(`PASS  ${id}: ${msg}`); };
const bad = (id, msg) => { steps.push(`FAIL  ${id}: ${msg}`); console.log(`FAIL  ${id}: ${msg}`); };
const step = async (id, fn) => { try { await fn(); } catch (e) { bad(id, String((e && e.message) || e)); } };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

// Счётчик стука на сервер (все /api/* и /health).
const knocks = [];
page.on('request', (r) => {
  const u = r.url();
  if (u.includes('/api/') || u.includes('/health')) knocks.push(`${r.method()} ${u.replace(BASE, '')}`);
});
page.on('response', (r) => {
  if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url().replace(BASE, '')}`);
});

// 1. Автостарт базы.
await page.goto(BASE + '/r/', { waitUntil: 'load' });
await page.waitForTimeout(1200);
await page.waitForFunction(() => window.game && window.game.started, null, { timeout: 20000 });
const stamp = await page.evaluate(async () => {
  const html = await (await fetch('/r/index.html')).text();
  const m = html.match(/\?v=([0-9A-Za-z._-]+)/);
  return m ? m[1] : '1';
});
ok('T0 автостарт', 'база запущена, identity=' + JSON.stringify(await page.evaluate(() => window.__saveIdentity)));

// Дом Г3 создаём, если автозапуск его не строит (как в баг-ханте D4).
async function ensureHouse(level) {
  return page.evaluate(async ({ stamp, level }) => {
    const st = window.game.state;
    const B = await import(`/r/js/buildings.js?v=${stamp}`);
    let b = st.buildings.find((x) => !x.dead && x.side === 'player' && x.type === 'depot');
    if (!b) {
      const cc = st.buildings.find((x) => !x.dead && x.side === 'player' && x.type === 'cc');
      b = new B.Building(st, 'player', 'depot', cc.tx + 6, cc.ty + 2, true);
      st.map.markBuilding(b);
    }
    b.level = level; b.done = true;
    return true;
  }, { stamp, level });
}

// T1: клавиатура в форме профиля — пин (цифры) и ник (буквы).
await step('T1 формы пин/ник не вводятся', async () => {
  await page.evaluate(() => window.showProfilePanel());
  await page.waitForTimeout(200);
  await page.click('#sv-nick');
  await page.keyboard.type('ab', { delay: 40 });
  await page.keyboard.press('Digit5');
  await page.keyboard.type('c', { delay: 40 });
  const nickVal = await page.evaluate(() => document.getElementById('sv-nick').value);
  await page.click('#sv-pin');
  await page.keyboard.type('1234', { delay: 40 });
  const pinVal = await page.evaluate(() => document.getElementById('sv-pin').value);
  const pausedByP = await page.evaluate(() => window.game.paused);
  if (pinVal === '1234') ok('T1', 'пин ввёлся (гипотеза не подтвердилась)');
  else bad('T1', `пин НЕ вводится: набрали «1234», в поле «${pinVal}»; ник: набрали «ab5c», в поле «${nickVal}»; пауза от клавиши p: ${pausedByP}`);
  await page.evaluate(() => { document.getElementById('sv-panel')?.remove(); window.game.paused = false; });
});

// T2: Дом — перелёт не обновляет b.x/b.y (центр остаётся на старом месте).
await step('T2 Дом: x/y устаревают после перелёта', async () => {
  await ensureHouse(3);
  const r = await page.evaluate(() => {
    const st = window.game.state;
    const TILE = 32;
    const b = st.buildings.find((x) => !x.dead && x.side === 'player' && x.type === 'depot');
    if (!b) throw new Error('нет Дома');
    const oldX = b.x, oldY = b.y, oldTx = b.tx;
    const wx = (b.tx + 8) * TILE, wy = (b.ty + 6) * TILE;
    window.game.moveHouse(b, wx, wy);
    return {
      oldX, oldY, oldTx, newTx: b.tx, newX: b.x, newY: b.y,
      expectX: (b.tx + b.w / 2) * TILE, expectY: (b.ty + b.h / 2) * TILE,
    };
  });
  const stale = Math.abs(r.newX - r.expectX) > 1 || Math.abs(r.newY - r.expectY) > 1;
  if (stale) bad('T2', `Дом переехал на тайл ${r.newTx}, центр px остался (${Math.round(r.newX)},${Math.round(r.newY)}) вместо (${Math.round(r.expectX)},${Math.round(r.expectY)}) — b.x/b.y не обновлены`);
  else ok('T2', 'x/y обновляются (гипотеза не подтвердилась)');
});

// T2b: выпустить отсек после перелёта — юниты выйдут на СТАРОМ месте.
await step('T2b отсек выпускается на старом месте', async () => {
  await ensureHouse(3);
  const r2 = await page.evaluate(async (stamp) => {
    const st = window.game.state, TILE = 32;
    const { releaseGarrison } = await import(`/r/js/units.js?v=${stamp}`);
    const b = st.buildings.find((x) => !x.dead && x.side === 'player' && x.type === 'depot');
    if (!b) throw new Error('нет Дома');
    const mock = { dead: false, garrison: b, hidden: true, order: { kind: 'idle' }, type: 'marine', id: -99, side: 'player' };
    st.units.push(mock);
    b.garrison = [mock];
    const centerNewX = (b.tx + b.w / 2) * TILE, centerNewY = (b.ty + b.h / 2) * TILE;
    releaseGarrison(st, b);
    const out = { spawnX: Math.round(mock.x), spawnY: Math.round(mock.y), centerNewX: Math.round(centerNewX), centerNewY: Math.round(centerNewY), bX: Math.round(b.x), bY: Math.round(b.y) };
    // очистка мока
    mock.dead = true;
    const i = st.units.indexOf(mock); if (i >= 0) st.units.splice(i, 1);
    b.garrison = [];
    return out;
  }, stamp);
  if (Math.abs(r2.spawnX - r2.centerNewX) > 40 || Math.abs(r2.spawnY - r2.centerNewY) > 40) bad('T2b', `выпуск отсека: юнит вышел в (${r2.spawnX},${r2.spawnY}), а Дом стоит в (${r2.centerNewX},${r2.centerNewY}) — считается от старого центра (${r2.bX},${r2.bY})`);
  else ok('T2b', 'отсек выходит у нового места (гипотеза не подтвердилась)');
});

// T3: тишина без профиля — сколько стука на сервер за 20с без identity.
await step('T3 стук на сервер без профиля', async () => {
  knocks.length = 0;
  await page.waitForTimeout(20000);
  const saves = knocks.filter((k) => k.includes('/api/save')).length;
  const health = knocks.filter((k) => k.includes('/health')).length;
  if (saves > 0 || health > 0) bad('T3', `за 20с без профиля: /health ×${health}, /api/save ×${saves} (все с pin=undefined → 400) — сервер не молчит`);
  else ok('T3', 'сервер молчит (гипотеза не подтвердилась)');
});

// T4: админка открывается по PIN без профиля (пин вводим fill — мимо клавиатуры).
await step('T4 админка не привязана к профилю', async () => {
  await page.evaluate(async (stamp) => {
    const { openAdmin } = await import(`/r/js/admin.js?v=${stamp}`);
    openAdmin(window.game);
  }, stamp);
  await page.waitForTimeout(200);
  await page.fill('#adm-pin', '1234');
  await page.click('#adm-login');
  await page.waitForTimeout(300);
  const state = await page.evaluate(() => {
    const gate = document.getElementById('adm-gate');
    const main = document.getElementById('adm-main');
    return { gateHidden: gate && gate.classList.contains('hidden'), mainVisible: main && !main.classList.contains('hidden'), identity: window.__saveIdentity };
  });
  if (state.mainVisible && !state.identity) bad('T4', 'админка открыта (PIN 1234) БЕЗ профиля — привязки к профилю владельца нет');
  else ok('T4', 'без профиля админка не пускает (гипотеза не подтвердилась)');
  await page.evaluate(() => { document.getElementById('admin-overlay')?.remove(); window.game.paused = false; });
});

// T5: Дом-Г4 НЕ лечит на домашней базе (аура только на вылазке).
await step('T5 Дом-Г4 не лечит дома', async () => {
  await ensureHouse(4);
  const r = await page.evaluate(async (stamp) => {
    const st = window.game.state, TILE = 32;
    const b = st.buildings.find((x) => !x.dead && x.side === 'player' && x.type === 'depot');
    if (!b) throw new Error('нет Дома');
    b.level = 4; // Г4 = лечение по канону
    // убираем медиков подальше, чтобы не лечили подопытного
    for (const m of st.units) if (!m.dead && m.side === 'player' && m.cfg && m.cfg.canHeal) { m.x = 2 * TILE; m.y = 2 * TILE; m.path = null; }
    const w = st.units.find((u) => !u.dead && u.side === 'player' && u.type === 'worker');
    if (!w) throw new Error('нет рабочего');
    // ставим рабочего вплотную к Дому (в новые тайлы)
    w.x = (b.tx + b.w / 2) * TILE; w.y = (b.ty + b.h / 2) * TILE;
    w.hp = Math.max(1, Math.floor(w.maxHp * 0.3));
    const hp0 = w.hp;
    // при явном патче: paуза выключена, тикаем
    return await new Promise((resolve) => {
      setTimeout(() => resolve({ healed: w.hp - hp0, hp: Math.round(w.hp), max: w.maxHp }), 3000);
    });
  }, stamp);
  if (r.healed > 0.5) ok('T5', `лечится и дома (гипотеза не подтвердилась): +${r.healed.toFixed(1)} HP/3с`);
  else bad('T5', `Дом-Г4 стоит рядом, рабочий ${r.hp}/${r.max} HP — за 3с лечение +${r.healed.toFixed(1)} (аура работает только на вылазке)`);
});

// T6: сборщик не может починить сборщика (RMB по раненому рабочему).
await step('T6 сборщик не чинит сборщика', async () => {
  const r = await page.evaluate(() => {
    const st = window.game.state, TILE = 32;
    const ws = st.units.filter((u) => !u.dead && u.side === 'player' && u.type === 'worker' && !u.garrison);
    if (ws.length < 2) throw new Error('нужно 2 рабочих, есть ' + ws.length);
    const wounded = ws[0], medic = ws[1];
    wounded.hp = Math.max(1, Math.floor(wounded.maxHp * 0.4));
    // выделяем второго и ПКМ по первому
    st.selection = [medic];
    window.game.issueRMB(wounded.x, wounded.y);
    return { order: medic.order.kind, targetIsUnit: medic.order.target ? (medic.order.target === wounded) : null };
  });
  if (r.order === 'repair' && r.targetIsUnit) ok('T6', 'починил (гипотеза не подтвердилась)');
  else bad('T6', `ПКМ по раненому рабочему: приказ = «${r.order}» (ремонта нет — цели ремонта: только здания и техника)`);
});

await page.screenshot({ path: '/tmp/szbug_audit/final.png' }).catch(() => {});
console.log('\n=== ОШИБКИ РАНТАЙМА/HTTP>=400 ===');
console.log(errors.length ? errors.join('\n') : '(нет)');
console.log('\n=== ИТОГ ===');
for (const s of steps) console.log(s);
await browser.close();
