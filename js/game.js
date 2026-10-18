// ============================================================
// game.js — точка входа. Состояние партии, фиксированный игровой
// цикл (логика 30 тик/с, отрисовка через requestAnimationFrame с
// интерполяцией), меню кампании/быстрого боя, выбор фракции
// (Гелиос-люди / кхарид-аборигены), миссия-оборона с волнами,
// команды игрока, победа/поражение, рестарт без перезагрузки.
// ============================================================
import {
  TILE, MAP_W, MAP_H, WORLD_W, WORLD_H, LOGIC_DT, MAX_FRAME_DT,
  START_MINERALS, BUILDINGS, UNITS, SUPPLY_MAX, UPGRADES,
  fname, fdesc,
} from './config.js';
import { GameMap, CC_WORKER_OFFS } from './map.js';
import { Fog } from './fog.js';
import { Sound } from './audio.js';
import * as U from './units.js';
import * as B from './buildings.js';
import { AIController } from './ai.js';
import { MISSIONS, SKIRMISH, loadProgress, saveProgress } from './missions.js';
import * as ui from './ui.js';
import { attachInput, updateCamera } from './input.js';

// Порядок кнопок в меню стройки: клавиша → тип здания.
const BUILD_ORDER = [
  ['KeyQ', 'cc'], ['KeyW', 'depot'], ['KeyE', 'barracks'],
  ['KeyR', 'turret'], ['KeyT', 'bunker'], ['KeyY', 'wall'], ['KeyU', 'factory'],
  ['KeyI', 'lab'],
];
const PRODUCE_KEYS = ['KeyQ', 'KeyW', 'KeyE'];
const RESEARCH_KEYS = ['KeyQ', 'KeyW', 'KeyE', 'KeyR'];
const RESEARCH_ORDER = ['infAtk', 'vehAtk', 'infArm', 'vehArm'];

// ------------------------------------------------------------
// Данные тултипов кнопок панели (подписи юнитов/зданий/улучшений).
// ------------------------------------------------------------
function buildingTip(type, fac) {
  const cfg = BUILDINGS[type];
  const lines = [`Прочность ${cfg.hp} · размер ${cfg.w}×${cfg.h} · стройка ${cfg.buildTime}с`];
  if (cfg.supplyGain) lines.push('Население +' + cfg.supplyGain);
  if (cfg.produces) {
    const list = Array.isArray(cfg.produces) ? cfg.produces : [cfg.produces];
    lines.push('Обучает: ' + list.map((t) => fname(UNITS[t], fac)).join(', '));
  }
  if (cfg.attack) lines.push('Атака ' + cfg.dmg + ' · дальность ' + cfg.range);
  if (cfg.garrisonCap) lines.push('Гарнизон до ' + cfg.garrisonCap + ' пехотинцев');
  if (cfg.research) lines.push('Исследует улучшения армии');
  if (cfg.requires) lines.push('Требует: ' + fname(BUILDINGS[cfg.requires], fac));
  return { title: fname(cfg, fac), cost: cfg.cost, desc: fdesc(cfg, fac), lines };
}
function unitTip(type, fac) {
  const cfg = UNITS[type];
  const lines = [
    'ОЗ ' + cfg.hp + ' · урон ' + cfg.dmg + ' · дальность ' + cfg.range,
    'Население ' + cfg.supply + ' · обучение ' + cfg.trainTime + 'с',
  ];
  if (cfg.splash) lines.push('Осколки по площади');
  if (cfg.canHeal) lines.push('Лечит пехоту: +' + cfg.healRate + ' ОЗ/с');
  if (cfg.vehicle) lines.push('Техника: чинится рабочими');
  return { title: fname(cfg, fac), cost: cfg.cost, desc: fdesc(cfg, fac), lines };
}
function upgradeTip(key, fac, lvl) {
  const u = UPGRADES[key];
  return {
    title: fname(u, fac) + ' ур.' + (lvl + 1), cost: u.costs[lvl],
    desc: fdesc(u, fac),
    lines: ['Время: ' + u.times[lvl] + 'с', 'Действует сразу на всю армию'],
  };
}

export class Game {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    this.ctx = this.canvas.getContext('2d', { alpha: false });
    this.sound = new Sound();
    this.ui = ui;
    this.state = null;
    this.started = false;
    this.paused = false;
    this.mission = MISSIONS[0];      // активная миссия (или сконструированный «быстрый бой»)
    this.box = null;                 // рамка выделения (мировые координаты)
    this.mouse = { x: -1, y: -1 };
    this.cssW = window.innerWidth;
    this.cssH = window.innerHeight;
    this.acc = 0;
    this.last = 0;
    this.grid = new U.SpatialGrid(64);

    window.addEventListener('resize', () => this.resize());
    this.resize();
    // При возврате на вкладку не накапливаем «долгие» тики.
    document.addEventListener('visibilitychange', () => { this.last = performance.now(); });

    this.hooks = this.makeHooks();
    ui.initUI(this);
    ui.setSoundUI(this.sound.muted);
    attachInput(this);
    this.newGame(); // фон для меню — партия не идёт, пока started=false

