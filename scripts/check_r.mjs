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
//   [8] Вид 20 уровней (Э5+): контрольный рендер sim_skins.mjs.
//   [9] Командир КЦ и оборона базы (Э7): sim_commander.mjs.
//  [10] Локали: каждый литеральный ключ t('…') есть в RU и EN.
//  [11] Приказы отрядам (Э7 ч.2): посты, отход к КЦ, трофеи, настройки рейдов.
//  [12] Утилита .hidden: класс, которым UI-модули прячут блоки, реально прячет.
//  [13] Стемп версии: один на весь r/ и симов (иначе node делает двойные модули).
//  [14] Экран вылазки: Дом-шаттл как КЦ (сдача эрга) и хедер без сырых «{…}».
//  [15] Профиль и вход: клавиатура в полях, тихая сеть без профиля, админка best.
//  [16] Дом: центр после перелёта, аура только В РЕЙДЕ, хилы лечат существ,
//       сборщики чинят машины, авто-лечение от КЦ (правка спеки владельцем).
//  [17] Эвакуация и трюм (issue #36): отсек = на борту, взлёт без дедлока,
//       стоп добычи по трюму Дома и ожидание у челнока.
//  [18] Модалки и сейв (issue #33 З2/З3): одна модалка за раз, Escape,
//       честный тост тихой неудачи сохранения.
//  [21] Вход поэтапно (issue #45): модалка-пинпад 3×4 (12 клавиш ≥48px,
//       touch-action: manipulation), «С» чистит всё, Escape сначала чистит
//       точки, pull снапшота ДО старта симуляции, выход чистит все ключи,
//       закрытие панели завершает гейт (дедлок ревью №2), один pull на старт,
//       rate-limit по нику, тост «Профиль создан», подтверждение выхода.
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

// ---------- [8] вид 20 уровней: контрольный рендер (Э5+) ----------
console.log('\n[8] Вид 20 уровней (здания 1–20, юниты 0–20):');
try {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'sim_skins.mjs')], { stdio: 'pipe' });
  ok('фазы, знаковые цвета и слои грейдов рисуются без исключений');
} catch (e) {
  bad('sim_skins упал:\n' + String(e.stdout || e.stderr || e.message));
}

// ---------- [9] командир и оборона базы (Э7) ----------
console.log('\n[9] Командир КЦ и оборона базы:');
try {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'sim_commander.mjs')], { stdio: 'pipe' });
  ok('звания 1–20, бонусы, входящие рейды, автозащита и карточка работают');
} catch (e) {
  bad('sim_commander упал:\n' + String(e.stdout || e.stderr || e.message));
}

// ---------- [10] локали: все литеральные ключи есть в RU и EN ----------
console.log('\n[10] Ключи локалей r/:');
try {
  const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'check_i18n_keys.mjs')], { stdio: 'pipe' }).toString();
  ok(out.trim().replace(/^✓\s*/, ''));
} catch (e) {
  bad('check_i18n_keys:\n' + String(e.stdout || e.stderr || e.message));
}

// ---------- [12] утилита .hidden в style.css ----------
// Регресс 26.10.2026: chests-ui/admin переключали блоки классом `hidden`, а в
// style.css было только `.overlay.hidden` — экран награды рисовался ПОД списком
// капсул, кнопка «Забрать и продолжить» уезжала за экран, и вскрытие выглядело
// как «кнопка не нажимается». Гейт ловит этот класс ошибок статически.
console.log('\n[12] Утилита .hidden (панели прячутся, а не рисуются друг под другом):');
{
  const css = readFileSync(path.join(R, 'style.css'), 'utf8');
  const users = allRel
    .filter((f) => f.endsWith('.js'))
    .filter((f) => /classList\.(?:add|remove|toggle)\('hidden'\)/.test(readFileSync(path.join(R, f), 'utf8')));
  const rule = /(?:^|\n)\.hidden\s*\{[^}]*display\s*:\s*none/.test(css);
  if (!users.length) {
    ok('класс hidden в JS не используется — правило не требуется');
  } else if (rule) {
    ok(`.hidden { display:none } задан; переключают: ${users.join(', ')}`);
  } else {
    bad(`класс hidden используют (${users.join(', ')}), но в r/style.css нет правила .hidden { display:none } — блоки не прячутся`);
  }
  // Экран награды и список капсул обязаны переключаться именно этим классом.
  const chest = readFileSync(path.join(R, 'js', 'chests-ui.js'), 'utf8');
  if (/grid\.classList\.add\('hidden'\)/.test(chest) && /box\.classList\.remove\('hidden'\)/.test(chest)) {
    ok('капсулы: список и экран награды переключаются взаимоисключающе');
  } else {
    bad('капсулы: список/экран награды не переключаются через hidden');
  }
}

