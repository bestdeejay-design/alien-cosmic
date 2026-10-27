// ============================================================
// chests.js — «КАПСУЛЫ СНАБЖЕНИЯ» (пакет Э6): награды-сундуки, условия выдачи
// и входные карточки. Полигон r/.
//
// ТЕРМИНОЛОГИЯ (под вселенную игры, не «сундук из фэнтези»):
//   КАПСУЛА — контейнер с наградой, который падает на базу и вскрывается.
//   Капсулы бывают по условию: «вечерний сброс» (окно входа), «капсула
//   именинника», «капсула рейдера» (N вылетов), «капсула лидера» (топ-N),
//   «подарок администрации» (ручная выдача), «ежедневная капсула».
// Модель данных и правила — в design/ADMIN_AND_CHESTS.md.
//
// ЧТО УМЕЕТ:
//   • шаблоны капсул с условиями (окно времени, ДР, число рейдов, добыча,
//     топ игроков, уровень КЦ) и списком наград с весами;
//   • проверка условий на живом состоянии игры (+ серверный топ);
//   • выдача наград: эрг, юниты, грейд здания, ранги, бустер добычи;
//   • входной оверлей с карточками (открытие, анимация, звук);
//   • ежедневная капсула (рандом из пула, раз в сутки);
//   • состояние «уже забрал» (per chest: день/раз в жизни);
//   • конфиг хранится локально и (если есть профиль) на сервере.
// ============================================================

export const CHEST_SCHEMA = 1;
const CFG_KEY = 'ac_chest_cfg_v1';
const STATE_KEY = 'ac_chest_state_v1';
const BIRTHDAY_KEY = 'ac_birthday_v1';
const SRV_CFG_KEY = 'ac_chest_cfg';
const SRV_GRANT_KEY = 'ac_grant';

const readJSON = (k, fallback) => {
  try {
    const raw = localStorage.getItem(k);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
};
const writeJSON = (k, v) => {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* приватный режим */ }
};

// ------------------------------------------------------------
// Рарности: цвет + «сила» (для сортировки карточек и анимации).
// ------------------------------------------------------------
export const RARITY = Object.freeze({
  common: { name: 'Обычная', color: '#9fe8de', glow: 0 },
  rare: { name: 'Редкая', color: '#7db8ff', glow: 6 },
  epic: { name: 'Эпическая', color: '#c9a7ff', glow: 10 },
  legend: { name: 'Легендарная', color: '#f3c579', glow: 14 },
});

// Условия: type + params. Проверяются на живом состоянии.
export const CONDITIONS = Object.freeze({
  always: { name: 'Всем игрокам', params: [] },
  window: { name: 'Окно входа', params: ['from', 'to'] },          // «кто зашёл 20:00–20:30»
  birthday: { name: 'Именинник', params: [] },                     // ДР сегодня (дата в профиле)
  raids: { name: 'N вылетов', params: ['n'] },                     // «сделал 20 рейдов»
  loot: { name: 'Добыто эрга', params: ['n'] },
  top: { name: 'Топ игроков', params: ['n', 'metric'] },           // по рейдам/добыче
  cc: { name: 'Уровень КЦ', params: ['n'] },
  daily: { name: 'Ежедневная', params: [] },                       // раз в сутки, всем
});

export const REWARD_KINDS = Object.freeze({
  erg: { name: 'Эрг', params: ['amount'] },
  unit: { name: 'Юнит', params: ['unit', 'count'] },
  grade: { name: 'Грейд здания', params: ['building', 'levels'] },
  tech: { name: 'Ранг юнитов', params: ['key', 'levels'] },
  boost: { name: 'Бустер добычи', params: ['mul', 'minutes'] },
  cosmetic: { name: 'Облик', params: ['id'] },
});

