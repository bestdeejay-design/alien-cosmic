// ============================================================
// sim_i18n.mjs — пакет I: полнота и согласованность локалей
// (design/I18N.md §6.1). Проверки:
//   T1  реестр ↔ файлы: locales/*.js соответствуют SUPPORTED_LOCALES
//   T2  схема 1:1: ключи/типы ru/en совпадают рекурсивно
//   T3  placeholder parity: наборы {name} в каждой паре равны
//   T4  t(): ru, en, неизвестная локаль, RU-фолбэк, missing-маркер
//   T5  plural: формы 0/1/2/5/21 (ru: one/few/many; en: one/other)
//   T6  числа/даты: Intl формат по локали
//   T7  выбор стартовой локали: saved → navigator (exact → base) → ru
//   T8  data-i18n маркеры index.html разрешаются в ОБОИХ словарях
//   T9  no-hardcode: в js/*.js нет пользовательских кириллических
//       литералов вне комментариев (тексты — только в locales/)
//   T10 инварианты кампании: id/порядок/seeds/баны не тронуты,
//       тексты миссий читаются из локали по прежним id
// Запуск: node scripts/sim_i18n.mjs (и вложенно из check.mjs)
// ============================================================

const failures = [];
function fail(phase, err) {
  failures.push(phase);
  console.log(`FAIL  ${phase}: ${String((err && err.message) || err)}`);
}
function pass(msg) { console.log(`PASS  ${msg}`); }
function assert(c, msg) { if (!c) throw new Error(msg); }

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));

const I = await import('../js/i18n.js');
const M = await import('../js/missions.js');
const L = await import('../js/lore.js');

// Локали грузим напрямую (не через выбор браузера).
const ru = (await import('../locales/ru.js')).default;
const en = (await import('../locales/en.js')).default;

// ---------- T1: реестр ↔ файлы ----------
try {
  const files = readdirSync(ROOT + 'locales').filter((f) => f.endsWith('.js')).map((f) => f.replace('.js', ''));
  const reg = Object.keys(I.SUPPORTED_LOCALES);
  assert(files.length === reg.length && files.every((f) => reg.includes(f)),
    'файлы/реестр расходятся: ' + files.join(',') + ' vs ' + reg.join(','));
  for (const code of reg) {
    const d = (await I.SUPPORTED_LOCALES[code].import()).default;
    assert(d && d.meta && d.meta.code === code, 'meta.code не ' + code);
    assert(d.meta.label && d.meta.htmlLang, 'meta.label/htmlLang пусты у ' + code);
  }
  pass('T1 реестр SUPPORTED_LOCALES ↔ locales/*.js 1:1, meta заполнены');
} catch (e) { fail('T1 registry-files', e); }

// ---------- T2: схема 1:1 (ключи и типы) ----------
try {
  const walk = (a, b, path) => {
    if (typeof a === 'string' || typeof b === 'string') {
      assert(typeof a === 'string' && typeof b === 'string', 'тип не строка: ' + path);
      return;
    }
    if (Array.isArray(a)) {
      assert(Array.isArray(b) && a.length === b.length, 'массив длиной/типом отличен: ' + path);
      a.forEach((x, i) => walk(x, b[i], path + '[' + i + ']'));
      return;
    }
    assert(a && b && typeof a === 'object' && typeof b === 'object', 'узел отсутствует: ' + path);
    for (const k of Object.keys(a)) assert(k in b, 'нет в EN: ' + path + '.' + k);
    for (const k of Object.keys(b)) assert(k in a, 'нет в RU: ' + path + '.' + k);
    for (const k of Object.keys(a)) if (k in b) walk(a[k], b[k], path + '.' + k);
  };
  walk(ru, en, '');
  pass('T2 схема ru/en 1:1 (ключи, массивы, типы)');
} catch (e) { fail('T2 schema-parity', e); }

// ---------- T3: placeholder parity ----------
try {
  const ph = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join(',');
  const walk = (a, b, path) => {
    if (typeof a === 'string') {
      assert(ph(a) === ph(b), 'плейсхолдеры: ' + path + ' «' + ph(a) + '» vs «' + ph(b) + '»');
      return;
    }
    if (Array.isArray(a)) { a.forEach((x, i) => walk(x, b[i], path + '[' + i + ']')); return; }
    for (const k of Object.keys(a)) if (b && typeof b === 'object' && k in b) walk(a[k], b[k], path + '.' + k);
  };
  walk(ru, en, '');
  pass('T3 плейсхолдеры {n}/{name}/… совпадают во всех парах');
} catch (e) { fail('T3 placeholders', e); }