// ---------- [13] единый стемп ?v= ----------
console.log('\n[13] Стемп версии модулей (?v=):');
{
  const stamps = new Map();
  const scan = (rel) => {
    const txt = readFileSync(path.join(R, rel), 'utf8');
    for (const m of txt.matchAll(/\?v=([0-9A-Za-z._-]+)/g)) {
      if (!stamps.has(m[1])) stamps.set(m[1], []);
      stamps.get(m[1]).push(rel);
    }
  };
  for (const f of allRel) if (f.endsWith('.js') || f.endsWith('.html')) scan(f);
  if (stamps.size === 1) {
    const [val] = [...stamps.keys()];
    ok(`во всём r/ один стемп: ?v=${val}`);
    // CSS без стемпа = игрок останется на старом оформлении после фикса.
    const html = readFileSync(path.join(R, 'index.html'), 'utf8');
    if (new RegExp('style\\.css\\?v=' + val).test(html)) ok('style.css тоже со стемпом (оформление не залипает)');
    else bad('у <link rel=stylesheet> нет ?v= — правки CSS могут не доехать до игрока');
  } else {
    bad('разные стемпы в r/: ' + [...stamps.entries()].map(([v, f]) => `${v} (${[...new Set(f)].slice(0, 3).join(', ')})`).join('; '));
  }
  // Симы обязаны брать стемп из stamp.mjs: захардкоженный номер = двойные модули.
  const scriptsDir = path.join(ROOT, 'scripts');
  const badStamps = readdirSync(scriptsDir)
    .filter((f) => f.endsWith('.mjs') && f !== 'stamp.mjs')
    .filter((f) => /['"]\?v=\d+['"]/.test(readFileSync(path.join(scriptsDir, f), 'utf8')));
  if (badStamps.length) bad(`симы хардкодят стемп (нужен scripts/stamp.mjs): ${badStamps.join(', ')}`);
  else ok('симы берут стемп из scripts/stamp.mjs (двойных инстансов нет)');
}

// ---------- [11] приказы отрядам, трофеи, настройки рейдов ----------
console.log('\n[11] Отряды и оборона (Э7 ч.2):');
try {
  const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'sim_squad.mjs')], { stdio: 'pipe' }).toString();
  const lines = out.split('\n').filter((l) => l.startsWith('PASS'));
  for (const l of lines) ok(l.replace(/^PASS\s+/, ''));
  if (!lines.length) bad('sim_squad: ни одного PASS');
} catch (e) {
  bad('sim_squad:\n' + String(e.stdout || e.stderr || e.message));
}

// ---------- [14] экран вылазки: Дом-шаттл как КЦ + хедер ----------
console.log('\n[14] Экран вылазки (Дом-шаттл как КЦ и хедер):');
try {
  const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'sim_raid_field.mjs')], { stdio: 'pipe' }).toString();
  const lines = out.split('\n').filter((l) => l.startsWith('PASS'));
  for (const l of lines) ok(l.replace(/^PASS\s+/, ''));
  if (!lines.length) bad('sim_raid_field: ни одного PASS');
} catch (e) {
  bad('sim_raid_field:\n' + String(e.stdout || e.stderr || e.message));
}

// ---------- [15] профиль и вход: поля ввода, тихая сеть, админка владельца ----------
console.log('\n[15] Профиль и вход (аудит владельца 26.10):');
try {
  const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'sim_profile.mjs')], { stdio: 'pipe' }).toString();
  const lines = out.split('\n').filter((l) => l.startsWith('PASS'));
  for (const l of lines) ok(l.replace(/^PASS\s+/, ''));
  if (!lines.length) bad('sim_profile: ни одного PASS');
} catch (e) {
  bad('sim_profile:\n' + String(e.stdout || e.stderr || e.message));
}

// ---------- [16] Дом (P2): перелёт, аура на базе, ремонт сборщиков ----------
console.log('\n[16] Дом (аудит владельца 26.10, P2):');
try {
  const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'sim_house.mjs')], { stdio: 'pipe' }).toString();
  const lines = out.split('\n').filter((l) => l.startsWith('PASS'));
  for (const l of lines) ok(l.replace(/^PASS\s+/, ''));
  if (!lines.length) bad('sim_house: ни одного PASS');
} catch (e) {
  bad('sim_house:\n' + String(e.stdout || e.stderr || e.message));
}

// ---------- [17] эвакуация и трюм (issue #36) ----------
console.log('\n[17] Эвакуация и трюм (issue #36, P1):');
try {
  const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'sim_evac36.mjs')], { stdio: 'pipe' }).toString();
  const lines = out.split('\n').filter((l) => l.startsWith('PASS'));
  for (const l of lines) ok(l.replace(/^PASS\s+/, ''));
  if (!lines.length) bad('sim_evac36: ни одного PASS');
} catch (e) {
  bad('sim_evac36:\n' + String(e.stdout || e.stderr || e.message));
}

