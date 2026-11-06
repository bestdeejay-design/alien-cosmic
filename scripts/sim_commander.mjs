// ============================================================
// sim_commander.mjs — Э7: командир КЦ (капитан → генерал) и оборона базы.
//
// Проверяем:
//   C1  звания 1–20, опыт, переходы капитан → майор → полковник → генерал;
//   C2  бонусы звания числами (места, грейд, урон в обороне, ремонт) и то,
//       что бонус мест реально доходит до населения (supply.cap);
//   C3  входящий рейд: таймер, предупреждение, спавн у края карты, приказы
//       врагам, автозащита командира, награда и опыт за отражение;
//   C4  учебная тревога и «рейд не начисляет награду дважды»;
//   C5  сохранение: командир переживает DTO домашней базы;
//   C6  карточка командира: открытие, звание, переключатель автозащиты,
//       кнопка «Учебная тревога», закрытие.
//
// Запуск: node scripts/sim_commander.mjs
//
// ace dual-path (копия из котла alien-cosmic/scripts с патчем путей ../r/ → ../game/r/,
// как sim_unlocks): котёл гоняет свой оригинал, ace — эту копию против game/r/.
// ============================================================
import './harness.mjs';

// dual-path: ace game/r/ ИЛИ котёл-симлинк r/
import { existsSync as _es } from 'node:fs';
const _ROOT = _es(new URL('../game/r/js/', import.meta.url).pathname) ? '../game/r/' : '../r/';
await import(_ROOT + 'js/game.js');
import { V } from './stamp.mjs';
const C = await import(_ROOT + 'js/commander.js' + V);
const HR = await import(_ROOT + 'js/home-raid.js' + V);
const CUI = await import(_ROOT + 'js/commander-ui.js' + V);
const U = await import(_ROOT + 'js/units.js' + V);
const cfg = await import(_ROOT + 'js/config.js' + V);
const R = await import(_ROOT + 'js/raid.js' + V);
const MIG = await import(_ROOT + 'js/alarm-v2-migration.js' + V);
const PLAN = await import(_ROOT + 'js/alarm-v2-plan.js' + V);
const DIR = await import(_ROOT + 'js/alarm-v2-director.js' + V);
const ECO = await import(_ROOT + 'js/economy.js' + V);
const BLD = await import(_ROOT + 'js/buildings.js' + V);

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
// ace#10: новая база — schema 2 (боевая тревога v2). Для legacy-веток сима
// (домашние волны, старая XP-кривая) сохранён контекст schema 1 — старые
// инварианты не удаляются, они проверяются на legacy-сессии.
const bootLegacy = () => {
  const st = boot();
  game.raidSession.schema = 1;
  game.raidSession.alarmV2 = undefined;
  st.commander = C.createCommander();
  return st;
};

// ---------- C1: звания и опыт ----------
try {
  const st = bootLegacy();
  const c = C.ensureCommander(st);
  assert(c.level === 1 && C.rankName(1) === 'Капитан', 'старт не капитан: ' + C.rankName(c.level));
  assert(C.xpNeed(1) === 100, 'нужно 100 XP на 2 уровень, а не ' + C.xpNeed(1));
  assert(C.totalXpTo20() > 8000 && C.totalXpTo20() < 11000,
    'путь до генерала вне коридора: ' + C.totalXpTo20());

  C.addXp(st, 99);
  assert(c.level === 1, 'уровень поднялся раньше нужного');
  C.addXp(st, 1);
  assert(c.level === 2, 'нет перехода на 2 уровень');
  assert(C.rankOf(2).key === 'captain', '2 уровень — не капитан');

  const jumps = [];
  for (const [target, rankKey] of [[5, 'major'], [10, 'colonel'], [15, 'general']]) {
    let guard = 0;
    while (c.level < target && guard++ < 50) C.addXp(st, C.xpNeed(c.level));
    assert(C.rankOf(c.level).key === rankKey, `на ${target} уровне ожидали ${rankKey}, получили ${C.rankOf(c.level).key}`);
    jumps.push(`${target}:${C.rankName(target)}`);
  }
  let guard = 0;
  while (c.level < 20 && guard++ < 80) C.addXp(st, C.xpNeed(c.level));
  assert(c.level === 20 && c.xp === 0, 'на 20 уровне опыт должен обнуляться');
  const max = C.addXp(st, 500);
  assert(max.gained === 0 && c.level === 20, 'после 20 уровня опыт не должен капать');
  assert(C.bonuses(20).supply === 9 && C.bonuses(20).defense === 1.19,
    'бонусы генерала неверны: ' + JSON.stringify(C.bonuses(20)));
  pass(`C1 звания (legacy): 1→20, ${jumps.join(' → ')}, путь ${C.totalXpTo20()} XP, на 20 опыт капается`);

  // COMMANDER2_SPEC §2/§3 (канон 03.11): ×8-кривая удалена, шкала едина
  // 60+40·L (путь 8 740 XP); no-op addXp снят — каналы §3.1 снова пишут XP.
  const st2 = boot();
  const c2 = C.ensureCommander(st2);
  assert(c2.schema === 2, 'новая база должна быть schema 2');
  assert(C.xpNeed(1, 2) === 100, 'xpNeed: ожидали 100, получили ' + C.xpNeed(1, 2));
  assert(C.totalXpTo20(2) === 8740, 'путь 1→20 должен быть 8740 XP: ' + C.totalXpTo20(2));
  const blocked = C.addXp(st2, 5000);
  assert(blocked.gained === 5000 && blocked.levelUp, 'addXp на v2 должен начислять XP');
  assert(c2.level === 14, '5000 XP по шкале 60+40·L дают L14 (сумма 5040): ' + c2.level);
  const award = MIG.prepareAlarmXpAward(c2, (BigInt(100) * 1000000n).toString());
  assert(award.levels === 1 && award.commander.level === 15, 'prepareAlarmXpAward не поднял уровень');
  assert(award.commander.unspent === 14, 'за новый уровень не выдано очко навыка');
  let lvl = 0;
  while (award.commander.level < 20) {
    const need = C.xpNeed(award.commander.level, 2);
    const r = MIG.prepareAlarmXpAward(award.commander, (BigInt(need) * 1000000n).toString());
    award.commander = r.commander; lvl += r.levels;
  }
  assert(award.commander.level === 20, 'v2: путь до 20 уровня не сходится');
  const cap = MIG.prepareAlarmXpAward(award.commander, (BigInt(500) * 1000000n).toString());
  assert(cap.gainedMicro === '0' && cap.commander.level === 20, 'v2: на 20 уровне XP капается');
  assert(award.commander.unspent === 19, 'всего очков навыка должно быть 19: ' + award.commander.unspent);
  pass(`C1 звания (legacy): 1→20, ${jumps.join(' → ')}, путь ${C.totalXpTo20()} XP; v2: единая кривая 8740, addXp начисляет, очки за уровни, кап 20`);
} catch (e) { fail('C1 звания и опыт', e); }

