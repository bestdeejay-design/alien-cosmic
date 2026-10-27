// ============================================================
// auth-ui.js — ЭТАП P1 «Авторизация поэтапно» (ACE / Alien Cosmic: Expedition,
// issue #45; спека ace/03-spec/auth-ci-stands.md §A + приоритетный §4 «Итоги
// аудита»).
//
// Что строим и почему:
//   • ШАГ 1 — ЛОГИН: одно поле, никаких «ник и пин в одной строке». Ввод ника
//     нормализуется ровно как раньше (trim + lower, 2–24 буквы/цифры/-/_),
//     autocomplete="username" — телефон сам подставит сохранённый ник.
//   • ШАГ 2 — ПИНПАД 3×4 (1-9, «C» = очистить всё, 0, «⌫» = стереть последнюю).
//     Клавиши ≥48px и touch-action: manipulation (палец не зумит страницу),
//     до 12 точек, пин 3–12 цифр. На десктопе работают цифры 0–9, Backspace и
//     Enter; на телефоне — только тапы по сетке (никакой текстовой клавиатуры
//     для пина: это и была жалоба владельца «не вводится пин с телефона»).
//   • НЕВЕРНЫЙ ПИН — шейк панели + полная очистка точек (без мигания цифрами).
//   • ВЫХОД — clearIdentity + удаление ВСЕХ локальных ключей профиля (минимум
//     ac_raid_session_v1) + перезагрузка: чужой прогресс не остаётся в браузере.
//   • PULL СНАПШОТА ДО СТАРТА СИМУЛЯЦИИ (закрывает гонку входа, баг №1):
//     прогресс-индикатор, таймаут 10 с, кнопка «Повторить», явный офлайн-фолбэк,
//     пустое облако = новая база, облако приоритетнее локала.
//   • ПАНЕЛЬ — модалка по канону check_r [18]: одна за раз (modals.js), Escape
//     сначала чистит точки, второй Escape закрывает панель.
//
// Модуль не ходит в сеть сам: единственный сетевой клиент полигона —
// save-client.js (гейт check_r [4]); здесь только его публичные ручки.
// ============================================================
import { t } from './i18n.js?v=10271840';
import { closeOthers, registerModal, unregisterModal, isModalOpen } from './modals.js?v=10271840';

export const AUTH_MODAL_ID = 'auth';
export const PIN_MIN = 3;
export const PIN_MAX = 12;
export const PULL_TIMEOUT_MS = 10000;
const NICK_RE = /^[a-zA-Zа-яА-Я0-9_-]{2,24}$/;
const PAD_KEYS = Object.freeze(['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', 'back']);

// ------------------------------------------------------------
// Состояние мастера (чистая логика: её и проверяют симы/гейты).
// ------------------------------------------------------------
export const auth = {
  step: 'login',      // login | pin | pull | offline
  nick: '',
  pin: '',
  busy: false,
  error: '',          // ключ локали (не текст!) — так проще сверять RU/EN
  errorParams: null,
  attempts: 0,
  shake: 0,           // флаг «дёрнуть панель» (render читает и сбрасывает)
  shakeCount: 0,      // сколько раз панель дёргалась (счётчик для проверок)
  progress: '',       // ключ локали для индикатора pull
  pullState: 'idle',  // idle | loading | ok | empty | offline
  registered: false,  // сервер только что создал профиль (тост «Профиль создан»)
};

export function authReset(step = 'login') {
  auth.step = step;
  auth.pin = '';
  auth.busy = false;
  auth.error = '';
  auth.errorParams = null;
  auth.shake = 0;
  auth.shakeCount = 0;
  auth.progress = '';
  auth.pullState = 'idle';
  auth.registered = false;
  return auth;
}

// Шаг 1: нормализация ника (одинаково с сервером и старым входом).
export function normalizeNick(raw) {
  return String(raw == null ? '' : raw).trim().toLowerCase();
}

export function setNick(raw) {
  auth.nick = normalizeNick(raw);
  auth.error = '';
  return auth.nick;
}