// ---------- [18] модалки и сейв (issue #33 З2/З3) ----------
console.log('\n[18] Модалки и сейв (issue #33 З2/З3):');
try {
  const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'sim_modals33.mjs')], { stdio: 'pipe' }).toString();
  const lines = out.split('\n').filter((l) => l.startsWith('PASS'));
  for (const l of lines) ok(l.replace(/^PASS\s+/, ''));
  if (!lines.length) bad('sim_modals33: ни одного PASS');
} catch (e) {
  bad('sim_modals33:\n' + String(e.stdout || e.stderr || e.message));
}

// ---------- [19] safe-mode boot (issue #42 З1) ----------
console.log('\n[19] Safe-mode boot (issue #42):');
try {
  const lines = [];
  for (const sc of ['badjson', 'garbage', 'truncated', 'throwing']) {
    const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'sim_boot42.mjs'), sc], { stdio: 'pipe' }).toString();
    lines.push(...out.split('\n').filter((l) => l.startsWith('PASS')));
  }
  if (lines.length !== 4) throw new Error('ожидались 4 PASS, пришло ' + lines.length);
  for (const l of lines) ok(l.replace(/^PASS\s+/, ''));
} catch (e) {
  bad('sim_boot42:\n' + String(e.stdout || e.stderr || e.message));
}


// ---------- [20] масштаб цен: связка админка ↔ economy (issue #43 П-2) ----------
console.log('\n[20] Масштаб цен админки (issue #43):');
try {
  const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'sim_econ_scale.mjs')], { stdio: 'pipe' }).toString();
  const lines = out.split('\n').filter((l) => l.startsWith('PASS'));
  if (!lines.length) throw new Error('ни одного PASS');
  for (const l of lines) ok(l.replace(/^PASS\s+/, ''));
} catch (e) {
  bad('sim_econ_scale:\n' + String(e.stdout || e.stderr || e.message));
}