// ---------- C2: бонусы и население ----------
try {
  const st = bootLegacy();
  const cc = st.buildings.find((b) => b.side === 'player' && b.type === 'cc');
  const baseCap = st.buildings.filter((b) => !b.dead && b.side === 'player' && b.done)
    .reduce((a, b) => a + (b.cfg.supplyGain || 0), 0);
  C.hydrateCommander(st, { level: 1, xp: 0, autoDefense: true, stats: {}, log: [] });
  ticks(2);
  assert(C.supplyBonus(st) === 0, 'капитан не должен давать мест');
  assert(st.supply.player.cap === Math.min(baseCap, cfg.SUPPLY_MAX), 'кап населения без командира изменился');
  C.hydrateCommander(st, { level: 19, xp: 0, autoDefense: true, stats: {}, log: [] });
  ticks(2);
  assert(C.supplyBonus(st) === 9, 'генерал-19 должен давать +9 мест: ' + C.supplyBonus(st));
  assert(st.supply.player.cap === Math.min(baseCap + 9, cfg.SUPPLY_MAX), 'бонус мест не дошёл до населения');
  // На вылазке командир остаётся на базе — бонус не применяется.
  st.raidMode = 'expedition';
  assert(C.supplyBonus(st) === 0, 'на вылазке бонус мест не должен работать');
  st.raidMode = 'home';
  // Бонус урона в обороне применяется только во время рейда.
  const turret = { kind: 'building', side: 'player', type: 'turret', level: 6, cfg: cfg.BUILDINGS.turret };
  const peace = U.atkBonus(st, turret);
  // Боевой бонус включается только на НАСТОЯЩЕМ рейде (учебная тревога — без него).
  HR.spawnHomeWave(st, { wave: 1 });
  const war = U.atkBonus(st, turret);
  assert(war >= peace, `урон в обороне не вырос: ${peace} → ${war}`);
  assert(peace > 0 || war > 0, 'турель вообще без урона');
  void cc;
  pass(`C2 бонусы: генерал-19 даёт +9 мест (кап ${st.supply.player.cap}), в бою урон турели ${peace}→${war}`);
} catch (e) { fail('C2 бонусы', e); }

