// ============================================================
// season2.js — первая обучающая миссия Сезона 2.
// Короткая RTS-петля: найти отключённую базу, включить ретранслятор
// героем, добыть минералы, построить оборону и отбить налёт.
// ============================================================
import { TILE, BUILDINGS } from './config.js';
import * as U from './units.js';
import { t } from './i18n.js';

const px = (tile) => (tile + 0.5) * TILE;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const alive = (unit) => !!unit && !unit.dead;
const MINE_TARGET = 120;
const WALL_TARGET = 3;
const RANGER_GARRISON_TARGET = 3;
const BUILD_ZONE = Object.freeze({ x: 17, y: 15, w: 20, h: 16 });
const OUTPOST = Object.freeze({ x: 22, y: 20 });
const RELAY_TILE = Object.freeze({ x: 27, y: 21 });
const RELAY_REACH = TILE * 2.2;
const RAID_TIMES = Object.freeze([145, 325]);

export const SEASON2_M1 = Object.freeze({
  id: 's2_1',
  season: 2,
  scripted: true,
  noBase: true,
  noEnemyBase: true,
  noUpgrades: true,
  faction: 'human',
  enemyFaction: 'alien',
  objective: 'script',
  startMinerals: 250,
  // Командный центр уже стоит на аванпосте, но не работает без связи.
  // Строим только казарму, бункер и стены; улучшений в первой миссии нет.
  banBuild: ['cc', 'depot', 'turret', 'factory', 'lab'],
  squad: [['hero', 1], ['scout', 1], ['marine', 3], ['worker', 2]],
  map: {
    seed: 20261023,
    biome: 'mars',
    w: 48,
    h: 48,
    rocks: 3,
    rich: 1,
    base: { x: 4, y: 39 },
    lakes: [],
    neutral: [[30, 20]],
  },
  ai: {
    workerTarget: 0, maxMarines: 0, firstWave: 0, waveGrowth: 0, waveMax: 0,
    minWaveInterval: 0, secondBarracksAt: 0, maxTurrets: 0,
    factory: false, maxBuggies: 0, maxTanks: 0, medics: 0, flamers: 0,
    arty: 0, research: false, repair: false,
  },
});

function clearOutpostFootprint(st, x, y, w, h) {
  for (const crystal of [...st.map.crystals]) {
    if (crystal.tx >= x && crystal.tx < x + w && crystal.ty >= y && crystal.ty < y + h) {
      st.map.removeCrystal(crystal);
    }
  }
  for (let ty = y; ty < y + h; ty++) {
    for (let tx = x; tx < x + w; tx++) {
      if (!st.map.inBounds(tx, ty)) continue;
      st.map.terrain[st.map.idx(tx, ty)] = 0;
    }
  }
}

function findOpenTile(st, tx, ty, used = new Set(), maxRadius = 6) {
  for (let r = 0; r <= maxRadius; r++) {
    for (let y = ty - r; y <= ty + r; y++) {
      for (let x = tx - r; x <= tx + r; x++) {
        if (Math.max(Math.abs(x - tx), Math.abs(y - ty)) !== r) continue;
        if (!st.map.inBounds(x, y) || st.map.blockedAt(x, y)) continue;
        const key = y * st.map.w + x;
        if (used.has(key)) continue;
        used.add(key);
        return { x, y };
      }
    }
  }
  return { x: tx, y: ty };
}

function spawnAt(st, side, type, tx, ty, used = new Set()) {
  const tile = findOpenTile(st, tx, ty, used);
  return U.spawnUnit(st, side, type, px(tile.x), px(tile.y));
}

