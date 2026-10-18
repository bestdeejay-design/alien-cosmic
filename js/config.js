// ============================================================
// config.js — ВСЕ числовые параметры игры собраны в одном месте.
// Балансировку можно вести, не трогая остальной код.
//
// Две играбельные расы (зеркальные техдеревья, у каждой свой облик):
//   human — «Гелиос-Индастриз» (люди-корпоранты, техника);
//   alien — «кхарид» (кристаллорождённые аборигены планет).
// Ключи юнитов/зданий общие; облик и подписи зависят от фракции.
// ============================================================

// --- Мир ---
export const TILE = 32;               // размер одного тайла, px мира
export const MAP_W = 64;              // ширина карты в тайлах
export const MAP_H = 64;              // высота карты в тайлах
export const WORLD_W = MAP_W * TILE;  // размер мира, px (2048)
export const WORLD_H = MAP_H * TILE;

// --- Игровой цикл ---
export const LOGIC_DT = 1 / 30;       // фиксированный шаг логики, сек
export const MAX_FRAME_DT = 0.25;     // потолок кадра — защита от «спирали смерти» после лагов

// --- Экономика ---
export const START_MINERALS = 150;    // минералы у каждой стороны на старте
export const MINERAL_PER_TRIP = 8;    // сколько рабочий приносит за рейс
export const MINE_TIME = 1.8;         // время добычи одного кристалла, сек
export const SUPPLY_MAX = 200;        // жёсткий потолок населения
export const WORKER_START = 4;        // рабочих у каждой стороны на старте

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
// hname/aname — имя юнита у людей / у кхарид.
//
// РОСТЕР «ALIEN COSMIC» (обновлённая линейка, не из старой версии):
//   Гелиос — ховер-технологии и плазма: Дрон-техник, Рейнджер, Скиф,
//   Нанит, Плазмер, Бастион, Мортира «Нова»;
//   кхарид — кристаллическая органика: Собиратель, Кристожал,
//   Скользень, Цветень, Кислотник, Громила, Спогром.
export const UNITS = {
  worker: {
    key: 'worker', hname: 'Дрон-техник', aname: 'Собиратель', hp: 60, dmg: 4, range: 26, cooldown: 1.0,
    sightTiles: 7, speed: 92, r: 10, supply: 1, cost: 50, trainTime: 12,
    canMine: true, canBuild: true, canRepair: true,
    projectile: 'none',
    hdesc: 'Ховер-дрон Гелиоса: добывает кристаллы, возводит и ремонтирует постройки и технику',
    adesc: 'Кристаллоносец улья: собирает эрг-кристаллы, взращивает гнёзда и латает сородичей',
  },
  marine: {
    key: 'marine', hname: 'Рейнджер', aname: 'Кристожал', hp: 52, dmg: 7, range: 134, cooldown: 0.85,
    sightTiles: 7, speed: 100, r: 10, supply: 1, cost: 50, trainTime: 13,
    canMine: false, canBuild: false, projectile: 'bullet',
    hdesc: 'Штурмовой стрелок с плазменным карабином — костяк любой атаки; помещается в бункер',
    adesc: 'Ползун с гребнем шипов: плюётся кристаллическими дротиками; прячется в коконе',
  },
  buggy: {
    key: 'buggy', hname: 'Скиф', aname: 'Скользень', hp: 85, dmg: 8, range: 132, cooldown: 0.45,
    sightTiles: 8, speed: 158, r: 11, supply: 2, cost: 100, trainTime: 16,
    canMine: false, canBuild: false, vehicle: true, projectile: 'bullet',
    hdesc: 'Стремительный ховер-разведчик со спаркой импульсных пушек — рейды по флангам',
    adesc: 'Четырёхлапый хищник-скользень: налетает, жалит и растворяется в пустошах',
  },
  tank: {
    key: 'tank', hname: 'Бастион', aname: 'Громила', hp: 260, dmg: 36, range: 200, cooldown: 2.4,
    sightTiles: 9, speed: 62, r: 14, supply: 3, cost: 180, trainTime: 28,
    canMine: false, canBuild: false, vehicle: true, projectile: 'shell',
    splash: { r: 46, frac: 0.6 },
    hdesc: 'Тяжёлый ховер-танк с осколочной пушкой: один залп накрывает всю группу',
    adesc: 'Исполин с кристаллическими рогами: его плевок взрывается снопом осколков',
  },
  medic: {
    key: 'medic', hname: 'Нанит', aname: 'Цветень', hp: 60, dmg: 2, range: 26, cooldown: 1.0,
    sightTiles: 7, speed: 104, r: 9, supply: 1, cost: 75, trainTime: 16,
    canMine: false, canBuild: false, projectile: 'none', canHeal: true, healRate: 7,
    hdesc: 'Наномедик: роящиеся наниты латают пехоту рядом (7 ОЗ/с); скальпель — лишь для самообороны',
    adesc: 'Спора-цветень: заживляющая пыльца лечит сородичей (7 ОЗ/с)',
  },
  flamer: {
    key: 'flamer', hname: 'Плазмер', aname: 'Кислотник', hp: 75, dmg: 14, range: 74, cooldown: 0.9,
    sightTiles: 7, speed: 90, r: 10, supply: 1, cost: 75, trainTime: 15,
    canMine: false, canBuild: false, projectile: 'shell',
    splash: { r: 36, frac: 0.7 },
    hdesc: 'Плазмометатель: выжигает группы врагов коротким залпом; страшен в упор, уязвим издали',
    adesc: 'Пузатый плевун: кислотный сноп по площади разъедает даже панцири',
  },
  arty: {
    key: 'arty', hname: 'Мортира «Нова»', aname: 'Спогром', hp: 160, dmg: 48, range: 400, cooldown: 3.4,
    sightTiles: 10, speed: 48, r: 13, supply: 3, cost: 220, trainTime: 34,
    canMine: false, canBuild: false, vehicle: true, projectile: 'shell',
    splash: { r: 62, frac: 0.65 },
    hdesc: 'Самоходная мортира: бьёт на 12 тайлов осколками по площади; медлительна и беззащитна вблизи',
    adesc: 'Огромный червь со спорной мортирой на спине: мечет взрывы через полкарты; держите его позади роя',
  },
};

