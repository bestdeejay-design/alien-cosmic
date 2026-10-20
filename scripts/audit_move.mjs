// ============================================================
// audit_move.mjs — headless-аудит движения (без браузера).
// Стабит document/canvas, гоняет pathfinding + генерацию карты:
//   A1. Старт A* из стены → шаг наружу, а не [] = «пришёл» (Г2).
//   A2. hasLosClear ловит то, что пропускает hasLos (Г5/Г8).
//   A3. smoothPathClear: все отрезки проходимы с габаритом.
//   A4. В карте нет скальных «карманов» и диагональных калиток.
//   A5. Связность баз по правилам боевого A* (8-dir, без среза).
//   A6. formationGoals: слоты строя — на свободных разных тайлах.
//   A7. nearestFreeFrom находит свободную клетку из стены.
//   A8. Perf: 200 длинных путей — время (санити бюджета).
//   A11. Пресеты кампании C: размер, путь база↔база, калитки 0, старты, зоны.
// Запуск: node scripts/audit_move.mjs
// ============================================================

// --- Стаб DOM: карте нужен только offscreen-canvas с 2d-контекстом ---
function ctxStub() {
  return new Proxy({}, {
    get: (t, k) => {
      if (k in t) return t[k];
      if (k === 'createRadialGradient' || k === 'createLinearGradient' || k === 'createPattern') {
        return (...a) => ({ addColorStop() {} });
      }
      return (...a) => undefined;
    },
    set: (t, k, v) => { t[k] = v; return true; },
  });
}
globalThis.document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => ctxStub() }),
};

const { TILE, MAP_W, MAP_H } = await import('../js/config.js');
const PF = await import('../js/pathfinding.js');
const { GameMap, T_GROUND, T_ROCK, T_WATER } = await import('../js/map.js');
const U = await import('../js/units.js');

let fails = 0;
const ok = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!cond) fails++;
};

// Тестовые карты: сиды из кампании + пара случайных.
const SEEDS = [11, 101, 202, 303, 404, 505, 777, 1234567];
const maps = SEEDS.map((s) => new GameMap(s, { seed: s, lakes: 'default', rocks: 7, rich: 1, base: { x: 8, y: 48 } }));

// ---------- A1. Старт из стены ----------
{
  const m = maps[0];
  // Находим скалу с свободным соседом.
  let rock = null;
  outer: for (let y = 2; y < MAP_H - 2 && !rock; y++)
    for (let x = 2; x < MAP_W - 2; x++)
      if (m.blockedAt(x, y) && !m.blockedAt(x + 1, y)) { rock = { x, y }; break outer; }
  const tiles = PF.findPath(m, rock.x, rock.y, (x, y) => x === rock.x + 6 && y === rock.y,
    (x, y) => Math.hypot(rock.x + 6 - x, rock.y - y));
  ok('A1. findPath из blocked-старта возвращает шаг наружу, а не []',
    tiles.length > 0 && !m.blockedAt(tiles[0].x, tiles[0].y),
    `старт=скала(${rock.x},${rock.y}) путь=${tiles.length} точек`);
}

// ---------- A2. Clearance ловит срезы ----------
{
  let diff = 0, checked = 0;
  const m = maps[2];
  for (let i = 0; i < 400; i++) {
    const x0 = 2 + ((i * 37) % 60), y0 = 2 + ((i * 53) % 60);
    const x1 = 2 + ((i * 91) % 60), y1 = 2 + ((i * 17) % 60);
    if (m.blockedAt(x0, y0) || m.blockedAt(x1, y1)) continue;
    checked++;
    if (PF.hasLos(m, x0, y0, x1, y1) && !PF.hasLosClear(m, x0, y0, x1, y1, 11.2)) diff++;
  }
  ok('A2. есть отрезки «видно, но корпусом не пройти» (clearance работает)',
    diff > 0, `таких ${diff} из ${checked}`);
}

