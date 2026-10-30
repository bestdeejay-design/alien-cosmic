// ============================================================
// sim_expedition_alarm_v2.mjs — ace#10 Ф-5 (ревизия SZ m2, ACCEPTANCE §2:90).
// Вылазка × Боевая тревога v2: запреты, перенос, возврат 1:1, семантика базы.
//   EX1 запуск вылазки запрещён в бою/восстановлении/учении (errAlarmActive);
//   EX2 домашние часы (incoming/cooldown) заморожены на время вылазки;
//   EX3 explored домашней карты и командир переживают вылет/возврат;
//   EX4 бюджет/груз зачисляются в кошелёк РОВНО один раз (микро-остаток,
//      returnId, lastSettledReturnId; reload через промоцию не дублирует);
//   EX5 грейд-таймер/очередь/СБОР-hold переживают вылет/возврат (П2-компенсация);
//   EX6 семантическое равенство базы до/после учения и отката ERROR_HOLD
//      (Ф-2), замороженные таймеры не продвигаются;
//   EX7 компенсация оффлайн-времени кэп 24 ч (не 100): таймеры не улетают.
// Запуск: node scripts/sim_expedition_alarm_v2.mjs
// ============================================================
import './harness.mjs';
import { V } from './stamp.mjs';

const failures = [];
const fail = (phase, err) => { failures.push(phase); console.log(`FAIL  ${phase}: ${String((err && err.message) || err)}`); };
const pass = (msg) => console.log(`PASS  ${msg}`);
const assert = (c, m) => { if (!c) throw new Error(m); };

await import('../r/js/game.js');
const DIR = await import('../r/js/alarm-v2-director.js' + V);
const U = await import('../r/js/units.js' + V);
const B = await import('../r/js/buildings.js' + V);
const R = await import('../r/js/raid.js' + V);
const STORE = await import('../r/js/alarm-v2-store.js' + V);
const ASM = await import('../r/js/alarm-v2-assembly.js' + V);

const game = globalThis.game;
assert(game, 'движок полигона не поднялся');
const ticks = (n) => { for (let i = 0; i < n; i++) game.tick(); };
const RAID_KEY = 'ac_raid_session_v1';

function bootHome() {
  game.startRaidHome('human', { forceNew: true });
  ticks(3);
  const st = game.state;
  const cc = st.buildings.find((b) => !b.dead && b.side === 'player' && b.type === 'cc');
  const depot = new B.Building(st, 'player', 'depot', cc.tx + 2, cc.ty + 2, true);
  depot.level = 5;
  depot.maxHp = depot.hp = Math.round(depot.cfg.hp * 2);
  st.map.markBuilding(depot);
  st.bcount.player++;
  ticks(2);
  return st;
}

function launch(st, budget = 50, units = { worker: 2 }) {
  const res = game.launchRaidExpedition({ tier: 1, seed: 4242, budget, units });
  assert(res && res.ok, 'вылазка не запустилась: ' + JSON.stringify(res));
  ticks(4);
  return game.state;
}

const meta = () => game.raidSession.alarmV2;
const wallet = () => BigInt(game.raidSession.alarmV2.walletMicro);
// В браузере каждая загрузка — отдельный макротаск (lock успевает
// освободиться); в симе промоции идут подряд — даём микротаскам
// дотикать релиз lease перед следующим захватом.
const flushLocks = () => new Promise((r) => setImmediate(r));

// Семантический отпечаток базы (Ф-2/EX6): сущности/HP/позиции/технологии/
// кристаллы/деньги. Часы (cooldown/incoming) сюда НЕ входят — они по праву
// меняются событием; всё остальное обязано вернуться бит-в-бит.
function fingerprint(st) {
  return JSON.stringify({
    b: st.buildings.filter((x) => !x.dead)
      .map((x) => [x.type, x.tx, x.ty, x.level || 1, Math.round(x.hp)]).sort(),
    u: st.units.filter((x) => !x.dead && !x.garrison)
      .map((x) => [x.type, Math.round(x.x), Math.round(x.y), Math.round(x.hp)]).sort(),
    c: st.map.crystals.filter((x) => !x.dead && x.amount > 0)
      .map((x) => [x.tx, x.ty, x.amount]).sort(),
    t: st.tech.player,
    m: Math.floor(st.minerals.player),
    cmd: JSON.stringify(st.commander),
    explored: (() => { let n = 0; for (let y = 0; y < st.map.h; y++) for (let x = 0; x < st.map.w; x++) if (st.fog.tileExplored(x, y)) n++; return n; })(),
  });
}

