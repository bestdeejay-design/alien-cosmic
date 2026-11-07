#!/usr/bin/env node
// ============================================================
// sim_onboarding.mjs — 30-grades-onboarding (ace#25/#26/#27):
// онбординг /r/ — легенда, 8 шагов, спотлайт, персистентность.
//
// Проверки (05-spec-onboarding.md §6 + правки задачи):
//   O1  свежая сессия → onboarding активен с шага 0 (легенда);
//       старый сейв без поля session.onboarding → НЕ активен,
//       validateRaidV2 не падает ни с полем, ни без
//   O2  шаг 1: спотлайт сборщика, классы body ob-active/ob-step-1,
//       камера навелась, каллаут не пуст
//   O3  выделение юнита → шаг 2; doubleSelect → шаг 3 (кристалл-цель)
//   O4  приказ на добычу → шаг 4; шаг 4 двухфазный (ace#36): 4а «Откройте
//       постройки» → 4б «Выберите Дом-шаттл» → 4в свободный выбор места, без маркера у КЦ; resume в 4а
//   O5  Дом поставлен → 5; казарма достроена → 6а (выбор казармы игроком);
//       найм marine → 6б (грейд + чип «Далее», ace#38); клик чипа → 7;
//       роадмап открыт/закрыт → 8 (done) + objective
//   O6  скип на любом шаге = done+skipped, оверлей снят (классы body)
//   O7  RU/EN ключи ui.onboarding.*/ui.exitMenu.*/ui.selCount/
//       ui.dbltapHint синхронны, плейсхолдеры совпадают (T9)
//   O8  флаг персистится в session.onboarding (step по ходу, done при финале)
//   O9  ac_dbltap_hint_v1 в PROFILE_KEYS (storage-ns)
//   O10 чужой модал открыт → онбординг подавлен (ob-suppressed, каллаут
//       погашен, dim снят), шаг сохранён; модал закрыт → шаг восстановлен
//   O13 (QA-пачка 05.11): шаг 3 = ТОЛЬКО ручной приказ игрока (issueRMB),
//       шаг 6 = дельта-найм от baseline, шаг 7 = интерактивная дырка
//       (тап = настоящий openCcRoadmap) + ob-roadmap-open, камера
//       возвращается к КЦ после авто-пана шага 3
//   O15 (ace#35): стартовые сборщики СТОЯТ (order=idle); скип тура →
//       программный gather простоям (kindness); восстановление сейва
//       (homeDto) — канон НЕ меняется (рабочие сразу добыча)
//   O17 (финальный QA 06.11, ace#25): живой rect-ассерт «Пропустить» vs
//       топбар («Выход») на 320/344/390/430, RU и EN: skip целиком под
//       топбаром (--tb-h), elementFromPoint в центре «Выхода» = btn-exit,
//       в центре скипа = ob-skip, вне экрана ничего; pageerror=0
//   O18 (финальный QA 06.11, ace#34): язык после reload = сохранённому
//       (RU остаётся RU при браузере en-US; EN остаётся EN; первое касание
//       без ключа = RU-дефолт рейд-канона raid-boot)
//   O16 (ace#34, merge wave34 — переименовано из O15: имя занято idle-спавном):
//       тоггл RU/EN на легенде (шаг 0) — реальные клики EN↔RU, персист
//       terrranrts.language, тексты легенды/«Далее»/«Пропустить» на активном
//       языке; тур НЕ перезапускается, «Далее» → шаг 1
//   O20 (ace#41 GATE): финал — тост1 → шаттл-легенда ВТОРЫМ тостом (≥1.7с,
//       таймер 1800мс), objective финала «…откроет турели»;
//       menuHintHook — JIT-подсказка меню: гварды (!active && (done||skipped)),
//       ровно один тост, флаг ac_ob_menu_hint_v1, края не падают. O19(б2):
//       начатый грейд казармы не двигает шаг 6б и не гасит чип. O7: тостовые
//       ключи ≤60 симв. O9: ac_ob_menu_hint_v1 в PROFILE_KEYS.
//
// Паттерн — sim_unlocks.mjs: живой код r/ копируется в .sim с зачисткой
// ?v= (локали — в scripts/locales, gitignore), DOM — стабы onb_harness.mjs.
// Запуск: node scripts/sim_onboarding.mjs
// ============================================================
import './onb_harness.mjs';
import { mkdirSync, readFileSync, writeFileSync, readdirSync, copyFileSync } from 'fs';
import { join } from 'path';

const failures = [];
const fail = (phase, err) => { failures.push(phase); console.log(`FAIL  ${phase}: ${String((err && err.message) || err)}`); };
const pass = (msg) => console.log(`PASS  ${msg}`);
const assert = (c, m) => { if (!c) throw new Error(m); };
async function phase(name, fn) {
  try { await fn(); } catch (err) { fail(name, err); }
}

// канон: в ace источник = game/r/, в котле alien-cosmic — симлинк r/ на игровой полигон
import { existsSync } from 'node:fs';
const ROOT = existsSync(new URL('../game/r/js/', import.meta.url).pathname)
  ? new URL('../game/r/', import.meta.url).pathname
  : new URL('../r/', import.meta.url).pathname;
const GAME = ROOT + 'js/';
const LOCALES = ROOT + 'locales/';
const SIMDIR = new URL('./.sim/', import.meta.url).pathname;
const SIMLOC = new URL('./locales/', import.meta.url).pathname; // ../locales/ из .sim
mkdirSync(SIMDIR, { recursive: true });
mkdirSync(SIMLOC, { recursive: true });

