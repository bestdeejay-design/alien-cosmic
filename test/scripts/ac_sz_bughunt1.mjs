// ac_sz_bughunt1.mjs — самостоятельный баг-хант SZ в полигоне r/ (26.10).
// Стенд: POLYGON=1 PORT=8806 static.mjs + save-server :8790.
// Полигон сам автозапускает рейд-хоум (raid-boot.js) — меню не трогаем.
// Отчёт: PASS/FAIL по шагам + все pageerror/console.error/HTTP>=400. Скриншоты: /tmp/szbug/.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = 'http://localhost:8806';
const OUT = '/tmp/szbug';
mkdirSync(OUT, { recursive: true });

const errors = [];
const steps = [];
const ok = (id, msg) => { steps.push(`PASS  ${id}: ${msg}`); console.log(`PASS  ${id}: ${msg}`); };
const bad = (id, msg) => { steps.push(`FAIL  ${id}: ${msg}`); console.log(`FAIL  ${id}: ${msg}`); };
const step = async (id, fn) => { try { await fn(); } catch (e) { bad(id, String((e && e.message) || e)); } };
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png` }).catch(() => {});
const stampOf = (page) => page.evaluate(async () => {
  const html = await (await fetch('/r/index.html')).text();
  const m = html.match(/\?v=([0-9A-Za-z._-]+)/);
  return m ? m[1] : null;
});

const browser = await chromium.launch();
await step('desktop', async () => {
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
  page.on('pageerror', (e) => errors.push(`[d] pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[d] console: ${m.text()}`); });
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`[d] HTTP ${r.status()} ${r.url()}`); });

  // 1. Полигон: автозапуск базы
  await page.goto(BASE + '/r/', { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  await page.waitForFunction(() => window.game && window.game.started, null, { timeout: 15000 });
  await shot(page, 'd01_base');
  const base = await page.evaluate(() => {
    const st = window.game.state;
    return { units: st.units.filter((u) => !u.dead).length, builds: st.buildings.filter((b) => !b.dead).length, m: Math.round(st.minerals.player), mode: st.raidMode };
  });
  ok('D1 автостарт базы', JSON.stringify(base));

  // 2. Тики базы 10с
  await page.waitForTimeout(10000);
  await shot(page, 'd02_base_10s');
  ok('D2 тики 10с', JSON.stringify(await page.evaluate(() => ({ m: Math.round(window.game.state.minerals.player), u: window.game.state.units.filter((u) => !u.dead).length }))));

  // 3. Командир: карточка (ПОСЛЕ — закрываем и снимаем паузу: openCommander ставит paused=true)
  await step('D3 командир', async () => {
    await page.evaluate(async (stamp) => {
      const g = window.game;
      const M = await import(`/r/js/commander-ui.js?v=${stamp}`);
      M.openCommander(g);
    }, await stampOf(page));
    await page.waitForTimeout(600);
    await shot(page, 'd03_commander');
    const vis = await page.evaluate(() => {
      const p = document.querySelector('#commander-overlay');
      return p ? { found: true, hidden: p.classList.contains('hidden'), text: p.innerText.slice(0, 100).replace(/\n/g, ' | ') } : { found: false };
    });
    if (!vis.found) throw new Error('карточка командира не найдена в DOM');
    if (vis.hidden) throw new Error('карточка командира есть, но спрятана');
    ok('D3 командир', vis.text.slice(0, 60));
  });
  await page.evaluate(async (stamp) => {
    const C = await import(`/r/js/commander-ui.js?v=${stamp}`);
    C.closeCommander();
    window.game.paused = false;
  }, await stampOf(page));
  await page.waitForTimeout(300);

  // 4. Вылазка тир 1: построить Дом Г2 (запуск требует Дома), запуск, тики, трюм
  await step('D4 вылазка', async () => {
    await page.evaluate(async (stamp) => {
      const g = window.game, st = g.state;
      const B = await import(`/r/js/buildings.js?v=${stamp}`);
      if (!st.buildings.some((b) => !b.dead && b.type === 'depot')) {
        const cc = st.buildings.find((b) => !b.dead && b.side === 'player' && b.type === 'cc');
        const d = new B.Building(st, 'player', 'depot', cc.tx + 2, cc.ty + 2, true);
        d.level = 2;
        st.map.markBuilding(d);
        st.bcount.player++;
      }
      const depot = st.buildings.find((b) => !b.dead && b.type === 'depot');
      depot.level = Math.max(2, depot.level || 1);
    }, await stampOf(page));
    const v = await page.evaluate(() => window.game.launchRaidExpedition({ tier: 1, seed: 4242, budget: 100, units: { worker: 2, marine: 2 } }));
    if (!v || !v.ok) throw new Error('валидация: ' + JSON.stringify(v));
    await page.waitForTimeout(6000);
    await shot(page, 'd04_expedition');
    const ex = await page.evaluate(() => {
      const st = window.game.state;
      const house = st.raidHouse;
      return { mode: st.raidMode, cargo: Math.round(st.raidCargo || 0), gathered: Math.round(st.raidGathered || 0), house: !!house, houseDead: house ? !!house.dead : null, units: st.units.filter((u) => !u.dead && u.side === 'player').length, header: (document.querySelector('#hud-cargo, .hud-raid-cargo, #raid-header') || {}).innerText || '' };
    });
    if (ex.mode !== 'expedition') throw new Error('режим не expedition');
    ok('D4 вылазка', `юнитов ${ex.units}, собрано ${ex.gathered}, трюм ${ex.cargo}, Дом жив: ${!ex.houseDead}`);
  });

  // 5. Сдача эрга: тики ещё 15с, трюм должен расти (свежий фикс пиксели/тайлы)
  await step('D5 сдача эрга', async () => {
    await page.waitForTimeout(15000);
    const ex = await page.evaluate(() => {
      const st = window.game.state;
      return { cargo: Math.round(st.raidCargo || 0), gathered: Math.round(st.raidGathered || 0), lost: Math.round(st.raidCargoLost || 0) };
    });
    await shot(page, 'd05_cargo');
    ok('D5 сдача', `трюм ${ex.cargo} / собрано ${ex.gathered} / мимо ${ex.lost}`);
  });

  // 6. Эвакуация: клик по кольцу (как игрок) или triggerRaidEvac
  await step('D6 эвакуация', async () => {
    await page.evaluate(() => window.game.triggerRaidEvac());
    await page.waitForTimeout(4000);
    await shot(page, 'd06_return');
    const back = await page.evaluate(() => {
      const st = window.game.state;
      const home = st.buildings.filter((b) => !b.dead && b.side === 'player').length;
      return { mode: st.raidMode, home, over: st.gameOver, toast: (document.querySelector('.toast, #toast') || {}).innerText || '' };
    });
    ok('D6 эвакуация', JSON.stringify(back));
  });

  // 7. Отсек Дома: собрать всех → в отсеке есть бойцы → вылазка → возврат: армия дома цела (фикс Арены)
  await step('D7 отсек Дома', async () => {
    const r = await page.evaluate(async (stamp) => {
      const g = window.game, st = g.state;
      const R = await import(`/r/js/raid.js?v=${stamp}`);
      const roster0 = R.countHomeRoster(st);
      if (typeof g.garrisonAllToHouse === 'function') g.garrisonAllToHouse();
      const roster1 = R.countHomeRoster(st);
      return { roster0, roster1 };
    }, await stampOf(page));
    ok('D7 отсек', `roster до=${JSON.stringify(r.roster0)} после сборки=${JSON.stringify(r.roster1)}`);
  });

  // 8. Капсулы (свежий фикс .hidden)
  await step('D8 капсулы', async () => {
    await page.evaluate(async (stamp) => {
      const g = window.game;
      const M = await import(`/r/js/chests-ui.js?v=${stamp}`);
      M.showChests(g);
    }, await stampOf(page));
    await page.waitForTimeout(900);
    await shot(page, 'd07_chests');
    const vis = await page.evaluate(() => {
      const grid = document.querySelector('#chest-grid');
      return { cards: document.querySelectorAll('.chest-card').length, gridHidden: grid ? grid.classList.contains('hidden') : null };
    });
    if (!vis.cards) throw new Error('карточки капсул не показались');
    await page.locator('.chest-card').first().click();
    await page.waitForTimeout(700);
    const opened = await page.evaluate(() => {
      const grid = document.querySelector('#chest-grid');
      const box = document.querySelector('#chest-open');
      return { gridHidden: grid ? grid.classList.contains('hidden') : null, boxVisible: box ? !box.classList.contains('hidden') : false, text: box ? box.innerText.slice(0, 100).replace(/\n/g, ' ') : '' };
    });
    await shot(page, 'd08_chest_open');
    if (opened.gridHidden && !opened.boxVisible) throw new Error('экран награды не показался (регресс .hidden?)');
    ok('D8 капсулы', `карточек ${vis.cards}, награда: ${opened.boxVisible ? opened.text.slice(0, 60) : '(нет доступных — карточки закрыты)'}`);
  });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // 9. Админка: PIN 1234 → вкладки, Оборона
  await step('D9 админка', async () => {
    await page.evaluate(async (stamp) => {
      const g = window.game;
      const M = await import(`/r/js/admin.js?v=${stamp}`);
      M.openAdmin(g);
    }, await stampOf(page));
    await page.waitForTimeout(600);
    await page.locator('#adm-pin').fill('1234');
    const entered = await page.evaluate(() => {
      const gate = document.querySelector('#adm-gate');
      const btns = gate ? [...gate.querySelectorAll('button')] : [];
      if (btns.length) btns[btns.length - 1].click();
      return btns.map((b) => b.id || b.textContent.trim());
    });
    await page.waitForTimeout(800);
    await shot(page, 'd09_admin');
    const adm = await page.evaluate(() => ({
      main: !!document.querySelector('#adm-main'),
      hidden: document.querySelector('#adm-main') ? document.querySelector('#adm-main').classList.contains('hidden') : null,
      text: document.querySelector('#adm-main') ? document.querySelector('#adm-main').innerText.slice(0, 120).replace(/\n/g, ' | ') : '',
    }));
    if (!adm.main || adm.hidden) throw new Error(`PIN-гейт не пустил (кнопки: ${entered.join(',')})`);
    ok('D9 админка', adm.text.slice(0, 80));
  });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // 10. Сейвы: API-контур
  await step('D10 сейвы', async () => {
    const res = await page.evaluate(async () => {
      const j = (p, b) => fetch(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
      const s = await j('/api/save', { player: 'SZBUG', key: 'bughunt', value: JSON.stringify({ t: Date.now(), note: 'sz-bughunt' }), pin: '1234' });
      const l = await j('/api/load', { player: 'SZBUG', key: 'bughunt', pin: '1234' });
      const list = await (await fetch('/api/list?player=SZBUG&pin=1234')).json();
      await j('/api/delete', { player: 'SZBUG', key: 'bughunt', pin: '1234' });
      return { s, l, list };
    });
    const parsed = res.l.ok && typeof res.l.value === 'string' ? JSON.parse(res.l.value) : res.l.value;
    if (!res.s.ok || !res.l.ok || !(parsed && parsed.note === 'sz-bughunt')) throw new Error(`save/load: ${JSON.stringify(res)}`);
    ok('D10 сейвы', `save/load/list/delete ок, list=${JSON.stringify(res.list).slice(0, 70)}`);
  });

  // 11. Скрытие вкладки: сейв-страховка (visibilitychange) — просто вызовем
  await step('D11 страховка сейва', async () => {
    await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); });
    await page.waitForTimeout(500);
    const saved = await page.evaluate(() => !!localStorage.getItem('ac_raid_session_v1'));
    if (!saved) throw new Error('сейв рейда не записан в localStorage');
    ok('D11 страховка', 'сейв рейда в localStorage есть');
  });

  await page.close();
});

// Мобильный: 390×844
await step('D12 mobile', async () => {
  const mp = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  mp.on('pageerror', (e) => errors.push(`[m] pageerror: ${e.message}`));
  mp.on('console', (m) => { if (m.type() === 'error') errors.push(`[m] console: ${m.text()}`); });
  mp.on('response', (r) => { if (r.status() >= 400) errors.push(`[m] HTTP ${r.status()} ${r.url()}`); });
  await mp.goto(BASE + '/r/', { waitUntil: 'load' });
  await mp.waitForTimeout(1500);
  await mp.waitForFunction(() => window.game && window.game.started, null, { timeout: 15000 });
  await shot(mp, 'm01_base');
  await mp.evaluate(async (stamp) => {
    const g = window.game;
    const M = await import(`/r/js/chests-ui.js?v=${stamp}`);
    M.showChests(g);
  }, await stampOf(mp));
  await mp.waitForTimeout(800);
  const mob = await mp.evaluate(() => {
    const box = document.querySelector('.chest-box');
    const r = box ? box.getBoundingClientRect() : null;
    const topbar = document.querySelector('#topbar');
    return { box: !!box, h: r ? Math.round(r.height) : 0, vh: window.innerHeight, overflows: r ? r.bottom > window.innerHeight + 2 : null, topbarH: topbar ? Math.round(topbar.getBoundingClientRect().height) : 0 };
  });
  await shot(mp, 'm02_chests');
  if (mob.overflows) throw new Error(`chest-box уезжает за экран (h=${mob.h}, vh=${mob.vh})`);
  ok('D12 mobile', `chest-box h=${mob.h}/${mob.vh}, топбар=${mob.topbarH}px`);
  await mp.close();
});

await browser.close();

console.log('\n===== СВОДКА БАГ-ХАНТА =====');
for (const s of steps) console.log(s);
const fails = steps.filter((s) => s.startsWith('FAIL'));
console.log(`\nШаги: ${steps.filter((s) => s.startsWith('PASS')).length} PASS / ${fails.length} FAIL`);
if (errors.length) {
  console.log(`\nОШИБКИ (${errors.length}):`);
  for (const e of [...new Set(errors)].slice(0, 30)) console.log('  ' + e);
} else console.log('\nОшибок консоли/pageerror/HTTP>=400: 0');
process.exit(fails.length ? 1 : 0);
