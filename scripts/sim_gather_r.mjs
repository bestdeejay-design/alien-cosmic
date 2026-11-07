// ============================================================
// sim_gather.mjs — ace#47: регресс логики добычи по аудиту ace#44.
//   G1 СБОР → «Отпустить сбор» → держимые idle-сборщики вернулись к
//      жилам (D1: releaseAssembly выдаёт orderGather), устойчиво ≥10 c;
//   G2 home-idle (orderStop/пришёл move) → mineScanT-автоскан вернул к
//      добыче ≤5 c (D1) и держит её 2 минуты (аудит-репро B);
//   G3 вылазка: разведанный карман кончился → одноразовый тост
//      «Жилы кончились» (D4), рабочий честно в idle, анти-спам;
//   G4 ПКМ по неразведанной жиле → движение к точке клика (D2),
//      по разведанной — добыча (регресс);
//   G5 вылазка: Дом погиб при фазе toDrop → груз в потери
//      (raidCargoLost), рабочий в evacWait (D5), не вечный toDrop.
// Запуск: node scripts/sim_gather.mjs
//
// Канон по sim_expedition_alarm_v2.mjs: ace dual-path (../game/r/ или
// ../r/), harness-стабы, FakeEl-мир без jsdom; DOM-состояние читается
// классами body. Симы всегда на RU (детерминизм текстов тостов).
// ============================================================
import './harness.mjs';
import { existsSync as _es } from 'node:fs';
const _P = (f) => (_es(new URL('../game/r/js/', import.meta.url).pathname) ? '../game/r/' : '../r/') + f;
import { V } from './stamp.mjs';

const failures = [];
const fail = (phase, err) => { failures.push(phase); console.log(`FAIL  ${phase}: ${String((err && err.message) || err)}`); };
const pass = (msg) => console.log(`PASS  ${msg}`);
const assert = (c, m) => { if (!c) throw new Error(m); };

await import(_P('js/game.js'));
const U = await import(_P('js/units.js' + V));
const B = await import(_P('js/buildings.js' + V));
const ASM = await import(_P('js/alarm-v2-assembly.js' + V));
const I18N = await import(_P('js/i18n.js' + V));
const { TILE } = await import(_P('js/config.js' + V));

const game = globalThis.game;
assert(game, 'движок полигона не поднялся');
const ticks = (n) => { for (let i = 0; i < n; i++) game.tick(); };

