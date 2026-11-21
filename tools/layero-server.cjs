'use strict';
// Layero entry: the whole NITI site on one origin.
//
// Layero cannot rewrite /player/* and /api/* to another host, and the hosted
// player Worker refuses server-side calls (Cloudflare answers 403 to anything
// but a browser). So this entry runs the player Worker in-process next to the
// static console: the browser always talks to one origin, the GM console keeps
// its live sessions, and nothing depends on an outside deployment.
//
// The database is YDB when YDB_DOCUMENT_ENDPOINT and YDB_SERVICE_ACCOUNT_KEY
// are set, so rooms survive a rebuild, a freeze and a long idle. Without those
// variables the entry falls back to SQLite on the container disk, exactly as
// the local dev server, which is fine for a throwaway preview.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { DatabaseSync } = require('node:sqlite');
const { createDatabase } = require('./ydb-db.cjs');

const root = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 3000);
const staticRoot = path.join(root, 'master/dist');
const workerFile = path.join(root, 'players/dist/server/index.js');
const schemaFile = path.join(root, 'players/drizzle/0000_petite_bullseye.sql');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8', '.pdf': 'application/pdf',
};

// /app is where Layero puts the code; /tmp is an in-memory fallback in case the
// working directory turns out to be read only.
function dataDir() {
  const candidates = [process.env.NITI_DATA_DIR, path.join(root, '.local'), '/tmp/niti-data'];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      fs.mkdirSync(candidate, { recursive: true });
      fs.accessSync(candidate, fs.constants.W_OK);
      return candidate;
    } catch { /* Try the next candidate. */ }
  }
  throw new Error('No writable data directory');
}

// Pages get their own origin from the browser, so no scheme or host is guessed
// here: one script works on local HTTP and behind the Layero proxy alike.
const ORIGIN_SCRIPT = '<script>window.NITI_SESSION_API_BASE=new URL(\'api/\',location.href).href;window.NITI_SESSION_PLAYER_URL=new URL(\'player/\',location.href).href;</script>';

// The Worker expects the D1 statement API; node:sqlite is close enough.
class SqliteStatement {
  constructor(sql, values = []) { this.sql = sql; this.values = values; }
  bind(...values) { return new SqliteStatement(this.sql, values); }
  async first(column) { const row = db.prepare(this.sql).get(...this.values); return row ? (column ? row[column] : { ...row }) : null; }
  async all() { return { success: true, results: db.prepare(this.sql).all(...this.values).map(row => ({ ...row })) }; }
  async run() { const row = db.prepare(this.sql).run(...this.values); return { success: true, meta: { changes: Number(row.changes), last_row_id: Number(row.lastInsertRowid) } }; }
}

// One object answers `prepare` for whichever backend booted. When YDB is
// configured but unreachable the Worker gets no DB at all, and its own
// /api/health and room routes answer 503 instead of inventing a second,
// divergent database on disk.
let backend = null;
const workerEnv = () => ({ DB: backend ? { prepare: sql => backend.prepare(sql) } : undefined });

let db = null;
let worker = null;

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://niti.local');
    const viaPlayer = url.pathname === '/player' || url.pathname.startsWith('/player/') || url.pathname.startsWith('/api/');

    if (viaPlayer) {
      if (url.pathname === '/player') { res.writeHead(301, { location: '/player/' }); res.end(); return; }
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const init = { method: req.method, headers: req.headers };
      if (!['GET', 'HEAD'].includes(req.method) && chunks.length) init.body = Buffer.concat(chunks);
      // The Worker owns its assets from the root; /player is only our prefix.
      const target = new URL(url.href);
      target.pathname = url.pathname.replace(/^\/player/, '') || '/';
      const request = new Request(target, init);
      // One origin: whatever Origin the browser sent is our own.
      const sent = req.headers.origin;
      const response = target.pathname.startsWith('/api/')
        ? await worker.handleApi(request, workerEnv(), sent ? { allowedOrigins: [sent] } : {})
        : await worker.default.fetch(request, workerEnv());
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(req.method === 'HEAD' ? undefined : Buffer.from(await response.arrayBuffer()));
      return;
    }

    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { allow: 'GET, HEAD' }); res.end(); return; }
    const name = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).slice(1);
    const file = path.resolve(staticRoot, name);
    if (!file.startsWith(staticRoot + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Not found'); return;
    }
    let data = fs.readFileSync(file);
    if (path.extname(file) === '.html') data = Buffer.from(data.toString().replace('<head>', '<head>' + ORIGIN_SCRIPT));
    res.writeHead(200, {
      'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch (error) {
    console.error('request failed:', req.url, error.message);
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Server error. See the application log.');
  }
});

(async () => {
  if (!fs.existsSync(workerFile)) throw new Error('Missing ' + workerFile + '. Run: python players/scripts/build-worker.py');
  if (process.env.YDB_DOCUMENT_ENDPOINT && process.env.YDB_SERVICE_ACCOUNT_KEY) {
    try {
      const ydb = createDatabase();
      const table = await ydb.ensureTable();
      backend = ydb;
      console.log('rooms live in YDB · table ' + table);
    } catch (error) {
      // Serving the static site is still useful; sessions say they are offline.
      console.error('YDB is configured but unreachable, sessions are offline:', error.message);
    }
  } else {
    db = new DatabaseSync(path.join(dataDir(), 'niti.sqlite'));
    if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='niti_rooms'").get()) {
      db.exec(fs.readFileSync(schemaFile, 'utf8'));
    }
    backend = { prepare: sql => new SqliteStatement(sql) };
    console.log('rooms live in SQLite on the container disk · not durable across rebuilds');
  }
  worker = await import(pathToFileURL(workerFile).href);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '0.0.0.0', resolve); });
  console.log('NITI on 0.0.0.0:' + PORT + ' · static ' + staticRoot);
})().catch(error => { console.error(error.message); db?.close(); process.exitCode = 1; });

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => { db?.close(); process.exit(0); }));
}