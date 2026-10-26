// ============================================================
// sim_squad.mjs — Э7 часть 2: приказы отрядам, трофеи, настройки рейдов.
//
// Проверяем:
//   Q1  «держать сектор»: пост ставится кликом (hooks.issueHold), радиус TILE*5,
//       отряд идёт на пост;
//   Q2  пост атакует врага в радиусе и НЕ гонится за врагом вне радиуса;
//   Q3  отход от поста возвращает бойца (патруль/возврат), а приказ игрока
//       (move/attack) пост не перебивает;
//   Q4  «к КЦ»: юниты получают kind 'cc' и кольцо вокруг КЦ (1.6–3 тайла);
//   Q5  «снять посты»: hold = null у выделенных, счётчик постов;
//   Q6  трофеи: после отражения рейда на месте высадки появляются кристаллы,
//       через 90 с сгорают (без бесплатного эрга);
//   Q7  настройки рейдов: enabled=false глушит рейды, scale меняет размер
//       волны, first/interval клампятся в коридор;
//   Q8  вкладка «Оборона» в админке: поля, пресеты, сохранение, сброс;
//   Q9  живой прогон: 90 тиков с постами, рендер колец, рейд поверх постов.
//
// Запуск: node scripts/sim_squad.mjs
// ============================================================
import './harness.mjs';

await import('../r/js/game.js');
import { V } from './stamp.mjs';
const S = await import('../r/js/squad.js' + V);
const HR = await import('../r/js/home-raid.js' + V);
const C = await import('../r/js/commander.js' + V);
const U = await import('../r/js/units.js' + V);
const cfg = await import('../r/js/config.js' + V);

const failures = [];
const fail = (phase, err) => { failures.push(phase); console.log(`FAIL  ${phase}: ${String((err && err.message) || err)}`); };
const pass = (m) => console.log(`PASS  ${m}`);
const assert = (c, m) => { if (!c) throw new Error(m); };

const game = globalThis.game;
assert(game, 'движок полигона не поднялся');
const ticks = (n) => { for (let i = 0; i < n; i++) game.tick(); };
const boot = () => {
  game.startRaidHome('human', { forceNew: true });
  ticks(3);
  return game.state;
};
const ccOf = (st) => st.buildings.find((b) => !b.dead && b.side === 'player' && b.type === 'cc');
const soldier = (st, x, y) => U.spawnUnit(st, 'player', 'marine', x, y);
const enemy = (st, x, y) => U.spawnUnit(st, 'enemy', 'buggy', x, y);
const TILE = cfg.TILE;

// ---------- Q1: пост ставится кликом, радиус и движение ----------
try {
  const st = boot();
  st.selection = [];
  const u = soldier(st, 600, 600);
  st.selection = [u];
  assert(S.combatUnits(st, st.selection).length === 1, 'боец не считается бойцом отряда');

  // Команда выделения: «Держать сектор» — режим, затем клик по карте.
  const cmds = game.getCommands();
  const holdCmd = cmds.find((c) => c.code === 'KeyJ');
  assert(holdCmd, 'в контексте выделения нет команды «Держать сектор»');
  holdCmd.on();
  assert(st.holdPick === true, 'клик по команде не включил режим постановки поста');
  game.hooks.issueHold(700, 660);
  st.holdPick = false;

  assert(u.hold && u.hold.kind === 'hold', 'пост не поставлен');
  assert(Math.round(u.hold.r) === Math.round(TILE * 5), 'радиус поста не TILE*5: ' + u.hold.r);
  assert(u.order.kind === 'move', 'боец не пошёл на пост: ' + u.order.kind);
  assert(S.squadHoldCount(st) === 1, 'счётчик постов неверен: ' + S.squadHoldCount(st));
  pass(`Q1 пост из контекста выделения, радиус ${Math.round(S.HOLD_RADIUS / TILE)} тайлов, боец идёт на пост`);
} catch (e) { fail('Q1', e); }