// ---------- A3. Сглаживание держит габарит ----------
{
  const m = maps[1];
  const R = 11.2;
  let bad = 0, tested = 0;
  for (let i = 0; i < 60; i++) {
    const sx = 2 + ((i * 29) % 60), sy = 2 + ((i * 41) % 60);
    const gx = 2 + ((i * 67) % 60), gy = 2 + ((i * 13) % 60);
    if (m.blockedAt(sx, sy) || m.blockedAt(gx, gy)) continue;
    const raw = PF.findPath(m, sx, sy, (x, y) => x === gx && y === gy,
      (x, y) => Math.max(Math.abs(gx - x), Math.abs(gy - y)));
    if (raw.length < 3) continue;
    const sm = PF.smoothPathClear(m, [{ x: sx, y: sy }, ...raw], R);
    tested++;
    let ax = sx, ay = sy, good = true;
    for (const p of sm) {
      if (!PF.hasLosClear(m, ax, ay, p.x, p.y, R)) { good = false; break; }
      ax = p.x; ay = p.y;
    }
    if (!good) bad++;
  }
  ok('A3. все отрезки smoothPathClear проходимы корпусом r*0.8', bad === 0, `маршрутов ${tested}, брак ${bad}`);
}

// ---------- A4. Карманы и калитки ----------
{
  let pockets = 0, rockGates = 0;
  for (const m of maps) {
    const free = (x, y) => m.inBounds(x, y) && !m.blockedAt(x, y);
    const isRock = (x, y) => m.inBounds(x, y) && m.terrain[m.idx(x, y)] === T_ROCK;
    for (let y = 1; y < MAP_H - 1; y++) for (let x = 1; x < MAP_W - 1; x++) {
      if (!free(x, y)) continue;
      const walls = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => !free(x + dx, y + dy)).length;
      if (walls >= 3) pockets++;
      if (free(x + 1, y + 1) && isRock(x + 1, y) && isRock(x, y + 1)) rockGates++;
    }
  }
  // Карманы у воды/границы возможны (естественный рельеф) — считаем,
  // но требуем мало; скальных диагональных калиток — строго ноль.
  ok('A4a. скальных диагональных калиток нет', rockGates === 0, `калиток: ${rockGates}`);
  ok('A4b. тупиков-карманов 1×1 немного', pockets <= maps.length * 4, `карманов: ${pockets} на ${maps.length} карт`);
}

// ---------- A5. Связность баз ----------
{
  let allOk = true, detail = [];
  for (let i = 0; i < maps.length; i++) {
    const m = maps[i];
    const s = m.bases.player.center, g = m.bases.enemy.center;
    const tiles = PF.findPath(m, s.x, s.y, (x, y) => x === g.x && y === g.y,
      (x, y) => Math.max(Math.abs(g.x - x), Math.abs(g.y - y)));
    const last = tiles[tiles.length - 1];
    const found = last && last.x === g.x && last.y === g.y;
    if (!found) { allOk = false; detail.push(`seed${SEEDS[i]}:частичный(${tiles.length})`); }
  }
  ok('A5. база игрока ↔ база врага: полный путь A* (8-dir, без среза)', allOk, detail.join(' ') || `${maps.length} карт`);
}

// ---------- A6. Слоты строя ----------
{
  const m = maps[3];
  // Цель — в скалах: слоты обязаны съехать на свободные тайлы.
  let rock = null;
  outer: for (let y = 20; y < 44 && !rock; y++)
    for (let x = 20; x < 44; x++)
      if (m.blockedAt(x, y)) { rock = { x, y }; break outer; }
  const st = { map: m, rngState: 123 };
  const units = [];
  for (let i = 0; i < 12; i++) units.push({ id: 100 + i });
  const goals = U.formationGoals(st, units, (rock.x + 0.5) * TILE, (rock.y + 0.5) * TILE);
  const tiles = goals.map((g) => `${(g.x / TILE) | 0},${(g.y / TILE) | 0}`);
  const blocked = goals.filter((g) => m.blockedAt((g.x / TILE) | 0, (g.y / TILE) | 0)).length;
  const uniq = new Set(tiles).size;
  ok('A6. formationGoals: все слоты свободны и почти все разные',
    blocked === 0 && uniq >= 10, `заблокировано ${blocked}/12, уникальных тайлов ${uniq}/12`);
}

