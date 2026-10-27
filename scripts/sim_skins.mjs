// ============================================================
// sim_skins.mjs — Э5+: визуальная эволюция 20 уровней (здания и юниты).
//
// Браузера нет, поэтому проверяем то, что вообще можно проверить headless:
//   • фазы 1–20 покрывают весь диапазон без дыр и наложений;
//   • у каждого типа здания цвет фазы МЕНЯЕТСЯ (сталь → золото → графит →
//     неон → призма), у стены — буквально как просил владелец;
//   • слой грейда ОТКЛЮЧЁН владельцем (28.10.2026) — сим сторожит, что
//     drawGradeTrim не рисует ничего ни на одном уровне (kill-switch);
//   • у юнитов ранг даёт масштаб (1.00 → 1.08), огни, антенну и неон —
//     и НЕ меняет хитбокс (u.r); сегменты брони отключены вместе со слоем;
//   • все типы зданий 1–20 и все юниты рангов 0…20 рисуются без исключений.
//
// Запуск: node scripts/sim_skins.mjs
// ============================================================
import './harness.mjs';

import { V } from './stamp.mjs';
const S = await import('../r/js/skins.js' + V);
const B = await import('../r/js/buildings.js' + V);
const U = await import('../r/js/units.js' + V);
const cfg = await import('../r/js/config.js' + V);

const failures = [];
const fail = (phase, err) => { failures.push(phase); console.log(`FAIL  ${phase}: ${String((err && err.message) || err)}`); };
const pass = (m) => console.log(`PASS  ${m}`);
const assert = (c, m) => { if (!c) throw new Error(m); };

// Считающий ctx: тот же no-op стаб харнесса, но с подсчётом вызовов.
function countingCtx() {
  const base = document.createElement('canvas').getContext('2d');
  const stat = { calls: 0, colors: new Set() };
  const proxy = new Proxy({}, {
    get(_t, prop) {
      if (prop === '__stat') return stat;
      const v = base[prop];
      if (typeof v === 'function') {
        return (...a) => { stat.calls++; return v(...a); };
      }
      if (prop === 'fillStyle' || prop === 'strokeStyle' || prop === 'shadowColor') {
        return stat[prop];
      }
      return v;
    },
    set(_t, prop, val) {
      if (prop === 'fillStyle' || prop === 'strokeStyle' || prop === 'shadowColor') {
        stat[prop] = val;
        if (typeof val === 'string') stat.colors.add(val);
      }
      try { base[prop] = val; } catch { /* read-only в стабе */ }
      return true;
    },
  });
  return proxy;
}

// ---------- S1: фазы ----------
try {
  assert(S.PHASES.length === 5, 'фаз не 5');
  let expect = 1;
  for (const p of S.PHASES) {
    assert(p.from === expect, `дыра в фазах перед ${p.from}`);
    expect = p.to + 1;
  }
  assert(expect === 21, 'фазы не доходят до 20 уровня');
  assert(S.phaseOf(0).key === 'steel' && S.phaseOf(21).key === 'prism', 'phaseOf не клампится в 1…20');
  pass('S1 фазы: сталь 1–4, золото 5–9, графит 10–14, неон 15–19, призма 20 — без дыр');
} catch (e) { fail('S1 фазы', e); }

// ---------- S2: знаковые цвета стены ----------
try {
  const wall = [1, 5, 10, 15, 20].map((L) => S.levelStyle('wall', L));
  assert(wall[0].trim === '#9fe8de', 'стена Г1 не стальная: ' + wall[0].trim);
  assert(wall[1].trim === '#f3c579', 'стена Г5 не золотая: ' + wall[1].trim);
  assert(wall[2].phase === 'graphite' && /^rgba/.test(String(wall[2].trim2)), 'стена Г10 не в графите');
  assert(wall[3].trim === '#7df3e2' && wall[3].glow >= 8, 'стена Г15 не неоновая');
  assert(wall[4].phase === 'prism' && wall[4].pips === 5, 'стена Г20 не призма');
  const sig = ['wall', 'cc', 'depot', 'turret', 'barracks', 'factory', 'lab', 'bunker']
    .map((t) => S.levelStyle(t, 1).signature);
  assert(new Set(sig).size >= 6, 'знаковые цвета типов почти не различаются: ' + sig.join(','));
  assert(S.levelStyle('depot', 1).signature === '#b48ce0', 'Дом не фиолетовый с Г1 — не читается как дорогая покупка');
  pass('S2 цвета: стена серая→золотая→графит→неон→призма, у типов свои знаковые цвета, Дом дорогой с Г1');
} catch (e) { fail('S2 цвета', e); }

