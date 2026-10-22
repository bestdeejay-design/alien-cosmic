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
// Пакет W (М1.2 бокс=колонка + Н2 перезагрузка в паузе): T22.
//
// Пакет X (тултип на таче, П1):
// T23 touch-пик тултипа транзиентен: авто-скрытие 5 c, тап мимо гасит (capture),
//     причина недоступности не вечна, пересборка панели гасит.
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

// ---------- T18: пакет S — клиллинг зданий по vw/vh + подтверждение «Заново» ----------
// Живое доказательство — в scripts/v_verify.mjs (S8-пиксельная проба + диалог).
try {
  const read = (p) => import('node:fs').then((fs) =>
    fs.readFileSync(new URL(p, import.meta.url), 'utf8'));
  const gameSrc = await read('../js/game.js');
  const uiSrc = await read('../js/ui.js');
  const ru = await read('../locales/ru.js');
  const en = await read('../locales/en.js');
  assert(gameSrc.includes('bx > cam.x + vw || by > cam.y + vh'),
    'клиллинг зданий не по vw/vh (пакет S потерян)');
  assert(!/bx > cam\.x \+ W \|\|/.test(gameSrc), 'остался старый W-клиллинг зданий');
  // S8-сценарий чистой математикой: W=390, z=0.5 → vw=780; здание в мире x=512
  // лежит в (W, vw) — старый предикат отсекал, новый обязан рисовать.
  {
    const W = 390, z = 0.5, camX = 0, vw = W / z, bx = 512, bw = 96;
    const oldCull = bx > camX + W || bx + bw < camX;
    const newCull = bx > camX + vw || bx + bw < camX;
    assert(oldCull === true && newCull === false,
      'S8-математика изменилась: старый предикат должен отсекать, новый — нет');
  }
  assert(uiSrc.includes('ui.topbar.restartConfirm'), 'нет confirm-проводки на «Заново» (ui.js)');
  assert(ru.includes('restartConfirm') && en.includes('restartConfirm'),
    'нет ключа ui.topbar.restartConfirm в локалях RU/EN');
  pass('T18 пакет S: клиллинг зданий vw/vh (S8-математика) + подтверждение «Заново»');
} catch (e) { fail('T18', e); }

// ---------- T19: пакет V (вариант А) — драг в placement панит, тап ставит ----------
try {
  await sleep(420);
  start();
  const st = game.state;
  const w = myWorker();
  st.selection = [w];
  st.minerals.player = 5000;
  game.centerCamera(w.x, w.y);
  st.placing = { type: 'depot', tx: -999, ty: -999 };
  const spot = emptySpot(w); // мировая точка будущей стройки
  const s = toScr(spot.x, spot.y);
  const z = st.camera.z || 1;
  const bx0 = st.buildings.length;
  const camX0 = st.camera.x;
  // Драг ВЛЕВО на 60px (>9px): камера едет вправо, призрак замирает,
  // tryPlace НЕ вызывается. (Вправо-драг выбрал бы клэмп у левого края.)
  tapDown(s.x, s.y);
  fire('pointermove', { pointerType: 'touch', pointerId: 1, clientX: s.x - 60, clientY: s.y, cancelable: true, preventDefault() {} });
  assert(Math.abs(st.camera.x - (camX0 + 60 / z)) < 0.5,
    `пан в placement не двигает камеру: ${camX0} → ${st.camera.x}`);
  tapUp(s.x - 60, s.y);
  assert(st.buildings.length === bx0, 'драг в placement поставил здание (вариант А сломан)');
  assert(st.placing, 'режим постройки слетел после пана');
  // После пана мировая точка spot ушла по экрану влево на 60*z:
  // тап по (s.x-60, s.y) — это всё тот же мир. Ставим депо туда.
  tap(s.x - 60, s.y);
  assert(st.buildings.length === bx0 + 1, 'тап после пана не поставил здание');
  const b = st.buildings[st.buildings.length - 1];
  assert(b.type === 'depot' && Math.abs(b.tx * 32 - spot.x) < 64 && Math.abs(b.ty * 32 - spot.y) < 64,
    `депо не в тапнутой точке: (${b.tx},${b.ty}) vs (${(spot.x / 32).toFixed(1)},${(spot.y / 32).toFixed(1)})`);
  pass('T19 пакет V (А): драг в placement = пан камеры (без постановки), тап ставит');
} catch (e) { fail('T19', e); }

