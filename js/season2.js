// ============================================================
// season2.js — первая одиночная миссия Сезона 2.
// Сезон 2 развивается отдельно от кампании Сезона 1: здесь только
// сценарий «Чужие на пороге» и механики, нужные для этого прототипа.
// ============================================================
import { TILE } from './config.js';
import * as U from './units.js';
import { t } from './i18n.js';

const px = (tile) => (tile + 0.5) * TILE;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const distTiles = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const alive = (unit) => !!unit && !unit.dead;

export const SEASON2_M1 = Object.freeze({
  id: 's2_1',
  season: 2,
  scripted: true,
  noEnemyBase: true,
  faction: 'alien',
  enemyFaction: 'human',
  objective: 'script',
  map: {
    seed: 20261022,
    biome: 'nest',
    w: 64,
    h: 64,
    rocks: 6,
    rich: 1.05,
    base: { x: 8, y: 48 },
    lakes: [[30, 19, 3.2, 2.2], [27, 48, 2.6, 1.8], [45, 36, 2.2, 3.1]],
    neutral: [[22, 30], [43, 39]],
  },
  ai: {
    workerTarget: 0, maxMarines: 0, firstWave: 0, waveGrowth: 0, waveMax: 0,
    minWaveInterval: 0, secondBarracksAt: 0, maxTurrets: 0,
    factory: false, maxBuggies: 0, maxTanks: 0, medics: 0, flamers: 0,
    arty: 0, research: false, repair: false,
  },
});

const TRACKS = Object.freeze([
  Object.freeze({ x: 25, y: 38 }),
  Object.freeze({ x: 35, y: 29 }),
  Object.freeze({ x: 44, y: 21 }),
]);

// Координаты в тайлах. Через эти тихие тропы кхарид проходят незамеченными.
const TRAIL_PATHS = Object.freeze([
  Object.freeze([
    Object.freeze({ x: 15, y: 44 }),
    Object.freeze({ x: 20, y: 41 }),
    Object.freeze({ x: 25, y: 38 }),
    Object.freeze({ x: 31, y: 33 }),
    Object.freeze({ x: 37, y: 27 }),
    Object.freeze({ x: 44, y: 21 }),
    Object.freeze({ x: 50, y: 15 }),
  ]),
]);

const PATROL_ROUTE = Object.freeze([
  Object.freeze({ x: 49, y: 16 }),
  Object.freeze({ x: 43, y: 22 }),
  Object.freeze({ x: 37, y: 27 }),
  Object.freeze({ x: 31, y: 33 }),
  Object.freeze({ x: 24, y: 39 }),
  Object.freeze({ x: 17, y: 45 }),
  Object.freeze({ x: 10, y: 49 }),
]);

const TRAP = Object.freeze({ x: 28, y: 35, radius: 2.8 });
const FIND_DEADLINE = 50;
const BASE_REACH_RADIUS = 3.2;

