import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
const db = new DatabaseSync("/data/saves.db");
db.exec("CREATE TABLE IF NOT EXISTS saves (player TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, ts INTEGER NOT NULL, PRIMARY KEY (player, key)); CREATE TABLE IF NOT EXISTS players (nick TEXT PRIMARY KEY, pin_hash TEXT NOT NULL, created INTEGER NOT NULL);");
const pinHash = (n, p) => createHash("sha256").update(String(n).toLowerCase() + ":" + p).digest("hex");
const json = (res, code, obj) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" }); res.end(JSON.stringify(obj)); };
const body = (req) => new Promise((ok, err) => { let d = ""; req.on("data", c => { d += c; if (d.length > 2e6) err(new Error("too large")); }); req.on("end", () => ok(d)); req.on("error", err); });
function auth(nick, pin) {
  nick = String(nick || "").trim().toLowerCase();
  if (!nick || !pin) return { code: 400, error: "need nick & pin" };
  const row = db.prepare("SELECT nick, pin_hash FROM players WHERE lower(nick) = lower(?)").get(nick);
  const h = pinHash(nick, pin);
  if (!row) { db.prepare("INSERT INTO players (nick, pin_hash, created) VALUES (?, ?, ?)").run(nick, h, Date.now()); return { nick }; }
  if (row.pin_hash !== h) return { code: 403, error: "nick taken, wrong pin" };
  return { nick: row.nick };
}
createServer(async (req, res) => {
  try {
  const u = new URL(req.url, "http://x");
  if (req.method === "OPTIONS") return json(res, 204, {});
  if (u.pathname === "/health") return json(res, 200, { ok: true, records: db.prepare("SELECT COUNT(*) n FROM saves").get().n, version: 4 });
  if (req.method === "POST" && u.pathname === "/api/save") {
    const { player, key, value, pin } = JSON.parse(await body(req));
    const a = auth(player, pin); if (a.error) return json(res, a.code, { ok: false, error: a.error });
    if (!key || typeof value !== "string") return json(res, 400, { ok: false, error: "need key,value" });
    const exist = db.prepare("SELECT ts FROM saves WHERE player = ? AND key = ?").get(a.nick, key);
    if (exist) db.prepare("UPDATE saves SET value = ?, ts = ? WHERE player = ? AND key = ?").run(value, Date.now(), a.nick, key);
    else db.prepare("INSERT INTO saves (player,key,value,ts) VALUES (?,?,?,?)").run(a.nick, key, value, Date.now());
    return json(res, 200, { ok: true, player: a.nick });
  }
  if (req.method === "POST" && u.pathname === "/api/load") {
    const { player, key, pin } = JSON.parse(await body(req));
    const a = auth(player, pin); if (a.error) return json(res, a.code, { ok: false, error: a.error });
    const row = db.prepare("SELECT value, ts FROM saves WHERE player = ? AND key = ?").get(a.nick, key);
    return row ? json(res, 200, { ok: true, value: row.value, ts: row.ts }) : json(res, 200, { ok: false, error: "not found" });
  }
  json(res, 404, { ok: false, error: "unknown route" });
  } catch (e) { json(res, 500, { ok: false, error: "HANDLER-ERR", stack: String(e.stack).split("\n").slice(0, 6) }); }
}).listen(8790, () => console.log("[save] :8790 v4"));
