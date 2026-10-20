// ============================================================
// sim_p1.mjs — приёмочные проверки UX-пакета K (P1).
// Карточка процесса, возвраты, честные причины disabled, доступность,
// четыре положения/скрытие панели, длинный EN и reduced-motion.
// Запуск: node scripts/sim_p1.mjs; также вложенно из check.mjs.
// ============================================================
import './harness.mjs';
import { readFileSync } from 'node:fs';
import { el } from './harness.mjs';

const failures = [];
function fail(phase, err) {
  failures.push(phase);
  console.log(`FAIL  ${phase}: ${String((err && err.message) || err)}`);
}
function pass(msg) { console.log(`PASS  ${msg}`); }
function assert(condition, msg) { if (!condition) throw new Error(msg); }

await import('../js/game.js');
const ui = await import('../js/ui.js');
const cfg = await import('../js/config.js');
const M = await import('../js/missions.js');
const B = await import('../js/buildings.js');
const I = await import('../js/i18n.js');
const game = globalThis.game;
if (!game) { console.log('FAIL  boot: window.game не создан'); process.exit(1); }

function start(faction = 'human') {
  game.startMission({
    ...M.SKIRMISH,
    id: -1,
    faction,
    map: { seed: 424242, biome: 'mars', lakes: 'default', rocks: 6, rich: 1.0, base: { x: 8, y: 48 } },
  });
  for (let i = 0; i < 3; i++) game.tick();
  const st = game.state;
  st.fog.explored.fill(1);
  st.minerals.player = 99999;
  ui.setPanelPos('bottom');
  ui.setPanelHidden(false);
  return st;
}
function placeDone(st, type, cx = 22, cy = 45) {
  const spec = cfg.BUILDINGS[type];
  for (let radius = 0; radius < 18; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        if (!B.canPlace(st.map, cx + dx, cy + dy, spec.w, spec.h)) continue;
        const building = B.placeBuildingCmd(st, 'player', type, cx + dx, cy + dy, []);
        if (!building) continue;
        building.done = true;
        building.hp = building.maxHp;
        return building;
      }
    }
  }
  throw new Error('no open site for ' + type);
}
function select(building) {
  game.state.selection = [building];
  ui.resetPanel();
  ui.update(game);
}
function findClass(root, className) {
  let found = null;
  const walk = (node) => {
    if (!node || found) return;
    if (String(node.className || '').split(/\s+/).includes(className)) { found = node; return; }
    for (const child of node.children || []) walk(child);
  };
  walk(root);
  return found;
}
function findAllClass(root, className) {
  const found = [];
  const walk = (node) => {
    if (!node) return;
    if (String(node.className || '').split(/\s+/).includes(className)) found.push(node);
    for (const child of node.children || []) walk(child);
  };
  walk(root);
  return found;
}
function findById(root, id) {
  if (!root) return null;
  if (root.id === id) return root;
  for (const child of root.children || []) {
    const found = findById(child, id);
    if (found) return found;
  }
  return null;
}
function textOf(root) {
  const parts = [];
  const walk = (node) => {
    if (!node) return;
    if (node.textContent) parts.push(node.textContent);
    for (const child of node.children || []) walk(child);
  };
  walk(root);
  return parts.join(' ');
}
function command(code) {
  return el('cmd-grid').children.find((button) => button.dataset.code === code) || null;
}
function processCard() { return findClass(el('sel-info'), 'process-card'); }
function paint() { game.render(1); ui.update(game); ui.drawMinimap(game); }
function event(target, type, fields = {}) {
  for (const handler of target._handlers[type] || []) handler({ type, target, ...fields });
}

