// ============================================================
// sim_entry_slots.mjs — С1 «вход: сторона → ник → пин; слоты; смена профиля;
// выход → экран слотов» (спека ace-wf/entry-audit/SPEC.md, бриф §1–§6,
// гейты Г1–Г3 в entry-audit/CHECKPOINTS.md).
//
// Режимы (по одному PASS на строку):
//   (без аргумента) — UNIT-логика хранилища (гейт Г1, 8 PASS):
//     a roundtrip upsert→read; b 9-й профиль вытесняет самый старый
//     lastPlayed; c вытеснение НЕ трогает ник текущей сессии;
//     d ac_entry_slots_v1 переживает purgeProfileKeys; e битый JSON → []
//     без исключения; f запись не содержит поля pin (ровно 5 полей);
//     g evictOldest возвращает ровно 8 записей; h дроссель 60 с.
//   side-first — сцена мастера: гейт без identity и без слотов открывает шаг
//     «сторона»; тап «Кхарид» → ник → пин → пустое облако → база 'alien',
//     слот записан (Г1-3).
//   side-skip  — Escape на шаге стороны → гость, boot дошёл до старта на
//     'human' (фолбэк raid-boot не тронут), слотов нет (Г1-3).
//   Г2 (сцены панели/выхода/switch): exit-flow, exit-keep-slots, slots-screen,
//     switch-cancel, switch-commit, slot-refresh.
//   Г3 (E2E): first-touch-alien, first-touch-human-badge, reenter-slot,
//     wrong-pin, panel-switch-cycle, evict-on-ninth, f5-slots.
//
// Запуск: node scripts/sim_entry_slots.mjs [режим]
// ============================================================
import { V } from './stamp.mjs';

const mode = process.argv[2] || '';
if (!mode) await unitTests();
else await scene(mode);

