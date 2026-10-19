// ac_p4_browse.mjs — браузерная приёмка П4 (перекраска №2/№6/№7) по чек-листу Арены.
// T1 карточка/брифинг №2 + ромб над Сердцем + таймер дедлайна в HUD
// T2 мягкий дедлайн №2: волна + тост, игра продолжается
// T3 №6: карточка «Соберите 2000 эрга», HUD-счётчик, багги у врага (фабрика)
// T4 эпилоги на экранах победы №2/№6/№7
// T5 снос своей базы в каждой = поражение (без эпилога)
// pageerrors 0.
import { chromium } from 'playwright';

const BASE = 'http://localhost:8793';
const OUT = '/home/z/my-project/alien-cosmic/tool-results';

const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1500 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.addInitScript(() => localStorage.setItem('terranrts.progress', '14'));
await page.goto(BASE + '/index.html', { waitUntil: 'load' });
await page.waitForTimeout(1200);

const openCampaign = async () => {
  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(900);
  await page.locator('#btn-season1').click();
  await page.waitForTimeout(350);
};
const startCard = async (idx) => {
  await openCampaign();
  await page.locator('.mission-card').nth(idx).click();
  await page.waitForTimeout(350);
  const brief = await page.locator('body').innerText();
  await page.locator('#btn-brief-go').click();
  await page.waitForTimeout(1200);
  return brief;
};
const centerOnEnemyCC = async () => {
  await page.evaluate(() => {
    const g = window.game, st = g.state;
    const cc = st.buildings.find((b) => b.side === 'enemy' && b.type === 'cc' && !b.dead);
    if (cc) { st.camera.x = cc.x; st.camera.y = cc.y; g.clampCam(); }
  });
  await page.waitForTimeout(300);
};
const endScreen = async () => {
  await page.waitForTimeout(600);
  return page.evaluate(() => ({
    over: window.game.state.gameOver,
    reason: (document.querySelector('#end-reason') || {}).textContent || '',
    epi: (document.querySelector('#end-epilogue') || {}).textContent || '',
    title: (document.querySelector('#end-title') || {}).textContent || ''
  }));
};
// bcount — event-driven счётчик (декремент в killEntity); прямой dead=true его
// не трогает, поэтому после прямого убийства зеркалим его вручную — как было бы
// при честной смерти (симы делают то же через U.damageEntity).
const killPlayerAll = () => page.evaluate(() => {
  const st = window.game.state;
  for (const u of st.units) if (u.side === 'player' && !u.dead) u.hp = -1, u.dead = true;
  for (const b of st.buildings) if (b.side === 'player' && !b.dead) { b.hp = -1; b.dead = true; }
  st.bcount.player = 0;
});

const out = {};
const dump = {};

// ---------- T1: №2 (карточка индекс 2) ----------
const brief2 = await startCard(2);
out.t1_card = /Уничтожьте: Сердце лагеря/.test(brief2) && /карательного корпуса|седьмой минуте/.test(brief2);
const hud2 = await page.evaluate(() => window.game.objectiveText());
// таймер — оставшееся время: после старта уже < 07:00, ловим формат ММ:СС
dump.t1_hudText = hud2;
out.t1_hud = /Уничтожьте: Сердце лагеря/.test(hud2) && /Карательный корпус «Гелиоса»: \d{2}:\d{2}/.test(hud2);
out.t1_keyTotal = await page.evaluate(() => window.game.state.keyTotal === 1);
await centerOnEnemyCC();
await page.screenshot({ path: OUT + '/p4_m2_diamond.png' });
const dead2 = await page.evaluate(() => window.game.state.loseDeadline);
out.t1_deadlineCfg = dead2 && dead2.at === 420 && dead2.hard === false;

// ---------- T2: мягкий дедлайн №2 ----------
out.t2 = await page.evaluate(async () => {
  const g = window.game, st = g.state;
  st.time = 419;
  await new Promise((r) => setTimeout(r, 2600)); // ~2.2 игровых секунд
  const toasts = Array.from(document.querySelectorAll('#toasts .toast')).map((t) => t.textContent).join('|');
  return {
    fired: st.deadlineFired === true,
    alive: !st.gameOver,
    toast: /Карательный корпус/.test(toasts),
    enemies: st.units.filter((u) => u.side === 'enemy' && !u.dead).length
  };
});
await page.screenshot({ path: OUT + '/p4_m2_deadline.png' });
out.t2_ok = out.t2.fired && out.t2.alive && out.t2.toast && out.t2.enemies > 0;

