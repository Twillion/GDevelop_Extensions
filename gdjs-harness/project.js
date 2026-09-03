/**
 * A minimal but REAL gdjs.projectData: 3D layer, 3D objects, and configured instances.
 *
 * Shapes follow Runtime-sources/types/project-data.d.ts from the installed GDevelop, so the engine
 * consumes it exactly as it would an exported game. Edit HARNESS_CONFIG below (or pass ?w=&h=&d=
 * in the URL) to reproduce a specific scene.
 */
var HARNESS_CONFIG = (function () {
  var q = new URLSearchParams(location.search);
  var num = function (key, dflt) {
    var v = parseFloat(q.get(key));
    return isFinite(v) ? v : dflt;
  };
  return {
    // The water volume, matching a real instance in the editor.
    width: num('w', 3150),
    height: num('h', 3416),
    depth: num('d', 100),
    x: num('x', 0),
    y: num('y', 0),
    z: num('z', 0),
    // Which scenario module to run once the scene is up.
    scenario: q.get('scenario') || 'ocean',
  };
})();

var gdjs = gdjs || {};

function createCubeContent(w, h, d, color, matType) {
  return {
    width: w || 100,
    height: h || 100,
    depth: d || 100,
    enableTextureOnFaceFront: false,
    enableTextureOnFaceBack: false,
    enableTextureOnFaceLeft: false,
    enableTextureOnFaceRight: false,
    enableTextureOnFaceTop: false,
    enableTextureOnFaceBottom: false,
    faceUpTexture: '',
    faceDownTexture: '',
    faceLeftTexture: '',
    faceRightTexture: '',
    faceFrontTexture: '',
    faceBackTexture: '',
    backFaceUpThroughWhichAxisRotation: 'X',
    facesOrientation: 'Y',
    materialType: matType || 'Standard',
    tint: color || '255;255;255',
  };
}

