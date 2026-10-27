// ============================================================
// sim_econ_scale.mjs — issue #43 П-2 (спека п.3): постоянный гейт
// на связку «админка пишет ac_econ_scale ↔ economy.js readScale».
// Класс бага «ползунок не применяется» больше не проходит приёмку молча.
//
// Сценарии (спека issue #43):
//   S1: LS 0.5 → ECON_SCALE 0.5 (сценарий владельца, бывший T2-баг)
//   S2: LS 0.5 + ?econ=0.1 → 0.1 (приоритет URL)
//   S3: чисто → 1 (канон)
//   S4–S6: клампы LS (5→2, 0.001→0.02, мусор→1)
//   S7: невалидный ?econ= → провал к LS (fall-through, канон Э7–E9)
//
// Запуск: node scripts/sim_econ_scale.mjs
// ============================================================
import './harness.mjs';

const KEY = 'ac_econ_scale';
const failures = [];
const check = (name, actual, expected) => {
  if (actual === expected) console.log(`PASS  ${name}: ${actual}`);
  else { failures.push(name); console.log(`FAIL  ${name}: ожидалось ${expected}, получено ${actual}`); }
};
let uniq = 0;
const scaleOf = async () => {
  // каждый вызов — свежий инстанс модуля (ECON_SCALE читается один раз при импорте)
  const m = await import(`../r/js/economy.js?sim=${++uniq}`);
  return m.ECON_SCALE;
};
// в harness нет location — даём изменяемый стенд (readScale читает только .search)
globalThis.location = { search: '' };

// S1: сценарий владельца
globalThis.localStorage.setItem(KEY, '0.5');
check('S1 LS 0.5 → 0.5', await scaleOf(), 0.5);

// S2: приоритет URL
globalThis.location.search = '?econ=0.1';
check('S2 LS 0.5 + ?econ=0.1 → 0.1', await scaleOf(), 0.1);

// S3: канон
globalThis.localStorage.removeItem(KEY);
globalThis.location.search = '';
check('S3 пусто → 1', await scaleOf(), 1);

// S4–S6: клампы LS
globalThis.location.search = '';
globalThis.localStorage.setItem(KEY, '5');
check('S4 LS 5 → кламп 2', await scaleOf(), 2);
globalThis.localStorage.setItem(KEY, '0.001');
check('S5 LS 0.001 → кламп 0.02', await scaleOf(), 0.02);
globalThis.localStorage.setItem(KEY, 'abc');
check('S6 LS мусор → 1', await scaleOf(), 1);

// S7: невалидный ?econ= → провал к LS
globalThis.location.search = '?econ=мусор';
globalThis.localStorage.setItem(KEY, '0.5');
check('S7 ?econ=мусор → LS 0.5', await scaleOf(), 0.5);

if (failures.length) { console.error(`❌ SIM_ECON_SCALE: провалено ${failures.length}`); process.exit(1); }
console.log('✅ SIM_ECON_SCALE: все сценарии зелёные');
