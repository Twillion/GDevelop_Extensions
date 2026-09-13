
// --- wglexe:isolation (injected by WGLEXE Packager — Mode B, see plan section 5.3) ---
// Serves the game from a privileged game:// origin with COOP/COEP, which grants
// crossOriginIsolated. Cost: GDevelop player authentication stops working, and any
// cross-origin asset without CORP is blocked.
const { protocol: __wglexeProtocol, net: __wglexeNet } = require('electron');
const __wglexePath = require('path');
const __wglexeUrl = require('url');

__wglexeProtocol.registerSchemesAsPrivileged([
  {
    scheme: 'game',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
      allowServiceWorkers: true,
    },
  },
]);

app.whenReady().then(() => {
  const root = __wglexePath.join(__dirname, 'app');
  __wglexeProtocol.handle('game', async (request) => {
    const { pathname } = new URL(request.url);
    const target = __wglexePath.join(root, decodeURIComponent(pathname));
    const relative = __wglexePath.relative(root, target);
    if (relative.startsWith('..') || __wglexePath.isAbsolute(relative)) {
      return new Response('Forbidden', { status: 403 });
    }
    const response = await __wglexeNet.fetch(
      __wglexeUrl.pathToFileURL(target).toString()
    );
    const headers = new Headers(response.headers);
    headers.set('Cross-Origin-Opener-Policy', 'same-origin');
    headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
    headers.set('Cross-Origin-Resource-Policy', 'same-origin');
    return new Response(response.body, { status: response.status, headers });
  });
});
// --- /wglexe:isolation ---
