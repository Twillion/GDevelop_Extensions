# tools/

Optional helpers the Electron build of the packager shells out to.

## rcedit.exe

Stamps the icon and version resources into the produced executable. Download the x64
build from <https://github.com/electron/rcedit/releases> and place `rcedit.exe` here.

This is the same tool `electron-builder` uses internally for the same job.

**If it is absent the packager still works** — it reports the step as skipped and the
executable keeps Electron's default icon and version strings. Nothing else is affected.

A future C# build of the packager calls `BeginUpdateResource` / `UpdateResource` /
`EndUpdateResource` directly and this folder disappears entirely (plan §5.7).