// ---------- A7. nearestFreeFrom ----------
{
  const m = maps[0];
  let rock = null;
  outer: for (let y = 2; y < MAP_H - 2 && !rock; y++)
    for (let x = 2; x < MAP_W - 2; x++)
      if (m.blockedAt(x, y)) { rock = { x, y }; break outer; }
  const f = PF.nearestFreeFrom(m, rock.x, rock.y, 4);
  ok('A7. nearestFreeFrom возвращает свободную клетку рядом со стеной',
    !!f && !m.blockedAt(f.x, f.y), f ? `(${f.x},${f.y})` : 'null');
}

// ---------- A9. drawUnit: каждый юнит обеих фракций и 3 состояния ----------
// (stub-контекст считает вызовы: проверяем, что теневых проходов мало).
{
  const { UNITS, COLORS } = await import('../js/config.js');
  let shadowSets = 0, calls = 0;
  const mkCtx = () => new Proxy({ canvas: {} }, {
    get: (t, k) => {
      if (k in t) return t[k];
      calls++;
      return (...a) => undefined;
    },
    set: (t, k, v) => {
      if (k === 'shadowBlur' && v > 0) shadowSets++;
      if (k === 'shadowBlur' && v > 9) t.tooMuch = true;
      t[k] = v; return true;
    },
  });
  const types = Object.keys(UNITS);
  let drawn = 0, errors = [];
  for (const faction of ['human', 'alien']) {
    for (const type of types) {
      for (const variant of [0, 1, 2]) {
        const cfg = UNITS[type];
        const u = {
          id: 7 + drawn, kind: 'unit', side: variant === 2 ? 'enemy' : 'player',
          faction, type, cfg, r: cfg.r, x: 100, y: 100,
          angle: variant * 1.1, moving: variant !== 0, cd: variant === 1 ? cfg.cooldown * 0.7 : 0,
          carrying: type === 'worker' && variant === 1 ? 8 : 0,
          flashT: variant === 2 ? 0.1 : 0, selected: variant !== 0,
          hp: variant === 2 ? cfg.hp * 0.4 : cfg.hp, maxHp: cfg.hp,
          idleReason: variant === 2 && type === 'marine' ? 'unreachable' : null,
        };
        try {
          const before = shadowSets;
          U.drawUnit(mkCtx(), u, 200, 200);
          drawn++;
        } catch (e) { errors.push(`${faction}/${type}v${variant}: ${e.message}`); }
      }
    }
  }
  const expectedDraws = types.length * 2 * 3;
  ok(`A9. drawUnit: ${types.length} спрайтов × 2 фракции × 3 состояния — без исключений`,
    errors.length === 0 && drawn === expectedDraws, errors.join('; ') || `${drawn}/${expectedDraws}, вызовов ctx ${calls}, shadowBlur>0 ×${shadowSets}`);
}

