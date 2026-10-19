// ac_p8_browse.mjs — браузерная приёмка П8 (пакет D: Кодекс/Хроника, №16–19, С1 UNLOCK_AT)
// по чек-листу Арены и киккоффу.
// Ш1 кодекс свежий: Хроника 15 ???, Герои 11 ???.                     p8_codex_fresh
// Ш2 кодекс после №0: запись «Дельта-2 замолчала» открыта.            p8_codex_open
// Ш3 вкладка Герои.                                                   p8_heroes
// Ш4 вкладка Арсенал (группы Гелиос/Кхарид).                          p8_arsenal
// Ш5 меню кампании: секция «Главы Хроники», Глава 1–4.                p8_chapters
// Ш6 сброс прогресса: миссия 1, главы скрыты, кодекс закрыт.          (без скрина)
// Ш7 №1: меню стройки без Завода/Лаборатории.                         p8_menu_m1
// Ш8 №3: меню стройки с Заводом.                                      p8_menu_m3
// Ш9 №16: волны с первых минут + HUD «Собрано n/2500».                p8_m16_waves
// Ш10 №17: рой против роя, склады врага; цветень = «Выводок пал».     p8_m17_mirror
// Ш11 №18: фаза 2 — evac на плато, счётчик 0/8, меню без казармы.     p8_m18_phase2
// Ш12 №19: HUD жёсткого дедлайна + ромб над «Глушителем».             p8_m19_timer
// Ш13 №19: победа + эпилог «Война кончилась…».                        p8_m19_win
// pageerrors 0.
import { chromium } from 'playwright';

const BASE = 'http://localhost:8793';
const OUT = '/tmp/ac-branch/tool-results';

const errors = [];
const ok = (id, msg) => { console.log(`PASS  ${id}: ${msg}`); };
const bad = (id, msg) => { console.log(`FAIL  ${id}: ${msg}`); process.exitCode = 1; };
const assert = (c, msg) => { if (!c) throw new Error(msg); };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1500 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('dialog', (d) => d.accept()); // П8: confirm сброса прогресса