// ---------- T3: №6 (карточка индекс 6) ----------
const brief6 = await startCard(6);
out.t3_card = /Соберите 2000 эрга/.test(brief6) && /Свои против своих|свои против своих/.test(brief6);
const hud6a = await page.evaluate(() => window.game.objectiveText());
await page.evaluate(() => { window.game.state.stats.mined = 1000; });
await page.waitForTimeout(300);
const hud6b = await page.evaluate(() => window.game.objectiveText());
const ai6 = await page.evaluate(() => {
  const st = window.game.state;
  return {
    factory: st.ai.p.factory === true,
    buggies: st.units.filter((u) => u.side === 'enemy' && u.kind === 'buggy' && !u.dead).length +
             (st.ai.p.maxBuggies === 6 ? 0 : -99)
  };
});
out.t3_hud = /Собрано 0\/2000/.test(hud6a) && /Собрано 1000\/2000/.test(hud6b);
out.t3_ai = ai6.factory && ai6.buggies >= 0;
await page.screenshot({ path: OUT + '/p4_m6_hud.png' });

// ---------- T4: эпилоги на победах ----------
const epilogueCheck = async () => {
  const r = await endScreen();
  return { over: r.over, epi: r.epi, reason: r.reason };
};
// №2: перезапуск миссии (после T3 игра стоит на №6!) и снос Сердца
await startCard(2);
await page.evaluate(() => {
  const st = window.game.state;
  const cc = st.buildings.find((b) => b.side === 'enemy' && b.type === 'cc' && !b.dead);
  cc.hp = -1; cc.dead = true;
});
await page.waitForTimeout(800);
const r2 = await epilogueCheck();
dump.r2 = r2;
out.t4_m2 = r2.over === 'win' && /Железные забыли/.test(r2.epi);

// №6: перезапуск миссии (после победы №2 игра на её финальном экране) и порог 2000
await startCard(6);
await page.evaluate(() => { window.game.state.stats.mined = 2000; });
await page.waitForTimeout(800);
const r6 = await epilogueCheck();
out.t4_m6 = r6.over === 'win' && /Флаги сорваны/.test(r6.epi);

// №7 (карточка индекс 7): снести штаб
await startCard(7);
const brief7 = await page.evaluate(() => window.game.objectiveText());
dump.m7_hudText = brief7;
out.t4_m7_pre = /Уничтожьте: Штаб форта/.test(brief7) && /Контрудар «Красного флага»: \d{2}:\d{2}/.test(brief7);
await page.evaluate(() => {
  const st = window.game.state;
  const cc = st.buildings.find((b) => b.side === 'enemy' && b.type === 'cc' && !b.dead);
  cc.hp = -1; cc.dead = true;
});
await page.waitForTimeout(800);
const r7 = await epilogueCheck();
out.t4_m7 = r7.over === 'win' && /Форт пал/.test(r7.epi);
await page.screenshot({ path: OUT + '/p4_m7_win.png' });

// ---------- T5: снос своей базы = поражение (все три) ----------
const loseCheck = async (idx) => {
  await startCard(idx);
  await killPlayerAll();
  await page.waitForTimeout(900);
  const r = await endScreen();
  return r.over === 'lose' && !/Железные забыли|Флаги сорваны|Форт пал/.test(r.epi);
};
out.t5_m2 = await loseCheck(2);
out.t5_m6 = await loseCheck(6);
out.t5_m7 = await loseCheck(7);
await page.screenshot({ path: OUT + '/p4_lose.png' });

console.log('HUD m2:', JSON.stringify(dump.t1_hudText));
console.log('HUD m7:', JSON.stringify(dump.m7_hudText));
console.log('R2:', JSON.stringify(dump.r2));
console.log('T1:', JSON.stringify(out.t1_card && out.t1_hud && out.t1_keyTotal && out.t1_deadlineCfg), JSON.stringify({ card: out.t1_card, hud: out.t1_hud, keyTotal: out.t1_keyTotal, dlCfg: out.t1_deadlineCfg }));
console.log('T2:', JSON.stringify(out.t2_ok), JSON.stringify(out.t2));
console.log('T3:', JSON.stringify(out.t3_card && out.t3_hud && out.t3_ai), JSON.stringify({ card: out.t3_card, hud: out.t3_hud, ai: out.t3_ai }));
console.log('T4:', JSON.stringify({ m2: out.t4_m2, m6: out.t4_m6, m7pre: out.t4_m7_pre, m7: out.t4_m7 }));
console.log('T5:', JSON.stringify({ m2: out.t5_m2, m6: out.t5_m6, m7: out.t5_m7 }));
console.log('PAGEERRORS:', errors.length);
if (errors.length) console.log('ERRORS:', errors.slice(0, 5).join(' | '));
await browser.close();
const allOk = out.t1_card && out.t1_hud && out.t1_keyTotal && out.t1_deadlineCfg && out.t2_ok &&
  out.t3_card && out.t3_hud && out.t3_ai && out.t4_m2 && out.t4_m6 && out.t4_m7_pre && out.t4_m7 &&
  out.t5_m2 && out.t5_m6 && out.t5_m7 && errors.length === 0;
console.log('ИТОГ:', allOk ? 'ВСЕ ЧЕК-ЛИСТ green' : 'ЕСТЬ ПРОВАЛЫ');
process.exit(allOk ? 0 : 1);