// Шаг 1 → шаг 2.
export function goToPin(rawNick) {
  const nick = normalizeNick(rawNick === undefined ? auth.nick : rawNick);
  if (!NICK_RE.test(nick)) {
    auth.error = 'ui.auth.errNick';
    auth.errorParams = null;
    return false;
  }
  auth.nick = nick;
  auth.step = 'pin';
  auth.pin = '';
  auth.error = '';
  auth.shake = 0;
  return true;
}

// Нажатие клавиши пинпада. Возвращает true, если состояние изменилось.
export function pressKey(key) {
  if (auth.step !== 'pin' || auth.busy) return false;
  auth.error = '';
  if (key === 'C') {                       // очистить ВСЁ
    auth.pin = '';
    return true;
  }
  if (key === 'back' || key === 'Backspace') { // стереть последнюю
    auth.pin = auth.pin.slice(0, -1);
    return true;
  }
  if (!/^[0-9]$/.test(String(key))) return false;
  if (auth.pin.length >= PIN_MAX) return false; // 12 точек — предел
  auth.pin += String(key);
  return true;
}

// Escape на пинпаде: сначала чистим точки (канон §A), панель остаётся открытой.
export function escapeOnPin() {
  if (auth.step === 'pin' && auth.pin.length) { auth.pin = ''; auth.error = ''; return true; }
  return false;
}

export function pinValid() {
  return auth.pin.length >= PIN_MIN && auth.pin.length <= PIN_MAX;
}

// ------------------------------------------------------------
// Сеть — только через save-client (window.__saveApi).
// ------------------------------------------------------------
function api() {
  return typeof window !== 'undefined' ? window.__saveApi || null : null;
}

// Шаг 2 → вход на сервере. Возвращает { ok, error, code, offline }.
export async function submitPin(rawPin) {
  if (auth.busy) return { ok: false, error: 'busy' };
  if (rawPin !== undefined) auth.pin = String(rawPin).replace(/\D/g, '').slice(0, PIN_MAX);
  if (!pinValid()) {
    auth.error = 'ui.auth.errPin';
    auth.errorParams = { min: PIN_MIN, max: PIN_MAX };
    return { ok: false, error: auth.error };
  }
  const save = api();
  if (!save || typeof save.loginWithPin !== 'function') {
    auth.error = 'ui.auth.errNoClient';
    return { ok: false, error: auth.error };
  }
  auth.busy = true;
  auth.error = '';
  let res;
  try {
    res = await save.loginWithPin(auth.nick, auth.pin);
  } catch (e) {
    res = { ok: false, error: 'offline', offline: true };
  }
  auth.busy = false;
  if (res && res.ok) {
    auth.attempts = 0;
    auth.registered = !!res.registered;   // первый сохранение закрепило пин за ником
    auth.step = 'pull';
    // Сразу тянем снапшот: симуляция не должна стартовать до базы (§A).
    void runPull();
    return res;
  }
  // Неверный пин / кулдаун / нет сети — точки стираем и «дёргаем» панель.
  auth.attempts++;
  auth.pin = '';
  auth.shake++;
  auth.shakeCount++;
  if (res && res.code === 403) auth.error = 'ui.auth.errPinWrong';
  else if (res && res.code === 429) {
    auth.error = 'ui.auth.errCooldown';
    auth.errorParams = { s: Number(res.retryAfter) || 60 };
  } else if (res && (res.offline || res.error === 'сервер недоступен')) {
    auth.error = 'ui.auth.errOffline';
  } else auth.error = 'ui.auth.errLogin';
  // Обновляем панель (в headless это no-op).
  render();
  return res || { ok: false, error: auth.error };
}

// Pull снапшота ДО старта симуляции. timeoutMs — жёсткий таймаут (10 с).
export async function pullSnapshot({ timeoutMs = PULL_TIMEOUT_MS } = {}) {
  const save = api();
  if (!save || typeof save.pullSnapshot !== 'function') {
    return { ok: false, offline: true, error: 'no client' };
  }
  auth.pullState = 'loading';
  auth.progress = 'ui.auth.pullWait';
  render();
  let timer = null;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, offline: true, timeout: true }), timeoutMs);
  });
  let res;
  try {
    res = await Promise.race([save.pullSnapshot(), timeout]);
  } catch {
    res = { ok: false, offline: true };
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (res && res.ok) {
    auth.pullState = res.found > 0 ? 'ok' : 'empty';
    auth.progress = '';
    return res;
  }
  auth.pullState = 'offline';
  auth.progress = '';
  auth.step = 'offline';
  // Экран «Повторить / Играть офлайн» рисуем здесь же: гейт вызывает pullSnapshot
  // напрямую (без runPull), и без этой перерисовки игрок видел бы вечный спиннер.
  render();
  return res || { ok: false, offline: true };
}

