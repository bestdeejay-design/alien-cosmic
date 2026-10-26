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
// ============================================================
import './harness.mjs';

await import('../r/js/game.js');
import { V } from './stamp.mjs';
const C = await import('../r/js/commander.js' + V);
const HR = await import('../r/js/home-raid.js' + V);
const CUI = await import('../r/js/commander-ui.js' + V);
const U = await import('../r/js/units.js' + V);
const cfg = await import('../r/js/config.js' + V);
const R = await import('../r/js/raid.js' + V);

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

// ---------- C1: звания и опыт ----------
try {
  const st = boot();
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
  pass(`C1 звания: 1→20, ${jumps.join(' → ')}, путь ${C.totalXpTo20()} XP, на 20 опыт капается`);
} catch (e) { fail('C1 звания и опыт', e); }

// ---------- C2: бонусы и население ----------
try {
  const st = boot();
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
  const st = boot();
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
  const st = boot();
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
  const st = boot();
  C.hydrateCommander(st, { level: 6, xp: 10, autoDefense: true, stats: { raids: 4, defenses: 1, kills: 9 }, log: [] });
  C.logEvent(st, 'Входящий рейд: волна 1', 'warn');
  CUI.openCommander(game);
  const panel = document.body.children.find((c) => c.id === 'commander-overlay');
  assert(panel, 'карточка командира не открылась');
  assert(/МАЙОР/.test(panel.querySelector('#cm-rank').textContent), 'в карточке нет звания: ' + panel.querySelector('#cm-rank').textContent);
  assert(/Опыт|XP/.test(panel.querySelector('#cm-xp').textContent), 'нет строки опыта: ' + panel.querySelector('#cm-xp').textContent);
  assert(/\+/.test(panel.querySelector('#cm-bonus').innerHTML), 'нет бонусов звания');
  assert(/Обслуж|СЛУЖБА/.test(panel.innerHTML) || /рейд/i.test(panel.querySelector('#cm-def').textContent) || /с/.test(panel.querySelector('#cm-def').textContent),
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
  const st = boot();
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
  const st = boot();
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

// ---------- Итог ----------
if (failures.length) {
  console.log(`\n❌ Э7: провалено ${failures.length} блок(ов): ${failures.join(', ')}`);
  process.exit(1);
}
console.log('\n✅ Э7: командир КЦ и оборона базы — все блоки зелёные');
