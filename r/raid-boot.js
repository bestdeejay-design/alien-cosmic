// raid-boot.js — ПОЛИГОН /r/: прямой заход в рейдовый режим, минуя лендинг.
// Копия движка Арены (R0-a); сам движок не меняем — только автозапуск.
import { t } from './js/i18n.js';

for (let i = 0; i < 200 && !(window.game && window.game.state); i++) {
  await new Promise((r) => setTimeout(r, 50));
}
const game = window.game;
if (!game) { console.error('[r] game не загрузился'); }
else if (!game.started) {
  game.startRaidHome('human');
  window.dispatchEvent(new Event('ac-vv-check'));
  console.log('[r] полигон: рейд-хоум запущен');
}
