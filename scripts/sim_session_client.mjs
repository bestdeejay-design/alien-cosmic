// ============================================================
// sim_session_client.mjs — С2 «реестр сессий», КЛИЕНТ (ace#6).
// Контракт: ace-wf/entry-audit/DESIGN_BRIEF_C2.md §1–§2 + CHECKPOINTS_C2.md
// гейт Г2. Клиент кодится против МОКА сервера по контракту раздела 1
// (как sim_profile/sim_entry_slots мокают fetch).
//
// Сценарии (по одному PASS на строку, ≥10; +3 сцены правок ревью Г2):
//   token-on-save        — после входа каждый push несёт sessionToken (тело +
//                          заголовок X-Session-Token), токен НЕ в URL;
//   beacon-active-token  — pagehide в ACTIVE: бикон несёт токен в теле
//                          (sendBeacon без заголовков) и ПРИНИМАЕТСЯ моком;
//   beat-60s             — бит зарегистрирован с интервалом 60 с и несёт токен;
//   panel-block          — блок «Мои сессии»: active первым, «Это вы» на
//                          current, статусы/lastSeen человекочитаемо,
//                          «Обновить список» перезапрашивает;
//   beat-reregister      — start упал при входе (500) → бит 60 с
//                          перерегистрирует (ретрай К-3, раньше был недостижим);
//   displaced-409        — 409 от push → флаг зрителя, дальше сеть молчит;
//   viewer-writes-muted  — интервал 15 с, бит и sendBeacon зрителя НЕ пишут;
//   viewer-banner        — баннер с device/«Обновлено», пауза поставлена;
//   viewer-poll          — авто-poll 20 с: мир перегидрирован из нового
//                          снапшота, paused остаётся, raidAuthPending не тронут;
//   claim-wrong-pin      — неверный пин на клейме: шейк, зритель сохранён;
//   claim-escape         — Escape на пинпаде клейма → зритель (НЕ гость);
//   claim-commit         — верный пин → start → токен обновлён, push
//                          восстановлен, баннер убран;
//   paused-on-load       — sessionStatus:'paused' от /api/load → зритель (К-4);
//   logout-ends          — «Выход» → session/end ДО очистки identity, токен
//                          стёрт; офлайн-end не блокирует выход;
//   viewer-poll-stale    — выход посреди poll: in-flight /api/load после purge
//                          НЕ перезаписывает RAID_KEY/lastSynced/ts;
//   degrade-health-v6    — /health без sessions:true: ноль session-вызовов,
//                          push/pull как в С1, блок панели скрыт;
//   degrade-404          — session-ручки 404: ровно ОДИН проб, фича выключена;
//   degrade-enforce-off  — SESSIONS_ENFORCE=0 (health без sessions) — как С1;
//   degrade-offline      — сеть лежит: без баннеров, без сессий, ошибки тихие.
//
// Запуск: node scripts/sim_session_client.mjs
// ============================================================
import { V } from './stamp.mjs';
import { windowHandlers, fireWindow } from './harness.mjs';

const assert = (await import('node:assert/strict')).default;

// ------------------------------------------------------------
// Стабы браузера: CustomEvent + dispatchEvent (доставка до слушателей
// harness), location, UA, confirm. Интервалы 60 с (бит) и 20 с (poll
// зрителя) НЕ тикают сами — сим дёргает их вручную (детерминизм).
// ------------------------------------------------------------
globalThis.CustomEvent = class CustomEvent {
  constructor(type, opts = {}) { this.type = type; this.detail = opts.detail; }
};
globalThis.dispatchEvent = (e) => {
  for (const fn of windowHandlers(e.type)) fn(e);
  return true;
};
globalThis.location = { protocol: 'http:', hostname: 'test.invalid', reload() {} };
try {
  Object.defineProperty(globalThis.navigator, 'userAgent', {
    configurable: true,
    value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  });
} catch { /* navigator без userAgent — метка устройства будет пустой */ }
globalThis.confirm = () => true;

const nativeInterval = globalThis.setInterval;
const nativeClearInterval = globalThis.clearInterval;
const captured = []; // { fn, ms, dead, manual }
globalThis.setInterval = (fn, ms) => {
  const rec = { fn, ms, dead: false, manual: ms === 60000 || ms === 20000 };
  captured.push(rec);
  if (rec.manual) return rec; // бит сессий и poll зрителя — только вручную (детерминизм)
  const id = nativeInterval(fn, ms);
  if (id && typeof id.unref === 'function') id.unref();
  rec.id = id;
  return id;
};
globalThis.clearInterval = (id) => {
  if (id && typeof id === 'object' && 'fn' in id) { id.dead = true; return undefined; }
  const rec = captured.find((c) => c.id === id);
  if (rec) rec.dead = true;
  return nativeClearInterval(id);
};
const liveOf = (ms) => [...captured].reverse().find((c) => c.ms === ms && !c.dead);

