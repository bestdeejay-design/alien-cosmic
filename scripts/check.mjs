// Проверка проекта Alien Cosmic:
//  1) синтаксис каждого js-модуля (node --check через копию .mjs);
//  2) все относительные импорты существуют (регистр важен) и
//     именованные экспорты реально объявлены;
//  3) index.html ссылается на существующие файлы;
//  4) запреты: fetch/XHR/WebSocket, абсолютные пути, внешние URL.
// Запуск из корня репозитория: node scripts/check.mjs
import { readdirSync, readFileSync, copyFileSync, mkdirSync, existsSync } from 'fs';
import { execFileSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const JS = path.join(ROOT, 'js');
const TMP = path.join(ROOT, '.tmpcheck');
mkdirSync(TMP, { recursive: true });

let failed = 0;
const err = (m) => { failed = 1; console.error('  ✗ ' + m); };
const ok = (m) => console.log('  ✓ ' + m);

const files = readdirSync(JS).filter((f) => f.endsWith('.js'));
const src = {};
for (const f of files) src[f] = readFileSync(path.join(JS, f), 'utf8');

// 1) Синтаксис
console.log('\n[1] Синтаксис модулей:');
for (const f of files) {
  const dst = path.join(TMP, f.replace(/\.js$/, '.mjs'));
  copyFileSync(path.join(JS, f), dst);
  try {
    execFileSync('node', ['--check', dst], { stdio: 'pipe' });
    ok(f);
  } catch (e) {
    err(f + '\n' + e.stderr.toString());
  }
}

// 2) Импорты ↔ экспорты
console.log('\n[2] Импорты и экспорты:');
function exportsOf(f) {
  const s = src[f];
  const set = new Set();
  for (const m of s.matchAll(/export\s+(?:async\s+)?(?:class|function\s*\*?|const|let|var)\s+([A-Za-z_$][\w$]*)/g)) set.add(m[1]);
  for (const m of s.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const raw of m[1].split(',')) {
      const name = raw.split(/\s+as\s+/).pop().trim();
      if (name) set.add(name);
    }
  }
  return set;
}
for (const f of files) {
  for (const m of src[f].matchAll(/import\s*(?:([A-Za-z_$][\w$]*)|\*\s*as\s+([A-Za-z_$][\w$]*)|\{([^}]*)\})?\s*from\s*['"](\.[^'"]+)['"]/g)) {
    const named = m[3] ? m[3].split(',').map((x) => x.trim()).filter(Boolean) : [];
    const from = m[4];
    const base = path.basename(from);
    if (!src[base]) { err(`${f}: импорт '${from}' — файла нет (проверьте регистр)`); continue; }
    const ex = exportsOf(base);
    for (const raw of named) {
      const name = raw.split(/\s+as\s+/)[0].trim();
      if (name && !ex.has(name)) err(`${f}: '${base}' не экспортирует '${name}'`);
    }
  }
}
if (!failed) ok('все импорты/экспорты сходятся');

// 3) index.html и статические ссылки
console.log('\n[3] Точка входа:');
const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
for (const m of html.matchAll(/(?:src|href)="(\.\/[^"]+)"/g)) {
  const p = path.join(ROOT, m[1]);
  if (!existsSync(p)) err('index.html: нет файла ' + m[1]);
  else ok(m[1]);
}
if (!html.includes('./js/game.js')) err('index.html не подключает ./js/game.js');
if (html.includes('src="/') || html.includes('href="/')) err('найден абсолютный путь в index.html');

