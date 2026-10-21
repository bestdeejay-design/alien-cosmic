// ============================================================
// config.js — ВСЕ числовые параметры игры собраны в одном месте.
// Балансировку можно вести, не трогая остальной код.
//
// Две играбельные расы (зеркальные техдеревья, у каждой свой облик):
//   human — «Гелиос-Индастриз» (люди-корпоранты, техника);
//   alien — «кхарид» (кристаллорождённые аборигены планет).
// Ключи юнитов/зданий общие; облик и подписи зависят от фракции.
// Весь видимый текст сущностей живёт в locales/*.js (пакет I):
// здесь только баланс, ID и стабильные ключи (I18N.md §5.2).
// ============================================================

import { entityText } from './i18n.js';

// --- Версия (V): буква последнего контентного пакета; поставка обновляет её и дату в бейдже ---
export const GAME_VERSION = 'Q';
export const GAME_DATE = '22.10.2026'; // дата фактической поставки (правило V)

// --- Мир ---
export const TILE = 32;               // размер одного тайла, px мира
export const MAP_W = 64;              // C/П7: ДЕФОЛТ ширины карты в тайлах
export const MAP_H = 64;              // C/П7: ДЕФОЛТ высоты карты в тайлах
export const WORLD_W = MAP_W * TILE;  // дефолтный размер мира, px (2048)
export const WORLD_H = MAP_H * TILE;

// --- Игровой цикл ---
export const LOGIC_DT = 1 / 30;       // фиксированный шаг логики, сек
export const MAX_FRAME_DT = 0.25;     // потолок кадра — защита от «спирали смерти» после лагов
export const ZOOM_MIN = 0.5;            // G.5: было 0.6 — обзор шире, тайл 16px ещё читаем
export const ZOOM_MAX = 2.0;            // G.5: было 1.6 — детализация для микроменеджмента

// --- Экономика ---
export const START_MINERALS = 150;    // минералы у каждой стороны на старте
export const MINERAL_PER_TRIP = 8;    // сколько рабочий приносит за рейс
export const MINE_TIME = 1.8;         // время добычи одного кристалла, сек
export const SUPPLY_MAX = 200;        // жёсткий потолок населения
export const BUILDERS_PER_SITE = 5; // П3: строителей на одну стройку (и игрок, и ИИ)

// --- Бой ---
export const BULLET_SPEED = 540;      // скорость пули/шипа, px/с
export const SHELL_SPEED = 380;       // скорость снаряда тяжёлой единицы, px/с
export const REPAIR_HP_PER_MINERAL = 6; // сколько HP ремонтируется за 1 минерал

// --- Юниты ---
// r — радиус корпуса (px); sightTiles — обзор в тайлах (туман войны);
// range — дальность атаки (px); speed — скорость (px/с).
// projectile: 'bullet' — самонаводящийся снаряд, 'shell' — снаряд с
// осколками (splash), 'none' — удар в упор.
// vehicle: true — «техника»: ремонтируется рабочими, взрывается крупнее
// (у кхарид вместо техники — крупные существа, логика та же).
// kind — раздел локали: имена/описания в locales/*.js (units.<key>.{human,alien}).
//
// РОСТЕР «ALIEN COSMIC» (обновлённая линейка, не из старой версии):
//   Гелиос — ховер-технологии и плазма: Дрон-техник, Рейнджер, Скиф,
//   Нанит, Плазмер, Бастион, Мортира «Нова»;
//   кхарид — кристаллическая органика: Собиратель, Кристожал,
//   Скользень, Цветень, Кислотник, Громила, Спогром.
export const UNITS = {
  worker: {
    key: 'worker', hp: 60, dmg: 4, range: 26, cooldown: 1.0,
    sightTiles: 7, speed: 92, r: 10, supply: 1, cost: 50, trainTime: 12,
    canMine: true, canBuild: true, canRepair: true,
    projectile: 'none',
  },
  marine: {
    key: 'marine', hp: 52, dmg: 7, range: 134, cooldown: 0.85,
    sightTiles: 7, speed: 100, r: 10, supply: 1, cost: 50, trainTime: 13,
    canMine: false, canBuild: false, projectile: 'bullet',
  },
  buggy: {
    key: 'buggy', hp: 85, dmg: 8, range: 132, cooldown: 0.45,
    sightTiles: 8, speed: 158, r: 11, supply: 2, cost: 100, trainTime: 16,
    canMine: false, canBuild: false, vehicle: true, projectile: 'bullet',
  },
  tank: {
    key: 'tank', hp: 260, dmg: 36, range: 200, cooldown: 2.4,
    sightTiles: 9, speed: 62, r: 14, supply: 3, cost: 180, trainTime: 28,
    canMine: false, canBuild: false, vehicle: true, projectile: 'shell',
    splash: { r: 46, frac: 0.6 },
  },
  medic: {
    key: 'medic', hp: 60, dmg: 2, range: 26, cooldown: 1.0,
    sightTiles: 7, speed: 104, r: 9, supply: 1, cost: 75, trainTime: 16,
    canMine: false, canBuild: false, projectile: 'none', canHeal: true, healRate: 7,
  },
  flamer: {
    key: 'flamer', hp: 75, dmg: 14, range: 74, cooldown: 0.9,
    sightTiles: 7, speed: 90, r: 10, supply: 1, cost: 75, trainTime: 15,
    canMine: false, canBuild: false, projectile: 'shell',
    splash: { r: 36, frac: 0.7 },
  },
  arty: {
    key: 'arty', hp: 160, dmg: 48, range: 400, cooldown: 3.4,
    sightTiles: 10, speed: 48, r: 13, supply: 3, cost: 220, trainTime: 34,
    canMine: false, canBuild: false, vehicle: true, projectile: 'shell',
    splash: { r: 62, frac: 0.65 },
  },
  scout: {
    key: 'scout', hp: 50, dmg: 0, range: 0, cooldown: 1.0,
    sightTiles: 11, speed: 185, r: 9, supply: 1, cost: 60, trainTime: 12,
    canMine: false, canBuild: false, vehicle: true, projectile: 'none', scout: true,
  },
};