// Применить полученный снапшот к игре (без перезагрузки страницы).
// Возвращает { applied, ccLevel } — ccLevel нужен автоприёмке «вход → КЦ-16».
export function applySnapshotToGame(game = (typeof window !== 'undefined' ? window.game : null)) {
  if (!game) return { applied: false, ccLevel: 0 };
  let raw = null;
  try { raw = localStorage.getItem('ac_raid_session_v1'); } catch { /* приватный режим */ }
  let session = null;
  if (raw) {
    try { session = JSON.parse(raw); } catch { session = null; }
  }
  game.raidSession = session;
  game.started = false;
  try {
    game.startRaidHome('human', { forceNew: !session });
  } catch (e) {
    console.warn('[auth] не удалось стартовать базу из снапшота', e);
    game.raidSession = null;
    game.startRaidHome('human', { forceNew: true });
  }
  const st = game.state;
  let ccLevel = 0;
  for (const b of (st && st.buildings) || []) {
    if (!b || b.dead || b.side !== 'player' || b.type !== 'cc') continue;
    ccLevel = Math.max(ccLevel, b.level || 1);
  }
  return { applied: !!session, ccLevel };
}

// ------------------------------------------------------------
// DOM. Всё строится кодом (в полигоне нет растровых ассетов UI).
// ------------------------------------------------------------
let overlay = null;
let keyBound = false;
// gateSettle — функция «гейт входа получил решение». Живёт только пока
// authGate() ждёт: успешный pull, кнопки офлайн-экрана и ЛЮБОЕ закрытие панели
// («Позже», Escape, клик по подложке) обязаны её вызвать. Иначе boot висел
// молча — это и был блокер ревью №2.
let gateSettle = null;

const esc = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
}[c]));

function dotsHtml() {
  const n = PIN_MAX;
  let out = '';
  for (let i = 0; i < n; i++) {
    out += `<span class="auth-dot${i < auth.pin.length ? ' is-on' : ''}" data-dot="${i}"></span>`;
  }
  return out;
}

function padHtml() {
  return PAD_KEYS.map((k) => {
    const label = k === 'C' ? t('ui.auth.keyClear') : k === 'back' ? '⌫' : k;
    const cls = 'auth-key' + (k === 'C' ? ' is-clear' : '') + (k === 'back' ? ' is-back' : '');
    const aria = k === 'C' ? t('ui.auth.keyClearAria')
      : k === 'back' ? t('ui.auth.keyBackAria') : k;
    return `<button type="button" class="${cls}" data-key="${k}" aria-label="${esc(aria)}">${esc(label)}</button>`;
  }).join('');
}

function errHtml() {
  if (!auth.error) return '';
  return `<div id="auth-err" class="auth-err" role="alert">${esc(t(auth.error, auth.errorParams || undefined))}</div>`;
}