// ------------------------------------------------------------
// МОК СЕРВЕРА по контракту DESIGN_BRIEF_C2.md §1.
// ------------------------------------------------------------
const S = {
  healthSessions: true,  // /health {version:7, sessions:true}
  endpointsUp: true,     // иначе /api/session/* и /api/sessions → 404
  offline: false,        // сеть лежит целиком
  endFails: false,       // /api/session/end падает (офлайн-end)
  loadPaused: false,     // /api/load отдаёт sessionStatus:'paused' (К-4)
  loadDelay: 0,          // задержка ответа /api/load (сцена stale-poll)
  failStart: 0,          // сколько следующих /api/session/start падает (500)
  rows: new Map(),       // sessionId → { player, device, status, created, lastSeen }
  thisToken: null,       // токен последнего start (чей клиент — не важно)
  snapshotValue: null,
  snapshotTs: 1730000000000,
  saves: [],             // { key, value, token }
  beacons: [],
  net: [],               // { path, method, token, body }
  uuidN: 0,
};
const resp = (status, j) => ({ status, ok: status >= 200 && status < 300, headers: { get: () => null }, json: async () => j });
const sess409 = (active) => resp(409, { ok: false, error: 'active elsewhere', activeElsewhere: true, active: { device: active.device, lastSeen: active.lastSeen } });
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
// К-3: write-owner enforcement — единое решение для fetch и для бикона
// (сцена beacon-active-token проверяет, что бикон СЕРВЕРОМ принимается).
const decideSave = (body, token) => {
  const row = token ? S.rows.get(token) : null;
  const active = [...S.rows.values()].find((r) => r.player === body.player && r.status === 'active');
  if (row && row.status === 'active') return { code: 200, accepted: true };
  if (active) return { code: 409, accepted: false, active };
  return { code: 200, accepted: true }; // без active — как в С1
};

globalThis.fetch = async (url, opts = {}) => {
  const raw = String(url);
  const path = raw.replace(/^https?:\/\/[^/]+/, '');
  const method = opts.method || 'GET';
  const headers = opts.headers || {};
  let body = {};
  try { body = JSON.parse(opts.body || '{}'); } catch { /* GET */ }
  const token = (body && body.sessionToken) || headers['X-Session-Token'] || '';
  S.net.push({ path, method, token, body, url: raw });
  if (S.offline) throw new Error('offline');

  if (path === '/health' || path.endsWith('/health')) {
    return resp(200, S.healthSessions
      ? { ok: true, players: 1, records: 2, version: 7, sessions: true }
      : { ok: true, players: 1, records: 2, version: 6 });
  }
  if (path.endsWith('/api/session/start')) {
    if (!S.endpointsUp) return resp(404, { ok: false, error: 'http 404' });
    if (!S.healthSessions) return resp(200, { ok: true, disabled: true }); // kill-switch
    if (S.failStart > 0) { S.failStart--; return resp(500, { ok: false, error: 'boom' }); }
    const hadActive = [...S.rows.values()].some((r) => r.player === body.player && r.status === 'active');
    for (const r of S.rows.values()) if (r.player === body.player) r.status = 'paused';
    const id = 'sid-' + (++S.uuidN) + '-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    S.rows.set(id, { player: body.player, device: String(body.device || ''), status: 'active', created: Date.now(), lastSeen: Date.now() });
    S.thisToken = id;
    return resp(200, { ok: true, sessionId: id, player: body.player, displaced: hadActive, active: true });
  }
  if (path.endsWith('/api/session/beat')) {
    if (!S.endpointsUp) return resp(404, { ok: false, error: 'http 404' });
    if (!S.healthSessions) return resp(200, { ok: true, disabled: true });
    const row = S.rows.get(token);
    const active = [...S.rows.values()].find((r) => r.player === body.player && r.status === 'active');
    if (row && row.status === 'active') return resp(200, { ok: true, lastSeen: Date.now(), status: 'active' });
    if (active) return sess409(active);
    return resp(200, { ok: true, status: 'none' }); // вкладка спала дольше реестра
  }
  if (path.endsWith('/api/session/end')) {
    if (S.endFails) throw new Error('end down');
    if (!S.endpointsUp) return resp(404, { ok: false, error: 'http 404' });
    if (!S.healthSessions) return resp(200, { ok: true, disabled: true });
    const row = S.rows.get(token);
    if (row) row.status = 'paused'; // завершает ТОЛЬКО свой токен
    return resp(200, { ok: true, status: 'paused' });
  }
  if (path.split('?')[0].endsWith('/api/sessions')) {
    if (!S.endpointsUp) return resp(404, { ok: false, error: 'http 404' });
    if (!S.healthSessions) return resp(200, { ok: true, disabled: true });
    const u = new URL(raw, 'http://localhost');
    if (!u.searchParams.get('pin')) return resp(403, { ok: false, error: 'nick taken, wrong pin' });
    const player = u.searchParams.get('player');
    const list = [...S.rows.entries()]
      .filter(([, r]) => r.player === player)
      .map(([id, r]) => ({ sessionId: id, device: r.device, status: r.status, created: r.created, lastSeen: r.lastSeen, current: id === token }))
      .sort((a, b) => ((a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1)) || (b.lastSeen - a.lastSeen));
    return resp(200, { ok: true, player, sessions: list });
  }
  if (path.endsWith('/api/load')) {
    if (S.loadDelay > 0) await sleepMs(S.loadDelay); // сцена stale-poll: ответ зависает
    if (body.key === '__check__') {
      if (body.pin !== '1234') return resp(403, { ok: false, error: 'nick taken, wrong pin' });
      return resp(200, { ok: true, player: 'best', registered: false });
    }
    if (body.key === 'ac_raid_session_v1' && S.snapshotValue != null) {
      const row = S.rows.get(token);
      if (S.loadPaused && row && row.status === 'paused') {
        const active = [...S.rows.values()].find((r) => r.player === body.player && r.status === 'active');
        return resp(200, {
          ok: true, value: S.snapshotValue, ts: S.snapshotTs,
          sessionStatus: 'paused', active: { device: active ? active.device : '', lastSeen: active ? active.lastSeen : 0 },
        });
      }
      return resp(200, { ok: true, value: S.snapshotValue, ts: S.snapshotTs });
    }
    return resp(200, { ok: false, error: 'not found' });
  }
  if (path.endsWith('/api/save')) {
    const v = decideSave(body, token);
    if (v.accepted) {
      S.saves.push({ key: body.key, value: body.value, token });
      const row = S.rows.get(token);
      if (row) row.lastSeen = Date.now(); // К-2: heartbeat на сессионном вызове
      return resp(200, { ok: true, ts: Date.now(), player: body.player });
    }
    return sess409(v.active); // К-3: write-owner enforcement
  }
  if (path.endsWith('/api/list')) return resp(200, { ok: true, records: [] });
  return resp(200, { ok: true });
};
try {
  Object.defineProperty(globalThis.navigator, 'sendBeacon', {
    configurable: true,
    value: (url, blob) => { S.beacons.push({ url, blob }); return true; },
  });
} catch { /* node без navigator */ }

