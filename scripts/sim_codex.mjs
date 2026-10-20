// ============================================================
// sim_codex.mjs — П8: растущий кодекс, главы Хроники, С1-фильтр.
//
// D1 unlockAfter/???: свежий прогресс — хроника/герои закрыты, завязка открыта.
// D2 открытие по победе: saveProgress(N+1) открывает запись №N.
// D3 после №14 хроника полна (все 15).
// D4 сброс прогресса закрывает записи обратно.
// D5 скирмиш кодекс не трогает (победа прогресс не пишет, открыто всё).
// D6 меню: бонусные главы скрыты до финала, затем — по порядку массива.
// D7 финал: campaignDone только №14; победа пишет индекс, а не id.
// C1 честные «Новинки»: фильтр меню (данные + реальные команды).
//
// Запуск: node scripts/sim_codex.mjs
// ============================================================
import './harness.mjs';

const failures = [];
function fail(phase, err) {
  failures.push(phase);
  console.log(`FAIL  ${phase}: ${String((err && err.message) || err)}`);
}
function pass(msg) { console.log(`PASS  ${msg}`); }
function assert(c, msg) { if (!c) throw new Error(msg); }

await import('../js/game.js');
const M = await import('../js/missions.js');
const L = await import('../js/lore.js');
const ui = await import('../js/ui.js');
const game = globalThis.game;
if (!game) { console.log('FAIL  boot: window.game не создан'); process.exit(1); }

const byId = (id) => L.CODEX.find((e) => e.id === id);
const lockedCount = (html) => (html.match(/\?\?\?/g) || []).length;
function ticks(n) { for (let i = 0; i < n; i++) game.tick(); }

// ---------- D1: свежий прогресс ----------
try {
  M.resetProgress();
  assert(M.loadProgress() === 0, 'прогресс не 0');
  const war = L.codexEntryHTML(byId('war'), 0);
  assert(lockedCount(war) === 15, 'хроника не вся закрыта: ' + lockedCount(war));
  assert(!/Дельта-2 замолчала/.test(war), 'заголовок хроники виден до победы');
  const heroes = L.codexEntryHTML(byId('heroes'), 0);
  assert(lockedCount(heroes) === 11, 'герои не все закрыты');
  const ars = L.codexEntryHTML(byId('arsenal'), 0);
  assert(/Дрон-техник/.test(ars) && /Собиратель/.test(ars), 'рабочие скрыты');
  assert(!/Рейнджер/.test(ars), 'рейнджер виден до победы №0');
  assert(/Мир|Рубеж-64/.test(L.codexEntryHTML(byId('world'), 0)), 'завязка закрыта');
  assert(/\?\?\?/.test(L.codexEntryHTML(byId('kharid'), 0)), 'рой открыт раньше №1');
  assert(/\?\?\?/.test(L.codexEntryHTML(byId('flag'), 0)), 'мятеж открыт раньше акта II');
  assert(!/\?\?\?/.test(L.codexEntryHTML(byId('planets'), 0)), 'планеты закрыты');
  pass('D1 unlockAfter: 15+11 ???, завязка и рабочие открыты');
} catch (e) { fail('D1 locked-fresh', e); }

// ---------- D2: открытие по победе ----------
try {
  M.resetProgress();
  M.saveProgress(1); // победа в №0
  assert(M.loadProgress() === 1, 'прогресс не 1');
  const war = L.codexEntryHTML(byId('war'), 1);
  assert(/Дельта-2 замолчала/.test(war), 'запись №0 не открылась');
  assert(/дюны пели/.test(war), 'нет эпилога §3 в теле');
  assert(/молчания одной шахты/.test(war), 'нет строки контекста');
  assert(lockedCount(war) === 14, 'открылось не 1: ' + lockedCount(war));
  assert(/дюны живые/.test(L.codexEntryHTML(byId('heroes'), 1)), 'герой №0 закрыт');
  assert(/Рейнджер/.test(L.codexEntryHTML(byId('arsenal'), 1)), 'рейнджер закрыт после №0');
  assert(!/Мортира/.test(L.codexEntryHTML(byId('arsenal'), 1)), 'мортира открылась раньше №7');
  assert(/\?\?\?/.test(L.codexEntryHTML(byId('kharid'), 1)), 'рой открыт раньше победы №1');
  M.saveProgress(2); // победа в №1
  assert(!/\?\?\?/.test(L.codexEntryHTML(byId('kharid'), 2)), 'рой закрыт после №1');
  pass('D2 победа №0: хроника-0 + герой + рейнджер открыты, остальное ???');
} catch (e) { fail('D2 open-on-win', e); }

