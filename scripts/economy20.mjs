// ============================================================
// economy20.mjs — калькулятор и валидатор экономики рейдов (полигон r/).
//
// Берёт единственный источник чисел — r/js/economy.js — и печатает:
//   • таблицу грейдов КЦ 1→20 с условиями (правило «L зданий уровня L−1»);
//   • таблицу грейдов всех зданий (цена/время/статы по уровням);
//   • рейдовые тиры 1→20: открытие, состав, добыча, доход/мин, трюм;
//   • сроки и «сколько рейдов нужно» на каждый уровень (окупаемость);
//   • итог: сколько ресурсов нужно на базу-20 (КЦ + 20 зданий + ранги).
//
// Запуск: node scripts/economy20.mjs [--md]
//   --md  — печать в markdown (для вставки в design/ECONOMY_20.md)
// ============================================================
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = path.join(ROOT, '.tmpcheck');
mkdirSync(TMP, { recursive: true });
const dst = path.join(TMP, 'economy_r.mjs');
writeFileSync(dst, readFileSync(path.join(ROOT, 'r/js/economy.js'), 'utf8'));
const E = await import(pathToFileURL(dst).href + '?t=' + Date.now());

const MD = process.argv.includes('--md');
const nf = (n) => Math.round(n).toLocaleString('ru-RU');
const pad = (s, w) => String(s).padEnd(w);
const padL = (s, w) => String(s).padStart(w);

function table(head, rows) {
  if (!MD) {
    const widths = head.map((h, i) => Math.max(String(h).length, ...rows.map((r) => String(r[i]).length)));
    console.log(head.map((h, i) => pad(h, widths[i])).join('  '));
    console.log(widths.map((w) => '-'.repeat(w)).join('  '));
    for (const r of rows) console.log(r.map((c, i) => pad(c, widths[i])).join('  '));
    return;
  }
  console.log('| ' + head.join(' | ') + ' |');
  console.log('|' + head.map((h) => '---').join('|') + '|');
  for (const r of rows) console.log('| ' + r.join(' | ') + ' |');
}

// ------------------------------------------------------------
// 0. Вводные: модель добычи
// ------------------------------------------------------------
const cycle = E.homeCycleSeconds();
const perWorkerMin = E.homeIncomePerWorker();
console.log('\n=== МОДЕЛЬ ДОБЫЧИ (из констант игры) ===');
console.log(`цикл рабочего на базе: ${cycle.toFixed(2)} с (шахта ${E.MINING.mineTime} с + дорога)`);
console.log(`доход одного рабочего: ${perWorkerMin.toFixed(1)} эрг/мин`);
console.log(`4 рабочих: ${(perWorkerMin * 4).toFixed(0)} эрг/мин · 8: ${(perWorkerMin * 8).toFixed(0)} · 12: ${(perWorkerMin * 12).toFixed(0)}`);

// ------------------------------------------------------------
// 1. КЦ 1→20
// ------------------------------------------------------------
console.log('\n=== КЦ 1→20: цена, время, условие ===');
const ccRows = [];
let cumulative = 0;
for (const row of E.ccProgression()) {
  cumulative += row.cost;
  ccRows.push([
    row.level, nf(row.cost), nf(cumulative), row.time + ' с',
    row.gateNeed ? `${row.gateNeed} зд. ${row.gateLevel} ур.+` : '—',
    'тир ' + row.raidTier,
  ]);
}
table(['ур.', 'грейд', 'всего', 'время', 'условие КЦ', 'открывает'], ccRows);

// ------------------------------------------------------------
// 2. Грейды зданий
// ------------------------------------------------------------
console.log('\n=== ГРЕЙДЫ ЗДАНИЙ: цена по целевым уровням ===');
const types = Object.keys(E.GRADE_TABLE);
const levels = [2, 3, 4, 5, 8, 10, 12, 15, 18, 19, 20];
const gRows = types.map((type) => {
  const cells = levels.map((L) => {
    const g = E.gradeEntry(type, L);
    return g ? nf(g.cost) : '—';
  });
  return [type, ...cells, nf(E.chainCost(type, Lv15or19(type)))];
});
function Lv15or19(type) { return type === 'cc' ? 20 : 19; }
table(['здание', ...levels.map((L) => '→' + L), 'всего до ' + '(19/20)'], gRows);