function render() {
  if (!overlay) return;
  const box = overlay.querySelector ? overlay.querySelector('.auth-box') : null;
  if (!box) return;
  if (auth.shake) {
    box.classList.add('is-shake');
    auth.shake = 0;
  } else {
    box.classList.remove('is-shake');
  }
  const body = overlay.querySelector('#auth-body');
  if (!body) return;
  if (auth.step === 'login') {
    body.innerHTML = `
      <p class="auth-sub">${esc(t('ui.auth.loginSub'))}</p>
      <label class="auth-label" for="auth-nick">${esc(t('ui.auth.nickLabel'))}</label>
      <input id="auth-nick" class="auth-input" name="username" type="text" autocomplete="username"
        autocapitalize="none" spellcheck="false" maxlength="24" enterkeyhint="next"
        inputmode="text" value="${esc(auth.nick)}" aria-label="${esc(t('ui.auth.nickLabel'))}">
      <button id="auth-next" class="auth-main" type="button">${esc(t('ui.auth.next'))}</button>
      ${errHtml()}`;
  } else if (auth.step === 'pin') {
    body.innerHTML = `
      <p class="auth-sub">${esc(t('ui.auth.pinSub', { nick: auth.nick }))}</p>
      <div id="auth-dots" class="auth-dots" role="status" aria-label="${esc(t('ui.auth.dotsAria'))}">${dotsHtml()}</div>
      <div id="auth-pad" class="auth-pad" role="group" aria-label="${esc(t('ui.auth.padAria'))}">${padHtml()}</div>
      <button id="auth-enter" class="auth-main" type="button"${auth.busy ? ' disabled' : ''}>${esc(t('ui.auth.enter'))}</button>
      <button id="auth-back-step" class="auth-link" type="button">${esc(t('ui.auth.changeNick'))}</button>
      ${errHtml()}`;
  } else if (auth.step === 'pull') {
    body.innerHTML = `
      <div class="auth-progress" role="status" aria-live="polite">
        <span class="auth-spinner" aria-hidden="true"></span>
        <span>${esc(t('ui.auth.pullWait'))}</span>
      </div>
      <p class="auth-sub">${esc(t('ui.auth.pullSub', { nick: auth.nick }))}</p>`;
  } else if (auth.step === 'offline') {
    body.innerHTML = `
      <p class="auth-sub">${esc(t('ui.auth.offlineText'))}</p>
      <button id="auth-retry" class="auth-main" type="button">${esc(t('ui.auth.retry'))}</button>
      <button id="auth-offline" class="auth-link" type="button">${esc(t('ui.auth.offlinePlay'))}</button>`;
  }
  bind();
}

// reason: 'user' (игрок закрыл сам) | 'gate' (гейт уже принял решение сам)
function close(reason = 'user') {
  unregisterModal(AUTH_MODAL_ID);
  if (overlay) {
    overlay.classList.add('hidden');
    if (overlay.parentNode && typeof overlay.parentNode.removeChild === 'function') {
      overlay.parentNode.removeChild(overlay);
    } else if (typeof overlay.remove === 'function') {
      overlay.remove();
    }
  }
  overlay = null;
  // БЛОКЕР РЕВЬЮ №2: закрытие панели — это ТОЖЕ решение гейта. Офлайн-сервер,
  // игрок нажал «Позже»/Escape → играем на локальном прогрессе, boot идёт
  // дальше. Раньше промис гейта ждал только две кнопки и висел навсегда.
  const settle = gateSettle;
  if (settle && reason !== 'gate') {
    gateSettle = null;
    settle({ ready: true, source: 'local', dismissed: true });
  }
}

function ensureOverlay() {
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.id = 'auth-overlay';
  overlay.className = 'overlay auth-overlay';
  overlay.innerHTML = `
    <div class="overlay-box auth-box" role="dialog" aria-modal="true" aria-labelledby="auth-title">
      <h1 id="auth-title">${esc(t('ui.auth.title'))}</h1>
      <div id="auth-body"></div>
      <button id="auth-close" class="auth-link" type="button">${esc(t('ui.auth.later'))}</button>
    </div>`;
  document.body.append(overlay);
  const closeBtn = overlay.querySelector('#auth-close');
  if (closeBtn) closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  return overlay;
}

// Десктопная клавиатура: 0–9 / Backspace / Enter (только на шаге пина).
function onKeyDown(e) {
  if (!overlay || auth.step !== 'pin') return;
  const code = String(e.code || '');
  if (/^(Digit|Numpad)[0-9]$/.test(code) || /^[0-9]$/.test(String(e.key || ''))) {
    const d = /^[0-9]$/.test(String(e.key || '')) ? String(e.key) : code.slice(-1);
    pressKey(d);
    if (typeof e.preventDefault === 'function') e.preventDefault();
    render();
    return;
  }
  if (code === 'Backspace' || e.key === 'Backspace') {
    pressKey('back');
    if (typeof e.preventDefault === 'function') e.preventDefault();
    render();
    return;
  }
  if (code === 'Enter' || code === 'NumpadEnter' || e.key === 'Enter') {
    if (typeof e.preventDefault === 'function') e.preventDefault();
    void submitPin();
  }
}

