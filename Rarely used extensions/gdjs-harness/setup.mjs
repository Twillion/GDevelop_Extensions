/**
 * Copies the minimum GDJS runtime needed to boot a real 3D scene out of the locally installed
 * GDevelop, into ./runtime (gitignored).
 *
 * The point of this harness is that a hand-written mock of the engine cannot reproduce the things
 * that actually break extensions. The bug that cost several rounds on FluidAndWater3D — three.js
 * and PIXI sharing one WebGL context, so three's cached GL state goes stale when anything renders
 * outside GDevelop's own reset handshake — is invisible in a standalone three.js page and obvious
 * here.
 *
 * Run: node gdjs-harness/setup.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, 'runtime');

const CANDIDATE_ROOTS = [
  'C:/Users/chris/AppData/Local/Programs/GDevelop/resources/GDJS/Runtime',
  'C:/Program Files/GDevelop/resources/GDJS/Runtime',
  process.env.GDJS_RUNTIME || '',
].filter(Boolean);

const src = CANDIDATE_ROOTS.find((p) => fs.existsSync(path.join(p, 'runtimegame.js')));
if (!src) {
  console.error('Could not find an installed GDJS runtime. Tried:\n  ' + CANDIDATE_ROOTS.join('\n  '));
  console.error('Set GDJS_RUNTIME to your GDevelop .../resources/GDJS/Runtime folder.');
  process.exit(1);
}
console.log('GDJS runtime found at:\n  ' + src + '\n');

/**
 * Load order matters. `gd.js` installs the namespace and the class-registration helpers, the
 * libraries have to exist before the renderers touch them, and the object/behavior files register
 * themselves into gdjs at load time.
 */
export const FILES = [
  // Libraries first.
  'libs/jshashtable.js',
  'libs/rbush.js',
  'pixi-renderers/pixi.js',
  'pixi-renderers/three.js',
  'pixi-renderers/ThreeAddons.js',

  // Core namespace and helpers. logger.js MUST precede gd.js: gd.js constructs a Logger at load.
  'logger.js',
  'gd.js',
  'AsyncTasksManager.js',
  'libs/nanomarkdown.js',

  // Data model.
  'variable.js',
  'variablescontainer.js',
  'oncetriggers.js',
  'profiler.js',
  'force.js',
  'polygon.js',
  'affinetransformation.js',
  'timer.js',
  'timemanager.js',

  // Objects, behaviors, containers.
  'runtimebehavior.js',
  'runtimeobject.js',
  'RuntimeInstanceContainer.js',
  'RuntimeLayer.js',
  'layer.js',
  'RuntimeCustomObjectLayer.js',
  'runtimescene.js',
  'scenestack.js',
  'SpriteAnimator.js',
  'spriteruntimeobject.js',
  'CustomRuntimeObject.js',
  'CustomRuntimeObject2D.js',
  'CustomRuntimeObjectInstanceContainer.js',

  // Resources and game.
  'ResourceCache.js',
  'ResourceLoader.js',
  'ResourceManager.js',
  'jsonmanager.js',
  'Model3DManager.js',
  'inputmanager.js',
  // ResourceLoader's constructor builds ALL of these unconditionally, so none is optional even for
  // a scene with no sound, fonts or spine assets: SoundManager, FontManager, BitmapFontManager,
  // ImageManager, JsonManager, SpineManager, SpineAtlasManager.
  'howler-sound-manager/howler.min.js',
  'howler-sound-manager/howler-sound-manager.js',
  'fontfaceobserver-font-manager/fontfaceobserver.js',
  'fontfaceobserver-font-manager/fontfaceobserver-font-manager.js',
  'Extensions/Spine/managers/pixi-spine-manager.js',
  'Extensions/Spine/managers/pixi-spine-atlas-manager.js',
  'indexeddb.js',
  // runtimegame-pixi-renderer calls gdjs.evtTools.common.isMobile() while building the renderer.
  'events-tools/commontools.js',
  'events-tools/runtimescenetools.js',
  'events-tools/objecttools.js',
  'events-tools/cameratools.js',
  'capturemanager.js',
  'runtimewatermark.js',
  'runtimegame.js',

  // Renderers.
  'pixi-renderers/pixi-image-manager.js',
  'pixi-renderers/pixi-bitmapfont-manager.js',
  'pixi-renderers/pixi-filters-tools.js',
  'pixi-renderers/pixi-effects-manager.js',
  'pixi-renderers/loadingscreen-pixi-renderer.js',
  'pixi-renderers/runtimegame-pixi-renderer.js',
  'pixi-renderers/runtimescene-pixi-renderer.js',
  'pixi-renderers/layer-pixi-renderer.js',
  'pixi-renderers/RuntimeInstanceContainerPixiRenderer.js',
  'pixi-renderers/CustomRuntimeObject2DPixiRenderer.js',
  'pixi-renderers/spriteruntimeobject-pixi-renderer.js',
  'pixi-renderers/DebuggerPixiRenderer.js',

  // 3D: what an ocean actually needs.
  'Extensions/3D/A_RuntimeObject3D.js',
  'Extensions/3D/A_RuntimeObject3DRenderer.js',
  'Extensions/3D/Base3DBehavior.js',
  'Extensions/3D/Cube3DRuntimeObject.js',
  'Extensions/3D/Cube3DRuntimeObjectPixiRenderer.js',
  'Extensions/3D/CustomRuntimeObject3D.js',
  'Extensions/3D/CustomRuntimeObject3DRenderer.js',
  'Extensions/3D/Model3DRuntimeObject.js',
  'Extensions/3D/Model3DRuntimeObject3DRenderer.js',
  'Extensions/3D/HemisphereLight.js',
  // 3D Physics (Jolt)
  'Extensions/Physics3DBehavior/Physics3DTools.js',
  'Extensions/Physics3DBehavior/Physics3DRuntimeBehavior.js',
];

const EXTRA_ASSETS = [
  'Extensions/Physics3DBehavior/jolt-physics.wasm.js',
  'Extensions/Physics3DBehavior/jolt-physics.wasm.wasm',
];

if (process.argv[1] && process.argv[1].endsWith('setup.mjs')) {
  fs.rmSync(outDir, { recursive: true, force: true });
  let copied = 0, missing = [];
  for (const rel of [...FILES, ...EXTRA_ASSETS]) {
    const from = path.join(src, rel);
    if (!fs.existsSync(from)) { missing.push(rel); continue; }
    const to = path.join(outDir, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    copied++;
  }
  const present = FILES.filter((f) => !missing.includes(f));
  fs.writeFileSync(path.join(outDir, 'FILES.json'), JSON.stringify(present, null, 2));

  // A loader script, so the page and this list cannot drift apart.
  const loader = [
    '/* Generated by gdjs-harness/setup.mjs. Do not edit. */',
    'document.write(' + JSON.stringify(present),
    '  .map(function (f) { return "<scr" + "ipt src=\\"./runtime/" + f + "\\"></scr" + "ipt>"; })',
    '  .join(""));',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(outDir, 'load.js'), loader);

  const bytes = FILES.filter((f) => !missing.includes(f))
    .reduce((a, f) => a + fs.statSync(path.join(outDir, f)).size, 0);
  console.log(`Copied ${copied} files (${(bytes / 1048576).toFixed(1)} MB) into gdjs-harness/runtime/`);
  if (missing.length) {
    console.log('\nNot present in this GDevelop version (skipped):');
    for (const m of missing) console.log('  ' + m);
  }
  console.log('\nNext:  node gdjs-harness/serve.js   then open http://localhost:8140');
}
