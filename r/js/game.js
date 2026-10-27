// ============================================================
// game.js — точка входа. Состояние партии, фиксированный игровой
// цикл (логика 30 тик/с, отрисовка через requestAnimationFrame с
// интерполяцией), меню кампании/быстрого боя, выбор фракции
// (Гелиос-люди / кхарид-аборигены), миссия-оборона с волнами,
// команды игрока, победа/поражение, рестарт без перезагрузки.
// ============================================================
// ПЕРВЫЙ импорт: изоляция localStorage полигона от S1 (см. storage-ns.js).
import './storage-ns.js?v=10272743';
import { HOUSE, MAX_BUILDING_LEVEL,
  TILE, LOGIC_DT, MAX_FRAME_DT,
  START_MINERALS, BUILDINGS, UNITS, SUPPLY_MAX, BUILDERS_PER_SITE, UPGRADES, GRADES, GRADE_ROMAN, gradeGar, ZOOM_MIN, ZOOM_MAX,
  EDGE_MARGIN, EDGE_ZONE_COLOR,
  fname, fdesc, GAME_VERSION, GAME_DATE,
} from './config.js?v=10272743';
import { GameMap, CC_WORKER_OFFS } from './map.js?v=10272743';
import { Fog } from './fog.js?v=10272743';
import { Sound } from './audio.js?v=10272743';
import * as U from './units.js?v=10272743';
import * as B from './buildings.js?v=10272743';
import { AIController } from './ai.js?v=10272743';
import { MISSIONS, SKIRMISH, loadProgress, saveProgress, objectiveLabel, missionIndex, isUnlocked, missionText, missionKey } from './missions.js?v=10272743';
import * as ui from './ui.js?v=10272743';
import { drawRankMark } from './skins.js?v=10272743';
import { openAdmin, isAdminProfile } from './admin.js?v=10272743';
import { ensureCommander, addXp, supplyBonus, logEvent } from './commander.js?v=10272743';
import { initHomeRaid, updateHomeRaid } from './home-raid.js?v=10272743';
import { openCommander } from './commander-ui.js?v=10272743';
import {
  issueHold, issueRetreatToCC, clearHold, updateSquad, drawSquadZones, combatUnits, ccAnchor,
} from './squad.js?v=10272743';
import { showChests } from './chests-ui.js?v=10272743';
import { createProfile } from './profile.js?v=10272743';
import { attachInput, updateCamera } from './input.js?v=10272743';
import { t, message, has, initI18n, applyStaticDOM, onLocaleChange, setRich } from './i18n.js?v=10272743';
import {
  MAX_LEVEL, ccGate, ccGateProgress, ccLevel as econCcLevel, canGradeBuilding,
  gradeEntry, TECH, unitRank, attackMul, houseLevelOf, HOUSE_LEVELS,
} from './economy.js?v=10272743';
import {
  createRaidSession, captureHomeBaseDTO, buildRaidHomeMission, buildRaidExpeditionMission,
  populateRaidState, updateRaidTick, checkRaidEnd, raidObjectiveText, drawRaidZone,
  validateRaidLoadout, deriveTargetSeed, RAID_PLANET,
  RAID_TIERS, RAID_UNIT_ORDER, unlockedRaidTier, countHomeRoster,
  boardHouseGarrison, boardRingNow,
} from './raid.js?v=10272743';

// Порядок кнопок в меню стройки: клавиша → тип здания.
const BUILD_ORDER = [
  ['KeyQ', 'cc'], ['KeyW', 'depot'], ['KeyE', 'barracks'],
  ['KeyR', 'turret'], ['KeyT', 'bunker'], ['KeyY', 'wall'], ['KeyU', 'factory'],
  ['KeyI', 'lab'],
];
const PRODUCE_KEYS = ['KeyQ', 'KeyW', 'KeyE', 'KeyT']; // H.3: 4-й продукт завода — разведчик
const RESEARCH_KEYS = ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT']; // H.1: 5-й слот лабы — авторемонт
const RESEARCH_ORDER = ['infAtk', 'vehAtk', 'infArm', 'vehArm', 'autoRepair'];

// ------------------------------------------------------------
// F.2: тултип кнопки «Грейд» — что даст следующий уровень (тексты — из локали).
function gradeTip(type, to, fac, g) {
  const lines = [];
  if (g.dmg) lines.push(t('ui.gradeTip.dmg', { d: g.dmg, r: g.range }));
  if (g.rate) lines.push(t('ui.gradeTip.rate', { r: g.rate, q: g.queue }));
  if (g.gar) lines.push(t('ui.gradeTip.gar', { n: g.gar, m: g.hpMul }));
  if (g.hpMul && !g.gar) lines.push(t('ui.gradeTip.hp', { m: g.hpMul }));
  if (type === 'cc') lines.push(to === 2 // H.0: грейды-ключи — разблокировки, не статы
    ? t('ui.gradeTip.opensAuto', { u: fname(UPGRADES.autoRepair, fac) })
    : to <= MAX_LEVEL ? t('ui.gradeTip.opensCmds') : '');
  if (type === 'depot') {
    // Э1: Дом — рейдовая станция: трюм, места, лечение, ход по уровням.
    lines.push(t('ui.gradeTip.house', { s: HOUSE.slotsAt(to), c: HOUSE.cargoAt(to) }));
    if (to >= HOUSE.moveFrom && to - 1 < HOUSE.moveFrom) lines.push(t('ui.gradeTip.houseMove'));
    if (to === 4) lines.push(t('ui.gradeTip.houseHeal', { h: HOUSE.healAt(to) }));
  }
  if (type === 'lab') lines.push(t('ui.gradeTip.lab', { r: g.rate }));
  return { title: t('ui.gradeTip.title', { r: GRADE_ROMAN[to], name: fname(BUILDINGS[type], fac) }), cost: g.cost, lines };
}