// ---------- T4: t() и фолбэк ----------
try {
  // Словари подменяем напрямую (чистые функции, без DOM/localStorage).
  const setDicts = (d, r) => { I.__testSetDicts(d, r); };
  setDicts(ru, ru);
  assert(I.t('ui.menu.season1') === 'Сезон 1 · Кампания', 't() ru сломан');
  assert(I.t('missions.1.name') === 'Ночь штырей', 't() миссия по id сломан');
  assert(I.message('noMinerals', 'alien') === 'Улью нужно больше граней', 'message() alien сломан');
  assert(I.message('noMinerals', 'human') === 'Не хватает минералов', 'message() human сломан');
  assert(I.entityText('units', 'marine', 'alien', 'name') === 'Кристожал', 'entityText() сломан');
  // EN
  setDicts(en, ru);
  assert(I.t('ui.menu.season1') === 'Season 1 · Campaign', 't() en сломан');
  assert(I.message('noMinerals', 'alien') === 'The hive needs more facets', 'message() en сломан');
  assert(I.entityText('units', 'marine', 'alien', 'name') === 'Shardjaw', 'глоссарий §3.2: Shardjaw');
  assert(I.entityText('upgrades', 'autoRepair', 'alien', 'name') === 'Mend-Song', 'глоссарий §3.3: Mend-Song');
  // Отсутствующий EN-ключ → RU-фолбэк; отсутствующий RU → missing-маркер
  const enPatch = JSON.parse(JSON.stringify(en));
  delete enPatch.ui.menu.season2Toast;
  setDicts(enPatch, ru);
  assert(I.t('ui.menu.season2Toast') === 'Сезон 2 пока в разработке: доступна первая миссия-прототип.', 'RU-фолбэк сломан');
  setDicts(enPatch, { meta: { code: 'ru' } });
  assert(I.t('ui.menu.season2Toast').startsWith('[missing:'), 'missing-маркер не отдан');
  // Неизвестная локаль игнорируется реестром
  assert(!I.SUPPORTED_LOCALES.de, 'реестр пропускает незарегистрированный код');
  setDicts(ru, ru);
  pass('T4 t()/message()/entityText(): ru, en, фолбэк RU, missing-маркер');
} catch (e) { fail('T4 t-fallback', e); }

// ---------- T5: plural ----------
try {
  I.__testSetDicts({
    meta: { code: 'ru' },
    test: { n: { one: '{n} боец', few: '{n} бойца', many: '{n} бойцов', other: '{n} бойца' } },
  }, null);
  const cases = [[1, '1 боец'], [2, '2 бойца'], [5, '5 бойцов'], [21, '21 боец'], [0, '0 бойцов'], [11, '11 бойцов']];
  for (const [n, want] of cases) assert(I.plural(n, 'test.n') === want, `plural ru ${n}: ` + I.plural(n, 'test.n'));
  I.__testSetDicts({
    meta: { code: 'en' },
    test: { n: { one: '{n} soldier', other: '{n} soldiers' } },
  }, null);
  assert(I.plural(1, 'test.n') === '1 soldier', 'plural en 1');
  assert(I.plural(5, 'test.n') === '5 soldiers', 'plural en 5');
  I.__testSetDicts(ru, ru);
  pass('T5 plural 0/1/2/5/11/21: ru one/few/many, en one/other');
} catch (e) { fail('T5 plural', e); }

// ---------- T6: числа/даты ----------
try {
  I.__testSetDicts({ meta: { code: 'ru' } }, null);
  assert(I.fmtNum(2500).includes('2'), 'fmtNum сломан');
  assert(/\d/.test(I.fmtDate(new Date(2026, 9, 21))), 'fmtDate сломан');
  I.__testSetDicts(ru, ru);
  pass('T6 fmtNum/fmtDate не падают и дают цифры');
} catch (e) { fail('T6 fmt', e); }

// ---------- T7: выбор стартовой локали (чистая функция) ----------
try {
  const r = I.resolveInitialLocale;
  assert(r('en', ['ru']) === 'en', 'saved имеет приоритет');
  assert(r(null, ['de-DE', 'en-US']) === 'en', 'exact/base match');
  assert(r(null, ['de-DE', 'en']) === 'en', 'exact match');
  assert(r(null, ['ru-RU']) === 'ru', 'base ru-RU → ru');
  assert(r(null, ['de', 'fr']) === 'ru', 'нет совпадения → ru');
  assert(r(null, []) === 'ru', 'пустой navigator → ru');
  assert(r('xx', ['de']) === 'ru', 'невалидный saved → браузер/ru');
  pass('T7 saved → navigator (exact → base) → ru');
} catch (e) { fail('T7 locale-pick', e); }

// ---------- T8: data-i18n маркеры index.html ----------
try {
  const html = readFileSync(ROOT + 'index.html', 'utf8');
  const keys = [...html.matchAll(/data-i18n(?:-title|-placeholder)?="([^"]+)"/g)].map((m) => m[1]);
  assert(keys.length >= 30, 'маркеров мало: ' + keys.length);
  const get = (d, key) => key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), d);
  for (const k of keys) {
    const rv = get(ru, k), ev = get(en, k);
    assert(typeof rv === 'string', 'нет в RU: ' + k);
    assert(typeof ev === 'string', 'нет в EN: ' + k);
  }
  // Тайтл и meta description — тоже из словаря
  assert(typeof ru.ui.title === 'string' && typeof en.ui.title === 'string', 'ui.title нет');
  assert(typeof ru.ui.metaDesc === 'string' && typeof en.ui.metaDesc === 'string', 'ui.metaDesc нет');
  pass(`T8 все ${keys.length} data-i18n маркеров разрешаются в ru и en`);
} catch (e) { fail('T8 static-markers', e); }

