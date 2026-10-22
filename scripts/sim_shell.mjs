// ============================================================
// sim_shell.mjs — пакет G: камера/панель, зум, скирмиш-пресеты, сезоны.
//
// S1 camera: центр и углы карты на видимой области во всех 4 позициях + скрытая.
// S2 zoom: клампы 0.5/2.0 (G.5), якорь держит точку.
// S3 presets: шесть канонических ID→габариты + запуск CTA 64×96 с путём баз.
// S4 seasons: Сезон 1 → миссия → реальная победа → прогресс 1; С2 — брифинг прототипа.
//
// Запуск: node scripts/sim_shell.mjs
// ============================================================
import './harness.mjs';
import { el } from './harness.mjs';

const failures = [];
function fail(phase, err) {
  failures.push(phase);
  console.log(`FAIL  ${phase}: ${String((err && err.message) || err)}`);
}
function pass(msg) { console.log(`PASS  ${msg}`); }
function assert(c, msg) { if (!c) throw new Error(msg); }

await import('../js/game.js');
const cfg = await import('../js/config.js');
const ui = await import('../js/ui.js');
const U = await import('../js/units.js');
const PF = await import('../js/pathfinding.js');
const { loadProgress } = await import('../js/missions.js');
const game = globalThis.game;
if (!game) { console.log('FAIL  boot: window.game не создан'); process.exit(1); }

function testMission(over = {}) {
  return {
    id: -1, faction: 'human',
    map: { seed: 424242, biome: 'mars', lakes: 'default', rocks: 6, rich: 1.0, base: { x: 8, y: 48 } },
    ai: {}, defense: null,
    objective: 'Тестовая цель',
    ...over,
  };
}
function ticks(n) { for (let i = 0; i < n; i++) game.tick(); }
function paint() { game.render(1); ui.update(game); ui.drawMinimap(game); }
function killAll(st, side) {
  for (const e of [...st.units, ...st.buildings]) {
    if (e.side === side && !e.dead) U.damageEntity(st, e, 1e9, null);
  }
}

// ---------- S1: камера и панель ----------
try {
  game.startMission(testMission());
  ticks(3);
  const st = game.state;
  const cx = st.map.pxW / 2, cy = st.map.pxH / 2;
  for (const [pos, hidden] of [['bottom', false], ['left', false], ['right', false], ['top', false], ['bottom', true]]) {
    ui.setPanelPos(pos);
    ui.setPanelHidden(hidden);
    game.resize();
    game.setZoom(1);
    const L = game.uiLeft || 0, R = game.uiRight || 0, T = game.uiTop || 0, Bm = game.uiBottom || 0;
    game.centerCamera(cx, cy);
    const s = game.worldToScreen(cx, cy);
    const ex = L + (game.cssW - L - R) / 2, ey = T + (game.cssH - T - Bm) / 2;
    assert(Math.abs(s.x - ex) < 0.01 && Math.abs(s.y - ey) < 0.01,
      `${pos}${hidden ? '/скрыта' : ''}: цель не в центре видимой (${s.x},${s.y} vs ${ex},${ey})`);
    game.centerCamera(0, 0);
    const tlx = st.camera.x + L, tly = st.camera.y + T;
    assert(Math.abs(tlx) < 1 && Math.abs(tly) < 1, `${pos}: левый верхний не на краю: ${tlx},${tly}`);
    game.centerCamera(st.map.pxW, st.map.pxH);
    const brx = st.camera.x + game.cssW - R, bry = st.camera.y + game.cssH - Bm;
    assert(Math.abs(brx - st.map.pxW) < 1 && Math.abs(bry - st.map.pxH) < 1,
      `${pos}: правый нижний не на краю: ${brx},${bry} vs ${st.map.pxW},${st.map.pxH}`);
  }
  ui.setPanelPos('bottom');
  ui.setPanelHidden(false);
  game.resize();
  game.setZoom(2); // и на зуме цель в видимом центре
  game.centerCamera(cx, cy);
  const s = game.worldToScreen(cx, cy);
  const L = game.uiLeft || 0, R = game.uiRight || 0;
  assert(Math.abs(s.x - (L + (game.cssW - L - R) / 2)) < 0.01, 'зум ×2: не в центре');
  game.setZoom(1);
  paint();
  pass('S1 camera: 4 позиции + скрытая — центр и углы на видимой области');
} catch (e) { fail('S1 camera', e); }

