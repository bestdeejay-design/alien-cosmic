// G.6: проверка letterbox-превью миникарты на всех формах карт
// (квадрат 64×64, wide 96×64, tall 64×96) и согласованности
// прямого (minimapView) и обратного (mmWorld) преобразований.
// Запуск: node scripts/check_minimap_view.mjs
import './harness.mjs';
import { minimapView } from '../js/ui.js';

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL:', msg); } };

const S = 176;
// 1) Квадрат 64×64: карта занимает весь канвас, смещений нет.
let v = minimapView({ pxW: 64 * 32, pxH: 64 * 32 });
ok(v.k === S / 2048 && v.ox === 0 && v.oy === 0, '64×64: k/ox/oy');

// 2) Wide 96×64: вся ширина в канвасе, высота центрируется (letterbox).
v = minimapView({ pxW: 96 * 32, pxH: 64 * 32 });
ok(Math.abs(v.ox) < 1e-9, 'wide: ox=0');
ok(Math.abs((v.oy * 2 + 2048 * v.k) - S) < 1e-9, 'wide: карта центрирована по y');
ok(2048 * v.k < S, 'wide: высота карты меньше канваса (низ не срезан)');
ok(Math.abs(3072 * v.k - S) < 1e-9, 'wide: ширина ровно в канвас');

// 3) Tall 64×96 — зеркально.
v = minimapView({ pxW: 64 * 32, pxH: 96 * 32 });
ok(Math.abs(v.oy) < 1e-9 && Math.abs((v.ox * 2 + 2048 * v.k) - S) < 1e-9, 'tall: центрирование по x');

// 4) Обратность: клик в центр канваса → центр мира; угол карты → угол мира.
// (имитируем mmWorld: CSS-px → bitmap → мир)
function clickToWorld(mp, cx, cy, rW, rH) {
  const view = minimapView(mp);
  const bx = cx * (view.S / rW), by = cy * (view.S / rH);
  return {
    x: Math.max(0, Math.min(mp.pxW, (bx - view.ox) / view.k)),
    y: Math.max(0, Math.min(mp.pxH, (by - view.oy) / view.k)),
  };
}
const wide = { pxW: 96 * 32, pxH: 64 * 32 };
let w = clickToWorld(wide, 83, 83, 166, 166); // центр
ok(Math.abs(w.x - wide.pxW / 2) < 2 && Math.abs(w.y - wide.pxH / 2) < 2, 'wide: центр канваса → центр мира');
w = clickToWorld(wide, 0, 0, 166, 166); // угол — но там letterbox-поле: кламп в 0
ok(w.x === 0 && w.y === 0, 'wide: угол с полем клампится в (0,0)');
w = clickToWorld(wide, 166, 83, 166, 166); // правый край карты по её верт. центру ( bitmap y = oy + pxH/2*k )
ok(Math.abs(w.x - wide.pxW) < 3 && Math.abs(w.y - wide.pxH / 2) < 3, 'wide: правый край → правый край мира');

// 5) Фолбэк без карты: WORLD 64×64.
v = minimapView(null);
ok(v.k === S / 2048, 'null: фолбэк WORLD_W/H');

if (fails) { console.log(`ПРОВАЛ: ${fails}`); process.exit(1); }
console.log('OK: letterbox-превью согласовано на квадрате/wide/tall, клики обратны');