// goto с уже выставленным прогрессом (setItem до загрузки приложения).
const gotoProgress = async (n) => {
  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await page.evaluate((v) => localStorage.setItem('terranrts.progress', String(v)), n);
  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(900);
};
const startCard = async (idx) => {
  await page.locator('#btn-campaign').click();
  await page.waitForTimeout(350);
  await page.locator('.mission-card').nth(idx).click();
  await page.waitForTimeout(350);
  await page.locator('#btn-brief-go').click();
  await page.waitForTimeout(1400);
};
const endScreen = () => page.evaluate(() => ({
  over: window.game.state.gameOver,
  reason: (document.querySelector('#end-reason') || {}).textContent || '',
  epi: (document.querySelector('#end-epilogue') || {}).textContent || '',
}));
const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png` });
const bodyText = () => page.evaluate(() => document.body.innerText);
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
const lockedCount = (s) => (s.match(/\?\?\?/g) || []).length;
const listText = () => page.evaluate(() => document.getElementById('mission-list').innerText);
// Открыть меню стройки выделением рабочего (панель команд реального DOM).
const openBuildMenu = async () => {
  const okw = await page.evaluate(() => {
    const st = window.game.state;
    const w = st.units.find((u) => u.side === 'player' && !u.dead && u.type === 'worker');
    if (!w) return false;
    st.selection = [w];
    st.buildMenu = true;
    return true;
  });
  assert(okw, 'рабочий не найден');
  await page.waitForTimeout(400);
};

try { // ---------- Ш1: кодекс у свежего профиля ----------
  await gotoProgress(0);
  await page.locator('#btn-codex').click();
  await page.waitForTimeout(400);
  const tabs = await page.evaluate(() => [...document.querySelectorAll('.codex-tab')].map((b) => b.textContent));
  assert(tabs.join('|') === 'Мир|Гелиос|Кхарид|Мятеж|Планеты|Хроника|Герои|Арсенал', 'вкладки не 8/переименованы: ' + tabs.join(','));
  await page.locator('.codex-tab[data-id="war"]').click();
  await page.waitForTimeout(200);
  let t = await bodyText();
  assert(lockedCount(t) >= 15, 'хроника не вся закрыта: ' + lockedCount(t));
  assert(!/Дельта-2 замолчала/.test(t), 'заголовок записи виден до победы');
  await shot('p8_codex_fresh');
  await page.locator('.codex-tab[data-id="heroes"]').click();
  await page.waitForTimeout(200);
  t = await bodyText();
  assert(lockedCount(t) >= 11, 'герои не все закрыты: ' + lockedCount(t));
  await page.locator('.codex-tab[data-id="kharid"]').click();
  await page.waitForTimeout(200);
  assert(lockedCount(await bodyText()) > 0, 'кхарид открыт у свежего профиля');
  ok('Ш1', `кодекс свежий: 8 вкладок, Хроника 15 ???, Герои 11 ???, Кхарид закрыт`);
} catch (e) { bad('Ш1', e.message); }

try { // ---------- Ш2: хроника после победы в №0 ----------
  await gotoProgress(1);
  await page.locator('#btn-codex').click();
  await page.locator('.codex-tab[data-id="war"]').click();
  await page.waitForTimeout(200);
  const t = await bodyText();
  assert(/Дельта-2 замолчала/.test(t), 'запись №0 не открылась');
  assert(/дюны пели/.test(t), 'нет эпилога §3 в теле записи');
  assert(lockedCount(t) === 14, 'открылась не одна запись: ' + lockedCount(t));
  await shot('p8_codex_open');
  ok('Ш2', 'хроника: №0 открыт (эпилог+контекст), остальные 14 ???');
} catch (e) { bad('Ш2', e.message); }

try { // ---------- Ш3: Герои ----------
  await page.locator('.codex-tab[data-id="heroes"]').click();
  await page.waitForTimeout(200);
  const t = await bodyText();
  assert(/Шахта «Дельта-2»/.test(t), 'герой №0 не открылся');
  assert(lockedCount(t) === 10, 'герои: не 10 ???: ' + lockedCount(t));
  await shot('p8_heroes');
  ok('Ш3', 'вкладка Герои: 1 открыта, 10 ???');
} catch (e) { bad('Ш3', e.message); }

try { // ---------- Ш4: Арсенал ----------
  await page.locator('.codex-tab[data-id="arsenal"]').click();
  await page.waitForTimeout(200);
  const t = await bodyText();
  assert(/Гелиос/.test(t) && /Кхарид/.test(t), 'нет групп в арсенале');
  assert(/Рейнджер/.test(t), 'рейнджер не открылся после №0');
  assert(!/Мортира «Нова»/.test(t), 'мортира открылась раньше №7');
  await shot('p8_arsenal');
  ok('Ш4', 'вкладка Арсенал: группы, пороги по UNLOCK_AT');
} catch (e) { bad('Ш4', e.message); }

try { // ---------- Ш5: Главы Хроники в меню ----------
  await gotoProgress(15);
  await page.locator('#btn-campaign').click();
  await page.waitForTimeout(400);
  const t = await listText(); // карточки в .mc-num отдаются в UPPERCASE (CSS text-transform)
  assert(/Главы Хроники/i.test(t), 'нет секции «Главы Хроники»');
  for (const n of [1, 2, 3, 4]) assert(new RegExp('ГЛАВА ' + n).test(t), 'нет «Глава ' + n + '»');
  assert(/МИССИЯ 15/.test(t), 'нет «Миссия 15»');
  await shot('p8_chapters');
  ok('Ш5', 'меню: секция «Главы Хроники» + Глава 1–4 после №14');
} catch (e) { bad('Ш5', e.message); }

try { // ---------- Ш6: сброс прогресса ----------
  await page.locator('#btn-missions-back').click();
  await page.waitForTimeout(250);
  await page.locator('#btn-reset').click(); // confirm принимается диалог-хендлером
  await page.waitForTimeout(300);
  const startTxt = await page.locator('#btn-start').textContent();
  assert(/миссия 1\b/.test(startTxt), 'кнопка старта не сброшена: ' + startTxt);
  await page.locator('#btn-campaign').click();
  await page.waitForTimeout(350);
  const t = await listText();
  assert(!/ГЛАВА/i.test(t), 'главы видны после сброса');
  assert(!/Главы Хроники/i.test(t), 'секция глав видна после сброса');
  await page.locator('#btn-missions-back').click(); // закрыть кампанию — btn-codex живёт в меню
  await page.waitForTimeout(250);
  await page.locator('#btn-codex').click();
  await page.locator('.codex-tab[data-id="war"]').click();
  await page.waitForTimeout(200);
  assert(lockedCount(await bodyText()) === 15, 'кодекс не закрылся после сброса');
  ok('Ш6', 'сброс: старт — миссия 1, главы скрыты, хроника 15 ???');
} catch (e) { bad('Ш6', e.message); }

try { // ---------- Ш7: №1 — меню без Завода (прогресс 1 — открыть карточку) ----------
  await gotoProgress(1);
  await startCard(1);
  await openBuildMenu();
  const t = await bodyText();
  assert(/Турель/.test(t) && /Казарма/.test(t), 'меню стройки не открыто');
  assert(!/Завод/.test(t), '№1: Завод виден (UNLOCK_AT 2 > 1)');
  assert(!/Лаборатория/.test(t), '№1: Лаборатория видена');
  await shot('p8_menu_m1');
  ok('Ш7', '№1: стройка без Завода и Лаборатории');
} catch (e) { bad('Ш7', e.message); }

try { // ---------- Ш8: №3 — меню с Заводом (прогресс 3 — открыть карточку) ----------
  await gotoProgress(3);
  await startCard(3);
  await openBuildMenu();
  const t = await bodyText();
  assert(/Завод техники/.test(t), '№3: Завода нет (UNLOCK_AT 2 <= 3)');
  assert(!/Лаборатория/.test(t), '№3: Лаборатория видена (11 > 3)');
  await shot('p8_menu_m3');
  ok('Ш8', '№3: стройка с Заводом, лаба ещё закрыта');
} catch (e) { bad('Ш8', e.message); }

try { // ---------- Ш9: №16 — волны с первых минут ----------
  await gotoProgress(15);
  await startCard(15);
  const t0 = await bodyText();
  assert(/Собрано\s*\d+\s*\/\s*2500/.test(t0), 'HUD добычи 2500 не найден: ' + (t0.match(/Собрано[^\n]*/) || [''])[0]);
  // Волны ИИ требуют казарму (~30с игровой) — фаст-форвард тиками до ≥3 бойцов (волны t=42/82).
  const wave = await page.evaluate(() => {
    const g = window.game, st = g.state;
    const mil = () => st.units.filter((u) => u.side === 'enemy' && !u.dead && u.kind === 'unit' && u.type !== 'worker');
    for (let i = 0; i < 3600 && mil().length < 3; i += 60) for (let k = 0; k < 60; k++) g.tick();
    const cur = mil();
    return { n: cur.length, x: cur.length ? cur[0].x : 0, y: cur.length ? cur[0].y : 0, t: Math.round(st.time) };
  });
  assert(wave.n >= 2, 'враг не пошёл волнами: бойцов ' + wave.n);
  await camAt(wave.x, wave.y);
  await page.waitForTimeout(400);
  await shot('p8_m16_waves');
  ok('Ш9', `№16: HUD 2500, вражеских бойцов на ${wave.t}-й игровой секунде: ${wave.n}`);
} catch (e) { bad('Ш9', e.message); }

try { // ---------- Ш10: №17 — рой против роя, цветень = провал ----------
  await gotoProgress(17);
  await startCard(16);
  const mir = await page.evaluate(() => {
    const st = window.game.state;
    const depots = st.buildings.filter((b) => b.side === 'enemy' && b.type === 'depot' && !b.dead).length;
    const medics = st.units.filter((u) => u.side === 'player' && !u.dead && u.type === 'medic').length;
    return { enemyFaction: st.factions.enemy, depots, medics, base: st.map.bases.enemy.cc };
  });
  assert(mir.enemyFaction === 'alien', 'враг №17 не рой: ' + mir.enemyFaction);
  assert(mir.depots === 3, 'складов не 3: ' + mir.depots);
  assert(mir.medics === 2, 'цветней не 2: ' + mir.medics);
  await camToBuilding('enemy');
  await page.waitForTimeout(400);
  await shot('p8_m17_mirror');
  await page.evaluate(async () => {
    const U = await import('./js/units.js');
    const st = window.game.state;
    const m = st.units.find((u) => u.side === 'player' && !u.dead && u.type === 'medic');
    U.damageEntity(st, m, 1e9, null);
  });
  await page.waitForTimeout(900);
  const e1 = await endScreen();
  assert(e1.over === 'lose', 'гибель цветня не проиграла');
  assert(/Выводок пал/.test(e1.reason), 'нет «Выводок пал»: ' + e1.reason);
  assert(e1.epi.length === 0, 'эпилог показан на поражении');
  ok('Ш10', '№17: зеркало (enemy=alien), 3 склада, гибель цветня = «Выводок пал» без эпилога');
} catch (e) { bad('Ш10', e.message); }

try { // ---------- Ш11: №18 — фаза 2, evac на плато, меню без казармы ----------
  await gotoProgress(18);
  await startCard(17);
  await openBuildMenu();
  await page.waitForTimeout(350);
  let t = await bodyText();
  assert(!/Казарма/.test(t), '№18: Казарма в меню (banBuild)');
  assert(!/Завод/.test(t), '№18: Завод в меню (banBuild)');
  assert(/Турель/.test(t), '№18: меню не открыто');
  const dawnSet = await page.evaluate(() => {
    const g = window.game, st = g.state;
    const d = g.mission && g.mission.defense;
    if (!d) return false;
    st.buildMenu = false;
    st.time = d.prep + d.total - 1; // пересечь рассвет на следующем тике
    return true;
  });
  assert(dawnSet, 'нет defense-конфига у №18');
  await page.waitForTimeout(1200);
  t = await bodyText();
  assert(/Эвакуировано\s*0\s*\/\s*8/.test(t), 'нет счётчика фазы 2: ' + (t.match(/Эвакуировано[^\n]*/) || [''])[0]);
  assert(/Рассвело/.test(t), 'нет тоста фазы 2');
  await camAt(34 * 32, 14 * 32); // evac (34,14) r3
  await page.waitForTimeout(350);
  await shot('p8_m18_phase2');
  ok('Ш11', '№18: фаза 2 (тост+счётчик 0/8, evac на плато), меню без казармы/завода');
} catch (e) { bad('Ш11', e.message); }

try { // ---------- Ш12: №19 — HUD жёсткого дедлайна ----------
  await gotoProgress(19);
  await startCard(18);
  const t = await bodyText();
  const m = t.match(/Глушитель запел:\s*\d{1,2}:\d{2}/);
  assert(m, 'нет таймера дедлайна в HUD');
  const v = await camToBuilding('enemy');
  assert(v, '«Глушитель» (КЦ врага) не найден');
  await page.waitForTimeout(400);
  await shot('p8_m19_timer');
  ok('Ш12', `№19: HUD «${m[0]}», ромб над целью`);
} catch (e) { bad('Ш12', e.message); }

try { // ---------- Ш13: №19 — победа + эпилог ----------
  await page.evaluate(async () => {
    const U = await import('./js/units.js');
    const st = window.game.state;
    const cc = st.buildings.find((b) => b.side === 'enemy' && b.type === 'cc' && !b.dead);
    U.damageEntity(st, cc, 1e9, null);
  });
  await page.waitForTimeout(900);
  const e1 = await endScreen();
  assert(e1.over === 'win', 'снос «Глушителя» не победил');
  assert(/Война кончилась\. Но в песках ещё тикает/.test(e1.epi), 'эпилог №19 не тот: ' + e1.epi);
  await shot('p8_m19_win');
  ok('Ш13', '№19: победа + эпилог «Война кончилась. Но в песках ещё тикает.»');
} catch (e) { bad('Ш13', e.message); }

await browser.close();
console.log('---');
console.log('pageerror/console.error всего: ' + errors.length);
if (errors.length) { console.log(errors.join('\n')); process.exitCode = 1; }
else console.log('PAGEERRORS 0 — OK');
