/** Static server for the harness. Serves the harness folder and the sibling extension folders. */
const http = require('http');
const fs = require('fs');
const path = require('path');

const harness = __dirname;
// The REPO ROOT, two levels up: this harness lives at tools/gdjs-harness/. It used to sit at
// the repo root, where one level up was correct; after the move that silently resolved to
// tools/ and every /ext/ request 404'd while the page still loaded and the engine still booted.
const repo = path.resolve(__dirname, '..', '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
                '.wasm': 'application/wasm', '.svg': 'image/svg+xml' };

http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]);
  let file;
  if (rel.startsWith('/ext/')) {
    // Extension sources live one level up. A relative "../" in the page would be collapsed away by
    // the browser at the site root, so route them explicitly.
    // Extensions are filed under GDevelop-style category folders ("3D", "Visual effect", ...),
    // and used to sit at the repo root. The harness page asks for them by BARE NAME on purpose -
    // a scenario should not have to know which category an extension was filed under, and moving
    // one between categories should not silently 404 the harness. So search: root first, then
    // every top-level directory.
    //
    // This resolver was itself broken by the category reorganisation, which is worth noting: the
    // page loaded, the engine booted, and the extension simply was not there. Nothing errored
    // loudly - the scenario just reported "runtime not loaded". Hence the explicit 404 body below
    // naming what was searched.
    const want = rel.slice('/ext/'.length);
    const roots = [repo];
    try {
      for (const entry of fs.readdirSync(repo, { withFileTypes: true })) {
        if (entry.isDirectory() && entry.name[0] !== '.' && entry.name !== 'node_modules') {
          roots.push(path.join(repo, entry.name));
        }
      }
    } catch (e) { /* fall through to the repo root alone */ }
    file = path.join(repo, want);
    for (const root of roots) {
      const candidate = path.join(root, want);
      if (fs.existsSync(candidate)) { file = candidate; break; }
    }
  } else {
    file = path.join(harness, rel === '/' ? 'index.html' : rel);
  }
  if (!file.startsWith(repo)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) {
      // Say WHERE it looked. A bare "not found" sent the last search after the scenario instead of
      // after the path, because a missing extension presents as a scenario that quietly does nothing.
      res.writeHead(404).end('not found: ' + rel + (rel.startsWith('/ext/')
        ? '  (searched the repo root and every top-level category folder)' : ''));
      return;
    }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(8140, () => console.log('GDJS harness on http://localhost:8140'));
