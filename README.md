# Twillion's GDevelop Extensions

A collection of GDevelop extensions, runtime source code, tools, and experiments by Christopher Monhollen (**Twillion**).

## Main extensions

| Extension | Features | Import file |
| --- | --- | --- |
| [AdvancedLighting3D](AdvancedLighting3D/README.md) | Clustered dynamic 3D lighting, baked indirect light probes, and signed distance field soft shadows. | [AdvancedLighting3D.json](AdvancedLighting3D/AdvancedLighting3D.json) |
| [Material 3D](MaterialMaster/README.md) | Composable 3D material behaviors for PBR surfaces, glass, animation, patterns, wetness, shading, and mesh displacement. | [MaterialMaster.json](MaterialMaster/MaterialMaster.json) |
| [Weather FX 2D](WeatherFX2D/README.md) | Snow, rain, fog, embers, water rings, heat effects, underwater distortion, and other screen effects. | [WeatherFX2D.json](WeatherFX2D/WeatherFX2D.json) |

## Using an extension

1. Download this repository or the extension's JSON file from the table above. When downloading an individual file on GitHub, use its raw file download.
2. Open your GDevelop project and import the JSON file through the Functions/Behaviors extension manager.
3. Follow the extension's README to add its behaviors or actions and configure your scene.
4. Preview your project to check the result.

Read each extension's documentation for renderer requirements and setup details. AdvancedLighting3D targets GDevelop 5's Three.js WebGL2 backend.

## More extensions and experiments

The [Rarely used extensions](Rarely%20used%20extensions/) folder contains additional extensions, prototypes, implementation plans, and supporting tools. These include camera tools, post-processing, water and fluid effects, mesh tools, MIDI playback, and a GDevelop runtime test harness.

Read each folder's documentation before using it: some entries are plans or experiments rather than ready-to-import extensions.

Repository planning documents:

- [Extension audit](EXTENSION-AUDIT.md)
- [Explored extension possibilities](Extension-explored-possibilities-list.md)
- [Material consolidation plan](MATERIAL-CONSOLIDATION-PLAN.md)

## Working on the source

Build and test scripts use Node.js. Run commands from the repository root. For example:

```sh
node AdvancedLighting3D/build-extension.mjs
node AdvancedLighting3D/test-runtime.mjs

node MaterialMaster/build-extension.mjs
node MaterialMaster/test-materialmaster.mjs

node WeatherFX2D/build-extension.mjs
node WeatherFX2D/build-api-reference.mjs
node WeatherFX2D/test-runtime.mjs
node WeatherFX2D/test-ui.mjs
node WeatherFX2D/check-shaders.mjs
```

For extensions with build scripts, edit their runtime source and declarations, then rebuild the importable JSON. Consult the individual README for the source layout and any additional validation steps.

Runtime tests and static shader checks cover only part of the behavior; preview rendering changes in GDevelop as well.

## Attribution and licensing

Check each extension's metadata, documentation, and included license files for its applicable license and third-party attribution.
