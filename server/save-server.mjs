// save-server.mjs — сервер сохранения прогресса Alien Cosmic (полигон r/).
// Ноль зависимостей: node:http + node:sqlite. Запуск: node server/save-server.mjs
// (переменные: PORT=8790, DB_PATH=./saves.db, TOKEN — опциональный секрет)
//
// Э2 (25.10.2026) — что исправлено после живой игры владельца:
//   1) НИК НЕ РЕГИСТРОЗАВИСИМ: BEST / best / BESt — один профиль (была
//      тройная регистрация и «база не нашлась»). Канонический ник — первый
//      введённый; сравнение через lower(), схема БД не менялась.
//   2) CORS + OPTIONS по-человечески (клиент может стучаться и на :8790
//      напрямую, и через прокси статики /api/*).
//   3) POST /api/load понимает и {pin}, и ?pin= (оба клиента).
//   4) /api/list отдаёт канонический ник и размер записи — панель профиля
//      показывает «что лежит на сервере» без догадок.
//   5) /api/delete — удалить запись (нужно для сброса битой базы).
//
// API:
//   GET  /health                              → { ok, players, records }
//   POST /api/save   {player,key,value,pin}    → { ok, ts, player }
//   POST /api/load   {player,key,pin}          → { ok, value, ts, player }
//   GET  /api/list?player=&pin=                → { ok, records:[{key,ts,bytes}] }
//   POST /api/delete {player,key,pin}          → { ok }
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const PORT = Number(process.env.PORT || 8790);
const DB_PATH = process.env.DB_PATH || join(dirname(fileURLToPath(import.meta.url)), 'saves.db');
const TOKEN = process.env.TOKEN || '';