// ---------- Q2: атака в радиусе, без погони за радиусом ----------
try {
  const st = boot();
  st.selection = [];
  const u = soldier(st, 600, 600);
  st.selection = [u];
  S.issueHold(st, 600, 600, st.selection);
  U.orderMove(st, u, 600, 600);
  u.order = { kind: 'idle' };
  u.x = 600; u.y = 600;

  // Враг далеко (вне радиуса) — пост не должен тянуть бойца в погоню.
  const far = enemy(st, 600 + TILE * 9, 600);
  S.updateSquad(st, 1, true);
  assert(u.order.kind === 'idle', 'пост погнался за врагом вне радиуса: ' + u.order.kind);
  assert(far.order.kind !== 'attack' || far.order.target !== u, 'враг вне радиуса получил приказ от поста');

  // Враг в радиусе — пост атакует.
  far.x = 600 + TILE * 3;
  far.y = 600;
  S.updateSquad(st, 1, true);
  assert(u.order.kind === 'attack' && u.order.target === far,
    'пост не атаковал врага в радиусе: ' + u.order.kind);

  // Боец ушёл с поста, врагов нет — возвращается.
  st.units = st.units.filter((x) => x !== far);
  u.order = { kind: 'idle' };
  u.path = null;
  u.x = 600 + TILE * 8;
  S.updateSquad(st, 1, true);
  assert(u.order.kind === 'move', 'боец не вернулся на пост: ' + u.order.kind);
  pass('Q2 пост бьёт врага в радиусе, не гонится за ним и возвращается на точку');
} catch (e) { fail('Q2', e); }

// ---------- Q3: приказ игрока не перебивается ----------
try {
  const st = boot();
  st.selection = [];
  const u = soldier(st, 600, 600);
  st.selection = [u];
  S.issueHold(st, 600, 600, st.selection);
  U.orderMove(st, u, 900, 900); // приказ игрока
  const before = u.order.kind;
  S.updateSquad(st, 1, true);
  assert(u.order.kind === before, 'пост перебил приказ игрока: ' + before + ' → ' + u.order.kind);
  assert(Math.abs(u.order.x - 900) < 1, 'приказ игрока изменил цель');
  pass('Q3 приказ игрока сильнее поста (пост ждёт, пока боец освободится)');
} catch (e) { fail('Q3', e); }

// ---------- Q4: «к КЦ» ставит кольцо вокруг КЦ ----------
try {
  const st = boot();
  const cc = ccOf(st);
  assert(cc, 'на домашней базе нет КЦ');
  st.selection = [];
  const a = soldier(st, cc.x + 500, cc.y);
  const b = soldier(st, cc.x, cc.y + 500);
  st.selection = [a, b];
  const cmds = game.getCommands();
  const cmd = cmds.find((c) => c.code === 'KeyL');
  assert(cmd, 'нет команды «Отойти к КЦ»');
  cmd.on();
  for (const u of [a, b]) {
    assert(u.hold && u.hold.kind === 'cc', 'нет приказа «к КЦ» у бойца');
    const d = Math.hypot(u.hold.px - cc.x, u.hold.py - cc.y);
    assert(d > TILE * 1.5 && d < TILE * 3.2, 'точка кольца вне 1.6–3 тайлов: ' + (d / TILE).toFixed(2));
  }
  assert(a.hold.px !== b.hold.px || a.hold.py !== b.hold.py, 'юниты встали в одну точку кольца');
  pass('Q4 «к КЦ»: кольцо 1.6–3 тайла вокруг центра, у бойцов разные места');
} catch (e) { fail('Q4', e); }

// ---------- Q5: снятие постов ----------
try {
  const st = boot();
  st.selection = [];
  const a = soldier(st, 600, 600);
  const b = soldier(st, 640, 600);
  st.selection = [a, b];
  S.issueHold(st, 620, 600, st.selection);
  assert(S.squadHoldCount(st) === 2, 'постов должно быть 2: ' + S.squadHoldCount(st));
  const cmds = game.getCommands();
  const cmd = cmds.find((c) => c.code === 'KeyN');
  assert(cmd, 'нет команды «Снять посты» при выставленных постах');
  cmd.on();
  assert(S.squadHoldCount(st) === 0, 'посты не снялись');
  assert(!a.hold && !b.hold, 'у бойцов остался hold');
  pass('Q5 «Снять посты» освобождает бойцов, команда появляется только при постах');
} catch (e) { fail('Q5', e); }