function bootHome() {
  game.startRaidHome('human', { forceNew: true });
  // Тур онбординга завершён (done=true): D1-автоскан дома работает только
  // ПОСЛЕ выхода из тура (канон ace#35 — стартовые сборщики стоят, пока
  // тур не закончен; гейт по флагам сессии см. units.js).
  game.raidSession.onboarding.done = true;
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

function launch(st, budget = 50, units = { worker: 3 }) {
  const res = game.launchRaidExpedition({ tier: 1, seed: 4242, budget, units });
  assert(res && res.ok, 'вылазка не запустилась: ' + JSON.stringify(res));
  ticks(4);
  return game.state;
}

const myWorkers = (st) => st.units.filter((u) => !u.dead && !u.garrison &&
  u.side === 'player' && u.type === 'worker' && !u.evacuated);

// ---------- G1: СБОР → release → возврат к добыче (D1, аудит P1-1) ----------
try {
  const st = bootHome();
  const workers = myWorkers(st);
  assert(workers.length >= 2, 'стартовых сборщиков меньше двух');
  // Все в idle без приказа и с пустым трюмом (eligible: idle, carrying 0).
  for (const w of workers) { w.carrying = 0; U.orderStop(w); }
  const cc = st.buildings.find((b) => !b.dead && b.side === 'player' && b.type === 'cc');
  const asm = ASM.issueAssembly(st, cc);
  assert(asm.ok && asm.unreachable === 0, 'СБОР не встал: ' + JSON.stringify(asm));
  // СБОР собирает всех idle (и бойцов тоже) — проверяем именно сборщиков.
  const held = workers.filter((w) => w.gatherHold === true);
  assert(held.length === workers.length, 'hold встал не всем сборщикам: ' + held.length + '/' + workers.length);
  // Собрались и стоят: idle при hold — hold-семантика не трогается (D1).
  for (const w of held) U.orderStop(w); // orderStop не снимает gatherHold
  assert(held.every((w) => w.gatherHold && w.order.kind === 'idle'), 'сбор не в idle-hold');
  // «Отпустить сбор».
  const n = ASM.releaseAssembly(st);
  assert(n >= held.length, 'релиз не всех: ' + n);
  for (const w of held) {
    assert(w.gatherHold === false && !w.assemble, 'hold не снят');
    assert(w.order && w.order.kind === 'gather',
      'релиз не вернул к жиле: ' + JSON.stringify(w.order));
  }
  // Устойчивость ≤10 c (критерий приёмки): не рассыпаются обратно в idle.
  ticks(600);
  for (const w of held) {
    assert(w.order && w.order.kind === 'gather',
      'через 10 c не добыча: ' + JSON.stringify(w.order));
  }
  pass('G1 СБОР→release: держимые idle-сборщики получили gather сразу и держат его 10 c');
} catch (e) { fail('G1 СБОР→release→добыча', e); }

// ---------- G2: home-idle → автоскан ≤5 c, держит 2 минуты (D1, аудит P1-2) ----------
try {
  const st = bootHome();
  const w = myWorkers(st)[0];
  U.orderStop(w); // как KeyS/пришедший move: idle без приказа
  let guard = 0;
  while (w.order.kind === 'idle' && guard++ < 500) game.tick(); // ≤5 c
  assert(w.order.kind === 'gather',
    'home-idle не вернулся к добыче за 5 c: ' + JSON.stringify(w.order) + ' (тика: ' + guard + ')');
  const t5 = guard / 100;
  // Аудит-репро B: «2 минуты порядка — idle 4/4». Теперь 2 минуты — добыча.
  const t0 = st.time;
  while (st.time - t0 < 120 && w.order.kind === 'gather') game.tick();
  assert(w.order.kind === 'gather',
    'за 2 минуты сборщик выпал из добычи: ' + JSON.stringify(w.order));
  pass(`G2 home-idle автоскан: gather за ${t5.toFixed(2)} c (≤5 c), держит 2 минуты`);
} catch (e) { fail('G2 home-idle автоскан', e); }

// ---------- G3: вылазка, карман кончился → тост (D4, аудит P2-3) ----------
try {
  const st = launch(bootHome(), 50, { worker: 2 });
  const pocketKey = I18N.t('ui.raid.toastPocketEmpty');
  assert(pocketKey && pocketKey !== 'ui.raid.toastPocketEmpty', 'ключ тоста не в локали');
  // Спай на тосты: game.ui — свойство инстанса (this.ui = ui), подменяем
  // копией неймспейса с обёрнутым toast; units.js зовёт st.game.ui.toast.
  const toasts = [];
  const realUI = game.ui;
  game.ui = Object.assign({}, realUI, {
    toast: (msg, kind, ms) => { toasts.push(String(msg)); return realUI.toast(msg, kind, ms); },
  });
  try {
    // Разведанная жила (есть после высадки; если нет — честно открываем обзор).
    let c = st.map.crystals.find((k) => !k.dead && k.amount > 0 && st.fog.tileExplored(k.tx, k.ty));
    if (!c) {
      c = st.map.crystals.find((k) => !k.dead && k.amount > 0);
      assert(c, 'на карте нет живых жил вообще');
      st.fog.mark(c.tx, c.ty, 9);
      st.fog.dirty = true;
    }
    const w = myWorkers(st).find((x) => !x.evacWait && !x.evacHold);
    assert(w, 'нет свободного сборщика на вылазке');
    U.orderGather(st, w, c);
    ticks(10); // в пути к жиле (или уже майнит — не важно)
    // Карман кончился: ВСЕ разведанные жилы обнулены, неразведанные живут.
    let zeroed = 0, hidden = 0;
    for (const k of st.map.crystals) {
      if (k.dead || k.amount <= 0) continue;
      if (st.fog.tileExplored(k.tx, k.ty)) { k.amount = 0; zeroed++; }
      else hidden++;
    }
    assert(zeroed >= 1, 'обнулили ноль разведанных жил');
    assert(hidden >= 1, 'нет неразведанных жил за туманом (репро аудита пустое)');
    ticks(5);
    assert(st.raidPocketToasted === true, 'одноразовый флаг тоста не встал');
    assert(toasts.some((m) => m === pocketKey),
      'тост «Жилы кончились» не показан: ' + JSON.stringify(toasts));
    assert(w.order.kind === 'idle', 'сборщик не остановлен честно: ' + JSON.stringify(w.order));
    // Анти-спам: 10 c спустя — повторов нет.
    ticks(1000);
    const n = toasts.filter((m) => m === pocketKey).length;
    assert(n === 1, 'тост спамит: ' + n);
  } finally {
    game.ui = realUI;
  }
  pass('G3 карман вылазки: тост RU ровно один, сборщик в idle, автопоиск честно молчит');
} catch (e) { fail('G3 тост кармана', e); }

// ---------- G4: ПКМ по неразведанной жиле → движение (D2, аудит P2-4) ----------
try {
  const st = bootHome();
  const w = myWorkers(st)[0];
  const fogC = st.map.crystals.find((k) => !k.dead && !st.fog.tileExplored(k.tx, k.ty));
  assert(fogC, 'нет жилы в тумане для репро');
  U.orderStop(w);
  st.selection = [w];
  game.issueRMB((fogC.tx + 0.5) * TILE, (fogC.ty + 0.5) * TILE);
  assert(w.order && w.order.kind === 'move',
    'ПКМ по серой жиле съеден молча: ' + JSON.stringify(w.order));
  assert(Math.hypot(w.order.gx - (fogC.tx + 0.5) * TILE, w.order.gy - (fogC.ty + 0.5) * TILE) <= TILE * 7,
    'движение не к точке клика: ' + JSON.stringify([w.order.gx, w.order.gy]));
  // Регресс: разведанная жила — по-прежнему добыча.
  const visC = st.map.crystals.find((k) => !k.dead && k.amount > 0 && st.fog.tileExplored(k.tx, k.ty));
  assert(visC, 'нет разведанной жилы для регресса');
  game.issueRMB((visC.tx + 0.5) * TILE, (visC.ty + 0.5) * TILE);
  assert(w.order && w.order.kind === 'gather' && w.order.target === visC,
    'ПКМ по разведанной жиле сломался: ' + JSON.stringify(w.order));
  pass('G4 RMB-в-туман → move к точке клика; разведанная жила → gather (регресс цел)');
} catch (e) { fail('G4 RMB-в-туман', e); }

// ---------- G5: Дом погиб при toDrop → груз в потери + evacWait (D5, аудит P3-6) ----------
try {
  const st = launch(bootHome(), 50, { worker: 2 });
  const w = myWorkers(st).find((x) => !x.evacWait && !x.evacHold);
  assert(w, 'нет свободного сборщика');
  // Репро аудита: carry=8, фаза toDrop.
  w.carrying = 8;
  w.order = { kind: 'gather', target: st.map.crystals[0] || null, phase: 'toDrop' };
  w.path = null; w.pathI = 0;
  const lostBefore = st.raidCargoLost || 0;
  st.raidHouse.dead = true; // Дом-шаттл уничтожен
  game.tick(); // updateUnits (D5-ветка) → updateRaidTick закрывает вылазку
  assert(st.raidCargoLost === lostBefore + 8,
    'груз не в потерях: ' + (st.raidCargoLost - lostBefore) + ' из 8');
  assert(w.carrying === 0, 'груз не списан с рабочего');
  assert(w.evacWait === true, 'рабочий не в evacWait');
  assert(w.order.kind === 'idle', 'рабочий не выведен из toDrop: ' + JSON.stringify(w.order));
  pass('G5 Дом-dead при toDrop: 8 эрга в raidCargoLost, рабочий evacWait/idle');
} catch (e) { fail('G5 Дом-dead toDrop', e); }

if (failures.length) {
  console.log(`\ngather: СБОЙ — ${failures.length}: ${failures.join('; ')}`);
  process.exit(1);
}
console.log('\ngather: все группы зелёные');
