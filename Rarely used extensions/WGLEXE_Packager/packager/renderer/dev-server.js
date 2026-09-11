'use strict';

/**
 * Static server for the Settings-screen preview harness (preview.html).
 *
 * Development aid only. The packager itself is a desktop application — this
 * exists so the renderer can be opened in an ordinary browser to check the
 * Settings screen and its warning interlocks without building or launching
 * Electron. It is excluded from the portable build.
 *
 *   node packager/renderer/dev-server.js [--port 8123]
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DEFAULT_PORT = 8123;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function portFromArgs(argv) {
  const at = argv.indexOf('--port');
  const value = at === -1 ? NaN : Number(argv[at + 1]);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_PORT;
}

const server = http.createServer((request, response) => {
  const requested = decodeURIComponent(request.url.split('?')[0]);
  const relative = requested === '/' ? 'preview.html' : requested.replace(/^\/+/, '');
  const target = path.join(ROOT, relative);

  // Never serve outside the renderer folder.
  if (!path.resolve(target).startsWith(path.resolve(ROOT))) {
    response.writeHead(403).end('Forbidden');
    return;
  }
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    response.writeHead(404).end(`Not found: ${relative}`);
    return;
  }

  response.writeHead(200, {
    'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  fs.createReadStream(target).pipe(response);
});

const port = portFromArgs(process.argv.slice(2));
server.listen(port, () => {
  console.log(`WGLEXE Packager renderer preview: http://localhost:${port}/`);
  console.log('Development harness only — the packager itself is a desktop application.');
});
