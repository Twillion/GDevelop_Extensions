(function () {
  if (typeof gdjs === 'undefined') return;
  if (gdjs.__fluidAndWater3D) return; // Singleton installation

  var THREE_OK = typeof THREE !== 'undefined';
  var GRAVITY = 9.81;

  /* ------------------------------------------------------------- Math & Helpers */

  function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  }

  function saturate(val) {
    return Math.max(0.0, Math.min(1.0, val));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function parseColor(input, fallback) {
    if (Array.isArray(input)) return input;
    if (typeof input === 'number') {
      return [(input >> 16) & 255, (input >> 8) & 255, input & 255];
    }
    if (typeof input === 'string') {
      var parts = input.split(';').map(function (v) { return parseFloat(v.trim()); });
      if (parts.length >= 3 && !isNaN(parts[0])) {
        return [parts[0], parts[1], parts[2]];
      }
      if (input.startsWith('#') && typeof gdjs.hexToRGBColor === 'function') {
        return gdjs.hexToRGBColor(input);
      }
    }
    return fallback || [64, 224, 208];
  }

  function getRootObject3D(object) {
    if (!object) return null;
    if (typeof object.get3DRendererObject === 'function') {
      try {
        var obj = object.get3DRendererObject();
        if (obj) return obj;
      } catch (e) {}
    }
    if (typeof object.getRendererObject === 'function') {
      try {
        var obj2 = object.getRendererObject();
        if (obj2) return obj2;
      } catch (e) {}
    }
    if (object.getRenderer && typeof object.getRenderer === 'function') {
      var r = object.getRenderer();
      if (r) {
        if (typeof r.get3DRendererObject === 'function') {
          try { return r.get3DRendererObject(); } catch (e) {}
        }
        if (r._threeObject) return r._threeObject;
      }
    }
    return null;
  }

  /**
   * Returns the three.js container that GDevelop parents its own 3D objects to for `layerName`
   * (`layer-pixi-renderer.add3DRendererObject` uses `_threeGroup`). Falls back to the scene root on
   * older runtimes. Anything added here inherits the scene's `scale.y = -1`, exactly like every
   * built-in 3D object, so GDevelop coordinates can be assigned to `position` directly.
   */
  function getLayerThreeRoot(runtimeScene, layerName) {
    if (!runtimeScene || typeof runtimeScene.getLayer !== 'function') return null;
    var layer = null;
    try { layer = runtimeScene.getLayer(layerName || ''); } catch (e) {}
    if (!layer || typeof layer.getRenderer !== 'function') return null;
    var renderer = layer.getRenderer();
    if (!renderer) return null;
    if (typeof renderer.getThreeGroup === 'function') {
      var group = renderer.getThreeGroup();
      if (group && typeof group.add === 'function') return group;
    }
    if (typeof renderer.getThreeScene === 'function') {
      var scene = renderer.getThreeScene();
      if (scene && typeof scene.add === 'function') return scene;
    }
    return null;
  }

  function getLayerThreeScene(runtimeScene, layerName) {
    if (!runtimeScene || typeof runtimeScene.getLayer !== 'function') return null;
    var layer = null;
    try { layer = runtimeScene.getLayer(layerName || ''); } catch (e) {}
    if (!layer || typeof layer.getRenderer !== 'function') return null;
    var renderer = layer.getRenderer();
    return renderer && typeof renderer.getThreeScene === 'function' ? renderer.getThreeScene() : null;
  }

  function getLayerThreeCamera(runtimeScene, layerName) {
    if (!runtimeScene || typeof runtimeScene.getLayer !== 'function') return null;
    var layer = null;
    try { layer = runtimeScene.getLayer(layerName || ''); } catch (e) {}
    if (!layer || typeof layer.getRenderer !== 'function') return null;
    var renderer = layer.getRenderer();
    return renderer && typeof renderer.getThreeCamera === 'function' ? renderer.getThreeCamera() : null;
  }

  /**
   * GDevelop's Hide action only sets a flag and calls the renderer's updateVisibility() once, so
   * anything that writes `visible = true` every frame silently undoes it. Water steps mirror this
   * instead: the surface mesh and the source volume both follow the object's own hidden state.
   */
  function objectIsHidden(object) {
    return !!(object && typeof object.isHidden === 'function' && object.isHidden());
  }

  function objectLayerName(object) {
    return (object && typeof object.getLayer === 'function') ? object.getLayer() : '';
  }

  /** Seconds elapsed since the previous frame, from the engine rather than a hardcoded 60 Hz guess. */
  function getDeltaSeconds(runtimeScene) {
    var ms = 16.6667;
    if (runtimeScene && typeof runtimeScene.getElapsedTime === 'function') {
      var v = runtimeScene.getElapsedTime();
      if (typeof v === 'number' && isFinite(v) && v > 0) ms = v;
    }
    // Clamp so a paused tab or a breakpoint cannot blow up the SPH integrator.
    return Math.min(ms / 1000.0, 0.1);
  }

  /* ------------------------------------------------------------- Fluid Presets */

  var FLUID_PRESETS = {
    Water: {
      viscosity: 0.2,
      surfaceTension: 0.5,
      restDensity: 1000.0,
      opacity: 0.30,
      roughness: 0.02,
      color: [64, 180, 240],
      dropletRadius: 0.02,
      flowRate: 60.0
    },
    MagicPotion: {
      viscosity: 0.8,
      surfaceTension: 1.2,
      restDensity: 1050.0,
      opacity: 0.85,
      roughness: 0.05,
      color: [220, 30, 120],
      dropletRadius: 0.022,
      flowRate: 50.0
    },
    HoneySyrup: {
      viscosity: 15.0,
      surfaceTension: 2.5,
      restDensity: 1400.0,
      opacity: 0.90,
      roughness: 0.08,
      color: [230, 160, 20],
      dropletRadius: 0.028,
      flowRate: 35.0
    },
    GreenSlime: {
      viscosity: 35.0,
      surfaceTension: 3.0,
      restDensity: 1200.0,
      opacity: 0.95,
      roughness: 0.15,
      color: [40, 210, 45],
      dropletRadius: 0.032,
      flowRate: 25.0
    },
    AcidPoison: {
      viscosity: 0.3,
      surfaceTension: 0.6,
      restDensity: 1100.0,
      opacity: 0.70,
      roughness: 0.02,
      color: [140, 240, 20],
      dropletRadius: 0.02,
      flowRate: 55.0
    },
    LavaMagma: {
      viscosity: 20.0,
      surfaceTension: 2.0,
      restDensity: 2500.0,
      opacity: 1.00,
      roughness: 0.35,
      color: [255, 70, 10],
      dropletRadius: 0.035,
      flowRate: 20.0
    },
    Custom: {
      viscosity: 1.0,
      surfaceTension: 0.8,
      restDensity: 1000.0,
      opacity: 0.85,
      roughness: 0.05,
      color: [220, 30, 120],
      dropletRadius: 0.02,
      flowRate: 50.0
    }
  };

  /* -------------------------------------------------------- Ocean Wave Presets */

  /* -------------------------------------------------------- Water Type Presets (WaterBody3D) */

  /**
   * WaterBody3D's palette set. Values are 0-1 RGB and cover only the uniforms
   * WATER_FRAGMENT_SHADER actually declares, so nothing here is written into a void.
   */
  var WATER_TYPE_PRESETS = {
    Ocean: {
      name: 'Ocean',
      causticsDepthFade: 1.00,
      shallowColor: [0.102, 0.549, 0.667],
      deepColor: [0.016, 0.086, 0.188],
      extinctionDepth: 160.0,
      causticsIntensity: 0.25,
      crestFoamIntensity: 0.75,
      shoreFoamIntensity: 0.90,
      refractionScale: 0.020
    },
    Lake: {
      name: 'Lake',
      causticsDepthFade: 0.60,
      shallowColor: [0.235, 0.627, 0.588],
      deepColor: [0.031, 0.157, 0.176],
      extinctionDepth: 90.0,
      causticsIntensity: 0.50,
      crestFoamIntensity: 0.35,
      shoreFoamIntensity: 0.70,
      refractionScale: 0.018
    },
    River: {
      name: 'River',
      causticsDepthFade: 0.00,
      shallowColor: [0.353, 0.588, 0.471],
      deepColor: [0.078, 0.196, 0.176],
      extinctionDepth: 55.0,
      causticsIntensity: 0.70,
      crestFoamIntensity: 0.45,
      shoreFoamIntensity: 1.00,
      refractionScale: 0.026
    },
    SwimmingPool: {
      name: 'Swimming Pool',
      causticsDepthFade: 0.00,
      shallowColor: [0.078, 0.882, 0.941],
      deepColor: [0.039, 0.451, 0.725],
      extinctionDepth: 250.0,
      causticsIntensity: 1.50,
      crestFoamIntensity: 0.00,
      shoreFoamIntensity: 0.20,
      refractionScale: 0.012
    }
  };

  function resolveWaterTypePreset(name) {
    if (!name || typeof name !== 'string') return null;
    var key = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (key === 'ocean' || key === 'sea') return WATER_TYPE_PRESETS.Ocean;
    if (key === 'lake' || key === 'pond') return WATER_TYPE_PRESETS.Lake;
    if (key === 'river' || key === 'stream' || key === 'canal') return WATER_TYPE_PRESETS.River;
    if (key === 'swimmingpool' || key === 'pool') return WATER_TYPE_PRESETS.SwimmingPool;
    return null;
  }

  /* -------------------------------------------------------- WaveWorks Beaufort Presets */

  var BEAUFORT_SCALE_PRESETS = {
    SeaOfThieves: Object.assign({}, {"shallowColor":[0,0.8431372549019608,0.7254901960784313],"deepColor":[0.01568627450980392,0.08627450980392157,0.18823529411764706],"translucencyColor":[0.13725490196078433,1,0.8823529411764706],"translucencyIntensity":2.2,"translucencyPower":3,"waveContrast":0.75,"extinctionDepth":130,"foamColor":[0.9803921568627451,0.9882352941176471,1],"foamIntensity":1.1,"foamCoverage":0.35,"microDetail":0.5,"microFrequency":1,"opacity":0.88,"sunHeading":75,"sunElevation":22,"sunColor":[1,0.94,0.82],"sunSpecularIntensity":2.8,"sunSpecularRoughness":160,"causticsIntensity":0.8}, {
      name: 'Sea of Thieves',
      causticsDepthFade: 0.00,
      windSpeed: 10.0,
      waveHeightScale: 1.0,
      choppiness: 1.0,
      cascadeWeight: 0.65,
      foamIntensity: 1.1,
      foamCoverage: 0.35,
      microDetail: 0.50
    }),
    SwimmingPool: Object.assign({}, {"shallowColor":[0.0784313725490196,0.8823529411764706,0.9411764705882353],"deepColor":[0.0392156862745098,0.45098039215686275,0.7254901960784313],"translucencyColor":[0.19607843137254902,0.9607843137254902,0.9215686274509803],"translucencyIntensity":1.2,"translucencyPower":3,"waveContrast":0.25,"extinctionDepth":250,"foamColor":[1,1,1],"foamIntensity":0,"foamCoverage":0,"microDetail":0.2,"microFrequency":0.8,"opacity":0.72,"sunHeading":45,"sunElevation":60,"sunColor":[1,1,0.98],"sunSpecularIntensity":1.8,"sunSpecularRoughness":192,"causticsIntensity":1.5}, {
      name: 'Swimming Pool',
      causticsDepthFade: 0.00,
      windSpeed: 0.0,
      waveHeightScale: 0.0,
      choppiness: 0.0,
      cascadeWeight: 0.0,
      foamIntensity: 0.0,
      foamCoverage: 0.0,
      microDetail: 0.0
    }),
    Murky: Object.assign({}, {"shallowColor":[0.07058823529411765,0.24313725490196078,0.34509803921568627],"deepColor":[0.023529411764705882,0.07058823529411765,0.12549019607843137],"translucencyColor":[0.09803921568627451,0.3137254901960784,0.4117647058823529],"translucencyIntensity":0.5,"translucencyPower":2.2,"waveContrast":0.6,"extinctionDepth":65,"foamColor":[0.8235294117647058,0.8823529411764706,0.9215686274509803],"foamIntensity":0.75,"foamCoverage":0.25,"microDetail":0.45,"microFrequency":1,"opacity":0.95,"sunColor":[0.85,0.88,0.92],"sunSpecularIntensity":1.2,"sunSpecularRoughness":64,"causticsIntensity":0.2}, {
      name: 'Murky',
      causticsDepthFade: 1.00,
      windSpeed: 7.5,
      waveHeightScale: 0.8,
      choppiness: 0.85,
      cascadeWeight: 0.5,
      foamIntensity: 0.75,
      foamCoverage: 0.25,
      microDetail: 0.45
    }),
    Stormy: Object.assign({}, {"shallowColor":[0.0784313725490196,0.20392156862745098,0.3058823529411765],"deepColor":[0.01568627450980392,0.047058823529411764,0.09411764705882353],"translucencyColor":[0.12549019607843137,0.3333333333333333,0.45098039215686275],"translucencyIntensity":0.8,"translucencyPower":2.4,"waveContrast":0.85,"extinctionDepth":85,"foamColor":[0.9490196078431372,0.9725490196078431,1],"foamIntensity":1.8,"foamCoverage":0.65,"microDetail":0.85,"microFrequency":1.4,"opacity":0.94,"sunColor":[0.75,0.8,0.88],"sunSpecularIntensity":3.2,"sunSpecularRoughness":64,"causticsIntensity":0.1}, {
      name: 'Stormy',
      causticsDepthFade: 1.00,
      windSpeed: 22.0,
      waveHeightScale: 1.6,
      choppiness: 1.35,
      cascadeWeight: 0.85,
      foamIntensity: 1.4,
      foamCoverage: 0.65,
      microDetail: 1.0
    }),
    Calm: Object.assign({}, {"shallowColor":[0.058823529411764705,0.7254901960784313,0.7843137254901961],"deepColor":[0.03137254901960784,0.17647058823529413,0.35294117647058826],"translucencyColor":[0.09803921568627451,0.8235294117647058,0.8431372549019608],"translucencyIntensity":1.4,"translucencyPower":3,"waveContrast":0.4,"extinctionDepth":180,"foamColor":[1,1,1],"foamIntensity":0.2,"foamCoverage":0.1,"microDetail":0.35,"microFrequency":0.8,"opacity":0.82,"sunHeading":45,"sunElevation":40,"sunColor":[1,0.98,0.92],"sunSpecularIntensity":2.2,"sunSpecularRoughness":220,"causticsIntensity":0.6}, {
      name: 'Calm',
      causticsDepthFade: 0.35,
      windSpeed: 3.5,
      waveHeightScale: 0.5,
      choppiness: 0.5,
      cascadeWeight: 0.35,
      foamIntensity: 0.2,
      foamCoverage: 0.1,
      microDetail: 0.35
    }),
    Beaufort0_Calm: Object.assign({}, {"shallowColor":[0.058823529411764705,0.7254901960784313,0.7843137254901961],"deepColor":[0.03137254901960784,0.17647058823529413,0.35294117647058826],"translucencyColor":[0.09803921568627451,0.8235294117647058,0.8431372549019608],"translucencyIntensity":1.4,"translucencyPower":3,"waveContrast":0.4,"extinctionDepth":180,"foamColor":[1,1,1],"foamIntensity":0.2,"foamCoverage":0.1,"microDetail":0.35,"microFrequency":0.8,"opacity":0.82,"sunHeading":45,"sunElevation":40,"sunColor":[1,0.98,0.92],"sunSpecularIntensity":2.2,"sunSpecularRoughness":220,"causticsIntensity":0.6}, {
      name: 'Beaufort 0 - Calm',
      causticsDepthFade: 1.00,
      windSpeed: 0.0,
      waveHeightScale: 0.0,
      choppiness: 0.0,
      cascadeWeight: 0.0,
      foamIntensity: 0.0,
      foamCoverage: 0.0,
      microDetail: 0.0
    }),
    Beaufort2_LightBreeze: Object.assign({}, {"shallowColor":[0.058823529411764705,0.7254901960784313,0.7843137254901961],"deepColor":[0.03137254901960784,0.17647058823529413,0.35294117647058826],"translucencyColor":[0.09803921568627451,0.8235294117647058,0.8431372549019608],"translucencyIntensity":1.4,"translucencyPower":3,"waveContrast":0.4,"extinctionDepth":180,"foamColor":[1,1,1],"foamIntensity":0.2,"foamCoverage":0.1,"microDetail":0.35,"microFrequency":0.8,"opacity":0.82,"sunHeading":45,"sunElevation":40,"sunColor":[1,0.98,0.92],"sunSpecularIntensity":2.2,"sunSpecularRoughness":220,"causticsIntensity":0.6}, {
      name: 'Beaufort 2 - Light Breeze',
      causticsDepthFade: 1.00,
      windSpeed: 2.5,
      waveHeightScale: 0.35,
      choppiness: 0.6,
      cascadeWeight: 0.4,
      foamIntensity: 0.15,
      foamCoverage: 0.08,
      microDetail: 0.3
    }),
    Beaufort4_ModerateBreeze: Object.assign({}, {"shallowColor":[0,0.8431372549019608,0.7254901960784313],"deepColor":[0.01568627450980392,0.08627450980392157,0.18823529411764706],"translucencyColor":[0.13725490196078433,1,0.8823529411764706],"translucencyIntensity":2.2,"translucencyPower":3,"waveContrast":0.75,"extinctionDepth":130,"foamColor":[0.9803921568627451,0.9882352941176471,1],"foamIntensity":1.1,"foamCoverage":0.35,"microDetail":0.5,"microFrequency":1,"opacity":0.88,"sunHeading":75,"sunElevation":22,"sunColor":[1,0.94,0.82],"sunSpecularIntensity":2.8,"sunSpecularRoughness":160,"causticsIntensity":0.8}, {
      name: 'Beaufort 4 - Moderate Breeze',
      causticsDepthFade: 1.00,
      windSpeed: 7.0,
      waveHeightScale: 0.75,
      choppiness: 0.9,
      cascadeWeight: 0.6,
      foamIntensity: 0.55,
      foamCoverage: 0.25,
      microDetail: 0.55
    }),
    Beaufort6_StrongBreeze: Object.assign({}, {"shallowColor":[0,0.8431372549019608,0.7254901960784313],"deepColor":[0.01568627450980392,0.08627450980392157,0.18823529411764706],"translucencyColor":[0.13725490196078433,1,0.8823529411764706],"translucencyIntensity":2.2,"translucencyPower":3,"waveContrast":0.75,"extinctionDepth":130,"foamColor":[0.9803921568627451,0.9882352941176471,1],"foamIntensity":1.1,"foamCoverage":0.35,"microDetail":0.5,"microFrequency":1,"opacity":0.88,"sunHeading":75,"sunElevation":22,"sunColor":[1,0.94,0.82],"sunSpecularIntensity":2.8,"sunSpecularRoughness":160,"causticsIntensity":0.8}, {
      name: 'Beaufort 6 - Strong Breeze',
      causticsDepthFade: 1.00,
      windSpeed: 12.5,
      waveHeightScale: 1.0,
      choppiness: 1.05,
      cascadeWeight: 0.7,
      foamIntensity: 0.85,
      foamCoverage: 0.4,
      microDetail: 0.7
    }),
    Beaufort9_StrongGale: Object.assign({}, {"shallowColor":[0.0784313725490196,0.20392156862745098,0.3058823529411765],"deepColor":[0.01568627450980392,0.047058823529411764,0.09411764705882353],"translucencyColor":[0.12549019607843137,0.3333333333333333,0.45098039215686275],"translucencyIntensity":0.8,"translucencyPower":2.4,"waveContrast":0.85,"extinctionDepth":85,"foamColor":[0.9490196078431372,0.9725490196078431,1],"foamIntensity":1.8,"foamCoverage":0.65,"microDetail":0.85,"microFrequency":1.4,"opacity":0.94,"sunColor":[0.75,0.8,0.88],"sunSpecularIntensity":3.2,"sunSpecularRoughness":64,"causticsIntensity":0.1}, {
      name: 'Beaufort 9 - Strong Gale',
      causticsDepthFade: 1.00,
      windSpeed: 22.0,
      waveHeightScale: 1.6,
      choppiness: 1.35,
      cascadeWeight: 0.85,
      foamIntensity: 1.4,
      foamCoverage: 0.65,
      microDetail: 1.0
    }),
    Beaufort12_Hurricane: Object.assign({}, {"shallowColor":[0.0784313725490196,0.20392156862745098,0.3058823529411765],"deepColor":[0.01568627450980392,0.047058823529411764,0.09411764705882353],"translucencyColor":[0.12549019607843137,0.3333333333333333,0.45098039215686275],"translucencyIntensity":0.8,"translucencyPower":2.4,"waveContrast":0.85,"extinctionDepth":85,"foamColor":[0.9490196078431372,0.9725490196078431,1],"foamIntensity":1.8,"foamCoverage":0.65,"microDetail":0.85,"microFrequency":1.4,"opacity":0.94,"sunColor":[0.75,0.8,0.88],"sunSpecularIntensity":3.2,"sunSpecularRoughness":64,"causticsIntensity":0.1}, {
      name: 'Beaufort 12 - Hurricane',
      causticsDepthFade: 1.00,
      windSpeed: 35.0,
      waveHeightScale: 2.4,
      choppiness: 1.55,
      cascadeWeight: 0.95,
      foamIntensity: 2.0,
      foamCoverage: 0.85,
      microDetail: 1.3
    }),
    FlatWater: Object.assign({}, {"shallowColor":[0.0784313725490196,0.8823529411764706,0.9411764705882353],"deepColor":[0.0392156862745098,0.45098039215686275,0.7254901960784313],"translucencyColor":[0.19607843137254902,0.9607843137254902,0.9215686274509803],"translucencyIntensity":1.2,"translucencyPower":3,"waveContrast":0.25,"extinctionDepth":250,"foamColor":[1,1,1],"foamIntensity":0,"foamCoverage":0,"microDetail":0.2,"microFrequency":0.8,"opacity":0.72,"sunHeading":45,"sunElevation":60,"sunColor":[1,1,0.98],"sunSpecularIntensity":1.8,"sunSpecularRoughness":192,"causticsIntensity":1.5}, {
      name: 'Flat Water',
      causticsDepthFade: 0.00,
      windSpeed: 0.0,
      waveHeightScale: 0.0,
      choppiness: 0.0,
      cascadeWeight: 0.0,
      foamIntensity: 0.0,
      foamCoverage: 0.0,
      microDetail: 0.0
    })
  };

/**
   * The six authored rungs are ANCHORS on a continuous scale, not six separate looks. Everything
   * between them - Beaufort 1, 3, 5, 7, 8, 10, 11, and every fractional value the strength slider
   * asks for - is interpolated from them, so the sea grows steadily instead of jumping between
   * settings. The anchors themselves come back bit-exact, so existing projects do not shift.
   *
   * The authored wind speeds (0, 2.5, 7, 12.5, 22, 35 m/s) already track the Beaufort scale's own
   * relation V = 0.836 * B^1.5 to within a few percent, so interpolating between them stays
   * physically honest.
   */
  var BEAUFORT_ANCHORS = null;
  function beaufortAnchors() {
    if (!BEAUFORT_ANCHORS) {
      BEAUFORT_ANCHORS = [
        [0, BEAUFORT_SCALE_PRESETS.Beaufort0_Calm],
        [2, BEAUFORT_SCALE_PRESETS.Beaufort2_LightBreeze],
        [4, BEAUFORT_SCALE_PRESETS.Beaufort4_ModerateBreeze],
        [6, BEAUFORT_SCALE_PRESETS.Beaufort6_StrongBreeze],
        [9, BEAUFORT_SCALE_PRESETS.Beaufort9_StrongGale],
        [12, BEAUFORT_SCALE_PRESETS.Beaufort12_Hurricane]
      ];
    }
    return BEAUFORT_ANCHORS;
  }

  /** The maritime names, indexed by rung. */
  var BEAUFORT_RUNG_NAMES = [
    'Calm', 'Light Air', 'Light Breeze', 'Gentle Breeze', 'Moderate Breeze', 'Fresh Breeze',
    'Strong Breeze', 'Near Gale', 'Gale', 'Strong Gale', 'Storm', 'Violent Storm', 'Hurricane'
  ];

  /** Dropdown label for an integer rung, e.g. 'Beaufort 7 - Near Gale'. */
  function beaufortLabel(rung) {
    var r = Math.max(0, Math.min(12, Math.round(rung)));
    return 'Beaufort ' + r + ' - ' + BEAUFORT_RUNG_NAMES[r];
  }

  /**
   * The sea state at any point on the scale, integer or not. Numbers blend linearly; colours blend
   * channel by channel, so Beaufort 7 really does sit between Beaufort 6's blue and Beaufort 9's
   * storm grey rather than snapping from one to the other.
   */
  /**
   * Monotone cubic interpolation (Fritsch-Carlson) over the Beaufort anchors.
   *
   * Straight linear interpolation was continuous in VALUE but not in SLOPE: wind speed climbed at
   * 0.69 per 0.25 rung through Beaufort 4-6, then 0.79 through 6-9, then 1.08 through 9-12. Since
   * significant wave height goes as the square of wind speed, each of those corners showed up as
   * the sea visibly changing size as the slider crossed a rung - worst at Beaufort 9, where the
   * per-step growth jumped by 34 units in one increment.
   *
   * This keeps every authored anchor exact, makes the first derivative continuous so there are no
   * corners left, and is monotone by construction - the sea can never shrink as the scale rises,
   * which a plain cubic spline would happily do by overshooting.
   */
  function monotoneAt(xs, ys, x) {
    var n = xs.length;
    if (n === 0) return 0;
    if (n === 1) return ys[0];
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];

    // Secant slopes between neighbouring anchors.
    var d = [];
    var i;
    for (i = 0; i < n - 1; i++) {
      d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
    }

    // Tangents: average of the two neighbouring secants, one-sided at the ends.
    var m = [d[0]];
    for (i = 1; i < n - 1; i++) m.push((d[i - 1] + d[i]) * 0.5);
    m.push(d[n - 2]);

    // Fritsch-Carlson limiter. Without it the curve overshoots between anchors, which here would
    // mean a sea that briefly grows past the next rung and comes back.
    for (i = 0; i < n - 1; i++) {
      if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
      var a = m[i] / d[i];
      var b = m[i + 1] / d[i];
      var sq = a * a + b * b;
      if (sq > 9) {
        var t = 3 / Math.sqrt(sq);
        m[i] = t * a * d[i];
        m[i + 1] = t * b * d[i];
      }
    }

    var k = n - 2;
    for (i = 0; i < n - 1; i++) {
      if (x >= xs[i] && x <= xs[i + 1]) { k = i; break; }
    }
    var h = xs[k + 1] - xs[k];
    var t2 = (x - xs[k]) / h;
    var t3 = t2 * t2;
    var tc = t3 * t2;
    // Hermite basis.
    return (2 * tc - 3 * t3 + 1) * ys[k]
      + (tc - 2 * t3 + t2) * h * m[k]
      + (-2 * tc + 3 * t3) * ys[k + 1]
      + (tc - t3) * h * m[k + 1];
  }

  var BEAUFORT_RUNG_CACHE = {};
  function beaufortAt(b) {
    var anchors = beaufortAnchors();
    var t = Math.max(0, Math.min(12, (typeof b === 'number' && isFinite(b)) ? b : 4));

    // Whole rungs are cached: they are what the dropdown asks for, callers compare them by
    // identity, and the strength slider would otherwise allocate one of these every frame.
    var whole = (t === Math.round(t)) ? String(t) : null;
    if (whole !== null && BEAUFORT_RUNG_CACHE[whole]) return BEAUFORT_RUNG_CACHE[whole];

    var lo = anchors[0], hi = anchors[anchors.length - 1];
    for (var i = 0; i < anchors.length - 1; i++) {
      if (t >= anchors[i][0] && t <= anchors[i + 1][0]) { lo = anchors[i]; hi = anchors[i + 1]; break; }
    }
    var span = hi[0] - lo[0];
    var f = (span > 0) ? (t - lo[0]) / span : 0;
    // Keep authored optics at anchors, but include the numeric level on every cached rung.
    if (f <= 0 || f >= 1) {
      var exact = Object.assign({}, (f <= 0) ? lo[1] : hi[1], { beaufort: t });
      if (whole !== null) { BEAUFORT_RUNG_CACHE[whole] = exact; }
      return exact;
    }

    // Interpolate across ALL the anchors, not just the bracketing pair: a smooth slope needs to
    // know what comes before and after, which is the whole reason the linear version had corners.
    var xs = [];
    for (var ai = 0; ai < anchors.length; ai++) xs.push(anchors[ai][0]);
    var a = lo[1], c = hi[1];
    var out = {};
    for (var key in a) {
      if (!Object.prototype.hasOwnProperty.call(a, key)) continue;
      var av = a[key], cv = c[key];
      if (typeof av === 'number' && typeof cv === 'number') {
        var ys = [];
        for (var yi = 0; yi < anchors.length; yi++) {
          var v = anchors[yi][1][key];
          ys.push(typeof v === 'number' ? v : av);
        }
        out[key] = monotoneAt(xs, ys, t);
      } else if (Array.isArray(av) && Array.isArray(cv) && av.length === cv.length) {
        var arr = [];
        for (var j = 0; j < av.length; j++) {
          var cys = [];
          for (var ci = 0; ci < anchors.length; ci++) {
            var carr = anchors[ci][1][key];
            cys.push(Array.isArray(carr) && typeof carr[j] === 'number' ? carr[j] : av[j]);
          }
          arr.push(monotoneAt(xs, cys, t));
        }
        out[key] = arr;
      } else {
        out[key] = (f < 0.5) ? av : cv;
      }
    }
    out.beaufort = t;
    out.name = beaufortLabel(t);
    if (whole !== null) { BEAUFORT_RUNG_CACHE[whole] = out; }
    return out;
  }

  function resolveWaveWorksBeaufortPreset(name) {
    if (typeof name === 'number') {
      return isFinite(name) ? beaufortAt(name) : null;
    }
    if (!name || typeof name !== 'string') return null;
    var trimmed = name.trim();
    var directNum = parseFloat(trimmed);
    if (isFinite(directNum) && /^[0-9]+(?:\.[0-9]+)?$/.test(trimmed)) {
      return beaufortAt(directNum);
    }
    var bDecMatch = /^(?:beaufort|b)\s*([0-9]+(?:\.[0-9]+)?)/i.exec(trimmed);
    if (bDecMatch) {
      var dVal = parseFloat(bDecMatch[1]);
      if (isFinite(dVal) && dVal >= 0 && dVal <= 12) return beaufortAt(dVal);
    }
    var key = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (key === 'swimmingpool' || key === 'pool' || key === 'resortpool') {
      return BEAUFORT_SCALE_PRESETS.SwimmingPool;
    }
    if (key === 'seaofthieves' || key === 'sot' || key === 'caribbean' || key === 'caribbeanocean') {
      return BEAUFORT_SCALE_PRESETS.SeaOfThieves;
    }
    if (key === 'murky' || key === 'swamp' || key === 'murkyocean' || key === 'darkmurky') {
      return BEAUFORT_SCALE_PRESETS.Murky;
    }
    if (key === 'stormy' || key === 'storm' || key === 'rough' || key === 'tempest') {
      return BEAUFORT_SCALE_PRESETS.Stormy;
    }
    if (key === 'calm' || key === 'calmwater' || key === 'peaceful' || key === 'glassy') {
      return BEAUFORT_SCALE_PRESETS.Calm;
    }
    if (key === 'flat' || key === 'flatwater' || key === 'mirror' || key === 'nowaves') {
      return BEAUFORT_SCALE_PRESETS.FlatWater;
    }
    // Named winds, for anyone who would rather write the weather than the number.
    if (key === 'lightair') return beaufortAt(1);
    if (key === 'lightbreeze' || key === 'light') return beaufortAt(2);
    if (key === 'gentlebreeze' || key === 'gentle') return beaufortAt(3);
    if (key === 'moderatebreeze' || key === 'moderate') return beaufortAt(4);
    if (key === 'freshbreeze' || key === 'fresh') return beaufortAt(5);
    if (key === 'strongbreeze' || key === 'strong' || key === 'default') return beaufortAt(6);
    if (key === 'neargale' || key === 'highwind') return beaufortAt(7);
    if (key === 'freshgale') return beaufortAt(8);
    if (key === 'stronggale' || key === 'gale') return beaufortAt(9);
    if (key === 'violentstorm') return beaufortAt(11);
    if (key === 'hurricane' || key === 'hellhole') return beaufortAt(12);

    // Anything shaped like a rung: '7', 'b7', 'beaufort7', 'beaufort7neargale'. Only whole rungs
    // arrive as text - `key` has already had its punctuation stripped, so a decimal point cannot
    // survive. Fractional sea states come through the strength slider, which passes numbers.
    var m = /^(?:beaufort|b)?([0-9]{1,2})$|^(?:beaufort|b)([0-9]{1,2})/.exec(key);
    if (m) {
      var rung = parseInt(m[1] !== undefined ? m[1] : m[2], 10);
      if (isFinite(rung) && rung >= 0 && rung <= 12) return beaufortAt(rung);
    }
    return null;
  }

  /* ----------------------------------------------------------------- Wave-collision spray */

  /** Gravity for airborne spray, in GDevelop units per second squared. */
  function sprayGravityFor(ocean, det) {
    var upm = (ocean && ocean.unitsPerMetre > 0) ? ocean.unitsPerMetre : 100.0;
    var scale = (det && det.sprayGravityScale > 0) ? det.sprayGravityScale : 1.0;
    return 9.81 * upm * scale;
  }


  /**
   * Ballistic spray thrown up where two crests collide.
   *
   * This deliberately does NOT go through the SPH droplet solver. That solver exists for pouring
   * liquid into containers: it does neighbour searches and pressure solves, costs about 2.4 ms for
   * 1500 particles, and none of that is what spray needs. Spray is water in the air - it launches,
   * it falls, it dies. A flat array and one gravity term covers it, and thousands of particles
   * cost less than a hundred SPH ones.
   *
   * Positions are GDevelop units and Z is up, matching the instanced droplet renderer, which sits
   * under the same y-mirrored root as every built-in 3D object.
   */
  function SpraySystem(max) {
    var n = Math.max(16, Math.min(8192, Math.round(max) || 1024));
    this.max = n;
    this.x = new Float32Array(n);
    this.y = new Float32Array(n);
    this.z = new Float32Array(n);
    this.vx = new Float32Array(n);
    this.vy = new Float32Array(n);
    this.vz = new Float32Array(n);
    this.gravity = new Float32Array(n);
    this.life = new Float32Array(n);
    this.life0 = new Float32Array(n);
    this.size = new Float32Array(n);
    this.alive = new Uint8Array(n);
    this.liveCount = 0;
    this.cursor = 0;
  }

  /** Oldest-wins recycling: a full pool keeps spraying rather than going silent. */
  SpraySystem.prototype.emit = function (x, y, z, vx, vy, vz, life, size, gravity) {
    var slot = -1;
    for (var probe = 0; probe < this.max; probe++) {
      var i = (this.cursor + probe) % this.max;
      if (!this.alive[i]) { slot = i; break; }
    }
    if (slot < 0) {
      var oldest = 0, least = Infinity;
      for (var j = 0; j < this.max; j++) {
        if (this.life[j] < least) { least = this.life[j]; oldest = j; }
      }
      slot = oldest;
    } else {
      this.liveCount++;
    }
    this.cursor = (slot + 1) % this.max;
    this.x[slot] = x; this.y[slot] = y; this.z[slot] = z;
    this.vx[slot] = vx; this.vy[slot] = vy; this.vz[slot] = vz;
    this.life[slot] = life; this.life0[slot] = life;
    this.size[slot] = size;
    this.gravity[slot] = gravity !== undefined ? gravity : NaN;
    this.alive[slot] = 1;
    return slot;
  };

  /**
   * `killZ` is the water line: a droplet that falls back through it has landed, and keeping it
   * alive below the surface is what makes spray read as bubbles hanging in the water. Undefined
   * means "no water line", which is what the tests use.
   */
  SpraySystem.prototype.step = function (dt, gravity, killZ) {
    if (!(dt > 0)) return;
    var d = Math.min(dt, 0.05);
    var g = gravity;
    var hasFloor = (typeof killZ === 'number' && isFinite(killZ));
    var live = 0;
    for (var i = 0; i < this.max; i++) {
      if (!this.alive[i]) continue;
      this.life[i] -= d;
      if (this.life[i] <= 0) { this.alive[i] = 0; continue; }
      // Falling, and back under the water it came from: it has splashed down.
      if (hasFloor && this.vz[i] < 0 && this.z[i] < killZ) { this.alive[i] = 0; continue; }
      this.vz[i] -= (isFinite(this.gravity[i]) ? this.gravity[i] : g) * d;
      this.x[i] += this.vx[i] * d;
      this.y[i] += this.vy[i] * d;
      this.z[i] += this.vz[i] * d;
      live++;
    }
    this.liveCount = live;
  };

  SpraySystem.prototype.clear = function () {
    this.alive.fill(0);
    this.liveCount = 0;
    this.cursor = 0;
  };

  /**
   * Walks the plume mask and launches spray from the sites that are converging hardest.
   *
   * The walk uses a rotating stride rather than a full scan, so the cost per frame is fixed no
   * matter how violent the sea is - a hurricane has ten percent of its surface converging, and a
   * full scan there would spawn without bound. `budget` is a hard cap, not a rate.
   */
  function emitWaveCollisionSpray(spray, ocean, cfg, dt) {
    if (!spray || !ocean || !ocean.field || !ocean.field.plume) return 0;
    var field = ocean.field;
    var n = field.n;
    var total = n * n;
    var cell = field.tileSize / n;
    var chop = ocean.choppiness;
    var upm = ocean.unitsPerMetre > 0 ? ocean.unitsPerMetre : 100.0;

    var budget = Math.max(0, Math.round(cfg.budget));
    if (budget <= 0) return 0;

    // Sample a fixed number of texels per frame, striding by a step coprime with the field so the
    // walk covers the whole surface over successive frames instead of re-testing one band.
    var probes = Math.min(total, budget * 24);
    var stride = 2 * Math.floor(n * 0.37) + 1;
    var origin = ocean.object ? ocean.object : null;
    var ox = origin && origin.getX ? origin.getX() : 0;
    var oy = origin && origin.getY ? origin.getY() : 0;
    // The SURFACE, not the bottom of the volume. getZ() is the base of a 3D object, so on a water
    // body 3568 units deep this spawned every droplet 3568 units UNDER the sea - which is exactly
    // what it looked like: bubbles hanging in the water rather than spray thrown off a crest. The
    // surface mesh sits at objZ + depth, so match it.
    var oz = ocean.baseZ !== undefined ? ocean.baseZ
      : ((origin && origin.getZ ? origin.getZ() : 0) +
         (origin && origin.getDepth && origin.getDepth() > 0 ? origin.getDepth() : 0));

    var spawned = 0;
    var cursor = ocean.sprayCursor || 0;
    for (var p = 0; p < probes && spawned < budget; p++) {
      cursor = (cursor + stride) % total;
      var v = field.plume[cursor];
      if (v < cfg.threshold) continue;

      var gy = Math.floor(cursor / n);
      var gx = cursor - gy * n;

      // The field is indexed in UNDISPLACED parameter space. Without adding the choppiness offset
      // the spray appears beside the crest that threw it, which is obvious at high choppiness.
      var wx = ox + gx * cell + field.dispX[cursor] * chop;
      var wy = oy + gy * cell + field.dispY[cursor] * chop;
      var wz = oz + field.height[cursor];

      // Launch speed scales with how hard the collision is and with the size of the sea.
      var strength = Math.sqrt(v);
      var up = cfg.speed * strength * Math.max(ocean.significantWaveHeight, upm * 0.05);
      var lateral = up * 0.22;
      spray.emit(
        wx, wy, wz,
        (Math.random() - 0.5) * lateral,
        (Math.random() - 0.5) * lateral,
        up * (0.75 + Math.random() * 0.5),
        cfg.life * (0.7 + Math.random() * 0.6),
        cfg.size * (0.6 + Math.random() * 0.8),
        cfg.gravity !== undefined ? cfg.gravity : sprayGravityFor(ocean, null)
      );
      spawned++;
    }
    ocean.sprayCursor = cursor;
    return spawned;
  }


  /* ------------------------------------------------------------- Multi-Octave Gerstner Wave Core */

  /**
   * Wave octaves for the Gerstner surface. Ten components, chosen against the ways a small sum of
   * sinusoids stops looking like water:
   *
   *   1. Frequency ratios sit near 1.6 and no two steps are equal. Harmonically related components
   *      share a period and phase-lock into a repeating lattice.
   *   2. Each octave carries its own phase, so they do not all crest together at the origin.
   *   3. Directions STRADDLE the wind and their spread WIDENS as the wavelength shortens: long
   *      swell runs with the wind, short chop fans out to ~50 degrees. A uniformly wide spread
   *      gives a crosshatch; a narrow one-sided cone gives parallel ridges that all march the same
   *      way when viewed at an angle. Frequency-dependent spreading is what real wind seas do and
   *      it avoids both.
   *   4. Amplitudes are weighted by cos^2(theta/2) off the wind and fall off near k^-1, rather than
   *      over-weighting the fine detail as a flat falloff does.
   *   5. `speedMul` is 1.0 throughout, so phase speed is left to the dispersion relation
   *      sqrt(g/k) — short waves are genuinely slower than long ones. Pushing the short octaves to
   *      2x, as an earlier table did, made the whole surface march in lockstep.
   *
   * Measured against a Tessendorf field of matched wave height (see `_dirsearch` notes in
   * IMPLEMENTATION_PLAN.md): ridge-orientation isotropy 0.643 vs 0.635, crest-height variation
   * 0.672 vs 0.732. The previous eight-octave table scored 0.338 isotropy — ridges all aligned.
   *
   * `ampRatio` values sum to 1.0, which `vWaveCrest` and the foam normalisation both rely on.
   */
  var GERSTNER_OCTAVES = [
    { dirOffset:  13.1, lenRatio: 1.00000, ampRatio: 0.4227, steepness: 0.75, speedMul: 1.0, phase: 3.5018 },
    { dirOffset: -27.2, lenRatio: 0.68417, ampRatio: 0.2563, steepness: 0.71, speedMul: 1.0, phase: 4.9985 },
    { dirOffset:  25.0, lenRatio: 0.42980, ampRatio: 0.1477, steepness: 0.67, speedMul: 1.0, phase: 1.3619 },
    { dirOffset: -40.1, lenRatio: 0.26838, ampRatio: 0.0776, steepness: 0.63, speedMul: 1.0, phase: 3.6933 },
    { dirOffset:  39.3, lenRatio: 0.16489, ampRatio: 0.0434, steepness: 0.59, speedMul: 1.0, phase: 1.3340 },
    { dirOffset: -50.9, lenRatio: 0.10602, ampRatio: 0.0234, steepness: 0.55, speedMul: 1.0, phase: 1.5099 },
    { dirOffset:  41.6, lenRatio: 0.06450, ampRatio: 0.0138, steepness: 0.51, speedMul: 1.0, phase: 0.5159 },
    { dirOffset: -43.2, lenRatio: 0.04027, ampRatio: 0.0078, steepness: 0.47, speedMul: 1.0, phase: 4.2335 },
    { dirOffset:  37.0, lenRatio: 0.02615, ampRatio: 0.0048, steepness: 0.43, speedMul: 1.0, phase: 2.2377 },
    { dirOffset: -38.3, lenRatio: 0.01521, ampRatio: 0.0025, steepness: 0.39, speedMul: 1.0, phase: 5.4084 }
  ];

  /* ------------------------------------------------------------- Gerstner Water 2 (Stylized Sea of Thieves Waves) */

  var GERSTNER2_WAVES = [
    { dirOffset:  0.0, lenRatio: 1.000, ampRatio: 0.38, steepness: 1.00, speedMul: 1.00, phase: 0.000 },
    { dirOffset: 12.0, lenRatio: 0.720, ampRatio: 0.26, steepness: 0.95, speedMul: 1.00, phase: 1.842 },
    { dirOffset: -24.0, lenRatio: 0.480, ampRatio: 0.16, steepness: 0.85, speedMul: 1.05, phase: 3.415 },
    { dirOffset:  28.0, lenRatio: 0.320, ampRatio: 0.09, steepness: 0.75, speedMul: 1.10, phase: 4.721 },
    { dirOffset: -40.0, lenRatio: 0.210, ampRatio: 0.05, steepness: 0.65, speedMul: 1.15, phase: 2.138 },
    { dirOffset:  48.0, lenRatio: 0.135, ampRatio: 0.03, steepness: 0.55, speedMul: 1.20, phase: 0.912 },
    { dirOffset: -55.0, lenRatio: 0.085, ampRatio: 0.02, steepness: 0.45, speedMul: 1.25, phase: 5.247 },
    { dirOffset:  35.0, lenRatio: 0.050, ampRatio: 0.01, steepness: 0.35, speedMul: 1.30, phase: 3.864 }
  ];



  /* ------------------------------------------------------------- Water Detailing Presets (Sea of Thieves Optics & SSS) */

  var WATER_DETAILING_PRESETS = {
    SeaOfThieves: Object.assign({
      name: 'Sea of Thieves',
      causticsDepthFade: 0.00
    }, {"shallowColor":[0,0.8431372549019608,0.7254901960784313],"deepColor":[0.01568627450980392,0.08627450980392157,0.18823529411764706],"translucencyColor":[0.13725490196078433,1,0.8823529411764706],"translucencyIntensity":2.2,"translucencyPower":3,"waveContrast":0.75,"extinctionDepth":130,"foamColor":[0.9803921568627451,0.9882352941176471,1],"foamIntensity":1.1,"foamCoverage":0.35,"microDetail":0.5,"microFrequency":1,"opacity":0.88,"sunHeading":75,"sunElevation":22,"sunColor":[1,0.94,0.82],"sunSpecularIntensity":2.8,"sunSpecularRoughness":160,"causticsIntensity":0.8}),
    SwimmingPool: Object.assign({
      name: 'Swimming Pool',
      causticsDepthFade: 0.00
    }, {"shallowColor":[0.0784313725490196,0.8823529411764706,0.9411764705882353],"deepColor":[0.0392156862745098,0.45098039215686275,0.7254901960784313],"translucencyColor":[0.19607843137254902,0.9607843137254902,0.9215686274509803],"translucencyIntensity":1.2,"translucencyPower":3,"waveContrast":0.25,"extinctionDepth":250,"foamColor":[1,1,1],"foamIntensity":0,"foamCoverage":0,"microDetail":0.2,"microFrequency":0.8,"opacity":0.72,"sunHeading":45,"sunElevation":60,"sunColor":[1,1,0.98],"sunSpecularIntensity":1.8,"sunSpecularRoughness":192,"causticsIntensity":1.5}),
    Murky: Object.assign({
      name: 'Murky',
      causticsDepthFade: 1.00
    }, {"shallowColor":[0.07058823529411765,0.24313725490196078,0.34509803921568627],"deepColor":[0.023529411764705882,0.07058823529411765,0.12549019607843137],"translucencyColor":[0.09803921568627451,0.3137254901960784,0.4117647058823529],"translucencyIntensity":0.5,"translucencyPower":2.2,"waveContrast":0.6,"extinctionDepth":65,"foamColor":[0.8235294117647058,0.8823529411764706,0.9215686274509803],"foamIntensity":0.75,"foamCoverage":0.25,"microDetail":0.45,"microFrequency":1,"opacity":0.95,"sunColor":[0.85,0.88,0.92],"sunSpecularIntensity":1.2,"sunSpecularRoughness":64,"causticsIntensity":0.2}),
    Stormy: Object.assign({
      name: 'Stormy',
      causticsDepthFade: 1.00
    }, {"shallowColor":[0.0784313725490196,0.20392156862745098,0.3058823529411765],"deepColor":[0.01568627450980392,0.047058823529411764,0.09411764705882353],"translucencyColor":[0.12549019607843137,0.3333333333333333,0.45098039215686275],"translucencyIntensity":0.8,"translucencyPower":2.4,"waveContrast":0.85,"extinctionDepth":85,"foamColor":[0.9490196078431372,0.9725490196078431,1],"foamIntensity":1.8,"foamCoverage":0.65,"microDetail":0.85,"microFrequency":1.4,"opacity":0.94,"sunColor":[0.75,0.8,0.88],"sunSpecularIntensity":3.2,"sunSpecularRoughness":64,"causticsIntensity":0.1}),
    Calm: Object.assign({
      name: 'Calm',
      causticsDepthFade: 0.35
    }, {"shallowColor":[0.058823529411764705,0.7254901960784313,0.7843137254901961],"deepColor":[0.03137254901960784,0.17647058823529413,0.35294117647058826],"translucencyColor":[0.09803921568627451,0.8235294117647058,0.8431372549019608],"translucencyIntensity":1.4,"translucencyPower":3,"waveContrast":0.4,"extinctionDepth":180,"foamColor":[1,1,1],"foamIntensity":0.2,"foamCoverage":0.1,"microDetail":0.35,"microFrequency":0.8,"opacity":0.82,"sunHeading":45,"sunElevation":40,"sunColor":[1,0.98,0.92],"sunSpecularIntensity":2.2,"sunSpecularRoughness":220,"causticsIntensity":0.6}),
    SeaOfThieves_GoldenHour: Object.assign({}, {"shallowColor":[0,0.8431372549019608,0.7254901960784313],"deepColor":[0.01568627450980392,0.08627450980392157,0.18823529411764706],"translucencyColor":[0.13725490196078433,1,0.8823529411764706],"translucencyIntensity":2.2,"translucencyPower":3,"waveContrast":0.75,"extinctionDepth":130,"foamColor":[0.9803921568627451,0.9882352941176471,1],"foamIntensity":1.1,"foamCoverage":0.35,"microDetail":0.5,"microFrequency":1,"opacity":0.88,"sunHeading":75,"sunElevation":22,"sunColor":[1,0.94,0.82],"sunSpecularIntensity":2.8,"sunSpecularRoughness":160,"causticsIntensity":0.8}, {
      name: 'Sea of Thieves - Golden Hour',
      causticsDepthFade: 0.00,
      sunHeading: 180.0,
      sunElevation: 18.0,
      sunColor: [1.0, 0.88, 0.65],
      sunSpecularIntensity: 2.6,
      sunSpecularRoughness: 128.0,
      waveContrast: 0.70,
      translucencyIntensity: 1.85,
      microFrequency: 1.0
    }),
    SeaOfThieves_Midday: Object.assign({}, {"shallowColor":[0,0.8431372549019608,0.7254901960784313],"deepColor":[0.01568627450980392,0.08627450980392157,0.18823529411764706],"translucencyColor":[0.13725490196078433,1,0.8823529411764706],"translucencyIntensity":2.2,"translucencyPower":3,"waveContrast":0.75,"extinctionDepth":130,"foamColor":[0.9803921568627451,0.9882352941176471,1],"foamIntensity":1.1,"foamCoverage":0.35,"microDetail":0.5,"microFrequency":1,"opacity":0.88,"sunHeading":75,"sunElevation":22,"sunColor":[1,0.94,0.82],"sunSpecularIntensity":2.8,"sunSpecularRoughness":160,"causticsIntensity":0.8}, {
      name: 'Sea of Thieves - Midday',
      causticsDepthFade: 0.00,
      sunHeading: 45.0,
      sunElevation: 65.0,
      sunColor: [1.0, 1.0, 0.96],
      sunSpecularIntensity: 2.0,
      sunSpecularRoughness: 160.0,
      waveContrast: 0.55
    }),
    Stormy_Dark: Object.assign({}, {"shallowColor":[0.0784313725490196,0.20392156862745098,0.3058823529411765],"deepColor":[0.01568627450980392,0.047058823529411764,0.09411764705882353],"translucencyColor":[0.12549019607843137,0.3333333333333333,0.45098039215686275],"translucencyIntensity":0.8,"translucencyPower":2.4,"waveContrast":0.85,"extinctionDepth":85,"foamColor":[0.9490196078431372,0.9725490196078431,1],"foamIntensity":1.8,"foamCoverage":0.65,"microDetail":0.85,"microFrequency":1.4,"opacity":0.94,"sunColor":[0.75,0.8,0.88],"sunSpecularIntensity":3.2,"sunSpecularRoughness":64,"causticsIntensity":0.1}, {
      name: 'Stormy - Dark',
      causticsDepthFade: 1.00,
      waveContrast: 0.85,
      sunSpecularRoughness: 64.0
    }),
    Crystal_Clear_Tropical: Object.assign({}, {"shallowColor":[0.058823529411764705,0.7254901960784313,0.7843137254901961],"deepColor":[0.03137254901960784,0.17647058823529413,0.35294117647058826],"translucencyColor":[0.09803921568627451,0.8235294117647058,0.8431372549019608],"translucencyIntensity":1.4,"translucencyPower":3,"waveContrast":0.4,"extinctionDepth":180,"foamColor":[1,1,1],"foamIntensity":0.2,"foamCoverage":0.1,"microDetail":0.35,"microFrequency":0.8,"opacity":0.82,"sunHeading":45,"sunElevation":40,"sunColor":[1,0.98,0.92],"sunSpecularIntensity":2.2,"sunSpecularRoughness":220,"causticsIntensity":0.6}, {
      name: 'Crystal Clear Tropical',
      causticsDepthFade: 0.00,
      waveContrast: 0.40
    })
  };

  /* ------------------------------------- Water Detailing: Style x Sub-style x Type x Lighting */

  /**
   * STYLE is the rendering METHOD - how the water is drawn. There is no single "stylized" switch,
   * because each stylized look is its own method. A style carries no colours at all: it bundles the
   * effect modules and scales what the type already says, so adding one costs a table entry.
   *
   * Modules map to uniforms:
   *   foamModel   0 = none, 1 = crest driven
   *   foamSoftness  widens the foam ramp; a painterly look wants soft edges, a toon look hard ones
   *   quantiseBands 0 = continuous shading, N = posterise the surface into N bands
   *   glitterScale  how much of the narrow specular lobe survives
   */
  var WATER_DETAILING_STYLES = {
    SeaOfThieves: {
      name: 'Sea of Thieves',
      // The light web reads across the whole surface, the way the game draws it.
      causticsDepthFade: 0.0,
      translucencyScale: 1.40,
      waveContrastScale: 1.15,
      foamScale: 1.25,
      sunSpecularScale: 1.10,
      foamModel: 1.0,
      foamSoftness: 1.0,
      quantiseBands: 0.0,
      glitterScale: 0.90
    },
    Realistic: {
      name: 'Realistic',
      // Caustics fade out with optical depth, so open water goes dark.
      causticsDepthFade: 1.0,
      translucencyScale: 0.70,
      waveContrastScale: 0.95,
      foamScale: 0.90,
      sunSpecularScale: 1.00,
      foamModel: 1.0,
      foamSoftness: 0.85,
      quantiseBands: 0.0,
      glitterScale: 0.55
    },
    SwimmingPool: {
      name: 'Swimming Pool',
      // A pool is a rendering approach, not a sea state: caustics dominate, the floor reads
      // through, and there are no whitecaps at all.
      causticsDepthFade: 0.0,
      translucencyScale: 0.45,
      waveContrastScale: 0.60,
      foamScale: 0.0,
      sunSpecularScale: 0.90,
      causticsBoost: 1.8,
      foamModel: 0.0,
      foamSoftness: 1.0,
      quantiseBands: 0.0,
      glitterScale: 0.30
    },
    Toon: {
      name: 'Toon',
      causticsDepthFade: 0.0,
      translucencyScale: 1.20,
      waveContrastScale: 1.30,
      foamScale: 1.35,
      sunSpecularScale: 0.80,
      foamModel: 1.0,
      // Hard foam edges and a posterised surface.
      foamSoftness: 0.25,
      quantiseBands: 4.0,
      glitterScale: 0.15
    },
    Painterly: {
      name: 'Painterly',
      causticsDepthFade: 0.35,
      translucencyScale: 1.25,
      waveContrastScale: 0.85,
      foamScale: 1.05,
      sunSpecularScale: 0.85,
      foamModel: 1.0,
      // Soft, smeared edges and almost no glint.
      foamSoftness: 2.2,
      quantiseBands: 0.0,
      glitterScale: 0.12
    }
  };

  /**
   * SUB-STYLE is the MEDIUM - what the liquid is. It owns how the water behaves rather than how it
   * is drawn: whether it foams at all, how long that foam survives, and its base clarity and cast.
   *
   * foamDecay is a real number: measured whitecap decay is ~3.85 s in salt water against ~2.54 s in
   * fresh. It is stored here for the foam buffer (Phase 2) and, until then, shapes how readily foam
   * appears through foamCoverageScale.
   */
  var WATER_DETAILING_SUBSTYLES = {
    SaltWater: {
      name: 'Salt Water',
      foamDecay: 3.85,
      foamCoverageScale: 1.00,
      extinctionScale: 1.00,
      tint: [1.00, 1.00, 1.00]
    },
    FreshWater: {
      name: 'Fresh Water',
      // Freshwater bubbles coalesce and burst, so lakes and rivers rarely whitecap.
      foamDecay: 2.54,
      foamCoverageScale: 0.45,
      // More dissolved organics: shorter optical path and a green cast.
      extinctionScale: 0.55,
      tint: [0.82, 1.06, 0.88]
    },
    PoolWater: {
      name: 'Pool Water',
      // Chlorinated and near-particulate-free: essentially non-foaming and very clear.
      foamDecay: 1.00,
      foamCoverageScale: 0.05,
      extinctionScale: 1.60,
      tint: [0.90, 1.05, 1.12]
    }
  };

  /**
   * TYPE is the CONDITION the water is in - agitation, silt, clarity - layered on the medium. It
   * still owns the palette, because a condition is what you actually see.
   */
  var WATER_DETAILING_TYPES = {
    Clear: Object.assign({}, WATER_DETAILING_PRESETS.SeaOfThieves, { name: 'Clear' }),
    Tropical: Object.assign({}, WATER_DETAILING_PRESETS.Crystal_Clear_Tropical, { name: 'Tropical' }),
    Calm: Object.assign({}, WATER_DETAILING_PRESETS.Calm, { name: 'Calm' }),
    Choppy: Object.assign({}, WATER_DETAILING_PRESETS.SeaOfThieves, {
      name: 'Choppy',
      foamIntensity: 1.35,
      foamCoverage: 0.48,
      waveContrast: 0.80
    }),
    Murky: Object.assign({}, WATER_DETAILING_PRESETS.Murky, { name: 'Murky' }),
    Stormy: Object.assign({}, WATER_DETAILING_PRESETS.Stormy, { name: 'Stormy' })
  };

  /**
   * FOAM is its own axis. Style says how the water is drawn, Sub-style what liquid it is, Type what
   * condition it is in - none of them say what the whitecaps themselves look like, and that is a
   * separate art decision. A gale on the North Sea and a reef break in Fiji can share a palette and
   * still have completely different foam.
   *
   * These are not coverage numbers with different names. Each one moves the four controls that
   * change foam's CHARACTER:
   *   scale  - how big one clump of foam is
   *   streak - how far the wind draws that clump out (1 = round, 8 = long parallel bands)
   *   bite   - contrast of the break-up noise (low = soft spume, high = hard-edged islands)
   *   trail  - how much foam is left hanging below the crest after it passes
   */
  var WATER_DETAILING_FOAM = {
    Natural: {
      name: 'Natural',
      // The open-ocean default, and what every earlier version drew.
      foamScale: 1.00, foamStreak: 4.5, foamBite: 1.00, foamTrail: 1.00,
      foamSoftness: 0.85, foamCoverageScale: 1.00, foamIntensityScale: 1.00
    },
    SeaOfThieves: {
      name: 'Sea of Thieves',
      // Big soft sheets that hang on the back of the wave. Rare's foam is generous and readable
      // from a distance rather than physically sparse.
      foamScale: 0.55, foamStreak: 3.0, foamBite: 0.70, foamTrail: 1.60,
      foamSoftness: 1.15, foamCoverageScale: 1.25, foamIntensityScale: 1.15
    },
    Whitecaps: {
      name: 'Whitecaps',
      // Sparse, small, high contrast: individual breaking crests with clean water between them.
      foamScale: 1.60, foamStreak: 2.2, foamBite: 1.80, foamTrail: 0.35,
      foamSoftness: 0.55, foamCoverageScale: 0.75, foamIntensityScale: 1.00
    },
    StormStreaks: {
      name: 'Storm Streaks',
      // Beaufort 8 and up: the wind stops letting foam sit in patches and drags it into the long
      // parallel bands that give a gale its direction.
      foamScale: 0.75, foamStreak: 9.0, foamBite: 1.25, foamTrail: 2.20,
      foamSoftness: 1.00, foamCoverageScale: 1.15, foamIntensityScale: 1.05
    },
    Surf: {
      name: 'Surf',
      // Shorewater: fine aerated bubbles, low contrast, and it lingers.
      foamScale: 2.40, foamStreak: 1.3, foamBite: 0.55, foamTrail: 1.80,
      foamSoftness: 1.30, foamCoverageScale: 1.20, foamIntensityScale: 0.95
    },
    Painted: {
      name: 'Painted',
      // Hard-edged flat shapes with no fine detail - foam as an illustrator would ink it.
      foamScale: 0.40, foamStreak: 2.6, foamBite: 3.20, foamTrail: 0.70,
      foamSoftness: 0.25, foamCoverageScale: 1.00, foamIntensityScale: 1.10
    },
    Minimal: {
      name: 'Minimal',
      // Almost nothing, for calm or stylised water that should not be busy.
      foamScale: 1.20, foamStreak: 3.0, foamBite: 1.40, foamTrail: 0.20,
      foamSoftness: 0.70, foamCoverageScale: 0.35, foamIntensityScale: 0.80
    }
  };

  function resolveWaterDetailingFoam(name) {
    if (!name || typeof name !== 'string') return null;
    var key = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (key === 'natural' || key === 'default' || key === 'ocean') return WATER_DETAILING_FOAM.Natural;
    if (key === 'seaofthieves' || key === 'sot' || key === 'stylized' || key === 'stylised') {
      return WATER_DETAILING_FOAM.SeaOfThieves;
    }
    if (key === 'whitecaps' || key === 'whitehorses' || key === 'realistic' || key === 'sparse') {
      return WATER_DETAILING_FOAM.Whitecaps;
    }
    if (key === 'stormstreaks' || key === 'streaks' || key === 'storm' || key === 'gale') {
      return WATER_DETAILING_FOAM.StormStreaks;
    }
    if (key === 'surf' || key === 'shore' || key === 'bubbly' || key === 'beach') {
      return WATER_DETAILING_FOAM.Surf;
    }
    if (key === 'painted' || key === 'painterly' || key === 'toon' || key === 'inked') {
      return WATER_DETAILING_FOAM.Painted;
    }
    if (key === 'minimal' || key === 'none' || key === 'subtle' || key === 'clean') {
      return WATER_DETAILING_FOAM.Minimal;
    }
    return null;
  }

  function resolveWaterDetailingStyle(name) {
    if (!name || typeof name !== 'string') return null;
    var key = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (key === 'seaofthieves' || key === 'sot' || key === 'stylized' || key === 'stylised') {
      return WATER_DETAILING_STYLES.SeaOfThieves;
    }
    if (key === 'realistic' || key === 'photoreal' || key === 'physical') {
      return WATER_DETAILING_STYLES.Realistic;
    }
    if (key === 'swimmingpool' || key === 'pool' || key === 'chlorinated') {
      return WATER_DETAILING_STYLES.SwimmingPool;
    }
    if (key === 'toon' || key === 'cel' || key === 'cellshaded' || key === 'cartoon') {
      return WATER_DETAILING_STYLES.Toon;
    }
    if (key === 'painterly' || key === 'painted' || key === 'ghibli') {
      return WATER_DETAILING_STYLES.Painterly;
    }
    return null;
  }

  function resolveWaterDetailingSubStyle(name) {
    if (!name || typeof name !== 'string') return null;
    var key = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (key === 'saltwater' || key === 'salt' || key === 'sea' || key === 'seawater' || key === 'ocean') {
      return WATER_DETAILING_SUBSTYLES.SaltWater;
    }
    if (key === 'freshwater' || key === 'fresh' || key === 'lake' || key === 'river') {
      return WATER_DETAILING_SUBSTYLES.FreshWater;
    }
    if (key === 'poolwater' || key === 'pool' || key === 'swimmingpool' || key === 'chlorinated') {
      return WATER_DETAILING_SUBSTYLES.PoolWater;
    }
    return null;
  }

  function resolveWaterDetailingType(name) {
    if (!name || typeof name !== 'string') return null;
    var key = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (key === 'clear' || key === 'openocean' || key === 'ocean' || key === 'seaofthieves') {
      return WATER_DETAILING_TYPES.Clear;
    }
    if (key === 'tropical' || key === 'cleartropical' || key === 'crystalcleartropical' || key === 'lagoon') {
      return WATER_DETAILING_TYPES.Tropical;
    }
    if (key === 'calm' || key === 'calmwater' || key === 'glassy') return WATER_DETAILING_TYPES.Calm;
    if (key === 'choppy' || key === 'wavy' || key === 'breezy') return WATER_DETAILING_TYPES.Choppy;
    if (key === 'murky' || key === 'murkywater' || key === 'swamp') return WATER_DETAILING_TYPES.Murky;
    if (key === 'stormy' || key === 'storm' || key === 'tempest' || key === 'stormydark') {
      return WATER_DETAILING_TYPES.Stormy;
    }
    // A pool used to be a type; it is a medium now, so send it to the closest condition.
    if (key === 'swimmingpool' || key === 'poolwater') return WATER_DETAILING_TYPES.Calm;
    return null;
  }

  /**
   * Combines the axes. Order matters and each step has a reason:
   *   type      supplies the palette and optics you actually see,
   *   sub-style constrains it - "murky" means something different in a lake than in the open sea,
   *   lighting  replaces the sun outright,
   *   style     scales what is left, so it shapes whichever medium and hour were chosen.
   */
  function composeWaterDetailingLook(style, type, lighting, subStyle, foam) {
    var look = Object.assign({}, type);

    if (subStyle) {
      look.subStyleName = subStyle.name;
      look.foamDecay = subStyle.foamDecay;
      if (look.foamCoverage !== undefined) {
        look.foamCoverage = clamp(look.foamCoverage * subStyle.foamCoverageScale, 0.0, 1.0);
      }
      if (look.extinctionDepth !== undefined) {
        look.extinctionDepth = Math.max(1.0, look.extinctionDepth * subStyle.extinctionScale);
      }
      // The medium tints the palette rather than replacing it, so a condition stays recognisable.
      for (var ci = 0; ci < 2; ci++) {
        var field = ci === 0 ? 'shallowColor' : 'deepColor';
        if (look[field]) {
          look[field] = [
            clamp(look[field][0] * subStyle.tint[0], 0.0, 1.0),
            clamp(look[field][1] * subStyle.tint[1], 0.0, 1.0),
            clamp(look[field][2] * subStyle.tint[2], 0.0, 1.0)
          ];
        }
      }
    }

    if (lighting) {
      look.lightingName = lighting.name;
      look.sunHeading = lighting.sunHeading;
      look.sunElevation = lighting.sunElevation;
      look.sunColor = lighting.sunColor.slice();
      look.sunSpecularIntensity = lighting.sunSpecularIntensity;
      look.sunSpecularRoughness = lighting.sunSpecularRoughness;
    }

    if (!style) return look;

    look.styleName = style.name;
    look.causticsDepthFade = style.causticsDepthFade;
    // Effect modules travel with the style.
    look.foamModel = style.foamModel;
    look.foamSoftness = style.foamSoftness;
    look.quantiseBands = style.quantiseBands;
    look.glitterScale = style.glitterScale;
    if (style.causticsBoost !== undefined && look.causticsIntensity !== undefined) {
      look.causticsIntensity = Math.max(0.0, look.causticsIntensity * style.causticsBoost);
    }
    if (look.translucencyIntensity !== undefined) {
      look.translucencyIntensity = Math.max(0.0, look.translucencyIntensity * style.translucencyScale);
    }
    if (look.waveContrast !== undefined) {
      look.waveContrast = clamp(look.waveContrast * style.waveContrastScale, 0.0, 1.0);
    }
    if (look.foamIntensity !== undefined) {
      look.foamIntensity = Math.max(0.0, look.foamIntensity * style.foamScale);
    }
    if (look.sunSpecularIntensity !== undefined) {
      look.sunSpecularIntensity = Math.max(0.0, look.sunSpecularIntensity * style.sunSpecularScale);
    }
    // FOAM LAST. The other three axes each nudge foam coverage as a side effect of what they are
    // really for; this axis exists to decide what the whitecaps look like, so it gets the final say.
    if (foam) {
      look.foamName = foam.name;
      look.foamScale = foam.foamScale;
      look.foamStreak = foam.foamStreak;
      look.foamBite = foam.foamBite;
      look.foamTrail = foam.foamTrail;
      if (foam.foamSoftness !== undefined) look.foamSoftness = foam.foamSoftness;
      if (look.foamCoverage !== undefined && foam.foamCoverageScale !== undefined) {
        look.foamCoverage = clamp(look.foamCoverage * foam.foamCoverageScale, 0.0, 1.0);
      }
      if (look.foamIntensity !== undefined && foam.foamIntensityScale !== undefined) {
        look.foamIntensity = Math.max(0.0, look.foamIntensity * foam.foamIntensityScale);
      }
    }

    return look;
  }

  /**
   * LIGHTING is the sun - heading, elevation, colour and the specular lobe it casts. It owns
   * nothing else, so the same water in the same style can be shot at any hour. Adding a sunrise or
   * an overcast sky is one entry here and one more value in the property's choice list.
   */
  var WATER_DETAILING_LIGHTING = {
    GoldenHour: {
      name: 'Golden Hour',
      sunHeading: 180.0,
      sunElevation: 18.0,
      sunColor: [1.0, 0.88, 0.65],
      sunSpecularIntensity: 2.6,
      sunSpecularRoughness: 128.0
    },
    Midday: {
      name: 'Midday',
      sunHeading: 45.0,
      sunElevation: 65.0,
      sunColor: [1.0, 1.0, 0.96],
      sunSpecularIntensity: 2.0,
      sunSpecularRoughness: 160.0
    }
  };

  function resolveWaterDetailingLighting(name) {
    if (!name || typeof name !== 'string') return null;
    var key = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (key === 'goldenhour' || key === 'golden' || key === 'sunset' || key === 'sunrise') {
      return WATER_DETAILING_LIGHTING.GoldenHour;
    }
    if (key === 'midday' || key === 'noon' || key === 'middaysun') {
      return WATER_DETAILING_LIGHTING.Midday;
    }
    return null;
  }

  function resolveWaterDetailingPreset(name) {
    if (!name || typeof name !== 'string') return null;
    var key = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (key === 'swimmingpool' || key === 'pool' || key === 'resortpool') {
      return WATER_DETAILING_PRESETS.SwimmingPool;
    }
    if (key === 'seaofthieves' || key === 'sot' || key === 'caribbean' || key === 'caribbeanocean') {
      return WATER_DETAILING_PRESETS.SeaOfThieves;
    }
    if (key === 'murky' || key === 'swamp' || key === 'murkyocean' || key === 'darkmurky') {
      return WATER_DETAILING_PRESETS.Murky;
    }
    if (key === 'stormydark') {
      return WATER_DETAILING_PRESETS.Stormy_Dark;
    }
    if (key === 'stormy' || key === 'storm' || key === 'rough' || key === 'tempest') {
      return WATER_DETAILING_PRESETS.Stormy;
    }
    if (key === 'crystalcleartropical') {
      return WATER_DETAILING_PRESETS.Crystal_Clear_Tropical;
    }
    if (key === 'calm' || key === 'calmwater' || key === 'peaceful' || key === 'glassy') {
      return WATER_DETAILING_PRESETS.Calm;
    }
    if (key === 'goldenhour' || key === 'sunset' || key === 'sotgoldenhour' || key === 'seaofthievesgoldenhour') {
      return WATER_DETAILING_PRESETS.SeaOfThieves_GoldenHour;
    }
    if (key === 'midday' || key === 'seaofthievesmidday') {
      return WATER_DETAILING_PRESETS.SeaOfThieves_Midday;
    }
    return null;
  }

  function numOrParse(value, fallback) {
    if (typeof value === 'number' && isFinite(value)) return value;
    if (typeof value === 'string') {
      var p = parseFloat(value);
      if (isFinite(p)) return p;
    }
    return fallback;
  }

  function parseNormalizedColor(input, fallback) {
    if (Array.isArray(input)) {
      if (input.length >= 3 && (input[0] > 1.0 || input[1] > 1.0 || input[2] > 1.0)) {
        return [clamp(input[0] / 255.0, 0.0, 1.0), clamp(input[1] / 255.0, 0.0, 1.0), clamp(input[2] / 255.0, 0.0, 1.0)];
      }
      return [clamp(numOrParse(input[0], 0.0), 0.0, 1.0), clamp(numOrParse(input[1], 0.0), 0.0, 1.0), clamp(numOrParse(input[2], 0.0), 0.0, 1.0)];
    }
    var raw = parseColor(input, null);
    if (raw) {
      return [clamp(raw[0] / 255.0, 0.0, 1.0), clamp(raw[1] / 255.0, 0.0, 1.0), clamp(raw[2] / 255.0, 0.0, 1.0)];
    }
    return fallback ? [fallback[0], fallback[1], fallback[2]] : [0.2, 0.8, 0.8];
  }

  function formatColor255(norm) {
    if (!norm) return '255;255;255';
    return Math.round(clamp(norm[0], 0, 1) * 255) + ';' +
           Math.round(clamp(norm[1], 0, 1) * 255) + ';' +
           Math.round(clamp(norm[2], 0, 1) * 255);
  }

  function setUniformVec3(uniform, arr) {
    if (!uniform) return;
    if (uniform.value && typeof uniform.value.set === 'function') {
      uniform.value.set(arr[0], arr[1], arr[2]);
    } else {
      uniform.value = (typeof THREE !== 'undefined' && THREE.Vector3)
        ? new THREE.Vector3(arr[0], arr[1], arr[2])
        : { x: arr[0], y: arr[1], z: arr[2] };
    }
  }

  function setUniformScalar(uniform, val) {
    if (!uniform) return;
    uniform.value = val;
  }

  function syncSceneLightingAndSky(runtimeScene, target) {
    if (!runtimeScene || !target || !target.material || !target.material.uniforms) return;
    var u = target.material.uniforms;
    var layerName = target.layerName || '';
    var threeScene = null;
    try {
      var layer = runtimeScene.getLayer ? runtimeScene.getLayer(layerName) : null;
      var rend = layer && layer.getRenderer ? layer.getRenderer() : null;
      threeScene = rend && typeof rend.getThreeScene === 'function' ? rend.getThreeScene() : null;
    } catch (e) { threeScene = null; }

    if (threeScene) {
      // 1. Skybox / Environment Map reflection
      var env = threeScene.environment || threeScene.background;
      if (env && (env.isCubeTexture || (env.image && env.image.length === 6))) {
        if (u.u_EnvMap) u.u_EnvMap.value = env;
        if (u.u_HasEnvMap) u.u_HasEnvMap.value = 1.0;
      } else {
        if (u.u_HasEnvMap) u.u_HasEnvMap.value = 0.0;
      }

      // 2. Directional Light / Sun Direction sync (if not driven by WaterDetailing3D)
      var hasDetailing = false;
      var state = getSceneState(runtimeScene);
      if (state && state.waterDetailings && state.waterDetailings.length > 0) {
        for (var di = 0; di < state.waterDetailings.length; di++) {
          if (state.waterDetailings[di].object === target.object) {
            hasDetailing = true;
            break;
          }
        }
      }

      if (!hasDetailing && !target.hasCustomSun && typeof threeScene.traverse === 'function') {
        var sunLight = null;
        threeScene.traverse(function (child) {
          if (!sunLight && child && child.isDirectionalLight) {
            sunLight = child;
          }
        });
        if (sunLight && u.u_SunDirection && u.u_SunDirection.value) {
          var lx = 0.5, ly = 0.8, lz = 1.0;
          try {
            var lp = (typeof THREE !== 'undefined' && typeof THREE.Vector3 === 'function')
              ? new THREE.Vector3()
              : {
                  x: 0, y: 0, z: 0,
                  set: function (x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
                };
            if (!lp.setFromMatrixPosition) {
              lp.setFromMatrixPosition = function (m) {
                if (m && m.elements) {
                  this.x = m.elements[12];
                  this.y = m.elements[13];
                  this.z = m.elements[14];
                }
                return this;
              };
            }
            if (typeof sunLight.getWorldPosition === 'function') {
              sunLight.getWorldPosition(lp);
              if (sunLight.target && typeof sunLight.target.getWorldPosition === 'function') {
                var tp = (typeof THREE !== 'undefined' && typeof THREE.Vector3 === 'function')
                  ? new THREE.Vector3()
                  : {
                      x: 0, y: 0, z: 0,
                      set: function (x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
                    };
                if (!tp.setFromMatrixPosition) {
                  tp.setFromMatrixPosition = function (m) {
                    if (m && m.elements) {
                      this.x = m.elements[12];
                      this.y = m.elements[13];
                      this.z = m.elements[14];
                    }
                    return this;
                  };
                }
                sunLight.target.getWorldPosition(tp);
                lx = lp.x - tp.x;
                ly = lp.y - tp.y;
                lz = lp.z - tp.z;
              } else {
                lx = lp.x; ly = lp.y; lz = lp.z;
              }
            } else if (typeof sunLight.getWorldDirection === 'function') {
              var wd = (typeof THREE !== 'undefined' && typeof THREE.Vector3 === 'function')
                ? new THREE.Vector3()
                : { x: 0, y: 0, z: 0, set: function (x, y, z) { this.x = x; this.y = y; this.z = z; return this; } };
              sunLight.getWorldDirection(wd);
              lx = -wd.x; ly = -wd.y; lz = -wd.z;
            } else if (sunLight.position) {
              lx = sunLight.position.x || 0.5;
              ly = sunLight.position.y || 0.8;
              lz = sunLight.position.z || 1.0;
            }
          } catch (ePos) {
            if (sunLight.position) {
              lx = sunLight.position.x || 0.5;
              ly = sunLight.position.y || 0.8;
              lz = sunLight.position.z || 1.0;
            }
          }
          var dLen = Math.sqrt(lx * lx + ly * ly + lz * lz);
          if (dLen > 0.0001) {
            lx /= dLen; ly /= dLen; lz /= dLen;
            if (u.u_SunDirection.value.set) {
              u.u_SunDirection.value.set(lx, ly, lz);
            } else if (u.u_SunDirection.value.copy) {
              u.u_SunDirection.value.copy({ x: lx, y: ly, z: lz });
            } else {
              u.u_SunDirection.value.x = lx;
              u.u_SunDirection.value.y = ly;
              u.u_SunDirection.value.z = lz;
            }
            if (!target.hasCustomSunColor && u.u_SunColor && u.u_SunColor.value && sunLight.color) {
              var intensity = sunLight.intensity !== undefined ? sunLight.intensity : 1.0;
              var cr = (sunLight.color.r !== undefined ? sunLight.color.r : 1.0) * intensity;
              var cg = (sunLight.color.g !== undefined ? sunLight.color.g : 0.96) * intensity;
              var cb = (sunLight.color.b !== undefined ? sunLight.color.b : 0.88) * intensity;
              if (u.u_SunColor.value.set) {
                u.u_SunColor.value.set(cr, cg, cb);
              } else if (u.u_SunColor.value.copy) {
                u.u_SunColor.value.copy({ x: cr, y: cg, z: cb });
              } else {
                u.u_SunColor.value.x = cr;
                u.u_SunColor.value.y = cg;
                u.u_SunColor.value.z = cb;
              }
            }
          }
        }
      }
    }
  }

  function applyPaletteToMaterial(profile, material) {
    if (!profile || !material || !material.uniforms) return;
    var u = material.uniforms;
    if (profile.shallowColor && u.u_ShallowColor) {
      setUniformVec3(u.u_ShallowColor, profile.shallowColor);
    }
    if (profile.deepColor && u.u_DeepColor) {
      setUniformVec3(u.u_DeepColor, profile.deepColor);
    }
    if (profile.translucencyColor && u.u_TranslucencyColor) {
      setUniformVec3(u.u_TranslucencyColor, profile.translucencyColor);
    }
    if (profile.translucencyIntensity !== undefined && u.u_TranslucencyIntensity) {
      u.u_TranslucencyIntensity.value = profile.translucencyIntensity;
    }
    if (profile.translucencyPower !== undefined && u.u_TranslucencyPower) {
      u.u_TranslucencyPower.value = profile.translucencyPower;
    }
    if (profile.foamColor && u.u_FoamColor) {
      setUniformVec3(u.u_FoamColor, profile.foamColor);
    }
    if (profile.foamIntensity !== undefined && u.u_CrestFoamIntensity) {
      // Some shaders name it u_CrestFoamIntensity; the ocean shaders use u_FoamIntensity.
      u.u_CrestFoamIntensity.value = profile.foamIntensity;
    }
    if (profile.foamIntensity !== undefined && u.u_FoamIntensity) {
      u.u_FoamIntensity.value = profile.foamIntensity;
    }
    if (profile.foamCoverage !== undefined && u.u_FoamCoverage) {
      u.u_FoamCoverage.value = profile.foamCoverage;
    }
    if (profile.extinctionDepth !== undefined && u.u_ExtinctionDepth) {
      u.u_ExtinctionDepth.value = profile.extinctionDepth;
    }
    if (profile.waveContrast !== undefined && u.u_WaveContrast) {
      u.u_WaveContrast.value = profile.waveContrast;
    }
    if (profile.opacity !== undefined && u.u_Opacity) {
      u.u_Opacity.value = profile.opacity;
    }
    if (profile.causticsIntensity !== undefined && u.u_CausticsIntensity) {
      u.u_CausticsIntensity.value = profile.causticsIntensity;
    }
    if (profile.causticsDepthFade !== undefined && u.u_CausticsDepthFade) {
      u.u_CausticsDepthFade.value = profile.causticsDepthFade;
    }
    if (profile.microDetail !== undefined && u.u_MicroDetail) {
      u.u_MicroDetail.value = profile.microDetail;
    }
    if (profile.microFrequency !== undefined && u.u_MicroFrequency) {
      u.u_MicroFrequency.value = profile.microFrequency;
    }
    if (profile.sunSpecularIntensity !== undefined && u.u_SunSpecularIntensity) {
      u.u_SunSpecularIntensity.value = profile.sunSpecularIntensity;
    }
    if (profile.sunSpecularRoughness !== undefined && u.u_SunSpecularRoughness) {
      u.u_SunSpecularRoughness.value = profile.sunSpecularRoughness;
    }
    if (profile.sunColor && u.u_SunColor) {
      setUniformVec3(u.u_SunColor, profile.sunColor);
    }
  }

  function applyWaterDetailingToMaterial(det, material) {
    if (!material || !material.uniforms) return;
    var u = material.uniforms;

    // The foam axis. Only the spectral ocean's shader carries these, so the guards matter: the
    // Gerstner water simply keeps its own foam and takes the coverage/intensity part of the preset.
    if (u.u_FoamScale && det.foamScale !== undefined) u.u_FoamScale.value = det.foamScale;
    if (u.u_FoamStreak && det.foamStreak !== undefined) u.u_FoamStreak.value = det.foamStreak;
    if (u.u_FoamBite && det.foamBite !== undefined) u.u_FoamBite.value = det.foamBite;
    if (u.u_FoamTrail && det.foamTrail !== undefined) u.u_FoamTrail.value = det.foamTrail;

    var radH = (det.sunHeading || 0.0) * (Math.PI / 180.0);
    var radE = Math.max(0.01, Math.min(89.9, det.sunElevation !== undefined ? det.sunElevation : 18.0)) * (Math.PI / 180.0);
    var cosE = Math.cos(radE);
    var sinE = Math.sin(radE);
    var sx = cosE * Math.cos(radH);
    var sy = cosE * Math.sin(radH);
    var sz = sinE;

    if (u.u_SunDirection) setUniformVec3(u.u_SunDirection, [sx, sy, sz]);
    if (u.u_SunColor) setUniformVec3(u.u_SunColor, det.sunColor);
    if (u.u_SunSpecularIntensity) setUniformScalar(u.u_SunSpecularIntensity, det.sunSpecularIntensity);
    if (u.u_SunSpecularRoughness) setUniformScalar(u.u_SunSpecularRoughness, det.sunSpecularRoughness);
    if (u.u_WaveContrast) setUniformScalar(u.u_WaveContrast, det.waveContrast);
    if (u.u_ShallowColor) setUniformVec3(u.u_ShallowColor, det.shallowColor);
    if (u.u_DeepColor) setUniformVec3(u.u_DeepColor, det.deepColor);
    if (u.u_ExtinctionDepth) setUniformScalar(u.u_ExtinctionDepth, det.extinctionDepth);
    if (u.u_TranslucencyColor) setUniformVec3(u.u_TranslucencyColor, det.translucencyColor);
    if (u.u_TranslucencyIntensity) setUniformScalar(u.u_TranslucencyIntensity, det.translucencyIntensity);
    if (u.u_TranslucencyPower) setUniformScalar(u.u_TranslucencyPower, det.translucencyPower);
    if (u.u_FoamColor) setUniformVec3(u.u_FoamColor, det.foamColor);
    if (u.u_FoamIntensity) setUniformScalar(u.u_FoamIntensity, det.foamIntensity);
    if (u.u_CrestFoamIntensity) setUniformScalar(u.u_CrestFoamIntensity, det.foamIntensity);
    if (u.u_FoamCoverage) setUniformScalar(u.u_FoamCoverage, det.foamCoverage);
    // Caustics belong to the look, so the detailing preset owns them too - without this the water
    // behavior's own value survived and a storm kept a lagoon's caustics.
    if (u.u_CausticsIntensity && det.causticsIntensity !== undefined) {
      setUniformScalar(u.u_CausticsIntensity, det.causticsIntensity);
    }
    if (u.u_CausticsDepthFade && det.causticsDepthFade !== undefined) {
      setUniformScalar(u.u_CausticsDepthFade, det.causticsDepthFade);
    }
    // Effect modules. Absent uniforms are skipped, so a shader that does not implement a module
    // simply ignores it rather than failing.
    if (u.u_FoamModel && det.foamModel !== undefined) setUniformScalar(u.u_FoamModel, det.foamModel);
    if (u.u_FoamSoftness && det.foamSoftness !== undefined) setUniformScalar(u.u_FoamSoftness, det.foamSoftness);
    if (u.u_QuantiseBands && det.quantiseBands !== undefined) setUniformScalar(u.u_QuantiseBands, det.quantiseBands);
    if (u.u_GlitterScale && det.glitterScale !== undefined) setUniformScalar(u.u_GlitterScale, det.glitterScale);
    if (u.u_MicroDetail) setUniformScalar(u.u_MicroDetail, det.microDetail);
    if (u.u_MicroFrequency) setUniformScalar(u.u_MicroFrequency, det.microFrequency);
    if (u.u_Opacity) setUniformScalar(u.u_Opacity, det.opacity);
  }



  /**
   * The SPH solver runs in metres so its kernel radius and gravity are physically meaningful,
   * while GDevelop scenes are in pixels. 100 px = 1 m, matching Physics3D's default world scale.
   */
  var SPH_WORLD_SCALE = 0.01;
  var SPH_WORLD_INV_SCALE = 1.0 / SPH_WORLD_SCALE;

  /** Volume of one spherical droplet, in litres — the unit ContainerCapacity is expressed in. */
  /**
   * Fluid presets are chosen from a Choice property whose values are human readable ("Magic
   * Potion"), while the table is keyed by identifier ("MagicPotion"). Normalising both sides
   * means either spelling resolves, so projects saved before the names were made readable keep
   * working. An unknown name falls back to Custom, as it always did.
   */
  function resolveFluidPreset(name) {
    if (!name || typeof name !== 'string') return FLUID_PRESETS.Custom;
    if (FLUID_PRESETS[name]) return FLUID_PRESETS[name];
    var key = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
    for (var presetName in FLUID_PRESETS) {
      if (!Object.prototype.hasOwnProperty.call(FLUID_PRESETS, presetName)) continue;
      if (presetName.toLowerCase().replace(/[^a-z0-9]+/g, '') === key) return FLUID_PRESETS[presetName];
    }
    return FLUID_PRESETS.Custom;
  }
  function dropletVolumeLitres(radiusMetres) {
    var r = radiusMetres > 0 ? radiusMetres : 0.02;
    return (4.0 / 3.0) * Math.PI * r * r * r * 1000.0;
  }

  var DEFAULT_BASE_WAVELENGTH = 300.0;

  /**
   * Resolves the per-octave parameters shared by the CPU solver and the GLSL vertex shader. Both
   * MUST derive them the same way or buoyancy drifts out of phase with the surface you can see.
   *
   * `minWavelength` is the shortest wave the water mesh can actually represent, derived from its
   * vertex spacing. Octaves below it are faded out rather than drawn: a Gerstner wave sampled at
   * fewer than a handful of vertices per wavelength does not read as a wave, it reads as a
   * crosshatch of sampling noise.
   */
  function octaveFade(wavelength, minWavelength) {
    if (!(minWavelength > 0)) return 1.0;
    var lo = minWavelength * 0.5;
    var hi = minWavelength;
    if (wavelength <= lo) return 0.0;
    if (wavelength >= hi) return 1.0;
    var t = (wavelength - lo) / (hi - lo);
    return t * t * (3.0 - 2.0 * t); // smoothstep
  }

  function resolveWaveParams(cfg) {
    var waveTiling = (cfg.waveTiling !== undefined && cfg.waveTiling > 0) ? cfg.waveTiling : 1.0;
    return {
      baseAmp: (cfg.waveHeight !== undefined ? cfg.waveHeight : 18.0) * 0.5,
      choppiness: cfg.waveChoppiness !== undefined ? cfg.waveChoppiness : 0.75,
      speed: cfg.waveSpeed !== undefined ? cfg.waveSpeed : 1.0,
      windRad: ((cfg.windDirection !== undefined ? cfg.windDirection : 45.0) * Math.PI) / 180.0,
      baseWavelength: (cfg.baseWavelength > 0 ? cfg.baseWavelength : DEFAULT_BASE_WAVELENGTH) / waveTiling,
      minWavelength: cfg.minWavelength > 0 ? cfg.minWavelength : 0.0,
      // The octave table's directions are authored around a 45 degree fan; this rescales them.
      // 0 collapses every wave onto the wind for pure rolling swell, 90 doubles the spread.
      dirSpread: (cfg.directionalSpread !== undefined ? cfg.directionalSpread : 45.0) / 45.0,
      phaseSeed: cfg.phaseSeed || 0.0,
      // Warps each crest along its perpendicular axis. This breaks the last visible straight,
      // repeating Gerstner bands without introducing frame-to-frame noise or CPU/GPU disagreement.
      irregularity: clamp(cfg.waveIrregularity !== undefined ? cfg.waveIrregularity : 0.4, 0.0, 1.0)
    };
  }

  function evaluateGerstnerDisplacement(x, y, time, cfg, outPos) {
    var P = resolveWaveParams(cfg);

    var dx = 0.0;
    var dy = 0.0;
    var dz = 0.0;

    var count = GERSTNER_OCTAVES.length;
    for (var i = 0; i < count; i++) {
      var oct = GERSTNER_OCTAVES[i];
      var wavelength = P.baseWavelength * oct.lenRatio;
      var a = P.baseAmp * oct.ampRatio * octaveFade(wavelength, P.minWavelength);
      if (a === 0.0) continue;

      var angle = P.windRad + (oct.dirOffset * P.dirSpread * Math.PI) / 180.0;
      var dirX = Math.cos(angle);
      var dirY = Math.sin(angle);

      var k = (2.0 * Math.PI) / Math.max(wavelength, 1.0);
      var w = Math.sqrt(GRAVITY * k) * oct.speedMul * P.speed;
      var q = Math.min((P.choppiness * oct.steepness) / (k * a * count + 0.0001), 1.0);

      var phase = k * (dirX * x + dirY * y) - w * time + oct.phase +
        P.phaseSeed * oct.lenRatio * 6.2831853;
      var wanderRate = 0.045 + 0.035 * (1.0 - oct.lenRatio);
      var crossCoord = -dirY * x + dirX * y;
      var wanderArg = k * crossCoord * 0.37 + time * wanderRate +
        oct.phase * 1.731 + P.phaseSeed * (0.37 + oct.lenRatio);
      phase += P.irregularity * 0.55 * Math.sin(wanderArg);
      var sinP = Math.sin(phase);
      var cosP = Math.cos(phase);

      dx -= q * a * dirX * sinP;
      dy -= q * a * dirY * sinP;
      dz += a * cosP;
    }

    if (outPos) {
      outPos.x = x + dx;
      outPos.y = y + dy;
      outPos.z = (cfg.baseZ || 0) + dz;
      return outPos;
    }
    return dz;
  }

  function evaluateGerstnerNormal(x, y, time, cfg, outNormal) {
    var P = resolveWaveParams(cfg);

    var nx = 0.0;
    var ny = 0.0;
    var nz = 1.0;

    var count = GERSTNER_OCTAVES.length;
    for (var i = 0; i < count; i++) {
      var oct = GERSTNER_OCTAVES[i];
      var wavelength = P.baseWavelength * oct.lenRatio;
      var a = P.baseAmp * oct.ampRatio * octaveFade(wavelength, P.minWavelength);
      if (a === 0.0) continue;

      var angle = P.windRad + (oct.dirOffset * P.dirSpread * Math.PI) / 180.0;
      var dirX = Math.cos(angle);
      var dirY = Math.sin(angle);

      var k = (2.0 * Math.PI) / Math.max(wavelength, 1.0);
      var w = Math.sqrt(GRAVITY * k) * oct.speedMul * P.speed;
      var q = Math.min((P.choppiness * oct.steepness) / (k * a * count + 0.0001), 1.0);

      var phase = k * (dirX * x + dirY * y) - w * time + oct.phase +
        P.phaseSeed * oct.lenRatio * 6.2831853;
      var wanderRate = 0.045 + 0.035 * (1.0 - oct.lenRatio);
      var crossCoord = -dirY * x + dirX * y;
      var wanderArg = k * crossCoord * 0.37 + time * wanderRate +
        oct.phase * 1.731 + P.phaseSeed * (0.37 + oct.lenRatio);
      phase += P.irregularity * 0.55 * Math.sin(wanderArg);
      var sinP = Math.sin(phase);
      var cosP = Math.cos(phase);

      var wa = w * a;
      nx -= dirX * wa * sinP;
      ny -= dirY * wa * sinP;
      nz -= q * wa * cosP;
    }

    var len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1.0;
    if (outNormal) {
      outNormal.x = nx / len;
      outNormal.y = ny / len;
      outNormal.z = nz / len;
      return outNormal;
    }
    return { x: nx / len, y: ny / len, z: nz / len };
  }



  function evaluateWaveVelocity(x, y, time, cfg) {
    var P = resolveWaveParams(cfg);

    var vx = 0.0;
    var vy = 0.0;
    var vz = 0.0;

    for (var i = 0; i < GERSTNER_OCTAVES.length; i++) {
      var oct = GERSTNER_OCTAVES[i];
      var wavelength = P.baseWavelength * oct.lenRatio;
      var a = P.baseAmp * oct.ampRatio * octaveFade(wavelength, P.minWavelength);
      if (a === 0.0) continue;

      var angle = P.windRad + (oct.dirOffset * P.dirSpread * Math.PI) / 180.0;
      var dirX = Math.cos(angle);
      var dirY = Math.sin(angle);

      var k = (2.0 * Math.PI) / Math.max(wavelength, 1.0);
      var w = Math.sqrt(GRAVITY * k) * oct.speedMul * P.speed;

      var phase = k * (dirX * x + dirY * y) - w * time + oct.phase +
        P.phaseSeed * oct.lenRatio * 6.2831853;
      var wanderRate = 0.045 + 0.035 * (1.0 - oct.lenRatio);
      var crossCoord = -dirY * x + dirX * y;
      var wanderArg = k * crossCoord * 0.37 + time * wanderRate +
        oct.phase * 1.731 + P.phaseSeed * (0.37 + oct.lenRatio);
      phase += P.irregularity * 0.55 * Math.sin(wanderArg);
      var phaseSpeed = w - P.irregularity * 0.55 * wanderRate * Math.cos(wanderArg);
      var cosP = Math.cos(phase);
      var sinP = Math.sin(phase);

      vx += dirX * (phaseSpeed * a) * cosP;
      vy += dirY * (phaseSpeed * a) * cosP;
      vz += (phaseSpeed * a) * sinP;
    }

    return { x: vx, y: vy, z: vz };
  }

  /**
   * Base wavelength for a water body, before `WaveTiling` divides it.
   *
   *  - `Absolute`          — a fixed 300 scene units regardless of the volume's size. Waves stay
   *                          world-space, so adjacent water bodies tile seamlessly and the surface
   *                          does not slide when the object moves. Right for oceans.
   *  - `RelativeToVolume`  — the volume's shorter horizontal side, so one base wave spans the body
   *                          at `WaveTiling` 1. Right for a pool, pond or lake that is one object.
   */
  /**
   * Wavelength scale that puts a sensible number of waves across a body of `tileSize`.
   *
   * The Phillips spectrum peaks at k = sqrt(2)/L, so the peak wavelength is about 4.44 L. A fully
   * developed sea's L is huge — 12 m/s of wind peaks near 92 m — so on anything smaller the
   * physically correct result is a single swell spanning the whole surface, which reads as dead
   * flat with a little chop on top. Targeting a peak of tile/TARGET_WAVES_ACROSS gives a surface
   * that looks like water at any scale, and the wave HEIGHT still comes from the wind.
   */
  // How many waves land across the water body by default.
  //
  // Too many and every wave is small next to the camera, so the player reads as a giant looking at
  // a puddle. Too few and the surface flattens out. Around 2.5 keeps waves large enough to feel
  // like real water at eye level while still showing structure across the body.
  var MIN_WAVES_ACROSS = 2.5;
  var MAX_WAVES_ACROSS = 9.0;

  /**
   * One scale factor applied to BOTH wavelength and height, so the sea keeps its physical shape.
   *
   * A fully developed sea has a fixed steepness: Hs/peak = 0.21/4.44 = 0.047, whatever the wind.
   * Wind sets the SCALE, not the shape. So fitting a body means choosing that scale — and wind
   * still decides how many waves land across it: a light breeze gives many small ones, a gale a
   * few large ones. Clamping that count keeps the surface readable at any body size.
   */
  function autoWavelengthScale(tileSize, windSpeed, unitsPerMetre) {
    var upm = unitsPerMetre > 0 ? unitsPerMetre : 100;
    var naturalPeak = 4.44 * ((windSpeed * windSpeed) / OCEAN_GRAVITY) * upm;
    if (!(naturalPeak > 0) || !(tileSize > 0)) return 1.0;
    var wavesAcross = clamp(tileSize / naturalPeak, MIN_WAVES_ACROSS, MAX_WAVES_ACROSS);
    return (tileSize / wavesAcross) / naturalPeak;
  }

  /** Applies the authored WavelengthScale, or fits one to the volume when it is left at 0. */
  function resolveWavelengthScale(ocean) {
    // An explicit peak wavelength wins: it is the one setting that maps directly onto what the
    // player sees, since it is a distance in the same units as everything else in the scene.
    if (ocean.peakWavelengthOption > 0) {
      var upm = ocean.unitsPerMetre > 0 ? ocean.unitsPerMetre : 100;
      var naturalPeak = 4.44 * ((ocean.windSpeed * ocean.windSpeed) / OCEAN_GRAVITY) * upm;
      ocean.wavelengthScale = naturalPeak > 0 ? (ocean.peakWavelengthOption / naturalPeak) : 1.0;
    } else if (ocean.wavelengthScaleOption > 0) {
      ocean.wavelengthScale = ocean.wavelengthScaleOption;
    } else {
      ocean.wavelengthScale = autoWavelengthScale(ocean.tileSize, ocean.windSpeed, ocean.unitsPerMetre);
    }
    return ocean.wavelengthScale;
  }

  function computeBaseWavelength(mode, width, height) {
    if (mode === 'RelativeToVolume') {
      var shortSide = Math.min(width > 0 ? width : 0, height > 0 ? height : 0);
      if (shortSide > 0) return shortSide;
    }
    return DEFAULT_BASE_WAVELENGTH;
  }

  /**
   * Shortest wave the surface mesh can resolve, from its vertex spacing. Four vertices per
   * wavelength is the practical floor for a Gerstner crest; below that the octave is faded out.
   */
  function computeMinWavelength(width, height, subdivisions) {
    var subs = subdivisions > 0 ? subdivisions : 48;
    var spacing = Math.max((width > 0 ? width : 0) / subs, (height > 0 ? height : 0) / subs);
    return spacing * 4.0;
  }

  /**
   * Fraction of the authored wave amplitude the surface mesh can actually represent, 0..1.
   * (The six octave amplitude ratios sum to exactly 1.0, so this is a direct fraction.)
   *
   * A value of 0 means every octave is shorter than the mesh can resolve and the water renders
   * perfectly flat — which looks identical to a broken shader, so it is worth reporting loudly.
   */
  function retainedAmplitudeFraction(baseWavelength, waveTiling, minWavelength) {
    var base = (baseWavelength > 0 ? baseWavelength : DEFAULT_BASE_WAVELENGTH) /
      (waveTiling > 0 ? waveTiling : 1.0);
    var sum = 0.0;
    for (var i = 0; i < GERSTNER_OCTAVES.length; i++) {
      var oct = GERSTNER_OCTAVES[i];
      sum += oct.ampRatio * octaveFade(base * oct.lenRatio, minWavelength);
    }
    return sum;
  }

  /**
   * Recomputes the detail diagnostic and, when the mesh cannot represent a single octave, explains
   * it once with the numbers that matter. Re-warns only if the configuration actually changes.
   */
  function refreshWaveResolution(body, width, height, subs) {
    body.waveDetailFraction = retainedAmplitudeFraction(
      body.baseWavelength, body.waveTiling, body.minWavelength
    );

    var key = [body.waveScaleMode, body.waveTiling, subs, Math.round(width), Math.round(height)].join('|');
    if (key === body._waveResolutionKey) return;
    body._waveResolutionKey = key;

    if (body.waveDetailFraction > 0.01) return;
    if (typeof console === 'undefined' || !console.warn) return;

    var longest = (body.baseWavelength / (body.waveTiling > 0 ? body.waveTiling : 1.0)) *
      GERSTNER_OCTAVES[0].lenRatio;
    var spacing = body.minWavelength / 4.0;
    // The base octave needs four vertices per wavelength to survive the fade.
    var subsNeeded = Math.ceil(Math.max(width, height) / Math.max(longest / 4.0, 0.0001));
    var relative = retainedAmplitudeFraction(
      computeBaseWavelength('RelativeToVolume', width, height), body.waveTiling, body.minWavelength
    );

    console.warn(
      '[FluidAndWater3D] This water body renders FLAT: none of its wave octaves are long enough ' +
      'for its surface mesh to represent.\n' +
      '  volume ' + Math.round(width) + ' x ' + Math.round(height) + ' units, GridSubdivisions ' + subs +
      ' -> ' + spacing.toFixed(1) + ' units between vertices (shortest renderable wave ' +
      body.minWavelength.toFixed(0) + ').\n' +
      '  WaveScaleMode "' + body.waveScaleMode + '" with WaveTiling ' + body.waveTiling +
      ' gives a longest octave of only ' + longest.toFixed(0) + ' units.\n' +
      '  Fix by either:\n' +
      '    - setting WaveScaleMode to "RelativeToVolume" (would retain ' +
      Math.round(relative * 100) + '% of the wave amplitude here), or\n' +
      '    - raising GridSubdivisions to at least ' + subsNeeded +
      (subsNeeded > 256 ? ' (above the 256 maximum, so this alone will not be enough)' : '') + '.\n' +
      '  Note WaveTiling makes this worse, not better: it shortens every wavelength.'
    );
  }

  /** Fixed-size uniform arrays for the WaterEdge3D volumes the shader can carry. */
  function makeEdgeBoundsArray() {
    var arr = [];
    for (var i = 0; i < MAX_WATER_EDGES; i++) {
      arr.push(THREE_OK && typeof THREE.Vector4 === 'function' ? new THREE.Vector4(0, 0, 0, 0) : { x: 0, y: 0, z: 0, w: 0, set: function () {} });
    }
    return arr;
  }

  function makeEdgeParamsArray() {
    var arr = [];
    for (var i = 0; i < MAX_WATER_EDGES; i++) {
      arr.push(THREE_OK && typeof THREE.Vector2 === 'function' ? new THREE.Vector2(0, 0) : { x: 0, y: 0, set: function () {} });
    }
    return arr;
  }

  /**
   * A behavior number property, or `fallback` when it is not a usable number.
   *
   * `!== undefined` is not enough. GDevelop hands these straight from event expressions, so a
   * division by zero or a failed string conversion arrives as NaN, sails through an undefined
   * check and lands in a uniform. NaN in u_WaveHeight makes every vertex NaN, and a mesh whose
   * positions are NaN is not rasterised at all: the water vanishes with nothing logged.
   */
  function num(value, fallback) {
    return (typeof value === 'number' && isFinite(value)) ? value : fallback;
  }

  /** Slack, in scene units, on the WaterEdge3D vertical test. */
  var EDGE_Z_TOLERANCE = 1e-3;

  /**
   * Surf-zone width when FoamWidth is left at 0, as a fraction of the water body's short side.
   *
   * A fixed default cannot work here: the same 120 units that read as a wide beach on a 1000-unit
   * pond is a 3% hairline on a 3500-unit bay, and invisible on anything larger. Foam has to be
   * sized against the water it borders.
   */
  var AUTO_FOAM_FRACTION = 0.08;
  var AUTO_SHALLOW_MULTIPLE = 3.0;
  var AUTO_FOAM_MIN = 40.0;

  /**
   * The foam band an edge would use against a water body of this span. Pure, so the diagnostics
   * can report the same number the shader is handed without depending on upload order: the report
   * runs in doStepPreEvents while uploadWaterEdges runs post-events, so on the frame the report is
   * emitted the edge record still holds its registration default.
   */
  function foamWidthFor(edge, waterSpan) {
    if (edge.foamWidthOption > 0) return edge.foamWidthOption;
    // isFinite matters as much as the > 0 test: the callers derive the span with Math.min over
    // Infinity placeholders, so a water object reporting no size yet yields Infinity, which is
    // both a number and greater than zero and would put Infinity into the shader uniform.
    var span = (typeof waterSpan === 'number' && isFinite(waterSpan) && waterSpan > 0) ? waterSpan : 0;
    return span > 0 ? Math.max(span * AUTO_FOAM_FRACTION, AUTO_FOAM_MIN) : 120.0;
  }

  /** Companion to foamWidthFor. Also pure. */
  function shallowWidthFor(edge, waterSpan) {
    if (edge.shallowWidthOption > 0) return edge.shallowWidthOption;
    return foamWidthFor(edge, waterSpan) * AUTO_SHALLOW_MULTIPLE;
  }

  /**
   * The reference dimension a water body sizes its shore effects against: its short side.
   *
   * Deriving this in one place matters. Both callers previously built it inline with
   * Math.min over Infinity placeholders, so a water object reporting no size produced Infinity,
   * which is a number and is greater than zero and sailed through the guards into a uniform.
   */
  function waterSpanOf(water) {
    var o = water && water.object;
    if (!o) return 0;
    var w = (o.getWidth && o.getWidth() > 0) ? o.getWidth() : 0;
    var h = (o.getHeight && o.getHeight() > 0) ? o.getHeight() : 0;
    if (w > 0 && h > 0) return Math.min(w, h);
    return w > 0 ? w : h;
  }

  /**
   * Is this WaterEdge3D volume vertically relevant to a water surface at `waterTopZ`?
   *
   * Shore foam is a property of the water SURFACE, so the land has to reach that surface: the
   * waterline must fall inside the edge volume's Z span. A block resting on the seabed far below
   * is a reef, not a coastline, and land floating above the waterline is not one either.
   *
   * A looser rule — overlapping the whole water VOLUME — was tried and is wrong: a deep body makes
   * every seabed feature a coastline. The cost of this stricter rule is that land whose Z range
   * misses the waterline is ignored, which looks like the behavior doing nothing at all, so
   * uploadWaterEdges reports that case rather than failing silently.
   *
   * An edge with no depth set is a flat footprint marker and is accepted at any height.
   */
  function edgeReachesWater(o, waterTopZ) {
    if (typeof waterTopZ !== 'number' || !isFinite(waterTopZ)) return true;
    var edgeBottom = (o && o.getZ) ? o.getZ() : 0;
    if (!isFinite(edgeBottom)) return true;
    var edgeDepth = (o && o.getDepth && o.getDepth() > 0) ? o.getDepth() : 0;
    if (edgeDepth <= 0) return true;
    return waterTopZ >= edgeBottom - EDGE_Z_TOLERANCE &&
      waterTopZ <= edgeBottom + edgeDepth + EDGE_Z_TOLERANCE;
  }

  /** CPU counterpart of the shaders' signed WaterEdge3D distance and shore attenuation. */
  function waterEdgeInfluenceAt(state, x, y, layerName, waterZ, waterSpan) {
    var best = Infinity;
    var shallowWidth = 0.0;
    if (!state || !state.waterEdges) {
      return { signedDistance: best, attenuation: 1.0, inside: false };
    }
    for (var i = 0; i < state.waterEdges.length; i++) {
      var edge = state.waterEdges[i];
      var o = edge && edge.object;
      if (!edge || !edge.enabled || !o) continue;
      if (layerName !== undefined && objectLayerName(o) !== layerName) continue;
      var w = (o.getWidth && o.getWidth() > 0) ? o.getWidth() : 0;
      var h = (o.getHeight && o.getHeight() > 0) ? o.getHeight() : 0;
      if (w <= 0 || h <= 0) continue;
      if (!edgeReachesWater(o, waterZ)) continue;
      var minX = o.getX ? o.getX() : 0;
      var minY = o.getY ? o.getY() : 0;
      var maxX = minX + w;
      var maxY = minY + h;
      var qx = Math.abs(x - (minX + maxX) * 0.5) - w * 0.5;
      var qy = Math.abs(y - (minY + maxY) * 0.5) - h * 0.5;
      var outsideX = Math.max(qx, 0.0);
      var outsideY = Math.max(qy, 0.0);
      var signed = Math.sqrt(outsideX * outsideX + outsideY * outsideY) +
        Math.min(Math.max(qx, qy), 0.0);
      if (signed < best) {
        best = signed;
        shallowWidth = shallowWidthFor(edge, waterSpan);
      }
    }
    if (!isFinite(best)) return { signedDistance: best, attenuation: 1.0, inside: false };
    var attenuation = shallowWidth > 0 ? saturate(Math.max(best, 0.0) / shallowWidth) : 1.0;
    attenuation = attenuation * attenuation * (3.0 - 2.0 * attenuation); // smoothstep
    return { signedDistance: best, attenuation: attenuation, inside: best < 0.0 };
  }

  /**
   * Blanks the top face of the source 3D box so the water surface mesh reads through it, leaving
   * the sides and bottom as the visible water volume. Materials are assigned as a fresh array
   * rather than mutated: GDevelop memoises Cube3D materials game-wide, so writing to one would
   * repaint every object sharing that texture.
   */
  function hideVolumeTopFace(object, holder) {
    if (!THREE_OK || typeof THREE.MeshBasicMaterial !== 'function') return;
    var root = getRootObject3D(object);
    if (!root) return;

    if (!holder.boxMaterials) {
      var side = new THREE.MeshBasicMaterial({
        color: new THREE.Color(holder.shallowColor[0], holder.shallowColor[1], holder.shallowColor[2]),
        transparent: true, opacity: 0.55, depthWrite: true, side: THREE.DoubleSide
      });
      var top = new THREE.MeshBasicMaterial({ visible: false });
      var bottom = new THREE.MeshBasicMaterial({
        color: new THREE.Color(holder.deepColor[0], holder.deepColor[1], holder.deepColor[2]),
        transparent: true, opacity: 0.65, depthWrite: true, side: THREE.DoubleSide
      });
      holder.boxMaterials = [side, side, side, side, top, bottom];
    }

    root.visible = !objectIsHidden(object);
    if (root.isMesh && root.material !== holder.boxMaterials) root.material = holder.boxMaterials;
    if (typeof root.traverse === 'function') {
      root.traverse(function (child) {
        if (child && child.isMesh && child !== holder.mesh && child.material !== holder.boxMaterials) {
          child.material = holder.boxMaterials;
        }
      });
    }
  }

  /** Single source of truth for the wave config, so every CPU query matches the shader. */
  function waveConfigOf(body, baseZ) {
    return {
      waveHeight: body.waveHeight,
      waveChoppiness: body.waveChoppiness,
      waveSpeed: body.waveSpeed,
      windDirection: body.windDirection,
      waveTiling: body.waveTiling,
      baseWavelength: body.baseWavelength,
      minWavelength: body.minWavelength,
      directionalSpread: body.directionalSpread,
      phaseSeed: body.phaseSeed,
      waveIrregularity: body.waveIrregularity,
      baseZ: baseZ || 0.0
    };
  }

  /** Builds the cfg object for evaluateGerstnerDisplacement / evaluateGerstnerNormal. */

  /* =============================================================== Tessendorf Ocean Core
   *
   * An implementation of the FFT ocean described in Tessendorf 2001, "Simulating Ocean Water" —
   * the same model Rare used for Sea of Thieves (Ang et al., SIGGRAPH 2018 Talks).
   *
   * Why this replaces a Gerstner octave sum:
   *   - A handful of Gerstner octaves at near-harmonic frequency ratios phase-lock into a visibly
   *     repeating lattice. An FFT field carries N^2 components with randomised phase and cannot.
   *   - Amplitude per wavenumber comes from the Phillips spectrum driven by WIND SPEED, so it is
   *     physically weighted rather than six hand-authored amplitude ratios.
   *   - The field is inherently band-limited to the grid, so no octave-fade machinery is needed.
   *   - Displacement is a function of world XY, not of mesh UVs, so any mesh shape gets the waves.
   *
   * GPU/CPU consistency: the random phases are drawn from a hash of the INTEGER WAVENUMBER, not
   * from a sequential PRNG over array indices. Two grids of different sizes sharing a tile size
   * therefore agree exactly on every wavenumber they have in common, which makes the 32^2 CPU field
   * a strict low-pass of the 256^2 GPU field rather than a different ocean that merely looks similar.
   */

  var OCEAN_GRAVITY = 9.81;

  /**
   * Deterministic pair of standard normal deviates for an integer wavenumber.
   * Hash -> two uniforms -> Box-Muller. Indexing by wavenumber (not array position) is what lets
   * different grid resolutions share a spectrum exactly.
   */
  function oceanGaussianPair(ix, iy, seed, out) {
    // 32-bit integer hash (Wang / xxhash-style avalanche), stable across engines.
    var h = (ix * 0x1f1f1f1f) ^ (iy * 0x85ebca6b) ^ (seed * 0xc2b2ae35);
    h = h | 0;
    h ^= h >>> 16; h = Math.imul(h, 0x7feb352d) | 0;
    h ^= h >>> 15; h = Math.imul(h, 0x846ca68b) | 0;
    h ^= h >>> 16;
    var u1 = ((h >>> 0) % 16777216) / 16777216;

    var h2 = Math.imul(h ^ 0x9e3779b9, 0x85ebca6b) | 0;
    h2 ^= h2 >>> 13; h2 = Math.imul(h2, 0xc2b2ae35) | 0;
    h2 ^= h2 >>> 16;
    var u2 = ((h2 >>> 0) % 16777216) / 16777216;

    // Guard the log at zero.
    u1 = Math.max(u1, 1e-7);
    var r = Math.sqrt(-2.0 * Math.log(u1));
    var theta = 2.0 * Math.PI * u2;
    out[0] = r * Math.cos(theta);
    out[1] = r * Math.sin(theta);
    return out;
  }

  /**
   * Phillips spectrum: the energy of a fully developed wind sea at wavenumber k.
   *
   *   P(k) = A * exp(-1/(k L)^2) / k^4 * |k^ . w^|^2 * exp(-k^2 l^2)
   *
   * L = V^2/g is the largest wave the wind can sustain, |k^.w^|^2 is the directional spreading that
   * kills waves travelling across the wind (the missing piece that made the Gerstner version look
   * like a crosshatch), and the final term damps waves too small to matter.
   */
  function phillipsSpectrum(kx, ky, windSpeed, windDirX, windDirY, amplitude, smallWave, unitsPerMetre, wavelengthScale) {
    var k2 = kx * kx + ky * ky;
    if (k2 < 1e-12) return 0.0;

    var k4 = k2 * k2;
    // L = V^2/g is a LENGTH, and k is in 1/scene-unit, so L has to be in scene units too. Leaving
    // it in metres made exp(-1/(kL)^2) round to zero for every long wave: the entire spectrum
    // collapsed onto the shortest wavelength the grid could hold, which normalisation then scaled
    // to the full significant wave height. The result was waves 117 units long and 308 units tall
    // — a steepness of 2.6, folding through itself, scattering the surface out of the volume.
    var upm = unitsPerMetre > 0 ? unitsPerMetre : 1.0;
    // `WavelengthScale` shortens or lengthens the whole spectrum without touching wave height.
    // A fully developed sea's waves are enormous — 12 m/s of wind naturally peaks near 92 m — so on
    // any water body smaller than that the physically correct answer is one swell spanning the whole
    // surface, which reads as flat. Scaling L below 1 fits several waves across a small body while
    // the height still comes from the wind.
    var wls = wavelengthScale > 0 ? wavelengthScale : 1.0;
    var L = ((windSpeed * windSpeed) / OCEAN_GRAVITY) * upm * wls;
    var kLen = Math.sqrt(k2);

    var kdotw = (kx / kLen) * windDirX + (ky / kLen) * windDirY;
    // Squared cosine spreading, and waves running against the wind are suppressed rather than
    // mirrored — otherwise the sea is symmetric and reads as a standing pattern.
    var directional = kdotw * kdotw;
    if (kdotw < 0.0) directional *= 0.07;

    var p = amplitude * Math.exp(-1.0 / (k2 * L * L)) / k4 * directional;
    if (smallWave > 0) p *= Math.exp(-k2 * smallWave * smallWave);
    return p;
  }

  /**
   * In-place iterative radix-2 FFT over a strided view, so the same routine does rows and columns
   * of a 2D field without transposing.
   */
  function OceanFFT(n) {
    this.n = n;
    var levels = Math.round(Math.log(n) / Math.LN2);
    this.levels = levels;

    this.rev = new Uint16Array(n);
    for (var i = 0; i < n; i++) {
      var x = i, r = 0;
      for (var j = 0; j < levels; j++) { r = (r << 1) | (x & 1); x >>= 1; }
      this.rev[i] = r;
    }

    this.cos = new Float32Array(n / 2);
    this.sin = new Float32Array(n / 2);
    for (var t = 0; t < n / 2; t++) {
      this.cos[t] = Math.cos((2.0 * Math.PI * t) / n);
      this.sin[t] = Math.sin((2.0 * Math.PI * t) / n);
    }
  }

  OceanFFT.prototype.transform = function (re, im, offset, stride) {
    var n = this.n, rev = this.rev, cosT = this.cos, sinT = this.sin;

    for (var i = 0; i < n; i++) {
      var j = rev[i];
      if (j > i) {
        var a = offset + i * stride, b = offset + j * stride;
        var t = re[a]; re[a] = re[b]; re[b] = t;
        t = im[a]; im[a] = im[b]; im[b] = t;
      }
    }

    for (var size = 2; size <= n; size <<= 1) {
      var half = size >> 1, step = n / size;
      for (var start = 0; start < n; start += size) {
        for (var p = start, k = 0; p < start + half; p++, k += step) {
          var ia = offset + p * stride, ib = offset + (p + half) * stride;
          var wr = cosT[k], wi = sinT[k];
          var xr = re[ib] * wr - im[ib] * wi;
          var xi = re[ib] * wi + im[ib] * wr;
          re[ib] = re[ia] - xr; im[ib] = im[ia] - xi;
          re[ia] += xr;         im[ia] += xi;
        }
      }
    }
  };

  OceanFFT.prototype.transform2D = function (re, im) {
    var n = this.n;
    for (var row = 0; row < n; row++) this.transform(re, im, row * n, 1);
    for (var col = 0; col < n; col++) this.transform(re, im, col, n);
  };

  /**
   * One resolution of the ocean. `tileSize` is in GDevelop units and is the period at which the
   * field repeats — set it to the water body's own size and the tile never visibly repeats.
   */
  function OceanField(n, tileSize, options) {
    options = options || {};
    this.n = n;
    this.tileSize = tileSize > 0 ? tileSize : 1000.0;
    this.seed = num(options.seed, 1337);

    this.fft = new OceanFFT(n);

    var count = n * n;
    this.h0re = new Float32Array(count);
    this.h0im = new Float32Array(count);
    this.h0cre = new Float32Array(count); // conj(h0(-k)), precomputed
    this.h0cim = new Float32Array(count);
    this.omega = new Float32Array(count);

    this.hre = new Float32Array(count);
    this.him = new Float32Array(count);
    this.dxre = new Float32Array(count);
    this.dxim = new Float32Array(count);
    this.dyre = new Float32Array(count);
    this.dyim = new Float32Array(count);
    // Both surface slopes ride one complex transform: see evolve().
    this.sre = new Float32Array(count);
    this.sim = new Float32Array(count);

    // Outputs, in GDevelop units.
    this.height = new Float32Array(count);
    this.dispX = new Float32Array(count);
    this.dispY = new Float32Array(count);
    // Surface slope, d(height)/d(gdX) and d(height)/d(gdY), taken from the spectrum rather
    // than reconstructed by differencing the height texture in the shader.
    this.slopeX = new Float32Array(count);
    this.slopeY = new Float32Array(count);
    // Where two crests are running into each other. Filled by computeFoam.
    this.plume = new Float32Array(count);

    this.buildSpectrum(options);
  }

  OceanField.prototype.buildSpectrum = function (options) {
    var n = this.n;
    var half = n / 2;
    var windSpeed = (options.windSpeed !== undefined && options.windSpeed !== null && options.windSpeed >= 0)
      ? Number(options.windSpeed) : 12.0;
    var windRad = ((num(options.windDirection, 45.0)) * Math.PI) / 180.0;
    var wdx = Math.cos(windRad), wdy = Math.sin(windRad);
    var amplitude = options.amplitude !== undefined ? Math.max(0.0, Number(options.amplitude)) : 1.0;
    var smallWave = num(options.smallWaveCutoff, 0.5);
    var upm = options.unitsPerMetre > 0 ? options.unitsPerMetre : 1.0;
    var wls = options.wavelengthScale > 0 ? options.wavelengthScale : 1.0;
    var twoPiOverL = (2.0 * Math.PI) / this.tileSize;

    this.windSpeed = windSpeed;
    this.windDirection = num(options.windDirection, 45.0);
    this.amplitude = amplitude;
    this.unitsPerMetre = upm;
    this.wavelengthScale = wls;

    if (windSpeed <= 0.001 || amplitude <= 0.0001) {
      this.peakWavelength = 0.0;
      this.heightFit = 0.0;
      this.significantWaveHeight = 0.0;
      this.h0re.fill(0);
      this.h0im.fill(0);
      this.h0cre.fill(0);
      this.h0cim.fill(0);
      this.omega.fill(0);
      this.height.fill(0);
      this.dispX.fill(0);
      this.dispY.fill(0);
      this.slopeX.fill(0);
      this.slopeY.fill(0);
      this.plume.fill(0);
      return;
    }

    // Phillips peaks at k = sqrt(2)/L, so the peak wavelength is 2*pi*L/sqrt(2) ~ 4.44 L.
    this.peakWavelength = 4.44 * ((windSpeed * windSpeed) / OCEAN_GRAVITY) * upm * wls;

    // Height does NOT shrink as fast as length. Scaling both equally would preserve the fully
    // developed steepness of 0.047 exactly — and then wind would stop changing anything once the
    // fit saturates, because a fully developed sea has the same shape at every wind speed. A small
    // body in a strong wind is fetch-limited, and fetch-limited seas really are steeper, so let
    // steepness climb with wind up to about 0.10, which is steep but still short of breaking.
    var MAX_FITTED_STEEPNESS = 0.10;
    var FULLY_DEVELOPED_STEEPNESS = 0.21 / 4.44;
    // A hard Math.min has a corner wherever the winning branch changes, and that corner is
    // visible: with the interpolation smoothed, this was the ONLY thing left making the sea
    // change size in steps as the strength slider crossed about Beaufort 7.75. Blend the branches
    // over a small window instead. smoothMin never returns more than the hard minimum, so the
    // steepness cap this exists to enforce still holds.
    // The two FITTING branches are blended with a rounded corner, because the switch between them
    // is what made the sea change size in steps as the strength slider crossed about Beaufort 7.75.
    // The ceiling of 1.0 stays a hard min: it is not a branch, it is the definition of "unfitted",
    // and rounding it would quietly shrink every sea that is not fetch-limited at all.
    this.heightFit = Math.min(1.0, smoothMin(
      Math.sqrt(wls),
      wls * (MAX_FITTED_STEEPNESS / FULLY_DEVELOPED_STEEPNESS),
      0.12
    ));

    var g = [0, 0];

    for (var m = 0; m < n; m++) {
      for (var q = 0; q < n; q++) {
        var idx = m * n + q;
        // Integer wavenumber, signed and centred: this is the key the hash is indexed by.
        var ix = q - half;
        var iy = m - half;

        var kx = ix * twoPiOverL;
        var ky = iy * twoPiOverL;
        var kLen = Math.sqrt(kx * kx + ky * ky);
        this.omega[idx] = Math.sqrt(OCEAN_GRAVITY * kLen);

        // The Nyquist row and column (ix or iy == -N/2) have no mirror partner inside the grid:
        // +N/2 is not a representable index. Leaving them populated breaks the Hermitian symmetry
        // the whole construction depends on, and the inverse transform then returns a complex field
        // whose imaginary part is the same order as its real part. Zero them.
        if (ix === -half || iy === -half) {
          this.h0re[idx] = 0; this.h0im[idx] = 0;
          this.h0cre[idx] = 0; this.h0cim[idx] = 0;
          this.omega[idx] = 0;
          continue;
        }

        var p = phillipsSpectrum(kx, ky, windSpeed, wdx, wdy, amplitude, smallWave, upm, wls);
        var scale = Math.sqrt(p * 0.5);

        oceanGaussianPair(ix, iy, this.seed, g);
        this.h0re[idx] = g[0] * scale;
        this.h0im[idx] = g[1] * scale;

        // conj(h0(-k)) — drawn from the SAME hash at the mirrored wavenumber, which is what makes
        // the reconstructed field real-valued without any index-wrapping special cases.
        var pm = phillipsSpectrum(-kx, -ky, windSpeed, wdx, wdy, amplitude, smallWave, upm, wls);
        var scaleM = Math.sqrt(pm * 0.5);
        oceanGaussianPair(-ix, -iy, this.seed, g);
        this.h0cre[idx] = g[0] * scaleM;
        this.h0cim[idx] = -g[1] * scaleM; // conjugate
      }
    }
  };

  /** Advances the field to absolute time `t` (seconds) and runs the three inverse transforms. */
  OceanField.prototype.evolve = function (t, choppiness) {
    var n = this.n, half = n / 2;
    var chop = choppiness !== undefined ? choppiness : 1.0;
    var twoPiOverL = (2.0 * Math.PI) / this.tileSize;

    var hre = this.hre, him = this.him;
    var dxre = this.dxre, dxim = this.dxim;
    var dyre = this.dyre, dyim = this.dyim;
    var sre = this.sre, sim = this.sim;

    for (var m = 0; m < n; m++) {
      for (var q = 0; q < n; q++) {
        var idx = m * n + q;
        var w = this.omega[idx] * t;
        var cw = Math.cos(w), sw = Math.sin(w);

        // h(k,t) = h0(k) e^{iwt} + conj(h0(-k)) e^{-iwt}
        var ar = this.h0re[idx], ai = this.h0im[idx];
        var br = this.h0cre[idx], bi = this.h0cim[idx];
        var re = ar * cw - ai * sw + br * cw + bi * sw;
        var im = ar * sw + ai * cw - br * sw + bi * cw;

        hre[idx] = re;
        him[idx] = im;


        // Horizontal displacement D(k) = -i * (k/|k|) * h(k,t) — this is what sharpens crests and
        // broadens troughs, the same role Gerstner choppiness plays.
        var ix = q - half, iy = m - half;
        var kx = ix * twoPiOverL, ky = iy * twoPiOverL;
        var kLen = Math.sqrt(kx * kx + ky * ky);

        // Surface slope, analytically. dh/dx = IFFT(i*kx*h) and dh/dy = IFFT(i*ky*h) are both
        // real fields, so they can share ONE complex transform: feed it C = h*(-ky + i*kx) and
        // the result carries dh/dx in its real part and dh/dy in its imaginary part. That is a
        // single extra FFT per cascade, and it saves the fragment shader six texture taps.
        sre[idx] = -ky * re - kx * im;
        sim[idx] = kx * re - ky * im;
        if (kLen < 1e-9) {
          dxre[idx] = 0; dxim[idx] = 0;
          dyre[idx] = 0; dyim[idx] = 0;
        } else {
          var nx = kx / kLen, ny = ky / kLen;
          // +i * n * h  ->  real = -n*im, imag = n*re
          //
          // Tessendorf writes this as -i, but that assumes the opposite exponent convention to
          // the transform below. With -i here the displacement converged on TROUGHS: measured
          // over the field, corr(fold, elevation) came out at -0.665, i.e. the surface pinched
          // in the hollows and foam formed there. With +i it is +0.679, which is the physical
          // case - water piles into the crest, the Jacobian folds at the top, whitecaps break
          // on the peaks. Test 44 pins the sign so it cannot silently flip back.
          dxre[idx] = -nx * im * chop;
          dxim[idx] = nx * re * chop;
          dyre[idx] = -ny * im * chop;
          dyim[idx] = ny * re * chop;
        }
      }
    }

    this.fft.transform2D(hre, him);
    this.fft.transform2D(dxre, dxim);
    this.fft.transform2D(dyre, dyim);
    this.fft.transform2D(sre, sim);

    // Sign flip on alternating cells undoes the fftshift implied by the centred wavenumbers.
    var height = this.height, dispX = this.dispX, dispY = this.dispY;
    var slopeX = this.slopeX, slopeY = this.slopeY;
    for (var y = 0; y < n; y++) {
      for (var x = 0; x < n; x++) {
        var i2 = y * n + x;
        var sign = ((x + y) & 1) ? -1.0 : 1.0;
        height[i2] = hre[i2] * sign;
        dispX[i2] = dxre[i2] * sign;
        dispY[i2] = dyre[i2] * sign;
        // Packed together, so the same fftshift sign applies to both.
        slopeX[i2] = sre[i2] * sign;
        slopeY[i2] = sim[i2] * sign;
      }
    }
  };

  /**
   * Rescales the spectrum so the field's significant wave height matches what the authored wind
   * speed physically implies, instead of the raw Phillips constant — which is arbitrary and, left
   * alone, swings peak height across five orders of magnitude between a breeze and a gale.
   *
   * For a fully developed sea, H_s ~= 0.21 V^2 / g (metres). Significant wave height is by
   * definition 4x the surface elevation standard deviation, so we measure sigma once and scale.
   *
   * `heightScale` is the art-direction multiplier on top of the physical result.
   */
  /**
   * Minimum of two values with a rounded corner: C1-continuous, and never above Math.min, so it
   * can stand in for a cap without ever letting the capped value through. `k` is the width of the
   * blend, in the units of the values themselves.
   */
  function smoothMin(a, b, k) {
    var h = Math.max(k - Math.abs(a - b), 0.0) / k;
    return Math.min(a, b) - h * h * k * 0.25;
  }

  OceanField.prototype.normalizeToWindSpeed = function (unitsPerMetre, heightScale) {
    var upm = unitsPerMetre > 0 ? unitsPerMetre : 100.0;
    var scale = (typeof heightScale === 'number' && heightScale >= 0) ? heightScale : 1.0;

    if (this.windSpeed <= 0.001 || scale <= 0.0001) {
      this.significantWaveHeight = 0.0;
      this.h0re.fill(0);
      this.h0im.fill(0);
      this.h0cre.fill(0);
      this.h0cim.fill(0);
      this.height.fill(0);
      this.dispX.fill(0);
      this.dispY.fill(0);
      this.slopeX.fill(0);
      this.slopeY.fill(0);
      this.plume.fill(0);
      return 0.0;
    }

    // Measure sigma from an unscaled snapshot.
    this.evolve(0.0, 1.0);
    var h = this.height, n = h.length;
    var mean = 0.0;
    for (var i = 0; i < n; i++) mean += h[i];
    mean /= n;
    var variance = 0.0;
    for (var j = 0; j < n; j++) { var d = h[j] - mean; variance += d * d; }
    var sigma = Math.sqrt(variance / n);

    // Height carries the SAME scale as the wavelength, so the sea keeps its natural steepness
    // (Hs/peak = 0.047) after being fitted to the body. Scaling length alone would leave 3 m waves
    // only 10 m long — steeper than water can physically be, folding the surface into spikes.
    var targetHsUnits = 0.21 * (this.windSpeed * this.windSpeed) / OCEAN_GRAVITY * upm *
      (this.heightFit > 0 ? this.heightFit : 1.0);

    var targetSigma = targetHsUnits / 4.0 * scale;

    var k = (sigma > 1e-9) ? (targetSigma / sigma) : 0.0;
    this.significantWaveHeight = targetHsUnits * scale;

    for (var m = 0; m < n; m++) {
      this.h0re[m] *= k; this.h0im[m] *= k;
      this.h0cre[m] *= k; this.h0cim[m] *= k;
    }

    // Re-run the transform so `height`/`dispX`/`dispY` reflect the SCALED spectrum. Without this
    // they still hold the unscaled measurement pass, and anything reading peakHeight() straight
    // after normalising sees a figure thousands of times too large.
    this.evolve(0.0, 1.0);
    return k;
  };

  /** Bilinear height sample at a world XY, in GDevelop units. Wraps on the tile. */
  OceanField.prototype.sampleHeight = function (x, y) {
    if (this.significantWaveHeight <= 0.0001) return 0.0;
    var n = this.n;
    var u = (x / this.tileSize) * n;
    var v = (y / this.tileSize) * n;
    var x0 = Math.floor(u), y0 = Math.floor(v);
    var fx = u - x0, fy = v - y0;

    var xa = ((x0 % n) + n) % n, xb = (xa + 1) % n;
    var ya = ((y0 % n) + n) % n, yb = (ya + 1) % n;

    var h = this.height;
    var h00 = h[ya * n + xa], h10 = h[ya * n + xb];
    var h01 = h[yb * n + xa], h11 = h[yb * n + xb];

    return (h00 * (1 - fx) + h10 * fx) * (1 - fy) + (h01 * (1 - fx) + h11 * fx) * fy;
  };

  /** Bilinear sample of the full displacement, for probes that need the horizontal motion too. */
  OceanField.prototype.sampleDisplacement = function (x, y, out) {
    var n = this.n;
    var u = (x / this.tileSize) * n;
    var v = (y / this.tileSize) * n;
    var x0 = Math.floor(u), y0 = Math.floor(v);
    var fx = u - x0, fy = v - y0;

    var xa = ((x0 % n) + n) % n, xb = (xa + 1) % n;
    var ya = ((y0 % n) + n) % n, yb = (ya + 1) % n;

    var i00 = ya * n + xa, i10 = ya * n + xb, i01 = yb * n + xa, i11 = yb * n + xb;
    function lerp2(arr) {
      return (arr[i00] * (1 - fx) + arr[i10] * fx) * (1 - fy) +
             (arr[i01] * (1 - fx) + arr[i11] * fx) * fy;
    }

    out = out || {};
    out.z = lerp2(this.height);
    out.x = lerp2(this.dispX);
    out.y = lerp2(this.dispY);
    return out;
  };

  /** Peak vertical amplitude of the current field, used to normalise foam and report wave height. */
  OceanField.prototype.peakHeight = function () {
    var h = this.height, peak = 0.0;
    for (var i = 0; i < h.length; i++) {
      var a = h[i] < 0 ? -h[i] : h[i];
      if (a > peak) peak = a;
    }
    return peak;
  };


  /* =============================================================== GPU FFT (ping-pong butterfly)
   *
   * A Stockham-style radix-2 Cooley-Tukey FFT run as fullscreen passes on the GPU, so the ocean can
   * carry a 256^2 spectrum that would cost ~22 ms a frame on the CPU.
   *
   * Two inverse transforms per frame, not three: h, Dx and Dy are all REAL fields, and the inverse
   * transform is linear, so IFFT(H + i*DX) has h as its real part and dx as its imaginary part.
   * The second transform carries Dy the same way.
   *
   * The CPU field still drives buoyancy. Both are built from `oceanGaussianPair` indexed by integer
   * wavenumber, so the small CPU grid is a strict low-pass of this one rather than a different sea.
   */

  /**
   * Butterfly lookup: width = log2(N) stages, height = N indices.
   * Each texel is (twiddle.re, twiddle.im, topIndex, bottomIndex).
   *
   * Stage 0 folds in the bit-reversal permutation, so no separate reorder pass is needed. The
   * twiddle index k advances by N/2^(stage+1), which flips the twiddle's sign for the lower wing of
   * each butterfly group — that is why every texel can use `p + w*q` with no per-wing branch.
   */
  /**
   * `choppiness` must be the same value the vertex shader applies, or the fold describes a
   * surface nobody is looking at: `evolve` bakes in a choppiness of 1.0 and the shader scales
   * the displacement again on the way to the vertex.
   */
  // Below this larger eigenvalue the surface is converging in both directions at once. The onset
  // sits at 0.95 rather than at the 0.85 where sites first appear, so that moderate seas register
  // as a weak plume instead of nothing at all: with a 0.85 onset the mask never rose above ~0.1
  // below a gale, and Beaufort 6 - which the scale describes as carrying "some spray" - threw
  // none. The range is what keeps Beaufort 4 silent: it lands at ~0.15, under any usable threshold.
  var PLUME_ONSET = 0.95;
  var PLUME_RANGE = 0.45;

  OceanField.prototype.computeFoam = function (out, choppiness, foamThreshold) {
    var n = this.n;
    var cell = this.tileSize / n;
    var dx = this.dispX, dy = this.dispY;
    var chop = (typeof choppiness === "number" && choppiness > 0) ? choppiness : 1.0;
    // Below this determinant the surface counts as breaking. Small values mean "only where it
    // actually folds"; larger values bias the Jacobian for more foam, which is the knob Rare
    // describes turning up for storms.
    var thr = (typeof foamThreshold === "number" && foamThreshold > 0.001) ? foamThreshold : 1.0;
    var inv2h = chop / (2.0 * cell);
    var plume = this.plume;

    for (var y = 0; y < n; y++) {
      var ym = ((y - 1) + n) % n, yp = (y + 1) % n;
      for (var x = 0; x < n; x++) {
        var xm = ((x - 1) + n) % n, xp = (x + 1) % n;
        var i = y * n + x;

        var dxdx = (dx[y * n + xp] - dx[y * n + xm]) * inv2h;
        var dxdy = (dx[yp * n + x] - dx[ym * n + x]) * inv2h;
        var dydx = (dy[y * n + xp] - dy[y * n + xm]) * inv2h;
        var dydy = (dy[yp * n + x] - dy[ym * n + x]) * inv2h;

        // Rare's formula: saturate((foamThreshold - detJ) / foamThreshold). The determinant sits
        // between +1 and +2 on open water and dips below zero only where the surface folds over
        // itself - their own slide shows foam generated at three points across a whole wave
        // profile. This used to hardcode the threshold to 1.0, the most permissive value it can
        // take, so foam was generated wherever the surface compressed at all and then had to be
        // thresholded back down afterwards. Biasing the Jacobian IS the foam control.
        var a = 1.0 + dxdx, d = 1.0 + dydy;
        var jacobian = a * d - dxdy * dydx;
        out[i] = clamp((thr - jacobian) / thr, 0.0, 1.0);

        // Colliding crests, as distinct from an ordinary breaking one. The displacement
        // gradient tensor has two eigenvalues: a wave spilling down its face compresses in ONE
        // direction, so one eigenvalue drops and the other stays near 1, while two crests
        // running together compress in BOTH. The Jacobian is their product and cannot tell the
        // cases apart - the LARGER eigenvalue can. Measured on the real field this fires on
        // 0.24% of a Beaufort 6 surface against 5.32% for the fold, and never at Beaufort 4.
        if (plume) {
          var tr = a + d;
          var disc = Math.sqrt(Math.max(tr * tr - 4.0 * jacobian, 0.0));
          var lamMax = (tr + disc) * 0.5;
          plume[i] = clamp((PLUME_ONSET - lamMax) / PLUME_RANGE, 0.0, 1.0);
        }
      }
    }
    return out;
  };

  /**
   * The Jacobian bias, from the foam coverage slider. Rare's control for "more foam" is to bias the
   * determinant threshold up, not to widen a ramp after the fact, so coverage maps here.
   */
  function foamThresholdFor(ocean) {
    var cov = (ocean && typeof ocean.foamCoverage === 'number') ? ocean.foamCoverage : 0.35;
    return clamp(0.40 + cov * 0.95, 0.05, 1.15);
  }

  var WAVEWORKS_VERTEX_SHADER = [
    'precision highp float;',
    '',
    'uniform sampler2D u_Field;',          // Cascade 0: Macro swell (rgb = displacement XYZ, a = fold)
    'uniform sampler2D u_FieldCascade;',   // Cascade 1: Chop / capillary (rgb = displacement XYZ, a = fold)
    'uniform float u_TileSize;',           // Cascade 0 tile size
    'uniform float u_CascadeTileSize;',    // Cascade 1 tile size
    'uniform float u_Choppiness;',
    'uniform float u_CascadeWeight;',
    'uniform float u_PeakReference;',
    'uniform float u_Time;',
    'uniform float u_EdgeCount;',
    'uniform vec4 u_EdgeBounds[8];',
    'uniform vec2 u_EdgeParams[8];',
    'uniform float u_InteractionCount;',
    'uniform vec4 u_Interactions[16];',
    'uniform vec4 u_InteractionParams[16];',
    '',
    'varying vec3 vWorldPosition;',
    'varying vec2 vGdXY;',
    'varying vec2 vFieldUv;',
    'varying vec2 vCascadeUv;',
    'varying float vPeak;',
    'varying float vShoreAttenuation;',
    'varying float vInteractionFoam;',
    '',
    'float signedDistanceToWaterEdge(vec2 p, out float foamWidth, out float shallowWidth) {',
    '  float best = 1.0e9;',
    '  foamWidth = 0.0;',
    '  shallowWidth = 0.0;',
    '  for (int i = 0; i < 8; i++) {',
    '    if (float(i) >= u_EdgeCount) break;',
    '    vec4 b = u_EdgeBounds[i];',
    '    vec2 centre = (b.xy + b.zw) * 0.5;',
    '    vec2 halfSize = max((b.zw - b.xy) * 0.5, vec2(0.0001));',
    '    vec2 q = abs(p - centre) - halfSize;',
    '    float sd = length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0);',
    '    if (sd < best) {',
    '      best = sd;',
    '      foamWidth = u_EdgeParams[i].x;',
    '      shallowWidth = u_EdgeParams[i].y;',
    '    }',
    '  }',
    '  return best;',
    '}',
    '',
    'float interactionWave(vec2 p, out float foam) {',
    '  float displacement = 0.0;',
    '  foam = 0.0;',
    '  for (int i = 0; i < 16; i++) {',
    '    if (float(i) >= u_InteractionCount) break;',
    '    vec4 e = u_Interactions[i];',
    '    vec4 q = u_InteractionParams[i];',
    '    float age = u_Time - e.z;',
    '    if (age < 0.0 || age >= q.y) continue;',
    '    float fade = 1.0 - age / max(q.y, 0.001);',
    '    float travel = q.x * age / max(q.y, 0.001);',
    '    float width = max(q.x * 0.10, 4.0);',
    '    float dist = length(p - e.xy);',
    '    float shell = exp(-abs(dist - travel) / width);',
    '    float phase = (dist - travel) * 6.2831853 / max(q.x * 0.22, 8.0);',
    '    displacement += e.w * cos(phase) * shell * fade;',
    '    foam = max(foam, shell * fade * clamp(abs(e.w) / 8.0, 0.0, 1.0));',
    '  }',
    '  return displacement;',
    '}',
    '',
    'void main() {',
    '  vec4 worldPos = modelMatrix * vec4(position, 1.0);',
    '  vec2 gdXY = vec2(worldPos.x, -worldPos.y);',
    '  vec2 uv0 = gdXY / max(u_TileSize, 0.001);',
    '  vec2 uv1 = gdXY / max(u_CascadeTileSize, 0.001);',
    '  vFieldUv = uv0;',
    '  vCascadeUv = uv1;',
    '',
    '  // These textures DO carry a mip chain - anisotropic filtering needs one - and the geometry',
    '  // must read the base level, never a filtered one, or the waves flatten with distance.',
    '  // texture2DLod would say that explicitly but does not exist here: three maps texture2D onto',
    '  // the WebGL2 builtin for GLSL1 shaders and has no mapping for texture2DLod, so it failed to',
    '  // compile and took the whole vertex shader with it - the ocean drew nothing at all.',
    '  // A vertex-shader fetch has no derivatives, so the spec gives it lod 0, which is what we',
    '  // want. Test 49 pins that this stays a plain texture2D with no bias argument.',
    '  vec4 field0 = texture2D(u_Field, uv0);',
    '  vec4 field1 = texture2D(u_FieldCascade, uv1);',
    '',
    '  float edgeFoamWidth, edgeShallowWidth;',
    '  float edgeSignedDistance = signedDistanceToWaterEdge(gdXY, edgeFoamWidth, edgeShallowWidth);',
    '  float shoreAttenuation = 1.0;',
    '  if (u_EdgeCount > 0.0 && edgeShallowWidth > 0.0) {',
    '    shoreAttenuation = smoothstep(0.0, edgeShallowWidth, max(edgeSignedDistance, 0.0));',
    '  }',
    '',
    '  float cWeight = clamp(u_CascadeWeight, 0.0, 1.5);',
    '  // Cascade 1 sits on a quarter-size tile, so its spatial gradient k is ~4x steeper.',
    '  // Scaling horizontal choppiness by the tile ratio prevents the detail cascade from pushing',
    '  // the Jacobian determinant negative and folding wave crests inside-out.',
    '  float cascadeChopRatio = clamp(u_CascadeTileSize / max(u_TileSize, 0.001), 0.0, 1.0);',
    '  // Safeguard effective choppiness against Jacobian inversion at extreme sea states (Beaufort 9-12).',
    '  // Total horizontal displacement gradient must remain below 1.0 to prevent quads folding inside-out.',
    '  float safeChop = min(u_Choppiness, 0.90) / (1.0 + cWeight * cascadeChopRatio * 0.5 + max(0.0, u_Choppiness - 0.7) * 0.5);',
    '  vec3 disp0 = vec3(field0.r * safeChop, -field0.g * safeChop, field0.b);',
    '  vec3 disp1 = vec3(field1.r * (safeChop * cascadeChopRatio), -field1.g * (safeChop * cascadeChopRatio), field1.b) * cWeight;',
    '  vec3 totalDisp = (disp0 + disp1) * shoreAttenuation;',
    '',
    '  worldPos.xyz += totalDisp;',
    '  float interactionFoam = 0.0;',
    '  worldPos.z += interactionWave(gdXY, interactionFoam) * shoreAttenuation;',
    '',
    '  vWorldPosition = worldPos.xyz;',
    '  vGdXY = vec2(worldPos.x, -worldPos.y);',
    '  // Rare drive subsurface from "the choppiness vertex offsets... a mask for where the SIDES',
    '  // of the waves are", so this is the horizontal offset magnitude, not elevation. It was',
    '  // briefly changed to elevation after measuring it correlating only 0.086 with height - but',
    '  // a flanks mask SHOULD be uncorrelated with height, since it peaks between crest and trough.',
    '  // The real defect was the divisor, which pinned it at 1.0 across a third of the surface.',
    '  vPeak = clamp(length(totalDisp.xy) / max(u_PeakReference, 1.0), 0.0, 1.0);',
    '  vShoreAttenuation = shoreAttenuation;',
    '  vInteractionFoam = interactionFoam * shoreAttenuation;',
    '',
    '  gl_Position = projectionMatrix * viewMatrix * worldPos;',
    '}'
  ].join('\n');

  var WAVEWORKS_FRAGMENT_SHADER = [
    'precision highp float;',
    '',
    'uniform sampler2D u_Field;',
    'uniform sampler2D u_FieldCascade;',
    'uniform sampler2D u_Slope;',
    'uniform sampler2D u_CascadeSlope;',
    'uniform float u_PlumeFoam;',
    'uniform float u_FoamScale;',   // cell size: fine bubbles vs broad sheets
    'uniform float u_FoamStreak;',  // how far the wind draws those cells out
    'uniform float u_FoamBite;',    // noise contrast: soft spume vs hard-edged islands
    'uniform float u_FoamTrail;',   // how much foam hangs below the crest
    'uniform sampler2D u_FoamBuffer;',
    'uniform float u_FoamBufferOn;',
    'uniform float u_TileSize;',
    'uniform float u_CascadeTileSize;',
    'uniform float u_FieldTexel;',
    'uniform float u_CascadeTexel;',
    'uniform float u_CascadeWeight;',
    'uniform vec3 u_ShallowColor;',
    'uniform vec3 u_DeepColor;',
    'uniform float u_ExtinctionDepth;',
    'uniform float u_FoamIntensity;',
    'uniform float u_FoamCoverage;',
    'uniform float u_Opacity;',
    'uniform float u_MicroDetail;',
    'uniform vec2 u_WindDir;',
    'uniform float u_CausticsIntensity;',
    'uniform float u_CausticsDepthFade;',
    'uniform float u_FoamModel;',
    'uniform float u_FoamSoftness;',
    'uniform float u_GlitterScale;',
    'uniform float u_QuantiseBands;',
    'uniform float u_Time;',
    'uniform vec3 u_SunDirection;',
    'uniform float u_WaterDepth;',
    'uniform float u_EdgeCount;',
    'uniform float u_EdgeMask;',
    'uniform vec4 u_EdgeBounds[8];',
    'uniform vec2 u_EdgeParams[8];',
    // Detailing enhancement uniforms
    'uniform vec3 u_SunColor;',
    'uniform float u_SunSpecularIntensity;',
    'uniform float u_SunSpecularRoughness;',
    'uniform float u_WaveContrast;',
    'uniform vec3 u_TranslucencyColor;',
    'uniform float u_TranslucencyIntensity;',
    'uniform float u_TranslucencyPower;',
    'uniform vec3 u_FoamColor;',
    'uniform float u_MicroFrequency;',
    'uniform samplerCube u_EnvMap;',
    'uniform float u_HasEnvMap;',
    '',
    'varying vec3 vWorldPosition;',
    'varying vec2 vGdXY;',
    'varying vec2 vFieldUv;',
    'varying vec2 vCascadeUv;',
    'varying float vPeak;',
    'varying float vShoreAttenuation;',
    'varying float vInteractionFoam;',
    '',
    'const vec3 BETA_EXTINCTION = vec3(0.12, 0.045, 0.015);',
    '',
    'vec2 hash2(vec2 p) {',
    '  p = mod(p, 256.0);',
    '  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));',
    '  return fract(sin(p) * 43758.5453123);',
    '}',
    '',
    '// 2-octave value noise. Foam break-up has to be aperiodic: the sine ruling it replaces',
    '// repeated hundreds of times across a single ocean and read as ruled lines.',
    'float valueNoise(vec2 p) {',
    '  vec2 i = floor(p);',
    '  vec2 f = fract(p);',
    '  vec2 u = f * f * (3.0 - 2.0 * f);',
    '  float a = hash2(i).x;',
    '  float b = hash2(i + vec2(1.0, 0.0)).x;',
    '  float c = hash2(i + vec2(0.0, 1.0)).x;',
    '  float d = hash2(i + vec2(1.0, 1.0)).x;',
    '  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);',
    '}',
    '',
    'float foamNoise(vec2 p) {',
    '  return valueNoise(p) * 0.62 + valueNoise(p * 2.17 + vec2(3.7, 1.3)) * 0.38;',
    '}',
    '',
    'float voronoiCaustics(vec2 uv, float time) {',
    '  vec2 p = uv * 3.5;',
    '  vec2 ip = floor(p);',
    '  vec2 fp = fract(p);',
    '  float d1 = 8.0;',
    '  float d2 = 8.0;',
    '  for (int y = -1; y <= 1; y++) {',
    '    for (int x = -1; x <= 1; x++) {',
    '      vec2 nb = vec2(float(x), float(y));',
    '      vec2 pt = hash2(ip + nb);',
    '      pt = 0.5 + 0.40 * sin(time * 1.3 + 6.2831853 * pt);',
    '      vec2 diff = nb + pt - fp;',
    '      float d = dot(diff, diff);',
    '      if (d < d1) {',
    '        d2 = d1;',
    '        d1 = d;',
    '      } else if (d < d2) {',
    '        d2 = d;',
    '      }',
    '    }',
    '  }',
    '  float edge = sqrt(d2) - sqrt(d1);',
    '  float caustic = clamp((0.22 - edge) / 0.22, 0.0, 1.0);',
    '  return caustic * caustic;',
    '}',
    '',
    'vec2 microWaveNormal(vec2 p, float time, vec2 wind, float freq) {',
    '  vec2 w = (length(wind) > 0.001) ? normalize(wind) : vec2(0.7071, 0.7071);',
    '  vec2 perp = vec2(-w.y, w.x);',
    '  float f = max(freq, 0.1);',
    '  // Build the ripples in the WIND frame. The previous version scaled p on the world axes',
    '  // and used the wind only as a scrolling offset, so the pattern never rotated: its x term',
    '  // rode a world-locked wave vector and its y term rode the perpendicular one. Two',
    '  // perpendicular world-locked plane waves are a square grid, which is exactly how it read.',
    '  // Squashed across the wind, because ripples are short along it and drawn out across it.',
    '  vec2 q = vec2(dot(p, w), dot(p, perp) * 0.42) * f;',
    '  // One height field, three octaves at deliberately non-harmonic wavenumbers so they cannot',
    '  // beat back into a lattice. The normal is its analytic gradient, so x and y come from the',
    '  // SAME waves - that is what removes the four-fold symmetry.',
    '  vec2 k1 = vec2(0.0093, 0.0000);',
    '  vec2 k2 = vec2(0.0190, 0.0069);',
    '  vec2 k3 = vec2(0.0353, -0.0247);',
    '  float a1 = dot(q, k1) + time * 1.20;',
    '  float a2 = dot(q, k2) - time * 0.87;',
    '  float a3 = dot(q, k3) + time * 1.63;',
    '  vec2 g = k1 * (0.50 * cos(a1)) + k2 * (0.32 * cos(a2)) + k3 * (0.18 * cos(a3));',
    '  // Chain rule back to world axes. 93.0 restores the mean amplitude the old function had,',
    '  // so u_MicroDetail keeps meaning what it meant.',
    '  g *= 93.0 * f;',
    '  return w * g.x + perp * (g.y * 0.42);',
    '}',
    '',
    'float signedDistanceToWaterEdge(vec2 p, out float foamWidth, out float shallowWidth) {',
    '  float best = 1.0e9;',
    '  foamWidth = 0.0;',
    '  shallowWidth = 0.0;',
    '  for (int i = 0; i < 8; i++) {',
    '    if (float(i) >= u_EdgeCount) break;',
    '    vec4 b = u_EdgeBounds[i];',
    '    vec2 centre = (b.xy + b.zw) * 0.5;',
    '    vec2 halfSize = max((b.zw - b.xy) * 0.5, vec2(0.0001));',
    '    vec2 q = abs(p - centre) - halfSize;',
    '    float sd = length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0);',
    '    if (sd < best) {',
    '      best = sd;',
    '      foamWidth = u_EdgeParams[i].x;',
    '      shallowWidth = u_EdgeParams[i].y;',
    '    }',
    '  }',
    '  return best;',
    '}',
    '',
    'void main() {',
    '  // Surface slope comes from the spectrum, not from differencing the height texture.',
    '  // Differencing a BILINEAR texture at exactly +/-1 texel makes the texel grid itself',
    '  // visible: the reconstruction is piecewise bilinear, so its derivative is discontinuous',
    '  // on texel boundaries and the discontinuities line up into a lattice. The field carries',
    '  // d(height)/d(gdX) and d(height)/d(gdY) directly now, exact per texel and smooth between,',
    '  // for two taps instead of the eight this used to cost.',
    '  vec4 sTex0 = texture2D(u_Slope, vFieldUv);',
    '  vec2 grad0 = -sTex0.xy;',
    '  // Blue is where two crests are colliding. The droplets thrown from those sites are',
    '  // spawned on the CPU; this is the bright disturbed water underneath them, without which',
    '  // the spray reads as stuck on rather than thrown up.',
    '  float plume0 = clamp(sTex0.z, 0.0, 1.0);',
    '  float cWeight = clamp(u_CascadeWeight, 0.0, 1.5);',
    '  vec2 grad1 = -texture2D(u_CascadeSlope, vCascadeUv).xy * cWeight;',
    '',
    '  vec2 totalGrad = (grad0 + grad1) * vShoreAttenuation;',
    '  vec3 nGd = normalize(vec3(totalGrad, 1.0));',
    '  if (u_MicroDetail > 0.001) {',
    '    float mFreq = (u_MicroFrequency > 0.001) ? u_MicroFrequency : 1.0;',
    '    vec2 micro = microWaveNormal(vGdXY, u_Time, u_WindDir, mFreq) * (u_MicroDetail * 0.18 * vShoreAttenuation);',
    '    nGd = normalize(vec3(nGd.xy + micro, 1.0));',
    '  }',
    '  vec3 toCam = cameraPosition - vWorldPosition;',
    '  float camDist = length(toCam);',
    '  vec3 viewDir = (camDist > 0.0001) ? (toCam / camDist) : vec3(0.0, 0.0, 1.0);',
    '',
    '  vec3 normal = vec3(nGd.x, -nGd.y, nGd.z);',
    '  // When viewed from above water, any back-facing fragment is an inverted self-intersecting',
    '  // crest fold. Discarding it eliminates dark triangular teeth inside/under the wave crests',
    '  // while preserving the underside of the surface when submerged.',
    '  if (!gl_FrontFacing) {',
    '    if (toCam.z > 0.0) discard;',
    '    normal = -normal;',
    '  }',
    '',
    '  float NdotV = abs(dot(normal, viewDir));',
    '  float fresnel = 0.02 + 0.98 * pow(1.0 - NdotV, 5.0);',
    '',
    '  float foamW, shallowW;',
    '  float signedEdge = signedDistanceToWaterEdge(vGdXY, foamW, shallowW);',
    '  float edgeDist = max(signedEdge, 0.0);',
    '  float landMask = 1.0;',
    '  if (u_EdgeCount > 0.0) {',
    '    float insetFade = max(foamW * 0.5, 1.0);',
    '    landMask = mix(1.0, smoothstep(-insetFade, 0.0, signedEdge), u_EdgeMask);',
    '    if (landMask <= 0.001) discard;',
    '    if (signedEdge < 0.0) edgeDist = max(shallowW, foamW);',
    '  }',
    '',
    '  // Depth column & wave elevation contrast',
    '  float column = u_WaterDepth;',
    '  if (u_EdgeCount > 0.0 && shallowW > 0.0) {',
    '    column = min(column, u_WaterDepth * clamp(edgeDist / shallowW, 0.0, 1.0));',
    '  }',
    '  float tilt = clamp(1.0 - normal.z, 0.0, 1.0);',
    '  float contrastScale = (u_WaveContrast > 0.0) ? u_WaveContrast : 0.50;',
    '  float contrast = clamp(1.0 + (tilt * 1.4 - 0.45) * contrastScale, 0.15, 2.5);',
    '  vec3 transmit = exp(-BETA_EXTINCTION * (column / max(u_ExtinctionDepth, 1.0)) * (6.0 * contrast));',
    '  vec3 waterColor = mix(u_DeepColor, u_ShallowColor, transmit);',
    '',
    '  if (u_CausticsIntensity > 0.0) {',
    '    float causticFalloff = clamp(1.0 - (column / max(u_ExtinctionDepth * 0.65, 20.0)), 0.0, 1.0);',
    '    float causticAtten = mix(1.0, causticFalloff, clamp(u_CausticsDepthFade, 0.0, 1.0));',
    '    if (causticAtten > 0.001) {',
    '      float c1 = voronoiCaustics(vGdXY * 0.004, u_Time * 1.2);',
    '      float c2 = voronoiCaustics(vGdXY * 0.007 + vec2(1.7, 3.2), u_Time * 1.5);',
    '      waterColor += vec3((c1 + c2) * 0.5 * 0.28 * u_CausticsIntensity * causticAtten * transmit.g);',
    '    }',
    '  }',
    '',
    '  // Sea of Thieves wind-aligned fibrous whitecap foam with directional trailing streaks',
    '  // Sampled here, NOT interpolated from the vertex. As a varying across a grid this coarse',
    '  // the foam took on the shape of the triangles it was drawn over - flat white facets with',
    '  // straight edges and sawtoothed diagonals, reading as terrain rather than water.',
    '  float fold0 = texture2D(u_Field, vFieldUv).a;',
    '  float fold1 = texture2D(u_FieldCascade, vCascadeUv).a;',
    '  // Cascade 0 decides WHERE the sea breaks; cascade 1 only roughens it. It used to be a',
    '  // max(), but the detail cascade carries the same spectrum on a quarter-size tile, so it is',
    '  // ~4x steeper and its fold pins at 1.0 over a third of a storm field. Through a max() that',
    '  // is a constant, and the whole surface turned to foam.',
    '  float fold = clamp((fold0 + fold1 * cWeight * 0.15) * vShoreAttenuation, 0.0, 1.0);',
    // u_WindDir is already the unit wind vector here (the JS side uploads cos/sin), unlike the
    // Gerstner shaders where the same uniform name carries a heading in degrees.
    '  vec2 wDir = normalize(u_WindDir);',
    '  vec2 wCross = vec2(-wDir.y, wDir.x);',
    '  // Break-up comes from noise in the DISPLACED frame, so foam rides the crest instead of the',
    '  // sea sliding beneath a fixed pattern. The frame is stretched along the wind so the noise',
    '  // reads as wind-blown streaks rather than blobs.',
    '  // Cell size and elongation are separate controls: scale sets how big a clump of foam is,',
    '  // streak sets how far the wind draws it out. Streak 1 gives round cells (a lake, or surf on',
    '  // a calm day), 4.5 is the open-ocean default, and higher is a gale tearing the tops off into',
    '  // long parallel bands.',
    '  float fScale = (u_FoamScale > 0.001) ? u_FoamScale : 1.0;',
    '  float fStreak = (u_FoamStreak > 0.001) ? u_FoamStreak : 4.5;',
    '  float along = 0.010 * fScale;',
    '  vec2 foamFrame = vec2(dot(vGdXY, wDir) * along + u_Time * 0.22,',
    '                        dot(vGdXY, wCross) * along * fStreak - u_Time * 0.05);',
    '  // How fresh this foam is. Straight off the crest the buffer is bright; after a few frames',
    '  // of progressive blur it has spread and faded. Rare blend two authored foam textures on',
    '  // exactly this signal - high frequency at the crest, lower frequency as it blends out -',
    '  // so the octave mix follows it rather than being fixed per preset.',
    '  float freshness = (u_FoamBufferOn > 0.5) ? clamp(texture2D(u_FoamBuffer, vFieldUv).r, 0.0, 1.0)',
    '                                          : clamp(fold, 0.0, 1.0);',
    '  float foamLace = foamNoise(foamFrame * 6.0);',
    '  float laceFine = foamNoise(foamFrame * 17.0 + vec2(11.3, 4.9));',
    '  float fineMix = mix(0.10, 0.46, freshness);',
    '  foamLace = clamp(foamLace * (1.0 - fineMix) + laceFine * fineMix, 0.0, 1.0);',
    '  // Bite is contrast about the midpoint. Low leaves a soft wash that reads as spume; high cuts',
    '  // the lace into hard-edged islands with clean water between them.',
    '  float fBite = (u_FoamBite > 0.001) ? u_FoamBite : 1.0;',
    '  foamLace = clamp((foamLace - 0.5) * fBite + 0.5, 0.0, 1.0);',
    '',
    '  // Foam is the Jacobian fold and nothing else - the places the surface actually folds over.',
    '  // vPeak (the choppiness offset) drives subsurface and glitter further down; it does NOT',
    '  // belong here. Feeding it in made a Beaufort 4 sea 41% solid white, because it saturates',
    '  // at a fraction of the wave height while the fold is still down at 0.14.',
    '  float crest = clamp(max(fold, plume0 * 0.85), 0.0, 1.0);',
    '  // With the buffer live it IS the foam, not an addition to it: the blit already injected',
    '  // this frame generation into it and blurred that against every previous frame, which is',
    '  // the progressive blur the whole look depends on. Taking max() with the instantaneous fold',
    '  // would put the hard un-blurred stamp back on top and undo it.',
    '  if (u_FoamBufferOn > 0.5) {',
    '    crest = clamp(texture2D(u_FoamBuffer, vFieldUv).r, 0.0, 1.0);',
    '  }',
    '  // The fold arriving here is ALREADY the foam intensity: the field generates it with the',
    '  // Rare rule, saturate((threshold - detJ) / threshold), so it is sparse and strong at',
    '  // source and the coverage slider biases that threshold. This band now only needs a soft',
    '  // toe to stop single texels popping - it used to re-threshold an over-generous signal,',
    '  // which meant two controls fighting over the same decision.',
    '  float crestThreshold = 0.02;',
    '  // Softness widens the ramp: a painterly sea wants smeared edges, a toon one wants a step.',
    '  float softness = (u_FoamSoftness > 0.001) ? u_FoamSoftness : 1.0;',
    '  float capWidth = max(u_FoamCoverage * 0.35, 0.12) * softness;',
    '  float cap = smoothstep(crestThreshold, min(crestThreshold + capWidth, 1.0), crest);',
    '  float trailBand = smoothstep(max(crestThreshold - capWidth * 0.6, 0.0), crestThreshold + 0.02, crest);',
    '  // The noise gates the trailing foam, so a calm sea shows none of it at all.',
    '  float laceLo = mix(0.42, 0.5, clamp(1.0 - softness, 0.0, 1.0));',
    '  float trail = trailBand * smoothstep(laceLo, laceLo + 0.44 * softness, foamLace);',
    '  float fTrail = (u_FoamTrail >= 0.0) ? u_FoamTrail : 1.0;',
    '  float crestFoam = clamp(cap * (0.55 + 0.65 * foamLace) + trail * 0.85 * fTrail, 0.0, 1.0) * u_FoamIntensity * step(0.5, u_FoamModel);',
    '  // Combined with max, never added. The fold is already high where crests collide, so a',
    '  // sum would blow the site out to flat white - the same failure that turned whitecaps',
    '  // into plateaus.',
    '  float plumeFoam = plume0 * u_PlumeFoam * u_FoamIntensity * step(0.5, u_FoamModel);',
    '  crestFoam = max(crestFoam, clamp(plumeFoam, 0.0, 1.0));',
    '',
    '  // Surf along registered WaterEdge3D volume',
    '  float shoreFoam = 0.0;',
    '  if (u_EdgeCount > 0.0 && foamW > 0.0) {',
    '    float band = 1.0 - smoothstep(0.0, foamW, edgeDist);',
    '    float contact = 1.0 - smoothstep(0.0, max(foamW * 0.20, 3.0), edgeDist);',
    '    float breakup = 0.68 + 0.32 * sin(vGdXY.x * 0.037 + u_Time * 1.7) * cos(vGdXY.y * 0.043 - u_Time * 1.1);',
    '    float trailing = smoothstep(0.15, 0.82, 0.5 + 0.5 * sin(edgeDist * 0.12 - u_Time * 2.2 + breakup * 3.0));',
    '    shoreFoam = clamp(max(contact * 0.95, band * (0.52 * breakup + 0.38 * trailing)) * u_FoamIntensity, 0.0, 1.0);',
    '  }',
    '',
    '  float foam = clamp(max(max(crestFoam, shoreFoam), vInteractionFoam), 0.0, 1.0);',
    '  vec3 foamColor = (length(u_FoamColor) > 0.01) ? u_FoamColor : vec3(0.97, 0.99, 1.0);',
    '',
    '  // Wave crest Subsurface Scattering (SSS)',
    '  vec3 sunDir = normalize(u_SunDirection);',
    '  float sssPow = (u_TranslucencyPower > 0.1) ? u_TranslucencyPower : 3.0;',
    '  float sunBacklit = pow(max(dot(viewDir, -sunDir), 0.0), sssPow);',
    '  // The crest mask is the horizontal choppiness offset, not surface tilt: light travels a',
    '  // shorter path through a pinched crest, which is what makes it glow.',
    '  float crestFactor = clamp(vPeak * 1.6 + fold * 0.5, 0.0, 1.0);',
    '  vec3 sssColor = (length(u_TranslucencyColor) > 0.01) ? u_TranslucencyColor : mix(u_ShallowColor, vec3(0.12, 0.95, 0.82), 0.6);',
    '  float sssInt = (u_TranslucencyIntensity > 0.0) ? u_TranslucencyIntensity : 1.4;',
    '  // BLEND towards the sub-surface colour rather than adding to it. Adding let the three',
    '  // factors compound into white; a mix keeps the hue and cannot exceed the colour itself.',
    '  float sssMix = clamp(sunBacklit * crestFactor * sssInt, 0.0, 1.0) * (1.0 - foam * 0.8);',
    '  waterColor = mix(waterColor, sssColor, sssMix);',
    '',
    '  // Dual-lobe sun specular highlight',
    '  vec3 halfVec = normalize(sunDir + viewDir);',
    '  float NdotH = max(dot(normal, halfVec), 0.0);',
    '  float specRough = (u_SunSpecularRoughness > 1.0) ? u_SunSpecularRoughness : 128.0;',
    '  float specInt = (u_SunSpecularIntensity > 0.0) ? u_SunSpecularIntensity : 2.2;',
    '  float specDisc = pow(NdotH, specRough * 2.0) * specInt;',
    '  // The glitter lobe used exponent roughness*0.22 (~35), wide enough to paint soft white',
    '  // patches rather than resolve into points. Narrow it and put the sparkle on the crests.',
    '  float specGlitter = pow(NdotH, max(specRough * 0.60, 40.0)) * (specInt * 0.35) * (0.35 + 0.65 * vPeak) * u_GlitterScale;',
    '  vec3 sunCol = (length(u_SunColor) > 0.01) ? u_SunColor : vec3(1.0, 0.96, 0.88);',
    '  vec3 sunGlint = sunCol * (specDisc + specGlitter) * (1.0 - foam * 0.85);',
    '  waterColor += sunGlint;',
    '',
    '  // Sky dome reflection & Fresnel',
    '  vec3 reflectDir = reflect(-viewDir, normal);',
    '  vec3 skyReflection;',
    '  if (u_HasEnvMap > 0.5) {',
    '    skyReflection = textureCube(u_EnvMap, vec3(reflectDir.x, -reflectDir.y, reflectDir.z)).rgb;',
    '  } else {',
    '    float skyZ = clamp(reflectDir.z, 0.0, 1.0);',
    '    vec3 zenithSky = vec3(0.12, 0.36, 0.72);',
    '    vec3 horizonSky = vec3(0.68, 0.84, 0.98);',
    '    skyReflection = mix(horizonSky, zenithSky, pow(skyZ, 0.65));',
    '  }',
    '  float sunReflect = max(dot(reflectDir, sunDir), 0.0);',
    '  skyReflection += vec3(1.0, 0.88, 0.65) * pow(sunReflect, 16.0) * 0.55;',
    '',
    '  vec3 finalColor = mix(waterColor, skyReflection, fresnel);',
    '  finalColor = mix(finalColor, foamColor, foam);',
    '  // A cel style posterises the surface into flat bands after everything else has resolved.',
    '  if (u_QuantiseBands > 0.5) {',
    '    finalColor = floor(finalColor * u_QuantiseBands + 0.5) / u_QuantiseBands;',
    '  }',
    '',
    '  // Opacity & transparency',
    '  float alpha = mix(0.40, 0.95, 1.0 - transmit.g);',
    '  alpha = clamp(max(alpha + fresnel * 0.25, foam), 0.0, 1.0) * u_Opacity;',
    '',
    '  gl_FragColor = vec4(finalColor, alpha * landMask);',
    '}'
  ].join('\n');

  var MAX_WATER_EDGES = 8;
  var MAX_WATER_INTERACTIONS = 16;

  function makeInteractionArray() {
    var arr = [];
    for (var i = 0; i < MAX_WATER_INTERACTIONS; i++) {
      arr.push(THREE_OK && typeof THREE.Vector4 === 'function'
        ? new THREE.Vector4(0, 0, 0, 0)
        : { x: 0, y: 0, z: 0, w: 0, set: function (x, y, z, w) {
          this.x = x; this.y = y; this.z = z; this.w = w;
        } });
    }
    return arr;
  }

  /**
   * Exact CPU counterpart of the localized ripple term shared by both water shaders.
   *
   * The event list deliberately runs a few entries past the shader's capacity (see
   * emitBodyInteraction), so this has to sum the SAME newest MAX_WATER_INTERACTIONS window
   * uploadBodyInteractions sends to the GPU. Summing the whole list instead made buoyancy and
   * WaveHeightAt() lift against rings the surface was not drawing.
   */
  function interactionDisplacementAt(holder, x, y, time) {
    if (!holder || !holder.interactions) return 0.0;
    var out = 0.0;
    var events = holder.interactions;
    var first = Math.max(events.length - MAX_WATER_INTERACTIONS, 0);
    for (var i = first; i < events.length; i++) {
      var e = events[i];
      var age = time - e.time;
      if (age < 0 || age >= e.life) continue;
      var fade = 1.0 - age / Math.max(e.life, 0.001);
      var travel = e.radius * age / Math.max(e.life, 0.001);
      var dx = x - e.x, dy = y - e.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      var width = Math.max(e.radius * 0.10, 4.0);
      var shell = Math.exp(-Math.abs(dist - travel) / width);
      var phase = (dist - travel) * 6.2831853 / Math.max(e.radius * 0.22, 8.0);
      out += e.strength * Math.cos(phase) * shell * fade;
    }
    return out;
  }

  /**
   * Picks a filter mode a float texture can actually be sampled with.
   *
   * Linear filtering of 32-bit float textures needs `OES_texture_float_linear`, which is NOT core
   * in WebGL2. Without it the texture is INCOMPLETE and every sample silently returns (0,0,0,1) —
   * no warning, no error, the shader just reads zeros. That reads as a dead flat surface, and
   * (before the foam encoding was fixed) as a fully foamed white one.
   */
  function pickFloatFilter(renderer) {
    if (!THREE_OK) return null;
    var linear = true;
    try {
      if (renderer && renderer.extensions && typeof renderer.extensions.has === 'function') {
        linear = !!renderer.extensions.has('OES_texture_float_linear');
      }
    } catch (e) { linear = false; }

    if (!linear && typeof console !== 'undefined' && console.info) {
      console.info('[FluidAndWater3D] OES_texture_float_linear is unavailable on this device; the ' +
        'ocean field is sampled unfiltered. Waves are correct, surface normals are slightly faceted.');
    }
    return linear ? THREE.LinearFilter : THREE.NearestFilter;
  }

  /** The three.js renderer, or null. Needed before any float texture is created. */
  function getThreeRendererOf(runtimeScene) {
    try {
      var game = runtimeScene && runtimeScene.getGame ? runtimeScene.getGame() : null;
      var gr = game && game.getRenderer ? game.getRenderer() : null;
      return gr && gr.getThreeRenderer ? gr.getThreeRenderer() : null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Normalises an anisotropy choice string ("1 (Off)", "2x", "4x", "8x", "16x") or number to a
   * valid integer in [1, 16].
   */
  function parseAnisotropy(val, fallback) {
    if (typeof val === 'number' && isFinite(val)) {
      return clamp(Math.round(val), 1, 16);
    }
    if (typeof val === 'string') {
      var m = val.match(/\d+/);
      if (m) return clamp(parseInt(m[0], 10), 1, 16);
    }
    return fallback !== undefined ? fallback : 4;
  }

  /** Queries the hardware maximum anisotropy supported by the current renderer (default 1). */
  function getRendererMaxAnisotropy(runtimeScene) {
    var renderer = getThreeRendererOf(runtimeScene);
    if (renderer && renderer.capabilities && typeof renderer.capabilities.getMaxAnisotropy === 'function') {
      try {
        return Math.max(1, renderer.capabilities.getMaxAnisotropy() || 1);
      } catch (e) { return 1; }
    }
    return 1;
  }

  /**
   * Applies anisotropic filtering to a Three.js texture, clamped against hardware limits.
   */
  function applyAnisotropyToTexture(texture, renderer, requestedAnisotropy) {
    if (!texture || !THREE_OK) return;
    var maxA = 1;
    try {
      if (renderer && renderer.capabilities && typeof renderer.capabilities.getMaxAnisotropy === 'function') {
        maxA = Math.max(1, renderer.capabilities.getMaxAnisotropy() || 1);
      }
      // Floating-point mipmap generation needs a renderable and filterable format.
      // An unknown renderer must not be treated as a fully capable GPU.
      if (texture.type === THREE.FloatType && (!renderer || !renderer.capabilities ||
          !renderer.capabilities.isWebGL2 || !renderer.extensions ||
          typeof renderer.extensions.has !== 'function' ||
          !renderer.extensions.has('OES_texture_float_linear') ||
          !renderer.extensions.has('EXT_color_buffer_float'))) maxA = 1;
    } catch (e) { maxA = 1; }

    if (texture.magFilter === THREE.NearestFilter) maxA = 1;
    var targetLevel = clamp(Math.round(requestedAnisotropy || 1), 1, maxA);
    var useMipmaps = targetLevel > 1;
    var minFilter = useMipmaps ? THREE.LinearMipmapLinearFilter : texture.magFilter;
    if (texture.anisotropy !== targetLevel || texture.minFilter !== minFilter ||
        texture.generateMipmaps !== useMipmaps) {
      texture.anisotropy = targetLevel;
      texture.minFilter = minFilter;
      texture.generateMipmaps = useMipmaps;
      texture.needsUpdate = true;
    }
  }



  /**
   * Lagrangian SPH solver (Mueller et al.) over a spatial hash grid.
   *
   * Fluid parameters are stored PER PARTICLE rather than passed once per step: a scene can pour
   * honey and water at the same time, and a single global viscosity would make every preset behave
   * identically. Positions are in metres (GDevelop pixels x SPH_WORLD_SCALE).
   */
  function SPHSolver(maxDroplets) {
    this.maxDroplets = maxDroplets || 2000;
    this.h = 0.06;
    this.h2 = this.h * this.h;
    this.h3 = this.h2 * this.h;
    this.h6 = this.h3 * this.h3;
    this.h9 = this.h6 * this.h3;

    this.poly6 = 315.0 / (64.0 * Math.PI * this.h9);
    this.spikyGrad = -45.0 / (Math.PI * this.h6);
    this.viscLap = 45.0 / (Math.PI * this.h6);

    this.x = new Float32Array(this.maxDroplets);
    this.y = new Float32Array(this.maxDroplets);
    this.z = new Float32Array(this.maxDroplets);

    this.vx = new Float32Array(this.maxDroplets);
    this.vy = new Float32Array(this.maxDroplets);
    this.vz = new Float32Array(this.maxDroplets);

    this.fx = new Float32Array(this.maxDroplets);
    this.fy = new Float32Array(this.maxDroplets);
    this.fz = new Float32Array(this.maxDroplets);

    this.density = new Float32Array(this.maxDroplets);
    this.pressure = new Float32Array(this.maxDroplets);
    this.alive = new Uint8Array(this.maxDroplets);
    this.life = new Float32Array(this.maxDroplets);

    // Per-particle material, so presets are actually distinguishable.
    this.visc = new Float32Array(this.maxDroplets);
    this.tension = new Float32Array(this.maxDroplets);
    this.rest = new Float32Array(this.maxDroplets);
    this.radius = new Float32Array(this.maxDroplets);
    this.cr = new Float32Array(this.maxDroplets);
    this.cg = new Float32Array(this.maxDroplets);
    this.cb = new Float32Array(this.maxDroplets);
    this.owner = new Int32Array(this.maxDroplets);

    this.particleCount = 0;
    this.particleMass = 0.02;

    // O(1) slot allocation. The previous linear scan for a free slot ran the full array on every
    // emitted droplet, which at 60 droplets/s over 3000 slots is 180k probes a second.
    this.freeList = new Int32Array(this.maxDroplets);
    this.freeCount = 0;

    this.gridTableSize = 4096;
    this.gridHead = new Int32Array(this.gridTableSize);
    this.gridNext = new Int32Array(this.maxDroplets);
    // Hash buckets can contain unrelated cells. Keep exact coordinates so a collision cannot make
    // one neighbour appear in two queried cells and contribute density/force more than once.
    this.gridCellX = new Int32Array(this.maxDroplets);
    this.gridCellY = new Int32Array(this.maxDroplets);
    this.gridCellZ = new Int32Array(this.maxDroplets);
    this.gridCellSize = this.h;
  }

  SPHSolver.prototype.hashCoords = function (cx, cy, cz) {
    var h = (cx * 73856093) ^ (cy * 19349663) ^ (cz * 83492791);
    return Math.abs(h) % this.gridTableSize;
  };

  SPHSolver.prototype.buildSpatialGrid = function () {
    this.gridHead.fill(-1);
    var invCell = 1.0 / this.gridCellSize;

    for (var i = 0; i < this.particleCount; i++) {
      if (!this.alive[i]) continue;
      var cx = Math.floor(this.x[i] * invCell);
      var cy = Math.floor(this.y[i] * invCell);
      var cz = Math.floor(this.z[i] * invCell);
      var cellHash = this.hashCoords(cx, cy, cz);

      this.gridCellX[i] = cx;
      this.gridCellY[i] = cy;
      this.gridCellZ[i] = cz;
      this.gridNext[i] = this.gridHead[cellHash];
      this.gridHead[cellHash] = i;
    }
  };

  SPHSolver.prototype.kill = function (i) {
    if (i < 0 || i >= this.maxDroplets || !this.alive[i]) return;
    this.alive[i] = 0;
    this.freeList[this.freeCount++] = i;
  };

  /**
   * @param props {viscosity, surfaceTension, restDensity, radius, color:[r,g,b] 0..1, owner}
   */
  SPHSolver.prototype.emit = function (x, y, z, vx, vy, vz, maxLife, props) {
    var idx = -1;
    if (this.freeCount > 0) {
      idx = this.freeList[--this.freeCount];
    } else if (this.particleCount < this.maxDroplets) {
      idx = this.particleCount++;
    } else {
      return -1;
    }

    var pr = props || {};

    this.x[idx] = x;
    this.y[idx] = y;
    this.z[idx] = z;
    this.vx[idx] = vx;
    this.vy[idx] = vy;
    this.vz[idx] = vz;
    this.fx[idx] = 0;
    this.fy[idx] = 0;
    this.fz[idx] = 0;

    this.rest[idx] = pr.restDensity > 0 ? pr.restDensity : 1000.0;
    this.visc[idx] = pr.viscosity !== undefined ? pr.viscosity : 1.0;
    this.tension[idx] = pr.surfaceTension !== undefined ? pr.surfaceTension : 0.8;
    this.radius[idx] = pr.radius > 0 ? pr.radius : 0.02;
    var c = pr.color || [1.0, 0.2, 0.5];
    this.cr[idx] = c[0];
    this.cg[idx] = c[1];
    this.cb[idx] = c[2];
    this.owner[idx] = pr.owner !== undefined ? pr.owner : -1;

    this.density[idx] = this.rest[idx];
    this.pressure[idx] = 0.0;
    this.alive[idx] = 1;
    this.life[idx] = maxLife || 12.0;

    return idx;
  };

  SPHSolver.prototype.step = function (dt, cfg) {
    if (this.particleCount === 0 || dt <= 0.0) return;
    cfg = cfg || {};

    var gasStiffness = 300.0;
    var h2 = this.h2;
    var poly6 = this.poly6;
    var spikyGrad = this.spikyGrad;
    var viscLap = this.viscLap;
    var mass = this.particleMass;
    var invCell = 1.0 / this.gridCellSize;

    this.buildSpatialGrid();

    for (var i = 0; i < this.particleCount; i++) {
      if (!this.alive[i]) continue;

      var piX = this.x[i];
      var piY = this.y[i];
      var piZ = this.z[i];

      var cx = Math.floor(piX * invCell);
      var cy = Math.floor(piY * invCell);
      var cz = Math.floor(piZ * invCell);

      var rho = 0.0;

      for (var ox = -1; ox <= 1; ox++) {
        for (var oy = -1; oy <= 1; oy++) {
          for (var oz = -1; oz <= 1; oz++) {
            var queryX = cx + ox;
            var queryY = cy + oy;
            var queryZ = cz + oz;
            var cellHash = this.hashCoords(queryX, queryY, queryZ);
            var j = this.gridHead[cellHash];
            while (j !== -1) {
              if (this.alive[j] &&
                  this.gridCellX[j] === queryX &&
                  this.gridCellY[j] === queryY &&
                  this.gridCellZ[j] === queryZ) {
                var dx = piX - this.x[j];
                var dy = piY - this.y[j];
                var dz = piZ - this.z[j];
                var r2 = dx * dx + dy * dy + dz * dz;

                if (r2 < h2) {
                  var diff = h2 - r2;
                  rho += mass * poly6 * diff * diff * diff;
                }
              }
              j = this.gridNext[j];
            }
          }
        }
      }

      var restI = this.rest[i];
      this.density[i] = Math.max(rho, restI * 0.5);
      var ratio = this.density[i] / restI;
      // Tait equation of state.
      this.pressure[i] = Math.max(0.0, gasStiffness * (ratio * ratio * ratio * ratio - 1.0));
    }

    var gravX = 0.0;
    var gravY = 0.0;
    var gravZ = -GRAVITY * (cfg.gravityScale !== undefined ? cfg.gravityScale : 1.0);

    for (var i = 0; i < this.particleCount; i++) {
      if (!this.alive[i]) continue;

      var piX = this.x[i];
      var piY = this.y[i];
      var piZ = this.z[i];
      var pviX = this.vx[i];
      var pviY = this.vy[i];
      var pviZ = this.vz[i];
      var pRho = this.density[i];
      var pPress = this.pressure[i];
      var pVisc = this.visc[i];
      var pTension = this.tension[i];

      var fPressX = 0.0, fPressY = 0.0, fPressZ = 0.0;
      var fViscX = 0.0, fViscY = 0.0, fViscZ = 0.0;
      var fCohesionX = 0.0, fCohesionY = 0.0, fCohesionZ = 0.0;

      var cx = Math.floor(piX * invCell);
      var cy = Math.floor(piY * invCell);
      var cz = Math.floor(piZ * invCell);

      for (var ox = -1; ox <= 1; ox++) {
        for (var oy = -1; oy <= 1; oy++) {
          for (var oz = -1; oz <= 1; oz++) {
            var queryX = cx + ox;
            var queryY = cy + oy;
            var queryZ = cz + oz;
            var cellHash = this.hashCoords(queryX, queryY, queryZ);
            var j = this.gridHead[cellHash];
            while (j !== -1) {
              if (j !== i && this.alive[j] &&
                  this.gridCellX[j] === queryX &&
                  this.gridCellY[j] === queryY &&
                  this.gridCellZ[j] === queryZ) {
                var dx = piX - this.x[j];
                var dy = piY - this.y[j];
                var dz = piZ - this.z[j];
                var r2 = dx * dx + dy * dy + dz * dz;

                if (r2 < h2 && r2 > 0.000001) {
                  var r = Math.sqrt(r2);
                  var hDiff = this.h - r;
                  var invR = 1.0 / r;

                  var pGradTerm = -mass * ((pPress + this.pressure[j]) / (2.0 * this.density[j])) * spikyGrad * hDiff * hDiff;
                  fPressX += pGradTerm * dx * invR;
                  fPressY += pGradTerm * dy * invR;
                  fPressZ += pGradTerm * dz * invR;

                  // Viscosity is averaged across the pair so honey dragging through water behaves
                  // symmetrically (Newton's third law) instead of only one side feeling the drag.
                  var muPair = 0.5 * (pVisc + this.visc[j]);
                  var vLapTerm = muPair * mass * (1.0 / this.density[j]) * viscLap * hDiff;
                  fViscX += vLapTerm * (this.vx[j] - pviX);
                  fViscY += vLapTerm * (this.vy[j] - pviY);
                  fViscZ += vLapTerm * (this.vz[j] - pviZ);

                  var cohTerm = 0.5 * (pTension + this.tension[j]) * mass * poly6 * (h2 - r2) * (h2 - r2);
                  fCohesionX -= cohTerm * dx;
                  fCohesionY -= cohTerm * dy;
                  fCohesionZ -= cohTerm * dz;
                }
              }
              j = this.gridNext[j];
            }
          }
        }
      }

      this.fx[i] = fPressX + fViscX + fCohesionX + gravX * pRho;
      this.fy[i] = fPressY + fViscY + fCohesionY + gravY * pRho;
      this.fz[i] = fPressZ + fViscZ + fCohesionZ + gravZ * pRho;
    }

    var floorZ = cfg.floorZ !== undefined ? cfg.floorZ : 0.0;
    var damping = 0.98;
    // Viscous fluids need a smaller substep to stay stable; split the frame rather than exploding.
    var substeps = Math.min(4, Math.max(1, Math.ceil(dt / 0.008)));
    var sdt = dt / substeps;

    for (var i = 0; i < this.particleCount; i++) {
      if (!this.alive[i]) continue;

      this.life[i] -= dt;
      if (this.life[i] <= 0.0) {
        this.kill(i);
        continue;
      }

      var invRho = 1.0 / this.density[i];
      var ax = this.fx[i] * invRho;
      var ay = this.fy[i] * invRho;
      var az = this.fz[i] * invRho;

      var maxAcc = 200.0;
      ax = clamp(ax, -maxAcc, maxAcc);
      ay = clamp(ay, -maxAcc, maxAcc);
      az = clamp(az, -maxAcc, maxAcc);

      for (var sub = 0; sub < substeps; sub++) {
        this.vx[i] = (this.vx[i] + ax * sdt) * damping;
        this.vy[i] = (this.vy[i] + ay * sdt) * damping;
        this.vz[i] = (this.vz[i] + az * sdt) * damping;

        this.x[i] += this.vx[i] * sdt;
        this.y[i] += this.vy[i] * sdt;
        this.z[i] += this.vz[i] * sdt;

        if (this.z[i] < floorZ) {
          this.z[i] = floorZ;
          this.vz[i] = -this.vz[i] * 0.3;
          this.vx[i] *= 0.8;
          this.vy[i] *= 0.8;
        }
      }
    }
  };

  SPHSolver.prototype.getActiveCount = function () {
    var count = 0;
    for (var i = 0; i < this.particleCount; i++) {
      if (this.alive[i]) count++;
    }
    return count;
  };

  SPHSolver.prototype.countOwnedBy = function (ownerId) {
    var count = 0;
    for (var i = 0; i < this.particleCount; i++) {
      if (this.alive[i] && this.owner[i] === ownerId) count++;
    }
    return count;
  };

  SPHSolver.prototype.clearAll = function () {
    this.alive.fill(0);
    this.particleCount = 0;
    this.freeCount = 0;
  };

  /* ------------------------------------------------------------- Persistent Foam Buffer */

  var FOAM_BLIT_VERTEX = [
    'precision highp float;',
    'varying vec2 vUv;',
    'void main() {',
    '  vUv = uv;',
    '  gl_Position = vec4(position.xy, 0.0, 1.0);',
    '}'
  ].join('\n');

  var FOAM_BLIT_FRAGMENT = [
    'precision highp float;',
    'uniform sampler2D u_Prev;',
    'uniform sampler2D u_Field;',
    'uniform float u_Decay;',
    'uniform float u_Texel;',
    'varying vec2 vUv;',
    'void main() {',
    '  // Cheap 4-tap blur: this is the "progressively blurred with feedback" step, and it is what',
    '  // makes foam disperse into a soft mask rather than staying a hard stamp of the crest.',
    '  float blurred = texture2D(u_Prev, vUv).r * 0.40',
    '    + texture2D(u_Prev, vUv + vec2(u_Texel, 0.0)).r * 0.15',
    '    + texture2D(u_Prev, vUv - vec2(u_Texel, 0.0)).r * 0.15',
    '    + texture2D(u_Prev, vUv + vec2(0.0, u_Texel)).r * 0.15',
    '    + texture2D(u_Prev, vUv - vec2(0.0, u_Texel)).r * 0.15;',
    '  // Alpha of the wave field is the Jacobian: where the surface folds is where foam is born.',
    '  float generated = texture2D(u_Field, vUv).a;',
    '  gl_FragColor = vec4(max(blurred * u_Decay, generated), 0.0, 0.0, 1.0);',
    '}'
  ].join('\n');

  /**
   * Two ping-ponged targets holding the foam field in the same UV space as the wave field, so the
   * fragment shader can sample it with the uv it already has.
   */
  function FoamBuffer(renderer, size, anisotropy) {
    this.renderer = renderer;
    this.size = size;
    this.anisotropy = parseAnisotropy(anisotropy, 4);
    this.failed = false;
    this.checked = false;
    this.index = 0;
    this.targets = [this.makeTarget(), this.makeTarget()];

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.material = new THREE.ShaderMaterial({
      vertexShader: FOAM_BLIT_VERTEX,
      fragmentShader: FOAM_BLIT_FRAGMENT,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        u_Prev: { value: null },
        u_Field: { value: null },
        u_Decay: { value: 0.98 },
        u_Texel: { value: 1.0 / size }
      }
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  FoamBuffer.isSupported = function (renderer) {
    if (!THREE_OK || !renderer) return false;
    if (typeof THREE.WebGLRenderTarget !== 'function') return false;
    if (typeof renderer.setRenderTarget !== 'function') return false;
    if (renderer.capabilities && renderer.capabilities.isWebGL2 === false) return false;
    return true;
  };

  FoamBuffer.prototype.makeTarget = function () {
    var t = new THREE.WebGLRenderTarget(this.size, this.size, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false
    });
    if (t.texture && this.anisotropy) {
      applyAnisotropyToTexture(t.texture, this.renderer, this.anisotropy);
    }
    return t;
  };

  FoamBuffer.prototype.setAnisotropy = function (level) {
    var requested = parseAnisotropy(level, 4);
    if (this.anisotropy === requested || !this.targets.length) return;
    var oldLevel = this.anisotropy;
    this.anisotropy = requested;
    var nextTargets = [this.makeTarget(), this.makeTarget()];
    if (nextTargets[0].texture.anisotropy === this.targets[0].texture.anisotropy) {
      nextTargets.forEach(function (t) { t.dispose(); });
      return;
    }
    // Three.js ignores needsUpdate for initialized render-target textures. Allocate new
    // samplers and copy the history instead of silently leaving the old GL parameters active.
    var renderer = this.renderer;
    var restore = renderer.getRenderTarget ? renderer.getRenderTarget() : null;
    var copy = new THREE.ShaderMaterial({
      vertexShader: FOAM_BLIT_VERTEX,
      fragmentShader: 'uniform sampler2D u_Source; varying vec2 vUv; void main() { gl_FragColor = texture2D(u_Source, vUv); }',
      depthTest: false, depthWrite: false,
      uniforms: { u_Source: { value: null } }
    });
    try {
      if (renderer.resetState) renderer.resetState();
      this.quad.material = copy;
      for (var i = 0; i < 2; i++) {
        copy.uniforms.u_Source.value = this.targets[i].texture;
        renderer.setRenderTarget(nextTargets[i]);
        renderer.render(this.scene, this.camera);
      }
      this.targets.forEach(function (t) { t.dispose(); });
      this.targets = nextTargets;
    } catch (e) {
      nextTargets.forEach(function (t) { t.dispose(); });
      this.anisotropy = oldLevel;
    } finally {
      this.quad.material = this.material;
      copy.dispose();
      renderer.setRenderTarget(restore);
      if (renderer.resetState) renderer.resetState();
    }
  };

  /**
   * One feedback step. dt and decaySeconds come from the scene clock and the medium, so the same
   * foam lives ~3.85 s in salt water and ~2.54 s in fresh regardless of frame rate.
   */
  FoamBuffer.prototype.update = function (fieldTexture, dt, decaySeconds) {
    if (this.failed || !fieldTexture) return null;
    var renderer = this.renderer;
    if (!renderer) return null;

    var previous = this.targets[this.index];
    var next = this.targets[1 - this.index];

    this.material.uniforms.u_Prev.value = previous.texture;
    this.material.uniforms.u_Field.value = fieldTexture;
    // Exponential decay to the measured half-life rather than a per-frame constant.
    this.material.uniforms.u_Decay.value =
      Math.exp(-Math.max(dt, 0.0) / Math.max(decaySeconds, 0.05));

    var restore = null;
    try {
      restore = (typeof renderer.getRenderTarget === 'function') ? renderer.getRenderTarget() : null;
      // GDevelop shares ONE WebGL context between PIXI and three, and three caches GL state. The
      // GPU FFT read that cache stale and returned garbage; bracket the pass the same way 2.4.1
      // fixed it.
      if (typeof renderer.resetState === 'function') renderer.resetState();
      renderer.setRenderTarget(next);
      renderer.render(this.scene, this.camera);
      renderer.setRenderTarget(restore);
      if (typeof renderer.resetState === 'function') renderer.resetState();
    } catch (e) {
      this.failed = true;
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[FluidAndWater3D] The persistent foam buffer could not render (' + e.message +
          '). Falling back to the stateless crest mask, which is what ships by default.');
      }
      return null;
    }

    this.index = 1 - this.index;
    return this.targets[this.index].texture;
  };

  /**
   * Read the finished target back once. A render target can fail with no error at all - an
   * unsupported format, a driver declining it - and a foam mask of NaN paints the whole ocean
   * white. This is the same self-check the GPU FFT needed.
   */
  FoamBuffer.prototype.validate = function () {
    if (this.failed || this.checked) return true;
    this.checked = true;
    var renderer = this.renderer;
    if (!renderer || typeof renderer.readRenderTargetPixels !== 'function') return true;
    var n = 8;
    var buf = new Uint8Array(n * n * 4);
    try {
      renderer.readRenderTargetPixels(this.targets[this.index], 0, 0, n, n, buf);
    } catch (e) {
      return true; // Cannot read it back; assume good rather than disable a working effect.
    }
    for (var i = 0; i < buf.length; i++) {
      if (!isFinite(buf[i])) {
        this.failed = true;
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[FluidAndWater3D] The persistent foam buffer produced unusable values. ' +
            'Falling back to the stateless crest mask.');
        }
        return false;
      }
    }
    return true;
  };

  FoamBuffer.prototype.dispose = function () {
    for (var i = 0; i < this.targets.length; i++) {
      if (this.targets[i] && this.targets[i].dispose) this.targets[i].dispose();
    }
    if (this.quad && this.quad.geometry) this.quad.geometry.dispose();
    if (this.material) this.material.dispose();
    this.targets = [];
  };

  /* ------------------------------------------------------------- State & Registration */

  var sceneStates = new WeakMap();

  function getSceneState(runtimeScene) {
    var state = sceneStates.get(runtimeScene);
    if (!state) {
      state = {
        waterBodies: [],
        oceans: [],
        waterEdges: [],
        waterDetailings: [],
        waterStrengthSliders: [],
        buoyantObjects: [],
        pourableObjects: [],
        containers: [],
        time: 0.0,
        timeScale: 1.0,
        paused: false,
        sphSolver: new SPHSolver(3000),
        // Ground plane the droplets pile up on, in GDevelop units. Settable so a scene whose floor
        // is not at Z = 0 does not have its liquid stop in mid-air.
        sphFloorZ: 0.0,
        particleMesh: null,
        spray: null,
        sprayMesh: null,
        sprayDummy: null,
        sprayLayerName: null,
        particleLayerName: null,
        particleColor: THREE_OK && typeof THREE.Color === 'function' ? new THREE.Color() : null,
        dummyObj: null,
        nextOwnerId: 1,
        physicsBehaviorCache: typeof WeakMap === 'function' ? new WeakMap() : null,
        underwaterActive: false,
        underwaterBody: null,
        savedFog: null
      };
      sceneStates.set(runtimeScene, state);
    }
    return state;
  }

  /* ------------------------------------------------------------- Shaders */

  // NOTE ON COORDINATE SPACE:
  // GDevelop's 3D scene root carries scale.y = -1 (layer-pixi-renderer._setup3DRendering), so
  // (modelMatrix * position).y is the NEGATED GDevelop Y. Every wave phase below is therefore
  // evaluated on vec2(worldPos.x, -worldPos.y) so the GPU surface matches the CPU solver used by
  // buoyancy and WaveHeightAt(), and the resulting XY displacement is mapped back into three space.

  var WATER_VERTEX_SHADER = [
    'precision highp float;',
    '',
    'uniform float u_Time;',
    'uniform float u_WaveHeight;',
    'uniform float u_WaveChoppiness;',
    'uniform float u_WaveSpeed;',
    'uniform float u_WindDir;',
    'uniform float u_WaveTiling;',
    'uniform float u_BaseWavelength;',
    'uniform float u_MinWavelength;',
    'uniform float u_DirSpread;',
    'uniform float u_PhaseSeed;',
    'uniform float u_WaveIrregularity;',
    'uniform float u_EdgeCount;',
    'uniform vec4 u_EdgeBounds[8];',
    'uniform vec2 u_EdgeParams[8];',
    'uniform float u_InteractionCount;',
    'uniform vec4 u_Interactions[16];',
    'uniform vec4 u_InteractionParams[16];',
    '',
    'varying vec3 vWorldPosition;',
    'varying vec3 vWorldNormal;',
    'varying vec2 vUv;',
    'varying vec2 vGdXY;',
    'varying float vWaveCrest;',
    'varying float vInteractionFoam;',
    '',
    '#define GRAVITY 9.81',
    '#define OCTAVE_COUNT ' + GERSTNER_OCTAVES.length + '.0',
    '#define PI 3.14159265359',
    '',
    '// Signed distance to the union of WaterEdge3D AABBs: positive on water, negative on land.',
    'float signedDistanceToWaterEdge(vec2 p, out float foamWidth, out float shallowWidth) {',
    '  float best = 1.0e9;',
    '  foamWidth = 0.0;',
    '  shallowWidth = 0.0;',
    '  for (int i = 0; i < 8; i++) {',
    '    if (float(i) >= u_EdgeCount) break;',
    '    vec4 b = u_EdgeBounds[i];',
    '    vec2 centre = (b.xy + b.zw) * 0.5;',
    '    vec2 halfSize = max((b.zw - b.xy) * 0.5, vec2(0.0001));',
    '    vec2 q = abs(p - centre) - halfSize;',
    '    float sd = length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0);',
    '    if (sd < best) {',
    '      best = sd;',
    '      foamWidth = u_EdgeParams[i].x;',
    '      shallowWidth = u_EdgeParams[i].y;',
    '    }',
    '  }',
    '  return best;',
    '}',
    '',
    'void addWave(',
    '  in float dirOffsetDeg,',
    '  in float lenRatio,',
    '  in float ampRatio,',
    '  in float steepness,',
    '  in float speedMul,',
    '  in float phaseOffset,',
    '  in vec2 worldXY,',
    '  in float windRad,',
    '  in float baseLen,',
    '  in float baseAmp,',
    '  in float time,',
    '  inout vec3 dPos,',
    '  inout vec3 dNorm,',
    '  inout float ampSum',
    ') {',
    '  float wavelength = baseLen * lenRatio;',
    '',
    '  // An octave the mesh cannot resolve is not a wave, it is sampling noise. Fade it out',
    '  // instead of drawing it. The CPU solver applies the identical fade, so buoyancy and',
    '  // WaveHeightAt() keep agreeing with the surface on screen.',
    '  float fade = smoothstep(u_MinWavelength * 0.5, u_MinWavelength, wavelength);',
    '  float a = baseAmp * ampRatio * fade;',
    '  ampSum += a;',
    '  if (a <= 0.0) return;',
    '',
    '  float angle = windRad + radians(dirOffsetDeg * u_DirSpread);',
    '  vec2 dir = vec2(cos(angle), sin(angle));',
    '  float k = (2.0 * PI) / max(wavelength, 1.0);',
    '  float w = sqrt(GRAVITY * k) * speedMul * u_WaveSpeed;',
    '  float q = clamp((u_WaveChoppiness * steepness) / (k * a * OCTAVE_COUNT + 0.0001), 0.0, 1.0);',
    '',
    '  // lenRatio varies per octave, so one seed shifts every octave by a different amount.',
    '  float phase = k * dot(dir, worldXY) - w * time + phaseOffset + u_PhaseSeed * lenRatio * 6.2831853;',
    '  float wanderRate = 0.045 + 0.035 * (1.0 - lenRatio);',
    '  float crossCoord = dot(vec2(-dir.y, dir.x), worldXY);',
    '  float wanderArg = k * crossCoord * 0.37 + time * wanderRate + phaseOffset * 1.731 + u_PhaseSeed * (0.37 + lenRatio);',
    '  phase += clamp(u_WaveIrregularity, 0.0, 1.0) * 0.55 * sin(wanderArg);',
    '  float sinP = sin(phase);',
    '  float cosP = cos(phase);',
    '',
    '  dPos.x -= q * a * dir.x * sinP;',
    '  dPos.y -= q * a * dir.y * sinP;',
    '  dPos.z += a * cosP;',
    '',
    '  float wa = w * a;',
    '  dNorm.x -= dir.x * wa * sinP;',
    '  dNorm.y -= dir.y * wa * sinP;',
    '  dNorm.z -= q * wa * cosP;',
    '}',
    '',
    'float interactionWave(vec2 p, out float foam) {',
    '  float displacement = 0.0;',
    '  foam = 0.0;',
    '  for (int i = 0; i < 16; i++) {',
    '    if (float(i) >= u_InteractionCount) break;',
    '    vec4 e = u_Interactions[i];',
    '    vec4 q = u_InteractionParams[i];',
    '    float age = u_Time - e.z;',
    '    if (age < 0.0 || age >= q.y) continue;',
    '    float fade = 1.0 - age / max(q.y, 0.001);',
    '    float travel = q.x * age / max(q.y, 0.001);',
    '    float width = max(q.x * 0.10, 4.0);',
    '    float dist = length(p - e.xy);',
    '    float shell = exp(-abs(dist - travel) / width);',
    '    float phase = (dist - travel) * 6.2831853 / max(q.x * 0.22, 8.0);',
    '    displacement += e.w * cos(phase) * shell * fade;',
    '    foam = max(foam, shell * fade * clamp(abs(e.w) / 8.0, 0.0, 1.0));',
    '  }',
    '  return displacement;',
    '}',
    '',
    'void main() {',
    '  vUv = uv;',
    '  vec4 worldPos = modelMatrix * vec4(position, 1.0);',
    '',
    '  // Un-mirror Y so the GPU phase matches the CPU Gerstner solver (GDevelop space).',
    '  vec2 gdXY = vec2(worldPos.x, -worldPos.y);',
    '',
    '  float edgeFoamWidth, edgeShallowWidth;',
    '  float edgeSignedDistance = signedDistanceToWaterEdge(gdXY, edgeFoamWidth, edgeShallowWidth);',
    '  float shoreAttenuation = 1.0;',
    '  if (u_EdgeCount > 0.0 && edgeShallowWidth > 0.0) {',
    '    // Flatten waves as they run onto land; the fragment shader masks the negative side.',
    '    shoreAttenuation = smoothstep(0.0, edgeShallowWidth, max(edgeSignedDistance, 0.0));',
    '  }',
    '  float baseAmp = u_WaveHeight * 0.5 * shoreAttenuation;',
    '  float windRad = radians(u_WindDir);',
    '  float baseLen = u_BaseWavelength / max(u_WaveTiling, 0.001);',
    '',
    '  vec3 dPos = vec3(0.0);',
    '  vec3 dNorm = vec3(0.0, 0.0, 1.0);',
    '  float ampSum = 0.0;',
    '',
  ].concat(GERSTNER_OCTAVES.map(function (o) {
    // Emitted from the octave table itself: a shader that hardcoded these would silently
    // drift from the CPU solver the first time the table changed.
    return '  addWave(' + [o.dirOffset, o.lenRatio, o.ampRatio, o.steepness, o.speedMul, o.phase]
      .map(function (v) { return v.toFixed(5); }).join(', ') +
      ', gdXY, windRad, baseLen, baseAmp, u_Time, dPos, dNorm, ampSum);';
  })).concat([
    '',
    '  float interactionFoam = 0.0;',
    '  dPos.z += interactionWave(gdXY, interactionFoam) * shoreAttenuation;',
    '  vInteractionFoam = interactionFoam * shoreAttenuation;',
    '',
    '  // Map the GDevelop-space displacement back into the mirrored three.js space.',
    '  worldPos.x += dPos.x;',
    '  worldPos.y -= dPos.y;',
    '  worldPos.z += dPos.z;',
    '',
    '  vWorldPosition = worldPos.xyz;',
    '  vGdXY = gdXY + vec2(dPos.x, dPos.y);',
    '',
    '  vec3 nMirrored = vec3(dNorm.x, -dNorm.y, dNorm.z);',
    '  float nLen = length(nMirrored);',
    '  vWorldNormal = (nLen > 0.0001) ? (nMirrored / nLen) : vec3(0.0, 0.0, 1.0);',
    '',
    '  // Normalise against the amplitude actually retained after the octave fade, not against',
    '  // the full baseAmp — otherwise whitecaps quietly stop appearing on a coarse mesh.',
    '  vWaveCrest = clamp((dPos.z / max(ampSum, 0.0001)) * 0.5 + 0.5, 0.0, 1.0);',
    '',
    '  gl_Position = projectionMatrix * viewMatrix * worldPos;',
    '}'
  ]).join('\n');

  // `cameraPosition`, `viewMatrix`, `modelMatrix` and `projectionMatrix` are declared by three.js's
  // own ShaderMaterial prefix (WebGLProgram) — redeclaring any of them is a GLSL redefinition error
  // and the material then silently never compiles. Do not add them here.
  var WATER_FRAGMENT_SHADER = [
    'precision highp float;',
    '',
    'uniform vec3 u_ShallowColor;',
    'uniform vec3 u_DeepColor;',
    'uniform float u_ExtinctionDepth;',
    'uniform float u_RefractionScale;',
    'uniform float u_ShoreFoamIntensity;',
    'uniform float u_CrestFoamIntensity;',
    'uniform float u_CausticsIntensity;',
    'uniform float u_CausticsDepthFade;',
    'uniform float u_FoamModel;',
    'uniform float u_FoamSoftness;',
    'uniform float u_QuantiseBands;',
    'uniform float u_WaveHeight;',
    'uniform float u_Time;',
    'uniform vec3 u_SunDirection;',
    'uniform float u_WaveTiling;',
    'uniform vec2 u_PlaneSize;',
    'uniform float u_WaterDepth;',
    'uniform float u_EdgeCount;',
    'uniform float u_EdgeMask;',
    'uniform vec4 u_EdgeBounds[8];',
    'uniform vec2 u_EdgeParams[8];',
    'uniform samplerCube u_EnvMap;',
    'uniform float u_HasEnvMap;',
    '',
    'varying vec3 vWorldPosition;',
    'varying vec3 vWorldNormal;',
    'varying vec2 vUv;',
    'varying vec2 vGdXY;',
    'varying float vWaveCrest;',
    'varying float vInteractionFoam;',
    '',
    '// Beer-Lambert extinction coefficients (red absorbs fastest, blue penetrates deepest).',
    'const vec3 BETA_EXTINCTION = vec3(0.35, 0.08, 0.02);',
    '',
    '// Signed distance to the union of WaterEdge3D AABBs: positive on water, negative on land.',
    'float signedDistanceToWaterEdge(vec2 p, out float foamWidth, out float shallowWidth) {',
    '  float best = 1.0e9;',
    '  foamWidth = 0.0;',
    '  shallowWidth = 0.0;',
    '  for (int i = 0; i < 8; i++) {',
    '    if (float(i) >= u_EdgeCount) break;',
    '    vec4 b = u_EdgeBounds[i];',
    '    vec2 centre = (b.xy + b.zw) * 0.5;',
    '    vec2 halfSize = max((b.zw - b.xy) * 0.5, vec2(0.0001));',
    '    vec2 q = abs(p - centre) - halfSize;',
    '    float sd = length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0);',
    '    if (sd < best) {',
    '      best = sd;',
    '      foamWidth = u_EdgeParams[i].x;',
    '      shallowWidth = u_EdgeParams[i].y;',
    '    }',
    '  }',
    '  return best;',
    '}',
    '',
    'vec2 hash2(vec2 p) {',
    '  p = mod(p, 256.0);',
    '  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));',
    '  return fract(sin(p) * 43758.5453123);',
    '}',
    '',
    '// 2-octave value noise. Foam break-up has to be aperiodic: the sine ruling it replaces',
    '// repeated hundreds of times across a single ocean and read as ruled lines.',
    'float valueNoise(vec2 p) {',
    '  vec2 i = floor(p);',
    '  vec2 f = fract(p);',
    '  vec2 u = f * f * (3.0 - 2.0 * f);',
    '  float a = hash2(i).x;',
    '  float b = hash2(i + vec2(1.0, 0.0)).x;',
    '  float c = hash2(i + vec2(0.0, 1.0)).x;',
    '  float d = hash2(i + vec2(1.0, 1.0)).x;',
    '  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);',
    '}',
    '',
    'float foamNoise(vec2 p) {',
    '  return valueNoise(p) * 0.62 + valueNoise(p * 2.17 + vec2(3.7, 1.3)) * 0.38;',
    '}',
    '',
    'float voronoiCaustics(vec2 uv, float time) {',
    '  vec2 p = uv * 3.5;',
    '  vec2 ip = floor(p);',
    '  vec2 fp = fract(p);',
    '  float d1 = 8.0;',
    '  float d2 = 8.0;',
    '  for (int y = -1; y <= 1; y++) {',
    '    for (int x = -1; x <= 1; x++) {',
    '      vec2 nb = vec2(float(x), float(y));',
    '      vec2 pt = hash2(ip + nb);',
    '      pt = 0.5 + 0.40 * sin(time * 1.3 + 6.2831853 * pt);',
    '      vec2 diff = nb + pt - fp;',
    '      float d = dot(diff, diff);',
    '      if (d < d1) {',
    '        d2 = d1;',
    '        d1 = d;',
    '      } else if (d < d2) {',
    '        d2 = d;',
    '      }',
    '    }',
    '  }',
    '  float edge = sqrt(d2) - sqrt(d1);',
    '  float caustic = clamp((0.22 - edge) / 0.22, 0.0, 1.0);',
    '  return caustic * caustic;',
    '}',
    '',
    'void main() {',
    '  vec3 toCam = cameraPosition - vWorldPosition;',
    '  float camDist = length(toCam);',
    '  vec3 viewDir = (camDist > 0.0001) ? (toCam / camDist) : vec3(0.0, 0.0, 1.0);',
    '',
    '  float nLen = length(vWorldNormal);',
    '  vec3 normal = (nLen > 0.0001) ? (vWorldNormal / nLen) : vec3(0.0, 0.0, 1.0);',
    '  if (!gl_FrontFacing) {',
    '    if (toCam.z > 0.0) discard;',
    '    normal = -normal;',
    '  }',
    '',
    '  float NdotV = abs(dot(normal, viewDir));',
    '  // Schlick Fresnel, F0 = 0.02 for water (n = 1.333).',
    '  float fresnel = 0.02 + 0.98 * pow(1.0 - NdotV, 5.0);',
    '',
    '  // Optical column depth. With no scene depth pre-pass available the column is approximated',
    '  // from the distance to the water volume edge, clamped by the volume depth: shallow at the',
    '  // shoreline, full depth toward the middle of the body.',
    '  vec2 duv = min(vUv, vec2(1.0) - vUv);',
    '  float volumeEdgeDist = min(duv.x * u_PlaneSize.x, duv.y * u_PlaneSize.y);',
    '  float foamWidth = max(u_WaveHeight * 2.0, 4.0);',
    '  float shallowWidth = max(foamWidth * 3.0, 12.0);',
    '  float edgeDist = volumeEdgeDist;',
    '  float landMask = 1.0;',
    '  if (u_EdgeCount > 0.0) {',
    '    float signedEdge = signedDistanceToWaterEdge(vGdXY, foamWidth, shallowWidth);',
    '    float insetFade = max(foamWidth * 0.5, 1.0);',
    '    landMask = mix(1.0, smoothstep(-insetFade, 0.0, signedEdge), u_EdgeMask);',
    '    if (landMask <= 0.001) discard;',
    '    edgeDist = max(signedEdge, 0.0);',
    '    // With masking off the water keeps rendering under the land footprint. Shade that',
    '    // region as OPEN water: edgeDist is 0 there, which otherwise reads as infinitely',
    '    // shallow water at full surf and turns the whole footprint into one white slab.',
    '    if (signedEdge < 0.0) edgeDist = max(shallowWidth, foamWidth);',
    '  }',
    '  float column = min(edgeDist, max(u_WaterDepth, 0.0));',
    '  if (u_EdgeCount > 0.0 && shallowWidth > 0.0) {',
    '    column = min(u_WaterDepth, u_WaterDepth * clamp(edgeDist / shallowWidth, 0.0, 1.0));',
    '  }',
    '  vec3 transmit = exp(-BETA_EXTINCTION * (column / max(u_ExtinctionDepth, 1.0)) * 6.0);',
    '  vec3 waterColor = mix(u_DeepColor, u_ShallowColor, transmit);',
    '',
    '  // Surface-normal distortion standing in for screen-space refraction (no scene color buffer',
    '  // is exposed to sample, so the distortion is applied to the caustic pattern instead).',
    '  vec2 refractOffset = normal.xy * u_RefractionScale * 40.0;',
    '  if (u_CausticsIntensity > 0.0) {',
    '    float causticFalloff = clamp(1.0 - (column / max(u_ExtinctionDepth * 0.65, 20.0)), 0.0, 1.0);',
    '    float causticAtten = mix(1.0, causticFalloff, clamp(u_CausticsDepthFade, 0.0, 1.0));',
    '    if (causticAtten > 0.001) {',
    '      vec2 cUv = (vGdXY + refractOffset) * 0.004 * max(u_WaveTiling, 0.001);',
    '      float caustics1 = voronoiCaustics(cUv, u_Time * 1.2);',
    '      float caustics2 = voronoiCaustics(cUv * 1.75 + vec2(1.7, 3.2), u_Time * 1.5);',
    '      float caustics = (caustics1 + caustics2) * 0.5;',
    '      waterColor += vec3(caustics * 0.28 * u_CausticsIntensity * causticAtten * transmit.g);',
    '    }',
    '  }',
    '',
    '  // Shore foam: a definite contact line plus broken trailing surf on the water side.',
    '  float shoreBand = 1.0 - smoothstep(0.0, foamWidth, edgeDist);',
    '  float contactFoam = 1.0 - smoothstep(0.0, max(foamWidth * 0.20, 3.0), edgeDist);',
    '  float shoreBreakup = 0.68 + 0.32 * sin(vGdXY.x * 0.047 + u_Time * 1.7) * cos(vGdXY.y * 0.053 - u_Time * 1.1);',
    '  float trailingFoam = smoothstep(0.15, 0.82, 0.5 + 0.5 * sin(edgeDist * 0.12 - u_Time * 2.2 + shoreBreakup * 3.0));',
    '  float shoreFoam = clamp(max(contactFoam * 0.95, shoreBand * (0.52 * shoreBreakup + 0.38 * trailingFoam)) * u_ShoreFoamIntensity, 0.0, 1.0);',
    '',
    '  // Crest whitecaps on the steep tops of the swell.',
    '  // Softness widens the crest ramp; foamModel 0 (a pool) removes whitecaps entirely.',
    '  float softness = (u_FoamSoftness > 0.001) ? u_FoamSoftness : 1.0;',
    '  float crestFoam = smoothstep(0.62, min(0.62 + 0.30 * softness, 1.0), vWaveCrest)',
    '                  * u_CrestFoamIntensity * step(0.5, u_FoamModel);',
    '',
    '  float foam = clamp(max(max(shoreFoam, crestFoam), vInteractionFoam), 0.0, 1.0);',
    '  vec3 foamColor = vec3(0.95, 0.98, 1.0);',
    '',
    '  // Sun specular gleam.',
    '  vec3 sunDir = normalize(u_SunDirection);',
    '  vec3 halfVec = normalize(sunDir + viewDir);',
    '  float NdotH = max(dot(normal, halfVec), 0.0);',
    '  float specular = pow(NdotH, 64.0) * 1.5 * (1.0 - foam);',
    '  waterColor += vec3(specular);',
    '',
    '  // Sky reflection.',
    '  vec3 reflectDir = reflect(-viewDir, normal);',
    '  vec3 skyReflection;',
    '  if (u_HasEnvMap > 0.5) {',
    '    skyReflection = textureCube(u_EnvMap, vec3(reflectDir.x, -reflectDir.y, reflectDir.z)).rgb;',
    '  } else {',
    '    skyReflection = vec3(0.65, 0.85, 1.0);',
    '  }',
    '  vec3 finalColor = mix(waterColor, skyReflection, fresnel * 0.35);',
    '  // Foam is a final surface layer: reflections must not wash it back into the water tint.',
    '  finalColor = mix(finalColor, foamColor, foam);',
    '  if (u_QuantiseBands > 0.5) {',
    '    finalColor = floor(finalColor * u_QuantiseBands + 0.5) / u_QuantiseBands;',
    '  }',
    '',
    '  // Shallow water reads through; deep water and foam go opaque.',
    '  float alpha = mix(0.45, 0.95, 1.0 - transmit.g);',
    '  alpha = clamp(max(alpha + fresnel * 0.2, foam), 0.0, 1.0);',
    '',
    '  gl_FragColor = vec4(finalColor, alpha * landMask);',
    '}'
  ].join('\n');

  /* ------------------------------------------------------------- Gerstner Water 2 Shaders (Stylized Sea of Thieves) */



  /* ------------------------------------------------------------- FluidAndWater3D Namespace */

  var FluidAndWater3D = {
    FLUID_PRESETS: FLUID_PRESETS,
    WATER_TYPE_PRESETS: WATER_TYPE_PRESETS,
    resolveWaterTypePreset: resolveWaterTypePreset,
    BEAUFORT_SCALE_PRESETS: BEAUFORT_SCALE_PRESETS,
    /** The scene's spray pool, or null if nothing has asked for spray yet. */
    spraySystemOf: function (runtimeScene) {
      if (!runtimeScene) return null;
      var st = getSceneState(runtimeScene);
      return st ? (st.spray || null) : null;
    },
    SpraySystem: SpraySystem,
    emitWaveCollisionSpray: emitWaveCollisionSpray,
    resolveWaveWorksBeaufortPreset: resolveWaveWorksBeaufortPreset,
    beaufortAt: beaufortAt,
    beaufortLabel: beaufortLabel,
    BEAUFORT_RUNG_NAMES: BEAUFORT_RUNG_NAMES,
    GERSTNER_OCTAVES: GERSTNER_OCTAVES,
    GERSTNER2_WAVES: GERSTNER2_WAVES,
    WATER_DETAILING_PRESETS: WATER_DETAILING_PRESETS,
    resolveWaterDetailingPreset: resolveWaterDetailingPreset,
    WATER_DETAILING_STYLES: WATER_DETAILING_STYLES,
    WATER_DETAILING_TYPES: WATER_DETAILING_TYPES,
    resolveWaterDetailingStyle: resolveWaterDetailingStyle,
    resolveWaterDetailingType: resolveWaterDetailingType,
    WATER_DETAILING_SUBSTYLES: WATER_DETAILING_SUBSTYLES,
    resolveWaterDetailingSubStyle: resolveWaterDetailingSubStyle,
    resolveWaterDetailingFoam: resolveWaterDetailingFoam,
    WATER_DETAILING_FOAM: WATER_DETAILING_FOAM,
    WATER_DETAILING_LIGHTING: WATER_DETAILING_LIGHTING,
    resolveWaterDetailingLighting: resolveWaterDetailingLighting,
    composeWaterDetailingLook: composeWaterDetailingLook,

    OceanField: OceanField,
    OceanFFT: OceanFFT,
    FoamBuffer: FoamBuffer,
    SPHSolver: SPHSolver,
    SpraySystem: SpraySystem,
    phillipsSpectrum: phillipsSpectrum,
    oceanGaussianPair: oceanGaussianPair,

    evaluateGerstnerDisplacement: evaluateGerstnerDisplacement,
    evaluateGerstnerNormal: evaluateGerstnerNormal,
    evaluateWaveVelocity: evaluateWaveVelocity,

    /* ========================================================= 1. WaterBody3D */

    registerWaterBody: function (runtimeScene, object, behavior, options) {
      if (!runtimeScene || !object || !behavior) return null;
      var state = getSceneState(runtimeScene);

      // A named Water Type owns the palette; Custom hands it back to the properties below.
      var wtName = options.waterType || 'Ocean';
      var wt = (wtName !== 'Custom') ? resolveWaterTypePreset(wtName) : null;
      var to255 = function (c) { return [c[0] * 255, c[1] * 255, c[2] * 255]; };

      var shallow = wt ? to255(wt.shallowColor) : parseColor(options.shallowColor, [64, 224, 208]);
      var deep = wt ? to255(wt.deepColor) : parseColor(options.deepColor, [10, 45, 90]);
      var fogCol = parseColor(options.underwaterFogColor, [15, 65, 110]);

      var width = (object.getWidth && object.getWidth() > 0) ? object.getWidth() : 1000;
      var height = (object.getHeight && object.getHeight() > 0) ? object.getHeight() : 1000;
      var depth = (object.getDepth && object.getDepth() > 0) ? object.getDepth() : 0;

      var body = {
        object: object,
        behavior: behavior,
        isOctaveSum: true,
        waterType: options.waterType || 'Ocean',
        waveHeight: num(options.waveHeight, 18.0),
        waveChoppiness: num(options.waveChoppiness, 0.75),
        waveSpeed: num(options.waveSpeed, 1.0),
        windDirection: num(options.windDirection, 45.0),
        waveTiling: num(options.waveTiling, 1.0),
        materialSource: options.materialSource || 'Builtin',
        shallowColor: [shallow[0] / 255, shallow[1] / 255, shallow[2] / 255],
        deepColor: [deep[0] / 255, deep[1] / 255, deep[2] / 255],
        extinctionDepth: wt ? wt.extinctionDepth : num(options.extinctionDepth, 150.0),
        refractionScale: wt ? wt.refractionScale : num(options.refractionScale, 0.02),
        maskUnderEdges: options.maskUnderEdges !== undefined ? !!options.maskUnderEdges : true,
        shoreFoamIntensity: wt ? wt.shoreFoamIntensity : num(options.shoreFoamIntensity, 0.85),
        crestFoamIntensity: wt ? wt.crestFoamIntensity : num(options.crestFoamIntensity, 0.60),
        causticsIntensity: wt ? wt.causticsIntensity : 1.0,
        causticsDepthFade: wt && wt.causticsDepthFade !== undefined ? wt.causticsDepthFade : 1.0,
        enableCaustics: options.enableCaustics !== undefined ? !!options.enableCaustics : true,
        enableUnderwaterFX: options.enableUnderwaterFX !== undefined ? !!options.enableUnderwaterFX : false,
        underwaterFogColor: [fogCol[0] / 255, fogCol[1] / 255, fogCol[2] / 255],
        underwaterFogDensity: num(options.underwaterFogDensity, 0.0005),
        gridSubdivisions: options.gridSubdivisions || 48,
        waveScaleMode: options.waveScaleMode || 'Absolute',
        directionalSpread: num(options.directionalSpread, 45.0),
        phaseSeed: options.phaseSeed || 0.0,
        waveIrregularity: clamp(num(options.waveIrregularity, 0.4), 0.0, 1.0),
        enableBodyInteractions: options.enableBodyInteractions !== undefined ? !!options.enableBodyInteractions : true,
        interactionStrength: options.interactionStrength !== undefined ? Math.max(options.interactionStrength, 0.0) : 14.0,
        interactionRadius: options.interactionRadius !== undefined ? Math.max(options.interactionRadius, 1.0) : 180.0,
        interactionSpeedThreshold: options.interactionSpeedThreshold !== undefined ? Math.max(options.interactionSpeedThreshold, 0.0) : 35.0,
        interactionLifetime: 1.6,
        interactions: [],
        interactionTracks: typeof WeakMap === 'function' ? new WeakMap() : null,
        // Derived, not authored: recomputed whenever the volume is resized.
        baseWavelength: 0.0,
        minWavelength: 0.0,
        waveDetailFraction: 1.0,
        isCameraUnderwater: false,
        initialWidth: width,
        initialHeight: height,
        layerName: objectLayerName(object),
        mesh: null,
        material: null
      };

      var subs = Math.round(clamp(body.gridSubdivisions, 8, 256));
      body.baseWavelength = computeBaseWavelength(body.waveScaleMode, width, height);
      body.minWavelength = computeMinWavelength(width, height, subs);
      refreshWaveResolution(body, width, height, subs);

      if (THREE_OK) {
        var geom = new THREE.PlaneGeometry(width, height, subs, subs);

        var mat = new THREE.ShaderMaterial({
          vertexShader: WATER_VERTEX_SHADER,
          fragmentShader: WATER_FRAGMENT_SHADER,
          transparent: true,
          depthWrite: true,
          depthTest: true,
          side: THREE.DoubleSide,
          uniforms: {
            u_Time: { value: 0.0 },
            u_WaveHeight: { value: body.waveHeight },
            u_WaveChoppiness: { value: body.waveChoppiness },
            u_WaveSpeed: { value: body.waveSpeed },
            u_WindDir: { value: body.windDirection },
            u_WaveTiling: { value: body.waveTiling },
            u_BaseWavelength: { value: body.baseWavelength },
            u_MinWavelength: { value: body.minWavelength },
            u_DirSpread: { value: body.directionalSpread / 45.0 },
            u_PhaseSeed: { value: body.phaseSeed },
            u_WaveIrregularity: { value: body.waveIrregularity },
            u_ShallowColor: { value: new THREE.Vector3().fromArray(body.shallowColor) },
            u_DeepColor: { value: new THREE.Vector3().fromArray(body.deepColor) },
            u_ExtinctionDepth: { value: body.extinctionDepth },
            u_RefractionScale: { value: body.refractionScale },
            u_ShoreFoamIntensity: { value: body.shoreFoamIntensity },
            u_CrestFoamIntensity: { value: body.crestFoamIntensity },
            u_SunDirection: { value: new THREE.Vector3(0.5, 0.8, 1.0).normalize() },
            u_CausticsIntensity: { value: body.enableCaustics ? body.causticsIntensity : 0.0 },
            u_CausticsDepthFade: { value: body.causticsDepthFade },
            // Effect-module defaults, so water with no WaterDetailing3D attached still draws foam.
            u_FoamModel: { value: 1.0 },
            u_FoamSoftness: { value: 1.0 },
            u_QuantiseBands: { value: 0.0 },
            u_PlaneSize: { value: new THREE.Vector2(width, height) },
            u_WaterDepth: { value: depth > 0 ? depth : 150.0 },
            u_EdgeCount: { value: 0.0 },
            u_EdgeMask: { value: body.maskUnderEdges ? 1.0 : 0.0 },
            u_EdgeBounds: { value: makeEdgeBoundsArray() },
            u_EdgeParams: { value: makeEdgeParamsArray() },
            u_InteractionCount: { value: 0.0 },
            u_Interactions: { value: makeInteractionArray() },
            u_InteractionParams: { value: makeInteractionArray() },
            u_EnvMap: { value: null },
            u_HasEnvMap: { value: 0.0 }
            // No `cameraPosition` uniform here: three.js declares and feeds it automatically for
            // every ShaderMaterial. Declaring our own shadows it and breaks shader compilation.
          }
        });
        body.material = mat;
        body.mesh = new THREE.Mesh(geom, mat);
        body.mesh.name = 'FluidAndWater3D_WaterPlane';
        body.mesh.frustumCulled = false;
        // Recent GDevelop builds apply an instance's editor transform after behavior onCreated.
        // A surface positioned here can therefore spend initialization at world origin. Keep it
        // hidden until doStepPreEvents reads the final transform and places it atomically.
        body.mesh.visible = false;

        // Parent to the object's OWN layer, not a hardcoded base layer — otherwise a water body on
        // any other layer is added to a scene that is never rendered for it.
        var threeRoot = getLayerThreeRoot(runtimeScene, body.layerName);
        if (threeRoot) threeRoot.add(body.mesh);

        // Apply 6-material water volume array to replace purple placeholder
        if (typeof THREE.MeshBasicMaterial === 'function') {
          var sideMat = new THREE.MeshBasicMaterial({
            color: new THREE.Color(body.shallowColor[0], body.shallowColor[1], body.shallowColor[2]),
            transparent: true,
            opacity: 0.55,
            depthWrite: true,
            side: THREE.DoubleSide
          });
          var topMat = new THREE.MeshBasicMaterial({
            visible: false
          });
          var bottomMat = new THREE.MeshBasicMaterial({
            color: new THREE.Color(body.deepColor[0], body.deepColor[1], body.deepColor[2]),
            transparent: true,
            opacity: 0.65,
            depthWrite: true,
            side: THREE.DoubleSide
          });
          body.boxMaterials = [sideMat, sideMat, sideMat, sideMat, topMat, bottomMat];
          // Applying these to the source box is deferred with the surface transform below.
        }
      }

      state.waterBodies.push(body);

      if (!state._waterAnnounced && typeof console !== 'undefined' && console.info) {
        state._waterAnnounced = true;
        console.info('[FluidAndWater3D] WaterBody3D (Gerstner) registered on "' +
          (object.getName ? object.getName() : '?') + '" — mesh ' +
          (body.mesh ? 'created' : 'MISSING') + ', parent = ' +
          (body.mesh && body.mesh.parent ? (body.mesh.parent.type || 'object') : 'NONE') +
          '. This is the octave-sum water, not the Tessendorf ocean.');
      }

      return body;
    },

    stepWaterBody: function (runtimeScene, object, behavior) {
      var body = FluidAndWater3D.waterBodyOf(runtimeScene, behavior);
      if (!body) return;

      // Follow the object if it is moved to another layer at runtime.
      var currentLayer = objectLayerName(object);
      if (currentLayer !== body.layerName) {
        body.layerName = currentLayer;
        if (body.mesh && body.mesh.parent && body.mesh.parent.remove) body.mesh.parent.remove(body.mesh);
      }

      if (body.mesh && !body.mesh.parent) {
        var threeRoot = getLayerThreeRoot(runtimeScene, body.layerName);
        if (threeRoot) threeRoot.add(body.mesh);
      }

      var objX = object.getX ? object.getX() : 0;
      var objY = object.getY ? object.getY() : 0;
      var objZ = object.getZ ? object.getZ() : 0;
      var w = (object.getWidth && object.getWidth() > 0) ? object.getWidth() : 1000;
      var h = (object.getHeight && object.getHeight() > 0) ? object.getHeight() : 1000;
      var d = (object.getDepth && object.getDepth() > 0) ? object.getDepth() : 0;

      if (body.mesh) {
        body.mesh.position.set(objX + w * 0.5, objY + h * 0.5, objZ + d + 0.1);

        if (body.initialWidth > 0 && body.initialHeight > 0) {
          body.mesh.scale.set(w / body.initialWidth, h / body.initialHeight, 1.0);
        }

        // GDevelop 3D objects rotate ZYX; three.js defaults to XYZ, which reorders the same angles
        // into a different orientation as soon as two axes are non-zero.
        if (body.mesh.rotation && body.mesh.rotation.order !== 'ZYX') body.mesh.rotation.order = 'ZYX';
        if (object.getAngle) body.mesh.rotation.z = object.getAngle() * (Math.PI / 180.0);
        if (object.getRotationX) body.mesh.rotation.x = object.getRotationX() * (Math.PI / 180.0);
        if (object.getRotationY) body.mesh.rotation.y = object.getRotationY() * (Math.PI / 180.0);
        // Reveal only after position, scale and rotation all describe the editor instance, and
        // only while the object itself is not hidden.
        body.mesh.visible = !objectIsHidden(object);
        syncSceneLightingAndSky(runtimeScene, body);

        // Wave scale, shore foam and optical depth all read the volume's dimensions, so they
        // have to be recomputed when it is resized rather than frozen at creation.
        var liveSubs = Math.round(clamp(body.gridSubdivisions, 8, 256));
        body.baseWavelength = computeBaseWavelength(body.waveScaleMode, w, h);
        body.minWavelength = computeMinWavelength(w, h, liveSubs);
        refreshWaveResolution(body, w, h, liveSubs);

        if (body.material && body.material.uniforms) {
          var su = body.material.uniforms;
          if (su.u_PlaneSize && su.u_PlaneSize.value && su.u_PlaneSize.value.set) {
            su.u_PlaneSize.value.set(w, h);
          }
          if (su.u_WaterDepth) su.u_WaterDepth.value = d > 0 ? d : 150.0;
          if (su.u_BaseWavelength) su.u_BaseWavelength.value = body.baseWavelength;
          if (su.u_MinWavelength) su.u_MinWavelength.value = body.minWavelength;
        }
      }

      // Ensure original 3D box maintains water volume materials
      var root = getRootObject3D(object);
      if (root) {
        root.visible = !objectIsHidden(object);
        if (body.boxMaterials) {
          if (root.isMesh && root.material !== body.boxMaterials) root.material = body.boxMaterials;
          if (typeof root.traverse === 'function') {
            root.traverse(function (child) {
              if (child && child.isMesh && child !== body.mesh && child.material !== body.boxMaterials) {
                child.material = body.boxMaterials;
              }
            });
          }
        }
      }
    },

    updateWaterBody: function (runtimeScene, object, behavior, options) {
      var body = FluidAndWater3D.waterBodyOf(runtimeScene, behavior);
      if (!body) return;

      if (options.waveHeight !== undefined) body.waveHeight = options.waveHeight;
      if (options.waveChoppiness !== undefined) body.waveChoppiness = options.waveChoppiness;
      if (options.waveSpeed !== undefined) body.waveSpeed = options.waveSpeed;
      if (options.windDirection !== undefined) body.windDirection = options.windDirection;
      if (options.waveTiling !== undefined) body.waveTiling = options.waveTiling;
      if (options.extinctionDepth !== undefined) body.extinctionDepth = options.extinctionDepth;
      if (options.refractionScale !== undefined) body.refractionScale = options.refractionScale;
      if (options.shoreFoamIntensity !== undefined) body.shoreFoamIntensity = options.shoreFoamIntensity;
      if (options.crestFoamIntensity !== undefined) body.crestFoamIntensity = options.crestFoamIntensity;
      if (options.enableUnderwaterFX !== undefined) body.enableUnderwaterFX = !!options.enableUnderwaterFX;
      if (options.enableCaustics !== undefined) body.enableCaustics = !!options.enableCaustics;
      if (options.waveScaleMode !== undefined) body.waveScaleMode = options.waveScaleMode;
      if (options.directionalSpread !== undefined) body.directionalSpread = options.directionalSpread;
      if (options.phaseSeed !== undefined) body.phaseSeed = options.phaseSeed;
      if (options.waveIrregularity !== undefined) body.waveIrregularity = clamp(options.waveIrregularity, 0.0, 1.0);
      if (options.enableBodyInteractions !== undefined) body.enableBodyInteractions = !!options.enableBodyInteractions;
      if (options.interactionStrength !== undefined) body.interactionStrength = Math.max(options.interactionStrength, 0.0);
      if (options.interactionRadius !== undefined) body.interactionRadius = Math.max(options.interactionRadius, 1.0);
      if (options.interactionSpeedThreshold !== undefined) body.interactionSpeedThreshold = Math.max(options.interactionSpeedThreshold, 0.0);
      if (options.underwaterFogDensity !== undefined) body.underwaterFogDensity = options.underwaterFogDensity;

      if (options.shallowColor) {
        var sc = parseColor(options.shallowColor, [64, 224, 208]);
        body.shallowColor = [sc[0] / 255, sc[1] / 255, sc[2] / 255];
        if (body.boxMaterials && body.boxMaterials[0] && body.boxMaterials[0].color) {
          body.boxMaterials[0].color.setRGB(body.shallowColor[0], body.shallowColor[1], body.shallowColor[2]);
        }
      }
      if (options.deepColor) {
        var dc = parseColor(options.deepColor, [10, 45, 90]);
        body.deepColor = [dc[0] / 255, dc[1] / 255, dc[2] / 255];
        if (body.boxMaterials && body.boxMaterials[5] && body.boxMaterials[5].color) {
          body.boxMaterials[5].color.setRGB(body.deepColor[0], body.deepColor[1], body.deepColor[2]);
        }
      }
      if (options.underwaterFogColor) {
        var fc = parseColor(options.underwaterFogColor, [15, 65, 110]);
        body.underwaterFogColor = [fc[0] / 255, fc[1] / 255, fc[2] / 255];
      }

      if (body.material && body.material.uniforms) {
        var u = body.material.uniforms;
        if (u.u_WaveHeight) u.u_WaveHeight.value = body.waveHeight;
        if (u.u_WaveChoppiness) u.u_WaveChoppiness.value = body.waveChoppiness;
        if (u.u_WaveSpeed) u.u_WaveSpeed.value = body.waveSpeed;
        if (u.u_WindDir) u.u_WindDir.value = body.windDirection;
        if (u.u_WaveTiling) u.u_WaveTiling.value = body.waveTiling;
        if (u.u_ExtinctionDepth) u.u_ExtinctionDepth.value = body.extinctionDepth;
        if (u.u_RefractionScale) u.u_RefractionScale.value = body.refractionScale;
        if (u.u_ShoreFoamIntensity) u.u_ShoreFoamIntensity.value = body.shoreFoamIntensity;
        if (u.u_EdgeMask) u.u_EdgeMask.value = body.maskUnderEdges ? 1.0 : 0.0;
        if (u.u_CrestFoamIntensity) u.u_CrestFoamIntensity.value = body.crestFoamIntensity;
        if (u.u_CausticsIntensity) u.u_CausticsIntensity.value = body.enableCaustics ? body.causticsIntensity : 0.0;
        if (u.u_DirSpread) u.u_DirSpread.value = body.directionalSpread / 45.0;
        if (u.u_PhaseSeed) u.u_PhaseSeed.value = body.phaseSeed;
        if (u.u_WaveIrregularity) u.u_WaveIrregularity.value = body.waveIrregularity;
        if (u.u_ShallowColor) u.u_ShallowColor.value.set(body.shallowColor[0], body.shallowColor[1], body.shallowColor[2]);
        if (u.u_DeepColor) u.u_DeepColor.value.set(body.deepColor[0], body.deepColor[1], body.deepColor[2]);
      }
    },

    disposeWaterBody: function (runtimeScene, behavior) {
      if (!runtimeScene || !behavior) return;
      var state = getSceneState(runtimeScene);
      var idx = state.waterBodies.findIndex(function (b) { return b.behavior === behavior; });
      if (idx !== -1) {
        var body = state.waterBodies[idx];
        if (body.mesh) {
          if (body.mesh.geometry) body.mesh.geometry.dispose();
          if (body.mesh.material) body.mesh.material.dispose();
          if (body.mesh.parent) body.mesh.parent.remove(body.mesh);
        }
        if (body.boxMaterials) {
          if (body.boxMaterials[0]) body.boxMaterials[0].dispose();
          if (body.boxMaterials[4]) body.boxMaterials[4].dispose();
          if (body.boxMaterials[5]) body.boxMaterials[5].dispose();
        }
        if (body.volumeMaterial) {
          body.volumeMaterial.dispose();
        }
        state.waterBodies.splice(idx, 1);
      }
    },

    waterBodyOf: function (runtimeScene, behavior) {
      if (!runtimeScene || !behavior) return null;
      var state = getSceneState(runtimeScene);
      return state.waterBodies.find(function (b) { return b.behavior === behavior; }) || null;
    },

    getWaveHeightAt: function (runtimeScene, behavior, x, y) {
      var state = getSceneState(runtimeScene);
      var body = behavior ? FluidAndWater3D.waterBodyOf(runtimeScene, behavior) : state.waterBodies[0];
      if (!body) return 0.0;
      var baseZ = (body.object.getZ ? body.object.getZ() : 0.0) +
        ((body.object.getDepth && body.object.getDepth() > 0) ? body.object.getDepth() : 0.0);
      var edge = waterEdgeInfluenceAt(state, x, y, body.layerName, baseZ, waterSpanOf(body));
      var waveDisp = evaluateGerstnerDisplacement(x, y, state.time,
        waveConfigOf(body, body.object.getZ ? body.object.getZ() : 0.0));
      return (waveDisp + interactionDisplacementAt(body, x, y, state.time)) * edge.attenuation;
    },

    getWaterSurfaceZ: function (runtimeScene, behavior, x, y) {
      var state = getSceneState(runtimeScene);
      var body = behavior ? FluidAndWater3D.waterBodyOf(runtimeScene, behavior) : state.waterBodies[0];
      if (!body || !body.object) return 0.0;
      var baseZ = (body.object.getZ ? body.object.getZ() : 0.0) + (body.object.getDepth ? body.object.getDepth() : 0.0);
      return baseZ + FluidAndWater3D.getWaveHeightAt(runtimeScene, behavior, x, y);
    },

    /**
     * Percentage of the authored wave amplitude this body's mesh can actually draw (0-100).
     * 100 means every octave is resolved; 0 means the surface renders flat — raise
     * GridSubdivisions or switch WaveScaleMode to "RelativeToVolume".
     */
    getWaveDetailPercent: function (runtimeScene, behavior) {
      var body = FluidAndWater3D.waterBodyOf(runtimeScene, behavior);
      if (!body) return 0.0;
      return clamp(body.waveDetailFraction * 100.0, 0.0, 100.0);
    },

    isCameraUnderwater: function (runtimeScene, behavior) {
      var body = FluidAndWater3D.waterBodyOf(runtimeScene, behavior);
      return body ? body.isCameraUnderwater : false;
    },

    isPositionUnderwater: function (runtimeScene, behavior, x, y, z) {
      var state = getSceneState(runtimeScene);
      var body = behavior ? FluidAndWater3D.waterBodyOf(runtimeScene, behavior) : state.waterBodies[0];
      if (!body || !body.object) return false;

      var obj = body.object;
      var objX = obj.getX ? obj.getX() : 0;
      var objY = obj.getY ? obj.getY() : 0;
      var objZ = obj.getZ ? obj.getZ() : 0;
      var objW = (obj.getWidth && obj.getWidth() > 0) ? obj.getWidth() : 1000;
      var objH = (obj.getHeight && obj.getHeight() > 0) ? obj.getHeight() : 1000;
      var objD = (obj.getDepth && obj.getDepth() > 0) ? obj.getDepth() : 0;

      var inX = x >= objX && x <= (objX + objW);
      var inY = y >= objY && y <= (objY + objH);
      if (!inX || !inY) return false;

      var surfZ = objZ + objD + FluidAndWater3D.getWaveHeightAt(runtimeScene, behavior, x, y);
      return z >= (objZ - 10.0) && z <= surfZ;
    },

    /* ========================================================= 4. OceanFFT3D */


    /**
     * Rebuilds the wave field when the water volume's real size turns out to differ from the size
     * it was built for.
     *
     * GDevelop applies an instance's custom width/height AFTER the behavior's onCreated runs, so at
     * registration a Cube3D still reports its object default (100 x 100 x 100). Everything derived
     * from the volume size — the tile the field repeats over, and the significant wave height the
     * spectrum is normalised to — is therefore wrong until the first step. Freezing it at creation
     * left a 7000-unit ocean carrying a 100-unit tile and 300-unit waves: the field repeated
     * seventy times across the body and displaced the surface clean outside it.
     */
    rebuildOceanForSize: function (ocean, width, height) {
      var desiredTile = ocean.tileSizeOption > 0 ? ocean.tileSizeOption : Math.max(width, height);
      if (!(desiredTile > 0)) return false;
      if (Math.abs(desiredTile - ocean.tileSize) < 0.5) return false;

      ocean.tileSize = desiredTile;

      var cutoff = Math.max(desiredTile / ocean.resolution * 0.25, 0.5);
      resolveWavelengthScale(ocean);
      ocean.field = new OceanField(ocean.resolution, desiredTile, {
        windSpeed: ocean.windSpeed,
        windDirection: ocean.windDirection,
        amplitude: 1.0,
        smallWaveCutoff: cutoff,
        unitsPerMetre: ocean.unitsPerMetre,
        wavelengthScale: ocean.wavelengthScale,
        seed: ocean.seed
      });
      ocean.field.normalizeToWindSpeed(ocean.unitsPerMetre, ocean.waveHeightScale);
      ocean.significantWaveHeight = ocean.field.significantWaveHeight;

      if (ocean.isWaveWorks) {
        var cascadeTile = Math.max(desiredTile * (ocean.cascadeScale || 0.25), 10.0);
        ocean.cascadeTileSize = cascadeTile;
        ocean.field1 = new OceanField(ocean.resolution, cascadeTile, {
          windSpeed: ocean.windSpeed,
          windDirection: ocean.windDirection,
          amplitude: 1.0,
          smallWaveCutoff: Math.max(cascadeTile / ocean.resolution * 0.25, 0.5),
          unitsPerMetre: ocean.unitsPerMetre,
          wavelengthScale: ocean.wavelengthScale,
          seed: ocean.seed + 101
        });
        ocean.field1.normalizeToWindSpeed(ocean.unitsPerMetre, ocean.waveHeightScale);
        if (ocean.material && ocean.material.uniforms) {
          if (ocean.material.uniforms.u_TileSize) ocean.material.uniforms.u_TileSize.value = desiredTile;
          if (ocean.material.uniforms.u_CascadeTileSize) ocean.material.uniforms.u_CascadeTileSize.value = cascadeTile;
        }
        return true;
      }

      if (ocean.material && ocean.material.uniforms && ocean.material.uniforms.u_TileSize) {
        ocean.material.uniforms.u_TileSize.value = desiredTile;
      }
      return true;
    },

    /**
     * One-time shore report, emitted from the post-events loop once the uploads have run.
     *
     * "No foam appears" has one cause in the shader — u_EdgeCount is 0 — and several causes in
     * the scene, none of which announce themselves. This prints the actual verdict for every
     * registered edge against every water surface, so the answer is read rather than guessed.
     */
    announceShore: function (state) {
      if (state._shoreAnnounced || !(state.time > 1.0)) return;
      if (typeof console === 'undefined' || !console.info) return;

      var surfaces = [];
      var wbi, oi;
      for (wbi = 0; wbi < state.waterBodies.length; wbi++) {
        surfaces.push({ kind: 'WaterBody3D', w: state.waterBodies[wbi] });
      }
      for (oi = 0; oi < state.oceans.length; oi++) {
        surfaces.push({ kind: state.oceans[oi].isWaveWorks ? 'OceanWaveWorks3D' : 'OceanFFT3D', w: state.oceans[oi] });
      }
      if (surfaces.length === 0) return;
      state._shoreAnnounced = true;

      var lines = ['[FluidAndWater3D] Shore foam status'];
      if (state.waterEdges.length === 0) {
        lines.push('  No WaterEdge3D behavior is attached to anything in this scene.');
        lines.push('  Shore foam only draws along a registered edge volume. Add the WaterEdge3D');
        lines.push('  behavior to the object standing in for your beach, cliff or harbour wall.');
        lines.push('  (Whitecap foam on the open water is separate and needs no edge.)');
        for (var li = 0; li < lines.length; li++) console.info(lines[li]);
        return;
      }

      for (var si = 0; si < surfaces.length; si++) {
        var kind = surfaces[si].kind, w = surfaces[si].w, o = w.object;
        var surfZ = (o && o.getZ ? o.getZ() : 0) +
          ((o && o.getDepth && o.getDepth() > 0) ? o.getDepth() : 0);
        var count = (w.material && w.material.uniforms && w.material.uniforms.u_EdgeCount)
          ? w.material.uniforms.u_EdgeCount.value : 0;
        var band = (count > 0 && w.material.uniforms.u_EdgeParams)
          ? w.material.uniforms.u_EdgeParams.value[0].x : 0;
        lines.push('  ' + kind + ' on "' + (o && o.getName ? o.getName() : '?') +
          '"  surface Z ' + Math.round(surfZ) + ', layer "' + (w.layerName || '') + '"');
        lines.push('    edges reaching it: ' + count +
          (count > 0 ? '   foam band ' + Math.round(band) + ' units' : '   <-- NO SHORE FOAM'));

        // uploadWaterEdges keeps only the nearest MAX_WATER_EDGES, so rank the qualifying ones
        // the same way here; otherwise the report calls an ignored edge "used".
        var wcx = (o && o.getX ? o.getX() : 0) +
          ((o && o.getWidth && o.getWidth() > 0) ? o.getWidth() * 0.5 : 0);
        var wcy = (o && o.getY ? o.getY() : 0) +
          ((o && o.getHeight && o.getHeight() > 0) ? o.getHeight() * 0.5 : 0);
        var ranked = [];
        for (var ri = 0; ri < state.waterEdges.length; ri++) {
          var re = state.waterEdges[ri], ro = re.object;
          if (!re.enabled || !ro) continue;
          if (objectLayerName(ro) !== w.layerName) continue;
          var rw = (ro.getWidth && ro.getWidth() > 0) ? ro.getWidth() : 0;
          var rh = (ro.getHeight && ro.getHeight() > 0) ? ro.getHeight() : 0;
          if (rw <= 0 || rh <= 0) continue;
          if (!edgeReachesWater(ro, surfZ)) continue;
          var rcx = (ro.getX ? ro.getX() : 0) + rw * 0.5;
          var rcy = (ro.getY ? ro.getY() : 0) + rh * 0.5;
          ranked.push({ e: re, d2: (rcx - wcx) * (rcx - wcx) + (rcy - wcy) * (rcy - wcy) });
        }
        ranked.sort(function (a, b) { return a.d2 - b.d2; });
        var usedSet = [];
        for (var ui = 0; ui < Math.min(ranked.length, MAX_WATER_EDGES); ui++) usedSet.push(ranked[ui].e);

        for (var ei = 0; ei < state.waterEdges.length; ei++) {
          var e = state.waterEdges[ei], eo = e.object;
          if (!eo) continue;
          var eLayer = objectLayerName(eo);
          var ew = (eo.getWidth && eo.getWidth() > 0) ? eo.getWidth() : 0;
          var eh = (eo.getHeight && eo.getHeight() > 0) ? eo.getHeight() : 0;
          var ez = eo.getZ ? eo.getZ() : 0;
          var ed = (eo.getDepth && eo.getDepth() > 0) ? eo.getDepth() : 0;
          var verdict;
          if (!e.enabled) verdict = 'SKIPPED - disabled';
          else if (eLayer !== w.layerName) {
            verdict = 'SKIPPED - on layer "' + eLayer + '", the water is on "' + (w.layerName || '') + '"';
          } else if (ew <= 0 || eh <= 0) verdict = 'SKIPPED - width or height is 0';
          else if (!edgeReachesWater(eo, surfZ)) {
            verdict = 'SKIPPED - spans Z ' + Math.round(ez) + ' to ' + Math.round(ez + ed) +
              ', which does not contain the water surface at Z ' + Math.round(surfZ) +
              '. Make the land taller or move it so the waterline falls inside it.';
          } else if (usedSet.indexOf(e) === -1) {
            verdict = 'SKIPPED - the shader carries only ' + MAX_WATER_EDGES +
              ' edges and ' + MAX_WATER_EDGES + ' others are nearer this water';
          } else verdict = 'used';
          lines.push('    - "' + (eo.getName ? eo.getName() : '?') + '"  x ' +
            Math.round(eo.getX ? eo.getX() : 0) + '..' + Math.round((eo.getX ? eo.getX() : 0) + ew) +
            ', y ' + Math.round(eo.getY ? eo.getY() : 0) + '..' +
            Math.round((eo.getY ? eo.getY() : 0) + eh) + '  ->  ' + verdict);
        }
      }
      for (var lj = 0; lj < lines.length; lj++) console.info(lines[lj]);
    },

    /** One-time console report, emitted once the volume's real dimensions are known. */
    announceOcean: function (state, ocean, width, height) {
      if (state._oceanAnnounced) return;
      if (typeof console === 'undefined' || !console.info) return;
      state._oceanAnnounced = true;

      var tile = ocean.tileSize;
      var report = [
        '[FluidAndWater3D] ' + (ocean.isWaveWorks ? 'OceanWaveWorks3D' : 'OceanFFT3D') + ' active on "' +
          (ocean.object && ocean.object.getName ? ocean.object.getName() : '?') + '"',
        '  surface mesh : ' + (ocean.mesh ? 'created' : 'MISSING') + ', parent = ' +
          (ocean.mesh && ocean.mesh.parent ? (ocean.mesh.parent.type || 'object') : 'NONE - it cannot render'),
        '  position     : ' + (ocean.mesh
          ? [ocean.mesh.position.x, ocean.mesh.position.y, ocean.mesh.position.z]
              .map(function (v) { return Math.round(v); }).join(', ')
          : '-') + '   size ' + Math.round(width) + ' x ' + Math.round(height),
        '  spectrum     : CPU ' + ocean.resolution + '^2   tile ' + Math.round(tile),
        '  wave height  : Hs ' + ocean.significantWaveHeight.toFixed(0) + ' units at ' +
          ocean.windSpeed + ' m/s',
        '  wave length  : ' + Math.round(ocean.field && ocean.field.peakWavelength || 0) +
          ' units crest to crest   (' + (ocean.field && ocean.field.peakWavelength > 0
            ? (tile / ocean.field.peakWavelength).toFixed(1) : '?') + ' waves across the body)',
        '  shore edges  : ' + (function () {
          var oo = ocean.object;
          var sz = (oo && oo.getZ ? oo.getZ() : 0) +
            ((oo && oo.getDepth && oo.getDepth() > 0) ? oo.getDepth() : 0);
          var reaching = FluidAndWater3D.countWaterEdgesReaching(state, ocean.layerName, sz);
          var total = state.waterEdges ? state.waterEdges.length : 0;
          if (total === 0) return 'none registered (no shore foam)';
          if (reaching === 0) {
            return '0 of ' + total + ' reach this surface (Z ' + Math.round(sz) +
              ')  <-- no shore foam will appear';
          }
          // The band width is the number that decides whether foam actually reads on screen.
          var span = waterSpanOf(ocean);
          var band = 0;
          for (var ei = 0; ei < state.waterEdges.length; ei++) {
            var ee = state.waterEdges[ei];
            if (!ee.enabled || !ee.object) continue;
            if (objectLayerName(ee.object) !== ocean.layerName) continue;
            if (!edgeReachesWater(ee.object, sz)) continue;
            band = Math.max(band, foamWidthFor(ee, span));
          }
          return reaching + ' of ' + total + ', foam band ' + Math.round(band) + ' units (' +
            (isFinite(span) && span > 0 ? (100 * band / span).toFixed(1) : '?') +
            '% of the water)';
        })(),
        '  field peak   : ' + ocean.field.peakHeight().toFixed(0) + ' units (CPU data texture)',
        '  mesh scale   : ' + (ocean.mesh
          ? ocean.mesh.scale.x.toFixed(2) + ' x ' + ocean.mesh.scale.y.toFixed(2)
          : '-') + '   geometry built at ' + Math.round(ocean.initialWidth) + ' x ' +
          Math.round(ocean.initialHeight)
      ];

      if (state.waterBodies.length > 0) {
        report.push('  WARNING: ' + state.waterBodies.length + ' WaterBody3D surface(s) are also active');
        report.push('  here. Two water surfaces overlap, and the flat one is probably what you see.');
      }

      // A sea taller than the body it lives in is not a sea. Real wind waves break past a
      // height-to-length ratio near 1/7, and the longest wave a tile can carry is the tile itself.
      var steep = ocean.significantWaveHeight / Math.max(tile, 1);
      if (steep > 0.15) {
        report.push('  WARNING: the waves are far too big for this water body.');
        report.push('    Hs ' + ocean.significantWaveHeight.toFixed(0) + ' units against a tile of ' +
          Math.round(tile) + ' units (' + (steep * 100).toFixed(0) + '% of it). The surface is');
        report.push('    displaced outside the volume, which looks like the water vanishing.');
        report.push('    At Units Per Metre ' + ocean.unitsPerMetre + ' this volume is ' +
          (tile / ocean.unitsPerMetre).toFixed(1) + ' m across, and ' + ocean.windSpeed +
          ' m/s of wind physically means ' +
          (ocean.significantWaveHeight / ocean.unitsPerMetre).toFixed(1) + ' m waves.');
        report.push('    Fix by any one of:');
        report.push('      - enlarging the volume to about ' +
          Math.round(ocean.significantWaveHeight * 20) + ' units, or');
        report.push('      - dropping Wind Speed to about ' +
          Math.max(1, Math.sqrt(0.05 * tile * 9.81 /
            (0.21 * ocean.unitsPerMetre * ocean.waveHeightScale))).toFixed(1) + ' m/s, or');
        report.push('      - setting Wave Height Scale to about ' +
          (0.05 / steep * ocean.waveHeightScale).toFixed(3) + '.');
      }

      console.info(report.join('\n'));
    },

    oceanOf: function (runtimeScene, behavior) {
      if (!runtimeScene || !behavior) return null;
      var state = getSceneState(runtimeScene);
      return state.oceans.find(function (o) { return o.behavior === behavior; }) || null;
    },

    /** Advances the field and pushes it to the GPU. rgb = displacement XYZ, a = Jacobian. */
    updateOceanField: function (ocean, time) {
      if (!ocean || !ocean.field) return;

      if (ocean.isWaveWorks) {
        var field0 = ocean.field;
        var field1 = ocean.field1;
        field0.evolve(time, 1.0);
        field0.computeFoam(ocean.foamBuffer, ocean.choppiness, foamThresholdFor(ocean));

        if (field1) {
          field1.evolve(time, 1.0);
          field1.computeFoam(ocean.cascadeFoamBuffer, ocean.choppiness, foamThresholdFor(ocean));
        }

        var n0 = field0.n;
        if (ocean.texData) {
          var data0 = ocean.texData;
          var sl0 = ocean.slopeData;
          for (var i = 0; i < n0 * n0; i++) {
            var o0 = i * 4;
            data0[o0] = field0.dispX[i];
            data0[o0 + 1] = field0.dispY[i];
            data0[o0 + 2] = field0.height[i];
            data0[o0 + 3] = ocean.foamBuffer[i];
            if (sl0) {
              sl0[o0] = field0.slopeX[i];
              sl0[o0 + 1] = field0.slopeY[i];
              // Blue channel was spare; the plume mask rides along for free.
              sl0[o0 + 2] = field0.plume[i];
            }
          }
          if (ocean.texture) ocean.texture.needsUpdate = true;
          if (sl0 && ocean.slopeTexture) ocean.slopeTexture.needsUpdate = true;
        }

        if (field1 && ocean.cascadeTexData) {
          var n1 = field1.n;
          var data1 = ocean.cascadeTexData;
          var sl1 = ocean.cascadeSlopeData;
          for (var j = 0; j < n1 * n1; j++) {
            var o1 = j * 4;
            data1[o1] = field1.dispX[j];
            data1[o1 + 1] = field1.dispY[j];
            data1[o1 + 2] = field1.height[j];
            data1[o1 + 3] = ocean.cascadeFoamBuffer[j];
            if (sl1) {
              sl1[o1] = field1.slopeX[j];
              sl1[o1 + 1] = field1.slopeY[j];
              // Cascade 1 is ~4x steeper on a quarter-size tile, so its eigenvalues collapse
              // everywhere and it must never drive the plume. Zero, deliberately.
              sl1[o1 + 2] = 0.0;
            }
          }
          if (ocean.cascadeTexture) ocean.cascadeTexture.needsUpdate = true;
          if (sl1 && ocean.cascadeSlopeTexture) ocean.cascadeSlopeTexture.needsUpdate = true;
        }
        if (ocean.foamRT && !ocean.foamRT.failed && ocean.texture) {
          // Decay comes from the medium: salt water foam lingers, fresh water foam collapses.
          var foamTex = ocean.foamRT.update(ocean.texture, ocean.lastFoamDt || 0.016,
            ocean.foamDecaySeconds || 3.85);
          ocean.foamRT.validate();
          if (foamTex && !ocean.foamRT.failed && ocean.material && ocean.material.uniforms) {
            ocean.material.uniforms.u_FoamBuffer.value = foamTex;
            ocean.material.uniforms.u_FoamBufferOn.value = 1.0;
          } else if (ocean.material && ocean.material.uniforms) {
            ocean.material.uniforms.u_FoamBufferOn.value = 0.0;
          }
        }
        // Hs changes with the Beaufort rung and with the wind, so refresh the crest reference
        // rather than freezing whatever it was at registration.
        if (ocean.material && ocean.material.uniforms && ocean.material.uniforms.u_PeakReference) {
          ocean.material.uniforms.u_PeakReference.value =
            Math.max(ocean.significantWaveHeight * 0.85, 1.0);
        }
        return;
      }

      var field = ocean.field;
      field.evolve(time, 1.0);
      field.computeFoam(ocean.foamBuffer, ocean.choppiness, foamThresholdFor(ocean));

      if (!ocean.texData) return;
      var data = ocean.texData;
      var n = field.n;
      for (var i = 0; i < n * n; i++) {
        var o = i * 4;
        data[o] = field.dispX[i];
        data[o + 1] = field.dispY[i];
        data[o + 2] = field.height[i];
        data[o + 3] = ocean.foamBuffer[i];
      }
      if (ocean.texture) ocean.texture.needsUpdate = true;
    },

    stepOcean: function (runtimeScene, object, behavior) {
      var ocean = FluidAndWater3D.oceanOf(runtimeScene, behavior);
      if (!ocean) return;

      // A sea-state transition, if one is running. No-op otherwise.
      if (ocean.seaDuration > 0) {
        FluidAndWater3D.advanceSeaTransition(runtimeScene, ocean, getDeltaSeconds(runtimeScene));
      }

      var currentLayer = objectLayerName(object);
      if (currentLayer !== ocean.layerName) {
        ocean.layerName = currentLayer;
        if (ocean.mesh && ocean.mesh.parent && ocean.mesh.parent.remove) ocean.mesh.parent.remove(ocean.mesh);
      }
      if (ocean.mesh && !ocean.mesh.parent) {
        var root = getLayerThreeRoot(runtimeScene, ocean.layerName);
        if (root) root.add(ocean.mesh);
      }

      var objX = object.getX ? object.getX() : 0;
      var objY = object.getY ? object.getY() : 0;
      var objZ = object.getZ ? object.getZ() : 0;
      var w = (object.getWidth && object.getWidth() > 0) ? object.getWidth() : 1000;
      var h = (object.getHeight && object.getHeight() > 0) ? object.getHeight() : 1000;
      var d = (object.getDepth && object.getDepth() > 0) ? object.getDepth() : 0;

      // The instance's real size only becomes readable after onCreated, so this is the first
      // point at which the field can be built for the volume it actually covers.
      FluidAndWater3D.rebuildOceanForSize(ocean, w, h);

      if (ocean.mesh) {
        ocean.mesh.position.set(objX + w * 0.5, objY + h * 0.5, objZ + d + 0.1);
        if (ocean.initialWidth > 0 && ocean.initialHeight > 0) {
          ocean.mesh.scale.set(w / ocean.initialWidth, h / ocean.initialHeight, 1.0);
        }
        if (ocean.material && ocean.material.uniforms && ocean.material.uniforms.u_WaterDepth) {
          ocean.material.uniforms.u_WaterDepth.value = d > 0 ? d : 150.0;
        }
        ocean.mesh.visible = !objectIsHidden(object);
        syncSceneLightingAndSky(runtimeScene, ocean);
      }
      hideVolumeTopFace(object, ocean);

      // Reported last, so the position and scale printed are the ones actually in effect.
      FluidAndWater3D.announceOcean(getSceneState(runtimeScene), ocean, w, h);
    },

    /** Water surface altitude at a world XY, including the wave. Used by Buoyancy3D. */
    getOceanSurfaceZ: function (runtimeScene, behavior, x, y) {
      var state = getSceneState(runtimeScene);
      var ocean = behavior ? FluidAndWater3D.oceanOf(runtimeScene, behavior) : state.oceans[0];
      if (!ocean || !ocean.object) return 0.0;
      var obj = ocean.object;
      var baseZ = (obj.getZ ? obj.getZ() : 0) + ((obj.getDepth && obj.getDepth() > 0) ? obj.getDepth() : 0);
      var edge = waterEdgeInfluenceAt(state, x, y, ocean.layerName, baseZ, waterSpanOf(ocean));
      var waveDisp = (ocean.isWaveWorks && ocean.field1)
        ? (ocean.field.sampleHeight(x, y) + (ocean.cascadeWeight !== undefined ? ocean.cascadeWeight : 0.65) * ocean.field1.sampleHeight(x, y))
        : ocean.field.sampleHeight(x, y);
      return baseZ + (waveDisp +
        interactionDisplacementAt(ocean, x, y, state.time)) * edge.attenuation;
    },

    getOceanWaveHeightAt: function (runtimeScene, behavior, x, y) {
      var state = getSceneState(runtimeScene);
      var ocean = behavior ? FluidAndWater3D.oceanOf(runtimeScene, behavior) : state.oceans[0];
      if (!ocean || !ocean.object) return 0.0;
      var obj = ocean.object;
      var baseZ = (obj.getZ ? obj.getZ() : 0) + ((obj.getDepth && obj.getDepth() > 0) ? obj.getDepth() : 0);
      var edge = waterEdgeInfluenceAt(state, x, y, ocean.layerName, baseZ, waterSpanOf(ocean));
      var waveDisp = (ocean.isWaveWorks && ocean.field1)
        ? (ocean.field.sampleHeight(x, y) + (ocean.cascadeWeight !== undefined ? ocean.cascadeWeight : 0.65) * ocean.field1.sampleHeight(x, y))
        : ocean.field.sampleHeight(x, y);
      return (waveDisp +
        interactionDisplacementAt(ocean, x, y, state.time)) * edge.attenuation;
    },

    getSignificantWaveHeight: function (runtimeScene, behavior) {
      var ocean = FluidAndWater3D.oceanOf(runtimeScene, behavior);
      return ocean ? ocean.significantWaveHeight : 0.0;
    },

    setOceanSunDirection: function (runtimeScene, behavior, heading, elevation) {
      var ocean = FluidAndWater3D.oceanOf(runtimeScene, behavior);
      if (!ocean || !ocean.material || !ocean.material.uniforms) return;
      var radH = (numOrParse(heading, 75.0) % 360) * (Math.PI / 180.0);
      var radE = Math.max(0.01, Math.min(89.9, numOrParse(elevation, 18.0))) * (Math.PI / 180.0);
      var cosE = Math.cos(radE);
      var sinE = Math.sin(radE);
      var sx = cosE * Math.cos(radH);
      var sy = cosE * Math.sin(radH);
      var sz = sinE;
      if (ocean.material.uniforms.u_SunDirection) {
        setUniformVec3(ocean.material.uniforms.u_SunDirection, [sx, sy, sz]);
      }
      ocean.sunHeading = heading;
      ocean.sunElevation = elevation;
      ocean.hasCustomSun = true;
    },

    setOceanSunColor: function (runtimeScene, behavior, colorStr) {
      var ocean = FluidAndWater3D.oceanOf(runtimeScene, behavior);
      if (!ocean || !ocean.material || !ocean.material.uniforms) return;
      var col = parseNormalizedColor(colorStr, [1.0, 0.96, 0.88]);
      if (ocean.material.uniforms.u_SunColor) {
        setUniformVec3(ocean.material.uniforms.u_SunColor, col);
      }
      ocean.sunColor = col;
      ocean.hasCustomSunColor = true;
    },

    setOceanWind: function (runtimeScene, behavior, windSpeed, windDirection) {
      var ocean = FluidAndWater3D.oceanOf(runtimeScene, behavior);
      if (!ocean) return;
      ocean.windSpeed = (typeof windSpeed === 'number' && windSpeed >= 0) ? windSpeed : 0.0;
      if (windDirection !== undefined) ocean.windDirection = windDirection;
      if (ocean.material && ocean.material.uniforms && ocean.material.uniforms.u_WindDir) {
        var wRad = (ocean.windDirection * Math.PI) / 180.0;
        if (ocean.material.uniforms.u_WindDir.value && ocean.material.uniforms.u_WindDir.value.set) {
          ocean.material.uniforms.u_WindDir.value.set(Math.cos(wRad), Math.sin(wRad));
        } else {
          ocean.material.uniforms.u_WindDir.value = { x: Math.cos(wRad), y: Math.sin(wRad) };
        }
      }

      // Rebuilding the spectrum is the expensive part of this extension; it runs only when the
      // wind actually changes, never per frame.
      resolveWavelengthScale(ocean);
      ocean.field.buildSpectrum({
        windSpeed: ocean.windSpeed,
        windDirection: ocean.windDirection,
        amplitude: 1.0,
        smallWaveCutoff: Math.max(ocean.tileSize / ocean.resolution * 0.25, 0.5),
        unitsPerMetre: ocean.unitsPerMetre,
        wavelengthScale: ocean.wavelengthScale,
        seed: ocean.seed
      });
      ocean.field.normalizeToWindSpeed(ocean.unitsPerMetre, ocean.waveHeightScale);
      ocean.significantWaveHeight = ocean.field.significantWaveHeight;

      if (ocean.isWaveWorks && ocean.field1) {
        var cascadeTile = ocean.cascadeTileSize || Math.max(ocean.tileSize * (ocean.cascadeScale || 0.25), 10.0);
        ocean.field1.buildSpectrum({
          windSpeed: ocean.windSpeed,
          windDirection: ocean.windDirection,
          amplitude: 1.0,
          smallWaveCutoff: Math.max(cascadeTile / ocean.resolution * 0.25, 0.5),
          unitsPerMetre: ocean.unitsPerMetre,
          wavelengthScale: ocean.wavelengthScale,
          seed: ocean.seed + 101
        });
        ocean.field1.normalizeToWindSpeed(ocean.unitsPerMetre, ocean.waveHeightScale);
      }

    },

    setOceanChoppiness: function (runtimeScene, behavior, chop) {
      var ocean = FluidAndWater3D.oceanOf(runtimeScene, behavior);
      if (!ocean) return;
      ocean.choppiness = Math.max(0.0, chop);
      if (ocean.material && ocean.material.uniforms && ocean.material.uniforms.u_Choppiness) {
        ocean.material.uniforms.u_Choppiness.value = ocean.choppiness;
      }
    },



    setOceanOpacity: function (runtimeScene, behavior, opacity) {
      var ocean = FluidAndWater3D.oceanOf(runtimeScene, behavior);
      if (!ocean) return;
      ocean.opacity = clamp(typeof opacity === 'number' ? opacity : parseFloat(opacity) || 0.0, 0.0, 1.0);
      if (ocean.material && ocean.material.uniforms && ocean.material.uniforms.u_Opacity) {
        ocean.material.uniforms.u_Opacity.value = ocean.opacity;
      }
    },

    getOceanOpacity: function (runtimeScene, behavior) {
      var ocean = FluidAndWater3D.oceanOf(runtimeScene, behavior);
      return ocean ? (ocean.opacity !== undefined ? ocean.opacity : 1.0) : 1.0;
    },

    setOceanMicroDetail: function (runtimeScene, behavior, detail) {
      var ocean = FluidAndWater3D.oceanOf(runtimeScene, behavior);
      if (!ocean) return;
      ocean.microDetail = Math.max(0.0, typeof detail === 'number' ? detail : parseFloat(detail) || 0.0);
      if (ocean.material && ocean.material.uniforms && ocean.material.uniforms.u_MicroDetail) {
        ocean.material.uniforms.u_MicroDetail.value = ocean.microDetail;
      }
    },

    getOceanMicroDetail: function (runtimeScene, behavior) {
      var ocean = FluidAndWater3D.oceanOf(runtimeScene, behavior);
      return ocean ? (ocean.microDetail !== undefined ? ocean.microDetail : 0.0) : 0.0;
    },

    disposeOcean: function (runtimeScene, behavior) {
      if (!runtimeScene || !behavior) return;
      var state = getSceneState(runtimeScene);
      var idx = state.oceans.findIndex(function (o) { return o.behavior === behavior; });
      if (idx === -1) return;
      var ocean = state.oceans[idx];
      if (ocean.mesh) {
        if (ocean.mesh.geometry) ocean.mesh.geometry.dispose();
        if (ocean.mesh.material) ocean.mesh.material.dispose();
        if (ocean.mesh.parent) ocean.mesh.parent.remove(ocean.mesh);
      }
      if (ocean.texture && ocean.texture.dispose) ocean.texture.dispose();
      if (ocean.cascadeTexture && ocean.cascadeTexture.dispose) ocean.cascadeTexture.dispose();
      if (ocean.slopeTexture && ocean.slopeTexture.dispose) ocean.slopeTexture.dispose();
      if (ocean.cascadeSlopeTexture && ocean.cascadeSlopeTexture.dispose) ocean.cascadeSlopeTexture.dispose();
      state.oceans.splice(idx, 1);
    },

    /* ========================================================= 4b. OceanWaveWorks3D */

    registerWaveWorksOcean: function (runtimeScene, object, behavior, options) {
      if (!runtimeScene || !object || !behavior) return null;
      var state = getSceneState(runtimeScene);

      var width = (object.getWidth && object.getWidth() > 0) ? object.getWidth() : 1000;
      var height = (object.getHeight && object.getHeight() > 0) ? object.getHeight() : 1000;
      var depth = (object.getDepth && object.getDepth() > 0) ? object.getDepth() : 0;

      var shallow = parseColor(options.shallowColor, [64, 224, 208]);
      var deep = parseColor(options.deepColor, [10, 45, 90]);
      var fogCol = parseColor(options.underwaterFogColor, [15, 65, 110]);

      var tile = options.tileSize > 0 ? options.tileSize : Math.max(width, height);
      var cascadeScale = (options.cascadeScale > 0 && options.cascadeScale < 1.0) ? Number(options.cascadeScale) : 0.25;
      var cascadeTile = Math.max(tile * cascadeScale, 10.0);
      var cascadeWeight = (options.cascadeWeight !== undefined && options.cascadeWeight !== null) ? clamp(Number(options.cascadeWeight), 0.0, 1.5) : 0.60;

      var res = clamp(Math.round(options.resolution || 64), 16, 128);
      res = Math.pow(2, Math.round(Math.log(res) / Math.LN2));

      var ocean = {
        isWaveWorks: true,
        object: object,
        behavior: behavior,
        layerName: objectLayerName(object),
        tileSize: tile,
        tileSizeOption: options.tileSize > 0 ? options.tileSize : 0,
        cascadeScale: cascadeScale,
        cascadeTileSize: cascadeTile,
        cascadeWeight: cascadeWeight,
        resolution: res,
        beaufortScale: options.beaufortScale || 'Beaufort 4 - Moderate Breeze',
        windSpeed: (options.windSpeed !== undefined && options.windSpeed !== null && options.windSpeed >= 0) ? Number(options.windSpeed) : 7.0,
        windDirection: num(options.windDirection, 45.0),
        waveHeightScale: options.waveHeightScale !== undefined ? Math.max(0.0, Number(options.waveHeightScale)) : 1.0,
        choppiness: num(options.choppiness, 0.9),
        opacity: (options.opacity !== undefined && options.opacity !== null) ? clamp(num(options.opacity, 0.85), 0.0, 1.0) : 0.85,
        microDetail: (options.microDetail !== undefined && options.microDetail !== null) ? Math.max(0.0, num(options.microDetail, 0.55)) : 0.55,
        seed: options.seed !== undefined ? Math.round(options.seed) : 1337,
        unitsPerMetre: options.unitsPerMetre > 0 ? options.unitsPerMetre : 100.0,
        wavelengthScaleOption: num(options.wavelengthScale, 0),
        peakWavelengthOption: options.peakWavelength > 0 ? options.peakWavelength : 0,
        wavelengthScale: 1.0,
        shallowColor: [shallow[0] / 255, shallow[1] / 255, shallow[2] / 255],
        deepColor: [deep[0] / 255, deep[1] / 255, deep[2] / 255],
        extinctionDepth: options.extinctionDepth > 0 ? options.extinctionDepth : 150.0,
        foamIntensity: num(options.foamIntensity, 0.55),
        foamCoverage: num(options.foamCoverage, 0.25),
        maskUnderEdges: options.maskUnderEdges !== undefined ? !!options.maskUnderEdges : true,
        enableCaustics: options.enableCaustics !== undefined ? !!options.enableCaustics : true,
        enableUnderwaterFX: options.enableUnderwaterFX !== undefined ? !!options.enableUnderwaterFX : false,
        underwaterFogColor: [fogCol[0] / 255, fogCol[1] / 255, fogCol[2] / 255],
        underwaterFogDensity: num(options.underwaterFogDensity, 0.0005),
        enableBodyInteractions: options.enableBodyInteractions !== undefined ? !!options.enableBodyInteractions : true,
        interactionStrength: options.interactionStrength !== undefined ? Math.max(options.interactionStrength, 0.0) : 14.0,
        interactionRadius: options.interactionRadius !== undefined ? Math.max(options.interactionRadius, 1.0) : 180.0,
        interactionSpeedThreshold: options.interactionSpeedThreshold !== undefined ? Math.max(options.interactionSpeedThreshold, 0.0) : 35.0,
        interactionLifetime: 1.6,
        interactions: [],
        interactionTracks: typeof WeakMap === 'function' ? new WeakMap() : null,
        gridSubdivisions: clamp(Math.round(options.gridSubdivisions || res), 8, 256),
        initialWidth: width,
        initialHeight: height,
        isCameraUnderwater: false,
        isSpectralOcean: true,
        // ON by default from 4.1.0. Rare's two slides make the case better than any argument:
        // raw Jacobian foam is captioned "Too Noisy", and the fix is not a threshold, it is
        // progressively blurring the accumulation buffer frame by frame. Without it we are
        // stuck at the noisy slide and papering over it with procedural break-up noise.
        // The capability gate and the first-frame read-back still make this degrade safely.
        persistentFoam: options.persistentFoam !== undefined ? !!options.persistentFoam : true,
        anisotropy: parseAnisotropy(options.textureAnisotropy !== undefined ? options.textureAnisotropy : 4, 4),
        foamRT: null,
        field: null,
        field1: null,
        foamBuffer: null,
        cascadeFoamBuffer: null,
        texData: null,
        cascadeTexData: null,
        texture: null,
        cascadeTexture: null,
        mesh: null,
        material: null
      };

      if (ocean.beaufortScale && ocean.beaufortScale !== 'Custom') {
        var bProfile = resolveWaveWorksBeaufortPreset(ocean.beaufortScale);
        if (bProfile) {
          ocean.beaufortScale = bProfile.name;
          ocean.beaufort = bProfile.beaufort !== undefined ? bProfile.beaufort : 4;
          ocean.windSpeed = bProfile.windSpeed;
          ocean.waveHeightScale = bProfile.waveHeightScale;
          ocean.choppiness = bProfile.choppiness;
          if (bProfile.cascadeWeight !== undefined) ocean.cascadeWeight = bProfile.cascadeWeight;
          ocean.foamIntensity = bProfile.foamIntensity;
          ocean.foamCoverage = bProfile.foamCoverage;
          if (bProfile.microDetail !== undefined) ocean.microDetail = bProfile.microDetail;
        }
      }

      resolveWavelengthScale(ocean);
      ocean.field = new OceanField(res, tile, {
        windSpeed: ocean.windSpeed,
        windDirection: ocean.windDirection,
        amplitude: 1.0,
        smallWaveCutoff: Math.max(tile / res * 0.25, 0.5),
        unitsPerMetre: ocean.unitsPerMetre,
        wavelengthScale: ocean.wavelengthScale,
        seed: ocean.seed
      });
      ocean.field.normalizeToWindSpeed(ocean.unitsPerMetre, ocean.waveHeightScale);
      ocean.foamBuffer = new Float32Array(res * res);
      ocean.significantWaveHeight = ocean.field.significantWaveHeight;

      ocean.field1 = new OceanField(res, cascadeTile, {
        windSpeed: ocean.windSpeed,
        windDirection: ocean.windDirection,
        amplitude: 1.0,
        smallWaveCutoff: Math.max(cascadeTile / res * 0.25, 0.5),
        unitsPerMetre: ocean.unitsPerMetre,
        wavelengthScale: ocean.wavelengthScale,
        seed: ocean.seed + 101
      });
      ocean.field1.normalizeToWindSpeed(ocean.unitsPerMetre, ocean.waveHeightScale);
      ocean.cascadeFoamBuffer = new Float32Array(res * res);

      if (THREE_OK && typeof THREE.DataTexture === 'function') {
        ocean.texData = new Float32Array(res * res * 4);
        ocean.texture = new THREE.DataTexture(ocean.texData, res, res, THREE.RGBAFormat, THREE.FloatType);
        ocean.texture.wrapS = THREE.RepeatWrapping;
        ocean.texture.wrapT = THREE.RepeatWrapping;

        ocean.cascadeTexData = new Float32Array(res * res * 4);
        ocean.cascadeTexture = new THREE.DataTexture(ocean.cascadeTexData, res, res, THREE.RGBAFormat, THREE.FloatType);
        ocean.cascadeTexture.wrapS = THREE.RepeatWrapping;
        ocean.cascadeTexture.wrapT = THREE.RepeatWrapping;

        // Slope rides its own texture per cascade. The main one has no spare channels, and
        // two extra taps here replace the eight the shader used to spend differencing height.
        ocean.slopeData = new Float32Array(res * res * 4);
        ocean.slopeTexture = new THREE.DataTexture(ocean.slopeData, res, res, THREE.RGBAFormat, THREE.FloatType);
        ocean.slopeTexture.wrapS = THREE.RepeatWrapping;
        ocean.slopeTexture.wrapT = THREE.RepeatWrapping;

        ocean.cascadeSlopeData = new Float32Array(res * res * 4);
        ocean.cascadeSlopeTexture = new THREE.DataTexture(ocean.cascadeSlopeData, res, res, THREE.RGBAFormat, THREE.FloatType);
        ocean.cascadeSlopeTexture.wrapS = THREE.RepeatWrapping;
        ocean.cascadeSlopeTexture.wrapT = THREE.RepeatWrapping;

        var fieldFilter = pickFloatFilter(getThreeRendererOf(runtimeScene)) || THREE.NearestFilter;
        ocean.slopeTexture.minFilter = fieldFilter;
        ocean.slopeTexture.magFilter = fieldFilter;
        ocean.slopeTexture.generateMipmaps = false;
        ocean.slopeTexture.needsUpdate = true;
        ocean.cascadeSlopeTexture.minFilter = fieldFilter;
        ocean.cascadeSlopeTexture.magFilter = fieldFilter;
        ocean.cascadeSlopeTexture.generateMipmaps = false;
        ocean.cascadeSlopeTexture.needsUpdate = true;
        ocean.texture.minFilter = fieldFilter;
        ocean.texture.magFilter = fieldFilter;
        ocean.texture.generateMipmaps = false;
        ocean.texture.needsUpdate = true;

        ocean.cascadeTexture.minFilter = fieldFilter;
        ocean.cascadeTexture.magFilter = fieldFilter;
        ocean.cascadeTexture.generateMipmaps = false;
        ocean.cascadeTexture.needsUpdate = true;

        var rend = getThreeRendererOf(runtimeScene);
        applyAnisotropyToTexture(ocean.slopeTexture, rend, ocean.anisotropy);
        applyAnisotropyToTexture(ocean.cascadeSlopeTexture, rend, ocean.anisotropy);
        applyAnisotropyToTexture(ocean.texture, rend, ocean.anisotropy);
        applyAnisotropyToTexture(ocean.cascadeTexture, rend, ocean.anisotropy);

        var subs = ocean.gridSubdivisions;
        var geom = new THREE.PlaneGeometry(width, height, subs, subs);

        var windRadInit = (ocean.windDirection * Math.PI) / 180.0;
        var mat = new THREE.ShaderMaterial({
          vertexShader: WAVEWORKS_VERTEX_SHADER,
          fragmentShader: WAVEWORKS_FRAGMENT_SHADER,
          transparent: true,
          depthWrite: true,
          depthTest: true,
          side: THREE.DoubleSide,
          uniforms: {
            u_Field: { value: ocean.texture },
            u_FieldCascade: { value: ocean.cascadeTexture },
            u_TileSize: { value: tile },
            u_CascadeTileSize: { value: cascadeTile },
            // 0 disables the bright water under a collision without touching the droplets.
            u_PlumeFoam: { value: 0.0 },
            // Defaults reproduce 3.6.0 exactly, so a project that never touches the foam
            // selector renders identically.
            u_FoamScale: { value: 1.0 },
            u_FoamStreak: { value: 4.5 },
            u_FoamBite: { value: 1.0 },
            u_FoamTrail: { value: 1.0 },
            u_Slope: { value: ocean.slopeTexture },
            u_CascadeSlope: { value: ocean.cascadeSlopeTexture },
            u_FieldTexel: { value: 1.0 / res },
            u_CascadeTexel: { value: 1.0 / res },
            u_Choppiness: { value: ocean.choppiness },
            u_CascadeWeight: { value: ocean.cascadeWeight },
            // Divides the horizontal choppiness offset. Measured |displacement| runs to 0.49 x Hs
            // on a Beaufort 2 sea and 1.44 x Hs on a Beaufort 12 one, with a 90th percentile near
            // 0.85 x Hs throughout - so that is the divisor. The original 0.28 pinned it at 1.0
            // across a third of the surface, which is what made this look broken.
            u_PeakReference: { value: Math.max(ocean.significantWaveHeight * 0.85, 1.0) },
            u_Opacity: { value: ocean.opacity },
            u_MicroDetail: { value: ocean.microDetail },
            u_WindDir: {
              value: (typeof THREE.Vector2 === 'function')
                ? new THREE.Vector2(Math.cos(windRadInit), Math.sin(windRadInit))
                : { x: Math.cos(windRadInit), y: Math.sin(windRadInit) }
            },
            u_ShallowColor: { value: new THREE.Vector3().fromArray(ocean.shallowColor) },
            u_DeepColor: { value: new THREE.Vector3().fromArray(ocean.deepColor) },
            u_ExtinctionDepth: { value: ocean.extinctionDepth },
            u_FoamIntensity: { value: ocean.foamIntensity },
            u_FoamCoverage: { value: ocean.foamCoverage },
            u_CausticsIntensity: { value: ocean.enableCaustics ? 1.0 : 0.0 },
            u_CausticsDepthFade: { value: 1.0 },
            // Effect-module defaults, so water with no WaterDetailing3D attached still draws foam.
            u_FoamModel: { value: 1.0 },
            u_FoamSoftness: { value: 1.0 },
            u_GlitterScale: { value: 0.6 },
            u_QuantiseBands: { value: 0.0 },
            // Persistent foam is opt-in; see PersistentFoam on the behavior.
            u_FoamBuffer: { value: null },
            u_FoamBufferOn: { value: 0.0 },
            u_Time: { value: 0.0 },
            u_SunDirection: { value: new THREE.Vector3(0.5, 0.8, 1.0).normalize() },
            u_SunColor: { value: new THREE.Vector3(1.0, 0.96, 0.88) },
            u_SunSpecularIntensity: { value: 2.2 },
            u_SunSpecularRoughness: { value: 128.0 },
            u_WaveContrast: { value: 0.50 },
            u_TranslucencyColor: { value: new THREE.Vector3(40 / 255, 255 / 255, 220 / 255) },
            u_TranslucencyIntensity: { value: 1.4 },
            u_TranslucencyPower: { value: 3.0 },
            u_FoamColor: { value: new THREE.Vector3(0.97, 0.99, 1.0) },
            u_MicroFrequency: { value: 1.0 },
            u_WaterDepth: { value: depth > 0 ? depth : 150.0 },
            u_EdgeCount: { value: 0.0 },
            u_EdgeMask: { value: ocean.maskUnderEdges ? 1.0 : 0.0 },
            u_EdgeBounds: { value: makeEdgeBoundsArray() },
            u_EdgeParams: { value: makeEdgeParamsArray() },
            u_InteractionCount: { value: 0.0 },
            u_Interactions: { value: makeInteractionArray() },
            u_InteractionParams: { value: makeInteractionArray() },
            u_EnvMap: { value: null },
            u_HasEnvMap: { value: 0.0 }
          }
        });

        ocean.material = mat;
        if (ocean.beaufortScale && ocean.beaufortScale !== 'Custom') {
          var bProf = resolveWaveWorksBeaufortPreset(ocean.beaufortScale);
          if (bProf) {
            // The chosen rung owns opacity, micro-detail and foam as well as the palette. These
            // used to be re-applied from the properties straight afterwards, which GDevelop always
            // supplies, so the preset's own values never survived registration.
            applyPaletteToMaterial(bProf, ocean.material);
            var wwU = ocean.material.uniforms;
            if (bProf.opacity !== undefined) ocean.opacity = bProf.opacity;
            if (bProf.microDetail !== undefined) ocean.microDetail = bProf.microDetail;
            if (bProf.foamIntensity !== undefined) ocean.foamIntensity = bProf.foamIntensity;
            if (bProf.foamCoverage !== undefined) ocean.foamCoverage = bProf.foamCoverage;
            if (wwU.u_Opacity) wwU.u_Opacity.value = ocean.opacity;
            if (wwU.u_MicroDetail) wwU.u_MicroDetail.value = ocean.microDetail;
            if (wwU.u_FoamIntensity) wwU.u_FoamIntensity.value = ocean.foamIntensity;
            if (wwU.u_FoamCoverage) wwU.u_FoamCoverage.value = ocean.foamCoverage;
          }
        }
        if (ocean.persistentFoam) {
          var foamRenderer = getThreeRendererOf(runtimeScene);
          if (FoamBuffer.isSupported(foamRenderer)) {
            ocean.foamRT = new FoamBuffer(foamRenderer, Math.min(res * 4, 256), ocean.anisotropy);
          } else if (typeof console !== 'undefined' && console.info) {
            console.info('[FluidAndWater3D] Persistent foam was requested but this renderer cannot ' +
              'provide a render target for it. Using the stateless crest mask instead.');
          }
        }
        ocean.mesh = new THREE.Mesh(geom, mat);
        ocean.mesh.name = 'FluidAndWater3D_OceanWaveWorks';
        ocean.mesh.frustumCulled = false;
        if (ocean.mesh.rotation) ocean.mesh.rotation.order = 'ZYX';
        ocean.mesh.visible = false;

        var root = getLayerThreeRoot(runtimeScene, ocean.layerName);
        if (root) root.add(ocean.mesh);
      }

      FluidAndWater3D.updateOceanField(ocean, 0.0);
      state.oceans.push(ocean);
      return ocean;
    },

    /**
     * Moves a running sea-state transition on by one frame. Re-applies the whole rung, which
     * rebuilds the spectrum: that is the expensive part, but it only runs while a transition is
     * actually in flight and there is no transition unless one was asked for.
     */
    advanceSeaTransition: function (runtimeScene, ocean, dt) {
      if (!ocean || !(ocean.seaDuration > 0)) return;
      ocean.seaElapsed = (ocean.seaElapsed || 0) + Math.max(dt, 0);
      var u = clamp(ocean.seaElapsed / ocean.seaDuration, 0, 1);
      // Smoothstep, so the sea does not lurch into motion or stop dead.
      var e = u * u * (3 - 2 * u);
      var at = ocean.seaFrom + (ocean.seaTo - ocean.seaFrom) * e;
      var done = u >= 1;
      if (done) ocean.seaDuration = 0;
      var profile = resolveWaveWorksBeaufortPreset(done ? ocean.seaTo : at);
      if (profile) FluidAndWater3D.applyWaveWorksProfile(runtimeScene, ocean, profile);
    },

    stepWaveWorksOcean: function (runtimeScene, object, behavior) {
      return FluidAndWater3D.stepOcean(runtimeScene, object, behavior);
    },

    disposeWaveWorksOcean: function (runtimeScene, behavior) {
      return FluidAndWater3D.disposeOcean(runtimeScene, behavior);
    },

    /**
     * Re-prints the ocean diagnostic block for the current sea state, including the
     * waves-too-big-for-this-body warning and its fix numbers. Safe to call at any time.
     */
    logWaveWorksDiagnostics: function (runtimeScene, behavior) {
      var ocean = FluidAndWater3D.oceanOf(runtimeScene, behavior);
      if (!ocean || !ocean.isWaveWorks) return;
      var o = ocean.object;
      var w = (o && o.getWidth && o.getWidth() > 0) ? o.getWidth() : ocean.tileSize;
      var h = (o && o.getHeight && o.getHeight() > 0) ? o.getHeight() : ocean.tileSize;
      FluidAndWater3D.announceOcean(getSceneState(runtimeScene), ocean, w, h);
    },

    /** Significant wave height of the live sea, in scene units. */
    getWaveWorksSignificantHeight: function (runtimeScene, behavior) {
      var ocean = FluidAndWater3D.oceanOf(runtimeScene, behavior);
      return (ocean && ocean.significantWaveHeight) ? ocean.significantWaveHeight : 0;
    },

    /**
     * Wave steepness: significant wave height over the tile the spectrum repeats across. This is
     * the single number that decides whether a sea reads as water. Real wind waves sit near 0.04;
     * water physically cannot stand up past about 0.10, and beyond that the surface folds
     * everywhere, foams everywhere, and displaces outside its own volume.
     */
    getWaveWorksSteepness: function (runtimeScene, behavior) {
      var ocean = FluidAndWater3D.oceanOf(runtimeScene, behavior);
      if (!ocean || !(ocean.tileSize > 0)) return 0;
      return ocean.significantWaveHeight / ocean.tileSize;
    },

    /**
     * `seconds` > 0 eases the sea from where it is to the new rung instead of snapping. Adjacent
     * Beaufort rungs differ by 38-92% in wave height - the scale is roughly cubic in B - so an
     * instant change is a visible pop. The scale is continuous, so easing is just animating the
     * rung number and re-applying every frame.
     */
    setWaveWorksBeaufort: function (runtimeScene, behavior, scaleName, seconds) {
      var ocean = FluidAndWater3D.oceanOf(runtimeScene, behavior);
      if (!ocean || !ocean.isWaveWorks) return;
      var profile = resolveWaveWorksBeaufortPreset(scaleName);
      if (!profile) return;

      var ease = (typeof seconds === "number" && isFinite(seconds)) ? Math.max(seconds, 0) : 0;
      var target = (profile.beaufort !== undefined) ? profile.beaufort : null;
      if (ease > 0 && target !== null) {
        // Ease only along the numeric scale. A named look that is not a rung (Custom, Murky and
        // friends) has nowhere to travel from, so it still applies at once.
        ocean.seaFrom = (typeof ocean.beaufort === "number") ? ocean.beaufort : target;
        ocean.seaTo = target;
        ocean.seaDuration = ease;
        ocean.seaElapsed = 0;
        return;
      }
      // An explicit set with no easing cancels whatever was in flight. The per-frame advance does
      // NOT come through here - it calls applyWaveWorksProfile directly - or it would cancel the
      // transition it is in the middle of running.
      ocean.seaDuration = 0;
      FluidAndWater3D.applyWaveWorksProfile(runtimeScene, ocean, profile);
    },

    /** Applies a resolved sea-state profile to the ocean immediately. */
    applyWaveWorksProfile: function (runtimeScene, ocean, profile) {
      var behavior = ocean.behavior;
      ocean.beaufortScale = profile.name;
      ocean.beaufort = profile.beaufort !== undefined ? profile.beaufort : 4;
      ocean.waveHeightScale = profile.waveHeightScale;
      ocean.choppiness = profile.choppiness;
      if (profile.cascadeWeight !== undefined) {
        ocean.cascadeWeight = profile.cascadeWeight;
        if (ocean.material && ocean.material.uniforms && ocean.material.uniforms.u_CascadeWeight) {
          ocean.material.uniforms.u_CascadeWeight.value = ocean.cascadeWeight;
        }
      }
      ocean.foamIntensity = profile.foamIntensity;
      ocean.foamCoverage = profile.foamCoverage;
      if (profile.microDetail !== undefined) {
        ocean.microDetail = profile.microDetail;
        if (ocean.material && ocean.material.uniforms && ocean.material.uniforms.u_MicroDetail) {
          ocean.material.uniforms.u_MicroDetail.value = ocean.microDetail;
        }
      }
      if (ocean.material && ocean.material.uniforms) {
        if (ocean.material.uniforms.u_Choppiness) ocean.material.uniforms.u_Choppiness.value = ocean.choppiness;
        if (ocean.material.uniforms.u_FoamIntensity) ocean.material.uniforms.u_FoamIntensity.value = ocean.foamIntensity;
        if (ocean.material.uniforms.u_FoamCoverage) ocean.material.uniforms.u_FoamCoverage.value = ocean.foamCoverage;
        applyPaletteToMaterial(profile, ocean.material);
      }
      FluidAndWater3D.setOceanWind(runtimeScene, behavior, profile.windSpeed, ocean.windDirection);
    },

    getWaveWorksBeaufort: function (runtimeScene, behavior) {
      var ocean = FluidAndWater3D.oceanOf(runtimeScene, behavior);
      return ocean ? (ocean.beaufortScale || 'Custom') : 'Custom';
    },

    getWaveWorksBeaufortNumber: function (runtimeScene, behavior) {
      var ocean = FluidAndWater3D.oceanOf(runtimeScene, behavior);
      if (!ocean) return 4;
      if (ocean.beaufort !== undefined) return ocean.beaufort;
      var prof = resolveWaveWorksBeaufortPreset(ocean.beaufortScale);
      return prof ? (prof.beaufort !== undefined ? prof.beaufort : 4) : 4;
    },

    setWaveWorksCascadeWeight: function (runtimeScene, behavior, weight) {
      var ocean = FluidAndWater3D.oceanOf(runtimeScene, behavior);
      if (!ocean || !ocean.isWaveWorks) return;
      ocean.cascadeWeight = clamp(typeof weight === 'number' ? weight : parseFloat(weight) || 0.0, 0.0, 2.0);
      if (ocean.material && ocean.material.uniforms && ocean.material.uniforms.u_CascadeWeight) {
        ocean.material.uniforms.u_CascadeWeight.value = ocean.cascadeWeight;
      }
    },

    getWaveWorksCascadeWeight: function (runtimeScene, behavior) {
      var ocean = FluidAndWater3D.oceanOf(runtimeScene, behavior);
      return ocean ? (ocean.cascadeWeight !== undefined ? ocean.cascadeWeight : 0.60) : 0.60;
    },

    setWaveWorksOpacity: function (runtimeScene, behavior, opacity) {
      return FluidAndWater3D.setOceanOpacity(runtimeScene, behavior, opacity);
    },

    getWaveWorksOpacity: function (runtimeScene, behavior) {
      return FluidAndWater3D.getOceanOpacity(runtimeScene, behavior);
    },

    setWaveWorksMicroDetail: function (runtimeScene, behavior, detail) {
      return FluidAndWater3D.setOceanMicroDetail(runtimeScene, behavior, detail);
    },

    getWaveWorksMicroDetail: function (runtimeScene, behavior) {
      return FluidAndWater3D.getOceanMicroDetail(runtimeScene, behavior);
    },

    setOceanAnisotropy: function (runtimeScene, behavior, level) {
      var ocean = FluidAndWater3D.oceanOf(runtimeScene, behavior);
      if (!ocean) return;
      ocean.anisotropy = parseAnisotropy(level, 4);
      var renderer = getThreeRendererOf(runtimeScene);
      if (ocean.slopeTexture) applyAnisotropyToTexture(ocean.slopeTexture, renderer, ocean.anisotropy);
      if (ocean.cascadeSlopeTexture) applyAnisotropyToTexture(ocean.cascadeSlopeTexture, renderer, ocean.anisotropy);
      if (ocean.texture) applyAnisotropyToTexture(ocean.texture, renderer, ocean.anisotropy);
      if (ocean.cascadeTexture) applyAnisotropyToTexture(ocean.cascadeTexture, renderer, ocean.anisotropy);
      if (ocean.foamRT && typeof ocean.foamRT.setAnisotropy === 'function') {
        ocean.foamRT.setAnisotropy(ocean.anisotropy);
        ocean.material.uniforms.u_FoamBuffer.value = ocean.foamRT.targets[ocean.foamRT.index].texture;
      }
    },

    getOceanAnisotropy: function (runtimeScene, behavior) {
      var ocean = FluidAndWater3D.oceanOf(runtimeScene, behavior);
      return ocean && ocean.slopeTexture ? (ocean.slopeTexture.anisotropy || 1) : 1;
    },

    setWaveWorksAnisotropy: function (runtimeScene, behavior, level) {
      return FluidAndWater3D.setOceanAnisotropy(runtimeScene, behavior, level);
    },

    getWaveWorksAnisotropy: function (runtimeScene, behavior) {
      return FluidAndWater3D.getOceanAnisotropy(runtimeScene, behavior);
    },

    /* ========================================================= 5. WaterEdge3D */

    registerWaterEdge: function (runtimeScene, object, behavior, options) {
      if (!runtimeScene || !object || !behavior) return null;
      var state = getSceneState(runtimeScene);

      var edge = {
        object: object,
        behavior: behavior,
        // 0 means "fit to the water body"; the resolved values land on foamWidth/shallowWidth
        // each frame in uploadWaterEdges.
        // Only the AUTHORED values live here. The effective widths are derived per water body
        // at the point of use, so an edge shared by two differently sized waters is correct for
        // both, and an edge crowded out of the nearest-eight upload cannot go stale.
        // Auto-fit is opt-in (set the property to 0); making it the default silently rewidened
        // the shallow tint and the surf in scenes that were already tuned.
        foamWidthOption: options.foamWidth > 0 ? options.foamWidth : 0,
        shallowWidthOption: options.shallowWidth > 0 ? options.shallowWidth : 0,
        enabled: options.enabled !== undefined ? !!options.enabled : true,
        hideSourceObject: options.hideSourceObject !== undefined ? !!options.hideSourceObject : false,
        _hiddenByBehavior: false
      };

      state.waterEdges.push(edge);
      if (state.waterEdges.length > MAX_WATER_EDGES && typeof console !== 'undefined' && console.warn) {
        console.warn(
          '[FluidAndWater3D] ' + state.waterEdges.length + ' WaterEdge3D objects are registered but ' +
          'the water shader carries only ' + MAX_WATER_EDGES + ' at a time. The ' + MAX_WATER_EDGES +
          ' nearest to each water body are used; the rest are ignored this frame. Cover a long ' +
          'coastline with fewer, larger edge volumes rather than many small ones.'
        );
      }
      return edge;
    },

    waterEdgeOf: function (runtimeScene, behavior) {
      if (!runtimeScene || !behavior) return null;
      var state = getSceneState(runtimeScene);
      return state.waterEdges.find(function (e) { return e.behavior === behavior; }) || null;
    },

    setWaterEdgeEnabled: function (runtimeScene, behavior, enabled) {
      var edge = FluidAndWater3D.waterEdgeOf(runtimeScene, behavior);
      if (edge) edge.enabled = !!enabled;
    },

    stepWaterEdge: function (runtimeScene, object, behavior, hideSourceObject) {
      var edge = FluidAndWater3D.waterEdgeOf(runtimeScene, behavior);
      if (!edge || !object) return;
      edge.hideSourceObject = !!hideSourceObject;
      var root = getRootObject3D(object);
      if (!root) return;
      if (edge.hideSourceObject) {
        root.visible = false;
        edge._hiddenByBehavior = true;
      } else if (edge._hiddenByBehavior) {
        root.visible = true;
        edge._hiddenByBehavior = false;
      }
    },

    disposeWaterEdge: function (runtimeScene, behavior) {
      if (!runtimeScene || !behavior) return;
      var state = getSceneState(runtimeScene);
      var idx = state.waterEdges.findIndex(function (e) { return e.behavior === behavior; });
      if (idx !== -1) {
        var edge = state.waterEdges[idx];
        if (edge._hiddenByBehavior && edge.object) {
          var root = getRootObject3D(edge.object);
          if (root) root.visible = true;
        }
        state.waterEdges.splice(idx, 1);
      }
    },

    /**
     * Feeds the nearest edge volumes into a water material. The shader carries a fixed eight, so
     * when a scene has more we pick the ones closest to this body rather than the first eight
     * registered — a coastline behind the camera should not crowd out the beach in front of it.
     */
    uploadWaterEdges: function (state, material, centreX, centreY, layerName, waterZ, waterSpan) {
      if (!material || !material.uniforms || !material.uniforms.u_EdgeCount) return;

      var active = [];
      var droppedDisabled = 0, droppedLayer = 0, droppedSize = 0, droppedAbove = 0;
      for (var i = 0; i < state.waterEdges.length; i++) {
        var e = state.waterEdges[i];
        if (!e.enabled || !e.object) { droppedDisabled++; continue; }
        var o = e.object;
        // Water on another layer is rendered by another three.js scene and must not be influenced.
        if (layerName !== undefined && objectLayerName(o) !== layerName) { droppedLayer++; continue; }
        var ow = (o.getWidth && o.getWidth() > 0) ? o.getWidth() : 0;
        var oh = (o.getHeight && o.getHeight() > 0) ? o.getHeight() : 0;
        if (ow <= 0 || oh <= 0) { droppedSize++; continue; }
        var ox = o.getX ? o.getX() : 0;
        var oy = o.getY ? o.getY() : 0;
        if (!edgeReachesWater(o, waterZ)) { droppedAbove++; continue; }
        var cx = ox + ow * 0.5, cy = oy + oh * 0.5;
        active.push({
          e: e, minX: ox, minY: oy, maxX: ox + ow, maxY: oy + oh,
          d2: (cx - centreX) * (cx - centreX) + (cy - centreY) * (cy - centreY)
        });
      }
      active.sort(function (a, b) { return a.d2 - b.d2; });

      var count = Math.min(active.length, MAX_WATER_EDGES);
      var bounds = material.uniforms.u_EdgeBounds.value;
      var params = material.uniforms.u_EdgeParams.value;
      for (var j = 0; j < count; j++) {
        var a = active[j];
        if (bounds[j] && bounds[j].set) bounds[j].set(a.minX, a.minY, a.maxX, a.maxY);
        if (params[j] && params[j].set) {
          params[j].set(foamWidthFor(a.e, waterSpan), shallowWidthFor(a.e, waterSpan));
        }
      }
      material.uniforms.u_EdgeCount.value = count;

      // Every shore branch in the shader is gated on u_EdgeCount, so an edge that never survives
      // these filters produces no foam, no shallow tint and no attenuation — and says nothing.
      // That silence is what made this hard to diagnose, so name the reason once.
      if (count === 0 && state.waterEdges.length > 0 && !state._edgeDropWarned &&
          state.time > 1.0 && typeof console !== 'undefined' && console.warn) {
        state._edgeDropWarned = true;
        var why = [];
        if (droppedLayer) why.push(droppedLayer + ' on a different layer than the water');
        if (droppedSize) why.push(droppedSize + ' with no width or height');
        if (droppedAbove) why.push(droppedAbove + ' whose Z range does not contain the water ' +
          'surface (Z ' + Math.round(waterZ) + ')');
        if (droppedDisabled) why.push(droppedDisabled + ' disabled');
        console.warn([
          '[FluidAndWater3D] ' + state.waterEdges.length + ' WaterEdge3D object(s) are registered',
          'but none of them reach this water surface, so there is no shore foam.',
          (why.length ? '  Reason: ' + why.join(', ') + '.' : ''),
          '  A WaterEdge3D object must be on the same layer as the water, have a real width and',
          '  height, and its Z range must contain the water surface height - raise the land or',
          '  make it taller so the waterline falls inside it.'
        ].filter(Boolean).join('\n'));
      }
    },

    /** How many registered edges currently reach a water surface. Diagnostics only. */
    countWaterEdgesReaching: function (state, layerName, waterZ) {
      if (!state || !state.waterEdges) return 0;
      var n = 0;
      for (var i = 0; i < state.waterEdges.length; i++) {
        var e = state.waterEdges[i];
        if (!e.enabled || !e.object) continue;
        if (layerName !== undefined && objectLayerName(e.object) !== layerName) continue;
        var w = (e.object.getWidth && e.object.getWidth() > 0) ? e.object.getWidth() : 0;
        var h = (e.object.getHeight && e.object.getHeight() > 0) ? e.object.getHeight() : 0;
        if (w <= 0 || h <= 0) continue;
        if (!edgeReachesWater(e.object, waterZ)) continue;
        n++;
      }
      return Math.min(n, MAX_WATER_EDGES);
    },

    /* ========================================================= 6. WaterDetailing3D */

    findWaterBodyForObject: function (state, object) {
      if (!state || !object) return null;
      var i;
      for (i = 0; i < state.oceans.length; i++) {
        if (state.oceans[i].object === object) return state.oceans[i];
      }
      for (i = 0; i < state.waterBodies.length; i++) {
        if (state.waterBodies[i].object === object) return state.waterBodies[i];
      }
      return null;
    },

    registerWaterDetailing: function (runtimeScene, object, behavior, options) {
      if (!runtimeScene || !object || !behavior) return null;
      var state = getSceneState(runtimeScene);
      options = options || {};

      // Two axes: STYLE is the drawing method, TYPE is the water condition. The style carries no
      // colours - it scales what the type says and decides whether caustics obey depth.
      var styleName = options.style || 'Sea of Thieves';
      var typeName = options.waterLook || 'Open Ocean';
      var subStyleName = options.subStyle || 'Salt Water';
      var lightingName = options.lighting || 'Golden Hour';
      var style = (styleName !== 'Custom') ? resolveWaterDetailingStyle(styleName) : null;
      var type = (typeName !== 'Custom') ? resolveWaterDetailingType(typeName) : null;
      var lighting = (lightingName !== 'Custom') ? resolveWaterDetailingLighting(lightingName) : null;
      var subStyle = (subStyleName !== 'Custom') ? resolveWaterDetailingSubStyle(subStyleName) : null;
      // Sea of Thieves is the default look. Natural is the physically sparse open-ocean foam
      // and it is still there, but the generous trailing sheets are what this extension is
      // actually for, and they read better at every sea state.
      var foamName = options.foamStyle || 'Sea of Thieves';
      var foam = (foamName !== 'Custom') ? resolveWaterDetailingFoam(foamName) : null;

      var p = type ? composeWaterDetailingLook(style, type, lighting, subStyle, foam) : null;
      var presetName = p ? (p.name || typeName) : typeName;
      var base = p || WATER_DETAILING_PRESETS.SeaOfThieves_GoldenHour;

      // A named preset OWNS the look. The individual properties below are the Custom-mode values:
      // GDevelop always calls their getters, so reading them here would mean the preset could never
      // win and the dropdown would do nothing at all.
      var src = p ? {} : options;
      // The sun belongs to the Lighting axis, so it is gated by that axis alone: Lighting = Custom
      // hands the sun back to the properties even while Style and Water Type stay on presets.
      var sunSrc = lighting ? {} : options;

      var det = {
        object: object,
        behavior: behavior,
        targetWaterBody: null,
        layerName: objectLayerName(object),
        // Wave-collision spray. Off by default: it is the only part of the detailing that
        // costs CPU in proportion to how rough the sea is.
        sprayEnabled: !!options.sprayEnabled,
        sprayAmount: (options.sprayAmount !== undefined) ? clamp(num(options.sprayAmount, 0.5), 0, 1) : 0.5,
        sprayHeight: (options.sprayHeight !== undefined) ? Math.max(0, num(options.sprayHeight, 1.0)) : 1.0,
        sprayThreshold: (options.sprayThreshold !== undefined) ? clamp(num(options.sprayThreshold, 0.5), 0, 1) : 0.5,
        sprayBudgetMax: 1024,
        lastDt: 0.016,
        // Store the canonical readable name, the way setWaterDetailingPreset does, so the
        // expression returns the same text the dropdown shows even for a project saved under
        // the old identifiers.
        preset: p ? (p.name || presetName) : presetName,
        style: style ? style.name : 'Custom',
        waterLook: type ? type.name : presetName,
        lighting: lighting ? lighting.name : 'Custom',
        subStyle: subStyle ? subStyle.name : 'Custom',
        foamDecay: subStyle ? subStyle.foamDecay : 3.0,
        // The medium's foaming tendency, kept so the spray can read it too: pool water is
        // chlorinated and barely foams, and it should barely spit either.
        foamCoverageScale: subStyle && subStyle.foamCoverageScale !== undefined
          ? subStyle.foamCoverageScale : 1.0,
        // The foam axis, resolved at registration and pushed to the shader every step.
        foamStyle: foam ? foam.name : foamName,
        foamScale: p && p.foamScale !== undefined ? p.foamScale : 1.0,
        foamStreak: p && p.foamStreak !== undefined ? p.foamStreak : 4.5,
        foamBite: p && p.foamBite !== undefined ? p.foamBite : 1.0,
        foamTrail: p && p.foamTrail !== undefined ? p.foamTrail : 1.0,
        sunHeading: ((numOrParse(sunSrc.sunHeading !== undefined ? sunSrc.sunHeading : base.sunHeading, base.sunHeading) % 360) + 360) % 360,
        sunElevation: clamp(numOrParse(sunSrc.sunElevation !== undefined ? sunSrc.sunElevation : base.sunElevation, base.sunElevation), 0.0, 90.0),
        sunColor: sunSrc.sunColor ? parseNormalizedColor(sunSrc.sunColor, base.sunColor) : base.sunColor.slice(),
        sunSpecularIntensity: Math.max(0.0, numOrParse(sunSrc.sunSpecularIntensity !== undefined ? sunSrc.sunSpecularIntensity : base.sunSpecularIntensity, base.sunSpecularIntensity)),
        sunSpecularRoughness: clamp(numOrParse(sunSrc.sunSpecularRoughness !== undefined ? sunSrc.sunSpecularRoughness : base.sunSpecularRoughness, base.sunSpecularRoughness), 1.0, 1024.0),
        waveContrast: clamp(numOrParse(src.waveContrast !== undefined ? src.waveContrast : base.waveContrast, base.waveContrast), 0.0, 1.0),
        shallowColor: src.shallowColor ? parseNormalizedColor(src.shallowColor, base.shallowColor) : base.shallowColor.slice(),
        deepColor: src.deepColor ? parseNormalizedColor(src.deepColor, base.deepColor) : base.deepColor.slice(),
        extinctionDepth: Math.max(1.0, numOrParse(src.extinctionDepth !== undefined ? src.extinctionDepth : base.extinctionDepth, base.extinctionDepth)),
        translucencyColor: src.translucencyColor ? parseNormalizedColor(src.translucencyColor, base.translucencyColor) : base.translucencyColor.slice(),
        translucencyIntensity: Math.max(0.0, numOrParse(src.translucencyIntensity !== undefined ? src.translucencyIntensity : base.translucencyIntensity, base.translucencyIntensity)),
        translucencyPower: clamp(numOrParse(src.translucencyPower !== undefined ? src.translucencyPower : base.translucencyPower, base.translucencyPower), 0.5, 16.0),
        foamColor: src.foamColor ? parseNormalizedColor(src.foamColor, base.foamColor) : base.foamColor.slice(),
        foamIntensity: Math.max(0.0, numOrParse(src.foamIntensity !== undefined ? src.foamIntensity : base.foamIntensity, base.foamIntensity)),
        foamCoverage: clamp(numOrParse(src.foamCoverage !== undefined ? src.foamCoverage : base.foamCoverage, base.foamCoverage), 0.0, 1.0),
        microDetail: Math.max(0.0, numOrParse(src.microDetail !== undefined ? src.microDetail : base.microDetail, base.microDetail)),
        microFrequency: clamp(numOrParse(src.microFrequency !== undefined ? src.microFrequency : base.microFrequency, base.microFrequency), 0.05, 10.0),
        opacity: clamp(numOrParse(src.opacity !== undefined ? src.opacity : base.opacity, base.opacity), 0.0, 1.0),
        causticsIntensity: Math.max(0.0, numOrParse(src.causticsIntensity !== undefined
          ? src.causticsIntensity : base.causticsIntensity, base.causticsIntensity !== undefined ? base.causticsIntensity : 0.8)),
        causticsDepthFade: clamp(numOrParse(src.causticsDepthFade !== undefined
          ? src.causticsDepthFade
          : (base.causticsDepthFade !== undefined ? base.causticsDepthFade : 1.0), 1.0), 0.0, 1.0),
        foamModel: base.foamModel !== undefined ? base.foamModel : 1.0,
        foamSoftness: base.foamSoftness !== undefined ? base.foamSoftness : 1.0,
        quantiseBands: base.quantiseBands !== undefined ? base.quantiseBands : 0.0,
        glitterScale: base.glitterScale !== undefined ? base.glitterScale : 0.6,
        sprayEnabled: options.sprayEnabled === true || options.sprayEnabled === 'true',
        sprayAmount: clamp(numOrParse(options.sprayAmount !== undefined ? options.sprayAmount : 0.5, 0.5), 0.0, 1.0),
        sprayHeight: Math.max(0.0, numOrParse(options.sprayHeight !== undefined ? options.sprayHeight : 1.0, 1.0)),
        sprayThreshold: clamp(numOrParse(options.sprayThreshold !== undefined ? options.sprayThreshold : 0.5, 0.5), 0.0, 1.0),
        textureAnisotropy: parseAnisotropy(options.textureAnisotropy !== undefined ? options.textureAnisotropy : 4, 4),
        lastDt: getDeltaSeconds(runtimeScene)
      };

      state.waterDetailings.push(det);

      var target = FluidAndWater3D.findWaterBodyForObject(state, object);
      if (target) {
        det.targetWaterBody = target;
        if (target.material) {
          applyWaterDetailingToMaterial(det, target.material);
        }
        FluidAndWater3D.applyWaterDetailingAnisotropyToTarget(runtimeScene, det, target);
      }

      return det;
    },

    applyWaterDetailingAnisotropyToTarget: function (runtimeScene, det, target) {
      if (!det || !target) return;
      var level = det.textureAnisotropy || 4;
      var renderer = getThreeRendererOf(runtimeScene);
      target.anisotropy = level;
      if (target.slopeTexture) applyAnisotropyToTexture(target.slopeTexture, renderer, level);
      if (target.cascadeSlopeTexture) applyAnisotropyToTexture(target.cascadeSlopeTexture, renderer, level);
      if (target.texture) applyAnisotropyToTexture(target.texture, renderer, level);
      if (target.cascadeTexture) applyAnisotropyToTexture(target.cascadeTexture, renderer, level);
      if (target.foamRT && typeof target.foamRT.setAnisotropy === 'function') {
        target.foamRT.setAnisotropy(level);
        target.material.uniforms.u_FoamBuffer.value = target.foamRT.targets[target.foamRT.index].texture;
      }
    },

    waterDetailingOf: function (runtimeScene, behavior) {
      if (!runtimeScene || !behavior) return null;
      var state = getSceneState(runtimeScene);
      return state.waterDetailings.find(function (d) { return d.behavior === behavior; }) || null;
    },

    /**
     * Renders the spray pool. Kept beside the step so the pool, its mesh and its teardown are
     * all in one place rather than scattered through the lifecycle.
     */
    syncSprayMesh: function (runtimeScene, det) {
      var state = getSceneState(runtimeScene);
      var spray = state.spray;
      if (!spray) return;
      if (!THREE_OK || typeof THREE.InstancedMesh !== 'function') return;

      if (!state.sprayMesh) {
        var root = getLayerThreeRoot(runtimeScene, (det && det.layerName) ? det.layerName : '');
        if (!root) return;
        var geom = new THREE.SphereGeometry(1.0, 6, 4);
        var mat = new THREE.MeshBasicMaterial({
          color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false
        });
        state.sprayMesh = new THREE.InstancedMesh(geom, mat, spray.max);
        state.sprayMesh.name = 'FluidAndWater3D_Spray';
        state.sprayMesh.frustumCulled = false;
        if (state.sprayMesh.instanceMatrix && state.sprayMesh.instanceMatrix.setUsage) {
          state.sprayMesh.instanceMatrix.setUsage(35048); // THREE.DynamicDrawUsage
        }
        state.sprayDummy = new THREE.Object3D();
        state.sprayAxis = (typeof THREE.Vector3 === 'function') ? new THREE.Vector3() : null;
        root.add(state.sprayMesh);
      }

      var mesh = state.sprayMesh;
      var dummy = state.sprayDummy;
      var sprayAxis = state.sprayAxis;
      if (!state.sprayUp && typeof THREE.Vector3 === 'function') {
        state.sprayUp = new THREE.Vector3(0, 0, 1);
      }
      var SPRAY_UP = state.sprayUp;
      if (!mesh || !dummy) return;
      var shown = 0;
      for (var i = 0; i < spray.max; i++) {
        if (!spray.alive[i]) continue;
        // Fade the last third of life by shrinking, so droplets thin out instead of popping.
        var t = spray.life0[i] > 0 ? (spray.life[i] / spray.life0[i]) : 0.0;
        var scale = spray.size[i] * Math.min(1.0, t * 3.0);
        dummy.position.set(spray.x[i], spray.y[i], spray.z[i]);
        // Water in flight is a streak, not a ball - a uniform sphere is the other half of why this
        // read as bubbles. Orient each droplet along its own velocity and stretch it, so fast ones
        // are long and thin and slow ones go round again as they hang at the top of the arc.
        var vx = spray.vx[i], vy = spray.vy[i], vz = spray.vz[i];
        var sp = Math.sqrt(vx * vx + vy * vy + vz * vz);
        var canOrient = sp > 1e-3 && sprayAxis && SPRAY_UP && dummy.quaternion &&
          typeof dummy.quaternion.setFromUnitVectors === 'function';
        if (canOrient) {
          sprayAxis.set(vx / sp, vy / sp, vz / sp);
          dummy.quaternion.setFromUnitVectors(SPRAY_UP, sprayAxis);
          var stretch = 1.0 + Math.min(sp / Math.max(spray.refSpeed || 1, 1), 1.0) * 2.2;
          dummy.scale.set(scale * 0.55, scale * 0.55, scale * stretch);
        } else {
          if (dummy.quaternion && typeof dummy.quaternion.set === 'function') {
            dummy.quaternion.set(0, 0, 0, 1);
          }
          dummy.scale.set(scale, scale, scale);
        }
        dummy.updateMatrix();
        mesh.setMatrixAt(shown, dummy.matrix);
        shown++;
      }
      mesh.count = shown;
      if (mesh.instanceMatrix) mesh.instanceMatrix.needsUpdate = true;
      mesh.visible = shown > 0;
    },

    stepWaterDetailing: function (runtimeScene, object, behavior) {
      if (!runtimeScene || !behavior) return;
      var det = FluidAndWater3D.waterDetailingOf(runtimeScene, behavior);
      if (!det) return;
      det.lastDt = getDeltaSeconds(runtimeScene);

      var state = getSceneState(runtimeScene);
      det.lastDt = getDeltaSeconds(runtimeScene);
      var target = det.targetWaterBody;
      if (!target || !target.material) {
        target = FluidAndWater3D.findWaterBodyForObject(state, object);
        det.targetWaterBody = target;
      }

      if (target) {
        if (target.material) {
          applyWaterDetailingToMaterial(det, target.material);
        }
        target.shallowColor = det.shallowColor;
        target.deepColor = det.deepColor;
        target.extinctionDepth = det.extinctionDepth;
        target.foamIntensity = det.foamIntensity;
        target.foamCoverage = det.foamCoverage;
        target.microDetail = det.microDetail;
        target.opacity = det.opacity;
        if (target.anisotropy !== det.textureAnisotropy) {
          FluidAndWater3D.applyWaterDetailingAnisotropyToTarget(runtimeScene, det, target);
        }
        // The medium owns how long foam survives; the ocean is what actually runs the buffer.
        if (det.foamDecay !== undefined) target.foamDecaySeconds = det.foamDecay;
      }

      // ---------------------------------------------------------------- wave-collision spray
      // Off unless asked for, like the persistent foam buffer, and for the same reason: it is the
      // only part of the detailing that costs CPU proportional to what is on screen.
      // Switched off, the bright patches have to go with the droplets.
      if (!det.sprayEnabled && target && target.material && target.material.uniforms
          && target.material.uniforms.u_PlumeFoam) {
        target.material.uniforms.u_PlumeFoam.value = 0.0;
      }
      if (!det.sprayEnabled) {
        return;
      }

      var ocean = (target && target.isWaveWorks) ? target : null;
      if (!ocean) {
        // Spray reads the plume mask, which only the spectral ocean produces. The Gerstner water
        // has no equivalent, so rather than fake one, say nothing and do nothing.
        return;
      }

      if (!state.spray) state.spray = new SpraySystem(det.sprayBudgetMax || 1024);
      if (state.sprayLayerName === null) state.sprayLayerName = det.layerName || '';
      var dt = det.lastDt * state.timeScale;
      if (state.paused || !(dt > 0)) return;

      // The style decides how theatrical the spray is; the medium decides whether it happens at
      // all. Pool water has a foamCoverageScale of 0.05 and should barely spit.
      var mediumScale = (det.foamCoverageScale !== undefined) ? det.foamCoverageScale : 1.0;
      var amount = clamp(det.sprayAmount !== undefined ? det.sprayAmount : 0.5, 0.0, 1.0);
      var perFrame = Math.round(amount * mediumScale * 24);

      emitWaveCollisionSpray(state.spray, ocean, {
        budget: perFrame,
        // The slider is 'how readily it spurts', so it runs backwards against the mask. 0.55
        // down to 0.05 puts the midpoint where a gale sprays freely, a strong breeze throws
        // the occasional spout, and Beaufort 4 and below stay dry.
        threshold: clamp(0.55 - 0.5 * (det.sprayThreshold !== undefined ? det.sprayThreshold : 0.5), 0.02, 1.0),
        speed: 0.9 * (det.sprayHeight !== undefined ? det.sprayHeight : 1.0),
        life: 1.1,
        size: Math.max(ocean.significantWaveHeight * 0.012, 1.0),
        gravity: sprayGravityFor(ocean, det)
      }, dt);

      // The bright disturbed water under a collision, tied to the same sliders as the droplets so
      // the two can never disagree about whether spray is happening here.
      if (ocean.material && ocean.material.uniforms && ocean.material.uniforms.u_PlumeFoam) {
        ocean.material.uniforms.u_PlumeFoam.value = 0.7 * amount * mediumScale;
      }
    },

    disposeWaterDetailing: function (runtimeScene, behavior) {
      if (!runtimeScene || !behavior) return;
      var state = getSceneState(runtimeScene);
      var idx = state.waterDetailings.findIndex(function (d) { return d.behavior === behavior; });
      if (idx !== -1) {
        state.waterDetailings.splice(idx, 1);
      }
      if (state.waterDetailings.length === 0) {
        if (state.sprayMesh) {
          if (state.sprayMesh.geometry && state.sprayMesh.geometry.dispose) state.sprayMesh.geometry.dispose();
          if (state.sprayMesh.material && state.sprayMesh.material.dispose) state.sprayMesh.material.dispose();
          if (state.sprayMesh.parent) state.sprayMesh.parent.remove(state.sprayMesh);
          state.sprayMesh = null;
        }
        if (state.spray) {
          state.spray.clear();
          state.spray = null;
        }
        state.sprayDummy = null;
        state.sprayLayerName = null;
      }
    },

    /** Switches the foam axis at runtime. Re-resolves and re-applies immediately. */
    setWaterDetailingFoamStyle: function (runtimeScene, behavior, foamName) {
      var det = FluidAndWater3D.waterDetailingOf(runtimeScene, behavior);
      if (!det) return;
      var f = resolveWaterDetailingFoam(foamName);
      if (!f) return;
      det.foamStyle = f.name;
      det.foamScale = f.foamScale;
      det.foamStreak = f.foamStreak;
      det.foamBite = f.foamBite;
      det.foamTrail = f.foamTrail;
      if (f.foamSoftness !== undefined) det.foamSoftness = f.foamSoftness;
      var target = det.targetWaterBody;
      if (target && target.material) applyWaterDetailingToMaterial(det, target.material);
    },

    getWaterDetailingFoamStyle: function (runtimeScene, behavior) {
      var det = FluidAndWater3D.waterDetailingOf(runtimeScene, behavior);
      return det ? (det.foamStyle || 'Natural') : 'Natural';
    },

    setWaterDetailingPreset: function (runtimeScene, behavior, presetName) {
      var det = FluidAndWater3D.waterDetailingOf(runtimeScene, behavior);
      if (!det) return;
      var p = resolveWaterDetailingPreset(presetName);
      if (!p) return;
      det.preset = p.name || presetName;
      det.sunHeading = p.sunHeading !== undefined ? p.sunHeading : det.sunHeading;
      det.sunElevation = p.sunElevation !== undefined ? p.sunElevation : det.sunElevation;
      if (p.sunColor) det.sunColor = p.sunColor.slice ? p.sunColor.slice() : p.sunColor;
      if (p.sunSpecularIntensity !== undefined) det.sunSpecularIntensity = p.sunSpecularIntensity;
      if (p.sunSpecularRoughness !== undefined) det.sunSpecularRoughness = p.sunSpecularRoughness;
      if (p.deepColor) det.deepColor = p.deepColor.slice ? p.deepColor.slice() : p.deepColor;
      if (p.shallowColor) det.shallowColor = p.shallowColor.slice ? p.shallowColor.slice() : p.shallowColor;
      if (p.waveContrast !== undefined) det.waveContrast = p.waveContrast;
      if (p.extinctionDepth !== undefined) det.extinctionDepth = p.extinctionDepth;
      if (p.translucencyColor) det.translucencyColor = p.translucencyColor.slice ? p.translucencyColor.slice() : p.translucencyColor;
      if (p.translucencyIntensity !== undefined) det.translucencyIntensity = p.translucencyIntensity;
      if (p.translucencyPower !== undefined) det.translucencyPower = p.translucencyPower;
      if (p.foamColor) det.foamColor = p.foamColor.slice ? p.foamColor.slice() : p.foamColor;
      if (p.foamIntensity !== undefined) det.foamIntensity = p.foamIntensity;
      if (p.foamCoverage !== undefined) det.foamCoverage = p.foamCoverage;
      if (p.microDetail !== undefined) det.microDetail = p.microDetail;
      if (p.microFrequency !== undefined) det.microFrequency = p.microFrequency;
      if (p.opacity !== undefined) det.opacity = p.opacity;
      if (p.causticsIntensity !== undefined) det.causticsIntensity = p.causticsIntensity;
      det.causticsDepthFade = (p.causticsDepthFade !== undefined) ? p.causticsDepthFade : 1.0;
      if (p.foamModel !== undefined) det.foamModel = p.foamModel;
      if (p.foamSoftness !== undefined) det.foamSoftness = p.foamSoftness;
      if (p.quantiseBands !== undefined) det.quantiseBands = p.quantiseBands;
      if (p.glitterScale !== undefined) det.glitterScale = p.glitterScale;
      if (det.targetWaterBody && det.targetWaterBody.material) {
        applyWaterDetailingToMaterial(det, det.targetWaterBody.material);
      }
    },

    getWaterDetailingPreset: function (runtimeScene, behavior) {
      var det = FluidAndWater3D.waterDetailingOf(runtimeScene, behavior);
      return det ? (det.preset || 'Custom') : 'Custom';
    },

    setWaterDetailingSunHeading: function (runtimeScene, behavior, heading) {
      var det = FluidAndWater3D.waterDetailingOf(runtimeScene, behavior);
      if (!det) return;
      det.sunHeading = ((numOrParse(heading, 0.0) % 360) + 360) % 360;
      det.preset = 'Custom';
      if (det.targetWaterBody && det.targetWaterBody.material) applyWaterDetailingToMaterial(det, det.targetWaterBody.material);
    },

    getWaterDetailingSunHeading: function (runtimeScene, behavior) {
      var det = FluidAndWater3D.waterDetailingOf(runtimeScene, behavior);
      return det ? det.sunHeading : 75.0;
    },

    setWaterDetailingSunElevation: function (runtimeScene, behavior, elevation) {
      var det = FluidAndWater3D.waterDetailingOf(runtimeScene, behavior);
      if (!det) return;
      det.sunElevation = clamp(numOrParse(elevation, 18.0), 0.0, 90.0);
      det.preset = 'Custom';
      if (det.targetWaterBody && det.targetWaterBody.material) applyWaterDetailingToMaterial(det, det.targetWaterBody.material);
    },

    getWaterDetailingSunElevation: function (runtimeScene, behavior) {
      var det = FluidAndWater3D.waterDetailingOf(runtimeScene, behavior);
      return det ? det.sunElevation : 18.0;
    },

    setWaterDetailingSunColor: function (runtimeScene, behavior, color) {
      var det = FluidAndWater3D.waterDetailingOf(runtimeScene, behavior);
      if (!det) return;
      det.sunColor = parseNormalizedColor(color, det.sunColor);
      det.preset = 'Custom';
      if (det.targetWaterBody && det.targetWaterBody.material) applyWaterDetailingToMaterial(det, det.targetWaterBody.material);
    },

    getWaterDetailingSunColor: function (runtimeScene, behavior) {
      var det = FluidAndWater3D.waterDetailingOf(runtimeScene, behavior);
      return det ? formatColor255(det.sunColor) : '255;245;225';
    },

    setWaterDetailingSunSpecularIntensity: function (runtimeScene, behavior, val) {
      var det = FluidAndWater3D.waterDetailingOf(runtimeScene, behavior);
      if (!det) return;
      det.sunSpecularIntensity = Math.max(0.0, numOrParse(val, 2.8));
      det.preset = 'Custom';
      if (det.targetWaterBody && det.targetWaterBody.material) applyWaterDetailingToMaterial(det, det.targetWaterBody.material);
    },

    getWaterDetailingSunSpecularIntensity: function (runtimeScene, behavior) {
      var det = FluidAndWater3D.waterDetailingOf(runtimeScene, behavior);
      return det ? det.sunSpecularIntensity : 2.8;
    },

    setWaterDetailingSunSpecularRoughness: function (runtimeScene, behavior, val) {
      var det = FluidAndWater3D.waterDetailingOf(runtimeScene, behavior);
      if (!det) return;
      det.sunSpecularRoughness = clamp(numOrParse(val, 160.0), 1.0, 1024.0);
      det.preset = 'Custom';
      if (det.targetWaterBody && det.targetWaterBody.material) applyWaterDetailingToMaterial(det, det.targetWaterBody.material);
    },

    getWaterDetailingSunSpecularRoughness: function (runtimeScene, behavior) {
      var det = FluidAndWater3D.waterDetailingOf(runtimeScene, behavior);
      return det ? det.sunSpecularRoughness : 160.0;
    },

    setWaterDetailingSunLighting: function (runtimeScene, behavior, heading, elevation, color, specularIntensity, specularRoughness) {
      var det = FluidAndWater3D.waterDetailingOf(runtimeScene, behavior);
      if (!det) return;
      det.sunHeading = ((numOrParse(heading, det.sunHeading) % 360) + 360) % 360;
      det.sunElevation = clamp(numOrParse(elevation, det.sunElevation), 0.0, 90.0);
      det.sunColor = parseNormalizedColor(color, det.sunColor);
      det.sunSpecularIntensity = Math.max(0.0, numOrParse(specularIntensity, det.sunSpecularIntensity));
      det.sunSpecularRoughness = clamp(numOrParse(specularRoughness, det.sunSpecularRoughness), 1.0, 1024.0);
      det.preset = 'Custom';
      if (det.targetWaterBody && det.targetWaterBody.material) applyWaterDetailingToMaterial(det, det.targetWaterBody.material);
    },

    setWaterDetailingShallowColor: function (runtimeScene, behavior, color) {
      var det = FluidAndWater3D.waterDetailingOf(runtimeScene, behavior);
      if (!det) return;
      det.shallowColor = parseNormalizedColor(color, det.shallowColor);
      det.preset = 'Custom';
      if (det.targetWaterBody && det.targetWaterBody.material) applyWaterDetailingToMaterial(det, det.targetWaterBody.material);
    },

    getWaterDetailingShallowColor: function (runtimeScene, behavior) {
      var det = FluidAndWater3D.waterDetailingOf(runtimeScene, behavior);
      return det ? formatColor255(det.shallowColor) : '35;220;200';
    },

    setWaterDetailingDeepColor: function (runtimeScene, behavior, color) {
      var det = FluidAndWater3D.waterDetailingOf(runtimeScene, behavior);
      if (!det) return;
      det.deepColor = parseNormalizedColor(color, det.deepColor);
      det.preset = 'Custom';
      if (det.targetWaterBody && det.targetWaterBody.material) applyWaterDetailingToMaterial(det, det.targetWaterBody.material);
    },

    getWaterDetailingDeepColor: function (runtimeScene, behavior) {
      var det = FluidAndWater3D.waterDetailingOf(runtimeScene, behavior);
      return det ? formatColor255(det.deepColor) : '4;22;48';
    },

    setWaterDetailingWaveContrast: function (runtimeScene, behavior, contrast) {
      var det = FluidAndWater3D.waterDetailingOf(runtimeScene, behavior);
      if (!det) return;
      det.waveContrast = clamp(numOrParse(contrast, 0.55), 0.0, 1.0);
      det.preset = 'Custom';
      if (det.targetWaterBody && det.targetWaterBody.material) applyWaterDetailingToMaterial(det, det.targetWaterBody.material);
    },

    getWaterDetailingWaveContrast: function (runtimeScene, behavior) {
      var det = FluidAndWater3D.waterDetailingOf(runtimeScene, behavior);
      return det ? det.waveContrast : 0.55;
    },

    setWaterDetailingExtinctionDepth: function (runtimeScene, behavior, depth) {
      var det = FluidAndWater3D.waterDetailingOf(runtimeScene, behavior);
      if (!det) return;
      det.extinctionDepth = Math.max(1.0, numOrParse(depth, 260.0));
      det.preset = 'Custom';
      if (det.targetWaterBody && det.targetWaterBody.material) applyWaterDetailingToMaterial(det, det.targetWaterBody.material);
    },

    getWaterDetailingExtinctionDepth: function (runtimeScene, behavior) {
      var det = FluidAndWater3D.waterDetailingOf(runtimeScene, behavior);
      return det ? det.extinctionDepth : 260.0;
    },

    setWaterDetailingPalette: function (runtimeScene, behavior, shallowColor, deepColor, waveContrast, extinctionDepth) {
      var det = FluidAndWater3D.waterDetailingOf(runtimeScene, behavior);
      if (!det) return;
      det.shallowColor = parseNormalizedColor(shallowColor, det.shallowColor);
      det.deepColor = parseNormalizedColor(deepColor, det.deepColor);
      det.waveContrast = clamp(numOrParse(waveContrast, det.waveContrast), 0.0, 1.0);
      det.extinctionDepth = Math.max(1.0, numOrParse(extinctionDepth, det.extinctionDepth));
      det.preset = 'Custom';
      if (det.targetWaterBody && det.targetWaterBody.material) applyWaterDetailingToMaterial(det, det.targetWaterBody.material);
    },

    setWaterDetailingTranslucencyColor: function (runtimeScene, behavior, color) {
      var det = FluidAndWater3D.waterDetailingOf(runtimeScene, behavior);
      if (!det) return;
      det.translucencyColor = parseNormalizedColor(color, det.translucencyColor);
      det.preset = 'Custom';
      if (det.targetWaterBody && det.targetWaterBody.material) applyWaterDetailingToMaterial(det, det.targetWaterBody.material);
    },

    getWaterDetailingTranslucencyColor: function (runtimeScene, behavior) {
      var det = FluidAndWater3D.waterDetailingOf(runtimeScene, behavior);
      return det ? formatColor255(det.translucencyColor) : '40;255;220';
    },

    setWaterDetailingTranslucencyIntensity: function (runtimeScene, behavior, val) {
      var det = FluidAndWater3D.waterDetailingOf(runtimeScene, behavior);
      if (!det) return;
      det.translucencyIntensity = Math.max(0.0, numOrParse(val, 1.60));
      det.preset = 'Custom';
      if (det.targetWaterBody && det.targetWaterBody.material) applyWaterDetailingToMaterial(det, det.targetWaterBody.material);
    },

    getWaterDetailingTranslucencyIntensity: function (runtimeScene, behavior) {
      var det = FluidAndWater3D.waterDetailingOf(runtimeScene, behavior);
      return det ? det.translucencyIntensity : 1.60;
    },

    setWaterDetailingTranslucencyPower: function (runtimeScene, behavior, val) {
      var det = FluidAndWater3D.waterDetailingOf(runtimeScene, behavior);
      if (!det) return;
      det.translucencyPower = clamp(numOrParse(val, 2.8), 0.5, 16.0);
      det.preset = 'Custom';
      if (det.targetWaterBody && det.targetWaterBody.material) applyWaterDetailingToMaterial(det, det.targetWaterBody.material);
    },

    getWaterDetailingTranslucencyPower: function (runtimeScene, behavior) {
      var det = FluidAndWater3D.waterDetailingOf(runtimeScene, behavior);
      return det ? det.translucencyPower : 2.8;
    },

    setWaterDetailingTranslucency: function (runtimeScene, behavior, color, intensity, power) {
      var det = FluidAndWater3D.waterDetailingOf(runtimeScene, behavior);
      if (!det) return;
      det.translucencyColor = parseNormalizedColor(color, det.translucencyColor);
      det.translucencyIntensity = Math.max(0.0, numOrParse(intensity, det.translucencyIntensity));
      det.translucencyPower = clamp(numOrParse(power, det.translucencyPower), 0.5, 16.0);
      det.preset = 'Custom';
      if (det.targetWaterBody && det.targetWaterBody.material) applyWaterDetailingToMaterial(det, det.targetWaterBody.material);
    },

    setWaterDetailingFoamColor: function (runtimeScene, behavior, color) {
      var det = FluidAndWater3D.waterDetailingOf(runtimeScene, behavior);
      if (!det) return;
      det.foamColor = parseNormalizedColor(color, det.foamColor);
      det.preset = 'Custom';
      if (det.targetWaterBody && det.targetWaterBody.material) applyWaterDetailingToMaterial(det, det.targetWaterBody.material);
    },

    getWaterDetailingFoamColor: function (runtimeScene, behavior) {
      var det = FluidAndWater3D.waterDetailingOf(runtimeScene, behavior);
      return det ? formatColor255(det.foamColor) : '248;252;255';
    },

    setWaterDetailingFoamIntensity: function (runtimeScene, behavior, val) {
      var det = FluidAndWater3D.waterDetailingOf(runtimeScene, behavior);
      if (!det) return;
      det.foamIntensity = Math.max(0.0, numOrParse(val, 0.75));
      det.preset = 'Custom';
      if (det.targetWaterBody && det.targetWaterBody.material) applyWaterDetailingToMaterial(det, det.targetWaterBody.material);
    },

    getWaterDetailingFoamIntensity: function (runtimeScene, behavior) {
      var det = FluidAndWater3D.waterDetailingOf(runtimeScene, behavior);
      return det ? det.foamIntensity : 0.75;
    },

    setWaterDetailingFoamCoverage: function (runtimeScene, behavior, val) {
      var det = FluidAndWater3D.waterDetailingOf(runtimeScene, behavior);
      if (!det) return;
      det.foamCoverage = clamp(numOrParse(val, 0.35), 0.0, 1.0);
      det.preset = 'Custom';
      if (det.targetWaterBody && det.targetWaterBody.material) applyWaterDetailingToMaterial(det, det.targetWaterBody.material);
    },

    getWaterDetailingFoamCoverage: function (runtimeScene, behavior) {
      var det = FluidAndWater3D.waterDetailingOf(runtimeScene, behavior);
      return det ? det.foamCoverage : 0.35;
    },

    setWaterDetailingFoam: function (runtimeScene, behavior, color, intensity, coverage) {
      var det = FluidAndWater3D.waterDetailingOf(runtimeScene, behavior);
      if (!det) return;
      det.foamColor = parseNormalizedColor(color, det.foamColor);
      det.foamIntensity = Math.max(0.0, numOrParse(intensity, det.foamIntensity));
      det.foamCoverage = clamp(numOrParse(coverage, det.foamCoverage), 0.0, 1.0);
      det.preset = 'Custom';
      if (det.targetWaterBody && det.targetWaterBody.material) applyWaterDetailingToMaterial(det, det.targetWaterBody.material);
    },

    setWaterDetailingMicroDetail: function (runtimeScene, behavior, val) {
      var det = FluidAndWater3D.waterDetailingOf(runtimeScene, behavior);
      if (!det) return;
      det.microDetail = Math.max(0.0, numOrParse(val, 0.35));
      det.preset = 'Custom';
      if (det.targetWaterBody && det.targetWaterBody.material) applyWaterDetailingToMaterial(det, det.targetWaterBody.material);
    },

    getWaterDetailingMicroDetail: function (runtimeScene, behavior) {
      var det = FluidAndWater3D.waterDetailingOf(runtimeScene, behavior);
      return det ? det.microDetail : 0.35;
    },

    setWaterDetailingMicroFrequency: function (runtimeScene, behavior, val) {
      var det = FluidAndWater3D.waterDetailingOf(runtimeScene, behavior);
      if (!det) return;
      det.microFrequency = clamp(numOrParse(val, 1.0), 0.05, 10.0);
      det.preset = 'Custom';
      if (det.targetWaterBody && det.targetWaterBody.material) applyWaterDetailingToMaterial(det, det.targetWaterBody.material);
    },

    getWaterDetailingMicroFrequency: function (runtimeScene, behavior) {
      var det = FluidAndWater3D.waterDetailingOf(runtimeScene, behavior);
      return det ? det.microFrequency : 1.0;
    },

    setWaterDetailingMicroRipples: function (runtimeScene, behavior, detail, frequency) {
      var det = FluidAndWater3D.waterDetailingOf(runtimeScene, behavior);
      if (!det) return;
      det.microDetail = Math.max(0.0, numOrParse(detail, det.microDetail));
      det.microFrequency = clamp(numOrParse(frequency, det.microFrequency), 0.05, 10.0);
      det.preset = 'Custom';
      if (det.targetWaterBody && det.targetWaterBody.material) applyWaterDetailingToMaterial(det, det.targetWaterBody.material);
    },

    setWaterDetailingOpacity: function (runtimeScene, behavior, opacity) {
      var det = FluidAndWater3D.waterDetailingOf(runtimeScene, behavior);
      if (!det) return;
      det.opacity = clamp(numOrParse(opacity, 0.78), 0.0, 1.0);
      det.preset = 'Custom';
      if (det.targetWaterBody && det.targetWaterBody.material) applyWaterDetailingToMaterial(det, det.targetWaterBody.material);
    },

    getWaterDetailingOpacity: function (runtimeScene, behavior) {
      var det = FluidAndWater3D.waterDetailingOf(runtimeScene, behavior);
      return det ? det.opacity : 0.78;
    },

    setWaterDetailingSprayEnabled: function (runtimeScene, behavior, enabled) {
      var det = FluidAndWater3D.waterDetailingOf(runtimeScene, behavior);
      if (det) det.sprayEnabled = !!enabled;
    },

    isWaterDetailingSprayEnabled: function (runtimeScene, behavior) {
      var det = FluidAndWater3D.waterDetailingOf(runtimeScene, behavior);
      return det ? !!det.sprayEnabled : false;
    },

    setWaterDetailingSprayAmount: function (runtimeScene, behavior, amount) {
      var det = FluidAndWater3D.waterDetailingOf(runtimeScene, behavior);
      if (det) det.sprayAmount = clamp(numOrParse(amount, 0.5), 0.0, 1.0);
    },

    getWaterDetailingSprayAmount: function (runtimeScene, behavior) {
      var det = FluidAndWater3D.waterDetailingOf(runtimeScene, behavior);
      return det ? (det.sprayAmount !== undefined ? det.sprayAmount : 0.5) : 0.5;
    },

    setWaterDetailingSprayHeight: function (runtimeScene, behavior, height) {
      var det = FluidAndWater3D.waterDetailingOf(runtimeScene, behavior);
      if (det) det.sprayHeight = Math.max(0.0, numOrParse(height, 1.0));
    },

    getWaterDetailingSprayHeight: function (runtimeScene, behavior) {
      var det = FluidAndWater3D.waterDetailingOf(runtimeScene, behavior);
      return det ? (det.sprayHeight !== undefined ? det.sprayHeight : 1.0) : 1.0;
    },

    setWaterDetailingSprayThreshold: function (runtimeScene, behavior, threshold) {
      var det = FluidAndWater3D.waterDetailingOf(runtimeScene, behavior);
      if (det) det.sprayThreshold = clamp(numOrParse(threshold, 0.5), 0.0, 1.0);
    },

    getWaterDetailingSprayThreshold: function (runtimeScene, behavior) {
      var det = FluidAndWater3D.waterDetailingOf(runtimeScene, behavior);
      return det ? (det.sprayThreshold !== undefined ? det.sprayThreshold : 0.5) : 0.5;
    },

    setWaterDetailingAnisotropy: function (runtimeScene, behavior, level) {
      var det = FluidAndWater3D.waterDetailingOf(runtimeScene, behavior);
      if (!det) return;
      det.textureAnisotropy = parseAnisotropy(level, 4);
      if (det.targetWaterBody) {
        FluidAndWater3D.applyWaterDetailingAnisotropyToTarget(runtimeScene, det, det.targetWaterBody);
      }
    },

    getWaterDetailingAnisotropy: function (runtimeScene, behavior) {
      var det = FluidAndWater3D.waterDetailingOf(runtimeScene, behavior);
      var target = det && det.targetWaterBody;
      return target && target.slopeTexture ? (target.slopeTexture.anisotropy || 1) : 1;
    },

    getWaterDetailingMaxDeviceAnisotropy: function (runtimeScene) {
      return getRendererMaxAnisotropy(runtimeScene);
    },

    /* ========================================================= 1d. WaterStrengthSlider3D */

    registerWaterStrengthSlider: function (runtimeScene, object, behavior, options) {
      if (!runtimeScene || !object || !behavior) return null;
      var state = getSceneState(runtimeScene);
      options = options || {};

      var normalized = options.scaleMode === 'Normalized (0 - 1)';
      var initStr = clamp(numOrParse(options.strength, normalized ? 4.0 / 12.0 : 4.0),
        0.0, normalized ? 1.0 : 12.0);

      var slider = {
        object: object,
        behavior: behavior,
        targetWaterBodyName: options.targetWaterBody || '',
        targetWaterBody: null,
        scaleMode: options.scaleMode || 'Beaufort (0 - 12)',
        strength: initStr,
        currentStrength: normalized ? initStr * 12.0 : initStr,
        lastAppliedTarget: null,
        lastAppliedStrength: null,
        smoothDamping: Math.max(0.0, (typeof options.smoothDamping === 'number' && isFinite(options.smoothDamping))
          ? options.smoothDamping
          : (parseFloat(options.smoothDamping) || 0.0)),
      };

      state.waterStrengthSliders.push(slider);
      return slider;
    },

    waterStrengthSliderOf: function (runtimeScene, behavior) {
      if (!runtimeScene || !behavior) return null;
      var state = getSceneState(runtimeScene);
      return state.waterStrengthSliders.find(function (s) { return s.behavior === behavior; }) || null;
    },

    disposeWaterStrengthSlider: function (runtimeScene, behavior) {
      if (!runtimeScene || !behavior) return;
      var state = getSceneState(runtimeScene);
      var idx = state.waterStrengthSliders.findIndex(function (s) { return s.behavior === behavior; });
      if (idx !== -1) {
        state.waterStrengthSliders.splice(idx, 1);
      }
    },

    stepWaterStrengthSlider: function (runtimeScene, object, behavior) {
      if (!runtimeScene || !behavior) return;
      var slider = FluidAndWater3D.waterStrengthSliderOf(runtimeScene, behavior);
      if (!slider) return;

      var state = getSceneState(runtimeScene);
      var dt = getDeltaSeconds(runtimeScene);

      // Target strength in Beaufort scale (0 - 12)
      var targetVal = slider.strength;
      if (slider.scaleMode === 'Normalized (0 - 1)') {
        targetVal = clamp(targetVal, 0.0, 1.0) * 12.0;
      } else {
        targetVal = clamp(targetVal, 0.0, 12.0);
      }

      if (slider.smoothDamping > 0.001) {
        var alpha = Math.min(1.0, dt / slider.smoothDamping);
        slider.currentStrength += (targetVal - slider.currentStrength) * alpha;
        if (Math.abs(targetVal - slider.currentStrength) < 0.0001) slider.currentStrength = targetVal;
      } else {
        slider.currentStrength = targetVal;
      }

      var bVal = slider.currentStrength;

      // Locate target
      var target = slider.targetWaterBody;
      if (target && state.oceans.indexOf(target) === -1 && state.waterBodies.indexOf(target) === -1) target = null;
      if (!target || !target.object) {
        if (slider.targetWaterBodyName) {
          for (var oi = 0; oi < state.oceans.length; oi++) {
            if (state.oceans[oi].object && state.oceans[oi].object.getName &&
                state.oceans[oi].object.getName() === slider.targetWaterBodyName) {
              target = state.oceans[oi];
              break;
            }
          }
          if (!target) {
            for (var bi = 0; bi < state.waterBodies.length; bi++) {
              if (state.waterBodies[bi].object && state.waterBodies[bi].object.getName &&
                  state.waterBodies[bi].object.getName() === slider.targetWaterBodyName) {
                target = state.waterBodies[bi];
                break;
              }
            }
          }
        }
        if (!target) {
          target = FluidAndWater3D.findWaterBodyForObject(state, object);
        }
        if (!target) {
          target = state.oceans.length ? state.oceans[0] : (state.waterBodies.length ? state.waterBodies[0] : null);
        }
        slider.targetWaterBody = target;
      }

      if (!target) return;

      if (slider.lastAppliedTarget === target && slider.lastAppliedStrength === bVal) return;
      slider.lastAppliedTarget = target;
      slider.lastAppliedStrength = bVal;

      if (target.isWaveWorks) {
        FluidAndWater3D.setWaveWorksBeaufort(runtimeScene, target.behavior, bVal);
      } else if (target.isOctaveSum || target.waveChoppiness !== undefined) {
        var fracWB = bVal / 12.0;
        var hWB = fracWB * 45.0;
        var chopWB = fracWB * 1.2;
        target.waveHeight = hWB;
        target.waveChoppiness = chopWB;
        if (target.material && target.material.uniforms) {
          if (target.material.uniforms.u_WaveHeight) target.material.uniforms.u_WaveHeight.value = hWB;
          if (target.material.uniforms.u_WaveChoppiness) target.material.uniforms.u_WaveChoppiness.value = chopWB;
        }
      }
    },

    setWaterStrength: function (runtimeScene, behavior, val) {
      var s = FluidAndWater3D.waterStrengthSliderOf(runtimeScene, behavior);
      if (s) s.strength = typeof val === 'number' ? val : (parseFloat(val) || 0.0);
    },

    getWaterStrength: function (runtimeScene, behavior) {
      var s = FluidAndWater3D.waterStrengthSliderOf(runtimeScene, behavior);
      return s ? (s.scaleMode === 'Normalized (0 - 1)' ? s.currentStrength / 12.0 : s.currentStrength) : 4.0;
    },

    setWaterStrengthNormalized: function (runtimeScene, behavior, val) {
      var s = FluidAndWater3D.waterStrengthSliderOf(runtimeScene, behavior);
      if (!s) return;
      var num = typeof val === 'number' ? val : (parseFloat(val) || 0.0);
      if (s.scaleMode === 'Normalized (0 - 1)') {
        s.strength = clamp(num, 0.0, 1.0);
      } else {
        s.strength = clamp(num, 0.0, 1.0) * 12.0;
      }
    },

    getWaterStrengthNormalized: function (runtimeScene, behavior) {
      var s = FluidAndWater3D.waterStrengthSliderOf(runtimeScene, behavior);
      return s ? clamp(s.currentStrength / 12.0, 0.0, 1.0) : 0.333;
    },

    setWaterStrengthDamping: function (runtimeScene, behavior, val) {
      var s = FluidAndWater3D.waterStrengthSliderOf(runtimeScene, behavior);
      if (s) s.smoothDamping = Math.max(0.0, typeof val === 'number' ? val : (parseFloat(val) || 0.0));
    },

    getWaterStrengthDamping: function (runtimeScene, behavior) {
      var s = FluidAndWater3D.waterStrengthSliderOf(runtimeScene, behavior);
      return s ? s.smoothDamping : 0.0;
    },

    setWaterStrengthTargetBody: function (runtimeScene, behavior, name) {
      var s = FluidAndWater3D.waterStrengthSliderOf(runtimeScene, behavior);
      if (s) {
        s.targetWaterBodyName = String(name || '');
        s.targetWaterBody = null;
      }
    },

    getWaterStrengthTargetBody: function (runtimeScene, behavior) {
      var s = FluidAndWater3D.waterStrengthSliderOf(runtimeScene, behavior);
      return s ? s.targetWaterBodyName : '';
    },

    getWaterStrengthBeaufortLabel: function (runtimeScene, behavior) {
      var s = FluidAndWater3D.waterStrengthSliderOf(runtimeScene, behavior);
      var b = s ? s.currentStrength : 4.0;
      return beaufortLabel(b);
    },

    getWaterStrengthBeaufortRungName: function (runtimeScene, behavior) {
      var s = FluidAndWater3D.waterStrengthSliderOf(runtimeScene, behavior);
      var b = s ? Math.max(0, Math.min(12, Math.round(s.currentStrength))) : 4;
      return BEAUFORT_RUNG_NAMES[b] || 'Moderate Breeze';
    },

    getWaterStrengthWindSpeed: function (runtimeScene, behavior) {
      var s = FluidAndWater3D.waterStrengthSliderOf(runtimeScene, behavior);
      var b = s ? s.currentStrength : 4.0;
      var prof = beaufortAt(b);
      return prof ? prof.windSpeed : 7.0;
    },

    isWaterStrengthCalm: function (runtimeScene, behavior) {
      var s = FluidAndWater3D.waterStrengthSliderOf(runtimeScene, behavior);
      return s ? (s.currentStrength < 1.0) : false;
    },

    isWaterStrengthStormy: function (runtimeScene, behavior) {
      var s = FluidAndWater3D.waterStrengthSliderOf(runtimeScene, behavior);
      return s ? (s.currentStrength >= 8.0) : false;
    },

    /* ========================================================= 2. Buoyancy3D */

    registerBuoyancy: function (runtimeScene, object, behavior, options) {
      if (!runtimeScene || !object || !behavior) return null;
      var state = getSceneState(runtimeScene);

      var buoy = {
        object: object,
        behavior: behavior,
        physics3D: (options && (options.physics3D || options.physics3DBehaviorName)) || 'Physics3D',
        buoyancyFactor: num(options.buoyancyFactor, 1.0),
        hullProbeCount: options.hullProbeCount || '4-Corners',
        fluidDrag: num(options.fluidDrag, 2.0),
        waveInfluence: num(options.waveInfluence, 0.8),
        stabilityStrength: num(options.stabilityStrength, 0.65),
        stabilityDamping: num(options.stabilityDamping, 1.5),
        maxSubmersionDepth: Math.max(num(options.maxSubmersionDepth, 0.0), 0.0),
        targetWaterBody: options.targetWaterBody || '',
        enabled: options.enabled !== undefined ? !!options.enabled : true,
        isFloating: false,
        isSubmerged: false,
        lastForce: 0.0,
        submersionDepth: 0.0,
        hooked: false,
        hook: null
      };

      buoy.hook = {
        doBeforePhysicsStep: function (dt) {
          if (!buoy.enabled) return;
          FluidAndWater3D.stepBuoyancy(runtimeScene, object, behavior, dt, true);
        }
      };

      state.buoyantObjects.push(buoy);
      return buoy;
    },

    buoyancyOf: function (runtimeScene, behavior) {
      if (!runtimeScene || !behavior) return null;
      var state = getSceneState(runtimeScene);
      return state.buoyantObjects.find(function (b) { return b.behavior === behavior; }) || null;
    },

    resetBuoyancyState: function (buoy) {
      if (!buoy) return;
      buoy.isFloating = false;
      buoy.isSubmerged = false;
      buoy.lastForce = 0.0;
      buoy.submersionDepth = 0.0;
    },

    /** True when two GDevelop objects overlap in XY on the same layer. */
    waterVolumeOverlapsXY: function (waterObject, object) {
      if (!waterObject || !object) return false;
      if (objectLayerName(waterObject) !== objectLayerName(object)) return false;

      var ax = waterObject.getX ? waterObject.getX() : 0;
      var ay = waterObject.getY ? waterObject.getY() : 0;
      var aw = (waterObject.getWidth && waterObject.getWidth() > 0) ? waterObject.getWidth() : 0;
      var ah = (waterObject.getHeight && waterObject.getHeight() > 0) ? waterObject.getHeight() : 0;
      var bx = object.getX ? object.getX() : 0;
      var by = object.getY ? object.getY() : 0;
      var bw = (object.getWidth && object.getWidth() > 0) ? object.getWidth() : 0;
      var bh = (object.getHeight && object.getHeight() > 0) ? object.getHeight() : 0;
      if (aw <= 0 || ah <= 0 || bw <= 0 || bh <= 0) return false;
      return bx + bw >= ax && bx <= ax + aw && by + bh >= ay && by <= ay + ah;
    },

    /**
     * Resolves only a water body whose volume actually overlaps this object. A named target is a
     * strict filter: being registered is not enough, and an absent target never falls back to a
     * different water body.
     */
    resolveWaterBodyFor: function (state, buoy, object) {
      if (!state.waterBodies.length) return null;
      for (var i = 0; i < state.waterBodies.length; i++) {
        var wb = state.waterBodies[i];
        var o = wb.object;
        if (!o) continue;
        if (buoy.targetWaterBody &&
            (!(typeof o.getName === 'function') || o.getName() !== buoy.targetWaterBody)) continue;
        if (FluidAndWater3D.waterVolumeOverlapsXY(o, object)) return wb;
      }
      return null;
    },

    /** Ocean equivalent of resolveWaterBodyFor, with the same strict overlap rules. */
    resolveOceanFor: function (state, buoy, object) {
      if (!state.oceans.length) return null;
      for (var i = 0; i < state.oceans.length; i++) {
        var ocean = state.oceans[i];
        var o = ocean.object;
        if (!o) continue;
        if (buoy.targetWaterBody &&
            (!(typeof o.getName === 'function') || o.getName() !== buoy.targetWaterBody)) continue;
        if (FluidAndWater3D.waterVolumeOverlapsXY(o, object)) return ocean;
      }
      return null;
    },

    /** Locates a Physics3D behavior on the object regardless of the name it was given in the editor. */
    findPhysics3D: function (object, preferredName) {
      if (!object || typeof object.getBehavior !== 'function') return null;
      if (preferredName) {
        var pb = object.getBehavior(preferredName);
        if (pb && (typeof pb.applyImpulse === 'function' || typeof pb.applyForce === 'function')) return pb;
      }
      var named = ['Physics3D', '3DPhysics', 'Physics3DBehavior'];
      for (var i = 0; i < named.length; i++) {
        var b = object.getBehavior(named[i]);
        if (b && (typeof b.applyImpulse === 'function' || typeof b.applyForce === 'function')) return b;
      }
      // Renamed behavior: scan the instance's behavior table for the Physics3D surface.
      var table = object._behaviors;
      if (Array.isArray(table)) {
        for (var j = 0; j < table.length; j++) {
          var cand = table[j];
          if (cand && (typeof cand.applyImpulse === 'function' || typeof cand.applyForce === 'function') && typeof cand.getMass === 'function') {
            return cand;
          }
        }
      }
      return null;
    },

    /**
     * Rotates a 3D vector by a quaternion q = (x, y, z, w).
     */
    rotateVec3ByQuat: function (v, q) {
      var vx = v.x !== undefined ? v.x : (v.rx !== undefined ? v.rx : 0);
      var vy = v.y !== undefined ? v.y : (v.ry !== undefined ? v.ry : 0);
      var vz = v.z !== undefined ? v.z : (v.rz !== undefined ? v.rz : 0);
      var qx = q.x || 0, qy = q.y || 0, qz = q.z || 0, qw = q.w !== undefined ? q.w : 1;
      var tx = 2 * (qy * vz - qz * vy);
      var ty = 2 * (qz * vx - qx * vz);
      var tz = 2 * (qx * vy - qy * vx);
      return {
        x: vx + qw * tx + (qy * tz - qz * ty),
        y: vy + qw * ty + (qz * tx - qx * tz),
        z: vz + qw * tz + (qx * ty - qy * tx)
      };
    },

    /**
     * Builds local probe offsets centered at hull bottom.
     */
    getHullProbes: function (width, height, depth, countMode) {
      var probes = [];
      var kz = -depth * 0.5;
      if (countMode === '1-Center') {
        probes.push({ rx: 0, ry: 0, rz: kz });
      } else if (countMode === '8-HullBox') {
        var hx8 = width * 0.45, hy8 = height * 0.45;
        probes.push(
          { rx: -hx8, ry: -hy8, rz: kz }, { rx: hx8, ry: -hy8, rz: kz },
          { rx: hx8, ry:  hy8, rz: kz }, { rx: -hx8, ry:  hy8, rz: kz },
          { rx: 0,    ry: -hy8, rz: kz }, { rx: 0,    ry:  hy8, rz: kz },
          { rx: -hx8, ry: 0,    rz: kz }, { rx: hx8, ry: 0,    rz: kz }
        );
      } else {
        var hx4 = width * 0.4, hy4 = height * 0.4;
        probes.push(
          { rx: -hx4, ry: -hy4, rz: kz },
          { rx:  hx4, ry: -hy4, rz: kz },
          { rx:  hx4, ry:  hy4, rz: kz },
          { rx: -hx4, ry:  hy4, rz: kz }
        );
      }
      return probes;
    },

    /**
     * Calculates a per-probe vertical force pair that rights roll/pitch while preserving yaw.
     * Applying the values at the existing hull probes works with the public Physics3D/Jolt force
     * API, so no private Jolt body or applyTorque method is required.
     */
    getHullRightingForces: function (probes, q, mass, worldScale, angX, angY, waterNormal, buoy) {
      var result = new Array(probes.length).fill(0.0);
      var strength = clamp(num(buoy.stabilityStrength, 0.65), 0.0, 4.0);
      var damping = clamp(num(buoy.stabilityDamping, 1.5), 0.0, 10.0);
      if (strength <= 0.0 || mass <= 0.0 || probes.length < 2) return result;

      var currentUp = FluidAndWater3D.rotateVec3ByQuat({ x: 0, y: 0, z: 1 }, q);
      var follow = clamp(num(buoy.waveInfluence, 0.8), 0.0, 1.0);
      var normal = waterNormal || { x: 0, y: 0, z: 1 };
      var dx = normal.x * follow;
      var dy = normal.y * follow;
      var dz = lerp(1.0, normal.z, follow);
      var dLen = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1.0;
      dx /= dLen; dy /= dLen; dz /= dLen;

      // cross(currentUp, desiredUp) is the shortest restoring rotation in world space.
      var errX = currentUp.y * dz - currentUp.z * dy;
      var errY = currentUp.z * dx - currentUp.x * dz;
      var scale = worldScale > 0 ? worldScale : 100.0;
      var rotated = [];
      var meanX = 0.0, meanY = 0.0;
      for (var i = 0; i < probes.length; i++) {
        var r = FluidAndWater3D.rotateVec3ByQuat(probes[i], q);
        var rx = r.x / scale, ry = r.y / scale;
        rotated.push({ x: rx, y: ry });
        meanX += rx;
        meanY += ry;
      }
      meanX /= probes.length;
      meanY /= probes.length;
      var sumX2 = 0.0, sumY2 = 0.0;
      for (var ri = 0; ri < rotated.length; ri++) {
        // The force pair must be centered on the probe footprint. A tilted hull's bottom plane is
        // horizontally offset from its centre; using that common offset would add unwanted lift.
        rotated[ri].x -= meanX;
        rotated[ri].y -= meanY;
        sumX2 += rotated[ri].x * rotated[ri].x;
        sumY2 += rotated[ri].y * rotated[ri].y;
      }
      var lever = Math.sqrt((sumX2 + sumY2) / Math.max(probes.length, 1));
      if (lever < 0.001) return result;

      var torqueScale = mass * GRAVITY * lever * strength;
      var inertiaScale = mass * lever * lever * damping;
      var torqueX = torqueScale * errX - inertiaScale * angX;
      var torqueY = torqueScale * errY - inertiaScale * angY;
      var maxPerProbe = mass * GRAVITY * (0.75 + strength) / probes.length;
      for (var j = 0; j < rotated.length; j++) {
        var fz = 0.0;
        if (sumY2 > 0.000001) fz += torqueX * rotated[j].y / sumY2;
        if (sumX2 > 0.000001) fz -= torqueY * rotated[j].x / sumX2;
        result[j] = clamp(fz, -maxPerProbe, maxPerProbe);
      }
      return result;
    },

    stepBuoyancy: function (runtimeScene, object, behavior, stepDt, fromPhysicsHook) {
      var buoy = FluidAndWater3D.buoyancyOf(runtimeScene, behavior);
      if (!buoy) return;
      if (!buoy.enabled) {
        FluidAndWater3D.resetBuoyancyState(buoy);
        return;
      }

      var phys3d = FluidAndWater3D.findPhysics3D(object, buoy.physics3D);
      // Guarded: a Physics3D build without the hook API must fall through to the per-frame path
      // rather than throwing and taking the whole behavior down.
      if (phys3d && phys3d._sharedData &&
          typeof phys3d._sharedData.registerHook === 'function' && !buoy.hooked) {
        phys3d._sharedData.registerHook(buoy.hook);
        buoy.hooked = true;
      }

      // When Physics3D is active and has registered the hook with Jolt, skip regular doStepPreEvents
      // so physical forces are evaluated directly inside Jolt's doBeforePhysicsStep pre-step.
      if (phys3d && buoy.hooked && !fromPhysicsHook) {
        return;
      }

      var state = getSceneState(runtimeScene);

      // An overlapping OceanFFT3D body takes precedence. A distant ocean must not hijack a
      // nearby WaterBody3D (or keep an object floating in empty space).
      var ocean = FluidAndWater3D.resolveOceanFor(state, buoy, object);
      if (ocean) {
        FluidAndWater3D.stepBuoyancyOnOcean(runtimeScene, object, behavior, buoy, state, stepDt, ocean);
        return;
      }

      var waterBody = FluidAndWater3D.resolveWaterBodyFor(state, buoy, object);
      if (!waterBody || !waterBody.object) {
        FluidAndWater3D.resetBuoyancyState(buoy);
        return;
      }

      var dt = (stepDt !== undefined && stepDt > 0) ? stepDt : (getDeltaSeconds(runtimeScene) * state.timeScale);
      if (state.paused || dt <= 0) return;

      var objX = object.getX ? object.getX() : 0;
      var objY = object.getY ? object.getY() : 0;
      var objZ = object.getZ ? object.getZ() : 0;
      var width = (object.getWidth && object.getWidth() > 0) ? object.getWidth() : 50;
      var height = (object.getHeight && object.getHeight() > 0) ? object.getHeight() : 50;
      var depth = (object.getDepth && object.getDepth() > 0) ? object.getDepth() : 50;

      var cx = objX + width * 0.5;
      var cy = objY + height * 0.5;
      var cz = objZ + depth * 0.5;

      var wbObj = waterBody.object;
      var waterBottomZ = wbObj.getZ ? wbObj.getZ() : 0.0;
      var waterTopZ = (wbObj.getZ ? wbObj.getZ() : 0.0) +
        ((wbObj.getDepth && wbObj.getDepth() > 0) ? wbObj.getDepth() : 0.0);

      // Buoyancy is a water-volume effect, not an infinite column below the surface.
      if (objZ + depth <= waterBottomZ) {
        FluidAndWater3D.resetBuoyancyState(buoy);
        return;
      }

      var waveCfg = waveConfigOf(waterBody, waterTopZ);
      var probes = FluidAndWater3D.getHullProbes(width, height, depth, buoy.hullProbeCount);
      var probeCount = probes.length;
      // A blank / zero MaxSubmersionDepth scales to the hull itself: full buoyant force once half
      // the hull is under. GDevelop 3D is pixel-scale (~100 units per metre), so a fixed
      // metre-sized default made every boat reach full lift a couple of pixels in — it rode ON the
      // water, and the resulting spring was far too stiff for the default FluidDrag to damp.
      var maxSub = buoy.maxSubmersionDepth > 0 ? buoy.maxSubmersionDepth : Math.max(depth * 0.5, 1.0);

      // phys3d was already resolved above WITH buoy.physics3D. Re-resolving here without that
      // name once picked a different physics-like behavior than the one the hook was registered
      // against, on an object carrying more than one.
      var mass = 0.0;
      if (phys3d && typeof phys3d.getMass === 'function') {
        try { mass = phys3d.getMass() || 0.0; } catch (e) { mass = 0.0; }
      }

      var velX = 0.0, velY = 0.0, velZ = 0.0;
      if (phys3d && typeof phys3d.getLinearVelocityZ === 'function') {
        try {
          velX = phys3d.getLinearVelocityX();
          velY = phys3d.getLinearVelocityY();
          velZ = phys3d.getLinearVelocityZ();
        } catch (e) {}
      }

      var angX = 0.0, angY = 0.0, angZ = 0.0;
      if (phys3d && typeof phys3d.getAngularVelocityZ === 'function') {
        try {
          angX = (phys3d.getAngularVelocityX() || 0.0) * (Math.PI / 180);
          angY = (phys3d.getAngularVelocityY() || 0.0) * (Math.PI / 180);
          angZ = (phys3d.getAngularVelocityZ() || 0.0) * (Math.PI / 180);
        } catch (e) {}
      }

      // Physics3D reports linear velocity in SCENE UNITS per second (it multiplies Jolt's m/s by
      // worldScale), while mass is in kilograms. Feeding px/s straight into a kg-based drag term
      // gives a force worldScale times too large — at the default 100 px/m that dwarfed buoyancy
      // and launched hulls out of the scene. Convert to m/s before the drag coefficient sees it.
      var worldScale = 100.0;
      if (phys3d && phys3d._sharedData && phys3d._sharedData.worldScale > 0) {
        worldScale = phys3d._sharedData.worldScale;
      }
      var invWorldScale = 1.0 / worldScale;

      var q = { x: 0, y: 0, z: 0, w: 1 };
      if (object.get3DRendererObject && object.get3DRendererObject()) {
        var rObj = object.get3DRendererObject();
        if (rObj.quaternion) {
          q.x = rObj.quaternion.x;
          q.y = rObj.quaternion.y;
          q.z = rObj.quaternion.z;
          q.w = rObj.quaternion.w;
        }
      }

      var waterNormal = evaluateGerstnerNormal(cx, cy, state.time, waveCfg);
      var rightingForces = FluidAndWater3D.getHullRightingForces(
        probes, q, mass, worldScale, angX, angY, waterNormal, buoy);

      var totalSubmersion = 0.0;
      var submergedProbes = 0;
      var sumSurfZ = 0.0;

      for (var i = 0; i < probeCount; i++) {
        var rWorld = FluidAndWater3D.rotateVec3ByQuat(probes[i], q);
        var px = cx + rWorld.x;
        var py = cy + rWorld.y;
        var pz = cz + rWorld.z;

        var shore = waterEdgeInfluenceAt(state, px, py, waterBody.layerName, waterTopZ,
          waterSpanOf(waterBody));
        var surfZ = waterTopZ +
          (evaluateGerstnerDisplacement(px, py, state.time, waveCfg) +
            interactionDisplacementAt(waterBody, px, py, state.time)) * shore.attenuation;
        sumSurfZ += surfZ;

        var sub = clamp(surfZ - pz, 0.0, maxSub);
        if (sub > 0.0) {
          totalSubmersion += sub;
          submergedProbes++;
        }

        if (phys3d && mass > 0.0 && sub > 0.0) {
          var frac = sub / maxSub;
          var fUp = (mass * GRAVITY * buoy.buoyancyFactor * frac) / probeCount;

          // Point velocity including rigid body angular rotation
          var rotVx = angY * rWorld.z - angZ * rWorld.y;
          var rotVy = angZ * rWorld.x - angX * rWorld.z;
          var rotVz = angX * rWorld.y - angY * rWorld.x;

          var ptVx = velX + rotVx;
          var ptVy = velY + rotVy;
          var ptVz = velZ + rotVz;

          var waveVel = evaluateWaveVelocity(px, py, state.time, waveCfg);
          waveVel.x *= shore.attenuation;
          waveVel.y *= shore.attenuation;
          waveVel.z *= shore.attenuation;
          // Scene units per second -> metres per second, so kg-based drag yields Newtons.
          var rvx = (ptVx - waveVel.x * buoy.waveInfluence) * invWorldScale;
          var rvy = (ptVy - waveVel.y * buoy.waveInfluence) * invWorldScale;
          var rvz = (ptVz - waveVel.z * buoy.waveInfluence) * invWorldScale;

          var dragK = (buoy.fluidDrag * mass * frac) / probeCount;
          var fdx = -dragK * rvx;
          var fdy = -dragK * rvy;
          var fdz = -dragK * rvz;

          var totalFx = fdx;
          var totalFy = fdy;
          // Fade righting torque in with contact so a grazing probe cannot violently snap a hull.
          var totalFz = fUp + fdz + rightingForces[i] * clamp(frac * 2.0, 0.0, 1.0);

          if (typeof phys3d.applyForce === 'function') {
            phys3d.applyForce(totalFx, totalFy, totalFz, px, py, pz);
          } else {
            phys3d.applyImpulse(totalFx * dt, totalFy * dt, totalFz * dt, px, py, pz);
          }
        }
      }

      if (submergedProbes === 0) {
        FluidAndWater3D.resetBuoyancyState(buoy);
        return;
      }

      buoy.submersionDepth = totalSubmersion / probeCount;
      buoy.isFloating = true;
      buoy.isSubmerged = submergedProbes === probeCount && (sumSurfZ / probeCount) >= (objZ + depth);
      buoy.lastForce = (mass > 0.0 ? mass : 1.0) * GRAVITY * buoy.buoyancyFactor *
        clamp(buoy.submersionDepth / maxSub, 0.0, 1.0);

      if (phys3d && mass > 0.0) return;

      // Kinematic fallback
      if (!object.setZ) return;
      var targetZ = (sumSurfZ / probeCount) - depth * 0.3;
      var blend = clamp(0.15 * buoy.waveInfluence * (dt / 0.016), 0.0, 1.0);
      object.setZ(lerp(object.getZ(), targetZ, blend));

      if (object.setRotationX && object.setRotationY) {
        var normal = waterNormal;
        var pitchDeg = (-normal.y * 35.0) * buoy.waveInfluence;
        var rollDeg = (normal.x * 35.0) * buoy.waveInfluence;
        var rotBlend = clamp((0.04 + 0.08 * buoy.stabilityStrength +
          0.02 * buoy.stabilityDamping) * (dt / 0.016), 0.0, 1.0);
        object.setRotationX(lerp(object.getRotationX ? object.getRotationX() : 0.0, pitchDeg, rotBlend));
        object.setRotationY(lerp(object.getRotationY ? object.getRotationY() : 0.0, rollDeg, rotBlend));
      }
    },

    /** Buoyancy against a Tessendorf field with full Jolt 3D orientation & angular point velocity. */
    stepBuoyancyOnOcean: function (runtimeScene, object, behavior, buoy, state, stepDt, selectedOcean) {
      var dt = (stepDt !== undefined && stepDt > 0) ? stepDt : (getDeltaSeconds(runtimeScene) * state.timeScale);
      if (state.paused || dt <= 0) return;

      var objX = object.getX ? object.getX() : 0;
      var objY = object.getY ? object.getY() : 0;
      var objZ = object.getZ ? object.getZ() : 0;
      var width = (object.getWidth && object.getWidth() > 0) ? object.getWidth() : 50;
      var height = (object.getHeight && object.getHeight() > 0) ? object.getHeight() : 50;
      var depth = (object.getDepth && object.getDepth() > 0) ? object.getDepth() : 50;

      var cx = objX + width * 0.5;
      var cy = objY + height * 0.5;
      var cz = objZ + depth * 0.5;

      var ocean = selectedOcean || FluidAndWater3D.resolveOceanFor(state, buoy, object);
      if (!ocean || !ocean.object) {
        FluidAndWater3D.resetBuoyancyState(buoy);
        return;
      }

      var probes = FluidAndWater3D.getHullProbes(width, height, depth, buoy.hullProbeCount);
      var probeCount = probes.length;

      var oo = ocean.object;
      var waterBottomZ = oo.getZ ? oo.getZ() : 0;
      var waterTopZ = (oo.getZ ? oo.getZ() : 0) + ((oo.getDepth && oo.getDepth() > 0) ? oo.getDepth() : 0);
      if (objZ + depth <= waterBottomZ) {
        FluidAndWater3D.resetBuoyancyState(buoy);
        return;
      }
      // A blank / zero MaxSubmersionDepth scales to the hull itself: full buoyant force once half
      // the hull is under. GDevelop 3D is pixel-scale (~100 units per metre), so a fixed
      // metre-sized default made every boat reach full lift a couple of pixels in — it rode ON the
      // water, and the resulting spring was far too stiff for the default FluidDrag to damp.
      var maxSub = buoy.maxSubmersionDepth > 0 ? buoy.maxSubmersionDepth : Math.max(depth * 0.5, 1.0);

      var phys3d = FluidAndWater3D.findPhysics3D(object, buoy.physics3D);
      var mass = 0.0;
      if (phys3d && typeof phys3d.getMass === 'function') {
        try { mass = phys3d.getMass() || 0.0; } catch (e) { mass = 0.0; }
      }
      var velX = 0.0, velY = 0.0, velZ = 0.0;
      if (phys3d && typeof phys3d.getLinearVelocityZ === 'function') {
        try {
          velX = phys3d.getLinearVelocityX();
          velY = phys3d.getLinearVelocityY();
          velZ = phys3d.getLinearVelocityZ();
        } catch (e) {}
      }
      var angX = 0.0, angY = 0.0, angZ = 0.0;
      if (phys3d && typeof phys3d.getAngularVelocityZ === 'function') {
        try {
          angX = (phys3d.getAngularVelocityX() || 0.0) * (Math.PI / 180);
          angY = (phys3d.getAngularVelocityY() || 0.0) * (Math.PI / 180);
          angZ = (phys3d.getAngularVelocityZ() || 0.0) * (Math.PI / 180);
        } catch (e) {}
      }

      // Physics3D reports linear velocity in SCENE UNITS per second (it multiplies Jolt's m/s by
      // worldScale), while mass is in kilograms. Feeding px/s straight into a kg-based drag term
      // gives a force worldScale times too large — at the default 100 px/m that dwarfed buoyancy
      // and launched hulls out of the scene. Convert to m/s before the drag coefficient sees it.
      var worldScale = 100.0;
      if (phys3d && phys3d._sharedData && phys3d._sharedData.worldScale > 0) {
        worldScale = phys3d._sharedData.worldScale;
      }
      var invWorldScale = 1.0 / worldScale;

      var q = { x: 0, y: 0, z: 0, w: 1 };
      if (object.get3DRendererObject && object.get3DRendererObject()) {
        var rObj = object.get3DRendererObject();
        if (rObj.quaternion) {
          q.x = rObj.quaternion.x;
          q.y = rObj.quaternion.y;
          q.z = rObj.quaternion.z;
          q.w = rObj.quaternion.w;
        }
      }

      var normalSample = Math.max(width, height) * 0.25;
      var normalHx = FluidAndWater3D.getOceanWaveHeightAt(runtimeScene, ocean.behavior,
        cx + normalSample, cy) - FluidAndWater3D.getOceanWaveHeightAt(runtimeScene,
        ocean.behavior, cx - normalSample, cy);
      var normalHy = FluidAndWater3D.getOceanWaveHeightAt(runtimeScene, ocean.behavior,
        cx, cy + normalSample) - FluidAndWater3D.getOceanWaveHeightAt(runtimeScene,
        ocean.behavior, cx, cy - normalSample);
      var waterNormal = {
        x: -normalHx / (2 * normalSample),
        y: -normalHy / (2 * normalSample),
        z: 1.0
      };
      var normalLen = Math.sqrt(waterNormal.x * waterNormal.x + waterNormal.y * waterNormal.y + 1.0);
      waterNormal.x /= normalLen; waterNormal.y /= normalLen; waterNormal.z /= normalLen;
      var rightingForces = FluidAndWater3D.getHullRightingForces(
        probes, q, mass, worldScale, angX, angY, waterNormal, buoy);

      var totalSubmersion = 0.0, submergedProbes = 0, sumSurfZ = 0.0;

      for (var i = 0; i < probeCount; i++) {
        var rWorld = FluidAndWater3D.rotateVec3ByQuat(probes[i], q);
        var px = cx + rWorld.x;
        var py = cy + rWorld.y;
        var pz = cz + rWorld.z;

        var shore = waterEdgeInfluenceAt(state, px, py, ocean.layerName, waterTopZ,
          waterSpanOf(ocean));
        var waveH = (ocean.isWaveWorks && ocean.field1)
          ? (ocean.field.sampleHeight(px, py) + (ocean.cascadeWeight !== undefined ? ocean.cascadeWeight : 0.65) * ocean.field1.sampleHeight(px, py))
          : ocean.field.sampleHeight(px, py);
        var surfZ = waterTopZ + (waveH +
          interactionDisplacementAt(ocean, px, py, state.time)) * shore.attenuation;
        sumSurfZ += surfZ;

        var sub = clamp(surfZ - pz, 0.0, maxSub);
        if (sub > 0.0) { totalSubmersion += sub; submergedProbes++; }

        if (phys3d && mass > 0.0 && sub > 0.0) {
          var frac = sub / maxSub;
          var fUp = (mass * GRAVITY * buoy.buoyancyFactor * frac) / probeCount;

          var rotVx = angY * rWorld.z - angZ * rWorld.y;
          var rotVy = angZ * rWorld.x - angX * rWorld.z;
          var rotVz = angX * rWorld.y - angY * rWorld.x;

          var ptVx = velX + rotVx;
          var ptVy = velY + rotVy;
          var ptVz = velZ + rotVz;

          var dragK = (buoy.fluidDrag * mass * frac) / probeCount;
          // Scene units per second -> metres per second, as above.
          var fdx = -dragK * ptVx * invWorldScale;
          var fdy = -dragK * ptVy * invWorldScale;
          var fdz = -dragK * ptVz * invWorldScale;

          var totalFx = fdx;
          var totalFy = fdy;
          var totalFz = fUp + fdz + rightingForces[i] * clamp(frac * 2.0, 0.0, 1.0);

          if (typeof phys3d.applyForce === 'function') {
            phys3d.applyForce(totalFx, totalFy, totalFz, px, py, pz);
          } else {
            phys3d.applyImpulse(totalFx * dt, totalFy * dt, totalFz * dt, px, py, pz);
          }
        }
      }

      if (submergedProbes === 0) {
        FluidAndWater3D.resetBuoyancyState(buoy);
        return;
      }

      buoy.submersionDepth = totalSubmersion / probeCount;
      buoy.isFloating = true;
      buoy.isSubmerged = submergedProbes === probeCount && (sumSurfZ / probeCount) >= (objZ + depth);
      buoy.lastForce = (mass > 0.0 ? mass : 1.0) * GRAVITY * buoy.buoyancyFactor *
        clamp(buoy.submersionDepth / maxSub, 0.0, 1.0);

      if (phys3d && mass > 0.0) return;
      if (!object.setZ) return;

      var targetZ = (sumSurfZ / probeCount) - depth * 0.3;
      var blend = clamp(0.15 * buoy.waveInfluence * (dt / 0.016), 0.0, 1.0);
      object.setZ(lerp(object.getZ(), targetZ, blend));

      if (object.setRotationX && object.setRotationY) {
        var s = normalSample;
        var hx = normalHx;
        var hy = normalHy;
        var rotBlend = clamp((0.04 + 0.08 * buoy.stabilityStrength +
          0.02 * buoy.stabilityDamping) * (dt / 0.016), 0.0, 1.0);
        object.setRotationX(lerp(object.getRotationX ? object.getRotationX() : 0,
          -Math.atan2(hy, 2 * s) * 180 / Math.PI * buoy.waveInfluence, rotBlend));
        object.setRotationY(lerp(object.getRotationY ? object.getRotationY() : 0,
          Math.atan2(hx, 2 * s) * 180 / Math.PI * buoy.waveInfluence, rotBlend));
      }
    },

    disposeBuoyancy: function (runtimeScene, behavior) {
      if (!runtimeScene || !behavior) return;
      var state = getSceneState(runtimeScene);
      var idx = state.buoyantObjects.findIndex(function (b) { return b.behavior === behavior; });
      if (idx !== -1) {
        var buoy = state.buoyantObjects[idx];
        if (buoy && buoy.hooked && buoy.object) {
          var phys3d = FluidAndWater3D.findPhysics3D(buoy.object, buoy.physics3D);
          if (phys3d && phys3d._sharedData && Array.isArray(phys3d._sharedData._physics3DHooks)) {
            var hIdx = phys3d._sharedData._physics3DHooks.indexOf(buoy.hook);
            if (hIdx !== -1) phys3d._sharedData._physics3DHooks.splice(hIdx, 1);
          }
        }
        state.buoyantObjects.splice(idx, 1);
      }
    },

    isFloating: function (runtimeScene, behavior) {
      var buoy = FluidAndWater3D.buoyancyOf(runtimeScene, behavior);
      return buoy ? buoy.isFloating : false;
    },

    isSubmerged: function (runtimeScene, behavior) {
      var buoy = FluidAndWater3D.buoyancyOf(runtimeScene, behavior);
      return buoy ? buoy.isSubmerged : false;
    },

    getBuoyancyForce: function (runtimeScene, behavior) {
      var buoy = FluidAndWater3D.buoyancyOf(runtimeScene, behavior);
      return buoy ? buoy.lastForce : 0.0;
    },

    /* ========================================================= 3. PourableLiquid3D */

    registerPourableLiquid: function (runtimeScene, object, behavior, options) {
      if (!runtimeScene || !object || !behavior) return null;
      var state = getSceneState(runtimeScene);

      var presetName = options.fluidPreset || 'MagicPotion';
      var preset = resolveFluidPreset(presetName);
      var col = parseColor(options.liquidColor, preset.color);

      var liquid = {
        object: object,
        behavior: behavior,
        // Stable id so emitted droplets can be attributed back to their emitter and so a droplet
        // never fills the very container that poured it.
        ownerId: state.nextOwnerId++,
        fluidPreset: presetName,
        maxDroplets: options.maxDroplets > 0 ? options.maxDroplets : 1500,
        flowRate: options.flowRate !== undefined ? options.flowRate : preset.flowRate,
        pourTiltThreshold: num(options.pourTiltThreshold, 45.0),
        dropletRadius: options.dropletRadius !== undefined ? options.dropletRadius : preset.dropletRadius,
        viscosity: options.viscosity !== undefined ? options.viscosity : preset.viscosity,
        surfaceTension: options.surfaceTension !== undefined ? options.surfaceTension : preset.surfaceTension,
        restDensity: options.restDensity !== undefined ? options.restDensity : preset.restDensity,
        liquidColor: [col[0] / 255, col[1] / 255, col[2] / 255],
        liquidOpacity: options.liquidOpacity !== undefined ? options.liquidOpacity : preset.opacity,
        liquidRoughness: options.liquidRoughness !== undefined ? options.liquidRoughness : preset.roughness,
        containerCapacity: num(options.containerCapacity, 1.0),
        currentVolume: 0.0,
        isPouring: false,
        autoPourOnTilt: options.autoPourOnTilt !== undefined ? !!options.autoPourOnTilt : true,
        emitAccumulator: 0.0
      };

      // The shared droplet mesh lives on the first registered emitter's layer.
      if (state.particleLayerName === null) state.particleLayerName = objectLayerName(object);

      state.pourableObjects.push(liquid);
      return liquid;
    },

    pourableOf: function (runtimeScene, behavior) {
      if (!runtimeScene || !behavior) return null;
      var state = getSceneState(runtimeScene);
      return state.pourableObjects.find(function (p) { return p.behavior === behavior; }) || null;
    },

    setFluidPreset: function (runtimeScene, behavior, presetName) {
      var liquid = FluidAndWater3D.pourableOf(runtimeScene, behavior);
      if (!liquid) return;

      var preset = resolveFluidPreset(presetName);
      liquid.fluidPreset = presetName;
      liquid.viscosity = preset.viscosity;
      liquid.surfaceTension = preset.surfaceTension;
      liquid.restDensity = preset.restDensity;
      liquid.liquidOpacity = preset.opacity;
      liquid.liquidRoughness = preset.roughness;
      liquid.dropletRadius = preset.dropletRadius;
      liquid.flowRate = preset.flowRate;
      liquid.liquidColor = [preset.color[0] / 255, preset.color[1] / 255, preset.color[2] / 255];
    },

    startPouring: function (runtimeScene, behavior, flowRate) {
      var liquid = FluidAndWater3D.pourableOf(runtimeScene, behavior);
      if (!liquid) return;
      liquid.isPouring = true;
      if (flowRate !== undefined && flowRate > 0) liquid.flowRate = flowRate;
    },

    stopPouring: function (runtimeScene, behavior) {
      var liquid = FluidAndWater3D.pourableOf(runtimeScene, behavior);
      if (!liquid) return;
      liquid.isPouring = false;
    },

    stepPourableLiquid: function (runtimeScene, object, behavior) {
      var liquid = FluidAndWater3D.pourableOf(runtimeScene, behavior);
      if (!liquid) return;

      var state = getSceneState(runtimeScene);
      if (state.paused) return;
      var dt = getDeltaSeconds(runtimeScene) * state.timeScale;
      if (dt <= 0) return;

      var pitch = object.getRotationX ? object.getRotationX() : 0.0;
      var roll = object.getRotationY ? object.getRotationY() : 0.0;

      if (liquid.autoPourOnTilt) {
        var tilt = Math.sqrt(pitch * pitch + roll * roll);
        liquid.isPouring = tilt >= liquid.pourTiltThreshold;
      }

      if (!liquid.isPouring || liquid.flowRate <= 0) return;

      // Draining a container that has something in it consumes what it holds.
      if (liquid.currentVolume > 0) {
        liquid.currentVolume = Math.max(
          0.0,
          liquid.currentVolume - liquid.flowRate * dt * dropletVolumeLitres(liquid.dropletRadius)
        );
      }

      if (state.sphSolver.countOwnedBy(liquid.ownerId) >= liquid.maxDroplets) return;

      liquid.emitAccumulator += liquid.flowRate * dt;
      var toEmit = Math.floor(liquid.emitAccumulator);
      if (toEmit <= 0) return;
      liquid.emitAccumulator -= toEmit;

      // Emit from the spout: the centre of the object's top face, not its min corner.
      var w = (object.getWidth && object.getWidth() > 0) ? object.getWidth() : 0;
      var h = (object.getHeight && object.getHeight() > 0) ? object.getHeight() : 0;
      var d = (object.getDepth && object.getDepth() > 0) ? object.getDepth() : 0;
      var spoutX = (object.getX ? object.getX() : 0) + w * 0.5;
      var spoutY = (object.getY ? object.getY() : 0) + h * 0.5;
      var spoutZ = (object.getZ ? object.getZ() : 0) + d;

      // Tilting the vessel throws the stream out over the lip in the direction it leans.
      var pitchRad = pitch * Math.PI / 180.0;
      var rollRad = roll * Math.PI / 180.0;
      var lipX = Math.sin(rollRad) * w * 0.5;
      var lipY = -Math.sin(pitchRad) * h * 0.5;
      spoutX += lipX;
      spoutY += lipY;

      var props = {
        viscosity: liquid.viscosity,
        surfaceTension: liquid.surfaceTension,
        restDensity: liquid.restDensity,
        radius: liquid.dropletRadius,
        color: liquid.liquidColor,
        owner: liquid.ownerId
      };

      var outSpeed = 0.4;
      for (var e = 0; e < toEmit; e++) {
        var spreadX = (Math.random() - 0.5) * 0.02;
        var spreadY = (Math.random() - 0.5) * 0.02;
        state.sphSolver.emit(
          spoutX * SPH_WORLD_SCALE + spreadX,
          spoutY * SPH_WORLD_SCALE + spreadY,
          spoutZ * SPH_WORLD_SCALE,
          Math.sin(rollRad) * outSpeed + spreadX * 4.0,
          -Math.sin(pitchRad) * outSpeed + spreadY * 4.0,
          -0.4,
          10.0,
          props
        );
      }
    },

    disposePourableLiquid: function (runtimeScene, behavior) {
      if (!runtimeScene || !behavior) return;
      var state = getSceneState(runtimeScene);
      var idx = state.pourableObjects.findIndex(function (p) { return p.behavior === behavior; });
      if (idx !== -1) state.pourableObjects.splice(idx, 1);
    },

    getFillLevelPercent: function (runtimeScene, behavior) {
      var liquid = FluidAndWater3D.pourableOf(runtimeScene, behavior);
      if (!liquid || liquid.containerCapacity <= 0) return 0.0;
      return clamp((liquid.currentVolume / liquid.containerCapacity) * 100.0, 0.0, 100.0);
    },

    getCurrentLiquidVolume: function (runtimeScene, behavior) {
      var liquid = FluidAndWater3D.pourableOf(runtimeScene, behavior);
      return liquid ? liquid.currentVolume : 0.0;
    },

    /** Droplets currently alive that were poured by THIS emitter (not the scene-wide total). */
    getActiveDropletCount: function (runtimeScene, behavior) {
      var state = getSceneState(runtimeScene);
      var liquid = FluidAndWater3D.pourableOf(runtimeScene, behavior);
      if (!liquid) return state.sphSolver.getActiveCount();
      return state.sphSolver.countOwnedBy(liquid.ownerId);
    },

    emptyContainer: function (runtimeScene, behavior) {
      var liquid = FluidAndWater3D.pourableOf(runtimeScene, behavior);
      if (liquid) liquid.currentVolume = 0.0;
    },

    clearAllDroplets: function (runtimeScene) {
      var state = getSceneState(runtimeScene);
      state.sphSolver.clearAll();
    },

    /** Adds one deterministic expanding ripple to a water holder's fixed-size event queue. */
    emitBodyInteraction: function (holder, x, y, strength, time) {
      if (!holder || !holder.enableBodyInteractions || !(strength > 0)) return;
      if (!holder.interactions) holder.interactions = [];
      holder.interactions.push({
        x: x, y: y, time: time,
        strength: Math.min(strength, holder.interactionStrength),
        radius: Math.max(holder.interactionRadius, 1.0),
        life: Math.max(holder.interactionLifetime || 1.6, 0.1)
      });
      // Keep a few events beyond the shader capacity so an expiring ring cannot make a new one
      // displace an otherwise still-visible recent ring during the same frame.
      if (holder.interactions.length > MAX_WATER_INTERACTIONS + 8) holder.interactions.shift();
    },

    /** Uploads the newest live ripples into the arrays shared by the Gerstner and FFT shaders. */
    uploadBodyInteractions: function (holder, time) {
      if (!holder || !holder.material || !holder.material.uniforms) return;
      var u = holder.material.uniforms;
      if (!u.u_InteractionCount || !u.u_Interactions || !u.u_InteractionParams) return;
      var events = holder.interactions || [];
      for (var p = events.length - 1; p >= 0; p--) {
        if (time - events[p].time >= events[p].life) events.splice(p, 1);
      }
      var count = Math.min(events.length, MAX_WATER_INTERACTIONS);
      var start = events.length - count;
      for (var i = 0; i < count; i++) {
        var e = events[start + i];
        u.u_Interactions.value[i].set(e.x, e.y, e.time, e.strength);
        u.u_InteractionParams.value[i].set(e.radius, e.life, 0, 0);
      }
      u.u_InteractionCount.value = count;
    },

    /**
     * Detects moving Physics3D/Jolt bodies overlapping either kind of water volume. The water is a
     * visual/physical volume sensor, not a Jolt collider, so players do not bounce off an invisible
     * surface and no collision callback or Buoyancy3D behavior is required.
     */
    detectBodyInteractions: function (runtimeScene, state, dt) {
      if (!runtimeScene || typeof runtimeScene.getAdhocListOfAllInstances !== 'function') return;
      var objects = runtimeScene.getAdhocListOfAllInstances();
      if (!objects || objects.length === 0) return;
      var holders;
      if (state.waterBodies.length && state.oceans.length) {
        holders = state.waterBodies.concat(state.oceans);
      } else {
        holders = state.waterBodies.length ? state.waterBodies : state.oceans;
      }

      for (var h = 0; h < holders.length; h++) {
        var holder = holders[h];
        var water = holder.object;
        if (!holder.enableBodyInteractions || !water) continue;

        var wx = water.getX ? water.getX() : 0;
        var wy = water.getY ? water.getY() : 0;
        var wz = water.getZ ? water.getZ() : 0;
        var ww = (water.getWidth && water.getWidth() > 0) ? water.getWidth() : 0;
        var wh = (water.getHeight && water.getHeight() > 0) ? water.getHeight() : 0;
        var wd = (water.getDepth && water.getDepth() > 0) ? water.getDepth() : 0;
        var baseSurface = wz + wd;
        if (ww <= 0 || wh <= 0) continue;

        for (var i = 0; i < objects.length; i++) {
          var object = objects[i];
          if (!object || object === water || object._isBeingDeleted) continue;
          if (objectLayerName(object) !== holder.layerName) continue;
          // Misses are cached too: without that, every non-physics instance in the scene paid a
          // full behavior-table scan once per water volume per frame.
          var physics = state.physicsBehaviorCache ? state.physicsBehaviorCache.get(object) : undefined;
          if (physics === undefined) {
            physics = FluidAndWater3D.findPhysics3D(object) || null;
            if (state.physicsBehaviorCache) state.physicsBehaviorCache.set(object, physics);
          }
          if (!physics) continue;

          var ox = object.getX ? object.getX() : 0;
          var oy = object.getY ? object.getY() : 0;
          var oz = object.getZ ? object.getZ() : 0;
          var ow = (object.getWidth && object.getWidth() > 0) ? object.getWidth() : 1;
          var oh = (object.getHeight && object.getHeight() > 0) ? object.getHeight() : 1;
          var od = (object.getDepth && object.getDepth() > 0) ? object.getDepth() : 1;
          var cx = ox + ow * 0.5;
          var cy = oy + oh * 0.5;
          if (ox + ow < wx || ox > wx + ww || oy + oh < wy || oy > wy + wh) continue;

          var shore = waterEdgeInfluenceAt(state, cx, cy, holder.layerName, baseSurface,
            waterSpanOf(holder));
          if (shore.inside) continue;
          var naturalWave = holder.field
            ? holder.field.sampleHeight(cx, cy) * shore.attenuation
            : evaluateGerstnerDisplacement(cx, cy, state.time, waveConfigOf(holder, 0)) * shore.attenuation;
          var surfaceZ = baseSurface + naturalWave;
          var wet = oz <= surfaceZ && oz + od >= wz - 5.0;
          // Motion well below the surface should not throw a full-strength white splash above it.
          // A body crossing the top has distance 0; a deeply submerged swimmer fades smoothly.
          var depthBelowSurface = Math.max(surfaceZ - (oz + od), 0.0);
          var surfaceInfluence = 1.0 - clamp(
            depthBelowSurface / Math.max(holder.interactionRadius * 0.75, 1.0), 0.0, 1.0
          );

          var track = holder.interactionTracks ? holder.interactionTracks.get(object) : null;
          if (!track) {
            track = { x: cx, y: cy, z: oz + od * 0.5, wet: false, lastEmit: -1e9 };
            if (holder.interactionTracks) holder.interactionTracks.set(object, track);
          }

          var vx = 0, vy = 0, vz = 0;
          try {
            if (typeof physics.getLinearVelocityX === 'function') vx = physics.getLinearVelocityX() || 0;
            if (typeof physics.getLinearVelocityY === 'function') vy = physics.getLinearVelocityY() || 0;
            if (typeof physics.getLinearVelocityZ === 'function') vz = physics.getLinearVelocityZ() || 0;
          } catch (e) { vx = vy = vz = 0; }
          if (dt > 0) {
            var measuredX = (cx - track.x) / dt;
            var measuredY = (cy - track.y) / dt;
            var measuredZ = ((oz + od * 0.5) - track.z) / dt;
            if (Math.abs(measuredX) > Math.abs(vx)) vx = measuredX;
            if (Math.abs(measuredY) > Math.abs(vy)) vy = measuredY;
            if (Math.abs(measuredZ) > Math.abs(vz)) vz = measuredZ;
          }

          var horizontalSpeed = Math.sqrt(vx * vx + vy * vy);
          var speed = Math.sqrt(horizontalSpeed * horizontalSpeed + vz * vz * 0.65);
          var threshold = Math.max(holder.interactionSpeedThreshold, 0.0);
          var entered = wet && !track.wet;
          var cooldown = entered ? 0.0 : 0.12;
          if (wet && surfaceInfluence > 0 && speed >= threshold && state.time - track.lastEmit >= cooldown) {
            var scale = clamp((speed - threshold) / Math.max(threshold * 4.0, 80.0), 0.12, 1.0);
            var verticalBoost = 1.0 + clamp(Math.abs(vz) / Math.max(threshold * 3.0, 120.0), 0.0, 0.6);
            var entryBoost = entered ? 1.35 : 1.0;
            FluidAndWater3D.emitBodyInteraction(
              holder, cx, cy, holder.interactionStrength * scale * verticalBoost * entryBoost * surfaceInfluence, state.time
            );
            track.lastEmit = state.time;
          }

          track.x = cx; track.y = cy; track.z = oz + od * 0.5; track.wet = wet;
        }
      }
    },

    /* ========================================================= 4. Global Scene Tick */

    /**
     * Absorbs droplets that have fallen into another PourableLiquid3D object's volume and raises
     * that object's fill level. Any object carrying the behavior doubles as a container; a droplet
     * never fills the vessel that poured it (`owner` check).
     */
    absorbDropletsIntoContainers: function (state) {
      if (state.pourableObjects.length === 0) return;
      var solver = state.sphSolver;

      // Cache each container's AABB once per frame instead of per droplet.
      var boxes = [];
      for (var c = 0; c < state.pourableObjects.length; c++) {
        var liq = state.pourableObjects[c];
        var o = liq.object;
        if (!o || liq.containerCapacity <= 0) continue;
        if (liq.currentVolume >= liq.containerCapacity) continue;

        var ow = (o.getWidth && o.getWidth() > 0) ? o.getWidth() : 0;
        var oh = (o.getHeight && o.getHeight() > 0) ? o.getHeight() : 0;
        var od = (o.getDepth && o.getDepth() > 0) ? o.getDepth() : 0;
        if (ow <= 0 || oh <= 0) continue;

        var ox = o.getX ? o.getX() : 0;
        var oy = o.getY ? o.getY() : 0;
        var oz = o.getZ ? o.getZ() : 0;

        boxes.push({
          liquid: liq,
          minX: ox * SPH_WORLD_SCALE,
          maxX: (ox + ow) * SPH_WORLD_SCALE,
          minY: oy * SPH_WORLD_SCALE,
          maxY: (oy + oh) * SPH_WORLD_SCALE,
          minZ: oz * SPH_WORLD_SCALE,
          maxZ: (oz + od) * SPH_WORLD_SCALE
        });
      }
      if (boxes.length === 0) return;

      for (var i = 0; i < solver.particleCount; i++) {
        if (!solver.alive[i]) continue;
        var px = solver.x[i], py = solver.y[i], pz = solver.z[i];
        var owner = solver.owner[i];

        for (var b = 0; b < boxes.length; b++) {
          var box = boxes[b];
          if (box.liquid.ownerId === owner) continue;
          if (px < box.minX || px > box.maxX) continue;
          if (py < box.minY || py > box.maxY) continue;
          if (pz < box.minZ || pz > box.maxZ) continue;

          box.liquid.currentVolume = Math.min(
            box.liquid.containerCapacity,
            box.liquid.currentVolume + dropletVolumeLitres(solver.radius[i])
          );
          solver.kill(i);
          break;
        }
      }
    },

    onScenePostEvents: function (runtimeScene) {
      var state = getSceneState(runtimeScene);
      if (state.paused) return;

      // Real frame time, not a hardcoded 60 Hz assumption — otherwise waves and pouring run fast on
      // a 144 Hz display and slow on a 30 Hz one.
      var dt = getDeltaSeconds(runtimeScene) * state.timeScale;
      state.time += dt;

      // Read Jolt/Physics3D motion after object events have run, then feed the same interaction
      // events to both water renderers and CPU surface queries.
      FluidAndWater3D.detectBodyInteractions(runtimeScene, state, dt);

      // 1. Water bodies: keep them parented to their own layer and advance the shader clock.
      for (var i = 0; i < state.waterBodies.length; i++) {
        var body = state.waterBodies[i];

        if (body.mesh && !body.mesh.parent) {
          var bodyRoot = getLayerThreeRoot(runtimeScene, body.layerName);
          if (bodyRoot) bodyRoot.add(body.mesh);
        }

        // `cameraPosition` is fed to every ShaderMaterial by three.js itself; there is nothing to
        // push here beyond the clock.
        if (body.material && body.material.uniforms && body.material.uniforms.u_Time) {
          body.material.uniforms.u_Time.value = state.time;
        }
        if (body.material && body.material.uniforms && body.object) {
          var bObj = body.object;
          var bw = (bObj.getWidth && bObj.getWidth() > 0) ? bObj.getWidth() : 0;
          var bh = (bObj.getHeight && bObj.getHeight() > 0) ? bObj.getHeight() : 0;
          var bd = (bObj.getDepth && bObj.getDepth() > 0) ? bObj.getDepth() : 0;
          var bcx = (bObj.getX ? bObj.getX() : 0) + bw * 0.5;
          var bcy = (bObj.getY ? bObj.getY() : 0) + bh * 0.5;
          var bSurfaceZ = (bObj.getZ ? bObj.getZ() : 0) + bd;
          FluidAndWater3D.uploadWaterEdges(
            state, body.material, bcx, bcy, body.layerName, bSurfaceZ, waterSpanOf(body)
          );
          FluidAndWater3D.uploadBodyInteractions(body, state.time);
          syncSceneLightingAndSky(runtimeScene, body);
        }
      }

      // 1b. Tessendorf oceans: advance the field, refresh the texture, feed in the shore volumes.
      for (var oi = 0; oi < state.oceans.length; oi++) {
        var ocean = state.oceans[oi];
        if (ocean.mesh && !ocean.mesh.parent) {
          var oRoot = getLayerThreeRoot(runtimeScene, ocean.layerName);
          if (oRoot) oRoot.add(ocean.mesh);
        }
        // The buffer decays in real seconds, so it needs the frame time, not just the clock.
        ocean.lastFoamDt = dt;
        FluidAndWater3D.updateOceanField(ocean, state.time);
        if (ocean.material && ocean.material.uniforms) {
          if (ocean.material.uniforms.u_Time) ocean.material.uniforms.u_Time.value = state.time;
          if (ocean.material.uniforms.u_EdgeMask) {
            ocean.material.uniforms.u_EdgeMask.value = ocean.maskUnderEdges ? 1.0 : 0.0;
          }
          var oObj = ocean.object;
          var ocx = (oObj.getX ? oObj.getX() : 0) + ((oObj.getWidth && oObj.getWidth() > 0) ? oObj.getWidth() * 0.5 : 0);
          var ocy = (oObj.getY ? oObj.getY() : 0) + ((oObj.getHeight && oObj.getHeight() > 0) ? oObj.getHeight() * 0.5 : 0);
          var ocz = (oObj.getZ ? oObj.getZ() : 0) + ((oObj.getDepth && oObj.getDepth() > 0) ? oObj.getDepth() : 0);
          FluidAndWater3D.uploadWaterEdges(
            state, ocean.material, ocx, ocy, ocean.layerName, ocz, waterSpanOf(ocean)
          );
          FluidAndWater3D.uploadBodyInteractions(ocean, state.time);
          syncSceneLightingAndSky(runtimeScene, ocean);
        }
      }

      FluidAndWater3D.announceShore(state);

      // Detailing behaviors emit into one pool. Integrate and upload it once per scene frame,
      // even when some emitters are disabled or use a different water model.
      if (state.spray) {
        // The water line droplets splash back into. Taken from the first spectral ocean in the
        // scene, a wave height below its still surface so a droplet landing in a trough is not
        // culled while it is still visibly in the air.
        var sprayFloor;
        for (var soi = 0; soi < state.oceans.length; soi++) {
          var so = state.oceans[soi];
          if (!so.isWaveWorks || !so.object) continue;
          var sTop = (so.object.getZ ? so.object.getZ() : 0) +
            (so.object.getDepth && so.object.getDepth() > 0 ? so.object.getDepth() : 0);
          sprayFloor = sTop - (so.significantWaveHeight || 0);
          break;
        }
        state.spray.step(dt, sprayGravityFor(null, null), sprayFloor);
        FluidAndWater3D.syncSprayMesh(runtimeScene, { layerName: state.sprayLayerName || '' });
      }

      // 2. Step the SPH solver, then let containers catch what fell into them.
      if (state.sphSolver.getActiveCount() > 0) {
        state.sphSolver.step(dt, { floorZ: state.sphFloorZ * SPH_WORLD_SCALE });
        FluidAndWater3D.absorbDropletsIntoContainers(state);
      }

      if (!THREE_OK) return;

      // 3. Droplet instances. Colour and size come from each droplet's own fluid preset.
      // The instanced mesh reserves every droplet slot up front, so it is only worth building
      // once a PourableLiquid3D exists — an ocean-only scene was allocating it for nothing.
      // Note this must not return early: the underwater transition below still has to run.
      var dropletsPossible = !!state.particleMesh || state.pourableObjects.length > 0 ||
        state.sphSolver.particleCount > 0;
      var particleRoot = dropletsPossible
        ? getLayerThreeRoot(runtimeScene, state.particleLayerName || '')
        : null;
      if (particleRoot) {
        if (!state.particleMesh && typeof THREE.InstancedMesh === 'function' &&
            typeof THREE.SphereGeometry === 'function' && typeof THREE.MeshBasicMaterial === 'function') {
          var pGeom = new THREE.SphereGeometry(1.0, 8, 8);
          var pMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
          state.particleMesh = new THREE.InstancedMesh(pGeom, pMat, state.sphSolver.maxDroplets);
          state.particleMesh.name = 'FluidAndWater3D_Droplets';
          state.particleMesh.frustumCulled = false;
          if (state.particleMesh.instanceMatrix && state.particleMesh.instanceMatrix.setUsage) {
            state.particleMesh.instanceMatrix.setUsage(35048); // THREE.DynamicDrawUsage
          }
          state.dummyObj = new THREE.Object3D();
          particleRoot.add(state.particleMesh);
        } else if (state.particleMesh && !state.particleMesh.parent) {
          particleRoot.add(state.particleMesh);
        }
      }

      if (state.particleMesh && state.dummyObj) {
        var solver = state.sphSolver;
        var dummy = state.dummyObj;
        var mesh = state.particleMesh;
        var activeCount = 0;
        var maxOpacity = 0.0;

        for (var pIdx = 0; pIdx < solver.particleCount; pIdx++) {
          if (!solver.alive[pIdx]) continue;

          // Back to GDevelop pixels. The instances sit under the same y-mirrored root as every
          // built-in 3D object, so GDevelop coordinates are assigned directly.
          dummy.position.set(
            solver.x[pIdx] * SPH_WORLD_INV_SCALE,
            solver.y[pIdx] * SPH_WORLD_INV_SCALE,
            solver.z[pIdx] * SPH_WORLD_INV_SCALE
          );
          dummy.scale.setScalar(Math.max(solver.radius[pIdx] * SPH_WORLD_INV_SCALE, 0.5));
          dummy.updateMatrix();
          mesh.setMatrixAt(activeCount, dummy.matrix);
          if (typeof mesh.setColorAt === 'function' && state.particleColor) {
            state.particleColor.setRGB(solver.cr[pIdx], solver.cg[pIdx], solver.cb[pIdx]);
            mesh.setColorAt(activeCount, state.particleColor);
          }
          activeCount++;
        }

        mesh.count = activeCount;
        if (mesh.instanceMatrix) mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

        // Opacity follows whichever registered liquid is the most opaque; a single instanced
        // material cannot carry per-droplet alpha.
        for (var lIdx = 0; lIdx < state.pourableObjects.length; lIdx++) {
          maxOpacity = Math.max(maxOpacity, state.pourableObjects[lIdx].liquidOpacity);
        }
        if (mesh.material && maxOpacity > 0) mesh.material.opacity = maxOpacity;
      }

      // 4. Underwater camera transition.
      FluidAndWater3D.updateUnderwater(runtimeScene, state);
    },

    /**
     * Wave displacement at (x, y) for either kind of registered water, with shore attenuation
     * already applied and the base surface Z excluded. Mirrors the per-model sampling used by
     * WaveHeightAt() and GetOceanSurfaceZ so the submersion test agrees with them.
     */
    underwaterWaveOffsetAt: function (state, holder, x, y, attenuation) {
      var disp;
      if (holder.isSpectralOcean) {
        // No field yet (the volume's real size only arrives after onCreated) means no surface to
        // be under; falling through to the Gerstner path would read octaves an ocean never has.
        if (!holder.field) return 0.0;
        disp = (holder.isWaveWorks && holder.field1)
          ? (holder.field.sampleHeight(x, y) +
             (holder.cascadeWeight !== undefined ? holder.cascadeWeight : 0.65) *
             holder.field1.sampleHeight(x, y))
          : holder.field.sampleHeight(x, y);
      } else {
        disp = evaluateGerstnerDisplacement(x, y, state.time, waveConfigOf(holder, 0));
      }
      return (disp + interactionDisplacementAt(holder, x, y, state.time)) * attenuation;
    },

    updateUnderwater: function (runtimeScene, state) {
      // Both registries take part: OceanFFT3D and OceanWaveWorks3D carry the same
      // EnableUnderwaterFX / UnderwaterFogColor / UnderwaterFogDensity properties and the same
      // IsCameraUnderwater condition as WaterBody3D, and used to be skipped entirely here.
      var holders;
      if (state.waterBodies.length && state.oceans.length) {
        holders = state.waterBodies.concat(state.oceans);
      } else {
        holders = state.waterBodies.length ? state.waterBodies : state.oceans;
      }
      if (holders.length === 0) return;

      var isUnderAny = false;
      var activeWater = null;
      var activeScene = null;

      for (var w = 0; w < holders.length; w++) {
        var wb = holders[w];
        var obj = wb.object;
        if (!obj) continue;

        var threeCamera = getLayerThreeCamera(runtimeScene, wb.layerName);
        if (!threeCamera) { wb.isCameraUnderwater = false; continue; }

        var camX = 0, camY = 0, camZ = 0;
        if (threeCamera.getWorldPosition && typeof THREE.Vector3 === 'function') {
          if (!state._camWorldPos) state._camWorldPos = new THREE.Vector3();
          threeCamera.getWorldPosition(state._camWorldPos);
          camX = state._camWorldPos.x;
          camY = state._camWorldPos.y;
          camZ = state._camWorldPos.z;
        } else if (threeCamera.position) {
          camX = threeCamera.position.x || 0;
          camY = threeCamera.position.y || 0;
          camZ = threeCamera.position.z || 0;
        }

        // The camera lives in three space, where Y is the negated GDevelop Y. Comparing it straight
        // against a GDevelop-space AABB puts it outside every water body at positive Y.
        var camGdY = -camY;

        var objX = obj.getX ? obj.getX() : 0;
        var objY = obj.getY ? obj.getY() : 0;
        var objZ = obj.getZ ? obj.getZ() : 0;
        var objW = (obj.getWidth && obj.getWidth() > 0) ? obj.getWidth() : 1000;
        var objH = (obj.getHeight && obj.getHeight() > 0) ? obj.getHeight() : 1000;
        var objD = (obj.getDepth && obj.getDepth() > 0) ? obj.getDepth() : 0;

        var inX = camX >= objX && camX <= (objX + objW);
        var inY = camGdY >= objY && camGdY <= (objY + objH);

        if (!inX || !inY) { wb.isCameraUnderwater = false; continue; }

        var baseSurfZ = objZ + objD;
        var shore = waterEdgeInfluenceAt(state, camX, camGdY, wb.layerName, baseSurfZ,
          waterSpanOf(wb));
        if (shore.inside) { wb.isCameraUnderwater = false; continue; }
        var waveOffset = FluidAndWater3D.underwaterWaveOffsetAt(
          state, wb, camX, camGdY, shore.attenuation);
        var liveSurfZ = baseSurfZ + waveOffset;

        if (camZ >= objZ && camZ <= liveSurfZ) {
          wb.isCameraUnderwater = true;
          if (wb.enableUnderwaterFX) {
            isUnderAny = true;
            activeWater = wb;
            activeScene = getLayerThreeScene(runtimeScene, wb.layerName);
          }
        } else {
          wb.isCameraUnderwater = false;
        }
      }

      if (isUnderAny && !state.underwaterActive && activeWater && activeScene) {
        state.underwaterActive = true;
        state.underwaterBody = activeWater;
        state.savedFog = activeScene.fog;
        state._fogScene = activeScene;
        if (typeof THREE.FogExp2 === 'function') {
          var col = activeWater.underwaterFogColor;
          activeScene.fog = new THREE.FogExp2(
            new THREE.Color(col[0], col[1], col[2]),
            activeWater.underwaterFogDensity
          );
        }
      } else if (!isUnderAny && state.underwaterActive) {
        state.underwaterActive = false;
        state.underwaterBody = null;
        // Restore the fog on the scene it was taken from, not on whatever scene is handy now.
        if (state._fogScene) state._fogScene.fog = state.savedFog || null;
        state._fogScene = null;
        state.savedFog = null;
      }
    },

    onSceneUnloaded: function (runtimeScene) {
      var state = sceneStates.get(runtimeScene);
      if (state) {
        for (var i = 0; i < state.waterBodies.length; i++) {
          var body = state.waterBodies[i];
          if (body.mesh) {
            if (body.mesh.geometry) body.mesh.geometry.dispose();
            if (body.mesh.material) body.mesh.material.dispose();
            if (body.mesh.parent) body.mesh.parent.remove(body.mesh);
          }
        }
        for (var oi = 0; oi < state.oceans.length; oi++) {
          var oc = state.oceans[oi];
          if (oc.mesh) {
            if (oc.mesh.geometry) oc.mesh.geometry.dispose();
            if (oc.mesh.material) oc.mesh.material.dispose();
            if (oc.mesh.parent) oc.mesh.parent.remove(oc.mesh);
          }
          if (oc.foamRT && oc.foamRT.dispose) oc.foamRT.dispose();
          if (oc.texture && oc.texture.dispose) oc.texture.dispose();
          if (oc.cascadeTexture && oc.cascadeTexture.dispose) oc.cascadeTexture.dispose();
          if (oc.slopeTexture && oc.slopeTexture.dispose) oc.slopeTexture.dispose();
          if (oc.cascadeSlopeTexture && oc.cascadeSlopeTexture.dispose) oc.cascadeSlopeTexture.dispose();
        }
        state.oceans = [];
        state.waterEdges = [];
        if (state.particleMesh) {
          if (state.particleMesh.geometry) state.particleMesh.geometry.dispose();
          if (state.particleMesh.material) state.particleMesh.material.dispose();
          if (state.particleMesh.parent) state.particleMesh.parent.remove(state.particleMesh);
          state.particleMesh = null;
        }
        if (state.sprayMesh) {
          if (state.sprayMesh.geometry && state.sprayMesh.geometry.dispose) state.sprayMesh.geometry.dispose();
          if (state.sprayMesh.material && state.sprayMesh.material.dispose) state.sprayMesh.material.dispose();
          if (state.sprayMesh.parent) state.sprayMesh.parent.remove(state.sprayMesh);
          state.sprayMesh = null;
        }
        if (state.spray) {
          state.spray.clear();
          state.spray = null;
        }
        state.sprayDummy = null;
        state.sprayLayerName = null;
        // Leave the scene's fog as we found it if the player quit while submerged.
        if (state.underwaterActive && state._fogScene) {
          state._fogScene.fog = state.savedFog || null;
          state._fogScene = null;
          state.underwaterActive = false;
        }
        state.waterBodies = [];
        state.oceans = [];
        state.waterEdges = [];
        state.waterDetailings = [];
        state.waterStrengthSliders = [];
        state.buoyantObjects = [];
        state.pourableObjects = [];
        state.sphSolver.clearAll();
        sceneStates.delete(runtimeScene);
      }
    },

    isSupported: function (runtimeScene) {
      if (!THREE_OK) return false;
      if (!runtimeScene || !runtimeScene.getGame) return true;
      var renderer = runtimeScene.getGame().getRenderer();
      if (!renderer || !renderer.getThreeRenderer) return true;
      var threeRenderer = renderer.getThreeRenderer();
      return !!(threeRenderer && threeRenderer.capabilities && threeRenderer.capabilities.isWebGL2 !== false);
    },

    setGlobalFluidTimeScale: function (runtimeScene, scale) {
      var state = getSceneState(runtimeScene);
      state.timeScale = Math.max(0.0, scale);
    },

    pauseAllFluids: function (runtimeScene, pause) {
      var state = getSceneState(runtimeScene);
      state.paused = !!pause;
    },

    /** Z height (GDevelop units) that poured droplets pile up on. Defaults to 0. */
    setDropletFloorZ: function (runtimeScene, z) {
      var state = getSceneState(runtimeScene);
      state.sphFloorZ = typeof z === 'number' && isFinite(z) ? z : 0.0;
    },

    getGlobalWaterSurfaceZ: function (runtimeScene, x, y) {
      return FluidAndWater3D.getWaterSurfaceZ(runtimeScene, null, x, y);
    },

    isCameraUnderwaterAny: function (runtimeScene) {
      var state = getSceneState(runtimeScene);
      return state.underwaterActive;
    },

    getTotalActiveDropletCount: function (runtimeScene) {
      var state = getSceneState(runtimeScene);
      return state.sphSolver.getActiveCount();
    },

    _getSceneStateForTests: function (runtimeScene) {
      return getSceneState(runtimeScene);
    }
  };

  if (typeof gdjs.registerRuntimeScenePostEventsCallback === 'function') {
    gdjs.registerRuntimeScenePostEventsCallback(FluidAndWater3D.onScenePostEvents);
  }
  if (typeof gdjs.registerRuntimeSceneUnloadedCallback === 'function') {
    gdjs.registerRuntimeSceneUnloadedCallback(FluidAndWater3D.onSceneUnloaded);
  }

  gdjs.__fluidAndWater3D = FluidAndWater3D;
})();
