# Extension folder audit — 2026-08-28

> **Update 2026-09-11:** the blueprint-only folders `CascadedShadowMaps3D/`, `MeshDeformation3D/`
> and `StableShadowAnchor3D/` have since been deleted. The CSM math and API reference was folded
> into Appendix A of
> [`AdvancedLighting3D/SHADOW_SELECTOR_IMPLEMENTATION_PLAN.md`](../AdvancedLighting3D/SHADOW_SELECTOR_IMPLEMENTATION_PLAN.md).
> `ClusteredDetail/` is the only blueprint-only folder still present. The body below is kept as the
> record of what was true on 2026-08-28 and is not edited to match.

A review of every top-level folder: what it is, whether it works, and a proposed disposition.
**Nothing has been moved, renamed or deleted.** This is a plan only. Other agents are working in
`AutoMeshLOD3D/`, `CameraTweens3d/`, `CascadedShadowMaps3D/`, `AdvancedLighting3D/`,
`ExternalSkeletalAnimator3D/`, `InGameCamera3D/`, `MeshDeformation3D/`,
`MidiSynthPlayer/` and `WGLEXE_Packager/` right now — none of those are proposed for deletion.

How the verdicts were reached: every `.json` was parsed and checked for the three failure modes
recorded in `AnimatedPBR3D/REVIEW.md` — the `properties` vs `propertyDescriptors` key, NUL-byte
truncation, and `behavior`/`return` scope errors in JsCode. Duplicate files were compared by
normalised JSON content, not by byte hash, so formatting-only differences are reported as identical.

---

## 1. Broken — needs a fix before it is used or shipped again

| Folder / file | Problem | Disposition |
| :--- | :--- | :--- |
| `SoftBody3D/SoftBody3D.json` (v1.0.1) | Its 24 behavior properties sit under the JSON key `properties`. GDevelop's serializer only reads `propertyDescriptors`, so **no properties exist at runtime** and every `_get<Name>()` accessor is undefined. This is the exact bug that made AnimatedPBR3D 1.0.0 never run. | **Salvage.** One-key rename plus a rebuild, then verify in GDevelop. The same broken file is also published in `Twillion-s-Extensions/extensions/`. |
| `Twillion-s-Extensions/extensions/Advanced3DMaterial.json` (v1.0.0) | Same `properties` key bug, 27 properties affected. Worse: **there is no source folder for it anywhere in this repo** — the published JSON is the only copy. | **Salvage or retire.** Decide first whether it is still wanted given three other material extensions exist (§3). If yes, it needs a home folder and the key fix. If no, drop it from the published set. |

Both are currently **published as working** in `Twillion-s-Extensions/`. That is the most urgent item
here — anyone downloading them gets an extension whose settings do nothing.

---

## 2. Publish folder out of sync — RESOLVED 2026-08-28

> **Framing correction.** An earlier draft treated `Twillion-s-Extensions/` as a live distribution
> channel and weighed changes against "what downloaders would get". That is wrong: **extensions are
> released on itch.io; this git repo is a personal record.** Nothing here is withdrawn from or pushed
> to users by editing it. That removes the only objection to syncing the folder, and it also means
> superseded release artifacts (the old `.zip`s) are *records worth keeping*, not clutter — see §5.

All eight extensions that exist in both a working folder and the publish folder are now
**byte-identical**. What had drifted:

- **3DCRT+ is stale.** Published `3DCRTplus.json` is **v0.6.0** (51 properties, 74 functions); the
  working `3d CRT PLUS/3DCRTplus.json` is **v1.0.0** (43 properties, 60 functions — the 1.0.0 release
  deliberately dropped bloom/brightness/saturation/contrast). Downloaders are getting the old build.
- **YAxisPhysicsCharacter3D is stale.** Both claim v2.0.20, but the working copy has **15**
  properties to the published copy's **14**, and four JsCode blocks differ. The version was never
  bumped, so nothing signals the drift.
- **MidiSynthPlayer was published without being listed.** `extensions/MidiSynthPlayer.json` exists
  (untracked, identical to the working folder) but the README table does not mention it — and it has
  no `REVIEW.md` and is still marked "Complete Blueprint" in the possibilities list. It may have been
  published before verification.
- **Identical, no action:** AdvancedMaterials, BRDFMaterials, GamePostProcess3D, ExtrudedSprite3D
  0.3.3/0.3.4/0.3.5 all match their working copies content-for-content.

**Done.** 3DCRT+ (now v1.0.0), YAxis and ExtrudedSprite3D (now v0.3.6) were re-exported; the README
table was rebuilt with a version column, MidiSynthPlayer added to it, and `SoftBody3D` /
`Advanced3DMaterial` moved to a **Known broken** section so the record does not present them as
usable. All eight pairs verified byte-identical afterwards.

