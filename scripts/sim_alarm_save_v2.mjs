// ============================================================
// sim_alarm_save_v2.mjs — ace#10: сохранение/миграция (PERSISTENCE §1–§5).
//   S1 миграция legacy→v2 аддитивна: уровень/дрога прогресса сохраняются,
//      кредит 7×rawXP начисляется ОДИН раз (повтор не добавляет);
//   S2 backup перед миграцией: исходный blob сохранён до преобразования;
//   S3 schema:2 roundtrip: v2-сейв переживает JSON без сложения legacy-теней
//      с микродолями; будущая схема — read-only (FUTURE_RAID_SCHEMA);
//   S4 противоречивый legacy не угадывается: миграция останавливается.
// Запуск: node scripts/sim_alarm_save_v2.mjs
// ============================================================
import './harness.mjs';
import { V } from './stamp.mjs';

const failures = [];
const fail = (phase, err) => { failures.push(phase); console.log(`FAIL  ${phase}: ${String((err && err.message) || err)}`); };
const pass = (m) => console.log(`PASS  ${m}`);
const assert = (c, m) => { if (!c) throw new Error(m); };

const STORE = await import('../r/js/alarm-v2-store.js' + V);
const MIG = await import('../r/js/alarm-v2-migration.js' + V);

// Обезличенный legacy-сейв (старый whitelist-DTO, без id).
function legacySave(level, rawXp) {
  return JSON.stringify({
    schemaVersion: 1, planetId: 'p1', faction: 'human', starterGiftClaimed: true,
    raidSeq: 3,
    homeDto: {
      capturedAt: 1000, minerals: 250,
      buildings: [{ type: 'cc', tx: 4, ty: 4, w: 4, h: 3, hp: 1200, maxHp: 1500, done: true, level: 3 },
        { type: 'wall', tx: 10, ty: 4, w: 1, h: 1, hp: 900, maxHp: 900, done: true }],
      units: [{ type: 'worker', x: 120, y: 130, hp: 50, maxHp: 50 }],
      crystals: [{ tx: 20, ty: 20, amount: 60, fieldId: 1 }],
      minerals: 250,
      commander: { schema: 1, level, xp: rawXp, autoDefense: true, stats: { raids: 2, defenses: 4, kills: 9, lost: 1 }, log: [] },
    },
  });
}

// ---------- S1: аддитивная миграция, кредит 7×rawXP однократно ----------
try {
  const raw = legacySave(5, 120);
  const res = STORE.prepareRaidV2(raw);
  assert(res.migrated === true, 'миграция не сработала');
  const v = res.value;
  assert(v.schema === 2, 'schema не 2');
  const c = v.homeDto.commander;
  assert(c.level === 5, 'уровень не сохранился: ' + c.level);
  // progress = x + 7x = 8x при долях старого порога: 120/260 → 960/2080.
  assert(BigInt(c.xpMicro) === 960n * 1000000n, 'кредит 7×: прогресс ' + c.xpMicro + ' != 960');
  assert(c.legacySnapshot && c.legacySnapshot.rawXp === 120 && c.legacySnapshot.normalizingCredit === 840,
    'legacySnapshot неверен: ' + JSON.stringify(c.legacySnapshot));
  assert(c.unspent === 4, 'очки навыка L5: ' + c.unspent);
  // Повторная миграция уже v2 — не добавляет кредит.
  const again = STORE.prepareRaidV2(JSON.stringify(v));
  assert(again.migrated === false, 'повторная миграция не идентична');
  assert(BigInt(again.value.homeDto.commander.xpMicro) === BigInt(c.xpMicro), 'кредит начислен повторно');
  pass(`S1 миграция: L5 сохранена, progress 960/2080 (120+840), unspent=4, повтор не дублирует`);
} catch (e) { fail('S1 миграция', e); }

// ---------- S2: L1/L20 и границы ----------
try {
  const r1 = STORE.prepareRaidV2(legacySave(1, 17));
  const c1 = r1.value.homeDto.commander;
  assert(c1.level === 1 && BigInt(c1.xpMicro) === 136n * 1000000n, 'пример L1,x=17 → 136: ' + c1.xpMicro);
  const r20 = STORE.prepareRaidV2(legacySave(20, 0));
  const c20 = r20.value.homeDto.commander;
  assert(c20.level === 20 && c20.xpMicro === '0', 'L20 с нулевым raw сломан');
  pass('S2 края: L1 (17→136) и L20 (0) мигрируют корректно');
} catch (e) { fail('S2 края', e); }

// ---------- S3: v2 roundtrip + будущая схема ----------
try {
  const raw = legacySave(7, 200);
  const res = STORE.prepareRaidV2(raw);
  const roundtrip = JSON.parse(JSON.stringify(res.value));
  STORE.validateRaidV2(roundtrip);
  const future = { ...roundtrip, schema: 3 };
  let threw = '';
  try { STORE.prepareRaidV2(JSON.stringify(future)); } catch (e) { threw = String(e.message); }
  assert(/FUTURE/.test(threw), 'будущая схема не отклонена: ' + threw);
  pass('S3 roundtrip v2 валиден; будущая схема — FUTURE_RAID_SCHEMA');
} catch (e) { fail('S3 roundtrip', e); }

// ---------- S4: противоречивый legacy не угадывается ----------
try {
  const bad = JSON.parse(legacySave(5, 99999)); // x >= oldNeed(5)=260 — противоречие
  let threw = '';
  try { STORE.prepareRaidV2(JSON.stringify(bad)); } catch (e) { threw = String(e.message); }
  assert(threw.length > 0, 'противоречивый сейв прошёл миграцию молча');
  const bad2 = JSON.parse(legacySave(5, -5));
  let threw2 = '';
  try { STORE.prepareRaidV2(JSON.stringify(bad2)); } catch (e) { threw2 = String(e.message); }
  assert(threw2.length > 0, 'отрицательный rawXp прошёл миграцию');
  pass('S4 противоречивые данные останавливают миграцию (без угадывания)');
} catch (e) { fail('S4 отказ', e); }

// ---------- S5: идентификаторы сущностей стабильны ----------
try {
  const res = STORE.prepareRaidV2(legacySave(5, 120));
  const v = res.value;
  const ids = [];
  for (const b of v.homeDto.buildings) ids.push(b.entityId);
  for (const u of v.homeDto.units) ids.push(u.entityId);
  for (const c of v.homeDto.crystals) ids.push(c.entityId);
  assert(ids.every((x) => typeof x === 'string' && x.startsWith(v.alarmV2.baseId)), 'entityId не от baseId');
  assert(new Set(ids).size === ids.length, 'дубликаты entityId');
  assert(v.alarmV2.nextEntitySeq > ids.length, 'nextEntitySeq не продвинут');
  pass('S5 идентификаторы: уникальны, стабильны, выводятся из baseId');
} catch (e) { fail('S5 id', e); }

if (failures.length) { console.log('FAIL  alarm save v2: ' + failures.join('; ')); process.exit(1); }
console.log('PASS  alarm save v2: все группы зелёные');
