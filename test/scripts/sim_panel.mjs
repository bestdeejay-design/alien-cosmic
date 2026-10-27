// ============================================================
// sim_panel.mjs — тесты Пакета E: положение панели (E.1) и
// мировые статусы зданий (E.2).
//
// P1 позиции: класс body + инсеты + камера + кадры без ошибок.
// P2 скрытие: перестройка панели и тосты работают при скрытой.
// P3 localStorage: выбор переживает «перезагрузку» (applyPrefs).
// P4 производство: очередь даёт иконку+прогресс, пустое — нет.
// P5 исследование: иконка + прогресс.
// P6 гарнизон: бейдж «N/M» у своих, у чужих/призраков — нет.
//
// Запуск: node scripts/sim_panel.mjs
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
const ui = await import('../js/ui.js');
const U = await import('../js/units.js');
const B = await import('../js/buildings.js');
const input = await import('../js/input.js');
const missionsMod = await import('../js/missions.js');
const game = globalThis.game;
if (!game) { console.log('FAIL  boot: window.game не создан'); process.exit(1); }

function start() {
  game.startMission({ ...missionsMod.SKIRMISH, id: -1, faction: 'human',
    map: { seed: 424242, biome: 'mars', lakes: 'default', rocks: 6, rich: 1.0, base: { x: 8, y: 48 } } });
  for (let i = 0; i < 5; i++) game.tick();
  const st = game.state;
  st.fog.explored.fill(1);
  st.minerals.player = 99999;
  return st;
}
function paint() { game.render(1); ui.update(game); ui.drawMinimap(game); }
function recCtx() {
  const calls = [];
  const sink = new Proxy(function () {}, { get: () => sink, set: () => true, apply: () => sink });
  return { calls, ctx: new Proxy({}, { get: (t, k) => (...a) => { calls.push([k, ...a]); return sink; }, set: () => true }) };
}
function bodyHas(cls) { return document.body.classList.contains(cls); }

// ---------- P1: позиции панели ----------
try {
  start();
  const want = {
    bottom: [{}, 'panel-'],
    left: [{ left: 236 }, 'panel-left'],
    right: [{ right: 236 }, 'panel-right'],
    top: [{ top: 190 }, 'panel-top'],
  };
  for (const pos of ['bottom', 'left', 'right', 'top']) {
    ui.setPanelPos(pos);
    game.resize();
    const ins = ui.getPanelInsets();
    const [key] = Object.keys(want[pos][0]);
    if (key) assert(ins[key] === want[pos][0][key], `${pos}: инсет ${key}=${ins[key]}`);
    assert(game.uiLeft === ins.left && game.uiRight === ins.right, `${pos}: камера не взяла инсеты`);
    assert(game.uiTop === ins.top && game.uiBottom === ins.bottom, `${pos}: верх/низ не взяты`);
    if (pos !== 'bottom') assert(bodyHas(want[pos][1]), `${pos}: класса нет`);
    else assert(!bodyHas('panel-left') && !bodyHas('panel-right') && !bodyHas('panel-top'), 'лишний класс');
    paint(); // полный кадр + миникарта при этой позиции — без ошибок
  }
  ui.setPanelPos('bottom');
  game.resize();
  pass('P1 pos: 4 позиции — классы, инсеты, камера, кадры');
} catch (e) { fail('P1 positions', e); }

// ---------- P2: скрытие не ломает панель и тосты ----------
try {
  start();
  const st = game.state;
  ui.setPanelHidden(true);
  assert(bodyHas('panel-hidden'), 'класса hidden нет');
  assert(Object.values(ui.getPanelInsets()).every((v) => v === 0), 'инсеты не нули');
  const cc = st.buildings.find((b) => b.side === 'player' && b.type === 'cc');
  input.clickSelect(game, st, { x: cc.x, y: cc.y }, false);
  ui.update(game); // перестройка скрытой панели — без ошибок
  assert(el('sel-info').children.length > 0, 'панель не перестроилась');
  ui.toast('тест-тост', 'info');
  const toasts = el('toasts').children.map((c) => c.textContent || '').join('|');
  assert(/тест-тост/.test(toasts), 'тост не показан при скрытой панели');
  paint();
  ui.setPanelHidden(false);
  assert(!bodyHas('panel-hidden'), 'hidden не снят');
  pass('P2 hide: перестройка + тосты живы при скрытой панели');
} catch (e) { fail('P2 hide', e); }