// ---------- P1.1: стройка как живой процесс, ETA только при наличии данных ----------
try {
  const st = start();
  const building = placeDone(st, 'depot');
  building.done = false;
  building.progress = 0.42;
  building.hp = building.maxHp * 0.6;
  select(building);

  let card = processCard();
  assert(card && card.dataset.kind === 'construction', 'недострой не показан как construction');
  let fill = findClass(card, 'process-fill');
  assert(fill && fill.style.width === '42%', 'стройка не отражает 42%: ' + (fill && fill.style.width));
  assert(findClass(card, 'process-eta').textContent === '', 'для стройки выдуман ETA');
  assert(textOf(card).includes('42%'), 'в карточке нет числового этапа стройки');

  building.progress = 0.6;
  ui.update(game);
  card = processCard();
  assert(findClass(card, 'process-fill').style.width === '60%', 'стройка не обновилась до 60% без пересборки');
  assert(textOf(el('sel-info')).includes('60%'), 'живой статус стройки не обновился');

  building.done = true;
  building.progress = 1;
  building.hp = building.maxHp;
  ui.update(game);
  card = processCard();
  assert(card.dataset.kind === 'idle', 'после стройки не показано спокойное состояние');
  assert(card.classList.contains('ready-pulse'), 'завершение не дало одиночный сигнал готовности');
  assert(findClass(card, 'process-track').style.display === 'none', 'idle-здание получило ложную полосу прогресса');
  await new Promise((resolve) => setTimeout(resolve, 320));
  assert(!card.classList.contains('ready-pulse'), 'сигнал готовности не завершился через 300 мс');
  paint();
  pass('P1.1 строительство: процент живой, ETA отсутствует, завершение → idle + один пульс 300мс');
} catch (e) { fail('P1.1 construction', e); }

// ---------- P1.2: грейд и производство одновременно, ETA и возврат до отмены ----------
try {
  const st = start();
  const barracks = placeDone(st, 'barracks');
  const beforeGrade = st.minerals.player;
  assert(B.startGrade(st, barracks) === 'ok', 'не удалось начать тестовый грейд');
  barracks.gradeUp.t = 15;
  barracks.queue = [
    { type: 'marine', t: 6.5, total: 13 },
    { type: 'medic', t: 13, total: 13 },
  ];
  select(barracks);

  let card = processCard();
  assert(card.dataset.kind === 'grade', 'грейд не стал главным процессом карточки');
  assert(textOf(card).includes('II'), 'карточка не показывает целевой грейд');
  assert(findClass(card, 'process-fill').style.width === '50%', 'прогресс грейда неверен');
  assert(/15/.test(findClass(card, 'process-eta').textContent), 'ETA грейда не показан');
  const firstChip = findAllClass(el('sel-info'), 'chip')[0];
  assert(firstChip && findClass(firstChip, 'chip-progress'), 'параллельная очередь не показывает прогресс');
  assert(textOf(firstChip).includes('50'), 'сумма возврата из очереди не видна до отмены');
  assert(firstChip.getAttribute('aria-label').includes('50'), 'возврат очереди не объявлен доступным именем');

  const cancelGrade = command('KeyX');
  assert(cancelGrade, 'нет команды отмены грейда');
  assert(findClass(cancelGrade, 'cmd-refund').textContent.includes('90'), 'возврат грейда не показан на кнопке');
  cancelGrade.focus();
  let tip = findById(document.body, 'cmd-tip');
  assert(tip && tip.getAttribute('role') === 'tooltip', 'тултип отмены не связан с ролью tooltip');
  assert(textOf(tip).includes('90'), 'тултип отмены не показывает возвращаемую цену');
  const gradeBalance = st.minerals.player;
  cancelGrade.click();
  assert(!barracks.gradeUp, 'клик отмены не остановил грейд');
  assert(st.minerals.player === gradeBalance + 90, 'отмена грейда вернула не его цену');

  ui.update(game);
  card = processCard();
  assert(card.dataset.kind === 'production', 'после отмены грейда очередь не стала основной');
  assert(findClass(card, 'process-fill').style.width === '50%', 'производство не показывает живой процент');
  assert(/7/.test(findClass(card, 'process-eta').textContent), 'ETA производства не показывает округлённое время');
  assert(textOf(el('sel-info')).includes('2/5'), 'вместимость/размер очереди не показан');

  const queueChip = findAllClass(el('sel-info'), 'chip')[0];
  const refundTextBeforeAction = textOf(queueChip);
  assert(refundTextBeforeAction.includes('50'), 'до отмены очереди не видна цена возврата');
  const queueBalance = st.minerals.player;
  queueChip.focus();
  tip = findById(document.body, 'cmd-tip');
  assert(textOf(tip).includes('50'), 'фокус очереди не открывает подсказку с возвратом');
  queueChip.click();
  assert(barracks.queue.length === 1, 'отмена не удалила только выбранный пункт очереди');
  assert(st.minerals.player === queueBalance + 50, 'отмена производства вернула неправильную цену');
  ui.update(game);
  assert(!processCard().classList.contains('ready-pulse'), 'ручная отмена выдала ложный сигнал готовности');
  paint();
  pass('P1.2 грейд + очередь: оба прогресса видны, ETA верен, возврат показан до отмены');
} catch (e) { fail('P1.2 grade/production/refund', e); }

