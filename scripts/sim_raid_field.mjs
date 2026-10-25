// ============================================================
// sim_raid_field.mjs — экран ВЫЛАЗКИ: Дом-шаттл как КЦ и хедер.
//
// Владелец (26.10.2026): «все сборщики ищут КЦ и не сдают ресурсы в дом,
// хотя в рейде для них Дом это КЦ» + «в хедере ошибки отображения».
// Причины были две:
//   1) путь к посадочной площадке Дома считался в ТАЙЛАХ, а pathToPoint()
//      ждёт МИРОВЫЕ ПИКСЕЛИ → бойцы уходили в угол карты (0,0);
//   2) строка цели вылазки ждала {max}/{cap}, а передавали только {tier,
//      cargo, alive} → в хедере висели сырые «{max}» и «{cap}».
//
// Проверяем:
//   F1  сборщики на вылазке несут эрг в Дом-шаттл (трюм растёт, добыто растёт);
//   F2  они идут к Дому, а не в угол карты (близость к площадке, не к (0,0));
//   F3  радиус приёма совпадает с нарисованным кольцом (pad.r тайлов);
//   F4  трюм уважает грейд Дома (ёмкость = st.raidCargoCap, перегруз считается);
//   F5  хедер вылазки: счётчик = «трюм/ёмкость», население = места Дома,
//       строка цели без сырых «{…}»;
//   F6  эвакуация: борт берёт груз, кламп по грейду Дома, а не по константе;
//   F7  дома (не на вылазке) хедер по-прежнему показывает минералы базы;
//   F10 аванпост воюет: охрана стоит на СВОБОДНОМ тайле у своего КЦ (не в
//       центре здания) и при подходе игрока переходит в атаку.
//
// Запуск: node scripts/sim_raid_field.mjs
// ============================================================
import './harness.mjs';
import { el } from './harness.mjs';
import { V } from './stamp.mjs';

await import('../r/js/game.js');
const R = await import('../r/js/raid.js' + V);
const U = await import('../r/js/units.js' + V);
const B = await import('../r/js/buildings.js' + V);
const E = await import('../r/js/economy.js' + V);
const I = await import('../r/js/i18n.js' + V);

const failures = [];
const fail = (phase, err) => { failures.push(phase); console.log(`FAIL  ${phase}: ${String((err && err.message) || err)}`); };
const pass = (m) => console.log(`PASS  ${m}`);
const assert = (c, m) => { if (!c) throw new Error(m); };

const game = globalThis.game;
assert(game, 'движок полигона не поднялся');
const ticks = (n) => { for (let i = 0; i < n; i++) game.tick(); };

// Домашняя база с Домом-Г5 и отрядом, затем вылазка на тир 1.
function launch(tier = 1, roster = { worker: 3, marine: 1 }, houseLv = 5) {
  game.startRaidHome('human', { forceNew: true });
  ticks(4);
  const st = game.state;
  st.minerals.player = 100000;
  const cc = st.buildings.find((b) => !b.dead && b.side === 'player' && b.type === 'cc');
  const depot = new B.Building(st, 'player', 'depot', cc.tx + 2, cc.ty + 2, true);
  depot.level = houseLv;
  depot.maxHp = depot.hp = Math.round(depot.cfg.hp * 2);
  st.map.markBuilding(depot);
  st.bcount.player++;
  for (const [type, n] of Object.entries(roster)) {
    for (let i = 0; i < n; i++) {
      // Свободные бойцы базы (countHomeRoster не считает гарнизон отсека).
      U.spawnUnit(st, 'player', type, cc.x + 90 + i * 26, cc.y + 90, false);
    }
  }
  ticks(3);
  st.minerals.player = 100000;
  const res = game.launchRaidExpedition({ tier, seed: 4242, budget: 100, units: { ...roster } });
  assert(res && res.ok, 'вылазка не запустилась: ' + JSON.stringify(res));
  ticks(4);
  return game.state;
}