// ------------------------------------------------------------
// Конфиг по умолчанию: набор капсул «на старт» (владелец может менять в админке).
// ------------------------------------------------------------
export function defaultConfig() {
  return {
    schemaVersion: CHEST_SCHEMA,
    updatedAt: Date.now(),
    enabled: true,
    showOnEntry: true,
    chests: [
      {
        id: 'evening-drop',
        name: 'Вечерний сброс',
        desc: 'Капсула с орбиты для тех, кто зашёл с 20:00 до 20:30.',
        icon: 'capsule',
        rarity: 'rare',
        condition: { type: 'window', params: { from: '20:00', to: '20:30' } },
        period: 'day',
        rewards: [
          { kind: 'erg', params: { amount: 1200 }, weight: 60 },
          { kind: 'unit', params: { unit: 'marine', count: 3 }, weight: 25 },
          { kind: 'boost', params: { mul: 1.5, minutes: 20 }, weight: 15 },
        ],
      },
      {
        id: 'birthday',
        name: 'Капсула именинника',
        desc: 'Личный груз: укажите дату рождения в профиле и заберите в свой день.',
        icon: 'cake',
        rarity: 'legend',
        condition: { type: 'birthday', params: {} },
        period: 'once',
        rewards: [
          { kind: 'grade', params: { building: 'depot', levels: 1 }, weight: 40 },
          { kind: 'erg', params: { amount: 15000 }, weight: 40 },
          { kind: 'unit', params: { unit: 'tank', count: 2 }, weight: 20 },
        ],
      },
      {
        id: 'raider-20',
        name: 'Капсула рейдера',
        desc: 'За 20 вылетов: снаряжение и эрг на новый грейд Дома.',
        icon: 'raider',
        rarity: 'epic',
        condition: { type: 'raids', params: { n: 20 } },
        period: 'once',
        rewards: [
          { kind: 'erg', params: { amount: 8000 }, weight: 55 },
          { kind: 'grade', params: { building: 'depot', levels: 1 }, weight: 25 },
          { kind: 'tech', params: { key: 'infAtk', levels: 1 }, weight: 20 },
        ],
      },
      {
        id: 'leader-100',
        name: 'Капсула лидера',
        desc: 'Топ-100 по числу вылетов — для тех, кто держит темп.',
        icon: 'crown',
        rarity: 'epic',
        condition: { type: 'top', params: { n: 100, metric: 'raids' } },
        period: 'day',
        rewards: [
          { kind: 'erg', params: { amount: 25000 }, weight: 50 },
          { kind: 'grade', params: { building: 'turret', levels: 2 }, weight: 30 },
          { kind: 'unit', params: { unit: 'arty', count: 2 }, weight: 20 },
        ],
      },
      {
        id: 'daily',
        name: 'Ежедневная капсула',
        desc: 'Раз в сутки, всегда что-то есть.',
        icon: 'daily',
        rarity: 'common',
        condition: { type: 'daily', params: {} },
        period: 'day',
        rewards: [
          { kind: 'erg', params: { amount: 400 }, weight: 70 },
          { kind: 'erg', params: { amount: 1200 }, weight: 20 },
          { kind: 'unit', params: { unit: 'worker', count: 1 }, weight: 10 },
        ],
      },
    ],
    dailyGift: { enabled: true, rewards: [{ kind: 'erg', params: { amount: 300 }, weight: 1 }] },
  };
}

export function loadConfig() {
  const cfg = readJSON(CFG_KEY, null);
  if (!cfg || cfg.schemaVersion !== CHEST_SCHEMA || !Array.isArray(cfg.chests)) return defaultConfig();
  return cfg;
}
export function saveConfig(cfg) {
  cfg.schemaVersion = CHEST_SCHEMA;
  cfg.updatedAt = Date.now();
  writeJSON(CFG_KEY, cfg);
  return cfg;
}
export function resetConfig() {
  const cfg = defaultConfig();
  writeJSON(CFG_KEY, cfg);
  return cfg;
}

// ------------------------------------------------------------
// Состояние «уже забрал».
// ------------------------------------------------------------
const dayKey = (d = new Date()) => d.toISOString().slice(0, 10);