const netCount = (suffix) => S.net.filter((r) => r.path.split('?')[0].endsWith(suffix)).length;

// Имитация входа с ДРУГОГО устройства: прежняя строка игрока → paused, чужая
// active (политика ace#6 «последний вошедший = active»).
function displaceByOther(device) {
  for (const r of S.rows.values()) if (r.player === 'best') r.status = 'paused';
  const id = 'sid-other-' + (++S.uuidN);
  S.rows.set(id, { player: 'best', device, status: 'active', created: Date.now(), lastSeen: Date.now() });
  S.thisToken = id;
  return id;
}

// ------------------------------------------------------------
// Подъём: движок + save-client + auth-ui + session-ui (ОДНИ инстансы).
// ------------------------------------------------------------
await import('../r/js/game.js');
const g = window.game;
g.startRaidHome('human', { forceNew: true });
g.raidSession = null; g.started = false;
localStorage.removeItem('ac_raid_session_v1');
await import('../r/save-client.js');
const save = window.__saveApi;
const A = await import('../r/js/auth-ui.js' + V);      // ТОТ ЖЕ инстанс, что у save-client
const SU = await import('../r/js/session-ui.js' + V);  // ТОТ ЖЕ инстанс (баннер/панель)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wait = async (pred, label) => {
  for (let i = 0; i < 300; i++) { if (pred()) return; await sleep(10); }
  throw new Error('timeout: ' + (label || ''));
};
const ccOf = () => g.state.buildings.find((b) => !b.dead && b.side === 'player' && b.type === 'cc');
const panelEl = () => document.body.children.find((c) => c && c.id === 'sv-panel');
const slotsOverlay = () => document.body.children.find((c) => c && c.id === 'slots-overlay');
const bannerText = () => (SU._debug.banner ? String(SU._debug.banner.innerHTML) : '');
// Ленивые узлы harness: textContent мета-строк виден через querySelector-узел,
// не через innerHTML родителя (как в sim_entry_slots «бейджи»).
const bannerMeta = (id) => {
  const n = SU._debug.banner && SU._debug.banner.querySelector('#' + id);
  return n ? String(n.textContent) : '';
};
const syncToLS = () => { g.syncRaidHomeSnapshot(); localStorage.setItem('ac_raid_session_v1', JSON.stringify(g.raidSession)); };
const bumpErg = (n) => {
  g.state.minerals.player = n;
  if (g.raidSession && g.raidSession.schema === 2 && g.raidSession.alarmV2) {
    g.raidSession.alarmV2.walletMicro = (BigInt(Math.round(n)) * 1000000n).toString();
  }
};
// Снимок базы с заданным КЦ (для «облака» сервера).
async function buildSnapshot(ccLevel) {
  const pausedWas = g.paused;
  g.startRaidHome('human', { forceNew: true });
  const cc = g.state.buildings.find((b) => !b.dead && b.side === 'player' && b.type === 'cc');
  cc.level = ccLevel; cc.done = true; cc.maxHp = 3750; cc.hp = 3750;
  g.syncRaidHomeSnapshot();
  const snap = JSON.stringify(g.raidSession);
  g.raidSession = null; g.started = false;
  localStorage.removeItem('ac_raid_session_v1');
  g.paused = pausedWas;
  return snap;
}
// Вход в профиль best через мастер (шаг пина) — полный поток С1+С2.
const loginBest = async () => {
  A.openAuth(g, { step: 'pin', nick: 'best' });
  assert.equal(A.auth.step, 'pin', 'мастер открыт на шаге пина');
  const r = await A.submitPin('1234');
  assert.ok(r && r.ok, 'вход best прошёл');
  await wait(() => !A.isAuthOpen(), 'мастер закрылся после pull');
};
// Выход через панель профиля (подтверждение) → экран слотов.
const exitViaPanel = async () => {
  window.showProfilePanel();
  await wait(() => panelEl(), 'панель открылась');
  panelEl().querySelector('#sv-out').click();
  const dlg = document.body.children.find((c) => c && c.id === 'auth-confirm');
  assert.ok(dlg, 'диалог подтверждения выхода открылся');
  dlg.querySelector('#auth-confirm-yes').click();
  await wait(() => !panelEl() && !!slotsOverlay(), 'экран слотов после выхода');
};

