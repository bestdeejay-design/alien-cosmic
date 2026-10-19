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

// 5) Бренд: заголовок проекта
console.log('\n[5] Бренд:');
if (!html.includes('ALIEN COSMIC')) err('index.html: нет заголовка ALIEN COSMIC');
else ok('заголовок ALIEN COSMIC на месте');

// 6) Версия (V): бейдж на экране входа
console.log('\n[6] Версия:');
if (!exportsOf('config.js').has('GAME_VERSION') || !src['config.js'].includes("GAME_VERSION = 'F'")) err('config.js: нет GAME_VERSION === \'F\'');
else ok("GAME_VERSION === 'F'");
if (!html.includes('id="ver-badge"') || !html.includes('версия F · 20.10.2026')) err('index.html: нет бейджа версии');
else ok('бейдж «версия F · 20.10.2026» на месте');

console.log(failed ? '\nПРОВЕРКА ПРОВАЛЕНА' : '\nВСЕ ПРОВЕРКИ ПРОЙДЕНЫ');
process.exit(failed);
