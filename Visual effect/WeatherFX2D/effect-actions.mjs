/** Effect-specific action declarations. Keep stored IDs stable when polishing labels. */
export function effectActions({ runtime, freeFn, num, col, layerParam, choice, bool }) {
  const readPreset = name => {
    const match = runtime.match(new RegExp(String.raw`var ${name} = (\{[\s\S]*?\n  \});`));
    if (!match) throw new Error(`Missing ${name}`);
    return new Function(`return (${match[1]});`)();
  };
  const weather = readPreset('PRESETS');
  const distortion = readPreset('DISTORTION_PRESETS');
  const labels = {
    density: 'Density (particles per screen)', minSize: 'Minimum size (px)', maxSize: 'Maximum size (px)',
    minSpeed: 'Minimum travel speed (px/s)', maxSpeed: 'Maximum travel speed (px/s)',
    windAngle: 'Direction (degrees: 90 = down)', windSpread: 'Per-particle angle variation (degrees)',
    gustStrength: 'Wind gusts (0-1)', swayAmount: 'Sideways swing distance (px)',
    swaySpeed: 'Swing frequency (100 = one cycle/s)', swayIrregularity: 'Swing irregularity (0-1)',
    color: 'Colour', opacity: 'Opacity (0-255)', softness: 'Softness (0-1)', additive: 'Additive blending',
    depthVariation: 'Depth variation (0-1)', streakWidth: 'Drop width (px)', streakLength: 'Streak length (px; 0 = automatic)',
    splashAmount: 'Rings per second (0 = manual only)', splashMinRadius: 'Minimum ring radius (px)',
    splashMaxRadius: 'Maximum ring radius (px)', splashLife: 'Ring lifetime (seconds)',
    strength: 'Wave strength (px)', wavelengthX: 'Horizontal wavelength (px)', wavelengthY: 'Vertical wavelength / band spacing (px)',
    speed: 'Animation speed', detail: 'Secondary detail (0-1)', riseSpeed: 'Rise speed multiplier', horizonFade: 'Fade toward top (0-1)',
    rippleStrength: 'Ripple strength (px)', rippleSpeed: 'Ripple expansion (px/s)', rippleLife: 'Ripple lifetime (seconds)',
    rippleWidth: 'Ripple thickness (px)', tearStrength: 'Strip offset (px)', tearWidth: 'Strip coverage (0-1)',
    tearStripHeight: 'Strip height (px; 0 = smooth)', magnification: 'Magnification (1 = unchanged)', bandWidth: 'Band thickness (px)',
    worldFollow: 'World anchoring (0 = screen, 1 = world)', zOrder: 'Draw order', pixelSnap: 'Snap to whole pixels',
    anchoring: 'Particle anchoring (rings always use world positions)', intensity: 'Intensity (0 = hidden, 1 = normal)', enabled: 'Enabled',
  };
  const look = ['color', 'opacity', 'softness', 'additive'];
  const particles = ['density', 'minSize', 'maxSize', 'depthVariation'];
  const motion = ['minSpeed', 'maxSpeed', 'windAngle', 'windSpread', 'gustStrength'];
  const swing = ['swayAmount', 'swaySpeed', 'swayIrregularity'];
  const rings = ['splashAmount', 'splashMinRadius', 'splashMaxRadius', 'splashLife'];
  const ripples = ['rippleStrength', 'rippleSpeed', 'rippleLife', 'rippleWidth'];
  const wave = ['strength', 'wavelengthX', 'wavelengthY', 'speed', 'detail'];
  const specs = [
    ['Snow', 'Snow', false, { Particles: particles, Appearance: look, Falling: motion, Swing: swing }],
    ['Rain', 'Rain', false, { Drops: ['density', 'streakWidth', 'streakLength', 'depthVariation'], Appearance: ['color', 'opacity', 'additive'], Falling: motion, Splashes: rings }],
    ['Fog', 'Fog', false, { Patches: particles, Appearance: look, Drift: motion, Sway: swing }],
    ['Embers', 'Embers', false, { Particles: particles, Appearance: look, Rising: motion, Flutter: swing }],
    ['WaterRings', 'Ripples', false, { Rings: rings, Appearance: ['color', 'opacity', 'additive'] }],
    ['HeatHaze', 'Heat Haze', true, { Waves: wave, Heat: ['riseSpeed', 'horizonFade'], Ripples: ripples }],
    ['HeatShimmer', 'Heat Shimmer', true, { Shimmer: ['strength', 'wavelengthX', 'wavelengthY', 'speed', 'detail', 'horizonFade'], Ripples: ripples }],
    ['Underwater', 'Underwater', true, { Waves: wave, Ripples: ripples }],
    ['DistortionRipples', 'Ripples Only', true, { Ripples: ripples }],
    ['TearLines', 'Tear Lines', true, { Strips: ['tearStrength', 'tearWidth', 'tearStripHeight', 'wavelengthY', 'speed', 'strength'], Ripples: ripples }],
    ['MagnifierBand', 'Magnifier Band', true, { Lens: ['magnification', 'bandWidth', 'wavelengthY', 'speed'], Ripples: ripples }],
  ];
  const actions = [];
  for (const [id, effect, shader, sections] of specs) {
    const title = id === 'WaterRings' ? 'Water rings' : id === 'DistortionRipples' ? 'Distortion ripples' : effect;
    const group = `${shader ? 'Distortion' : 'Weather'} / ${title}`;
    const defaults = { ...(shader ? distortion[effect] : weather[effect]), swayIrregularity: effect === 'Snow' ? 0.4 : 0,
      worldFollow: 1, anchoring: 'World', zOrder: 1000, pixelSnap: false, intensity: 1, enabled: true };
    const typeField = shader ? 'mode' : 'type';
    const start = shader ? 'startDistortion' : 'startWeather';
    const setType = shader ? 'setDistortionMode' : 'setWeatherType';
    const collection = shader ? 'distortions' : 'emitters';
    // Public start/update API preserves settings on the same effect; reset only when switching type.
    const prepare = `const layerName = eventsFunctionContext.getArgument("Layer") || "";
const systems = runtimeScene.__weatherFX2D && runtimeScene.__weatherFX2D.${collection};
const existing = systems && systems["layer:" + layerName];
if (existing && existing.autoOptions && existing.autoOptions.${typeField} !== ${JSON.stringify(effect)}) {
  WFX.${setType}(runtimeScene, layerName, ${JSON.stringify(effect)});
}
`;
    const fieldLabel = field => field === 'wavelengthY'
      ? (['Tear Lines', 'Magnifier Band'].includes(effect) ? 'Band spacing (px)' : 'Vertical wavelength (px)')
      : labels[field];
    const params = fields => fields.map(field => {
      if (!labels[field]) throw new Error(`Missing label for ${field}`);
      if (field === 'anchoring') return choice('Value_' + field, fieldLabel(field), ['World', 'Screen']);
      if (typeof defaults[field] === 'boolean') return { ...bool('Value_' + field, fieldLabel(field)), defaultValue: String(defaults[field]) };
      if (field === 'color') {
        const c = defaults[field];
        return col('Value_' + field, fieldLabel(field), `${(c >> 16) & 255};${(c >> 8) & 255};${c & 255}`);
      }
      return num('Value_' + field, fieldLabel(field), String(defaults[field]));
    });
    const add = (name, label, fields, isStart = false) => {
      // Match the editing form exactly: layer first, then every setting in declaration order.
      const sentence = `${label} on layer _PARAM0_` + fields.map((field, index) =>
        `; ${fieldLabel(field)}: _PARAM${index + 1}_`).join('');
      actions.push(freeFn(name, label, sentence,
        `${isStart ? 'Start' : 'Start or configure'} ${title.toLowerCase()} without a behavior. `
        + 'Updates only these settings; other settings for this effect are preserved. '
        + `Switching from another ${shader ? 'distortion' : 'weather'} effect restores this effect's defaults. `
        + 'One weather effect and one distortion effect can run per layer; use separate layers to combine more effects.',
        'Action', [layerParam('Layer', 'Effect layer'), ...params(fields)],
        prepare + `WFX.${start}(runtimeScene, layerName, { layerName, ${typeField}: ${JSON.stringify(effect)},\n`
        + (isStart ? 'enabled: true,\n' : '')
        + fields.map(field => `${field}: eventsFunctionContext.getArgument(${JSON.stringify('Value_' + field)})`).join(',\n') + '\n});',
        { group, withRuntime: true }));
    };
    add(`Start${id}`, `Start ${title.toLowerCase()}`, ['intensity'], true);
    for (const [section, fields] of Object.entries(sections)) {
      const suffix = title.toLowerCase().endsWith(section.toLowerCase()) ? '' : ` ${section.toLowerCase()}`;
      add(`Configure${id}${section}`, `Configure ${title.toLowerCase()}${suffix}`, fields);
    }
    add(`Configure${id}Placement`, `Configure ${title.toLowerCase()} placement`,
      shader ? (effect === 'Ripples Only' ? ['enabled', 'intensity'] : ['enabled', 'intensity', 'worldFollow'])
        : (effect === 'Ripples' ? ['enabled', 'intensity', 'zOrder'] : ['enabled', 'intensity', 'anchoring', 'zOrder', 'pixelSnap']));
  }
  return actions;
}