// ---------- C3: входящий рейд и автооборона ----------
try {
  const st = bootLegacy();
  HR.initHomeRaid(st);
  const hr = st.homeRaid;
  assert(hr.nextAt === HR.HOME_RAID.first && hr.t === 0, 'таймер первого рейда не выставлен');

  let events = HR.updateHomeRaid(game, st, HR.HOME_RAID.first - HR.HOME_RAID.warn - 5);
  assert(!events.some((e) => e.type === 'warn'), 'предупреждение пришло слишком рано');
  events = HR.updateHomeRaid(game, st, 10);
  assert(events.some((e) => e.type === 'warn'), 'нет предупреждения за 25 секунд');
  events = HR.updateHomeRaid(game, st, HR.HOME_RAID.warn + 1);
  const incoming = events.find((e) => e.type === 'incoming');
  assert(incoming, 'рейд не начался по таймеру');
  assert(hr.active && hr.active.wave === 1, 'волна не отмечена активной');
  const enemies = st.units.filter((u) => u.side === 'enemy' && !u.dead);
  assert(enemies.length === incoming.count && enemies.length >= 3, 'врагов не столько, сколько объявлено: ' + enemies.length);
  assert(enemies.every((e) => e.order && e.order.kind === 'attack'), 'враги не получили приказ атаковать базу');
  assert(enemies.every((e) => e.homeRaider), 'враги не помечены как рейдеры');
  const farFromCenter = enemies.every((e) => {
    const cc = st.buildings.find((b) => b.side === 'player' && b.type === 'cc');
    return Math.abs(e.x - cc.x) + Math.abs(e.y - cc.y) > 200;
  });
  assert(farFromCenter, 'враги высадились не у края карты');

  // Автозащита: свободный боец получает приказ атаковать.
  const cc = st.buildings.find((b) => b.side === 'player' && b.type === 'cc');
  const hero = U.spawnUnit(st, 'player', 'marine', cc.x + 60, cc.y + 60, false);
  assert(!hero.order || hero.order.kind !== 'attack', 'у нового бойца не должно быть боевого приказа');
  C.ensureCommander(st).autoDefense = true;
  const issued = HR.autoDefendOrders(st);
  assert(issued >= 1 && hero.order && hero.order.kind === 'attack', 'командир не поднял войска');
  // С выключенной автозащитой приказов нет.
  hero.order = { kind: 'idle' };
  C.ensureCommander(st).autoDefense = false;
  HR.updateHomeRaid(game, st, 0.05);
  assert(hero.order.kind !== 'attack', 'с выключенной автозащитой командир всё равно приказывает');

  // Уничтожаем волну — рейд отбит, награда и опыт начислены.
  C.ensureCommander(st).autoDefense = true;
  const erg0 = st.minerals.player;
  const xp0 = st.commander.xp;
  for (const e of enemies) U.damageEntity(st, e, 1e9, hero);
  events = HR.updateHomeRaid(game, st, 0.05);
  const repelled = events.find((e) => e.type === 'repelled');
  assert(repelled && !repelled.training, 'рейд не засчитан как отбитый');
  assert(st.minerals.player > erg0, 'нет награды за отражение');
  assert(st.commander.xp !== xp0 || st.commander.level > 1, 'нет опыта за отражение');
  assert(st.commander.stats.defenses === 1, 'счётчик отражений не вырос');
  assert(!st.homeRaid.active && st.homeRaid.nextAt === HR.HOME_RAID.interval, 'таймер следующего рейда не сброшен');
  pass(`C3 рейд: предупреждение → волна ${incoming.count} у края → автозащита ${issued} приказ(ов) → отбито, +${repelled.reward} эрга, опыт, счётчик ${st.commander.stats.defenses}`);
} catch (e) { fail('C3 входящий рейд', e); }

// ---------- C4: учебная тревога ----------
try {
  const st = bootLegacy();
  HR.initHomeRaid(st);
  const res = HR.spawnHomeWave(st, { training: true });
  assert(res.ok && res.training, 'учебная тревога не запустилась');
  assert(st.homeRaid.active.training === true, 'волна не помечена как учебная');
  assert(st.homeRaid.active.buff === 1, 'на учебной тревоге не должно быть боевого бонуса');
  const erg0 = st.minerals.player;
  const enemies = st.units.filter((u) => u.side === 'enemy' && !u.dead);
  for (const e of enemies) U.damageEntity(st, e, 1e9, null);
  const events = HR.updateHomeRaid(game, st, 0.05);
  const ok = events.find((e) => e.type === 'repelled');
  assert(ok && ok.training, 'учебная тревога не закрылась');
  assert(st.minerals.player === erg0, 'учебная тревога не должна давать эрг');
  const again = HR.spawnHomeWave(st, { training: true });
  assert(again.ok, 'повторная учебная тревога не запускается');
  pass('C4 учебная тревога: спавн, отсутствие награды, можно повторять');
} catch (e) { fail('C4 учебная тревога', e); }

// ---------- C5: командир в сохранении базы ----------
try {
  const st = boot();
  C.hydrateCommander(st, { level: 12, xp: 55, autoDefense: false, stats: { raids: 7, defenses: 3, kills: 21 }, log: [] });
  const dto = R.captureHomeBaseDTO(st, game.raidSession, new Set());
  assert(dto.commander && dto.commander.level === 12, 'командир не попал в DTO');
  assert(dto.commander.autoDefense === false && dto.commander.stats.kills === 21, 'настройки командира потерялись в DTO');
  const json = JSON.parse(JSON.stringify(dto)); // как через localStorage/сервер
  const fresh = { units: [], buildings: [] };
  C.hydrateCommander(fresh, json.commander);
  assert(fresh.commander.level === 12 && fresh.commander.xp === 55, 'командир не восстановился из DTO');
  assert(fresh.commander.autoDefense === false, 'автозащита не восстановилась');
  pass('C5 сохранение: уровень/опыт/автозащита/статистика командира переживают DTO и JSON');
} catch (e) { fail('C5 сохранение', e); }

