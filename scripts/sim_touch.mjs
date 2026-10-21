// ============================================================
// sim_touch.mjs — хотфикс-пакет T (мобильный тач):
//
// T1  тап по своему рабочему — выделение.
// T2  тап по земле при выделении — ПРИКАЗ (движение), выделение живо.
// T3  тап по кристаллу при выделении рабочего — добыча.
// T4  тап по вражескому зданию при выделении — атака.
// T5  двойной тап по пустому — снять выделение.
// T6  тап по своему зданию — выделение здания; тап по земле — точка сбора.
// T7  долгое нажатие (450мс) — приказ как ПКМ.
// T8  дрифт камеры: синтетический mousemove тача НЕ оживляет мышь
//     (ни sourceCapabilities-путь, ни эвристика), камера стоит.
// T9  настоящая мышь работает после тача (регресс десктопа).
// T10 pointerdown тача возвращает мышь в sentinel −1.
// T11 подсказка жестов показывается один раз (touchHintShown).
//
// Пакет U (профиль ввода):
// T12 классы game-touch/game-desktop на <html>, зум-кнопки только в тач-профиле.
// T13 смена профиля перестраивает панель (хинт ЛКМ/Тап).
// T14 атака-движение: кнопка KeyA в панели, тап в режиме — приказ attackMove.
// T15 override профиля сохраняется в localStorage, auto возвращает базис.
//
// Пакет Q (жесты страницы):
// T17 touch-action-политика, meta-ограничения, gesturestart-гвард, кнопка reload.
//
// Запуск: node scripts/sim_touch.mjs
// ============================================================
import './harness.mjs';
import { el } from './harness.mjs';

// Перехватываем window-обработчики (mousemove и пр.) ДО импорта game.js.
const winH = {};
const origAdd = globalThis.addEventListener;
globalThis.addEventListener = (ev, fn) => { (winH[ev] = winH[ev] || []).push(fn); };
await import('../js/game.js');
globalThis.addEventListener = origAdd;
const fireWin = (ev, obj) => (winH[ev] || []).forEach((fn) => fn(obj));

const U = await import('../js/units.js');
const missionsMod = await import('../js/missions.js');
const game = globalThis.game;
if (!game) { console.log('FAIL  boot: window.game не создан'); process.exit(1); }