// ============================================================
// UNIT: хранилище слотов (бриф §1.1–§1.3).
// ============================================================
async function unitTests() {
  await import('./harness.mjs');
  const assert = (await import('node:assert/strict')).default;
  const S = await import('../r/js/entry-slots.js' + V);
  const NS = await import('../r/js/storage-ns.js' + V);
  const pass = (m) => console.log('PASS ' + m);
  const FIVE = JSON.stringify(['baseId', 'ccLevel', 'lastPlayed', 'nick', 'side']);

  // (a) roundtrip upsert→read: ровно пять полей, нормализация ника.
  localStorage.removeItem(S.SLOT_KEY);
  S.upsertSlot({ nick: '  Best ', side: 'human', ccLevel: 16, baseId: 'AB12-01', lastPlayed: 1730000000000 });
  let slots = S.readSlots();
  assert.equal(slots.length, 1, 'a: после upsert читается одна запись');
  assert.equal(slots[0].nick, 'best', 'a: ник нормализован (trim+lower)');
  assert.equal(JSON.stringify(Object.keys(slots[0]).sort()), FIVE, 'a: запись — ровно пять полей');
  assert.equal(slots[0].ccLevel, 16, 'a: ccLevel сохранён');
  assert.equal(slots[0].baseId, 'AB12-01', 'a: baseId сохранён');
  pass('a roundtrip upsert→read: ник нормализован, ровно пять полей');

  // (b) 9-й профиль вытесняет самый старый lastPlayed.
  localStorage.removeItem(S.SLOT_KEY);
  const t0 = 1700000000000;
  for (let i = 0; i < 8; i++) {
    S.upsertSlot({ nick: 'p' + i, side: 'human', ccLevel: i + 1, baseId: 'B' + i, lastPlayed: t0 + i * 1000 });
  }
  S.upsertSlot({ nick: 'new9', side: 'alien', ccLevel: 1, baseId: 'B9', lastPlayed: t0 + 999000 });
  slots = S.readSlots();
  assert.equal(slots.length, 8, 'b: после 9-го профиля слотов 8');
  assert.equal(S.findSlot('p0'), null, 'b: вытеснен самый старый (p0)');
  assert.ok(S.findSlot('new9'), 'b: новый профиль записан');
  pass('b 9-й профиль вытесняет запись с самым старым lastPlayed (p0 ушла)');

  // (c) вытеснение НЕ трогает ник текущей сессии (keepNick) — чистая функция
  // и интеграция через upsertSlot (активная сессия = ник записи).
  const crowded = [];
  for (let i = 0; i < 9; i++) {
    crowded.push({ nick: i === 0 ? 'current' : 'q' + i, side: 'human', ccLevel: 5, baseId: '', lastPlayed: t0 + i * 1000 });
  }
  const kept = S.evictOldest(crowded, 'current');
  assert.equal(kept.length, 8, 'c: после вытеснения 8 записей');
  assert.ok(kept.some((r) => r.nick === 'current'), 'c: current (самый старый) выжил');
  assert.equal(S.findSlot('q0'), null, 'c: вытеснен следующий по старости, не current');
  localStorage.removeItem(S.SLOT_KEY);
  for (let i = 0; i < 8; i++) S.upsertSlot({ nick: 'k' + i, side: 'human', ccLevel: 3, baseId: '', lastPlayed: t0 + i * 1000 });
  S.upsertSlot({ nick: 'k0', side: 'human', ccLevel: 3, baseId: '', lastPlayed: t0 + 888000 }); // активный обновил свой слот
  assert.equal(S.readSlots().length, 8, 'c: апсерт активного не плодит записей');
  pass('c вытеснение не трогает ник текущей сессии (evictOldest keep + upsert)');

  // (d) ключ переживает purgeProfileKeys (keep-множество storage-ns).
  localStorage.removeItem(S.SLOT_KEY);
  S.upsertSlot({ nick: 'survivor', side: 'human', ccLevel: 7, baseId: 'B7', lastPlayed: t0 });
  localStorage.setItem('ac_save_nick', 'survivor');
  localStorage.setItem('ac_raid_session_v1', '{}');
  const purged = NS.purgeProfileKeys();
  assert.ok(purged >= 2, 'd: purge удалил профильные ключи (' + purged + ')');
  assert.equal(localStorage.getItem('ac_save_nick'), null, 'd: профильный ключ стёрт');
  assert.equal(localStorage.getItem('ac_raid_session_v1'), null, 'd: база рейда стёрта');
  slots = S.readSlots();
  assert.equal(slots.length, 1, 'd: слоты пережили выход');
  assert.equal(slots[0].nick, 'survivor', 'd: запись целая');
  pass('d ac_entry_slots_v1 переживает purgeProfileKeys (выход = не потеря слотов)');

  // (e) битый JSON → [] без исключения.
  localStorage.setItem(S.SLOT_KEY, '{broken json');
  slots = S.readSlots();
  assert.deepEqual(slots, [], 'e: битый JSON читается как пустой список');
  S.upsertSlot({ nick: 'after', side: 'alien', ccLevel: 2, baseId: '', lastPlayed: t0 });
  assert.equal(S.readSlots().length, 1, 'e: после апсерта ключ перезаписан');
  pass('e битый JSON → [] без исключения, перезаписывается при апсерте');

  // (f) пин и прочий мусор не хранятся: ровно пять полей, «pin» нет нигде.
  localStorage.removeItem(S.SLOT_KEY);
  S.upsertSlot({ nick: 'pinner', pin: '9999', secret: 'junk', side: 'human', ccLevel: 4, baseId: 'B4', lastPlayed: t0, extra: [1, 2] });
  const raw = localStorage.getItem(S.SLOT_KEY);
  assert.ok(!/"pin"\s*:/.test(raw), 'f: в сыром JSON нет поля pin');
  const rec = S.findSlot('pinner');
  assert.equal(JSON.stringify(Object.keys(rec).sort()), FIVE, 'f: ключи записи — ровно пять');
  pass('f запись слота не содержит поля pin (лишние поля выкидываются)');

  // (g) evictOldest возвращает ровно 8 записей.
  const many = [];
  for (let i = 0; i < 12; i++) {
    many.push({ nick: 'm' + i, side: 'human', ccLevel: 1, baseId: '', lastPlayed: t0 + i * 1000 });
  }
  assert.equal(S.evictOldest(many, '').length, 8, 'g: 12 → 8');
  assert.equal(S.evictOldest(many, 'm0').length, 8, 'g: 12 → 8 (с keepNick)');
  assert.equal(S.evictOldest(many.slice(0, 8), '').length, 8, 'g: ровно 8 не трогается');
  assert.equal(S.evictOldest(many, 'm0')[0].nick, 'm0', 'g: keepNick выжил');
  pass('g evictOldest возвращает ровно 8 записей');

  // (h) дроссель: два апсерта подряд без изменений ccLevel/side в пределах
  // 60 с — второй no-op (lastPlayed не перезаписывается, записей не плодит).
  localStorage.removeItem(S.SLOT_KEY);
  S.upsertSlot({ nick: 'throttle', side: 'human', ccLevel: 9, baseId: 'B9', lastPlayed: t0 });
  S.upsertSlot({ nick: 'throttle', side: 'human', ccLevel: 9, baseId: 'B9', lastPlayed: t0 + 30000 });
  slots = S.readSlots();
  assert.equal(slots.length, 1, 'h: записей не плодит');
  assert.equal(slots[0].lastPlayed, t0, 'h: второй апсерт в пределах 60 с — no-op');
  S.upsertSlot({ nick: 'throttle', side: 'human', ccLevel: 10, baseId: 'B9', lastPlayed: t0 + 30000 }); // ccLevel изменился
  assert.equal(S.findSlot('throttle').ccLevel, 10, 'h: изменение ccLevel пишется сразу');
  S.upsertSlot({ nick: 'throttle', side: 'human', ccLevel: 10, baseId: 'B9', lastPlayed: t0 + 30000 + 61000 });
  assert.equal(S.findSlot('throttle').lastPlayed, t0 + 91000, 'h: ≥60 с с прошлой записи — lastPlayed обновляется');
  pass('h дроссель 60 с: без изменений — no-op, изменение/60с — пишется');

  // (i) ГЕЙТ МИНОР-4: readSlots режет рукотворный файл до SLOT_CAP.
  localStorage.setItem(S.SLOT_KEY, JSON.stringify({ slots: Array.from({ length: 10 }, (_, i) => ({ nick: 'c' + i, side: 'human', ccLevel: 1, baseId: '', lastPlayed: t0 + i })) }));
  assert.equal(S.readSlots().length, 8, 'i: 10 записей в файле → читается 8 (cap)');
  localStorage.removeItem(S.SLOT_KEY);
  pass('i МИНОР-4 readSlots: файл >8 записей читается как 8 (cap после дедупа)');

  // (j) ГЕЙТ МИНОР-5: entry-запись двигает lastPlayed даже <60с;
  // save-путь (upsertSlot по умолчанию) — дроссель на месте.
  window.game = { raidSession: { faction: 'human', alarmV2: { baseId: 'BX' } } };
  S.upsertSlot({ nick: 'ent', side: 'human', ccLevel: 5, baseId: 'BX', lastPlayed: t0 });
  S.recordActiveSlot({ nick: 'ent', ccLevel: 5 });
  const entA = S.findSlot('ent').lastPlayed;
  await new Promise((r) => setTimeout(r, 15));
  S.recordActiveSlot({ nick: 'ent', ccLevel: 5 });
  const entB = S.findSlot('ent').lastPlayed;
  assert.ok(entB > entA, 'j: entry-запись <60с двигает lastPlayed');
  const entFixed = entB;
  S.upsertSlot({ nick: 'ent', side: 'human', ccLevel: 5, baseId: 'BX', lastPlayed: entFixed + 1000 });
  assert.equal(S.findSlot('ent').lastPlayed, entFixed, 'j: save-путь <60с — no-op (дроссель на месте)');
  localStorage.removeItem(S.SLOT_KEY);
  delete window.game;
  pass('j МИНОР-5: entry двигает lastPlayed <60с, дроссель 60с — только save-путь');
  process.exit(0);
}

