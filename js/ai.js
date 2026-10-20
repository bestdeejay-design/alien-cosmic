// ============================================================
// ai.js — ИИ противника. Работает по профилю миссии:
//   обычный бой — экономика (рабочие → дома → казармы → пехота →
//   техника) и нарастающие волны атак;
//   миссия-оборона — волны спавнятся у командного центра противника
//   с нарастающим размером, без собственной экономики (гнёзда-бараки —
//   дополнительные цели для сноса).
// ИИ не симулирует туман войны — видит всю карту (классическое
// «читерство» простых RTS-ИИ, допустимо для аркады).
// ============================================================
import { AI, BUILDINGS, UNITS, UPGRADES, SUPPLY_MAX, TILE } from './config.js';
import { orderGather, orderBuild, orderAttack, orderRepair, spawnUnit, srand } from './units.js';
import { canPlace, placeBuildingCmd, enqueueUnit, startResearch } from './buildings.js';
import { pathToRect } from './pathfinding.js';
import { message } from './i18n.js';

export class AIController {
  constructor(profile = {}) {
    this.p = { ...AI, ...profile };       // профиль миссии поверх базовых чисел
    this.def = this.p.defense || null;    // режим обороны (миссия защиты)
    this.accT = 0;
    this.nextWave = this.p.firstWave;
    this.lastWave = -999;
    this.defWaveNum = 0;
    this.defNextWaveAt = this.def ? this.def.prep : 0;
    // Спираль офсетов вокруг базы для поиска места под здание.
    this.spotOffsets = [];
    const R = 11;
    for (let dy = -R; dy <= R; dy++)
      for (let dx = -R; dx <= R; dx++)
        this.spotOffsets.push([dx, dy, dx * dx + dy * dy]);
    this.spotOffsets.sort((a, b) => a[2] - b[2]);
  }

  update(dt, st) {
    this.accT += dt;
    if (this.accT < 0.5) return; // решения принимаем 2 раза в секунду
    this.accT = 0;
    this.step(st);
  }

  step(st) {
    if (!st || st.gameOver) return;
    if (this.def) { this.defenseStep(st); return; }
    this.survivalStep(st);
  }

  // ----------------------------------------------------------
  // Миссия-оборона: подготовка → волны из гнёзд, растущие со временем.
  // ----------------------------------------------------------
  defenseStep(st) {
    const D = this.def;
    if (st.time < D.prep) return; // игрок готовится — противник ждёт
    if (st.time < this.defNextWaveAt) return;

    // Отправляем волну: размер растёт с номером волны.
    const n = Math.min(D.max, D.start + D.grow * this.defWaveNum);
    const cc = st.buildings.find((b) => b.side === 'enemy' && !b.dead && b.type === 'cc');
    if (!cc) return;
    const wave = [];
    for (let i = 0; i < n; i++) {
      const a = srand(st) * Math.PI * 2;
      const r = TILE * (2.5 + srand(st) * 2);
      const u = spawnUnit(st, 'enemy', 'marine', cc.x + Math.cos(a) * r, cc.y + Math.sin(a) * r);
      wave.push(u);
    }
    // Каждая третья волна усиливается быстрыми единицами.
    if (this.defWaveNum % 3 === 2) {
      for (let i = 0; i < 2; i++) {
        const u = spawnUnit(st, 'enemy', 'buggy', cc.x + (srand(st) - 0.5) * TILE * 4, cc.y + TILE * 3);
        wave.push(u);
      }
    }
    // Поздние волны разнообразятся по профилю: кислотники — каждая вторая, мортиры — каждая пятая.
    if (this.defWaveNum % 2 === 0 && this.p.flamers > 0) {
      for (let i = 0; i < 2; i++) {
        wave.push(spawnUnit(st, 'enemy', 'flamer', cc.x + (srand(st) - 0.5) * TILE * 4, cc.y + TILE * 2.5));
      }
    }
    if (this.defWaveNum % 5 === 4 && this.p.arty > 0) {
      wave.push(spawnUnit(st, 'enemy', 'arty', cc.x + (srand(st) - 0.5) * TILE * 3, cc.y + TILE * 4));
    }
    // М6: медики добираются до лимита профиля каждую чётную волну.
    if (this.defWaveNum % 2 === 0 && this.p.medics > 0) {
      let alive = 0;
      for (const u of st.units) if (!u.dead && u.side === 'enemy' && u.type === 'medic') alive++;
      for (let i = alive; i < this.p.medics; i++) {
        wave.push(spawnUnit(st, 'enemy', 'medic', cc.x + (srand(st) - 0.5) * TILE * 4, cc.y + TILE * 2));
      }
    }
    const target = nearestPlayerBuilding(st, cc);
    for (const u of wave) if (target) orderAttack(st, u, target);

    this.defWaveNum++;
    this.defNextWaveAt = st.time + D.every;
    st.defenseWave = this.defWaveNum;
    st.pings.push({ x: cc.x, y: cc.y, t: 0 });
    st.game.ui.toast(message('wave', st.factions.enemy, { n: this.defWaveNum }), 'error');
    st.game.sound.ping();
  }

