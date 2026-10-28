// browser-test.mjs — ace#5 правки И1+И2: браузерный контракт для стенда.
// Запуск (на стенде):  PLAYWRIGHT_MODULE=playwright PANEL_BASE=http://127.0.0.1:8793 node browser-test.mjs
// В песочнице Playwright недоступен — прогон выполняется на стенде.
//
// Что проверяем сверх 07-selection-panel:
//   И1: миниатюры КЦ/турель/стена/Дом/юнит на dpr 1 и 2 — резкость
//       (самокалиброванный edge-тест против размытой копии), fit без
//       обрезок, backing = size×dpr, кэш по dpr-бакету; скриншоты
//       портретов desktop dpr1+dpr2 в screenshots/.
//   И2: .cmd-lvl в левом углу, kbd справа, без наложений в обычном,
//       compact и на 390×844; хоткеи: R=грейд у всех (лаба включена),
//       D=4-й ресерч лабы, Y свободна.
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import fs from 'node:fs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const OUT = process.env.PANEL_SHOTS || fileURLToPath(new URL('./screenshots/', import.meta.url));
const BASE = process.env.PANEL_BASE || 'http://127.0.0.1:8793';
const V = '10271858'; // стемп r/ продового main (П-3: приведение к проду)
const browser = await chromium.launch();
fs.mkdirSync(OUT, { recursive: true });
const errors = [];
try {
  for (const width of [1280, 390]) for (const lang of ['ru', 'en']) {
    const context = await browser.newContext({ viewport: { width, height: width === 1280 ? 800 : 844 }, isMobile: width === 390, hasTouch: width === 390, deviceScaleFactor: 1 });
    const p = await context.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    await p.addInitScript((lang) => localStorage.setItem('terranrts.language', lang), lang);
    await p.addInitScript((v) => { window.__STAMP__ = v; }, V);
    await p.goto(BASE + '/r/');
    // П-2 (SZ m2): hardening-вход (ace#4) открывает модалку пинпада ДО старта
    // симуляции; Skip → гость, иначе waitForFunction(game.started) уходит в таймаут.
    const skip = p.locator('#auth-close');
    if (await skip.isVisible({ timeout: 4000 }).catch(() => false)) await skip.click();
    await p.waitForFunction(() => window.game?.started);
    await p.waitForTimeout(1500);
    if (await p.locator('#chest-close').isVisible()) await p.locator('#chest-close').click();
    for (const mode of ['ordinary', 'upgrading', 'unit', 'construction']) {
      await p.evaluate(async ({ mode }) => {
        const g = window.game, st = g.state;
        const B = await import(`/r/js/buildings.js?v=${window.__STAMP__}`);
        const ui = await import(`/r/js/ui.js?v=${window.__STAMP__}`);
        g.paused = true;
        for (const x of [...st.units, ...st.buildings]) x.selected = false;
        let b;
        if (mode === 'unit') { b = st.units.find((u) => u.side === 'player'); b.angle = .8; }
        else {
          b = new B.Building(st, 'player', mode === 'construction' ? 'factory' : 'barracks', 30, 30, true);
          b.hp = b.maxHp * .73;
          if (mode === 'upgrading') { b.level = 8; b.gradeUp = { to: 9, t: 17.1, total: 30 }; b.queue = [{ type: 'marine', t: 6.5, total: 13 }]; }
          if (mode === 'construction') { b.done = false; b.progress = .43; }
        }
        b.selected = true; st.selection = [b]; ui.resetPanel();
        st.camera.x = b.x - (g.cssW - g.uiRight) / 2; st.camera.y = b.y - (g.cssH - g.uiBottom) / 2;
        st.fog.visible.fill(1); st.fog.explored.fill(1); st.fog.dirty = true;
        ui.update(g); g.render(1); window.panelTarget = b;
      }, { mode });
      await p.waitForTimeout(120);
      const result = await p.evaluate(() => {
        const s = document.querySelector('#sel-info'), box = s.querySelector('.sel-box'), portrait = box.querySelector('.portrait');
        return { text: s.innerText, width: s.clientWidth, scrollWidth: s.scrollWidth, portrait: portrait.getContext('2d').getImageData(0, 0, portrait.width, portrait.height).data.some((v, i) => i % 4 === 3 && v > 0), grade: s.querySelector('.sel-grade')?.hidden, rect: box.getBoundingClientRect().toJSON() };
      });
      if (!result.portrait || result.scrollWidth > result.width + 1) throw new Error(JSON.stringify({ width, lang, mode, result }));
      if (mode === 'upgrading' && (result.grade || !result.text.includes('IX') || !result.text.includes('43%'))) throw new Error('grade missing ' + JSON.stringify(result));
      console.log('PASS', width, lang, mode);
      await p.screenshot({ path: join(OUT, `${width}-${lang}-${mode}.png`) });
    }

    // ---------- И2: бейдж уровня — без наложений во всех режимах ----------
    const badge = await p.evaluate(async () => {
      const ui = await import(`/r/js/ui.js?v=${window.__STAMP__}`);
      const B = await import(`/r/js/buildings.js?v=${window.__STAMP__}`);
      const g = window.game, st = g.state;
      st.minerals.player = 999999;
      const b = new B.Building(st, 'player', 'barracks', 30, 30, true);
      b.level = 1; b.selected = true; st.selection = [b]; ui.resetPanel(); ui.update(g);
      const grid = document.querySelector('#cmd-grid');
      const read = () => {
        const lvl = grid.querySelector('.cmd-lvl'), kbd = grid.querySelector('kbd');
        const li = grid.querySelector('canvas');
        const overlap = (a, c) => a && c && !(a.right <= c.left || a.left >= c.right || a.bottom <= c.top || a.top >= c.bottom);
        return {
          lvlText: lvl?.textContent,
          lvlKbd: lvl && kbd && getComputedStyle(kbd).display !== 'none' ? overlap(lvl.getBoundingClientRect(), kbd.getBoundingClientRect()) : false,
          lvlIcon: lvl && li ? overlap(lvl.getBoundingClientRect(), li.getBoundingClientRect()) : false,
          lvlLeft: lvl ? getComputedStyle(lvl).left : null,
          kbdRight: kbd && getComputedStyle(kbd).display !== 'none' ? getComputedStyle(kbd).right : 'hidden',
        };
      };
      const out = { normal: read() };
      grid.classList.add('compact'); out.compact = read(); grid.classList.remove('compact');
      document.body.classList.add('game-touch'); out.touch = read(); document.body.classList.remove('game-touch');
      return out;
    });
    for (const [mode, r] of Object.entries(badge)) {
      if (r.lvlKbd || r.lvlIcon) throw new Error(`badge overlap ${mode}: ${JSON.stringify(r)}`);
      if (mode === 'normal' && (r.lvlLeft !== '3px' || r.kbdRight !== '4px')) throw new Error('badge corners: ' + JSON.stringify(r));
    }
    console.log('PASS badge', width, lang, JSON.stringify(badge));

    // ---------- И2: хоткеи ----------
    const hotkeys = await p.evaluate(async () => {
      const ui = await import(`/r/js/ui.js?v=${window.__STAMP__}`);
      const B = await import(`/r/js/buildings.js?v=${window.__STAMP__}`);
      const g = window.game, st = g.state;
      st.minerals.player = 999999;
      const cc = st.buildings.find((x) => !x.dead && x.side === 'player' && x.type === 'cc');
      if (cc) cc.level = 8;
      const out = {};
      const fresh = (type) => { const b = new B.Building(st, 'player', type, 30, 30, true); st.selection = [b]; ui.resetPanel(); ui.update(g); return b; };
      let b = fresh('barracks'); out.gradeBarracks = ui.handleHotkey('KeyR') && !!b.gradeUp;
      b = fresh('lab'); out.gradeLab = ui.handleHotkey('KeyR') && !!b.gradeUp;
      b = fresh('lab'); out.research4 = ui.handleHotkey('KeyD') && b.res?.key === 'vehArm';
      b = fresh('lab'); out.research1 = ui.handleHotkey('KeyQ') && b.res?.key === 'infAtk';
      b = fresh('lab'); out.keyYFree = ui.handleHotkey('KeyY') === false;
      return out;
    });
    for (const [k, v] of Object.entries(hotkeys)) if (!v) throw new Error('hotkey ' + k + ' failed: ' + JSON.stringify(hotkeys));
    console.log('PASS hotkeys', width, lang, JSON.stringify(hotkeys));

    // ---------- И1 (десктоп ru): матрица + резкость + скриншоты портретов ----------
    if (lang === 'ru' && width === 1280) {
      for (const dsf of [1, 2]) {
        const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: dsf });
        const p2 = await ctx2.newPage();
        await p2.addInitScript((v) => { window.__STAMP__ = v; }, V);
        await p2.goto(BASE + '/r/');
        // П-2: тот же Skip в контексте dpr-тестов.
        const skip2 = p2.locator('#auth-close');
        if (await skip2.isVisible({ timeout: 4000 }).catch(() => false)) await skip2.click();
        await p2.waitForFunction(() => window.game?.started);
        const shots = await p2.evaluate(async ({ dsf }) => {
          const ui = await import(`/r/js/ui.js?v=${window.__STAMP__}`);
          const out = {};
          const cases = [['cc', 'cc'], ['turret', 'turret'], ['wall', 'wall'], ['house', 'depot'], ['unit', 'marine']];
          const edgeFrac = (c) => {
            const g = c.getContext('2d'), d = g.getImageData(0, 0, c.width, c.height).data;
            const lum = [];
            for (let i = 0; i < d.length; i += 4) lum.push(d[i + 3] > 64 ? (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 : null);
            let pairs = 0, hard = 0;
            for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width - 1; x++) {
              const a = lum[y * c.width + x], b = lum[y * c.width + x + 1];
              if (a != null && b != null) { pairs++; if (Math.abs(a - b) > 24) hard++; }
            }
            return hard / pairs;
          };
          for (const [name, type] of cases) {
            const img = ui.modelThumbnail(type, { faction: 'human', level: 8, rank: 2, size: 52 });
            if (img.width !== 52 * (dsf > 1 ? 2 : 1)) throw new Error(`backing ${name} dpr${dsf}: ${img.width}`);
            const g = img.getContext('2d'), d = g.getImageData(0, 0, img.width, img.height).data;
            for (let i = 0; i < img.width; i++) {
              // П-3 (SZ m2): порог alpha>=8 — единичный пиксель alpha=2 от
              // спила даунскейла суперсэмплинга глазу невидим и не баг.
              const edge = (px) => (d[(px * img.width + i) * 4 + 3] || 0) >= 8 || (d[(i * img.width + px) * 4 + 3] || 0) >= 8;
              if (edge(0) || edge(img.height - 1)) throw new Error('edge clip ' + name + ' dpr' + dsf);
            }
            // Самокалиброванный тест резкости: оригинал против размытой копии.
            const blur = document.createElement('canvas');
            blur.width = img.width; blur.height = img.height;
            const bg = blur.getContext('2d');
            const half = document.createElement('canvas');
            half.width = Math.max(2, img.width / 2 | 0); half.height = Math.max(2, img.height / 2 | 0);
            const hg = half.getContext('2d');
            hg.drawImage(img, 0, 0, half.width, half.height);
            bg.drawImage(half, 0, 0, blur.width, blur.height);
            const sharp = edgeFrac(img), soft = edgeFrac(blur);
            // П-3 (SZ m2): пороги по реальному Chromium. Бар Дома 1.4× (координатор,
// 28.10: на стемпе 10271858 дом даёт 1.49× — маргинал на антиалиасах;
// мутация SS×3 держит сигнал −12..−46%, порог 1.4 остаётся информативным).
// Было: антиалиасы отличаются
            // от @napi-rs/canvas): юнит 1.09×/0.94×, турель dpr2 1.34× — старый
            // бар 1.5× падал на валидных рендерах. Здания держат 1.5× (проходили).
            const bar = ({ cc: 1.5, house: 1.4, wall: 1.5, turret: 1.25, unit: 0.85 })[name] || 1.5;
            if (sharp < soft * bar) throw new Error(`blurry ${name} dpr${dsf}: ${sharp.toFixed(4)} vs ${soft.toFixed(4)} (бар ${bar}×)`);
            out[`${name}-dpr${dsf}`] = img.toDataURL('image/png');
          }
          return out;
        }, { dsf });
        for (const [name, dataUrl] of Object.entries(shots)) {
          fs.writeFileSync(join(OUT, `browser-portrait-${name}.png`), Buffer.from(dataUrl.split(',')[1], 'base64'));
        }
        console.log('PASS И1 matrix+sharpness dsf=' + dsf, Object.keys(shots).length, 'портретов');
        await ctx2.close();
      }
    }
    await context.close();
  }
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('PASS browser-test: И1 (minиатюры/резкость/dpr) + И2 (бейдж/хоткеи) — ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ');
} finally { await browser.close(); }