export function loadState() {
  return readJSON(STATE_KEY, { claimed: {}, seen: {} });
}
function saveState(state) { writeJSON(STATE_KEY, state); }

export function isClaimed(chestId, period, state = loadState()) {
  const rec = state.claimed[chestId];
  if (!rec) return false;
  if (period === 'once') return true;
  return rec.day === dayKey();
}

// ------------------------------------------------------------
// Условия.
// ------------------------------------------------------------
export function getBirthday() { return readJSON(BIRTHDAY_KEY, null); }
export function setBirthday(month, day) {
  const v = { month: Math.max(1, Math.min(12, month | 0)), day: Math.max(1, Math.min(31, day | 0)) };
  writeJSON(BIRTHDAY_KEY, v);
  return v;
}

function minutesOf(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
  if (!m) return null;
  return (Number(m[1]) % 24) * 60 + (Number(m[2]) % 60);
}

// ctx: { now, raids, loot, ccLevel, topRank, statsAvailable }
export function checkCondition(cond, ctx) {
  const type = cond && cond.type;
  const p = (cond && cond.params) || {};
  switch (type) {
    case 'always': return { ok: true };
    case 'window': {
      const from = minutesOf(p.from), to = minutesOf(p.to);
      if (from === null || to === null) return { ok: false, why: 'окно не задано' };
      const now = ctx.now.getHours() * 60 + ctx.now.getMinutes();
      const ok = from <= to ? (now >= from && now <= to) : (now >= from || now <= to);
      return { ok, why: ok ? '' : `окно ${p.from}–${p.to}` };
    }
    case 'birthday': {
      const bd = getBirthday();
      if (!bd) return { ok: false, why: 'дата рождения не указана' };
      const ok = bd.month === ctx.now.getMonth() + 1 && bd.day === ctx.now.getDate();
      return { ok, why: ok ? '' : 'не сегодня' };
    }
    case 'raids': {
      const need = Number(p.n) || 0;
      return { ok: (ctx.raids || 0) >= need, why: `нужно вылетов: ${need}` };
    }
    case 'loot': {
      const need = Number(p.n) || 0;
      return { ok: (ctx.loot || 0) >= need, why: `нужно эрга: ${need}` };
    }
    case 'cc': {
      const need = Number(p.n) || 0;
      return { ok: (ctx.ccLevel || 1) >= need, why: `нужен КЦ ур. ${need}` };
    }
    case 'top': {
      const need = Number(p.n) || 100;
      if (!ctx.statsAvailable) return { ok: false, why: 'топ недоступен (нет сервера)' };
      if (!ctx.topRank) return { ok: false, why: `нужен топ-${need}` };
      return { ok: ctx.topRank <= need, why: `топ-${need}, вы ${ctx.topRank}` };
    }
    case 'daily': return { ok: true };
    default: return { ok: false, why: 'неизвестное условие' };
  }
}

// ------------------------------------------------------------
// Награды.
// ------------------------------------------------------------
export function pickReward(rewards, rnd = Math.random) {
  const list = (rewards || []).filter((r) => r && REWARD_KINDS[r.kind]);
  if (!list.length) return null;
  const total = list.reduce((a, r) => a + Math.max(0.0001, Number(r.weight) || 1), 0);
  let roll = rnd() * total;
  for (const r of list) {
    roll -= Math.max(0.0001, Number(r.weight) || 1);
    if (roll <= 0) return r;
  }
  return list[list.length - 1];
}

