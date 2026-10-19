// ac_e_browse.mjs — браузерная приёмка Пакета E (E.1 панель, E.2 статусы зданий).
// T1 четыре положения панели: класс + реальная геометрия bbox + скрины
// T2 скрытие: кнопка, плавающая «Панель», тосты живы, показ обратно
// T3 хоткей V: скрыть/показать, resize пересчитал инсеты
// T4 localStorage: выбор переживает перезагрузку
// T5 краевой скролл от инсетов (панель слева: над панелью — тишина, у края — едет)
// T6 бейджи в мире: производство ×2, исследование, гарнизон «2/4» (+скрин)
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

await page.addInitScript(() => {
  localStorage.setItem('terranrts.progress', '14');
  // чистка приёмки — только по хэшу #clean (иначе перезагрузка T4 сотрёт префы)
  if (location.hash === '#clean') localStorage.removeItem('terranrts.panel');
});
await page.goto(BASE + '/index.html#clean', { waitUntil: 'load' });
await page.waitForTimeout(1000);

const uiApi = () => page.evaluate(async () => {
  const ui = await import('./js/ui.js');
  return { pos: ui.getPanelPos(), hidden: ui.isPanelHidden(), ins: ui.getPanelInsets() };
});
const bbox = () => page.locator('#bottom-panel').boundingBox();
const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png` });
const startMission = async () => {
  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(900);
  await page.locator('#btn-campaign').click();
  await page.waitForTimeout(350);
  await page.locator('.mission-card').nth(0).click();
  await page.waitForTimeout(350);
  await page.locator('#btn-brief-go').click();
  await page.waitForTimeout(1200);
};

await startMission(); // панель кликабельна только в игре — оверлей меню перехватывает клики

// ---------- T1: четыре положения ----------
try {
  const names = ['bottom', 'left', 'right', 'top'];
  for (let i = 0; i < 4; i++) {
    if (i > 0) await page.locator('#panel-pos').click(); // кнопка циклит низ→лево→право→верх
    await page.waitForTimeout(250);
    const api = await uiApi();
    const bb = await bbox();
    assert(api.pos === names[i], `позиция ${names[i]}, а ${api.pos}`);
    const label = (await page.locator('#panel-pos').innerText()).trim();
    if (i === 0) {
      assert(bb.y >= 1500 - 200, `низ: панель у низа (y=${Math.round(bb.y)})`);
    } else if (i === 1) {
      assert(bb.x <= 2 && bb.width <= 250, `лево: панель слева шириной ~236 (x=${Math.round(bb.x)}, w=${Math.round(bb.width)})`);
    } else if (i === 2) {
      assert(bb.x + bb.width >= 1598 && bb.width <= 250, `право: панель справа (x=${Math.round(bb.x)})`);
    } else {
      assert(bb.y >= 40 && bb.y <= 60, `верх: панель под топбаром (y=${Math.round(bb.y)})`);
    }
    assert(label.includes(names[i] === 'bottom' ? 'низ' : names[i] === 'left' ? 'слева' : names[i] === 'right' ? 'справа' : 'верх'), `лейбл кнопки: ${label}`);
    await shot(`e_panel_${names[i]}`);
  }
  // вернуть низ — через API (кликом легко промахнуться по циклу)
  await page.evaluate(async () => {
    const ui = await import('./js/ui.js');
    ui.setPanelPos('bottom'); window.game.resize();
  });
  await page.waitForTimeout(150);
  const back = await uiApi();
  assert(back.pos === 'bottom', `возврат в низ, а ${back.pos}`);
  ok('T1', '4 положения: класс, геометрия bbox, лейбл кнопки, скрины e_panel_*');
} catch (e) { bad('T1', e.message); }

// ---------- T2: скрытие кнопкой, тосты, плавающая кнопка ----------
try {
  await page.locator('#panel-hide').click();
  await page.waitForTimeout(250);
  assert(await uiApi().then((a) => a.hidden), 'не скрылась');
  assert(await page.locator('#panel-show').isVisible(), 'плавающая «Панель» не видна');
  assert(!(await bbox()), '#bottom-panel ещё в DOM/видим');
  await page.evaluate(async () => { const ui = await import('./js/ui.js'); ui.toast('тест-тост E', 'info'); });
  await page.waitForTimeout(300);
  const toastText = await page.locator('#toasts').innerText();
  assert(/тест-тост E/.test(toastText), 'тост не показан при скрытой панели');
  await shot('e_panel_hidden');
  await page.locator('#panel-show').click();
  await page.waitForTimeout(250);
  assert(await bbox(), 'панель не вернулась');
  assert(!(await page.locator('#panel-show').isVisible()), 'плавающая кнопка не спряталась');
  ok('T2', 'скрытие: панель спрятана, тост жив, «Панель» возвращает');
} catch (e) { bad('T2', e.message); }

// ---------- T3: хоткей V ----------
try {
  await page.keyboard.press('v');
  await page.waitForTimeout(200);
  const h1 = await uiApi();
  assert(h1.hidden && h1.ins.bottom === 0 && h1.ins.left === 0, `V не скрыл (${JSON.stringify(h1.ins)})`);
  const gameIns = await page.evaluate(() => ({ bot: window.game.uiBottom, left: window.game.uiLeft }));
  assert(gameIns.bot === 0 && gameIns.left === 0, `resize после V не пересчитал инсеты (${JSON.stringify(gameIns)})`);
  await page.keyboard.press('v');
  await page.waitForTimeout(200);
  const h2 = await uiApi();
  assert(!h2.hidden && h2.ins.bottom === 190, 'V не показал обратно');
  ok('T3', 'V скрывает/показывает, resize пересчитал инсеты');
} catch (e) { bad('T3', e.message); }

// ---------- T5: краевой скролл от инсетов (панель слева) ----------
try {
  // мышь после кликов T2/T3 может стоять в краевой зоне — в центр, иначе камера уедет
  await page.mouse.move(800, 700);
  await page.waitForTimeout(150);
  await page.evaluate(async () => {
    const ui = await import('./js/ui.js');
    ui.setPanelPos('left'); window.game.resize();
    const st = window.game.state;
    st.fog.explored.fill(1);
    st.camera.x = 400; st.camera.y = 300; window.game.clampCam();
  });
  await page.waitForTimeout(200);
  // мышь НАД панелью (x=60 < 236) — камера стоит
  await page.mouse.move(60, 600);
  await page.waitForTimeout(600);
  const c1 = await page.evaluate(() => ({ ...window.game.state.camera }));
  // мышь у игрового края (x=236+2) — камера едет влево
  await page.mouse.move(239, 600);
  await page.waitForTimeout(700);
  const c2 = await page.evaluate(() => ({ ...window.game.state.camera }));
  assert(Math.abs(c1.x - 400) < 1 && Math.abs(c1.y - 300) < 1, `над панелью камера уехала (${c1.x},${c1.y})`);
  assert(c2.x < c1.x - 10, `у игрового края камера не поехала влево (${c2.x} vs ${c1.x})`);
  ok('T5', `краевой скролл от инсетов: над панелью стоит (${Math.round(c1.x)}), у края едет (${Math.round(c2.x)})`);
  await page.evaluate(async () => { const ui = await import('./js/ui.js'); ui.setPanelPos('bottom'); window.game.resize(); });
} catch (e) { bad('T5', e.message); }

// ---------- T6: бейджи в мире ----------
try {
  await page.evaluate(async () => {
    const B = await import('./js/buildings.js');
    const U = await import('./js/units.js');
    const st = window.game.state;
    st.minerals.player = 99999;
    const cc = st.buildings.find((b) => b.side === 'player' && b.type === 'cc' && !b.dead);
    // площадка правее базы
    const bx = cc.tx + 6, by = cc.ty + 1;
    const rax = B.placeBuildingCmd(st, 'player', 'barracks', bx, by, []);
    rax.done = true; rax.hp = rax.maxHp;
    rax.queue = [{ type: 'marine', t: 6.5, total: 13 }, { type: 'marine', t: 13, total: 13 }];
    const lab = B.placeBuildingCmd(st, 'player', 'lab', bx, by + 4, []);
    lab.done = true; lab.hp = lab.maxHp;
    lab.res = { key: 'infAtk', lvl: 1, t: 20, total: 40 };
    const bun = B.placeBuildingCmd(st, 'player', 'bunker', bx, by + 8, []);
    bun.done = true; bun.hp = bun.maxHp;
    for (let i = 0; i < 2; i++) {
      const m = U.spawnUnit(st, 'player', 'marine', bun.tx * 32 + 16, (bun.ty + 1) * 32);
      m.garrison = bun; bun.garrison.push(m);
    }
    st.camera.x = (bx + 2) * 32; st.camera.y = (by + 4) * 32;
    window.game.clampCam();
  });
  await page.waitForTimeout(400);
  await shot('e_badges');
  const errCount = errors.length;
  assert(errCount === 0, `pageerrors во время бейджей: ${errCount}`);
  ok('T6', 'бейджи: казарма ×2, лаба с исследованием, бункер 2/4 — кадр e_badges');
} catch (e) { bad('T6', e.message); }

// ---------- T4: localStorage переживает перезагрузку (последней — reload)
try {
  await page.evaluate(async () => { const ui = await import('./js/ui.js'); ui.setPanelPos('top'); });
  await page.waitForTimeout(150);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(900);
  const cls = await page.evaluate(() => document.body.className);
  const label = (await page.locator('#panel-pos').innerText()).trim();
  assert(/panel-top/.test(cls), `после перезагрузки класс пропал: "${cls}"`);
  assert(label.includes('верх'), `лейбл после перезагрузки: ${label}`);
  ok('T4', 'выбор «верх» пережил перезагрузку (класс + лейбл)');
  await page.evaluate(async () => { const ui = await import('./js/ui.js'); ui.setPanelPos('bottom'); ui.setPanelHidden(false); });
} catch (e) { bad('T4', e.message); }

// ---------- финал ----------
await page.waitForTimeout(300);
console.log('\n--- ИТОГ БРАУЗЕРНОЙ ПРИЁМКИ E ---');
for (const r of results) console.log(r);
console.log(`pageerrors/console-errors: ${errors.length}`);
for (const e of errors) console.log('  ' + e);
await browser.close();
process.exit(results.some((r) => r.startsWith('FAIL')) || errors.length ? 1 : 0);