// ---------- Q6: трофеи после отражения и сгорание через 90 с ----------
try {
  const st = boot();
  const c = C.ensureCommander(st);
  c.level = 12; // полковник: ×1.3 к трофеям
  const before = st.map.crystals.length;
  const res = HR.spawnHomeWave(st, {});
  assert(res.ok, 'рейд не запустился');
  const wave = res.wave;
  // Убиваем всех врагов — рейд отбит.
  for (const u of st.units) if (u.side === 'enemy') u.dead = true;
  const events = [];
  for (let i = 0; i < 30 && !events.length; i++) events.push(...HR.updateHomeRaid(game, st, 1));
  const rep = events.find((e) => e.type === 'repelled');
  assert(rep, 'нет события об отражении рейда');
  assert(rep.salvage > 0, 'трофеи не выпали');
  const after = st.map.crystals.length;
  assert(after > before, 'на карте не появились кристаллы-трофеи');
  assert(st.homeRaid.salvage, 'нет окна трофеев в статусе');
  const per = Math.round((60 + wave * 60) * 1.3);
  assert(rep.salvage === per * (after - before), 'сумма трофеев неверна: ' + rep.salvage + ' vs ' + per * (after - before));
  const left = HR.homeRaidStatus(st).salvage.left;
  assert(left > 85 && left <= 90, 'окно трофеев не 90 с: ' + left);

  // Ждём 90 с игрового времени — трофеи сгорают.
  st.time = (st.time || 0) + 91;
  const gone = HR.updateHomeRaid(game, st, 0.2).find((e) => e.type === 'salvageGone');
  assert(gone, 'нет события о сгорании трофеев');
  assert(st.map.crystals.length === before, 'кристаллы-трофеи не исчезли с карты: ' + st.map.crystals.length);
  assert(st.homeRaid.salvage === null, 'окно трофеев не закрылось');
  pass(`Q6 трофеи: ${rep.salvage} эрга (×1.3 за звание), окно 90 с, потом сгорают`);
} catch (e) { fail('Q6', e); }

// ---------- Q7: настройки рейдов ----------
try {
  HR.resetRaidConfig();
  const def = HR.loadRaidConfig();
  assert(def.enabled === true && def.first === 240 && def.interval === 300 && def.scale === 1,
    'дефолт конфига неверен: ' + JSON.stringify(def));

  // Клампы.
  const clamped = HR.saveRaidConfig({ first: 5, interval: 5, scale: 99 });
  assert(clamped.first === 30 && clamped.interval === 60 && clamped.scale === 3,
    'клампы first/interval/scale не работают: ' + JSON.stringify(clamped));
  HR.resetRaidConfig();
  let st0State = null;
  const st0 = () => (st0State || (st0State = boot()));

  const base = HR.waveSize(st0(), 1);
  HR.saveRaidConfig({ scale: 2 });
  const doubled = HR.waveSize(st0(), 1);
  assert(doubled > base, 'scale не увеличил волну: ' + base + ' → ' + doubled);
  HR.saveRaidConfig({ scale: 0.5 });
  const half = HR.waveSize(st0(), 1);
  assert(half < base, 'scale не уменьшил волну: ' + base + ' → ' + half);
  assert(half >= 2, 'волна не может быть меньше 2');
  HR.resetRaidConfig();

  // enabled=false: таймер идёт, но рейд не приходит.
  const st = boot();
  HR.saveRaidConfig({ enabled: false, first: 30 });
  st.homeRaid.nextAt = 1;
  let spawned = 0;
  for (let i = 0; i < 20; i++) {
    for (const e of HR.updateHomeRaid(game, st, 1)) if (e.type === 'incoming') spawned++;
  }
  assert(spawned === 0, 'при enabled=false рейд всё равно пришёл');
  assert(!st.homeRaid.active, 'при enabled=false появились враги');

  // Включили обратно — рейд приходит.
  HR.saveRaidConfig({ enabled: true, first: 30, interval: 60 });
  st.homeRaid.nextAt = 1;
  let back = 0;
  for (let i = 0; i < 20; i++) {
    for (const e of HR.updateHomeRaid(game, st, 1)) if (e.type === 'incoming') back++;
  }
  assert(back === 1, 'после включения рейд не пришёл один раз: ' + back);
  // Отбиваем волну — следующий рейд должен ждать ровно interval из админки.
  for (const u of st.units) if (u.side === 'enemy') u.dead = true;
  let repelled = false;
  for (let i = 0; i < 30 && !repelled; i++) {
    repelled = HR.updateHomeRaid(game, st, 1).some((e) => e.type === 'repelled');
  }
  assert(repelled, 'волна не отбилась');
  assert(st.homeRaid.nextAt === 60, 'интервал не применился к следующему рейду: ' + st.homeRaid.nextAt);
  HR.resetRaidConfig();
  pass(`Q7 настройки рейдов: волна ×0.5…×2, enabled глушит/включает, интервал 60 с применяется`);
} catch (e) { fail('Q7', e); }