// ---------- EX1: запрет вылаза в бою/восстановлении/учении ----------
try {
  bootHome();
  DIR.startAlarmEvent(game, { mode: 'light', kind: 'normal' });
  let v = R.validateRaidLoadout(game.state, { tier: 1, units: { worker: 2 }, budget: 0, seed: 1 });
  assert(!v.ok && v.reasonKey === 'ui.raid.errAlarmActive', 'бой не запретил вылазку: ' + JSON.stringify(v));
  // откат события, чтобы продолжить
  DIR.rollbackAlarmEvent(game);
  ticks(2);
  // восстановление (recovery) — отказ тем же ключом
  meta().recovery = { ruins: [] };
  v = R.validateRaidLoadout(game.state, { tier: 1, units: { worker: 2 }, budget: 0, seed: 1 });
  assert(!v.ok && v.reasonKey === 'ui.raid.errAlarmActive', 'восстановление не запретило вылазку');
  meta().recovery = null;
  // учение — отказ (Ф-5: живой бой на карте базы)
  DIR.startTrainingAlarm(game, { mode: 'light' });
  v = R.validateRaidLoadout(game.state, { tier: 1, units: { worker: 2 }, budget: 0, seed: 1 });
  assert(!v.ok && v.reasonKey === 'ui.raid.errAlarmActive', 'учение не запретило вылазку');
  DIR.endTrainingAlarm(game, game.state);
  pass('EX1 запреты: бой/восстановление/учение → errAlarmActive, вылазка не стартует');
} catch (e) { fail('EX1 запреты', e); }

// ---------- EX2: домашние часы заморожены на вылазке ----------
try {
  const st = bootHome();
  const before = meta().incomingTicks;
  launch(st, 50);
  ticks(300); // 10 с игрового времени на вылазке
  game.finishRaidExpedition('evac');
  const after = meta().incomingTicks;
  assert(after === before, 'домашние часы тикали на вылазке: ' + before + '→' + after);
  ticks(30); // 1 с дома
  assert(meta().incomingTicks === after - 30, 'дома часы не пошли');
  pass(`EX2 часы: incoming ${before} заморожен на вылазке, дома пошёл (-30)`);
} catch (e) { fail('EX2 часы', e); }

// ---------- EX3: explored и командир переживают вылет/возврат ----------
try {
  const st = bootHome();
  let explored = 0;
  for (let y = 0; y < st.map.h; y++) for (let x = 0; x < st.map.w; x++) if (st.fog.tileExplored(x, y)) explored++;
  const cmd = JSON.stringify(st.commander);
  launch(st, 50);
  ticks(200); // на вылазке туман ходит, но это ДРУГАЯ карта
  game.finishRaidExpedition('evac');
  ticks(2);
  const home = game.state;
  let explored2 = 0;
  for (let y = 0; y < home.map.h; y++) for (let x = 0; x < home.map.w; x++) if (home.fog.tileExplored(x, y)) explored2++;
  assert(explored2 === explored, 'знания домашней карты изменились: ' + explored + '→' + explored2);
  assert(JSON.stringify(home.commander) === cmd, 'командир изменился после вылета');
  pass(`EX3 перенос: explored ${explored} и командир пережили вылет/возврат`);
} catch (e) { fail('EX3 перенос', e); }