// ---------- S3: слой зданий ОТКЛЮЧЁН владельцем ----------
// 28.10.2026 владелец: «отключи этот слой полностью, может он нам пригодится,
// но не сейчас» — drawGradeTrim выключен ранним return (код сохранён для
// возврата). Сим теперь сторожит ОТКЛЮЧЕНИЕ: слой не должен рисовать ничего
// ни на одном уровне ни у одного типа. Вернёшь слой — переверни этот блок.
try {
  const types = ['cc', 'depot', 'barracks', 'factory', 'lab', 'turret', 'bunker', 'wall'];
  for (const type of types) {
    for (const L of [1, 2, 5, 10, 15, 20]) {
      const ctx = countingCtx();
      const b = { type, level: L, done: true, cfg: cfg.BUILDINGS[type], side: 'player', hp: 100, maxHp: 100 };
      S.drawGradeTrim(ctx, b, 10, 10, 96, 72, 1.25);
      assert(ctx.__stat.calls === 0, `${type} Г${L}: отключённый слой что-то рисует (${ctx.__stat.calls} вызовов)`);
    }
  }
  pass('S3 здания: grade trim отключён владельцем — 0 вызовов на всех типах и уровнях');
} catch (e) { fail('S3 слой зданий', e); }

// ---------- S4: юниты — масштаб, сегменты, хитбокс ----------
try {
  assert(S.unitStyle(0).scale === 1, 'ранг 0 должен быть масштаба 1');
  assert(Math.abs(S.unitScale(20) - 1.08) < 1e-9, 'ранг 20 не +8 %: ' + S.unitScale(20));
  for (let r = 1; r <= 20; r++) {
    assert(S.unitScale(r) >= S.unitScale(r - 1), 'масштаб не монотонен на ранге ' + r);
  }
  assert(S.unitStyle(1).segments === 0 && S.unitStyle(5).segments >= 1, 'сегменты брони не появляются с рангом');
  assert(S.unitStyle(4).lights >= 1 && S.unitStyle(20).lights === 5, 'огни не растут до 5');
  assert(S.unitStyle(6).antenna === 0 && S.unitStyle(7).antenna === 1 && S.unitStyle(14).antenna === 2,
    'антенна не появляется на 7 и не усиливается на 14');
  assert(S.unitStyle(20).trim === '#7df3e2' && S.unitStyle(20).phase === 'prism', 'ранг 20 не призма');
  pass('S4 юниты: масштаб 1.00→1.08, сегменты 0→4, огни 1→5, антенна 0/1/2, на 20 — призма');
} catch (e) { fail('S4 стиль юнитов', e); }

// ---------- S5: рендер всех зданий и юнитов без исключений ----------
try {
  let drawn = 0;
  for (const type of Object.keys(cfg.BUILDINGS)) {
    for (let L = 1; L <= 20; L++) {
      const ctx = countingCtx();
      const b = {
        type, level: L, done: true, side: 'player', faction: 'human', cfg: cfg.BUILDINGS[type],
        tx: 4, ty: 4, w: cfg.BUILDINGS[type].w || 2, h: cfg.BUILDINGS[type].h || 2,
        hp: 100, maxHp: 100, garrison: [], angle: 0, id: 7, progress: 1,
      };
      B.drawBuilding(ctx, b, false, 0, 0, null);
      assert(ctx.__stat.calls > 0, `${type} Г${L}: ничего не нарисовано`);
      drawn++;
    }
  }
  for (const type of Object.keys(cfg.UNITS)) {
    for (const rank of [0, 1, 5, 10, 15, 20]) {
      const ctx = countingCtx();
      const u = {
        type, side: 'player', faction: 'human', cfg: cfg.UNITS[type], x: 100, y: 100, r: 10,
        angle: 0.6, hp: 50, maxHp: 50, cd: 0, moving: true, selected: true, id: 3, flashT: 0,
        carrying: 0, order: null,
      };
      U.drawUnit(ctx, u, 100, 100, rank);
      assert(ctx.__stat.calls > 0, `${type} ранга ${rank}: ничего не нарисовано`);
      if (rank > 0) {
        // Слой ранга трогает цвета фаз.
        const phaseColor = S.unitStyle(rank).trim;
        assert(ctx.__stat.colors.has(phaseColor), `${type} ранга ${rank}: цвет фазы ${phaseColor} не использован`);
      }
      drawn++;
    }
  }
  pass(`S5 рендер: ${drawn} комбинаций (все здания 1–20, все юниты рангов 0…20) — без исключений`);
} catch (e) { fail('S5 рендер', e); }

// ---------- Итог ----------
if (failures.length) {
  console.log(`\n❌ Э5+: провалено ${failures.length} блок(ов): ${failures.join(', ')}`);
  process.exit(1);
}
console.log('\n✅ Э5+: вид 20 уровней — все блоки зелёные');
