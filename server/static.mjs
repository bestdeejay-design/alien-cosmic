// static.mjs — статика полигонов без кэширования + ПРОКСИ СЕЙВ-СЕРВЕРА.
// Использование: PORT=8805 node server/static.mjs
//
// Э2 (25.10.2026): почему прокси. Владелец играл с телефона и планшета, и
// сохранение «не работало» по трём причинам:
//   1) клиент стучался на http://<host>:8790 — при https-странице это mixed
//      content, а на телефоне порт 8790 вообще не проброшен;
//   2) браузер не пускал запрос без CORS (теперь CORS есть, но прокси надёжнее);
//   3) два порта = два разных «стенда» в предпросмотре.
// Решение: всё, что начинается с /api/ или /health, проксируется на локальный
// сейв-сервер (по умолчанию 127.0.0.1:8790). Страница и API живут на одном
// origin, поэтому сейв работает в любом браузере и в предпросмотре.
import { createServer, request as httpRequest } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = Number(process.env.PORT || 8805);
// POLYGON=1 — стенд сразу открывает полигон рейдов: «/» уводит на «/r/».
// Нужно для предпросмотра с телефона (в адресной строке путь не набрать),
// при этом относительные пути r/index.html («./js/game.js») остаются верными —
// поэтому именно 302, а не отдача r/index.html по корню.
const POLYGON = process.env.POLYGON === '1';
const API_PORT = Number(process.env.API_PORT || 8790);
const API_HOST = process.env.API_HOST || '127.0.0.1';
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.mjs': 'text/javascript',
  '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};

function proxy(req, res) {
  const up = httpRequest({
    host: API_HOST, port: API_PORT, path: req.url, method: req.method,
    headers: { ...req.headers, host: `${API_HOST}:${API_PORT}` },
  }, (upRes) => {
    res.writeHead(upRes.statusCode || 502, upRes.headers);
    upRes.pipe(res);
  });
  up.on('error', () => {
    // Сейв-сервер не запущен — честный ответ, клиент уйдёт в локальный режим.
    res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ok: false, error: 'save-server offline', apiPort: API_PORT }));
  });
  req.pipe(up);
}

createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://x').pathname;
  if (pathname.startsWith('/api/') || pathname === '/health') return proxy(req, res);
  if (POLYGON && (pathname === '/' || pathname === '/index.html')) {
    res.writeHead(302, { Location: '/r/', 'Cache-Control': 'no-store' });
    return res.end();
  }
  try {
    let p = decodeURIComponent(pathname);
    if (p.endsWith('/')) p += 'index.html';
    const f = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ''));
    const data = await readFile(f);
    res.writeHead(200, { 'Content-Type': MIME[extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  } catch { res.writeHead(404); res.end('not found'); }
}).listen(PORT, '0.0.0.0', () => console.log(
  `[static] :${PORT} ← ${ROOT} (+/api → :${API_PORT})${POLYGON ? ' · режим ПОЛИГОН: / → /r/' : ''}`));
