// ac_p7_browse.mjs — браузерная приёмка П7 (пакет C: размеры карт, базы с 4 сторон,
// биомы, С3 startTech) по чек-листу Арены.
// Ш1 №3: 88×88, база Ю, HUD добычи; биом mars крупно.           p7_m3_south, p7_biomes_mars
// Ш2 №2: 76×76, биом nest; снос «Сердца лагеря» = победа+эпилог. p7_biomes_nest, p7_m2_win
// Ш3 №4: 56×56, круг шаттлов у края (evac 10,8).                p7_m4_small
// Ш4 №7: 72×72, база ЮВ.                                        p7_m7_se
// Ш5 №11: 76×76, база СВ.                                       p7_m11_ne
// Ш6 №13: 52×52, рифт + зона отхода; биом moon.                 p7_m13_rift, p7_biomes_moon
// Ш7 №14: 80×80, С3 — tech врага 1, лаба качает 2-й, иконки на лабе;
//         снос крепления = победа + campaignDone + эпилог.      p7_m14_tech, p7_m14_win
// pageerrors 0.
import { chromium } from 'playwright';

const BASE = 'http://localhost:8793';
const OUT = '/tmp/ac-branch/tool-results';

const errors = [];
const results = [];
const ok = (id, msg) => { results.push(`PASS  ${id}: ${msg}`); console.log(`PASS  ${id}: ${msg}`); };
const bad = (id, msg) => { results.push(`FAIL  ${id}: ${msg}`); console.log(`FAIL  ${id}: ${msg}`); };
const assert = (c, msg) => { if (!c) throw new Error(msg); };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1500 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.addInitScript(() => localStorage.setItem('terranrts.progress', '14'));