// ---------- F1: сборщики сдают эрг в Дом-шаттл ----------
try {
  const st = launch();
  assert(st.raidMode === 'expedition', 'режим не expedition: ' + st.raidMode);
  assert(st.raidHouse && st.raidHouse.type === 'depot', 'на карте нет Дома-шаттла');
  assert(st.raidDrop && st.raidDrop.tx === st.raidHouse.tx, 'площадка приёма не совпадает с Домом');
  const cargo0 = st.raidCargo || 0;
  ticks(600);
  assert(st.raidCargo > cargo0, 'трюм не пополнился: ' + st.raidCargo);
  assert(st.stats.mined > 0, 'добыто ноль при живых сборщиках');
  assert(st.raidCargo === st.stats.mined, 'добыто и трюм расходятся: ' + st.stats.mined + ' vs ' + st.raidCargo);
  pass(`F1 сборщики сдают эрг в Дом-шаттл: трюм ${Math.floor(st.raidCargo)} = добыто ${st.stats.mined}`);
} catch (e) { fail('F1 сдача в Дом', e); }

// ---------- F2: путь ведёт к Дому, а не в угол карты ----------
try {
  const st = launch();
  ticks(600);
  const workers = st.units.filter((u) => u.side === 'player' && u.type === 'worker' && !u.dead);
  assert(workers.length, 'на вылазке нет сборщиков');
  const pad = st.raidDrop;
  let minD = Infinity;
  for (const w of workers) {
    const d = Math.hypot(w.x - pad.x, w.y - pad.y);
    minD = Math.min(minD, d);
    assert(w.x > 0 && w.y > 0, `сборщик ушёл за край карты: ${Math.round(w.x)},${Math.round(w.y)}`);
  }
  assert(minD <= (pad.r + 2) * 32, 'никто даже не подошёл к Дому, ближайший на ' + (minD / 32).toFixed(1) + ' тайлов');
  pass(`F2 сборщики ходят к Дому (ближайший в ${(minD / 32).toFixed(1)} тайла), а не в угол карты`);
} catch (e) { fail('F2 путь к Дому', e); }

// ---------- F3: радиус приёма = нарисованное кольцо ----------
try {
  const st = launch();
  const pad = st.raidDrop;
  const w = U.spawnUnit(st, 'player', 'worker', pad.x + (pad.r - 0.3) * 32, pad.y, false);
  w.carrying = 5;
  w.order = { kind: 'gather', target: null, phase: 'toDrop' };
  ticks(2);
  assert(w.carrying === 0, 'в зоне кольца груз не принят (радиус приёма меньше нарисованного)');
  // А далеко — не принимают.
  const far = U.spawnUnit(st, 'player', 'worker', pad.x + (pad.r + 3) * 32, pad.y, false);
  far.carrying = 5;
  far.order = { kind: 'gather', target: null, phase: 'toDrop' };
  ticks(2);
  assert(far.carrying === 5, 'груз приняли вне зоны приёма');
  pass(`F3 приём груза ровно в кольце радиусом ${pad.r} тайла (как нарисовано)`);
} catch (e) { fail('F3 радиус приёма', e); }

// ---------- F4: ёмкость трюма по грейду Дома + перегруз ----------
try {
  const st = launch(1, { worker: 2, marine: 1 }, 5);
  const expectCap = E.HOUSE_LEVELS.cargo(st.raidHouse.level);
  assert(st.raidCargoCap === expectCap, `трюм не по грейду Дома: ${st.raidCargoCap} vs ${expectCap}`);
  // Перегруз: кладём почти полный трюм и сдаём ещё.
  st.raidCargo = expectCap - 3;
  const pad = st.raidDrop;
  const w = U.spawnUnit(st, 'player', 'worker', pad.x + 20, pad.y + 20, false);
  w.carrying = 10;
  w.order = { kind: 'gather', target: null, phase: 'toDrop' };
  ticks(2);
  assert(st.raidCargo === expectCap, 'трюм переполнился выше ёмкости: ' + st.raidCargo);
  assert(st.raidCargoLost >= 3, 'излишек не учтён в потерях: ' + st.raidCargoLost);
  pass(`F4 трюм Дома-Г${st.raidHouse.level} = ${expectCap}, излишек ушёл в «потеряно» (${Math.floor(st.raidCargoLost)})`);
} catch (e) { fail('F4 ёмкость трюма', e); }