// ============================================================
// СЦЕНЫ: реальный движок + save-client + boot (по образцу sim_auth_entry4).
// ============================================================
async function scene(mode) {
  const { fireWindow } = await import('./harness.mjs');
  const assert = (await import('node:assert/strict')).default;
  const nativeInterval = globalThis.setInterval;
  globalThis.setInterval = (fn, ms, ...args) => { const id = nativeInterval(fn, ms, ...args); id.unref?.(); return id; };
  const callbacks = {};
  const oldAdd = globalThis.addEventListener;
  globalThis.addEventListener = (ev, fn) => { (callbacks[ev] || []).push(fn); oldAdd(ev, fn); };
  globalThis.location = { protocol: 'http:', hostname: 'test.invalid', reload() {} };
  globalThis.dispatchEvent = () => true;
  globalThis.confirm = () => true;
  const net = [];
  let offline = false;
  let wrongPin = null; // режим сцены wrong-pin: 'NNNN' → 403, 'cooldown' → 429
  const resp = (status, j) => ({ status, ok: status >= 200 && status < 300, headers: { get: () => null }, json: async () => j });
  const clouds = {}; // player → снапшот базы (строка)
  globalThis.fetch = async (url, opts = {}) => {
    const path = String(url);
    let body = {};
    try { body = JSON.parse(opts.body || '{}'); } catch { /* GET */ }
    net.push({ path, player: body.player || '', key: body.key || '' });
    if (offline) throw new Error('offline');
    if (path.endsWith('/health')) return resp(200, { ok: true });
    if (path.endsWith('/api/load')) {
      if (body.key === '__check__' && wrongPin === 'cooldown') {
        return resp(429, { ok: false, error: 'too many attempts', retryAfter: 60 });
      }
      if (body.key === '__check__' && wrongPin && body.pin === wrongPin) {
        return resp(403, { ok: false, error: 'nick taken, wrong pin' });
      }
      if (body.key === 'ac_raid_session_v1' && clouds[body.player]) return resp(200, { ok: true, value: clouds[body.player], ts: 12345 });
      return resp(200, { ok: false, error: 'not found' });
    }
    if (path.endsWith('/api/save')) return resp(200, { ok: true, ts: 1 });
    return resp(200, { ok: true, records: [] });
  };
  try {
    Object.defineProperty(globalThis.navigator, 'sendBeacon', { configurable: true, value: () => true });
  } catch { /* node без navigator */ }

  await import('../r/js/game.js');
  const g = window.game;
  // Инициализируем state движка и убираем базу: гейт обязан поднять мир сам.
  g.startRaidHome('human', { forceNew: true });
  g.raidSession = null; g.started = false;
  localStorage.removeItem('ac_raid_session_v1');
  await import('../r/save-client.js');
  const save = window.__saveApi;
  const A = await import('../r/js/auth-ui.js' + V);   // ТОТ ЖЕ инстанс, что у save-client
  const S = await import('../r/js/entry-slots.js' + V);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const wait = async (pred) => {
    for (let i = 0; i < 250; i++) { if (pred()) return; await sleep(10); }
    throw new Error(`timeout ${mode}: step=${A.auth.step} open=${A.isAuthOpen()}`);
  };
  const overlay = () => document.body.children.find((c) => c.id === 'auth-overlay' && !c.classList.contains('hidden'));
  const slotsOverlay = () => document.body.children.find((c) => c.id === 'slots-overlay');
  const panelEl = () => document.body.children.find((c) => c.id === 'sv-panel');
  const bodyIn = (id) => document.body.children.some((c) => c && c.id === id);
  const ccOf = () => g.state.buildings.find((b) => !b.dead && b.side === 'player' && b.type === 'cc');
  // Изменение добычи, которое РЕАЛЬНО попадает в снапшот (как setErg в
  // sim_auth_entry4: в schema 2 homeDto.minerals живёт в кошельке).
  const bumpErg = (n) => {
    g.state.minerals.player = n;
    if (g.raidSession && g.raidSession.schema === 2 && g.raidSession.alarmV2) {
      g.raidSession.alarmV2.walletMicro = (BigInt(Math.round(n)) * 1000000n).toString();
    }
  };
  const raidSaves = () => net.filter((x) => x.path.endsWith('/api/save')).length;
  // Ручной сейв-тик как делает saveNow raid-boot: снапшот → localStorage
  // (дальше push уходит сам при следующем пуш-цикле/ручном pushAll).
  const syncToLS = () => { g.syncRaidHomeSnapshot(); localStorage.setItem('ac_raid_session_v1', JSON.stringify(g.raidSession)); };
  const guestWrap = () => {
    const orig = save.enterGuest.bind(save);
    let calls = 0;
    save.enterGuest = async () => { calls++; return orig(); };
    return () => calls;
  };

  // Войти в профиль best (облачная human-база КЦ-16) через гейт: identity →
  // шаг ника → пинпад → pull → applied. Слот 'second' подкладывается заранее.
  const loginBest = async () => {
    if (!clouds.best) clouds.best = await buildSnapshot('human');
    S.upsertSlot({ nick: 'second', side: 'alien', ccLevel: 16, baseId: 'B2', lastPlayed: Date.now() - 60000 });
    save.setIdentity('best', '1234');
    const boot = import('../r/raid-boot.js');
    await wait(() => A.isAuthOpen());
    assert.equal(A.auth.step, 'login', 'identity есть → шаг ника (матрица)');
    assert.ok(A.goToPin('best'));
    const r = await A.submitPin('1234');
    assert.ok(r && r.ok, 'вход best прошёл');
    await wait(() => !A.isAuthOpen());
    await boot;
    assert.equal(g.started, true, 'база best поднята гейтом');
    assert.equal(ccOf().level, 16, 'после входа КЦ-16');
  };

  // Выйти через панель профиля (подтверждение) и дождаться экрана слотов.
  const exitViaPanel = async () => {
    window.showProfilePanel();
    const panel = panelEl();
    assert.ok(panel, 'панель профиля открылась');
    panel.querySelector('#sv-out').click();
    const dlg = document.body.children.find((c) => c && c.id === 'auth-confirm');
    assert.ok(dlg, 'диалог подтверждения выхода открылся');
    dlg.querySelector('#auth-confirm-yes').click();
    await wait(() => !panelEl() && !!slotsOverlay());
  };

  // Тап по заполненному слоту на ЭКРАНЕ СЛОТОВ → пинпад ника слота (gate).
  const tapSlotOnScreen = async (nick) => {
    const card = slotsOverlay().querySelector('#slots-grid').querySelectorAll('.slot-card')
      .find((c) => c.dataset && c.dataset.nick === nick);
    assert.ok(card, 'слот ' + nick + ' на экране слотов');
    card.click();
    await wait(() => A.isAuthOpen() && A.auth.step === 'pin');
  };

  // Смена профиля из панели: чужой слот → пин → база применена.
  const panelSwitchTo = async (nick) => {
    window.showProfilePanel();
    const card = panelEl().querySelector('#sv-slots').querySelectorAll('.slot-card')
      .find((c) => c.dataset && c.dataset.nick === nick);
    assert.ok(card, 'слот ' + nick + ' в панели');
    card.click();
    await wait(() => A.isAuthOpen() && A.auth.step === 'pin');
    const r = await A.submitPin('1234');
    assert.ok(r && r.ok, 'пин ' + nick + ' принят');
    await wait(() => !A.isAuthOpen());
  };

  // Пин на слоте при живом мире за экраном (после выхода): штатный мастер
  // показывает «choice» (гость-кандидат против облака) — честный E2E жмёт
  // «Загрузить сохранённую базу».
  const submitPinResolveChoice = async () => {
    const r = await A.submitPin('1234');
    assert.ok(r && r.ok, 'пин принят');
    await wait(() => A.auth.step === 'choice' || !A.isAuthOpen());
    if (A.auth.step === 'choice') {
      const load = overlay().querySelector('#auth-load-cloud');
      assert.ok(load, 'на шаге choice есть «Загрузить сохранённую базу»');
      load.click();
    }
    await wait(() => !A.isAuthOpen());
  };

  if (mode === 'side-first' || mode === 'side-skip') {
    // Г1-3: boot-гейт открыт, симуляция ждёт решения (ace#4).
    var boot = import('../r/raid-boot.js');
    await wait(() => A.isAuthOpen());
    assert.equal(g.started, false, 'симуляция ждёт решения гейта (ace#4)');
  }

  if (mode === 'side-first') {
    // Г1-3: без identity и без слотов гейт открывает шаг СТОРОНЫ.
    assert.equal(A.auth.step, 'side', 'первое касание: гейт открыл выбор стороны, got ' + A.auth.step);
    const body = overlay().querySelector('#auth-body');
    const cards = body.querySelectorAll('.fac-card');
    assert.equal(cards.length, 2, 'на шаге стороны две карточки');
    const alien = cards.find((c) => c.dataset && c.dataset.side === 'alien');
    assert.ok(alien, 'карточка «Кхарид» на месте');
    alien.click();
    await wait(() => A.auth.step === 'login');
    assert.equal(A.auth.side, 'alien', 'тап «Кхарид» запомнил сторону');
    // Шаг ника: тап «Далее» с введённым ником (DOM-проводка).
    const nickEl = overlay().querySelector('#auth-nick');
    nickEl.value = 'Kharid1';
    overlay().querySelector('#auth-next').click();
    await wait(() => A.auth.step === 'pin');
    assert.equal(A.auth.nick, 'kharid1', 'ник нормализован мастером');
    for (const d of '1234') A.pressKey(d);
    const r = await A.submitPin('1234');
    assert.ok(r && r.ok, 'пин принят сервером');
    await wait(() => A.auth.pullState === 'empty' || A.auth.pullState === 'ok');
    await wait(() => !A.isAuthOpen());
    await boot;
    assert.equal(g.started, true, 'база стартовала без перезагрузки');
    assert.equal(g.raidSession.faction, 'alien', 'пустое облако + Кхарид → createRaidSession("alien")');
    const slots = S.readSlots();
    assert.equal(slots.length, 1, 'слот активной сессии записан при входе');
    assert.equal(slots[0].nick, 'kharid1');
    assert.equal(slots[0].side, 'alien', 'в слоте фактическая сторона базы');
    assert.ok(slots[0].baseId, 'baseId непустой (alarmV2)');
    assert.ok(Math.abs(slots[0].lastPlayed - Date.now()) < 15000, 'lastPlayed ≈ сейчас');
    assert.equal(JSON.stringify(Object.keys(slots[0]).sort()), JSON.stringify(['baseId', 'ccLevel', 'lastPlayed', 'nick', 'side']), 'в слоте нет пина — ровно пять полей');
    console.log('PASS side-first: сторона→ник→пин→база alien, слот записан без пина');
  } else if (mode === 'side-skip') {
    // Г1-3: Escape на шаге стороны → гость; boot дошёл до старта (дедлока нет),
    // фолбэк raid-boot startRaidHome('human') не тронут.
    assert.equal(A.auth.step, 'side', 'шаг стороны открыт');
    fireWindow('keydown', { key: 'Escape', code: 'Escape' });
    await sleep(10); // enterGuest асинхронен
    await wait(() => !A.isAuthOpen());
    await boot;
    assert.equal(save.identity, null, 'Escape на стороне → identity нет (гость)');
    assert.equal(g.started, true, 'boot завершился стартом базы (gateSettle резолвится — дедлока нет)');
    assert.equal(g.raidSession.faction, 'human', 'гость получил human-фолбэк raid-boot (литерал не тронут)');
    assert.equal(S.readSlots().length, 0, 'гость не писал слот');
    console.log('PASS side-skip: Escape на стороне → гость human, гейт не завис, слотов нет');
  } else if (mode === 'exit-flow') {
    // Г2: выход = push ДО clearIdentity → экран слотов, без reload; запись
    // за экраном заглушена (saveNow не пишет, сеть молчит).
    await loginBest();
    const before = S.readSlots().slice();
    let savesAtClear = -1;
    const origClear = save.clearIdentity.bind(save);
    save.clearIdentity = (...a) => { savesAtClear = raidSaves(); return origClear(...a); };
    let reloads = 0;
    globalThis.location = { protocol: 'http:', hostname: 'test.invalid', reload: () => { reloads++; } };
    // Реальное изменение со времени последнего синка — иначе pushAll честно
    // не пушит (нечего отправлять; capturedAt-один-в-один глушится norm()).
    // Как saveNow: снапшот → localStorage. Меняем ДОБЫЧУ, не КЦ: слот при
    // пушe останется неизменным (дроссель) — это же покрывает exit-keep-slots
    // «те же записи, что до выхода».
    bumpErg(123456);
    syncToLS();
    const savesBefore = raidSaves();
    await exitViaPanel();
    assert.ok(savesAtClear > savesBefore, 'пуш сейва ушёл ДО clearIdentity (' + savesAtClear + ' > ' + savesBefore + ')');
    assert.equal(reloads, 0, 'выход без location.reload()');
    assert.equal(save.identity, null, 'identity закрыта');
    assert.equal(g.raidAuthPending, true, 'raidAuthPending: запись заглушена');
    assert.equal(g.paused, true, 'мир за экраном на паузе');
    const savesAfter = raidSaves();
    assert.equal(localStorage.getItem('ac_raid_session_v1'), null, 'профильный ключ стёрт выходом');
    await sleep(2300); // ≥2 тика таймера сейва raid-boot (1.5 с)
    assert.equal(raidSaves(), savesAfter, 'после выхода сеть не пишется');
    assert.equal(localStorage.getItem('ac_raid_session_v1'), null, 'saveNow не записал localStorage (глушение работает)');
    const after = S.readSlots();
    assert.deepEqual(after, before, 'exit-keep-slots: слоты пережили выход 1:1');
    assert.ok(slotsOverlay(), 'экран слотов виден после выхода');
    assert.equal(A.isAuthOpen(), false, 'мастер входа не открылся поверх');
    console.log('PASS exit-flow: push→clear→экран слотов, без reload, запись заглушена, слоты целы');
  } else if (mode === 'exit-keep-slots') {
    // Г2: после выхода readSlots() возвращает те же записи, что до него
    // (keep-множество storage-ns — главный баг этой задачи).
    await loginBest();
    const before = S.readSlots().slice();
    await exitViaPanel();
    const after = S.readSlots();
    assert.deepEqual(after, before, 'слоты пережили выход 1:1');
    assert.equal(save.identity, null, 'сессия закрыта');
    assert.ok(slotsOverlay(), 'экран слотов открылся');
    console.log('PASS exit-keep-slots: readSlots до и после выхода совпадают запись в запись');
  } else if (mode === 'slots-screen') {
    // Г2: Escape на экране слотов — no-op; тап по заполненному → пинпад ника
    // слота (gate); тап по пустому → мастер на шаге стороны; ссылка
    // «гостем» → свежая human-база.
    await loginBest();
    await exitViaPanel();
    fireWindow('keydown', { key: 'Escape', code: 'Escape' });
    await sleep(10);
    assert.ok(slotsOverlay(), 'Escape на экране слотов — no-op (экран остался)');
    // Тап по заполненному слоту → пинпад ника слота.
    const grid = slotsOverlay().querySelector('#slots-grid');
    const cards = grid.querySelectorAll('.slot-card');
    assert.equal(cards.length, 8, 'на экране слотов 8 карточек');
    const filled = cards.filter((c) => c.dataset && c.dataset.nick);
    assert.equal(filled.length, 2, 'две заполненные карточки (best + second)');
    const secondCard = filled.find((c) => c.dataset.nick === 'second');
    assert.ok(secondCard, 'карточка слота second на месте');
    secondCard.click();
    await wait(() => A.isAuthOpen() && A.auth.step === 'pin');
    assert.equal(A.auth.nick, 'second', 'пинпад открылся с ником слота');
    assert.equal(A.auth.mode, 'gate', 'без identity вход в слот — режим gate');
    assert.equal(slotsOverlay(), undefined, 'экран слотов уступил место пинпаду (одна модалка)');
    fireWindow('keydown', { key: 'Escape', code: 'Escape' }); // gate: Escape → гость
    await sleep(10);
    await wait(() => !A.isAuthOpen());
    assert.equal(save.identity, null, 'Escape на пинпаде gate-режима → гость (прежнее поведение)');
    // Тап по пустому слоту → мастер с шага стороны.
    S.openSlotsScreen();
    const grid2 = slotsOverlay().querySelector('#slots-grid');
    const empty2 = grid2.querySelectorAll('.slot-card').find((c) => c.dataset && c.dataset.empty);
    assert.ok(empty2, 'пустая карточка «+ Новая игра» на месте');
    empty2.click();
    await wait(() => A.isAuthOpen() && A.auth.step === 'side');
    assert.equal(slotsOverlay(), undefined, 'мастер открылся вместо экрана слотов');
    fireWindow('keydown', { key: 'Escape', code: 'Escape' });
    await sleep(10);
    await wait(() => !A.isAuthOpen());
    // Ссылка «гостем» → свежая human-база (после выхода мир заменяется).
    S.openSlotsScreen();
    const guestBtn = slotsOverlay().querySelector('#slots-guest');
    assert.ok(guestBtn, 'ссылка «Пропустить — играть гостем» на месте');
    guestBtn.click();
    await wait(() => !slotsOverlay() && g.started);
    assert.equal(g.raidSession.faction, 'human', 'гостевой путь даёт human-базу');
    assert.equal(ccOf().level, 1, 'база СВЕЖАЯ (прежняя cc-17 миру не осталась)');
    assert.equal(g.paused, false, 'гость играет без паузы');
    console.log('PASS slots-screen: Escape no-op, слот→пинпад ника, пустой→сторона, гость→свежая human-база');
  } else if (mode === 'switch-cancel') {
    // Г2, ловушка §6.3: отмена смены профиля не выкидывает в гостя.
    await loginBest();
    const guestCalls = guestWrap();
    ccOf().level = 17;
    syncToLS();
    window.showProfilePanel();
    const grid = panelEl().querySelector('#sv-slots');
    const cards = grid.querySelectorAll('.slot-card');
    const you = cards.find((c) => c.classList.contains('is-current'));
    assert.ok(you, 'карточка «вы сейчас» есть в панели');
    assert.equal(you.dataset.nick, 'best', '«вы сейчас» — текущий профиль');
    you.click(); // не тапается: ничего не должно произойти
    await sleep(20);
    assert.ok(panelEl(), 'карточка «вы сейчас» не тапается');
    const secondCard = cards.find((c) => c.dataset && c.dataset.nick === 'second');
    assert.ok(secondCard, 'чужой слот в панели');
    const savesBefore = raidSaves();
    secondCard.click();
    await wait(() => A.isAuthOpen() && A.auth.step === 'pin');
    assert.ok(raidSaves() > savesBefore, 'перед пинпадом ушёл push старой сессии');
    assert.equal(A.auth.mode, 'switch', 'пинпад открыт в режиме switch');
    assert.equal(A.auth.nick, 'second', 'пинпад ника слота');
    assert.equal(g.paused, true, 'активная сессия на паузе (спека п.4)');
    assert.equal(panelEl(), undefined, 'панель профиля уступила место пинпаду (одна модалка)');
    assert.equal(A.isAuthOpen(), true);
    for (const d of '12') A.pressKey(d);
    fireWindow('keydown', { key: 'Escape', code: 'Escape' }); // очистить точки
    assert.equal(A.auth.pin, '', 'Escape сначала чистит точки (канон)');
    assert.equal(A.isAuthOpen(), true, 'панель осталась после очистки точек');
    fireWindow('keydown', { key: 'Escape', code: 'Escape' }); // закрыть
    await sleep(10);
    await wait(() => !A.isAuthOpen());
    assert.equal(save.identity && save.identity.nick, 'best', 'identity ЦЕЛА после отмены смены');
    assert.equal(guestCalls(), 0, 'enterGuest НЕ вызывался (ловушка §6.3 закрыта)');
    assert.equal(g.paused, false, 'пауза снята — можно продолжать');
    // Режим gate сохранил прежнее поведение: Escape → гость.
    A.openAuth(g, { step: 'login' });
    assert.ok(A.goToPin('best'));
    fireWindow('keydown', { key: 'Escape', code: 'Escape' });
    fireWindow('keydown', { key: 'Escape', code: 'Escape' });
    await sleep(10);
    await wait(() => !A.isAuthOpen());
    assert.equal(save.identity, null, 'gate-режим: Escape по-прежнему выкидывает в гостя');
    assert.ok(guestCalls() >= 1, 'gate-режим: enterGuest вызван');
    console.log('PASS switch-cancel: отмена смены бережёт сессию; gate-режим — прежний Escape→гость');
  } else if (mode === 'switch-commit') {
    // Г2: смена на другой слот — push старой сессии, чужое облако применяется,
    // «вы сейчас» переезжает на нового.
    clouds.best = await buildSnapshot('human');
    clouds.second = await buildSnapshot('alien');
    await loginBest();
    ccOf().level = 18;
    syncToLS();
    window.showProfilePanel();
    const secondCard = panelEl().querySelector('#sv-slots').querySelectorAll('.slot-card')
      .find((c) => c.dataset && c.dataset.nick === 'second');
    const savesBeforeTap = raidSaves();
    secondCard.click();
    await wait(() => A.isAuthOpen() && A.auth.step === 'pin');
    assert.ok(raidSaves() > savesBeforeTap, 'push старой сессии ушёл до пинпада');
    assert.equal(A.auth.mode, 'switch', 'режим switch');
    const r = await A.submitPin('1234');
    assert.ok(r && r.ok, 'пин second принят');
    await wait(() => !A.isAuthOpen());
    assert.equal(save.identity.nick, 'second', 'identity переехала на second');
    assert.equal(g.raidSession.faction, 'alien', 'база соответствует слоту (кхарид)');
    assert.equal(ccOf().level, 16, 'облако second применено (КЦ-16)');
    const sBest = S.findSlot('best');
    const sSecond = S.findSlot('second');
    assert.equal(sSecond.side, 'alien', 'слот second показывает фактическую сторону');
    assert.ok(sSecond.lastPlayed > sBest.lastPlayed, '«вы сейчас» переехал: second свежее best');
    assert.ok(slotsOverlay() === undefined && !panelEl(), 'никаких модалок поверх игры');
    console.log('PASS switch-commit: push старой → пин → база слота применена, слот обновлён');
  } else if (mode === 'slot-refresh') {
    // Г2: успешный push RAID_KEY с выросшим КЦ обновляет слот; повторный тик
    // без изменений не трогает localStorage (дроссель).
    await loginBest();
    const t1 = S.findSlot('best').lastPlayed;
    assert.equal(S.findSlot('best').ccLevel, 16, 'слот записан при входе (КЦ-16)');
    ccOf().level = 17;
    syncToLS();
    await save.pushKey('ac_raid_session_v1');
    const after1 = S.findSlot('best');
    assert.equal(after1.ccLevel, 17, 'push с новым КЦ обновил слот');
    assert.ok(after1.lastPlayed >= t1, 'lastPlayed обновлён');
    const lp = after1.lastPlayed;
    const savesMid = raidSaves();
    await save.pushKey('ac_raid_session_v1'); // ничего не изменилось
    const after2 = S.findSlot('best');
    assert.equal(after2.lastPlayed, lp, 'повторный тик НЕ трогает слот (дроссель)');
    assert.equal(raidSaves(), savesMid, 'повторный тик не пушит (unchanged)');
    console.log('PASS slot-refresh: push обновил слот (КЦ/время), холостой тик — no-op');
  } else if (mode === 'first-touch-alien' || mode === 'first-touch-human-badge') {
    // Г3 E2E: чистый браузер → сторона → ник → пин → база стороны + слот.
    const pick = mode === 'first-touch-human-badge' ? 'human' : 'alien';
    var boot = import('../r/raid-boot.js');
    await wait(() => A.isAuthOpen());
    assert.equal(g.started, false, 'чистый браузер: симуляция ждёт решения');
    assert.equal(A.auth.step, 'side', 'первое касание — шаг стороны');
    const cards = overlay().querySelector('#auth-body').querySelectorAll('.fac-card');
    const card = cards.find((c) => c.dataset && c.dataset.side === pick);
    assert.ok(card, 'карточка стороны на месте');
    if (mode === 'first-touch-human-badge') {
      // Бейджи проверяем по разметке шага: у распарсенных узлов harness нет
      // innerHTML детей, а тег span матчится только по открывающему тегу.
      const bodyHtml = String(overlay().querySelector('#auth-body')._html);
      assert.equal((bodyHtml.match(/class="ac-badge[ "]/g) || []).length, 2, 'бейджи на обеих карточках');
      assert.ok(/Рекомендовано для старта/.test(bodyHtml), 'у Гелиоса бейдж «Рекомендовано для старта»');
      assert.ok(/Контент в разработке/.test(bodyHtml), 'у Кхарида пометка «Контент в разработке»');
    }
    card.click();
    await wait(() => A.auth.step === 'login');
    const nickEl = overlay().querySelector('#auth-nick');
    nickEl.value = pick === 'alien' ? 'Kharid1' : 'Helios1';
    overlay().querySelector('#auth-next').click();
    await wait(() => A.auth.step === 'pin');
    for (const k of '1234') A.pressKey(k);
    overlay().querySelector('#auth-enter').click();
    await wait(() => !A.isAuthOpen());
    await boot;
    assert.equal(g.started, true, 'база создана без перезагрузки страницы');
    assert.equal(g.raidSession.faction, pick, 'база стороны ' + pick + ' (createRaidSession)');
    const rec = S.findSlot(pick === 'alien' ? 'kharid1' : 'helios1');
    assert.ok(rec, 'слот записан при создании профиля');
    assert.equal(rec.side, pick, 'в слоте сторона базы');
    assert.ok(rec.baseId, 'baseId непустой');
    assert.ok(Math.abs(rec.lastPlayed - Date.now()) < 15000, 'lastPlayed ≈ сейчас');
    console.log('PASS ' + mode + ': сторона→ник→пин→база ' + pick + ', слот записан (без пина)');
  } else if (mode === 'reenter-slot') {
    // Г3 E2E: выход → экран слотов → тап по слоту → пин → база вернулась,
    // КЦ слота совпал с фактическим после hydration.
    await loginBest();
    await exitViaPanel();
    await tapSlotOnScreen('best');
    assert.equal(A.auth.nick, 'best', 'пинпад ника слота');
    await submitPinResolveChoice();
    assert.equal(g.started, true, 'база вернулась без перезагрузки');
    assert.equal(ccOf().level, 16, 'база best: КЦ-16 после hydration');
    const rec = S.findSlot('best');
    assert.equal(rec.ccLevel, ccOf().level, 'КЦ слота совпал с фактическим');
    assert.equal(save.identity.nick, 'best', 'identity восстановлена');
    console.log('PASS reenter-slot: выход → слот → пин → база КЦ-16, метки слота честные');
  } else if (mode === 'wrong-pin') {
    // Г3 E2E: неверный пин на слоте — шейк, точки очищены, identity не создана;
    // кулдаун 429 обрабатывается как раньше (не ломаем [21]).
    await loginBest();
    await exitViaPanel();
    await tapSlotOnScreen('best');
    wrongPin = '9999';
    const bad = await A.submitPin('9999');
    assert.equal(bad.ok, false, 'чужой пин отклонён');
    assert.equal(bad.code, 403, 'код 403 прежний');
    assert.equal(A.auth.pin, '', 'точки очищены');
    assert.ok(A.auth.shakeCount >= 1, 'панель «дёрнулась» (шейк)');
    assert.equal(A.auth.error, 'ui.auth.errPinWrong', 'текст «Неверный пин»');
    assert.equal(save.identity, null, 'identity НЕ создана');
    wrongPin = 'cooldown';
    const cool = await A.submitPin('1234');
    assert.equal(cool.ok, false, 'кулдаун отклонён');
    assert.equal(cool.code, 429, 'код 429 прежний');
    assert.equal(A.auth.error, 'ui.auth.errCooldown', 'текст кулдауна');
    assert.equal(A.auth.errorParams && A.auth.errorParams.s, 60, 'время ожидания показано');
    assert.equal(save.identity, null, 'identity по-прежнему нет');
    console.log('PASS wrong-pin: 403 шейк+очистка без identity, 429 кулдаун как раньше');
  } else if (mode === 'panel-switch-cycle') {
    // Г3 E2E: 4 переключения (панель ×2, выход→слоты, панель) без потери
    // identity и без дублей в слотах.
    clouds.best = await buildSnapshot('human');
    clouds.second = await buildSnapshot('alien');
    await loginBest();
    await panelSwitchTo('second');
    assert.equal(save.identity.nick, 'second', 'переключение 1: best → second');
    assert.equal(g.raidSession.faction, 'alien', 'база second применена');
    await panelSwitchTo('best');
    assert.equal(save.identity.nick, 'best', 'переключение 2: second → best');
    assert.equal(g.raidSession.faction, 'human', 'база best применена');
    await exitViaPanel();
    await tapSlotOnScreen('best');
    await submitPinResolveChoice();
    assert.equal(save.identity.nick, 'best', 'переключение 3: возврат из слотов');
    await panelSwitchTo('second');
    assert.equal(save.identity.nick, 'second', 'переключение 4: best → second');
    const slots = S.readSlots();
    assert.equal(slots.length, 2, 'в памяти ровно 2 слота');
    assert.deepEqual(slots.map((x) => x.nick).sort(), ['best', 'second'], 'дублей нет');
    assert.equal(A.isAuthOpen(), false, 'мастер закрыт');
    assert.equal(slotsOverlay(), undefined, 'экран слотов закрыт');
    console.log('PASS panel-switch-cycle: 4 переключения, identity цела, слоты без дублей');
  } else if (mode === 'evict-on-ninth') {
    // Г3 E2E: 9 профилей подряд → ровно 8, вытеснен самый старый неактивный,
    // тост ui.slots.evictNotice показан ОДИН раз.
    const toasts = [];
    window.__slotsToastHook = (nick) => toasts.push(nick);
    localStorage.removeItem(S.SLOT_KEY);
    const t = 1700000000000;
    for (let i = 0; i < 8; i++) {
      S.upsertSlot({ nick: 'p' + i, side: i % 2 ? 'alien' : 'human', ccLevel: i + 1, baseId: 'B' + i, lastPlayed: t + i * 60000 });
    }
    S.upsertSlot({ nick: 'p8', side: 'human', ccLevel: 9, baseId: 'B8', lastPlayed: Date.now() }); // 9-й (активный)
    const slots = S.readSlots();
    assert.equal(slots.length, 8, 'в памяти ровно 8 слотов');
    assert.equal(S.findSlot('p0'), null, 'вытеснен самый старый неактивный (p0)');
    assert.ok(S.findSlot('p8'), 'активная сессия (p8) на месте');
    assert.deepEqual(toasts, ['p0'], 'тост вытеснения показан один раз и про того ник');
    assert.equal(S.findSlot('p1').ccLevel, 2, 'остальные записи целы');
    delete window.__slotsToastHook;
    console.log('PASS evict-on-ninth: 9-й вытеснил p0, активный цел, тост единственный');
  } else if (mode === 'f5-slots') {
    // Г3 E2E: страница без identity при наличии слотов → гейт открыл ЭКРАН
    // СЛОТОВ (матрица §2.3); гостевая ссылка резолвит boot без дедлока.
    S.upsertSlot({ nick: 'best', side: 'human', ccLevel: 16, baseId: 'B1', lastPlayed: Date.now() - 60000 });
    const boot = import('../r/raid-boot.js');
    await wait(() => S.isSlotsOpen());
    assert.equal(A.isAuthOpen(), false, 'мастер входа НЕ открывается поверх слотов');
    assert.equal(g.started, false, 'симуляция ждёт решения');
    // Заголовок проверяем по innerHTML: стаб harness не матчит теги с цифрами
    // (<h1>): [a-z]+\b обрывается на 'h' перед '1'.
    assert.ok(/Выберите слот/.test(String(slotsOverlay().innerHTML)), 'заголовок отрисован из локали (ui.slots.title)');
    assert.ok(/Профили, в которые играли/.test(String(slotsOverlay().innerHTML)), 'подзаголовок отрисован (ui.slots.sub)');
    const guestBtn = slotsOverlay().querySelector('#slots-guest');
    guestBtn.click();
    await wait(() => g.started);
    assert.equal(g.raidSession.faction, 'human', 'гостевой путь: human-база');
    assert.equal(save.identity, null, 'identity нет');
    console.log('PASS f5-slots: F5 без identity со слотами → экран слотов, гейт резолвится');
  } else if (mode === 'switch-back-nick') {
    // ГЕЙТ ВАЖНО-1: «Другой ник» в switch-режиме НЕ возвращает gate-семантику.
    await loginBest();
    const guestCalls = guestWrap();
    window.showProfilePanel();
    panelEl().querySelector('#sv-slots').querySelectorAll('.slot-card')
      .find((c) => c.dataset && c.dataset.nick === 'second').click();
    await wait(() => A.isAuthOpen() && A.auth.step === 'pin');
    assert.equal(A.auth.mode, 'switch', 'режим switch');
    overlay().querySelector('#auth-back-step').click();
    await wait(() => A.auth.step === 'login');
    assert.equal(A.auth.mode, 'switch', 'ВАЖНО-1: «Другой ник» сохранил switch');
    fireWindow('keydown', { key: 'Escape', code: 'Escape' });
    await sleep(10);
    await wait(() => !A.isAuthOpen());
    assert.equal(save.identity && save.identity.nick, 'best', 'identity цела после отмены');
    assert.equal(guestCalls(), 0, 'enterGuest не вызван');
    assert.equal(g.paused, false, 'пауза снята');
    console.log('PASS switch-back-nick: «Другой ник» в switch не выкидывает живую сессию в гостя');
  } else if (mode === 'exit-escape-fresh-base') {
    // ГЕЙТ ВАЖНО-2: Escape на мастере ПОСЛЕ выхода — гость на СВЕЖЕЙ базе;
    // гостевой ключ localStorage не содержит базы прежнего профиля.
    await loginBest();
    const oldLs = localStorage.getItem('ac_raid_session_v1');
    const oldBaseId = JSON.parse(oldLs).alarmV2.baseId;
    await exitViaPanel();
    await tapSlotOnScreen('best');
    fireWindow('keydown', { key: 'Escape', code: 'Escape' });
    await sleep(10);
    await wait(() => !A.isAuthOpen());
    assert.equal(save.identity, null, 'гость: identity нет');
    assert.equal(g.started, true, 'мир жив');
    assert.equal(ccOf().level, 1, 'база СВЕЖАЯ (не прежнего профиля)');
    assert.equal(g.paused, false, 'пауза снята');
    await sleep(2000); // таймер сейва raid-boot пишет гостевую базу
    const guest = localStorage.getItem(save.guestRaidKey);
    assert.ok(guest, 'гостевой ключ записан');
    assert.notEqual(guest, oldLs, 'приватность: гостевой ключ ≠ база прежнего профиля');
    const newBaseId = JSON.parse(guest).alarmV2.baseId;
    assert.ok(newBaseId && newBaseId !== oldBaseId, 'приватность: baseId в гостевом ключе сменился');
    console.log('PASS exit-escape-fresh-base: Escape после выхода → свежая human-база, базы прежнего профиля в гостевом ключе нет');
  } else if (mode === 'panel-new-slot-cancel') {
    // ГЕЙТ ВАЖНО-3: «+ Новая игра» из панели при живой сессии — push, пауза,
    // switch; отмена (Escape) бережёт сессию.
    await loginBest();
    const guestCalls = guestWrap();
    ccOf().level = 17;
    syncToLS();
    const savesBefore = raidSaves();
    window.showProfilePanel();
    const emptyCard = panelEl().querySelector('#sv-slots').querySelectorAll('.slot-card')
      .find((c) => c.dataset && c.dataset.empty);
    assert.ok(emptyCard, 'пустая карточка в панели');
    emptyCard.click();
    await wait(() => A.isAuthOpen() && A.auth.step === 'side');
    assert.ok(raidSaves() > savesBefore, 'push старой сессии ушёл (зеркало openSlotByNick)');
    assert.equal(A.auth.mode, 'switch', 'режим switch');
    assert.equal(g.paused, true, 'сессия на паузе');
    const skipBtn = overlay().querySelector('#auth-close');
    assert.ok(skipBtn && skipBtn.style.display === 'none', '«Пропустить» скрыт в switch');
    fireWindow('keydown', { key: 'Escape', code: 'Escape' });
    await sleep(10);
    await wait(() => !A.isAuthOpen());
    assert.equal(save.identity && save.identity.nick, 'best', 'identity цела после отмены');
    assert.equal(guestCalls(), 0, 'enterGuest не вызван');
    assert.equal(g.paused, false, 'пауза снята');
    console.log('PASS panel-new-slot-cancel: новая игра из панели отменяется без потери сессии');
  } else if (mode === 'gate-settle-modes') {
    // ГЕЙТ: регресс дедлока — закрытие мастера резолвит гейт во всех режимах.
    const settleOnce = async (act, label, wantStep) => {
      const p = window.__saveApi.authGate(game);
      await wait(() => A.isAuthOpen());
      if (wantStep) assert.equal(A.auth.step, wantStep, label + ': шаг мастера');
      act();
      await sleep(30);
      const res = await Promise.race([p, new Promise((r) => setTimeout(() => r({ hang: true }), 1500))]);
      assert.ok(res && !res.hang, label + ': гейт НЕ резолвился (дедлок)');
      assert.equal(A.isAuthOpen(), false, label + ': мастер закрыт');
      return res;
    };
    // (a) gate: identity есть → шаг ника → Escape → резолв, identity стёрта.
    save.setIdentity('best', '1234');
    localStorage.removeItem(S.SLOT_KEY);
    const resA = await settleOnce(() => { fireWindow('keydown', { key: 'Escape', code: 'Escape' }); }, 'gate');
    assert.equal(resA.source, 'guest', 'gate: источник guest');
    assert.equal(save.identity, null, 'gate: Escape → гость (прежнее поведение)');
    // (b) side: без identity и слотов → шаг стороны → Escape → резолв.
    await save.enterGuest();
    localStorage.removeItem(S.SLOT_KEY);
    await settleOnce(() => { fireWindow('keydown', { key: 'Escape', code: 'Escape' }); }, 'side', 'side');
    // (c) switch: закрытие switch-мастера резолвит ожидающий гейт БЕЗ гостя.
    save.setIdentity('best', '1234');
    A.openAuth(game, { step: 'pin', nick: 'best', mode: 'switch' });
    assert.equal(A.auth.mode, 'switch', 'switch: мастер открыт в switch');
    const pC = window.__saveApi.authGate(game); // открытие гейта закрывает switch-мастер
    await sleep(30);
    const resC = await Promise.race([pC, new Promise((r) => setTimeout(() => r({ hang: true }), 1500))]);
    assert.ok(resC && !resC.hang, 'switch: гейт НЕ резолвился закрытием switch-мастера (дедлок)');
    assert.equal(save.identity && save.identity.nick, 'best', 'switch: identity цела (без гостя)');
    assert.equal(g.paused, false, 'switch: пауза снята');
    fireWindow('keydown', { key: 'Escape', code: 'Escape' }); // закрыть мастер самого гейта
    await sleep(10);
    console.log('PASS gate-settle-modes: закрытие мастера резолвит гейт в gate/side/switch — дедлока нет');
  } else {
    throw new Error('неизвестный режим: ' + mode);
  }
  process.exit(0);

  // Снимок базы заданной стороны с КЦ-16 (для «облака» сцены switch-commit).
  async function buildSnapshot(faction) {
    g.startRaidHome(faction, { forceNew: true });
    const cc = g.state.buildings.find((b) => !b.dead && b.side === 'player' && b.type === 'cc');
    cc.level = 16; cc.done = true; cc.maxHp = 3750; cc.hp = 3750;
    g.syncRaidHomeSnapshot();
    const snap = JSON.stringify(g.raidSession);
    // вернуть мир в «догейтовое» состояние
    g.raidSession = null; g.started = false;
    localStorage.removeItem('ac_raid_session_v1');
    return snap;
  }
}