// ---------- D3: после №14 хроника полна ----------
try {
  M.resetProgress();
  M.saveProgress(15); // победа в №14
  const war = L.codexEntryHTML(byId('war'), 15);
  assert(lockedCount(war) === 0, 'хроника неполна: ??? ' + lockedCount(war));
  assert(/Рубеж замкнут/.test(war) && /Дельта-2 замолчала/.test(war), 'краёв хроники нет');
  assert(lockedCount(L.codexEntryHTML(byId('heroes'), 15)) === 0, 'герои неполны');
  assert(lockedCount(L.codexEntryHTML(byId('arsenal'), 15)) === 0, 'арсенал неполон');
  assert(!/\?\?\?/.test(L.codexEntryHTML(byId('flag'), 15)), 'мятеж закрыт после кампании');
  pass('D3 финал: хроника 15/15, герои и арсенал полны');
} catch (e) { fail('D3 full-after-14', e); }

// ---------- D4: сброс закрывает обратно ----------
try {
  M.saveProgress(15);
  M.resetProgress();
  assert(M.loadProgress() === 0, 'прогресс не сброшен');
  assert(lockedCount(L.codexEntryHTML(byId('war'), 0)) === 15, 'хроника не закрылась');
  assert(lockedCount(L.codexEntryHTML(byId('heroes'), 0)) === 11, 'герои не закрылись');
  pass('D4 сброс: записи снова ???');
} catch (e) { fail('D4 reset-closes', e); }

// ---------- D5: скирмиш кодекс не трогает ----------
try {
  M.resetProgress();
  game.startSkirmish('human');
  ticks(5);
  assert(game.mission.id === -1, 'у скирмиша не -1');
  game.win('тестовая победа');
  ticks(3);
  assert(game.state.gameOver === 'win', 'победа не засчитана');
  assert(M.loadProgress() === 0, 'скирмиш записал прогресс');
  assert(M.isUnlocked(game.mission, 'lab') && M.isUnlocked(game.mission, 'arty'), 'в скирмише не всё открыто');
  pass('D5 скирмиш: победа прогресс не пишет, меню полное');
} catch (e) { fail('D5 skirmish-guard', e); }

// ---------- D6: главы Хроники в меню ----------
try {
  const kids = () => document.getElementById('mission-list').children;
  const cards = () => kids().filter((c) => c.tag === 'button');
  M.resetProgress();
  ui.showMissions(game);
  assert(cards().length === 15, 'до финала карточек не 15: ' + cards().length);
  assert(!cards().some((c) => /Глава/.test(c.innerHTML)), 'главы видны до финала');
  M.saveProgress(15); // победа в №14
  ui.showMissions(game);
  const all = cards();
  assert(all.length === 19, 'после финала карточек не 19: ' + all.length);
  assert(kids().some((c) => c.tag === 'div' && c.textContent === 'Главы Хроники'), 'секции нет');
  const ch1 = all.find((c) => /Глава 1/.test(c.innerHTML));
  assert(ch1 && !ch1.disabled, 'глава 1 закрыта после №14');
  assert(/Ржавый караван/.test(ch1.innerHTML), 'не та глава 1');
  const ch2 = all.find((c) => /Глава 2/.test(c.innerHTML));
  assert(ch2 && ch2.disabled, 'глава 2 открыта раньше победы в №16');
  M.saveProgress(16); // победа в №16
  ui.showMissions(game);
  const ch2b = cards().find((c) => /Глава 2/.test(c.innerHTML));
  assert(ch2b && !ch2b.disabled, 'глава 2 закрыта после №16');
  pass('D6 главы: скрыты до №14, затем по порядку (1 открыта, 2 — после №16)');
} catch (e) { fail('D6 bonus-menu', e); }