// ---------- F5: хедер вылазки ----------
try {
  const st = launch();
  ticks(120);
  const cargo = Math.floor(st.raidCargo);
  const cap = Math.floor(st.raidCargoCap);
  const slots = E.HOUSE_LEVELS.slots(st.raidHouse.level);
  assert(String(el('res-minerals').textContent) === `${cargo}/${cap}`,
    'счётчик в хедере не «трюм/ёмкость»: ' + el('res-minerals').textContent);
  assert(String(el('res-supply').textContent) === `${st.supply.player.used}/${slots}`,
    'население в хедере не по местам Дома: ' + el('res-supply').textContent);
  const obj = el('res-objective').textContent;
  assert(!/\{\w+\}/.test(obj), 'в строке цели сырые подстановки: ' + obj);
  assert(!/\{\w+\}/.test(el('res-minerals').textContent), 'в счётчике сырые подстановки');
  assert(!/\{\w+\}/.test(el('res-supply').textContent), 'в населении сырые подстановки');
  pass(`F5 хедер: «${el('res-minerals').textContent}» трюм · «${el('res-supply').textContent}» места Дома · цель без «{…}»`);
} catch (e) { fail('F5 хедер вылазки', e); }

// ---------- F6: эвакуация и кламп груза по грейду ----------
try {
  const st = launch(1, { worker: 2, marine: 1 }, 5);
  const pad = st.raidDrop;
  const cap = st.raidCargoCap;
  const w = st.units.find((u) => u.type === 'worker' && u.side === 'player' && !u.dead);
  w.carrying = 6;
  w.x = pad.x + 10; w.y = pad.y + 10; w.hp = w.maxHp;
  st.raidCargo = cap - 2; // почти полный трюм
  st.raidEvacuating = true;
  st.raidBoarded = [];
  for (const u of st.units) {
    if (u.side !== 'player') continue;
    u.x = pad.x + 10; u.y = pad.y + 10;
  }
  ticks(60);
  assert(st.raidCargo === cap, 'груз при посадке переполнил трюм: ' + st.raidCargo);
  assert(st.raidCargoLost > 0, 'излишек при посадке не учтён');
  pass(`F6 эвакуация: трюм клампится по грейду (${cap}), излишек ${Math.floor(st.raidCargoLost)} не потерян молча`);
} catch (e) { fail('F6 эвакуация', e); }

// ---------- F7: вне вылазки хедер показывает минералы базы ----------
try {
  game.startRaidHome('human', { forceNew: true });
  ticks(4);
  const st = game.state;
  st.minerals.player = 777;
  ticks(2);
  assert(String(el('res-minerals').textContent) === '777', 'дома счётчик не показывает минералы: ' + el('res-minerals').textContent);
  assert(!el('res-minerals').classList.contains('is-full'), 'дома счётчик помечен как «трюм полон»');
  const obj = el('res-objective').textContent;
  assert(!/\{\w+\}/.test(obj), 'дома в строке цели сырые подстановки: ' + obj);
  pass('F7 дома хедер как раньше: минералы базы, строка цели без «{…}»');
} catch (e) { fail('F7 хедер базы', e); }

// ---------- F8: ни один экранный текст не оставил сырых подстановок ----------
try {
  const st = launch();
  ticks(300);
  const leak = [...I.missingParams].filter((s) => !s.startsWith('ui.raid.hudExpedition'));
  assert(!leak.length, 'незаполненные подстановки: ' + leak.join(', '));
  pass('F8 за всю вылазку ни одного незаполненного параметра локали (' + I.missingParams.size + ' проверено)');
} catch (e) { fail('F8 подстановки локали', e); }