// 4) Запреты: fetch/XHR/абсолютные пути в модулях
console.log('\n[4] Запреты (fetch / XHR / абсолютные пути / CDN):');
for (const f of files) {
  if (/\bfetch\s*\(|XMLHttpRequest|WebSocket/.test(src[f])) err(f + ': сетевой запрос!');
  if (/from\s+['"]\//.test(src[f])) err(f + ': абсолютный путь в импорте');
  if (/https?:\/\//.test(src[f])) err(f + ': внешний URL');
}
if (!failed) ok('нарушений нет');

// 5) Бренд и social preview
console.log('\n[5] Бренд и social preview:');
if (!html.includes('ALIEN') || !html.includes('COSMIC')) err('index.html: нет названия ALIEN COSMIC');
else ok('название ALIEN COSMIC на месте');
for (const tag of ['property="og:title"', 'property="og:description"', 'property="og:image"', 'property="og:type"', 'name="twitter:card" content="summary_large_image"']) {
  if (!html.includes(tag)) err('index.html: нет social meta ' + tag);
}
const ogPath = path.join(ROOT, 'assets', 'og-image.png');
const ogScript = path.join(ROOT, 'scripts', 'shots', 'og_image.py');
if (!existsSync(ogPath) || !existsSync(ogScript)) err('нет генератора scripts/shots/og_image.py или assets/og-image.png');
else {
  const og = readFileSync(ogPath);
  if (!og.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) err('assets/og-image.png: неверная PNG-сигнатура');
  else if (og.readUInt32BE(16) !== 1200 || og.readUInt32BE(20) !== 630) err('assets/og-image.png: ожидается ровно 1200×630');
  else ok('OG/Twitter-теги + assets/og-image.png 1200×630 и скрипт генерации');
}

// 6) Версия (V): бейдж N на главной странице, дата фактической поставки
console.log('\n[6] Версия:');
if (!exportsOf('config.js').has('GAME_VERSION') || !src['config.js'].includes("GAME_VERSION = 'S'")) err("config.js: нет GAME_VERSION === 'S'");
else ok("GAME_VERSION === 'S'");
if (!exportsOf('config.js').has('GAME_DATE') || !src['config.js'].includes("GAME_DATE = '22.10.2026'")) err('config.js: дата не соответствует правилу V (22.10.2026)');
else ok('GAME_DATE соответствует правилу V (22.10.2026)');
if (!html.includes('id="ver-badge"')) err('index.html: нет бейджа версии');
else ok('бейдж версии на месте (текст — из локали, ui.setVersionBadge)');

// 7) Штаб (H): КЦ Г2/Г3, авторемонт, разведчик
console.log('\n[7] Штаб:');
const has = (f, t) => src[f].includes(t);
if (!has('config.js', "key: 'scout'") || !has('config.js', 'speed: 185') || !has('config.js', 'sightTiles: 11')) err('config.js: нет UNITS.scout (ключ/185/11)');
else ok('UNITS.scout на месте');
if (!has('config.js', 'dmg: 0, range: 0')) err('config.js: разведчик не безоружен');
else ok('разведчик безоружен (dmg/range 0)');
if (!has('config.js', '{ cost: 240, time: 30 }') || !has('config.js', '{ cost: 400, time: 45 }')) err('config.js: нет GRADES.cc 240/30 + 400/45');
else ok('GRADES.cc 240/30 + 400/45');
if (!has('config.js', "requiresGrade: { type: 'cc', level: 2 }")) err('config.js: нет UPGRADES.autoRepair за КЦ Г2');
else ok('UPGRADES.autoRepair за КЦ Г2');
if (!has('missions.js', 'scout: 2')) err('missions.js: нет UNLOCK_AT.scout = 2');
else ok('UNLOCK_AT.scout = 2');
if (!has('audio.js', 'alarm()')) err('audio.js: нет sound.alarm()');
else ok('sound.alarm() на месте');
// I: фракционные строки переехали из lore.js в locales/*.js (messages.*)
const ruLoc = readFileSync(path.join(ROOT, 'locales', 'ru.js'), 'utf8');
const strMiss = ['needCC2', 'noRally', 'reconDone', 'contact', 'veinFound', 'noScouts'].filter((k) => !ruLoc.includes(k + ':'));
if (strMiss.length) err('locales/ru.js: нет messages.' + strMiss.join(', '));
else ok('фракционные строки ×6 в locales/ru.js');
if (!has('ui.js', "case 'scout'") || !has('ui.js', "case 'recon'") || !has('ui.js', "case 'rally'") || !has('ui.js', "case 'u_autoRepair'")) err('ui.js: нет иконок H');
else ok('иконки H на месте');
if (!has('units.js', 'updateScout') || !has('units.js', 'updateAutoRepair')) err('units.js: нет updateScout/updateAutoRepair');
else ok('updateScout/updateAutoRepair на месте');
if (!has('game.js', 'autoRepair: 0') || !has('game.js', 'KeyT') || !has('game.js', 'orderMassRally')) err('game.js: нет состояния/горячих клавиш H');
else ok('состояние и команды штаба на месте');
if (!has('units.js', 'attacker.cfg.dmg > 0') || !has('units.js', 'if (u.cfg.scout) return') ||
    !has('game.js', '!u.cfg.scout') || !has('game.js', 'e.cfg.dmg > 0')) err('units/game.js: не все 5 затворов разведчика');
else ok('5 затворов безоружности разведчика на месте');
if (!has('buildings.js', 'export function rallySpot') || !has('buildings.js', 'export function bestCCLevel')) err('buildings.js: нет H-точки сбора или проверки грейда');
else ok('bestCCLevel/rallySpot на месте');
if (!has('game.js', "['infAtk', 'infArm', 'vehAtk', 'vehArm']")) err('game.js: startTech затрагивает не только армейские ресерчи');
else ok('startTech оставляет Авторемонт вне профиля ИИ');
if (has('ai.js', "'scout'") || has('ai.js', "'autoRepair'")) err('ai.js знает о разведчике/Авторемонте — H должен быть для ИИ невидим');
else ok('AIController не знает о scout/autoRepair');
if (!has('ui.js', "case 'a_scout'") || !has('units.js', "u.type === 'scout'")) err('нет двух обликов разведчика');
else ok('спрайты Следопыта/Слухача на месте');
// I: кодекс — тексты в локалях, структура/unlockAfter в lore.js
if (!has('lore.js', "id: 'arsenal'") || !has('lore.js', '{ unlockAfter: 2 }, { unlockAfter: 2 },')) err('lore.js: нет структуры Арсенала (разведчик с №3)');
else ok('кодекс: арсенал открывает оба облика с миссии №3 (текст — в локалях)');
if (!has('game.js', 'await initI18n()') || !has('game.js', 'setVersionBadge')) err('game.js: нет I-бута (await initI18n + бейдж)');
else ok('I-бут: initI18n до меню + бейдж версии из локали');
if (!has('ui.js', 'refreshLocale') || !has('i18n.js', 'applyStaticDOM') || !has('i18n.js', 'SUPPORTED_LOCALES')) err('нет каркаса смены языка (refreshLocale/applyStaticDOM/реестр)');
else ok('каркас локалей: реестр + applyStaticDOM + refreshLocale');

// 8) sim_i18n — обязательная вложенная проверка (I18N.md §6.1)
console.log('\n[8] sim_i18n (вложенно):');
try {
  execFileSync('node', ['scripts/sim_i18n.mjs'], { cwd: ROOT, stdio: 'inherit' });
  ok('sim_i18n прошёл');
} catch (e) {
  err('sim_i18n упал (см. вывод выше)');
}

// 9) sim_p1 — UX-пакет: процессы, доступность команд, геометрия/фокус.
console.log('\n[9] sim_p1 (вложенно):');
try {
  execFileSync('node', ['scripts/sim_p1.mjs'], { cwd: ROOT, stdio: 'inherit' });
  ok('sim_p1 прошёл');
} catch (e) {
  err('sim_p1 упал (см. вывод выше)');
}

// 10) sim_menu — R2-C: пресеты, CTA, prefs, кампания и новый menu shell.
console.log('\n[10] sim_menu (вложенно):');
try {
  execFileSync('node', ['scripts/sim_menu.mjs'], { cwd: ROOT, stdio: 'inherit' });
  ok('sim_menu прошёл');
} catch (e) {
  err('sim_menu упал (см. вывод выше)');
}

console.log(failed ? '\nПРОВЕРКА ПРОВАЛЕНА' : '\nВСЕ ПРОВЕРКИ ПРОЙДЕНЫ');
process.exit(failed);