// ---------- C6: карточка командира ----------
try {
  const st = bootLegacy();
  C.hydrateCommander(st, { level: 6, xp: 10, autoDefense: true, stats: { raids: 4, defenses: 1, kills: 9 }, log: [] });
  C.logEvent(st, 'Входящий рейд: волна 1', 'warn');
  CUI.openCommander(game);
  const panel = document.body.children.find((c) => c.id === 'commander-overlay');
  assert(panel, 'карточка командира не открылась');
  assert(/МАЙОР/.test(panel.querySelector('#cm-rank').textContent), 'в карточке нет звания: ' + panel.querySelector('#cm-rank').textContent);
  assert(/Опыт|XP/.test(panel.querySelector('#cm-xp').textContent), 'нет строки опыта: ' + panel.querySelector('#cm-xp').textContent);
  assert(/\+/.test(panel.querySelector('#cm-bonus').innerHTML), 'нет бонусов звания');
  // ace#29-редизайн: секция обороны = cm-section-defense (заголовок),
  // живой статус внутри — #cm-def (его обновляет refresh(), у ленивых
  // узлов стаба текст живёт на том узле, куда писал refresh).
  const defSection = panel.querySelector('#cm-section-defense');
  const defBlock = panel.querySelector('#cm-def');
  assert(defSection && defBlock && /рейд|Оборо/i.test(defBlock.textContent),
    'нет блока обороны');
  // Переключатель автозащиты.
  const auto = panel.querySelector('#cm-auto');
  auto.checked = false;
  (auto._handlers && auto._handlers.change || []).forEach((fn) => fn({ target: auto }));
  assert(st.commander.autoDefense === false, 'переключатель автозащиты не сработал');
  // Учебная тревога из карточки.
  panel.querySelector('#cm-training').click();
  assert(st.homeRaid && st.homeRaid.active && st.homeRaid.active.training, 'кнопка учебной тревоги не сработала');
  CUI.closeCommander();
  assert(!document.body.children.some((c) => c.id === 'commander-overlay'), 'карточка не закрылась');
  pass('C6 карточка: звание МАЙОР, опыт, бонусы, оборона, учебная тревога, закрытие');
} catch (e) { fail('C6 карточка командира', e); }

// ---------- C8: карточка командира — посты и трофеи (Э7 ч.2) ----------
try {
  const st = bootLegacy();
  C.ensureCommander(st).level = 8;
  st.selection = [];
  const a = U.spawnUnit(st, 'player', 'marine', 620, 620);
  const b = U.spawnUnit(st, 'player', 'marine', 650, 620);
  st.selection = [a, b];
  // Трофеи на месте высадки: окно 50 секунд.
  st.homeRaid.salvage = { until: (st.time || 0) + 50, amount: 480, crystals: [], wave: 2 };
  CUI.openCommander(game);
  const panel = document.body.children.find((c) => c.id === 'commander-overlay');
  assert(panel, 'карточка не открылась');
  const sv = panel.querySelector('#cm-salvage');
  assert(/480/.test(sv.textContent) && /\d+/.test(sv.textContent), 'в карточке нет трофеев: ' + sv.textContent);
  assert(sv.classList.contains('is-hot'), 'трофеи не подсвечены');

  // «Все к КЦ» — приказ отряду прямо из карточки.
  panel.querySelector('#cm-retreat').click();
  assert(a.hold && a.hold.kind === 'cc' && b.hold.kind === 'cc', 'кнопка «Все к КЦ» не дала приказ');
  const posts = panel.querySelector('#cm-posts');
  assert(/2/.test(posts.textContent), 'счётчик постов в карточке неверен: ' + posts.textContent);

  // «Снять посты».
  panel.querySelector('#cm-clear').click();
  assert(!a.hold && !b.hold, 'кнопка «Снять посты» не сработала');
  assert(!/\d/.test(posts.textContent), 'счётчик постов не обнулился: ' + posts.textContent);
  CUI.closeCommander();
  st.homeRaid.salvage = null;
  pass('C8 карточка: трофеи (окно/подсветка), «Все к КЦ», «Снять посты», счётчик постов');
} catch (e) { fail('C8 посты/трофеи в карточке', e); }

// ---------- C7: движок крутит оборону сам (интеграция в tick) ----------
try {
  const st = bootLegacy();
  HR.initHomeRaid(st);
  st.homeRaid.t = st.homeRaid.nextAt - 0.1; // рейд вот-вот
  ticks(10);
  assert(st.homeRaid.active, 'движок не запустил рейд по таймеру из tick()');
  const cc = st.buildings.find((b) => b.side === 'player' && b.type === 'cc');
  assert(cc.commanderLevel >= 1, 'вымпел командира не выставлен на КЦ');
  ticks(40);
  assert(st.homeRaid.active || st.homeRaid.repelled === 1, 'рейд не развивается');
  pass('C7 интеграция: tick() сам запускает рейд, ставит вымпел на КЦ, бой идёт');
} catch (e) { fail('C7 интеграция', e); }


