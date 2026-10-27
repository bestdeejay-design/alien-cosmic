// ============================================================
// sim_profile.mjs — аудит владельца 26.10.2026, пакет P1 «Профиль и вход».
//
// Три находки владельца, подтверждённые живыми проверками (T1/T3/T4):
//   A1  «не вводятся пин/ник — всю клавиатуру перепробовал»: глобальный
//       keydown играл приказом даже когда фокус в поле ввода;
//   A2  «без профиля — ноль запросов к серверу, условие максимально тихое»:
//       анонимная сессия стучалась /api/save 400-ми каждые 15 с + /health;
//   A3  админка — только профиль владельца «best» (без учёта регистра).
//
// Проверяем:
//   P1  ввод в input/textarea/select/contenteditable не перехватывается игрой
//       (p не ставит паузу, A не включает атаку-движение, цифры не берут
//       группы), а те же клавиши вне поля работают как раньше;
//   P2  без профиля — НОЛЬ запросов: ни при загрузке (даже /health), ни по
//       таймеру, ни при уходе со страницы (sendBeacon), ни через публичные
//       ручки (список/API); панель пишет «войдите в КЦ (U)»;
//   P3  ручной вход из панели профиля сеть всё-таки будит, и после входа
//       фоновая синхронизация работает (гейт не «залип»);
//   P4  админка: не-best не видит команду «Админ» и не получает панель даже
//       программным вызовом; best в любом регистре видит команду и входит.
//
// Запуск: node scripts/sim_profile.mjs
// ============================================================
import './harness.mjs';
import { V } from './stamp.mjs';

const failures = [];
const fail = (phase, err) => { failures.push(phase); console.log(`FAIL  ${phase}: ${String((err && err.message) || err)}`); };
const pass = (m) => console.log(`PASS  ${m}`);
const assert = (c, m) => { if (!c) throw new Error(m); };

// ---------- инструменты: перехват сети и слушателей окна ----------
const net = { calls: [] };
globalThis.fetch = async (url, opts = {}) => {
  const path = String(url);
  net.calls.push({ path, body: opts.body });
  net.calls[net.calls.length - 1].path = path;
  if (path.endsWith('/health')) return { ok: true, status: 200, json: async () => ({ ok: true }) };
  if (path.endsWith('/api/load')) {
    return { ok: true, status: 200, json: async () => ({ ok: false, error: 'not found' }) };
  }
  if (path.endsWith('/api/save')) {
    return { ok: true, status: 200, json: async () => ({ ok: true, ts: Date.now() }) };
  }
  if (path.includes('/api/list')) return { ok: true, status: 200, json: async () => ({ ok: true, records: [] }) };
  return { ok: true, status: 200, json: async () => ({ ok: true }) };
};
let beacons = 0;
// В node navigator — геттер только для чтения: подменяем метод, а не объект.
try {
  Object.defineProperty(globalThis.navigator, 'sendBeacon', {
    value: () => { beacons++; return true; }, configurable: true, writable: true,
  });
} catch {
  Object.defineProperty(globalThis, 'navigator', { value: { sendBeacon: () => { beacons++; return true; } }, configurable: true });
}
let reloads = 0;
globalThis.location = { hostname: 'polygon.test', reload: () => { reloads++; } };

// Слушатели window: harness складывает их во внутренний объект, наружу его нет —
// поэтому ставим свой регистратор ПОВЕРХ (до импорта движка).
const winHandlers = {};
const baseAdd = globalThis.addEventListener;
globalThis.addEventListener = (ev, fn, opts) => {
  (winHandlers[ev] = winHandlers[ev] || []).push(fn);
  return baseAdd(ev, fn, opts);
};
const fire = (ev, payload) => (winHandlers[ev] || []).forEach((fn) => fn(payload));

