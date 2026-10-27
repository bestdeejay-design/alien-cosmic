// zoom_buildings_repro.mjs — репро бага владельца (22.10, проверка пакета Q, пункт 3):
// «зумлю карту — исчезают строения, которые я строю / построил ИИ / хочу построить».
// Метод: iPhone-контекст (390×844, dpr3, hasTouch), Quick Battle, реальный недострой
// (placeBuildingCmd) + ghost (st.placing), канонический game.setZoom (якорь) +
// настоящий двухпальцевый щипок через CDP. Для каждого здания — пиксельный тест
// по серой палитре корпусов (рельеф марса оранжевый, корпуса серые) прямо с
// канваса + репликация клиллинга game.js (W/H vs vw/vh). Скриншоты каждой стадии.
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = 'http://localhost:8793';
const OUT = '/home/z/my-project/alien-cosmic/tool-results/zoom-buildings';
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(...a);
const warnings = [];

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 3,
  isMobile: true, hasTouch: true,
});
const page = await ctx.newPage();
page.on('pageerror', (e) => log('PAGEERROR:', e.message));
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error') log('CONSOLE ERR:', t);
  if (t.includes('draw-skip')) warnings.push(t);
});

await page.goto(BASE + '/index.html', { waitUntil: 'load' });
await page.evaluate(() => localStorage.setItem('terranrts.language', 'ru'));
await page.goto(BASE + '/index.html', { waitUntil: 'load' });
await page.waitForTimeout(600);
await page.locator('#btn-quick-primary').click();
await page.waitForTimeout(250);
await page.locator('#quick-faction-human').click();
await page.waitForTimeout(250);
await page.locator('#btn-quick-battle-start').click();
await page.waitForTimeout(1100);

// --- сцена: CC(done) + недострой-depot + ghost-barracks, камера на базу ---
await page.evaluate(async () => {
  const g = window.game, st = g.state;
  st.minerals.player = 5000;
  const Bm = await import('./js/buildings.js');
  const cc = st.buildings.find((b) => b.side === 'player' && b.type === 'cc' && !b.dead);
  const TILE = 32;
  // место под depot рядом с CC
  let spot = null;
  for (let d = 4; d < 12 && !spot; d++) {
    for (const [dx, dy] of [[d, 2], [-d, 2], [2, d], [2, -d], [d, d], [-d, -d]]) {
      const tx = cc.tx + dx, ty = cc.ty + dy;
      if (Bm.canPlace(st.map, tx, ty, 3, 2) && Bm.zoneAllows(st, tx, ty, 3, 2)) { spot = { tx, ty }; break; }
    }
  }
  if (!spot) throw new Error('нет места под depot');
  const depot = Bm.placeBuildingCmd(st, 'player', 'depot', spot.tx, spot.ty, []);
  if (!depot) throw new Error('placeBuildingCmd вернул null');
  // ghost barracks рядом
  let g2 = null;
  for (let d = 4; d < 12 && !g2; d++) {
    for (const [dx, dy] of [[-d, -2], [d, -2], [-2, d], [-2, -d], [d, -d], [-d, d]]) {
      const tx = cc.tx + dx, ty = cc.ty + dy;
      if (Bm.canPlace(st.map, tx, ty, 3, 3) && Bm.zoneAllows(st, tx, ty, 3, 3)) { g2 = { tx, ty }; break; }
    }
  }
  st.placing = { type: 'barracks', tx: g2.tx, ty: g2.ty };
  g.centerCamera((cc.tx + cc.w / 2) * TILE, (cc.ty + cc.h / 2) * TILE);
});
await page.waitForTimeout(500);