// ---------- P1.3: исследование, прогресс/ETA, отмена с возвратом ----------
try {
  const st = start();
  const lab = placeDone(st, 'lab');
  lab.res = { key: 'infAtk', lvl: 1, t: 20, total: 40 };
  select(lab);
  let card = processCard();
  assert(card.dataset.kind === 'research', 'лаборатория не показывает исследование');
  assert(findClass(card, 'process-fill').style.width === '50%', 'прогресс исследования неверен');
  assert(/20/.test(findClass(card, 'process-eta').textContent), 'ETA исследования не показан');

  lab.res.t = 9.2;
  ui.update(game);
  card = processCard();
  assert(findClass(card, 'process-fill').style.width === '77%', 'прогресс исследования не обновился');
  assert(/10/.test(findClass(card, 'process-eta').textContent), 'ETA исследования не округлён вверх');
  const cancel = command('KeyX');
  assert(findClass(cancel, 'cmd-refund').textContent.includes('100'), 'на отмене ресерча нет возврата 100');
  const balance = st.minerals.player;
  cancel.click();
  assert(!lab.res, 'исследование не остановлено');
  assert(st.minerals.player === balance + 100, 'отмена исследования вернула неправильную цену');
  ui.update(game);
  card = processCard();
  assert(card.dataset.kind === 'idle' && findClass(card, 'process-track').style.display === 'none', 'после отмены остался фиктивный процесс');
  assert(!card.classList.contains('ready-pulse'), 'отмена исследования ошибочно показана как готовность');
  pass('P1.3 исследование: прогресс/ETA живые; отмена показывает и возвращает 100');
} catch (e) { fail('P1.3 research', e); }

// ---------- P1.4: idle, гарнизон, попадание под огонь ----------
try {
  const st = start();
  const turret = placeDone(st, 'turret');
  select(turret);
  let card = processCard();
  assert(card.dataset.kind === 'post', 'пустая турель показана как активный процесс');
  assert(findClass(card, 'process-track').style.display === 'none', 'у турели на посту есть ложный ETA/прогресс');
  assert(textOf(el('sel-info')).includes('На позиции'), 'idle-статус турели не читается');

  turret.flashT = 1;
  ui.update(game);
  card = processCard();
  assert(textOf(el('sel-info')).includes('Под огнём'), 'попадание не отражено в статусе здания');
  assert(card.dataset.kind === 'post' && findClass(card, 'process-track').style.display === 'none', 'под огнём турели выдуман процесс');

  const bunker = placeDone(st, 'bunker', 30, 45);
  bunker.garrison = [];
  select(bunker);
  card = processCard();
  assert(card.dataset.kind === 'garrison', 'покой бункера не представлен гарнизоном');
  assert(textOf(card).includes('0/4'), 'пустой гарнизон не показывает вместимость');
  assert(findClass(card, 'process-track').style.display === 'none', 'гарнизон получил ложный прогресс');
  bunker.garrison.push({ id: 'test-garrison' });
  bunker.flashT = 1;
  ui.update(game);
  assert(textOf(processCard()).includes('1/4'), 'численность гарнизона не обновляется динамически');
  assert(textOf(el('sel-info')).includes('Под огнём'), 'состояние гарнизона под огнём не читается');
  assert(findClass(processCard(), 'process-track').style.display === 'none', 'у гарнизона под огнём есть ложный процесс');
  pass('P1.4 idle/пост/гарнизон/под огнём: текст живой, фиктивного прогресса нет');
} catch (e) { fail('P1.4 idle/garrison/fire', e); }