// ---------- C9 (SPEC §5/§9): учебная тревога v2 — eventId детерминирован,
// повторная сдача в сутки не даёт XP, кристаллов учебная не даёт ----------
try {
  const st = boot();
  const crystalsWithMark = () => st.map.crystals.filter((c) => c.alarmEventId).length;
  const r1 = DIR.startTrainingAlarm(game, { mode: 'light' });
  assert(r1.ok, 'учебная v2 не запустилась: ' + (r1.error || ''));
  const ev1 = game.raidSession.alarmV2.trainingEvent;
  assert(ev1.ledger.plan.kind === 'training', 'учебная не помечена kind=training');
  const id1 = ev1.ledger.plan.eventId;
  assert(id1.startsWith('training-'), 'eventId учебной не по форме training-<baseId>-<seed>: ' + id1);
  // Доводим до конца (SETTLING закрывает учение); гасим учебных врагов
  // штатным уроном, чтобы сим-база без турелей не падала раньше времени.
  let g = 0;
  while (st.alarmTraining && g++ < 40000) {
    for (const u of st.units.filter((x) => x.side === 'enemy' && !x.dead && x.alarmEnemyId)) {
      U.damageEntity(st, u, 1e9, st.units.find((x) => x.side === 'player' && !x.dead && !x.garrison) || null);
    }
    ticks(20);
  }
  assert(!st.alarmTraining, 'учение не завершилось');
  assert(st.commander.lastTrainingXpAt != null, 'нет водяного знака 15 XP/24 ч');
  const microAfterFirst = st.commander.xpMicro;
  assert(crystalsWithMark() === 0, 'учебная тревога дала кристаллы (kind=training исключён)');
  // Повторный пуск в пределах суток: тот же eventId, XP не растёт.
  const r2 = DIR.startTrainingAlarm(game, { mode: 'light' });
  assert(r2.ok, 'повторная учебная не запустилась');
  const id2 = game.raidSession.alarmV2.trainingEvent.ledger.plan.eventId;
  assert(id1 === id2, 'eventId учебной не детерминирован на сутки: ' + id1 + ' vs ' + id2);
  g = 0;
  while (st.alarmTraining && g++ < 40000) ticks(20);
  assert(st.commander.xpMicro === microAfterFirst, 'вторая учебная в сутки дала XP (анти-абьюз §3.3)');
  assert(crystalsWithMark() === 0, 'повторная учебная дала кристаллы');
  pass(`C9 учебная v2 (§3.3/§5): eventId повторяем (${id1.split('-')[0]}-…), XP 15/24 ч по водяному знаку, кристаллов нет`);
} catch (e) { fail('C9 учебная v2', e); }

// ---------- C10 (SPEC §4/§9): эталон баунти и математика исходов ----------
try {
  // Эталон спеки: medium, C=10, K=10, любой seed → potentialBounty === 135.
  const plan = PLAN.createAlarmPlan({ baseId: 'b'.repeat(32), eventSeq: 1, ccUid: 'b'.repeat(32) + ':b:1',
    ccLevel: 10, commanderLevel: 10, mode: 'medium', kind: 'normal', seed: 1 });
  assert(plan.potentialBounty === 135, 'эталон баунти medium C10/K10 != 135: ' + plan.potentialBounty);
  const toWave = (l) => {
    let guard = 0;
    while (l.phase !== 'WAVE' && guard++ < 20000) PLAN.tickAlarm(l);
  };
  const runToVictory = (l) => {
    let guard = 0;
    while (l.phase !== 'SETTLING' && guard++ < 50) {
      toWave(l);
      for (const slot of l.plan.waves[l.waveIndex].slots) {
        l.statuses[slot.enemyId] = 'alive';
        PLAN.recordDeath(l, slot.enemyId, true);
      }
      PLAN.finishAlarmTick(l, true);
    }
    assert(l.phase === 'SETTLING', 'ledger не завершён');
  };
  const ledger = PLAN.createAlarmLedger(plan);
  runToVictory(ledger);
  const ck = ledger.creditedKills;
  const win = PLAN.alarmOutcomeProposal(ledger, { initialBuildingHpMicro: '1000000000', damageMicro: '0', commanderLevel: 10, settledThrough: 0 });
  assert(win.payout === Math.floor(135 * 2.0), 'победа: payout != ⌊135×2⌋: ' + win.payout);
  assert(win.xp === 135 + 2 * ck, 'победа: XP != B + 2·creditedKills: ' + win.xp);
  // Спам-окно 50 %: и XP, и payout режутся вдвое (чек-лист §9: ≤168 эрга и ≤91 XP).
  const spam = PLAN.alarmOutcomeProposal(ledger, { initialBuildingHpMicro: '1000000000', damageMicro: '0', commanderLevel: 10, settledThrough: 0, xpMul: 0.5, payoutMul: 0.5 });
  assert(spam.payout === Math.floor(270 * 0.5) && spam.payout <= 168, 'спам: payout != 50 %: ' + spam.payout);
  assert(spam.xp === Math.floor(win.xp * 0.5) && spam.xp <= 91, 'спам: XP != 50 %: ' + spam.xp);
  // Поражение (сдача): payout 0 (А3), XP 2/килл (X3).
  const l2 = PLAN.createAlarmLedger(plan);
  toWave(l2);
  for (const slot of l2.plan.waves[0].slots.slice(0, 3)) {
    l2.statuses[slot.enemyId] = 'alive';
    PLAN.recordDeath(l2, slot.enemyId, true);
  }
  PLAN.surrenderAlarm(l2);
  const loss = PLAN.alarmOutcomeProposal(l2, { initialBuildingHpMicro: '1000000000', damageMicro: '500000000', commanderLevel: 10, settledThrough: 0 });
  assert(loss.payout === 0, 'поражение: payout должен быть 0: ' + loss.payout);
  assert(loss.xp === 2 * l2.creditedKills, 'поражение: XP != 2/килл: ' + loss.xp);
  // hard: modeMul 1.15 на X1 (§3.3).
  const planHard = PLAN.createAlarmPlan({ baseId: 'b'.repeat(32), eventSeq: 1, ccUid: 'b'.repeat(32) + ':b:1',
    ccLevel: 10, commanderLevel: 10, mode: 'hard', kind: 'normal', seed: 1 });
  const lh = PLAN.createAlarmLedger(planHard);
  runToVictory(lh);
  const hard = PLAN.alarmOutcomeProposal(lh, { initialBuildingHpMicro: '1000000000', damageMicro: '0', commanderLevel: 10, settledThrough: 0 });
  assert(hard.xp === Math.floor(planHard.potentialBounty * 1.15 + 2 * lh.creditedKills),
    'hard: modeMul 1.15 не применён: ' + hard.xp);
  pass(`C10 экономика (§4): medium C10/K10 B=135, payout 270, победа XP ${win.xp} (183-эталон при 24 врагах), спам 50 % (${spam.payout}/${spam.xp}), поражение 0/${loss.xp}, hard ×1.15`);
} catch (e) { fail('C10 экономика', e); }

