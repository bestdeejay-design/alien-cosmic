// ============================================================
// sim_chests_ui.mjs — Э6: headless-прогон UI капсул и панели админа.
//
// Браузера в песочнице нет, поэтому проверяем не «красоту», а логику:
//   • оверлей капсул строится, карточек столько же, сколько в конфиге;
//   • клик по готовой карточке вскрывает капсулу и начисляет награду;
//   • «Забрать и продолжить» возвращает список (капсула помечена «забрана»);
//   • панель админа: PIN, четыре вкладки, конструктор капсул (создание/сброс);
//   • ручной подарок и публикация конфига не падают без сети.
//
// Запуск: node scripts/sim_chests_ui.mjs
// ============================================================
import './harness.mjs';

await import('../r/js/game.js');
const V = '?v=10262510'; // тот же стемп, что внутри движка — иначе двойные модули
const CUI = await import('../r/js/chests-ui.js' + V);
const C = await import('../r/js/chests.js' + V);
const A = await import('../r/js/admin.js' + V);

const failures = [];
const fail = (phase, err) => { failures.push(phase); console.log(`FAIL  ${phase}: ${String((err && err.message) || err)}`); };
const pass = (m) => console.log(`PASS  ${m}`);
const assert = (c, m) => { if (!c) throw new Error(m); };

const game = globalThis.game;
assert(game, 'движок полигона не поднялся');

// Детерминизм: награды выдаются по весам через Math.random.
let seed = 7;
Math.random = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };

const byId = (id) => (document.body.children || []).find((c) => c.id === id);

// ---------- U1: оверлей и вскрытие ----------
try {
  game.startRaidHome('human', { forceNew: true });
  for (let i = 0; i < 3; i++) game.tick();
  for (const k of ['ac_chest_cfg_v1', 'ac_chest_state_v1', 'ac_birthday_v1']) localStorage.removeItem(k);
  const st = game.state;
  st.minerals.player = 0;

  CUI.showChests(game);
  const ov = byId('chest-overlay');
  assert(ov, 'оверлей капсул не создан');
  assert(!ov.classList.contains('hidden'), 'оверлей капсул остался скрытым');
  assert(game.paused === true, 'игра не встала на паузу при открытии капсул');

  const grid = ov.querySelector('#chest-grid');
  const cfg = C.loadConfig();
  assert(grid.children.length === cfg.chests.length,
    `карточек ${grid.children.length}, а капсул ${cfg.chests.length}`);

  const ready = grid.children.find((c) => /is-ready/.test(c.className || ''));
  assert(ready, 'нет ни одной готовой карточки (ежедневная должна быть доступна)');
  const erg0 = st.minerals.player;
  const units0 = st.units.filter((u) => !u.dead && u.side === 'player').length;
  const boost0 = st.boost ? 1 : 0;
  ready.click();
  const changed = st.minerals.player !== erg0
    || st.units.filter((u) => !u.dead && u.side === 'player').length !== units0
    || (st.boost ? 1 : 0) !== boost0;
  assert(changed, 'вскрытие карточки не выдало награду');

  const box = ov.querySelector('#chest-open');
  assert(/chest-reward/.test(box.innerHTML), 'экран награды не показан');
  box.querySelector('#chest-more').click();
  assert(/hidden/.test(box.className || ''), 'экран награды не закрылся');
  assert(/chest-card/.test(ov.querySelector('#chest-grid').innerHTML) || ov.querySelector('#chest-grid').children.length > 0,
    'список капсул не вернулся после награды');

  // Повторное вскрытие той же капсулы в тот же день запрещено.
  const list = C.availableChests(game, C.buildContext(game, {}));
  const daily = list.find((x) => x.chest.id === 'daily');
  assert(daily && daily.claimed, 'ежедневная капсула не помечена как забранная');

  // Закрытая по условию карточка не вскрывается, а объясняет причину.
  const all = C.availableChests(game, C.buildContext(game, {}));
  const idx = all.findIndex((x) => !x.eligible);
  if (idx >= 0) {
    assert(all[idx].why, 'закрытая капсула не объясняет, чего не хватает');
    const card = ov.querySelector('#chest-grid').children[idx];
    assert(card && /is-locked/.test(card.className), 'закрытая капсула не выглядит закрытой');
    const before = game.state.minerals.player;
    card.click();
    assert(game.state.minerals.player === before, 'закрытая карточка всё-таки выдала награду');
    assert(/blocked-feedback/.test(card.className), 'закрытая карточка не дала отклик');
  }
  pass(`U1 капсулы: оверлей, ${cfg.chests.length} карточек, вскрытие с наградой, «забрана» не вскрывается повторно`);
} catch (e) { fail('U1 капсулы: оверлей', e); }

// ---------- U2: автопоказ на входе ----------
try {
  sessionStorage.clear();
  localStorage.removeItem('ac_chest_state_v1');
  // Свежая сессия: карточки должны появиться сами (без кнопок в топбаре).
  CUI.maybeShowOnEntry(game);
  await new Promise((r) => setTimeout(r, 1100));
  const ov = byId('chest-overlay');
  assert(ov && !ov.classList.contains('hidden'), 'карточки не показались автоматически при входе');
  // Регистрация команды КЦ «Капсулы» — глобальная ручка без новых кнопок.
  CUI.registerChestCommand(game);
  assert(typeof window.showChestPanel === 'function', 'команда КЦ «Капсулы» не зарегистрирована');
  ov.classList.add('hidden');
  window.showChestPanel();
  assert(!ov.classList.contains('hidden'), 'команда КЦ «Капсулы» не открыла список');
  ov.classList.add('hidden');
  pass('U2 вход: карточки появляются сами, команда КЦ «Капсулы» открывает список повторно');
} catch (e) { fail('U2 вход', e); }