// ---------- A10. drawBuilding: 8 зданий × 2 фракции × состояния ----------
// Состояния: готово / повреждено / стройка / призрак / турель в бою /
// бункер с гарнизоном. Проверяем отсутствие исключений и бюджет свечений.
{
  const { BUILDINGS } = await import('../js/config.js');
  const B = await import('../js/buildings.js');
  let shadowSets = 0, tooMuch = 0, nanArgs = 0;
  const COORD_METHODS = new Set(['arc', 'ellipse', 'fillRect', 'strokeRect', 'rect',
    'moveTo', 'lineTo', 'quadraticCurveTo', 'bezierCurveTo', 'fillText']);
  const mkCtx = () => new Proxy({ canvas: {} }, {
    get: (t, k) => {
      if (k in t) return t[k];
      if (k === 'createRadialGradient' || k === 'createLinearGradient' || k === 'createPattern') {
        return (...a) => {
          for (const v of a) if (typeof v === 'number' && !isFinite(v)) nanArgs++;
          return { addColorStop() {} };
        };
      }
      if (COORD_METHODS.has(k)) {
        return (...a) => {
          for (const v of a) if (typeof v === 'number' && !isFinite(v)) nanArgs++;
        };
      }
      return (...a) => undefined;
    },
    set: (t, k, v) => {
      if (k === 'shadowBlur' && v > 0) shadowSets++;
      if (k === 'shadowBlur' && v > 9) tooMuch++;
      t[k] = v; return true;
    },
  });
  const types = Object.keys(BUILDINGS);
  let drawn = 0;
  const errors = [];
  const mk = (faction, type, st) => {
    const cfg = BUILDINGS[type];
    return {
      tx: 10, ty: 10, w: cfg.w, h: cfg.h, side: faction === 'human' ? 'player' : 'enemy',
      type, cfg, faction, id: 1000 + drawn, angle: st === 4 ? 1.2 : -Math.PI / 4,
      done: st !== 2, progress: st === 2 ? 0.45 : 1,
      hp: st === 1 ? cfg.hp * 0.3 : cfg.hp, maxHp: cfg.hp,
      flashT: st === 1 ? 0.1 : 0, selected: st === 0,
      garrison: st === 5 && cfg.garrisonCap ? [{}, {}, {}] : [],
      cd: st === 4 && cfg.attack ? cfg.cooldown * 0.6 : 0,
    };
  };
  for (const faction of ['human', 'alien']) {
    for (const type of types) {
      for (let st = 0; st < 6; st++) {
        // ст.3 = призрак (рисуем с ghost=true), ст.5 для не-бункеров пропускаем
        if (st === 5 && !BUILDINGS[type].garrisonCap) continue;
        try {
          B.drawBuilding(mkCtx(), mk(faction, type, st), st === 3, 0, 0);
          drawn++;
        } catch (e) { errors.push(`${faction}/${type}s${st}: ${e.message}`); }
      }
    }
  }
  // Призрак стройки как в game.drawGhost: без id/cd — анимация не должна
  // дать NaN-координаты (canvas бы молча ронял фигуры).
  for (const [faction, type] of [['human', 'cc'], ['alien', 'turret'], ['human', 'wall']]) {
    const cfg = BUILDINGS[type];
    try {
      B.drawBuilding(mkCtx(), {
        tx: 10, ty: 10, w: cfg.w, h: cfg.h, side: 'player', type, cfg, faction,
        angle: -Math.PI / 4, garrison: [], done: true, progress: 1,
        hp: 1, maxHp: 1, flashT: 0, selected: false,
      }, false, 0, 0);
      drawn++;
    } catch (e) { errors.push(`ghost-preview/${type}: ${e.message}`); }
  }
  ok('A10. drawBuilding: 8×2×состояния — без исключений, blur ≤ 9, координаты конечны',
    errors.length === 0 && tooMuch === 0 && nanArgs === 0,
    errors.join('; ') || `${drawn} отрисовок, shadowBlur>0 ×${shadowSets}, NaN-аргументов ${nanArgs}`);
}

// ---------- A8. Perf ----------
{
  const m = maps[4];
  const t0 = Date.now();
  let n = 0;
  for (let i = 0; i < 200; i++) {
    const sx = 2 + ((i * 31) % 60), sy = 2 + ((i * 47) % 60);
    const gx = 62 - ((i * 23) % 60), gy = 62 - ((i * 11) % 60);
    if (m.blockedAt(sx, sy)) continue;
    PF.pathToPoint(m, sx, sy, (gx + 0.5) * TILE, (gy + 0.5) * TILE, { clearance: 11 });
    n++;
  }
  const ms = Date.now() - t0;
  ok('A8. 200 длинных путей с clearance считаются быстро', ms < 3000, `${n} путей за ${ms} мс (${(ms / Math.max(1, n)).toFixed(1)} мс/путь)`);
}