// Серверное облако: human-база КЦ-16.
S.snapshotValue = await buildSnapshot(16);

// ============================================================
// 1) token-on-save: вход → start → токен в sessionStorage → push несёт токен.
// ============================================================
await loginBest();
const startReq = S.net.filter((r) => r.path.endsWith('/api/session/start')).pop();
assert.ok(startReq, 'после входа ушёл /api/session/start');
assert.equal(startReq.body.player, 'best', 'start: игрок best');
assert.equal(startReq.body.device, 'Chrome · macOS', 'start: метка устройства из UA (≤64)');
const token1 = sessionStorage.getItem('ac_session_token');
assert.ok(token1 && token1 === S.thisToken, 'токен сервера в sessionStorage (ac_session_token)');
assert.ok(!startReq.url.includes(token1), 'токен НЕ светится в URL');
S.saves.length = 0;
bumpErg(111); syncToLS();
await save.pushKey('ac_raid_session_v1');
assert.ok(S.saves.length >= 1, 'push дошёл до сервера');
assert.ok(S.saves.every((s) => s.token === token1), 'каждый push несёт sessionToken');
console.log('PASS token-on-save: вход → start → токен в sessionStorage, push несёт его (тело+заголовок, не URL)');

// ============================================================
// 1b) beacon-active-token: pagehide в ACTIVE — бикон несёт токен в теле
// (sendBeacon не умеет заголовки, контракт §1.2) и принимается сервером,
// иначе прогресс закрытой вкладки (до 15 с) теряется на 409 (ревью Г2).
// ============================================================
const beacons1b = S.beacons.length;
bumpErg(1234); syncToLS(); // локально «грязно» — pagehide обязан дослать
fireWindow('pagehide', {});
assert.ok(S.beacons.length > beacons1b, 'бикон ушёл при закрытии вкладки (ACTIVE)');
const bbody = JSON.parse(await S.beacons[S.beacons.length - 1].blob.text());
assert.equal(bbody.sessionToken, token1, 'бикон несёт sessionToken в теле');
assert.equal(bbody.key, 'ac_raid_session_v1', 'бикон: ключ базы рейда');
const verdict1b = decideSave(bbody, bbody.sessionToken);
assert.equal(verdict1b.code, 200, 'мок принимает бикон (К-3: токен активной строки → 200, не 409)');
console.log('PASS beacon-active-token: pagehide в ACTIVE — бикон с токеном принят сервером (прогресс не теряется)');

// ============================================================
// 2) beat-60s: бит зарегистрирован с интервалом 60 с и несёт токен.
// ============================================================
const beat = liveOf(60000);
assert.ok(beat, 'интервал бита 60 с зарегистрирован');
const beats0 = netCount('/api/session/beat');
await beat.fn();
assert.equal(netCount('/api/session/beat'), beats0 + 1, 'бит ушёл по ручному тику');
const beatReq = S.net.filter((r) => r.path.endsWith('/api/session/beat')).pop();
assert.equal(beatReq.body.sessionToken, token1, 'бит несёт sessionToken');
console.log('PASS beat-60s: интервал 60 с зарегистрирован, бит несёт токен активной сессии');