// ---------- F9: «к КЦ» на вылазке = к Дому-шаттлу ----------
try {
  const S = await import('../r/js/squad.js' + V);
  const st = launch(1, { worker: 1, marine: 3 }, 4);
  const house = st.raidHouse;
  assert(S.ccAnchor(st) === house, 'на вылазке роль КЦ не у Дома-шаттла');
  const marines = st.units.filter((u) => u.side === 'player' && u.type === 'marine' && !u.dead);
  assert(marines.length, 'нет бойцов для приказа');
  st.selection = marines.slice();
  const cmd = game.getCommands().find((c) => c.code === 'KeyL');
  assert(cmd, 'команды «Отойти к КЦ» нет на вылазке');
  assert(cmd.enabled === undefined || cmd.disabled !== true, 'команда «к КЦ» заблокирована на вылазке');
  cmd.on();
  for (const u of marines) {
    assert(u.hold && u.hold.kind === 'cc', 'нет приказа «к КЦ» у бойца');
    assert(Math.abs(u.hold.x - house.x) < 1 && Math.abs(u.hold.y - house.y) < 1,
      'кольцо поставлено не вокруг Дома-шаттла');
    const d = Math.hypot(u.hold.px - house.x, u.hold.py - house.y);
    assert(d > 32 * 1.4 && d < 32 * 3.3, 'точка кольца вне 1.6–3 тайлов от Дома: ' + (d / 32).toFixed(2));
  }
  pass('F9 «к КЦ» на вылазке собирает отряд вокруг Дома-шаттла');
} catch (e) { fail('F9 «к КЦ» на вылазке', e); }

// ---------- F10: аванпост воюет (регресс на дефект «охрана застревает в move») ----------
try {
  const st = launch(1, { worker: 1, marine: 3 }, 4);
  const guards = st.units.filter((u) => u.side === 'enemy' && !u.dead);
  assert(guards.length >= 2, 'у аванпоста нет охраны');
  const ccE = st.buildings.find((b) => !b.dead && b.side === 'enemy' && b.type === 'cc');
  assert(ccE, 'на аванпосте нет КЦ');
  ticks(240);
  for (const g of guards) {
    // Главное: охрана не «застряла в пути внутрь здания» — она на посту.
    assert(g.order.kind !== 'move' || g.idleReason !== 'unreachable',
      'охрана застряла в недостижимом пути (снова точка сбора в центре КЦ)');
    const inside = g.tx >= ccE.tx && g.tx < ccE.tx + ccE.w && g.ty >= ccE.ty && g.ty < ccE.ty + ccE.h;
    assert(!inside, 'охрана стоит внутри здания КЦ');
  }
  const my = st.units.find((u) => u.side === 'player' && u.type === 'marine' && !u.dead);
  assert(my, 'нет своего бойца для проверки агро');
  my.hp = my.maxHp = 9999;
  my.x = guards[0].x + 32 * 5;
  my.y = guards[0].y;
  ticks(120);
  const engaged = guards.filter((g) => g.order.kind === 'attack' || g.order.kind === 'attackMove');
  assert(engaged.length >= 1, 'охрана не отреагировала на игрока в 5 тайлах');
  assert(engaged.some((g) => g.order.target === my || (g.order.target && g.order.target.side === 'player')),
    'цель атаки охраны — не подошедший боец');
  pass(`F10 аванпост воюет: ${engaged.length}/${guards.length} охраны перешли в атаку`);
} catch (e) { fail('F10 агро аванпоста', e); }

if (failures.length) {
  console.log(`\n❌ Вылазка: провалено ${failures.length} (${failures.join(', ')})`);
  process.exit(1);
}
console.log('\n✅ Вылазка: Дом-шаттл как КЦ и хедер — все блоки зелёные');