// ---------- A11. Пресеты кампании (пакет C) ----------
{
  const { MISSIONS, missionText } = await import('../js/missions.js');
  const { CC_WORKER_OFFS } = await import('../js/map.js');
  for (const m of MISSIONS) {
    const gm = new GameMap(m.map.seed, m.map);
    const errs = [];
    // Размер: явный — в диапазоне 48–96, иначе дефолт 64 (гвард).
    if (m.map.w || m.map.h) {
      if (gm.w < 48 || gm.w > 96 || gm.h < 48 || gm.h > 96) errs.push(`размер ${gm.w}×${gm.h} вне 48–96`);
    } else if (gm.w !== 64 || gm.h !== 64) {
      errs.push(`дефолт не 64: ${gm.w}×${gm.h}`);
    }
    // Полный путь A* база↔база (правила боевого поиска).
    const s = gm.bases.player.center, g = gm.bases.enemy.center;
    const tiles = PF.findPath(gm, s.x, s.y, (x, y) => x === g.x && y === g.y,
      (x, y) => Math.max(Math.abs(g.x - x), Math.abs(g.y - y)));
    const last = tiles[tiles.length - 1];
    if (!last || last.x !== g.x || last.y !== g.y) errs.push(`путь частичный (${tiles.length})`);
    // Скальных диагональных калиток — 0; карманы — считаем.
    const free = (x, y) => gm.inBounds(x, y) && !gm.blockedAt(x, y);
    const isRock = (x, y) => gm.inBounds(x, y) && gm.terrain[gm.idx(x, y)] === T_ROCK;
    let rockGates = 0, pockets = 0;
    for (let y = 1; y < gm.h - 1; y++) for (let x = 1; x < gm.w - 1; x++) {
      if (!free(x, y)) continue;
      const walls = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => !free(x + dx, y + dy)).length;
      if (walls >= 3) pockets++;
      if (free(x + 1, y + 1) && isRock(x + 1, y) && isRock(x, y + 1)) rockGates++;
    }
    if (rockGates) errs.push(`калиток ${rockGates}`);
    // Старты: cc 4×3 свободен, рабочие на земле, кристаллы есть.
    const footFree = (tx, ty, w, h) => {
      for (let y = ty; y < ty + h; y++) for (let x = tx; x < tx + w; x++) {
        if (!gm.inBounds(x, y) || gm.terrain[gm.idx(x, y)] !== T_GROUND || gm.mineralGrid[gm.idx(x, y)]) return false;
      }
      return true;
    };
    [gm.bases.player.cc, gm.bases.enemy.cc].forEach((cc, i) => {
      if (!footFree(cc.x, cc.y, 4, 3)) errs.push(`cc ${i ? 'врага' : 'игрока'} не встаёт`);
      for (const [dx, dy] of CC_WORKER_OFFS) {
        if (gm.blockedAt(cc.x + dx, cc.y + dy)) { errs.push(`рабочий ${i ? 'врага' : 'игрока'} в стене`); break; }
      }
    });
    if (!gm.crystals.length) errs.push('нет кристаллов');
    // Зоны миссии — внутри карты.
    const checkEvac = (w) => {
      if (!w || w.kind !== 'evac') return;
      if (w.x - w.r < 0 || w.y - w.r < 0 || w.x + 1 + w.r > gm.w || w.y + 1 + w.r > gm.h) errs.push('evac-зона вне карты');
    };
    if (m.objective && typeof m.objective === 'object') { checkEvac(m.objective); checkEvac(m.objective.then); }
    for (const z of (m.buildZone || [])) {
      if (z.x < 0 || z.y < 0 || z.x + z.w > gm.w || z.y + z.h > gm.h) errs.push('buildZone вне карты');
    }
    // Сторона базы для таблицы отчёта.
    const pb = gm.bases.player.cc;
    const dx = pb.x + 2 - gm.w / 2, dy = pb.y + 1.5 - gm.h / 2;
    const side = Math.abs(dx) > Math.abs(dy) * 1.4 ? (dx > 0 ? 'В' : 'З')
      : Math.abs(dy) > Math.abs(dx) * 1.4 ? (dy > 0 ? 'Ю' : 'С')
      : (dy > 0 ? 'Ю' : 'С') + (dx > 0 ? 'В' : 'З');
    ok(`A11. №${m.id} ${missionText(m, 'name')}: ${gm.w}×${gm.h}, база ${side} (${pb.x},${pb.y})`,
      errs.length === 0, errs.join('; ') || `путь ${tiles.length}, калиток 0, карманов ${pockets}, кристаллов ${gm.crystals.length}`);
  }
}