// ============================================================
// 3) panel-block: «Мои сессии» — третий блок панели (профиль → слоты → сессии).
// ============================================================
S.rows.set('sid-old-1', { player: 'best', device: 'Firefox · Linux', status: 'paused', created: 1, lastSeen: Date.now() - 5 * 60000 });
window.showProfilePanel();
await wait(() => panelEl() && panelEl().querySelector('#sv-sess-list'), 'блок сессий отрисован');
const sessBlockEl = panelEl().querySelector('#sv-sessions');
const sessHtml = String(sessBlockEl.innerHTML);
assert.ok(/Мои сессии/.test(sessHtml), 'заголовок блока из локали (ui.sessions.title)');
assert.ok(/Chrome · macOS/.test(sessHtml) && /Firefox · Linux/.test(sessHtml), 'карточки устройств');
const cards = sessBlockEl.querySelectorAll('.sess-card');
assert.ok(cards.length >= 2, 'две карточки сессий, got ' + cards.length);
assert.ok(cards[0].classList.contains('is-current'), 'active первым');
assert.ok(/Это вы/.test(sessHtml), 'пометка «Это вы» на current');
assert.ok(/в сети/.test(sessHtml), 'статус active — «в сети»');
assert.ok(/на паузе/.test(sessHtml), 'статус paused — «на паузе»');
assert.ok(/была активна:/.test(sessHtml), 'lastSeen человекочитаемо');
const sessGets0 = netCount('/api/sessions');
panelEl().querySelector('#sv-sess-refresh').click();
await wait(() => netCount('/api/sessions') === sessGets0 + 1, '«Обновить список» перезапросил');
const sessReq = S.net.filter((r) => r.path.split('?')[0].endsWith('/api/sessions')).pop();
assert.ok(sessReq.token === token1, 'GET /api/sessions несёт X-Session-Token');
assert.ok(!sessReq.url.includes(token1), 'токен списка НЕ в URL');
// Панель закрываем (одна модалка — следующий сценарий открывает баннер без панели).
panelEl().querySelector('#sv-close').click();
await wait(() => !panelEl(), 'панель закрыта');
console.log('PASS panel-block: третий блок панели, active+«Это вы», статусы/время, обновление перезапрашивает');

// ============================================================
// 3b) beat-reregister: start упал при входе (500) — бит 60 с перерегистрирует
// (раньше: ни бита, ни ретрая — токен терялся до следующего входа; ревью Г2).
// ============================================================
S.failStart = 1; // следующий start → 500
await exitViaPanel();
await loginBest(); // start падает, вход жив (registerSession — best-effort)
assert.equal(sessionStorage.getItem('ac_session_token'), null, 'start упал — токена нет');
const beatRetry = liveOf(60000);
assert.ok(beatRetry, 'бит зарегистрирован даже при неудачном start (не только при успехе)');
await beatRetry.fn();
await wait(() => !!sessionStorage.getItem('ac_session_token'), 'бит перерегистрировал');
const tokenR = sessionStorage.getItem('ac_session_token');
assert.equal(tokenR, S.thisToken, 'повторный start выдал токен через бит');
console.log('PASS beat-reregister: неудача start → бит 60 с перерегистрирует (ретрай К-3)');

// ============================================================
// 4) displaced-409: вытеснение другим устройством → push 409 → зритель.
// ============================================================
displaceByOther('Safari · iPhone');
const saves0 = S.saves.length;
bumpErg(222); syncToLS();
await save.pushKey('ac_raid_session_v1');
assert.equal(save.viewerActive, true, '409 включил режим зрителя');
assert.equal(S.saves.length, saves0, 'вытесненный push НЕ дошёл до сервера (value не отправлен)');
const saves1 = S.saves.length;
const apiSaves1 = netCount('/api/save');
bumpErg(333); syncToLS();
await save.pushKey('ac_raid_session_v1');
assert.equal(netCount('/api/save'), apiSaves1, 'повторный push зрителя молчалив (сеть не тронута)');
assert.equal(S.saves.length, saves1, 'ни одного вызова с value профиля');
console.log('PASS displaced-409: 409 activeElsewhere → зритель, запись заглушена без тостов-спама');

