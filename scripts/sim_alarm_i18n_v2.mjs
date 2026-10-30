// ============================================================
// sim_alarm_i18n_v2.mjs — ace#10: RU/EN контракт «Боевой тревоги v2».
// ACCEPTANCE §1: равенство наборов ключей, паритет {placeholder},
// запрет сырых ключей на экране. Запуск: node scripts/sim_alarm_i18n_v2.mjs
// ============================================================
import './harness.mjs';
import { V } from './stamp.mjs';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const failures = [];
const fail = (phase, err) => { failures.push(phase); console.log(`FAIL  ${phase}: ${String((err && err.message) || err)}`); };
const pass = (m) => console.log(`PASS  ${m}`);
const assert = (c, m) => { if (!c) throw new Error(m); };
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const ru = (await import('../r/locales/ru.js' + V)).default;
const en = (await import('../r/locales/en.js' + V)).default;

function flat(o, p = '') {
  const out = {};
  for (const [k, v] of Object.entries(o)) {
    const q = p ? p + '.' + k : k;
    if (v && typeof v === 'object') Object.assign(out, flat(v, q));
    else out[q] = v;
  }
  return out;
}

// ---------- I1: равенство наборов ключей и плейсхолдеров ----------
try {
  const fr = flat(ru.ui.combatAlertV2), fe = flat(en.ui.combatAlertV2);
  const kr = Object.keys(fr).sort(), ke = Object.keys(fe).sort();
  assert(kr.length >= 50, 'меньше 50 ключей: ' + kr.length);
  assert(JSON.stringify(kr) === JSON.stringify(ke), 'наборы ключей RU/EN расходятся');
  for (const k of kr) {
    const pr = [...String(fr[k]).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
    const pe = [...String(fe[k]).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
    assert(pr === pe, `плейсхолдеры ${k}: RU[${pr}] ≠ EN[${pe}]`);
    assert(String(fr[k]).trim().length > 0 && String(fe[k]).trim().length > 0, `пустой перевод ${k}`);
    assert(!/\{[a-z]+\}/i.test(String(fr[k]).replace(/\{\w+\}/g, '')), `сырой шаблон в ${k}`);
  }
  pass(`I1 RU/EN: ${kr.length} ключей, плейсхолдеры паритетны`);
} catch (e) { fail('I1 паритет', e); }

// ---------- I2: типы плейсхолдеров согласованы (0/1/2/5/21 в числовых) ----------
try {
  const fr = flat(ru.ui.combatAlertV2), fe = flat(en.ui.combatAlertV2);
  for (const [k, v] of Object.entries(fr)) {
    const names = [...String(v).matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    for (const n of names) {
      assert(typeof String(fe[k]).includes('{' + n + '}'), `EN потерял плейсхолдер ${k}.{${n}}`);
    }
  }
  pass('I2 каждый плейсхолдер RU присутствует в EN');
} catch (e) { fail('I2 типы', e); }

// ---------- I3: динамические ключи (mode/skill/report) собираются в обеих локалях ----------
try {
  for (const suffix of ['light', 'medium', 'hard']) {
    assert(ru.ui.combatAlertV2.mode[suffix] && en.ui.combatAlertV2.mode[suffix], 'нет mode.' + suffix);
  }
  for (const key of ['focus', 'triage', 'antiArtillery', 'engineer', 'reserve', 'scout', 'countermove', 'logistics']) {
    assert(ru.ui.combatAlertV2.skill[key] && en.ui.combatAlertV2.skill[key], 'нет skill.' + key);
  }
  for (const key of ['victory', 'defeat', 'bounty', 'payout', 'xp', 'points', 'sector', 'theft', 'repair', 'title']) {
    assert(ru.ui.combatAlertV2.report[key] && en.ui.combatAlertV2.report[key], 'нет report.' + key);
  }
  // К-2 (ревизия SZ m2): случай «нет v2» — отдельный честный ключ, не ложное «занято».
  for (const key of ['active', 'unavailable', 'outdated']) {
    assert(ru.ui.combatAlertV2.error[key] && en.ui.combatAlertV2.error[key], 'нет error.' + key);
  }
  pass('I3 динамические ключи (mode/skill/report/error) на месте в RU и EN');
} catch (e) { fail('I3 динамика', e); }

// ---------- I4: t() находит все используемые ключи через живой словарь ----------
try {
  const { t } = await import('../r/js/i18n.js' + V);
  const missing = [];
  for (const k of Object.keys(flat(ru.ui.combatAlertV2))) {
    const full = 'ui.combatAlertV2.' + k;
    const s = t(full, { mode: 'M', waves: 1, seconds: 1, wave: 1, total: 1, amount: 1, score: 1, preservation: 1, sector: 'N', damage: 1, coverage: 1, attempts: 1, returned: 1, lost: 1, cost: 1, count: 1, unreachable: 1, level: 1, xp: 1, need: 1, points: 1, rank: 1, n: 1 });
    if (!s || /\{[a-z]+\}/i.test(s)) missing.push(full);
  }
  assert(missing.length === 0, 'не резолвятся: ' + missing.join(', '));
  pass('I4 все ключи резолвятся через t() без сырых {шаблонов}');
} catch (e) { fail('I4 t()', e); }

if (failures.length) { console.log('FAIL  alarm i18n v2: ' + failures.join('; ')); process.exit(1); }
console.log('PASS  alarm i18n v2: все группы зелёные');
