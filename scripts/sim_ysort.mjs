// ============================================================
// sim_ysort.mjs — ace#8: y-сортировка отрисовки мира (2.5D-канон).
//
// Находка владельца (28.10): «нижний элемент всегда выше по слою, чем
// верхний». Проверяем headless, без браузера и без пикселей — на живом
// game.render() и на чистой функции порядка (r/js/ysort.js):
//
//   Y1 сцена «здание+здание» (стенка на стенку по вертикали): южное
//      здание рисуется поверх северного В ОБОИХ порядках постройки;
//   Y2 сцена «юнит+здание»: юнит севернее здания — за крышей (рисуется
//      раньше), южнее — перед фасадом (позже); оба порядка вставки;
//   Y3 HP/выделение/бейджи/ромб цели — вторым проходом поверх ВСЕХ тел:
//      ни один маркер UI не читается, пока не отрисованы все тела;
//   Y4 интерполяция кадра: ключ глубины юнита считается от той же
//      координаты, которой рисуем (prevY + (y-prevY)*alpha + r);
//   Y5 мёртвые/гарнизонные не участвуют; равные кромки — юнит поверх
//      здания (стоит перед его гранью);
//   Y6 перфоманс: сортировка сотен объектов на кадр укладывается в бюджет.
//
// Запуск: node scripts/sim_ysort.mjs
// ============================================================
import './harness.mjs';
import { V } from './stamp.mjs';

await import('../r/js/game.js');
const YS = await import('../r/js/ysort.js' + V);
const B = await import('../r/js/buildings.js' + V);
const U = await import('../r/js/units.js' + V);

const failures = [];
const fail = (phase, err) => { failures.push(phase); console.log(`FAIL  ${phase}: ${String((err && err.message) || err)}`); };
const pass = (m) => console.log(`PASS  ${m}`);
const assert = (c, m) => { if (!c) throw new Error(m); };

const game = globalThis.game;
assert(game, 'движок полигона не поднялся');
const TILE = 32;

// Маркеры порядка чтения прокси: тела читают 'faction'/'moving' при
// отрисовке корпуса, UI-слои — 'selected'/'keyTarget' (первое чтение
// показывает, в каком порядке отработали проходы).
const BODY_MARKERS = new Set(['faction', 'moving']);
const UI_MARKERS = new Set(['selected', 'keyTarget']);
function wrapEntity(e, kind, id, log) {
  let bodyLogged = false;
  const uiLogged = new Set();
  return new Proxy(e, {
    get(t, prop, recv) {
      if (BODY_MARKERS.has(prop) && !bodyLogged) {
        bodyLogged = true;
        log.push((kind === 'b' ? 'B:' : 'U:') + id);
      }
      if (UI_MARKERS.has(prop) && !uiLogged.has(prop)) {
        uiLogged.add(prop);
        log.push('UI:' + id);
      }
      const v = Reflect.get(t, prop, recv);
      return typeof v === 'function' ? v.bind(t) : v;
    },
    set(t, prop, val) { t[prop] = val; return true; },
  });
}