// ---------- T9: no-hardcode (кириллица только в комментариях) ----------
try {
  const targets = readdirSync(ROOT + 'js').filter((f) => f.endsWith('.js')).map((f) => 'js/' + f);
  const stripComments = (src) => {
    let out = '', i = 0;
    while (i < src.length) {
      const c = src[i], d = src[i + 1];
      if (c === '/' && d === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
      if (c === '/' && d === '*') { i += 2; while (i < src.length - 1 && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
      if (c === '"' || c === "'" || c === '`') {
        const q = c; out += c; i++;
        while (i < src.length) {
          if (src[i] === '\\') { out += src[i] + (src[i + 1] || ''); i += 2; continue; }
          out += src[i];
          if (src[i] === q) { i++; break; }
          i++;
        }
        continue;
      }
      out += c; i++;
    }
    return out;
  };
  const bad = [];
  for (const f of targets) {
    const lines = stripComments(readFileSync(ROOT + f, 'utf8')).split('\n');
    lines.forEach((l, idx) => {
      if (!/[А-Яа-яЁё]/.test(l)) return;
      // Исключение по дизайну §2.3: native-подписи локалей в реестре
      // SUPPORTED_LOCALES (label — имя языка на самом языке, не переводится).
      if (f === 'js/i18n.js' && /label:\s*'/.test(l)) return;
      bad.push(`${f}:${idx + 1}`);
    });
  }
  // index.html: маркер-рефакторинг — кириллица допустима только в HTML-комментариях
  const html = readFileSync(ROOT + 'index.html', 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  if (/[А-Яа-яЁё]/.test(html)) bad.push('index.html (статичный текст)');
  assert(bad.length === 0, 'литералы вне локалей: ' + bad.slice(0, 8).join(', '));
  pass(`T9 no-hardcode: ${targets.length} файлов js + index.html чисты`);
} catch (e) { fail('T9 no-hardcode', e); }

// ---------- T10: инварианты кампании ----------
try {
  const ids = M.MISSIONS.map((m) => m.id);
  assert(JSON.stringify(ids) === JSON.stringify([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 18, 19]),
    'состав/порядок миссий изменился: ' + ids.join(','));
  const seeds = [20260101, 20260102, 20260103, 20260104, 20260105, 20260106, 20260107, 20260108, 20260109, 20260110, 20260111, 20260112, 20260113, 20260114, 20260115, 20260117, 20260118, 20260119, 20260120];
  M.MISSIONS.forEach((m, i) => assert(m.map.seed === seeds[i], 'seed миссии ' + m.id + ' изменён'));
  assert(M.MISSIONS[17].banBuild && M.MISSIONS[17].banBuild.join(',') === 'barracks,factory,lab', 'banBuild №18 изменён');
  assert(M.MISSIONS[6].enemyFaction === 'human' && M.MISSIONS[7].enemyFaction === 'human' && M.MISSIONS[11].enemyFaction === 'human', 'enemyFaction J-фикс откатился');
  // Тексты читаются по id (обе локали), у скирмиша — свой раздел
  for (const code of ['ru', 'en']) {
    const d = code === 'ru' ? ru : en;
    for (const m of M.MISSIONS) {
      const sec = d.missions[m.id];
      assert(sec && sec.name && Array.isArray(sec.brief) && sec.brief.length >= 2, 'нет текста миссии ' + m.id + ' в ' + code);
      assert(sec.act, 'нет акта миссии ' + m.id + ' в ' + code);
    }
    assert(d.missions.skirmish && d.missions.skirmish.name, 'нет missions.skirmish в ' + code);
  }
  // Кодекс: структура и тексты по прежним id
  assert(L.CODEX.length === 8, 'вкладок кодекса не 8');
  assert(L.CODEX[2].id === 'kharid' && L.CODEX[2].unlockAfter === 1, 'unlockAfter kharid изменён');
  assert(L.codexEntryParts(L.CODEX[2], 2).length > 1, 'kharid не открылся после №1');
  assert(L.codexEntryParts(L.CODEX[2], 0).some((p) => p.type === 'locked'), 'kharid открыт раньше времени');
  pass('T10 id/порядок/seeds/баны нетронуты; тексты по id в обеих локалях');
} catch (e) { fail('T10 campaign-invariants', e); }

console.log(failures.length ? `\nИТОГ SIM_I18N: ${failures.length} ОШИБОК (${failures.join(', ')})` : '\nИТОГ SIM_I18N: ВСЕ ПРОВЕРКИ ПРОШЛИ');
process.exit(failures.length ? 1 : 0);