const failures = [];
const pass = (m) => console.log(`PASS  ${m}`);
const fail = (id, e) => { failures.push(id); console.log(`FAIL  ${id}: ${String((e && e.message) || e)}`); };
const assert = (c, m) => { if (!c) throw new Error(m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const cv = el('game-canvas');
const fire = (ev, obj) => (cv._handlers[ev] || []).forEach((fn) => fn(obj));
const tapDown = (x, y, id = 1) => fire('pointerdown', { pointerType: 'touch', pointerId: id, clientX: x, clientY: y, cancelable: true, preventDefault() {} });
const tapUp = (x, y, id = 1) => fire('pointerup', { pointerType: 'touch', pointerId: id, clientX: x, clientY: y, cancelable: true, preventDefault() {} });
const tap = (x, y, id = 1) => { tapDown(x, y, id); tapUp(x, y, id); };
const toScr = (wx, wy) => game.worldToScreen(wx, wy);

function start() {
  game.startMission({ ...missionsMod.SKIRMISH, id: -1, faction: 'human',
    map: { seed: 777, biome: 'mars', lakes: 'default', rocks: 6, rich: 1.0, base: { x: 8, y: 48 } } });
  for (let i = 0; i < 3; i++) game.tick();
}
const myWorker = () => game.state.units.find((u) => u.side === 'player' && u.type === 'worker' && !u.dead && !u.garrison);
const myCC = () => game.state.buildings.find((b) => b.side === 'player' && b.type === 'cc' && !b.dead);
const enemyCC = () => game.state.buildings.find((b) => b.side === 'enemy' && !b.dead);
// Пустая точка земли рядом с рабочим: без кристалла, без зданий, без юнитов.
function emptySpot(near) {
  for (let d = 3; d < 14; d++) {
    for (const [dx, dy] of [[d, 0], [-d, 0], [0, d], [0, -d], [d, d], [-d, -d]]) {
      const x = near.x + dx * 32, y = near.y + dy * 32;
      if (U.crystalAt(game.state, x, y)) continue;
      if (game.state.buildings.some((b) => !b.dead &&
        x > b.tx * 32 - 20 && x < (b.tx + b.w) * 32 + 20 &&
        y > b.ty * 32 - 20 && y < (b.ty + b.h) * 32 + 20)) continue;
      return { x, y };
    }
  }
  throw new Error('пустая точка не найдена');
}

// ---------- T1: тап по своему рабочему ----------
try {
  start();
  const w = myWorker();
  const s = toScr(w.x, w.y);
  tap(s.x, s.y);
  assert(game.state.selection.length === 1 && game.state.selection[0] === w, 'рабочий не выделился тапом');
  pass('T1  тап по своему юниту — выделение');
} catch (e) { fail('T1', e); }

// ---------- T2: тап по земле при выделении — приказ ----------
try {
  await sleep(420); // не склеить с предыдущим тапом в «двойной»
  const w = myWorker();
  const spot = emptySpot(w);
  const s = toScr(spot.x, spot.y);
  tap(s.x, s.y);
  assert(w.order.kind === 'move', `ожидал приказ move, факт ${w.order.kind}`);
  assert(game.state.selection.includes(w), 'выделение сбросилось после приказа');
  pass('T2  тап по земле — приказ движения, выделение живо');
} catch (e) { fail('T2', e); }

// ---------- T3: тап по кристаллу — добыча ----------
try {
  await sleep(420);
  const w = myWorker();
  const c = game.state.map.crystals.find((c) => c.amount > 0);
  assert(c, 'в скирмише нет кристаллов');
  const s = toScr((c.tx + 0.5) * 32, (c.ty + 0.5) * 32);
  tap(s.x, s.y);
  assert(w.order.kind === 'gather', `ожидал gather, факт ${w.order.kind}`);
  pass('T3  тап по кристаллу — добыча');
} catch (e) { fail('T3', e); }

// ---------- T4: тап по вражескому зданию — атака ----------
try {
  await sleep(420);
  const w = myWorker();
  game.state.selection = [w]; // прямое выделение (камеру к врагу не возим)
  const e2 = enemyCC();
  assert(e2, 'нет вражеского КЦ');
  const s = toScr((e2.tx + 1.5) * 32, (e2.ty + 1) * 32);
  tap(s.x, s.y);
  assert(w.order.kind === 'attack', `ожидал attack, факт ${w.order.kind}`);
  pass('T4  тап по врагу — атака');
} catch (e) { fail('T4', e); }

// ---------- T5: двойной тап по пустому — снять выделение ----------
try {
  await sleep(420);
  const w = myWorker();
  game.state.selection = [w];
  const spot = emptySpot(w);
  const s = toScr(spot.x, spot.y);
  tap(s.x, s.y);          // первый тап — приказ
  tap(s.x + 3, s.y + 2);  // второй сразу — снять выделение
  assert(game.state.selection.length === 0, 'двойной тап не снял выделение');
  pass('T5  двойной тап по пустому — снять выделение');
} catch (e) { fail('T5', e); }

// ---------- T6: своё здание — выделение и точка сбора ----------
try {
  await sleep(420);
  const cc = myCC();
  const s = toScr((cc.tx + cc.w / 2) * 32, (cc.ty + cc.h / 2) * 32);
  tap(s.x, s.y);
  assert(game.state.selection.length === 1 && game.state.selection[0] === cc, 'КЦ не выделился тапом');
  await sleep(420);
  const spot = emptySpot({ x: (cc.tx + 4) * 32, y: (cc.ty + cc.h + 2) * 32 });
  const s2 = toScr(spot.x, spot.y);
  tap(s2.x, s2.y);
  assert(cc.rally && Math.abs(cc.rally.x - spot.x) < 40, 'точка сбора не поставлена');
  pass('T6  свой КЦ: выделение тапом + точка сбора тапом по земле');
} catch (e) { fail('T6', e); }

// ---------- T7: долгое нажатие — приказ как ПКМ ----------
try {
  await sleep(420);
  const w = myWorker();
  game.state.selection = [w];
  const c = game.state.map.crystals.find((c) => c.amount > 0);
  const s = toScr((c.tx + 0.5) * 32, (c.ty + 0.5) * 32);
  tapDown(s.x, s.y);
  await sleep(520); // > 450мс таймера long-press
  tapUp(s.x, s.y);
  assert(w.order.kind === 'gather', `ожидал gather от long-press, факт ${w.order.kind}`);
  pass('T7  долгое нажатие — приказ (ПКМ-эквивалент)');
} catch (e) { fail('T7', e); }

// ---------- T8: дрифт камеры — синтетика тача мышь не оживляет ----------
try {
  await sleep(420);
  game.sleepMouse();
  const w = myWorker();
  const s = toScr(w.x, w.y);
  tap(s.x, s.y); // тач: lastTouchPoint обновлён, мышь сброшена
  // (а) Chrome/Android: sourceCapabilities.firesTouchEvents
  fireWin('mousemove', { clientX: 640, clientY: 790, sourceCapabilities: { firesTouchEvents: true } });
  assert(game.mouse.x === -1 && game.mouse.y === -1, 'sourceCapabilities-синтетика двигает мышь');
  // (б) Safari: эвристика — рядом и сразу после тача
  fireWin('mousemove', { clientX: s.x + 10, clientY: s.y + 8 });
  assert(game.mouse.x === -1 && game.mouse.y === -1, 'эвристика пропустила синтетику');
  const y0 = game.state.camera.y, x0 = game.state.camera.x;
  for (let i = 0; i < 90; i++) game.tick(); // 1.5 c логики у нижней кромки
  assert(game.state.camera.y === y0 && game.state.camera.x === x0, `камера уехала: (${x0},${y0}) → (${game.state.camera.x},${game.state.camera.y})`);
  pass('T8  синтетический mousemove тача не панирует камеру');
} catch (e) { fail('T8', e); }

// ---------- T9: настоящая мышь после тача работает ----------
try {
  await sleep(800); // выйти из 700мс окна эвристики
  fireWin('mousemove', { clientX: 640, clientY: 400 });
  assert(game.mouse.x === 640 && game.mouse.y === 400, 'настоящая мышь заблокирована');
  game.sleepMouse();
  pass('T9  настоящая мышь работает после тача');
} catch (e) { fail('T9', e); }

// ---------- T10: pointerdown тача сбрасывает мышь в sentinel ----------
try {
  game.mouse.x = 500; game.mouse.y = 500;
  const w = myWorker();
  const s = toScr(w.x, w.y);
  tapDown(s.x, s.y);
  assert(game.mouse.x === -1 && game.mouse.y === -1, 'pointerdown не сбросил мышь');
  assert(game.edgeT === 0 && !game.edgeZone, 'краевые зоны не погашены');
  tapUp(s.x, s.y);
  pass('T10  тач возвращает мышь в sentinel −1');
} catch (e) { fail('T10', e); }

// ---------- T11: подсказка жестов один раз + текст тоста не «[object Object]» ----------
try {
  assert(game.touchHintShown === true, 'touchHintShown не взведён');
  const ui = await import('../js/ui.js');
  const msg = ui.toast.last ? String(ui.toast.last.msg) : '';
  assert(msg.includes('Тап по карте') && !msg.includes('object Object'),
    `текст тоста сломан: "${msg.slice(0, 60)}"`);
  pass('T11  подсказка жестов показана (один раз), текст тоста корректный');
} catch (e) { fail('T11', e); }

// ---------- T12: профиль ввода — классы на <html>, зум по профилю ----------
try {
  assert(game.profile && typeof game.profile.effective === 'function', 'game.profile не создан');
  assert(game.profile.mode() === 'auto', `в симе override должен быть auto, факт ${game.profile.mode()}`);
  assert(game.profile.effective() === 'desktop', 'в headless-симе базис должен быть desktop');
  const root = document.documentElement;
  assert(root.classList.contains('game-desktop'), 'класса game-desktop на <html> нет');
  assert(root.getAttribute('data-input') === 'desktop', 'data-input не desktop');
  // Тач-профиль: классы + зум-кнопки видимы в партии.
  game.profile.set('touch');
  assert(root.classList.contains('game-touch'), 'класс game-touch не встал');
  assert(root.getAttribute('data-input') === 'touch', 'data-input не touch');
  for (let i = 0; i < 3; i++) game.tick();
  assert(el('zoom-controls').hidden === false, 'зум-кнопки скрыты в тач-профиле');
  // Десктоп-профиль: зум-кнопки скрыты (дублируют колесо/клавиши/СКМ).
  game.profile.set('desktop');
  for (let i = 0; i < 3; i++) game.tick();
  assert(el('zoom-controls').hidden === true, 'зум-кнопки не скрыты в десктоп-профиле');
  pass('T12 профиль ввода: классы на <html>, зум-кнопки только в тач-профиле');
} catch (e) { fail('T12', e); }

// ---------- T13: панель перестраивается по профилю (хинт выделения) ----------
try {
  const ui = await import('../js/ui.js');
  game.state.selection = [];
  ui.update(game);
  assert(String(el('sel-info').innerHTML).includes('ЛКМ'), 'десктоп-хинт не показан в десктоп-профиле');
  game.profile.set('touch');
  ui.update(game);
  assert(String(el('sel-info').innerHTML).includes('Тап'), 'тач-хинт не показан в тач-профиле');
  game.profile.set('desktop');
  ui.update(game);
  pass('T13 смена профиля перестраивает панель (хинт ЛКМ/Тап)');
} catch (e) { fail('T13', e); }

// ---------- T14: атака-движение кнопкой в cmd-grid + тап-приказ ----------
try {
  await sleep(420);
  const ui = await import('../js/ui.js');
  const st = game.state;
  const m = U.spawnUnit(st, 'player', 'marine', st.buildings.find((b) => b.side === 'player').tx * 32 + 64,
    st.buildings.find((b) => b.side === 'player').ty * 32 + 96);
  st.selection = [m];
  ui.update(game);
  const grid = el('cmd-grid');
  const btn = grid.children.find((c) => c.dataset && c.dataset.code === 'KeyA');
  assert(btn, 'кнопка атака-движения (KeyA) не появилась при боевом выделении');
  btn.click();
  assert(st.attackMoveMode === true, 'кнопка не взвела attackMoveMode');
  const spot = emptySpot(m);
  const s = toScr(spot.x, spot.y);
  tap(s.x, s.y); // тап в режиме — приказ и выход из режима
  assert(m.order.kind === 'attackMove', `ожидал attackMove, факт ${m.order.kind}`);
  assert(st.attackMoveMode === false, 'режим не снялся после тап-приказа');
  // Регресс: без выделения панели команд нет вовсе (рабочий по канону игры
  // тоже «боевой» — dmg 4, клавиша A с ним и раньше работала).
  st.selection = [];
  ui.update(game);
  assert(!grid.children.some((c) => c.dataset && c.dataset.code === 'KeyA'), 'KeyA показана без выделения');
  pass('T14 атака-движение: кнопка в панели, тап в режиме — приказ attackMove');
} catch (e) { fail('T14', e); }

// ---------- T15: override профиля сохраняется в localStorage ----------
try {
  game.profile.set('touch');
  assert(globalThis.localStorage.getItem('terranrts.profile') === 'touch', 'override touch не сохранён');
  game.profile.set('desktop');
  assert(globalThis.localStorage.getItem('terranrts.profile') === 'desktop', 'override desktop не сохранён');
  game.profile.set('auto');
  assert(globalThis.localStorage.getItem('terranrts.profile') === 'auto', 'override auto не сохранён');
  assert(game.profile.effective() === 'desktop', 'после auto базис сима должен быть desktop');
  pass('T15 override профиля persisted + auto возвращает базис');
} catch (e) { fail('T15', e); }

// ---------- T16: runtime-сигналы профиля (pointer-события window) ----------
try {
  assert(game.profile.effective() === 'desktop', 'базис сима — desktop');
  fireWin('pointerdown', { pointerType: 'touch' });
  assert(game.profile.effective() === 'touch', 'тач-сигнал не поднял профиль');
  assert(document.documentElement.getAttribute('data-input') === 'touch', 'data-input не обновлён сигналом');
  fireWin('pointerdown', { pointerType: 'mouse' });
  assert(game.profile.effective() === 'desktop', 'мышиный сигнал не поднял десктоп');
  // Односторонняя политика: с десктопа тач больше не поднимается (без маяты).
  fireWin('pointerdown', { pointerType: 'touch' });
  assert(game.profile.effective() === 'desktop', 'односторонняя политика сломана: тач вернул');
  // При override сигналы игнорируются.
  game.profile.set('touch');
  fireWin('pointerdown', { pointerType: 'mouse' });
  assert(game.profile.effective() === 'touch', 'override не защитил от сигнала');
  game.profile.set('auto');
  assert(game.profile.effective() === 'desktop', 'auto должен вернуться к накопленному сигналу (desktop)');
  pass('T16 runtime-сигналы: тач/мышь, односторонняя политика, гвард override');
} catch (e) { fail('T16', e); }

// ---------- T17: политика жестов страницы (пакет Q) ----------
// Статическая гарантия: touch-action-политика в CSS, meta-ограничения,
// gesturestart-гвард. Живое поведение — в scripts/v_verify.mjs (браузер).
try {
  const css = await import('node:fs').then((fs) =>
    fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8'));
  const html = await import('node:fs').then((fs) =>
    fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8'));
  const gameSrc = await import('node:fs').then((fs) =>
    fs.readFileSync(new URL('../js/game.js', import.meta.url), 'utf8'));
  assert(/html\s*{\s*touch-action:\s*manipulation/.test(css), 'нет html manipulation (double-tap глобально)');
  assert(/body\s*>\s*\*\s*{\s*touch-action:\s*pan-y/.test(css), 'нет body>* pan-y (pinch не закрыт)');
  assert(/touch-action:\s*none/.test(css), 'канвас touch-action:none пропал');
  assert(html.includes('maximum-scale=1') && html.includes('user-scalable=no'), 'meta-ограничения зума отсутствуют');
  assert(html.includes('btn-reload-screen'), 'кнопка «Перезагрузить экран» отсутствует');
  assert(gameSrc.includes("addEventListener('gesturestart'"), 'нет gesturestart-гварда в game.js');
  pass('T17 политика жестов: CSS-политика, meta, gesturestart-гвард, кнопка reload');
} catch (e) { fail('T17', e); }

// ---------- ИТОГ ----------
console.log(failures.length
  ? `\nИТОГ SIM_TOUCH: ПРОВАЛЕНО ${failures.length}: ${failures.join(', ')}`
  : '\nИТОГ SIM_TOUCH: ВСЕ ПРОВЕРКИ ПРОШЛИ');
process.exitCode = failures.length ? 1 : 0;