// ---------- Y1/Y2/Y5: чистый порядок drawList ----------
try {
  const wallN = { ty: 10, h: 1, visY: 0 };  // низ 352
  const wallS = { ty: 11, h: 1, visY: 0 };  // низ 384 — «стенка на стенку»
  for (const order of [[wallS, wallN], [wallN, wallS]]) {
    const st = { buildings: order, units: [] };
    const l = YS.drawList(st, 1);
    assert(l.length === 2 && l[0].e === wallN && l[1].e === wallS,
      'стенка на стенку: южное не поверх северного (порядок постройки ' + (order[0] === wallS ? 'юг-первый' : 'север-первый') + ')');
  }
  pass('Y1 здание+здание: южное перекрывает северное в обоих порядках постройки');

  const depot = { ty: 10, h: 2, visY: 0 };            // низ 384
  const uN = { y: 300, r: 12, prevY: 300 };           // низ 312 — севернее здания
  const uS = { y: 430, r: 12, prevY: 430 };           // низ 442 — южнее здания
  for (const order of [[uS, uN], [uN, uS]]) {
    const st = { buildings: [depot], units: order };
    const l = YS.drawList(st, 1);
    assert(l[0].e === uN && l[1].e === depot && l[2].e === uS,
      'юнит+здание: неверный порядок глубины (северный юнит должен быть за крышей)');
  }
  pass('Y2 юнит+здание: северный юнит за крышей, южный перед фасадом (оба порядка)');

  const dead = { ty: 11, h: 1, dead: true };
  const garr = { y: 300, r: 12, prevY: 300, garrison: 1 };
  const sameA = { ty: 10, h: 1, visY: 0 };
  const sameB = { ty: 10, h: 1, visY: 4 };            // низ 356 = низ юнита
  const sameU = { y: 344, r: 12, prevY: 344 };        // низ 356
  const st2 = { buildings: [sameA, dead, sameB], units: [garr, sameU] };
  const l2 = YS.drawList(st2, 1);
  assert(l2.length === 3, 'мёртвые/гарнизонные участвуют в отрисовке');
  assert(l2[0].e === sameA && l2[1].e === sameB && l2[2].e === sameU,
    'равные кромки: юнит должен идти после здания (перед его гранью)');
  pass('Y5 мёртвые/гарнизон пропущены; равные кромки — юнит поверх грани здания');
} catch (e) { fail('Y1/Y2/Y5 порядок drawList', e); }

// ---------- Y4: интерполяция кадра ----------
try {
  const u = { y: 400, prevY: 300, r: 10 };
  const b = { ty: 10, h: 1, visY: 0 };                // низ 352
  const at0 = YS.drawList({ buildings: [b], units: [u] }, 0);
  const at1 = YS.drawList({ buildings: [b], units: [u] }, 1);
  assert(at0[0].e === u && at0[1].e === b, 'alpha=0: юнит (низ 310) должен быть севернее');
  assert(at1[0].e === b && at1[1].e === u, 'alpha=1: юнит (низ 410) должен быть южнее');
  assert(YS.unitBottom(u, 0.5) === 360, 'южная кромка юнита не по интерполированной y');
  pass('Y4 глубина юнита — по интерполированной координате кадра (y+r)');
} catch (e) { fail('Y4 интерполяция', e); }

// ---------- Y1–Y3: живой game.render(), порядок проходов через прокси ----------
function bootScene(buildings, units, log) {
  game.startRaidHome('human', { forceNew: true });
  game.tick();
  const st = game.state;
  game.cssW = 1280; game.cssH = 800;
  st.camera.x = 0; st.camera.y = 0; st.camera.z = 1;
  st.buildings = buildings.map((b, i) => wrapEntity(b, 'b', i, log));
  st.units = units.map((u, i) => wrapEntity(u, 'u', i, log));
  return st;
}

function mkBuilding(st, type, tx, ty, extra) {
  const b = new B.Building(st, 'player', type, tx, ty, true);
  if (extra) Object.assign(b, extra);
  return b;
}
function mkUnit(st, type, x, y, extra) {
  const u = new U.Unit(st, 'player', type, x, y);
  if (extra) Object.assign(u, extra);
  return u;
}