// Данные тултипов кнопок панели (подписи юнитов/зданий/улучшений).
// ------------------------------------------------------------
function buildingTip(type, fac) {
  const cfg = BUILDINGS[type];
  const lines = [t('ui.buildTip.stats', { hp: cfg.hp, w: cfg.w, h: cfg.h, t: cfg.buildTime })];
  if (cfg.supplyGain) lines.push(t('ui.buildTip.supply', { n: cfg.supplyGain }));
  if (cfg.produces) {
    const list = Array.isArray(cfg.produces) ? cfg.produces : [cfg.produces];
    lines.push(t('ui.buildTip.trains', { list: list.map((u) => fname(UNITS[u], fac)).join(', ') }));
  }
  if (cfg.attack) lines.push(t('ui.buildTip.attack', { d: cfg.dmg, r: cfg.range }));
  if (cfg.garrisonCap) lines.push(t('ui.buildTip.garrison', { n: cfg.garrisonCap }));
  if (cfg.research) lines.push(t('ui.buildTip.research'));
  if (cfg.requires) lines.push(t('ui.buildTip.requires', { name: fname(BUILDINGS[cfg.requires], fac) }));
  return { title: fname(cfg, fac), cost: cfg.cost, desc: fdesc(cfg, fac), lines };
}
function unitTip(type, fac) {
  const cfg = UNITS[type];
  const lines = [
    t('ui.unitTip.line1', { hp: cfg.hp, d: cfg.dmg, r: cfg.range }),
    t('ui.unitTip.line2', { s: cfg.supply, t: cfg.trainTime }),
  ];
  if (cfg.splash) lines.push(t('ui.unitTip.splash'));
  if (cfg.canHeal) lines.push(t('ui.unitTip.heal', { n: cfg.healRate }));
  if (cfg.vehicle) lines.push(t('ui.unitTip.vehicle'));
  return { title: fname(cfg, fac), cost: cfg.cost, desc: fdesc(cfg, fac), lines };
}
function upgradeTip(key, fac, lvl) {
  const u = UPGRADES[key];
  const per = Math.round((u.perLevel || 0) * 1000) / 10; // 0.04 → 4 (%)
  const lines = [t('ui.upgradeTip.time', { t: u.times[lvl] })];
  if (u.effect === 'atk') lines.push(t('ui.upgradeTip.atk', { p: per, total: Math.round(per * (lvl + 1) * 10) / 10 }));
  else if (u.effect === 'arm') lines.push(t('ui.upgradeTip.arm', { p: per, total: Math.round(per * (lvl + 1) * 10) / 10 }));
  else lines.push(t('ui.upgradeTip.global'));
  lines.push(t('ui.upgradeTip.rankMax', { a: lvl + 1, max: u.max }));
  return {
    title: t('ui.upgradeTip.title', { name: fname(u, fac), n: lvl + 1 }), cost: u.costs[lvl],
    desc: fdesc(u, fac), lines,
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
    this.overUI = false;          // хотфикс L: курсор над панелями (краевой скролл молчит)
    this.edgeT = 0;               // хотфикс L: время непрерывного пребывания в краевой зоне
    this.edgeZone = null;         // хотфикс L: активные краевые зоны {l,r,t,b} для индикатора
    this.cssW = window.innerWidth;
    this.cssH = window.innerHeight;
    this.acc = 0;
    this.last = 0;
    this.grid = new U.SpatialGrid(64);
    // Пакет U: профиль ввода — источник правды об афордансах (зум, отмена
    // стройки, подсказки, kbd). Классы game-touch/game-desktop на <html>
    // ставятся здесь, до первой отрисовки UI.
    this.profile = createProfile();
    this.placementCancelHintShown = false; // одноразовый хинт «ПКМ — отмена» на десктопе
    this.raidSession = null;               // R0: сессия постоянной домашней базы рейда
    this.raidPausedBeforeModal = false;

    window.addEventListener('resize', () => this.resize());
    // Хотфикс M2: fullscreen/поворот экрана. resize-событие приходит ДО того,
    // как панель перестроилась под новые размеры (рефлоу по контенту, перенос
    // строк, шрифты) — getPanelInsets() запоминает устаревшие метрики, кламп
    // камеры фиксируется на них и край карты становится недостижим, пока не
    // передёрнешь панель (скрыть/показать). Домеряем по факту: события
    // fullscreen/orientation + ResizeObserver на панели (панель растёт по
    // содержимому — G.6). Канвас абсолютен (#game-canvas inset:0) и на размер
    // панелей не влияет — цикла наблюдения нет.
    window.addEventListener('orientationchange', () => this.resize());
    document.addEventListener('fullscreenchange', () => this.resize());
    // Пакет Q: гвард пинча страницы на iOS Safari. Meta user-scalable=no iOS
    // игнорирует с iOS 10 (доступность), поэтому единственный надёжный способ —
    // отменять Safari-события жеста. На Chromium-браузерах gesture* не бывают —
    // там pinch закрыт touch-action-политикой (style.css, пакет Q). Игровой
    // щипок канваса живёт на pointer-событиях (input.js) и не страдает:
    // preventDefault на gesture* отменяет только масштабирование страницы.
    const killPageGesture = (e) => e.preventDefault();
    document.addEventListener('gesturestart', killPageGesture);
    document.addEventListener('gesturechange', killPageGesture);
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => this.resize());
      const bp = document.getElementById('bottom-panel');
      const tb = document.getElementById('topbar');
      if (bp) ro.observe(bp);
      if (tb) ro.observe(tb);
    }
    this.resize();
    // Пакет R: visualViewport-устойчивость (системный iOS-зум / AA-зум Safari).
    this.initVVFollow();
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
        enemy: m.enemyFaction || (m.faction === 'alien' ? 'human' : 'alien'), // П8: зеркальные бои задают явно
      },
      minerals: { player: START_MINERALS, enemy: START_MINERALS },
      supply: { player: { used: 0, cap: 0 }, enemy: { used: 0, cap: 0 } },
      units: [], buildings: [], projectiles: [], effects: [], floats: [], pings: [],
      reportedFields: new Set(), lastContactT: -99, lastReconDoneT: -99, autoRepairT: 0,
      selection: [], groups: {}, placing: null, wallDrag: null, buildMenu: false,
      camera: { x: 0, y: 0, z: 1 }, mouseWorld: { x: 0, y: 0 },
      gameOver: null,
      stats: { kills: 0, losses: 0, mined: 0, time: 0 },
      bcount: { player: 0, enemy: 0 },
      defenseWave: 0,
      // Уровни улучшений обеих сторон (растут исследованиями лаборатории).
      tech: {
        player: { infAtk: 0, infArm: 0, vehAtk: 0, vehArm: 0, autoRepair: 0 },
        enemy:  { infAtk: 0, infArm: 0, vehAtk: 0, vehArm: 0, autoRepair: 0 },
      },
      noBase: !!m.noBase,           // стелс-миссия: отряд без базы
      // M0: механическая цель (null = легаси: снеси всё / переживи таймер).
      win: (m.objective && typeof m.objective === 'object') ? m.objective : null,
      loseDeadline: m.loseDeadline ? Object.assign({}, m.loseDeadline, { labelKey: missionKey(m) + '.deadlineLabel' }) : null, // { at, hard, labelKey } — событие по таймеру (метка из локали)
      deadlineFired: false,
      buildZone: m.buildZone || null,       // [{ x,y,w,h }] в тайлах — стройка игрока
      evacuated: 0,                         // погружено в зону эвакуации
      guardLost: false, // П8: потерян ключевой юнит (цветень №17)
      keyTotal: 0,                          // ключевых целей встречено (защита от мгновенной победы)
      phase2: false,                        // П5: фаза 2 двухфазной миссии началась (тост показан)
      shakeT: 0, shakeMag: 0,       // тряска экрана от взрывов
      lastAlertT: -99, lastSupplyToast: -99, lastRepairToast: -99, lastAutoWaitToast: -99,
      lastAlertPos: null, // точка последней тревоги — прыжок по H
    };
    st.map = new GameMap(seed, m.map);
    st.fog = new Fog(st.map.w, st.map.h);
    // С3/П7: стартовый tech врага — исследования 1-го уровня закрыты сразу.
    const startTech = (m.ai && m.ai.startTech) || 0;
    // H: scenario startTech seeds only the four army upgrades; keep new
    // HQ research (autoRepair) outside the AI's fixed research vocabulary.
    if (startTech > 0) for (const key of ['infAtk', 'infArm', 'vehAtk', 'vehArm']) st.tech.enemy[key] = startTech;
    st.game = this;
    this.state = st;
    this.box = null;
    this.paused = false;
    this.raidPausedBeforeModal = false;
    ui.setPausedUI(false);

    if (m.raidMode) {
      populateRaidState(this, st, m);
    }

    // Стартовые базы: командный центр + рабочие (враг — зеркален).
    for (const side of ['player', 'enemy']) {
      const base = st.map.bases[side];
      if (side === 'player' && (st.noBase || m.raidMode)) continue; // стелс-миссия или рейд
      if (side === 'enemy' && m.noEnemyBase) continue;
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
      if (st.factions.enemy === 'alien') {
        // П8: жвала — по фракции врага (было: по фракции игрока; поведение то же).
        this.placeEnemyTurrets(st, e, 2);
      }
    }

    // П8: достроенные здания врага у его базы (склады №17).
    if (m.enemyExtra) {
      const e = st.map.bases.enemy.cc;
      for (const ex of m.enemyExtra) {
        const cfg = BUILDINGS[ex.type];
        const tx = e.x + ex.dx, ty = e.y + ex.dy;
        if (!B.canPlace(st.map, tx, ty, cfg.w, cfg.h)) continue;
        const xb = new B.Building(st, 'enemy', ex.type, tx, ty, true);
        st.map.markBuilding(xb);
        st.bcount.enemy++;
      }
    }
    st.ai = new AIController({ ...m.ai, defense: m.defense });
    calcSupply(st);
    st.fog.recompute(st);

    // Камера — на базу игрока (или на челночную площадку вылазки).
    const pb = st.map.bases.player.cc;
    if (st.raidDrop) this.centerCamera(st.raidDrop.x, st.raidDrop.y);
    else this.centerCamera((pb.x + 2) * TILE, (pb.y + 2) * TILE);

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
    if (!m.raidMode) this.syncRaidHomeSnapshot();
    this.mission = m;
    this.newGame();
    this.started = true;
    this.sleepMouse(); // T2: stale-позиция меню не включает краевой скролл
    ui.hideStart();
    ui.hideMissions();
    ui.hideBrief();
    ui.hideEnd();
    ui.hideRaidLaunch();
    ui.toast(m.raidMode ? this.objectiveText() : objectiveLabel(m));
  }

  // G.5: dims {w,h} из пресетов скирмиша; без них — классика 64×64.
  // Биом оставляем сид-рандомом (на баланс не влияет, кликов меньше).
  startSkirmish(faction, dims) {
    const seed = (Math.random() * 0xFFFFFFFF) >>> 0;
    const biome = ['mars', 'nest', 'moon'][seed % 3];
    const w = (dims && dims.w) || 64, h = (dims && dims.h) || 64;
    this.startMission({
      ...SKIRMISH,
      id: -1,
      faction,
      map: {
        seed, biome, w, h,
        lakes: 'default', rocks: 6 + (seed % 5),
        rich: 1 + ((seed >> 4) % 3) * 0.15,
        base: { x: 8, y: h - 16 }, // G.5: база масштабируется с высотой (64→48 как раньше)
      },
    });
  }

  // ---------- R0: локальный raid-loop (домашняя база и вылазка) ----------
  hasRaidHome() {
    return !!(this.raidSession && this.raidSession.starterGiftClaimed);
  }

  syncRaidHomeSnapshot() {
    if (this.raidSession && this.state && this.state.raidMode === 'home' && !this.state.gameOver) {
      this.raidSession.homeDto = captureHomeBaseDTO(this.state, this.raidSession, new Set());
    }
  }

  startRaidHome(faction, { forceNew = false } = {}) {
    if (!this.raidSession || forceNew || (!this.hasRaidHome() && faction)) {
      const side = faction || (this.raidSession && this.raidSession.faction) || 'human';
      this.raidSession = createRaidSession(side);
    } else {
      this.syncRaidHomeSnapshot();
      this.raidSession.activeExpedition = null;
      this.raidSession.pendingReturn = null;
    }
    this.startMission(buildRaidHomeMission(this.raidSession));
    // Э7: на домашней базе живёт командир (капитан → генерал) и тикает
    // расписание входящих рейдов. На вылазке командир остаётся на базе.
    if (this.state && this.state.raidMode === 'home') {
      ensureCommander(this.state);
      initHomeRaid(this.state);
    }
    ui.syncRaidMenu(this);
  }

  // Э7: события обороны базы → тосты, звук и метка на миникарте.
  handleHomeRaidEvent(ev) {
    const st = this.state;
    if (!st || !ev) return;
    if (ev.type === 'warn') {
      ui.toast(t('ui.commander.warnToast', { s: ev.seconds }), 'warn', 4200);
      this.sound.ping();
      const cc = st.buildings.find((b) => b.side === 'player' && b.type === 'cc' && !b.dead);
      if (cc) st.pings.push({ x: cc.x, y: cc.y, t: 0 });
    } else if (ev.type === 'incoming') {
      ui.toast(t('ui.commander.incomingToast', { n: ev.wave }), 'error', 4200);
      this.sound.alarm();
    } else if (ev.type === 'repelled') {
      if (ev.training) {
        ui.toast(t('ui.commander.trainingWin'), 'info', 3000);
      } else {
        ui.toast(ev.levelUp
          ? t('ui.commander.repelledToastXp', { erg: ev.reward, n: ev.level })
          : t('ui.commander.repelledToast', { erg: ev.reward }), 'info', 3600);
        this.sound.win();
        if (ev.salvage) {
          ui.toast(t('ui.commander.salvageToast', { erg: ev.salvage, s: 90 }), 'warn', 5000);
        }
      }
    } else if (ev.type === 'salvageGone') {
      ui.toast(t('ui.commander.salvageGone'), 'warn', 3200);
    }
  }

  resetRaidHome(faction) {
    const side = faction || (this.raidSession && this.raidSession.faction) || 'human';
    this.raidSession = createRaidSession(side);
    ui.syncRaidMenu(this);
  }

  nextRaidSeed(tier = 1) {
    const seq = this.raidSession ? this.raidSession.raidSeq : 0;
    return deriveTargetSeed(RAID_PLANET.homeSeed, seq, tier);
  }

  getRaidConsoleModel(draft) {
    const st = this.state;
    const unlockedTier = unlockedRaidTier(st);
    const roster = countHomeRoster(st);
    const homeMinerals = st ? Math.max(0, Math.floor(Number(st.minerals.player) || 0)) : 0;
    const raidSeq = this.raidSession ? this.raidSession.raidSeq : 0;
    const validation = draft ? validateRaidLoadout(st, draft) : null;
    // Э1: мест в челноке не больше, чем даёт грейд Дома — консоль показывает
    // реальный лимит тира, а не «до 22 ед.» при Доме-Г2.
    const houseSlots = HOUSE.slotsAt(Math.max(2, houseLevelOf(st) || 2));
    const tiers = RAID_TIERS.map((t) => (t.maxUnits <= houseSlots ? t : { ...t, maxUnits: houseSlots }));
    // #36 З3: реальный лимит вылазки — ТРЮМ ДОМА (канон владельца «лимит —
    // сколько он может увезти»), а не «эрг на карте». Консоль показывает это
    // число вместо фейкового yieldTotal.
    const houseLevel = Math.max(2, houseLevelOf(st) || 2);
    const cargoCap = HOUSE_LEVELS.cargo(houseLevel);
    return {
      unlockedTier,
      houseSlots,
      houseLevel,
      cargoCap,
      tiers,
      unitOrder: RAID_UNIT_ORDER,
      roster,
      homeMinerals,
      raidSeq,
      validation,
    };
  }

  // Э6: награда-юнит из капсулы. Ставим рядом с КЦ на свободный тайл,
  // не ломая население: если места нет — юнит всё равно появится (подарок).
  spawnRewardUnit(st, type, tx, ty) {
    if (!st || !UNITS[type]) return null;
    const cc = (st.buildings || []).find((b) => !b.dead && b.done && b.side === 'player' && b.type === 'cc');
    const cx = cc ? cc.tx + 2 : (tx | 0);
    const cy = cc ? cc.ty + 4 : (ty | 0);
    for (let r = 0; r < 8; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const gx = cx + dx, gy = cy + dy;
          if (!st.map.inBounds(gx, gy) || st.map.blockedAt(gx, gy)) continue;
          const u = U.spawnUnit(st, 'player', type, (gx + 0.5) * TILE, (gy + 0.5) * TILE, type === 'worker');
          if (u) return u;
        }
      }
    }
    return null;
  }

  // Э4: «Собрать всех» — все свободные юниты базы идут в отсек Дома.
  // Берём ближайших к Дому, чтобы отряд собирался быстро и предсказуемо.
  loadAllIntoHouse(house) {
    const st = this.state;
    if (!st || !house || house.dead) return 0;
    const cap = U.unitCapOf(house);
    const inside = house.garrison ? house.garrison.length : 0;
    let free = Math.max(0, cap - inside);
    if (!free) { ui.toast(t('ui.cmds.bayFull', { n: cap }), 'warn'); return 0; }
    if (st.raidMode === 'expedition') { ui.toast(t('ui.cmds.bayHomeOnly'), 'warn'); return 0; }
    const pool = st.units
      .filter((u) => !u.dead && !u.garrison && !u.evacuated && u.side === 'player' && u.kind === 'unit')
      .sort((a, b2) => Math.hypot(a.x - house.x, a.y - house.y) - Math.hypot(b2.x - house.x, b2.y - house.y));
    let n = 0;
    for (const u of pool) {
      if (free <= 0) break;
      U.orderGarrison(st, u, house);
      free--; n++;
    }
    if (n) { this.sound.ack(); ui.toast(t('ui.cmds.bayLoading', { n }), 'info'); }
    else ui.toast(t('ui.cmds.bayEmpty'), 'warn');
    return n;
  }

  openRaidLaunch() {
    if (!this.started || !this.state || this.state.raidMode !== 'home' || this.state.gameOver) return;
    if (ui.isRaidOverlayOpen()) return;
    this.raidPausedBeforeModal = this.paused;
    this.paused = true;
    ui.showRaidLaunch(this);
    this.sound.click();
  }

  closeRaidLaunch() {
    if (!ui.isRaidOverlayOpen()) return;
    ui.hideRaidLaunch();
    this.paused = !!this.raidPausedBeforeModal;
    this.raidPausedBeforeModal = false;
    this.sound.click();
  }

  launchRaidExpedition(draft) {
    const st = this.state;
    const v = validateRaidLoadout(st, draft);
    if (!v.ok || !this.raidSession) return v;

    const dispatchedIds = new Set();
    const dispatchedList = [];
    // Э4: приоритет — отряд, уже погружённый в отсек Дома (игрок сам решил,
    // кого взять). Остаток добираем со свободных юнитов базы.
    const homeBay = (st.buildings || []).find((b) => !b.dead && b.done && b.side === 'player'
      && b.type === 'depot' && (b.level || 1) >= 2 && b.garrison && b.garrison.length);
    for (const [type, need] of Object.entries(v.units)) {
      if (!need) continue;
      const fromBay = homeBay
        ? homeBay.garrison.filter((u) => !u.dead && u.type === type).sort((a, b) => b.hp - a.hp || a.id - b.id)
        : [];
      const fromBase = st.units
        .filter((u) => !u.dead && !u.garrison && u.side === 'player' && u.kind === 'unit' && u.type === type)
        .sort((a, b) => b.hp - a.hp || a.id - b.id);
      const pool2 = fromBay.concat(fromBase);
      for (let i = 0; i < need && i < pool2.length; i++) {
        dispatchedIds.add(pool2[i].id);
        dispatchedList.push({ type: pool2[i].type, hp: Math.max(1, Math.ceil(pool2[i].hp)) });
        if (pool2[i].garrison) pool2[i].garrison = null; // уходит в челнок
      }
    }

    st.minerals.player = Math.max(0, Math.floor(st.minerals.player) - v.budget);
    this.raidSession.raidSeq++;
    this.raidSession.homeDto = captureHomeBaseDTO(st, this.raidSession, dispatchedIds);
    this.raidSession.activeExpedition = {
      tier: v.tier,
      seed: v.seed,
      budget: v.budget,
      units: dispatchedList,
      // Э1: грейд Дома-шаттла летит с отрядом — от него трюм и места.
      houseLevel: houseLevelOf(st),
    };

    ui.hideRaidLaunch();
    this.raidPausedBeforeModal = false;
    this.paused = false;
    this.mission = buildRaidExpeditionMission(this.raidSession, v);
    this.newGame();
    this.started = true;
    this.sleepMouse();
    ui.syncRaidMenu(this);
    ui.toast(t('ui.raid.toastLaunch', { tier: v.tier, n: v.totalUnits }), 'info');
    this.sound.ready();
    return v;
  }

  triggerRaidEvac() {
    const st = this.state;
    if (!st || st.raidMode !== 'expedition' || st.gameOver) return;
    const pad = st.raidDrop;
    if (!st.raidEvacuating) {
      // НАЖАТИЕ 1 — маяк. #36 З1: отсек Дома считается ДОСТАВЛЕННЫМ (владелец:
      // «все собрались внутри»), а приказ сбрасывается у ВСЕХ полевых, включая
      // стоящих в кольце с добычей (раньше movers-фильтр трогал только тех,
      // кто снаружи, и рабочий уходил бурить посреди эвакуации).
      st.raidEvacuating = true;
      boardHouseGarrison(this, st);
      for (const u of U.fieldUnits(st)) U.orderEvacHold(st, u, pad);
      ui.update(this);
      ui.setObjective(this.objectiveText());
      ui.toast(t('ui.raid.toastEvacStart'), 'info');
      this.sound.ping();
      return;
    }
    // НАЖАТИЕ 2 — ВСЕГДА ВЗЛЁТ (слово владельца 26.10: «второй клик всегда
    // взлёт», ровно п.4 спеки #36 З1). Ветки ОТМЕНЫ нет, «финального сбора»
    // нет: сначала мгновенно сажаем всех, кто уже в кольце (без удержания 2 с),
    // затем поднимаем челнок. Кто не успел — остаётся на планете, и это честно
    // видно в отчёте возврата («на борту n/sent»). Дедлок невозможен.
    boardRingNow(this, st);
    this.finishRaidExpedition('evac');
  }

  finishRaidExpedition(outcome) {
    const st = this.state;
    if (!st || st.raidMode !== 'expedition' || !this.raidSession) return;
    const ok = outcome === 'evac';
    const cargo = ok ? Math.max(0, Math.floor(st.raidCargo || 0)) : 0;
    const returnedBudget = ok ? Math.max(0, Math.floor(st.minerals.player || 0)) : 0;
    // Э4: что не влезло в трюм и что осталось на карте — честно в отчёте.
    const overflow = ok ? Math.max(0, Math.floor(st.raidCargoLost || 0)) : 0;
    const leftOnMap = Math.max(0, Math.floor(st.raidLootLeft || 0));
    const boarded = ok && Array.isArray(st.raidBoarded) ? st.raidBoarded.slice() : [];
    const sentCount = st.raidInitialCount || 0;

    this.raidSession.lastReturn = {
      outcome: ok ? 'evac' : 'wiped',
      cargo,
      returnedBudget,
      boardedCount: boarded.length,
      sentCount,
      tier: st.raidTier || 1,
      seed: st.raidTargetSeed || st.seed,
      overflow,
      leftOnMap,
    };
    this.raidSession.pendingReturn = { cargo, returnedBudget, boarded };
    this.raidSession.activeExpedition = null;

    ui.hideEnd();
    ui.hideRaidLaunch();
    this.mission = buildRaidHomeMission(this.raidSession);
    this.newGame();
    this.started = true;
    this.sleepMouse();
    ui.syncRaidMenu(this);
    // Э7: вылет — это служба командира. Опыт только за успешный возврат.
    if (ok && this.state) {
      const c = ensureCommander(this.state);
      c.stats.raids++;
      const gained = addXp(this.state, 40 + (Number(st.raidTier) || 1) * 6);
      logEvent(this.state, t('ui.commander.logRaid', { tier: Number(st.raidTier) || 1 }), 'info');
      if (gained.levelUp) ui.toast(t('ui.commander.levelUpToast', { n: gained.level }), 'info', 3200);
    }
    if (ok) {
      let extra = '';
      if (overflow > 0) extra += ' ' + t('ui.raid.toastOverflow', { n: overflow });
      if (leftOnMap > 0) extra += ' ' + t('ui.raid.toastLeft', { n: leftOnMap });
      ui.toast(t('ui.raid.toastReturnOk', {
        cargo: cargo + returnedBudget,
        n: boarded.length,
        sent: sentCount,
      }) + extra, overflow > 0 ? 'warn' : 'info');
      this.sound.win();
    } else {
      ui.toast(t('ui.raid.toastReturnWiped'), 'error');
      this.sound.lose();
    }
  }

  restart() {
    ui.hideEnd();
    ui.hideRaidLaunch();
    if (this.state && this.state.raidMode === 'expedition') {
      this.finishRaidExpedition('wiped');
      return;
    }
    if (this.state && this.state.raidMode === 'home' && this.raidSession) {
      this.raidSession = createRaidSession(this.raidSession.faction);
      this.mission = buildRaidHomeMission(this.raidSession);
      ui.syncRaidMenu(this);
    }
    this.newGame();
    this.started = true;
    this.sleepMouse();
    ui.hideStart();
    ui.toast(this.mission.raidMode ? this.objectiveText() : objectiveLabel(this.mission));
    this.sound.click();
  }

  togglePause() {
    if (!this.started || (this.state && this.state.gameOver)) return;
    if (ui.isRaidOverlayOpen()) { this.closeRaidLaunch(); return; }
    this.paused = !this.paused;
    ui.setPausedUI(this.paused);
    this.sound.click();
  }

  toggleSound() {
    ui.setSoundUI(this.sound.toggle());
  }

  // ---------- Пакет R: следование за visualViewport ----------
  // Системный iOS-зум (три пальца) и принудительный AA-зум Safari вебом не
  // блокируются — пакет Q закрыл только зум страницы. При scale>1.01 видимая
  // область — «дырка» в layout viewport: канвас и HUD следуют за ней через
  // CSS-переменные --vv-* (style.css, html.vv-follow). Обещать авто-выход
  // нельзя (веб не сбрасывает системный зум) — одноразовый тост «верните
  // масштаб щипком» (ui.vvHintOnce).
  initVVFollow() {
    this.vvActive = false;
    const bind = () => {
      const v = window.visualViewport;
      if (!v || v.__vvBound) return;
      v.__vvBound = true;
      v.addEventListener('resize', () => this.applyVV());
      v.addEventListener('scroll', () => this.applyVV());
    };
    bind();
    // Тест-хук: в Playwright/стендах window.visualViewport подменяется ПОСЛЕ
    // загрузки модуля — слушатели реального vv его не увидят. ac-vv-check
    // перечитывает window.visualViewport и пересчитывает режим.
    window.addEventListener('ac-vv-check', () => { bind(); this.applyVV(); });
    this.applyVV();
  }

  applyVV() {
    const v = window.visualViewport;
    if (!v) return;
    const zoomed = Number(v.scale) > 1.01;
    const root = document.documentElement;
    if (zoomed) {
      root.classList.add('vv-follow');
      root.style.setProperty('--vv-x', Math.round(Number(v.offsetLeft) || 0) + 'px');
      root.style.setProperty('--vv-y', Math.round(Number(v.offsetTop) || 0) + 'px');
      root.style.setProperty('--vv-w', Math.round(Number(v.width) || window.innerWidth) + 'px');
      root.style.setProperty('--vv-h', Math.round(Number(v.height) || window.innerHeight) + 'px');
      if (!this.vvActive) {
        this.vvActive = true;
        ui.vvHintOnce(); // одноразовая подсказка (не обещаем авто-выход)
      }
      this.resize(Math.round(Number(v.width) || window.innerWidth), Math.round(Number(v.height) || window.innerHeight));
    } else if (this.vvActive) {
      this.vvActive = false;
      root.classList.remove('vv-follow');
      for (const p of ['--vv-x', '--vv-y', '--vv-w', '--vv-h']) root.style.removeProperty(p);
      this.resize(); // возврат к layout viewport
    }
  }

  // Пакет R (V2, MOBILE_VIEWPORT_AUDIT.md §6): подстройка буфера под заданную
  // область. По умолчанию — layout viewport (как раньше); в режиме следования
  // за visualViewport applyVV() передаёт размеры видимой области.
  resize(w = window.innerWidth, h = window.innerHeight) {
    this.cssW = w;
    this.cssH = h;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(this.cssW * dpr);
    this.canvas.height = Math.round(this.cssH * dpr);
    this.canvas.style.width = this.cssW + 'px';
    this.canvas.style.height = this.cssH + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Aspect-aware minimap sizing may change panel geometry; update it before
    // reading the actual DOM insets so camera clamps use the final layout.
    ui.resizeMinimap(this);
    // Размеры панелей UI — чтобы краевой скролл не срабатывал над ними.
    // Инсеты командной панели — из её положения E.1 (DOM-метрики врут
    // при боковых положениях: offsetHeight там во весь экран).
    const ins = ui.getPanelInsets();
    this.uiTop = (document.getElementById('topbar')?.offsetHeight || 0) + ins.top;
    this.uiBottom = ins.bottom;
    this.uiLeft = ins.left;
    this.uiRight = ins.right;
    this.clampCam();
    // Пакет U: media-базис может смениться (подключили мышь к планшету) —
    // пересчитываем профиль, классы и афордансы.
    if (this.profile) this.profile.refresh();
    ui.refreshLayout(this);
  }

  // Видимый размер мира в пикселях при текущем зуме.
  viewW() { return this.cssW / ((this.state && this.state.camera.z) || 1); }
  viewH() { return this.cssH / ((this.state && this.state.camera.z) || 1); }

  // Хотфикс T2: мышь в «сонное» состояние — краевой скролл спит,
  // пока не появится настоящее движение настоящей мыши.
  sleepMouse() {
    this.mouse.x = -1; this.mouse.y = -1;
    this.edgeT = 0; this.edgeZone = null; this.overUI = false;
  }

  // Хотфикс T3 (guard-система отрисовки): сбойный элемент пропускается,
  // кадр живёт — на незнакомых устройствах игра не превращается в чёрный
  // экран, а в консоли остаётся ровно одна диагностика на тип сбоя.
  drawWarnOnce(key, e) {
    if (!this.drawWarned) this.drawWarned = new Set();
    if (this.drawWarned.has(key)) return;
    this.drawWarned.add(key);
    try { console.warn('[draw-skip] ' + key + ': ' + ((e && e.message) || e)); } catch { /* консоль может отсутствовать */ }
  }

  // G.2: видимая область (канвас минус инсеты панели/топбара) в px мира.
  visW() { return (this.cssW - (this.uiLeft || 0) - (this.uiRight || 0)) / ((this.state && this.state.camera.z) || 1); }
  visH() { return (this.cssH - (this.uiTop || 0) - (this.uiBottom || 0)) / ((this.state && this.state.camera.z) || 1); }

  clampCam() {
    const st = this.state;
    if (!st) return;
    // G.2: кламп по видимой области — за панелью прячется пустота, а не карта.
    // Без инсетов сводится к старому [0, pxW-viewW]. Карта меньше видимой —
    // центрируем (середина [lo, hi] при hi < lo — ровно центр карты).
    const z = st.camera.z || 1;
    const vw = this.cssW / z, vh = this.cssH / z;
    const L = (this.uiLeft || 0) / z, R = (this.uiRight || 0) / z;
    const T = (this.uiTop || 0) / z, B = (this.uiBottom || 0) / z;
    const loX = -L, hiX = st.map.pxW - vw + R;
    const loY = -T, hiY = st.map.pxH - vh + B;
    st.camera.x = hiX < loX ? (loX + hiX) / 2 : Math.max(loX, Math.min(hiX, st.camera.x));
    st.camera.y = hiY < loY ? (loY + hiY) / 2 : Math.max(loY, Math.min(hiY, st.camera.y));
  }

  centerCamera(wx, wy) {
    const st = this.state;
    if (!st) return;
    // G.2: цель — в центр ВИДИМОЙ области (все прыжки: Пробел/H/Tab/отряды).
    const z = st.camera.z || 1;
    const L = this.uiLeft || 0, R = this.uiRight || 0;
    const T = this.uiTop || 0, B = this.uiBottom || 0;
    st.camera.x = wx - (L + (this.cssW - L - R) / 2) / z;
    st.camera.y = wy - (T + (this.cssH - T - B) / 2) / z;
    this.clampCam();
  }

  // Экран (CSS-пиксели от левого верхнего угла канваса) ↔ мир.
  screenToWorld(sx, sy) {
    const cam = this.state.camera;
    const z = cam.z || 1;
    return { x: cam.x + sx / z, y: cam.y + sy / z };
  }
  worldToScreen(wx, wy) {
    const cam = this.state.camera;
    const z = cam.z || 1;
    return { x: (wx - cam.x) * z, y: (wy - cam.y) * z };
  }

  // П2/G.5: зум ZOOM_MIN–ZOOM_MAX с якорем: мировая точка под (ax, ay) стоит на месте.
  // Якорь — в CSS-пикселях экрана; без якоря — центр экрана.
  setZoom(nz, ax = this.cssW / 2, ay = this.cssH / 2) {
    const st = this.state;
    if (!st) return;
    nz = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, nz)); // G.5
    const cam = st.camera;
    const z0 = cam.z || 1;
    cam.x = cam.x + ax / z0 - ax / nz;
    cam.y = cam.y + ay / z0 - ay / nz;
    cam.z = nz;
    this.clampCam();
  }

  // П2: выход в главное меню. Прогресс кампании не трогаем (сейвы целы):
  // записывается он только победой. Состояние партии остаётся фоном меню.
  toMenu() {
    this.syncRaidHomeSnapshot();
    if (this.raidSession && this.state && this.state.raidMode === 'expedition') {
      this.raidSession.activeExpedition = null;
      this.raidSession.pendingReturn = null;
    }
    this.started = false;
    this.paused = false;
    this.raidPausedBeforeModal = false;
    this.box = null;
    if (this.state) { this.state.placing = null; this.state.attackMoveMode = false; }
    ui.setPausedUI(false);
    ui.hideEnd();
    ui.hideMissions();
    ui.hideBrief();
    ui.hideCodex();
    ui.hideRaidLaunch();
    ui.syncRaidMenu(this);
    ui.showStart();
    this.sound.click();
  }

  // ----------------------------------------------------------
  // Контекстные команды панели (кнопки + хоткеи).
  // ----------------------------------------------------------
  getCommands() {
    const st = this.state;
    const sel = st.selection.filter((e) => !e.dead);
    const cmds = [];
    if (st.placing) {
      cmds.push({
        code: 'KeyX', icon: 'stop', label: t('ui.placement.cancel'),
        on: () => this.hooks.cancelPlacement(),
      });
      for (const [code, type] of BUILD_ORDER) {
        if (!isUnlocked(this.mission, type)) continue;
        const cfg = BUILDINGS[type];
        cmds.push({
          code, icon: st.factions.player === 'alien' ? 'a_' + type : type,
          label: fname(cfg, st.factions.player), cost: cfg.cost,
          tip: buildingTip(type, st.factions.player), selected: st.placing.type === type,
          on: () => this.hooks.beginPlace(type),
        });
      }
      return cmds;
    }
    const b = sel.length === 1 && sel[0].kind === 'building' ? sel[0] : null;
    if (b && b.side === 'player') {
      if (b.done && b.cfg.produces) {
        const list = Array.isArray(b.cfg.produces) ? b.cfg.produces : [b.cfg.produces];
        list.forEach((type, i) => {
          if (!isUnlocked(this.mission, type)) return; // П8/С1: неоткрытое не показываем (хоткей стабилен)
          const ut = UNITS[type];
          cmds.push({
            code: PRODUCE_KEYS[i], icon: b.faction === 'alien' ? 'a_' + type : type,
            label: fname(ut, st.factions.player), cost: ut.cost,
            // Э1: бейдж ранга, с которым выйдет юнит (находка владельца:
            // «не видно уровней юнитов в командном меню»).
            level: unitRank(st, 'player', ut) + 1,
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
          // H.1: ресерч за грейдом виден замком (кнопка неактивна + строка в типе).
          const ccl = econCcLevel(st, 'player');
          // Э1 (правило R3): ранг юнита не выше уровня КЦ.
          const locked = (up.requiresGrade && ccl < up.requiresGrade.level) || (lvl + 1 > ccl);
          const tip = upgradeTip(key, st.factions.player, lvl);
          let lock = '';
          if (locked) {
            lock = up.requiresGrade && ccl < up.requiresGrade.level
              ? message('needCC2', st.factions.player)
              : t('ui.cmds.needCc', { n: lvl + 1 });
            tip.lines.push(lock);
          }
          cmds.push({
            code: RESEARCH_KEYS[i], icon: 'u_' + key,
            label: fname(up, st.factions.player) + t('ui.cmds.rankArrow', { a: lvl, b: lvl + 1 }) + (locked ? t('ui.cmds.lockMark') : ''), cost: up.costs[lvl],
            level: lvl + 1, lock,
            tip,
            enabled: () => !locked && !b.res && st.minerals.player >= up.costs[lvl],
            on: () => this.hooks.startResearch(b, key),
          });
        });
        if (b.res) {
          cmds.push({
            code: 'KeyX', icon: 'stop', label: t('ui.cmds.undo'),
            on: () => this.hooks.cancelResearch(b),
          });
        }
      }
      // Гарнизон: выпустить пехоту из бункера/кокона.
      if (b.done && b.cfg.garrisonCap && b.garrison.length) {
        cmds.push({
          code: 'KeyF', icon: 'exit',
          label: t('ui.cmds.deploy', { n: b.garrison.length }),
          on: () => { U.releaseGarrison(st, b); this.sound.click(); },
        });
      }
      // Э1: ГРЕЙД ЗДАНИЯ 1→20. Кнопка показывается ВСЕГДА, когда грейд
      // возможен в принципе, и честно объясняет, что мешает (находка
      // владельца: «не всегда показываются кнопки» — раньше кнопка молча
      // исчезала при упоре в уровень КЦ).
      // На карте вылазки грейдить нечего: КЦ там нет (banBuild), Дом-шаттл
      // грейдится только на базе — иначе кнопка была бы вечно «закрыта».
      if (b.done && !b.gradeUp && st.raidMode !== 'expedition' && (b.level || 1) < MAX_BUILDING_LEVEL && GRADES[b.type]) {
        const to = (b.level || 1) + 1;
        const g = gradeEntry(b.type, to);
        const chk = canGradeBuilding(st, 'player', b);
        const lines = [];
        let lock = '';
        if (chk.code === 'cclow') {
          lock = t('ui.cmds.needCc', { n: chk.needCc });
          lines.push(lock);
        }
        if (chk.code === 'gate') {
          const gateLines = [t('ui.cmds.needGate', { have: chk.gate.have, need: chk.gate.need, lvl: GRADE_ROMAN[chk.gate.minLevel] })];
          // R2b: с КЦ→11 в наборе нужны «развитые» здания (казарма/завод/лаба/Дом).
          if (chk.gate.eliteNeed > 0) {
            gateLines.push(t('ui.cmds.needGateElite', { have: chk.gate.eliteHave, need: chk.gate.eliteNeed }));
          }
          lock = gateLines.join(' · ');
          lines.push(...gateLines);
        }
        const tip = gradeTip(b.type, to, st.factions.player, g);
        if (lines.length) tip.lines.push(...lines);
        cmds.push({
          // В лаборатории KeyR занят исследованием «Плиты техники», поэтому
          // грейд там висит на Y — иначе горячая клавиша молча уводила в ресерч.
          code: b.cfg.research ? 'KeyY' : 'KeyR', icon: 'grade',
          label: t('ui.cmds.grade', { r: GRADE_ROMAN[to] }) + (chk.ok ? '' : t('ui.cmds.lockMark')),
          cost: g.cost, level: to, lock,
          tip,
          enabled: () => canGradeBuilding(st, 'player', b).ok,
          on: () => this.hooks.startGrade(b),
        });
      }
      // H.3/H.4: командование КЦ Г3 — разведка и общий сбор.
      if (b.done && b.type === 'cc' && (b.level || 1) >= 3) {
        cmds.push({
          code: 'KeyT', icon: 'recon', label: t('ui.cmds.recon'),
          tip: { title: t('ui.cmds.recon'), lines: t('ui.cmds.reconTip') },
          on: () => this.hooks.orderRecon(),
        });
        cmds.push({
          code: 'KeyG', icon: 'rally', label: t('ui.cmds.rally'),
          tip: { title: t('ui.cmds.rally'), lines: t('ui.cmds.rallyTip') },
          on: () => this.hooks.orderMassRally(b),
        });
      }
      // Э6: капсулы снабжения и панель админа — тоже команды КЦ
      // (канон владельца: управление живёт в строениях, а не в топбаре).
      if (b.done && b.type === 'cc') {
        cmds.push({
          code: 'KeyC', icon: 'grade', label: t('ui.cmds.capsules'),
          tip: { title: t('ui.cmds.capsules'), lines: t('ui.cmds.capsulesTip') },
          on: () => showChests(this),
        });
        // A3 (аудит 26.10): команда «Админ» существует только для профиля
        // владельца (best, без учёта регистра) — остальным её просто нет.
        if (isAdminProfile()) {
          cmds.push({
            code: 'KeyO', icon: 'recon', label: t('ui.cmds.admin'),
            tip: { title: t('ui.cmds.admin'), lines: t('ui.cmds.adminTip') },
            on: () => openAdmin(this),
          });
        }
      }
      // Э7: командир базы — капитан → генерал (звание, бонусы, оборона).
      if (b.done && b.type === 'cc') {
        cmds.push({
          code: 'KeyK', icon: 'officer', label: t('ui.cmds.commander'),
          tip: { title: t('ui.cmds.commander'), lines: t('ui.cmds.commanderTip') },
          on: () => openCommander(this),
        });
      }
      // ВЛАДЕЛЕЦ 25.10: профиль/сохранения — команда КЦ (не в хедере).
      if (b.done && b.type === 'cc' && window.showProfilePanel) {
        cmds.push({
          // KeyP занят глобальной паузой (input.js), поэтому профиль — на U.
          code: 'KeyU', icon: 'recon', label: t('ui.cmds.profile'),
          tip: { title: t('ui.cmds.profile'), lines: t('ui.cmds.profileTip') },
          on: () => window.showProfilePanel(),
        });
      }
      // ВЛАДЕЛЕЦ 25.10: Дом в экспедиции — команда «Эвакуация» внутри Дома.
      if (b.done && b.type === 'depot' && st.raidMode === 'expedition' && b === st.raidHouse) {
        cmds.push({
          code: 'KeyE', icon: 'shuttle',
          label: st.raidEvacuating ? t('ui.raid.topLiftoff', { n: (st.raidBoarded || []).length }) : t('ui.raid.topEvac'),
          tip: { title: t('ui.raid.topEvacTitle'), lines: t('ui.raid.cmdLaunchTip') },
          on: () => this.triggerRaidEvac(),
        });
      }
      // ВЛАДЕЛЕЦ 25.10: рейд запускается из ДОМА (Г2+), не из КЦ.
      if (b.done && b.type === 'depot' && (b.level || 1) >= 2 && st.raidMode === 'home') {
        cmds.push({
          code: 'KeyE', icon: 'shuttle', label: t('ui.raid.cmdLaunch'),
          tip: { title: t('ui.raid.cmdLaunch'), lines: t('ui.raid.cmdLaunchTip') },
          on: () => this.openRaidLaunch(),
        });
      }
      // Э4: «Собрать всех» — отряд в отсек (вместимость = грейд Дома),
      // «Выгрузить» — обратно на базу. Одно число = одно действие.
      // На вылазке отсек не работает (бойцы уже на карте) — команду не показываем,
      // чтобы не было кнопки-пустышки с тостом «только на базе».
      if (b.done && b.type === 'depot' && (b.level || 1) >= 1 && st.raidMode !== 'expedition') {
        const cap = U.unitCapOf(b);
        const inside = b.garrison ? b.garrison.length : 0;
        if (inside > 0) {
          cmds.push({
            code: 'KeyF', icon: 'exit',
            label: t('ui.cmds.bayOut', { n: inside, cap }),
            tip: { title: t('ui.cmds.bayOut', { n: inside, cap }), lines: t('ui.cmds.bayOutTip') },
            on: () => { U.releaseGarrison(st, b); this.sound.click(); },
          });
        } else {
          const free = Math.max(0, cap);
          cmds.push({
            code: 'KeyF', icon: 'rally', label: t('ui.cmds.bayIn', { n: cap }),
            tip: { title: t('ui.cmds.bayIn', { n: cap }), lines: t('ui.cmds.bayInTip') },
            enabled: () => free > 0,
            on: () => { this.loadAllIntoHouse(b); },
          });
        }
      }
      // ВЛАДЕЛЕЦ 25.10: Г3 — Дом перемещается как юнит (приказ точкой ПКМ).
      if (b.done && b.type === 'depot' && (b.level || 1) >= HOUSE.moveFrom && !b.flight) {
        cmds.push({
          code: 'KeyM', icon: 'rally', label: t('ui.cmds.houseMove'),
          tip: { title: t('ui.cmds.houseMove'), lines: t('ui.cmds.houseMoveTip') },
          on: () => { st.houseMove = b; },
        });
      }
      if (b.done && b.gradeUp) {
        cmds.push({
          code: 'KeyX', icon: 'stop', label: t('ui.cmds.undo'),
          on: () => this.hooks.cancelGrade(b),
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
          cmds.push({ code: 'KeyB', icon: 'build', label: t('ui.cmds.build'), on: () => { st.buildMenu = true; } });
        } else {
          for (const [code, type] of BUILD_ORDER) {
            if (!isUnlocked(this.mission, type)) continue; // П8/С1 + banBuild
            const cfg = BUILDINGS[type];
            cmds.push({
              code, icon: fac === 'alien' ? 'a_' + type : type,
              label: fname(cfg, fac), cost: cfg.cost,
              tip: buildingTip(type, fac),
              enabled: () => st.minerals.player >= cfg.cost,
              on: () => this.hooks.beginPlace(type),
            });
          }
          cmds.push({ code: 'KeyX', icon: 'stop', label: t('ui.cmds.back'), on: () => { st.buildMenu = false; } });
        }
      }
      // Пакет U (разилка 4 аудита адаптивности): атака-движение кнопкой —
      // раньше было доступно только с клавиатуры (KeyA), тач-игрок был
      // лишён боевой механики вовсе. Тоггл: повторный клик снимает режим.
      const combat = sel.some((e) => e.kind === 'unit' && e.side === 'player' &&
        !e.dead && !e.garrison && e.cfg.dmg > 0);
      // «Стоп» не показываем в открытом меню стройки: 7 зданий + «Назад»
      // заполняют компактную сетку 2×4 ровно целиком.
      if (!st.buildMenu) {
        if (combat) {
          cmds.push({
            code: 'KeyA', icon: 'attack', label: t('ui.cmds.attackMove'),
            tip: { title: t('ui.cmds.attackMove'), lines: t('ui.cmds.attackMoveTip') },
            selected: !!st.attackMoveMode,
            on: () => {
              st.attackMoveMode = !st.attackMoveMode;
              this.canvas.style.cursor = st.attackMoveMode ? 'crosshair' : '';
              this.sound.click();
            },
          });
        }
        if (st.raidMode === 'expedition') {
          const boarded = st.raidBoarded ? st.raidBoarded.length : 0;
          const evLabel = !st.raidEvacuating
            ? t('ui.raid.cmdEvac')
            : (boarded > 0 ? t('ui.raid.cmdLiftoff', { n: boarded }) : t('ui.raid.cmdEvacCancel'));
          cmds.push({
            code: 'KeyE', icon: 'shuttle', label: evLabel,
            tip: { title: t('ui.raid.cmdEvac'), lines: t('ui.raid.cmdEvacTip') },
            selected: !!st.raidEvacuating,
            on: () => this.triggerRaidEvac(),
          });
        }
        cmds.push({ code: 'KeyS', icon: 'stop', label: t('ui.cmds.stop'), on: () => this.hooks.stopSelected() });
        // Э7: приказы командира отряду — пост «держать сектор» и отход к КЦ.
        const squadSel = combatUnits(st, units);
        if (squadSel.length) {
          cmds.push({
            code: 'KeyJ', icon: 'hold', label: t('ui.cmds.holdSector'),
            tip: { title: t('ui.cmds.holdSector'), lines: t('ui.cmds.holdSectorTip') },
            selected: !!st.holdPick,
            on: () => {
              st.holdPick = !st.holdPick;
              this.canvas.style.cursor = st.holdPick ? 'crosshair' : '';
              this.sound.click();
            },
          });
          cmds.push({
            code: 'KeyL', icon: 'home', label: t('ui.cmds.retreatCC'),
            tip: { title: t('ui.cmds.retreatCC'), lines: t('ui.cmds.retreatCCTip') },
            // На вылазке роль КЦ играет Дом-шаттл — приказ должен работать и там.
            enabled: () => !!ccAnchor(st),
            on: () => {
              U.clearEvacFlags(squadSel); // приказ игрока главнее ожидания у челнока
              const n = issueRetreatToCC(st, squadSel);
              ui.toast(t('ui.squad.retreat', { n }), 'info');
              this.sound.ack();
            },
          });
          if (squadSel.some((u) => u.hold)) {
            cmds.push({
              code: 'KeyN', icon: 'stop', label: t('ui.cmds.holdClear'),
              tip: { title: t('ui.cmds.holdClear'), lines: t('ui.cmds.holdClearTip') },
              on: () => {
                const n = clearHold(st, squadSel);
                ui.toast(t('ui.squad.cleared', { n }), 'info');
                this.sound.click();
              },
            });
          }
        }
      }
    }
    return cmds;
  }

  // F.1: тултип остатков кристалла под курсором (зовёт input.js).
  updateCrystalTip(wx, wy) {
    ui.updateCrystalTip(this, wx, wy);
  }

  makeHooks() {
    const st = () => this.state;
    return {
      centerCamera: (wx, wy) => this.centerCamera(wx, wy),

      // Э7: клик в режиме «Держать сектор» — ставим пост выделенным бойцам.
      issueHold: (wx, wy) => {
        const s = st();
        U.clearEvacFlags(s.selection); // явный приказ снимает «жду эвакуации»
        const n = issueHold(s, wx, wy, s.selection);
        if (n) ui.toast(t('ui.squad.hold', { n }), 'info');
        else ui.toast(t('ui.squad.none'), 'warn');
        this.sound.ack();
      },

      issueRMB: (wx, wy) => this.issueRMB(wx, wy),

      beginPlace: (type) => {
        const s = st();
        s.buildMenu = false;
        if (s.placing) {
          s.placing.type = type;
          if (s.placing.tx > -900) {
            const cfg = BUILDINGS[type];
            s.placing.tx = Math.max(0, Math.min(s.map.w - cfg.w, s.placing.tx));
            s.placing.ty = Math.max(0, Math.min(s.map.h - cfg.h, s.placing.ty));
          }
        } else {
          s.placing = { type, tx: -999, ty: -999 };
        }
        this.sound.click();
      },

      cancelPlacement: () => {
        const s = st();
        s.placing = null;
        s.wallDrag = null;
        s.buildMenu = false;
        this.sound.click();
      },

      tryPlace: (tx, ty) => this.tryPlace(tx, ty),

      train: (b, type) => {
        const r = B.enqueueUnit(st(), b, type);
        const fac = st().factions.player;
        if (r === 'money') { ui.toast(message('noMinerals', fac), 'error'); this.sound.error(); }
        else if (r === 'queue') { ui.toast(message('queueFull', fac), 'warn'); this.sound.error(); }
        else this.sound.click();
      },

      startGrade: (b) => {
        const r = B.startGrade(st(), b);
        const fac = st().factions.player;
        const code = typeof r === 'string' ? r : (r && r.code) || 'wrong';
        if (code === 'money') { ui.toast(message('noMinerals', fac), 'error'); this.sound.error(); }
        else if (code === 'cclow') {
          ui.toast(t('ui.raid.errCcLevel'), 'warn'); this.sound.error();
        } else if (code === 'gate') {
          const g = (r && r.gate) || { have: 0, need: 2, minLevel: 1, eliteHave: 0, eliteNeed: 0 };
          const base = t('ui.cmds.gateToast', {
            have: g.have, need: g.need, lvl: GRADE_ROMAN[g.minLevel],
          });
          const elite = g.eliteNeed > 0
            ? ' ' + t('ui.cmds.gateToastElite', { have: g.eliteHave, need: g.eliteNeed })
            : '';
          ui.toast(base + elite, 'warn');
          this.sound.error();
        } else if (code === 'max') {
          ui.toast(t('ui.cmds.maxLevel', { n: MAX_BUILDING_LEVEL }), 'warn'); this.sound.error();
        } else if (code === 'busy' || code === 'wrong') { this.sound.error(); }
        else this.sound.click();
      },

      cancelGrade: (b) => { B.cancelGrade(st(), b); this.sound.click(); },

      loadAllIntoHouse: (b) => this.loadAllIntoHouse(b),

      startResearch: (b, key) => {
        const r = B.startResearch(st(), b, key);
        const fac = st().factions.player;
        if (r === 'money') { ui.toast(message('noMinerals', fac), 'error'); this.sound.error(); }
        else if (r === 'busy') { ui.toast(message('labBusy', fac), 'warn'); this.sound.error(); }
        else if (r === 'max') { ui.toast(message('maxed', fac), 'error'); }
        else if (r === 'grade') { ui.toast(message('needCC2', fac), 'error'); this.sound.error(); }
        else this.sound.click();
      },

      cancelResearch: (b) => { B.cancelResearch(st(), b); this.sound.click(); },

      cancelQueue: (b, i) => B.cancelQueueItem(st(), b, i),

      stopSelected: () => {
        U.clearEvacFlags(st().selection); // явный приказ снимает «жду эвакуации»
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
        U.clearEvacFlags(units);
        // Слоты строя проверяются по карте (не в стене) — как у обычного движения.
        const goals = U.formationGoals(s, units, wx, wy);
        for (let i = 0; i < units.length; i++) {
          U.orderAttackMove(s, units[i], goals[i].x, goals[i].y);
        }
        this.sound.ack();
      },

      // H.3: «Разведать» — все свои разведчики (кроме уже разведывающих) в туман.
      orderRecon: () => {
        const s = st();
        const scouts = s.units.filter((u) => u.kind === 'unit' && u.side === 'player' &&
          !u.dead && !u.garrison && u.cfg.scout && u.order.kind !== 'scout');
        if (!scouts.length) {
          const any = s.units.some((u) => u.kind === 'unit' && u.side === 'player' && !u.dead && u.cfg.scout);
          if (!any) ui.toast(message('noScouts', s.factions.player), 'error');
          this.sound.error();
          return;
        }
        for (const u of scouts) U.orderScout(s, u);
        this.sound.ack();
      },
      // H.4: «Сбор» — все свои без приказа (idle, вне гарнизона) к точке сбора КЦ.
      orderMassRally: (b) => {
        const s = st();
        if (!b.rally) { ui.toast(message('noRally', s.factions.player), 'error'); this.sound.error(); return; }
        let n = 0;
        for (const u of s.units) {
          if (u.kind !== 'unit' || u.side !== 'player' || u.dead || u.garrison) continue;
          if (u.order.kind !== 'idle') continue;
          const spot = B.rallySpot(s, b);
          U.orderMove(s, u, spot.x, spot.y);
          n++;
        }
        if (n) this.sound.ack(); else this.sound.error();
      },
      assignGroup: (n) => {
        // Только свои: осмотренный враг (inspect) в отряд не пишется.
        const g = st().selection.filter((e) => e.kind === 'unit' && e.side === 'player' && !e.dead);
        if (g.length) { st().groups[n] = g; this.sound.click(); }
      },

      selectGroup: (n) => {
        const g = (st().groups[n] || []).filter((u) => !u.dead);
        if (g.length) { st().selection = g; st().buildMenu = false; this.sound.click(); }
      },

      // Двойной тап цифры: прыжок камеры к центру отряда.
      centerOnGroup: (n) => {
        const g = (st().groups[n] || []).filter((u) => !u.dead);
        if (!g.length) return;
        const cx = g.reduce((a, u) => a + u.x, 0) / g.length;
        const cy = g.reduce((a, u) => a + u.y, 0) / g.length;
        this.centerCamera(cx, cy);
      },

      // Точка: следующий свободный рабочий + камера на него.
      cycleIdleWorker: () => {
        const list = st().units.filter((u) => u.kind === 'unit' && u.side === 'player' &&
          !u.dead && !u.garrison && u.cfg.canBuild && u.order.kind === 'idle');
        if (!list.length) return;
        const cur = st().selection.length === 1 ? list.indexOf(st().selection[0]) : -1;
        const u = list[(cur + 1) % list.length];
        st().selection = [u];
        st().buildMenu = false;
        this.centerCamera(u.x, u.y);
        this.sound.click();
      },

      // Запятая: выделить всю армию (всех своих бойцов).
      selectArmy: () => {
        const army = st().units.filter((u) => u.kind === 'unit' && u.side === 'player' &&
          !u.dead && !u.garrison && !u.cfg.canBuild && !u.cfg.scout); // H.3: затвор №3
        if (army.length) { st().selection = army; st().buildMenu = false; this.sound.click(); }
      },

      // Tab: перебор бойцов по одному + камера следом.
      cycleCombat: () => {
        const list = st().units.filter((u) => u.kind === 'unit' && u.side === 'player' &&
          !u.dead && !u.garrison && !u.cfg.canBuild && !u.cfg.scout); // H.3: затвор №3
        if (!list.length) return;
        const cur = st().selection.length === 1 ? list.indexOf(st().selection[0]) : -1;
        const u = list[(cur + 1) % list.length];
        st().selection = [u];
        st().buildMenu = false;
        this.centerCamera(u.x, u.y);
        this.sound.click();
      },

      // H: прыжок камеры к последней тревоге («нас атакуют»).
      jumpToAlert: () => {
        const p = st().lastAlertPos;
        if (!p) return;
        this.centerCamera(p.x, p.y);
        this.sound.ping();
      },
    };
  }

  // ПКМ: атака врага / добыча кристалла / ремонт / гарнизон /
  // помочь достроить / движение.
  // ВЛАДЕЛЕЦ 25.10: перемещение Дома-Г3 «как юнита» — мгновенная перегрузка
  // на сетке + визуальный полёт по прямой (коллизии пересчитываются сразу).
  moveHouse(b, wx, wy) {
    const st = this.state;
    const tx = Math.max(0, Math.min(st.map.w - b.w, Math.floor(wx / TILE)));
    const ty = Math.max(0, Math.min(st.map.h - b.h, Math.floor(wy / TILE)));
    if (tx === b.tx && ty === b.ty) return;
    st.map.unmarkBuilding(b);
    if (!B.canPlace(st.map, tx, ty, b.w, b.h) ||
        Math.hypot(tx - st.map.bases.player.center.x, ty - st.map.bases.player.center.y) < 4) {
      st.map.markBuilding(b);
      ui.toast(t('ui.raid.houseMoveBlocked'), 'warn');
      this.sound.click();
      return;
    }
    const fromX = (b.tx + b.w / 2) * TILE, fromY = (b.ty + b.h / 2) * TILE;
    b.tx = tx; b.ty = ty;
    // B1 (аудит владельца 26.10.2026): «сбор/отсек/эффекты показывают не там,
    // где стоит Дом». b.x/b.y — мировой центр здания, от него считаются аура,
    // выпуск отсека, ремонт, дистанции в панели. Переезд менял только тайлы,
    // центр оставался на старом месте — отсюда «сбор не там».
    b.x = (b.tx + b.w / 2) * TILE;
    b.y = (b.ty + b.h / 2) * TILE;
    st.map.markBuilding(b);
    const toX = b.x, toY = b.y;
    // Вылазка: Дом-шаттл — это и посадочная площадка (сдача эрга + эвакуация).
    // Раньше здание уезжало, а кольцо приёма оставалось на старом месте: груз
    // «сдавали в пустоту», эвакуация шла в точку, где Дома уже нет (26.10.2026).
    if (st.raidMode === 'expedition' && b === st.raidHouse && st.raidDrop) {
      st.raidDrop.tx = b.tx;
      st.raidDrop.ty = b.ty;
      st.raidDrop.x = toX;
      st.raidDrop.y = toY;
    }
    const dist = Math.hypot(toX - fromX, toY - fromY);
    b.flight = { t: 0, dur: Math.max(0.6, dist / (Math.max(60, HOUSE.speedAt(b.level || 3)) * TILE / 32)), dx0: fromX - toX, dy0: fromY - toY };
    b.visX = b.flight.dx0; b.visY = b.flight.dy0;
    U.addFloat(st, toX, toY, t('ui.cmds.houseMove'), '#9be29e');
    this.sound.ack();
  }

  issueRMB(wx, wy) {
    const st = this.state;
    if (!st || st.gameOver) return;
    // ВЛАДЕЛЕЦ 25.10: режим перемещения Дома (Г3) — ПКМ задаёт точку.
    if (st.houseMove) {
      const b = st.houseMove;
      st.houseMove = null;
      this.moveHouse(b, wx, wy);
      return;
    }
    const sel = st.selection.filter((e) => !e.dead);

    // Выделено своё здание — ставим точку сбора. Точка на кристалле
    // превращает новых рабочих сразу в добытчиков (без «пришёл и стою»).
    if (sel.length === 1 && sel[0].kind === 'building' &&
        sel[0].side === 'player') {
      const rc = U.crystalAt(st, wx, wy);
      sel[0].rally = rc ? { x: wx, y: wy, crystal: rc } : { x: wx, y: wy };
      U.addFloat(st, wx, wy, rc ? message('rallyCrystal', st.factions.player) : message('rallyPoint', st.factions.player), '#9be29e');
      this.sound.ack();
      return;
    }
    const units = sel.filter((e) => e.kind === 'unit' && e.side === 'player');
    if (!units.length) return;
    // #36 З2: явный приказ игрока неприкосновенен — снимаем «жду эвакуации».
    U.clearEvacFlags(units);

    // 1) Враг — атака.
    const enemyU = U.unitAt(st, wx, wy, 'enemy');
    const bld = B.buildingAt(st, wx, wy);
    if ((enemyU || (bld && bld.side === 'enemy'))) {
      const target = enemyU || bld;
      for (const u of units) if (!u.cfg.scout) U.orderAttack(st, u, target); // H.3: затвор №4
      this.sound.ack();
      return;
    }
    // 2) Кристалл — добыча (рабочими), остальные идут за ним.
    const crystal = U.crystalAt(st, wx, wy);
    if (crystal) {
      // F.1: первый — на кликнутый, остальные раскидываются цепочкой
      // (приказы встают сразу — учёт толпы живой, стеков >2 нет).
      let first = true;
      for (const u of units) {
        if (u.type !== 'worker') { U.orderMove(st, u, wx, wy); continue; }
        if (first) { U.orderGather(st, u, crystal); first = false; }
        else U.orderGather(st, u, U.nearestCrystal(st, u) || crystal);
      }
      this.sound.ack();
      return;
    }
    // 3) Своя постройка: гарнизон → достройка → ремонт.
    const own = bld && bld.side === 'player' ? bld : null;
    if (own) {
      // Э4: Дом — отсек для отряда. Приказ ПКМ по Дому грузит ЛЮБЫЕ юниты
      // (рабочих тоже) — влезает ровно столько, сколько позволяет грейд.
      if (own.done && own.type === 'depot' && (own.level || 1) >= 2) {
        const cap = U.unitCapOf(own);
        const free = Math.max(0, cap - (own.garrison ? own.garrison.length : 0));
        const candidates = units.filter((u) => !u.garrison && free > 0);
        for (const u of candidates.slice(0, free)) U.orderGarrison(st, u, own);
        if (candidates.length) {
          if (candidates.length > free) ui.toast(t('ui.cmds.bayFull', { n: cap }), 'warn');
          this.sound.ack();
          return;
        }
      }
      const infantry = units.filter((u) => !u.cfg.canMine && !u.cfg.vehicle && !u.garrison);
      if (own.done && own.cfg.garrisonCap && infantry.length &&
          own.garrison.length < gradeGar(own.type, own.level || 1, own.cfg.garrisonCap)) { // F.2
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
        U.orderRepairSpread(st, repairers, wx, wy, own); // G.4
        for (const u of units) if (!u.cfg.canRepair) U.orderMove(st, u, wx, wy);
        this.sound.ack();
        return;
      }
    }
    // 4) Своя повреждённая техника под курсором — ремонт.
    // B3 (аудит 26.10): и раненый СБОРЩИК тоже — сборщики чинят сборщиков.
    const ownU = U.unitAt(st, wx, wy, 'player');
    if (ownU && (ownU.cfg.vehicle || ownU.cfg.canMine) && ownU.hp < ownU.maxHp) {
      const repairers = units.filter((u) => u.cfg.canRepair);
      if (repairers.length) {
        U.orderRepairSpread(st, repairers, wx, wy, ownU); // G.4
        for (const u of units) if (!u.cfg.canRepair) U.orderMove(st, u, ownU.x, ownU.y);
        this.sound.ack();
        return;
      }
    }
    // 4b) Своё раненое СУЩЕСТВО под курсором — лечение (GO владельца 26.10:
    // «всё делаем симметрично» с ремонтом). Лечат только хилы и только свою
    // расу; не-хилы просто идут к цели. Нет хилов — тихий фолбэк в движение
    // (никаких тостов: приказ не «не сработал», просто нет лекарей).
    if (ownU && !ownU.cfg.vehicle && !ownU.cfg.canMine && ownU.hp < ownU.maxHp) {
      const healers = units.filter((u) => u.cfg.canHeal && u.faction === ownU.faction && u !== ownU);
      if (healers.length && U.orderHealSpread(st, healers, wx, wy, ownU)) {
        for (const u of units) {
          if (u.cfg.canHeal && u.faction === ownU.faction) continue;
          if (u.garrison) continue;
          U.orderMove(st, u, ownU.x, ownU.y);
        }
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
    tx = Math.max(0, Math.min(st.map.w - cfg.w, tx));
    ty = Math.max(0, Math.min(st.map.h - cfg.h, ty));
    for (let y = ty; y < ty + cfg.h; y++)
      for (let x = tx; x < tx + cfg.w; x++)
        if (!st.fog.tileExplored(x, y)) {
          ui.toast(message('unexplored', fac), 'error'); this.sound.error(); return;
        }
    // Требование технологии: у завода нужна казарма/инкубатор.
    if (cfg.requires) {
      const ok = st.buildings.some((b) => !b.dead && b.side === 'player' &&
        b.type === cfg.requires && b.done);
      if (!ok) {
        ui.toast(message('requires', fac) + fname(BUILDINGS[cfg.requires], fac), 'error');
        this.sound.error(); return;
      }
    }
    if (!B.canPlace(st.map, tx, ty, cfg.w, cfg.h)) {
      ui.toast(message('cantBuild', fac), 'error'); this.sound.error(); return;
    }
    if (!B.zoneAllows(st, tx, ty, cfg.w, cfg.h)) {
      ui.toast(message('outsideZone', fac), 'error'); this.sound.error(); return;
    }
    if (st.minerals.player < cfg.cost) {
      ui.toast(message('noMinerals', fac), 'error'); this.sound.error(); return;
    }
    const pool = st.selection.filter((e) => e.kind === 'unit' && e.side === 'player' &&
      e.cfg.canBuild && !e.dead)
      .sort((p, q) => Math.hypot(p.x - tx * TILE, p.y - ty * TILE) -
        Math.hypot(q.x - tx * TILE, q.y - ty * TILE));
    if (!pool.length) {
      ui.toast(t('ui.hints.selectWorker', { worker: fname(UNITS.worker, fac).toLowerCase() }), 'error');
      this.sound.error(); return;
    }
    const b = B.placeBuildingCmd(st, 'player', pl.type, tx, ty, pool);
    if (!b) return; // деньги/место могли уйти между кликом и коммитом
    // П3 (B.7.2): остатки пула — по голодным стройкам жадно: каждый —
    // на самую голодную (меньше строителей, ничья — ближайшая). «Все на
    // одну» запрещено: placeBuildingCmd уже забрал 5 ближайших на новую.
    const leftovers = pool.slice(BUILDERS_PER_SITE);
    for (const w of leftovers) {
      let best = null, bn = Infinity, bd = Infinity;
      for (const s2 of st.buildings) {
        if (s2.dead || s2.done || s2.side !== 'player' || s2 === b) continue;
        const n = U.buildersOf(st, s2);
        if (n >= BUILDERS_PER_SITE) continue;
        const d = Math.hypot(w.x - s2.x, w.y - s2.y);
        if (n < bn || (n === bn && d < bd)) { bn = n; bd = d; best = s2; }
      }
      if (best) U.orderBuild(st, w, best);
    }
    // П3 (B.7.3): серии — режим НЕ сбрасываем, выход ПКМ/Esc.
    this.sound.build();
  }

  // П3 (B.7.4): тайлы линии 1×1 от снимка драга (DDA, без дублей, кламп
  // по бюджету). Чистая от st.wallDrag: mouseup обнуляет поле ДО коммита —
  // коммит идёт от снимка, живого поля может уже не быть (фикс блокера).
  wallLineTiles(d = this.state.wallDrag) {
    const st = this.state;
    if (!d || !st.placing) return { tiles: [], skipped: 0 };
    const cfg = BUILDINGS[st.placing.type];
    const dx = d.x1 - d.x0, dy = d.y1 - d.y0;
    const steps = Math.max(Math.abs(dx), Math.abs(dy));
    const tiles = [];
    const seen = new Set();
    for (let i = 0; i <= steps; i++) {
      const x = Math.round(d.x0 + (steps ? dx * i / steps : 0));
      const y = Math.round(d.y0 + (steps ? dy * i / steps : 0));
      if (x < 0 || y < 0 || x >= st.map.w || y >= st.map.h) continue;
      const k = y * st.map.w + x;
      if (seen.has(k)) continue;
      seen.add(k);
      tiles.push({ x, y });
    }
    // Кламп длины по бюджету: больше, чем можем оплатить, не тянем.
    const afford = Math.floor(st.minerals.player / cfg.cost);
    return { tiles: tiles.slice(0, Math.max(0, afford)), skipped: Math.max(0, tiles.length - afford) };
  }

  // П3 (B.7.4): коммит линии — стройки по тайлам, бригада вдоль по очереди.
  commitWallLine(d = this.state.wallDrag) {
    const st = this.state;
    const pl = st.placing;
    if (!pl) return 0;
    const cfg = BUILDINGS[pl.type];
    const fac = st.factions.player;
    if (cfg.requires) {
      const ok = st.buildings.some((b) => !b.dead && b.side === 'player' &&
        b.type === cfg.requires && b.done);
      if (!ok) {
        ui.toast(message('requires', fac) + fname(BUILDINGS[cfg.requires], fac), 'error');
        this.sound.error(); return 0;
      }
    }
    const { tiles } = this.wallLineTiles(d);
    const pool = st.selection.filter((e) => e.kind === 'unit' && e.side === 'player' &&
      e.cfg.canBuild && !e.dead);
    if (!pool.length) {
      ui.toast(t('ui.hints.selectWorker', { worker: fname(UNITS.worker, fac).toLowerCase() }), 'error');
      this.sound.error(); return 0;
    }
    const sites = [];
    for (const t of tiles) {
      if (st.minerals.player < cfg.cost) break;
      if (!st.fog.tileExplored(t.x, t.y)) continue;
      const b = B.placeBuildingCmd(st, 'player', pl.type, t.x, t.y, []);
      if (b) sites.push(b);
    }
    if (!sites.length) {
      ui.toast(message('cantBuild', fac), 'error'); this.sound.error(); return 0;
    }
    // Бригада идёт вдоль линии по очереди: рабочие пула (от ближнего
    // к началу линии) разбирают стройки round-robin, кап 5 — как везде.
    const first = sites[0];
    const crew = pool.filter((w) => !w.dead)
      .sort((p, q) => Math.hypot(p.x - first.x, p.y - first.y) -
        Math.hypot(q.x - first.x, q.y - first.y));
    let i = 0;
    for (const w of crew) {
      const site = sites[i % sites.length];
      i++;
      if (U.buildersOf(st, site) >= BUILDERS_PER_SITE) continue;
      U.orderBuild(st, w, site);
    }
    this.sound.build();
    return sites.length;
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
    // ВЛАДЕЛЕЦ 25.10: визуальный полёт перемещаемого Дома-Г3.
    for (const b of st.buildings) {
      if (!b.flight) continue;
      b.flight.t += LOGIC_DT;
      const p = Math.min(1, b.flight.t / b.flight.dur);
      const e = p * p * (3 - 2 * p); // smoothstep
      b.visX = b.flight.dx0 * (1 - e);
      b.visY = b.flight.dy0 * (1 - e);
      if (p >= 1) { b.flight = null; b.visX = 0; b.visY = 0; }
    }
    st.units = st.units.filter((u) => !u.dead);
    st.buildings = st.buildings.filter((b) => !b.dead);
    U.syncSelectionFlags(st); // кольца выделения видимы каждый тик
    // ВЛАДЕЛЕЦ 25.10: баланс сбора на рейде виден всегда (обновление HUD раз в ~0.5с).
    if (st.raidMode === 'expedition') {
      st._hudT = (st._hudT || 0) + LOGIC_DT;
      if (st._hudT >= 0.5) { st._hudT = 0; ui.setObjective(this.objectiveText()); }
    }
    // Э7: посты отрядов («держать сектор», «к КЦ») — поправляем раз в 0.35 с.
    updateSquad(st, LOGIC_DT);
    U.updateProjectiles(st, LOGIC_DT);
    U.updateEffects(st, LOGIC_DT);
    if (!this.mission.noEnemyBase) st.ai.update(LOGIC_DT, st);
    this.updateWin(st, LOGIC_DT);
    if (st.raidMode) {
      updateRaidTick(this, st, LOGIC_DT);
      if (this.state !== st) return; // вылазка завершилась и вернула игрока на домашнюю базу
    }
    // Э7: входящие рейды и автооборона — только на домашней базе.
    if (st.raidMode === 'home' && !st.gameOver) {
      const events = updateHomeRaid(this, st, LOGIC_DT);
      for (const ev of events) this.handleHomeRaidEvent(ev);
      const ccB = st.buildings.find((b) => !b.dead && b.side === 'player' && b.type === 'cc');
      if (ccB) ccB.commanderLevel = st.commander ? st.commander.level : 0;
    }

    if (st.tick % 3 === 0) st.fog.recompute(st);
    calcSupply(st);
    if (st.tick % 2 === 0) {
      ui.update(this);
      ui.setObjective(this.objectiveText());
    }
    if (st.tick % 3 === 0) ui.drawMinimap(this);
    this.checkEnd();
  }

  // Механики победы M0: доводка эвакуации и дедлайн. Вызывается каждый
  // тик; при отсутствии механик в миссии — дешёвые проверки и выход.
  updateWin(st, dt) {
    if (st.gameOver) return;
    const w = st.win;
    // Эвакуация: свой юнит стоит в зоне hold секунд подряд — погружается
    // (исчезает, в потери не пишется). Выход из зоны сбрасывает таймер.
    // П5: в двухфазной обороне (def + evac) погрузка идёт только во 2-й фазе,
    // а её начало объявляется тостом с новой целью.
    const def = this.mission && this.mission.defense;
    if (def && w && w.kind === 'evac' && !st.phase2 && st.time >= def.prep + def.total) {
      st.phase2 = true;
      ui.toast(missionText(this.mission, 'phaseToast') || t('messages.newObjective', { goal: objectiveLabel(this.mission, w) }), 'info');
      this.sound.ready();
    }
    if (w && w.kind === 'evac' && (!def || st.time >= def.prep + def.total)) {
      const cx = (w.x + 0.5) * TILE, cy = (w.y + 0.5) * TILE, r = w.r * TILE;
      for (const u of st.units) {
        if (u.dead || u.evacuated || u.side !== 'player' || u.kind !== 'unit') continue;
        if (Math.hypot(u.x - cx, u.y - cy) <= r) {
          u.evacT = (u.evacT || 0) + dt;
          if (u.evacT >= w.hold) {
            u.evacuated = true;
            u.dead = true; // убирается чисткой тика, но в потери не попадает (см. killEntity)
            u.selected = false;
            st.evacuated++;
            U.addEffect(st, { kind: 'spark', x: u.x, y: u.y, ang: -Math.PI / 2, t: 0, life: 0.3 });
            U.addFloat(st, u.x, u.y - 16, message('evacOne', st.factions.player), '#9be29e');
            this.sound.ready();
          }
        } else {
          u.evacT = 0;
        }
      }
      st.selection = st.selection.filter((e) => !e.evacuated);
      // Чистка погружённых сразу: иначе кадр покажет их в зоне после победы.
      if (st.evacuated > 0) st.units = st.units.filter((u) => !u.evacuated);
    }
    // Дедлайн: разовое событие по таймеру (волна усиления или поражение).
    const dl = st.loseDeadline;
    if (dl && !st.deadlineFired && st.time >= dl.at) {
      st.deadlineFired = true;
      const dlLabel = dl.labelKey && has(dl.labelKey) ? t(dl.labelKey) : (dl.label || '');
      if (dl.hard) {
        ui.toast(dlLabel, 'error'); // П8: жёсткий дедлайн — тост + поражение
        this.lose(dlLabel);
      } else {
        st.ai.raidWave(st, st.ai.p.waveMax);
        ui.toast(dlLabel, 'error');
        this.sound.ping();
      }
    }
  }

  // Текст цели миссии в верхней панели (с таймерами обороны).
  objectiveText() {
    const st = this.state;
    if (!st) return '';
    if (st.raidMode) return raidObjectiveText(this, st);
    const m = this.mission;
    const def = m && m.defense;
    const w = st.win;
    // П5: в двухфазной обороне (def + evac) таймер — только фаза 1;
    // в фазе 2 HUD показывает счётчик эвакуации (ветки ниже).
    const phase2 = def && w && w.kind === 'evac' && st.time >= def.prep + def.total;
    if (def && !phase2) {
      if (st.time < def.prep) {
        return t('ui.objective.prep', { t: fmtTime(def.prep - st.time) });
      }
      const left = Math.max(0, def.prep + def.total - st.time);
      return t('ui.objective.defense', { t: fmtTime(left), n: st.defenseWave });
    }
    const dl = st.loseDeadline && !st.deadlineFired
      ? ' · ' + (st.loseDeadline.labelKey && has(st.loseDeadline.labelKey) ? t(st.loseDeadline.labelKey) : (st.loseDeadline.label || '')) + ': ' + fmtTime(Math.max(0, st.loseDeadline.at - st.time))
      : '';
    if (w && w.kind === 'stockpile') {
      return t('ui.objective.stockpile', {
        n: Math.floor(st.stats.mined), m: w.amount,
        word: message('minedWord', st.factions.player),
      }) + dl;
    }
    if (w && w.kind === 'evac') {
      return t('ui.objective.evac', { n: st.evacuated, m: w.need }) + dl;
    }
    if (w && w.kind === 'key') {
      return objectiveLabel(m) + dl;
    }
    return objectiveLabel(m) + dl;
  }

  checkEnd() {
    const st = this.state;
    if (st.gameOver) return;
    if (st.raidMode) { checkRaidEnd(this, st); return; }
    const def = this.mission && this.mission.defense;
    const w = st.win;
    const fac = st.factions.player;
    // Ключевая цель: победа, когда все встреченные цели типа уничтожены.
    // keyTotal защищает от мгновенной победы, если цели такого типа нет.
    if (w && w.kind === 'key') {
      let alive = 0;
      for (const b of st.buildings) {
        if (b.side !== 'enemy' || b.dead || b.type !== w.type) continue;
        b.keyTarget = true; // маркер-ромб и точка на минимапе
        alive++;
      }
      if (alive > 0) st.keyTotal = Math.max(st.keyTotal, alive);
      if (st.keyTotal > 0 && alive === 0) {
        // П5: последовательная цель (key → evac): переключаемся на следующую
        // цель вместо победы и объявляем её тостом.
        if (w.then) {
          st.win = w.then;
          st.keyTotal = 0;
          st.phase2 = true;
          ui.toast(missionText(this.mission, 'phaseToast') || t('messages.newObjective', { goal: objectiveLabel(this.mission, st.win) }), 'info');
          this.sound.ready();
          return;
        }
        this.win(message('winKey', fac));
        return;
      }
    }
    if (w && w.kind === 'stockpile' && st.stats.mined >= w.amount) {
      this.win(message('winStock', fac));
      return;
    }
    if (w && w.kind === 'evac') {
      if (st.evacuated >= w.need) {
        this.win(message('winEvac', fac));
        return;
      }
      // П5: «некого грузить» — погружено + живо + в очереди меньше need,
      // а восстановить поголовье нечем: нет жилого прод-здания, у которого
      // были бы рабочие, очередь или минералы на рабочего. Поражение вместо
      // софтлока (фаза 2 №1, фаза 2 №13; №4 проигрывает раньше, но тоже честно).
      let aliveU = 0, workers = 0, queued = 0, prod = false;
      for (const u of st.units) {
        if (u.dead || u.side !== 'player' || u.kind !== 'unit') continue;
        aliveU++;
        if (u.cfg.canMine) workers++;
      }
      for (const b of st.buildings) {
        if (b.dead || b.side !== 'player' || !b.done || !b.cfg.produces) continue;
        prod = true;
        queued += b.queue.length;
      }
      const canRecover = prod && (workers > 0 || queued > 0 || st.minerals.player >= UNITS.worker.cost);
      if (st.evacuated + aliveU + queued < w.need && !canRecover) {
        this.lose(message('loseEmbark', fac));
        return;
      }
    }
    // Стелс-миссия: база отсутствует — проигрыш по гибели всего отряда.
    // Снос всей базы врага остаётся запасным путём победы и в новых типах:
    // уничтоживший угрозу игрок не должен упереться в софтлок.
    if (st.noBase) {
      // П8: №17 — потеря ключевого юнита раньше запасного пути (жёстче №13).
      if (w && w.guardType && st.guardLost) { this.lose(missionText(this.mission, 'guardLose') || message('lostSquad', fac)); return; }
      const alive = st.units.some((u) => u.side === 'player' && !u.dead);
      // П5-фикс: запасной путь подавлен, пока висит evac-цель (фаза 2 №13):
      // «победа только после отхода», даже если «Око» — последнее здание.
      // №8 не задевает — там evac-цели нет.
      if (st.bcount.enemy <= 0 && !(w && w.kind === 'evac')) {
        // П5: запасной путь победы — формулировка по фракции врага
        // (№8 — гнездо, №13 — форт людей); текст №8 не меняется.
        this.win(st.factions.enemy === 'human'
          ? message('winNoBaseFort', fac)
          : message('winNoBaseNest', fac));
      } else if (!alive) {
        this.lose(message('lostSquad', fac));
      }
      return;
    }
    if (st.bcount.enemy <= 0) {
      this.win(message('winKill', fac));
    } else if (st.bcount.player <= 0) {
      this.lose(message('loseBase', fac));
    } else if (def && st.time >= def.prep + def.total && !(w && w.kind === 'evac')) {
      // П5: в двухфазной обороне истекший таймер — не победа, а фаза эвакуации.
      this.win(message('winDefense', fac));
    }
  }

  win(reason) {
    const st = this.state;
    st.gameOver = 'win';
    st.stats.time = st.time;
    ui.hideRaidLaunch();
    this.sound.win();
    if (this.mission.id >= 0) saveProgress(missionIndex(this.mission) + 1); // П8: шкала — порядок массива
    ui.showEnd(true, st.stats, this.endOpts(true, reason));
  }

  lose(reason) {
    const st = this.state;
    st.gameOver = 'lose';
    st.stats.time = st.time;
    ui.hideRaidLaunch();
    this.sound.lose();
    ui.showEnd(false, st.stats, this.endOpts(false, reason));
  }

  // Опции экрана финала: следующая миссия, подпись причины.
  endOpts(win, reason) {
    const m = this.mission;
    const opts = { faction: m.faction };
    if (reason) opts.reason = reason;
    const ni = missionIndex(m) + 1; // П8: следующая — по порядку массива (id бонусных идут с разрывом)
    if (win && m.id >= 0 && ni > 0 && ni < MISSIONS.length) {
      opts.next = MISSIONS[ni];
    }
    if (win && m.id === 14) opts.campaignDone = true; // П8: кампанию закрывает №14, не хвост массива
    const epi = missionText(m, 'epilogue');
    if (win && epi) opts.epilogue = epi;
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

    // П2: зум. Весь мировой рендер уже считает (world - cam) сам —
    // scale(z) даёт ровно (world-cam)*z без правок каждого вызова.
    const z = cam.z || 1, vw = W / z, vh = H / z;
    ctx.save();
    // Тряска экрана: затухающие случайные смещения от взрывов/артиллерии.
    if (st.shakeT > 0) {
      const k = st.shakeMag * (st.shakeT / 0.3);
      ctx.translate((Math.random() - 0.5) * 2 * k, (Math.random() - 0.5) * 2 * k);
    }
    ctx.scale(z, z);

    // Рельеф: один drawImage видимого куска кэша 2048×2048.
    const sw = Math.min(vw, st.map.pxW - cam.x), sh = Math.min(vh, st.map.pxH - cam.y);
    if (sw > 0 && sh > 0) {
      ctx.drawImage(st.map.terrainCanvas, cam.x, cam.y, sw, sh, 0, 0, sw, sh);
    }

    const inView = (x, y, m) =>
      x > cam.x - m && x < cam.x + vw + m && y > cam.y - m && y < cam.y + vh + m;

    // M0: пунктирные границы зоны стройки (всегда видны, в режиме
    // размещения — ярче). Своя земля подсвечена бирюзой Рубежа.
    if (st.buildZone) {
      ctx.save();
      ctx.setLineDash([8, 6]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = st.placing ? 'rgba(143,255,226,0.8)' : 'rgba(143,255,226,0.35)';
      for (const z of st.buildZone) {
        // Пакет S: zx/zy — дельта-пространство (мир − камера), видимая ширина
        // в нём = vw/vh (не W/H) при любом z. Аудит ZOOM_CULL §3 предположил
        // здесь дефект «экранные vs мировые» — проверка показала, что сравнение
        // корректно; комментарий держит систему координат явной.
        const zx = z.x * TILE - cam.x, zy = z.y * TILE - cam.y;
        if (zx > vw || zy > vh || zx + z.w * TILE < 0 || zy + z.h * TILE < 0) continue;
        ctx.strokeRect(zx, zy, z.w * TILE, z.h * TILE);
      }
      ctx.restore();
    }

    // Кристаллы минералов (на разведанной территории).
    for (const c of st.map.crystals) {
      if (c.amount <= 0 || !inView(c.x, c.y, 40)) continue;
      if (!st.fog.tileExplored(c.tx, c.ty)) continue;
      try { this.drawCrystal(ctx, c, cam.x, cam.y); } catch (e) { this.drawWarnOnce('crystal', e); }
    }

    // Здания: свои всегда; вражеские — видимые или «запомненные».
    for (const b of st.buildings) {
      if (b.dead) continue;
      const bx = b.tx * TILE, by = b.ty * TILE;
      // Пакет S (баг 3 проверки Q): клиллинг в МИРОВЫХ координатах — видимая
      // область при зуме vw=W/z, vh=H/z (как inView у юнитов), а не экранная W/H.
      // При z<1 W-вариант отсекал здания на видимой половине экрана (S8-репро).
      if (bx > cam.x + vw || by > cam.y + vh ||
          bx + b.w * TILE < cam.x || by + b.h * TILE < cam.y) continue;
      const visibleNow = b.side === 'player' ||
        st.fog.tileVisible(b.tx + (b.w >> 1), b.ty + (b.h >> 1));
      if (b.side === 'enemy' && !b.spotted && !visibleNow) continue;
      try { B.drawBuilding(ctx, b, b.side === 'enemy' && !visibleNow, cam.x, cam.y, st); }
      catch (e) { this.drawWarnOnce('building:' + b.type, e); continue; }
      // M0: пульсирующий ромб над ключевой целью (обе расы, янтарь DS).
      if (b.keyTarget && !b.dead) {
        const pulse = 0.6 + 0.4 * Math.sin(performance.now() * 0.005);
        const dx = bx + (b.w * TILE) / 2 - cam.x, dy = by - 14 - cam.y;
        ctx.save();
        ctx.globalAlpha = pulse;
        ctx.fillStyle = '#f3c579';
        ctx.beginPath();
        ctx.moveTo(dx, dy - 8); ctx.lineTo(dx + 6, dy);
        ctx.lineTo(dx, dy + 8); ctx.lineTo(dx - 6, dy);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = '#3a2a12'; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.restore();
      }
    }

    // M0: круг зоны эвакуации на земле (пульс + пунктир).
    if (st.win && st.win.kind === 'evac') {
      const w = st.win;
      const ex = (w.x + 0.5) * TILE - cam.x, ey = (w.y + 0.5) * TILE - cam.y;
      if (inView((w.x + 0.5) * TILE, (w.y + 0.5) * TILE, w.r * TILE)) {
        const pulse = 0.5 + 0.3 * Math.sin(performance.now() * 0.004);
        ctx.save();
        ctx.globalAlpha = pulse;
        ctx.strokeStyle = '#8ff5e2';
        ctx.lineWidth = 3;
        ctx.setLineDash([10, 7]);
        ctx.beginPath();
        ctx.arc(ex, ey, w.r * TILE, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }
    drawRaidZone(ctx, st, cam, inView);
    // Э7: кольца постов отрядов (видно, что отряд держит сектор).
    drawSquadZones(ctx, st, cam, inView);

    // Юниты с интерполяцией между логическими тиками.
    for (const u of st.units) {
      if (u.dead || u.garrison) continue;
      if (u.side === 'enemy' && !u.visible) continue;
      const wx = u.prevX + (u.x - u.prevX) * alpha;
      const wy = u.prevY + (u.y - u.prevY) * alpha;
      if (!inView(wx, wy, 30)) continue;
      try {
        // Э5: ранг юнита (технологии лаборатории) виден и в самом спрайте
        // (сегменты брони/огни/размер), и шевронами над корпусом.
        const rk = u.side === 'player' && u.kind === 'unit' ? unitRank(st, 'player', u.cfg) : 0;
        U.drawUnit(ctx, u, wx - cam.x, wy - cam.y, rk);
        if (rk > 0) drawRankMark(ctx, wx - cam.x, wy - cam.y - (u.r || 10) - 8, rk, '#f3c579');
      } catch (e) { this.drawWarnOnce('unit:' + u.type, e); }
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

    // Туман войны поверх мира (мягкие края за счёт масштабирования w→экран).
    if (st.fog.dirty) st.fog.paint();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(st.fog.canvas, cam.x / TILE, cam.y / TILE, vw / TILE, vh / TILE, 0, 0, vw, vh);

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

    // Призрак размещаемого здания (во время драга линии — сама линия).
    if (st.placing && st.placing.tx > -900) {
      if (st.wallDrag) this.drawWallLine(ctx, st, cam);
      else this.drawGhost(ctx, st, cam);
    }

    // П2: флажки точек сбора выделенных своих зданий.
    for (const b of st.buildings) {
      if (!b.dead && b.selected && b.side === 'player' && b.rally) {
        this.drawRallyFlag(ctx, b, cam.x, cam.y);
      }
    }

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

    ctx.restore(); // конец зоны мира (тряска + зум)

    // Хотфикс L → G.6: краевые зоны панорамирования. Постоянная слабая
    // разметка кромок игровой области — игрок ВСЕГДА видит, где карта
    // реагирует на курсор (владелец: зона должна быть видимой заранее,
    // а не только в момент въезда в неё). Активная сторона пульсирует
    // ярче — блок ниже.
    const ez = this.edgeZone;
    {
      const top = this.uiTop || 0, bot = this.uiBottom || 0;
      const Lft = this.uiLeft || 0, Rgt = this.uiRight || 0;
      const pw = W - Lft - Rgt, ph = H - top - bot;
      if (this.started && !st.gameOver && pw > 0 && ph > 0) {
        ctx.fillStyle = `rgba(${EDGE_ZONE_COLOR},0.07)`;
        ctx.fillRect(Lft, top, pw, 2);
        ctx.fillRect(Lft, H - bot - 2, pw, 2);
        ctx.fillRect(Lft, top, 2, ph);
        ctx.fillRect(W - Rgt - 2, top, 2, ph);
      }
    }
    if (ez && this.started && !st.gameOver) {
      const M = EDGE_MARGIN;
      const top = this.uiTop || 0, bot = this.uiBottom || 0;
      const Lft = this.uiLeft || 0, Rgt = this.uiRight || 0;
      const t = performance.now() * 0.006;
      const a = 0.14 + 0.05 * Math.sin(t); // мягкий пульс
      const strip = (x, y, w2, h2, vertical, inward) => {
        // Яркая кромка — внешняя (к краю экрана), растворение внутрь зоны:
        // 'neg' — край сверху/слева (min-координата), 'pos' — снизу/справа.
        const g = vertical
          ? (inward === 'neg' ? ctx.createLinearGradient(x, y, x, y + h2)
                              : ctx.createLinearGradient(x, y + h2, x, y))
          : (inward === 'neg' ? ctx.createLinearGradient(x, y, x + w2, y)
                              : ctx.createLinearGradient(x + w2, y, x, y));
        g.addColorStop(0, `rgba(${EDGE_ZONE_COLOR},${a + 0.12})`);
        g.addColorStop(1, `rgba(${EDGE_ZONE_COLOR},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(x, y, w2, h2);
        ctx.fillStyle = `rgba(${EDGE_ZONE_COLOR},${a + 0.25})`;
        if (vertical) ctx.fillRect(x, inward === 'neg' ? y : y + h2 - 2, w2, 2);
        else ctx.fillRect(inward === 'neg' ? x : x + w2 - 2, y, 2, h2);
      };
      const pw = W - Lft - Rgt, ph = H - top - bot;
      if (ez.t) strip(Lft, top, pw, M, true, 'neg');            // верх: свет вниз
      if (ez.b) strip(Lft, H - bot - M, pw, M, true, 'pos');    // низ: свет вверх
      if (ez.l) strip(Lft, top, M, ph, false, 'neg');           // лево: свет вправо
      if (ez.r) strip(W - Rgt - M, top, M, ph, false, 'pos');   // право: свет влево
    }
  }

  // П2: флажок точки сбора. Линия от здания к точке + шест с вымпелом
  // и кольцо на земле (у сбора на кристалле — янтарный ромб вместо кольца).
  drawRallyFlag(ctx, b, camX, camY) {
    const r = b.rally;
    if (!r) return;
    const bx = b.x - camX, by = b.y - camY;
    const rx = r.x - camX, ry = r.y - camY;
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = '#8ff5e2';
    ctx.lineWidth = 1.6;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(rx, ry);
    ctx.stroke();
    ctx.setLineDash([]);
    if (r.crystal) {
      ctx.fillStyle = '#f3c579';
      ctx.beginPath();
      ctx.moveTo(rx, ry - 7); ctx.lineTo(rx + 5, ry);
      ctx.lineTo(rx, ry + 7); ctx.lineTo(rx - 5, ry);
      ctx.closePath(); ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(rx, ry, 9, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Шест и вымпел флага.
    ctx.strokeStyle = '#e8f4f1';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(rx, ry);
    ctx.lineTo(rx, ry - 22);
    ctx.stroke();
    ctx.fillStyle = '#8ff5e2';
    ctx.beginPath();
    ctx.moveTo(rx, ry - 22);
    ctx.lineTo(rx + 13, ry - 18);
    ctx.lineTo(rx, ry - 14);
    ctx.closePath(); ctx.fill();
    ctx.restore();
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
    const tx = Math.max(0, Math.min(st.map.w - cfg.w, pl.tx));
    const ty = Math.max(0, Math.min(st.map.h - cfg.h, pl.ty));
    let ok = st.minerals.player >= cfg.cost;
    if (ok && !B.zoneAllows(st, tx, ty, cfg.w, cfg.h)) ok = false;
    // V-5 (вопрос владельца «непонятно, можно строить тут или нет»): раньше
    // фон футпринта был едва заметным (alpha 0.28) и не говорило, КАКОЙ
    // именно тайл мешает. Теперь каждый недоступный тайл футпринта помечен
    // крест-накрест — преграда видна точно, а не «где-то в области».
    const bad = [];
    for (let y = ty; y < ty + cfg.h; y++)
      for (let x = tx; x < tx + cfg.w; x++)
        if (st.map.blockedAt(x, y) || !st.fog.tileExplored(x, y)) bad.push([x, y]);
    if (bad.length) ok = false;

    const gx = tx * TILE - cam.x, gy = ty * TILE - cam.y;
    ctx.globalAlpha = 0.24;
    ctx.fillStyle = ok ? 'rgba(118,227,215,0.55)' : 'rgba(255,96,87,0.5)';
    ctx.fillRect(gx, gy, cfg.w * TILE, cfg.h * TILE);
    // Недоступные тайлы — плотная красная заливка: читается и сама по себе,
    // и как подложка под полупрозрачным спрайтом.
    if (bad.length) {
      ctx.save();
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = '#ff5a4e';
      for (const [bx, by] of bad) ctx.fillRect(bx * TILE - cam.x, by * TILE - cam.y, TILE, TILE);
      ctx.restore();
    }
    ctx.globalAlpha = 0.55;
    B.drawBuilding(ctx, {
      tx, ty, w: cfg.w, h: cfg.h, side: 'player', type: pl.type, cfg,
      faction: st.factions.player,
      angle: -Math.PI / 4, garrison: [],
      done: true, progress: 1, hp: 1, maxHp: 1, flashT: 0, selected: false,
    }, false, cam.x, cam.y);
    // Кресты — ПОВЕРХ спрайта: иначе метка тонет под призраком здания и
    // «непонятно, какой именно тайл мешает» (изначальный вопрос владельца).
    if (bad.length) {
      ctx.save();
      ctx.globalAlpha = 0.95;
      ctx.strokeStyle = '#ffb3ab'; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
      for (const [bx, by] of bad) {
        const px = bx * TILE - cam.x + 3.5, py = by * TILE - cam.y + 3.5, s = TILE - 7;
        ctx.beginPath();
        ctx.moveTo(px, py); ctx.lineTo(px + s, py + s);
        ctx.moveTo(px + s, py); ctx.lineTo(px, py + s);
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = ok ? '#a8fbe0' : '#ff8a7e';
    ctx.lineWidth = 2;
    ctx.strokeRect(gx + 1, gy + 1, cfg.w * TILE - 2, cfg.h * TILE - 2);
    ctx.globalAlpha = 1;
  }

  // П3 (B.7.4): превью линии 1×1 — тайлы (зелёный/красный) + стоимость.
  drawWallLine(ctx, st, cam) {
    const cfg = BUILDINGS[st.placing.type];
    const { tiles, skipped } = this.wallLineTiles();
    for (const t of tiles) {
      const ok = st.fog.tileExplored(t.x, t.y) && B.canPlace(st.map, t.x, t.y, 1, 1) &&
        B.zoneAllows(st, t.x, t.y, 1, 1);
      // V-5: как и у призрака здания, недоступный тайл помечен крестом —
      // преграда видна точно, а не «красноватая подсветка где-то там».
      ctx.globalAlpha = ok ? 0.3 : 0.5;
      ctx.fillStyle = ok ? 'rgba(118,227,215,0.6)' : 'rgba(255,90,78,0.85)';
      ctx.fillRect(t.x * TILE - cam.x, t.y * TILE - cam.y, TILE, TILE);
      if (!ok) {
        ctx.save();
        ctx.globalAlpha = 0.95;
        ctx.strokeStyle = '#ffb3ab'; ctx.lineWidth = 2; ctx.lineCap = 'round';
        const px = t.x * TILE - cam.x + 4, py = t.y * TILE - cam.y + 4, s = TILE - 8;
        ctx.beginPath();
        ctx.moveTo(px, py); ctx.lineTo(px + s, py + s);
        ctx.moveTo(px + s, py); ctx.lineTo(px, py + s);
        ctx.stroke();
        ctx.restore();
      }
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = ok ? '#a8fbe0' : '#ff8a7e';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(t.x * TILE - cam.x + 1, t.y * TILE - cam.y + 1, TILE - 2, TILE - 2);
    }
    ctx.globalAlpha = 1;
    if (tiles.length) {
      const last = tiles[tiles.length - 1];
      const total = tiles.length * cfg.cost;
      ctx.font = 'bold 13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = skipped > 0 ? '#f3c579' : '#e8f4f1';
      ctx.fillText(t('ui.hints.wallCost', { n: tiles.length, cost: cfg.cost, total }) +
        (skipped > 0 ? ' ' + t('ui.hints.wallCostShort', { n: skipped }) : ''),
        (last.x + 0.5) * TILE - cam.x, last.y * TILE - cam.y - 8);
      ctx.textAlign = 'left';
    }
  }

  drawEffects(ctx, st, inView, camX, camY) {
    // Палитры по фракциям: люди горят оранжевым, кхарид лопаются кислотой.
    const BOOM = {
      human: { core: '#fff3b0', fire: '255,140,50', ring: '255,220,140', ember: '#ffd977' },
      alien: { core: '#eafff0', fire: '110,220,130', ring: '190,140,255', ember: '#9ff5b8' },
    };
    for (const e of st.effects) {
      if (!inView(e.x, e.y, 60)) continue;
      const k = e.t / e.life;
      const ex = e.x - camX, ey = e.y - camY;
      const F = BOOM[e.faction] || BOOM.human;
      if (e.kind === 'boom') {
        const R = (e.big ? 46 : 18) * (0.3 + 0.7 * k);
        // Огненный шар.
        ctx.globalAlpha = (1 - k) * 0.85;
        ctx.fillStyle = 'rgba(' + F.fire + ',1)';
        ctx.beginPath(); ctx.arc(ex, ey, R, 0, Math.PI * 2); ctx.fill();
        // Белая вспышка ядра в начале.
        if (k < 0.45) {
          ctx.globalAlpha = 1 - k * 1.8;
          ctx.fillStyle = F.core;
          ctx.beginPath(); ctx.arc(ex, ey, R * (0.55 - 0.3 * k), 0, Math.PI * 2); ctx.fill();
        }
        // Расширяющееся кольцо.
        ctx.globalAlpha = (1 - k) * 0.8;
        ctx.strokeStyle = 'rgba(' + F.ring + ',1)';
        ctx.lineWidth = 3 * (1 - k) + 1;
        ctx.beginPath(); ctx.arc(ex, ey, R * (0.4 + 1.1 * k), 0, Math.PI * 2); ctx.stroke();
        // Угольки/капли — детерминированы от координат.
        const seed = ((ex * 13 + ey * 7) | 0) * 0.01;
        ctx.fillStyle = F.ember;
        ctx.globalAlpha = 1 - k;
        for (let i = 0; i < 5; i++) {
          const a = seed + i * 2.4;
          const d = R * (0.3 + 0.9 * k);
          ctx.beginPath();
          ctx.arc(ex + Math.cos(a) * d, ey + Math.sin(a) * d - k * 10, 2 * (1 - k) + 0.5, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (e.kind === 'spark') {
        // Искра: яркая линия с головкой.
        const col = e.faction === 'alien' ? '#c8ff9e' : '#ffe9a8';
        const d = 11 * (1 - k) + 3;
        const hx = ex + Math.cos(e.ang) * d, hy = ey + Math.sin(e.ang) * d;
        ctx.globalAlpha = 1 - k;
        ctx.strokeStyle = col;
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(hx, hy); ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(hx, hy, 1.8, 0, Math.PI * 2); ctx.fill();
      } else if (e.kind === 'muzzle') {
        // Вспышка выстрела: звезда-крест + ядро + ореол.
        const col = e.faction === 'alien' ? '#d0ffa8' : '#fff3b0';
        const L = 8 * (1 - k) + 2;
        ctx.globalAlpha = (1 - k) * 0.3;
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(ex, ey, 6.5, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1 - k;
        ctx.strokeStyle = col;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(ex - L, ey); ctx.lineTo(ex + L, ey);
        ctx.moveTo(ex, ey - L * 0.7); ctx.lineTo(ex, ey + L * 0.7);
        ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(ex, ey, 2.2, 0, Math.PI * 2); ctx.fill();
      } else if (e.kind === 'smoke') {
        // Дым повреждённого здания / споры раненого улья.
        const c1 = e.faction === 'alien' ? '#5a4a7a' : '#565c64';
        const c2 = e.faction === 'alien' ? '#3a2a5a' : '#3a3f45';
        const a = (1 - k) * 0.35;
        ctx.globalAlpha = a;
        ctx.fillStyle = c1;
        ctx.beginPath();
        ctx.arc(ex, ey - k * 26, 5 + k * 14, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = a * 0.6;
        ctx.fillStyle = c2;
        ctx.beginPath();
        ctx.arc(ex + 4, ey - k * 34, 3 + k * 10, 0, Math.PI * 2);
        ctx.fill();
      } else if (e.kind === 'debris') {
        // Обломки/шипики: разлёт из точки смерти с затуханием.
        const d = e.dist * (0.3 + 0.7 * k);
        ctx.globalAlpha = 1 - k;
        ctx.fillStyle = e.faction === 'alien'
          ? (k < 0.4 ? '#c8ff9e' : '#7a5a9a')
          : (k < 0.4 ? '#ffd977' : '#9aa2ad');
        const dx = ex + Math.cos(e.ang) * d, dy = ey + Math.sin(e.ang) * d - k * 8;
        ctx.fillRect(dx - 2, dy - 2, 4, 4);
      } else if (e.kind === 'heal') {
        // Зелёный плюсик над леченым юнитом — всплывает и тает.
        const hy = ey - k * 10;
        ctx.globalAlpha = 1 - k;
        ctx.strokeStyle = '#7dff9b';
        ctx.lineWidth = 2;
        const r = 4 + k * 2;
        ctx.beginPath();
        ctx.moveTo(ex, hy - r); ctx.lineTo(ex, hy + r);
        ctx.moveTo(ex - r, hy); ctx.lineTo(ex + r, hy);
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
    if (side === 'player') cap += supplyBonus(st); // Э7: места от командира базы
    // Вылазка: «база» игрока — Дом-шаттл, его места и есть предел отряда.
    // Раньше в хедере висело «4/99» (noBase-заглушка) — игрок читал это как
    // ошибку: мест в Доме 10, а счётчик обещал 99.
    if (st.raidMode === 'expedition' && st.raidHouse) {
      const slots = HOUSE_LEVELS.slots(st.raidHouse.level || 1);
      if (slots > 0) cap = slots;
    } else if (st.noBase && side === 'player') {
      cap = 99;
    }
    st.supply[side].cap = Math.min(cap, SUPPLY_MAX);
  }
}

function fmtTime(sec) {
  const s = Math.max(0, Math.ceil(sec));
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

// --- Запуск ---
// I: локаль грузится ДО построения меню (top-level await — модульная
// точка входа). Затем — статические маркеры index.html и бейдж версии.
await initI18n();
const game = new Game();
window.game = game; // отладочная ручка: window.game.state в консоли
window.__marker = 'gamejs-v6';
window.__cfg = { GRADES, TILE, HOUSE: (typeof HOUSE !== 'undefined' ? HOUSE : null) };

// I: бейдж версии (правило V) — буква пакета + дата поставки;
// смена языка переотрисовывает статические экраны и открытые оверлеи.
ui.setVersionBadge(t('ui.versionBadge', { v: GAME_VERSION, date: GAME_DATE }));
onLocaleChange(() => {
  ui.setVersionBadge(t('ui.versionBadge', { v: GAME_VERSION, date: GAME_DATE }));
  ui.refreshLocale();
});
