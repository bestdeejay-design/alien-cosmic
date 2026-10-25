// ============================================================
// check_r.mjs — ГЕЙТ ИЗОЛЯЦИИ ПОЛИГОНА r/ ОТ ОСНОВНОЙ ИГРЫ S1.
//
// Проверяет ровно то, о чём спрашивал владелец: «точно ли S1 и r/ разделены
// и можно ли менять r/ без риска для логики основной игры».
//
//   [1] Синтаксис всех модулей r/ (node --check через копии .mjs).
//   [2] r/ не импортирует НИЧЕГО из корня (js/, style.css, index.html) —
//       единственное исключение: свои же locales/.
//   [3] Все относительные импорты r/ существуют на диске.
//   [4] В r/ нет сетевых вызовов, кроме разрешённого клиента сейва
//       (save-client.js) и boot-скрипта — и нет WebSocket.
//   [5] localStorage-изоляция: полигон пишет terranrts.* ТОЛЬКО в acr.*,
//       а прогресс S1 при этом остаётся нетронутым (живой прогон).
//   [6] В r/index.html подключён ровно один движок — r/js/game.js.
//   [7] Капсулы снабжения (Э6): headless-прогон sim_chests_ui.mjs.
//
// Запуск: node scripts/check_r.mjs   (код выхода 1 при провале)
// ============================================================
import { readdirSync, readFileSync, copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const R = path.join(ROOT, 'r');
const TMP = path.join(ROOT, '.tmpcheck', 'r');
mkdirSync(TMP, { recursive: true });

let failed = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { failed = 1; console.error('  ✗ ' + m); };

const jsFiles = readdirSync(path.join(R, 'js')).filter((f) => f.endsWith('.js'));
const bootFiles = readdirSync(R).filter((f) => f.endsWith('.js'));
const allRel = [...jsFiles.map((f) => path.join('js', f)), ...bootFiles];

// ---------- [1] синтаксис ----------
console.log('\n[1] Синтаксис модулей r/:');
for (const rel of allRel) {
  const src = path.join(R, rel);
  const dst = path.join(TMP, rel.replace(/[\\/]/g, '_').replace(/\.js$/, '.mjs'));
  copyFileSync(src, dst);
  try {
    execFileSync(process.execPath, ['--check', dst], { stdio: 'pipe' });
  } catch (e) {
    bad(`синтаксис ${rel}: ${String(e.stderr || e.message).split('\n')[0]}`);
  }
}
if (!failed) ok(`${allRel.length} модулей — синтаксис в порядке`);

// ---------- [2] нет импортов из корня ----------
console.log('\n[2] Изоляция от S1 (импорты наружу):');
let leaks = 0;
const insideR = (abs) => abs === R || abs.startsWith(R + path.sep);
for (const rel of allRel) {
  const file = path.join(R, rel);
  const src = readFileSync(file, 'utf8');
  // Не ловим текст подсказок вида {"from":"20:00"} — только настоящий
  // импорт: ключевое слово не внутри кавычек/идентификатора.
  const re = /(?<![\w'"$])(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src))) {
    const spec = m[1];
    if (!spec.startsWith('.')) { bad(`${rel}: внешний пакет '${spec}'`); leaks++; continue; }
    const target = path.resolve(path.dirname(file), spec.split('?')[0]);
    if (!insideR(target)) { bad(`${rel}: импорт выходит за пределы r/ → '${spec}'`); leaks++; }
  }
}
if (!leaks) ok('ни одного импорта за пределы r/ (движок корня не тянется)');

// ---------- [3] импорты существуют ----------
console.log('\n[3] Существование файлов импорта:');
let missing = 0;
for (const rel of allRel) {
  const src = readFileSync(path.join(R, rel), 'utf8');
  const re = /(?:from|import)\s*\(?\s*['"](\.\.?\/[^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src))) {
    const clean = m[1].split('?')[0];
    const target = path.resolve(path.dirname(path.join(R, rel)), clean);
    if (!existsSync(target)) { bad(`${rel}: нет файла '${clean}'`); missing++; }
  }
}
if (!missing) ok('все относительные импорты ведут на существующие файлы');

// ---------- [4] сеть ----------
console.log('\n[4] Сеть (гейт MVP: без сети, кроме клиента сейва):');
const ALLOW = new Set(['save-client.js', 'raid-boot.js']);
let net = 0;
for (const rel of allRel) {
  if (ALLOW.has(path.basename(rel))) continue;
  const src = readFileSync(path.join(R, rel), 'utf8');
  if (/\bfetch\s*\(|XMLHttpRequest|new\s+WebSocket/.test(src)) { bad(`${rel}: сетевой вызов вне save-client`); net++; }
}
if (!net) ok('движок r/ сети не касается (fetch только в клиенте сохранения)');

// ---------- [6] index.html: один движок ----------
console.log('\n[6] Страница полигона:');
const html = readFileSync(path.join(R, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
const rootEngine = scripts.filter((s) => !s.startsWith('./js/') && !s.startsWith('./save-client') && !s.startsWith('./raid-boot'));
if (rootEngine.length) bad('страница r/ тянет скрипт не из r/: ' + rootEngine.join(', '));
if (!scripts.some((s) => s.includes('./js/game.js'))) bad('в r/index.html нет движка r/js/game.js');
if (!failed) ok('r/index.html грузит только собственные модули: ' + scripts.map((s) => s.split('?')[0]).join(', '));

// ---------- [5] localStorage-изоляция (живой прогон) ----------
console.log('\n[5] Хранилище: полигон не трогает прогресс S1:');
try {
  const probe = path.join(TMP, 'ns_probe.mjs');
  const harness = path.relative(path.dirname(probe), path.join(ROOT, 'scripts', 'harness.mjs')).replace(/\\/g, '/');
  const gamePath = path.relative(path.dirname(probe), path.join(R, 'js', 'game.js')).replace(/\\/g, '/');
  const missionsPath = path.relative(path.dirname(probe), path.join(R, 'js', 'missions.js')).replace(/\\/g, '/');
  readFileSync(path.join(R, 'js', 'missions.js'), 'utf8');
  const code = `
import '${harness}';
const ls = globalThis.localStorage;
ls.setItem('terranrts.progress', '14');            // «доигранная» кампания S1
ls.setItem('terranrts.quickBattle', '{"human":1}');
const raw = { get: ls.getItem.bind(ls) };
await import('${gamePath}');
const m = await import('${missionsPath}');
m.saveProgress(3);                                  // полигон пишет свой прогресс
globalThis.localStorage.setItem('terranrts.quickBattle', '{"alien":2}');
const s1p = raw.get('terranrts.progress');
const s1q = raw.get('terranrts.quickBattle');
const rp = raw.get('acr.terranrts.progress');
const rq = raw.get('acr.terranrts.quickBattle');
console.log('RESULT ' + JSON.stringify({ s1p, s1q, rp, rq }));
`;
  const tmpProbe = path.join(TMP, 'ns_run.mjs');
  copyFileSync(path.join(R, 'js', 'storage-ns.js'), path.join(TMP, 'storage-ns-copy.js'));
  // Копия game.js не нужна: пути уже относительные от TMP.
  execFileSync(process.execPath, ['-e', `require('fs').writeFileSync(${JSON.stringify(tmpProbe)}, ${JSON.stringify(code)})`]);
  const out = execFileSync(process.execPath, [tmpProbe], { stdio: 'pipe' }).toString();
  const line = out.split('\n').find((l) => l.startsWith('RESULT '));
  const r = JSON.parse(line.slice(7));
  if (r.s1p !== '14') bad(`прогресс S1 изменился полигоном: ${r.s1p}`);
  if (r.s1q !== '{"human":1}') bad(`быстрый бой S1 изменился: ${r.s1q}`);
  if (r.rp !== '3') bad(`прогресс полигона не записался в acr.*: ${r.rp}`);
  if (!failed) ok('S1(progress=14, quickBattle) цел, полигон пишет в acr.terranrts.*');
} catch (e) {
  bad('прогон изоляции хранилища: ' + String((e.stderr || e.message)).split('\n')[0]);
}

// ---------- [7] капсулы снабжения: UI-прогон (Э6) ----------
console.log('\n[7] Капсулы и панель админа (headless UI):');
try {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'sim_chests_ui.mjs')], { stdio: 'pipe' });
  ok('карточки на входе, вскрытие, панель админа и конструктор капсул работают');
} catch (e) {
  bad('sim_chests_ui упал:\n' + String(e.stdout || e.stderr || e.message));
}

console.log(failed ? '\n❌ ГЕЙТ r/: есть проблемы изоляции' : '\n✅ ГЕЙТ r/: полигон изолирован от S1, капсулы зелёные');
process.exit(failed ? 1 : 0);