// ---------- P3: выбор переживает перезагрузку ----------
try {
  start();
  localStorage.setItem('terranrts.panel', JSON.stringify({ pos: 'right', hidden: true }));
  ui.applyPanelPrefs(); // как при загрузке игры
  assert(ui.getPanelPos() === 'right' && ui.isPanelHidden(), 'префы не применились');
  assert(bodyHas('panel-right') && bodyHas('panel-hidden'), 'классы не применились');
  ui.setPanelPos('left');
  assert(/"pos":"left"/.test(localStorage.getItem('terranrts.panel')), 'позиция не сохраняется');
  ui.setPanelPos('bottom');
  ui.setPanelHidden(false);
  pass('P3 persist: localStorage → applyPrefs → классы; запись при смене');
} catch (e) { fail('P3 persist', e); }

// ---------- P4: бейдж производства ----------
try {
  const st = start();
  const cc = st.buildings.find((b) => b.side === 'player' && b.type === 'cc');
  cc.queue = [{ type: 'marine', t: 6.5, total: 13 }, { type: 'marine', t: 13, total: 13 }];
  const rec = recCtx();
  B.drawBuilding(rec.ctx, cc, false, 0, 0);
  const icons = rec.calls.filter((c) => c[0] === 'drawImage');
  assert(icons.length >= 1, 'иконки производства нет');
  assert(icons.some((c) => c[4] === 20 && c[5] === 20), 'иконка не 20×20');
  assert(rec.calls.some((c) => c[0] === 'fillText' && String(c[1]).includes('×2')), 'счётчика ×2 нет');
  const px = cc.tx * 32;
  assert(rec.calls.some((c) => c[0] === 'fillRect' && c[1] === px + 23), 'полосы прогресса нет');
  // Пустое здание — тихо.
  const rax = B.placeBuildingCmd(st, 'player', 'barracks', 24, 44, []);
  assert(rax, 'казарма не встала');
  rax.done = true; rax.hp = rax.maxHp;
  const rec2 = recCtx();
  B.drawBuilding(rec2.ctx, rax, false, 0, 0);
  assert(!rec2.calls.some((c) => c[0] === 'drawImage'), 'пустое здание рисует иконку');
  paint();
  pass('P4 produce: очередь → иконка 20×20 + прогресс + ×2; пустое молчит');
} catch (e) { fail('P4 produce', e); }

// ---------- P5: бейдж исследования ----------
try {
  const st = start();
  const lab = B.placeBuildingCmd(st, 'player', 'lab', 20, 44, []);
  assert(lab, 'лаборатория не встала');
  lab.done = true; lab.hp = lab.maxHp;
  lab.res = { key: 'infAtk', lvl: 1, t: 20, total: 40 };
  const rec = recCtx();
  B.drawBuilding(rec.ctx, lab, false, 0, 0);
  assert(rec.calls.some((c) => c[0] === 'drawImage'), 'иконки исследования нет');
  const px = lab.tx * 32;
  assert(rec.calls.some((c) => c[0] === 'fillRect' && c[1] === px + 23), 'прогресса исследования нет');
  pass('P5 research: иконка + прогресс исследования');
} catch (e) { fail('P5 research', e); }

// ---------- P6: бейдж гарнизона ----------
try {
  const st = start();
  const bun = B.placeBuildingCmd(st, 'player', 'bunker', 12, 44, []);
  assert(bun, 'бункер не встал');
  bun.done = true; bun.hp = bun.maxHp;
  for (let i = 0; i < 2; i++) {
    const m = U.spawnUnit(st, 'player', 'marine', 12 * 32, 44 * 32);
    m.garrison = bun; bun.garrison.push(m);
  }
  const rec = recCtx();
  B.drawBuilding(rec.ctx, bun, false, 0, 0);
  assert(rec.calls.some((c) => c[0] === 'fillText' && c[1] === '2/4'), 'бейджа «2/4» нет');
  // Чужой бункер и призрак — молчат.
  const foe = B.placeBuildingCmd(st, 'enemy', 'bunker', 40, 12, []);
  foe.done = true; foe.hp = foe.maxHp; foe.garrison = [{}, {}];
  const rec2 = recCtx();
  B.drawBuilding(rec2.ctx, foe, false, 0, 0);
  assert(!rec2.calls.some((c) => c[0] === 'fillText' && c[1] === '2/4'), 'чужой гарнизон светится');
  const rec3 = recCtx();
  B.drawBuilding(rec3.ctx, bun, true, 0, 0);
  assert(!rec3.calls.some((c) => c[0] === 'fillText' && c[1] === '2/4'), 'призрак светится');
  paint();
  pass('P6 garrison: «2/4» у своих; чужие и призраки молчат');
} catch (e) { fail('P6 garrison', e); }

console.log(failures.length ? `\nИТОГ SIM_PANEL: ${failures.length} ОШИБОК (${failures.join(', ')})` : '\nИТОГ SIM_PANEL: ВСЕ СЦЕНАРИИ ПРОШЛИ');
process.exit(failures.length ? 1 : 0);