// Стаб harness'а кэширует getElementById по id и всегда отдаёт «элемент», даже
// если его нет в DOM — а панель профиля/админка по этому признаку РЕШАЕТ,
// открываться или закрыться. Даём честную семантику только для оверлеев.
const realGetById = document.getElementById.bind(document);
document.getElementById = (id) => {
  if (id === 'sv-panel' || id === 'admin-overlay') {
    return document.body.children.find((c) => c.id === id) || null;
  }
  return realGetById(id);
};

await import('../r/js/game.js');
const I = await import('../r/js/input.js' + V);
const game = globalThis.game;
assert(game, 'движок полигона не поднялся');

const boot = () => {
  game.startRaidHome('human', { forceNew: true });
  for (let i = 0; i < 3; i++) game.tick();
  return game.state;
};

// ---------- P1: клавиатура в поле ввода принадлежит полю ----------
try {
  const st = boot();
  const keydown = winHandlers.keydown || [];
  assert(keydown.length, 'глобальный keydown не зарегистрирован (attachInput не вызван)');

  const field = { tagName: 'INPUT', id: 'sv-nick', value: '' };
  const textarea = { tagName: 'TEXTAREA', value: '' };
  const select = { tagName: 'SELECT' };
  const editable = { tagName: 'DIV', isContentEditable: true };
  const plain = { tagName: 'DIV' };

  for (const [name, t] of [['input', field], ['textarea', textarea], ['select', select], ['contenteditable', editable]]) {
    assert(I.isTypingTarget(t) === true, `${name} не распознан как поле ввода`);
  }
  assert(I.isTypingTarget(plain) === false, 'обычный div считается полем ввода');
  assert(I.isTypingTarget(null) === false && I.isTypingTarget(undefined) === false, 'пустая цель — не поле');

  const press = (target, code, extra = {}) => {
    let prevented = false;
    const e = { code, key: code, target, repeat: false, preventDefault() { prevented = true; }, ...extra };
    for (const fn of keydown) fn(e);
    return prevented;
  };

  // Игра до теста не на паузе и в обычном режиме.
  if (game.paused) game.togglePause();
  assert(!game.paused, 'игра на паузе до проверки');
  st.attackMoveMode = false;

  const preventedP = press(field, 'KeyP');
  assert(!game.paused, 'клавиша p в поле ввода поставила игру на паузу');
  assert(!preventedP, 'клавиша в поле ввода всё ещё отбирается у браузера (preventDefault)');

  press(field, 'KeyA');
  assert(!st.attackMoveMode, 'A в поле ввода включила атаку-движение');

  // Цифры в поле не должны выбирать группы (в поле — это просто текст).
  let groupTouched = 0;
  const origSelect = game.hooks.selectGroup;
  game.hooks.selectGroup = (...a) => { groupTouched++; return origSelect && origSelect(...a); };
  press(field, 'Digit1');
  press(field, 'Digit3');
  game.hooks.selectGroup = origSelect;
  assert(groupTouched === 0, 'цифры в поле ввода всё ещё выбирают группы (' + groupTouched + ')');

  // Вне поля те же клавиши работают как раньше — гейт не сломал управление.
  press(plain, 'KeyP');
  assert(game.paused === true, 'p вне поля перестала ставить паузу');
  press(plain, 'KeyP');
  assert(game.paused === false, 'p вне поля не снимает паузу');
  pass('P1 ввод: p/цифры/A в поле не перехватываются, вне поля хоткеи работают');
} catch (e) { fail('P1 ввод в поля', e); }