// ============================================================
// 5) viewer-writes-muted: интервал 15 с, бит и sendBeacon зрителя не пишут.
// ============================================================
const tick = [...captured].reverse().find((c) => c.ms === 15000 && !c.dead);
assert.ok(tick, 'интервал сейва 15 с на месте');
const apiSaves2 = netCount('/api/save');
const beats1 = netCount('/api/session/beat');
await tick.fn();
const liveBeat2 = liveOf(60000);
if (liveBeat2) await liveBeat2.fn();
assert.equal(netCount('/api/save'), apiSaves2, 'тик 15 с зрителя не пушит');
assert.equal(netCount('/api/session/beat'), beats1, 'бит зрителя молчит');
const beacons0 = S.beacons.length;
bumpErg(444); syncToLS(); // локально «грязно» — beacon обязан промолчать
fireWindow('pagehide', {});
assert.equal(S.beacons.length, beacons0, 'sendBeacon зрителя не отправляет тело профиля');
console.log('PASS viewer-writes-muted: интервал 15 с, бит и sendBeacon зрителя не пишут в профиль');

// ============================================================
// 6) viewer-banner: баннер с устройством, пауза поставлена; «Обновлено» после poll.
// ============================================================
const banner = SU._debug.banner;
assert.ok(banner, 'баннер зрителя показан');
assert.ok(/Сессия продолжена на другом устройстве/.test(bannerText()), 'текст баннера из локали');
assert.equal(bannerMeta('sv-viewer-device'), 'Активно на: Safari · iPhone', 'баннер показывает активное устройство');
assert.equal(g.paused, true, 'пауза зрительской карты поставлена');
assert.equal(bannerMeta('sv-viewer-updated'), '', 'до первого poll «Обновлено» нет');
const poll = liveOf(20000);
assert.ok(poll, 'авто-poll зрителя зарегистрирован (20 с)');
await poll.fn();
await wait(() => /Обновлено:/.test(bannerMeta('sv-viewer-updated')), 'poll обновил баннер');
console.log('PASS viewer-banner: баннер с device и «Обновлено», пауза поставлена (не модалка)');

// ============================================================
// 7) viewer-poll: новый снапшот сервера → перегидрация мира, paused остаётся.
// ============================================================
S.snapshotValue = await buildSnapshot(17); // сервер ушёл вперёд: КЦ-17
const pendingBefore = g.raidAuthPending;
const poll2 = liveOf(20000);
await poll2.fn();
await wait(() => ccOf().level === 17, 'мир перегидрирован из нового снапшота');
assert.equal(ccOf().level, 17, 'мир перегидрирован из нового снапшота (КЦ-17)');
assert.equal(g.paused, true, 'game.paused остаётся true');
assert.equal(g.raidAuthPending, pendingBefore, 'raidAuthPending не тронут');
console.log('PASS viewer-poll: poll 20 с → мир из нового снапшота, paused сохранён, raidAuthPending цел');

// ============================================================
// 8) claim-wrong-pin: «Забрать сессию» → пинпад → неверный пин → шейк, зритель цел.
// ============================================================
SU._debug.banner.querySelector('#sv-viewer-claim').click();
await wait(() => A.isAuthOpen() && A.auth.step === 'pin', 'пинпад клейма открыт');
assert.equal(A.auth.mode, 'switch', 'пинпад клейма в семантике switch С1');
assert.equal(A.auth.viewer, true, 'флаг клейма зрителя выставлен');
assert.equal(A.auth.nick, 'best', 'пинпад ника текущего профиля');
assert.equal(SU._debug.banner, null, 'баннер убран на время клейма');
const badPin = await A.submitPin('9999');
assert.equal(badPin.ok, false, 'неверный пин отклонён');
assert.equal(badPin.code, 403, 'код 403 прежний');
assert.ok(A.auth.shakeCount >= 1, 'пинпад «дёрнулся» (шейк)');
assert.equal(save.viewerActive, true, 'зритель сохранён после неверного пина');
console.log('PASS claim-wrong-pin: неверный пин — шейк и очистка, зритель не потерян');

// ============================================================
// 9) claim-escape: Escape на пинпаде клейма → зритель (НЕ гость).
// ============================================================
const guestWrap = (() => { let calls = 0; const orig = save.enterGuest.bind(save); save.enterGuest = async (...a) => { calls++; return orig(...a); }; return () => calls; })();
const tokenBeforeEscape = sessionStorage.getItem('ac_session_token');
fireWindow('keydown', { key: 'Escape', code: 'Escape' });
await wait(() => !A.isAuthOpen(), 'пинпад закрыт Escape');
await sleep(20);
assert.equal(save.identity && save.identity.nick, 'best', 'identity цела (не гость)');
assert.equal(guestWrap(), 0, 'enterGuest НЕ вызывался');
assert.equal(sessionStorage.getItem('ac_session_token'), tokenBeforeEscape, 'токен не стёрт');
assert.equal(save.viewerActive, true, 'режим зрителя сохранён');
assert.equal(g.paused, true, 'пауза зрительской карты НЕ снята');
assert.ok(SU._debug.banner, 'баннер зрителя вернулся после отмены клейма');
console.log('PASS claim-escape: Escape на пинпаде клейма → зритель с баннером, identity цела, гость не создан');