// Применение награды к живому состоянию. Возвращает текст для тоста.
export function applyReward(game, reward) {
  if (!game || !game.state || !reward) return '';
  const st = game.state;
  const p = reward.params || {};
  // minerals/tech в состоянии движка ключуются стороной ('player'/'enemy'),
  // а не именем фракции (st.factions.player = 'human').
  const side = 'player';
  switch (reward.kind) {
    case 'erg': {
      const amount = Math.max(1, Math.round(Number(p.amount) || 0));
      st.minerals[side] = (st.minerals[side] || 0) + amount;
      return '+' + amount + ' эрга';
    }
    case 'unit': {
      const count = Math.max(1, Math.min(20, Math.round(Number(p.count) || 1)));
      const type = String(p.unit || 'marine');
      const cc = (st.buildings || []).find((b) => !b.dead && b.done && b.side === 'player' && b.type === 'cc');
      let made = 0;
      for (let i = 0; i < count; i++) {
        const ax = cc ? cc.tx + (i % 4) * 1.4 : 6 + i;
        const ay = cc ? cc.ty + 5 + Math.floor(i / 4) : 8;
        const u = typeof game.spawnRewardUnit === 'function'
          ? game.spawnRewardUnit(st, type, ax, ay)
          : null;
        if (u) made++;
      }
      return made ? `+${made} × ${type}` : 'юнит не поместился';
    }
    case 'grade': {
      const type = String(p.building || 'depot');
      const levels = Math.max(1, Math.min(5, Math.round(Number(p.levels) || 1)));
      const target = (st.buildings || [])
        .filter((b) => !b.dead && b.done && b.side === 'player' && b.type === type)
        .sort((a, b) => (a.level || 1) - (b.level || 1))[0];
      if (!target) return 'нет здания ' + type;
      const from = target.level || 1;
      // Канон R1: здание не может быть выше КЦ — приз тоже не ломает правило.
      const ccL = (st.buildings || [])
        .filter((b) => !b.dead && b.done && b.side === 'player' && b.type === 'cc')
        .reduce((m, b) => Math.max(m, b.level || 1), 1);
      const to = Math.min(20, ccL, from + levels);
      if (to <= from) return `грейд не выше КЦ ур. ${ccL}`;
      target.level = to;
      if (target.cfg && target.cfg.hp) {
        const mul = 1 + 0.08 * (to - 1);
        target.maxHp = Math.round(target.cfg.hp * mul);
        target.hp = target.maxHp;
      }
      return `грейд ${from}→${to}`;
    }
    case 'tech': {
      const key = String(p.key || 'infAtk');
      const levels = Math.max(1, Math.min(5, Math.round(Number(p.levels) || 1)));
      if (!st.tech || !st.tech[side]) return 'нет технологий';
      const before = st.tech[side][key] || 0;
      st.tech[side][key] = Math.min(20, before + levels);
      return `ранг ${key}: ${before}→${st.tech[side][key]}`;
    }
    case 'boost': {
      const mul = Math.max(1, Math.min(3, Number(p.mul) || 1.5));
      const minutes = Math.max(1, Math.min(240, Number(p.minutes) || 15));
      st.boost = { mul, until: Date.now() + minutes * 60000 };
      return `добыча ×${mul} на ${minutes} мин`;
    }
    case 'cosmetic': {
      const id = String(p.id || 'skin');
      st.cosmetics = st.cosmetics || [];
      if (!st.cosmetics.includes(id)) st.cosmetics.push(id);
      return 'облик: ' + id;
    }
    default:
      return '';
  }
}

// ------------------------------------------------------------
// Контекст состояния для проверки условий.
// ------------------------------------------------------------
export function buildContext(game, extra = {}) {
  const st = game && game.state;
  const session = game && game.raidSession;
  let ccLevel = 1;
  if (st && Array.isArray(st.buildings)) {
    for (const b of st.buildings) {
      if (b && !b.dead && b.done && b.side === 'player' && b.type === 'cc') ccLevel = Math.max(ccLevel, b.level || 1);
    }
  }
  const raids = (session && session.raidSeq) || 0;
  const loot = (st && st.stats && st.stats.mined) || 0;
  return {
    now: new Date(),
    raids,
    loot,
    ccLevel,
    topRank: extra.topRank || 0,
    statsAvailable: extra.statsAvailable !== undefined ? extra.statsAvailable : !!extra.topRank,
    ...extra,
  };
}

