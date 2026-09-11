/** Static server for the harness. Serves the harness folder and the sibling extension folders. */
const http = require('http');
const fs = require('fs');
const path = require('path');

const harness = __dirname;
const repo = path.resolve(__dirname, '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
                '.wasm': 'application/wasm', '.svg': 'image/svg+xml' };

http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]);
  let file;
  if (rel.startsWith('/ext/')) {
    // Extension sources live one level up. A relative "../" in the page would be collapsed away by
    // the browser at the site root, so route them explicitly.
    file = path.join(repo, rel.slice('/ext/'.length));
    // Some extensions still sit under "Rarely used extensions/" while the restructure is in
    // progress. Fall back there rather than 404ing, so the harness works either side of the move.
    if (!fs.existsSync(file)) {
      const alt = path.join(repo, 'Rarely used extensions', rel.slice('/ext/'.length));
      if (fs.existsSync(alt)) file = alt;
    }
  } else {
    file = path.join(harness, rel === '/' ? 'index.html' : rel);
  }
  if (!file.startsWith(repo)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end('not found: ' + rel); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(8140, () => console.log('GDJS harness on http://localhost:8140'));
