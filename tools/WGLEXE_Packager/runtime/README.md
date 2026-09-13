# runtime/

This folder holds the **Electron runtime template** — the prebuilt Electron distribution
the packager copies and patches to produce a game executable. Bundling it here is what
makes the tool work offline, on any machine, with no Node or npm installed.

It is empty in the repository because a checked-in ~180 MB binary tree does not belong in
git. Populate it once:

```bash
curl -L -o electron.zip https://github.com/electron/electron/releases/download/v32.3.3/electron-v32.3.3-win32-x64.zip
```

Unzip it so the layout is:

```
runtime/
└── electron-v32.3.3-win32-x64/
    ├── electron.exe
    ├── resources/
    ├── *.dll, *.pak, ...
```

The packager picks the first subdirectory it finds, so keep exactly one version here
unless you are deliberately testing the Electron bump described in the plan (§5.4).

## Why this version

`32.3.3` is the Electron that GDevelop's own export pins (`Runtime/Electron/package.json`),
so it is the version GDevelop has tested its runtime against. Matching it is the whole
point — see plan §5.4 before changing it.

## Distributing the tool

When you ship WGLEXE Packager to someone else, include this folder populated. That is the
"bundled in the app" choice: larger download, works with no network, ever.