function bind() {
  if (!overlay) return;
  const q = (sel) => overlay.querySelector(sel);
  const next = q('#auth-next');
  if (next) next.addEventListener('click', () => {
    const input = q('#auth-nick');
    const ok = goToPin(input ? input.value : auth.nick);
    // Анти-зум и автозаполнение: на шаге пина поле ника убираем совсем.
    render();
    if (!ok) return;
  });
  const nickEl = q('#auth-nick');
  if (nickEl) {
    nickEl.addEventListener('input', (e) => { auth.nick = normalizeNick(e.target && e.target.value); });
    nickEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (goToPin(nickEl.value)) render();
      }
    });
  }
  const pad = q('#auth-pad');
  if (pad) {
    pad.addEventListener('click', (e) => {
      const target = e.target && e.target.dataset ? e.target.dataset.key : null;
      if (!target) return;
      pressKey(target);
      render();
    });
  }
  const enter = q('#auth-enter');
  if (enter) enter.addEventListener('click', () => { void submitPin(); });
  const backStep = q('#auth-back-step');
  if (backStep) backStep.addEventListener('click', () => { authReset('login'); render(); });
  const retry = q('#auth-retry');
  if (retry) retry.addEventListener('click', () => { void runPull(); });
  const offlineBtn = q('#auth-offline');
  if (offlineBtn) offlineBtn.addEventListener('click', () => {
    // Явный офлайн-фолбэк: сначала решение для гейта, потом закрытие панели
    // (порядок важен: close() сам резолвит гейт как «закрыто игроком»).
    console.log('[auth] выбран офлайн-фолбэк: играем на локальном прогрессе');
    const off = typeof window !== 'undefined' ? window.__authOffline : null;
    if (typeof off === 'function') { off(); close('gate'); } else close('user');
  });
}

// Тост после входа: «Профиль создан» (сервер закрепил пин за новым ником)
// либо «База загружена: КЦ N». Второй тост не нужен — иначе два всплывающих.
function toastAfterLogin(applied) {
  const g = typeof window !== 'undefined' ? window.game : null;
  // __authToastHook — шов для headless-симов: namespace ui.js в node неизменяем,
  // поэтому тост нельзя перехватить подменой game.ui.toast.
  const hook = typeof window !== 'undefined' ? window.__authToastHook : null;
  if (typeof hook === 'function') {
    hook(auth.registered ? 'registered' : 'pulled', { nick: auth.nick, ccLevel: applied && applied.ccLevel });
  }
  if (!g || !g.ui || typeof g.ui.toast !== 'function') return;
  if (auth.registered) {
    g.ui.toast(t('ui.auth.profileCreated', { nick: auth.nick }), 'ok', 4200);
    auth.registered = false;
    return;
  }
  if (applied) g.ui.toast(t('ui.auth.pullOk', { n: applied.ccLevel || 1 }), 'ok', 3000);
}

async function runPull() {
  auth.step = 'pull';
  auth.error = '';
  render();
  const res = await pullSnapshot();
  if (res && res.ok) {
    // Применяем снапшот к живой игре: база КЦ-16 должна стоять в state
    // сразу после входа, без перезагрузки и без «новой базы».
    const applied = applySnapshotToGame(typeof window !== 'undefined' ? window.game : null);
    const done = typeof window !== 'undefined' ? window.__authDone : null;
    if (typeof done === 'function') {
      done(res, applied);      // сначала решение гейта…
      close('gate');           // …потом закрытие панели (иначе гейт решит «локально»)
    } else {
      close('user');
      toastAfterLogin(applied);
    }
    return;
  }
  render(); // шаг offline с «Повторить» и фолбэком
}

// ------------------------------------------------------------
// Публичный вход: открыть панель (мастер с шага 1 или шага 2).
// ------------------------------------------------------------
export function openAuth(game, { step = 'login', nick = '' } = {}) {
  void game;
  authReset(step);
  if (nick) auth.nick = normalizeNick(nick);
  closeOthers(AUTH_MODAL_ID);
  ensureOverlay();
  registerModal(AUTH_MODAL_ID, close, { onEscape: () => escapeOnPin() });
  overlay.classList.remove('hidden');
  if (!keyBound) {
    keyBound = true;
    window.addEventListener('keydown', onKeyDown);
  }
  render();
  return auth;
}

export function isAuthOpen() {
  return isModalOpen(AUTH_MODAL_ID);
}