// ---------- T20: пакет V (Р3) — все :hover только под @media (hover: hover) ----------
// Липкий hover тача подсвечивал прошлые пункты командного меню. Статическая
// гарантия: ни один :hover-селектор не живёт вне hover-медиа (токенайзер {/}).
try {
  const css = (await import('node:fs')).readFileSync(new URL('../style.css', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const stack = [];
  let i = 0, hoverRules = 0, naked = [];
  while (i < css.length) {
    const j = css.indexOf('{', i), k = css.indexOf('}', i);
    if (j === -1 && k === -1) break;
    if (k !== -1 && (j === -1 || k < j)) { stack.pop(); i = k + 1; continue; }
    // ВАЖНО: lastIndexOf с fromIndex включает сам индекс — ищем строго ДО j
    // (иначе '{' находит сам себя и заголовок правила пуст).
    const start = Math.max(css.lastIndexOf('}', j - 1), css.lastIndexOf(';', j - 1), css.lastIndexOf('{', j - 1));
    const header = css.slice(start + 1, j).trim();
    if (header.startsWith('@media')) stack.push(header.includes('hover: hover'));
    else {
      if (header.includes(':hover')) {
        hoverRules++;
        if (!stack.some((s) => s === true)) naked.push(header.slice(0, 60));
      }
      stack.push(null);
    }
    i = j + 1;
  }
  assert(hoverRules >= 20, `hover-правил слишком мало: ${hoverRules} (обёртка потеряна?)`);
  assert(naked.length === 0, `:hover вне @media (hover: hover): ${naked.join(' | ')}`);
  pass(`T20 пакет V (Р3): все ${hoverRules} :hover-правил внутри @media (hover: hover)`);
} catch (e) { fail('T20', e); }

// ---------- T21: пакет V — М1-лимиты/full-bleed мини-карты + favicon (Ф1) ----------
try {
  const fs = await import('node:fs');
  const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
  const uiSrc = await read('../js/ui.js');
  const css = await read('../style.css');
  const html = await read('../index.html');
  // М1 + М1.2 (W): лимиты ширины (низ/верх 200); боковой бокс теперь следует
  // ширине колонки (clientWidth — фолбэк стаба 178 = поведение V 176+2).
  assert(uiSrc.includes('maxW = 200; maxH = 200'), 'М1: десктоп-лимит не 200');
  assert(uiSrc.includes('maxW = Math.max(120, colW - 2)'), 'М1.2: боковой бокс не следует ширине колонки');
  // М1: виньетка снята, бокс прижат к внешнему углу панели.
  assert(!css.includes('inset 0 0 12px'), 'М1: виньетка #minimap-box на месте');
  assert(/#minimap-box\s*\{[^}]*margin-left:\s*-14px;\s*margin-bottom:\s*-12px/.test(css),
    'М1: бокс не прижат к углу нижней панели');
  // Ф1: проводка в head + файлы на диске.
  assert(html.includes('rel="icon" type="image/svg+xml"'), 'Ф1: нет svg-иконки в head');
  assert(html.includes('favicon-32.png') && html.includes('favicon-48.png'), 'Ф1: нет PNG-фолбэков в head');
  assert(html.includes('apple-touch-icon.png'), 'Ф1: нет apple-touch-icon в head');
  assert(html.includes('<meta name="theme-color" content="#071218"/>'), 'Ф1: нет theme-color');
  for (const f of ['favicon.svg', 'favicon-32.png', 'favicon-48.png', 'apple-touch-icon.png']) {
    assert(fs.existsSync(new URL('../assets/' + f, import.meta.url)), `Ф1: нет файла assets/${f}`);
  }
  pass('T21 пакет V: М1 (200/176 + full-bleed) и Ф1 (favicon svg/png/apple + theme-color)');
} catch (e) { fail('T21', e); }

// ---------- T22: пакет W — М1.2 (бокс=колонка) + Н2 (перезагрузка в паузе) ----------
try {
  const fs = await import('node:fs');
  const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
  const uiSrc = await read('../js/ui.js');
  const css = await read('../style.css');
  const html = await read('../index.html');
  // М1.2: боковой бокс = clientWidth колонки минус рамки; потолок высоты 300.
  assert(uiSrc.includes("panelPos === 'left' || panelPos === 'right'")
    && uiSrc.includes('col.clientWidth'), 'М1.2: бокс не читает ширину колонки');
  assert(uiSrc.includes('maxH = 300'), 'М1.2: нет потолка высоты боковых панелей');
  assert(css.includes('scrollbar-width: thin'), 'М1.2: нет скролл-страховки боковой колонки');
  // Н2: кнопка в паузе, локаль ui.menu.reload, тот же confirm-контракт.
  assert(html.includes('id="btn-pause-reload"'), 'Н2: нет кнопки перезагрузки в паузе');
  assert(/btn-pause-reload[^>]*data-i18n="ui\.menu\.reload"/.test(html), 'Н2: кнопка паузы без локали ui.menu.reload');
  const m = uiSrc.match(/btn-pause-reload[\s\S]{0,220}?reloadConfirm/);
  assert(m, 'Н2: кнопка паузы не подтверждает перезагрузку (confirm)');
  for (const loc of ['ru', 'en']) {
    const src = await read(`../locales/${loc}.js`);
    assert(src.includes('reloadConfirm'), `Н2: нет reloadConfirm в ${loc}`);
  }
  pass('T22 пакет W: М1.2 (бокс=колонка, потолок 300) + Н2 (перезагрузка в паузе с confirm, RU/EN)');
} catch (e) { fail('T22', e); }

// ---------- T23: пакет X — тач-пик тултипа транзиентен (П1) ----------
try {
  const fs = await import('node:fs');
  const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
  const uiSrc = await read('../js/ui.js');
  // Авто-скрытие: таймер 5 c, взводится в обоих touch-показах (кнопка + чип).
  assert(uiSrc.includes('TIP_TOUCH_HIDE_MS = 5000'), 'П1: нет константы авто-скрытия 5000');
  const arms = uiSrc.match(/armTipAutoHide\(\)/g) || [];
  assert(arms.length >= 3, `П1: взведение таймера должно быть в 3 точках (2 тача + disabled), найдено ${arms.length}`);
  // Тап мимо: capture-слушатель на document с исключением самого #cmd-tip.
  assert(/document\.addEventListener\('pointerdown'[\s\S]{0,200}?tipEl\.contains[\s\S]{0,120}?hideTip\(\);[\s\S]{0,40}?\}, true\)/.test(uiSrc),
    'П1: нет capture-слушателя «тап мимо гасит» с исключением #cmd-tip');
  // Причина недоступности на таче не вечна: disabled-ветка взводит таймер.
  assert(/state\.disabled[\s\S]{0,400}?armTipAutoHide\(\)/.test(uiSrc),
    'П1: disabled-ветка не взводит авто-скрытие');
  // Пересборка панели гасит тултип (не переживает смену выделения/очереди).
  assert(/rebuildPanel\(game, sel\) \{[\s\S]{0,900}?hideTip\(\);/.test(uiSrc) ||
         /const previousDyn = dyn;[\s\S]{0,800}?hideTip\(\);/.test(uiSrc),
    'П1: rebuildPanel не гасит тултип');
  // hideTip снимает таймер (нет гонок «погас-и-погас»).
  assert(/function hideTip\(\) \{[\s\S]{0,120}?clearTimeout\(tipHideTimer\)/.test(uiSrc),
    'П1: hideTip не снимает таймер');
  pass('T23 пакет X: тач-пик транзиентен (таймер 5 c, тап мимо, disabled, пересборка)');
} catch (e) { fail('T23', e); }

// ---------- T24: пакет R — visualViewport-устойчивость (V2) ----------
try {
  const innerW = globalThis.innerWidth, innerH = globalThis.innerHeight;
  const rootEl = document.documentElement;
  // Фейковый vv: до зума — обычное состояние (initVVFollow уже отработал в
  // конструкторе без vv; здесь подменяем и считаем applyVV напрямую).
  const vv = {
    scale: 1, width: 390, height: 700, offsetLeft: 40, offsetTop: 60,
    _h: {}, addEventListener(ev, fn) { (this._h[ev] = this._h[ev] || []).push(fn); },
  };
  globalThis.visualViewport = vv;
  fireWin('ac-vv-check', {}); // хук: bind() перечитывает vv + applyVV (контракт реального vv-события)
  assert(!rootEl.classList.contains('vv-follow'), 'R: режим следования включился при scale=1');
  // Зум: класс + --vv-* + канвас и cssW/cssH под видимую область.
  vv.scale = 1.6;
  fireWin('ac-vv-check', {});
  assert(rootEl.classList.contains('vv-follow'), 'R: нет класса vv-follow при scale>1.01');
  assert(rootEl.style['--vv-x'] === '40px' && rootEl.style['--vv-y'] === '60px',
    `R: смещение --vv-x/--vv-y не выставлено (${rootEl.style['--vv-x']}/${rootEl.style['--vv-y']})`);
  assert(rootEl.style['--vv-w'] === '390px' && rootEl.style['--vv-h'] === '700px',
    `R: размеры --vv-w/--vv-h не выставлены (${rootEl.style['--vv-w']}/${rootEl.style['--vv-h']})`);
  assert(cv.style.width === '390px' && cv.style.height === '700px',
    `R: канвас не подстроен под видимую область (${cv.style.width}x${cv.style.height})`);
  assert(game.cssW === 390 && game.cssH === 700, `R: cssW/cssH не переключились на vv (${game.cssW}x${game.cssH})`);
  // Подписка на vv-события есть (resize/scroll ведут к applyVV).
  assert(vv._h.resize && vv._h.scroll, 'R: нет подписки на vv resize/scroll');
  // Одноразовая подсказка: флаг ставится и не переспрашивается.
  assert(globalThis.localStorage.getItem('ac_vv_hint_v1') === '1', 'R: нет флага одноразовой подсказки');
  game.vvActive = false; // имитация повторного входа в зум
  fireWin('ac-vv-check', {});
  assert(globalThis.localStorage.getItem('ac_vv_hint_v1') === '1', 'R: подсказка не одноразовая');
  // Возврат масштаба: режим снят, переменные очищены, канвас вернулся к layout.
  vv.scale = 1;
  fireWin('ac-vv-check', {});
  assert(!rootEl.classList.contains('vv-follow'), 'R: класс vv-follow не снят при scale=1');
  assert(rootEl.style['--vv-x'] === undefined, 'R: --vv-x не очищен при возврате');
  assert(cv.style.width === innerW + 'px' && cv.style.height === innerH + 'px',
    `R: канвас не вернулся к layout viewport (${cv.style.width}x${cv.style.height})`);
  pass('T24 пакет R: следование за visualViewport (класс+переменные, канвас, подписка, подсказка один раз, возврат)');
} catch (e) { fail('T24', e); }

// ---------- ИТОГ ----------
console.log(failures.length
  ? `\nИТОГ SIM_TOUCH: ПРОВАЛЕНО ${failures.length}: ${failures.join(', ')}`
  : '\nИТОГ SIM_TOUCH: ВСЕ ПРОВЕРКИ ПРОШЛИ');
process.exitCode = failures.length ? 1 : 0;
