/**
 * WeatherFX2D runtime engine.
 *
 * Two subsystems, both camera-correct by construction:
 *
 *   1. A sprite particle field (snow / rain / fog / embers). Particles are integrated in FIELD
 *      SPACE - screen pixels, relative to the centre of the view - and wrapped against a box that
 *      is always centred on the camera. There is therefore no fixed world line where the whole
 *      field recycles at once, and no world rectangle the effect can fall outside of.
 *
 *   2. A screen distortion PIXI filter (heat haze / underwater / ripples). The filter pins
 *      `filterArea` to exactly the renderer screen and derives screen pixels from PIXI's own
 *      `inputSize` / `outputFrame` uniforms, so the shader is independent of how PIXI happened to
 *      size its framebuffer this frame.
 *
 * BOTH OF THOSE ARE THE POINT. The naive versions of these effects break in the same three ways,
 * and the reasons are worth stating because they are not obvious:
 *
 *   - A PIXI container added to `layer.getRenderer().getRendererObject()` is in WORLD coordinates.
 *     GDevelop rewrites that container's transform every frame from the camera
 *     (layer-pixi-renderer.js, updatePosition: scale = zoom, position = viewportOrigin - cam*zoom).
 *     Writing `getGameResolutionWidth()`-based positions into it therefore pins the weather to the
 *     world rectangle (0,0)-(resW,resH) and nowhere else.
 *
 *   - A filter with no `filterArea` gets its framebuffer sized from `target.getBounds()` - the union
 *     of every object on the layer, clipped to the screen. PIXI's texture pool only returns an
 *     exact-fit texture when that size is EXACTLY the screen; one pixel off and it rounds up to the
 *     next power of two. `vTextureCoord` is `aVertexPosition * (outputFrame.zw * inputSize.zw)`, so
 *     its range collapses from 0..1 to 0..0.53 the instant that happens, and every amplitude and
 *     wavelength expressed in UV units snaps with it.
 *
 *   - When the content bounds stop intersecting the screen at all, PIXI zeroes the frame and the
 *     filter never runs.
 *
 * Verified against the GDJS runtime shipped with GDevelop 5.6.279 (PIXI 7.4.2).
 */