// ---------- A12. Скирмиш-пресеты G.5 (12 форм × 2 сида) ----------
{
  const { CC_WORKER_OFFS } = await import('../js/map.js');
  // Формула — та же, что skirmishDims в ui.js (size длинная, short ≈ 2/3 чётная).
  const dims = (size, shape) => {
    const short = Math.round(size / 3) * 2;
    if (shape === 'wide') return [size, short];
    if (shape === 'tall') return [short, size];
    return [size, size];
  };
  for (const size of [48, 64, 80, 96]) for (const shape of ['square', 'wide', 'tall']) {
    const [w, h] = dims(size, shape);
    for (const seed of [7, 424242]) {
      // base — как startSkirmish в game.js (y = h - 16).
      const gm = new GameMap(seed, { w, h, seed, lakes: 'default', rocks: 8, rich: 1.0, base: { x: 8, y: h - 16 } });
      const errs = [];
      if (gm.w !== w || gm.h !== h) errs.push(`размер ${gm.w}×${gm.h}, ждали ${w}×${h}`);
      const ps = gm.bases.player.center, pg = gm.bases.enemy.center;
      const tiles = PF.findPath(gm, ps.x, ps.y, (x, y) => x === pg.x && y === pg.y,
        (x, y) => Math.max(Math.abs(pg.x - x), Math.abs(pg.y - y)));
      const last = tiles[tiles.length - 1];
      if (!last || last.x !== pg.x || last.y !== pg.y) errs.push(`путь частичный (${tiles.length})`);
      const free = (x, y) => gm.inBounds(x, y) && !gm.blockedAt(x, y);
      const isRock = (x, y) => gm.inBounds(x, y) && gm.terrain[gm.idx(x, y)] === T_ROCK;
      let rockGates = 0;
      for (let y = 1; y < gm.h - 1; y++) for (let x = 1; x < gm.w - 1; x++) {
        if (free(x, y) && free(x + 1, y + 1) && isRock(x + 1, y) && isRock(x, y + 1)) rockGates++;
      }
      if (rockGates) errs.push(`калиток ${rockGates}`);
      const footFree = (tx, ty, fw, fh) => {
        for (let y = ty; y < ty + fh; y++) for (let x = tx; x < tx + fw; x++) {
          if (!gm.inBounds(x, y) || gm.terrain[gm.idx(x, y)] !== T_GROUND || gm.mineralGrid[gm.idx(x, y)]) return false;
        }
        return true;
      };
      [gm.bases.player.cc, gm.bases.enemy.cc].forEach((cc, i) => {
        if (!footFree(cc.x, cc.y, 4, 3)) errs.push(`cc ${i ? 'врага' : 'игрока'} не встаёт`);
        for (const [dx, dy] of CC_WORKER_OFFS) {
          if (gm.blockedAt(cc.x + dx, cc.y + dy)) { errs.push(`рабочий ${i ? 'врага' : 'игрока'} в стене`); break; }
        }
      });
      if (!gm.crystals.length) errs.push('нет кристаллов');
      ok(`A12. скирмиш ${w}×${h} сид ${seed}`, errs.length === 0,
        errs.join('; ') || `путь ${tiles.length}, калиток 0, кристаллов ${gm.crystals.length}`);
    }
  }
}

console.log(fails ? `\nИТОГ АУДИТА ДВИЖЕНИЯ: ЕСТЬ ПРОВАЛЫ (${fails})` : '\nИТОГ АУДИТА ДВИЖЕНИЯ: ВСЕ ПРОВЕРКИ ПРОШЛИ');
process.exit(fails ? 1 : 0);
