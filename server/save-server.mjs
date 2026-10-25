// save-server.mjs — ПРИМИТИВНЫЙ сервер сохранения прогресса Alien Cosmic.
// Ноль зависимостей: node:http + node:sqlite. Запуск: node save-server.mjs
// (переменные: PORT=8790, DB_PATH=./saves.db, TOKEN — опциональный секрет).
//
// API:
//   GET  /health                      → { ok, players, records }
//   POST /api/save  {player,key,value,ts?} → { ok, ts }
//   GET  /api/load?player=&key=       → { ok, value, ts } | { ok:false }
//   GET  /api/list?player=            → { ok, records: [{key, ts}] }
//
// Это учебный примитив для полигона r/: показать владельцу и Арене живой
// круг «клиент → БД на внешней машине → клиент». Оптимизация — задача Арены.
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
`);

// Пин храним как SHA-256(nick + ':' + pin) — примитив, но не plaintext.
import { createHash } from 'node:crypto';
const pinHash = (nick, pin) => createHash('sha256').update(`${nick}:${pin}`).digest('hex');

// Авторизация примитива: ник + пин. Первый save под незанятым ником регистрирует
// его с этим пином; дальше все операции под ником требуют тот же пин. 403 — чужой.
function authPlayer(db, nick, pin) {
  if (!nick || !pin) return { ok: false, code: 400, error: 'need nick & pin' };
  if (!/^[a-zA-Zа-яА-Я0-9_-]{2,24}$/.test(nick)) return { ok: false, code: 400, error: 'bad nick' };
  const row = db.prepare('SELECT pin_hash FROM players WHERE nick = ?').get(nick);
  if (!row) {
    db.prepare('INSERT INTO players (nick, pin_hash, created) VALUES (?, ?, ?)')
      .run(nick, pinHash(nick, pin), Date.now());
    return { ok: true, registered: true };
  }
  if (row.pin_hash !== pinHash(nick, pin)) return { ok: false, code: 403, error: 'nick taken, wrong pin' };
  return { ok: true };
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  });
  res.end(body);
}

function authOk(req) {
  if (!TOKEN) return true;
  return (req.headers.authorization || '') === `Bearer ${TOKEN}`;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) reject(new Error('too large')); });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (!authOk(req)) return json(res, 401, { ok: false, error: 'bad token' });

  if (req.method === 'GET' && url.pathname === '/health') {
    const n = db.prepare('SELECT COUNT(*) AS n FROM saves').get().n;
    const p = db.prepare('SELECT COUNT(DISTINCT player) AS n FROM saves').get().n;
    return json(res, 200, { ok: true, players: p, records: n, db: DB_PATH });
  }

  if (req.method === 'POST' && url.pathname === '/api/save') {
    try {
      const { player, key, value, ts, pin } = JSON.parse(await readBody(req));
      const auth = authPlayer(db, player, pin);
      if (!auth.ok) return json(res, auth.code, auth);
      if (!key || typeof value !== 'string') {
        return json(res, 400, { ok: false, error: 'need key, value(string)' });
      }
      const now = Date.now();
      db.prepare(`
        INSERT INTO saves (player, key, value, ts) VALUES (?, ?, ?, ?)
        ON CONFLICT(player, key) DO UPDATE SET value = excluded.value, ts = excluded.ts
      `).run(String(player).slice(0, 64), String(key).slice(0, 128), value, Number(ts) || now);
      return json(res, 200, { ok: true, ts: now, registered: !!auth.registered });
    } catch (e) {
      return json(res, 400, { ok: false, error: String(e.message) });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/load') {
    try {
      const { player, key, pin } = JSON.parse(await readBody(req));
      const auth = authPlayer(db, player, pin);
      if (!auth.ok) return json(res, auth.code, auth);
      if (!key) return json(res, 400, { ok: false, error: 'need key' });
      const row = db.prepare('SELECT value, ts FROM saves WHERE player = ? AND key = ?').get(player, key);
      return row ? json(res, 200, { ok: true, value: row.value, ts: row.ts })
                 : json(res, 200, { ok: false, error: 'not found' });
    } catch (e) {
      return json(res, 400, { ok: false, error: String(e.message) });
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/list') {
    const player = url.searchParams.get('player');
    if (!player) return json(res, 400, { ok: false, error: 'need player' });
    const rows = db.prepare('SELECT key, ts FROM saves WHERE player = ? ORDER BY ts DESC').all(player);
    return json(res, 200, { ok: true, records: rows });
  }

  json(res, 404, { ok: false, error: 'unknown route' });
});

server.listen(PORT, () => console.log(`[save-server] :${PORT}, db: ${DB_PATH}`));