try {
  for (const southFirst of [true, false]) {
    const log = [];
    // Стена северная (ty=10) и южная (ty=11): низы 352/384.
    const draft = { factions: { player: 'human', enemy: 'alien' }, buildings: [], units: [] };
    const wallN = mkBuilding(draft, 'wall', 12, 10);
    const wallS = mkBuilding(draft, 'wall', 12, 11);
    const buildings = southFirst ? [wallS, wallN] : [wallN, wallS];
    bootScene(buildings, [], log);
    game.render(1);
    const order = log.filter((x) => x.startsWith('B:') || x.startsWith('U:'));
    const expected = ['B:' + buildings.indexOf(wallN), 'B:' + buildings.indexOf(wallS)];
    assert(order.join() === expected.join(),
      'живой render: неверный порядок тел (' + order.join() + ' вместо ' + expected.join() + ', порядок постройки ' + (southFirst ? 'юг-первый' : 'север-первый') + ')');
    const ui = log.filter((x) => x.startsWith('UI:'));
    assert(log.indexOf(order[1]) < (ui.length ? log.indexOf(ui[0]) : Infinity),
      'живой render: UI-маркер прочитан до отрисовки всех тел');
  }
  pass('Y1 живой render: здания в порядке глубины в обоих порядках постройки; UI — вторым проходом');

  for (const unitFirst of [true, false]) {
    const log = [];
    const draft = { factions: { player: 'human', enemy: 'alien' }, buildings: [], units: [] };
    const depot = mkBuilding(draft, 'depot', 12, 10);            // низ 384
    const uN = mkUnit(draft, 'worker', 13 * TILE + 16, 300);      // низ 312 — за крышей
    const uS = mkUnit(draft, 'worker', 13 * TILE + 16, 430);      // низ 442 — перед фасадом
    bootScene([depot], unitFirst ? [uS, uN] : [uN, uS], log);
    game.render(1);
    const order = log.filter((x) => x.startsWith('B:') || x.startsWith('U:'));
    // Индексы в логе соответствуют позициям в массивах bootScene:
    // зданий один (B:0), юниты — uS и uN по позиции в st.units.
    const uNid = unitFirst ? 'U:1' : 'U:0';
    const uSid = unitFirst ? 'U:0' : 'U:1';
    assert(order.join() === [uNid, 'B:0', uSid].join(),
      'живой render: юнит+здание — ' + order.join() + ' вместо ' + [uNid, 'B:0', uSid].join());
  }
  pass('Y2 живой render: юнит севернее здания — за крышей, южнее — перед фасадом');
} catch (e) { fail('Y1–Y3 живой render', e); }

// ---------- Y3: маркеры UI вторым проходом (отдельно, с ромбом цели) ----------
try {
  const log = [];
  const draft = { factions: { player: 'human', enemy: 'alien' }, buildings: [], units: [] };
  const b1 = mkBuilding(draft, 'wall', 12, 10, { selected: true, keyTarget: true, hp: 5, maxHp: 30 });
  const b2 = mkBuilding(draft, 'wall', 12, 11, { selected: true });
  bootScene([b1, b2], [], log);
  game.render(1);
  const bodyIdx = log.map((x, i) => (x.startsWith('B:') || x.startsWith('U:')) ? i : -1).filter((i) => i >= 0);
  const uiIdx = log.map((x, i) => x.startsWith('UI:') ? i : -1).filter((i) => i >= 0);
  assert(uiIdx.length >= 3, 'UI-маркеры не прочитаны (ожидались selected×2 и keyTarget): ' + log.join());
  assert(Math.max(...bodyIdx) < Math.min(...uiIdx),
    'HP/выделение/бейджи читаются до завершения тел: ' + log.join());
  pass('Y3 HP/выделение/ромб цели — второй проход поверх всех тел');
} catch (e) { fail('Y3 второй проход', e); }

// ---------- Y6: перфоманс сортировки ----------
try {
  const buildings = [], units = [];
  for (let i = 0; i < 400; i++) buildings.push({ ty: (i % 90), h: 1 + (i % 3), visY: 0, dead: false });
  for (let i = 0; i < 400; i++) units.push({ y: (i % 120) * 10, prevY: (i % 120) * 10, r: 10, dead: false });
  const st = { buildings, units };
  YS.drawList(st, 1); // прогрев
  const t0 = performance.now();
  const N = 200;
  for (let i = 0; i < N; i++) YS.drawList(st, 1);
  const avgUs = ((performance.now() - t0) / N) * 1000;
  assert(avgUs < 2000, `сортировка 800 объектов ${avgUs.toFixed(0)}µs — вне бюджета кадра (<2000µs)`);
  pass(`Y6 перфоманс: сортировка 400 зданий + 400 юнитов = ${avgUs.toFixed(0)}µs/кадр (бюджет 2000µs)`);
} catch (e) { fail('Y6 перфоманс', e); }

if (failures.length) {
  console.log('FAIL  y-sort: ' + failures.join('; '));
  process.exit(1);
}
console.log('PASS  y-sort: все сценарии зелёные');