(function () {
  if (typeof gdjs === 'undefined') return;
  if (gdjs.__weatherFX2D) return; // Singleton installation

  var PIXI_OK = typeof PIXI !== 'undefined';

  var TWO_PI = Math.PI * 2;

  /* ============================================================== Math & small helpers */

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function toNumber(value, fallback) {
    var n = Number(value);
    return isFinite(n) ? n : fallback;
  }

  /**
   * Folds `value` into [-span/2, +span/2). Used instead of a single subtract so that a camera
   * teleport - a scene change, a cutscene cut, a respawn - resolves in one step rather than leaving
   * particles stranded many field-widths away for as many frames.
   */
  function wrapSigned(value, span) {
    if (!(span > 0)) return value;
    var half = span * 0.5;
    var folded = (value + half) % span;
    if (folded < 0) folded += span;
    return folded - half;
  }

  function wrapPositive(value, span) {
    if (!(span > 0)) return 0;
    var folded = value % span;
    return folded < 0 ? folded + span : folded;
  }

  /**
   * Accepts "255;128;0", "#ff8000" and 0xff8000. GDevelop's colour properties hand over the
   * semicolon form; expressions written by hand tend to use hex.
   */
  function parseColorToHex(input, fallback) {
    if (typeof input === 'number' && isFinite(input)) return input | 0;
    if (typeof input === 'string') {
      var text = input.trim();
      if (text.charAt(0) === '#') {
        var parsedHex = parseInt(text.slice(1), 16);
        if (isFinite(parsedHex)) return parsedHex;
      }
      var parts = text.split(';');
      if (parts.length >= 3) {
        var r = clamp(parseInt(parts[0], 10) || 0, 0, 255);
        var g = clamp(parseInt(parts[1], 10) || 0, 0, 255);
        var b = clamp(parseInt(parts[2], 10) || 0, 0, 255);
        return (r << 16) + (g << 8) + b;
      }
    }
    return fallback === undefined ? 0xffffff : fallback;
  }

  /** Deterministic per-particle randomness so a rebuilt field does not reshuffle every attribute. */
  function randomRange(min, max) {
    return min + Math.random() * (max - min);
  }

  /* ============================================================== Shared textures */

  /**
   * Particle textures are built once per page and shared by every emitter, so the whole field is one
   * batched draw call regardless of how many systems are running.
   *
   * Softness 0 returns PIXI.Texture.WHITE - a crisp square, which is what pixel-art snow actually
   * looks like and what the tint/scale path batches most cheaply. Anything above 0 generates a
   * radial-falloff disc whose solid core shrinks as softness rises.
   */
  var textureCache = {};

  function canBuildCanvasTexture() {
    return PIXI_OK && typeof document !== 'undefined' && !!document.createElement;
  }

  function getDotTexture(softness) {
    if (!PIXI_OK) return null;
    var amount = clamp(toNumber(softness, 0), 0, 1);
    if (amount <= 0.01 || !canBuildCanvasTexture()) {
      return PIXI.Texture.WHITE;
    }

    var key = 'dot:' + amount.toFixed(2);
    if (textureCache[key]) return textureCache[key];

    var size = 64;
    var canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    var ctx = canvas.getContext('2d');
    if (!ctx) return PIXI.Texture.WHITE;

    var centre = size / 2;
    // A fully soft dot fades from the very centre; a nearly-crisp one holds solid almost to the rim.
    var coreStop = clamp(1 - amount, 0, 0.95);
    var gradient = ctx.createRadialGradient(centre, centre, 0, centre, centre, centre);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(coreStop, 'rgba(255,255,255,1)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    var texture = PIXI.Texture.from(canvas);
    if (texture.baseTexture) texture.baseTexture.scaleMode = PIXI.SCALE_MODES.LINEAR;
    textureCache[key] = texture;
    return texture;
  }

  /** Hollow ring, used for rain splashes. Same cache, same batch. */
  function getRingTexture() {
    if (!PIXI_OK) return null;
    if (!canBuildCanvasTexture()) return PIXI.Texture.WHITE;
    if (textureCache.ring) return textureCache.ring;

    var size = 64;
    var canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    var ctx = canvas.getContext('2d');
    if (!ctx) return PIXI.Texture.WHITE;

    ctx.strokeStyle = 'rgba(255,255,255,1)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 4, 0, TWO_PI);
    ctx.stroke();

    var texture = PIXI.Texture.from(canvas);
    if (texture.baseTexture) texture.baseTexture.scaleMode = PIXI.SCALE_MODES.LINEAR;
    textureCache.ring = texture;
    return texture;
  }

  /* ============================================================== Camera sampling */

  /**
   * Everything either subsystem needs to know about the view this frame, in one place.
   *
   * `viewWidth` / `viewHeight` are the layer's viewport in SCREEN pixels; `getCameraWidth()` is that
   * divided by the zoom (layer.js: `getCameraWidth(){return this.getWidth()/this._zoomFactor}`), so
   * multiplying back by the zoom recovers the pixel size without assuming the game resolution.
   */
  function sampleCamera(runtimeScene, layerName) {
    var layer = runtimeScene.getLayer(layerName || '');
    var zoom = 1;
    if (layer && typeof layer.getCameraZoom === 'function') {
      zoom = toNumber(layer.getCameraZoom(), 1);
    }
    if (!(zoom > 0)) zoom = 1;

    var viewWidth = 0;
    var viewHeight = 0;
    if (layer && typeof layer.getWidth === 'function') {
      viewWidth = toNumber(layer.getWidth(), 0);
      viewHeight = toNumber(layer.getHeight(), 0);
    }
    if (!(viewWidth > 0) || !(viewHeight > 0)) {
      var game = runtimeScene.getGame();
      viewWidth = toNumber(game.getGameResolutionWidth(), 800);
      viewHeight = toNumber(game.getGameResolutionHeight(), 600);
    }

    return {
      layer: layer,
      x: layer && layer.getCameraX ? toNumber(layer.getCameraX(), 0) : 0,
      y: layer && layer.getCameraY ? toNumber(layer.getCameraY(), 0) : 0,
      zoom: zoom,
      rotationRad: layer && layer.getCameraRotation
        ? (toNumber(layer.getCameraRotation(), 0) * Math.PI) / 180
        : 0,
      viewWidth: viewWidth,
      viewHeight: viewHeight,
    };
  }

  /**
   * Field space -> world space.
   *
   * Field space is screen pixels measured from the centre of the view. GDevelop's own world->screen
   * (layer.js convertInverseCoords) is `screen = R(-rot) * (world - cam) * zoom + resolution/2`, so
   * the inverse used here is `world = cam + R(rot) * field / zoom`.
   */
  function fieldToWorldX(camera, fx, fy) {
    var ex = fx / camera.zoom;
    var ey = fy / camera.zoom;
    if (!camera.rotationRad) return camera.x + ex;
    return camera.x + Math.cos(camera.rotationRad) * ex - Math.sin(camera.rotationRad) * ey;
  }

  function fieldToWorldY(camera, fx, fy) {
    var ex = fx / camera.zoom;
    var ey = fy / camera.zoom;
    if (!camera.rotationRad) return camera.y + ey;
    return camera.y + Math.sin(camera.rotationRad) * ex + Math.cos(camera.rotationRad) * ey;
  }

  /** Inverse of fieldToWorld: screen = R(-rot) * (world - cam) * zoom, as GDevelop computes it. */
  function worldToFieldX(camera, worldX, worldY) {
    var ex = worldX - camera.x;
    var ey = worldY - camera.y;
    if (!camera.rotationRad) return ex * camera.zoom;
    return (Math.cos(-camera.rotationRad) * ex - Math.sin(-camera.rotationRad) * ey) * camera.zoom;
  }

  function worldToFieldY(camera, worldX, worldY) {
    var ex = worldX - camera.x;
    var ey = worldY - camera.y;
    if (!camera.rotationRad) return ey * camera.zoom;
    return (Math.sin(-camera.rotationRad) * ex + Math.cos(-camera.rotationRad) * ey) * camera.zoom;
  }

  /**
   * Builds the similarity transform that carries a field coordinate expressed against LAST frame's
   * camera into one expressed against THIS frame's camera.
   *
   * Composing the two conversions gives
   *   fNew = R(rPrev - rNew) * fPrev * (zoomNew / zoomPrev) + R(-rNew) * (camPrev - camNew) * zoomNew
   * which is four multiplies and two adds per particle, and stays exact through pans, zooms,
   * rotations and outright teleports alike. World-anchored particles use it; screen-anchored ones
   * skip it, and that single difference is the whole of the anchoring option.
   */
  function buildCameraDelta(previous, camera) {
    if (!previous) return { a: 1, b: 0, ox: 0, oy: 0 };

    var scale = camera.zoom / (previous.zoom || 1);
    var deltaRotation = previous.rotationRad - camera.rotationRad;
    var a = scale * Math.cos(deltaRotation);
    var b = scale * Math.sin(deltaRotation);

    var dx = previous.x - camera.x;
    var dy = previous.y - camera.y;
    var cos = Math.cos(-camera.rotationRad);
    var sin = Math.sin(-camera.rotationRad);

    return {
      a: a,
      b: b,
      ox: (cos * dx - sin * dy) * camera.zoom,
      oy: (sin * dx + cos * dy) * camera.zoom,
    };
  }

  /* ============================================================== Scene state */

  function getSceneState(runtimeScene) {
    if (!runtimeScene.__weatherFX2D) {
      runtimeScene.__weatherFX2D = {
        emitters: {},
        distortions: {},
        globalIntensity: 1,
        paused: false,
      };
    }
    return runtimeScene.__weatherFX2D;
  }

  var keyCounter = 0;

  /** Behaviours key by instance, free functions key by layer name; the prefixes keep them apart. */
  function resolveKey(key) {
    if (typeof key === 'string') return 'layer:' + key;
    if (!key) return 'layer:';
    if (!key.__weatherFX2DKey) {
      keyCounter += 1;
      key.__weatherFX2DKey = 'b:' + keyCounter;
    }
    return key.__weatherFX2DKey;
  }

  /* ============================================================== Particle presets */

  /**
   * Each preset is a complete set of defaults, so a free-function quick start needs only a type
   * name. The behaviour overrides whichever of these its properties supply.
   *
   * Angles follow GDevelop's screen convention: 0 is right, 90 is down. Sizes and speeds are in
   * SCREEN pixels and screen pixels per second, which is why they hold their look through a zoom.
   */
  var PRESETS = {
    Snow: {
      density: 220, minSize: 2, maxSize: 5, softness: 0,
      minSpeed: 35, maxSpeed: 95, windAngle: 90, windSpread: 14,
      gustStrength: 0.3, swayAmount: 16, swaySpeed: 55,
      color: 0xffffff, opacity: 210, additive: false, depthVariation: 0.6,
      streakWidth: 0, streakLength: 0,
      splashAmount: 0, splashMinRadius: 5, splashMaxRadius: 13, splashLife: 0.45,
    },
    Rain: {
      density: 320, minSize: 1, maxSize: 2, softness: 0,
      minSpeed: 700, maxSpeed: 1300, windAngle: 90, windSpread: 3,
      gustStrength: 0, swayAmount: 0, swaySpeed: 0,
      color: 0xbfd8ff, opacity: 150, additive: false, depthVariation: 0.55,
      streakWidth: 2, streakLength: 0,
      splashAmount: 26, splashMinRadius: 5, splashMaxRadius: 13, splashLife: 0.45,
    },
    Fog: {
      density: 26, minSize: 140, maxSize: 380, softness: 1,
      minSpeed: 4, maxSpeed: 16, windAngle: 0, windSpread: 22,
      gustStrength: 0.5, swayAmount: 10, swaySpeed: 8,
      color: 0xdfe8f2, opacity: 34, additive: false, depthVariation: 0.7,
      streakWidth: 0, streakLength: 0,
      splashAmount: 0, splashMinRadius: 5, splashMaxRadius: 13, splashLife: 0.45,
    },
    Embers: {
      density: 90, minSize: 2, maxSize: 4, softness: 0.75,
      minSpeed: 25, maxSpeed: 70, windAngle: 275, windSpread: 22,
      gustStrength: 0.45, swayAmount: 22, swaySpeed: 90,
      color: 0xffa032, opacity: 220, additive: true, depthVariation: 0.65,
      streakWidth: 0, streakLength: 0,
      splashAmount: 0, splashMinRadius: 5, splashMaxRadius: 13, splashLife: 0.45,
    },
    // Drawn rings rather than a shader distortion: expanding outlines that sit ON the water, which
    // is the look a top-down game usually wants. Density 0 - nothing falls, the rings are the whole
    // effect, seeded across the view at SplashAmount per second and spawnable on demand.
    Ripples: {
      density: 0, minSize: 2, maxSize: 4, softness: 1,
      minSpeed: 0, maxSpeed: 0, windAngle: 90, windSpread: 0,
      gustStrength: 0, swayAmount: 0, swaySpeed: 0,
      color: 0xffffff, opacity: 130, additive: false, depthVariation: 0.5,
      streakWidth: 0, streakLength: 0,
      splashAmount: 8, splashMinRadius: 14, splashMaxRadius: 46, splashLife: 2.2,
    },
  };

  function resolvePreset(name) {
    return PRESETS[name] || PRESETS.Snow;
  }

  /**
   * Merges caller options over the preset for the requested type. Anything the caller leaves
   * undefined keeps the preset value, so a free action can pass two fields and still get a
   * complete, coherent configuration.
   */
  function normalizeEmitterOptions(options) {
    var source = options || {};
    var type = PRESETS[source.type] ? source.type : 'Snow';
    var preset = resolvePreset(type);
    var resolved = { type: type };

    for (var field in preset) {
      if (!Object.prototype.hasOwnProperty.call(preset, field)) continue;
      resolved[field] = source[field] === undefined || source[field] === null
        ? preset[field]
        : source[field];
    }

    resolved.layerName = source.layerName || '';
    resolved.enabled = source.enabled === undefined ? true : !!source.enabled;
    resolved.anchoring = source.anchoring === 'Screen' ? 'Screen' : 'World';
    resolved.zOrder = toNumber(source.zOrder, 1000);
    resolved.pixelSnap = !!source.pixelSnap;
    // Applies whether or not the rest came from the preset, so "the same snow but heavier" needs no
    // other setting touched.
    resolved.intensity = Math.max(0, toNumber(source.intensity, 1));

    resolved.density = Math.max(0, toNumber(resolved.density, 0));
    resolved.minSize = Math.max(0.01, toNumber(resolved.minSize, 1));
    resolved.maxSize = Math.max(resolved.minSize, toNumber(resolved.maxSize, resolved.minSize));
    resolved.softness = clamp(toNumber(resolved.softness, 0), 0, 1);
    resolved.minSpeed = toNumber(resolved.minSpeed, 0);
    resolved.maxSpeed = Math.max(resolved.minSpeed, toNumber(resolved.maxSpeed, resolved.minSpeed));
    resolved.windAngle = toNumber(resolved.windAngle, 90);
    resolved.windSpread = Math.max(0, toNumber(resolved.windSpread, 0));
    resolved.gustStrength = clamp(toNumber(resolved.gustStrength, 0), 0, 1);
    resolved.swayAmount = Math.max(0, toNumber(resolved.swayAmount, 0));
    resolved.swaySpeed = Math.max(0, toNumber(resolved.swaySpeed, 0));
    resolved.swayIrregularity = clamp(toNumber(source.swayIrregularity, type === 'Snow' ? 0.4 : 0), 0, 1);
    resolved.opacity = clamp(toNumber(resolved.opacity, 255), 0, 255);
    resolved.depthVariation = clamp(toNumber(resolved.depthVariation, 0), 0, 1);
    resolved.streakWidth = Math.max(0, toNumber(resolved.streakWidth, 0));
    resolved.streakLength = Math.max(0, toNumber(resolved.streakLength, 0));
    resolved.splashAmount = Math.max(0, toNumber(resolved.splashAmount, 0));
    resolved.splashMinRadius = Math.max(0.5, toNumber(resolved.splashMinRadius, 5));
    resolved.splashMaxRadius = Math.max(resolved.splashMinRadius,
      toNumber(resolved.splashMaxRadius, resolved.splashMinRadius));
    resolved.splashLife = Math.max(0.05, toNumber(resolved.splashLife, 0.45));
    resolved.colorHex = parseColorToHex(resolved.color, 0xffffff);

    return resolved;
  }

  /* ============================================================== Particle emitter */

  function createEmitterSystem(runtimeScene, layerName) {
    var camera = sampleCamera(runtimeScene, layerName);
    if (!camera.layer || !PIXI_OK) return null;

    var renderer = camera.layer.getRenderer();
    if (!renderer || typeof renderer.getRendererObject !== 'function') return null;
    var layerContainer = renderer.getRendererObject();
    if (!layerContainer) return null;

    var container = new PIXI.Container();
    layerContainer.addChild(container);

    return {
      layerName: layerName || '',
      layerContainer: layerContainer,
      container: container,
      particles: [],
      splashes: [],
      texture: null,
      textureSoftness: -1,
      ringTexture: null,
      previousCamera: null,
      elapsed: 0,
      splashCarry: 0,
      lastCount: -1,
    };
  }

  /**
   * Rebuilds a particle's randomised attributes. `depth` drives size, speed and alpha together -
   * one number, three correlated effects - which is what reads as depth rather than as noise.
   */
  function randomizeParticle(particle, options) {
    particle.depth = Math.random();
    particle.speedJitter = Math.random();
    particle.angleJitter = Math.random() * 2 - 1;
    particle.swayPhase = Math.random() * TWO_PI;
    particle.swayRate = 0.75 + Math.random() * 0.5;
    particle.alphaJitter = 0.65 + Math.random() * 0.35;
    particle.gustPhase = Math.random() * TWO_PI;
    return particle;
  }

  function ensureParticleCount(system, options, count) {
    var particles = system.particles;

    while (particles.length > count) {
      var removed = particles.pop();
      if (removed.sprite) {
        system.container.removeChild(removed.sprite);
        removed.sprite.destroy();
      }
    }

    while (particles.length < count) {
      var sprite = new PIXI.Sprite(system.texture);
      sprite.anchor.set(0.5);
      system.container.addChild(sprite);

      var particle = randomizeParticle({ sprite: sprite, fx: 0, fy: 0 }, options);
      // Scattered across the whole field rather than spawned on an edge: the field is already
      // full on the first frame, so there is no fill-up wave and no thin band when the camera
      // starts moving before the ramp has finished.
      particle.needsScatter = true;
      particles.push(particle);
    }
  }

  function stepEmitter(runtimeScene, key, options) {
    stepEmitterByKey(runtimeScene, resolveKey(key), options);
  }

  function stepEmitterByKey(runtimeScene, systemKey, options) {
    var state = getSceneState(runtimeScene);
    var config = normalizeEmitterOptions(options);
    var system = state.emitters[systemKey];

    if (!system) return;

    // A layer change from the property panel or an expression re-homes the whole field rather than
    // leaving an orphaned container drawing on the old layer.
    if (system.layerName !== config.layerName) {
      var carriedAutoOptions = system.autoOptions;
      disposeEmitterByKey(runtimeScene, systemKey);
      var rebuilt = createEmitterSystem(runtimeScene, config.layerName);
      if (!rebuilt) return;
      rebuilt.autoOptions = carriedAutoOptions;
      state.emitters[systemKey] = rebuilt;
      system = rebuilt;
    }

    var container = system.container;
    if (!container) return;

    // GDevelop rebuilds a layer's PIXI container when the layer's own effects change. Re-parent
    // rather than silently rendering into a detached container.
    var camera = sampleCamera(runtimeScene, config.layerName);
    if (!camera.layer) return;
    var currentLayerContainer = camera.layer.getRenderer().getRendererObject();
    if (currentLayerContainer && container.parent !== currentLayerContainer) {
      currentLayerContainer.addChild(container);
      system.layerContainer = currentLayerContainer;
    }

    container.zIndex = config.zOrder;
    container.visible = config.enabled && !state.paused;
    if (!container.visible) {
      system.previousCamera = camera;
      return;
    }

    if (system.textureSoftness !== config.softness || !system.texture) {
      system.texture = config.type === 'Rain' ? PIXI.Texture.WHITE : getDotTexture(config.softness);
      system.textureSoftness = config.softness;
      for (var t = 0; t < system.particles.length; t++) {
        system.particles[t].sprite.texture = system.texture;
      }
    }

    var deltaSeconds = runtimeScene.getTimeManager().getElapsedTime() / 1000;
    if (!(deltaSeconds > 0)) deltaSeconds = 0;
    // A tab regaining focus can hand over a multi-second step. Integrating it whole teleports the
    // entire field in one frame, which reads as the effect "jumping"; clamping loses nothing.
    if (deltaSeconds > 0.1) deltaSeconds = 0.1;
    system.elapsed += deltaSeconds;

    var intensity = clamp(state.globalIntensity, 0, 1);

    // --- Field geometry ------------------------------------------------------------------
    // Padding only has to hide the wrap seam, and a particle wraps when its CENTRE crosses the
    // field edge - so covering the largest particle's own extent is sufficient.
    var maxExtent = config.maxSize;
    if (config.type === 'Rain') {
      var longestStreak = config.streakLength > 0 ? config.streakLength : config.maxSpeed * 0.035;
      maxExtent = Math.max(config.maxSize, longestStreak);
    }
    var padding = maxExtent + 32;
    var fieldWidth = camera.viewWidth + padding * 2;
    var fieldHeight = camera.viewHeight + padding * 2;

    var visibleArea = Math.max(1, camera.viewWidth * camera.viewHeight);
    var fieldArea = fieldWidth * fieldHeight;
    // Density is stated as "particles visible on one screenful", so the stored count scales up by
    // exactly the ratio the padding adds. Change resolution or zoom and the on-screen count holds.
    var targetCount = Math.round(config.density * config.intensity * intensity * (fieldArea / visibleArea));
    targetCount = Math.max(0, Math.min(targetCount, 20000));

    ensureParticleCount(system, config, targetCount);

    // --- Per-frame constants -------------------------------------------------------------
    var delta = config.anchoring === 'World'
      ? buildCameraDelta(system.previousCamera, camera)
      : { a: 1, b: 0, ox: 0, oy: 0 };

    var baseAngle = (config.windAngle * Math.PI) / 180;
    // Two incommensurate rates so the gust never settles into an obvious loop.
    var gust = config.gustStrength
      ? (Math.sin(system.elapsed * 0.37) * 0.65 + Math.sin(system.elapsed * 0.11) * 0.35) * config.gustStrength
      : 0;

    var halfFieldWidth = fieldWidth * 0.5;
    var halfFieldHeight = fieldHeight * 0.5;
    var sizeSpan = config.maxSize - config.minSize;
    var speedSpan = config.maxSpeed - config.minSpeed;
    var alphaBase = config.opacity / 255;
    var blendMode = config.additive ? PIXI.BLEND_MODES.ADD : PIXI.BLEND_MODES.NORMAL;
    var isRain = config.type === 'Rain';


    var particles = system.particles;
    for (var i = 0; i < particles.length; i++) {
      var particle = particles[i];

      if (particle.needsScatter) {
        particle.fx = (Math.random() - 0.5) * fieldWidth;
        particle.fy = (Math.random() - 0.5) * fieldHeight;
        particle.needsScatter = false;
      } else if (delta.a !== 1 || delta.b !== 0 || delta.ox !== 0 || delta.oy !== 0) {
        var priorX = particle.fx;
        particle.fx = delta.a * priorX - delta.b * particle.fy + delta.ox;
        particle.fy = delta.b * priorX + delta.a * particle.fy + delta.oy;
      }

      // depthScale near 0 = distant (small, slow, faint), near 1 = close.
      var depthScale = 1 - config.depthVariation * (1 - particle.depth);
      var size = (config.minSize + sizeSpan * particle.depth) * depthScale;
      var speed = (config.minSpeed + speedSpan * particle.speedJitter) * depthScale;

      var angle = baseAngle
        + ((config.windSpread * particle.angleJitter) * Math.PI) / 180
        + gust * 0.45;
      var dirX = Math.cos(angle);
      var dirY = Math.sin(angle);

      var moveX = dirX * speed;
      var moveY = dirY * speed;

      if (config.swayAmount > 0 && config.swaySpeed > 0) {
        var oldPhase = particle.swayPhase;
        particle.swayPhase += (config.swaySpeed / 100) * particle.swayRate * deltaSeconds * TWO_PI;
        // Sway is applied across the direction of travel, so it reads as the particle being pushed
        // sideways by air rather than as a speed change.
        // Integrate a bounded lateral displacement, so the distance control really is pixels.
        // A second, independently phased frequency makes snow flutter irregularly.
        var irregularity = config.swayIrregularity;
        var flutterPhase = particle.angleJitter * Math.PI;
        var beforeSway = Math.sin(oldPhase) + irregularity * 0.5 * Math.sin(oldPhase * 1.73 + flutterPhase);
        var afterSway = Math.sin(particle.swayPhase) + irregularity * 0.5 * Math.sin(particle.swayPhase * 1.73 + flutterPhase);
        var sway = deltaSeconds > 0
          ? (afterSway - beforeSway) * config.swayAmount / (1 + irregularity * 0.5) / deltaSeconds : 0;
        moveX += -dirY * sway;
        moveY += dirX * sway;
      }

      particle.fx += moveX * deltaSeconds;
      particle.fy += moveY * deltaSeconds;

      particle.fx = wrapSigned(particle.fx, fieldWidth);
      particle.fy = wrapSigned(particle.fy, fieldHeight);

      var outX = particle.fx;
      var outY = particle.fy;
      if (config.pixelSnap) {
        outX = Math.round(outX);
        outY = Math.round(outY);
      }

      var sprite = particle.sprite;
      sprite.x = fieldToWorldX(camera, outX, outY);
      sprite.y = fieldToWorldY(camera, outX, outY);
      sprite.tint = config.colorHex;
      sprite.blendMode = blendMode;
      sprite.alpha = alphaBase * particle.alphaJitter * depthScale;

      // Sizes are authored in screen pixels but written into a container the camera scales by the
      // zoom, so dividing here is what makes the look hold across a zoom change.
      if (isRain) {
        var streakLength = config.streakLength > 0 ? config.streakLength : speed * 0.035;
        sprite.width = Math.max(0.5, config.streakWidth * depthScale) / camera.zoom;
        sprite.height = Math.max(1, streakLength) / camera.zoom;
        sprite.rotation = angle - Math.PI / 2 + camera.rotationRad;
      } else {
        var drawSize = size / camera.zoom;
        sprite.width = drawSize;
        sprite.height = drawSize;
        sprite.rotation = 0;
      }

      // Guard against a NaN camera (a layer deleted mid-frame) poisoning the sprite permanently.
      if (!isFinite(sprite.x) || !isFinite(sprite.y)) {
        sprite.x = 0;
        sprite.y = 0;
      }
    }

    system.lastRingConfig = config;
    if (system.pendingRipples && system.pendingRipples.length) {
      for (var q = 0; q < system.pendingRipples.length; q++) {
        var queued = system.pendingRipples[q];
        addRingAtWorld(system, camera, queued[0], queued[1], queued[2], config);
      }
      system.pendingRipples.length = 0;
    }

    stepSplashes(system, config, camera, deltaSeconds, intensity, fieldWidth, fieldHeight,
      halfFieldWidth, halfFieldHeight, alphaBase, delta);

    system.previousCamera = camera;
  }

  /**
   * Expanding rings. Used for two things: rain splashes, and the Ripples effect type, which is
   * nothing but rings.
   *
   * In a top-down game there is no ground line to test an impact against, so they are seeded
   * uniformly across the field at a rate proportional to the visible area - which is what rain
   * hitting open water actually looks like from above. Rings store their world position at birth.
   * They remain on the surface even when falling particles use Screen anchoring.
   */
  function stepSplashes(system, config, camera, deltaSeconds, intensity, fieldWidth, fieldHeight,
    halfFieldWidth, halfFieldHeight, alphaBase, delta) {
    // Gated on the RATE, not on the effect type: that is what lets Ripples be a type of its own and
    // still lets any other type carry splashes if its rate is raised.
    var wanted = (config.splashAmount > 0 || system.splashes.length > 0) && intensity > 0;

    if (!wanted) {
      if (system.splashes.length) {
        for (var c = 0; c < system.splashes.length; c++) {
          system.container.removeChild(system.splashes[c].sprite);
          system.splashes[c].sprite.destroy();
        }
        system.splashes.length = 0;
      }
      return;
    }

    if (!system.ringTexture) system.ringTexture = getRingTexture();

    var lifetime = config.splashLife;
    var fieldRatio = (fieldWidth * fieldHeight) / Math.max(1, camera.viewWidth * camera.viewHeight);
    system.splashCarry += config.splashAmount * intensity * fieldRatio * deltaSeconds;

    var toSpawn = Math.floor(system.splashCarry);
    system.splashCarry -= toSpawn;
    if (toSpawn > 60) toSpawn = 60;

    for (var s = 0; s < toSpawn; s++) {
      var sprite = new PIXI.Sprite(system.ringTexture);
      sprite.anchor.set(0.5);
      system.container.addChild(sprite);
      var ringFieldX = (Math.random() - 0.5) * fieldWidth;
      var ringFieldY = (Math.random() - 0.5) * fieldHeight;
      system.splashes.push({
        sprite: sprite,
        worldX: fieldToWorldX(camera, ringFieldX, ringFieldY),
        worldY: fieldToWorldY(camera, ringFieldX, ringFieldY),
        age: 0,
        maxRadius: randomRange(config.splashMinRadius, config.splashMaxRadius),
      });
    }

    for (var i = system.splashes.length - 1; i >= 0; i--) {
      var splash = system.splashes[i];
      splash.age += deltaSeconds;
      // A ring spawned on demand carries the lifetime it was born with, so changing the setting
      // mid-flight cannot strand one at a size it never fades out of.
      var ringLife = splash.life || lifetime;

      if (splash.age >= ringLife) {
        system.container.removeChild(splash.sprite);
        splash.sprite.destroy();
        system.splashes.splice(i, 1);
        continue;
      }

      var progress = splash.age / ringLife;
      var radius = splash.maxRadius * (0.25 + progress * 0.75);
      var splashSprite = splash.sprite;
      splashSprite.x = splash.worldX;
      splashSprite.y = splash.worldY;
      splashSprite.width = (radius * 2) / camera.zoom;
      splashSprite.height = (radius * 2) / camera.zoom;
      splashSprite.tint = config.colorHex;
      splashSprite.blendMode = config.additive ? PIXI.BLEND_MODES.ADD : PIXI.BLEND_MODES.NORMAL;
      splashSprite.alpha = alphaBase * (1 - progress) * 0.8;
    }
  }

  function registerEmitter(runtimeScene, key, options) {
    var state = getSceneState(runtimeScene);
    var systemKey = resolveKey(key);
    if (state.emitters[systemKey]) return;

    var config = normalizeEmitterOptions(options);
    var system = createEmitterSystem(runtimeScene, config.layerName);
    if (!system) return;
    state.emitters[systemKey] = system;
  }

  /**
   * Free-function entry point: start (or reconfigure) the one emitter that belongs to a layer.
   *
   * Unlike the behaviour path, nothing here is called again next frame - so the options are stored
   * on the system and a scene post-events callback drives it. One action starts weather and it
   * keeps running, rather than the caller having to remember an "update every frame" event, which
   * is the step everybody forgets and then reports as "the effect is frozen".
   */
  function startWeather(runtimeScene, layerName, options) {
    var state = getSceneState(runtimeScene);
    var systemKey = resolveKey(layerName || '');
    var config = normalizeEmitterOptions(options);

    var system = state.emitters[systemKey];
    if (system && system.layerName !== config.layerName) {
      disposeEmitter(runtimeScene, layerName || '');
      system = null;
    }
    if (!system) {
      system = createEmitterSystem(runtimeScene, config.layerName);
      if (!system) return;
      state.emitters[systemKey] = system;
    }

    // Store the raw options, not the normalised ones: a later "set wind" action merges into these,
    // and merging into normalised values would bake this frame's preset fallbacks in permanently.
    system.autoOptions = system.autoOptions || {};
    var incoming = options || {};
    for (var field in incoming) {
      if (Object.prototype.hasOwnProperty.call(incoming, field) && incoming[field] !== undefined) {
        system.autoOptions[field] = incoming[field];
      }
    }
    system.autoKey = systemKey;
  }

  function startDistortion(runtimeScene, layerName, options) {
    var state = getSceneState(runtimeScene);
    var systemKey = resolveKey(layerName || '');
    var config = normalizeDistortionOptions(options);

    var system = state.distortions[systemKey];
    if (system && system.layerName !== config.layerName) {
      disposeDistortion(runtimeScene, layerName || '');
      system = null;
    }
    if (!system) {
      system = createDistortionSystem(runtimeScene, config);
      if (!system) return;
      state.distortions[systemKey] = system;
    }

    system.autoOptions = system.autoOptions || {};
    var incoming = options || {};
    for (var field in incoming) {
      if (Object.prototype.hasOwnProperty.call(incoming, field) && incoming[field] !== undefined) {
        system.autoOptions[field] = incoming[field];
      }
    }
    system.autoKey = systemKey;
  }

  /** Drives every free-function system. Behaviour-owned systems step from doStepPreEvents instead. */
  function stepAutoSystems(runtimeScene) {
    var state = runtimeScene.__weatherFX2D;
    if (!state) return;

    var emitterKeys = Object.keys(state.emitters);
    for (var e = 0; e < emitterKeys.length; e++) {
      var emitter = state.emitters[emitterKeys[e]];
      if (emitter && emitter.autoOptions) {
        stepEmitterByKey(runtimeScene, emitterKeys[e], emitter.autoOptions);
      }
    }

    var distortionKeys = Object.keys(state.distortions);
    for (var d = 0; d < distortionKeys.length; d++) {
      var distortion = state.distortions[distortionKeys[d]];
      if (distortion && distortion.autoOptions) {
        stepDistortionByKey(runtimeScene, distortionKeys[d], distortion.autoOptions);
      }
    }
  }

  function disposeEmitter(runtimeScene, key) {
    var state = getSceneState(runtimeScene);
    var systemKey = resolveKey(key);
    var system = state.emitters[systemKey];
    if (!system) return;

    for (var i = 0; i < system.particles.length; i++) {
      var sprite = system.particles[i].sprite;
      if (sprite) {
        system.container.removeChild(sprite);
        sprite.destroy();
      }
    }
    for (var s = 0; s < system.splashes.length; s++) {
      system.container.removeChild(system.splashes[s].sprite);
      system.splashes[s].sprite.destroy();
    }
    system.particles.length = 0;
    system.splashes.length = 0;

    if (system.container && system.container.parent) {
      system.container.parent.removeChild(system.container);
    }
    if (system.container) system.container.destroy({ children: true });

    delete state.emitters[systemKey];
  }

  /**
   * Spawns one expanding ring at a point in SCENE coordinates.
   *
   * Needs a camera to convert with, and the emitter only has one after its first step - so before
   * that, the ring is queued rather than dropped. Otherwise a ripple fired from an "at the
   * beginning of the scene" event would silently never appear.
   */
  function spawnParticleRipple(runtimeScene, key, worldX, worldY, radiusScale) {
    var state = getSceneState(runtimeScene);
    var system = state.emitters[resolveKey(key)];
    if (!system || !PIXI_OK) return;

    var camera = system.previousCamera;
    if (!camera) {
      system.pendingRipples = system.pendingRipples || [];
      if (system.pendingRipples.length < 64) {
        system.pendingRipples.push([toNumber(worldX, 0), toNumber(worldY, 0), toNumber(radiusScale, 1)]);
      }
      return;
    }

    addRingAtWorld(system, camera, toNumber(worldX, 0), toNumber(worldY, 0),
      toNumber(radiusScale, 1), system.lastRingConfig);
  }

  function addRingAtWorld(system, camera, worldX, worldY, radiusScale, config) {
    if (!system.ringTexture) system.ringTexture = getRingTexture();
    var settings = config || { splashMinRadius: 14, splashMaxRadius: 46, splashLife: 2.2 };

    var sprite = new PIXI.Sprite(system.ringTexture);
    sprite.anchor.set(0.5);
    system.container.addChild(sprite);

    var scale = radiusScale > 0 ? radiusScale : 1;
    system.splashes.push({
      sprite: sprite,
      worldX: worldX,
      worldY: worldY,
      age: 0,
      life: settings.splashLife,
      maxRadius: randomRange(settings.splashMinRadius, settings.splashMaxRadius) * scale,
    });
  }

  function getParticleCount(runtimeScene, key) {
    var state = getSceneState(runtimeScene);
    var system = state.emitters[resolveKey(key)];
    return system ? system.particles.length : 0;
  }

  /* ============================================================== Distortion filter */

  var MAX_RIPPLES = 12;

  /**
   * Resolution-independent by construction.
   *
   * `screenPx` is recovered from PIXI's own automatic uniforms rather than from vTextureCoord's
   * range, so the shader behaves identically whether PIXI handed it an exact-fit screen texture or
   * a power-of-two one. Every amplitude and wavelength below is in real screen pixels for the same
   * reason. `highp` is required, not cosmetic: world coordinates run past mediump's exact range
   * (~2048) within a screen or two of the origin, and the result is visible stair-stepping.
   */
  var DISTORTION_FRAGMENT_SHADER = [
    'precision highp float;',
    '',
    'varying vec2 vTextureCoord;',
    'uniform sampler2D uSampler;',
    '',
    '// Supplied automatically by PIXI for every filter.',
    'uniform vec4 inputSize;',
    'uniform vec4 outputFrame;',
    'uniform vec4 inputClamp;',
    '',
    'uniform vec4 uPhase;',
    'uniform vec2 uOrigin;',
    'uniform vec2 uWavelength;',
    'uniform float uStrength;',
    'uniform float uDetail;',
    'uniform float uMode;',
    'uniform float uHorizon;',
    'uniform float uViewHeight;',
    '',
    'uniform float uTearStrength;',
    'uniform float uTearWidth;',
    'uniform float uTearBands;',
    'uniform float uMagnification;',
    'uniform float uBandWidth;',
    '',
    'uniform vec3 uRipples[' + MAX_RIPPLES + '];',
    'uniform float uRippleCount;',
    'uniform float uRippleStrength;',
    'uniform float uRippleSpeed;',
    'uniform float uRippleWidth;',
    'uniform float uRippleLife;',
    '',
    'const float TAU = 6.2831853;',
    '',
    '// Wrapping the lattice keeps the sin() argument small enough to stay exact at highp, AND makes',
    '// the noise tile every 4096 cells - which is what lets the world-anchored origin fold with no',
    '// visible seam. Without the mod, a shimmer several screens from the origin degrades into',
    '// obvious repeating blocks as the hash loses precision.',
    'float hash(vec2 cell) {',
    '    cell = mod(cell, 4096.0);',
    '    return fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453123);',
    '}',
    '',
    'float valueNoise(vec2 point) {',
    '    vec2 cell = floor(point);',
    '    vec2 f = fract(point);',
    '    vec2 smoothed = f * f * (3.0 - 2.0 * f);',
    '    return mix(mix(hash(cell), hash(cell + vec2(1.0, 0.0)), smoothed.x),',
    '               mix(hash(cell + vec2(0.0, 1.0)), hash(cell + vec2(1.0, 1.0)), smoothed.x),',
    '               smoothed.y);',
    '}',
    '',
    'float fbm(vec2 point) {',
    '    float total = 0.0;',
    '    float amplitude = 0.5;',
    '    for (int octave = 0; octave < 4; octave++) {',
    '        total += valueNoise(point) * amplitude;',
    '        point *= 2.0;',
    '        amplitude *= 0.5;',
    '    }',
    '    return total;',
    '}',
    '',
    'float wrapSigned(float value, float span) {',
    '    float halfSpan = span * 0.5;',
    '    return mod(value + halfSpan, span) - halfSpan;',
    '}',
    '',
    'void main(void) {',
    '    vec2 screenPx = vTextureCoord * inputSize.xy + outputFrame.xy;',
    '    vec2 p = screenPx + uOrigin;',
    '',
    '    vec2 k = TAU / max(uWavelength, vec2(1.0));',
    '    float height = clamp(screenPx.y / max(uViewHeight, 1.0), 0.0, 1.0);',
    '    vec2 offset = vec2(0.0);',
    '',
    '    if (uMode < 1.5) {',
    '        // Standing waves: world position sets the shape; time sets oscillation independently.',
    '        offset.x = sin(p.y * k.y) * sin(uPhase.x) * uStrength;',
    '        offset.x += sin(p.y * k.y * 2.3) * sin(uPhase.z) * uStrength * uDetail;',
    '',
    '        // Heat rises, so its vertical component stays small and the image shimmers sideways',
    '        // rather than swimming. Underwater uses the full amplitude on both axes.',
    '        float verticalScale = uMode < 0.5 ? 0.35 : 1.0;',
    '        offset.y = sin(p.x * k.x) * sin(uPhase.y) * uStrength * verticalScale;',
    '        offset.y += sin(p.x * k.x * 2.7) * sin(uPhase.w) * uStrength * uDetail * verticalScale;',
    '',
    '        if (uMode < 0.5) offset *= mix(1.0, height, uHorizon);',
    '    } else if (uMode > 2.5 && uMode < 3.5) {',
    '        // 3 Heat Shimmer - fractal noise flow, the turbulent cousin of the sine wave.',
    '        vec2 flow = vec2(p.x / max(uWavelength.x, 1.0), p.y / max(uWavelength.y, 1.0));',
    '',
    '        // Rows sample the noise field at different offsets so it does not slide as one sheet.',
    '        // This is deliberately an OFFSET, not a per-row speed multiplier: a rate that varies by',
    '        // row cannot fold seamlessly, because the fold would shift each row by a different',
    '        // amount. Offsetting keeps every row locked to the 4096-cell noise tile.',
    '        // Keep the noise field fixed in world space; animate its amplitude, not its position.',
    '        flow.y -= sin(p.y * k.y) * uDetail * 2.0;',
    '',
    '        offset.x = (fbm(flow) - 0.5) * 2.0 * uStrength * sin(uPhase.x);',
    '        offset.y = (fbm(flow + 10.0) - 0.5) * 2.0 * uStrength * 0.35 * sin(uPhase.y);',
    '        offset *= mix(1.0, height, uHorizon);',
    '    } else if (uMode > 3.5 && uMode < 4.5) {',
    '        // 4 Tear Lines - a smooth ambient wave plus hard-edged bands that jump sideways.',
    '        offset.x = sin(p.y * k.y) * sin(uPhase.x) * uStrength;',
    '',
    '        // Quantising in PHASE space rather than in pixels is what keeps the strips seamless',
    '        // across the world-anchoring fold: phase is periodic, world Y is not.',
    '        float phase = p.y / max(uWavelength.y, 1.0) + uPhase.y / TAU;',
    '        if (uTearBands > 0.0) phase = floor(phase * uTearBands) / uTearBands;',
    '        offset.x += step(fract(phase), uTearWidth) * uTearStrength;',
    '    } else if (uMode > 4.5) {',
    '        // 5 Magnifier Band - a travelling band that locally stretches the image through it.',
    '        float spacing = max(uWavelength.y, 1.0);',
    '        float delta = wrapSigned(p.y - (uPhase.y / TAU) * spacing, spacing);',
    '        float influence = 1.0 - smoothstep(0.0, max(uBandWidth, 1.0), abs(delta));',
    '        float zoom = mix(1.0, max(uMagnification, 0.01), influence);',
    '        offset.y = delta / zoom - delta;',
    '    }',
    '',
    '    for (int i = 0; i < ' + MAX_RIPPLES + '; i++) {',
    '        if (float(i) >= uRippleCount) break;',
    '        vec3 ripple = uRipples[i];',
    '        if (ripple.z < 0.0) continue;',
    '',
    '        vec2 toCentre = screenPx - ripple.xy;',
    '        float dist = length(toCentre);',
    '        float radius = ripple.z * uRippleSpeed;',
    '        float band = 1.0 - clamp(abs(dist - radius) / max(uRippleWidth, 1.0), 0.0, 1.0);',
    '        if (band <= 0.0) continue;',
    '',
    '        float fade = 1.0 - clamp(ripple.z / max(uRippleLife, 0.001), 0.0, 1.0);',
    '        // Squared band gives the ring a soft shoulder instead of a hard edge.',
    '        float amount = band * band * fade * uRippleStrength;',
    '        offset += normalize(toCentre + vec2(0.0001)) * amount;',
    '    }',
    '',
    '    vec2 uv = vTextureCoord + offset * inputSize.zw;',
    '    gl_FragColor = texture2D(uSampler, clamp(uv, inputClamp.xy, inputClamp.zw));',
    '}',
  ].join('\n');

  var DISTORTION_MODES = {
    'Heat Haze': 0,
    Underwater: 1,
    'Ripples Only': 2,
    'Heat Shimmer': 3,
    'Tear Lines': 4,
    'Magnifier Band': 5,
  };

  /**
   * Heat Shimmer's noise field tiles every 4096 cells (see hash() in the shader), so its world
   * origin folds at 4096 wavelengths and the fold is invisible. Every other mode is built from
   * periodic functions whose harmonics are 2.3x and 2.7x the base, and ten of each is 23 and 27
   * whole cycles - so ten wavelengths is the seamless fold there.
   */
  function originFoldMultiplier(modeValue) {
    return modeValue === 3 ? 4096 : 10;
  }

  /**
   * Heat Shimmer scrolls its noise by one cell per turn of the phase, so its phase has to run to
   * 4096 turns before folding or the noise would jump. Everything else is a sine and folds at one.
   */
  function phaseFoldSpan(modeValue) {
    return modeValue === 3 ? TWO_PI * 4096 : TWO_PI;
  }

  /**
   * Mode defaults, filled in for any option the caller leaves undefined - the same contract the
   * particle presets use, so "pick a mode and it looks right" holds for both subsystems.
   *
   * Heat haze shimmers sideways in short, fast waves; underwater swims slowly on both axes with a
   * long wavelength; ripples-only leaves the standing wave off entirely so nothing moves until
   * something is dropped in the water.
   */
  var DISTORTION_PRESETS = {
    'Heat Haze': {
      strength: 4, wavelengthX: 160, wavelengthY: 55, speed: 1.1, detail: 0.4,
      riseSpeed: 1.6, horizonFade: 0.55,
      rippleStrength: 8, rippleSpeed: 260, rippleLife: 1.6, rippleWidth: 30,
      tearStrength: 0, tearWidth: 0.3, tearStripHeight: 0,
      magnification: 1.3, bandWidth: 60,
    },
    Underwater: {
      strength: 9, wavelengthX: 220, wavelengthY: 190, speed: 0.55, detail: 0.3,
      riseSpeed: 1, horizonFade: 0,
      rippleStrength: 10, rippleSpeed: 220, rippleLife: 2, rippleWidth: 40,
      tearStrength: 0, tearWidth: 0.3, tearStripHeight: 0,
      magnification: 1.3, bandWidth: 60,
    },
    'Ripples Only': {
      strength: 0, wavelengthX: 120, wavelengthY: 120, speed: 1, detail: 0,
      riseSpeed: 1, horizonFade: 0,
      rippleStrength: 12, rippleSpeed: 300, rippleLife: 1.4, rippleWidth: 26,
      tearStrength: 0, tearWidth: 0.3, tearStripHeight: 0,
      magnification: 1.3, bandWidth: 60,
    },
    'Heat Shimmer': {
      strength: 5, wavelengthX: 240, wavelengthY: 150, speed: 0.45, detail: 0.5,
      riseSpeed: 1, horizonFade: 0.6,
      rippleStrength: 8, rippleSpeed: 260, rippleLife: 1.6, rippleWidth: 30,
      tearStrength: 0, tearWidth: 0.3, tearStripHeight: 0,
      magnification: 1.3, bandWidth: 60,
    },
    'Tear Lines': {
      strength: 2, wavelengthX: 160, wavelengthY: 90, speed: 0.35, detail: 0,
      riseSpeed: 1, horizonFade: 0,
      rippleStrength: 8, rippleSpeed: 260, rippleLife: 1.6, rippleWidth: 30,
      tearStrength: 7, tearWidth: 0.35, tearStripHeight: 4,
      magnification: 1.3, bandWidth: 60,
    },
    'Magnifier Band': {
      strength: 0, wavelengthX: 160, wavelengthY: 420, speed: 0.25, detail: 0,
      riseSpeed: 1, horizonFade: 0,
      rippleStrength: 8, rippleSpeed: 260, rippleLife: 1.6, rippleWidth: 30,
      tearStrength: 0, tearWidth: 0.3, tearStripHeight: 0,
      magnification: 1.35, bandWidth: 70,
    },
  };

  /**
   * How much of the camera's movement the wave pattern is dragged along by, 0 to 1.
   *
   * At 1 the pattern is glued to the map, which is right for something painted on the ground and
   * wrong for something hanging in the air: walking then ADDS to the apparent animation speed,
   * because you are travelling through a stationary pattern. That coupling is tight in inverse
   * proportion to the wavelength, so Heat Haze - whose vertical wavelength is only 55px - visibly
   * speeds up as soon as you walk vertically, while horizontal movement barely shows.
   *
   * A fraction reads as parallax: the shimmer belongs to the scene without racing when you move.
   * `anchoring` is still honoured for callers that pass the old binary form.
   */
  function resolveWorldFollow(source) {
    if (source.worldFollow !== undefined && source.worldFollow !== null) {
      return clamp(toNumber(source.worldFollow, 1), 0, 1);
    }
    if (source.anchoring === 'Screen') return 0;
    if (source.anchoring === 'World') return 1;
    return 1;
  }

  function normalizeDistortionOptions(options) {
    var source = options || {};
    var mode = DISTORTION_MODES[source.mode] === undefined ? 'Heat Haze' : source.mode;
    var preset = DISTORTION_PRESETS[mode];

    var pick = function (field) {
      return source[field] === undefined || source[field] === null ? preset[field] : source[field];
    };

    return {
      mode: mode,
      modeValue: DISTORTION_MODES[mode],
      layerName: source.layerName || '',
      enabled: source.enabled === undefined ? true : !!source.enabled,
      anchoring: source.anchoring === 'Screen' ? 'Screen' : 'World',
      worldFollow: resolveWorldFollow(source),
      intensity: Math.max(0, toNumber(source.intensity, 1)),
      strength: Math.max(0, toNumber(pick('strength'), 6)),
      wavelengthX: Math.max(1, toNumber(pick('wavelengthX'), 90)),
      wavelengthY: Math.max(1, toNumber(pick('wavelengthY'), 140)),
      speed: toNumber(pick('speed'), 1),
      detail: clamp(toNumber(pick('detail'), 0.35), 0, 1),
      riseSpeed: toNumber(pick('riseSpeed'), 1),
      horizonFade: clamp(toNumber(pick('horizonFade'), 0), 0, 1),
      rippleStrength: Math.max(0, toNumber(pick('rippleStrength'), 8)),
      rippleSpeed: Math.max(1, toNumber(pick('rippleSpeed'), 260)),
      rippleLife: Math.max(0.05, toNumber(pick('rippleLife'), 1.6)),
      rippleWidth: Math.max(1, toNumber(pick('rippleWidth'), 30)),
      tearStrength: toNumber(pick('tearStrength'), 0),
      tearWidth: clamp(toNumber(pick('tearWidth'), 0.3), 0, 1),
      tearStripHeight: Math.max(0, toNumber(pick('tearStripHeight'), 0)),
      magnification: Math.max(0.05, toNumber(pick('magnification'), 1.3)),
      bandWidth: Math.max(1, toNumber(pick('bandWidth'), 60)),
    };
  }

  /**
   * Strips are authored in pixels because that is what an author can see, but the shader quantises
   * in phase space - so the count has to be a whole number of strips per tear cycle, or the last
   * strip in each cycle would be a different height from the rest and the seam would show.
   */
  function tearBandCount(config) {
    if (!(config.tearStripHeight > 0)) return 0;
    return Math.max(1, Math.round(config.wavelengthY / config.tearStripHeight));
  }

  function createDistortionSystem(runtimeScene, config) {
    if (!PIXI_OK) return null;
    var camera = sampleCamera(runtimeScene, config.layerName);
    if (!camera.layer) return null;

    var renderer = camera.layer.getRenderer();
    if (!renderer || typeof renderer.getRendererObject !== 'function') return null;
    var layerContainer = renderer.getRendererObject();
    if (!layerContainer) return null;

    var filter = new PIXI.Filter(undefined, DISTORTION_FRAGMENT_SHADER, {
      uPhase: new Float32Array([0, 0, 0, 0]),
      uOrigin: new Float32Array([0, 0]),
      uWavelength: new Float32Array([config.wavelengthX, config.wavelengthY]),
      uStrength: config.strength,
      uDetail: config.detail,
      uMode: config.modeValue,
      uHorizon: config.horizonFade,
      uViewHeight: camera.viewHeight,
      uRipples: new Float32Array(MAX_RIPPLES * 3),
      uRippleCount: 0,
      uRippleStrength: config.rippleStrength,
      uRippleSpeed: config.rippleSpeed,
      uRippleWidth: config.rippleWidth,
      uRippleLife: config.rippleLife,
      uTearStrength: config.tearStrength,
      uTearWidth: config.tearWidth,
      uTearBands: tearBandCount(config),
      uMagnification: config.magnification,
      uBandWidth: config.bandWidth,
    });

    // Zero padding keeps the requested frame exactly the screen. Any padding at all pushes the
    // request off PIXI's SCREEN_KEY fast path and back onto next-power-of-two allocation, which is
    // the thing this whole design exists to avoid.
    filter.padding = 0;

    // Append rather than assign: GDevelop initialises every layer container with `filters = []`
    // and the layer effects panel may already have put its own filters there.
    layerContainer.filters = layerContainer.filters
      ? layerContainer.filters.concat(filter)
      : [filter];

    return {
      layerName: config.layerName,
      layerContainer: layerContainer,
      filter: filter,
      ripples: [],
      phase: [0, 0, 0, 0],
    };
  }

  function detachDistortionFilter(system) {
    var container = system.layerContainer;
    if (container && container.filters) {
      var kept = [];
      for (var i = 0; i < container.filters.length; i++) {
        if (container.filters[i] !== system.filter) kept.push(container.filters[i]);
      }
      container.filters = kept;
    }
  }

  function stepDistortion(runtimeScene, key, options) {
    stepDistortionByKey(runtimeScene, resolveKey(key), options);
  }

  function stepDistortionByKey(runtimeScene, systemKey, options) {
    var state = getSceneState(runtimeScene);
    var config = normalizeDistortionOptions(options);
    var system = state.distortions[systemKey];
    if (!system) return;

    if (system.layerName !== config.layerName) {
      var carriedRipples = system.ripples;
      var carriedAutoOptions = system.autoOptions;
      detachDistortionFilter(system);
      delete state.distortions[systemKey];
      var rebuilt = createDistortionSystem(runtimeScene, config);
      if (!rebuilt) return;
      rebuilt.ripples = carriedRipples;
      rebuilt.autoOptions = carriedAutoOptions;
      state.distortions[systemKey] = rebuilt;
      system = rebuilt;
    }

    var camera = sampleCamera(runtimeScene, config.layerName);
    if (!camera.layer) return;

    var layerContainer = camera.layer.getRenderer().getRendererObject();
    if (!layerContainer) return;

    // Toggling a layer effect in the editor replaces the filter array wholesale. Re-attach instead
    // of quietly stopping.
    var stillAttached = layerContainer.filters && layerContainer.filters.indexOf(system.filter) !== -1;
    if (!stillAttached) {
      layerContainer.filters = layerContainer.filters
        ? layerContainer.filters.concat(system.filter)
        : [system.filter];
      system.layerContainer = layerContainer;
    }

    var enabled = config.enabled && !state.paused;
    system.filter.enabled = enabled;
    if (!enabled) return;

    var intensity = clamp(state.globalIntensity, 0, 1);

    // THE fix for the snap. `renderer.screen` is exactly the screen rectangle, so PIXI's texture
    // pool returns its exact-fit SCREEN_KEY texture every frame instead of sizing the framebuffer
    // from whatever scene content happens to be on the layer.
    var pixiRenderer = runtimeScene.getGame().getRenderer().getPIXIRenderer();
    if (pixiRenderer && pixiRenderer.screen) {
      layerContainer.filterArea = pixiRenderer.screen;
    }

    var deltaSeconds = runtimeScene.getTimeManager().getElapsedTime() / 1000;
    if (!(deltaSeconds > 0)) deltaSeconds = 0;
    if (deltaSeconds > 0.1) deltaSeconds = 0.1;

    // Each harmonic advances its own phase, every one folded to [0, 2pi). Accumulating a single
    // `time` uniform instead would eventually lose float precision and, once wrapped, pop.
    var rate = config.speed * (config.modeValue === 0 ? config.riseSpeed : 1);
    var rates = [rate, config.speed * 0.85, config.speed * 1.7, config.speed * 1.3];
    // Tear Lines and Magnifier Band both scroll a single band down the screen, and both read that
    // position out of uPhase.y - so it advances at the plain speed rather than the 0.85 offset the
    // sine modes use to keep their two axes from beating against each other.
    if (config.modeValue === 4 || config.modeValue === 5) rates[1] = config.speed;
    var phaseSpan = phaseFoldSpan(config.modeValue);
    for (var p = 0; p < 4; p++) {
      system.phase[p] = wrapPositive(system.phase[p] + rates[p] * deltaSeconds * TWO_PI, phaseSpan);
    }

    var uniforms = system.filter.uniforms;
    uniforms.uPhase[0] = system.phase[0];
    uniforms.uPhase[1] = system.phase[1];
    uniforms.uPhase[2] = system.phase[2];
    uniforms.uPhase[3] = system.phase[3];

    // World anchoring: the world position of the screen's top-left corner, folded to ten
    // wavelengths. Ten is not arbitrary - the harmonics are 2.3x and 2.7x the base, and ten of each
    // is 23 and 27 whole cycles, so the fold is seamless for all three waves at once.
    var originX = 0;
    var originY = 0;
    if (config.worldFollow > 0) {
      // The follow amount is applied BEFORE the fold, not after. Scaling a folded value would move
      // the fold off the wavelength boundary it has to sit on, and put a visible seam in the world.
      var fold = originFoldMultiplier(config.modeValue);
      var topLeftX = (camera.x - camera.viewWidth / (2 * camera.zoom)) * config.worldFollow;
      var topLeftY = (camera.y - camera.viewHeight / (2 * camera.zoom)) * config.worldFollow;
      originX = wrapPositive(topLeftX, config.wavelengthX * fold);
      originY = wrapPositive(topLeftY, config.wavelengthY * fold);
    }
    uniforms.uOrigin[0] = originX;
    uniforms.uOrigin[1] = originY;

    uniforms.uWavelength[0] = config.wavelengthX;
    uniforms.uWavelength[1] = config.wavelengthY;
    uniforms.uStrength = config.strength * config.intensity * intensity;
    uniforms.uDetail = config.detail;
    uniforms.uMode = config.modeValue;
    uniforms.uHorizon = config.horizonFade;
    uniforms.uViewHeight = camera.viewHeight;
    uniforms.uRippleStrength = config.rippleStrength * config.intensity * intensity;
    uniforms.uRippleSpeed = config.rippleSpeed;
    uniforms.uRippleWidth = config.rippleWidth;
    uniforms.uRippleLife = config.rippleLife;
    uniforms.uTearStrength = config.tearStrength * config.intensity * intensity;
    uniforms.uTearWidth = config.tearWidth;
    uniforms.uTearBands = tearBandCount(config);
    // Magnification is a ratio, so intensity has to scale its DISTANCE FROM 1, not the value.
    uniforms.uMagnification = 1 + (config.magnification - 1) * config.intensity * intensity;
    uniforms.uBandWidth = config.bandWidth;

    stepRipples(system, config, camera, deltaSeconds);
  }

  function stepRipples(system, config, camera, deltaSeconds) {
    var ripples = system.ripples;
    var uniforms = system.filter.uniforms;
    var packed = uniforms.uRipples;

    var live = 0;
    for (var i = ripples.length - 1; i >= 0; i--) {
      var ripple = ripples[i];
      ripple.age += deltaSeconds;
      if (ripple.age >= config.rippleLife) {
        ripples.splice(i, 1);
      }
    }

    for (var r = 0; r < ripples.length && live < MAX_RIPPLES; r++) {
      var entry = ripples[r];

      // Ripple centres are stored in world coordinates and converted to screen pixels here, so a
      // ripple stays over the puddle that spawned it while the camera moves.
      var ex = (entry.worldX - camera.x) * camera.zoom;
      var ey = (entry.worldY - camera.y) * camera.zoom;
      var screenX;
      var screenY;
      if (camera.rotationRad) {
        var cos = Math.cos(-camera.rotationRad);
        var sin = Math.sin(-camera.rotationRad);
        screenX = cos * ex - sin * ey;
        screenY = sin * ex + cos * ey;
      } else {
        screenX = ex;
        screenY = ey;
      }

      packed[live * 3] = screenX + camera.viewWidth / 2;
      packed[live * 3 + 1] = screenY + camera.viewHeight / 2;
      packed[live * 3 + 2] = entry.age;
      live++;
    }

    for (var pad = live; pad < MAX_RIPPLES; pad++) {
      packed[pad * 3] = 0;
      packed[pad * 3 + 1] = 0;
      packed[pad * 3 + 2] = -1;
    }

    uniforms.uRippleCount = live;
  }

  function registerDistortion(runtimeScene, key, options) {
    var state = getSceneState(runtimeScene);
    var systemKey = resolveKey(key);
    if (state.distortions[systemKey]) return;

    var config = normalizeDistortionOptions(options);
    var system = createDistortionSystem(runtimeScene, config);
    if (!system) return;
    state.distortions[systemKey] = system;
  }

  function disposeDistortion(runtimeScene, key) {
    var state = getSceneState(runtimeScene);
    var systemKey = resolveKey(key);
    var system = state.distortions[systemKey];
    if (!system) return;

    detachDistortionFilter(system);

    // Only drop filterArea once nothing else is filtering this container, or a second distortion on
    // the same layer would lose its pinned frame and start snapping again.
    var container = system.layerContainer;
    if (container && (!container.filters || container.filters.length === 0)) {
      container.filterArea = null;
    }

    if (system.filter && typeof system.filter.destroy === 'function') system.filter.destroy();
    delete state.distortions[systemKey];
  }

  /**
   * `worldX` / `worldY` are scene coordinates, matching what Object.X() and CursorX() return, so
   * spawning a ripple under a footstep needs no conversion at the call site.
   */
  function spawnRipple(runtimeScene, key, worldX, worldY, strengthScale) {
    var state = getSceneState(runtimeScene);
    var system = state.distortions[resolveKey(key)];
    if (!system) return;

    if (system.ripples.length >= MAX_RIPPLES) {
      // Drop the oldest: a new impact is what the player just caused, so it is the one to show.
      system.ripples.shift();
    }
    system.ripples.push({
      worldX: toNumber(worldX, 0),
      worldY: toNumber(worldY, 0),
      age: 0,
      scale: toNumber(strengthScale, 1),
    });
  }

  function getRippleCount(runtimeScene, key) {
    var state = getSceneState(runtimeScene);
    var system = state.distortions[resolveKey(key)];
    return system ? system.ripples.length : 0;
  }

  /* ============================================================== Settings by name */

  var WEATHER_NUMBER_FIELDS = {
    'Intensity': 'intensity',
    'Density': 'density',
    'Minimum size': 'minSize',
    'Maximum size': 'maxSize',
    'Softness': 'softness',
    'Minimum speed': 'minSpeed',
    'Maximum speed': 'maxSpeed',
    'Wind angle': 'windAngle',
    'Wind spread': 'windSpread',
    'Gust strength': 'gustStrength',
    'Sway distance': 'swayAmount',
    'Sway speed': 'swaySpeed',
    'Sway irregularity': 'swayIrregularity',
    'Opacity': 'opacity',
    'Depth variation': 'depthVariation',
    'Rain streak width': 'streakWidth',
    'Rain streak length': 'streakLength',
    'Rings per second': 'splashAmount',
    'Ring minimum radius': 'splashMinRadius',
    'Ring maximum radius': 'splashMaxRadius',
    'Ring lifetime': 'splashLife',
    'Draw order': 'zOrder',
  };

  var WEATHER_FLAG_FIELDS = {
    'Enabled': 'enabled',
    'Additive blending': 'additive',
    'Snap to whole pixels': 'pixelSnap',
  };

  var DISTORTION_NUMBER_FIELDS = {
    'Intensity': 'intensity',
    'Wave strength': 'strength',
    'Wavelength across': 'wavelengthX',
    'Wavelength down': 'wavelengthY',
    'Wave speed': 'speed',
    'Secondary detail': 'detail',
    'Heat rise speed': 'riseSpeed',
    'Fade toward top': 'horizonFade',
    'World follow': 'worldFollow',
    'Ripple strength': 'rippleStrength',
    'Ripple expansion speed': 'rippleSpeed',
    'Ripple lifetime': 'rippleLife',
    'Ripple ring thickness': 'rippleWidth',
    'Tear line offset': 'tearStrength',
    'Tear line coverage': 'tearWidth',
    'Tear strip height': 'tearStripHeight',
    'Magnification': 'magnification',
    'Magnifier band thickness': 'bandWidth',
  };

  var DISTORTION_FLAG_FIELDS = {
    'Enabled': 'enabled',
  };

  /**
   * Writes one field into a layer-keyed system's stored options.
   *
   * Deliberately a no-op when nothing has been started on that layer: a "set density" action that
   * quietly conjures snowfall out of nowhere would be a worse surprise than one that does nothing
   * until you start the weather first.
   */
  function applyOption(runtimeScene, collection, layerName, fieldMap, label, value) {
    var state = getSceneState(runtimeScene);
    var system = state[collection][resolveKey(layerName || '')];
    if (!system || !system.autoOptions) return false;

    var field = fieldMap[label];
    if (!field) return false;

    system.autoOptions[field] = value;
    return true;
  }

  function setWeatherSetting(runtimeScene, layerName, label, value) {
    return applyOption(runtimeScene, 'emitters', layerName, WEATHER_NUMBER_FIELDS,
      label, toNumber(value, 0));
  }

  function setWeatherFlag(runtimeScene, layerName, label, value) {
    return applyOption(runtimeScene, 'emitters', layerName, WEATHER_FLAG_FIELDS, label, !!value);
  }

  function setWeatherType(runtimeScene, layerName, typeName) {
    if (!PRESETS[typeName]) return false;
    var state = getSceneState(runtimeScene);
    var system = state.emitters[resolveKey(layerName || '')];
    if (!system || !system.autoOptions) return false;

    // Switching type has to drop every look-and-motion override too, or the new type inherits the
    // old one's numbers and "change snow to rain" produces slow fat rain.
    var kept = {
      layerName: system.autoOptions.layerName,
      enabled: system.autoOptions.enabled,
      intensity: system.autoOptions.intensity,
      anchoring: system.autoOptions.anchoring,
      zOrder: system.autoOptions.zOrder,
      pixelSnap: system.autoOptions.pixelSnap,
      type: typeName,
    };
    system.autoOptions = kept;
    return true;
  }

  function setWeatherAnchoring(runtimeScene, layerName, anchoring) {
    var state = getSceneState(runtimeScene);
    var system = state.emitters[resolveKey(layerName || '')];
    if (!system || !system.autoOptions) return false;
    system.autoOptions.anchoring = anchoring === 'Screen' ? 'Screen' : 'World';
    return true;
  }

  function setDistortionSetting(runtimeScene, layerName, label, value) {
    return applyOption(runtimeScene, 'distortions', layerName, DISTORTION_NUMBER_FIELDS,
      label, toNumber(value, 0));
  }

  function setDistortionFlag(runtimeScene, layerName, label, value) {
    return applyOption(runtimeScene, 'distortions', layerName, DISTORTION_FLAG_FIELDS,
      label, !!value);
  }

  function setDistortionMode(runtimeScene, layerName, modeName) {
    if (DISTORTION_MODES[modeName] === undefined) return false;
    var state = getSceneState(runtimeScene);
    var system = state.distortions[resolveKey(layerName || '')];
    if (!system || !system.autoOptions) return false;

    var kept = {
      layerName: system.autoOptions.layerName,
      enabled: system.autoOptions.enabled,
      intensity: system.autoOptions.intensity,
      worldFollow: system.autoOptions.worldFollow,
      mode: modeName,
    };
    system.autoOptions = kept;
    return true;
  }

  /** Reads back the value actually in force, preset fallbacks included - not the raw override. */
  function getWeatherSetting(runtimeScene, layerName, label) {
    var state = getSceneState(runtimeScene);
    var system = state.emitters[resolveKey(layerName || '')];
    var field = WEATHER_NUMBER_FIELDS[label];
    if (!system || !field) return 0;
    var resolved = normalizeEmitterOptions(system.autoOptions || {});
    return toNumber(resolved[field], 0);
  }

  function getDistortionSetting(runtimeScene, layerName, label) {
    var state = getSceneState(runtimeScene);
    var system = state.distortions[resolveKey(layerName || '')];
    var field = DISTORTION_NUMBER_FIELDS[label];
    if (!system || !field) return 0;
    var resolved = normalizeDistortionOptions(system.autoOptions || {});
    return toNumber(resolved[field], 0);
  }

  /* ============================================================== Global controls */

  function setGlobalIntensity(runtimeScene, value) {
    getSceneState(runtimeScene).globalIntensity = clamp(toNumber(value, 1), 0, 1);
  }

  function getGlobalIntensity(runtimeScene) {
    return getSceneState(runtimeScene).globalIntensity;
  }

  function setPaused(runtimeScene, paused) {
    getSceneState(runtimeScene).paused = !!paused;
  }

  function isPaused(runtimeScene) {
    return getSceneState(runtimeScene).paused;
  }

  function isActive(runtimeScene, key) {
    var state = getSceneState(runtimeScene);
    var systemKey = resolveKey(key);
    return !!(state.emitters[systemKey] || state.distortions[systemKey]);
  }

  function isSupported(runtimeScene) {
    if (!PIXI_OK) return false;
    var renderer = runtimeScene.getGame().getRenderer();
    if (!renderer || typeof renderer.getPIXIRenderer !== 'function') return false;
    var pixiRenderer = renderer.getPIXIRenderer();
    return !!pixiRenderer && pixiRenderer.type === PIXI.RENDERER_TYPE.WEBGL;
  }

  function disposeAll(runtimeScene) {
    var state = runtimeScene.__weatherFX2D;
    if (!state) return;

    var emitterKeys = Object.keys(state.emitters);
    for (var e = 0; e < emitterKeys.length; e++) {
      // Keys are already resolved, so hand them through unchanged rather than re-prefixing.
      disposeEmitterByKey(runtimeScene, emitterKeys[e]);
    }

    var distortionKeys = Object.keys(state.distortions);
    for (var d = 0; d < distortionKeys.length; d++) {
      disposeDistortionByKey(runtimeScene, distortionKeys[d]);
    }

    runtimeScene.__weatherFX2D = null;
  }

  function disposeEmitterByKey(runtimeScene, systemKey) {
    var state = getSceneState(runtimeScene);
    var system = state.emitters[systemKey];
    if (!system) return;
    for (var i = 0; i < system.particles.length; i++) {
      var sprite = system.particles[i].sprite;
      if (sprite) sprite.destroy();
    }
    for (var s = 0; s < system.splashes.length; s++) {
      system.splashes[s].sprite.destroy();
    }
    if (system.container && system.container.parent) {
      system.container.parent.removeChild(system.container);
    }
    if (system.container) system.container.destroy({ children: true });
    delete state.emitters[systemKey];
  }

  function disposeDistortionByKey(runtimeScene, systemKey) {
    var state = getSceneState(runtimeScene);
    var system = state.distortions[systemKey];
    if (!system) return;
    detachDistortionFilter(system);
    var container = system.layerContainer;
    if (container && (!container.filters || container.filters.length === 0)) {
      container.filterArea = null;
    }
    if (system.filter && typeof system.filter.destroy === 'function') system.filter.destroy();
    delete state.distortions[systemKey];
  }

  if (typeof gdjs.registerRuntimeSceneUnloadedCallback === 'function') {
    gdjs.registerRuntimeSceneUnloadedCallback(function (runtimeScene) {
      disposeAll(runtimeScene);
    });
  }

  // Post-events rather than pre-events: an event that moves the camera this frame has already run,
  // so the field is placed against where the camera actually ended up and never trails it by a frame.
  if (typeof gdjs.registerRuntimeScenePostEventsCallback === 'function') {
    gdjs.registerRuntimeScenePostEventsCallback(function (runtimeScene) {
      stepAutoSystems(runtimeScene);
    });
  }

  /* ============================================================== Preset access */

  /**
   * Returns a copy, never the preset itself. `Apply preset` writes these straight into a
   * behaviour's properties, and handing back the live object would let one behaviour's edits
   * rewrite the defaults every later call reads.
   */
  function getPreset(typeName) {
    var preset = resolvePreset(typeName);
    var copy = {};
    for (var field in preset) {
      if (Object.prototype.hasOwnProperty.call(preset, field)) copy[field] = preset[field];
    }
    return copy;
  }

  function getDistortionPreset(modeName) {
    var preset = DISTORTION_PRESETS[modeName] || DISTORTION_PRESETS['Heat Haze'];
    var copy = {};
    for (var field in preset) {
      if (Object.prototype.hasOwnProperty.call(preset, field)) copy[field] = preset[field];
    }
    return copy;
  }

  /* ============================================================== Public surface */

  gdjs.__weatherFX2D = {
    // Particles
    registerEmitter: registerEmitter,
    stepEmitter: stepEmitter,
    disposeEmitter: disposeEmitter,
    getParticleCount: getParticleCount,
    startWeather: startWeather,
    spawnParticleRipple: spawnParticleRipple,

    // Distortion
    registerDistortion: registerDistortion,
    stepDistortion: stepDistortion,
    disposeDistortion: disposeDistortion,
    spawnRipple: spawnRipple,
    getRippleCount: getRippleCount,
    startDistortion: startDistortion,

    // Settings by name (the no-behavior path)
    setWeatherSetting: setWeatherSetting,
    setWeatherFlag: setWeatherFlag,
    setWeatherType: setWeatherType,
    setWeatherAnchoring: setWeatherAnchoring,
    setDistortionSetting: setDistortionSetting,
    setDistortionFlag: setDistortionFlag,
    setDistortionMode: setDistortionMode,
    getWeatherSetting: getWeatherSetting,
    getDistortionSetting: getDistortionSetting,

    // Presets
    getPreset: getPreset,
    getDistortionPreset: getDistortionPreset,

    // Global
    setGlobalIntensity: setGlobalIntensity,
    getGlobalIntensity: getGlobalIntensity,
    setPaused: setPaused,
    isPaused: isPaused,
    isActive: isActive,
    isSupported: isSupported,
    disposeAll: disposeAll,

    // Exposed for the test suite and the static shader check.
    _internals: {
      wrapSigned: wrapSigned,
      wrapPositive: wrapPositive,
      parseColorToHex: parseColorToHex,
      normalizeEmitterOptions: normalizeEmitterOptions,
      normalizeDistortionOptions: normalizeDistortionOptions,
      buildCameraDelta: buildCameraDelta,
      fieldToWorldX: fieldToWorldX,
      fieldToWorldY: fieldToWorldY,
      worldToFieldX: worldToFieldX,
      worldToFieldY: worldToFieldY,
      sampleCamera: sampleCamera,
      PRESETS: PRESETS,
      DISTORTION_PRESETS: DISTORTION_PRESETS,
      DISTORTION_MODES: DISTORTION_MODES,
      tearBandCount: tearBandCount,
      resolveWorldFollow: resolveWorldFollow,
      WEATHER_NUMBER_FIELDS: WEATHER_NUMBER_FIELDS,
      WEATHER_FLAG_FIELDS: WEATHER_FLAG_FIELDS,
      DISTORTION_NUMBER_FIELDS: DISTORTION_NUMBER_FIELDS,
      DISTORTION_FLAG_FIELDS: DISTORTION_FLAG_FIELDS,
      originFoldMultiplier: originFoldMultiplier,
      phaseFoldSpan: phaseFoldSpan,
      MAX_RIPPLES: MAX_RIPPLES,
      DISTORTION_FRAGMENT_SHADER: DISTORTION_FRAGMENT_SHADER,
    },
  };
})();