// ============================================================
// 10) claim-commit: верный пин → start → новый токен, push восстановлен.
// ============================================================
SU._debug.banner.querySelector('#sv-viewer-claim').click();
await wait(() => A.isAuthOpen() && A.auth.step === 'pin', 'пинпад клейма открыт снова');
const goodPin = await A.submitPin('1234');
assert.ok(goodPin && goodPin.ok, 'верный пин принят');
await wait(() => !A.isAuthOpen(), 'мастер закрыт после клейма');
const token2 = sessionStorage.getItem('ac_session_token');
assert.ok(token2 && token2 !== token1 && token2 === S.thisToken, 'start выдал НОВЫЙ токен');
assert.equal(save.viewerActive, false, 'флаг зрителя снят');
assert.equal(SU._debug.banner, null, 'баннер убран');
assert.equal(g.paused, false, 'игра продолжается (push восстановлен)');
S.saves.length = 0;
bumpErg(555); syncToLS();
await save.pushKey('ac_raid_session_v1');
assert.ok(S.saves.length === 1 && S.saves[0].token === token2, 'push восстановлен и несёт новый токен');
console.log('PASS claim-commit: клейм → новый токен, зритель снят, push восстановлен, баннер убран');

// ============================================================
// 11) paused-on-load: sessionStatus:'paused' от /api/load → зритель (К-4).
// ============================================================
displaceByOther('Edge · Windows');
S.loadPaused = true;
const pulled = await save.pullKey('ac_raid_session_v1');
assert.ok(pulled, 'зритель получил данные (Д-3: читатели никогда не 409)');
assert.equal(save.viewerActive, true, 'sessionStatus paused включил зрителя');
assert.ok(SU._debug.banner, 'баннер показан');
assert.equal(g.paused, true, 'пауза поставлена');
S.loadPaused = false;
console.log('PASS paused-on-load: К-4 — /api/load с sessionStatus paused → зритель с данными');

// ============================================================
// 12) logout-ends: «Выход» → session/end ДО clearIdentity; офлайн-end не блокирует.
// ============================================================
let marker = -1;
const origClear = save.clearIdentity.bind(save);
save.clearIdentity = (...a) => { marker = S.net.length; return origClear(...a); };
await exitViaPanel();
assert.ok(marker > 0, 'выход дошёл до clearIdentity');
// end инициируется ПЕРВОЙ строкой clearIdentity — его запись в сетевом логе
// лежит ровно на индексе marker (до purge эффектов).
const endReq = S.net[marker];
assert.ok(endReq && endReq.path.endsWith('/api/session/end'),
  'session/end ушёл ДО очистки identity (перехват сети видит порядок), got ' + (endReq && endReq.path));
assert.equal(endReq.body.sessionToken, token2, 'end завершает СВОЮ сессию');
assert.equal(sessionStorage.getItem('ac_session_token'), null, 'токен стёрт');
assert.equal(save.identity, null, 'identity закрыта');
await sleep(30);
assert.ok(slotsOverlay(), 'экран слотов открыт');
// офлайн-end: повторный цикл — end падает, выход не блокируется
S.endFails = true;
await loginBest();
await exitViaPanel();
assert.equal(save.identity, null, 'офлайн-end: выход всё равно завершён');
assert.equal(sessionStorage.getItem('ac_session_token'), null, 'офлайн-end: токен стёрт всегда');
S.endFails = false;
console.log('PASS logout-ends: end ДО очистки identity (порядок виден сетью), офлайн-end не блокирует выход');

// ============================================================
// 12b) viewer-poll-stale: выход посреди poll — in-flight /api/load просыпается
// ПОСЛЕ purge и не перезаписывает RAID_KEY/lastSynced/ts (ревью Г2).
// ============================================================
await loginBest();
displaceByOther('Safari · iPhone');
S.loadPaused = true;
await save.pullKey('ac_raid_session_v1'); // → зритель
S.loadPaused = false;
const pollStale = liveOf(20000);
S.loadDelay = 350; // ответ зависает в моке
void pollStale.fn(); // poll ушёл в сеть и завис
await exitViaPanel(); // выход В ПОЛЁТЕ poll (purge: epoch++, RAID_KEY удалён)
await sleep(600); // poll проснулся уже после очистки
assert.equal(localStorage.getItem('ac_raid_session_v1'), null,
  'stale poll НЕ записал RAID_KEY поверх purge');
S.loadDelay = 0;
console.log('PASS viewer-poll-stale: выход посреди poll — перегидрация не переживает purge');

