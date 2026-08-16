// Serves desktop/ui over http so the UI can be previewed in a browser.
//
// The app normally runs inside Tauri, which serves these files over its own
// protocol. Opening them as file:// does not work: library.json and every
// question bank are fetched, and fetch is blocked for file:// origins. A
// plain static server is the smallest thing that makes the real UI runnable
// outside the shell.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', 'desktop', 'ui');
const PORT = Number(process.env.PORT || 8792);

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
  '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml'
};

http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || '_preview.html';
  const file = path.join(ROOT, rel);

  // Never serve outside the ui folder, whatever the request path claims.
  if (!file.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }

  fs.readFile(file, (err, body) => {
    if (err) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(body);
  });
}).listen(PORT, () => console.log(`serving desktop/ui on http://localhost:${PORT}`));
