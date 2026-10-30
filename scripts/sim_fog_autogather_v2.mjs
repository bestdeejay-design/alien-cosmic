// ============================================================
// sim_fog_autogather_v2.mjs — ace#10 Ф-5 (ревизия SZ m2, ACCEPTANCE §2:88).
// Запрет авто-добычи в неоткрытом тумане (фикс 6299a96 жив на v2) + holds.
//   FG1 авто-добыча на ЧЁРНУЮ жилу — no-op: приказа нет, юнит не двигается;
//   FG2 изученная жила — приказ ставится, юнит идёт и начинает добычу;
//   FG3 markOwnSight даёт знания РОВНО по тайлам обзора (позиция внутри
//      тайла не расширяет знания — никакой пиксельной утечки);
//   FG4 авто-добыча не снимает evacWait/evacHold/gatherHold (isAutoLocked);
//   FG5 трюм полон (raidHoldFull) — бурение бессмысленно, авто не стартует;
//   FG6 вылазка: старт и секундный retry авто-добычи (6299a96) живы на v2:
//      свежий отряд стартует только по изученным жилам, исчерпание жилы
//      возвращает рабочего в idle и через ~1 с он подхватывает новую.
// Полный цикл «едет-добывает-сдаёт» на вылазке покрыт sim_raid_field F1–F3.
// Запуск: node scripts/sim_fog_autogather_v2.mjs
// ============================================================
import './harness.mjs';
import { V } from './stamp.mjs';

const failures = [];
const fail = (phase, err) => { failures.push(phase); console.log(`FAIL  ${phase}: ${String((err && err.message) || err)}`); };
const pass = (msg) => console.log(`PASS  ${msg}`);
const assert = (c, m) => { if (!c) throw new Error(m); };

await import('../r/js/game.js');
const U = await import('../r/js/units.js' + V);
const B = await import('../r/js/buildings.js' + V);

const game = globalThis.game;
assert(game, 'движок полигона не поднялся');
const ticks = (n) => { for (let i = 0; i < n; i++) game.tick(); };

// Домашняя база с Домом-Г2 (консоль вылазки требует depot>=2) и стартовым
// рабочим; затем вылазка тир 1 (карта вылазки начинается НЕизученной).
function launchRaid() {
  game.startRaidHome('human', { forceNew: true });
  ticks(4);
  const home = game.state;
  const cc = home.buildings.find((b) => !b.dead && b.side === 'player' && b.type === 'cc');
  const depot = new B.Building(home, 'player', 'depot', cc.tx + 2, cc.ty + 2, true);
  depot.level = 5;
  depot.maxHp = depot.hp = Math.round(depot.cfg.hp * 2);
  home.map.markBuilding(depot);
  home.bcount.player++;
  const res = game.launchRaidExpedition({ tier: 1, seed: 909, budget: 50, units: { worker: 2 } });
  assert(res && res.ok, 'вылазка не запустилась: ' + JSON.stringify(res));
  ticks(4);
  return game.state;
}

function fieldWorkers(st) {
  return st.units.filter((u) => !u.dead && !u.garrison && u.side === 'player' && u.type === 'worker');
}

// ---------- FG1: чёрная жила — авто-добыча no-op ----------
try {
  const st = launchRaid();
  const w = fieldWorkers(st)[0];
  assert(w, 'на вылазке нет рабочего');
  const black = st.map.crystals.find((c) => !c.dead && c.amount > 0 && !st.fog.tileExplored(c.tx, c.ty));
  assert(black, 'на вылазке нет чёрной жилы — старт карты уже изучен?');
  const before = { x: w.x, y: w.y, order: w.order && w.order.kind };
  U.orderGather(st, w, black); // авто-целеуказание по неизвестной жиле
  assert(!(w.order && w.order.kind === 'gather'), 'авто-приказ встал на чёрную жилу (6299a96 сломан)');
  assert(w.x === before.x && w.y === before.y, 'юнит сдвинулся к чёрной жиле без приказа');
  ticks(90); // ~3 с авто-поиска
  assert(!(w.order && w.order.kind === 'gather'), 'авто-поиск через ~3 с вскрыл чёрную жилу');
  pass('FG1 чёрная жила: авто-добыча no-op, юнит стоит (6299a96 жив)');
} catch (e) { fail('FG1 чёрная жила', e); }