// ---------- U3: панель админа ----------
try {
  A.openAdmin(game);
  const adm = byId('admin-overlay');
  assert(adm, 'панель админа не создана');
  assert(!adm.querySelector('#adm-gate').classList.contains('hidden'), 'вход по PIN не запрошен');

  // Неверный PIN — доступа нет.
  adm.querySelector('#adm-pin').value = '0000';
  adm.querySelector('#adm-login').click();
  assert(!adm.querySelector('#adm-gate').classList.contains('hidden'), 'пустило с неверным PIN');

  adm.querySelector('#adm-pin').value = A.adminPin();
  adm.querySelector('#adm-login').click();
  assert(adm.querySelector('#adm-gate').classList.contains('hidden'), 'верный PIN не пустил');

  const tabs = {};
  for (const t of adm.querySelectorAll('.adm-tab')) tabs[t.dataset.tab] = t;
  assert(Object.keys(tabs).length === 4, 'вкладок не 4: ' + Object.keys(tabs).join(','));
  const marker = { econ: 'adm-econ', chests: 'adm-add', players: 'adm-top', diag: 'adm-reset-claims' };
  for (const [name, tab] of Object.entries(tabs)) {
    tab.click();
    const body = adm.querySelector('#adm-body');
    assert(body._html.includes(marker[name]), `вкладка «${name}» пустая`);
  }
  pass('U3 админ: PIN (неверный/верный), 4 вкладки с содержимым');
} catch (e) { fail('U3 админ: вход и вкладки', e); }

// ---------- U4: конструктор капсул ----------
try {
  const adm = byId('admin-overlay');
  const tabs = {};
  for (const t of adm.querySelectorAll('.adm-tab')) tabs[t.dataset.tab] = t;
  tabs.chests.click();
  let body = adm.querySelector('#adm-body');
  const before = C.loadConfig().chests.length;
  body.querySelector('#adm-add').click();
  const list = body.querySelector('#adm-list');
  const nameEl = list.querySelector('#ce-name');
  assert(nameEl && nameEl.value === 'Новая капсула', 'редактор новой капсулы не открылся');
  list.querySelector('#ce-name').value = 'Тестовая капсула';
  list.querySelector('#ce-cond').value = 'raids';
  list.querySelector('#ce-params').value = '{"n":3}';
  list.querySelector('#ce-save').click();
  const after = C.loadConfig().chests;
  assert(after.length === before + 1, `капсула не добавилась: было ${before}, стало ${after.length}`);
  const added = after[after.length - 1];
  assert(added.name === 'Тестовая капсула' && added.condition.type === 'raids' && added.condition.params.n === 3,
    'параметры капсулы сохранились неверно: ' + JSON.stringify(added.condition));

  // Битый JSON не ломает сохранение — показывается ошибка.
  body.querySelector('#adm-add').click();
  list.querySelector('#ce-params').value = '{сломано';
  list.querySelector('#ce-save').click();
  assert(C.loadConfig().chests.length === before + 1, 'битый JSON всё же сохранился');

  // Заводской набор возвращает ровно дефолт.
  body.querySelector('#adm-reset').click();
  assert(C.loadConfig().chests.length === C.defaultConfig().chests.length, 'сброс к заводскому набору не сработал');
  pass(`U4 конструктор: создание капсулы (${before}→${before + 1}), проверка JSON, сброс к ${C.defaultConfig().chests.length} заводским`);
} catch (e) { fail('U4 конструктор капсул', e); }

// ---------- U5: сеть без сервера не роняет панель ----------
try {
  const adm = byId('admin-overlay');
  const tabs = {};
  for (const t of adm.querySelectorAll('.adm-tab')) tabs[t.dataset.tab] = t;
  tabs.players.click();
  let body = adm.querySelector('#adm-body');
  body.querySelector('#adm-g-nick').value = 'Тестер';
  body.querySelector('#adm-grant').click();
  await new Promise((r) => setTimeout(r, 60));
  const msgEl = adm.querySelector('#adm-msg');
  assert(msgEl && msgEl.textContent, 'ручная выдача не сообщила результат');
  const text = msgEl.textContent;
  tabs.diag.click();
  body = adm.querySelector('#adm-body');
  assert(body._html.includes('Капсул в конфиге'), 'диагностика не показывает состояние');
  pass(`U5 сеть: без сервера выдача отвечает «${text}», диагностика на месте`);
} catch (e) { fail('U5 сеть', e); }

// ---------- Итог ----------
if (failures.length) {
  console.log(`\n❌ Э6 UI: провалено ${failures.length} блок(ов): ${failures.join(', ')}`);
  process.exit(1);
}
console.log('\n✅ Э6 UI: капсулы и панель админа — все блоки зелёные');