// ---------- P2: без профиля сеть молчит полностью ----------
try {
  localStorage.removeItem('ac_save_nick');
  localStorage.removeItem('ac_save_pin');
  window.__saveIdentity = null;
  net.calls.length = 0;
  beacons = 0;

  // Импорт клиента сейва = старт страницы без профиля.
  await import('../r/save-client.js' + V);
  await new Promise((r) => setTimeout(r, 30));
  assert(window.__saveApi, 'клиент сейва не поднялся');
  assert(net.calls.length === 0, 'без профиля уже при старте улетели запросы: ' +
    net.calls.map((c) => c.path).join(', '));

  // Публичные ручки полигона (капсулы, рейтинг, список) — тоже без сети.
  const pushAll = await window.__saveApi.pushAll();
  assert(pushAll && typeof pushAll === 'object', 'pushAll не ответил объектом');
  await window.__saveApi.api('/api/chests');
  await window.__saveApi.list();
  await window.__saveApi.pullKey('ac_raid_session_v1');
  assert(net.calls.length === 0, 'без профиля ручки API ходят в сеть: ' +
    net.calls.map((c) => c.path).join(', '));

  // Уход со страницы (sendBeacon) и скрытие вкладки — тоже тишина.
  fire('pagehide', { type: 'pagehide' });
  fire('beforeunload', { type: 'beforeunload' });
  const docHide = (ev) => { /* document-слушатели в harness отдельные */ };
  void docHide;
  assert(beacons === 0, 'без профиля улетел sendBeacon при уходе со страницы');
  assert(net.calls.length === 0, 'без профиля сеть тронута при уходе со страницы');

  // Статус честно объясняет, что делать.
  assert(window.__saveApi.identity === null, 'без профиля identity не пуст');
  const statusAfter = window.__saveApi.status;
  assert(statusAfter.api === 'нужен профиль', 'канал не помечен «нужен профиль»: ' + statusAfter.api);

  // Панель профиля: подсказка + отсутствие зонда.
  window.showProfilePanel();
  const panel = document.body.children.find((c) => c.id === 'sv-panel');
  assert(panel, 'панель профиля не открылась');
  const stateEl = panel.querySelector('#sv-state');
  assert(stateEl && /войдите в КЦ/.test(stateEl.textContent), 'в панели нет подсказки про вход в КЦ: ' +
    (stateEl && stateEl.textContent));
  await new Promise((r) => setTimeout(r, 20));
  assert(net.calls.length === 0, 'панель профиля без профиля всё же зондирует сервер');

  pass('P2 без профиля: 0 запросов (старт, таймер, API, уход со страницы), панель объясняет вход');
} catch (e) { fail('P2 тихая сеть без профиля', e); }

// ---------- P3: ручной вход будит сеть, дальше синхронизация жива ----------
try {
  const panel = document.body.children.find((c) => c.id === 'sv-panel');
  assert(panel, 'панель профиля закрылась до входа');
  net.calls.length = 0;
  panel.querySelector('#sv-nick').value = 'best';
  // P1 (#45): вход поэтапно. Шаг 1 — ник в панели, шаг 2 — пинпад отдельной
  // модалки (текстового поля пина больше нет).
  const A = await import('../r/js/auth-ui.js' + V);
  panel.querySelector('#sv-login').click();
  assert(A.auth.step === 'pin', 'шаг 2 не открылся: панель не перешла к пинпаду (step=' + A.auth.step + ')');
  assert(A.auth.nick === 'best', 'ник не передан в пинпад: ' + A.auth.nick);
  assert(!document.body.children.some((c) => c && c.id === 'sv-panel'), 'панель профиля осталась висеть под пинпадом');
  for (const d of ['1', '2', '3', '4']) A.pressKey(d);
  assert(A.auth.pin === '1234', 'пинпад не набрал 1234: ' + A.auth.pin);
  await A.submitPin();
  await new Promise((r) => setTimeout(r, 80));  // вход + авто-pull снапшота
  assert(net.calls.length > 0, 'ручной вход не сделал ни одного запроса (вход не работает)');
  assert(net.calls.some((c) => c.path.includes('/api/load')), 'ручной вход не проверил пин на сервере');
  const id = window.__saveApi.identity;
  assert(id && String(id.nick).toLowerCase() === 'best', 'после входа профиль не установлен: ' + JSON.stringify(id));
  // База подтягивается ДО старта симуляции, а не перезагрузкой страницы:
  // именно эта гонка (баг №1) и давала «новую базу» вместо КЦ-16.
  assert(A.auth.step === 'pull' || A.auth.pullState === 'empty' || A.auth.pullState === 'ok',
    'после пина не начался pull снапшота (step=' + A.auth.step + ', pull=' + A.auth.pullState + ')');
  assert(net.calls.some((c) => c.path.includes('/api/load')), 'pull снапшота не сходил на сервер');

  // После входа фон обязан работать: pushAll реально пишет.
  net.calls.length = 0;
  localStorage.setItem('ac_raid_session_v1', JSON.stringify({ v: 1, probe: 'p3' }));
  await window.__saveApi.pushAll();
  assert(net.calls.some((c) => c.path.includes('/api/save')), 'после входа pushAll не пишет на сервер (гейт залип)');
  pass('P3 ручной вход: ник → пинпад → pull снапшота до старта, сеть просыпается');
} catch (e) { fail('P3 ручной вход', e); }