// ---------- P1.5: дефицит, закрытый тир и очередь полна — RU и EN, фокус/тап ----------
try {
  const st = start();
  const barracks = placeDone(st, 'barracks');
  barracks.queue = [];
  st.minerals.player = 20;
  select(barracks);
  let train = command('KeyQ');
  assert(train && train.getAttribute('aria-disabled') === 'true', 'команда найма не отключилась при нехватке ресурсов');
  assert(train.getAttribute('aria-label').includes('30'), 'не показана точная недостающая сумма');
  assert(train.getAttribute('aria-describedby') === 'cmd-tip', 'кнопка не связана с доступной подсказкой');
  train.focus();
  let tip = findById(document.body, 'cmd-tip');
  assert(tip && tip.classList.contains('show') && textOf(tip).includes('30'), 'фокус не открыл причину с суммой');
  assert(train.classList.contains('disabled'), 'визуальное состояние не совпало с aria-disabled');
  train.click();
  assert(barracks.queue.length === 0, 'заблокированная команда всё же поставила юнита в очередь');
  assert(train.classList.contains('blocked-feedback'), 'тап по недоступной команде не дал короткий feedback');

  await I.setLocale('en', { persist: false });
  ui.refreshLocale();
  ui.update(game);
  train = command('KeyQ');
  assert(train.getAttribute('aria-disabled') === 'true', 'EN: нехватка не отключила команду');
  assert(train.getAttribute('aria-label').includes('Helios short by 30 erg'), 'EN: нет творчески адаптированной причины/суммы');
  train.focus();
  tip = findById(document.body, 'cmd-tip');
  assert(textOf(tip).includes('Helios short by 30 erg'), 'EN: фокус не открывает причину');

  await I.setLocale('ru', { persist: false });
  ui.refreshLocale();
  ui.update(game);
  st.minerals.player = 99999;
  const lab = placeDone(st, 'lab', 30, 30);
  st.tech.player.autoRepair = 0;
  select(lab);
  let locked = command('KeyT');
  assert(locked && locked.getAttribute('aria-disabled') === 'true', 'запертое исследование активировалось');
  assert(locked.getAttribute('aria-label').includes('Требуется КЦ грейда II'), 'RU: причина закрытого условия не локализована');
  locked.focus();
  tip = findById(document.body, 'cmd-tip');
  assert(textOf(tip).includes('Требуется КЦ грейда II'), 'RU: закрытое условие не доступно по фокусу');

  await I.setLocale('en', { persist: false });
  ui.refreshLocale();
  ui.update(game);
  locked = command('KeyT');
  assert(locked.getAttribute('aria-disabled') === 'true', 'EN: закрытый тир не заблокирован');
  assert(locked.getAttribute('aria-label').includes('Requires Command Center Tier II'), 'EN: причина закрытого условия не локализована');
  locked.focus();
  tip = findById(document.body, 'cmd-tip');
  assert(textOf(tip).includes('Requires Command Center Tier II'), 'EN: фокус не показывает требование грейда');

  await I.setLocale('ru', { persist: false });
  ui.refreshLocale();
  ui.update(game);
  const labBusy = lab;
  labBusy.res = { key: 'infAtk', lvl: 1, t: 30, total: 40 };
  ui.update(game);
  const otherResearch = command('KeyW');
  assert(otherResearch.getAttribute('aria-disabled') === 'true', 'занятая лаборатория позволяет начать второе исследование');
  assert(otherResearch.getAttribute('aria-label').includes('Лаборатория уже занята'), 'причина lab busy не показана');

  // Полная очередь — причина есть даже если хватает ресурсов.
  const fullBarracks = placeDone(st, 'barracks', 38, 45);
  fullBarracks.queue = Array.from({ length: 5 }, () => ({ type: 'marine', t: 10, total: 13 }));
  select(fullBarracks);
  const full = command('KeyQ');
  assert(full.getAttribute('aria-disabled') === 'true', 'полная очередь не блокирует новую команду');
  assert(full.getAttribute('aria-label').includes('Очередь полна'), 'нет ясной причины queue full');
  full.focus();
  tip = findById(document.body, 'cmd-tip');
  assert(textOf(tip).includes('Очередь полна'), 'причина queue full недоступна по фокусу');
  const queueLength = fullBarracks.queue.length;
  full.click();
  assert(fullBarracks.queue.length === queueLength, 'заблокированный хоткей изменил полную очередь');
  pass('P1.5 RU/EN: дефицит с точной суммой, тир, лаборатория занята, queue full; focus+tap защищают действие');
} catch (e) { fail('P1.5 availability/i18n', e); }

// ---------- P1.6: game-over оставляет инспектор, гасит команды ----------
try {
  const st = start();
  const barracks = placeDone(st, 'barracks');
  barracks.queue = [];
  select(barracks);
  const before = textOf(el('sel-info'));
  st.gameOver = 'win';
  ui.update(game);
  const train = command('KeyQ');
  assert(train && train.getAttribute('aria-disabled') === 'true', 'game-over оставил команду доступной');
  assert(train.getAttribute('aria-label').includes('Партия завершена'), 'game-over не объясняет недоступность');
  assert(textOf(el('sel-info')).includes(before.split(' ')[0]), 'инспектор очистился после game-over');
  train.focus();
  assert(textOf(findById(document.body, 'cmd-tip')).includes('Партия завершена'), 'причина game-over не доступна по фокусу');
  pass('P1.6 game-over: команды гаснут, инспектор остаётся читаемым');
} catch (e) { fail('P1.6 game-over', e); }