// --- Здания ---
// w/h — размер в тайлах; supplyGain — прибавка населения; produces — кого
// обучает (строка или массив); attack:true — само стреляет (турель);
// garrisonCap — сколько пехоты помещается (бункер/кокон); requires — какое
// здание должно быть достроено, прежде чем это можно ставить.
export const BUILDINGS = {
  cc:       { key: 'cc',       hname: 'Командный центр', aname: 'Гнездо-улей', w: 4, h: 3, hp: 1500, cost: 400, buildTime: 30, supplyGain: 10, sightTiles: 9, produces: 'worker',
    hdesc: 'Штаб базы: обучает рабочих, принимает минералы, +10 населения',
    adesc: 'Сердце улья: растит собирателей, принимает эрг-кристаллы, +10 населения' },
  depot:    { key: 'depot',    hname: 'Дом',             aname: 'Нарост-кладовая', w: 2, h: 2, hp: 500,  cost: 100, buildTime: 14, supplyGain: 8,  sightTiles: 5, produces: null,
    hdesc: 'Жильё колонистов: +8 населения. Без домов армия не растёт',
    adesc: 'Живой склад: расширяет улей, +8 населения' },
  barracks: { key: 'barracks', hname: 'Казарма',         aname: 'Инкубатор', w: 3, h: 2, hp: 1000, cost: 150, buildTime: 20, supplyGain: 0,  sightTiles: 6, produces: ['marine', 'flamer', 'medic'],
    hdesc: 'Обучает пехоту: рейнджеры, плазмеры и наниты. Очередь — до 5 юнитов',
    adesc: 'Выводит из икры кристожалов, кислотников и цветней. Очередь — до 5 юнитов' },
  turret:   { key: 'turret',   hname: 'Турель «Скорпион»', aname: 'Жвала', w: 1, h: 1, hp: 380, cost: 100, buildTime: 12, supplyGain: 0, sightTiles: 9,
              attack: true, dmg: 8, range: 150, cooldown: 0.65, projectile: 'bullet',
    hdesc: 'Автоматическая пушка: сама находит и обстреливает врагов в радиусе 150',
    adesc: 'Жвала-башня: плюётся шипами по всем чужакам поблизости' },
  wall:     { key: 'wall',     hname: 'Секция стены',    aname: 'Хитиновая стена', w: 1, h: 1, hp: 900,  cost: 30,  buildTime: 5,  supplyGain: 0,  sightTiles: 2,
    hdesc: 'Дешёвая преграда: 900 прочности — задержит рой и технику',
    adesc: 'Хитиновый барьер: живая стена улья' },
  bunker:   { key: 'bunker',   hname: 'Бункер',          aname: 'Кокон', w: 2, h: 2, hp: 1100, cost: 120, buildTime: 16, supplyGain: 0,  sightTiles: 8,
              garrisonCap: 4, range: 140,
    hdesc: 'Прячет до 4 пехотинцев: внутри они неуязвимы и стреляют сами. ПКМ — занять',
    adesc: 'Кокон: 4 бойца прячутся внутри и жалят через щели' },
  factory:  { key: 'factory',  hname: 'Завод техники',   aname: 'Яма выводка', w: 3, h: 3, hp: 1300, cost: 250, buildTime: 35, supplyGain: 0,  sightTiles: 7,
              produces: ['buggy', 'tank', 'arty'], requires: 'barracks',
    hdesc: 'Производит технику: скифы, бастионы и мортиры «Нова». Нужна казарма',
    adesc: 'Яма выводка: выползают скользни, громилы и спогромы. Нужен инкубатор' },
  lab:      { key: 'lab',      hname: 'Лаборатория',     aname: 'Узел эволюции', w: 3, h: 3, hp: 900,  cost: 200, buildTime: 32, supplyGain: 0,  sightTiles: 6,
              requires: 'barracks', research: true,
    hdesc: 'Исследует улучшения армии: оружие, броня пехоты, орудия и плиты техники',
    adesc: 'Узел эволюции: грани роя крепнут с каждым исследованием' },
};