export function setupSeason2Mission(st, buildingModule) {
  const player = st.units.filter((unit) => unit.side === 'player' && !unit.dead);
  const hero = player.find((unit) => unit.type === 'hero');
  const scout = player.find((unit) => unit.type === 'scout');
  const rangers = player.filter((unit) => unit.type === 'marine');
  const workers = player.filter((unit) => unit.type === 'worker');
  if (!hero || !scout || rangers.length !== 3 || workers.length !== 2 || !buildingModule) {
    throw new Error('Season 2 M1 requires hero, scout, three rangers, two workers, and the building module.');
  }

  // Освобождаем площадку под старый аванпост. Ресурсное поле остаётся
  // рядом восточнее командного центра.
  clearOutpostFootprint(st, OUTPOST.x - 1, OUTPOST.y - 1, 9, 6);
  st.map.buildTerrainCanvas();
  st.map.buildMiniCanvas();
  const cc = new buildingModule.Building(st, 'player', 'cc', OUTPOST.x, OUTPOST.y, true);
  cc.s2Offline = true;
  cc.s2Hidden = true;
  cc.cfg = { ...cc.cfg, produces: null };
  st.map.markBuilding(cc);
  st.bcount.player++;

  const relay = {
    x: px(RELAY_TILE.x), y: px(RELAY_TILE.y),
    tx: RELAY_TILE.x, ty: RELAY_TILE.y,
    active: false,
  };
  const s2 = {
    hero, scout, rangers, workers, cc, relay,
    buildZone: { ...BUILD_ZONE },
    baseFound: false,
    relayActivationRequested: false,
    relayOnAt: null,
    bunker: null,
    raiders: [],
    raidGroups: [null, null],
    finalBoss: null,
  };
  st.s2 = s2;
  st.buildZone = null;
  st.minerals.player = Number.isFinite(st.game.mission.startMinerals)
    ? st.game.mission.startMinerals : 250;

  // По умолчанию выбран Следопыт — первый приказ помогает открыть карту.
  st.selection = [scout];
  U.syncSelectionFlags(st);
}

export function activateSeason2Relay(game, st, hero) {
  const s2 = st && st.s2;
  if (!s2 || !hero || hero !== s2.hero || hero.dead || s2.relay.active || !s2.baseFound) return false;
  if (dist(hero, s2.relay) > RELAY_REACH) return false;

  s2.relay.active = true;
  s2.relayActivationRequested = false;
  s2.relayOnAt = st.time;
  U.orderStop(hero);
  s2.cc.s2Offline = false;
  s2.cc.cfg = BUILDINGS.cc;
  st.buildZone = [{ ...s2.buildZone }];
  game.ui.toast(t('missions.s2_1.relayOnline'), 'info');
  game.ui.toast(t('missions.s2_1.buildZoneHint'), 'info');
  game.sound.ready();
  return true;
}

function buildingCount(st, type) {
  return st.buildings.filter((building) => !building.dead && building.side === 'player' &&
    building.type === type && building.done).length;
}

function wallCount(st) { return buildingCount(st, 'wall'); }
function garrisonedRangers(s2) {
  return s2.rangers.filter((unit) => alive(unit) && unit.garrison === s2.bunker).length;
}

