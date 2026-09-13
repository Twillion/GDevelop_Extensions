# WGLEXE Packager

A portable Windows application that turns a GDevelop 5 "Electron Build" export into a
configured, Steam-ready executable — with GPU switches, `SharedArrayBuffer`, Steam overlay
support and window options set from a checkbox screen rather than a config file.

Full reasoning, and the research behind every default, is in
[ARCHITECTURE_AND_IMPLEMENTATION_PLAN.md](ARCHITECTURE_AND_IMPLEMENTATION_PLAN.md).

## How it works

GDevelop's local export produces an Electron **project**, not an executable — the online
build service runs `electron-builder` to make the exe. Rather than requiring that
toolchain, this tool **assembles**: it copies a bundled Electron runtime, drops the game
into `resources/app/`, patches `main.js` at named anchors, renames and brands the exe, and
then **runs the result once to verify it** before reporting success.

No Node, no npm, no build step, nothing written outside this folder.

## Layout

```
WGLEXE_Packager/
├── packager/            the application
│   ├── core/            all packaging logic — survives a shell rewrite
│   ├── renderer/        the GUI
│   └── cli.js           headless entry point (plain Node, no Electron)
├── patches/             patch anchors and templates, as data
├── presets/             Steam (default), Browser build
├── runtime/             the bundled Electron template   — see runtime/README.md
├── vendor/node_modules/ @electron/remote, steamworks.js — see vendor/README.md
└── tools/               optional rcedit.exe             — see tools/README.md
```

`runtime/`, `vendor/` and `tools/` are gitignored: they hold third-party binaries.
Populate them once, following each README, before first use.

## Building the application

```bash
node build-portable.js
```

Produces `dist/WGLEXE Packager/WGLEXEPackager.exe` — a real desktop application, about
274 MB. Copy the folder anywhere and run it. Nothing is installed, and nothing is written
outside the folder: settings, presets and even Chromium's own profile live inside it.

The tool is built the same way it builds games — copy an Electron distribution, drop the
app into `resources/app/`, rename the executable. It also **uses its own Electron
distribution as the ship template**, so it carries one copy rather than two. Which files
belong to Electron is recorded in `electron-manifest.json` at build time, never guessed,
because a wrong guess would ship the packager's own settings inside someone's game.

Pass `--with-runtime` to ship a separate template as well. That is only needed when games
should run on a different Electron than the tool itself does (plan §5.4).

## Running from source

```bash
cd packager && npm install && npm start
```

## Running headless

The core needs no Electron, so everything is testable from plain Node:

```bash
node packager/cli.js check --source <exported-project>
```

```bash
node packager/cli.js patch --source <exported-project> --out /tmp/main.patched.js
```

```bash
node packager/cli.js package --source <exported-project> --output <depot-folder>
```

`patch` is a dry run — it prints the patched `main.js` and touches nothing else. It is the
quickest way to see exactly what the tool injects.

## Verified behaviour

Both `SharedArrayBuffer` modes have been assembled and run end to end against a real
GDevelop `main.js`:

| Mode | Origin | `SharedArrayBuffer` | `crossOriginIsolated` |
| :--- | :--- | :--- | :--- |
| `flag` (default) | `file://` | yes | no |
| `isolation` | `game://app/` | yes | yes |

In both, the Steam Input gamepad fix survives the switch merge and `--in-process-gpu` is
applied when Steam overlay support is on.

## Two rules the Settings screen must keep

1. **Every toggle that trades stability for speed states its failure mode inline.** The
   research behind this tool is worthless if the UI hides it behind a friendly label.
2. **Defaults are the safe column.** Ticking nothing produces a correct Steam build, and
   no warnings.

`packager/renderer/preview.html` opens the Settings screen in an ordinary browser with a
stubbed bridge, so both rules can be checked without building anything. It also documents
the `window.wglexe` contract a future C# or C++ shell would have to satisfy.

## Adding a setting

Edit `packager/core/schema.js`. That is the whole change: defaults, validation, the
runtime config written next to `main.js`, and the Settings screen all derive from it.