// --- Улучшения (исследуются в Лаборатории / Узле эволюции) ---
// Бонусы применяются автоматически ко ВСЕМ своим юнитам (и новым тоже):
//   infAtk — +3 к урону пехоты за уровень; vehAtk — +5 к урону техники;
//   infArm — −2 к получаемому урону пехоты;  vehArm — −3 у техники.
export const UPGRADES = {
  infAtk: { key: 'infAtk', hname: 'Оружие пехоты', aname: 'Заточка шипов', max: 3,
    costs: [100, 175, 250], times: [40, 55, 70],
    hdesc: 'Калибровка стволов и огнесмесей: +3 урона пехоте за уровень',
    adesc: 'Шипы и кислота крепнут: +3 урона пехоте за уровень' },
  infArm: { key: 'infArm', hname: 'Броня пехоты', aname: 'Панцирь', max: 3,
    costs: [100, 175, 250], times: [40, 55, 70],
    hdesc: 'Композитные щитки: −2 к получаемому урону пехоты за уровень',
    adesc: 'Хитиновые пластины: −2 к получаемому урону пехоты за уровень' },
  vehAtk: { key: 'vehAtk', hname: 'Орудия техники', aname: 'Жвалы выводка', max: 3,
    costs: [100, 175, 250], times: [45, 60, 75],
    hdesc: 'Длиннее ствол — дальше смерть: +5 урона технике за уровень',
    adesc: 'Крупнейшие жвала улья: +5 урона тяжёлым существам за уровень' },
  vehArm: { key: 'vehArm', hname: 'Плиты техники', aname: 'Хитиновый панцирь', max: 3,
    costs: [100, 175, 250], times: [45, 60, 75],
    hdesc: 'Навесная броня: −3 к получаемому урону техники за уровень',
    adesc: 'Многослойный панцирь: −3 к получаемому урону за уровень' },
};

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

// --- Палитра сторон (язык цвета «Рубежа 64»: бирюза против огня) ---
// player — бирюзовый («свечение своих»), enemy — раскалённо-оранжевый.
export const COLORS = {
  player: '#76e3d7', playerDark: '#245e68', playerBright: '#c5fff1',
  enemy:  '#ff806e', enemyDark:  '#713943', enemyBright: '#ffd0b5',
  mineral: '#7ed9e7',
  hpLow: '#ff806e',
  amber: '#f3c579',
};

// --- Подписи по фракции: у людей и кхарид разные имена/описания ---
export function fname(cfg, faction) {
  return faction === 'alien' ? (cfg.aname || cfg.hname) : cfg.hname;
}
export function fdesc(cfg, faction) {
  return faction === 'alien' ? (cfg.adesc || cfg.hdesc) : cfg.hdesc;
}

// --- Биомы планет (палитры генератора карт): тёмные, чтобы светящиеся
// юниты/кристаллы «горели» на фоне — язык визуала «Рубежа 64» ---
export const BIOMES = {
  mars: { // Актан-4: тёмные ржавые пустоши, базальтовые гряды
    ground: '#3d281e', tones: ['#33201a', '#4a2f24', '#513527', '#37231b'],
    speck1: 'rgba(18,8,4,0.32)', speck2: 'rgba(226,150,96,0.14)',
    water: '#12414a', waterGlint: 'rgba(126,217,231,0.3)', shore: 'rgba(122,72,42,0.55)',
    rock: ['#38302e', '#4a3d3a', '#5e4c48'], dust: 'rgba(196,116,66,0.16)',
  },
  nest: { // Брок-Тхаал: фиолетовые пустоши улья, светящиеся кислотные озёра
    ground: '#2a2140', tones: ['#221b34', '#332a4d', '#392e55', '#262039'],
    speck1: 'rgba(10,6,20,0.34)', speck2: 'rgba(150,120,220,0.15)',
    water: '#0f4436', waterGlint: 'rgba(126,255,190,0.32)', shore: 'rgba(72,52,110,0.55)',
    rock: ['#332e44', '#443d59', '#574e70'], dust: 'rgba(140,100,220,0.16)',
  },
  moon: { // Селенит-Б: графитовые лунные равнины, реголит, кратеры
    ground: '#2b2e35', tones: ['#23262c', '#34383f', '#3a3e46', '#282b31'],
    speck1: 'rgba(8,9,12,0.32)', speck2: 'rgba(170,190,210,0.13)',
    water: '#123246', waterGlint: 'rgba(140,200,240,0.28)', shore: 'rgba(80,86,98,0.5)',
    rock: ['#2c2f36', '#3b3f47', '#4c515a'], dust: 'rgba(150,170,190,0.14)',
  },
};
