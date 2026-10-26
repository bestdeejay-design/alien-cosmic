// ============================================================
// commander.js — КОМАНДИР БАЗЫ: капитан → майор → полковник → генерал (Э7).
//
// Владелец: «внутри КЦ должен появиться капитан → генерал, который управляет
// КЦ и базой, юнитами, нападением и отражением атак, когда на базу прилетят
// с рейдом».
//
// Здесь — только «мозг» и правила: звания, опыт, бонусы, сериализация.
// Приказы войскам и отражение входящих рейдов живут в home-raid.js, карточка
// командира — в commander-ui.js. Так модуль остаётся проверяемым в симах.
//
// ЗВАНЬЯ (20 уровней, как у всех в игре):
//   1–4    Капитан     — учится держать базу
//   5–9    Майор       — вторая волна обороны, ремонт
//   10–14  Полковник   — контратака, усиленный огонь турелей
//   15–20  Генерал     — база под полным управлением
//
// ОПЫТ: рейды (вылазки приносят опыт при возврате), отражённые атаки и
// уничтоженные враги на своей базе. Опыт НЕ покупается и не падает из
// капсул — только за игру (канон: призы не заменяют игру).
// ============================================================
import { t } from './i18n.js?v=10262518';

export const COMMANDER_SCHEMA = 1;
export const MAX_COMMANDER_LEVEL = 20;

export const RANK_STEPS = Object.freeze([
  { from: 1, to: 4, key: 'captain', pips: 1 },
  { from: 5, to: 9, key: 'major', pips: 2 },
  { from: 10, to: 14, key: 'colonel', pips: 3 },
  { from: 15, to: 20, key: 'general', pips: 4 },
]);

const clampLevel = (v) => Math.max(1, Math.min(MAX_COMMANDER_LEVEL, Math.floor(Number(v) || 1)));

export function rankOf(level) {
  const L = clampLevel(level);
  return RANK_STEPS.find((r) => L >= r.from && L <= r.to) || RANK_STEPS[0];
}

export function rankName(level) {
  return t('ui.commander.rank.' + rankOf(level).key);
}

// Опыт до следующего звания. Растёт линейно: суммарно ~9 600 XP на путь
// 1→20 (при 100–200 XP за вылет это десятки рейдов, а не вечер).
export function xpNeed(level) {
  const L = clampLevel(level);
  if (L >= MAX_COMMANDER_LEVEL) return 0;
  return 60 + 40 * L;
}

export function totalXpTo20() {
  let sum = 0;
  for (let L = 1; L < MAX_COMMANDER_LEVEL; L++) sum += xpNeed(L);
  return sum;
}

// Бонусы — процентные/штучные, чтобы не ломать экономику 20 уровней.
//   supply      — дополнительные места населения (+0…+9)
//   gradeSpeed  — ускорение грейда зданий (0…9.5 %)
//   defense     — множитель урона СВОИХ в обороне базы (1.00…1.19)
//   repair      — хил юнитов у КЦ во время обороны, hp/с
export function bonuses(level) {
  const L = clampLevel(level);
  return {
    supply: Math.floor((L - 1) / 2),
    gradeSpeed: +(0.005 * (L - 1)).toFixed(3),
    defense: +(1 + 0.01 * (L - 1)).toFixed(3),
    repair: +(0.4 * (L - 1)).toFixed(1),
  };
}

export function createCommander() {
  return {
    schema: COMMANDER_SCHEMA,
    level: 1,
    xp: 0,
    autoDefense: true,           // автозащита: командир сам поднимает войска
    stats: { raids: 0, defenses: 0, kills: 0, lost: 0 },
    log: [],                     // последние события (в карточке командира)
  };
}

