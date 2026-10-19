// ac_p6_browse.mjs — браузерная приёмка П6 (перекраска №10/№11/№14 + арка) по чек-листу Арены.
// T1 №10: ромб над штабом «Гелиоса» + HUD «Уничтожьте: Штаб «Гелиоса»»; снос = победа + эпилог
// T2 №11: HUD «Штаб «Кремня» · Ветераны «Кремня»: 07:xx» + ромб; дедлайн = тост + рейд-волна, игра идёт; снос = победа + эпилог
// T3 №14: ромб над «Последней песней»; снос = победа + campaignDone + эпилог
// pageerrors 0. Скрины: p6_m10_diamond, p6_m10_win, p6_m11_deadline, p6_m11_wave, p6_m11_win, p6_m14_diamond, p6_m14_win.
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
  reason: (document.querySelector('#end-reason') || {}).textContent || '',
  epi: (document.querySelector('#end-epilogue') || {}).textContent || '',
}));
const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png` });
const camTo = (sel) => page.evaluate(() => {
  const st = window.game.state;
  st.fog.explored.fill(1);
  const cc = st.buildings.find((b) => b.side === 'enemy' && b.type === 'cc' && !b.dead);
  // телепорт своего юнита к КЦ — туман считает visible из юнитов, ромб требует visible
  const u = st.units.find((x) => x.side === 'player' && !x.dead);
  if (u) { u.x = cc.x + 48; u.y = cc.y + 40; }
  // cc.x/y — пиксели ЦЕНТРА здания; camera — левый-верхний угол вида: центрируем КЦ
  st.camera.x = cc.x - window.game.viewW() / 2;
  st.camera.y = cc.y - window.game.viewH() / 2;
  window.game.clampCam();
  return { cc: !!cc, unit: !!u, camx: Math.round(st.camera.x), camy: Math.round(st.camera.y), ccx: Math.round(cc.x), ccy: Math.round(cc.y) };
});
const toasts = () => page.evaluate(() =>
  [...document.querySelectorAll('#toasts .toast')].map((t) => t.textContent).join(' | '));
const bodyText = () => page.evaluate(() => document.body.innerText);

// ---------- T1: №10 «Сердце улья» — ЦЕЛЬ ----------
try {
  await startCard(10);
  const t1 = await bodyText();
  assert(/Уничтожьте:\s*Штаб «Гелиоса»/.test(t1), 'HUD-цели «Штаб «Гелиоса»» нет: ' + t1.slice(0, 300));
  const k1 = await page.evaluate(() => ({ keyTotal: window.game.state.keyTotal, dl: window.game.state.loseDeadline }));
  assert(k1.keyTotal === 1, 'keyTotal не 1: ' + k1.keyTotal);
  assert(k1.dl == null, 'у №10 появился дедлайн, а его быть не должно');
  const v1 = await camTo();
  assert(v1.cc && v1.unit, 'КЦ или свой юнит не найдены');
  await page.waitForTimeout(600);
  await shot('p6_m10_diamond');
  await page.evaluate(async () => {
    const U = await import('./js/units.js');
    const st = window.game.state;
    const cc = st.buildings.find((b) => b.side === 'enemy' && b.type === 'cc' && !b.dead);
    U.damageEntity(st, cc, 1e9, null);
  });
  await page.waitForTimeout(900);
  const e1 = await endScreen();
  assert(e1.over === 'win', 'снос штаба не дал победу');
  assert(/Сердце чужаков вырвано/.test(e1.reason), 'причины нет: ' + e1.reason);
  assert(/Поля святы\.\s*Но железные вернутся — им нужен эрг, не мир\./.test(e1.epi), 'эпилога №10 нет: ' + e1.epi);
  await shot('p6_m10_win');
  ok('T1', '№10: HUD-штаб, keyTotal 1, ромб, снос = победа + эпилог, без дедлайна');
} catch (e) { bad('T1', e.message); }

// ---------- T2: №11 «Переворот» — ОСАДА + мягкий дедлайн ----------
try {
  await startCard(11);
  const t2 = await bodyText();
  assert(/Уничтожьте:\s*Штаб «Кремня»/.test(t2), 'HUD-цели «Штаб «Кремня»» нет: ' + t2.slice(0, 300));
  assert(/Ветераны «Кремня»:\s*07:\d{2}/.test(t2), 'таймера ветеранов в HUD нет: ' + t2.slice(0, 300));
  const k2 = await page.evaluate(() => ({ keyTotal: window.game.state.keyTotal, dl: window.game.state.loseDeadline }));
  assert(k2.keyTotal === 1, 'keyTotal не 1: ' + k2.keyTotal);
  assert(k2.dl && k2.dl.at === 450 && k2.dl.hard === false, 'дедлайн не {at:450, hard:false}: ' + JSON.stringify(k2.dl));
  const v2 = await camTo();
  assert(v2.cc && v2.unit, 'КЦ или свой юнит не найдены');
  await page.waitForTimeout(600);
  await shot('p6_m11_deadline');
  // мягкий дедлайн: тост + рейд-волна, игра продолжается
  const before = await page.evaluate(() => {
    const st = window.game.state;
    st.time = 449;
    return st.units.filter((u) => u.side === 'enemy' && !u.dead).length;
  });
  await page.waitForTimeout(1600);
  const w2 = await page.evaluate(() => ({
    fired: window.game.state.deadlineFired,
    over: window.game.state.gameOver,
    enemy: window.game.state.units.filter((u) => u.side === 'enemy' && !u.dead).length,
  }));
  assert(w2.fired === true, 'дедлайн не сработал');
  assert(!w2.over, 'мягкий дедлайн завершил игру');
  assert(w2.enemy > before, `волны нет: ${before} -> ${w2.enemy}`);
  const tst2 = await toasts();
  assert(/Ветераны «Кремня»/.test(tst2), 'тоста о ветеранах нет: ' + tst2);
  await shot('p6_m11_wave');
  // победа штабом
  await page.evaluate(async () => {
    const U = await import('./js/units.js');
    const st = window.game.state;
    const cc = st.buildings.find((b) => b.side === 'enemy' && b.type === 'cc' && !b.dead);
    U.damageEntity(st, cc, 1e9, null);
  });
  await page.waitForTimeout(900);
  const e2 = await endScreen();
  assert(e2.over === 'win', 'снос штаба не дал победу');
  assert(/Ключевая цель уничтожена/.test(e2.reason), 'причины нет: ' + e2.reason);
  assert(/«Кремень» молчит\.\s*«Глушитель» не найден\. Он где-то рядом\./.test(e2.epi), 'эпилога №11 нет: ' + e2.epi);
  await shot('p6_m11_win');
  ok('T2', '№11: HUD штаб+таймер, дедлайн = тост+волна+игра идёт, снос = победа + эпилог');
} catch (e) { bad('T2', e.message); }

// ---------- T3: №14 «Звёздный рубеж» — ЦЕЛЬ-финал ----------
try {
  await startCard(14);
  const t3 = await bodyText();
  assert(/Уничтожьте:\s*Крепление «Последняя песня»/.test(t3), 'HUD-цели «Крепление «Последняя песня»» нет: ' + t3.slice(0, 300));
  const k3 = await page.evaluate(() => ({ keyTotal: window.game.state.keyTotal, dl: window.game.state.loseDeadline }));
  assert(k3.keyTotal === 1, 'keyTotal не 1: ' + k3.keyTotal);
  assert(k3.dl == null, 'у №14 появился дедлайн, а его быть не должно');
  const v3 = await camTo();
  assert(v3.cc && v3.unit, 'КЦ или свой юнит не найдены');
  await page.waitForTimeout(600);
  await shot('p6_m14_diamond');
  await page.evaluate(async () => {
    const U = await import('./js/units.js');
    const st = window.game.state;
    const cc = st.buildings.find((b) => b.side === 'enemy' && b.type === 'cc' && !b.dead);
    U.damageEntity(st, cc, 1e9, null);
  });
  await page.waitForTimeout(900);
  const e3 = await endScreen();
  assert(e3.over === 'win', 'снос крепления не дал победу');
  assert(/Кампания пройдена — поля кхарид свободны!/.test(e3.reason), 'campaignDone-строки нет: ' + e3.reason);
  assert(/«Глушитель» мёртв\.\s*Рубеж замкнут\. Мир — обеим расам\./.test(e3.epi), 'эпилога №14 нет: ' + e3.epi);
  await shot('p6_m14_win');
  ok('T3', '№14: HUD-крепление, ромб, снос = победа + campaignDone + эпилог');
} catch (e) { bad('T3', e.message); }

// ---------- финал ----------
await page.waitForTimeout(300);
console.log('\n--- ИТОГ БРАУЗЕРНОЙ ПРИЁМКИ П6 ---');
for (const r of results) console.log(r);
console.log(`pageerrors/console-errors: ${errors.length}`);
for (const e of errors) console.log('  ' + e);
await browser.close();
process.exit(results.some((r) => r.startsWith('FAIL')) || errors.length ? 1 : 0);
