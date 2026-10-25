// ============================================================
// missions.js — кампания «Звёздный рубеж»: механика 15 миссий /
// 3 акта + бонусные «Главы Хроники» (№16–19, открываются после
// финала). Прогресс хранится в localStorage.
// Весь сюжетный текст (акты, имена, брифы, интро, эпилоги, цели)
// живёт в locales/*.js — раздел missions, ключ = mission.id
// (I18N.md §5.2); здесь только игровые данные и стабильные ID.
// ============================================================

import { t, has } from './i18n.js?v=10252058';

const PROGRESS_KEY = 'terranrts.progress';

// Загружаем максимум открытой миссии (0 = открыта только первая).
// Верхняя граница — от длины кампании, а не magic number: при расширении
// мира на новые миссии кламп подхватит их сам.
export function loadProgress() {
  try {
    const v = parseInt(localStorage.getItem(PROGRESS_KEY) || '0', 10);
    return Number.isFinite(v) ? Math.max(0, Math.min(MISSIONS.length - 1, v)) : 0;
  } catch (e) { return 0; }
}

export function saveProgress(missionIndex) {
  try {
    if (missionIndex > loadProgress()) localStorage.setItem(PROGRESS_KEY, String(missionIndex));
  } catch (e) { /* приватный режим — прогресс не сохраняем */ }
}

// П8: сброс прогресса (кнопка в меню) — кодекс закрывается сам:
// записи читают только loadProgress().
export function resetProgress() {
  try { localStorage.removeItem(PROGRESS_KEY); } catch (e) { /* нечего сбрасывать */ }
}

// П8 (С1): честные «Новинки». Юнит/здание открывается миссией, чья
// intro его анонсирует (сверено с GAME_GUIDE; гайд местами stale —
// турели №0 и завод №1 из разборов отменены интро №1/№2 и киккоффом).
// -1 = открыто всегда. Семантика меню: доступно в миссии с индексом
// M, если M >= UNLOCK_AT (при переигровке ранних — по-прежнему честно);
// в скирмише открыто всё. medic: 8 — №8 анонсирует нанитов в отряде,
// а «Новинка у кхарид» №10 честна пофракционно (у роя — впервые).
export const UNLOCK_AT = {
  worker: -1, depot: -1, cc: -1,
  marine: 0, barracks: 0,
  turret: 1, wall: 1, bunker: 1,
  factory: 2, buggy: 2, tank: 2, scout: 2, // H.3: разведчик приходит с заводом
  flamer: 6, arty: 7, medic: 8, lab: 11,
};

// Индекс миссии в MISSIONS (-1 = скирмиш/чужая). Разблокировка идёт
// по порядку массива, а не по id: бонусные главы продолжают шкалу.
export function missionIndex(m) {
  return m ? MISSIONS.findIndex((x) => x.id === m.id) : -1;
}

// Фильтр меню стройки/производства: глобальный UNLOCK_AT + per-mission
// запрет (banBuild №18). Уже построенное/очереди не трогает — только меню.
export function isUnlocked(mission, type) {
  if (mission && Array.isArray(mission.banBuild) && mission.banBuild.includes(type)) return false;
  const idx = missionIndex(mission);
  if (idx < 0) return true; // скирмиш / рейд — всё остальное открыто
  return (UNLOCK_AT[type] === undefined ? -1 : UNLOCK_AT[type]) <= idx;
}

// ------------------------------------------------------------
// Ключ миссии в локали: id ≥ 0 → 'missions.<id>'; скирмиш (id -1,
// флаг skirmish) → 'missions.skirmish'. Бонусные главы имеют разрыв
// id (15 пропущен), поэтому ключ строится ТОЛЬКО из id, не из позиции.
// ------------------------------------------------------------
function mKey(m) {
  return 'missions.' + (m && m.skirmish ? 'skirmish' : String(m ? m.id : -1));
}

// Текстовое поле миссии из локали; отсутствующее поле → '' (пусто),
// а не маркер missing: у бонусных глав нет части полей.
export function missionText(m, field) {
  const k = mKey(m) + '.' + field;
  return has(k) ? t(k) : '';
}