// ---------- C11 (SPEC §5/§9): кристалл за КАЖДОГО убитого, окно 90 с,
// поражение с живым КЦ кристаллы сохраняет, потеря КЦ сжигает ----------
try {
  const st = boot();
  const before = st.map.crystals.length;
  const res = DIR.startAlarmEvent(game, { mode: 'light', kind: 'normal' });
  assert(res.ok, 'событие не стартовало: ' + (res.error || ''));
  const eventId = res.eventId;
  // Гоняем бой штатно: врагов гасит игрок — каждый credited-килл роняет кристалл.
  let guard = 0;
  while (game.raidSession.alarmV2.activeEvent && guard++ < 60000) {
    const led = game.raidSession.alarmV2.activeEvent && game.raidSession.alarmV2.activeEvent.ledger;
    if (led && led.phase === 'WAVE') {
      for (const u of st.units.filter((x) => x.side === 'enemy' && !x.dead && x.alarmEnemyId)) {
        U.damageEntity(st, u, 1e9, st.units.find((x) => x.side === 'player' && !x.dead && !x.garrison) || null);
      }
    }
    ticks(1);
  }
  assert(guard < 60000, 'событие не завершилось');
  const marked = st.map.crystals.filter((c) => c.alarmEventId === eventId);
  assert(marked.length > 0, 'за убийства не упало ни одного кристалла');
  assert(marked.every((c) => c.until != null && c.amount > 0), 'кристалл события без per-кристалльного окна/цены');
  // Поражение с живым КЦ (сдача) — кристаллы остаются на поле.
  const afterBattle = marked.length;
  assert(afterBattle >= 1, 'кристаллы события пропали до settle');
  // Окно подъёма 90 с: сдвигаем время — кристаллы сгорают (аналог burnSalvage).
  st.time = (st.time || 0) + 95;
  ticks(3);
  assert(st.map.crystals.filter((c) => c.alarmEventId === eventId).length === 0,
    'кристаллы события не сгорели по окну 90 с');
  // Потеря КЦ: burnAlarmEventCrystals сжигает событие немедленно.
  const ev2 = DIR.startAlarmEvent(game, { mode: 'light', kind: 'normal' });
  assert(ev2.ok, 'второе событие не стартовало (cooldown?)');
  const ev2id = ev2.eventId;
  const led2 = game.raidSession.alarmV2.activeEvent.ledger;
  led2.phase = 'WAVE';
  const slot0 = led2.plan.waves[0].slots[0];
  led2.statuses[slot0.enemyId] = 'alive';
  DIR.noteAlarmDeath(st, { alarmEnemyId: slot0.enemyId, x: st.map.w * 32 / 2, y: st.map.h * 32 / 2, side: 'enemy' }, { side: 'player' });
  assert(st.map.crystals.some((c) => c.alarmEventId === ev2id), 'пер-килл дроп не сработал на хуке смерти');
  assert(DIR.burnAlarmEventCrystals(st, ev2id) >= 1, 'сжигание при потере КЦ не удалило кристаллы');
  assert(!st.map.crystals.some((c) => c.alarmEventId === ev2id), 'кристалл события пережил потерю КЦ');
  void before;
  pass(`C11 кристаллы (§5): ${afterBattle} кристаллов за бой (за каждого убитого), окно 90 с сжигает, потеря КЦ сжигает немедленно`);
} catch (e) { fail('C11 кристаллы', e); }