// --- Здания ---
// w/h — размер в тайлах; supplyGain — прибавка населения; produces — кого
// обучает (строка или массив); attack:true — само стреляет (турель);
// garrisonCap — сколько пехоты помещается (бункер/кокон); requires — какое
// здание должно быть достроено, прежде чем это можно ставить.
export const BUILDINGS = {
  cc:       { key: 'cc',       w: 4, h: 3, hp: 1500, cost: 400, buildTime: 30, supplyGain: 10, sightTiles: 9, produces: 'worker' },
  depot:    { key: 'depot',    w: 2, h: 2, hp: 500,  cost: 100, buildTime: 14, supplyGain: 8,  sightTiles: 5, produces: null },
  barracks: { key: 'barracks', w: 3, h: 2, hp: 1000, cost: 150, buildTime: 20, supplyGain: 0,  sightTiles: 6, produces: ['marine', 'flamer', 'medic'] },
  turret:   { key: 'turret',   w: 1, h: 1, hp: 380, cost: 100, buildTime: 12, supplyGain: 0, sightTiles: 9,
              attack: true, dmg: 8, range: 150, cooldown: 0.65, projectile: 'bullet' },
  wall:     { key: 'wall',     w: 1, h: 1, hp: 900,  cost: 30,  buildTime: 5,  supplyGain: 0,  sightTiles: 2 },
  bunker:   { key: 'bunker',   w: 2, h: 2, hp: 1100, cost: 120, buildTime: 16, supplyGain: 0,  sightTiles: 8,
              garrisonCap: 4, range: 140 },
  factory:  { key: 'factory',  w: 3, h: 3, hp: 1300, cost: 250, buildTime: 35, supplyGain: 0,  sightTiles: 7,
              produces: ['buggy', 'tank', 'arty', 'scout'], requires: 'barracks' },
  lab:      { key: 'lab',      w: 3, h: 3, hp: 900,  cost: 200, buildTime: 32, supplyGain: 0,  sightTiles: 6,
              requires: 'barracks', research: true },
};

// --- Улучшения (исследуются в Лаборатории / Узле эволюции) ---
// Бонусы применяются автоматически ко ВСЕМ своим юнитам (и новым тоже):
//   infAtk — +3 к урону пехоты за уровень; vehAtk — +5 к урону техники;
//   infArm — −2 к получаемому урону пехоты;  vehArm — −3 у техники.
export const UPGRADES = {
  infAtk: { key: 'infAtk', max: 3,
    costs: [100, 175, 250], times: [40, 55, 70] },
  infArm: { key: 'infArm', max: 3,
    costs: [100, 175, 250], times: [40, 55, 70] },
  vehAtk: { key: 'vehAtk', max: 3,
    costs: [100, 175, 250], times: [45, 60, 75] },
  vehArm: { key: 'vehArm', max: 3,
    costs: [100, 175, 250], times: [45, 60, 75] },
  autoRepair: { key: 'autoRepair', max: 1,
    costs: [150], times: [60], requiresGrade: { type: 'cc', level: 2 } }, // H.1: открывает КЦ Г2
};