// ---------- D7: финал и шкала прогресса ----------
try {
  M.resetProgress();
  game.startMission(M.MISSIONS[14]);
  const o14 = game.endOpts(true, 'тест');
  assert(o14.campaignDone === true, '№14 не закрывает кампанию');
  assert(o14.next && o14.next.id === 16, 'после №14 не №16');
  game.startMission(M.MISSIONS[18]);
  const o19 = game.endOpts(true, 'тест');
  assert(!o19.campaignDone, '№19 закрывает кампанию');
  assert(!o19.next, 'после №19 есть следующая');
  game.startMission(M.MISSIONS[15]);
  ticks(3);
  game.win('тест');
  assert(M.loadProgress() === 16, 'победа №16 пишет не индекс: ' + M.loadProgress());
  pass('D7 campaignDone только №14; победа №16 → прогресс 16');
} catch (e) { fail('D7 finale-scale', e); }

// ---------- C1: честные «Новинки» ----------
try {
  const t = M.isUnlocked;
  const m0 = M.MISSIONS[0], m1 = M.MISSIONS[1], m3 = M.MISSIONS[3];
  assert(!t(m1, 'factory') && t(m3, 'factory'), 'фабрика: не №2');
  assert(!t(m0, 'turret') && t(m1, 'turret') && t(m1, 'wall') && t(m1, 'bunker'), 'турели/стены/бункеры: не №1');
  assert(t(m0, 'marine') && t(m0, 'barracks'), '№0 без рейнджера/казармы');
  assert(!t(m3, 'flamer') && t(M.MISSIONS[6], 'flamer'), 'плазмер: не №6');
  assert(!t(M.MISSIONS[6], 'arty') && t(M.MISSIONS[7], 'arty'), 'мортира: не №7');
  assert(!t(M.MISSIONS[7], 'medic') && t(M.MISSIONS[8], 'medic'), 'нанит: не №8');
  assert(!t(M.MISSIONS[10], 'lab') && t(M.MISSIONS[11], 'lab'), 'лаборатория: не №11');
  assert(!t(M.MISSIONS[17], 'barracks') && !t(M.MISSIONS[17], 'factory') && !t(M.MISSIONS[17], 'lab'), 'ban №18 не держит (лаба добавлена, hotfix K)');
  assert(t(M.MISSIONS[15], 'barracks'), 'ban бьёт мимо');
  M.saveProgress(15);
  assert(!t(m1, 'factory'), 'переигровка №1 открыла фабрику');
  M.resetProgress();
  // Реальное меню стройки: №1 без завода, №3 с заводом, скирмиш полный.
  const buildCodes = () => {
    const st = game.state;
    st.selection = [st.units.find((u) => u.side === 'player' && u.cfg && u.cfg.canBuild)];
    st.buildMenu = true;
    return game.getCommands().map((c) => c.code);
  };
  game.startMission(m1); ticks(3);
  const c1 = buildCodes();
  assert(!c1.includes('KeyU') && c1.includes('KeyR'), 'меню №1: ' + c1.join(','));
  game.startMission(m3); ticks(3);
  assert(buildCodes().includes('KeyU'), 'в меню №3 завода нет');
  game.startSkirmish('alien'); ticks(3);
  const cs = buildCodes();
  assert(cs.includes('KeyU') && cs.includes('KeyI'), 'скирмиш урезан: ' + cs.join(','));
  pass('C1 UNLOCK_AT: пороги по интро, ban №18, переигровка честна, меню №1/№3/скирмиш');
} catch (e) { fail('C1 unlock-filter', e); }

console.log(failures.length ? `\nИТОГ SIM_CODEX: ${failures.length} ОШИБОК (${failures.join(', ')})` : '\nИТОГ SIM_CODEX: ВСЕ СЦЕНАРИИ ПРОШЛИ');
process.exit(failures.length ? 1 : 0);
