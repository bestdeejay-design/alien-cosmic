// gist-bridge.mjs — мостик «игра на GitHub Pages → GitHub Gist (БД владельца)».
// ЗАПУСК НА СВОЕЙ МАШИНЕ (Mac): PORT=8791 node server/gist-bridge.mjs
// Права берёт авторизованный `gh` (gh auth status). Секрет в клиент не попадает.
// API: GET /health · POST /api/save {player,key,value,pin} · GET /api/load?player=&key=
// Гист: AC_SAVE_GIST_ID (по умолчанию 69f6832c50a3715bb60c2a8ff896dca9, приватный).
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const PORT = Number(process.env.PORT || 8791);
const GIST = process.env.AC_SAVE_GIST_ID || '69f6832c50a3715bb60c2a8ff896dca9';
const OWNER = 'bestdeejay-design';

function json(res, code, obj) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((res2, rej) => {
    let d = '';
    req.on('data', (c) => { d += c; if (d.length > 2e6) rej(new Error('too large')); });
    req.on('end', () => res2(d));
    req.on('error', rej);
  });
}
// Пин-хеш как на сервере игры: sha256(nick:pin) — тот же ник+пин = тот же доступ.
import { createHash } from 'node:crypto';
const pinHash = (n, p) => createHash('sha256').update(`${n}:${p}`).digest('hex').slice(0, 32);

async function gistRead() {
  const { stdout } = await exec('gh', ['api', `gists/${GIST}`], { timeout: 15000 });
  const j = JSON.parse(stdout);
  const files = {};
  for (const [name, f] of Object.entries(j.files)) files[name] = f.content || '';
  return files;
}
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join as pjoin } from 'node:path';
async function gistPatch(files) {
  // gh не ест stdin-инпут стабильно — пишем через временный файл
  const dir = await mkdtemp(pjoin(tmpdir(), 'gist-'));
  const fp = pjoin(dir, 'body.json');
  await writeFile(fp, JSON.stringify({ files }));
  await exec('gh', ['api', `gists/${GIST}`, '-X', 'PATCH', '--input', fp], { timeout: 25000 });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (req.method === 'GET' && url.pathname === '/health') {
    try { await gistRead(); return json(res, 200, { ok: true, gist: GIST }); }
    catch (e) { return json(res, 503, { ok: false, error: String(e.message).slice(0, 120) }); }
  }
  if (req.method === 'POST' && url.pathname === '/api/save') {
    try {
      const { player, key, value, pin } = JSON.parse(await readBody(req));
      if (!player || !key || typeof value !== 'string' || !pin) return json(res, 400, { ok: false, error: 'need player,key,value,pin' });
      const file = `ac_${pinHash(player, pin)}_${String(key).replace(/[^a-z0-9._-]/gi, '_')}.json`;
      const files = await gistRead();
      let prev = null;
      try { prev = JSON.parse(files[file] || 'null'); } catch { /* битая запись перезапишем */ }
      if (prev && prev.pin !== pinHash(player, pin)) return json(res, 403, { ok: false, error: 'nick taken, wrong pin' });
      const record = JSON.stringify({ pin: pinHash(player, pin), key, value, ts: Date.now() });
      files[file] = record;
      // СТРАХОВКА владельца 26.10: каждое сохранение дублируется файлом на диск Mac
      // (server/backups/<player>.json — один файл, последнее состояние, гист может подвести).
      try {
        const { mkdir, writeFile } = await import('node:fs/promises');
        const path = await import('node:path');
        const dir = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'backups');
        await mkdir(dir, { recursive: true });
        const safe = String(player).toLowerCase().replace(/[^a-z0-9_-]/g, '_');
        const accPath = path.join(dir, safe + '.json');
        let acc = {};
        try { acc = JSON.parse(await (await import('node:fs/promises')).readFile(accPath, 'utf8')); } catch { /* первый сейв */ }
        acc[player] = acc[player] || {};
        acc[player][key] = { value, ts: Date.now() };
        await writeFile(accPath, JSON.stringify(acc, null, 1));
      } catch (be) { console.error('[bridge] disk backup failed:', be.message); }
      await gistPatch({ [file]: { content: record } });
      return json(res, 200, { ok: true });
    } catch (e) {
      return json(res, 500, { ok: false, error: String(e.message).slice(0, 160) });
    }
  }
  if (req.method === 'GET' && url.pathname === '/api/load') {
    try {
      const player = url.searchParams.get('player'), key = url.searchParams.get('key'), pin = url.searchParams.get('pin');
      if (!player || !key || !pin) return json(res, 400, { ok: false, error: 'need player,key,pin' });
      const file = `ac_${pinHash(player, pin)}_${String(key).replace(/[^a-z0-9._-]/gi, '_')}.json`;
      const files = await gistRead();
      const raw = files[file];
      if (!raw) return json(res, 200, { ok: false, error: 'not found' });
      const j = JSON.parse(raw);
      if (j.pin !== pinHash(player, pin)) return json(res, 403, { ok: false, error: 'wrong pin' });
      return json(res, 200, { ok: true, value: j.value, ts: j.ts });
    } catch (e) {
      return json(res, 500, { ok: false, error: String(e.message).slice(0, 160) });
    }
  }
  json(res, 404, { ok: false, error: 'unknown route' });
});
server.listen(PORT, () => console.log(`[gist-bridge] :${PORT} → gist ${GIST}`));