gdjs.projectData = {
  firstLayout: 'Scene',
  gdVersion: { build: 0, major: 5, minor: 0, revision: 0 },
  properties: {
    adaptGameResolutionAtRuntime: true,
    folderProject: false,
    orientation: 'landscape',
    packageName: 'com.harness.gdjs',
    projectFile: '',
    scaleMode: 'linear',
    pixelsRounding: false,
    antialiasingMode: 'MSAA',
    antialisingEnabledOnMobile: false,
    sizeOnStartupMode: '',
    version: '1.0.0',
    name: 'GDJS Harness',
    author: 'Twillion',
    authorIds: [],
    authorUsernames: [],
    windowWidth: 1024,
    windowHeight: 576,
    latestCompilationDirectory: '',
    maxFPS: 60,
    minFPS: 10,
    verticalSync: false,
    loadingScreen: {
      showGDevelopSplash: false,
      gdevelopLogoStyle: 'light',
      backgroundImageResourceName: '',
      backgroundColor: 0,
      backgroundFadeInDuration: 0,
      minDuration: 0,
      logoAndProgressFadeInDuration: 0,
      logoAndProgressLogoFadeInDelay: 0,
      showProgressBar: false,
      progressBarMinWidth: 0,
      progressBarMaxWidth: 0,
      progressBarWidthPercent: 0,
      progressBarHeight: 0,
      progressBarColor: 16777215,
    },
    watermark: { showWatermark: false, placement: 'bottom-left' },
    useDeprecatedZeroAsDefaultZOrder: false,
    projectUuid: 'harness',
    extensionProperties: [],
  },
  resources: { resources: [] },
  usedResources: [],
  objects: [
    {
      name: 'Ocean',
      type: 'Scene3D::Cube3DObject',
      variables: [],
      behaviors: [],
      effects: [],
      content: createCubeContent(100, 100, 100, '255;255;255', 'Basic'),
    },
    {
      name: 'Boat',
      type: 'Scene3D::Cube3DObject',
      variables: [],
      behaviors: [
        {
          name: 'Physics3D',
          type: 'Physics3D::Physics3DBehavior',
          bodyType: 'Dynamic',
          bullet: false,
          fixedRotation: false,
          shape: 'Box',
          shapeOrientation: 'Z',
          shapeDimensionA: 0,
          shapeDimensionB: 0,
          shapeDimensionC: 0,
          density: 1,
          friction: 0.3,
          restitution: 0.1,
          linearDamping: 0.1,
          angularDamping: 0.1,
          gravityScale: 1,
          layers: 1,
          masks: 1,
          massCenterOffsetX: 0,
          massCenterOffsetY: 0,
          massCenterOffsetZ: 0,
        },
      ],
      effects: [],
      content: createCubeContent(120, 200, 60, '180;100;40', 'Standard'),
    },
    {
      name: 'Bottle',
      type: 'Scene3D::Cube3DObject',
      variables: [],
      behaviors: [],
      effects: [],
      content: createCubeContent(40, 40, 80, '100;180;255', 'Standard'),
    },
    {
      name: 'Cauldron',
      type: 'Scene3D::Cube3DObject',
      variables: [],
      behaviors: [],
      effects: [],
      content: createCubeContent(150, 150, 100, '50;50;60', 'Standard'),
    },
    {
      name: 'Ground',
      type: 'Scene3D::Cube3DObject',
      variables: [],
      behaviors: [],
      effects: [],
      content: createCubeContent(2000, 2000, 20, '120;120;120', 'Standard'),
    },
    {
      name: 'TargetCube',
      type: 'Scene3D::Cube3DObject',
      variables: [],
      behaviors: [],
      effects: [],
      content: createCubeContent(80, 80, 80, '220;60;60', 'Standard'),
    },
    {
      name: 'Crate',
      type: 'Scene3D::Cube3DObject',
      variables: [],
      behaviors: [
        {
          name: 'Physics3D',
          type: 'Physics3D::Physics3DBehavior',
          bodyType: 'Dynamic',
          bullet: false,
          fixedRotation: false,
          shape: 'Box',
          shapeOrientation: 'Z',
          shapeDimensionA: 0,
          shapeDimensionB: 0,
          shapeDimensionC: 0,
          density: 1,
          friction: 0.3,
          restitution: 0.1,
          linearDamping: 0.1,
          angularDamping: 0.1,
          gravityScale: 1,
          layers: 1,
          masks: 1,
          massCenterOffsetX: 0,
          massCenterOffsetY: 0,
          massCenterOffsetZ: 0,
        },
      ],
      effects: [],
      content: createCubeContent(50, 50, 50, '210;150;70', 'Standard'),
    },
  ],
  variables: [],
  layouts: [
    {
      r: 232,
      v: 234,
      b: 236,
      mangledName: 'Scene',
      name: 'Scene',
      stopSoundsOnStartup: true,
      title: '',
      behaviorsSharedData: [
        {
          name: 'Physics3D',
          type: 'Physics3D::Physics3DBehavior',
          // GDevelop 3D is Z-up, so gravity runs down -Z. worldScale is the px-per-metre the
          // extension's UnitsPerMetre must agree with.
          gravityX: 0,
          gravityY: 0,
          gravityZ: -9.8,
          worldScale: 100,
        },
      ],
      objects: [],
      layers: [
        {
          name: '',
          renderingType: '3d',
          cameraType: 'perspective',
          visibility: true,
          cameras: [{ defaultSize: true, defaultViewport: true, height: 0, viewportBottom: 1, viewportLeft: 0, viewportRight: 1, viewportTop: 0, width: 0 }],
          effects: [],
          ambientLightColorR: 200,
          ambientLightColorG: 200,
          ambientLightColorB: 200,
          camera3DFieldOfView: 45,
          camera3DFarPlaneDistance: 300000,
          camera3DNearPlaneDistance: 3,
          isLightingLayer: false,
          followBaseLayerCamera: false,
        },
      ],
      instances: [
        {
          angle: 0,
          customSize: true,
          height: HARNESS_CONFIG.height,
          layer: '',
          name: 'Ocean',
          persistentUuid: 'ocean-instance',
          width: HARNESS_CONFIG.width,
          depth: HARNESS_CONFIG.depth,
          x: HARNESS_CONFIG.x,
          y: HARNESS_CONFIG.y,
          z: HARNESS_CONFIG.z,
          zOrder: 1,
          numberProperties: [],
          stringProperties: [],
          initialVariables: [],
        },
      ],
      variables: [],
      usedResources: [],
      uiSettings: {
        grid: false, gridType: 'rectangular', gridWidth: 32, gridHeight: 32,
        gridOffsetX: 0, gridOffsetY: 0, gridColor: 0, gridAlpha: 0,
        snap: false, zoomFactor: 1, windowMask: false,
      },
    },
  ],
  externalLayouts: [],
  eventsFunctionsExtensions: [],
};

/** GDevelop generates one of these per scene from its events. Ours has no events. */
gdjs.SceneCode = {
  func: function (runtimeScene) { return; },
};
gdjs.projectData.layouts[0].mangledName = 'Scene';
