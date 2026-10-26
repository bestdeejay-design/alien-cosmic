// ac_sz_evac_repro.mjs — репро трёх багов владельца от 26.10 (поздний вечер):
//   BUG-1: эвакуация не завершается, когда юниты сидят в отсеке Дома (гарнизон
//          не досчитывается в aliveLeft) + повторное нажатие при пустом борту
//          отменяет отход вместо взлёта;
//   BUG-2: сборщики бурят после заполнения трюма (проверки cap в цикле добычи нет);
//   BUG-3: консоль вылазки обещает «эрг на карте = yieldTotal», реальный пул ×1.2.
// Стенд: PORT=8823 node server/static.mjs (репо-корень). Скриншоты: download/evac_repro/.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:8823';
const OUT = '/home/z/my-project/download/evac_repro';
mkdirSync(OUT, { recursive: true });

const errors = [];
const ok = (id, msg) => console.log(`PASS  ${id}: ${msg}`);
const bad = (id, msg) => console.log(`FAIL  ${id}: ${msg}`);
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png` }).catch(() => {});
const stampOf = (page) => page.evaluate(async () => {
  const html = await (await fetch('/r/index.html')).text();
  const m = html.match(/\?v=([0-9A-Za-z._-]+)/);
  return m ? m[1] : null;
});

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('/api/save')) errors.push(`HTTP ${r.status()} ${r.url()}`); });

await page.goto(`${BASE}/r/`, { waitUntil: 'load' });
for (let i = 0; i < 100 && !(await page.evaluate(() => !!(window.game && window.game.state))); i++) {
  await page.waitForTimeout(100);
}
ok('boot', 'полигон поднялся, game.state готов');

const backHome = async () => {
  await page.evaluate(() => {
    const st = window.game.state;
    if (st && st.raidMode === 'expedition' && !st.gameOver) window.game.finishRaidExpedition('evac');
  });
  await page.waitForTimeout(1500);
  const m = await page.evaluate(() => window.game.state && window.game.state.raidMode);
  if (m && m !== 'home') throw new Error('не вернулись на базу, mode=' + m);
};

const ensureDepotAndLaunch = async (seed) => {
  await backHome();
  const v = await page.evaluate(async (s) => {
    const g = window.game, st = g.state;
    const U = await import('/r/js/units.js?v=10262517');
    const B = await import('/r/js/buildings.js?v=10262517');
    if (!st.buildings.some((b) => !b.dead && b.type === 'depot' && b.side === 'player')) {
      const cc = st.buildings.find((b) => !b.dead && b.side === 'player' && b.type === 'cc');
      const d = new B.Building(st, 'player', 'depot', cc.tx + 3, cc.ty + 3, true);
      d.level = 2;
      st.map.markBuilding(d);
      st.bcount.player++;
    }
    const depot = st.buildings.find((b) => !b.dead && b.type === 'depot' && b.side === 'player');
    depot.level = Math.max(2, depot.level || 1);
    // Компенсируем потери прошлых прогонов: докидываем недостающих спавном у КЦ
    const cc = st.buildings.find((b) => !b.dead && b.side === 'player' && b.type === 'cc');
    const home = (t) => st.units.filter((u) => !u.dead && !u.garrison && u.side === 'player' && u.kind === 'unit' && u.type === t).length;
    for (let i = home('worker'); i < 2; i++) U.spawnUnit(st, 'player', 'worker', (cc.tx + 2 + i) * 32, (cc.ty + 2) * 32);
    for (let i = home('marine'); i < 2; i++) U.spawnUnit(st, 'player', 'marine', (cc.tx + 2 + i) * 32, (cc.ty + 4) * 32);
    const res = g.launchRaidExpedition({ tier: 1, seed: s, budget: 100, units: { worker: 2, marine: 2 } });
    if (!res || !res.ok) throw new Error('launch rejected: ' + JSON.stringify(res));
    return true;
  }, seed);
  await page.waitForTimeout(2500);
  return v;
};

const raidState = () => page.evaluate(() => {
  const st = window.game.state;
  const players = st.units.filter((u) => !u.dead && !u.evacuated && u.side === 'player' && u.kind === 'unit');
  return {
    mode: st.raidMode,
    evac: !!st.raidEvacuating,
    boarded: (st.raidBoarded || []).length,
    field: players.filter((u) => !u.garrison).length,
    inGarrison: players.filter((u) => !!u.garrison).length,
    cargo: Math.round(st.raidCargo || 0),
    cap: st.raidCargoCap || 0,
    lost: Math.round(st.raidCargoLost || 0),
    gameOver: !!st.gameOver,
    toast: (document.querySelector('.toast, #toast') || {}).innerText || '',
  };
});

// Телепорт юнита к зданию вплотную (внутрь 1 тайла от прямоугольника)
const teleportNear = (page, who, what) => page.evaluate(({ who, what }) => {
  const st = window.game.state;
  const b = what === 'house' ? st.raidHouse
    : what === 'pad' ? { tx: (st.raidDrop.x / 32) - 1, ty: (st.raidDrop.y / 32) - 1 }
    : null;
  if (!b) throw new Error('нет цели телепорта');
  const u = st.units.find(who);
  if (!u) throw new Error('нет юнита');
  u.x = (b.tx + b.w / 2) * 32;
  u.y = (b.ty - 0.6) * 32; // над зданием, в тайле от кромки
  u.path = null; u.moving = false;
}, { who, what });

const fabGarrison = (page) => page.evaluate(() => {
  const st = window.game.state;
  const house = st.raidHouse;
  const u = st.units.find((x) => !x.dead && x.side === 'player' && x.kind === 'unit' && !x.garrison);
  if (!u) return null;
  u.garrison = house;
  house.garrison.push(u);
  u.hidden = true;
  u.selected = false;
  u.order = { kind: 'idle' };
  u.path = null;
  return u.type;
});

// ============ BUG-1a: гарнизон не досчитывается → авто-финиш не стреляет ============
try {
  await ensureDepotAndLaunch(4242);
  // Полевых — к кольцу посадки, чтобы борт шёл быстро
  await page.evaluate(() => {
    const st = window.game.state;
    const pad = st.raidDrop;
    for (const u of st.units.filter((x) => !x.dead && !x.garrison && x.side === 'player' && x.kind === 'unit')) {
      u.x = pad.x + (Math.random() - 0.5) * 40;
      u.y = pad.y + (Math.random() - 0.5) * 40;
      u.path = null; u.moving = false;
    }
  });
  const gt = await fabGarrison(page); // одного — в отсек Дома напрямую
  ok('garrison', `в отсек посажен: ${gt}`);
  let s = await raidState();
  ok('setup', `mode=${s.mode} поле=${s.field} отсек=${s.inGarrison}`);

  await page.evaluate(() => window.game.triggerRaidEvac()); // нажатие 1
  await page.waitForTimeout(9000); // pad.hold = 2с, запас на борт
  s = await raidState();
  console.log(`      после 9с: mode=${s.mode} evac=${s.evac} boarded=${s.boarded} поле=${s.field} отсек=${s.inGarrison}`);
  await page.waitForTimeout(11000); // ещё 11с — хвостовые полевые должны досесть
  s = await raidState();
  await shot(page, 'bug1a_after_press1');
  console.log(`      после 20с: mode=${s.mode} evac=${s.evac} boarded=${s.boarded} поле=${s.field} отсек=${s.inGarrison}`);
  if (s.boarded >= 3 && s.field === 0 && s.mode === 'expedition' && s.inGarrison >= 1) {
    bad('BUG-1a ПОДТВЕРЖДЁН',
      `все полевые на борту (${s.boarded}), отсек ${s.inGarrison} держит aliveLeft>0 — авто-взлёт не стреляет ${s.evac ? 'и evac висит' : ''}`);
  } else if (s.boarded >= 3 && s.field > 0 && s.mode === 'expedition') {
    bad('BUG-1a частично', `полевой(е) ${s.field} не сел(и) за 20с: ` + JSON.stringify(s));
  } else if (s.mode === 'home') {
    ok('BUG-1a не воспроизвёлся', 'авто-взлёт сработал несмотря на гарнизон');
  } else {
    bad('BUG-1a', 'неожиданное состояние: ' + JSON.stringify(s));
  }

  if (s.mode === 'expedition' && s.boarded > 0) {
    await page.evaluate(() => window.game.triggerRaidEvac()); // нажатие 2
    await page.waitForTimeout(1500);
    s = await raidState();
    console.log(`      после нажатия 2: mode=${s.mode} boarded=${s.boarded} (второе нажатие при boarded>0 ${s.mode === 'home' ? 'СПАСАЕТ — владелец просто не дожал' : 'НЕ спасает'})`);
  }
} catch (e) { bad('BUG-1a прогон', String((e && e.message) || e)); }

// ============ BUG-1b: все в отсеке → повторное нажатие ОТМЕНЯЕТ отход ============
try {
  await ensureDepotAndLaunch(777001);
  const n = await page.evaluate(() => {
    const st = window.game.state;
    const house = st.raidHouse;
    let n = 0;
    for (const u of st.units.filter((x) => !x.dead && x.side === 'player' && x.kind === 'unit' && !x.garrison)) {
      u.garrison = house; house.garrison.push(u); u.hidden = true; u.selected = false;
      u.order = { kind: 'idle' }; u.path = null; n++;
    }
    return n;
  });
  let s = await raidState();
  console.log(`      BUG-1b setup: посажено в отсек ${n}, поле=${s.field} отсек=${s.inGarrison}`);
  await page.evaluate(() => window.game.triggerRaidEvac()); // нажатие 1
  await page.waitForTimeout(6000);
  s = await raidState();
  await shot(page, 'bug1b_after_press1');
  console.log(`      BUG-1b после нажатия 1: boarded=${s.boarded} evac=${s.evac} mode=${s.mode}`);
  await page.evaluate(() => window.game.triggerRaidEvac()); // нажатие 2
  await page.waitForTimeout(1200);
  s = await raidState();
  await shot(page, 'bug1b_after_press2');
  console.log(`      BUG-1b после нажатия 2: boarded=${s.boarded} evac=${s.evac} mode=${s.mode} toast="${s.toast.trim()}"`);
  if (s.mode === 'expedition' && s.boarded === 0) {
    bad('BUG-1b ПОДТВЕРЖДЁН', `отряд весь в отсеке: boarded=0, повторное нажатие ${s.evac ? 'висит в evac' : 'ОТМЕНИЛО отход'} — взлёт недостижим без ручного выхода из гарнизона`);
  } else if (s.mode === 'home') {
    ok('BUG-1b не воспроизвёлся', 'взлёт произошёл');
  } else {
    bad('BUG-1b', 'состояние: ' + JSON.stringify(s));
  }
  await backHome();
} catch (e) { bad('BUG-1b прогон', String((e && e.message) || e)); }

// ============ BUG-2: сборщики бурят при полном трюме ============
try {
  await ensureDepotAndLaunch(4243);
  await page.evaluate(() => { window.game.state.raidCargoCap = 40; }); // микротрюм
  await page.waitForTimeout(35000);
  const s = await raidState();
  const phases = await page.evaluate(() => {
    const st = window.game.state;
    return st.units
      .filter((u) => !u.dead && u.side === 'player' && u.type === 'worker' && !u.garrison)
      .map((u) => u.order && u.order.kind === 'gather' ? u.order.phase : (u.order ? u.order.kind : 'idle'));
  });
  await shot(page, 'bug2_full_cargo');
  console.log(`      BUG-2: cargo=${s.cargo}/${s.cap} lost=${s.lost} фазы рабочих: [${phases.join(', ')}]`);
  if (s.cargo >= s.cap && phases.some((p) => p === 'toMineral' || p === 'mine' || p === 'toDrop')) {
    bad('BUG-2 ПОДТВЕРЖДЁН', `трюм полон (${s.cargo}/${s.cap}, потеряно ${s.lost}), но рабочие продолжают цикл добычи: [${phases.join(', ')}]`);
  } else if (s.cargo >= s.cap) {
    ok('BUG-2 не воспроизвёлся', `рабочие остановились: [${phases.join(', ')}]`);
  } else {
    bad('BUG-2', 'трюм не заполнился за 35с: ' + JSON.stringify(s));
  }
  await backHome();
} catch (e) { bad('BUG-2 прогон', String((e && e.message) || e)); }

// ============ BUG-3: обещанный эрг vs реальный пул ============
try {
  await ensureDepotAndLaunch(4244);
  const t3 = await page.evaluate(async () => {
    const E = await import('/r/js/economy.js?v=10262517');
    const st = window.game.state;
    const tcfg = E.raidTierAt(st.raidTier || 1);
    return { shown: tcfg.yieldTotal, pool: st.raidLootPool || 0, left: st.raidLootLeft || 0, tier: st.raidTier };
  });
  console.log(`      BUG-3: тир ${t3.tier}: консоль обещала ${t3.shown}, реальный пул ${t3.pool} (×${(t3.pool / t3.shown).toFixed(2)})`);
  if (t3.pool > t3.shown) bad('BUG-3 ПОДТВЕРЖДЁН', `карта богаче обещанного на ${t3.pool - t3.shown} эрга (мультипликатор 1.2 в raid.js:575, консоль этого не знает)`);
  else ok('BUG-3 не воспроизвёлся', 'числа совпали');
} catch (e) { bad('BUG-3 прогон', String((e && e.message) || e)); }

await shot(page, 'final');
await browser.close();
console.log('\n=== ОШИБКИ РАНТАЙМА ===');
console.log(errors.length ? errors.slice(0, 12).join('\n') : '(чисто)');