console.log('\n=== ГРЕЙДЫ: время и статы по уровням (турия) ===');
table(['ур.', 'урон', 'дальность', 'HP×', 'время'],
  levels.map((L) => {
    const g = E.gradeEntry('turret', L);
    return [L, g.dmg, g.range, '—', g.time + ' с'];
  }));

// ------------------------------------------------------------
// 3. Рейды 1→20
// ------------------------------------------------------------
console.log('\n=== РЕЙДЫ 1→20 ===');
const raidRows = [];
for (let T = 1; T <= E.MAX_LEVEL; T++) {
  const t = E.raidTierAt(T);
  const workers = Math.max(2, Math.floor(t.maxUnits / 2));
  const incub = T >= 5 ? E.HOUSE_LEVELS.cargo(Math.min(E.MAX_LEVEL, T)) : 3000;
  const cap = Math.min(t.yieldTotal, incub);
  const mins = cap / E.raidIncomePerMinute(T, workers);
  raidRows.push([
    T, 'КЦ ' + t.unlockCC, t.maxUnits, nf(t.maxBudget), nf(t.yieldTotal),
    t.tripYield, nf(cap), mins.toFixed(1) + ' мин',
  ]);
}
table(['тир', 'нужен', 'ед.', 'бюджет', 'эрг на карте', 'эрг/рейс', 'вывезти', 'заполнить'], raidRows);

// ------------------------------------------------------------
// 3b. Готовность уровня: сколько стоит довести базу до КЦ-L
// ------------------------------------------------------------
console.log('\n=== ДОРОГА ДО КЦ-L: КЦ + широкий набор зданий ===');
const readyRows = [];
for (let L = 2; L <= E.MAX_LEVEL; L++) {
  const ccSum = E.chainCost('cc', L);
  const need = L;                      // условие КЦ→L: L зданий уровня L−1
  const to = L - 1;
  const cheapest = Math.min(...Object.keys(E.GRADE_TABLE).filter((x) => x !== 'cc').map((x) => E.chainCost(x, to)));
  const wide = need * cheapest;
  readyRows.push([L, nf(ccSum), nf(wide), nf(ccSum + wide)]);
}
table(['КЦ', 'КЦ всего', 'широкий набор (мин.)', 'итого'], readyRows);

// ------------------------------------------------------------
// 4. Окупаемость: сколько рейдов на уровень КЦ
// ------------------------------------------------------------
console.log('\n=== ОКУПАЕМОСТЬ: сколько рейдов нужно на грейд КЦ ===');
const payRows = [];
for (let L = 2; L <= E.MAX_LEVEL; L++) {
  const g = E.gradeEntry('cc', L);
  const t = E.raidTierAt(L);
  const workers = Math.max(2, Math.floor(t.maxUnits / 2));
  const perRaid = Math.min(t.yieldTotal, E.HOUSE_LEVELS.cargo(L));
  const raids = g.cost / Math.max(1, perRaid);
  const homeMin = g.cost / perWorkerMin / 8; // 8 рабочих дома
  payRows.push([
    L, nf(g.cost), raids.toFixed(1), Math.ceil(raids),
    (g.cost / E.homeIncomePerWorker() / 8).toFixed(0) + ' мин (8 раб.)',
  ]);
}
table(['КЦ', 'грейд', 'рейдов', 'рейдов (округл.)', 'домашней добычей'], payRows);

