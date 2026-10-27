// ============================================================
// sim_boot42.mjs — issue #42 З1 (маркер SAFEMODE-CARD-1026):
// битый restore сессии рейда не должен приводить к тёмному экрану
// («r/ BOOT ERR»), boot всегда приходит в играбельный home.
//
// Сценарии (argv[2]):
//   badjson     — синтаксически битый JSON (catch на JSON.parse);
//   garbage     — валидный JSON с мусорным содержимым (кривые типы) —
//                 раньше проваливался во внешний catch raid-boot;
//   truncated   — усечённая сессия (пустой объект) — hydrate без полей.
// Для каждого: game.started, raidMode==='home', КЦ на базе, не gameOver;
// для garbage битая сессия стирается из localStorage.
//
// Запуск: node scripts/sim_boot42.mjs <scenario>
// ============================================================
import './harness.mjs';

const KEY = 'ac_raid_session_v1';
const scenario = process.argv[2] || 'garbage';

const SEEDS = {
  badjson: '{"homeDto":{"minerals":',
  garbage: '{"homeDto":123,"faction":42,"raidSeq":"x","activeExpedition":{},"pendingReturn":[]}',
  truncated: '{}',
  // SZ #42: единственный сид, реально бросающий исключение в hydrate
  // (iterating числа) — через него проверяется сам safe-mode catch,
  // а не терпимый путь «свежая база без исключения».
  throwing: '{"starterGiftClaimed":true,"homeDto":{"crystals":5,"units":[]},"faction":"human","raidSeq":3}',
};
if (!SEEDS[scenario]) throw new Error('неизвестный сценарий: ' + scenario);
globalThis.localStorage.setItem(KEY, SEEDS[scenario]);
// raid-boot дёргает window.dispatchEvent(new Event('ac-vv-check')) — в harness
// окна нет ни того, ни другого (в браузере есть); шимим только для сима.
if (typeof globalThis.dispatchEvent !== 'function') {
  globalThis.dispatchEvent = () => true;
}
globalThis.Event = globalThis.Event || class Event { constructor(t) { this.type = t; } };

await import('../r/js/game.js');
await import('../r/raid-boot.js');

const game = globalThis.game;
const assert = (c, m) => { if (!c) throw new Error(m); };
assert(game, 'движок не поднялся');
assert(game.started, 'boot не дошёл до старта сессии');
assert(game.state && game.state.raidMode === 'home', 'raidMode !== home');
assert(game.state.buildings.some((b) => !b.dead && b.side === 'player' && b.type === 'cc'), 'КЦ на базе отсутствует');
assert(!game.state.gameOver, 'состояние gameOver после boot');
if (scenario === 'garbage') {
  assert(globalThis.localStorage.getItem(KEY) == null || globalThis.localStorage.getItem(KEY) !== SEEDS[scenario],
    'битая сессия не стёрта из localStorage');
}
console.log(`PASS  B1 safe-mode boot (${scenario}): играемая home-база, без тёмного экрана`);
process.exit(0); // raid-boot держит setInterval(сейв) — без выхода сим не завершается