// Список капсул, доступных прямо сейчас (для входного оверлея).
export function availableChests(game, ctx) {
  const cfg = loadConfig();
  if (!cfg.enabled) return [];
  const state = loadState();
  const out = [];
  for (const chest of cfg.chests) {
    if (!chest || !chest.id) continue;
    const period = chest.period === 'once' ? 'once' : 'day';
    const claimed = isClaimed(chest.id, period, state);
    const cond = checkCondition(chest.condition, ctx);
    out.push({ chest, claimed, eligible: cond.ok, why: cond.why || '', period });
  }
  // Сначала доступные, потом по редкости.
  const rank = { legend: 4, epic: 3, rare: 2, common: 1 };
  out.sort((a, b) => (Number(b.eligible) - Number(a.eligible))
    || (rank[b.chest.rarity] || 0) - (rank[a.chest.rarity] || 0));
  return out;
}

export function claimChest(game, chestId, ctx) {
  const cfg = loadConfig();
  const chest = cfg.chests.find((c) => c && c.id === chestId);
  if (!chest) return { ok: false, error: 'нет такой капсулы' };
  const state = loadState();
  const period = chest.period === 'once' ? 'once' : 'day';
  if (isClaimed(chest.id, period, state)) return { ok: false, error: 'уже забрана' };
  const cond = checkCondition(chest.condition, ctx);
  if (!cond.ok) return { ok: false, error: cond.why || 'условие не выполнено' };
  const reward = pickReward(chest.rewards);
  if (!reward) return { ok: false, error: 'в капсуле нет наград' };
  const text = applyReward(game, reward);
  state.claimed[chest.id] = { day: dayKey(), ts: Date.now() };
  saveState(state);
  return { ok: true, reward, text, chest };
}

// ------------------------------------------------------------
// Сервер: конфиг капсул и ручные выдачи администратора.
// ------------------------------------------------------------
// Сеть полигона живёт в save-client (window.__saveApi.api) — единая точка:
// адрес API, офлайн-режим и статус связи считаются там.
async function api(path, payload) {
  const save = typeof window !== 'undefined' ? window.__saveApi : null;
  if (!save || !save.api) return null;
  const j = await save.api(path, payload);
  return j && j.ok ? j : null;
}

export async function pullConfigFromServer(identity) {
  if (!identity) return false;
  // Конфиг лежит отдельным серверным ключом (не в SYNC_KEYS), поэтому тянем
  // точечно и кэшируем локально.
  const res = await api('/api/load', { player: identity.nick, pin: identity.pin, key: SRV_CFG_KEY });
  if (res && res.ok && typeof res.value === 'string') {
    try {
      const cfg = JSON.parse(res.value);
      if (cfg && cfg.schemaVersion === CHEST_SCHEMA) { writeJSON(CFG_KEY, cfg); return true; }
    } catch { /* битый конфиг — остаёмся на локальном */ }
  }
  return false;
}

export async function publishConfigToServer(identity) {
  if (!identity) return { ok: false, error: 'нужен профиль (ник+пин в КЦ)' };
  const cfg = loadConfig();
  cfg.updatedAt = Date.now();
  writeJSON(CFG_KEY, cfg);
  const res = await api('/api/save', {
    player: identity.nick, pin: identity.pin, key: SRV_CFG_KEY, value: JSON.stringify(cfg),
  });
  return res && res.ok ? { ok: true } : { ok: false, error: 'сервер недоступен' };
}

// Ручные подарки (админка → игроку): сервер отдаёт список по нику.
export async function pullGrants(identity) {
  if (!identity) return [];
  const res = await api('/api/load', { player: identity.nick, pin: identity.pin, key: SRV_GRANT_KEY });
  if (!res || !res.ok || typeof res.value !== 'string') return [];
  try {
    const list = JSON.parse(res.value);
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}

export async function fetchTop(metric = 'raids', n = 100) {
  const res = await api(`/api/top?metric=${encodeURIComponent(metric)}&n=${n}`);
  return res && res.ok ? res : null;
}
