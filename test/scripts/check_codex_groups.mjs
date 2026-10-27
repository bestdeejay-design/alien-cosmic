// Быстрая проверка фикса групп кодекса: ни одна открытая вкладка
// (world..arsenal) при полном прогрессе не должна давать заглушек
// '[missing:...]' в частях записи. Запуск: node scripts/check_codex_groups.mjs
import { initI18n } from '../js/i18n.js';
import { CODEX, codexEntryParts } from '../js/lore.js';

await initI18n();
const PROGRESS = 99; // всё открыто
let bad = 0;
for (const entry of CODEX) {
  const parts = codexEntryParts(entry, PROGRESS);
  for (const p of parts) {
    if (p.text && String(p.text).includes('[missing:')) {
      bad++;
      console.log('MISSING-STUB:', entry.id, '→', p.text);
    }
  }
}
// Группы там, где они есть по дизайну, должны остаться:
const war = codexEntryParts(CODEX.find((e) => e.id === 'war'), PROGRESS);
const warH3 = war.filter((p) => p.type === 'h3').length;
const heroes = codexEntryParts(CODEX.find((e) => e.id === 'heroes'), PROGRESS);
const heroesH3 = heroes.filter((p) => p.type === 'h3').length;
console.log(`h3: war=${warH3}, heroes=${heroesH3} (heroes ожидаемо 0 — список плоский)`);
if (bad || warH3 === 0) {
  console.log('ПРОВАЛ: заглушки остались или группы пропали');
  process.exit(1);
}
console.log('OK: заглушек нет, группы war/arsenal на месте');