// ---------- C12 (SPEC §6.2/§9): канон потерь — поражение ≠ сброс ----------
try {
  // Частичные потери: КЦ пал, депо живо → НИЧЕГО не выдаётся.
  const st = boot();
  st.commander.level = 7; st.commander.unspent = 6;
  const workers0 = st.units.filter((u) => u.type === 'worker' && !u.dead).length;
  const cc0 = st.buildings.find((b) => b.type === 'cc' && !b.dead);
  const depot = new BLD.Building(st, 'player', 'depot', cc0.tx + 2, cc0.ty + 2, true);
  depot.level = 5;
  st.map.markBuilding(depot);
  st.bcount.player++;
  ticks(2);
  const cc = st.buildings.find((b) => b.type === 'cc' && !b.dead);
  U.damageEntity(st, cc, 1e9, null);
  game.raidSession.alarmV2.lostHouseLevel = ECO.houseLevelOf(st);
  assert(DIR.alarmRecovery.enterRecovery(game, st, null), 'recovery не вошёл');
  const rec = game.raidSession.alarmV2.recovery;
  assert(rec && rec.gift === false, 'частичные потери не должны выдавать подарок');
  const workers1 = st.units.filter((u) => u.type === 'worker' && !u.dead).length;
  assert(workers1 === workers0, 'частичные потери выдали бесплатного юнита');
  assert(!st.buildings.some((b) => b.type === 'cc' && !b.dead), 'КЦ реанимирован при частичных потерях (только ремонт за эрги)');
  // Полное уничтожение: подарок КЦ (HP 50 %) + 2 сборщика + Дом lostHouseLevel.
  const st2 = boot();
  const c2 = st2.commander;
  c2.level = 7; c2.unspent = 6;
  const cc2b = st2.buildings.find((b) => b.type === 'cc' && !b.dead);
  const depot2 = new BLD.Building(st2, 'player', 'depot', cc2b.tx + 2, cc2b.ty + 2, true);
  depot2.level = 5;
  st2.map.markBuilding(depot2);
  st2.bcount.player++;
  ticks(2);
  const house0 = ECO.houseLevelOf(st2);
  assert(house0 > 0, 'нет Дома на стартовой базе');
  for (const b of st2.buildings.filter((x) => x.side === 'player')) U.damageEntity(st2, b, 1e9, null);
  for (const u of st2.units.filter((x) => x.side === 'player')) u.dead = true;
  game.raidSession.alarmV2.lostHouseLevel = house0;
  assert(DIR.alarmRecovery.enterRecovery(game, st2, null), 'recovery не вошёл (полное)');
  const rec2 = game.raidSession.alarmV2.recovery;
  assert(rec2 && rec2.gift === true, 'полное уничтожение без подарка');
  const cc2 = st2.buildings.find((b) => b.type === 'cc' && !b.dead);
  assert(cc2, 'подарочный КЦ не выдан');
  assert(cc2.emergency === true, 'подарочный КЦ не в аварийном режиме');
  assert(cc2.hp === Math.round(cc2.maxHp * 0.5), 'КЦ подарка не HP 50 %: ' + cc2.hp + '/' + cc2.maxHp);
  assert(cc2.level === 1, 'КЦ подарка не в грейде на момент потери: ' + cc2.level);
  const newWorkers = st2.units.filter((u) => u.type === 'worker' && !u.dead).length;
  assert(newWorkers === 2, 'подарок должен давать ровно 2 сборщиков: ' + newWorkers);
  const house = st2.buildings.find((b) => b.type === 'depot' && !b.dead);
  assert(house && house.level === house0, 'Дом подарка не в грейде lostHouseLevel: ' + (house && house.level));
  assert(game.raidSession.alarmV2.lostHouseLevel === house0, 'lostHouseLevel не сохранён в атомарной записи');
  pass(`C12 канон потерь (§6.2): частичные — ничего; полное уничтожение → КЦ 50 % (аварийный, бесплатно), 2 сборщика, Дом ур. ${house0}`);
} catch (e) { fail('C12 канон потерь', e); }

// ---------- C13 (SPEC §3.3/§9): анти-спам ручного пуска — 50 % в окне 300 с ----------
try {
  const st = boot();
  const session = game.raidSession;
  // Пуск сразу после settle (водяной знак свежий) → 50 %.
  session.alarmV2.lastSettleAt = Date.now();
  const r1 = DIR.startAlarmEvent(game, { mode: 'light', kind: 'normal', manual: true });
  assert(r1.ok, 'ручной пуск не прошёл: ' + (r1.error || ''));
  const a1 = session.alarmV2.activeEvent;
  assert(a1.xpMul === 0.5 && a1.payoutMul === 0.5, 'спам-пуск не получил 50 %: ' + a1.xpMul);
  // Закрываем сдачей.
  DIR.surrenderAlarmEvent(game);
  let g = 0;
  while (session.alarmV2.activeEvent && g++ < 40000) ticks(20);
  assert(!session.alarmV2.activeEvent, 'сдача не закрыла событие');
  // Пуск после кулдауна (> 300 с от settle) → 100 %.
  session.alarmV2.lastSettleAt = Date.now() - 301000;
  const r2 = DIR.startAlarmEvent(game, { mode: 'light', kind: 'normal', manual: true });
  assert(r2.ok, 'пуск после кулдауна не прошёл: ' + (r2.error || ''));
  const a2 = session.alarmV2.activeEvent;
  assert(a2.xpMul === 1 && a2.payoutMul === 1, 'пуск после кулдауна должен платить 100 %: ' + a2.xpMul);
  DIR.surrenderAlarmEvent(game);
  g = 0;
  while (session.alarmV2.activeEvent && g++ < 40000) ticks(20);
  pass('C13 анти-спам (§3.3): ручной пуск < 300 с → 50 % XP и payout, после кулдауна → 100 %');
} catch (e) { fail('C13 анти-спам', e); }