**Still worth doing:** a one-line sync check, so this cannot drift silently again. The root cause in
both drifted cases was the same — **the version string was not bumped when the file changed**, so
nothing signalled the divergence.

---

## 3. Overlapping extensions — four of them cover the same ground

There are now four material extensions with substantial overlap:

| Extension | Version | State |
| :--- | :---: | :--- |
| `AnimatedPBR3D` | 2.0.0 | Newest, actively maintained, has a review, 47 properties. Superset of the others in ambition (PBR maps + UV scroll + flipbook + video). |
| `AdvancedMaterials` | 1.3.1 | Published, works. 15 properties. |
| `BRDF_Materials3D extension` | 3.2.0 | Published, works. 13 properties. |
| `Advanced3DMaterial` | 1.0.0 | Broken (§1), no source folder. |

**Disposition — consolidate, don't delete yet.** AnimatedPBR3D 2.0.0 is the natural successor. Before
retiring anything, list what AdvancedMaterials and BRDF do that AnimatedPBR3D does not; those are
published extensions with users, so they should be *deprecated with a pointer*, not removed. The one
clear call is `Advanced3DMaterial`: broken, sourceless, and fully covered by the other three.

Two smaller overlaps, **both resolved by deletion on 2026-08-28** (see §4):
`Custom3DShaderBackend`'s CRT pass was superseded by 3DCRT+ 1.0.0, and `VolumetricFog` is superseded
by `AdvancedLighting3D`'s clustered volumetric fog.

---

## 4. Rarely used — DELETED 2026-08-28

Four small, narrow or superseded extensions were removed at the maintainer's instruction rather than
being filed into `tools/`. All parsed clean and used the correct property key; they
were simply not worth keeping.

| Folder | Was | Why removed |
| :--- | :--- | :--- |
| `ThreeJsTweaks` | v0.1.0, 8.6 KB, 6 properties | Renderer shadow-map type and tone mapping. To be superseded by `CascadedShadowMaps3D`. |
| `TweenLightRadius` | v1.1.1 | Tweened a 2D light object's radius — unrelated to the 3D line of work. |
| `VolumetricFog` | v0.1.0, debug `console.log` still in runtime | Superseded by `AdvancedLighting3D`. |
| `Custom3DShaderBackend` | v0.1.0, 17 functions | CRT half superseded by 3DCRT+ 1.0.0. |

All ten files were committed and unmodified at deletion, so `git checkout <commit> -- <folder>`
restores any of them. None were part of the published `Twillion-s-Extensions/` set, so no downloadable
extension was withdrawn.

Two documentation references now point at folders that no longer exist — both are prose citations,
not build dependencies: `AnimatedPBR3D/REVIEW.md:28,46` cites VolumetricFog and ThreeJsTweaks as
examples of correct `propertyDescriptors` / `extraInformation` usage, and
`ExternalSkeletalAnimator3D/PLAN.md:364,371` cites VolumetricFog and Custom3DShaderBackend as the
build-script precedent. Worth a footnote in each if those docs are revised.

`tools/` is now empty with no candidates. Either drop the folder or hold it for
future demotions — `InGameCamera3D` (prototype) is the likeliest next occupant if it stalls.

---

## 5. Version clutter to prune inside folders

`ExtrudedSprite3D/` holds four files: `v0.3.3`, `v0.3.4`, `v0.3.5`, and `ExtrudedSprite3D.json`.
The publish folder mirrors three of them. That is ~860 KB of the same extension four times.

**Correction to an earlier draft of this audit:** `ExtrudedSprite3D.json` is *not* byte-identical to
`ExtrudedSprite3D-v0.3.5.json`. It is 51 KB larger. Both declare **v0.3.5**, both carry the same two
behaviors and one object, and their 31 runtime code blocks are identical apart from trailing
newlines — but their **metadata has diverged in both directions**:

| Field | `ExtrudedSprite3D.json` | `ExtrudedSprite3D-v0.3.5.json` |
| :--- | :--- | :--- |
| `category` | `General` | `3D` |
| `author` | *(empty)* | `Twillion` |
| `iconUrl`, `previewIconUrl`, `helpPath`, `objectType` | present | **absent** |
| function `sentence` fields | present on 5 functions | **absent** |
| property / function `group` fields | absent | **present** |
| `inlineCode` serialization | mixed list/string | mixed list/string |

**Neither is a superset of the other**, so this is not a delete-one situation. The suffixed file has
the correct category and author; the unsuffixed one has the icons, help path and action sentences
that GDevelop shows in the editor. They need to be merged into a single v0.3.6 before either is
discarded, and the version bumped so the divergence cannot recur silently.