// ---------- [21] вход поэтапно: модалка-пинпад (issue #45) ----------
console.log('\n[21] Вход поэтапно: модалка-пинпад (issue #45):');
try {
  const authSrc = readFileSync(path.join(R, 'js', 'auth-ui.js'), 'utf8');
  const saveSrc = readFileSync(path.join(R, 'save-client.js'), 'utf8');
  const bootSrc = readFileSync(path.join(R, 'raid-boot.js'), 'utf8');
  const nsSrc = readFileSync(path.join(R, 'js', 'storage-ns.js'), 'utf8');
  const cssSrc = readFileSync(path.join(R, 'style.css'), 'utf8');
  const ru = readFileSync(path.join(R, 'locales', 'ru.js'), 'utf8');
  const en = readFileSync(path.join(R, 'locales', 'en.js'), 'utf8');

  // 1) пинпад 3×4: ровно 12 клавиш, «С» и «⌫» на своих местах
  if (!/PAD_KEYS\s*=\s*Object\.freeze\(\['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', 'back'\]\)/.test(authSrc)) {
    bad('в auth-ui.js нет раскладки 3×4 (1-9, C, 0, ⌫)');
  } else ok('пинпад: 12 клавиш 3×4 (1-9, «С», 0, «⌫»)');
  if (!/PIN_MIN\s*=\s*3/.test(authSrc) || !/PIN_MAX\s*=\s*12/.test(authSrc)) bad('пин не 3–12 цифр');
  else ok('пин 3–12 цифр (приоритет §4 над «4–8» в тексте issue)');

  // 2) канон модалок [18] + Escape сначала чистит точки
  if (!/registerModal\(AUTH_MODAL_ID,\s*close,\s*\{\s*onEscape/.test(authSrc)) bad('пинпад не зарегистрирован как модалка с onEscape');
  else ok('пинпад — модалка по канону [18], Escape чистит точки, второй закрывает');

  // 3) тач: клавиши ≥48px и touch-action: manipulation
  const keyBlock = /\.auth-key\s*\{([^}]*)\}/.exec(cssSrc);
  const minH = keyBlock ? Number((/min-height:\s*(\d+)px/.exec(keyBlock[1]) || [])[1] || 0) : 0;
  if (!keyBlock || minH < 48) bad('клавиша пинпада ниже 48px (палец не попадает)');
  else ok(`клавиши пинпада ${minH}px ≥ 48px`);
  if (!keyBlock || !/touch-action:\s*manipulation/.test(keyBlock[1])) bad('у клавиш пинпада нет touch-action: manipulation');
  else ok('touch-action: manipulation (двойной тап не зумит)');

  // 4) поля и i18n: autocomplete=username, «С» ↔ «C»
  if (!/autocomplete="username"/.test(authSrc) || !/autocomplete="username"/.test(saveSrc)) bad('у поля ника нет autocomplete="username"');
  else ok('логин-шаг: одно поле, autocomplete="username"');
  if (!/keyClear: 'С'/.test(ru) || !/keyClear: 'C'/.test(en)) bad('«С»/«C» в локалях расходится');
  else ok('RU/EN симметричны: «С» ↔ «C»');

  // 5) pull снапшота ДО старта симуляции + офлайн-фолбэк
  if (!/pullSnapshot/.test(saveSrc) || !/PULL_TIMEOUT_MS\s*=\s*10000/.test(authSrc)) bad('нет pull снапшота с таймаутом 10 с');
  else ok('pull снапшота: таймаут 10 с, «Повторить», офлайн-фолбэк');
  const gateAt = bootSrc.indexOf('saveApi.authGate');
  const startAt = bootSrc.indexOf("startRaidHome('human')");
  if (gateAt < 0) bad('raid-boot не ждёт гейт входа');
  else if (!(gateAt < startAt)) bad('raid-boot стартует симуляцию РАНЬШЕ pull (гонка входа вернулась)');
  else ok('raid-boot: pull снапшота ДО старта симуляции');

  // 6) выход = полная очистка ключей профиля
  if (!/purgeProfileKeys\(/.test(saveSrc)) bad('выход не чистит локальные ключи профиля');
  else ok('выход: clearIdentity → purgeProfileKeys + перезагрузка');
  if (!nsSrc.includes("'ac_raid_session_v1'")) bad('в списке очистки нет ac_raid_session_v1');
  else ok('минимум §4: ac_raid_session_v1 в списке очистки');

  // 7) БЛОКЕР ревью №2: закрытие панели обязано завершать гейт
  if (!/gateSettle/.test(authSrc)) bad('гейт не имеет единой точки завершения (дедлок при закрытии панели)');
  else ok('гейт завершается любым закрытием панели («Позже», Escape, подложка)');
  if (!/close\(reason\s*=\s*'user'\)/.test(authSrc)) bad('close() не сообщает гейту о закрытии');
  else ok('close() резолвит ожидающий гейт (без «тихого» зависания boot)');

  // 8) итерация 2: один pull на старт, rate-limit по нику, тост, выход с подтверждением
  if (!/RAID_KEY\)\s*continue|key\s*===\s*RAID_KEY\)\s*continue/.test(saveSrc)) bad('reconcile не исключает базу рейда — двойной pull на старте');
  else ok('один pull базы на старт (reconcile не дублирует гейт)');
  if (!/gateTriedNet/.test(bootSrc)) bad('raid-boot делает повторный сетевой pullKey после гейта');
  else ok('raid-boot не ходит в сеть второй раз после гейта');
  if (/rlKey\s*=\s*\(nick,\s*ip\)/.test(readFileSync(path.join(ROOT, 'server', 'save-server.mjs'), 'utf8'))) {
    bad('rate-limit всё ещё считает по паре ник+адрес (обход сменой адреса)');
  } else ok('rate-limit сервера считается по нику (адрес — только в лог)');
  if (!/profileCreated/.test(authSrc) || !/logoutTitle/.test(authSrc)) bad('нет тоста «Профиль создан» / подтверждения выхода');
  else ok('тост «Профиль создан» + подтверждение выхода (одна модалка [18])');

  // 9) автоприёмка «вход → пинпад → pull → КЦ-16» + кулдаун сервера
  const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'ac_sz_auth45.mjs')], { stdio: 'pipe' }).toString();
  const lines = out.split('\n').filter((l) => l.startsWith('PASS'));
  if (lines.length < 12) throw new Error('ac_sz_auth45: ожидались 12 PASS, пришло ' + lines.length);
  for (const l of lines) ok('auth45 · ' + l.replace(/^PASS\s+/, ''));

  // 10) сквозной boot: профиль → pull → КЦ-16, офлайн-фолбэк, «Позже», Escape-Escape
  for (const mode of ['cloud', 'offline', 'later', 'esc']) {
    const b = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'ac_sz_auth45_boot.mjs'), mode], { stdio: 'pipe' }).toString();
    const pass = b.split('\n').filter((l) => l.startsWith('PASS'));
    if (pass.length !== 1) throw new Error('ac_sz_auth45_boot ' + mode + ': ' + b.slice(-400));
    ok('auth45 · ' + pass[0].replace(/^PASS\s+/, ''));
  }
} catch (e) {
  bad('auth-45:\n' + String(e.stdout || e.stderr || e.message));
}

console.log(failed ? '\n❌ ГЕЙТ r/: есть проблемы изоляции' : '\n✅ ГЕЙТ r/: полигон изолирован от S1, капсулы/вид/командир/отряды/вылазка/профиль/дом/эвакуация/модалки/вход зелёные');
process.exit(failed ? 1 : 0);