for (const f of readdirSync(GAME).filter((x) => x.endsWith('.js'))) {
  let s = readFileSync(join(GAME, f), 'utf8');
  s = s.replace(/\b(from\s*\(\s*|from\s+|import\s*\(\s*)(['"])([^'"]+)\?v=\d+\2/g, (m, pre, q, p) => `${pre}${q}${p}${q}`); // + динамический import() (QA#2б: тап в дырку шага 7)
  writeFileSync(join(SIMDIR, f), s);
}
for (const f of readdirSync(LOCALES).filter((x) => x.endsWith('.js'))) {
  copyFileSync(join(LOCALES, f), join(SIMLOC, f));
}

await import('./.sim/game.js');
const OB = await import('./.sim/onboarding.js');
const STORE = await import('./.sim/alarm-v2-store.js');
const U = await import('./.sim/units.js');
const ru = (await import(LOCALES + 'ru.js')).default;
const en = (await import(LOCALES + 'en.js')).default;

const { TILE } = await import('./.sim/config.js');
const game = globalThis.game;
assert(game, 'движок полигона не поднялся');
const pump = (n = 1) => { for (let i = 0; i < n; i++) globalThis.__obPump(); };
const body = () => document.body.classList;

const getWorker = () => game.state.units.find((u) => !u.dead && u.side === 'player' && u.type === 'worker');

// ---------- O1: свежая сессия активна с шага 0; старый сейв — не активен ----------
await phase('O1 fresh/legacy/validator', async () => {
  // Старый сейв: поле onboarding отсутствует → онбординг НЕ показывается.
  game.startRaidHome('human', { forceNew: true });
  delete game.raidSession.onboarding;
  OB.startOnboarding(game);
  assert(game.onboarding && game.onboarding.active === false, 'старый сейв не должен включать онбординг');
  assert(!body().contains('ob-active'), 'ob-active не должен быть на body у старого игрока');
  // Валидатор не падает ни без поля (старый сейв), ни с полем (новый формат).
  const legacyBlob = JSON.parse(JSON.stringify(game.raidSession));
  assert(STORE.validateRaidV2(legacyBlob) === true, 'validateRaidV2 упал на старом сейве');
  // Свежая сессия: поле есть → активен с шага 0 (легенда).
  game.startRaidHome('human', { forceNew: true });
  assert(game.raidSession.onboarding &&
    game.raidSession.onboarding.done === false &&
    game.raidSession.onboarding.step === 0, 'createRaidSession не дал дефолт онбординга');
  assert(STORE.validateRaidV2(JSON.parse(JSON.stringify(game.raidSession))) === true,
    'validateRaidV2 отверг поле onboarding — whitelist строгий');
  OB.startOnboarding(game);
  assert(game.onboarding.active === true, 'свежая сессия не активировала онбординг');
  assert(game.onboarding.step === 0, 'старт не с шага 0');
  assert(body().contains('ob-active') && body().contains('ob-legend-open') && body().contains('ob-step-0'),
    'нет классов ob-active/ob-legend-open/ob-step-0');
  const legend = document.body.querySelector('#ob-legend');
  assert(legend, 'легенда не в DOM');
  assert(legend.classList.contains('is-on'), 'легенда не показана');
  const title = legend.querySelector('.ob-legend-title');
  assert(title && title.textContent.length > 0, 'пустой заголовок легенды');
  // REV-O п.1: «Пропустить» видна уже на легенде (skip внутри #ob-overlay,
  // z-слой оверлея выше легенды — CSS; здесь — факт is-on на шаге 0).
  const skipOnLegend = document.body.querySelector('#ob-overlay').querySelector('.ob-skip');
  assert(skipOnLegend && skipOnLegend.classList.contains('is-on'),
    '«Пропустить» не показана на шаге 0 (легенде)');
  pass('O1 свежая сессия: активна с шага 0; старый сейв — не активен; валидатор пропускает поле');
});

// ---------- O2: шаг 1 — спотлайт сборщика, камера, каллаут ----------
await phase('O2 step1 spotlight', () => {
  const legend = document.body.querySelector('#ob-legend');
  legend.querySelector('.ob-legend-next').click(); // «Далее» легенды → шаг 1
  assert(game.onboarding.step === 1, 'после легенды не шаг 1');
  assert(body().contains('ob-step-1') && !body().contains('ob-legend-open'), 'классы шага 1 не выставлены');
  const w = getWorker();
  assert(w, 'нет сборщика в свежей базе');
  pump(2); // кадр онбординга: рендер дырки/каллаута
  const callout = document.body.querySelector('#ob-overlay').querySelector('.ob-callout');
  assert(callout && callout.textContent.length > 0 && callout.classList.contains('is-on'),
    'каллаут шага 1 пуст');
  const hole = document.body.querySelector('#ob-hole');
  assert(hole && parseFloat(hole.style.width) > 0, 'дырка спотлайта не отрисована');
  // REV-O п.4: честная проверка камеры — сборщик в видимой области
  // (centerCamera целится в центр; у базы у края карты кламп допустим),
  // и дырка спотлайта стоит по экранной позиции сборщика.
  const s = game.worldToScreen(w.x, w.y);
  const cw = game.cssW || window.innerWidth, ch = game.cssH || window.innerHeight;
  assert(s.x >= 0 && s.x <= cw && s.y >= 0 && s.y <= ch,
    `сборщик вне видимой области: screen=(${s.x.toFixed(1)},${s.y.toFixed(1)}), viewport=${cw}x${ch}`);
  const hx = parseFloat(hole.style.left) + parseFloat(hole.style.width) / 2;
  const hy = parseFloat(hole.style.top) + parseFloat(hole.style.height) / 2;
  assert(Math.abs(hx - s.x) < 60 && Math.abs(hy - s.y) < 60,
    `дырка не по сборщику: hole=(${hx.toFixed(1)},${hy.toFixed(1)}), unit=(${s.x.toFixed(1)},${s.y.toFixed(1)})`);
  assert(game.onboarding.step === 1, 'шаг 1 сбился');
  pass('O2 шаг 1: ob-step-1, спотлайт, каллаут; сборщик в кадре, дырка по цели');
});

// ---------- O3: выделение → шаг 2; doubleSelect → шаг 3; reload → resume ----------
await phase('O3 select→2 dbl→3 resume', () => {
  const w = getWorker();
  game.state.selection = [w];
  game.onboarding.onUnitPicked(game, w); // хук input.js clickSelect
  assert(game.onboarding.step === 2, 'выделение не двинуло на шаг 2');
  assert(body().contains('ob-step-2'), 'нет ob-step-2');
  game.onboarding.onDoubleSelect(game); // хук input.js doubleSelect
  pump(1);
  assert(game.onboarding.step === 3, 'doubleSelect не двинул на шаг 3');
  assert(body().contains('ob-step-3'), 'нет ob-step-3');
  // Персист шага (O8-часть).
  assert(game.raidSession.onboarding.step === 3, 'шаг не персистится в сессии');
  // REV-O п.2: перезагрузка страницы mid-onboarding — продолжаем с шага 3,
  // легенду заново НЕ показываем и шаг не перескакиваем.
  OB.startOnboarding(game);
  assert(game.onboarding.active === true, 'resume: онбординг не активен');
  assert(game.onboarding.step === 3, 'resume: шаг не восстановлен');
  assert(!body().contains('ob-legend-open'), 'resume: легенда показана заново');
  const legendAgain = document.body.querySelector('#ob-legend');
  assert(!legendAgain || !legendAgain.classList.contains('is-on'), 'resume: карточка легенды открыта');
  assert(body().contains('ob-step-3'), 'resume: нет ob-step-3');
  pass('O3 выделение → 2, doubleSelect → 3; resume с шага 3 без легенды; шаг персистится');
});

// ---------- O4: приказ на кристалл → шаг 4 ----------
await phase('O4 player order→4 + camera return', () => {
  const st = game.state;
  const crystal = (st.map.crystals || []).find((c) => c.amount > 0 && st.fog.tileExplored(c.tx, c.ty));
  assert(crystal, 'нет жилы с amount>0');
  // QA#1: автосбор стартового отряда (order=gather) НЕ завершает шаг 3 —
  // только приказ ИГРОКА (issueRMB с выделенными рабочими по кристаллу).
  pump(2);
  assert(game.onboarding.step === 3, 'шаг 3 не должен завершиться сам (автосбор)');
  st.selection = [getWorker()];
  game.hooks.issueRMB((crystal.tx + 0.5) * TILE, (crystal.ty + 0.5) * TILE);
  const cameraBefore = { x: st.camera.x, y: st.camera.y };
  pump(1);
  assert(game.onboarding.step === 4, 'приказ игрока не двинул на шаг 4');
  assert(st.camera.x === cameraBefore.x && st.camera.y === cameraBefore.y, 'шаг 4 не должен двигать камеру игрока');
  // ace#36 O16: шаг 4 двухфазный. 4а — меню закрыто: каллаут «Откройте
  // постройки», дырка на cmd-grid кнопке стройки (в харнессе cmd-grid пуст —
  // дырки нет, проверяем каллаут и флаг).
  pump(2);
  const cal4 = document.body.querySelector('#ob-overlay').querySelector('.ob-callout');
  assert(cal4 && cal4.classList.contains('is-on') && cal4.textContent === ru.ui.onboarding.s4a,
    'каллаут шага 4 не 4а: ' + (cal4 && cal4.textContent));
  // 4б — меню открыто: «Выберите Дом-шаттл».
  st.buildMenu = true;
  pump(2);
  assert(cal4.textContent === ru.ui.onboarding.s4b, 'каллаут не 4б: ' + cal4.textContent);
  st.buildMenu = false;
  // У размещения нет рекомендованной точки: только тактический совет и управление.
  st.placing = { type: 'depot', tx: -999, ty: -999 };
  pump(2);
  assert(cal4.textContent.includes(ru.ui.onboarding.s4c) && cal4.textContent.includes(ru.ui.onboarding.s4plan) && cal4.textContent.includes(ru.ui.onboarding.s4paths), 'нет совета по размещению');
  assert(cal4.textContent.includes(ru.ui.onboarding.s4touch) || cal4.textContent.includes(ru.ui.onboarding.s4mouse), 'нет инструкции управления камерой');
  const hole4 = document.body.querySelector('#ob-overlay').querySelector('#ob-hole');
  assert(parseFloat(hole4.style.width) === 0 && parseFloat(hole4.style.height) === 0,
    'у размещения не должно быть маркера на выбранном туториалом месте');
  assert(!document.getElementById('ob-ping').classList.contains('is-on'), 'нет пинга на миникарте при выборе места');
  st.placing = null;
  pump(1);
  pass('O4 приказ добычи, свободное размещение без маркера и принудительного движения камеры');
});

// ---------- O5: Дом → 5, казарма достроена → 6, найм → 7, роадмап → 8 ----------
await phase('O5 build chain', async () => {
  const st = game.state;
  const mkB = (id, type) => ({
    id, type, side: 'player', done: true, dead: false,
    tx: 12, ty: 12, w: 2, h: 2, level: 1, queue: [],
  });
  st.buildings.push(mkB('ob-depot', 'depot'));
  // ace#36: resume-канон — beginStep(5) при пустом выделении программно
  // выделяет сборщиков (кнопка «Строить» без сборщика не существует).
  st.selection = [];
  pump(1);
  assert(game.onboarding.step === 5, 'Дом не двинул на шаг 5');
  assert(st.selection.some((s) => s.kind === 'unit' && s.type === 'worker'),
    'beginStep(5) не выделил сборщиков при пустом выделении (resume-тупик)');
  // ace#36 D: каллаут шага 5 — детский бар (деньги есть: эрг-fallback не ждём).
  pump(1);
  const cal5 = document.body.querySelector('#ob-overlay').querySelector('.ob-callout');
  assert(cal5 && cal5.textContent === ru.ui.onboarding.s5,
    'каллаут шага 5 не из детского бара: ' + (cal5 && cal5.textContent));
  st.buildings.push(mkB('ob-barracks', 'barracks'));
  pump(1);
  assert(game.onboarding.step === 6, 'казарма (b.done) не открыла шаг 6');
  // Сначала игрок выбирает казарму, затем появляется команда найма.
  pump(1);
  const cal6 = document.body.querySelector('#ob-overlay').querySelector('.ob-callout');
  assert(cal6.textContent === ru.ui.onboarding.selectBarracks, 'ожидается выбор казармы');
  const bar = st.buildings.find((b) => b.id === 'ob-barracks');
  st.selection = [bar];
  pump(1);
  assert(cal6.textContent === ru.ui.onboarding.s6ready,
    'каллаут 6а не s6ready: ' + cal6.textContent);
  assert(st.selection.length === 1 && st.selection[0] === bar,
    '6а не удерживает выделение казармы (KeyQ недоступен)');
  assert(game.onboarding.sub6b === false, '6б включился без найма');
  // Найм → НЕ advance, а 6б (guard: под-фаза однократная, шаг тот же).
  bar.queue.push({ type: 'marine' });
  pump(2);
  assert(game.onboarding.step === 6, 'найм не должен закрывать шаг 6 (только 6б)');
  assert(game.onboarding.sub6b === true, 'найм не включил 6б');
  pump(1);
  assert(cal6.textContent === ru.ui.onboarding.s6grade,
    'каллаут 6б не s6grade: ' + cal6.textContent);
  // ace#38: чип «Далее» — ТОЛЬКО в 6б: один элемент, слушатель один.
  const chip = document.body.querySelector('#ob-overlay').querySelector('#ob-next');
  assert(chip, 'чип «Далее» не в DOM на 6б');
  assert(chip.style.display === 'block', 'чип «Далее» не показан на 6б');
  assert(chip.textContent === ru.ui.onboarding.nextChip, 'чип не на RU-локали');
  const countById = (node, id) => (node.children || []).reduce((n, c) =>
    n + (c.id === id ? 1 : 0) + countById(c, id), 0);
  assert(countById(document.body.querySelector('#ob-overlay'), 'ob-next') === 1,
    'чипов «Далее» больше одного');
  assert((chip._handlers.click || []).length === 1, 'слушателей у чипа не ровно один');
  // Клик чипа → 7 (единственный выход из шага 6).
  chip.click();
  pump(1);
  assert(game.onboarding.step === 7, 'клик чипа «Далее» не двинул на шаг 7');
  // Шаг 7: спотлайт «Развитие»/КЦ; завершение — роадмап открыт → закрыт.
  // QA#2а: beginStep(7) сам наводит камеру на КЦ и выделяет его (панель КЦ).
  const cc7 = st.buildings.find((b2) => !b2.dead && b2.side === 'player' && b2.type === 'cc');
  assert(st.selection.length === 1 && st.selection[0] === cc7,
    'шаг 7 не выделил КЦ программно');
  // QA#2б: дырка шага 7 интерактивна — тап по ней откроет НАСТОЯЩИЙ роадмап
  // (openCcRoadmap через динамический импорт ui.js, registerModal('ccRoadmap')).
  // Харнес-заглушка getElementById отдаёт объект на ЛЮБОЙ id — openCcRoadmap
  // считал роадмап «уже открытым» и выходил. Для этого кейса ищем по живому
  // дереву body.
  const realGet = document.getElementById.bind(document);
  document.getElementById = (id) => id === 'cc-roadmap-overlay'
    ? (document.body.querySelector('#cc-roadmap-overlay') || null)
    : realGet(id);
  const dev = document.createElement('div');
  dev.className = 'sel-dev';
  dev._rect = { left: 100, top: 200, right: 220, bottom: 250, width: 120, height: 50 };
  document.getElementById('sel-info').appendChild(dev);
  pump(2);
  const hole7 = document.body.querySelector('#ob-overlay').querySelector('#ob-hole');
  assert(hole7.classList.contains('ob-hole-act'), 'дырка шага 7 не интерактивна (нет ob-hole-act)');
  hole7.click();
  await new Promise((r) => setTimeout(r, 0)); // динамический import — микротаск
  pump(2);
  assert(document.body.querySelector('#cc-roadmap-overlay'), 'тап в дырку шага 7 не открыл роадмап');
  assert(game.onboarding.step === 7, 'открытый роадмап не должен завершать шаг 7');
  assert(!document.body.classList.contains('ob-suppressed'),
    'роадмап — СВОЁ окно шага 7: онбординг НЕ должен подавляться');
  // QA#13: при открытом роадмапе поверх него ничего не рисуется (CSS-гвард).
  assert(document.body.classList.contains('ob-roadmap-open'),
    'нет ob-roadmap-open при открытом роадмапе (дырка/каллаут не погашены)');
  const MODALS = await import('./.sim/modals.js');
  MODALS.closeModal('ccRoadmap'); // как Escape/closeTop: unregister + close
  dev.remove();
  pump(2);
  assert(!document.body.querySelector('#cc-roadmap-overlay'), 'closeRoadmap не убрал оверлей');
  assert(!document.body.classList.contains('ob-roadmap-open'), 'ob-roadmap-open не снят после закрытия');
  assert(game.onboarding.step === 8, 'закрытие роадмапа не двинуло на финал');
  assert(game.onboarding.done === true && game.onboarding.skipped === false, 'финал не выставил done');
  assert(!body().contains('ob-active'), 'после финала ob-active должен быть снят');
  // ace#41 GATE п.5: сразу после финала — тост1 (finalToast) уже в DOM,
  // шаттл-тост приходим ВТОРЫМ по таймеру ≥1.7с (проверка — в O20).
  const t0 = [...document.getElementById('toasts').children].map((x) => x.textContent);
  assert(t0[t0.length - 1] === ru.ui.onboarding.finalToast,
    'последний тост после финала не finalToast: ' + JSON.stringify(t0));
  assert(!t0.some((x) => x === ru.ui.onboarding.shuttleToast),
    'шаттл-тост пришёл синхронно — обязан быть вторым ≥1.7с');
  pass('O5 цепочка Дом→5, казарма→6а (игрок выбирает казарму), найм→6б (чип «Далее»), клик чипа→7, роадмап закрыт→8 (done)');
});

// ---------- O20 (ace#41): шаттл-тост вторым, objective «турели», menuHint JIT ----------
await phase('O20 shuttle toast + objective + menuHint JIT', async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const texts = () => [...document.getElementById('toasts').children].map((x) => x.textContent);
  // O5 оставил тур в финале (done=true, active=false): finish() дал тост1
  // сразу (проверено в конце O5), шаттл-легенда приходит вторым по таймеру
  // 1800мс (антиспам ui.js — интервал 1600мс; \n в textContent не рендерится).
  await sleep(2300);
  assert(texts().includes(ru.ui.onboarding.finalToast),
    'тост1 финала не в стеке: ' + JSON.stringify(texts()));
  assert(texts().includes(ru.ui.onboarding.shuttleToast),
    'шаттл-тост (второй, ≥1.7с) не пришёл: ' + JSON.stringify(texts()));
  // ace#41 GATE п.4: objective финала — новый текст (оборона: турели/вылазки),
  // ставится отложенным setObjective (0/700мс) поверх HUD-синка.
  const obj = document.getElementById('res-objective').textContent;
  assert(obj === ru.ui.onboarding.objective, 'objective финала не из ключа: ' + obj);
  // ace#41 GATE п.6: JIT-подсказка меню — гварды и однократность.
  localStorage.removeItem('ac_ob_menu_hint_v1');
  const ob0 = { done: game.onboarding.done, skipped: game.onboarding.skipped, active: game.onboarding.active };
  // (а) тур активен → тоста нет, флаг не ставится.
  game.onboarding.active = true; game.onboarding.done = false; game.onboarding.skipped = false;
  OB.menuHintHook(game);
  // (б) вне тура, но не done/skipped → тоста нет.
  game.onboarding.active = false;
  OB.menuHintHook(game);
  assert(!texts().includes(ru.ui.onboarding.menuHint),
    'menuHint показан вопреки гвардам (active / не done): ' + JSON.stringify(texts()));
  assert(localStorage.getItem('ac_ob_menu_hint_v1') === null,
    'флаг menuHint поставлен вызовом вне гвардов');
  // (в) после тура → РОВНО один тост + флаг; повтор молчит; края не падают.
  game.onboarding.done = true; game.onboarding.skipped = false; game.onboarding.active = false;
  OB.menuHintHook(undefined); OB.menuHintHook({});
  OB.menuHintHook(game);
  let jit = texts().filter((x) => x === ru.ui.onboarding.menuHint).length;
  assert(jit === 1, 'menuHint показан не ровно один раз: ' + jit);
  assert(localStorage.getItem('ac_ob_menu_hint_v1') === '1',
    'флаг ac_ob_menu_hint_v1 не выставлен после подсказки');
  OB.menuHintHook(game);
  jit = texts().filter((x) => x === ru.ui.onboarding.menuHint).length;
  assert(jit === 1, 'второй вызов menuHintHook задублировал тост');
  // откат состояния O5 (дальнейшие фазы на него опираются) + детерминизм.
  game.onboarding.done = ob0.done; game.onboarding.skipped = ob0.skipped; game.onboarding.active = ob0.active;
  localStorage.removeItem('ac_ob_menu_hint_v1');
  pass('O20 финал: тост1 → шаттл-тост вторым (≥1.7с); objective «турели»; menuHint: гварды + однократность + флаг');
});

// ---------- O6/O8: скип на произвольном шаге + персистентность ----------
await phase('O6 skip + O8 persist', () => {
  // Новый прогон: доходим до шага 3 и скипаем.
  game.startRaidHome('human', { forceNew: true });
  OB.startOnboarding(game);
  document.body.querySelector('#ob-legend').querySelector('.ob-legend-next').click();
  game.state.selection = [getWorker()];
  game.onboarding.onUnitPicked(game, getWorker());
  assert(game.onboarding.step === 2, 'подготовка скипа: не шаг 2');
  const skipBtn = document.body.querySelector('#ob-overlay').querySelector('.ob-skip');
  assert(skipBtn, 'кнопка «Пропустить» не в DOM');
  skipBtn.click();
  assert(game.onboarding.done === true && game.onboarding.skipped === true, 'скип не выставил флаги');
  assert(!body().contains('ob-active'), 'после скипа ob-active снят');
  assert(game.raidSession.onboarding.done === true && game.raidSession.onboarding.skipped === true,
    'флаги скипа не персистятся');
  // ace#35: скип тура → kindness-автодобыча — простаивавшие сборщики
  // программно получили gather (ближайший разведанный кристалл).
  const miners = game.state.units.filter((u) => !u.dead && !u.garrison &&
    u.side === 'player' && u.type === 'worker');
  assert(miners.length === 2, 'после скипа сборщиков не 2');
  assert(miners.every((u) => u.order && u.order.kind === 'gather'),
    'после скипа сборщики не добыча (order != gather)');
  // Повторный startOnboarding на скипнутой сессии — не включается.
  OB.startOnboarding(game);
  assert(game.onboarding.active === false, 'скипнутый онбординг не должен включаться заново');
  // Повтор легенды из exit-меню флагов не меняет.
  OB.showLegendAgain(game);
  assert(body().contains('ob-legend-open'), 'повтор легенды не показан');
  assert(game.onboarding.done === true && game.onboarding.skipped === true, 'повтор легенды меняет флаги');
  // REV-O п.3: у повторной легенды есть своя «Пропустить» (кнопка пересоздана).
  const repeatSkip = document.body.querySelector('.ob-skip');
  assert(repeatSkip && repeatSkip.classList.contains('is-on'), 'у повторной легенды нет «Пропустить»');
  document.body.querySelector('#ob-legend').querySelector('.ob-legend-next').click();
  assert(!body().contains('ob-legend-open'), 'повтор легенды не закрылся');
  // Повтор НОМЕР ДВА: после закрытия ссылка на кнопку обнулена — скип пересоздаётся.
  OB.showLegendAgain(game);
  const repeatSkip2 = document.body.querySelector('.ob-skip');
  assert(repeatSkip2 && repeatSkip2.classList.contains('is-on'), 'второй повтор легенды без «Пропустить»');
  repeatSkip2.click(); // скип повторной легенды — просто закрыть
  assert(!body().contains('ob-legend-open'), 'скип повторной легенды не закрыл её');
  assert(game.onboarding.done === true && game.onboarding.skipped === true, 'скип повторной легенды меняет флаги');
  pass('O6/O8 скип: done+skipped, оверлей снят; повтор легенды флаги не меняет и всегда со «Пропустить»');
});

// ---------- O7: RU/EN ключи и плейсхолдеры ----------
await phase('O7 i18n RU/EN', () => {
  const groups = [['onboarding', ru.ui.onboarding, en.ui.onboarding],
    ['exitMenu', ru.ui.exitMenu, en.ui.exitMenu]];
  const keys = (o, p = '') => Object.entries(o).flatMap(([k, v]) =>
    v && typeof v === 'object' ? keys(v, p + k + '.') : [p + k]);
  const ph = (s) => (String(s).match(/\{[a-z]+\}/g) || []).sort().join(',');
  for (const [name, r, e] of groups) {
    assert(r && e, 'секция ui.' + name + ' отсутствует в ' + (r ? 'en' : 'ru'));
    const kr = keys(r), ke = keys(e);
    assert(JSON.stringify(kr) === JSON.stringify(ke), 'ui.' + name + ': ключи RU/EN не синхронны');
    for (const k of kr) {
      assert(ph(r[k]) === ph(e[k]), `ui.${name}.${k}: плейсхолдеры RU/EN расходятся`);
    }
  }
  for (const k of ['selCount', 'dbltapHint']) {
    assert(ru.ui[k] && en.ui[k], 'нет ui.' + k);
    assert(ph(ru.ui[k]) === ph(en.ui[k]), 'ui.' + k + ': плейсхолдеры расходятся');
  }
  // Каллауты «детского бара» (ace#35/#36): глагол первым, ≤ 40 символов
  // (лимит строки 390px); ключи s4a/s4b/s4c — под-фазы шага 4;
  // s6ready/s6grade — под-фазы шага 6 (ace#38), nextChip — подпись чипа.
  const CALLOUT_KEYS = ['s1', 's2', 's3', 's4a', 's4b', 's4c', 's4plan', 's4paths', 's4touch', 's4mouse', 's4mousePlace', 's5', 's6ready', 's6grade', 'nextChip', 's7'];
  for (const k of CALLOUT_KEYS) {
    const s = ru.ui.onboarding[k];
    assert(s && s.length <= 40, 'каллаут ' + k + ' длиннее 40 символов: ' + s);
    assert(en.ui.onboarding[k], 'нет EN-аналога ' + k);
  }
  assert(!ru.ui.onboarding.s4 && !en.ui.onboarding.s4, 'старый ключ s4 должен быть заменён на s4a/s4b/s4c');
  assert(!ru.ui.onboarding.s6 && !en.ui.onboarding.s6, 'старый ключ s6 должен быть заменён на s6ready/s6grade (ace#38)');
  // ace#41: тостовые ключи онбординга — НЕ каллауты (лимит 40 не их), но
  // обязаны влезать в ширину тоста (одна строка 390px ≈ 60 симв) и быть
  // синхронными (синхронность уже проверена общим обходом ключей выше).
  for (const k of ['finalToast', 'shuttleToast', 'menuHint']) {
    assert(ru.ui.onboarding[k] && en.ui.onboarding[k], 'нет ui.onboarding.' + k);
    assert(ru.ui.onboarding[k].length <= 60, 'тост ' + k + ' длиннее 60 символов: ' + ru.ui.onboarding[k]);
    assert(en.ui.onboarding[k].length <= 60, 'EN-тост ' + k + ' длиннее 60 символов: ' + en.ui.onboarding[k]);
  }
  assert(game.onboarding.updateSelCount, 'updateSelCount не выставлен в game.onboarding');
  game.onboarding.updateSelCount(game, [{ dead: false }, { dead: false }]);
  const chip = document.body.querySelector('#sel-count');
  assert(chip && chip.classList.contains('is-on') && chip.textContent === ru.ui.selCount.replace('{n}', '2'),
    'чип sel-count не включился: ' + (chip && chip.textContent));
  game.onboarding.updateSelCount(game, [{ dead: false }]);
  assert(!chip.classList.contains('is-on'), 'чип не погас при одиночном выделении');
  pass('O7 RU/EN синхронны, плейсхолдеры совпадают, каллауты ≤40, чип работает');
});

// ---------- O9: ac_dbltap_hint_v1 + ac_ob_menu_hint_v1 в PROFILE_KEYS ----------
await phase('O9 PROFILE_KEYS', async () => {
  const NS = await import('./.sim/storage-ns.js');
  assert(NS.PROFILE_KEYS.includes('ac_dbltap_hint_v1'),
    'ac_dbltap_hint_v1 нет в PROFILE_KEYS — ключ переживёт смену профиля');
  // ace#41 GATE п.6: JIT-флаг меню — тоже ключ профиля (чистится при выходе).
  assert(NS.PROFILE_KEYS.includes('ac_ob_menu_hint_v1'),
    'ac_ob_menu_hint_v1 нет в PROFILE_KEYS — ключ переживёт смену профиля');
  pass('O9 ac_dbltap_hint_v1 + ac_ob_menu_hint_v1 в PROFILE_KEYS');
});

// ---------- O10: чужой модал → онбординг подавлен; закрыли → восстановлен ----------
await phase('O10 foreign modal suppress', async () => {
  // Свежий прогон до шага 1 (сборщик — шаг из баг-репорта владельца).
  game.startRaidHome('human', { forceNew: true });
  OB.startOnboarding(game);
  document.body.querySelector('#ob-legend').querySelector('.ob-legend-next').click();
  assert(game.onboarding.step === 1, 'O10 подготовка: не шаг 1');
  pump(1);
  const overlayRoot = document.body.querySelector('#ob-overlay');
  assert(overlayRoot, 'O10: корень онбординга не в DOM');
  assert(!document.body.classList.contains('ob-suppressed'), 'O10: подавление без модалки');

  // Открываем «чужой» модал как chests-ui: registerModal + видимый .overlay.
  const MODALS = await import('./.sim/modals.js');
  const chestLike = document.createElement('div');
  chestLike.id = 'chest-overlay';
  chestLike.className = 'overlay hidden';
  document.body.appendChild(chestLike);
  let closed = false;
  MODALS.registerModal('chests', () => { closed = true; });
  chestLike.classList.remove('hidden');
  pump(2); // два кадра rAF: подавление должно схлопнуться
  assert(document.body.classList.contains('ob-suppressed'), 'O10: нет ob-suppressed на body при открытом модале');
  assert(overlayRoot.classList.contains('ob-suppressed'), 'O10: корень онбординга без класса ob-suppressed');
  const callout = overlayRoot.querySelector('.ob-callout');
  assert(callout && !callout.classList.contains('is-on'), 'O10: каллаут не погашен при модале');
  // Шаг НЕ тронут: ни advance, ни потеря состояния.
  assert(game.onboarding.step === 1 && body().contains('ob-step-1'), 'O10: шаг потерян при подавлении');
  assert(game.onboarding.active === true, 'O10: онбординг деактивировался при модале');
  assert(game.raidSession.onboarding.step === 1, 'O10: шаг не персистится во время подавления');

  // Закрываем модал (как closeModal/unregister + hide()).
  chestLike.classList.add('hidden');
  MODALS.unregisterModal('chests');
  assert(closed === false, 'O10: close не должен зваться при ручном закрытии теста');
  pump(2);
  assert(!document.body.classList.contains('ob-suppressed'), 'O10: ob-suppressed не снят после закрытия модала');
  assert(!overlayRoot.classList.contains('ob-suppressed'), 'O10: корень не восстановлен');
  assert(game.onboarding.step === 1, 'O10: после модала шаг не 1');
  assert(body().contains('ob-step-1'), 'O10: после модала нет ob-step-1');
  pump(1);
  const callout2 = overlayRoot.querySelector('.ob-callout');
  assert(callout2 && callout2.classList.contains('is-on') && callout2.textContent.length > 0,
    'O10: каллаут шага 1 не вернулся после закрытия модала');
  // Симметрия: завершение шага работает СРАЗУ после восстановления.
  game.state.selection = [getWorker()];
  game.onboarding.onUnitPicked(game, getWorker());
  assert(game.onboarding.step === 2, 'O10: после модала выделение не двинуло на шаг 2');
  // (Голый .overlay без реестра — путь document.querySelector — проверяется
  // живым playwright-прогоном: FakeEl не умеет сложные селекторы.)
  chestLike.remove();
  pass('O10 чужой модал: онбординг спрятан (ob-suppressed, каллаут погашен), шаг сохранён; закрыли — шаг 1 вернулся, завершение работает');
});

// ---------- O11 (ace#25 fix, коорд. итер.): DOM-цель шага 7 — геометрия дырки/каллаута ----------
// Регресс бага приёмки: спотлайт блока «Развитие» (.sel-dev) был узкой «щелью»
// во весь экран. Проверки: (1) дырка = живой rect элемента ±pad; (2) каллаут
// рядом с дыркой, не в углу; (3) нулевой rect → дырка СКРЫТА (не растягивается);
// (4) гигантский rect (кривая геометрия) → дырка тоже скрыта (санитарный лимит).
await phase('O11 dom-target geometry', () => {
  game.startRaidHome('human', { forceNew: true });
  OB.startOnboarding(game);
  document.body.querySelector('#ob-legend').querySelector('.ob-legend-next').click();
  // Прыжок на шаг 7 (как в живом стенде): КЦ выделен, панель КЦ отрисована.
  // Берём НАСТОЯЩИЙ КЦ базы (ccB() в onboarding.js находит именно его).
  const st = game.state;
  const cc = st.buildings.find((b) => !b.dead && b.side === 'player' && b.type === 'cc');
  assert(cc, 'нет КЦ в свежей базе');
  cc.done = true;
  st.selection = [cc];
  game.onboarding.step = 7;
  body().add('ob-step-7');
  // «Блок Развитие» панели КЦ: FakeEl с getBoundingClientRect-заглушкой.
  const selInfo = document.getElementById('sel-info');
  const dev = document.createElement('div');
  dev.className = 'sel-dev';
  const RECT = { left: 100, top: 200, width: 120, height: 80, right: 220, bottom: 280 };
  dev._rect = RECT;
  selInfo.appendChild(dev);
  pump(1); // ui.js может пересобрать панель (смена sig выделения) и стереть стаб
  selInfo.appendChild(dev);
  const holeEl = document.body.querySelector('#ob-overlay').querySelector('#ob-hole');
  const callout = document.body.querySelector('#ob-overlay').querySelector('.ob-callout');
  const rectOf = (n) => ({
    x: parseFloat(n.style.left), y: parseFloat(n.style.top),
    w: parseFloat(n.style.width), h: parseFloat(n.style.height),
  });
  pump(2);
  // (1) дырка = rect ± pad(8) + зазор G(12) по каждой стороне.
  const hole = rectOf(holeEl);
  assert(hole.w > 0 && hole.h > 0, 'дырка DOM-цели не нарисована');
  assert(Math.abs(hole.x - (RECT.left - 20)) <= 1, `дырка X не по rect: ${hole.x}`);
  assert(Math.abs(hole.y - (RECT.top - 20)) <= 1, `дырка Y не по rect: ${hole.y}`);
  assert(Math.abs(hole.w - (RECT.width + 40)) <= 1, `дырка W не по rect: ${hole.w}`);
  assert(Math.abs(hole.h - (RECT.height + 40)) <= 1, `дырка H не по rect: ${hole.h}`);
  // (2) каллаут рядом с дыркой (центр в 200px от центра дырки).
  assert(callout.classList.contains('is-on') && callout.textContent.length > 0,
    'каллаут шага 7 скрыт/пуст при DOM-цели');
  const ccx = parseFloat(callout.style.left) + 150; // ~половина max-width 300
  const ccy = parseFloat(callout.style.top) + 20;
  const hcx = hole.x + hole.w / 2, hcy = hole.y + hole.h / 2;
  assert(Math.hypot(ccx - hcx, ccy - hcy) <= 200,
    `каллаут далеко от дырки: (${ccx.toFixed(0)},${ccy.toFixed(0)}) vs (${hcx.toFixed(0)},${hcy.toFixed(0)})`);
  // (3) нулевой rect (элемент скрыт) → дырка скрыта, НЕ растянута.
  dev._rect = { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 };
  pump(2);
  assert(parseFloat(holeEl.style.width) === 0 && parseFloat(holeEl.style.height) === 0,
    'нулевой rect не спрятал дырку');
  // (4) гигантский rect (кривая геометрия) → санитарный лимит прячет дырку.
  dev._rect = { left: 0, top: 0, width: 2000, height: 2000, right: 2000, bottom: 2000 };
  pump(2);
  assert(parseFloat(holeEl.style.width) === 0 && parseFloat(holeEl.style.height) === 0,
    'гигантский rect не должен рисовать дырку на весь экран');
  // Цель полностью за экраном: она должна получить scrollIntoView ещё до
  // рендера дырки (раньше ветка рендера срабатывала только для видимой цели).
  dev._rect = { left: 100, top: 900, width: 120, height: 80, right: 220, bottom: 980 };
  let scrolls = 0;
  dev.scrollIntoView = () => { scrolls++; dev._rect = RECT; };
  pump(2);
  assert(scrolls === 1 && parseFloat(holeEl.style.width) > 0, 'цель за экраном не была прокручена');
  pass('O11 DOM-цель: дырка = rect ±pad, каллаут рядом; нулевой/гигантский rect → дырка скрыта');
});

// ---------- O12 (приёмка 05.11): dim-полосы НЕ запирают HUD ----------
// Баг владельца: dim-полосы (pointer-events:auto) лежали ПОВЕРХ топбара
// (Выход/Пауза/звук) и зум-кнопок — «кнопка выход не даёт ничего нажать»,
// «не вижу кнопки зума». Проверка (геометрия как на телефоне 390x844:
// топбар 52px, зум-кнопки у правого края над нижней панелью): НИ одна
// dim-полоса не пересекает ни полосу топбара, ни прямоугольник зума; дырка
// шага по-прежнему окружена полосами.
await phase('O12 dim не запирает HUD (топбар/зум тапабельны)', () => {
  game.startRaidHome('human', { forceNew: true });
  OB.startOnboarding(game);
  document.body.querySelector('#ob-legend').querySelector('.ob-legend-next').click();
  assert(game.onboarding.step === 1, 'не шаг 1');
  const topbar = document.getElementById('topbar');
  const zc = document.getElementById('zoom-controls');
  topbar.offsetHeight = 52;
  topbar._rect = { left: 0, top: 0, width: 390, height: 52, right: 390, bottom: 52 };
  zc.hidden = false;
  zc._rect = { left: 228, top: 542, width: 152, height: 52, right: 380, bottom: 594 };
  pump(2);
  const overlay = document.body.querySelector('#ob-overlay');
  const dims = overlay.children.filter((c) => c.className === 'ob-dim');
  const rectOf = (n) => ({
    x: parseFloat(n.style.left), y: parseFloat(n.style.top),
    w: parseFloat(n.style.width), h: parseFloat(n.style.height),
  });
  const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const TOPBAR = { x: 0, y: 0, w: 390, h: 52 };
  const ZOOM = { x: 228, y: 542, w: 152, h: 52 };
  let active = 0;
  for (const d of dims) {
    const r = rectOf(d);
    if (!(r.w > 0 && r.h > 0)) continue;
    active++;
    assert(!hit(r, TOPBAR), `полоса накрывает топбар: ${JSON.stringify(r)}`);
    assert(!hit(r, ZOOM), `полоса накрывает зум-кнопки: ${JSON.stringify(r)}`);
  }
  assert(active >= 4, `полос слишком мало: ${active}`);
  // Дырка шага 1 окружена: снизу есть полоса ниже дырки (каркас не сломан).
  const hole = rectOf(document.body.querySelector('#ob-hole'));
  assert(hole.h > 0 && hole.y >= 56, `дырка в HUD-зоне/не нарисована: ${JSON.stringify(hole)}`);
  pass('O12 dim не запирает HUD: ни одна полоса не лежит на топбаре/зуме');
});

// ---------- O13 (QA-пачка 05.11; ace#38): шаг 6 — дельта-найм открывает 6б, а не 7 ----------
await phase('O13 step6 delta hire → 6б', () => {
  game.startRaidHome('human', { forceNew: true });
  OB.startOnboarding(game);
  document.body.querySelector('#ob-legend').querySelector('.ob-legend-next').click();
  const st = game.state;
  // QA#4: свежая база УЖЕ несёт предспавненных маринов (стартовый отряд).
  const m0 = st.units.filter((u) => !u.dead && u.side === 'player' && u.type === 'marine').length;
  assert(m0 > 0, 'на свежей базе нет предспавненных marine — кейс нерепрезентативен');
  const bar = { id: 'ob-bar6', type: 'barracks', side: 'player', done: true, dead: false, tx: 12, ty: 12, w: 3, h: 2, level: 1, queue: [] };
  st.buildings.push(bar);
  game.onboarding.step = 6;
  game.onboarding.sub6b = false;
  game.onboarding.m0 = m0; // как beginStep(6): baseline на начало шага
  document.body.classList.add('ob-step-6');
  pump(3);
  assert(game.onboarding.step === 6 && game.onboarding.sub6b === false,
    'предспавненные marines не должны закрывать шаг 6 / включать 6б');
  // Найм ВО ВРЕМЯ шага: дельта от baseline → 6б (НЕ 7, ace#38).
  st.units.push({ id: 'new1', kind: 'unit', side: 'player', type: 'marine', dead: false, x: 0, y: 0 });
  pump(2);
  assert(game.onboarding.step === 6 && game.onboarding.sub6b === true,
    'дельта-найт не включил 6б');
  pass('O13 шаг 6: предспавн 2 marine шаг не закрывает; новый найм (+1 к baseline) — включает 6б');
});

// ---------- O19: свобода выделения, чип и resume ----------
await phase('O19 step6 re-action/chip/resume', () => {
  game.startRaidHome('human', { forceNew: true });
  OB.startOnboarding(game);
  document.body.querySelector('#ob-legend').querySelector('.ob-legend-next').click();
  const st = game.state;
  const bar = { id: 'ob-bar19', type: 'barracks', side: 'player', done: true, dead: false, tx: 12, ty: 12, w: 3, h: 2, level: 1, queue: [] };
  st.buildings.push(bar);
  game.onboarding.step = 6;
  game.onboarding.sub6b = false;
  game.onboarding.m0 = st.units.filter((u) => !u.dead && u.side === 'player' && u.type === 'marine').length;
  document.body.classList.add('ob-step-6');
  const cal = document.body.querySelector('#ob-overlay').querySelector('.ob-callout');
  // (а) Снятие выделения не перехватывается; подсказка объясняет, что выбрать.
  st.selection = [];
  pump(2);
  assert(st.selection.length === 0, 'онбординг не должен перехватывать выделение');
  assert(cal.textContent === ru.ui.onboarding.selectBarracks, 'подсказка выбора казармы: ' + cal.textContent);
  st.selection = [bar]; pump(1);
  assert(cal.textContent === ru.ui.onboarding.s6ready, '6а каллаут: ' + cal.textContent);
  const chipOf = () => document.body.querySelector('#ob-overlay').querySelector('#ob-next');
  assert(chipOf().style.display !== 'block', 'чип «Далее» виден в 6а (должен быть только в 6б)');
  // (б) На 6б тоже сохраняется свобода выбора; чип остаётся доступен.
  bar.queue.push({ type: 'marine' });
  pump(2);
  assert(game.onboarding.sub6b === true, '6б не включился');
  st.selection = [];
  pump(10); // 10 кадров pump — чип один, слушатель один, состояние стабильно
  assert(st.selection.length === 0, '6б не должен перехватывать выделение');
  assert(cal.textContent === ru.ui.onboarding.selectBarracks, '6б подсказка выбора: ' + cal.textContent);
  st.selection = [bar]; pump(1);
  assert(cal.textContent === ru.ui.onboarding.s6grade, '6б каллаут: ' + cal.textContent);
  const chip = chipOf();
  assert(chip.style.display === 'block', 'чип «Далее» не показан в 6б');
  const countById = (node, id) => (node.children || []).reduce((n, c) =>
    n + (c.id === id ? 1 : 0) + countById(c, id), 0);
  assert(countById(document.body.querySelector('#ob-overlay'), 'ob-next') === 1,
    '10 кадров pump плодят дубли чипа');
  assert((chip._handlers.click || []).length === 1, '10 кадров плодят слушатели чипа');
  assert(game.onboarding.step === 6, '6б сам не должен уезжать с шага 6');
  // (б2) ace#41 GATE п.3: начатый грейд казармы (gradeUp) в 6б НЕ двигает шаг,
  // НЕ гасит чип и НЕ меняет каллаут — «покупка не завершает шаг», выход
  // из 6б только чипом «Далее».
  bar.gradeUp = { to: 2, t: 90, total: 90, cost: 90 };
  pump(4);
  assert(game.onboarding.step === 6 && game.onboarding.sub6b === true,
    'начатый грейд казармы двинул шаг из 6б');
  assert(chipOf().style.display === 'block', 'начатый грейд погасил чип «Далее»');
  assert(cal.textContent === ru.ui.onboarding.s6grade, 'начатый грейд сменил каллаут 6б');
  delete bar.gradeUp;
  // (в) Resume на 6б восстанавливает сохранённый признак найма.
  game.raidSession.onboarding = { v: 1, done: false, skipped: false, step: 6, sub6b: true };
  OB.startOnboarding(game);
  // startOnboarding пересобирает корень — каллаут/чип перезапрашиваем.
  const cal2 = document.body.querySelector('#ob-overlay').querySelector('.ob-callout');
  assert(game.onboarding.active === true && game.onboarding.step === 6, 'resume не вернул шаг 6');
  assert(game.onboarding.sub6b === true, 'resume не восстановил сохранённую подфазу 6б');
  assert(st.selection.length === 1 && st.selection[0] === bar,
    'resume 6б не выделил казарму программно');
  pump(1);
  assert(cal2.textContent === ru.ui.onboarding.s6grade, 'resume 6б каллаут: ' + cal2.textContent);
  assert(chipOf().style.display === 'block', 'resume 6б без чипа «Далее»');
  // (г) чип кликабелен → 7.
  chipOf().click();
  pump(1);
  assert(game.onboarding.step === 7, 'клик чипа на resume-6б не двинул на шаг 7');
  pass('O19 шаг 6: свобода выделения, чип один, resume 6б и переход к шагу 7');
});

// Проверка продолжения на 6а: построенная казарма не означает найм.
await phase('resume step6 before hire', () => {
  const st = game.state;
  game.raidSession.onboarding = { v: 1, done: false, skipped: false, step: 6 };
  const bar = st.buildings.find((b) => b.type === 'barracks' && b.done);
  bar.queue = [];
  OB.startOnboarding(game); pump(1);
  assert(!game.onboarding.sub6b, 'перезагрузка не должна подменять найм');
  assert(document.body.querySelector('#ob-next').style.display !== 'block', 'кнопка далее до найма');
});

await phase('wrong selections and missed crystal', () => {
  game.startRaidHome('human', { forceNew: true });
  OB.startOnboarding(game);
  document.body.querySelector('#ob-legend').querySelector('.ob-legend-next').click();
  const st = game.state;
  const other = st.units.find((u) => u.side === 'player' && u.type !== 'worker');
  st.selection = [other]; game.onboarding.onUnitPicked(game, other); pump(1);
  assert(game.onboarding.step === 1, 'другой юнит не должен завершать выбор сборщика');
  const worker = getWorker();
  st.selection = [worker]; game.onboarding.onUnitPicked(game, worker);
  st.selection = [other]; game.onboarding.onDoubleSelect(game); pump(1);
  assert(game.onboarding.step === 2, 'двойной выбор бойцов не должен завершать шаг сборщиков');
  st.selection = [worker]; game.onboarding.onDoubleSelect(game); pump(1);
  assert(game.onboarding.step === 3, 'двойной выбор сборщиков должен работать');
  st.selection = []; pump(1);
  assert(document.body.querySelector('#ob-callout').textContent === ru.ui.onboarding.selectWorker,
    'после потери выделения нужна подсказка');
  st.selection = [worker];
  const c = st.map.crystals.find((v) => v.amount > 0 && st.fog.tileExplored(v.tx, v.ty));
  game.hooks.issueRMB((c.tx - 0.01) * TILE, (c.ty + 0.5) * TILE); pump(1);
  assert(game.onboarding.step === 3, 'промах рядом с жилой не должен считаться добычей');
  game.hooks.issueRMB((c.tx + 0.5) * TILE, (c.ty + 0.5) * TILE); pump(1);
  assert(game.onboarding.step === 4, 'принятый приказ добычи должен засчитываться');
  pass('выбор бойца, потеря выделения и промах по жиле не ломают обучение');
});

// Проверяем именно реальные правила движка, а не имитацию успешного клика.
await phase('placement freedom and resume', async () => {
  const B = await import('./.sim/buildings.js');
  game.startRaidHome('human', { forceNew: true });
  OB.startOnboarding(game);
  document.body.querySelector('#ob-legend').querySelector('.ob-legend-next').click();
  const st = game.state;
  st.selection = [getWorker()];
  game.onboarding.step = 4;
  const cc = st.buildings.find((b) => b.side === 'player' && b.type === 'cc');
  st.placing = { type: 'depot', tx: cc.tx, ty: cc.ty };
  const count = st.buildings.length;
  game.hooks.tryPlace(cc.tx, cc.ty); // занято КЦ
  assert(st.buildings.length === count && st.placing && st.placing.type === 'depot',
    'неудачный тап не должен отменять размещение');
  let candidates = [];
  for (let y = 0; y < st.map.h - 2; y++) for (let x = 0; x < st.map.w - 2; x++) {
    if (!B.canPlace(st.map, x, y, 2, 2) || !B.zoneAllows(st, x, y, 2, 2)) continue;
    if (![0, 1].every((dy) => [0, 1].every((dx) => st.fog.tileExplored(x + dx, y + dy)))) continue;
    candidates.push({ x, y, d: Math.hypot(x - cc.tx, y - cc.ty) });
  }
  candidates.sort((a, b) => b.d - a.d);
  assert(candidates.length > 1, 'нет доступных мест для Дома');
  const spot = candidates[0];
  game.hooks.tryPlace(spot.x, spot.y);
  assert(st.buildings.some((b) => b.type === 'depot' && b.tx === spot.x && b.ty === spot.y),
    'Дом должен ставиться в любом разрешённом движком месте');
  assert(!st.placing, 'после успешного размещения учебного Дома серия завершается');
  // Имитируем reload между размещением и следующим кадром туториала.
  game.raidSession.onboarding.step = 4;
  game.syncRaidHomeSnapshot();
  game.startRaidHome();
  OB.startOnboarding(game);
  pump(2);
  assert(game.onboarding.step === 5, 'уже поставленный Дом после reload должен засчитываться');
  const state = game.state;
  const bar = { id: 'resume-bar', type: 'barracks', side: 'player', done: false, dead: false,
    progress: 0.5, tx: 10, ty: 10, w: 3, h: 2, queue: [] };
  state.buildings.push(bar);
  game.raidSession.onboarding.step = 5;
  OB.startOnboarding(game); pump(2);
  assert(game.onboarding.step === 5, 'нужно дождаться достройки казармы');
  assert(document.body.querySelector('#ob-callout').textContent === ru.ui.onboarding.resumeBuild, 'при отсутствии строителей нужна подсказка');
  state.units.find((u) => u.type === 'worker').order = { kind: 'build', target: bar };
  pump(1);
  assert(document.body.querySelector('#ob-callout').textContent.includes('50%'), 'нет прогресса после продолжения стройки');
  bar.done = true; pump(1);
  assert(game.onboarding.step === 6, 'достроенная казарма должна засчитываться после продолжения');
  pass('размещение: неудача сохраняет режим, дальнее допустимое место; resume Дома и казармы');
});

// ---------- O14 (ace#25, заказ владельца 05.11): капсулы ПОСЛЕ онбординга ----------
// Раньше: maybeShowOnEntry срабатывал при boot ДО онбординга (выход по гварду,
// shownThisSession не ставился), и после skip()/finish() капсулы в той же
// сессии были недостижимы. Проверки: (1) скип на легенде → капсулы открылись
// в ЭТОЙ же сессии на свободном экране (~1.5с); (2) чужой модал в момент
// скипа → капсулы ОТЛОЖЕНЫ и открылись после его закрытия.
await phase('O14 capsules after onboarding', async () => {
  const CH = await import('./.sim/chests-ui.js');
  const MODALS = await import('./.sim/modals.js');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const chestOverlay = () => document.body.querySelector('#chest-overlay');

  // (1) скип на легенде → капсулы в этой же сессии
  game.startRaidHome('human', { forceNew: true });
  OB.startOnboarding(game);
  assert(document.body.querySelector('.ob-skip'), 'нет «Пропустить» на легенде');
  document.body.querySelector('.ob-skip').click();
  assert(game.onboarding.skipped === true, 'скип не выставил флаг');
  assert(!chestOverlay() || chestOverlay().classList.contains('hidden'),
    'капсулы открылись ДО своей задержки (мгновенно поверх тура)');
  await sleep(2900); // 1500 (хук) + 900 (автопоказ) + запас
  let ov = chestOverlay();
  assert(ov && !ov.classList.contains('hidden'), 'после скипа капсулы НЕ открылись в этой же сессии');
  ov.querySelector('#chest-close').click(); // закрыть как игрок
  assert(chestOverlay().classList.contains('hidden'), 'панель капсул не закрылась');

  // (2) чужой модал в момент скипа → отложено до его закрытия
  CH._debug.resetPostOnboarding();
  game.startRaidHome('human', { forceNew: true });
  OB.startOnboarding(game);
  const foreign = document.createElement('div');
  foreign.id = 'commander-overlay';
  document.body.appendChild(foreign);
  MODALS.registerModal('commander', () => {});
  document.body.querySelector('.ob-skip').click();
  await sleep(2900);
  assert(!chestOverlay() || chestOverlay().classList.contains('hidden'),
    'капсулы открылись ПОВЕРХ чужого модала');
  MODALS.unregisterModal('commander');
  foreign.remove();
  await sleep(2400); // ≤500 (очередь) + 900 (автопоказ) + запас
  ov = chestOverlay();
  assert(ov && !ov.classList.contains('hidden'), 'после закрытия модала капсулы не открылись');
  ov.querySelector('#chest-close').click();
  pass('O14 скип → капсулы открылись в этой же сессии; при чужом модале — отложены до его закрытия');
});

// ---------- O15 (ace#35): idle-старт, скип-kindness, канон восстановления ----------
await phase('O15 idle-start / skip-kindness / restore-canon', async () => {
  const wOf = () => game.state.units.filter((u) => !u.dead && !u.garrison &&
    u.side === 'player' && u.type === 'worker');
  // (а) Свежая база: оба стартовых сборщика СТОЯТ у КЦ (order=idle) —
  // авто-добычи больше нет (raid.js populateRaidState, ace#35).
  game.startRaidHome('human', { forceNew: true });
  let ws = wOf();
  assert(ws.length === 2, 'стартовых сборщиков не 2: ' + ws.length);
  assert(ws.every((u) => u.order && u.order.kind === 'idle'),
    'стартовые сборщики не стоят: ' + ws.map((u) => u.order && u.order.kind).join(','));
  // (б) Скип на легенде → kindness: программный gather обоим простоям через
  // публичный game.hooks.issueRMB (onboarding.js autoGatherWorkers).
  OB.startOnboarding(game);
  assert(game.onboarding.active === true, 'онбординг не активен (O15)');
  const skipO15 = document.body.querySelector('.ob-skip');
  assert(skipO15, 'нет «Пропустить» на легенде (O15)');
  skipO15.click();
  assert(game.onboarding.skipped === true, 'скип не выставлен (O15)');
  ws = wOf();
  assert(ws.length === 2 && ws.every((u) => u.order && u.order.kind === 'gather'),
    'после скипа сборщики не добыча: ' + ws.map((u) => u.order && u.order.kind).join(','));
  // (в) Восстановление сейва (homeDto уже есть — re-populate БЕЗ forceNew):
  // канон НЕ меняется — рабочие при гидратации сразу добыча (autoGather),
  // как у старых профилей.
  game.startRaidHome('human', {});
  ws = wOf();
  assert(ws.length === 2, 'после восстановления сборщиков не 2');
  assert(ws.every((u) => u.order && u.order.kind === 'gather'),
    'канон восстановления сломан: рабочие при restore не добыча');
  pass('O15 сборщики стоят; скип → программная добыча; восстановление сейва — канон (сразу добыча)');
});

// ---------- O16 (ace#34, merge wave34): тоггл языка на легенде — тур НЕ перезапускается ----------
// Переименовано из O15 (ace#34) при слиянии: имя O15 занято idle-спавном
// ace#35. Кейс владельца: язык, выбранный на главной, должен быть сменяем и на легенде
// онбординга (шаг 0). Проверки: клик по тогглу меняет язык (persist в
// terrranrts.language — канон i18n), тексты легенды/«Пропустить» — на активном
// языке, активная кнопка подсвечена; шаг/флаги не трогаются (легенда остаётся
// открыта на шаге 0), «Далее» продолжает тур штатно, «Пропустить» работает.
await phase('O16 legend lang toggle', async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  assert(ru.ui.onboarding.legend1 !== en.ui.onboarding.legend1,
    'локали неотличимы — кейс нерепрезентативен');
  // Свежая сессия → легенда (шаг 0, RU).
  game.startRaidHome('human', { forceNew: true });
  OB.startOnboarding(game);
  const legend = document.body.querySelector('#ob-legend');
  assert(legend && legend.classList.contains('is-on'), 'легенда не открыта');
  assert(game.onboarding.step === 0, 'не шаг 0');
  const langRow = legend.querySelector('#ob-legend-lang');
  assert(langRow, 'тоггл языка не в карточке легенды');
  const btns = langRow.querySelectorAll('.auth-lang-btn');
  assert(btns.length === 2, `кнопок языка ${btns.length} вместо 2`);
  const ruBtn = btns.find((b) => b.dataset.lang === 'ru');
  const enBtn = btns.find((b) => b.dataset.lang === 'en');
  assert(ruBtn && enBtn, 'нет кнопок ru/en');
  assert(ruBtn.classList.contains('is-on') && !enBtn.classList.contains('is-on'),
    'RU не подсвечен как активный');
  const skip = document.body.querySelector('#ob-overlay').querySelector('.ob-skip');
  assert(skip.classList.contains('is-on'), '«Пропустить» не показана на легенде');

  // Клик EN: язык сменён (persist), тексты — EN, тур НЕ перезапущен.
  enBtn.click();
  await sleep(40); // setLocale — динамический импорт словаря
  assert(localStorage.getItem('terranrts.language') === 'en', 'язык не персистится (EN)');
  assert(legend.querySelector('.ob-legend-title').textContent === en.ui.raid.planetName,
    'заголовок легенды не EN');
  assert(legend.querySelector('.ob-legend-l1').textContent === en.ui.onboarding.legend1,
    'строка l1 не EN');
  assert(legend.querySelector('.ob-legend-next').textContent === en.ui.onboarding.next,
    '«Далее» не EN');
  assert(skip.textContent === en.ui.onboarding.skip, '«Пропустить» не EN');
  assert(enBtn.classList.contains('is-on') && !ruBtn.classList.contains('is-on'),
    'EN не подсвечен после смены');
  assert(game.onboarding.step === 0 && game.onboarding.active === true,
    'тур сбросился/перезапустился при смене языка');
  assert(legend.classList.contains('is-on') && body().contains('ob-legend-open') &&
    body().contains('ob-step-0'), 'легенда/классы шага 0 потеряны при смене языка');

  // Обратный клик RU: полный round-trip EN↔RU без перезапуска.
  ruBtn.click();
  await sleep(40);
  assert(localStorage.getItem('terranrts.language') === 'ru', 'язык не персистится (RU)');
  assert(legend.querySelector('.ob-legend-title').textContent === ru.ui.raid.planetName,
    'заголовок легенды не вернулся на RU');
  assert(legend.querySelector('.ob-legend-l1').textContent === ru.ui.onboarding.legend1,
    'строка l1 не RU');
  assert(ruBtn.classList.contains('is-on') && !enBtn.classList.contains('is-on'),
    'RU не подсвечен после возврата');
  assert(game.onboarding.step === 0, 'шаг потерян при возврате RU');

  // «Далее» — тур продолжается штатно: шаг 1, каллаут на активном (RU) языке.
  legend.querySelector('.ob-legend-next').click();
  assert(game.onboarding.step === 1 && !body().contains('ob-legend-open'),
    'после легенды не шаг 1');
  pump(2);
  const callout = document.body.querySelector('#ob-overlay').querySelector('.ob-callout');
  assert(callout && callout.textContent === ru.ui.onboarding.s1,
    `каллаут шага 1 не RU: "${callout && callout.textContent}"`);
  assert(skip.textContent === ru.ui.onboarding.skip, '«Пропустить» шага 1 не RU');

  // «Пропустить» после всех переключений работает (стек онбординга не задет).
  skip.click();
  assert(game.onboarding.done === true && game.onboarding.skipped === true,
    'скип после смен языка не выставил флаги');
  assert(!body().contains('ob-active'), 'после скипа ob-active снят');
  pass('O16 легенда: EN↔RU через тоггл без перезапуска тура; тексты/скип на активном языке; «Далее» и «Пропустить» работают');
});


// ---------- O17/O18 (финальный QA 06.11): живая верификация на playwright.
// FakeEl не считает CSS-layout, поэтому rect-ассерты скипа/топбара и
// reload-язык проверяются только живым браузером (паттерн sim_ui_matrix:
// свои серверы на своих портах, чтобы сим был самодостаточным из клона).
if (!process.env.SIM_OB_HEADLESS_ONLY) {
  const OB_STATIC_PORT = Number(process.env.SIM_OB_STATIC_PORT || 8902);
  const OB_API_PORT = Number(process.env.SIM_OB_API_PORT || 8903);
  const OB_URL = `http://127.0.0.1:${OB_STATIC_PORT}/r/index.html`;
  const REPO = new URL('../', import.meta.url).pathname;
  const { spawn } = await import('node:child_process');
  const procs = [];
  const start = (args, env) => {
    const p = spawn(process.execPath, args, { cwd: REPO, env: { ...process.env, ...env }, stdio: 'ignore' });
    procs.push(p); return p;
  };
  // временная БД на прогон: O18 проверяет «первое касание» — чужие профили
  // в постоянной БД изменили бы гейт входа (пин-пад вместо гостя)
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const obTmp = mkdtempSync(join(tmpdir(), 'ac-ob-live-'));
  start(['server/save-server.mjs'], { PORT: String(OB_API_PORT), DB_PATH: join(obTmp, 'saves.db') });
  start(['server/static.mjs'], { PORT: String(OB_STATIC_PORT), API_PORT: String(OB_API_PORT) });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    await sleep(250);
    try {
      const res = await fetch(OB_URL);
      up = res.ok && /game-canvas/.test(await res.text());
    } catch { /* ещё не поднялся */ }
  }
  try {
    if (!up) throw new Error('живой стенд сима не поднялся (static/save-сервер)');
    let pw = null;
    const PWCAND = '/opt/homebrew/lib/node_modules/@playwright/test/node_modules';
    for (const c of ['playwright',
      process.env.PLAYWRIGHT_DIR && join(process.env.PLAYWRIGHT_DIR, 'playwright', 'index.mjs'),
      existsSync(join(PWCAND, 'playwright', 'index.mjs')) && join(PWCAND, 'playwright', 'index.mjs'),
    ].filter(Boolean)) {
      try { pw = await import(c); break; } catch { /* следующий кандидат */ }
    }
    if (!pw) throw new Error('playwright не найден: npm i playwright, либо PLAYWRIGHT_DIR=<node_modules>');

    const { chromium } = pw;
    const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] } : {});
    const overlap = (a, b) => a && b && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

    await phase('O17 skip vs топбар (live 320/344/390/430, RU+EN)', async () => {
      let checks = 0;
      for (const W of [320, 344, 390, 430]) {
        for (const lang of ['ru', 'en']) {
          const ctx = await browser.newContext({ viewport: { width: W, height: 844 }, hasTouch: true, isMobile: true, locale: lang === 'ru' ? 'ru-RU' : 'en-US' });
          await ctx.addInitScript((l) => { try { localStorage.setItem('terranrts.language', l); } catch {} }, lang);
          const page = await ctx.newPage();
          const errors = [];
          page.on('pageerror', (e) => errors.push(String(e)));
          const tag = `${W}/${lang}`;
          await page.goto(OB_URL);
          // гейт входа: свежий контекст — экран входа → «гость» (как ob_walkthrough)
          for (let i = 0; i < 60; i++) {
            if (await page.evaluate(() => !!document.getElementById('ob-legend'))) break;
            const which = await page.evaluate(() => {
              const foot = document.getElementById('auth-foot-guest');
              if (foot && foot.getBoundingClientRect().width) return '#auth-foot-guest';
              const sg = document.getElementById('slots-guest');
              if (sg && sg.getBoundingClientRect().width) return '#slots-guest';
              return null;
            });
            if (which) { await page.click(which); await sleep(300); continue; }
            await sleep(500);
          }
          await page.waitForFunction(() => window.game && window.game.started && window.game.onboarding, null, { timeout: 30000 });
          await sleep(1200);
          // легенда — фулскрин-карточка шага 0: закрываем, проверяем боевой шаг
          const nextBtn = await page.$('.ob-legend-next');
          if (nextBtn) { await nextBtn.click(); await sleep(1000); }
          const r = await page.evaluate(() => {
            const rect = (el) => { if (!el) return null; const b = el.getBoundingClientRect();
              return { x: b.x, y: b.y, width: b.width, height: b.height }; };
            const skip = document.querySelector('.ob-skip.is-on');
            const exit = document.getElementById('btn-exit');
            const ids = ['btn-exit', 'btn-restart', 'btn-pause', 'btn-sound', 'res-objective', 'res-minerals', 'res-supply'];
            const tb = {};
            for (const id of ids) tb[id] = rect(document.getElementById(id));
            const hit = (x, y) => { const el = document.elementFromPoint(x, y); return el ? (el.id || String(el.className)) : 'null'; };
            return {
              skipText: skip ? skip.textContent : null, skip: rect(skip), exit: rect(exit), tb,
              vw: window.innerWidth, vh: window.innerHeight,
              hitExit: exit ? hit(rect(exit).x + 22, rect(exit).y + 22) : 'no-exit',
              hitSkip: skip ? hit(rect(skip).x + rect(skip).width / 2, rect(skip).y + 22) : 'no-skip',
            };
          });
          if (W === 320) {
            // Реальная типографика и CSS в обеих локалях: проверяем не число
            // символов, а высоту каждой подсказки в узком мобильном окне.
            const wrapped = await page.evaluate(async (language) => {
              const dict = (await import('./locales/' + language + '.js?v=11030130')).default.ui.onboarding;
              const el = document.querySelector('.ob-callout');
              const old = el.textContent;
              const keys = ['s1', 's2', 's3', 's4a', 's4b', 's4c', 's4plan', 's4paths', 's4touch', 's4mouse', 's4mousePlace', 'resumeBuild', 'noWorker', 'selectWorker', 'selectBarracks', 'buildBarracks', 'placingOther', 's5', 's6ready', 's6grade', 's7'];
              const bad = keys.filter((key) => { el.textContent = dict[key]; return el.getBoundingClientRect().height > 44; });
              el.textContent = old;
              return bad;
            }, lang);
            assert(wrapped.length === 0, `${tag}: подсказки переносятся на две строки: ${wrapped.join(', ')}`);
          }
          assert(r.skip && r.skip.width > 0, `${tag}: «Пропустить» не видна`);
          checks++;
          assert(r.hitExit === 'btn-exit', `${tag}: elementFromPoint(центр «Выхода»)=${r.hitExit}, не btn-exit`);
          assert(/ob-skip/.test(String(r.hitSkip)), `${tag}: elementFromPoint(центр скипа)=${r.hitSkip}`);
          let clash = null;
          for (const [id, rr] of Object.entries(r.tb)) if (rr && rr.width > 0 && overlap(r.skip, rr)) clash = id;
          assert(!clash, `${tag}: skip пересекает топбар-элемент ${clash}`);
          assert(r.skip.x >= 0 && r.skip.x + r.skip.width <= r.vw && r.skip.y >= 0,
            `${tag}: skip вне экрана: ${JSON.stringify(r.skip)}`);
          const wantLabel = lang === 'ru' ? 'Пропустить' : 'Skip';
          assert(r.skipText === wantLabel, `${tag}: подпись скипа "${r.skipText}", ждём "${wantLabel}"`);
          assert(errors.length === 0, `${tag}: pageerror: ${errors[0]}`);
          // Проверяем именно многострочную подсказку размещения для обоих профилей,
          // а не только длину отдельных строк из словаря.
          await page.evaluate(() => {
            const g = window.game, st = g.state;
            g.onboarding.step = 4;
            st.selection = [st.units.find(u => !u.dead && u.side === 'player' && u.type === 'worker')];
            st.placing = { type: 'depot', tx: -999, ty: -999 };
          });
          for (const profile of ['touch', 'desktop']) {
            await page.evaluate((p) => window.game.profile.set(p), profile);
            await sleep(350);
            const placement = await page.evaluate(async ({lang, profile}) => {
              const dict = (await import('./locales/' + lang + '.js?v=11030130')).default.ui.onboarding;
              const el = document.querySelector('.ob-callout'), hole = document.querySelector('#ob-hole');
              const r = el.getBoundingClientRect(), skip = document.querySelector('.ob-skip').getBoundingClientRect();
              return { text: el.textContent, want: [dict.s4c, dict.s4plan, dict.s4paths, ...(profile === 'touch' ? [dict.s4touch] : [dict.s4mouse, dict.s4mousePlace])].join('\n'),
                visible: el.classList.contains('is-on') && r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight,
                overlap: r.left < skip.right && skip.left < r.right && r.top < skip.bottom && skip.top < r.bottom,
                pointer: getComputedStyle(el).pointerEvents, width: parseFloat(hole.style.width), height: parseFloat(hole.style.height), ping: document.querySelector('#ob-ping').classList.contains('is-on') };
            }, {lang, profile});
            assert(placement.text === placement.want && placement.visible && !placement.overlap && placement.pointer === 'none' && placement.width === 0 && placement.height === 0 && !placement.ping,
              `${tag}/${profile}: размещение: ${JSON.stringify(placement)}`);
          }
          await page.screenshot({ path: `/tmp/finalfix-skip-${W}-${lang}.png` });
          await ctx.close();
        }
      }
      await browser.close();
      pass(`O17 live: skip целиком под топбаром, «Выход» и skip тапабельны (${checks} прогонов 320–430)`);
    });

    await phase('O18 язык после reload = сохранённому (live)', async () => {
      const browser2 = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] } : {}); // свой инстанс: O17 закрыл свой
      const ctx = await browser2.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'en-US' });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.goto(OB_URL);
      // гейт входа: свежий контекст — экран входа → «гость» (как в O17)
      for (let i = 0; i < 60; i++) {
        if (await page.evaluate(() => window.game && window.game.started)) break;
        const which = await page.evaluate(() => {
          const foot = document.getElementById('auth-foot-guest');
          if (foot && foot.getBoundingClientRect().width) return '#auth-foot-guest';
          const sg = document.getElementById('slots-guest');
          if (sg && sg.getBoundingClientRect().width) return '#slots-guest';
          return null;
        });
        if (which) { await page.click(which); await sleep(300); continue; }
        await sleep(500);
      }
      await page.waitForFunction(() => window.game && window.game.started, null, { timeout: 30000 });
      await sleep(1500);
      // первое касание: ключа не было → raid-boot ставит и ПРИМЕНЯЕТ ru (канон полигона)
      const first = await page.evaluate(() => ({
        key: localStorage.getItem('terranrts.language'),
        lang: document.documentElement.lang,
        setFn: typeof window.i18nSetLocale,
      }));
      assert(first.key === 'ru' && first.lang === 'ru', `первое касание без ключа → RU-канон, получено ${JSON.stringify(first)}`);
      assert(first.setFn === 'function', 'window.i18nSetLocale не выставлен (raid-boot не может применить RU)');
      const probe = async () => page.evaluate(() => ({
        key: localStorage.getItem('terranrts.language'),
        lang: document.documentElement.lang,
        exit: (document.getElementById('btn-exit') || {}).textContent || '',
      }));
      // saved ru + reload (браузер en-US — именно кейс QA: фолбэк не должен выиграть)
      await page.evaluate(() => localStorage.setItem('terranrts.language', 'ru'));
      await page.reload();
      await sleep(800);
      // гейт входа: свежий контекст — экран входа → «гость» (гейт после reload — слоты/вход снова доступны)
      for (let i = 0; i < 60; i++) {
        if (await page.evaluate(() => window.game && window.game.started)) break;
        const which = await page.evaluate(() => {
          const foot = document.getElementById('auth-foot-guest');
          if (foot && foot.getBoundingClientRect().width) return '#auth-foot-guest';
          const sg = document.getElementById('slots-guest');
          if (sg && sg.getBoundingClientRect().width) return '#slots-guest';
          return null;
        });
        if (which) { await page.click(which); await sleep(300); continue; }
        await sleep(500);
      }
      await page.waitForFunction(() => window.game && window.game.started, null, { timeout: 30000 });
      await sleep(1500);
      const ruSt = await probe();
      assert(ruSt.lang === 'ru' && ruSt.exit === 'Выход', `reload при saved ru → UI должен быть RU: ${JSON.stringify(ruSt)}`);
      // saved en + reload → EN остаётся EN
      await page.evaluate(() => localStorage.setItem('terranrts.language', 'en'));
      await page.reload();
      await sleep(800);
      // гейт входа: свежий контекст — экран входа → «гость» (как в O17)
      for (let i = 0; i < 60; i++) {
        if (await page.evaluate(() => window.game && window.game.started)) break;
        const which = await page.evaluate(() => {
          const foot = document.getElementById('auth-foot-guest');
          if (foot && foot.getBoundingClientRect().width) return '#auth-foot-guest';
          const sg = document.getElementById('slots-guest');
          if (sg && sg.getBoundingClientRect().width) return '#slots-guest';
          return null;
        });
        if (which) { await page.click(which); await sleep(300); continue; }
        await sleep(500);
      }
      await page.waitForFunction(() => window.game && window.game.started, null, { timeout: 30000 });
      await sleep(1500);
      const enSt = await probe();
      assert(enSt.lang === 'en' && enSt.exit === 'Exit', `reload при saved en → UI должен быть EN: ${JSON.stringify(enSt)}`);
      assert(errors.length === 0, `pageerror: ${errors[0]}`);
      await page.screenshot({ path: '/tmp/finalfix-lang-ru.png' });
      await ctx.close();
      await browser2.close();
      pass('O18 live: RU остаётся RU и EN остаётся EN после reload (браузер en-US); первое касание = RU');
    });
  } finally {
    for (const p of procs) { try { p.kill(); } catch { /* уже мёртв */ } }
  }
}

if (failures.length) {
  console.log('\nИТОГ: FAIL — упавшие фазы: ' + failures.join(', '));
  process.exit(1);
}
console.log(process.env.SIM_OB_HEADLESS_ONLY ? '\nИТОГ: PASS — headless-фазы; браузерные пропущены' : '\nИТОГ: PASS — все фазы зелёные');