// --- пиксельный тест: каждое здание/ghost — видно ли его на канвасе ---
const probe = () => page.evaluate(() => {
  const g = window.game, st = g.state;
  const cv = document.getElementById('game-canvas');
  const ctx2 = cv.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const W = g.cssW, H = g.cssH;
  const cam = st.camera, z = cam.z || 1, vw = W / z, vh = H / z;
  const TILE = 32;
  const grey = (d) => Math.abs(d[0] - d[1]) < 26 && Math.abs(d[1] - d[2]) < 26 && d[0] > 25 && d[0] < 205;
  const rows = [];
  const check = (name, wx, wy, ww, wh, culledByGame) => {
    const x0 = (wx - cam.x) * z * dpr, y0 = (wy - cam.y) * z * dpr;
    const rw = ww * z * dpr, rh = wh * z * dpr;
    const ix0 = Math.max(0, x0 | 0), iy0 = Math.max(0, y0 | 0);
    const ix1 = Math.min(cv.width, (x0 + rw) | 0), iy1 = Math.min(cv.height, (y0 + rh) | 0);
    const iw = ix1 - ix0, ih = iy1 - iy0;
    const onScreenPct = (iw > 0 && ih > 0) ? (iw * ih) / (rw * rh) : 0;
    let px = -1;
    if (iw > 4 && ih > 4 && onScreenPct > 0.15) {
      const img = ctx2.getImageData(ix0, iy0, iw, ih).data;
      let n = 0;
      for (let i = 0; i < img.length; i += 16) { if (grey([img[i], img[i + 1], img[i + 2]])) n++; }
      px = n;
    }
    rows.push({ name, culledByGame, onScreenPct: +onScreenPct.toFixed(2), px });
  };
  for (const b of st.buildings) {
    if (b.dead || b.side !== 'player') continue;
    const bx = b.tx * TILE, by = b.ty * TILE, bw = b.w * TILE, bh = b.h * TILE;
    const culled = (bx > cam.x + W || by > cam.y + H || bx + bw < cam.x || by + bh < cam.y);
    check((b.done === false ? 'недострой:' : 'здание:') + b.type, bx, by, bw, bh, culled);
  }
  if (st.placing && st.placing.tx > -900) {
    const cfgTile = { barracks: [3, 3] }[st.placing.type] || [2, 2];
    const gx = st.placing.tx * TILE, gy = st.placing.ty * TILE;
    const culled = (gx > cam.x + W || gy > cam.y + H || gx + cfgTile[0] * TILE < cam.x || gy + cfgTile[1] * TILE < cam.y);
    check('ghost:' + st.placing.type, gx, gy, cfgTile[0] * TILE, cfgTile[1] * TILE, culled);
  }
  return { z, cam: { x: Math.round(cam.x), y: Math.round(cam.y) }, W, H, vw: Math.round(vw), vh: Math.round(vh), rows };
});

const report = async (tag, shot) => {
  const r = await probe();
  log(`\n=== ${tag} (z=${r.z}, cam=(${r.cam.x},${r.cam.y}), cssW=${r.W}, vw=${r.vw}) ===`);
  for (const row of r.rows) {
    const verdict = row.onScreenPct <= 0.15 ? 'вне экрана'
      : row.px > 30 ? 'ВИДНО'
      : row.px > 0 ? 'бледно' : '★ ИСЧЕЗ ★';
    log(` ${row.name.padEnd(20)} culled=${String(row.culledByGame).padEnd(5)} onScreen=${String(row.onScreenPct).padEnd(5)} px=${String(row.px).padEnd(6)} → ${verdict}`);
  }
  if (shot) await page.screenshot({ path: `${OUT}/${shot}.png` });
  return r;
};

// --- стадии ---
await report('S1: z=1.0 база', 'S1_z100');

await page.evaluate(() => window.game.setZoom(1.6));
await page.waitForTimeout(400);
await report('S2: setZoom(1.6) якорь-центр', 'S2_z160');

await page.evaluate(() => {
  const g = window.game, st = g.state, TILE = 32;
  const cc = st.buildings.find((b) => b.side === 'player' && b.type === 'cc' && !b.dead);
  g.setZoom(1.3, (cc.tx + cc.w / 2) * TILE - st.camera.x ? (cc.tx + cc.w / 2) * TILE : (cc.tx + cc.w / 2) * TILE,
            (cc.ty + cc.h / 2) * TILE);
});
await page.waitForTimeout(400);
await report('S3: setZoom(1.3) якорь=CC', 'S3_z130');