// ---------- EX4: бюджет/груз 1:1 один раз, returnId, reload без дубля ----------
try {
  const st = bootHome();
  const w0 = wallet();
  const BUDGET = 50n, CARGO = 31n;
  launch(st, Number(BUDGET));
  assert(wallet() === w0 - BUDGET * 1000000n, 'бюджет не списался из кошелька: ' + wallet());
  const field = game.state;
  field.raidCargo = Number(CARGO); // добытый груз (полный цикл — в sim_raid_field F1)
  R.boardRingNow(game, field); // посадка отряда у челнока
  game.finishRaidExpedition('evac');
  ticks(2);
  const ret = game.raidSession;
  assert(ret.pendingReturn === null, 'pendingReturn не погашен гидрацией');
  assert(ret.alarmV2.lastSettledReturnId && /:return:1$/.test(ret.alarmV2.lastSettledReturnId),
    'lastSettledReturnId не выставлен: ' + ret.alarmV2.lastSettledReturnId);
  const w1 = wallet();
  // Кошелёк: −бюджет + груз + возврат остатка бюджета (ничего не тратили).
  assert(w1 === w0 + CARGO * 1000000n,
    'возврат не 1:1: ' + w0 + ' → ' + w1 + ' (ожидалось +' + CARGO + ' эрг)');
  // RELOAD: сейв → промоция → подъём — повторного зачисления нет.
  localStorage.setItem(RAID_KEY, JSON.stringify(game.raidSession));
  const promoted = await STORE.promoteStoredRaid(localStorage, RAID_KEY, STORE.RAID_BACKUP_PROFILE);
  await flushLocks();
  assert(promoted.migrated === false, 'v2-сейв зачем-то мигрирован');
  game.raidSession = promoted.value;
  game.started = false;
  game.startRaidHome('human');
  ticks(2);
  assert(wallet() === w1, 'reload повторно зачислил возврат: ' + w1 + ' → ' + wallet());
  pass(`EX4 возврат: бюджет/груз 1:1 (+${CARGO} эрг), returnId зафиксирован, reload без дубля`);
} catch (e) { fail('EX4 возврат 1:1', e); }

// ---------- EX5: таймеры/очередь/СБОР-hold переживают вылет/возврат ----------
try {
  const st = bootHome();
  const cc = st.buildings.find((b) => b.side === 'player' && b.type === 'cc');
  const bar = new B.Building(st, 'player', 'barracks', cc.tx + 4, cc.ty + 2, true);
  st.map.markBuilding(bar); st.bcount.player++;
  bar.queue = [{ type: 'marine', t: 40, total: 40 }];
  const depot = st.buildings.find((b) => b.side === 'player' && b.type === 'depot');
  depot.gradeUp = { t: 40, total: 90 };
  // СБОР — настоящей командой (issueAssembly): hold/assemble/order ставит
  // движок, выживание проверяем через assembly-часть DTO (рабочие выслали —
  // hold держит бойца, он и остаётся на базе).
  const cc0 = st.buildings.find((b) => !b.dead && b.side === 'player' && b.type === 'cc');
  const asm = ASM.issueAssembly(st, cc0);
  assert(asm.ok && asm.ordered > 0, 'СБОР не встал: ' + JSON.stringify(asm));
  launch(st, 50);
  ticks(150); // 5 с вылазки — таймеры дома НЕ должны уйти
  game.finishRaidExpedition('evac');
  ticks(2);
  const home = game.state;
  const bar2 = home.buildings.find((b) => b.side === 'player' && b.type === 'barracks');
  const depot2 = home.buildings.find((b) => b.side === 'player' && b.type === 'depot');
  const w2 = home.units.find((u) => !u.dead && u.side === 'player' && u.gatherHold);
  assert(bar2 && bar2.queue && bar2.queue.length === 1 && bar2.queue[0].type === 'marine',
    'очередь производства потерялась: ' + JSON.stringify(bar2 && bar2.queue));
  assert(bar2.queue[0].t <= 40 && bar2.queue[0].t >= 37, 'таймер очереди улетел: ' + bar2.queue[0].t);
  assert(depot2.gradeUp && depot2.gradeUp.t <= 40 && depot2.gradeUp.t >= 37,
    'грейд-таймер улетел: ' + JSON.stringify(depot2.gradeUp));
  assert(w2 && w2.gatherHold === true, 'СБОР-hold не пережил вылет');
  pass('EX5 перенос работы: очередь ' + bar2.queue[0].type + ' t=' + bar2.queue[0].t.toFixed(1) +
    ', грейд t=' + depot2.gradeUp.t.toFixed(1) + ', СБОР-hold жив');
} catch (e) { fail('EX5 перенос работы', e); }

