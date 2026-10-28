// ============================================================
// sim_walls.mjs — ace#7 ФИНАЛ: стены D «Крест» + K1 в игровом рендере.
// Чек-лист SZ m2 п.6: новая группа check_r «стены» — 3 конфигурации
// (горизонталь/вертикаль/Г-угол) × 2 фракции × I/V/XX.
// Запуск: node scripts/sim_walls.mjs
// ============================================================
import './harness.mjs';
import { V } from './stamp.mjs';

const B = await import('../r/js/buildings.js' + V);

const failures = [];
const fail = (phase, err) => { failures.push(phase); console.log(`FAIL  ${phase}: ${String((err && err.message) || err)}`); };
const pass = (m) => console.log(`PASS  ${m}`);
const assert = (c, m) => { if (!c) throw new Error(m); };

function countingCtx() {
  const base = document.createElement('canvas').getContext('2d');
  const stat = { calls: 0 };
  return new Proxy({}, {
    get(_t, prop) {
      if (prop === '__stat') return stat;
      const v = base[prop];
      if (typeof v === 'function') return (...a) => { stat.calls++; return v(...a); };
      return v;
    },
    set(_t, prop, val) { try { base[prop] = val; } catch { /* stub */ } return true; },
  });
}

// Маски трёх конфигураций: горизонталь (запад-восток), вертикаль, Г-угол.
const CONFS = {
  h: { n: false, e: true, s: false, w: true },
  v: { n: true, e: false, s: true, w: false },
  l: { n: true, e: true, s: false, w: false },
};
const LV = [1, 5, 20];

// ---------- W1: 3 конфигурации × 2 фракции × I/V/XX — без исключений ----------
try {
  for (const [name, mask] of Object.entries(CONFS)) {
    for (const faction of ['human', 'alien']) {
      for (const level of LV) {
        const ctx = countingCtx();
        const st = { factions: { player: 'human', enemy: 'alien' }, buildings: [], units: [] };
        const b = new B.Building(st, 'player', 'wall', 0, 0, true);
        b.level = level; b.faction = faction;
        const wallSet = new Set(['0,0']);
        if (mask.n) wallSet.add('0,-1');
        if (mask.e) wallSet.add('1,0');
        if (mask.s) wallSet.add('0,1');
        if (mask.w) wallSet.add('-1,0');
        B.drawBuilding(ctx, b, false, 0, 0, st, { overlays: false, wallSet });
        assert(ctx.__stat.calls > 40, `${name}/${faction}/L${level}: отрисовка пустая`);
      }
    }
  }
  pass('W1 стены: 3 конфигурации × 2 фракции × I/V/XX рисуются без исключений');
} catch (e) { fail('W1 конфигурации', e); }

// ---------- W2: все 16 масок соседей (сохранённые базы) ----------
try {
  for (let m = 0; m < 16; m++) {
    const mask = { n: !!(m & 1), e: !!(m & 2), s: !!(m & 4), w: !!(m & 8) };
    const st = { factions: { player: 'human', enemy: 'alien' }, buildings: [], units: [] };
    const b = new B.Building(st, 'player', 'wall', 0, 0, true);
    b.level = 12;
    const wallSet = new Set(['0,0']);
    if (mask.n) wallSet.add('0,-1');
    if (mask.e) wallSet.add('1,0');
    if (mask.s) wallSet.add('0,1');
    if (mask.w) wallSet.add('-1,0');
    B.drawBuilding(countingCtx(), b, false, 0, 0, st, { overlays: false, wallSet });
  }
  pass('W2 сохранённые базы: все 16 масок соседей — без исключений');
} catch (e) { fail('W2 маски', e); }

// ---------- W3: fallback «одиночная секция» (ghost/лаба, ст= null, нет wallSet) ----------
try {
  const st = { factions: { player: 'human', enemy: 'alien' }, buildings: [], units: [] };
  const b = new B.Building(st, 'player', 'wall', 0, 0, true);
  b.level = 8;
  B.drawBuilding(countingCtx(), b, false, 0, 0, null);            // lab.js:89 — st=null
  B.drawBuilding(countingCtx(), b, true, 0, 0, st);               // ghost
  B.drawBuilding(countingCtx(), b, false, 0, 0, st, { overlays: true }); // без wallSet
  pass('W3 fallback: одиночная секция для ghost/лабы/миниатюр');
} catch (e) { fail('W3 fallback', e); }

if (failures.length) {
  console.log('FAIL  стены: ' + failures.join('; '));
  process.exit(1);
}
console.log('PASS  стены: все сценарии зелёные');
