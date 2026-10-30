// ============================================================
// sim_alarm_boot_v2.mjs — ace#10 К-4 (ревизия SZ m2): ЖИВОЙ roundtrip
// «save v2 → reload → сессия жива» через настоящий бут-путь промоции.
// Покрывает Ф-4 регрессии, которые library-сим (save_v2) не видит.
//   R1 v2-сейв: boot-промоция → подъём → КЦ/кошелёк/командир/сессия живы;
//   R2 legacy-сейв: бут-путь МИГРИРУЕТ (бэкап оригинала + кредит 7×rawXP
//      однократно), повторная промоция — no-op;
//   R3 будущая схема: отказ FUTURE_RAID_SCHEMA, канонический блоб НЕ тронут;
//   R4 гость-ключ: тот же roundtrip на ac_guest_raid_session_v1 (+бэкап гостя).
// Запуск: node scripts/sim_alarm_boot_v2.mjs
// ============================================================
import './harness.mjs';
import { V } from './stamp.mjs';

const failures = [];
const fail = (phase, err) => { failures.push(phase); console.log(`FAIL  ${phase}: ${String((err && err.message) || err)}`); };
const pass = (msg) => console.log(`PASS  ${msg}`);
const assert = (c, m) => { if (!c) throw new Error(m); };

await import('../r/js/game.js');
const B = await import('../r/js/buildings.js' + V);
const STORE = await import('../r/js/alarm-v2-store.js' + V);

const game = globalThis.game;
assert(game, 'движок полигона не поднялся');
const ticks = (n) => { for (let i = 0; i < n; i++) game.tick(); };
const RAID_KEY = 'ac_raid_session_v1';
const GUEST_KEY = 'ac_guest_raid_session_v1';
const flushLocks = () => new Promise((r) => setImmediate(r)); // релиз lease между промоциями

// Бут-путь (как в raid-boot.js): сейв → promoteStoredRaid → присвоение → подъём.
function bootSave() {
  game.syncRaidHomeSnapshot();
  const raw = JSON.stringify(game.raidSession);
  localStorage.setItem(RAID_KEY, raw);
  return raw;
}
async function bootReload(key = RAID_KEY, backup = STORE.RAID_BACKUP_PROFILE) {
  const promoted = await STORE.promoteStoredRaid(localStorage, key, backup);
  await flushLocks();
  game.raidSession = promoted.value;
  game.started = false;
  game.startRaidHome('human');
  ticks(2);
  return promoted;
}

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

// ---------- R1: v2 roundtrip через бут-путь ----------
try {
  const st = bootHome();
  const session0 = game.raidSession;
  const w0 = session0.alarmV2.walletMicro;
  const baseId0 = session0.alarmV2.baseId;
  const cmd0 = JSON.stringify(session0.homeDto.commander);
  const ccLevel0 = st.buildings.find((b) => b.type === 'cc').level || 1;
  const raw0 = bootSave();
  const promoted = await bootReload();
  assert(promoted.migrated === false, 'живой v2-сейв не должен мигрировать');
  assert(game.state.raidMode === 'home', 'после reload нет домашней базы');
  const cc = game.state.buildings.find((b) => !b.dead && b.side === 'player' && b.type === 'cc');
  assert(cc, 'КЦ не поднялся после reload');
  assert((cc.level || 1) === ccLevel0, 'уровень КЦ не пережил reload');
  assert(game.raidSession.alarmV2.walletMicro === w0, 'кошелёк изменился при reload');
  assert(game.raidSession.alarmV2.baseId === baseId0, 'baseId изменился при reload');
  assert(JSON.stringify(game.raidSession.homeDto.commander) === cmd0, 'командир изменился');
  STORE.validateRaidV2(JSON.parse(localStorage.getItem(RAID_KEY)));
  assert(game.raidSession.alarmV2.incomingTicks !== undefined, 'часы не живут после reload');
  pass(`R1 v2 roundtrip: КЦ-Г${ccLevel0}, кошелёк/командир/baseId/часы живы, блоб валиден`);
} catch (e) { fail('R1 v2 roundtrip', e); }