await page.evaluate(() => window.game.setZoom(0.7));
await page.waitForTimeout(400);
await report('S4: setZoom(0.7) отдаление', 'S4_z070');

// --- настоящий двухпальцевый щипок через CDP (путь жестов телефона) ---
await page.evaluate(() => window.game.setZoom(1));
await page.waitForTimeout(300);
const cdp = await ctx.newCDPSession(page);
const midY = 420;
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [
  { x: 135, y: midY, id: 1 }, { x: 255, y: midY, id: 2 }] });
for (let i = 1; i <= 6; i++) {
  const s = i / 6;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [
    { x: 135 - 60 * s, y: midY, id: 1 }, { x: 255 + 60 * s, y: midY, id: 2 }] });
  await page.waitForTimeout(60);
}
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await page.waitForTimeout(400);
await report('S5: реальный pinch (жестовый FSM)', 'S5_pinch');

log('\n=== draw-skip предупреждения ===');
log(warnings.length ? warnings.join('\n') : '(нет)');

// --- S6/S7: синтетический FSM-щипок (PointerEvents) — якорь и состояние ---
const fsmPinch = async (tag, midX) => {
  await page.evaluate(() => {
    const g = window.game, st = g.state, TILE = 32;
    g.setZoom(1);
    const cc = st.buildings.find((b) => b.side === 'player' && b.type === 'cc' && !b.dead);
    g.centerCamera((cc.tx + cc.w / 2) * TILE, (cc.ty + cc.h / 2) * TILE);
  });
  await page.waitForTimeout(300);
  const res = await page.evaluate(async ({ midX }) => {
    const g = window.game, st = g.state, cv = document.getElementById('game-canvas');
    const y = 420;
    const world0 = g.screenToWorld(midX, y);
    const cam0 = { ...st.camera };
    const state0 = { placing: !!st.placing, selLen: st.selection.length };
    const ev = (type, id, x, primary) => cv.dispatchEvent(new PointerEvent(type, {
      pointerId: id, pointerType: 'touch', isPrimary: primary, clientX: x, clientY: y,
      bubbles: true, cancelable: true, pointerTypeCheck: undefined,
    }));
    ev('pointerdown', 1, midX - 35, true);
    ev('pointerdown', 2, midX + 35, false);
    for (let i = 1; i <= 8; i++) {
      const s = i / 8;
      ev('pointermove', 1, midX - 35 - 65 * s, true);
      ev('pointermove', 2, midX + 35 + 65 * s, false);
      await new Promise((r) => setTimeout(r, 40));
    }
    ev('pointerup', 1, midX - 100, true);
    ev('pointerup', 2, midX + 100, false);
    await new Promise((r) => setTimeout(r, 300));
    const world1 = g.screenToWorld(midX, y);
    return {
      z: st.camera.z,
      camDelta: { x: Math.round(st.camera.x - cam0.x), y: Math.round(st.camera.y - cam0.y) },
      anchorErr: Math.round(Math.hypot(world1.x - world0.x, world1.y - world0.y)),
      anchorWorld0: { x: Math.round(world0.x), y: Math.round(world0.y) },
      state: { placing: !!st.placing, selLen: st.selection.length, state0 },
    };
  }, { midX });
  log(`\n=== ${tag} ===`);
  log(` z: 1 → ${res.z}; camDelta=(${res.camDelta.x},${res.camDelta.y}); anchorErr=${res.anchorErr}px мира (якорь мира ${res.anchorWorld0.x},${res.anchorWorld0.y})`);
  log(` состояние: placing ${res.state.state0.placing}→${res.state.placing}, selection ${res.state.state0.selLen}→${res.state.selLen}`);
  log(` вердикт: ${res.anchorErr <= 8 ? 'якорь держится' : '★ ПРЫЖОК КАМЕРЫ — «исчезнувшие здания» ★'}`);
  await page.screenshot({ path: `${OUT}/${tag.split(':')[0]}.png` });
};
await fsmPinch('S6: FSM-щипок центр базы', 195);
await fsmPinch('S7: FSM-щипок у края карты (якорь на базе)', 90);