const db = new DatabaseSync(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS saves (
    player TEXT NOT NULL,
    key    TEXT NOT NULL,
    value  TEXT NOT NULL,
    ts     INTEGER NOT NULL,
    PRIMARY KEY (player, key)
  );
  CREATE TABLE IF NOT EXISTS players (
    nick     TEXT PRIMARY KEY,
    pin_hash TEXT NOT NULL,
    created  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS players_nick_lower ON players (lower(nick));
`);

const pinHash = (nick, pin) => createHash('sha256').update(`${String(nick).toLowerCase()}:${pin}`).digest('hex');
const NICK_RE = /^[a-zA-Zа-яА-Я0-9_-]{2,24}$/;

// ---- П-5 (#45): защита от перебора пина -------------------------------
// 5 неудачных попыток → кулдаун 60 с; каждая следующая серия удваивает
// ожидание (60 → 120 → 240 … до 1 часа). Считаем по паре «ник + адрес»:
// чужой человек за тем же роутером не блокирует владельца, а смена адреса
// не обнуляет счёт по нику. Успешный вход сбрасывает серию.
const RL_LIMIT = 5;
const RL_BASE_MS = 60 * 1000;
const RL_MAX_MS = 60 * 60 * 1000;
const rl = new Map(); // 'ник|адрес' → { fails, until, strikes }
const rlKey = (nick, ip) => `${String(nick || '').toLowerCase()}|${ip || '-'}`;
function rlCheck(nick, ip) {
  const e = rl.get(rlKey(nick, ip));
  if (e && e.until > Date.now()) {
    return { blocked: true, retryAfter: Math.max(1, Math.ceil((e.until - Date.now()) / 1000)) };
  }
  return { blocked: false };
}
function rlFail(nick, ip) {
  const k = rlKey(nick, ip);
  const e = rl.get(k) || { fails: 0, until: 0, strikes: 0 };
  e.fails++;
  if (e.fails >= RL_LIMIT) {
    e.strikes++;
    const wait = Math.min(RL_MAX_MS, RL_BASE_MS * 2 ** (e.strikes - 1));
    e.until = Date.now() + wait;
    e.fails = 0;
    console.warn(`[save-server] rate-limit: ${e.strikes} серия неудач → кулдаун ${Math.round(wait / 1000)} с (ник «${nick}», ${ip || '-'})`);
  }
  rl.set(k, e);
}
function rlOk(nick, ip) { rl.delete(rlKey(nick, ip)); }
const clientIp = (req) => String((req && req.socket && req.socket.remoteAddress) || '-');

// Ник + пин → канонический профиль. Регистронезависимо.
function authPlayer(nick, pin, ip) {
  const raw = String(nick || '').trim();
  if (!raw || !pin) return { ok: false, code: 400, error: 'need nick & pin' };
  if (!NICK_RE.test(raw)) return { ok: false, code: 400, error: 'bad nick' };
  const gate = rlCheck(raw, ip);
  if (gate.blocked) {
    return { ok: false, code: 429, error: 'too many attempts', retryAfter: gate.retryAfter };
  }
  const row = db.prepare('SELECT nick, pin_hash FROM players WHERE lower(nick) = lower(?)').get(raw);
  if (!row) {
    db.prepare('INSERT INTO players (nick, pin_hash, created) VALUES (?, ?, ?)')
      .run(raw, pinHash(raw, pin), Date.now());
    return { ok: true, registered: true, nick: raw };
  }
  // Пин считается ОТ КАНОНИЧЕСКОГО ника — иначе смена регистра ломала вход.
  if (row.pin_hash !== pinHash(row.nick, pin)) {
    rlFail(raw, ip);
    return { ok: false, code: 403, error: 'nick taken, wrong pin', nick: row.nick };
  }
  rlOk(raw, ip);
  return { ok: true, nick: row.nick };
}

function json(res, code, obj, extraHeaders) {
  const body = JSON.stringify(obj);
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };
  if (extraHeaders) Object.assign(headers, extraHeaders);
  res.writeHead(code, headers);
  res.end(body);
}

// Отказ авторизации: 429 отдаёт Retry-After, чтобы клиент показал точный
// отсчёт кулдауна, а не «попробуйте позже».
const authFail = (res, auth) => json(
  res, auth.code, auth,
  auth.code === 429 ? { 'Retry-After': String(auth.retryAfter || 60) } : undefined,
);

function authOk(req) {
  if (!TOKEN) return true;
  return (req.headers.authorization || '') === `Bearer ${TOKEN}`;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 4e6) reject(new Error('too large')); });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'x'}`);
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (!authOk(req)) return json(res, 401, { ok: false, error: 'bad token' });

  if (req.method === 'GET' && url.pathname === '/health') {
    const n = db.prepare('SELECT COUNT(*) AS n FROM saves').get().n;
    const p = db.prepare('SELECT COUNT(*) AS n FROM players').get().n;
    return json(res, 200, { ok: true, players: p, records: n, db: DB_PATH, version: 3 });
  }

  if (req.method === 'POST' && url.pathname === '/api/save') {
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      const { player, key, value, ts } = body;
      const pin = body.pin !== undefined ? body.pin : url.searchParams.get('pin');
      const auth = authPlayer(player, pin, clientIp(req));
      if (!auth.ok) return authFail(res, auth);
      if (!key || typeof value !== 'string') {
        return json(res, 400, { ok: false, error: 'need key, value(string)' });
      }
      const now = Date.now();
      db.prepare(`
        INSERT INTO saves (player, key, value, ts) VALUES (?, ?, ?, ?)
        ON CONFLICT(player, key) DO UPDATE SET value = excluded.value, ts = excluded.ts
      `).run(auth.nick, String(key).slice(0, 128), value, Number(ts) || now);
      return json(res, 200, { ok: true, ts: now, player: auth.nick, registered: !!auth.registered });
    } catch (e) {
      return json(res, 400, { ok: false, error: String(e.message) });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/load') {
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      const pin = body.pin !== undefined ? body.pin : url.searchParams.get('pin');
      const auth = authPlayer(body.player, pin, clientIp(req));
      if (!auth.ok) return authFail(res, auth);
      if (!body.key) return json(res, 400, { ok: false, error: 'need key' });
      const row = db.prepare('SELECT value, ts FROM saves WHERE player = ? AND key = ?')
        .get(auth.nick, String(body.key));
      return row
        ? json(res, 200, { ok: true, value: row.value, ts: row.ts, player: auth.nick })
        : json(res, 200, { ok: false, error: 'not found', player: auth.nick });
    } catch (e) {
      return json(res, 400, { ok: false, error: String(e.message) });
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/list') {
    const nick = url.searchParams.get('player');
    const pin = url.searchParams.get('pin');
    // Список без пина — только имена ключей и время (не данные).
    const row = db.prepare('SELECT nick FROM players WHERE lower(nick) = lower(?)').get(String(nick || ''));
    if (!row) return json(res, 200, { ok: true, records: [], player: null });
    const rows = db.prepare('SELECT key, ts, length(value) AS bytes FROM saves WHERE player = ? ORDER BY ts DESC')
      .all(row.nick);
    return json(res, 200, { ok: true, records: rows, player: row.nick, pin: pin ? undefined : 'hidden' });
  }

  // Э6: рейтинг игроков. Клиент пишет статистику в ключ ac_stats
  // ({raids, loot, ccLevel, houseLevel, nick, ts}); сервер собирает топ.
  if (req.method === 'GET' && url.pathname === '/api/top') {
    const metric = url.searchParams.get('metric') === 'loot' ? 'loot' : 'raids';
    const n = Math.max(1, Math.min(500, Number(url.searchParams.get('n')) || 100));
    const rows = db.prepare("SELECT player, value, ts FROM saves WHERE key = 'ac_stats'").all();
    const list = [];
    for (const r of rows) {
      try {
        const v = JSON.parse(r.value);
        list.push({
          player: r.player,
          raids: Number(v.raids) || 0,
          loot: Number(v.loot) || 0,
          ccLevel: Number(v.ccLevel) || 1,
          houseLevel: Number(v.houseLevel) || 0,
          ts: Number(r.ts) || 0,
        });
      } catch { /* битые данные пропускаем */ }
    }
    list.sort((a, b) => (b[metric] - a[metric]) || (b.loot - a.loot) || a.player.localeCompare(b.player));
    const top = list.slice(0, n).map((x, i) => ({ ...x, rank: i + 1 }));
    return json(res, 200, { ok: true, metric, total: list.length, top });
  }

  // Э6: «подарок администрации» — админка кладёт запись под ником игрока.
  // Без ADMIN_PIN (dev-режим) разрешено всё; с ним — обязателен заголовок Bearer.
  if (req.method === 'POST' && url.pathname === '/api/grant') {
    const adminPin = process.env.ADMIN_PIN || '';
    if (adminPin && (req.headers.authorization || '') !== `Bearer ${adminPin}`) {
      return json(res, 401, { ok: false, error: 'admin pin required' });
    }
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      const nick = String(body.player || '').trim();
      if (!NICK_RE.test(nick)) return json(res, 400, { ok: false, error: 'bad nick' });
      const row = db.prepare('SELECT nick FROM players WHERE lower(nick) = lower(?)').get(nick);
      if (!row) return json(res, 404, { ok: false, error: 'player not found' });
      const cur = db.prepare('SELECT value FROM saves WHERE player = ? AND key = ?').get(row.nick, 'ac_grant');
      let list = [];
      if (cur) { try { list = JSON.parse(cur.value) || []; } catch { list = []; } }
      const grant = body.grant || {};
      list.push({ id: 'g' + Date.now(), ts: Date.now(), ...grant });
      db.prepare(`
        INSERT INTO saves (player, key, value, ts) VALUES (?, ?, ?, ?)
        ON CONFLICT(player, key) DO UPDATE SET value = excluded.value, ts = excluded.ts
      `).run(row.nick, 'ac_grant', JSON.stringify(list), Date.now());
      return json(res, 200, { ok: true, player: row.nick, grants: list.length });
    } catch (e) {
      return json(res, 400, { ok: false, error: String(e.message) });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/delete') {
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      const auth = authPlayer(body.player, body.pin, clientIp(req));
      if (!auth.ok) return authFail(res, auth);
      if (!body.key) return json(res, 400, { ok: false, error: 'need key' });
      db.prepare('DELETE FROM saves WHERE player = ? AND key = ?').run(auth.nick, String(body.key));
      return json(res, 200, { ok: true, player: auth.nick });
    } catch (e) {
      return json(res, 400, { ok: false, error: String(e.message) });
    }
  }

  json(res, 404, { ok: false, error: 'unknown route' });
});

server.listen(PORT, '0.0.0.0', () => console.log(`[save-server] :${PORT}, db: ${DB_PATH}`));
