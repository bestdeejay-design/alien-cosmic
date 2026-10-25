// ============================================================
// i18n.js — каркас локалей (пакет I, по design/I18N.md).
// ЛИСТОВОЙ модуль: никаких статических импортов. Локали
// (`locales/*.js`) грузятся динамически только через реестр
// SUPPORTED_LOCALES — код для import() не строится из
// localStorage или navigator.languages.
//
//   t(key, params)            — строка по ключу ('ui.menu.season1')
//   message(key, faction)     — фракционная строка (messages.*)
//   entityText(kind,key,fac,f)— имя/описание сущности из локали
//   plural(n, forms)          — формы 1/2/5 через Intl.PluralRules
//   fmtNum / fmtDate          — Intl.NumberFormat / DateTimeFormat
//   setRich(el, str)          — безопасный DOM: только <b> и <br>
//   applyStaticDOM()          — маркеры data-i18n / data-i18n-title
//   initI18n / setLocale      — выбор и смена языка без перезагрузки
//
// Фолбэк: выбранная локаль → ru → '[missing:key]' (сим ловит).
// Язык хранится в `terranrts.language`, отдельно от прогресса и панели.
// Ошибки localStorage/navigator/document не ломают загрузку (headless).
// ============================================================

const LS_KEY = 'terranrts.language';

// Реестр локалей: только записям реестра разрешён import() и показ
// в переключателе. Новая локаль = файл locales/<code>.js + запись здесь.
export const SUPPORTED_LOCALES = {
  ru: { code: 'ru', label: 'Русский', htmlLang: 'ru', import: () => import('../locales/ru.js?v=10262510') },
  en: { code: 'en', label: 'English', htmlLang: 'en', import: () => import('../locales/en.js?v=10262510') },
};

let dict = null;      // словарь выбранной локали
let ruDict = null;    // русский фолбэк
let currentCode = 'ru';
const listeners = [];

// Чистая функция выбора стартовой локали (проверяется симом):
// валидный сохранённый код → он; иначе первая поддерживаемая из
// navigator.languages (сначала точное совпадение, затем базовый код);
// иначе 'ru'.
export function resolveInitialLocale(saved, navLangs) {
  const codes = Object.keys(SUPPORTED_LOCALES);
  if (saved && codes.includes(saved)) return saved;
  for (const tag of Array.isArray(navLangs) ? navLangs : []) {
    const s = String(tag).toLowerCase();
    if (codes.includes(s)) return s;
    const base = s.split('-')[0];
    if (codes.includes(base)) return base;
  }
  return 'ru';
}

function readSaved() {
  try { return localStorage.getItem(LS_KEY); } catch (e) { return null; }
}
function browserLangs() {
  try {
    const n = typeof navigator !== 'undefined' ? navigator : null;
    return (n && n.languages) || [];
  } catch (e) { return []; }
}
function persist(code) {
  try { localStorage.setItem(LS_KEY, code); } catch (e) { /* приватный режим */ }
}

export function getLocale() { return currentCode; }
export function onLocaleChange(cb) { listeners.push(cb); }

// ТЕСТОВЫЙ хук (только sim_i18n): подмена словарей без import() —
// позволяет проверять t()/фолбэк/missing чисто, без браузера.
export function __testSetDicts(d, ruFallback) {
  dict = d;
  ruDict = ruFallback;
  currentCode = (d && d.meta && d.meta.code) || 'ru';
}

export async function initI18n() {
  await setLocale(resolveInitialLocale(readSaved(), browserLangs()), { persist: false });
}

export async function setLocale(code, opts = {}) {
  const entry = SUPPORTED_LOCALES[code];
  if (!entry) return;
  const mod = await entry.import();
  const d = mod.default;
  if (!d || !d.meta) return;
  if (code === 'ru') ruDict = d; // фолбэк всегда держит русский
  dict = d;
  currentCode = code;
  if (opts.persist !== false) persist(code);
  // <html lang>, <title>, meta description
  try {
    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.lang = d.meta.htmlLang;
      document.title = lookup(d, 'ui.title') || document.title;
      const meta = document.querySelector ? document.querySelector('meta[name="description"]') : null;
      if (meta && lookup(d, 'ui.metaDesc')) meta.setAttribute('content', lookup(d, 'ui.metaDesc'));
    }
  } catch (e) { /* headless */ }
  applyStaticDOM();
  for (const cb of listeners) { try { cb(code); } catch (e) { /* слушатель не роняет смену */ } }
}

// --- Поиск по точечному пути: t('missions.7.name') ---
function lookup(d, key) {
  if (!d) return undefined;
  let cur = d;
  for (const part of key.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[part];
  }
  return cur;
}
export function has(key) {
  return lookup(dict, key) !== undefined || lookup(ruDict, key) !== undefined;
}