// --- S8: ДОКАЗАТЕЛЬСТВО клиллинг-дефекта (z<1, правая половина экрана) ---
// Видимая ширина мира vw=W/z=780 при z=0.5, а клиллинг зданий режет по W=390:
// всё здание с bx ∈ (cam.x+W, cam.x+vw) на экране, но не рисуется.
await page.evaluate(async () => {
  const g = window.game, st = g.state, TILE = 32;
  const Bm = await import('./js/buildings.js');
  st.minerals.player = 9000;
  const cc = st.buildings.find((b) => b.side === 'player' && b.type === 'cc' && !b.dead);
  // два депо на одной широте: левое (bx=192 < 390) и правое (bx=448 ∈ (390, 780))
  const put = (tx, ty) => {
    for (let dy = 0; dy < 6; dy++) for (let dx = 0; dx < 6; dx++) {
      if (Bm.canPlace(st.map, tx + dx, ty + dy, 3, 2)) return Bm.placeBuildingCmd(st, 'player', 'depot', tx + dx, ty + dy, []);
    }
    return null;
  };
  window.__depotL = put(cc.tx + 8, cc.ty + 6);
  window.__depotR = put(cc.tx + 22, cc.ty + 6);
  st.camera.z = 0.5;
  st.camera.x = 0; st.camera.y = (cc.ty - 4) * TILE;
  g.clampCam();
});
await page.waitForTimeout(400);
const s8 = await page.evaluate(() => {
  const g = window.game, st = g.state, cv = document.getElementById('game-canvas');
  const ctx2 = cv.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const cam = st.camera, z = cam.z || 1, TILE = 32;
  const W = g.cssW, vw = W / z;
  const grey = (d) => Math.abs(d[0] - d[1]) < 26 && Math.abs(d[1] - d[2]) < 26 && d[0] > 25 && d[0] < 205;
  const probe1 = (b) => {
    const bx = b.tx * TILE, by = b.ty * TILE, bw = b.w * TILE, bh = b.h * TILE;
    const culled = bx > cam.x + W || by > cam.y + H2() || bx + bw < cam.x || by + bh < cam.y;
    function H2() { return g.cssH; }
    const x0 = Math.max(0, ((bx - cam.x) * z * dpr) | 0), y0 = Math.max(0, ((by - cam.y) * z * dpr) | 0);
    const x1 = Math.min(cv.width, ((bx - cam.x + bw) * z * dpr) | 0), y1 = Math.min(cv.height, ((by - cam.y + bh) * z * dpr) | 0);
    if (x1 - x0 < 4 || y1 - y0 < 4) return { culled, px: -1, sx: Math.round((bx - cam.x) * z) };
    const img = ctx2.getImageData(x0, y0, x1 - x0, y1 - y0).data;
    let n = 0;
    for (let i = 0; i < img.length; i += 16) { if (grey([img[i], img[i + 1], img[i + 2]])) n++; }
    return { culled, px: n, sx: Math.round((bx - cam.x) * z) };
  };
  return {
    z, camX: Math.round(cam.x), vw: Math.round(vw), W,
    L: probe1(window.__depotL), R: probe1(window.__depotR),
  };
});
log(`\n=== S8: клиллинг-дефект при z=${s8.z} (cam.x=${s8.camX}, W=${s8.W}, vw=${s8.vw}) ===`);
log(` левое депо:  screenX=${s8.L.sx}px, culled=${s8.L.culled}, px=${s8.L.px} → ${s8.L.px > 30 ? 'ВИДНО' : '★ ИСЧЕЗ ★'}`);
log(` правое депо: screenX=${s8.R.sx}px, culled=${s8.R.culled}, px=${s8.R.px} → ${s8.R.px > 30 ? 'ВИДНО' : '★ ИСЧЕЗ ★'}`);
log(` вердикт: ${(!s8.R.culled || s8.R.px > 30) ? 'дефект НЕ подтверждён' : '★ ДЕФЕКТ ДОКАЗАН: правая часть экрана теряет здания при отдалении ★'}`);
await page.screenshot({ path: `${OUT}/S8_cull_z050.png` });

await browser.close();
log('\nАртефакты: ' + OUT);