    requestAnimationFrame((t) => this.loop(t));
  }

  // ----------------------------------------------------------
  // Новая партия — строится из this.mission (карта, фракции, ИИ).
  // ----------------------------------------------------------
  newGame() {
    const m = this.mission;
    const seed = m.map.seed;
    const st = {
      tick: 0, time: 0, seed,
      rngState: (seed ^ 0x51ED2707) >>> 0, // детерминированный ГПСЧ боя (см. srand)
      repathsThisTick: 0,                  // бюджет пересчётов пути на тик
      factions: {
        player: m.faction,
        enemy: m.faction === 'alien' ? 'human' : 'alien',
      },
      minerals: { player: START_MINERALS, enemy: START_MINERALS },
      supply: { player: { used: 0, cap: 0 }, enemy: { used: 0, cap: 0 } },
      units: [], buildings: [], projectiles: [], effects: [], floats: [], pings: [],
      selection: [], groups: {}, placing: null, buildMenu: false,
      camera: { x: 0, y: 0 }, mouseWorld: { x: 0, y: 0 },
      gameOver: null,
      stats: { kills: 0, losses: 0, mined: 0 },
      bcount: { player: 0, enemy: 0 },
      defenseWave: 0,
      // Уровни улучшений обеих сторон (растут исследованиями лаборатории).
      tech: {
        player: { infAtk: 0, infArm: 0, vehAtk: 0, vehArm: 0 },
        enemy:  { infAtk: 0, infArm: 0, vehAtk: 0, vehArm: 0 },
      },
      noBase: !!m.noBase,           // стелс-миссия: отряд без базы
      shakeT: 0, shakeMag: 0,       // тряска экрана от взрывов
      lastAlertT: -99, lastSupplyToast: -99, lastRepairToast: -99,
    };
    st.map = new GameMap(seed, m.map);
    st.fog = new Fog();
    st.game = this;
    this.state = st;
    this.box = null;
    this.paused = false;
    ui.setPausedUI(false);

    // Стартовые базы: командный центр + рабочие (враг — зеркален).
    for (const side of ['player', 'enemy']) {
      const base = st.map.bases[side];
      if (side === 'player' && st.noBase) continue; // стелс-миссия — отряд вместо базы
      const cc = new B.Building(st, side, 'cc', base.cc.x, base.cc.y, true);
      st.map.markBuilding(cc);
      st.bcount[side]++;
      for (const [dx, dy] of CC_WORKER_OFFS) {
        U.spawnUnit(st, side, 'worker', (base.cc.x + dx + 0.5) * TILE, (base.cc.y + dy + 0.5) * TILE, true);
      }
    }

    // Стелс-миссия: стартовый отряд без базы (workers нет — строить нельзя).
    if (st.noBase && m.squad) {
      const pb = st.map.bases.player.cc;
      let i = 0;
      for (const [type, n] of m.squad) {
        for (let k = 0; k < n; k++) {
          const a = (i / 12) * Math.PI * 2;
          U.spawnUnit(st, 'player', type,
            (pb.x + 2 + Math.cos(a) * 3.2) * TILE,
            (pb.y + 2 + Math.sin(a) * 3.2) * TILE);
          i++;
        }
      }
    }

    // Миссия-оборона: у противника дополнительные гнёзда-укрепления.
    if (m.defense) {
      const e = st.map.bases.enemy.cc;
      const cand = [[-4, 0], [4, 1], [0, -4], [-1, 4], [3, -3], [-3, 3]];
      let placed = 0;
      for (const [dx, dy] of cand) {
        if (placed >= m.defense.nests) break;
        const tx = e.x + dx, ty = e.y + dy;
        if (!B.canPlace(st.map, tx, ty, 3, 2)) continue;
        const nest = new B.Building(st, 'enemy', 'barracks', tx, ty, true);
        st.map.markBuilding(nest);
        st.bcount.enemy++;
        placed++;
      }
      if (m.faction === 'human') {
        // Фракция игрока — люди: у противника кхарид ставим жвала.
        this.placeEnemyTurrets(st, e, 2);
      }
    }

    st.ai = new AIController({ ...m.ai, defense: m.defense });
    calcSupply(st);
    st.fog.recompute(st);

    // Камера — на базу игрока.
    const pb = st.map.bases.player.cc;
    this.centerCamera((pb.x + 2) * TILE, (pb.y + 2) * TILE);

    ui.resetPanel();
    ui.update(this);
    ui.setObjective(this.objectiveText());
    ui.drawMinimap(this);
  }

  // Турели-жвала врага в миссии обороны (ставим без строителей).
  placeEnemyTurrets(st, cc, count) {
    const cand = [[2, -2], [-3, -1], [2, 3], [-2, 3], [4, 0], [0, -5]];
    let placed = 0;
    for (const [dx, dy] of cand) {
      if (placed >= count) break;
      const tx = cc.x + dx, ty = cc.y + dy;
      if (!B.canPlace(st.map, tx, ty, 1, 1)) continue;
      const t = new B.Building(st, 'enemy', 'turret', tx, ty, true);
      st.map.markBuilding(t);
      st.bcount.enemy++;
      placed++;
    }
  }

  // ----------------------------------------------------------
  // Запуск миссии из меню.
  // ----------------------------------------------------------
  startMission(m) {
    this.sound.unlock();      // жест пользователя — легально включаем звук
    this.mission = m;
    this.newGame();
    this.started = true;
    ui.hideStart();
    ui.hideMissions();
    ui.hideBrief();
    ui.hideEnd();
    ui.toast(m.objective);
  }

  startSkirmish(faction) {
    const seed = (Math.random() * 0xFFFFFFFF) >>> 0;
    const biome = ['mars', 'nest', 'moon'][seed % 3];
    this.startMission({
      ...SKIRMISH,
      id: -1,
      faction,
      map: {
        seed, biome,
        lakes: 'default', rocks: 6 + (seed % 5),
        rich: 1 + ((seed >> 4) % 3) * 0.15,
        base: { x: 8, y: 48 },
      },
    });
  }

  restart() {
    ui.hideEnd();
    this.newGame();
    this.started = true;
    ui.hideStart();
    ui.toast(this.mission.objective);
    this.sound.click();
  }

  togglePause() {
    if (!this.started || (this.state && this.state.gameOver)) return;
    this.paused = !this.paused;
    ui.setPausedUI(this.paused);
    this.sound.click();
  }

  toggleSound() {
    ui.setSoundUI(this.sound.toggle());
  }

  resize() {
    this.cssW = window.innerWidth;
    this.cssH = window.innerHeight;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(this.cssW * dpr);
    this.canvas.height = Math.round(this.cssH * dpr);
    this.canvas.style.width = this.cssW + 'px';
    this.canvas.style.height = this.cssH + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Размеры панелей UI — чтобы краевой скролл не срабатывал над ними.
    this.uiTop = document.getElementById('topbar')?.offsetHeight || 0;
    this.uiBottom = document.getElementById('bottom-panel')?.offsetHeight || 0;
    this.clampCam();
  }

  clampCam() {
    const st = this.state;
    if (!st) return;
    st.camera.x = Math.max(0, Math.min(WORLD_W - this.cssW, st.camera.x));
    st.camera.y = Math.max(0, Math.min(WORLD_H - this.cssH, st.camera.y));
  }

  centerCamera(wx, wy) {
    const st = this.state;
    if (!st) return;
    st.camera.x = wx - this.cssW / 2;
    st.camera.y = wy - this.cssH / 2;
    this.clampCam();
  }

  // ----------------------------------------------------------
  // Контекстные команды панели (кнопки + хоткеи).
  // ----------------------------------------------------------
  getCommands() {
    const st = this.state;
    const sel = st.selection.filter((e) => !e.dead);
    const cmds = [];
    if (st.placing) {
      cmds.push({ code: 'Escape', icon: 'stop', label: 'Отмена', on: () => { st.placing = null; } });
      return cmds;
    }
    const b = sel.length === 1 && sel[0].kind === 'building' ? sel[0] : null;
    if (b && b.side === 'player') {
      if (b.done && b.cfg.produces) {
        const list = Array.isArray(b.cfg.produces) ? b.cfg.produces : [b.cfg.produces];
        list.forEach((type, i) => {
          const ut = UNITS[type];
          cmds.push({
            code: PRODUCE_KEYS[i], icon: b.faction === 'alien' ? 'a_' + type : type,
            label: fname(ut, st.factions.player), cost: ut.cost,
            tip: unitTip(type, st.factions.player),
            enabled: () => st.minerals.player >= ut.cost,
            on: () => this.hooks.train(b, type),
          });
        });
      }
      // Лаборатория: исследования улучшений (по одному за раз).
      if (b.done && b.cfg.research) {
        RESEARCH_ORDER.forEach((key, i) => {
          const up = UPGRADES[key];
          const lvl = st.tech.player[key] || 0;
          if (lvl >= up.max) return; // изучено до максимума
          cmds.push({
            code: RESEARCH_KEYS[i], icon: 'u_' + key,
            label: fname(up, st.factions.player) + ' ур.' + (lvl + 1), cost: up.costs[lvl],
            tip: upgradeTip(key, st.factions.player, lvl),
            enabled: () => !b.res && st.minerals.player >= up.costs[lvl],
            on: () => this.hooks.startResearch(b, key),
          });
        });
        if (b.res) {
          cmds.push({
            code: 'KeyX', icon: 'stop', label: 'Отменить',
            on: () => this.hooks.cancelResearch(b),
          });
        }
      }
      // Гарнизон: выпустить пехоту из бункера/кокона.
      if (b.done && b.cfg.garrisonCap && b.garrison.length) {
        cmds.push({
          code: 'KeyF', icon: 'exit',
          label: 'Выпустить ×' + b.garrison.length,
          on: () => { U.releaseGarrison(st, b); this.sound.click(); },
        });
      }
      return cmds;
    }
    const units = sel.filter((e) => e.kind === 'unit' && e.side === 'player');
    if (units.length) {
      const workers = units.filter((u) => u.cfg.canBuild);
      if (workers.length) {
        const fac = st.factions.player;
        if (!st.buildMenu) {
          cmds.push({ code: 'KeyB', icon: 'build', label: 'Строить', on: () => { st.buildMenu = true; } });
        } else {
          for (const [code, type] of BUILD_ORDER) {
            const cfg = BUILDINGS[type];
            cmds.push({
              code, icon: fac === 'alien' ? 'a_' + type : type,
              label: fname(cfg, fac), cost: cfg.cost,
              tip: buildingTip(type, fac),
              enabled: () => st.minerals.player >= cfg.cost,
              on: () => this.hooks.beginPlace(type),
            });
          }
          cmds.push({ code: 'KeyX', icon: 'stop', label: 'Назад', on: () => { st.buildMenu = false; } });
        }
      }
      // «Стоп» не показываем в открытом меню стройки: 7 зданий + «Назад»
      // заполняют компактную сетку 2×4 ровно целиком.
      if (!st.buildMenu) cmds.push({ code: 'KeyS', icon: 'stop', label: 'Стоп', on: () => this.hooks.stopSelected() });
    }
    return cmds;
  }

  makeHooks() {
    const st = () => this.state;
    return {
      centerCamera: (wx, wy) => this.centerCamera(wx, wy),

      issueRMB: (wx, wy) => this.issueRMB(wx, wy),

      beginPlace: (type) => {
        st().buildMenu = false;
        st().placing = { type, tx: -999, ty: -999 };
        this.sound.click();
      },

      tryPlace: (tx, ty) => this.tryPlace(tx, ty),

      train: (b, type) => {
        const r = B.enqueueUnit(st(), b, type);
        if (r === 'money') { ui.toast('Не хватает минералов', 'error'); this.sound.error(); }
        else if (r === 'queue') { ui.toast('Очередь заполнена', 'error'); this.sound.error(); }
        else this.sound.click();
      },

      startResearch: (b, key) => {
        const r = B.startResearch(st(), b, key);
        if (r === 'money') { ui.toast('Не хватает минералов', 'error'); this.sound.error(); }
        else if (r === 'busy') { ui.toast('Лаборатория уже занята исследованием', 'error'); this.sound.error(); }
        else if (r === 'max') { ui.toast('Улучшение изучено до предела', 'error'); }
        else this.sound.click();
      },

      cancelResearch: (b) => { B.cancelResearch(st(), b); this.sound.click(); },

      cancelQueue: (b, i) => B.cancelQueueItem(st(), b, i),

      stopSelected: () => {
        for (const e of st().selection) if (e.kind === 'unit') U.orderStop(e);
        this.sound.click();
      },

      // Атака-движение (A + ЛКМ): боевые юниты выделения идут к точке
      // строем и вступают в бой со всем по дороге.
      issueAttackMove: (wx, wy) => {
        const s = st();
        const units = s.selection.filter((e) => e.kind === 'unit' && e.side === 'player' &&
          !e.dead && !e.garrison && e.cfg.dmg > 0);
        if (!units.length) return;
        // Слоты строя проверяются по карте (не в стене) — как у обычного движения.
        const goals = U.formationGoals(s, units, wx, wy);
        for (let i = 0; i < units.length; i++) {
          U.orderAttackMove(s, units[i], goals[i].x, goals[i].y);
        }
        this.sound.ack();
      },

      assignGroup: (n) => {
        const g = st().selection.filter((e) => e.kind === 'unit' && !e.dead);
        if (g.length) { st().groups[n] = g; this.sound.click(); }
      },

      selectGroup: (n) => {
        const g = (st().groups[n] || []).filter((u) => !u.dead);
        if (g.length) { st().selection = g; st().buildMenu = false; this.sound.click(); }
      },
    };
  }

  // ПКМ: атака врага / добыча кристалла / ремонт / гарнизон /
  // помочь достроить / движение.
  issueRMB(wx, wy) {
    const st = this.state;
    if (!st || st.gameOver) return;
    const sel = st.selection.filter((e) => !e.dead);

    // Выделено своё здание — ставим точку сбора. Точка на кристалле
    // превращает новых рабочих сразу в добытчиков (без «пришёл и стою»).
    if (sel.length === 1 && sel[0].kind === 'building' &&
        sel[0].side === 'player') {
      const rc = U.crystalAt(st, wx, wy);
      sel[0].rally = rc ? { x: wx, y: wy, crystal: rc } : { x: wx, y: wy };
      U.addFloat(st, wx, wy, rc ? 'Сбор у кристалла' : 'Точка сбора', '#9be29e');
      this.sound.ack();
      return;
    }
    const units = sel.filter((e) => e.kind === 'unit' && e.side === 'player');
    if (!units.length) return;

    // 1) Враг — атака.
    const enemyU = U.unitAt(st, wx, wy, 'enemy');
    const bld = B.buildingAt(st, wx, wy);
    if ((enemyU || (bld && bld.side === 'enemy'))) {
      const target = enemyU || bld;
      for (const u of units) U.orderAttack(st, u, target);
      this.sound.ack();
      return;
    }
    // 2) Кристалл — добыча (рабочими), остальные идут за ним.
    const crystal = U.crystalAt(st, wx, wy);
    if (crystal) {
      for (const u of units) {
        if (u.type === 'worker') U.orderGather(st, u, crystal);
        else U.orderMove(st, u, wx, wy);
      }
      this.sound.ack();
      return;
    }
    // 3) Своя постройка: гарнизон → достройка → ремонт.
    const own = bld && bld.side === 'player' ? bld : null;
    if (own) {
      const infantry = units.filter((u) => !u.cfg.canMine && !u.cfg.vehicle && !u.garrison);
      if (own.done && own.cfg.garrisonCap && infantry.length &&
          own.garrison.length < own.cfg.garrisonCap) {
        for (const u of infantry) U.orderGarrison(st, u, own);
        this.sound.ack();
        return;
      }
      if (!own.done) {
        for (const u of units) {
          if (u.cfg.canBuild) U.orderBuild(st, u, own);
          else U.orderMove(st, u, wx, wy);
        }
        this.sound.ack();
        return;
      }
      const repairers = units.filter((u) => u.cfg.canRepair);
      if (own.done && own.hp < own.maxHp && repairers.length) {
        for (const u of repairers) U.orderRepair(st, u, own);
        for (const u of units) if (!u.cfg.canRepair) U.orderMove(st, u, wx, wy);
        this.sound.ack();
        return;
      }
    }
    // 4) Своя повреждённая техника под курсором — ремонт.
    const ownU = U.unitAt(st, wx, wy, 'player');
    if (ownU && ownU.cfg.vehicle && ownU.hp < ownU.maxHp) {
      const repairers = units.filter((u) => u.cfg.canRepair);
      if (repairers.length) {
        for (const u of repairers) U.orderRepair(st, u, ownU);
        for (const u of units) if (!u.cfg.canRepair) U.orderMove(st, u, ownU.x, ownU.y);
        this.sound.ack();
        return;
      }
    }
    // 5) Просто движение.
    U.orderMoveGroup(st, units, wx, wy);
    this.sound.ack();
  }

  // ЛКМ в режиме размещения: проверки → постройка.
  tryPlace(tx, ty) {
    const st = this.state;
    const pl = st.placing;
    if (!pl) return;
    const cfg = BUILDINGS[pl.type];
    const fac = st.factions.player;
    tx = Math.max(0, Math.min(MAP_W - cfg.w, tx));
    ty = Math.max(0, Math.min(MAP_H - cfg.h, ty));
    for (let y = ty; y < ty + cfg.h; y++)
      for (let x = tx; x < tx + cfg.w; x++)
        if (!st.fog.tileExplored(x, y)) {
          ui.toast('Территория не разведана', 'error'); this.sound.error(); return;
        }
    // Требование технологии: у завода нужна казарма/инкубатор.
    if (cfg.requires) {
      const ok = st.buildings.some((b) => !b.dead && b.side === 'player' &&
        b.type === cfg.requires && b.done);
      if (!ok) {
        ui.toast('Сначала постройте: ' + fname(BUILDINGS[cfg.requires], fac), 'error');
        this.sound.error(); return;
      }
    }
    if (!B.canPlace(st.map, tx, ty, cfg.w, cfg.h)) {
      ui.toast('Здесь строить нельзя', 'error'); this.sound.error(); return;
    }
    if (st.minerals.player < cfg.cost) {
      ui.toast('Не хватает минералов', 'error'); this.sound.error(); return;
    }
    const builders = st.selection.filter((e) => e.kind === 'unit' && e.side === 'player' &&
      e.cfg.canBuild && !e.dead);
    if (!builders.length) {
      ui.toast('Выделите ' + fname(UNITS.worker, fac).toLowerCase(), 'error');
      this.sound.error(); return;
    }
    const b = B.placeBuildingCmd(st, 'player', pl.type, tx, ty, builders);
    if (b) { st.placing = null; this.sound.build(); }
  }

  // ----------------------------------------------------------
  // Фиксированный шаг логики.
  // ----------------------------------------------------------
  tick() {
    const st = this.state;
    st.tick++;
    st.time += LOGIC_DT;
    st.repathsThisTick = 0; // новый тик — новый бюджет A* на репути
    st.shakeT = Math.max(0, st.shakeT - LOGIC_DT);
    if (st.shakeT === 0) st.shakeMag = 0;

    updateCamera(this, LOGIC_DT);

    this.grid.clear();
    for (const u of st.units) if (!u.dead && !u.garrison) this.grid.insert(u);

    U.updateUnits(st, LOGIC_DT, this.grid);
    B.updateBuildings(st, LOGIC_DT, this.grid);
    st.units = st.units.filter((u) => !u.dead);
    st.buildings = st.buildings.filter((b) => !b.dead);
    U.syncSelectionFlags(st); // кольца выделения видимы каждый тик
    U.updateProjectiles(st, LOGIC_DT);
    U.updateEffects(st, LOGIC_DT);
    st.ai.update(LOGIC_DT, st);

    if (st.tick % 3 === 0) st.fog.recompute(st);
    calcSupply(st);
    if (st.tick % 2 === 0) {
      ui.update(this);
      ui.setObjective(this.objectiveText());
    }
    if (st.tick % 3 === 0) ui.drawMinimap(this);
    this.checkEnd();
  }

  // Текст цели миссии в верхней панели (с таймерами обороны).
  objectiveText() {
    const st = this.state;
    if (!st) return '';
    const def = this.mission && this.mission.defense;
    if (def) {
      if (st.time < def.prep) {
        return 'Подготовка: ' + fmtTime(def.prep - st.time) + ' — стройте оборону';
      }
      const left = Math.max(0, def.prep + def.total - st.time);
      return 'Оборона: ' + fmtTime(left) + ' · волн отбито: ' + st.defenseWave;
    }
    return this.mission.objective;
  }

  checkEnd() {
    const st = this.state;
    if (st.gameOver) return;
    const def = this.mission && this.mission.defense;
    // Стелс-миссия: база отсутствует — проигрыш по гибели всего отряда.
    if (st.noBase) {
      const alive = st.units.some((u) => u.side === 'player' && !u.dead);
      if (st.bcount.enemy <= 0) {
        this.win('Гнездо разорено — отряд выполнил задачу!');
      } else if (!alive) {
        st.gameOver = 'lose';
        this.sound.lose();
        ui.showEnd(false, st.stats, this.endOpts(false, 'Отряд погиб — миссия провалена'));
      }
      return;
    }
    if (st.bcount.enemy <= 0) {
      this.win('Противник уничтожен!');
    } else if (st.bcount.player <= 0) {
      st.gameOver = 'lose';
      this.sound.lose();
      ui.showEnd(false, st.stats, this.endOpts(false));
    } else if (def && st.time >= def.prep + def.total) {
      this.win('Шаттлы прибыли — оборона выстояла!');
    }
  }

  win(reason) {
    const st = this.state;
    st.gameOver = 'win';
    this.sound.win();
    if (this.mission.id >= 0) saveProgress(this.mission.id + 1);
    ui.showEnd(true, st.stats, this.endOpts(true, reason));
  }

  // Опции экрана финала: следующая миссия, подпись причины.
  endOpts(win, reason) {
    const m = this.mission;
    const opts = {};
    if (reason) opts.reason = reason;
    if (win && m.id >= 0 && m.id < MISSIONS.length - 1) {
      opts.next = MISSIONS[m.id + 1];
    }
    if (win && m.id === MISSIONS.length - 1) opts.campaignDone = true;
    return opts;
  }

  // ----------------------------------------------------------
  // Цикл: накопитель фиксированных тиков + интерполяция рендера.
  // ----------------------------------------------------------
  loop(t) {
    requestAnimationFrame((tt) => this.loop(tt));
    const dt = Math.min(MAX_FRAME_DT, Math.max(0, (t - this.last) / 1000));
    this.last = t;
    if (this.started && !this.paused && this.state && !document.hidden) {
      this.acc += dt;
      let guard = 0;
      while (this.acc >= LOGIC_DT && guard++ < 8) {
        this.tick();
        this.acc -= LOGIC_DT;
      }
    }
    this.render(this.acc / LOGIC_DT);
  }

  // ----------------------------------------------------------
  // Отрисовка кадра: рельеф одним blit → кристаллы → здания →
  // юниты → снаряды → эффекты → туман → UI-слои.
  // ----------------------------------------------------------
  render(alpha) {
    const st = this.state;
    if (!st) return;
    const ctx = this.ctx, W = this.cssW, H = this.cssH;
    const cam = st.camera;

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    // Тряска экрана: затухающие случайные смещения от взрывов/артиллерии.
    if (st.shakeT > 0) {
      const k = st.shakeMag * (st.shakeT / 0.3);
      ctx.save();
      ctx.translate((Math.random() - 0.5) * 2 * k, (Math.random() - 0.5) * 2 * k);
    }

    // Рельеф: один drawImage видимого куска кэша 2048×2048.
    const sw = Math.min(W, WORLD_W - cam.x), sh = Math.min(H, WORLD_H - cam.y);
    if (sw > 0 && sh > 0) {
      ctx.drawImage(st.map.terrainCanvas, cam.x, cam.y, sw, sh, 0, 0, sw, sh);
    }

    const inView = (x, y, m) =>
      x > cam.x - m && x < cam.x + W + m && y > cam.y - m && y < cam.y + H + m;

    // Кристаллы минералов (на разведанной территории).
    for (const c of st.map.crystals) {
      if (c.amount <= 0 || !inView(c.x, c.y, 40)) continue;
      if (!st.fog.tileExplored(c.tx, c.ty)) continue;
      this.drawCrystal(ctx, c, cam.x, cam.y);
    }

    // Здания: свои всегда; вражеские — видимые или «запомненные».
    for (const b of st.buildings) {
      if (b.dead) continue;
      const bx = b.tx * TILE, by = b.ty * TILE;
      if (bx > cam.x + W || by > cam.y + H ||
          bx + b.w * TILE < cam.x || by + b.h * TILE < cam.y) continue;
      const visibleNow = b.side === 'player' ||
        st.fog.tileVisible(b.tx + (b.w >> 1), b.ty + (b.h >> 1));
      if (b.side === 'enemy' && !b.spotted && !visibleNow) continue;
      B.drawBuilding(ctx, b, b.side === 'enemy' && !visibleNow, cam.x, cam.y);
    }

    // Юниты с интерполяцией между логическими тиками.
    for (const u of st.units) {
      if (u.dead || u.garrison) continue;
      if (u.side === 'enemy' && !u.visible) continue;
      const wx = u.prevX + (u.x - u.prevX) * alpha;
      const wy = u.prevY + (u.y - u.prevY) * alpha;
      if (!inView(wx, wy, 30)) continue;
      U.drawUnit(ctx, u, wx - cam.x, wy - cam.y);
    }

    // Маршруты выделенных: пунктирная линия пути + флажок цели.
    // Учит читать приказы: видно, как маршрут огибает препятствия и
    // куда юнит идёт «точно по задаче». Рисуем только для своих —
    // чужие приказы игроку ни к чему.
    this.drawMovePaths(ctx, st, cam, alpha);

    // Снаряды — светящиеся трассеры в цвете команды (бирюза/оранж).
    for (const p of st.projectiles) {
      if (!inView(p.x, p.y, 20)) continue;
      const own = p.src && p.src.side === 'player';
      ctx.save();
      ctx.shadowColor = own ? '#9efded' : '#ffae87';
      ctx.shadowBlur = 8;
      ctx.strokeStyle = own ? '#d9fff0' : '#ffd7a4';
      ctx.lineWidth = p.splash ? 3.5 : 2;
      ctx.beginPath();
      ctx.moveTo(p.x - cam.x, p.y - cam.y);
      ctx.lineTo(p.x - (p.tx - p.x) * 0.03 - cam.x, p.y - (p.ty - p.y) * 0.03 - cam.y);
      ctx.stroke();
      ctx.restore();
    }

    this.drawEffects(ctx, st, inView, cam.x, cam.y);

    // Туман войны поверх мира (мягкие края за счёт масштабирования 64→экран).
    if (st.fog.dirty) st.fog.paint();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(st.fog.canvas, cam.x / TILE, cam.y / TILE, W / TILE, H / TILE, 0, 0, W, H);

    // Рамка выделения — бирюза «Рубежа 64».
    if (this.box) {
      const b = this.box;
      ctx.fillStyle = 'rgba(118,227,215,0.1)';
      ctx.fillRect(Math.min(b.x0, b.x1) - cam.x, Math.min(b.y0, b.y1) - cam.y,
        Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0));
      ctx.strokeStyle = 'rgba(143,255,226,0.9)';
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1.5;
      ctx.strokeRect(Math.min(b.x0, b.x1) - cam.x, Math.min(b.y0, b.y1) - cam.y,
        Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0));
      ctx.setLineDash([]);
    }

    // Призрак размещаемого здания.
    if (st.placing && st.placing.tx > -900) this.drawGhost(ctx, st, cam);

    // Всплывающий текст (+8 минералов и т.п.).
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (const f of st.floats) {
      ctx.globalAlpha = Math.max(0, 1 - f.t / f.life);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x - cam.x, f.y - cam.y);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';

    if (st.shakeT > 0) ctx.restore(); // конец зоны тряски
  }

  // Пунктиры маршрутов выделенных юнитов (см. вызов в render).
  // Цель-точка (move/attackMove) — кольцо-флажок; цель-сущность
  // (атака/добыча/стройка) — линия к ней. Недостижимая цель —
  // красный флажок: игрок сразу видит, что приказ не выполнить.
  drawMovePaths(ctx, st, cam, alpha) {
    let drawn = 0;
    for (const u of st.selection) {
      if (drawn >= 24) break; // толпу целиком не разрисовываем — только первые
      if (!u || u.kind !== 'unit' || u.dead || u.garrison || u.side !== 'player') continue;
      const o = u.order;
      if (!o || o.kind === 'idle') continue;
      const wx = u.prevX + (u.x - u.prevX) * alpha;
      const wy = u.prevY + (u.y - u.prevY) * alpha;
      const bad = u.idleReason === 'unreachable';
      ctx.save();
      ctx.globalAlpha = 0.6;
      ctx.strokeStyle = bad ? '#ff6a5e' : '#8ff5e2';
      ctx.lineWidth = 1.6;
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      ctx.moveTo(wx - cam.x, wy - cam.y);
      let gx = null, gy = null;
      if (u.path && u.pathI < u.path.length) {
        for (let k = u.pathI; k < u.path.length; k++) {
          ctx.lineTo(u.path[k].x - cam.x, u.path[k].y - cam.y);
        }
        const last = u.path[u.path.length - 1];
        gx = last.x; gy = last.y;
      }
      // Цель приказа точнее конца пути: ведём хвостик до неё.
      const tgt = o.target;
      if (tgt && !tgt.dead) {
        gx = tgt.x; gy = tgt.y;
        ctx.lineTo(gx - cam.x, gy - cam.y);
      } else if (o.gx != null) {
        gx = o.gx; gy = o.gy;
        ctx.lineTo(gx - cam.x, gy - cam.y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      if (gx != null) {
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        ctx.arc(gx - cam.x, gy - cam.y, 5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(gx - cam.x, gy - cam.y - 5);
        ctx.lineTo(gx - cam.x, gy - cam.y - 12);
        ctx.stroke();
      }
      ctx.restore();
      drawn++;
    }
  }

  drawCrystal(ctx, c, camX, camY) {
    // Друза из трёх осколков: задний тёмный, главный со свечением,
    // передний светлый + мерцающая искра. Масштаб — от остатка.
    const s = 0.45 + 0.55 * (c.amount / c.max);
    const tw = 0.5 + 0.5 * Math.sin(performance.now() * 0.004 + c.x * 0.7 + c.y);
    ctx.save();
    ctx.translate(c.x - camX, c.y - camY);
    ctx.fillStyle = 'rgba(5,19,24,0.45)';
    ctx.beginPath(); ctx.ellipse(2, 10, 13 * s, 5 * s, 0, 0, Math.PI * 2); ctx.fill();
    ctx.scale(s, s);
    // Осколки породы у основания.
    ctx.fillStyle = '#22333a';
    ctx.beginPath();
    ctx.moveTo(-11, 10); ctx.lineTo(-6, 4); ctx.lineTo(-2, 10);
    ctx.moveTo(4, 11); ctx.lineTo(9, 5); ctx.lineTo(12, 11);
    ctx.fill();
    // Задний осколок — тёмный.
    ctx.fillStyle = '#2e6b7a';
    ctx.beginPath();
    ctx.moveTo(-9, 8); ctx.lineTo(-7, -10); ctx.lineTo(-3, -13); ctx.lineTo(-1, 9);
    ctx.closePath(); ctx.fill();
    // Главный осколок со свечением.
    ctx.shadowColor = '#7ed9e7'; ctx.shadowBlur = 10;
    ctx.fillStyle = '#61b6c8';
    ctx.beginPath();
    ctx.moveTo(-4, 10); ctx.lineTo(-2, -12); ctx.lineTo(3, -16); ctx.lineTo(7, -4); ctx.lineTo(5, 10);
    ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0;
    // Грани главного: светлая и тёмная.
    ctx.fillStyle = '#b9f5ed';
    ctx.beginPath();
    ctx.moveTo(-2, -12); ctx.lineTo(0, -2); ctx.lineTo(-3, 8);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#3b809a';
    ctx.beginPath();
    ctx.moveTo(0, -2); ctx.lineTo(7, -4); ctx.lineTo(5, 10); ctx.lineTo(1, 9);
    ctx.closePath(); ctx.fill();
    // Передний малый осколок — светлый.
    ctx.fillStyle = '#9be4ef';
    ctx.beginPath();
    ctx.moveTo(3, 10); ctx.lineTo(7, -3); ctx.lineTo(10, -1); ctx.lineTo(9, 10);
    ctx.closePath(); ctx.fill();
    // Искра на вершине.
    ctx.fillStyle = 'rgba(230,255,252,' + (0.35 + 0.6 * tw).toFixed(2) + ')';
    ctx.fillRect(-3.5, -17.5, 7, 1.6);
    ctx.fillRect(-0.8, -20, 1.6, 7);
    ctx.restore();
  }

  drawGhost(ctx, st, cam) {
    const pl = st.placing;
    const cfg = BUILDINGS[pl.type];
    const tx = Math.max(0, Math.min(MAP_W - cfg.w, pl.tx));
    const ty = Math.max(0, Math.min(MAP_H - cfg.h, pl.ty));
    let ok = st.minerals.player >= cfg.cost;
    for (let y = ty; y < ty + cfg.h && ok; y++)
      for (let x = tx; x < tx + cfg.w && ok; x++)
        if (st.map.blockedAt(x, y) || !st.fog.tileExplored(x, y)) ok = false;

    ctx.globalAlpha = 0.28;
    ctx.fillStyle = ok ? 'rgba(118,227,215,0.55)' : 'rgba(255,96,87,0.5)';
    ctx.fillRect(tx * TILE - cam.x, ty * TILE - cam.y, cfg.w * TILE, cfg.h * TILE);
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = ok ? '#a8fbe0' : '#ff8a7e';
    ctx.lineWidth = 2;
    ctx.strokeRect(tx * TILE - cam.x + 1, ty * TILE - cam.y + 1, cfg.w * TILE - 2, cfg.h * TILE - 2);
    ctx.globalAlpha = 0.55;
    B.drawBuilding(ctx, {
      tx, ty, w: cfg.w, h: cfg.h, side: 'player', type: pl.type, cfg,
      faction: st.factions.player,
      angle: -Math.PI / 4, garrison: [],
      done: true, progress: 1, hp: 1, maxHp: 1, flashT: 0, selected: false,
    }, false, cam.x, cam.y);
    ctx.globalAlpha = 1;
  }

  drawEffects(ctx, st, inView, camX, camY) {
    for (const e of st.effects) {
      if (!inView(e.x, e.y, 60)) continue;
      const k = e.t / e.life;
      const ex = e.x - camX, ey = e.y - camY;
      if (e.kind === 'boom') {
        const R = (e.big ? 46 : 18) * (0.3 + 0.7 * k);
        ctx.globalAlpha = 1 - k;
        ctx.fillStyle = 'rgba(255,140,50,0.8)';
        ctx.beginPath(); ctx.arc(ex, ey, R, 0, Math.PI * 2); ctx.fill();
        if (k < 0.4) {
          ctx.fillStyle = 'rgba(255,235,140,0.9)';
          ctx.beginPath(); ctx.arc(ex, ey, R * 0.5, 0, Math.PI * 2); ctx.fill();
        }
      } else if (e.kind === 'spark') {
        ctx.globalAlpha = 1 - k;
        ctx.strokeStyle = '#ffe9a8';
        ctx.lineWidth = 1.5;
        const d = 6 * (1 - k) + 2;
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex + Math.cos(e.ang) * d, ey + Math.sin(e.ang) * d);
        ctx.stroke();
      } else if (e.kind === 'muzzle') {
        ctx.globalAlpha = 1 - k;
        ctx.fillStyle = '#fff3b0';
        ctx.beginPath(); ctx.arc(ex, ey, 3.5, 0, Math.PI * 2); ctx.fill();
      } else if (e.kind === 'smoke') {
        // Дым повреждённого здания: поднимающийся серый клуб.
        const a = (1 - k) * 0.35;
        ctx.globalAlpha = a;
        ctx.fillStyle = '#565c64';
        ctx.beginPath();
        ctx.arc(ex, ey - k * 26, 5 + k * 14, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = a * 0.6;
        ctx.fillStyle = '#3a3f45';
        ctx.beginPath();
        ctx.arc(ex + 4, ey - k * 34, 3 + k * 10, 0, Math.PI * 2);
        ctx.fill();
      } else if (e.kind === 'debris') {
        // Обломки/шипики: разлёт из точки смерти с затуханием.
        const d = e.dist * (0.3 + 0.7 * k);
        ctx.globalAlpha = 1 - k;
        ctx.fillStyle = k < 0.4 ? '#ffd977' : '#9aa2ad';
        const dx = ex + Math.cos(e.ang) * d, dy = ey + Math.sin(e.ang) * d - k * 8;
        ctx.fillRect(dx - 1.5, dy - 1.5, 3, 3);
      } else if (e.kind === 'heal') {
        // Зелёный плюсик над леченым юнитом.
        ctx.globalAlpha = 1 - k;
        ctx.strokeStyle = '#7dff9b';
        ctx.lineWidth = 2;
        const r = 4 + k * 2;
        ctx.beginPath();
        ctx.moveTo(ex, ey - r); ctx.lineTo(ex, ey + r);
        ctx.moveTo(ex - r, ey); ctx.lineTo(ex + r, ey);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }
}

// Пересчёт населения: cap — по достроенным зданиям, used — по живым юнитам.
// В стелс-миссии базы нет — отряду ставим виртуальный потолок, чтобы
// производство/подсказки не считали отряд «перезаселением».
function calcSupply(st) {
  st.supply.player.used = 0;
  st.supply.enemy.used = 0;
  for (const u of st.units) if (!u.dead) st.supply[u.side].used += u.cfg.supply;
  for (const side of ['player', 'enemy']) {
    let cap = 0;
    for (const b of st.buildings) {
      if (!b.dead && b.side === side && b.done) cap += b.cfg.supplyGain || 0;
    }
    st.supply[side].cap = (st.noBase && side === 'player') ? 99 : Math.min(cap, SUPPLY_MAX);
  }
}

function fmtTime(sec) {
  const s = Math.max(0, Math.ceil(sec));
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

// --- Запуск ---
const game = new Game();
window.game = game; // отладочная ручка: window.game.state в консоли