// Интерполяция '{name}': неизвестные плейсхолдеры остаются как есть —
// сим ловит незаменённые '{...}' в отрисованных строках.
export function interpolate(str, params) {
  if (!params) return str;
  return String(str).replace(/\{(\w+)\}/g, (m, name) =>
    params[name] !== undefined ? String(params[name]) : m);
}

export function t(key, params) {
  let v = lookup(dict, key);
  if (v === undefined) v = lookup(ruDict, key);
  if (v === undefined) return '[missing:' + key + ']';
  if (typeof v === 'string') return interpolate(v, params);
  if (v && typeof v === 'object' && params) return v; // объекты (формы множественного) — наружу
  return v;
}

// --- «Мягкий» запрос: undefined, если ключа нет ни в локали, ни в ru. ---
// Для опциональных по дизайну ключей (например, группы записей кодекса):
// t() при промахе возвращает заглушку '[missing:key]', tMaybe — ничего.
export function tMaybe(key) {
  let v = lookup(dict, key);
  if (v === undefined) v = lookup(ruDict, key);
  return v;
}

// --- Фракционные сообщения (бывший STR): messages.<key>.{human,alien} ---
export function message(key, faction, params) {
  const m = lookup(dict, 'messages.' + key) || lookup(ruDict, 'messages.' + key);
  if (!m || typeof m !== 'object') return '[missing:messages.' + key + ']';
  const v = faction === 'alien' ? (m.alien || m.human) : (m.human || m.alien);
  return interpolate(v || '', params);
}

// --- Сущности: units/buildings/upgrades.<key>.{human,alien}.{name,description} ---
export function entityText(kind, key, faction, field) {
  const side = faction === 'alien' ? 'alien' : 'human';
  const path = kind + '.' + key + '.' + side + '.' + field;
  let v = lookup(dict, path);
  if (v === undefined) v = lookup(ruDict, path);
  if (v === undefined) return '[missing:' + path + ']';
  return v;
}

// --- Формы множественного числа: {one, few, many, other} ---
// en: one/other; ru: one/few/many/other. Число подставляется как {n}.
export function plural(count, forms, params) {
  const obj = typeof forms === 'string' ? t(forms) : forms;
  if (!obj || typeof obj !== 'object') return String(count);
  let cat = 'other';
  try {
    if (typeof Intl !== 'undefined' && Intl.PluralRules) cat = new Intl.PluralRules(currentCode).select(count);
    else cat = count === 1 ? 'one' : 'other';
  } catch (e) { cat = count === 1 ? 'one' : 'other'; }
  const v = obj[cat] !== undefined ? obj[cat] : obj.other;
  return interpolate(v || '', Object.assign({}, params, { n: fmtNum(count), count: fmtNum(count) }));
}

export function fmtNum(n) {
  try {
    if (typeof Intl !== 'undefined' && Intl.NumberFormat) return new Intl.NumberFormat(currentCode).format(n);
  } catch (e) { /* ниже — простой путь */ }
  return String(n);
}

export function fmtDate(d) {
  try {
    if (typeof Intl !== 'undefined' && Intl.DateTimeFormat) {
      return new Intl.DateTimeFormat(currentCode, { day: 'numeric', month: 'short', year: 'numeric' }).format(d);
    }
  } catch (e) { /* ниже — ISO */ }
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d);
}

// --- Безопасная вставка переведённой строки: textContent + только
// разрешённые <b>…</b> и <br> (никаких innerHTML с переводом) ---
export function setRich(el, str) {
  if (!el) return;
  el.textContent = '';
  let bold = null;
  for (const part of String(str).split(/(<b>|<\/b>|<br>)/g)) {
    if (part === '<b>') {
      bold = document.createElement('b');
      el.appendChild(bold);
    } else if (part === '</b>') {
      bold = null;
    } else if (part === '<br>') {
      el.appendChild(document.createElement('br'));
    } else if (part) {
      (bold || el).appendChild(document.createTextNode(part));
    }
  }
}

// --- Статический DOM: маркеры data-i18n / data-i18n-title ---
export function applyStaticDOM(root) {
  if (typeof document === 'undefined' || !document.querySelectorAll) return;
  const scope = root || document;
  for (const el of Array.from(scope.querySelectorAll('[data-i18n]'))) {
    const v = t(el.getAttribute('data-i18n'));
    if (typeof v === 'string') setRich(el, v);
  }
  for (const el of Array.from(scope.querySelectorAll('[data-i18n-title]'))) {
    const v = t(el.getAttribute('data-i18n-title'));
    if (typeof v === 'string') el.title = v;
  }
  for (const el of Array.from(scope.querySelectorAll('[data-i18n-placeholder]'))) {
    const v = t(el.getAttribute('data-i18n-placeholder'));
    if (typeof v === 'string') el.placeholder = v;
  }
}