// ------------------------------------------------------------
// 5. ИТОГ: база на максимум
// ------------------------------------------------------------
const plan = E.basePlanCost({ level: E.MAX_LEVEL });
console.log('\n=== БАЗА НА МАКСИМУМ (20 уровней) ===');
const planRows = Object.entries(plan.perType).map(([k, v]) => [
  k, v.count, v.target, nf(v.each), nf(v.total),
]);
table(['тип', 'шт.', 'до ур.', 'каждое', 'итого'], planRows);
console.log(`\nздания: ${nf(plan.buildings)} эрга`);
console.log(`ранги юнитов (лаборатория): ${nf(plan.tech)} эрга`);
console.log(`ВСЕГО (рекомендуемая база): ${nf(plan.total)} эрга`);
const minPlan = E.cheapestWidePlan();
console.log(`МИНИМУМ для КЦ-20 (КЦ + ${minPlan.count} × ${minPlan.type} до 19 ур.): ${nf(minPlan.total)} эрга`);

// ------------------------------------------------------------
// 6. Валидатор баланса (жёсткие проверки, падает с кодом 1)
// ------------------------------------------------------------
const problems = [];
const fail = (m) => problems.push(m);
if (E.MAX_LEVEL !== 20) fail('MAX_LEVEL должен быть 20');
for (let L = 3; L <= E.MAX_LEVEL; L++) {
  const gate = E.ccGate(L);
  if (gate.count !== L || gate.minLevel !== L - 1) fail(`условие КЦ→${L} посчитано неверно`);
}
for (let L = 2; L <= E.MAX_LEVEL; L++) {
  const g = E.gradeEntry('cc', L);
  if (!g || !(g.cost > 0)) fail(`нет цены грейда КЦ→${L}`);
  if (L > 2 && g.cost <= E.gradeEntry('cc', L - 1).cost) fail(`цена КЦ→${L} не растёт`);
}
for (let T = 2; T <= E.MAX_LEVEL; T++) {
  const a = E.raidTierAt(T - 1), b = E.raidTierAt(T);
  if (!(b.yieldTotal > a.yieldTotal)) fail(`добыча тира ${T} не растёт`);
  if (!(b.tripYield >= a.tripYield)) fail(`эрг/рейс тира ${T} не растёт`);
}
// Кривая цены: рост за уровень в коридоре 1.3–1.6
for (const type of types) {
  const a = E.gradeEntry(type, 10), b = E.gradeEntry(type, 11);
  if (!a || !b) { fail(`нет грейда ${type} на 10–11`); continue; }
  const ratio = b.cost / a.cost;
  if (ratio < 1.25 || ratio > 1.65) fail(`${type}: рост цены ${ratio.toFixed(2)} вне 1.25–1.65`);
}
// Рейд должен окупать грейд КЦ за 1–8 вылетов
for (let L = 2; L <= E.MAX_LEVEL; L++) {
  const g = E.gradeEntry('cc', L);
  const t = E.raidTierAt(L);
  const perRaid = Math.min(t.yieldTotal, E.HOUSE_LEVELS.cargo(Math.max(2, L)));
  const raids = g.cost / perRaid;
  // Ранняя игра (КЦ ≤ 8) финансируется домашним месторождением, поэтому
  // 0.2 рейда на грейд там — норма; дальше рейд обязан быть основным путём.
  const lo = L <= 8 ? 0.2 : 0.5;
  if (raids < lo || raids > 12) fail(`КЦ→${L}: рейдов на грейд ${raids.toFixed(1)} вне ${lo}–12`);
}
// Трюм Дома должен позволять вывезти хотя бы половину карты тира
for (let L = 5; L <= E.MAX_LEVEL; L++) {
  const cargo = E.HOUSE_LEVELS.cargo(L);
  const y = E.raidTierAt(L).yieldTotal;
  if (cargo < y * 0.4) fail(`Дом Г${L}: трюм ${cargo} меньше 40% добычи тира ${y}`);
}

if (problems.length) {
  console.log('\n❌ ПРОБЛЕМЫ БАЛАНСА:');
  for (const p of problems) console.log('  · ' + p);
  process.exitCode = 1;
} else {
  console.log('\n✅ Баланс-инварианты в порядке (кривые цен, условия КЦ, добыча тиров, окупаемость).');
}