// ---------- EX6: семантическое равенство базы: учение и откат ----------
try {
  // 6а. Учебная копия (Ф-2): база до === базе после.
  {
    const st = bootHome();
    const fp0 = fingerprint(st);
    const res = DIR.startTrainingAlarm(game, { mode: 'light' });
    assert(res.ok && st.alarmTraining, 'учение не стартовало');
    // Дефект-7 (дельта ревизии): бой учения обязан ДОЙТИ до волны и
    // заспавнить противника — иначе «равенство» вакуально (замёрзший ledger
    // ничего не менял и маскировал и бой, и восстановление).
    let guard = 0;
    const tledger = () => st.game.raidSession.alarmV2.trainingEvent &&
      st.game.raidSession.alarmV2.trainingEvent.ledger;
    while (tledger() && tledger().phase !== 'WAVE' && guard++ < 2000) ticks(20);
    ticks(30); // бой учения: враги, урон, движение — всё «после»
    assert(st.units.some((u) => u.side === 'enemy' && !u.dead) ||
      st.buildings.some((b) => b.side === 'enemy' && !b.dead),
      'учение не заспавнило противника (ledger мёртв — заморозка theft-тика)');
    DIR.endTrainingAlarm(game, game.state);
    ticks(2);
    const fp1 = fingerprint(game.state);
    assert(fp1 === fp0, 'база после учения != до\n  до:   ' + fp0 + '\n  после: ' + fp1);
  }
  // 6б. ERROR_HOLD → откат (Ф-2): база до === базе после, замороженные
  // таймеры (грейд) не продвинулись — гидратация из preBattleDto.
  {
    const st = bootHome();
    const depot = st.buildings.find((b) => b.side === 'player' && b.type === 'depot');
    depot.gradeUp = { t: 40, total: 90 };
    const fp0 = fingerprint(st);
    DIR.startAlarmEvent(game, { mode: 'light', kind: 'normal' });
    // Дефект-7 (дельта ревизии): откат проверяется на РЕАЛЬНОМ бою —
    // до волны со спавном врагов и уроном, а не в тихом WARNING.
    {
      let g2 = 0;
      const aled = () => st.game.raidSession.alarmV2.activeEvent &&
        st.game.raidSession.alarmV2.activeEvent.ledger;
      while (aled() && aled().phase !== 'WAVE' && g2++ < 2000) ticks(20);
      ticks(30);
      assert(st.units.some((u) => u.side === 'enemy' && !u.dead),
        'событие не заспавнило врагов для проверки отката');
    }
    const rb = DIR.rollbackAlarmEvent(game);
    assert(rb.ok, 'откат не прошёл');
    ticks(2);
    const fp1 = fingerprint(game.state);
    assert(fp1 === fp0, 'база после отката != до\n  до:   ' + fp0 + '\n  после: ' + fp1);
    const depot2 = game.state.buildings.find((b) => b.side === 'player' && b.type === 'depot');
    assert(depot2.gradeUp && depot2.gradeUp.t <= 40 && depot2.gradeUp.t >= 37,
      'замороженный грейд-таймер продвинулся: ' + JSON.stringify(depot2.gradeUp));
  }
  pass('EX6 семантика базы: учение и откат ERROR_HOLD возвращают базу бит-в-бит, таймеры заморожены');
} catch (e) { fail('EX6 семантика базы', e); }

// ---------- EX7: компенсация оффлайн-времени — кэп 24 ч ----------
try {
  const st = bootHome();
  const depot = st.buildings.find((b) => b.side === 'player' && b.type === 'depot');
  depot.gradeUp = { t: 25 * 3600, total: 26 * 3600 }; // 25 ч работы
  game.syncRaidHomeSnapshot();
  // «Вкладка спала 100 ч»: capturedAt в прошлом, кап должен срезать до 24 ч.
  game.raidSession.homeDto.capturedAt = Date.now() - 100 * 3600 * 1000;
  localStorage.setItem(RAID_KEY, JSON.stringify(game.raidSession));
  await flushLocks(); // релиз lease предыдущей промоции (EX4)
  const promoted = await STORE.promoteStoredRaid(localStorage, RAID_KEY, STORE.RAID_BACKUP_PROFILE);
  game.raidSession = promoted.value;
  game.started = false;
  game.startRaidHome('human');
  ticks(2);
  const depot2 = game.state.buildings.find((b) => b.side === 'player' && b.type === 'depot');
  const t = depot2.gradeUp ? depot2.gradeUp.t : -1;
  // 25 ч − 24 ч = 1 ч (плюс/минус секунды сима): НЕ 0 и НЕ отрицательное.
  assert(t > 3500 && t < 3700, 'кэп 24 ч не сработал: остаток таймера ' + t);
  pass('EX7 оффлайн-компенсация: 100 ч сна списали ровно 24 ч, остаток ' + Math.round(t) + ' с');
} catch (e) { fail('EX7 кэп 24 ч', e); }

if (failures.length) { console.log('FAIL  expedition alarm v2: ' + failures.join('; ')); process.exit(1); }
console.log('PASS  expedition alarm v2: все группы зелёные');
