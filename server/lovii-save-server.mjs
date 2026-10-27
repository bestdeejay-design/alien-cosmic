import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
const db = new DatabaseSync("/data/saves.db");
db.exec("CREATE TABLE IF NOT EXISTS saves (player TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, ts INTEGER NOT NULL, PRIMARY KEY (player, key)); CREATE TABLE IF NOT EXISTS players (nick TEXT PRIMARY KEY, pin_hash TEXT NOT NULL, created INTEGER NOT NULL);");
const pinHash = (n, p) => createHash("sha256").update(String(n).toLowerCase() + ":" + p).digest("hex");
const json = (res, code, obj, extra) => { const h = { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" }; if (extra) Object.assign(h, extra); res.writeHead(code, h); res.end(JSON.stringify(obj)); };
const body = (req) => new Promise((ok, err) => { let d = ""; req.on("data", c => { d += c; if (d.length > 2e6) err(new Error("too large")); }); req.on("end", () => ok(d)); req.on("error", err); });
// П-5 (#45): защита от перебора пина — те же правила, что в save-server.mjs:
// 5 неудач → кулдаун 60 с, каждая следующая серия удваивает ожидание (до часа).
// Ключ — ТОЛЬКО ник (итерация 2 ревью #45); адрес пишем в лог для диагностики.
const RL_LIMIT = 5, RL_BASE_MS = 60000, RL_MAX_MS = 3600000;
const rl = new Map();
const rlKey = (nick) => String(nick || "").trim().toLowerCase();
function rlCheck(nick) {
  const e = rl.get(rlKey(nick));
  if (e && e.until > Date.now()) return { blocked: true, retryAfter: Math.max(1, Math.ceil((e.until - Date.now()) / 1000)) };
  return { blocked: false };
}
function rlFail(nick, ip) {
  const k = rlKey(nick), e = rl.get(k) || { fails: 0, until: 0, strikes: 0 };
  e.fails++;
  if (e.fails >= RL_LIMIT) {
    e.strikes++;
    const wait = Math.min(RL_MAX_MS, RL_BASE_MS * 2 ** (e.strikes - 1));
    e.until = Date.now() + wait; e.fails = 0;
    console.log("[save] rate-limit: серия " + e.strikes + " → кулдаун " + Math.round(wait / 1000) + " с (ник «" + nick + "», " + (ip || "-") + ")");
  }
  rl.set(k, e);
}
const clientIp = (req) => String((req && req.socket && req.socket.remoteAddress) || "-");
const authFail = (res, a) => json(res, a.code, { ok: false, error: a.error, retryAfter: a.retryAfter }, a.code === 429 ? { "Retry-After": String(a.retryAfter || 60) } : undefined);
function auth(nick, pin, ip) {
  nick = String(nick || "").trim().toLowerCase();
  if (!nick || !pin) return { code: 400, error: "need nick & pin" };
  const gate = rlCheck(nick);
  if (gate.blocked) return { code: 429, error: "too many attempts", retryAfter: gate.retryAfter };
  const row = db.prepare("SELECT nick, pin_hash FROM players WHERE lower(nick) = lower(?)").get(nick);
  const h = pinHash(nick, pin);
  if (!row) { db.prepare("INSERT INTO players (nick, pin_hash, created) VALUES (?, ?, ?)").run(nick, h, Date.now()); return { nick, registered: true }; }
  if (row.pin_hash !== h) { rlFail(nick, ip); return { code: 403, error: "nick taken, wrong pin" }; }
  rl.delete(rlKey(nick));
  return { nick: row.nick };
}
createServer(async (req, res) => {
  try {
  const u = new URL(req.url, "http://x");
  if (req.method === "OPTIONS") return json(res, 204, {});
  if (u.pathname === "/health") return json(res, 200, { ok: true, records: db.prepare("SELECT COUNT(*) n FROM saves").get().n, version: 5 });
  if (req.method === "POST" && u.pathname === "/api/save") {
    const { player, key, value, pin } = JSON.parse(await body(req));
    const a = auth(player, pin, clientIp(req)); if (a.error) return authFail(res, a);
    if (!key || typeof value !== "string") return json(res, 400, { ok: false, error: "need key,value" });
    const exist = db.prepare("SELECT ts FROM saves WHERE player = ? AND key = ?").get(a.nick, key);
    if (exist) db.prepare("UPDATE saves SET value = ?, ts = ? WHERE player = ? AND key = ?").run(value, Date.now(), a.nick, key);
    else db.prepare("INSERT INTO saves (player,key,value,ts) VALUES (?,?,?,?)").run(a.nick, key, value, Date.now());
    return json(res, 200, { ok: true, player: a.nick });
  }
  if (req.method === "POST" && u.pathname === "/api/load") {
    const { player, key, pin } = JSON.parse(await body(req));
    const a = auth(player, pin, clientIp(req)); if (a.error) return authFail(res, a);
    const row = db.prepare("SELECT value, ts FROM saves WHERE player = ? AND key = ?").get(a.nick, key);
    const registered = !!a.registered;
    return row ? json(res, 200, { ok: true, value: row.value, ts: row.ts, registered }) : json(res, 200, { ok: false, error: "not found", registered });
  }
  json(res, 404, { ok: false, error: "unknown route" });
  } catch (e) { json(res, 500, { ok: false, error: "HANDLER-ERR", stack: String(e.stack).split("\n").slice(0, 6) }); }
}).listen(8790, () => console.log("[save] :8790 v4"));