// ---------- P1.7: геометрия, скрытие, narrow CSS, reduced motion, фокус ----------
try {
  const st = start();
  const barracks = placeDone(st, 'barracks');
  select(barracks);
  const expected = {
    bottom: { top: 0, bottom: 190, left: 0, right: 0 },
    left: { top: 0, bottom: 0, left: 236, right: 0 },
    right: { top: 0, bottom: 0, left: 0, right: 236 },
    top: { top: 190, bottom: 0, left: 0, right: 0 },
  };
  for (const pos of ['bottom', 'left', 'right', 'top']) {
    ui.setPanelPos(pos);
    game.resize();
    const actual = ui.getPanelInsets();
    for (const side of ['top', 'bottom', 'left', 'right']) {
      assert(actual[side] === expected[pos][side], `${pos}: ${side} inset ${actual[side]} ≠ ${expected[pos][side]}`);
    }
    paint();
  }
  ui.setPanelHidden(true);
  assert(Object.values(ui.getPanelInsets()).every((n) => n === 0), 'скрытая панель оставляет инсеты');
  ui.update(game);
  assert(processCard() && textOf(el('sel-info')).length > 0, 'инспектор перестал обновляться при скрытой панели');
  ui.setPanelHidden(false);
  ui.setPanelPos('bottom');

  globalThis.innerWidth = 320;
  globalThis.innerHeight = 568;
  game.resize();
  ui.update(game);
  paint();
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  assert(css.includes('min-height: 190px'), 'контракт нижней панели 190px потерян');
  assert(/width:\s*236px/.test(css), 'контракт боковых панелей 236px потерян');
  assert(css.includes('max-width: 720px') && css.includes('max-width: 400px'), 'нет адаптации узкого окна');
  assert(css.includes('width: min(300px, calc(100vw - 16px))'), 'tooltip не ограничен шириной узкого экрана');
  assert(css.includes('@media (prefers-reduced-motion: reduce)') && /animation:\s*none !important/.test(css) && /transition:\s*none !important/.test(css), 'reduced-motion не отключает анимации/переходы');
  assert(css.includes('.cmd:focus-visible') && css.includes('outline: 2px solid var(--cyan-light)'), 'keyboard focus не имеет видимого контура');
  assert(css.includes('backdrop-filter: blur(6px)') && css.includes('rgba(8, 24, 31, .92)'), 'стеклянная тема/fallback не заданы');
  assert(css.includes('#bottom-panel::before') && css.includes('#bottom-panel::after'), 'нет тонких HUD-углов');
  pass('P1.7 четыре позиции/инсеты, скрытие, 320px, glass/fallback, focus-visible, reduced-motion');
} catch (e) { fail('P1.7 geometry/accessibility/motion', e); }

// ---------- P1.8: RU/EN словари и структурные инварианты ----------
try {
  const ru = (await import('../locales/ru.js')).default;
  const en = (await import('../locales/en.js')).default;
  assert(JSON.stringify(Object.keys(ru.ui.process)) === JSON.stringify(Object.keys(en.ui.process)), 'структура ui.process ru/en расходится');
  assert(ru.ui.process.refundLabel.includes('{n}') && en.ui.process.refundLabel.includes('{n}'), 'placeholder возврата пропал');
  assert(ru.ui.cmds.shortageHuman.includes('{n}') && en.ui.cmds.shortageHuman.includes('{n}'), 'placeholder дефицита пропал');
  assert(cfg.GAME_VERSION === 'M', 'версия должна быть M');
  pass('P1.8 локали 1:1, placeholders сохранены, бейдж M');
} catch (e) { fail('P1.8 locale/version', e); }

console.log(failures.length ? `\nИТОГ SIM_P1: ${failures.length} ОШИБОК (${failures.join(', ')})` : '\nИТОГ SIM_P1: ВСЕ СЦЕНАРИИ ПРОШЛИ');
process.exit(failures.length ? 1 : 0);
