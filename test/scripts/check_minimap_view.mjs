// T10: the minimap fills an aspect-matched canvas for square, wide, and tall maps.
// Rendering and pointer hit-testing share the same live bitmap transform.
// Run: node scripts/check_minimap_view.mjs
import './harness.mjs';
import { minimapView } from '../js/ui.js';

let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('FAIL:', msg); } };

const maps = [
  { name: 'square', map: { pxW: 64 * 32, pxH: 64 * 32 } },
  { name: 'wide', map: { pxW: 96 * 32, pxH: 64 * 32 } },
  { name: 'tall', map: { pxW: 64 * 32, pxH: 96 * 32 } },
];
function bitmapFor(map) {
  const aspect = map.pxW / map.pxH;
  return aspect >= 1
    ? { width: 168, height: Math.round(168 / aspect) }
    : { width: Math.round(168 * aspect), height: 168 };
}
function clickToWorld(map, canvas, cx, cy, rectW, rectH) {
  const view = minimapView(map, canvas);
  const bx = cx * (view.width / rectW), by = cy * (view.height / rectH);
  return {
    x: Math.max(0, Math.min(map.pxW, (bx - view.ox) / view.k)),
    y: Math.max(0, Math.min(map.pxH, (by - view.oy) / view.k)),
  };
}
for (const { name, map } of maps) {
  const canvas = bitmapFor(map);
  const view = minimapView(map, canvas);
  const drawnW = map.pxW * view.k, drawnH = map.pxH * view.k;
  ok(view.width === canvas.width && view.height === canvas.height, `${name}: live bitmap size`);
  ok(Math.abs(view.ox) < 1e-9 && Math.abs(view.oy) < 1e-9, `${name}: no letterbox bars`);
  ok(Math.abs(drawnW - canvas.width) < 1e-7 && Math.abs(drawnH - canvas.height) < 1e-7,
    `${name}: map fills the aspect-matched canvas`);

  // CSS dimensions may be half the bitmap dimensions on DPR=2 screens.
  const cssW = canvas.width / 2, cssH = canvas.height / 2;
  let w = clickToWorld(map, canvas, cssW / 2, cssH / 2, cssW, cssH);
  ok(Math.abs(w.x - map.pxW / 2) < 2 && Math.abs(w.y - map.pxH / 2) < 2,
    `${name}: canvas center maps to world center`);
  w = clickToWorld(map, canvas, 0, 0, cssW, cssH);
  ok(w.x === 0 && w.y === 0, `${name}: top-left maps to world origin`);
  w = clickToWorld(map, canvas, cssW, cssH, cssW, cssH);
  ok(Math.abs(w.x - map.pxW) < 2 && Math.abs(w.y - map.pxH) < 2,
    `${name}: bottom-right maps to world edge`);
}

// No canvas is only used by pure callers/tests: use world pixel dimensions as an identity transform.
const fallback = minimapView(null);
ok(fallback.k === 1 && fallback.width === fallback.height, 'default world fallback is identity-sized');

if (fails) { console.log(`FAIL: ${fails} minimap view assertions`); process.exit(1); }
console.log('OK: full-aspect minimap view and inverse pointer mapping on square/wide/tall maps');