const startCard = async (idx) => {
  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(900);
  await page.locator('#btn-campaign').click();
  await page.waitForTimeout(350);
  await page.locator('.mission-card').nth(idx).click();
  await page.waitForTimeout(350);
  await page.locator('#btn-brief-go').click();
  await page.waitForTimeout(1400);
};
const endScreen = () => page.evaluate(() => ({
  over: window.game.state.gameOver,
  title: (document.querySelector('#end-title') || {}).textContent || '',
  reason: (document.querySelector('#end-reason') || {}).textContent || '',
  epi: (document.querySelector('#end-epilogue') || {}).textContent || '',
}));
const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png` });
const bodyText = () => page.evaluate(() => document.body.innerText);
// Центр камеры на пиксельные координаты (x,y) с телепортом своего юнита — туман.
const camAt = (x, y) => page.evaluate(([wx, wy]) => {
  const g = window.game, st = g.state;
  st.fog.explored.fill(1);
  const u = st.units.find((t) => t.side === 'player' && !t.dead);
  if (u) { u.x = wx; u.y = wy; }
  st.camera.x = wx - g.viewW() / 2;
  st.camera.y = wy - g.viewH() / 2;
  g.clampCam();
  return { camx: Math.round(st.camera.x), camy: Math.round(st.camera.y) };
}, [x, y]);
const camToBuilding = (side) => page.evaluate((s) => {
  const g = window.game, st = g.state;
  st.fog.explored.fill(1);
  const b = st.buildings.find((t) => t.side === s && t.type === 'cc' && !t.dead);
  if (!b) return null;
  const u = st.units.find((t) => t.side === 'player' && !t.dead);
  if (u) { u.x = b.x + 48; u.y = b.y + 40; }
  st.camera.x = b.x - g.viewW() / 2;
  st.camera.y = b.y - g.viewH() / 2;
  g.clampCam();
  return { x: Math.round(b.x), y: Math.round(b.y) };
}, side);
const mapDims = () => page.evaluate(() => ({
  w: window.game.state.map.w, h: window.game.state.map.h,
  pxW: window.game.state.map.pxW, pxH: window.game.state.map.pxH,
  tw: window.game.state.map.terrainCanvas.width, th: window.game.state.map.terrainCanvas.height,
}));
// Середина карты — чистый рельеф биома (без баз).
const biomeShot = async (name) => {
  const c = await page.evaluate(() => {
    const st = window.game.state;
    return [st.map.pxW / 2, st.map.pxH / 2];
  });
  await camAt(c[0], c[1]);
  await page.waitForTimeout(400);
  await shot(name);
};

// ---------- Ш1: №3 «Рудник-7» — 88×88, база Ю, mars ----------
try {
  await startCard(3);
  const d = await mapDims();
  assert(d.w === 88 && d.h === 88, `№3 размер не 88×88: ${d.w}×${d.h}`);
  assert(d.pxW === 2816 && d.tw === 2816, `канвасы не 2816: ${d.pxW}/${d.tw}`);
  const t = await bodyText();
  assert(/Собрано\s*0\s*\/\s*2500/.test(t), 'HUD «Собрано 0/2500» не найден');
  const v = await camToBuilding('player');
  assert(v, 'свой КЦ не найден');
  await page.waitForTimeout(500);
  await shot('p7_m3_south');
  await biomeShot('p7_biomes_mars');
  ok('Ш1', '№3: 88×88 (px 2816), HUD добычи, база Ю на скрине, mars-рельеф снят');
} catch (e) { bad('Ш1', e.message); }

// ---------- Ш2: №2 «Пробуждение недр» — 76×76, nest, победа ----------
try {
  await startCard(2);
  const d = await mapDims();
  assert(d.w === 76 && d.h === 76, `№2 размер не 76×76: ${d.w}×${d.h}`);
  const t = await bodyText();
  assert(/Уничтожьте:\s*Сердце лагеря/.test(t), 'HUD «Сердце лагеря» не найден');
  await biomeShot('p7_biomes_nest');
  await page.evaluate(async () => {
    const U = await import('./js/units.js');
    const st = window.game.state;
    const cc = st.buildings.find((b) => b.side === 'enemy' && b.type === 'cc' && !b.dead);
    U.damageEntity(st, cc, 1e9, null);
  });
  await page.waitForTimeout(900);
  const e1 = await endScreen();
  assert(e1.over === 'win', 'снос Сердца не дал победу');
  assert(e1.epi.length > 10, 'эпилог №2 пуст: ' + JSON.stringify(e1.epi));
  await shot('p7_m2_win');
  ok('Ш2', `№2: 76×76, nest снят, снос = победа, эпилог: ${e1.epi.slice(0, 60)}…`);
} catch (e) { bad('Ш2', e.message); }

// ---------- Ш3: №4 «Пепельная линия» — 56×56, круг шаттлов у края ----------
try {
  await startCard(4);
  const d = await mapDims();
  assert(d.w === 56 && d.h === 56, `№4 размер не 56×56: ${d.w}×${d.h}`);
  const t = await bodyText();
  assert(/Эвакуировано\s*0\s*\/\s*8/.test(t), 'HUD «Эвакуировано 0/8» не найден');
  const z = await page.evaluate(() => {
    const w = window.game.state.win;
    return [(w.x + 0.5) * 32, (w.y + 0.5) * 32, w.x, w.y];
  });
  assert(z[2] === 10 && z[3] === 8, `evac-зона не (10,8): ${z[2]},${z[3]}`);
  await camAt(z[0], z[1]);
  await page.waitForTimeout(500);
  await shot('p7_m4_small');
  ok('Ш3', '№4: 56×56, зона отхода (10,8) у северо-западного края, круг огней на скрине');
} catch (e) { bad('Ш3', e.message); }

// ---------- Ш4: №7 «Стальной кулак» — 72×72, база ЮВ ----------
try {
  await startCard(7);
  const d = await mapDims();
  assert(d.w === 72 && d.h === 72, `№7 размер не 72×72: ${d.w}×${d.h}`);
  const v = await camToBuilding('player');
  assert(v, 'свой КЦ не найден');
  const corner = await page.evaluate(() => {
    const st = window.game.state;
    const cc = st.buildings.find((b) => b.side === 'player' && b.type === 'cc');
    const { bases } = st.map;
    return { cx: bases.player.cc.x, cy: bases.player.cc.y };
  });
  assert(corner.cx === 56 && corner.cy === 56, `база не (56,56): ${corner.cx},${corner.cy}`);
  await page.waitForTimeout(500);
  await shot('p7_m7_se');
  ok('Ш4', '№7: 72×72, база ЮВ (56,56) в углу на скрине');
} catch (e) { bad('Ш4', e.message); }

// ---------- Ш5: №11 «Переворот» — 76×76, база СВ ----------
try {
  await startCard(11);
  const d = await mapDims();
  assert(d.w === 76 && d.h === 76, `№11 размер не 76×76: ${d.w}×${d.h}`);
  const corner = await page.evaluate(() => {
    const { bases } = window.game.state.map;
    return { x: bases.player.cc.x, y: bases.player.cc.y };
  });
  assert(corner.x === 56 && corner.y === 10, `база не (56,10): ${corner.x},${corner.y}`);
  await camToBuilding('player');
  await page.waitForTimeout(500);
  await shot('p7_m11_ne');
  ok('Ш5', '№11: 76×76, база СВ (56,10) в углу на скрине');
} catch (e) { bad('Ш5', e.message); }

// ---------- Ш6: №13 «Око бури» — 52×52, рифт + зона отхода, moon ----------
try {
  await startCard(13);
  const d = await mapDims();
  assert(d.w === 52 && d.h === 52, `№13 размер не 52×52: ${d.w}×${d.h}`);
  const t = await bodyText();
  assert(/Снесите Око бури/.test(t), 'HUD «Снесите Око бури» не найден');
  // №13 — цепочка: evac-зона живёт в win.then (сейчас фаза «Око»)
  const z = await page.evaluate(() => {
    const w = window.game.state.win.then || window.game.state.win;
    return [(w.x + 0.5) * 32, (w.y + 0.5) * 32, w.x, w.y];
  });
  assert(z[2] === 20 && z[3] === 40, `evac-зона не (20,40): ${z[2]},${z[3]}`);
  // рифт (26,26) и зона (20,40) рядом — камера между ними
  await camAt((z[0] + 26.5 * 32) / 2, (z[1] + 26.5 * 32) / 2);
  await page.waitForTimeout(500);
  await shot('p7_m13_rift');
  await biomeShot('p7_biomes_moon');
  ok('Ш6', '№13: 52×52, рифт + зона отхода (20,40), moon-рельеф снят');
} catch (e) { bad('Ш6', e.message); }

// ---------- Ш7: №14 «Звёздный рубеж» — 80×80, С3, финал ----------
try {
  await startCard(14);
  const d = await mapDims();
  assert(d.w === 80 && d.h === 80, `№14 размер не 80×80: ${d.w}×${d.h}`);
  const t = await bodyText();
  assert(/Уничтожьте:\s*Крепление «Последняя песня»/.test(t), 'HUD крепления не найден');
  // С3: стартовый tech врага = 1, игрок не тронут
  const tech = await page.evaluate(() => {
    const st = window.game.state;
    return { enemy: { ...st.tech.enemy }, player: { ...st.tech.player } };
  });
  for (const k of ['infAtk', 'vehAtk', 'infArm', 'vehArm']) {
    assert(tech.enemy[k] === 1, `tech.enemy.${k} не 1: ${tech.enemy[k]}`);
    assert((tech.player[k] || 0) === 0, `tech.player.${k} тронут`);
  }
  // Честная лаба врага: placeBuildingCmd из модуля, достроена — ИИ качает 2-й уровень.
  const labInfo = await page.evaluate(async () => {
    const B = await import('./js/buildings.js');
    const st = window.game.state;
    st.minerals.enemy = 99999; // W20: placeBuildingCmd проверяет цену
    const e = st.map.bases.enemy.cc;
    let spot = null;
    for (let dy = 10; dy >= -12 && !spot; dy--) // южнее КЦ — запас экрана вверх под 4 слота
      for (let dx = -12; dx <= 12; dx++)
        if (B.canPlace(st.map, e.x + dx, e.y + dy, 3, 3)) { spot = [e.x + dx, e.y + dy]; break; }
    if (!spot) return null;
    const lab = B.placeBuildingCmd(st, 'enemy', 'lab', spot[0], spot[1], []);
    lab.done = true; lab.hp = lab.maxHp;
    return { x: lab.x, y: lab.y };
  });
  assert(labInfo, 'лаборатории негде встать');
  // Юнит-сторож у лабы: idle, иначе уходит добывать и лаба снова становится ghost
  await page.evaluate(() => {
    const st = window.game.state;
    const lab = st.buildings.find((b) => b.side === 'enemy' && b.type === 'lab' && !b.dead);
    const u = st.units.find((t) => t.side === 'player' && !t.dead);
    if (u) { u.x = lab.x; u.y = lab.y + 10; u.order = { kind: 'idle' }; u.moving = false; }
  });
  await page.waitForTimeout(2600);
  const lvl = await page.evaluate(() => {
    const lab = window.game.state.buildings.find((b) => b.side === 'enemy' && b.type === 'lab' && !b.dead);
    return lab && lab.res ? { lvl: lab.res.lvl, key: lab.res.key } : null;
  });
  assert(lvl && lvl.lvl === 2, `лаба врага не качает 2-й уровень: ${JSON.stringify(lvl)}`);
  // Камера на вражью лабу: иконки закрытых уровней (юнит-сторож держит видимость)
  await page.evaluate(() => {
    const g = window.game, st = g.state;
    const lab = st.buildings.find((b) => b.side === 'enemy' && b.type === 'lab' && !b.dead);
    st.camera.x = lab.x - g.viewW() / 2;
    st.camera.y = lab.y - g.viewH() / 2;
    g.clampCam();
    const u = st.units.find((t) => t.side === 'player' && !t.dead);
    if (u) { u.x = lab.x; u.y = lab.y + 10; u.order = { kind: 'idle' }; u.moving = false; }
  });
  await page.waitForTimeout(600);
  await shot('p7_m14_tech');
  // Финал: снос крепления = победа + campaignDone + эпилог.
  await page.evaluate(async () => {
    const U = await import('./js/units.js');
    const st = window.game.state;
    const cc = st.buildings.find((b) => b.side === 'enemy' && b.type === 'cc' && !b.dead);
    U.damageEntity(st, cc, 1e9, null);
  });
  await page.waitForTimeout(900);
  const e2 = await endScreen();
  assert(e2.over === 'win', 'снос крепления не дал победу');
  const body = await bodyText();
  assert(/Кампания пройдена/.test(body), 'бейджа «Кампания пройдена» нет');
  assert(/«Глушитель» мёртв/.test(e2.epi), 'эпилога №14 нет: ' + JSON.stringify(e2.epi));
  await shot('p7_m14_win');
  ok('Ш7', '№14: 80×80, tech врага 1 (игрок 0), лаба качает 2-й, иконки; финал campaignDone + эпилог');
} catch (e) { bad('Ш7', e.message); }

// ---------- pageerrors ----------
if (errors.length) {
  bad('PAGEERRORS', `${errors.length} шт: ${errors.slice(0, 5).join(' || ')}`);
} else {
  ok('PAGEERRORS', '0 за всю сессию');
}

console.log('\n=== ИТОГ ===');
for (const r of results) console.log(r);
await browser.close();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