// kind — маршрут в локаль: entityText(kind, key, faction, field).
// Проставляется циклом, чтобы не шуметь в каждом литерале.
for (const k of Object.keys(UNITS)) UNITS[k].kind = 'units';
for (const k of Object.keys(BUILDINGS)) BUILDINGS[k].kind = 'buildings';
for (const k of Object.keys(UPGRADES)) UPGRADES[k].kind = 'upgrades';

// --- F.1: занятость кристаллов (прецедент BUILDERS_PER_SITE) ---
export const WORKERS_PER_CRYSTAL = 2; // оптимум на кристалл; маржинальный 3-й — только когда свободных нет
export const REPAIRERS_PER_TARGET = 2; // G.4: техников на цель (аналог лимита добычи)
export const REPAIR_SPREAD_PX = 256;   // G.4: радиус сбора целей вокруг клика (8 тайлов)
export const AUTOREPAIR_RADIUS = 480;  // H.1: радиус диспетчера от КЦ (15 тайлов)
export const AUTOREPAIR_TICK = 0.5;    // H.1: тик диспетчера, сек
export const AUTOREPAIR_WORKERS_PER_SIDE = 2; // H.1: глобальный лимит авто-ремонтников, чтобы не снимать всех с добычи
export const ALARM_BASE_RADIUS = 480;  // H.2: базовый тир тревоги (15 тайлов от КЦ)
export const RECON_TICK = 0.4;         // H.3: тик разведки, сек
export const RECON_FLEE_TILES = 6;     // H.3: отход от угрозы, тайлов
export const RECON_SAMPLES = 12;       // H.3: сэмплов неразведанного за выбор
export const CONTACT_COOLDOWN = 10;    // H.3: кулдаун доклада «контакт», сек

// --- F.2: грейды зданий Г1→Г2→Г3. GRADES[type][to] — цена/время/статы ЦЕЛЕВОГО уровня.
export const GRADES = {
  turret: [null, null, // F.2: индекс = целевой уровень (2, 3)
    { cost: 60, time: 30, dmg: 10, range: 165 },
    { cost: 100, time: 45, dmg: 12, range: 180 }],
  barracks: [null, null, // F.2: индекс = целевой уровень (2, 3)
    { cost: 90, time: 30, rate: 1.25, queue: 7 },
    { cost: 150, time: 45, rate: 1.5, queue: 9 }],
  factory: [null, null, // F.2: индекс = целевой уровень (2, 3)
    { cost: 150, time: 30, rate: 1.25, queue: 7 },
    { cost: 250, time: 45, rate: 1.5, queue: 9 }],
  bunker: [null, null, // F.2: индекс = целевой уровень (2, 3)
    { cost: 72, time: 30, gar: 6, hpMul: 1.25 },
    { cost: 120, time: 45, gar: 8, hpMul: 1.5 }],
  cc: [null, null, // H.0: грейды-ключи без статов (только разблокировки)
    { cost: 240, time: 30 },
    { cost: 400, time: 45 }],
};
export const GRADE_ROMAN = ['', 'I', 'II', 'III'];
export function glevel(type, level) { const g = GRADES[type]; return g ? g[level] || null : null; }
export function gradeDmg(type, level, base) { const e = glevel(type, level); return e && e.dmg ? e.dmg : base; }
export function gradeRange(type, level, base) { const e = glevel(type, level); return e && e.range ? e.range : base; }
export function gradeRate(type, level) { const e = glevel(type, level); return e && e.rate ? e.rate : 1; }
export function gradeQueue(type, level) { const e = glevel(type, level); return e && e.queue ? e.queue : 5; }
export function gradeGar(type, level, base) { const e = glevel(type, level); return e && e.gar ? e.gar : base; }

// --- ИИ противника (базовый профиль; миссии переопределяют) ---
export const AI = {
  workerTarget: 12,      // до скольких рабочих добывать
  maxMarines: 30,        // максимум живой пехоты у ИИ одновременно
  firstWave: 4,          // размер первой волны атаки
  waveGrowth: 2,         // прибавка к каждой следующей волне
  waveMax: 18,           // потолок размера волны
  minWaveInterval: 40,   // минимальная пауза между волнами, сек
  secondBarracksAt: 150, // время постройки второй казармы, сек
  maxTurrets: 0,         // турели у базы
  factory: false,        // строить ли завод техники
  maxBuggies: 0,         // лимит быстрых единиц
  maxTanks: 0,           // лимит тяжёлых единиц
  medics: 0,             // лимит нанитов/цветней
  flamers: 0,            // лимит плазмеров/кислотников
  arty: 0,               // лимит мортир/спогромов
  research: false,       // строить ли лабораторию и исследовать улучшения
  repair: false,         // чинить ли здания и технику
};

