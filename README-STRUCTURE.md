# Repository layout

Extensions are filed under the category each one declares in its own `.json` (`category` field),
matching the categories GDevelop itself uses in the extension browser. Nothing is filed by how
often it gets used — the previous "Rarely used extensions" folder said nothing about what was
inside it, and buried actively-developed extensions next to research notes.

| Folder | Holds |
| :--- | :--- |
| `3D/` | AdvancedLighting3D, MaterialMaster, CinematicPostFX3D, AnimatedPBR3D, CameraTweens3d, ClusteredDetail, ExternalSkeletalAnimator3D, FluidAndWater3D, InGameCamera3D, Polygon3D, AutoMeshLOD3D, FloatingOrigin3D, WorldPartition3D |
| `Visual effect/` | AdvancedWeather3D, WeatherFX2D, 3d CRT PLUS |
| `Movement/` | NavMesh3D |
| `Audio/` | MidiSynthPlayer |
| `General/` | DeformableIngot3D, Portal3D |
| `tools/` | `gdjs-harness` (the GDJS runtime every WebGL test boots), WGLEXE_Packager, multi-extension-workspace |
| `reference/` | CustomRuntimeObject (GDevelop source excerpts), GDevelop extension library, SeaOfThieves_TechArt research |
| `published/` | Released extension bundle |
| `demos/` | Benchmark scenes and the Phase 0 measurement harness |
| `docs/` | Plans and audits |

## If you move an extension between categories

Tests reach the shared GDJS runtime by a path relative to the repo root, so a move changes two
things and both must be updated together:

1. The **repo-root walk**: an extension at `<Category>/<Name>/` is two levels down, so tests use
   `path.resolve(here, '../..')`, not `'..'`.
2. Any **repo-root-relative join** to another extension — `path.join(repoRoot, '3D/MaterialMaster/…')`.
   References to a sibling inside the same category stay as `../Sibling/…` and need no change.

Both were missed on the first pass of this reorganisation and showed up as `ENOENT` on
`ShaderChain.runtime.js`. Run the WebGL suites after any move; the Node-only ones pass regardless
because they resolve fewer paths.