// ============================================================
// 13) degrade-health-v6: /health без sessions:true — весь С2 невидим (С1).
// ============================================================
S.rows.clear(); S.thisToken = null;
S.healthSessions = false;
const starts13 = netCount('/api/session/start');
await loginBest();
assert.equal(sessionStorage.getItem('ac_session_token'), null, 'v6: токен не выдаётся');
assert.equal(netCount('/api/session/start'), starts13, 'v6: ноль session-вызовов (один проб /health, без start)');
S.saves.length = 0;
bumpErg(666); syncToLS();
await save.pushKey('ac_raid_session_v1');
assert.ok(S.saves.length === 1 && S.saves[0].token === '', 'v6: push проходит БЕЗ токена (как в С1)');
assert.equal(save.viewerActive, false, 'v6: никаких баннеров');
const sessGets13 = netCount('/api/sessions');
window.showProfilePanel();
await wait(() => panelEl(), 'панель открылась');
await sleep(30);
const sessBlock6 = panelEl().querySelector('#sv-sessions');
assert.ok(sessBlock6 && String(sessBlock6.innerHTML).trim() === '', 'v6: блок «Мои сессии» скрыт целиком');
assert.equal(netCount('/api/sessions'), sessGets13, 'v6: список сессий не запрашивается');
panelEl().querySelector('#sv-close').click();
await wait(() => !panelEl(), 'панель закрыта');
await exitViaPanel();
console.log('PASS degrade-health-v6: сервер v6 — ноль session-вызовов, push как в С1, блок скрыт');

// ============================================================
// 14) degrade-404: health отдал sessions:true, но ручек нет → РОВНО ОДИН проб.
// ============================================================
S.rows.clear(); S.thisToken = null;
S.healthSessions = true;
S.endpointsUp = false;
const startsBefore14 = netCount('/api/session/start');
await loginBest();
const starts14 = netCount('/api/session/start') - startsBefore14;
assert.equal(starts14, 1, '404: ровно одна попытка start при поднятии канала');
assert.equal(sessionStorage.getItem('ac_session_token'), null, '404: токена нет');
S.saves.length = 0;
bumpErg(777); syncToLS();
await save.pushKey('ac_raid_session_v1');
window.showProfilePanel();
await wait(() => panelEl(), 'панель открылась');
await sleep(30);
assert.equal(netCount('/api/session/start'), startsBefore14 + starts14, '404: повторов пробы нет (не на каждый вызов)');
assert.ok(S.saves.length >= 1 && S.saves[0].token === '', '404: push как в С1');
const sessBlock14 = panelEl().querySelector('#sv-sessions');
assert.ok(sessBlock14 && String(sessBlock14.innerHTML).trim() === '', '404: блок сессий скрыт');
assert.equal(save.viewerActive, false, '404: баннеров нет');
panelEl().querySelector('#sv-close').click();
await wait(() => !panelEl(), 'панель закрыта');
await exitViaPanel();
console.log('PASS degrade-404: ручек нет — один проб, фича выключена, остальное как в С1');

// ============================================================
// 15) degrade-enforce-off: SESSIONS_ENFORCE=0 — health без sessions, ручки disabled.
// ============================================================
S.rows.clear(); S.thisToken = null;
S.healthSessions = false; // enforce=0 → /health не отдаёт sessions:true
S.endpointsUp = true;     // ручки отвечают {ok, disabled:true} — клиент их не зовёт
const starts15 = netCount('/api/session/start');
await loginBest();
assert.equal(netCount('/api/session/start'), starts15, 'enforce-off: ноль session-вызовов');
assert.equal(sessionStorage.getItem('ac_session_token'), null, 'enforce-off: токена нет');
S.saves.length = 0;
bumpErg(888); syncToLS();
await save.pushKey('ac_raid_session_v1');
assert.ok(S.saves.length === 1 && S.saves[0].token === '', 'enforce-off: push как в С1');
assert.equal(save.viewerActive, false, 'enforce-off: без баннеров');
await exitViaPanel();
console.log('PASS degrade-enforce-off: SESSIONS_ENFORCE=0 — фича невидима, поведение С1');

// ============================================================
// 16) degrade-offline: сеть лежит — тихие ошибки, без сессий и баннеров.
// ============================================================
S.rows.clear(); S.thisToken = null;
S.offline = true;
const starts16 = netCount('/api/session/start');
A.openAuth(g, { step: 'pin', nick: 'best' });
const offlineRes = await A.submitPin('1234');
assert.equal(offlineRes.ok, false, 'офлайн: вход честно отклонён');
assert.equal(offlineRes.offline, true, 'офлайн: код offline от loginWithPin');
assert.equal(A.auth.error, 'ui.auth.errOffline', 'офлайн: текст «Нет связи» на пинпаде (С1)');
assert.equal(netCount('/api/session/start'), starts16, 'офлайн: ноль session-вызовов');
assert.equal(save.viewerActive, false, 'офлайн: баннеров нет');
S.offline = false;
console.log('PASS degrade-offline: сеть лежит — офлайн-экран С1, ноль session-вызовов, без баннеров');

console.log('sim_session_client: 18 PASS — гейт Г2 (клиент против мока сервера) зелёный, правки ревью покрыты');
process.exit(0);