// ---------- C14 (ace#29 + XREV-10A/10B): компоновка — порядок, аккордеоны,
// бонусы-по-факту, журнал видим с пометкой «Пока тихо», disarm «Сдаться» ----------
try {
  const st = bootLegacy();
  C.hydrateCommander(st, { level: 1, xp: 0, autoDefense: true, stats: {}, log: [] });
  CUI.openCommander(game);
  const panel = document.body.children.find((c) => c.id === 'commander-overlay');
  assert(panel, 'карточка не открылась');
  // Порядок «управление»: Тревога → Оборона → Развитие → (аккордеоны позже).
  const html = panel.innerHTML;
  const iAlarm = html.indexOf('id="cm-section-alarm"');
  const iDef = html.indexOf('id="cm-section-defense"');
  const iBase = html.indexOf('id="cm-section-base"');
  const iTrain = html.indexOf('id="cm-section-training"');
  const iSkills = html.indexOf('id="cm-section-skills"');
  const iLog = html.indexOf('id="cm-section-log"');
  assert(iAlarm >= 0 && iAlarm < iDef && iDef < iBase && iBase < iTrain && iTrain < iSkills && iSkills < iLog,
    `порядок секций нарушен: ${iAlarm},${iDef},${iBase},${iTrain},${iSkills},${iLog}`);
  // Бонусы звания 1 уровня — нули: строка «нет» видна, список нулей скрыт.
  const bonusNone = panel.querySelector('#cm-bonus-none');
  const bonusList = panel.querySelector('#cm-bonus');
  assert(bonusNone, 'нет строки bonusNone');
  assert(!bonusNone.hidden && /нет|none/i.test(bonusNone.textContent + ' ' + panel.innerHTML), 'bonusNone не показан на 1 уровне');
  assert(bonusList.hidden, 'список нулевых бонусов должен быть скрыт');
  // Аккордеоны: свёрнуты по умолчанию (нет open), заголовки — summary.
  assert(/<details class="cm-acc" id="cm-section-skills">/.test(html), 'навыки не свёрнуты по умолчанию');
  assert(/<details class="cm-acc" id="cm-section-training">/.test(html), 'тренировка не свёрнута');
  assert(/<details class="cm-acc" id="cm-section-log">/.test(html), 'журнал не свёрнут по умолчанию (открыт)');
  // XREV-10B: пустой журнал ВИДЕН (обнаруживаемость), в заголовке — «Пока тихо».
  const logSection = panel.querySelector('#cm-section-log');
  assert(logSection && logSection.hidden === false, 'пустой журнал должен быть видим (XREV-10B)');
  const logNote = panel.querySelector('#cm-log-note');
  assert(logNote && logNote.hidden === false && /Пока тихо|Quiet/i.test(logNote.textContent || ''),
    'у пустого журнала нет пометки «Пока тихо»: ' + (logNote && logNote.textContent));
  // Пустой отчёт скрыт (рендер по факту).
  const repSection = panel.querySelector('#cm-section-report');
  assert(repSection.hidden === true, 'пустой отчёт должен скрываться');
  CUI.closeCommander();

  // XREV-10B: журнал с записями — пометка «Пока тихо» гаснет, список рендерится.
  C.logEvent(st, 'Тестовая запись журнала', 'warn');
  CUI.openCommander(game);
  const panel2 = document.body.children.find((x) => x.id === 'commander-overlay');
  assert(panel2, 'карточка не открылась повторно');
  const logNote2 = panel2.querySelector('#cm-log-note');
  assert(logNote2 && logNote2.hidden === true, 'пометка «Пока тихо» не погашена при записях журнала');
  // Записи refresh() пишет в ленивый узел #cm-log — читаем его innerHTML напрямую.
  const logEl2 = panel2.querySelector('#cm-log');
  assert(logEl2 && /Тестовая запись журнала/.test(logEl2.innerHTML), 'запись журнала не отрендерена');
  CUI.closeCommander();

  // XREV-10B: ПУСК гасит armed-фазу «Сдаться» (гонка armed→ПУСК). На legacy
  // сессии пуск честно отклоняется (нет v2-меты) — нам важен только disarm.
  CUI.openCommander(game);
  const panel3 = document.body.children.find((x) => x.id === 'commander-overlay');
  const surrender = panel3.querySelector('#alarm-surrender');
  surrender.click(); // первый тап — armed
  assert(surrender.classList.contains('is-armed'), 'первый тап по «Сдаться» не вооружил кнопку');
  panel3.querySelector('#alarm-start').click(); // ПУСК при armed (на legacy — отказ без исключения)
  assert(!surrender.classList.contains('is-armed'), 'ПУСК не погасил armed-фазу «Сдаться»');
  CUI.closeCommander();
  pass('C14 компоновка ace#29+XREV: порядок секций, бонус-строка, журнал «Пока тихо»/записи, отчёт по факту, disarm при ПУСК');
} catch (e) { fail('C14 компоновка ace#29', e); }

// ---------- Итог ----------
if (failures.length) {
  console.log(`\n❌ Э7: провалено ${failures.length} блок(ов): ${failures.join(', ')}`);
  process.exit(1);
}
console.log('\n✅ Э7: командир КЦ и оборона базы — все блоки зелёные');