// ---------- S2: зум ----------
try {
  game.startMission(testMission());
  ticks(3);
  const st = game.state;
  assert(cfg.ZOOM_MIN === 0.5 && cfg.ZOOM_MAX === 2.0, 'константы зума');
  game.setZoom(99);
  assert(st.camera.z === 2.0, 'верхний кламп: ' + st.camera.z);
  game.setZoom(0);
  assert(st.camera.z === 0.5, 'нижний кламп: ' + st.camera.z);
  game.setZoom(1);
  const before = game.screenToWorld(400, 300);
  game.setZoom(1.7, 400, 300);
  const after = game.screenToWorld(400, 300);
  assert(Math.hypot(before.x - after.x, before.y - after.y) < 0.01, 'якорь поплыл');
  game.setZoom(1);
  pass('S2 zoom: 0.5–2.0, якорь держит точку');
} catch (e) { fail('S2 zoom', e); }

// ---------- S3: canonical quick-battle presets ----------
try {
  const expected = [
    ['square-48', 48, 48], ['square-64', 64, 64], ['square-80', 80, 80],
    ['square-96', 96, 96], ['wide-96x64', 96, 64], ['tall-64x96', 64, 96],
  ];
  let finalPathLength = 0;
  for (const [id, w, h] of expected) {
    game.toMenu();
    localStorage.removeItem('terranrts.quickBattle');
    ui.restoreQuickBattleConfig();
    el('quick-preset-' + id).click();
    el('quick-faction-human').click();
    el('btn-quick-battle-start').click();
    assert(game.started && game.mission.id === -1, `${id}: quick battle did not start`);
    const st = game.state;
    assert(st.map.w === w && st.map.h === h && game.mission.faction === 'human',
      `${id}: received ${st.map.w}×${st.map.h} / ${game.mission.faction}`);
    const s = st.map.bases.player.center, g = st.map.bases.enemy.center;
    assert(st.map.inBounds(s.x, s.y) && st.map.inBounds(g.x, g.y), `${id}: bases out of bounds`);
    const tiles = PF.findPath(st.map, s.x, s.y, (x, y) => x === g.x && y === g.y,
      (x, y) => Math.max(Math.abs(g.x - x), Math.abs(g.y - y)));
    const last = tiles[tiles.length - 1];
    assert(last && last.x === g.x && last.y === g.y, `${id}: no base-to-base path`);
    finalPathLength = tiles.length;
  }
  ticks(30);
  paint();
  pass(`S3 presets: all six IDs launched exact map sizes for HELIOS; base path exists (last ${finalPathLength} tiles)`);
} catch (e) { fail('S3 presets', e); }

// ---------- S4: сезоны ----------
try {
  assert(loadProgress() === 0, 'прогресс не нулевой в свежем процессе');
  el('btn-season1').click();
  const cards = el('mission-list').children.filter((c) => c.tag === 'button');
  assert(cards.length > 0, 'Сезон 1: карточек нет');
  el('btn-missions-back').click();
  assert(el('mission-overlay').classList.contains('hidden'), 'назад не закрыл миссии');
  el('btn-season1').click();
  const first = el('mission-list').children.find((c) => c.tag === 'button' && !c.disabled);
  assert(first, 'нет доступных миссий');
  first.click();
  assert(!el('brief-overlay').classList.contains('hidden'), 'брифинг не открылся');
  el('btn-brief-go').click();
  assert(game.state && game.mission.id === 0, 'миссия 0 не стартовала');
  killAll(game.state, 'enemy');
  ticks(10);
  assert(game.state.gameOver === 'win', 'победы нет');
  assert(loadProgress() === 1, 'победа не записала прогресс: ' + loadProgress());
  el('btn-season2').click(); // S2 M1: брифинг открывается, запуск — только по кнопке брифинга
  assert(!el('brief-overlay').classList.contains('hidden'), 'брифинг Сезона 2 не открылся');
  assert(game.mission.id === 0, 'Сезон 2 запустился без подтверждения брифинга');
  el('btn-brief-back').click();
  assert(el('brief-overlay').classList.contains('hidden'), 'возврат не закрыл брифинг Сезона 2');
  assert(!el('landing-page').classList.contains('hidden'), 'возврат из брифинга С2 не вернул на лендинг');
  el('btn-codex').click(); // Universe link on the main screen
  assert(!el('codex-overlay').classList.contains('hidden'), 'Вселенная не открылась');
  el('btn-codex-back').click();
  assert(el('codex-overlay').classList.contains('hidden'), 'Вселенная не закрылась');
  paint();
  pass('S4 seasons: S1 → миссия 0 → победа → прогресс 1; S2 — брифинг без запуска; Вселенная на месте');
} catch (e) { fail('S4 seasons', e); }

console.log(failures.length ? `\nИТОГ SIM_SHELL: ${failures.length} ОШИБОК (${failures.join(', ')})` : '\nИТОГ SIM_SHELL: ВСЕ СЦЕНАРИИ ПРОШЛИ');
process.exit(failures.length ? 1 : 0);