  // М4: карательная волна по дедлайну — враг бросает резерв (размером
  // с его обычную волну) на ближайшее здание игрока. Разовая.
  raidWave(st, n) {
    const cc = st.buildings.find((b) => b.side === 'enemy' && !b.dead && b.type === 'cc');
    if (!cc) return 0;
    const target = nearestPlayerBuilding(st, cc);
    let sent = 0;
    for (let i = 0; i < n; i++) {
      const a = srand(st) * Math.PI * 2;
      const r = TILE * (2.5 + srand(st) * 2);
      const u = spawnUnit(st, 'enemy', 'marine', cc.x + Math.cos(a) * r, cc.y + Math.sin(a) * r);
      if (target) orderAttack(st, u, target);
      sent++;
    }
    if (this.p.flamers > 0) {
      for (let i = 0; i < 2; i++) {
        const u = spawnUnit(st, 'enemy', 'flamer', cc.x + (srand(st) - 0.5) * TILE * 4, cc.y + TILE * 2.5);
        if (target) orderAttack(st, u, target);
        sent++;
      }
    }
    st.pings.push({ x: cc.x, y: cc.y, t: 0 });
    return sent;
  }

  // ----------------------------------------------------------
  // Обычный бой: экономика → техника → волны.
  // ----------------------------------------------------------
  survivalStep(st) {
    const P = this.p;
    const mine = (e) => e.side === 'enemy' && !e.dead;
    const workers = st.units.filter((u) => mine(u) && u.type === 'worker');
    const combat = st.units.filter((u) => mine(u) && !u.cfg.canMine);
    const ccs = st.buildings.filter((b) => mine(b) && b.type === 'cc');
    const barracks = st.buildings.filter((b) => mine(b) && b.type === 'barracks');
    const money = st.minerals.enemy;
    const { used, cap } = st.supply.enemy;

    // 1) Бездельники-рабочие — за кристаллы.
    for (const w of workers) {
      if (w.order.kind === 'idle') {
        const c = st.map.crystals.find((c) => !c.dead && c.amount > 0);
        if (c) orderGather(st, w, c);
      }
    }

    // 2) Недостроенные здания без строителя — назначить рабочего.
    for (const b of st.buildings) {
      if (!mine(b) || b.done) continue;
      const hasBuilder = st.units.some((u) => mine(u) && u.order.kind === 'build' && u.order.target === b);
      if (!hasBuilder && workers.length) {
        const w = nearestTo(workers, b.x, b.y);
        if (w) orderBuild(st, w, b);
      }
    }

    // 3) Дом — если население на пределе (приоритет №1, иначе deadlock).
    const depotPending = st.buildings.some((b) => mine(b) && !b.done && b.type === 'depot');
    if (P.depots !== false && cap < SUPPLY_MAX && cap - used <= 2 && !depotPending && money >= BUILDINGS.depot.cost) { // П8: №17 запрещает дома
      this.tryPlace(st, 'depot');
    }

    // 4) Рабочие до целевого количества.
    if (workers.length < P.workerTarget) {
      for (const cc of ccs) {
        if (cc.done && cc.queue.length < 2 && money >= UNITS.worker.cost && cap - used >= 1) {
          enqueueUnit(st, cc, 'worker');
        }
      }
    }

    // 5) Казармы: первая сразу, вторая по времени; лаборатория — по профилю.
    if (barracks.length < 1 && money >= BUILDINGS.barracks.cost) {
      this.tryPlace(st, 'barracks');
    } else if (st.time > P.secondBarracksAt && barracks.length < 2 &&
               money >= BUILDINGS.barracks.cost + 100) {
      this.tryPlace(st, 'barracks');
    }
    if (P.research && barracks.some((b) => b.done)) {
      const labs = st.buildings.filter((b) => mine(b) && b.type === 'lab');
      const labPending = st.buildings.some((b) => mine(b) && !b.done && b.type === 'lab');
      if (!labs.length && !labPending && money >= BUILDINGS.lab.cost + 80) {
        this.tryPlace(st, 'lab');
      }
    }

    // 5b) Исследования: каждая свободная лаборатория качает первый доступный апгрейд.
    if (P.research) {
      const labs = st.buildings.filter((b) => mine(b) && b.done && b.type === 'lab');
      for (const lab of labs) {
        if (lab.res) continue;
        for (const key of ['infAtk', 'vehAtk', 'infArm', 'vehArm']) {
          const u = UPGRADES[key];
          const lvl = st.tech.enemy[key] || 0;
          if (lvl < u.max && st.minerals.enemy >= u.costs[lvl] + 80) {
            startResearch(st, lab, key);
            break;
          }
        }
      }
    }

    // 5c) Казармы производят смешанную пехоту по профилю: кислотники → наниты → рейнджеры.
    const cnt = (type) => st.units.filter((u) => mine(u) && u.type === type).length;
    const queued = (b, type) => b.queue.filter((q) => q.type === type).length;
    for (const br of barracks) {
      if (!br.done || br.queue.length >= 2) continue;
      if (P.flamers > 0 && money >= UNITS.flamer.cost &&
          cnt('flamer') + queued(br, 'flamer') < P.flamers && cap - used >= 1) {
        enqueueUnit(st, br, 'flamer');
      } else if (P.medics > 0 && money >= UNITS.medic.cost &&
          cnt('medic') + queued(br, 'medic') < P.medics && cap - used >= 1) {
        enqueueUnit(st, br, 'medic');
      } else if (money >= UNITS.marine.cost &&
          cnt('marine') + queued(br, 'marine') < P.maxMarines && cap - used >= 1) {
        enqueueUnit(st, br, 'marine');
      }
    }

    // 6) Турели у базы — по профилю миссии.
    if (P.maxTurrets > 0) {
      const turrets = st.buildings.filter((b) => mine(b) && b.type === 'turret');
      if (turrets.length < P.maxTurrets && money >= BUILDINGS.turret.cost + 60) {
        this.tryPlace(st, 'turret');
      }
    }

    // 7) Завод техники и техника — по профилю миссии (мортиры приоритетнее бастионов).
    if (P.factory && barracks.some((b) => b.done)) {
      const factories = st.buildings.filter((b) => mine(b) && b.type === 'factory');
      if (!factories.length && money >= BUILDINGS.factory.cost + 50) {
        this.tryPlace(st, 'factory');
      }
      const buggies = st.units.filter((u) => mine(u) && u.type === 'buggy');
      const tanks = st.units.filter((u) => mine(u) && u.type === 'tank');
      const artys = st.units.filter((u) => mine(u) && u.type === 'arty');
      for (const f of factories) {
        if (!f.done || f.queue.length >= 2) continue;
        const queued = f.queue.reduce((s, q) => s + (q.type === 'buggy' ? 1 : q.type === 'arty' ? 2 : 2), 0);
        if (P.arty > 0 && money >= UNITS.arty.cost && artys.length + f.queue.filter((q) => q.type === 'arty').length < P.arty && cap - used >= 3) {
          enqueueUnit(st, f, 'arty');
        } else if (money >= UNITS.tank.cost && tanks.length + queued < P.maxTanks && cap - used >= 3) {
          enqueueUnit(st, f, 'tank');
        } else if (money >= UNITS.buggy.cost && buggies.length + queued < P.maxBuggies && cap - used >= 2) {
          enqueueUnit(st, f, 'buggy');
        }
      }
    }

    // 8) Ремонт: рабочий латает повреждённую технику/здания.
    if (P.repair) {
      const busy = workers.filter((w) => w.order.kind === 'repair');
      if (!busy.length) {
        const hurtV = st.units.find((u) => mine(u) && u.cfg.vehicle && u.hp < u.maxHp * 0.6);
        const hurtB = st.buildings.find((b) => mine(b) && b.done && b.hp < b.maxHp * 0.55);
        const target = hurtV || hurtB;
        if (target) {
          const w = nearestTo(workers, target.x, target.y);
          if (w && w.order.kind !== 'build') orderRepair(st, w, target);
        }
      }
    }

    // 9) Волны атаки: копим армию до размера волны и отправляем.
    const idle = combat.filter((u) => u.order.kind !== 'attack');
    if (idle.length >= this.nextWave && st.time - this.lastWave >= P.minWaveInterval) {
      for (const m of idle) {
        const target = nearestPlayerBuilding(st, m);
        if (target) orderAttack(st, m, target);
      }
      this.lastWave = st.time;
      this.nextWave = Math.min(this.nextWave + P.waveGrowth, P.waveMax);
    }
  }