export function ensureCommander(st) {
  if (!st) return createCommander();
  if (!st.commander || typeof st.commander !== 'object') st.commander = createCommander();
  const c = st.commander;
  c.schema = COMMANDER_SCHEMA;
  c.level = clampLevel(c.level);
  c.xp = Math.max(0, Math.floor(Number(c.xp) || 0));
  c.autoDefense = c.autoDefense !== false;
  c.stats = { raids: 0, defenses: 0, kills: 0, lost: 0, ...(c.stats || {}) };
  if (!Array.isArray(c.log)) c.log = [];
  return c;
}

export function commanderOf(st) {
  return ensureCommander(st);
}

// Начисление опыта. Возвращает {gained, level, prev, levelUp, rankKey, max}.
export function addXp(st, amount) {
  const c = ensureCommander(st);
  const prev = c.level;
  const gain = Math.max(0, Math.round(Number(amount) || 0));
  if (!gain || prev >= MAX_COMMANDER_LEVEL) return { gained: 0, level: c.level, prev, levelUp: false, rankKey: rankOf(c.level).key, max: prev >= MAX_COMMANDER_LEVEL };
  c.xp += gain;
  let need = xpNeed(c.level);
  while (need > 0 && c.xp >= need) {
    c.xp -= need;
    c.level = clampLevel(c.level + 1);
    need = xpNeed(c.level);
  }
  if (c.level >= MAX_COMMANDER_LEVEL) c.xp = 0;
  const levelUp = c.level > prev;
  if (levelUp && prev < MAX_COMMANDER_LEVEL) {
    const rankChanged = rankOf(c.level).key !== rankOf(prev).key;
    logEvent(st, rankChanged
      ? t('ui.commander.logRank', { rank: rankName(c.level) })
      : t('ui.commander.logLevel', { n: c.level }));
  }
  return { gained: gain, level: c.level, prev, levelUp, rankKey: rankOf(c.level).key, max: c.level >= MAX_COMMANDER_LEVEL };
}

// Событие в журнал командира (последние 10, свежие сверху).
export function logEvent(st, text, kind = 'info') {
  const c = ensureCommander(st);
  c.log.unshift({ t: Date.now(), text: String(text || ''), kind });
  if (c.log.length > 10) c.log.length = 10;
  return c.log[0];
}

// Сколько мест населения добавляет командир (0 — если базы нет/вылазка).
export function supplyBonus(st) {
  if (!st || !st.commander) return 0;
  if (st.raidMode === 'expedition' || st.noBase) return 0;
  const hasCc = (st.buildings || []).some((b) => b && !b.dead && b.done && b.side === 'player' && b.type === 'cc');
  if (!hasCc) return 0;
  return bonuses(st.commander.level).supply;
}

export function defenseMul(st) {
  if (!st || !st.commander) return 1;
  return bonuses(st.commander.level).defense;
}

export function serializeCommander(c) {
  if (!c) return null;
  return {
    schema: COMMANDER_SCHEMA,
    level: clampLevel(c.level),
    xp: Math.max(0, Math.floor(Number(c.xp) || 0)),
    autoDefense: c.autoDefense !== false,
    stats: { raids: 0, defenses: 0, kills: 0, lost: 0, ...(c.stats || {}) },
    log: Array.isArray(c.log) ? c.log.slice(0, 6).map((e) => ({ t: Number(e.t) || 0, text: String(e.text || ''), kind: e.kind || 'info' })) : [],
  };
}

export function hydrateCommander(st, raw) {
  if (!st) return null;
  if (!raw || typeof raw !== 'object') { st.commander = createCommander(); return st.commander; }
  const c = createCommander();
  c.level = clampLevel(raw.level);
  c.xp = Math.max(0, Math.floor(Number(raw.xp) || 0));
  c.autoDefense = raw.autoDefense !== false;
  c.stats = { ...c.stats, ...(raw.stats || {}) };
  if (Array.isArray(raw.log)) c.log = raw.log.slice(0, 6);
  st.commander = c;
  return c;
}

// Короткая подпись для карточки: «МАЙОР · ур. 7».
export function commanderTitle(level) {
  const L = clampLevel(level);
  return `${rankName(L).toUpperCase()} · ${t('ui.commander.levelShort', { n: L })}`;
}