Same-version-different-content also affects `YAxisPhysicsCharacter3D` (§2). Two instances of the same
failure mode: **the version string is not being bumped when the file changes.**

**Revised:** `3d CRT PLUS/3d_CRT_Twillion_V0_5_0.zip` was listed here as a superseded artifact to
delete. Given that this repo is a **personal record** and releases go out on itch.io, an old release
zip is exactly the kind of thing the record should hold — it is the only copy of what v0.5.0 actually
shipped as. **Keep it.** Same reasoning applies to any future superseded release zip.

---

## 6. Dead files

| File | Finding |
| :--- | :--- |
| `CustomRuntimeObject/CustomRuntimeObject.ts` | **34 bytes containing the text `404: Not Found`.** A download that failed and was saved anyway. Delete. |
| `CustomRuntimeObject/CustomRuntimeObject3D.ts`, `…3DRenderer.ts` | Real GDevelop engine source (UTF-16), kept as reference. Fine to keep — but they belong with the other reference material (§7), not in a folder that looks like an extension. |

---

## 7. Not extensions — reference material and tooling

These sit alongside the extensions but are a different kind of thing, which is part of why the folder
feels cluttered:

| Folder | What it actually is |
| :--- | :--- |
| `Advanced/webgpu+Dependent Extensions/` | One 16 KB markdown API note. |
| `Webgpu_Advanced_Lightning/` | One WGSL shader template `.txt`. |
| `Library for building Gdevelop extensions/` | Extension catalog markdown + `gdevelop-mcp-0.21.0.zip` tooling. |
| `CustomRuntimeObject/` | GDevelop engine source copies (see §6). |

**Disposition:** gather under a single `_reference/` folder. Four folders collapse to one, and
nothing that looks like an extension is actually a text file any more.

### `WGLEXE_Packager/` — the elephant

Not an extension at all: it is a standalone Electron app that packages GDevelop exports into
Steam-ready executables. **It is 548 MB** — 273 MB of `node_modules`, 265 MB of bundled Electron
runtime. Its own `.gitignore` correctly excludes both, so committing it would not bloat git history,
but it dominates the working tree and any folder-level backup or search.

**Disposition:** it wants its own repository. Since it is under active development right now, leave
it alone and revisit when that work settles. Do not delete — the bundled runtime is a deliberate
design choice documented in its README, not accidental cruft.

---

## 8. Blueprint-only — no code yet

`CascadedShadowMaps3D/` and `MeshDeformation3D/` contain README + IMPLEMENTATION_PLAN + API_REFERENCE
and **no `.json` and no `.runtime.js`**. They are designs, not extensions. That is fine — but they
read as shipped extensions at a glance because the READMEs are written in the present tense
("**replaces** GDevelop's single, blurry directional shadow map").

**Disposition:** keep, and add a one-line status banner at the top of each README the way
`InGameCamera3D` and `ExternalSkeletalAnimator3D` already do. Consider a `_planned/` prefix or folder
so the top-level listing distinguishes design from code.

Related: `Extension-explored-possibilities-list.md` is stale. It marks `AutoMeshLOD3D`,
`LightProbeGrid3D`, `AdvancedLighting3D` and `MidiSynthPlayer` as "Complete Blueprint" when all
four now have built JSON and runtimes. `LightProbeGrid3D` no longer exists as a separate folder at
all — see the consolidation note below.

---

## 9. Verification status of the active work

Not a disposition question, but the thing that determines what is safe to publish:

| Extension | Verified in GDevelop? |
| :--- | :--- |
| `CameraTweens3d` | `REVIEW.md`: build reproduces byte-for-byte, all 7 test phases pass, findings measured in a Node harness. Not stated as run in-engine. |
| `AutoMeshLOD3D` | `REVIEW.md` states plainly: **"Nothing has been run inside GDevelop yet."** Open findings remain. |
| `ExternalSkeletalAnimator3D` | README lists bone sockets, `Drive object` root motion and skeleton layers as **not verified in-engine**. |
| `InGameCamera3D` | Self-described prototype, v0.3.0. |
| `AdvancedLighting3D` | No `REVIEW.md`. Carries the former `LightProbeGrid3D` since 2.0.0; 11 unit tests pass in a Node harness, nothing run in-engine yet. |
| `MidiSynthPlayer` | No `REVIEW.md` — **yet already copied into the publish folder** (§2). |

The JSON sizes that prompted this note are fixed. `AdvancedLighting3D.json` now holds both
extensions' worth of functions in **509 KB**, because the runtime is installed once from an
`onSceneLoaded` extension lifecycle function instead of being embedded in every JsCode block. Any
other extension in this repo using the embed-per-block pattern can do the same.