// ---------- FG2: изученная жила — приказ и начало добычи ----------
try {
  const st = launchRaid();
  const w = fieldWorkers(st)[0];
  const c = st.map.crystals.find((x) => !x.dead && x.amount > 0);
  st.fog.mark(c.tx, c.ty, 2); // канон 28.10: разведка открывает жилу
  const d0 = Math.hypot(w.x - (c.tx + 0.5) * 32, w.y - (c.ty + 0.5) * 32);
  U.orderGather(st, w, c);
  assert(w.order && w.order.kind === 'gather', 'приказ по изученной жиле не встал');
  ticks(260);
  const d1 = Math.hypot(w.x - (c.tx + 0.5) * 32, w.y - (c.ty + 0.5) * 32);
  assert(d1 < d0, 'рабочий не приблизился к изученной жиле: ' + d0.toFixed(1) + '→' + d1.toFixed(1));
  assert(w.carrying > 0 || w.order.phase === 'toMineral', 'добыча не началась');
  pass(`FG2 изученная жила: приказ встал, рабочий идёт (${d0.toFixed(0)}→${d1.toFixed(0)} px), добыча началась`);
} catch (e) { fail('FG2 изученная жила', e); }

// ---------- FG3: markOwnSight — знания ровно по тайлам обзора ----------
try {
  const st = launchRaid();
  const w = fieldWorkers(st)[0];
  const sight = w.cfg.sightTiles;
  assert(Number.isFinite(sight) && sight >= 1, 'у рабочего нет sightTiles');
  // Девственная чёрная зона: тайл и всё до sight+1 вокруг — не изучены
  // (спавн-зона высадки уже раскрыта, поэтому ищем дальний угол).
  let T1 = null, T2 = null;
  outer:
  for (let ty = sight + 2; ty < st.map.h - sight - 3 && (!T1 || !T2); ty++) {
    for (let tx = sight + 2; tx < st.map.w - sight - 3; tx++) {
      let black = true;
      for (let dy = -(sight + 1); dy <= sight + 1 && black; dy++) {
        for (let dx = -(sight + 1); dx <= sight + 1; dx++) {
          if (st.fog.tileExplored(tx + dx, ty + dy)) { black = false; break; }
        }
      }
      if (!black) continue;
      const farFromT1 = !T1 || Math.hypot(tx - T1.tx, ty - T1.ty) >= 25; // окна ±12 не пересекаются
      if (!farFromT1) continue;
      if (!T1) { T1 = { tx, ty }; tx += sight + 4; }
      else { T2 = { tx, ty }; break outer; }
    }
  }
  assert(T1 && T2, 'на карте вылазки нет двух девственных чёрных зон');
  // Сравниваем ТОЛЬКО новораскрытые тайлы: в окно ±12 могут попадать
  // старые знания (зона высадки/чужой аванпост) — они не должны влиять.
  const windowSet = (t) => {
    const s = new Set();
    for (let dy = -12; dy <= 12; dy++) for (let dx = -12; dx <= 12; dx++) {
      s.add((t.tx + dx) + ':' + (t.ty + dy));
    }
    return s;
  };
  const exploredBefore = (win) => new Set([...win].filter((k) => {
    const [x, y] = k.split(':').map(Number);
    return st.fog.tileExplored(x, y);
  }));
  const W1 = windowSet(T1), W2 = windowSet(T2);
  const pre1 = exploredBefore(W1), pre2 = exploredBefore(W2);
  // Пиксельная граница тайла НЕ расширяет знания: центр тайла vs угол тайла.
  w.x = T1.tx * 32 + 0.5; w.y = T1.ty * 32 + 0.5;
  U.orderGather(st, w, null); // no-op приказ, но markOwnSight отработает
  const n1 = [...exploredBefore(W1)].filter((k) => !pre1.has(k)).length;
  w.x = T2.tx * 32 + 31.9; w.y = T2.ty * 32 + 31.9; // тот же тайл, угол пикселя
  U.orderGather(st, w, null);
  const n2 = [...exploredBefore(W2)].filter((k) => !pre2.has(k)).length;
  assert(st.fog.tileExplored(T1.tx, T1.ty), 'свой тайл не изучен');
  assert(n1 === n2 && n1 > 0, 'позиция внутри тайла меняет знания: ' + n1 + ' vs ' + n2);
  assert(st.fog.tileExplored(T1.tx + sight, T1.ty), 'аксиальный край обзора (sight) не изучен');
  assert(!st.fog.tileExplored(T1.tx + sight + 1, T1.ty), 'утечка знаний за sight+1');
  pass(`FG3 markOwnSight: знания ровно в радиусе ${sight} тайлов; пиксельный край тайла ничего не добавляет (${n1}=${n2})`);
} catch (e) { fail('FG3 радиус знаний', e); }