// Подпись цели для меню/брифингов/тостов. Легаси-миссии хранят цель
// строкой в локали (missions.<id>.objective); новые типы (M0) — объектом
// { kind, ... } с текстом в missions.<id>.objText и именем ключевой
// цели в missions.<id>.objName. Динамический прогресс (собрано/нужно,
// таймеры) дорисовывает objectiveText() в game.js.
// Второй аргумент — фазовая цель (эвакуация после штурма №1/№13/№18).
export function objectiveLabel(m, o) {
  o = o || (m && m.objective);
  if (!o) return t('ui.objectiveLabel.fallback');
  if (typeof o === 'string') return missionText(m, 'objective');
  if (o.text) return missionText(m, 'objText');
  if (o.kind === 'key') {
    const name = missionText(m, 'objName') || t('ui.objectiveLabel.keyFallback');
    return t('ui.objectiveLabel.key', { name });
  }
  if (o.kind === 'stockpile') return t('ui.objectiveLabel.stockpile', { n: o.amount });
  if (o.kind === 'evac') return t('ui.objectiveLabel.evac', { n: o.need });
  return t('ui.objectiveLabel.fallback');
}

// Ключ миссии в локали (для полей вне этого модуля: дедлайн HUD,
// toast фазы и т.п.): id ≥ 0 → 'missions.<id>', скирмиш → 'missions.skirmish'.
export function missionKey(m) {
  return mKey(m);
}

