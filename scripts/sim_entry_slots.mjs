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
  const netCalls = [];
  let offline = false;
  const resp = (status, j) => ({ status, ok: status >= 200 && status < 300, headers: { get: () => null }, json: async () => j });
  // «Облако»: пустое (новый профиль законен). Сторона базы — только выбор игрока.
  globalThis.fetch = async (url, opts = {}) => {
    const path = String(url);
    netCalls.push(path);
    if (offline) throw new Error('offline');
    if (path.endsWith('/health')) return resp(200, { ok: true });
    if (path.endsWith('/api/load')) {
      if (opts.body) {
        const body = JSON.parse(opts.body);
        if (body.key === 'ac_raid_session_v1') return resp(200, { ok: false, error: 'not found' });
      }
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
  const wait = async (pred) => {
    for (let i = 0; i < 250; i++) { if (pred()) return; await new Promise((r) => setTimeout(r, 10)); }
    throw new Error(`timeout ${mode}: step=${A.auth.step} open=${A.isAuthOpen()}`);
  };
  const overlay = () => document.body.children.find((c) => c.id === 'auth-overlay' && !c.classList.contains('hidden'));
  const boot = import('../r/raid-boot.js');
  await wait(() => A.isAuthOpen());
  assert.equal(g.started, false, 'симуляция ждёт решения гейта (ace#4)');

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
    await new Promise((r) => setTimeout(r, 10)); // enterGuest асинхронен
    await wait(() => !A.isAuthOpen());
    await boot;
    assert.equal(save.identity, null, 'Escape на стороне → identity нет (гость)');
    assert.equal(g.started, true, 'boot завершился стартом базы (gateSettle резолвится — дедлока нет)');
    assert.equal(g.raidSession.faction, 'human', 'гость получил human-фолбэк raid-boot (литерал не тронут)');
    assert.equal(S.readSlots().length, 0, 'гость не писал слот');
    console.log('PASS side-skip: Escape на стороне → гость human, гейт не завис, слотов нет');
  } else {
    throw new Error('неизвестный режим: ' + mode);
  }
  process.exit(0);
}
