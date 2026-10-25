// ============================================================
// check_i18n_keys.mjs — каждый литеральный ключ t('…') в r/ есть в RU и EN.
//
// Зачем: локали — единственное место, где «нет ошибки», но игрок видит
// сырой ключ вместо текста. Именно так всплыл `ui.cmds.houseMoveBlocked`
// (ключ жил в ui.raid.*, а код звал ui.cmds.*).
//
// Динамические ключи (сборка через конкатенацию) пропускаются: они
// проверяются своими симами.
//
// Запуск: node scripts/check_i18n_keys.mjs  (exit 1 при пропущенном ключе)
// ============================================================
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const R = path.join(ROOT, 'r');

const ru = (await import(path.join(R, 'locales', 'ru.js'))).default;
const en = (await import(path.join(R, 'locales', 'en.js'))).default;
const get = (o, key) => key.split('.').reduce((a, k) => (a == null ? a : a[k]), o);

const files = [
  ...readdirSync(path.join(R, 'js')).filter((f) => f.endsWith('.js')).map((f) => path.join('js', f)),
  ...readdirSync(R).filter((f) => f.endsWith('.js')),
];

const missing = new Map();
let total = 0;
for (const rel of files) {
  const src = readFileSync(path.join(R, rel), 'utf8');
  for (const m of src.matchAll(/\bt\(\s*'([\w.]+)'/g)) {
    const key = m[1];
    if (key.endsWith('.')) continue; // динамический префикс
    total++;
    if (get(ru, key) == null) missing.set(`RU ${rel} → ${key}`, true);
    if (get(en, key) == null) missing.set(`EN ${rel} → ${key}`, true);
  }
}

if (missing.size) {
  console.error('✗ пропущенные ключи локалей:');
  for (const k of missing.keys()) console.error('  ' + k);
  process.exit(1);
}
console.log(`✓ ключи локалей: проверено ${total} литеральных вызовов t(), RU и EN совпадают`);