// ---------- R2: legacy-сейв мигрируется бут-путём ОДИН раз ----------
try {
  const raw = JSON.stringify({
    schemaVersion: 1, planetId: 'p1', faction: 'human', starterGiftClaimed: true, raidSeq: 3,
    homeDto: {
      capturedAt: 1000, minerals: 250,
      buildings: [{ type: 'cc', tx: 4, ty: 4, w: 4, h: 3, hp: 1200, maxHp: 1500, done: true, level: 3 },
        { type: 'wall', tx: 10, ty: 4, w: 1, h: 1, hp: 900, maxHp: 900, done: true }],
      units: [{ type: 'worker', x: 120, y: 130, hp: 50, maxHp: 50 }],
      crystals: [{ tx: 20, ty: 20, amount: 60, fieldId: 1 }],
      commander: { schema: 1, level: 5, xp: 120, autoDefense: true, stats: { raids: 2, defenses: 4, kills: 9, lost: 1 }, log: [] },
    },
  });
  localStorage.setItem(RAID_KEY, raw);
  const promoted = await bootReload();
  assert(promoted.migrated === true, 'legacy-сейв не мигрировал бут-путём');
  assert(localStorage.getItem(STORE.RAID_BACKUP_PROFILE) === raw, 'оригинал не в бэкапе');
  const v = promoted.value;
  assert(v.schema === 2 && v.alarmV2.walletMicro === '250000000', 'миграция кривая: ' + v.alarmV2.walletMicro);
  assert(BigInt(v.homeDto.commander.xpMicro) === 960n * 1000000n, 'кредит 7× не начислен');
  // Повторная промоция того же канона — no-op, кредит не дублируется.
  const again = await STORE.promoteStoredRaid(localStorage, RAID_KEY, STORE.RAID_BACKUP_PROFILE);
  await flushLocks();
  assert(again.migrated === false, 'повторная миграция не идентична');
  assert(again.value.homeDto.commander.xpMicro === v.homeDto.commander.xpMicro, 'кредит задублирован');
  pass('R2 legacy миграция бут-путём: бэкап оригинала, кредит 7× однократно, повтор no-op');
} catch (e) { fail('R2 legacy миграция', e); }

// ---------- R3: будущая схема — отказ, блоб не тронут ----------
try {
  const st = bootHome();
  bootSave();
  const future = JSON.parse(localStorage.getItem(RAID_KEY));
  future.schema = 3;
  const futureRaw = JSON.stringify(future);
  localStorage.setItem(RAID_KEY, futureRaw);
  await flushLocks();
  let code = '';
  try {
    await STORE.promoteStoredRaid(localStorage, RAID_KEY, STORE.RAID_BACKUP_PROFILE);
  } catch (e) { code = e.code || String(e.message); }
  assert(/FUTURE/.test(code), 'будущая схема не отклонена: ' + code);
  assert(localStorage.getItem(RAID_KEY) === futureRaw, 'канонический блоб перезаписан при отказе!');
  await flushLocks(); // релиз lease отказной промоции дотикал — R4 берёт лок чисто
  pass('R3 будущая схема: FUTURE_RAID_SCHEMA, новый формат не перезаписан старым клиентом');
} catch (e) { fail('R3 будущая схема', e); }

// ---------- R4: гость-ключ — тот же бут-roundtrip ----------
try {
  bootHome();
  game.syncRaidHomeSnapshot();
  const raw = JSON.stringify(game.raidSession);
  localStorage.setItem(GUEST_KEY, raw);
  const promoted = await bootReload(GUEST_KEY, STORE.RAID_BACKUP_GUEST);
  assert(promoted.migrated === false, 'гость v2-блоб мигрировал без причины');
  assert(game.state.raidMode === 'home' && game.raidSession.schema === 2,
    'гость-сессия не поднялась');
  STORE.validateRaidV2(JSON.parse(localStorage.getItem(GUEST_KEY)));
  pass('R4 гость-ключ: roundtrip на ac_guest_raid_session_v1 жив, блоб валиден');
} catch (e) { fail('R4 гость-ключ', e); }

if (failures.length) { console.log('FAIL  alarm boot v2: ' + failures.join('; ')); process.exit(1); }
console.log('PASS  alarm boot v2: все группы зелёные');