function allDead(units) { return !units || units.every((unit) => !alive(unit)); }
function timeString(seconds) {
  const value = Math.max(0, Math.ceil(seconds));
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

function missionStage(st) {
  const s2 = st.s2;
  if (!s2.baseFound) return 'find';
  if (!s2.relay.active) return 'activate';
  if (st.stats.mined < MINE_TARGET) return 'mine';
  if (buildingCount(st, 'barracks') < 1) return 'barracks';
  if (!s2.bunker || s2.bunker.dead || !s2.bunker.done) return 'bunker';
  if (wallCount(st) < WALL_TARGET) return 'wall';
  if (garrisonedRangers(s2) < RANGER_GARRISON_TARGET) return 'garrison';

  if (!s2.raidGroups[0]) return 'prepareRaid';
  if (!allDead(s2.raidGroups[0])) return 'firstRaid';
  if (!s2.raidGroups[1]) return 'prepareCommander';
  if (!allDead(s2.raidGroups[1])) return 'commander';
  return 'complete';
}

function spawnRaid(st, wave, types, targetRelay = false) {
  const s2 = st.s2;
  const used = new Set();
  const entry = { x: st.map.w - 3, y: RELAY_TILE.y };
  const group = [];
  for (const type of types) {
    const unit = spawnAt(st, 'enemy', type, entry.x, entry.y, used);
    unit.s2Raid = wave;
    if (type === 'hero') {
      // Командир опасен в дуэли, но слабее героя игрока, чтобы оставить
      // новичку запас времени на освоение боевых приказов.
      unit.cfg = { ...unit.cfg, hp: 210, dmg: 15, cooldown: 1.1, speed: 96 };
      unit.hp = unit.maxHp = unit.cfg.hp;
      unit.s2RetakeHero = true;
      s2.finalBoss = unit;
    }
    group.push(unit);
    s2.raiders.push(unit);
    if (targetRelay && type === 'hero') U.orderAttackMove(st, unit, s2.relay.x, s2.relay.y);
    else U.orderAttack(st, unit, s2.cc);
  }
  s2.raidGroups[wave - 1] = group;
  st.game.ui.toast(t(targetRelay ? 'missions.s2_1.commanderIncoming' : 'missions.s2_1.raidIncoming', { n: wave }), 'warn');
  st.game.sound.ping();
}

function updateDiscovery(st) {
  const s2 = st.s2;
  if (s2.baseFound) return;
  const tx = s2.relay.tx, ty = s2.relay.ty;
  if (!st.fog.tileVisible(tx, ty) && !st.fog.tileExplored(tx, ty)) return;
  s2.baseFound = true;
  s2.cc.s2Hidden = false;
  st.game.ui.toast(t('missions.s2_1.baseFound'), 'info');
  st.game.ui.toast(t('missions.s2_1.ccOfflineHint'), 'warn');
  st.game.sound.ready();
}

function updateRaids(game, st) {
  const s2 = st.s2;
  if (!s2.relay.active) return;
  const elapsed = st.time - s2.relayOnAt;
  if (!s2.raidGroups[0] && elapsed >= RAID_TIMES[0]) {
    spawnRaid(st, 1, ['marine', 'marine']);
  }
  if (!s2.raidGroups[1] && s2.raidGroups[0] && allDead(s2.raidGroups[0]) && elapsed >= RAID_TIMES[1]) {
    spawnRaid(st, 2, ['marine', 'marine', 'hero'], true);
  }

}

function requiredTasksComplete(st) {
  const s2 = st.s2;
  return !!(s2.relay.active && st.stats.mined >= MINE_TARGET &&
    buildingCount(st, 'barracks') >= 1 && s2.bunker && !s2.bunker.dead && s2.bunker.done &&
    wallCount(st) >= WALL_TARGET && garrisonedRangers(s2) >= RANGER_GARRISON_TARGET);
}

export function updateSeason2Mission(game, st) {
  const s2 = st && st.s2;
  if (!s2 || st.gameOver) return;
  if (!alive(s2.hero)) {
    game.lose(t('missions.s2_1.heroLost'));
    return;
  }
  if (!s2.cc || s2.cc.dead) {
    game.lose(t('missions.s2_1.commandCenterLost'));
    return;
  }

  updateDiscovery(st);
  s2.bunker = st.buildings.find((building) => !building.dead && building.side === 'player' && building.type === 'bunker') || null;
  if (s2.relayActivationRequested && s2.baseFound && dist(s2.hero, s2.relay) <= RELAY_REACH) {
    activateSeason2Relay(game, st, s2.hero);
  }
  updateRaids(game, st);
  if (st.gameOver) return;

  if (s2.raidGroups[1] && allDead(s2.raiders) && requiredTasksComplete(st)) {
    game.win(t('missions.s2_1.winReason'));
  }
}

export function season2ObjectiveText(st) {
  const s2 = st && st.s2;
  if (!s2) return '';
  const stage = missionStage(st);
  if (stage === 'find') return t('missions.s2_1.objFind');
  if (stage === 'activate') return t('missions.s2_1.objActivate');
  if (stage === 'mine') return t('missions.s2_1.objMine', { n: Math.min(MINE_TARGET, Math.floor(st.stats.mined)), m: MINE_TARGET });
  if (stage === 'barracks') return t('missions.s2_1.objBarracks');
  if (stage === 'bunker') return t('missions.s2_1.objBunker');
  if (stage === 'wall') return t('missions.s2_1.objWall', { n: Math.min(WALL_TARGET, wallCount(st)), m: WALL_TARGET });
  if (stage === 'garrison') return t('missions.s2_1.objGarrison', { n: garrisonedRangers(s2), m: RANGER_GARRISON_TARGET });
  const elapsed = Math.max(0, st.time - (s2.relayOnAt || 0));
  if (stage === 'prepareRaid') return t('missions.s2_1.objPrepareRaid', { time: timeString(RAID_TIMES[0] - elapsed) });
  if (stage === 'firstRaid') return t('missions.s2_1.objFirstRaid');
  if (stage === 'prepareCommander') return t('missions.s2_1.objPrepareCommander', { time: timeString(RAID_TIMES[1] - elapsed) });
  if (stage === 'commander') return t('missions.s2_1.objCommander');
  return t('missions.s2_1.objComplete');
}

export function season2EndObjectives(st) {
  const s2 = st && st.s2;
  if (!s2) return [];
  return [
    { label: t('missions.s2_1.endRelay'), complete: !!s2.relay.active },
    { label: t('missions.s2_1.endMine'), complete: st.stats.mined >= MINE_TARGET },
    { label: t('missions.s2_1.endBuild'), complete: buildingCount(st, 'barracks') >= 1 && s2.bunker && !s2.bunker.dead && s2.bunker.done && wallCount(st) >= WALL_TARGET },
    { label: t('missions.s2_1.endGarrison'), complete: garrisonedRangers(s2) >= RANGER_GARRISON_TARGET },
    { label: t('missions.s2_1.endDefend'), complete: !!s2.raidGroups[1] && allDead(s2.raiders) },
  ];
}

export function drawSeason2Overlay(ctx, st, cam, inView) {
  const s2 = st && st.s2;
  if (!s2 || (!s2.baseFound && !s2.relay.active)) return;
  const relay = s2.relay;
  if (!st.fog.tileExplored(relay.tx, relay.ty)) return;
  const x = relay.x - cam.x, y = relay.y - cam.y;
  if (!inView(relay.x, relay.y, TILE * 2)) return;
  const time = performance.now() * 0.001;
  const pulse = 0.5 + 0.5 * Math.sin(time * 3.2);
  const color = relay.active ? '#7df3e2' : '#ff8b65';

  ctx.save();
  // Основание маяка и отмеченный круг подключения.
  ctx.fillStyle = 'rgba(8,14,18,0.76)';
  ctx.beginPath(); ctx.ellipse(x, y + 8, 22, 11, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = relay.active ? `rgba(125,243,226,${0.35 + pulse * 0.45})` : 'rgba(255,139,101,0.58)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.ellipse(x, y + 8, 19 + pulse * 2, 9 + pulse, 0, 0, Math.PI * 2); ctx.stroke();

  // Три опоры и центральная мачта: OFF — тёмный сигнал, ON — яркий луч.
  ctx.strokeStyle = '#59676d'; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(x - 11, y + 10); ctx.lineTo(x, y - 16); ctx.lineTo(x + 11, y + 10); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x, y + 9); ctx.lineTo(x, y - 23); ctx.stroke();
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(x - 7, y - 2); ctx.lineTo(x + 7, y - 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x - 4, y - 10); ctx.lineTo(x + 4, y - 10); ctx.stroke();
  ctx.fillStyle = relay.active ? `rgba(125,243,226,${0.7 + pulse * 0.3})` : '#8f4137';
  ctx.shadowColor = color; ctx.shadowBlur = relay.active ? 12 : 3;
  ctx.beginPath(); ctx.arc(x, y - 24, relay.active ? 5 + pulse * 1.3 : 4, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;
  if (relay.active) {
    ctx.strokeStyle = `rgba(125,243,226,${0.24 + pulse * 0.24})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x, y - 29); ctx.lineTo(x, y - 48 - pulse * 8); ctx.stroke();
  }

  const label = t(relay.active ? 'missions.s2_1.relayOnLabel' : 'missions.s2_1.relayOffLabel');
  ctx.font = '700 9px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = relay.active ? '#b9fff4' : '#ffc2a8';
  ctx.fillText(label, x, y - 34);
  ctx.restore();
}
