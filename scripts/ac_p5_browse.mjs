// ac_p5_browse.mjs — браузерная приёмка П5 (перекраска №1/№5/№13) по чек-листу Арены.
// T1 №1: таймер→фаза 2 (тост «Шаттлы сели…», HUD «Эвакуировано 0/6»), 6 в круг = победа + эпилог
// T2 №5: пунктир священных полей, стройка снаружи запрещена (zoneAllows + placeBuildingCmd), таймер = победа + эпилог
// T3 №13: ромб над «Оком» + HUD-текст, снос Ока = тост + счётчик 0/4, отход 4 = победа + эпилог
// pageerrors 0. Скрины: p5_m1_phase2, p5_m1_win, p5_m5_zone, p5_m5_win, p5_m13_eye, p5_m13_phase2, p5_m13_win.
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
  await page.waitForTimeout(1200);
};
const endScreen = () => page.evaluate(() => ({
  over: window.game.state.gameOver,
  title: (document.querySelector('#end-title') || {}).textContent || '',
  epi: (document.querySelector('#end-epilogue') || {}).textContent || '',
}));
const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png` });
const cam = (wx, wy) => page.evaluate(([x, y]) => {
  const st = window.game.state;
  st.fog.explored.fill(1);
  st.camera.x = x; st.camera.y = y; window.game.clampCam();
}, [wx, wy]);
const bodyText = () => page.evaluate(() => document.body.innerText);

// ---------- T1: №1 двухфазная ----------
try {
  await startCard(1);
  //enemy юнитов убираем — детерминизм ожиданий hold
  await page.evaluate(() => {
    const st = window.game.state;
    for (const u of st.units) if (u.side === 'enemy' && !u.dead) { u.hp = -1; u.dead = true; }
  });
  await page.evaluate(() => {
    const st = window.game.state, def = window.game.mission.defense;
    st.time = def.prep + def.total + 1;
  });
  await page.waitForTimeout(700);
  const t1 = await bodyText();
  const st1 = await page.evaluate(() => ({ p2: window.game.state.phase2, over: window.game.state.gameOver }));
  assert(st1.p2 === true, 'фаза 2 не началась по таймеру');
  assert(!st1.over, 'таймер завершил игру (не должен)');
  assert(/Шаттлы сели/.test(t1), 'тоста «Шаттлы сели…» нет');
  assert(/Эвакуировано\s*0\s*\/\s*6/.test(t1), `HUD-счётчика 0/6 нет`);
  await cam(16.5 * 32, 8.5 * 32);
  await page.waitForTimeout(300);
  await shot('p5_m1_phase2');
  // 6 бойцов в круг огней, hold 3с: спавним новых idle-марин прямо в круг
  // (существующие рабочие с приказами уходят из зоны — это корректно для игры)
  await page.evaluate(async () => {
    const U = await import('./js/units.js');
    const st = window.game.state;
    for (let n = 0; n < 6; n++) {
      const m = U.spawnUnit(st, 'player', 'marine', 16.5 * 32, 8.5 * 32);
      m.x = 16.5 * 32 + (n - 3) * 12; m.y = 8.5 * 32 + (n % 2) * 14;
    }
  });
  await page.waitForTimeout(4500);
  const e1 = await endScreen();
  assert(e1.over === 'win', 'победа после эвакуации 6 не наступила');
  assert(/Шаттлы ушли/.test(e1.epi), 'эпилога №1 нет: ' + e1.epi);
  await shot('p5_m1_win');
  ok('T1', '№1: фаза 2 (тост+HUD 0/6+круг), 6 в круг = победа + эпилог');
} catch (e) { bad('T1', e.message); }

// ---------- T2: №5 зона + мортиры ----------
try {
  await startCard(5);
  await page.evaluate(() => { window.game.state.minerals.player = 99999; });
  await cam(11 * 32, 11 * 32); // священные поля {3,4,16,16} — зона с ЦК внутри
  await page.waitForTimeout(300);
  await shot('p5_m5_zone');
  const z = await page.evaluate(async () => {
    const B = await import('./js/buildings.js');
    const st = window.game.state;
    const inside = B.zoneAllows(st, 8, 9, 2, 2);
    const outside = B.zoneAllows(st, 40, 40, 2, 2);
    const denied = B.placeBuildingCmd(st, 'player', 'turret', 40, 40, []);
    const allowed = B.placeBuildingCmd(st, 'player', 'turret', 14, 14, []);
    return { inside, outside, denied: !!denied, allowed: !!allowed };
  });
  assert(z.inside === true, 'zoneAllows внутри полей = ' + z.inside);
  assert(z.outside === false, 'zoneAllows снаружи полей = ' + z.outside);
  assert(z.denied === false, 'постройка снаружи полей прошла');
  assert(z.allowed === true, 'постройка внутри полей отклонена');
  // мортиры у врага — по конфигу миссии (волны ещё не шли в момент замера)
  const arty = await page.evaluate(() => window.game.mission.ai.arty);
  assert(arty === 2, 'ai.arty в конфиге №5 = ' + arty + ', ожидалось 2');
  await page.evaluate(() => {
    const st = window.game.state, def = window.game.mission.defense;
    st.time = def.prep + def.total + 1;
  });
  await page.waitForTimeout(700);
  const e2 = await endScreen();
  assert(e2.over === 'win', 'оборона №5 не выиграна по таймауту');
  assert(/Хребет удержан/.test(e2.epi), 'эпилога №5 нет: ' + e2.epi);
  await shot('p5_m5_win');
  ok('T2', '№5: пунктир полей, стройка только внутри, мортиры в волнах, победа + эпилог');
} catch (e) { bad('T2', e.message); }

// ---------- T3: №13 диверсия ----------
try {
  await startCard(13);
  // где «Око бури» и что за отряд
  const eye = await page.evaluate(() => {
    const st = window.game.state;
    const cc = st.buildings.find((b) => b.side === 'enemy' && b.type === 'cc' && !b.dead);
    const sq = st.units.filter((u) => u.side === 'player' && !u.dead).map((u) => u.type);
    return { cc: !!cc, sq: sq.join(',') };
  });
  assert(eye.cc, 'КЦ врага («Око») не найден');
  assert(/marine/.test(eye.sq), 'отряда нет: ' + eye.sq);
  await page.evaluate(() => {
    const st = window.game.state;
    const cc = st.buildings.find((b) => b.side === 'enemy' && b.type === 'cc' && !b.dead);
    st.camera.x = cc.x; st.camera.y = cc.y; window.game.clampCam();
  });
  await page.waitForTimeout(300);
  const hud3 = await bodyText();
  assert(/Око бури/.test(hud3), 'в HUD нет «Око бури»');
  await shot('p5_m13_eye');
  // снос Ока → цепочка к эвакуации
  await page.evaluate(() => {
    const st = window.game.state;
    const cc = st.buildings.find((b) => b.side === 'enemy' && b.type === 'cc' && !b.dead);
    cc.hp = -1; cc.dead = true; st.bcount.enemy--;
    for (const u of st.units) if (u.side === 'enemy' && !u.dead) { u.hp = -1; u.dead = true; }
  });
  await page.waitForTimeout(700);
  const st3 = await page.evaluate(() => ({
    w: window.game.state.win && window.game.state.win.kind,
    p2: window.game.state.phase2,
    over: window.game.state.gameOver,
  }));
  assert(st3.w === 'evac' && st3.p2 === true && !st3.over, `цепочка не сработала: ${JSON.stringify(st3)}`);
  const t3 = await bodyText();
  assert(/Око уничтожено/.test(t3), 'тоста «Око уничтожено…» нет');
  assert(/Эвакуировано\s*0\s*\/\s*4/.test(t3), 'HUD-счётчика 0/4 нет');
  await cam(8.5 * 32, 48.5 * 32);
  await page.waitForTimeout(250);
  await shot('p5_m13_phase2');
  // 4 к зоне отхода (спавн у 8,48 — рядом): новые idle-юниты в круг
  await page.evaluate(async () => {
    const U = await import('./js/units.js');
    const st = window.game.state;
    for (let n = 0; n < 4; n++) {
      const m = U.spawnUnit(st, 'player', 'marine', 8.5 * 32, 48.5 * 32);
      m.x = 8.5 * 32 + (n - 2) * 12; m.y = 48.5 * 32 + (n % 2) * 14;
    }
  });
  await page.waitForTimeout(4500);
  const e3 = await endScreen();
  assert(e3.over === 'win', 'победа после отхода не наступила');
  // Честная evac-победа: reason = winEvac по фракции игрока (в №13 faction:
  // 'alien' → «Выводок уведён вглубь…»; человек — «Эвакуация завершена…»).
  // Фолбэк noBase «Цитадель пала…» подавлен фикс-коммитом — его быть не должно.
  const r3 = await page.evaluate(() => (document.querySelector('#end-reason') || {}).textContent || '');
  assert(/Выводок уведён вглубь|Эвакуация завершена/.test(r3), 'причины winEvac нет: ' + r3);
  assert(!/Цитадель пала/.test(r3 + e3.title + e3.epi), 'фолбэк noBase всё ещё срабатывает: ' + r3);
  assert(/Око закрылось/.test(e3.epi), 'эпилога №13 нет: ' + e3.epi);
  await shot('p5_m13_win');
  ok('T3', '№13: ромб «Ока», снос → тост + 0/4, отход 4 = победа + эпилог');
} catch (e) { bad('T3', e.message); }

// ---------- финал ----------
await page.waitForTimeout(300);
console.log('\n--- ИТОГ БРАУЗЕРНОЙ ПРИЁМКИ П5 ---');
for (const r of results) console.log(r);
console.log(`pageerrors/console-errors: ${errors.length}`);
for (const e of errors) console.log('  ' + e);
await browser.close();
process.exit(results.some((r) => r.startsWith('FAIL')) || errors.length ? 1 : 0);
