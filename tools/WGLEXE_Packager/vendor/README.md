# vendor/node_modules/

Runtime dependencies the packager supplies to the game it assembles.

## Why this exists

GDevelop's local "Electron Build" export contains **no `node_modules`** — its online
build service runs `npm install` server-side. But the exported `main.js` does this
unconditionally, at the top of the file:

```js
require('@electron/remote/main').initialize();
```

So an assembled build with no `@electron/remote` starts and dies immediately. This was
found the hard way: the packager's own verification step caught it as
`uncaught: Cannot find module '@electron/remote/main'` rather than shipping a broken exe.

Vendoring these here is what keeps the tool portable — no npm, no network, no toolchain.

## What to put here

| Package | Needed when | Where to get it |
| :--- | :--- | :--- |
| `@electron/remote` | always | npm, pinned to `2.1.2` to match GDevelop's `package.json` |
| `steamworks.js` | `steam.enabled` is on | npm; also ships `steam_api64.dll`, which the packager lifts from `dist/win64/` |

Resulting layout:

```
vendor/node_modules/
├── @electron/
│   └── remote/
└── steamworks.js/
    └── dist/win64/steam_api64.dll
```

If the exported project already has one of these in its own `node_modules`, that copy
wins and the vendored one is ignored.

## Native ABI

`steamworks.js` contains a native `.node` binary compiled against a specific Node ABI. It
must match the Electron version in `runtime/`. If you take the Electron bump described in
the plan (§5.4), this has to be rebuilt — which is exactly why that bump is gated behind
the Steam integration tests.

## Not in git

This folder is gitignored. It holds third-party packages that belong to npm, not to this
repository.