// ------------------------------------------------------------
// BOOT-ГЕЙТ: pull снапшота ДО старта симуляции.
// Возвращает { ready, source: 'anon' | 'cloud' | 'empty' | 'local' | 'offline' }.
// ------------------------------------------------------------
export async function authGate(game = (typeof window !== 'undefined' ? window.game : null), opts = {}) {
  const save = api();
  if (!save || !save.identity) return { ready: true, source: 'anon' };

  // Гейт ОБЯЗАН завершиться при любом исходе:
  //   cloud | empty        — снапшот получен (и применён к игре);
  //   offline              — игрок выбрал «Играть офлайн»;
  //   local (dismissed)    — панель закрыта «Позже»/Escape/тапом по подложке;
  //   cloud/empty (retry)  — «Повторить» со второй попытки.
  // Раньше закрытие панели не резолвило промис → boot висел молча (блокер #2).
  const result = await new Promise((resolve) => {
    let done = false;
    const finishGate = (v) => {
      if (done) return;
      done = true;
      gateSettle = null;
      if (typeof window !== 'undefined') { window.__authDone = null; window.__authOffline = null; }
      resolve(v);
    };
    gateSettle = finishGate;
    if (typeof window !== 'undefined') {
      window.__authDone = (res, applied) => finishGate({
        ready: true, source: res && res.found > 0 ? 'cloud' : 'empty', applied, viaRetry: true,
      });
      window.__authOffline = () => finishGate({ ready: true, source: 'offline' });
    }

    openAuth(game, { step: 'pull' });
    render();
    // Собственный pull гейта. Неудача сама по себе гейт НЕ завершает: панель
    // показывает «Повторить»/«Играть офлайн», и ждём решения игрока.
    (async () => {
      const res = await pullSnapshot(opts);
      if (!(res && res.ok)) return;
      const applied = applySnapshotToGame(game);
      finishGate({ ready: true, source: res.found > 0 ? 'cloud' : 'empty', applied });
    })().catch(() => { /* остаёмся на экране выбора */ });
  });

  if (result.source === 'cloud' || result.source === 'empty') toastAfterLogin(result.applied);
  if (isAuthOpen()) close('gate');
  return result;
}

// ------------------------------------------------------------
// Подтверждение выхода (канон модалок [18]): выход стирает профиль И базу
// в этом браузере — спрашиваем один раз, одной модалкой.
// ------------------------------------------------------------
export const CONFIRM_MODAL_ID = 'auth-confirm';

export function confirmSignOut(onConfirm) {
  closeOthers(CONFIRM_MODAL_ID);
  const box = document.createElement('div');
  box.id = 'auth-confirm';
  box.className = 'overlay auth-overlay';
  box.innerHTML = `
    <div class="overlay-box auth-box" role="dialog" aria-modal="true" aria-labelledby="auth-confirm-title">
      <h1 id="auth-confirm-title">${esc(t('ui.auth.logoutTitle'))}</h1>
      <p class="auth-sub">${esc(t('ui.auth.logoutText', { nick: auth.nick || '—' }))}</p>
      <button id="auth-confirm-yes" class="auth-main" type="button">${esc(t('ui.auth.logoutYes'))}</button>
      <button id="auth-confirm-no" class="auth-link" type="button">${esc(t('ui.auth.logoutCancel'))}</button>
    </div>`;
  document.body.append(box);
  const closeConfirm = () => {
    unregisterModal(CONFIRM_MODAL_ID);
    if (box.parentNode && typeof box.parentNode.removeChild === 'function') box.parentNode.removeChild(box);
    else if (typeof box.remove === 'function') box.remove();
  };
  registerModal(CONFIRM_MODAL_ID, closeConfirm);
  const yes = box.querySelector('#auth-confirm-yes');
  if (yes) yes.addEventListener('click', () => { closeConfirm(); onConfirm(); });
  const no = box.querySelector('#auth-confirm-no');
  if (no) no.addEventListener('click', closeConfirm);
  return box;
}

// Для проверок: доступ к панели без DOM-событий.
export const _debug = {
  get overlay() { return overlay; },
  get gatePending() { return typeof gateSettle === 'function'; },
  render,
  close,
  PAD_KEYS,
};