// ---------- FG4: авто-добыча не снимает holds ----------
try {
  const st = launchRaid();
  const w = fieldWorkers(st)[0];
  const c = st.map.crystals.find((x) => !x.dead && x.amount > 0);
  st.fog.mark(c.tx, c.ty, 2);
  for (const hold of ['evacWait', 'evacHold', 'gatherHold']) {
    w[hold] = true;
    U.orderGather(st, w, c); // авто-приказ по изученной жиле при активном hold
    assert(w[hold] === true, 'auto-добыча сняла ' + hold);
    assert(!(w.order && w.order.kind === 'gather'), 'auto-приказ встал при hold=' + hold);
    w[hold] = false;
  }
  pass('FG4 holds: evacWait/evacHold/gatherHold переживают авто-добычу (isAutoLocked)');
} catch (e) { fail('FG4 holds', e); }

// ---------- FG5: трюм полон — авто-добыча не стартует ----------
try {
  const st = launchRaid();
  const w = fieldWorkers(st)[0];
  const c = st.map.crystals.find((x) => !x.dead && x.amount > 0);
  st.fog.mark(c.tx, c.ty, 2);
  const cap = Number(st.raidCargoCap) || 0;
  assert(cap > 0, 'на вылазке нет вместимости трюма');
  assert(!U.raidHoldFull(st, w), 'raidHoldFull врёт на пустом трюме');
  st.raidCargo = cap; // трюм полон — как после полной загрузки (Э1)
  assert(U.raidHoldFull(st, w), 'raidHoldFull не видит полный трюм');
  U.orderStop(w);
  ticks(120); // ~4 с авто-диспетчера
  assert(!(w.order && w.order.kind === 'gather'), 'авто-добыча стартовала при полном трюме');
  pass('FG5 трюм полон: raidHoldFull=true, авто-добыча не стартует');
} catch (e) { fail('FG5 полный трюм', e); }

// ---------- FG6: старт и секундный retry авто-добычи на вылазке ----------
try {
  const st = launchRaid();
  const workers = fieldWorkers(st);
  assert(workers.length >= 2, 'отряд из 2 рабочих не прилетел');
  // Автоскан берёт БЛИЖАЙШУЮ жилу: если она чёрная — честный no-op (FG1).
  // Старт 6299a96 = разведанная ближайшая жила + скан раз в ~1 с.
  const w = workers[0];
  // Разведка вокруг СВОЕЙ площадки: ближайшие жилы раскрываются, угроз рядом
  // нет (чужой аванпост в тумане — «известных» врагов около площадки нет).
  const wtx = (w.x / 32) | 0, wty = (w.y / 32) | 0;
  for (const c of st.map.crystals) {
    if (c.dead || c.amount <= 0) continue;
    if (Math.hypot(c.tx - wtx, c.ty - wty) <= 12) st.fog.mark(c.tx, c.ty, 2);
  }
  const c1 = U.nearestCrystal(st, w);
  let started = false;
  for (let i = 0; i < 120 && !started; i++) {
    game.tick();
    started = !!(w.order && w.order.kind === 'gather' && w.order.target === c1);
  }
  assert(started, 'авто-старт добычи по разведанной ближайшей жиле не сработал (~4 с)');
  // RETRY (~1 c): жила исчерпана/исчезла — рабочий возвращается в idle и
  // секундный скан подхватывает следующую РАЗВЕДАННУЮ жилу (6299a96).
  const c2 = U.nearestCrystal(st, w, c1);
  assert(c2, 'нет второй жилы для retry-пробы');
  st.fog.mark(c2.tx, c2.ty, 2);
  st.map.removeCrystal(c1);
  let retried = false;
  for (let i = 0; i < 150 && !retried; i++) {
    game.tick();
    retried = !!(w.order && w.order.kind === 'gather' && w.order.target === c2);
  }
  assert(retried, 'секундный retry не подхватил следующую разведанную жилу');
  pass('FG6 вылазка: авто-старт по ближайшей разведанной жиле и секундный retry живы (6299a96)');
} catch (e) { fail('FG6 старт/retry', e); }

if (failures.length) { console.log('FAIL  fog autogather v2: ' + failures.join('; ')); process.exit(1); }
console.log('PASS  fog autogather v2: все группы зелёные');