---

## Consolidation: Advanced Lighting (2026-08-29)

**Renamed.** The merged extension is now `AdvancedLighting3D/` (display name "Advanced Lighting 3D",
namespace `gdjs.__advancedLighting3D`). Earlier entries in this document that predate 2026-08-29 have
been updated to the new name for working links; the folder was called `ClusteredLightManager3D/`
at the time those verdicts were reached.

`LightProbeGrid3D/` was **merged into `AdvancedLighting3D/` and deleted**. The two are now one
"Advanced Lighting" extension covering both halves of a scene's lighting: clustered forward dynamic
lights (direct) and baked probe-grid GI (indirect).

They could not safely coexist as separate extensions. Both injected into `lights_fragment_begin` on
the same shared materials and both overrode `customProgramCacheKey` with a constant, so Three could
hand a material the other one's compiled program — silently, because a broken 3D shader in GDevelop
renders unlit rather than erroring. Merged, there is one injection, one cache key
(`GD_ADVLIGHT3D_V1|CL1|G3D<0|1>|LP<0|1>`) and one post-events tick.

The probe design record survives as `AdvancedLighting3D/PROBE_IMPLEMENTATION_PLAN.md`. The
deleted files are recoverable with `git checkout <commit> -- LightProbeGrid3D`.

---

## Current shape — restructured 2026-08-28

At the maintainer's instruction, **all 23 remaining folders were moved into
`tools/`**, to be promoted back to the root individually as each one proves it is
still in use. The root now holds only markdown and dotfiles.

```
GDevelop_Extensions/
├── EXTENSION-AUDIT.md
├── Extension-explored-possibilities-list.md
├── .gitignore  .fold11_icon.ico  .claude/
└── tools/       ← all 23 folders, awaiting promotion by use
```

The folder name is now a staging area rather than a judgement — the extensions inside it are not all
rarely used, they are simply unsorted. **Consider renaming it** (`_unsorted/`, `_staging/`) so it does
not read as a verdict on `Twillion-s-Extensions/` or the active project folders.

Three things to know about this layout:

- **`Twillion-s-Extensions/`** — the published distribution repo — is now nested one level deeper. Any
  external clone path, publish script or bookmark pointing at the old location needs updating.
- **Ten folders were under active development when this ran**, five of them written to within
  ~1.5 hours (`CameraTweens3d` 34 minutes prior). Any agent or editor holding a path to the old
  location will fail or silently recreate an empty folder at the root. All 23 moves succeeded, so no
  file was locked at the moment of the move, but processes started *before* it still hold stale paths.
- **Git sees this as 38 deletions plus an untracked tree**, not renames, until it is committed. Nothing
  is lost — every tracked file was verified present at its new path — but the working tree is a large
  uncommitted change.

### Where things should end up

As folders get promoted back out, the shape worth aiming for:

| Destination | Contents |
| :--- | :--- |
| Root | `Twillion-s-Extensions/` (published set, re-synced per §2) |
| Root | Active extensions, one folder each, as each proves it is in use |
| `_reference/` | `Advanced`, `Webgpu_Advanced_Lightning`, `Library for building…`, `CustomRuntimeObject` (§7) |
| `_planned/` | `CascadedShadowMaps3D`, `MeshDeformation3D` — blueprint-only, status banners added (§8) |
| Own repo | `WGLEXE_Packager` — 548 MB, not an extension (§7) |

## Suggested order of work

1. Fix the `properties` → `propertyDescriptors` key in `SoftBody3D` and decide `Advanced3DMaterial`'s
   fate. These are shipping broken today.
2. Re-sync 3DCRT+ and YAxis into `Twillion-s-Extensions/`, fix the README table.
3. Prune duplicate `ExtrudedSprite3D` versions and the superseded CRT zip.
4. Delete `CustomRuntimeObject/CustomRuntimeObject.ts` (the 404 file).
5. Refresh `Extension-explored-possibilities-list.md` statuses.
6. Sort into `_reference/` — **last**, and only after grepping for path references, so it does not
   collide with the agents currently working in this folder.

**Done 2026-08-28:** step 6's demotion half — `ThreeJsTweaks`, `TweenLightRadius`, `VolumetricFog`
and `Custom3DShaderBackend` deleted outright instead of being filed (§4). Then all 23 remaining
folders were moved into `tools/` for promotion-by-use. Both the deletions and the
move are in the working tree but **not committed**.

Note that steps 1–5 now operate on paths inside `tools/`. The `SoftBody3D` and
`Advanced3DMaterial` property-key bugs (§1) and the stale 3DCRT+ / YAxis publish copies (§2) are
still outstanding and unaffected by the reorganisation.