// ---------- Q8: вкладка «Оборона» в админке ----------
try {
  const st = boot();
  HR.resetRaidConfig();
  const A = await import('../r/js/admin.js' + V);
  // A3 (аудит 26.10): админка — только профиль владельца «best».
  globalThis.localStorage.setItem('ac_save_nick', 'best');
  window.__saveIdentity = { nick: 'best', pin: '1234' };
  globalThis.sessionStorage.setItem('ac_admin_ok', '1');
  A.closeAdmin();
  A.openAdmin(game);
  const panel = document.body.children.find((c) => c.id === 'admin-overlay');
  assert(panel, 'админка не открылась');
  const tab = panel.querySelectorAll('.adm-tab').find((b) => b.dataset.tab === 'raid');
  assert(tab, 'нет вкладки «Оборона»');
  tab.click();
  const body = panel.querySelector('#adm-body');
  assert(body, 'нет тела админки');
  const on = body.querySelector('#adm-rd-on');
  const first = body.querySelector('#adm-rd-first');
  const scale = body.querySelector('#adm-rd-scale');
  assert(on && first && scale, 'на вкладке «Оборона» нет полей конфига');
  assert(on.checked === true, 'дефолт: рейды должны быть включены');

  // Меняем: выключить рейды, первый 120 с, масштаб 1.5 → сохранить.
  on.checked = false;
  first.value = '120';
  scale.value = '1.5';
  body.querySelector('#adm-rd-save').click();
  const saved = HR.loadRaidConfig();
  assert(saved.enabled === false && saved.first === 120 && Math.abs(saved.scale - 1.5) < 1e-6,
    'админка не сохранила конфиг: ' + JSON.stringify(saved));

  // Пресет «Мягко» и сброс.
  const presets = body.querySelectorAll('[data-preset]');
  const softBtn = presets.find((b) => b.dataset.preset === '120,180,0.6');
  assert(softBtn, 'нет пресета «Мягко»');
  softBtn.click();
  body.querySelector('#adm-rd-save').click();
  const soft = HR.loadRaidConfig();
  assert(soft.enabled && soft.first === 120 && soft.interval === 180 && Math.abs(soft.scale - 0.6) < 1e-6,
    'пресет «Мягко» не применился: ' + JSON.stringify(soft));
  body.querySelector('#adm-rd-reset').click();
  const back2 = HR.loadRaidConfig();
  assert(back2.enabled === true && back2.first === 240 && back2.interval === 300 && back2.scale === 1,
    'сброс не вернул стандарт: ' + JSON.stringify(back2));
  A.closeAdmin();
  sessionStorage.removeItem('ac_admin_ok');
  pass('Q8 админка: вкладка «Оборона» — вкл/выкл, first, интервал, масштаб, пресеты, сброс');
} catch (e) { fail('Q8', e); }

// ---------- Q9: живой тик и рендер с постами ----------
try {
  const st = boot();
  st.selection = [];
  const a = soldier(st, 600, 600);
  const b = soldier(st, 640, 640);
  st.selection = [a, b];
  S.issueHold(st, 620, 620, st.selection);
  S.issueRetreatToCC(st, [b]);
  // 90 игровых тиков: пост живёт, ничего не падает, кольца рисуются.
  ticks(90);
  assert(a.hold && a.hold.kind === 'hold', 'пост «держать сектор» пропал после тиков');
  assert(b.hold && b.hold.kind === 'cc', 'приказ «к КЦ» пропал после тиков');
  game.render(1);
  // Рейд поверх постов: командир поднимает войска, пост не мешает.
  HR.spawnHomeWave(st, {});
  ticks(30);
  game.render(1);
  assert(st.homeRaid.active || st.homeRaid.repelled > 0, 'рейд не прошёл при выставленных постах');
  pass('Q9 90 тиков с постами + рендер колец + входящий рейд — без ошибок');
} catch (e) { fail('Q9', e); }

if (failures.length) {
  console.log(`\n❌ Э7 ч.2: провалено ${failures.length} (${failures.join(', ')})`);
  process.exit(1);
}
console.log('\n✓ Э7 ч.2 зелёная: посты, отход к КЦ, трофеи, настройки рейдов');