// --- Камера ---
export const EDGE_SCROLL_SPEED = 560; // прокрутка мышью у края экрана, px/с
export const KEY_SCROLL_SPEED = 720;  // прокрутка стрелками, px/с
export const EDGE_MARGIN = 26;        // ширина зоны у края экрана, px
export const EDGE_PAN_GRACE = 0.15;   // хотфикс L: задержка до старта пана (с) —
                                      // проход мимо зоны к панели не уводит камеру
export const EDGE_ZONE_COLOR = '118,227,215'; // хотфикс L: индикатор зоны (бирюза, rgb)

// --- Палитра сторон (язык цвета «Рубежа 64»: бирюза против огня) ---
// player — бирюзовый («свечение своих»), enemy — раскалённо-оранжевый.
export const COLORS = {
  player: '#76e3d7', playerDark: '#245e68', playerBright: '#c5fff1',
  enemy:  '#ff806e', enemyDark:  '#713943', enemyBright: '#ffd0b5',
  mineral: '#7ed9e7',
  hpLow: '#ff806e',
  amber: '#f3c579',
};

// --- Подписи по фракции: у людей и кхарид разные имена/описания.
// Тексты берутся из локали (units/buildings/upgrades.<key>.{human,alien}). ---
export function fname(cfg, faction) {
  return entityText(cfg.kind, cfg.key, faction, 'name');
}
export function fdesc(cfg, faction) {
  return entityText(cfg.kind, cfg.key, faction, 'description');
}

// --- Биомы планет (палитры генератора карт): тёмные, чтобы светящиеся
// юниты/кристаллы «горели» на фоне — язык визуала «Рубежа 64» ---
export const BIOMES = {
  mars: { // Актан-4: ржавые пустоши и солончаки (C/П7: рыжее + соль)
    ground: '#472b1b', tones: ['#381f16', '#54301f', '#5c3620', '#3c2318'],
    speck1: 'rgba(18,8,4,0.32)', speck2: 'rgba(233,222,200,0.13)',
    water: '#12414a', waterGlint: 'rgba(126,217,231,0.3)', shore: 'rgba(122,72,42,0.55)',
    rock: ['#38302e', '#4a3d3a', '#5e4c48'], dust: 'rgba(210,120,60,0.16)', dustHex: '#d2783c',
    // Террейн v2: мягкие пятна, глубина воды, пена, галька, вал кратера, флора.
    deep: '#0b2e35', foam: 'rgba(140,230,240,0.55)',
    blotch: ['#54301f', '#381f16', '#663d22'],
    pebble: '#6b5148', craterRim: 'rgba(255,196,150,0.25)',
    flora: '#84452c', floraGlow: 'rgba(255,170,120,0.5)',
  },
  nest: { // Брок-Тхаал: фиолет плоти, зелень слизи (C/П7: глубже + зеленее)
    ground: '#2e1e4e', tones: ['#241832', '#3a2a58', '#422e66', '#291d42'],
    speck1: 'rgba(10,6,20,0.34)', speck2: 'rgba(150,220,160,0.14)',
    water: '#0f4436', waterGlint: 'rgba(126,255,190,0.32)', shore: 'rgba(72,52,110,0.55)',
    rock: ['#332e44', '#443d59', '#574e70'], dust: 'rgba(140,100,220,0.16)', dustHex: '#8c64dc',
    deep: '#0a3327', foam: 'rgba(140,255,200,0.55)',
    blotch: ['#3a2a58', '#241832', '#542f96'],
    pebble: '#6a5f8a', craterRim: 'rgba(190,140,255,0.22)',
    flora: '#46a05a', floraGlow: 'rgba(140,255,170,0.65)',
  },
  moon: { // Селенит-Б: серая пыль, чёрные трещины (C/П7: светлее + чернее)
    ground: '#33363d', tones: ['#282b31', '#3a3e46', '#41454e', '#2d3036'],
    speck1: 'rgba(0,0,0,0.4)', speck2: 'rgba(170,190,210,0.13)',
    water: '#123246', waterGlint: 'rgba(140,200,240,0.28)', shore: 'rgba(80,86,98,0.5)',
    rock: ['#2c2f36', '#3b3f47', '#4c515a'], dust: 'rgba(150,170,190,0.14)', dustHex: '#96aabe',
    deep: '#0c2434', foam: 'rgba(150,210,245,0.5)',
    blotch: ['#3a3e46', '#282b31', '#4e535e'],
    pebble: '#62686f', craterRim: 'rgba(220,230,240,0.22)',
    flora: '#596270', floraGlow: 'rgba(180,220,255,0.5)',
  },
};