function findOpenSpawnTile(st, tx, ty, used) {
  for (let r = 0; r <= 5; r++) {
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
  const tile = findOpenSpawnTile(st, tx, ty, used);
  return U.spawnUnit(st, side, type, px(tile.x), px(tile.y));
}

function orderOnRoute(st, unit, index = 0) {
  const route = st.s2 ? st.s2.route : PATROL_ROUTE;
  if (!alive(unit) || index >= route.length) return;
  unit.s2RouteIndex = index;
  const point = route[index];
  U.orderMove(st, unit, px(point.x), px(point.y));
}

export function setupSeason2Mission(st) {
  const base = st.map.bases.player.cc;
  const usedPlayer = new Set();
  const heroine = spawnAt(st, 'player', 'hero', base.x + 6, base.y + 1, usedPlayer);
  heroine.s2NoAutoAcquire = true;
  const scout = spawnAt(st, 'player', 'scout', base.x + 8, base.y - 1, usedPlayer);
  const defenders = [
    spawnAt(st, 'player', 'marine', base.x + 5, base.y - 2, usedPlayer),
    spawnAt(st, 'player', 'marine', base.x + 6, base.y - 3, usedPlayer),
    spawnAt(st, 'player', 'marine', base.x + 7, base.y - 2, usedPlayer),
  ];

  const usedPatrol = new Set();
  const captain = spawnAt(st, 'enemy', 'hero', 51, 14, usedPatrol);
  captain.s2Captain = true;
  const patrol = [
    captain,
    spawnAt(st, 'enemy', 'marine', 50, 16, usedPatrol),
    spawnAt(st, 'enemy', 'marine', 52, 16, usedPatrol),
    spawnAt(st, 'enemy', 'marine', 49, 14, usedPatrol),
    spawnAt(st, 'enemy', 'marine', 51, 18, usedPatrol),
    spawnAt(st, 'enemy', 'marine', 48, 17, usedPatrol),
  ];
  // Миссионный темп: около 0.75 тайла/с, чтобы у игрока было время
  // заметить патруль и перехватить его до подхода к гнезду.
  for (const unit of patrol) unit.cfg = { ...unit.cfg, speed: 24 };

  st.s2 = {
    heroine,
    isOnTrail: (unit) => isOnSeason2Trail(st, unit),
    scout,
    defenders,
    captain,
    patrol,
    tracks: TRACKS,
    trails: TRAIL_PATHS,
    trap: TRAP,
    basePoint: { x: (base.x + 2) * TILE, y: (base.y + 1.5) * TILE },
    route: PATROL_ROUTE.map((point) => findOpenSpawnTile(st, point.x, point.y, new Set())),
    foundTracks: 0,
    spotted: false,
    spottedAt: null,
    foundBeforeDeadline: false,
    noise: false,
    noisePoint: null,
    investigators: [],
    trapBaited: false,
    trapped: false,
    trapKnown: false,
    finale: false,
    findDeadline: FIND_DEADLINE,
  };

  for (const unit of patrol) {
    unit.s2LastHp = unit.hp;
    orderOnRoute(st, unit);
  }

  st.selection = [heroine, scout];
  U.syncSelectionFlags(st);
}

function pointSegmentDistance(p, a, b) {
  const vx = b.x - a.x, vy = b.y - a.y;
  const wx = p.x - a.x, wy = p.y - a.y;
  const vv = vx * vx + vy * vy;
  const t = vv ? Math.max(0, Math.min(1, (wx * vx + wy * vy) / vv)) : 0;
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}

export function isOnSeason2Trail(st, unit) {
  const s2 = st && st.s2;
  if (!s2 || !unit || unit.dead || unit.side !== 'player') return false;
  const p = { x: unit.x / TILE, y: unit.y / TILE };
  for (const path of s2.trails) {
    for (let i = 1; i < path.length; i++) {
      if (pointSegmentDistance(p, path[i - 1], path[i]) <= 0.72) return true;
    }
  }
  return false;
}

function nearestPlayer(st, point, requireVisible = false) {
  let best = null, bestDist = Infinity;
  for (const unit of st.units) {
    if (!alive(unit) || unit.side !== 'player' || unit.garrison) continue;
    if (requireVisible && isOnSeason2Trail(st, unit)) continue;
    const d = dist(unit, point);
    if (d < bestDist) { best = unit; bestDist = d; }
  }
  return best;
}

function triggerNoise(st, point) {
  const s2 = st.s2;
  if (s2.noise || s2.finale) return;
  s2.noise = true;
  s2.noisePoint = { x: point.x, y: point.y };
  const trapPoint = { x: px(s2.trap.x), y: px(s2.trap.y) };
  const baitDistance = distTiles(
    { x: point.x / TILE, y: point.y / TILE },
    { x: s2.trap.x + 0.5, y: s2.trap.y + 0.5 },
  );
  s2.trapBaited = baitDistance <= s2.trap.radius + 1.1;
  const nonCaptain = s2.patrol.filter((unit) => alive(unit) && unit !== s2.captain);
  s2.investigators = nonCaptain.slice(0, Math.ceil(nonCaptain.length / 2));
  const target = s2.trapBaited ? trapPoint : point;
  for (const unit of s2.investigators) U.orderMove(st, unit, target.x, target.y);
  st.game.ui.toast(t('missions.s2_1.noiseHint'), 'warn');
  st.game.sound.ping();
}

function advancePatrol(st, unit) {
  if (!alive(unit) || unit.s2Trapped || unit.s2Ceasefire) return;
  if (unit.s2Investigator) {
    if (unit.s2Searching) return;
    const target = st.s2.trapBaited
      ? { x: px(st.s2.trap.x), y: px(st.s2.trap.y) }
      : st.s2.noisePoint;
    if (!target) return;
    if (dist(unit, target) <= TILE * 0.9) {
      unit.s2Searching = true;
      U.orderStop(unit);
    } else if (unit.order.kind === 'idle') {
      U.orderMove(st, unit, target.x, target.y);
    }
    return;
  }
  const index = unit.s2RouteIndex || 0;
  const waypoint = st.s2.route[index];
  if (!waypoint) return;
  const target = { x: px(waypoint.x), y: px(waypoint.y) };
  if (dist(unit, target) <= TILE * 0.85) {
    orderOnRoute(st, unit, index + 1);
  } else if (unit.order.kind === 'idle' || unit.order.kind === 'attack') {
    // После локальной стычки отряд возвращается к сценарию маршрута.
    orderOnRoute(st, unit, index);
  }
}

function s2TrapReached(st, unit) {
  const trapPoint = { x: px(st.s2.trap.x), y: px(st.s2.trap.y) };
  return dist(unit, trapPoint) <= TILE * 1.25;
}

function detectFirstTrack(st) {
  const s2 = st.s2;
  if (!alive(s2.scout)) return;
  while (s2.foundTracks < s2.tracks.length) {
    const track = s2.tracks[s2.foundTracks];
    if (dist(s2.scout, { x: px(track.x), y: px(track.y) }) > TILE * 1.65) break;
    s2.foundTracks++;
    s2.trapKnown = true;
    if (s2.foundTracks === 1) {
      st.game.ui.toast(t('missions.s2_1.firstTrackHint'), 'info');
    } else if (s2.foundTracks === s2.tracks.length) {
      st.game.ui.toast(t('missions.s2_1.lastTrackHint'), 'info');
    }
  }
}

function detectPatrol(st) {
  const s2 = st.s2;
  if (s2.spotted || (s2.foundTracks === 0 && !s2.noise)) return;
  const seen = s2.patrol.some((unit) => alive(unit) && unit.visible);
  if (!seen) return;
  s2.spotted = true;
  s2.spottedAt = st.time;
  s2.foundBeforeDeadline = st.time <= s2.findDeadline;
  st.game.ui.toast(t('missions.s2_1.spottedHint'), 'info');
  st.game.sound.ready();
}

function detectNoise(st) {
  const s2 = st.s2;
  if (s2.noise || s2.finale) return;

  for (const enemy of s2.patrol) {
    if (enemy.hp < enemy.s2LastHp - 0.01) {
      const shooter = nearestPlayer(st, enemy);
      triggerNoise(st, shooter || enemy);
      enemy.s2LastHp = enemy.hp;
      break;
    }
    enemy.s2LastHp = enemy.hp;
  }
  if (s2.noise) return;

  for (const unit of st.units) {
    if (!alive(unit) || unit.side !== 'player' || unit.garrison || isOnSeason2Trail(st, unit)) continue;
    for (const enemy of s2.patrol) {
      if (alive(enemy) && dist(unit, enemy) <= TILE * 5.2) {
        triggerNoise(st, unit);
        return;
      }
    }
  }
}

function updateTrap(st) {
  const s2 = st.s2;
  if (!s2.trapBaited || s2.trapped) return;
  for (const unit of s2.investigators) {
    if (!alive(unit) || unit.s2Trapped || !s2TrapReached(st, unit)) continue;
    unit.s2Trapped = true;
    U.orderStop(unit);
  }
  const trappedCount = s2.investigators.filter((unit) => alive(unit) && unit.s2Trapped).length;
  if (trappedCount >= 2) {
    s2.trapped = true;
    st.game.ui.toast(t('missions.s2_1.trapHint'), 'info');
  }
}

function startFinale(game, st) {
  const s2 = st.s2;
  if (s2.finale) return;
  s2.finale = true;
  for (const enemy of s2.patrol) {
    if (!alive(enemy)) continue;
    enemy.s2Ceasefire = true;
    U.orderStop(enemy);
  }
  if (alive(s2.captain)) {
    // Рейн опускает оружие. Это локальная копия конфига, не меняющая
    // характеристики остальных героев или последующих партий.
    s2.captain.cfg = { ...s2.captain.cfg, dmg: 0, range: 0, projectile: 'none' };
  }
  U.orderStop(s2.heroine);
  st.game.ui.toast(t('missions.s2_1.rainLowersWeapon'), 'info');
  st.game.win(t('missions.s2_1.winReason'));
}

export function updateSeason2Mission(game, st) {
  const s2 = st.s2;
  if (!s2 || st.gameOver) return;
  if (!alive(s2.heroine)) {
    game.lose(t('missions.s2_1.heroLost'));
    return;
  }

  detectFirstTrack(st);
  detectPatrol(st);
  detectNoise(st);

  if (s2.noise && !s2.investigatorsMarked) {
    for (const unit of s2.investigators) unit.s2Investigator = true;
    s2.investigatorsMarked = true;
  }

  for (const unit of s2.patrol) advancePatrol(st, unit);
  updateTrap(st);

  // Финальный контакт — встреча Тха-Риссы и капитана Рейна.
  if (alive(s2.captain) && dist(s2.heroine, s2.captain) <= TILE * 3.1) {
    startFinale(game, st);
    return;
  }

  // Вторичная цель «найти отряд до срока» перестаёт быть выполнимой,
  // но сама миссия продолжается: можно успеть перехватить позже.
  if (!s2.spotted && st.time > s2.findDeadline) s2.findDeadlinePassed = true;

  const reachedBase = s2.patrol.some((unit) => alive(unit) && dist(unit, s2.basePoint) <= TILE * BASE_REACH_RADIUS);
  if (reachedBase) {
    game.lose(t('missions.s2_1.baseReached'));
    return;
  }

  // Победа, если больше некому продолжать путь к гнезду. Следователи,
  // уже отделённые шумом, сами по себе угрозы гнезду не представляют.
  const stillMarching = s2.patrol.some((unit) => alive(unit) && !unit.s2Investigator && !unit.s2Trapped);
  if (!stillMarching) game.win(t('missions.s2_1.patrolStopped'));
}

function formatTime(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function remainingTime(st, deadline = st.s2.findDeadline) {
  return formatTime(deadline - st.time);
}

function timeToNest(st) {
  const s2 = st.s2;
  let nearest = Infinity;
  for (const unit of s2.patrol) {
    if (!alive(unit) || unit.s2Trapped || unit.s2Investigator) continue;
    const index = Math.max(0, unit.s2RouteIndex || 0);
    if (!s2.route[index]) continue;
    let routeTiles = distTiles(
      { x: unit.x / TILE, y: unit.y / TILE },
      s2.route[index],
    );
    for (let i = index + 1; i < s2.route.length; i++) {
      routeTiles += distTiles(s2.route[i - 1], s2.route[i]);
    }
    routeTiles = Math.max(0, routeTiles - BASE_REACH_RADIUS);
    nearest = Math.min(nearest, routeTiles * TILE / Math.max(1, unit.cfg.speed || 1));
  }
  return formatTime(nearest === Infinity ? 0 : nearest);
}

export function season2ObjectiveText(st) {
  const s2 = st && st.s2;
  if (!s2) return '';
  if (s2.finale) return t('missions.s2_1.hudFinale');
  if (s2.trapped) return t('missions.s2_1.hudTrap');
  if (s2.spotted) return t('missions.s2_1.hudIntercept', { time: timeToNest(st) });
  if (s2.foundTracks > 0) return t('missions.s2_1.hudFollow', { time: remainingTime(st) });
  return t('missions.s2_1.hudTracks', { time: remainingTime(st) });
}

export function season2EndObjectives(st) {
  const s2 = st && st.s2;
  if (!s2) return [];
  return [
    { label: t('missions.s2_1.secondaryFind', { time: formatTime(s2.findDeadline) }), complete: !!s2.foundBeforeDeadline },
    { label: t('missions.s2_1.secondaryScout'), complete: alive(s2.scout) },
    { label: t('missions.s2_1.secondaryTrap'), complete: !!s2.trapped },
  ];
}

function drawTrail(ctx, path, cam, st) {
  // Рисуем цельную линию под туманом: ещё не исследованные отрезки
  // скрывает fog canvas, а уже открытые показывают тихий маршрут.
  ctx.beginPath();
  path.forEach((point, i) => {
    const x = px(point.x) - cam.x, y = px(point.y) - cam.y;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(154,255,198,0.11)';
  ctx.lineWidth = TILE * 0.72;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(164,255,205,0.45)';
  ctx.lineWidth = 2.2;
  ctx.setLineDash([7, 9]);
  ctx.stroke();
  ctx.setLineDash([]);

  // Лёгкие метки по пути — только на уже открытой части карты.
  for (let i = 1; i < path.length - 1; i++) {
    const point = path[i];
    if (!st.fog.tileExplored(point.x, point.y)) continue;
    const x = px(point.x) - cam.x, y = px(point.y) - cam.y;
    ctx.fillStyle = 'rgba(194,255,218,0.68)';
    ctx.beginPath(); ctx.ellipse(x - 5, y, 2.1, 3.2, -0.35, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x + 4, y - 3, 2.1, 3.2, 0.35, 0, Math.PI * 2); ctx.fill();
  }
}

export function drawSeason2Overlay(ctx, st, cam, inView) {
  const s2 = st && st.s2;
  if (!s2) return;
  ctx.save();
  for (const path of s2.trails) drawTrail(ctx, path, cam, st);

  if (s2.trapKnown) {
    const x = px(s2.trap.x) - cam.x, y = px(s2.trap.y) - cam.y;
    const r = s2.trap.radius * TILE;
    if (inView(x + cam.x, y + cam.y, r)) {
      ctx.fillStyle = 'rgba(243,197,121,0.045)';
      ctx.strokeStyle = 'rgba(243,197,121,0.55)';
      ctx.lineWidth = 1.7;
      ctx.setLineDash([6, 6]);
      ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.72, -0.25, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,225,164,0.9)';
      ctx.font = '700 10px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(t('missions.s2_1.trapMarker'), x, y - r * 0.78);
    }
  }

  for (let i = 0; i < s2.tracks.length; i++) {
    const point = s2.tracks[i];
    if (!st.fog.tileExplored(point.x, point.y)) continue;
    const x = px(point.x) - cam.x, y = px(point.y) - cam.y;
    const pulse = 0.62 + 0.25 * Math.sin(performance.now() * 0.003 + i);
    ctx.globalAlpha = pulse;
    ctx.strokeStyle = '#d4ffe0';
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.ellipse(x, y, 9, 5.5, -0.4, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#c9ffd9';
    ctx.beginPath(); ctx.ellipse(x - 3, y - 1, 1.6, 2.5, -0.4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x + 3, y + 1, 1.6, 2.5, -0.4, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

export function drawHeroAura(ctx, st, cam, hero, inView) {
  if (!hero || hero.dead || hero.side !== 'player' || !hero.cfg.auraRadiusTiles) return;
  const x = hero.x - cam.x, y = hero.y - cam.y;
  const radius = hero.cfg.auraRadiusTiles * TILE;
  if (!inView(hero.x, hero.y, radius)) return;
  const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.002);
  ctx.save();
  ctx.fillStyle = `rgba(159,245,184,${0.025 + pulse * 0.025})`;
  ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = `rgba(159,245,184,${0.24 + pulse * 0.15})`;
  ctx.lineWidth = 1.2;
  ctx.setLineDash([5, 8]);
  ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}