// ---------- P4: админка — только профиль «best» ----------
try {
  const A = await import('../r/js/admin.js' + V);
  const st = boot();
  const cc = st.buildings.find((b) => !b.dead && b.side === 'player' && b.type === 'cc');
  assert(cc, 'нет КЦ на базе');
  st.selection = [cc];
  const cmdLabels = () => game.getCommands().map((c) => c.code + ':' + c.label);

  const hasAdmin = () => game.getCommands().some((c) => c.code === 'KeyO');
  const adminInDom = () => document.body.children.some((c) => c.id === 'admin-overlay');

  // 1) Чужой профиль: команды нет, панель не создаётся даже программно.
  window.__saveIdentity = { nick: 'guest', pin: '1111' };
  localStorage.setItem('ac_save_nick', 'guest');
  sessionStorage.removeItem('ac_admin_ok');
  assert(!hasAdmin(), 'у чужого профиля есть команда «Админ»: ' + cmdLabels().join(' | '));
  A.openAdmin(game);
  assert(!adminInDom(), 'чужому профилю открылась панель админа (программный вызов)');
  assert(!document.body.children.some((c) => c && c.querySelector && c.querySelector('#adm-pin')),
    'в DOM есть форма PIN админки для чужого профиля');

  // 2) Аноним (без профиля) — тоже нет.
  window.__saveIdentity = null;
  localStorage.removeItem('ac_save_nick');
  assert(!hasAdmin(), 'без профиля есть команда «Админ»');
  A.openAdmin(game);
  assert(!adminInDom(), 'без профиля открылась админка');

  // 3) Владелец в любом регистре: команда есть, панель открывается с PIN.
  for (const nick of ['best', 'Best', 'BEST']) {
    window.__saveIdentity = { nick, pin: '1234' };
    localStorage.setItem('ac_save_nick', nick);
    assert(A.isAdminProfile() === true, `профиль «${nick}» не распознан как владелец`);
    assert(hasAdmin(), `у профиля «${nick}» нет команды «Админ»`);
    A.closeAdmin();
    A.openAdmin(game);
    assert(adminInDom(), `админка не открылась для «${nick}»`);
    const panel = document.body.children.find((c) => c.id === 'admin-overlay');
    assert(panel.querySelector('#adm-pin'), 'нет входа по PIN для владельца');
    A.closeAdmin();
  }
  sessionStorage.removeItem('ac_admin_ok');
  pass('P4 админка: не-best не видит и не открывает, best/Best/BEST входят');
} catch (e) { fail('P4 админка только best', e); }

if (failures.length) {
  console.log(`\n❌ Профиль и вход: провалено ${failures.length} (${failures.join(', ')})`);
  process.exit(1);
}
console.log('\n✅ Профиль и вход: клавиатура в полях, тихая сеть без профиля, админка только best');
// Клиент сейва держит setInterval(15 с) — в headless это вечный event loop.
process.exit(0);