// ------------------------------------------------------------
// Профиль ИИ: ключи совпадают с config.js/AI (включая medics,
// flamers, arty, research).
// defense — параметры миссии-обороны:
//   prep — сек подготовки до первой волны; every — пауза между волнами;
//   start/grow/max — размер волны; total — сколько секунд обороняться;
//   nests — сколько дополнительных гнёзд у противника.
// map — параметры генератора: seed, biome, lakes, rocks, rich, base,
//   w/h — размер в тайлах (48–96, дефолт 64; пакет C).
// startTech в профиле ИИ — стартовые уровни улучшений врага (С3, финал).
// noBase + squad — стелс-миссия: базы нет, стартуем готовым отрядом.
// enemyFaction — фракция врага (по умолчанию противоположная игроку;
// зеркальные бои №17–№19 задают явно). enemyExtra — достроенные здания
// врага у его базы [{ type, dx, dy }] (склады №17). banBuild — типы,
// скрытые из меню стройки этой миссии (казарма/завод/лаба №18).
// loseDeadline — { at, hard }: событие по таймеру (текст метки —
// в локали missions.<id>.deadlineLabel, HUD подставляет по ключу).
// bonus — «Главы Хроники»: видны после победы в №14.
// ------------------------------------------------------------
export const MISSIONS = [
  // ==================== АКТ I «РУБЕЖ» ====================
  {
    id: 0,
    faction: 'human',
    objective: 'legacy', // легаси: строка цели — в локали (missions.0.objective)
    map: { seed: 20260101, biome: 'mars', lakes: 'default', rocks: 6, rich: 1.0, base: { x: 8, y: 48 } },
    ai: {
      workerTarget: 9, maxMarines: 12, firstWave: 3, waveGrowth: 1, waveMax: 8,
      minWaveInterval: 55, secondBarracksAt: 210, maxTurrets: 0,
      factory: false, maxBuggies: 0, maxTanks: 0, repair: false,
    },
    defense: null,
  },
  {
    id: 1,
    faction: 'human',
    objective: {
      kind: 'evac', x: 16, y: 8, r: 3, need: 6, hold: 3,
      text: true, // текст цели — в локали (missions.1.objText)
    },
    map: {
      seed: 20260102, biome: 'mars', rocks: 13, rich: 1.15, base: { x: 8, y: 9 },
      lakes: [[28, 16, 4.2, 3.0], [35, 47, 4.2, 3.0], [12, 38, 2.2, 1.6], [51, 25, 2.2, 1.6]],
      neutral: [[14, 50], [49, 13], [46, 44], [17, 19]],
    },
    ai: {
      workerTarget: 0, maxMarines: 60, firstWave: 0, waveGrowth: 0, waveMax: 0,
      minWaveInterval: 0, secondBarracksAt: 0, maxTurrets: 0,
      factory: false, maxBuggies: 0, maxTanks: 0, repair: false, arty: 2,
    },
    defense: { prep: 180, every: 65, start: 4, grow: 1, max: 16, total: 600, nests: 2 },
  },
  {
    id: 2,
    faction: 'alien',
    objective: { kind: 'key', type: 'cc' },
    loseDeadline: { at: 420, hard: false },
    map: {
      seed: 20260103, biome: 'nest', w: 76, h: 76, rocks: 10, rich: 1.3, base: { x: 60, y: 48 },
      lakes: [[30, 20, 4.5, 3.2], [46, 58, 3, 2.2]],
      neutral: [[24, 30], [52, 48]],
    },
    ai: {
      workerTarget: 14, maxMarines: 30, firstWave: 5, waveGrowth: 2, waveMax: 18,
      minWaveInterval: 38, secondBarracksAt: 100, maxTurrets: 4,
      factory: true, maxBuggies: 8, maxTanks: 0, repair: true,
    },
    defense: null,
  },
  {
    id: 3,
    faction: 'human',
    objective: { kind: 'stockpile', amount: 2500 },
    map: {
      seed: 20260104, biome: 'mars', w: 88, h: 88, rocks: 6, rich: 1.1, base: { x: 40, y: 76 },
      lakes: [[24, 24, 3, 2], [64, 24, 3, 2]],
      neutral: [[20, 60], [44, 44], [68, 60]],
    },
    ai: {
      workerTarget: 14, maxMarines: 30, firstWave: 5, waveGrowth: 2, waveMax: 18,
      minWaveInterval: 38, secondBarracksAt: 100, maxTurrets: 4,
      factory: true, maxBuggies: 4, maxTanks: 6, flamers: 4, repair: true,
    },
    defense: null,
  },
  {
    id: 4,
    faction: 'human',
    objective: { kind: 'evac', x: 10, y: 8, r: 4, need: 8, hold: 3 },
    map: {
      seed: 20260105, biome: 'mars', w: 56, h: 56, rocks: 9, rich: 1.2, base: { x: 8, y: 40 },
      lakes: [[20, 5, 3.5, 2.2], [28, 28, 3, 2.5]],
      neutral: [[16, 30]],
    },
    ai: {
      workerTarget: 10, maxMarines: 26, firstWave: 5, waveGrowth: 2, waveMax: 16,
      minWaveInterval: 45, secondBarracksAt: 120, maxTurrets: 3,
      factory: false, maxBuggies: 0, maxTanks: 0, flamers: 2, repair: false,
    },
    defense: null,
  },

  // ==================== АКТ II «ОГОНЬ И СТАЛЬ» ====================
  {
    id: 5,
    faction: 'alien',
    objective: 'legacy', // легаси: строка цели — в локали,
    map: {
      seed: 20260106, biome: 'nest', rocks: 11, rich: 1.2, base: { x: 8, y: 9 },
      lakes: 'default',
      neutral: [[14, 50], [49, 13], [46, 44], [17, 19]],
    },
    ai: {
      workerTarget: 0, maxMarines: 70, firstWave: 0, waveGrowth: 0, waveMax: 0,
      minWaveInterval: 0, secondBarracksAt: 0, maxTurrets: 0,
      factory: false, maxBuggies: 0, maxTanks: 0, repair: false, arty: 2,
    },
    defense: { prep: 200, every: 60, start: 4, grow: 1, max: 16, total: 660, nests: 1 },
    buildZone: [{ x: 3, y: 4, w: 16, h: 16 }], // священные поля вокруг гнезда
  },
  {
    id: 6,
    faction: 'human',
    objective: { kind: 'stockpile', amount: 2000 },
    enemyFaction: 'human', // J: мятежники — люди, не рой
    map: {
      seed: 20260107, biome: 'mars', w: 84, h: 84, rocks: 12, rich: 1.15, base: { x: 40, y: 8 },
      lakes: [[26, 30, 4, 3], [58, 30, 4, 3]],
      neutral: [[20, 50], [42, 42], [64, 50]],
    },
    ai: {
      workerTarget: 12, maxMarines: 14, firstWave: 4, waveGrowth: 2, waveMax: 14,
      minWaveInterval: 45, secondBarracksAt: 120, maxTurrets: 3,
      factory: true, maxBuggies: 6, maxTanks: 0, medics: 2, flamers: 5, arty: 0,
      research: false, repair: true,
    },
    defense: null,
  },
  {
    id: 7,
    faction: 'human',
    objective: { kind: 'key', type: 'cc' },
    loseDeadline: { at: 480, hard: false },
    enemyFaction: 'human', // J: форт «Гвоздь» держат отступники-люди
    map: {
      seed: 20260108, biome: 'mars', w: 72, h: 72, rocks: 11, rich: 1.25, base: { x: 56, y: 56 },
      lakes: [[30, 44, 4, 3], [44, 30, 4, 3]],
      neutral: [[24, 52], [52, 24]],
    },
    ai: {
      workerTarget: 13, maxMarines: 24, firstWave: 4, waveGrowth: 2, waveMax: 15,
      minWaveInterval: 45, secondBarracksAt: 110, maxTurrets: 6,
      factory: true, maxBuggies: 3, maxTanks: 4, medics: 3, flamers: 6, arty: 2,
      research: false, repair: true,
    },
    defense: null,
  },
  {
    id: 8,
    faction: 'human',
    objective: 'legacy', // легаси: строка цели — в локали,
    map: {
      seed: 20260109, biome: 'nest', w: 52, h: 52, rocks: 9, rich: 1.0, base: { x: 8, y: 8 },
      lakes: [[30, 14, 3, 2]],
      neutral: [[36, 30]],
    },
    noBase: true,
    squad: [['marine', 4], ['flamer', 2], ['medic', 2]],
    ai: {
      workerTarget: 9, maxMarines: 14, firstWave: 3, waveGrowth: 1, waveMax: 6,
      minWaveInterval: 50, secondBarracksAt: 240, maxTurrets: 4,
      factory: false, maxBuggies: 0, maxTanks: 0, repair: false,
    },
    defense: null,
  },
  {
    id: 9,
    faction: 'human',
    objective: 'legacy', // легаси: строка цели — в локали,
    map: {
      seed: 20260110, biome: 'moon', rocks: 10, rich: 1.2, base: { x: 8, y: 9 },
      lakes: 'default',
      neutral: [[14, 50], [49, 13], [46, 44], [17, 19]],
    },
    ai: {
      workerTarget: 0, maxMarines: 80, firstWave: 0, waveGrowth: 0, waveMax: 0,
      minWaveInterval: 0, secondBarracksAt: 0, maxTurrets: 0,
      factory: false, maxBuggies: 0, maxTanks: 0, medics: 4, flamers: 6, arty: 2,
      research: false, repair: false,
    },
    defense: { prep: 240, every: 50, start: 6, grow: 2, max: 22, total: 840, nests: 3 },
  },

  // ==================== АКТ III «ДОМИНИОН» ====================
  {
    id: 10,
    faction: 'alien',
    objective: { kind: 'key', type: 'cc' },
    map: { seed: 20260111, biome: 'nest', lakes: 'default', rocks: 9, rich: 1.25, base: { x: 8, y: 48 } },
    ai: {
      workerTarget: 14, maxMarines: 30, firstWave: 5, waveGrowth: 2, waveMax: 18,
      minWaveInterval: 40, secondBarracksAt: 100, maxTurrets: 4,
      factory: true, maxBuggies: 4, maxTanks: 5, medics: 4, flamers: 6, arty: 3,
      research: true, repair: true,
    },
    defense: null,
  },
  {
    id: 11,
    faction: 'human',
    objective: { kind: 'key', type: 'cc' },
    loseDeadline: { at: 450, hard: false },
    enemyFaction: 'human', // J: «Кремень» — столица Сынов Песка (люди)
    map: {
      seed: 20260112, biome: 'mars', w: 76, h: 76, rocks: 12, rich: 1.3, base: { x: 56, y: 10 },
      lakes: [[28, 30, 4, 3], [48, 46, 3.5, 2.5]],
      neutral: [[24, 52], [52, 24]],
    },
    ai: {
      workerTarget: 15, maxMarines: 32, firstWave: 5, waveGrowth: 2, waveMax: 20,
      minWaveInterval: 38, secondBarracksAt: 100, maxTurrets: 5,
      factory: true, maxBuggies: 4, maxTanks: 5, medics: 5, flamers: 8, arty: 3,
      research: true, repair: true,
    },
    defense: null,
  },
  {
    id: 12,
    faction: 'human',
    objective: 'legacy', // легаси: строка цели — в локали,
    map: {
      seed: 20260113, biome: 'mars', rocks: 12, rich: 1.3, base: { x: 8, y: 9 },
      lakes: 'default',
      neutral: [[14, 50], [49, 13], [46, 44], [17, 19]],
    },
    ai: {
      workerTarget: 0, maxMarines: 90, firstWave: 0, waveGrowth: 0, waveMax: 0,
      minWaveInterval: 0, secondBarracksAt: 0, maxTurrets: 0,
      factory: false, maxBuggies: 0, maxTanks: 0, medics: 5, flamers: 8, arty: 3,
      research: false, repair: false,
    },
    defense: { prep: 300, every: 45, start: 6, grow: 2, max: 26, total: 900, nests: 4 },
  },
  {
    id: 13,
    faction: 'alien',
    objective: {
      kind: 'key', type: 'cc',
      text: true, // текст цели — в локали (missions.13.objText)
      then: { kind: 'evac', x: 20, y: 40, r: 4, need: 4, hold: 3 },
    },
    map: {
      seed: 20260114, biome: 'moon', w: 52, h: 52, rocks: 7, rich: 1.3, base: { x: 20, y: 40 },
      lakes: [[26, 26, 3, 10]],
      neutral: [[14, 14]],
    },
    noBase: true,
    squad: [['marine', 6], ['medic', 2]],
    ai: {
      workerTarget: 15, maxMarines: 32, firstWave: 5, waveGrowth: 2, waveMax: 20,
      minWaveInterval: 38, secondBarracksAt: 100, maxTurrets: 6,
      factory: true, maxBuggies: 4, maxTanks: 6, medics: 5, flamers: 8, arty: 4,
      research: true, repair: true,
    },
    defense: null,
  },
  {
    id: 14,
    faction: 'human',
    objective: { kind: 'key', type: 'cc' },
    map: {
      seed: 20260115, biome: 'nest', w: 80, h: 80, rocks: 14, rich: 1.35, base: { x: 10, y: 64 },
      lakes: [[34, 30, 4.5, 3.2], [52, 50, 3.5, 2.5]],
      neutral: [[22, 30], [40, 24], [40, 56], [58, 50]],
    },
    ai: {
      workerTarget: 16, maxMarines: 36, firstWave: 5, waveGrowth: 2, waveMax: 24,
      minWaveInterval: 35, secondBarracksAt: 90, maxTurrets: 8,
      factory: true, maxBuggies: 5, maxTanks: 6, medics: 6, flamers: 9, arty: 4,
      research: true, repair: true, startTech: 1,
    },
    defense: null,
  },
  // ==================== ГЛАВЫ ХРОНИКИ (бонус после №14) ====================
  {
    id: 16,
    faction: 'human',
    bonus: true,
    objective: { kind: 'stockpile', amount: 2500 },
    map: {
      seed: 20260117, biome: 'mars', w: 84, h: 84, rocks: 12, rich: 1.1, base: { x: 40, y: 72 },
      lakes: [[24, 30, 4, 3], [60, 30, 4, 3]],
      neutral: [[20, 52], [64, 52], [42, 42]],
    },
    ai: {
      workerTarget: 12, maxMarines: 24, firstWave: 2, waveGrowth: 1, waveMax: 12,
      minWaveInterval: 40, secondBarracksAt: 150, maxTurrets: 2,
      factory: true, maxBuggies: 4, maxTanks: 0, medics: 0, flamers: 4, arty: 0,
      research: false, repair: false,
    },
    defense: null,
  },
  {
    id: 17,
    faction: 'alien',
    bonus: true,
    objective: {
      kind: 'key', type: 'depot',
      guardType: 'medic', guardLose: true, // текст поражения — в локали (guardLose)
    },
    noBase: true,
    squad: [['marine', 6], ['medic', 2]],
    enemyFaction: 'alien', // рой против роя — зеркальные юниты
    enemyExtra: [
      { type: 'depot', dx: -3, dy: 0 }, { type: 'depot', dx: 4, dy: 0 }, { type: 'depot', dx: 0, dy: 6 },
    ],
    map: {
      seed: 20260118, biome: 'nest', w: 52, h: 52, rocks: 9, rich: 1.0, base: { x: 36, y: 36 },
      lakes: [[16, 34, 3, 2]],
      neutral: [[26, 26]],
    },
    ai: {
      workerTarget: 6, maxMarines: 12, firstWave: 3, waveGrowth: 1, waveMax: 8,
      minWaveInterval: 55, secondBarracksAt: 240, maxTurrets: 3,
      factory: false, maxBuggies: 0, maxTanks: 0, medics: 2, flamers: 2, arty: 0,
      research: false, repair: false, depots: false, // складов ровно 3 — ИИ не достраивает
    },
    defense: null,
  },
  {
    id: 18,
    faction: 'human',
    bonus: true,
    objective: {
      kind: 'evac', x: 34, y: 14, r: 3, need: 8, hold: 3,
      text: true, // текст цели — в локали (missions.18.objText)
    },
    enemyFaction: 'human', // свои против своих — мятежники
    banBuild: ['barracks', 'factory', 'lab'], // подкреплений нет; лаба требует казарму — без запрета тупиковая кнопка в меню (K)
    buildZone: [{ x: 24, y: 2, w: 24, h: 18 }], // только плато «Вала»
    map: {
      seed: 20260119, biome: 'moon', w: 72, h: 72, rocks: 10, rich: 1.15, base: { x: 32, y: 8 },
      lakes: [[20, 40, 4, 3], [52, 40, 4, 3]],
      neutral: [[16, 56], [56, 56]],
    },
    ai: {
      workerTarget: 0, maxMarines: 60, firstWave: 0, waveGrowth: 0, waveMax: 0,
      minWaveInterval: 0, secondBarracksAt: 0, maxTurrets: 0,
      factory: false, maxBuggies: 0, maxTanks: 0, repair: false, flamers: 2, arty: 1,
    },
    defense: { prep: 150, every: 60, start: 4, grow: 1, max: 14, total: 480, nests: 2 },
  },
  {
    id: 19,
    faction: 'alien',
    bonus: true,
    objective: { kind: 'key', type: 'cc' },
    loseDeadline: { at: 600, hard: true }, // первый жёсткий дедлайн
    enemyFaction: 'human', // верный выводок добивает мятежников
    map: {
      seed: 20260120, biome: 'mars', w: 76, h: 76, rocks: 10, rich: 1.2, base: { x: 60, y: 40 },
      lakes: [[30, 24, 3.5, 2.5], [30, 52, 3.5, 2.5]],
      neutral: [[38, 38]],
    },
    ai: {
      workerTarget: 8, maxMarines: 12, firstWave: 3, waveGrowth: 1, waveMax: 8,
      minWaveInterval: 60, secondBarracksAt: 300, maxTurrets: 4,
      factory: false, maxBuggies: 0, maxTanks: 0, medics: 0, flamers: 0, arty: 0,
      research: false, repair: false,
    },
    defense: null,
  },
];

// Профиль быстрого боя — полноценный противник со всей техникой.
// Фракцию выбирает игрок на старте; враг всегда противоположная.
// Тексты (имя/место/бриф/цель) — в локали missions.skirmish.*.
export const SKIRMISH = {
  skirmish: true,
  objective: 'legacy', // легаси: строка цели — в локали (missions.skirmish.objective)
  map: null, // seed генерируется случайно при старте
  ai: {
    workerTarget: 12, maxMarines: 30, firstWave: 4, waveGrowth: 2, waveMax: 18,
    minWaveInterval: 40, secondBarracksAt: 150, maxTurrets: 3,
    factory: true, maxBuggies: 4, maxTanks: 5, medics: 3, flamers: 4, arty: 2,
    research: true, repair: true,
  },
  defense: null,
};