  // Ищем свободное место у своей базы и ставим здание силами рабочего.
  tryPlace(st, type) {
    const cfg = BUILDINGS[type];
    const cc = st.buildings.find((b) => b.side === 'enemy' && !b.dead && b.type === 'cc');
    if (!cc) return;
    const workers = st.units.filter((u) => u.side === 'enemy' && !u.dead && u.type === 'worker');
    if (!workers.length) return;

    for (const [dx, dy] of this.spotOffsets) {
      const tx = cc.tx + dx, ty = cc.ty + dy;
      if (!canPlace(st.map, tx, ty, cfg.w, cfg.h)) continue;
      // Место должно быть достижимо из базы — иначе рабочий застрянет.
      if (!pathToRect(st.map, cc.tx + 2, cc.ty + 1, { x: tx, y: ty, w: cfg.w, h: cfg.h })) continue;
      const w = nearestTo(workers, (tx + cfg.w / 2) * TILE, (ty + cfg.h / 2) * TILE);
      placeBuildingCmd(st, 'enemy', type, tx, ty, [w]);
      return;
    }
  }
}

function nearestTo(list, x, y) {
  let best = null, bd = Infinity;
  for (const e of list) {
    const d = Math.hypot(e.x - x, e.y - y);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

function nearestPlayerBuilding(st, unit) {
  let best = null, bd = Infinity;
  for (const b of st.buildings) {
    if (b.dead || b.side !== 'player') continue;
    const d = Math.hypot(b.x - unit.x, b.y - unit.y);
    if (d < bd) { bd = d; best = b; }
  }
  // Стелс-миссия: зданий у игрока нет — волны преследуют сам отряд.
  if (!best) {
    for (const u of st.units) {
      if (u.dead || u.side !== 'player' || u.garrison) continue;
      const d = Math.hypot(u.x - unit.x, u.y - unit.y);
      if (d < bd) { bd = d; best = u; }
    }
  }
  return best;
}
