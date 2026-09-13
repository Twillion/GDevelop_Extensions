# Weather FX 2D — API reference

Generated from `WeatherFX2D.json` v1.5.0 by `build-api-reference.mjs`.
Do not edit by hand — rerun the generator instead.

Weather and screen distortion in one action. No behavior required.

---

## Behaviors

### Weather Emitter 2D

Internal name: `WeatherEmitter2D`

Fills the view with weather particles that stay put in the world while the camera moves, at any position on the map and at any zoom. Attach it to any one object - the object is only a home for the settings and is never drawn as weather - then pick an Effect Type and press play. Sizes are in screen pixels and speeds in screen pixels per second, so the look holds through a zoom change.

#### Properties

**Effect | Start here**

| Property | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| Enabled | Boolean | `true` | Turn the weather off without removing the behavior. Particles are hidden, not destroyed, so switching back on is instant. |
| Intensity | Number | `1` | Multiplies how many particles are drawn. 1 = the normal amount, 0.5 = half, 0 = none. This is the setting to animate for a storm building or dying down - it works whether or not the built-in settings are in use. |
| Effect layer | String | `` | Name of the layer to draw the weather on. Leave EMPTY for the base layer. The weather is drawn inside that layer, so it scrolls, zooms and rotates with it. |
| Effect type | choice: `Snow`, `Rain`, `Fog`, `Embers`, `Ripples` | `Snow` | Which weather to draw. Each type carries a complete built-in look, so this alone is enough to get a good result. Ripples is the odd one out: nothing falls, and the effect is expanding rings drawn on the water - use it for a pond surface, or put it on your player and spawn rings by hand as they wade. |
| Use built-in settings for this type | Boolean | `true` | ON (default): every Look, Motion, Particles and Rain setting below is ignored, and the built-in look for the chosen Effect Type is used instead - so switching Effect Type just works. Turn this OFF to author those numbers yourself. Effect layer, Enabled, Intensity and the whole Placement group always apply either way. |

**Look | Custom settings**

| Property | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| Additive blending | Boolean | `false` | Blend particles by adding light instead of covering what is behind. Right for embers, sparks and fireflies; wrong for snow, which should hide what it passes in front of. |
| Colour | Color | `255;255;255` | Tint applied to every particle. |
| Opacity (0-255) | Number | `210` | Overall opacity of the whole field. Individual particles also vary slightly around this. |
| Softness (0-1) | Number | `0` | 0 draws a crisp square - the correct choice for pixel art, and the cheapest to draw. Raise it toward 1 for a soft round particle with a faded edge. |

**Motion | Custom settings**

| Property | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| Gust strength (0-1) | Number | `0.3` | Slow wandering of the wind direction over time. Two rates that do not divide into each other are mixed, so the gust never settles into an audible loop. |
| Maximum speed (px/s) | Number | `95` | Fastest particle, in SCREEN pixels per second. |
| Minimum speed (px/s) | Number | `35` | Slowest particle, in SCREEN pixels per second. |
| Sway distance (px) | Number | `16` | How far a particle drifts from side to side across its direction of travel. This is what makes snow read as snow rather than as falling dots. |
| Sway speed | Number | `55` | How quickly each particle sways. Every particle gets its own slight variation on this. |
| Wind angle (degrees) | Number | `90` | Direction of travel, in GDevelop angles: 0 is right, 90 is straight down, 270 is straight up. |
| Wind spread (degrees) | Number | `14` | How far individual particles may deviate from the wind angle. 0 makes every particle travel on exactly the same line, which reads as artificial. |

**Particles | Custom settings**

| Property | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| Density (particles on screen) | Number | `220` | How many particles are visible on one screenful. The stored count is scaled up automatically to cover the off-screen margin, so this number means the same thing at any resolution or zoom. |
| Depth variation (0-1) | Number | `0.6` | How strongly distant particles are made smaller, slower AND fainter together. One number driving all three is what reads as depth; varying them separately just reads as noise. |
| Maximum size (px) | Number | `5` | Largest particle, in SCREEN pixels. |
| Minimum size (px) | Number | `2` | Smallest particle, in SCREEN pixels. |

**Placement**

| Property | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| Anchoring | choice: `World`, `Screen` | `World` | World (default): particles hold their place on the map, so moving the camera moves past them - this is what makes weather feel part of the scene. Screen: particles hold their place on the display and travel with the camera, like a HUD overlay. Water rings and rain splashes always remain at their world positions. |
| Draw order (Z order) | Number | `1000` | Z order of the weather within its layer. Higher draws in front. The default of 1000 puts it in front of ordinary scene objects. |
| Snap to whole pixels | Boolean | `false` | Round every particle to a whole screen pixel. Keeps a pixel-art game crisp, but slow particles will visibly step rather than glide. |

**Rain streaks | Custom settings**

| Property | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| Rain streak length (px) | Number | `0` | Length of a raindrop. Leave at 0 to derive it from each drop's own speed, so fast drops streak longer than slow ones. Only used when Effect Type is Rain. |
| Rain streak width (px) | Number | `2` | Thickness of a raindrop. Only used when Effect Type is Rain. |

**Water rings & rain splashes | Custom settings**

| Property | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| Ring lifetime (seconds) | Number | `0.45` | How long a ring takes to expand and fade away. |
| Ring maximum radius (px) | Number | `13` | Largest a ring grows to before it fades out. |
| Ring minimum radius (px) | Number | `5` | Smallest a ring grows to before it fades out. |
| Rings per second | Number | `26` | Expanding rings seeded across the visible area each second. These are rain splashes when Effect Type is Rain, and the whole effect when it is Ripples. Set to 0 for none - you can still spawn rings on demand with the actions. |

#### Actions

##### Enable / disable this weather

> Set weather on _PARAM0_ enabled: _PARAM2_

Turn this emitter on or off. Particles are hidden rather than destroyed, so turning it back on is instant and the field does not have to refill.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Enabled` | yes/no | Enabled |

##### Set weather intensity

> Set weather intensity of _PARAM0_ to _PARAM2_

Set how much weather is drawn, as a multiplier of the density. 0 is none, 1 is normal. Tween this to build a storm up or let it die away.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Intensity` | number | Intensity multiplier (0 = none, 1 = normal) (default `1`) |

##### Set wind

> Set wind of _PARAM0_ to angle _PARAM2_ degrees, spread _PARAM3_

Set the direction particles travel and how far individual particles may deviate from it. Angles follow GDevelop: 0 is right, 90 is straight down. This needs "Use built-in settings for this type" switched OFF, otherwise the built-in wind is used instead.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Angle` | number | Wind angle in degrees (0 = right, 90 = down) (default `90`) |
| `Spread` | number | Spread in degrees (default `14`) |

##### Copy a built-in look into the settings

> Configure _PARAM0_ with built-in settings: _PARAM2_

Writes the built-in numbers for one effect type into this behavior's own Look, Motion, Particles and Rain properties, and switches "Use built-in settings" OFF. Use it as a starting point you then edit, instead of authoring 15 numbers from scratch. Runtime only - the values shown in the editor panel do not change.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Type` | choice: `Snow`, `Rain`, `Fog`, `Embers`, `Ripples` | Effect type to copy from (default `Snow`) |

##### Spawn a water ring at this object

> Spawn a water ring on _PARAM0_ at its own position; size: _PARAM2_

Draw one expanding ring centred on the object carrying this behavior. This is the drawn-ring kind, sitting on top of the water - not the shader kind that bends the image. Put the behavior on your player and call this as each footstep lands in shallow water.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Size` | number | Size multiplier (1 = the configured radius) (default `1`) |

##### Spawn a water ring at a position

> Spawn a water ring on _PARAM0_ at _PARAM2_ ; _PARAM3_ with size _PARAM4_

Draw one expanding ring at a point in SCENE coordinates - the same numbers Object.X() and CursorX() give you. The ring stays over that spot on the map while the camera moves.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `X` | number | Scene X coordinate (default `0`) |
| `Y` | number | Scene Y coordinate (default `0`) |
| `Size` | number | Size multiplier (1 = the configured radius) (default `1`) |

#### Conditions

##### Weather is enabled

> Weather on _PARAM0_ is enabled

Check whether this emitter is currently drawing.

*No parameters.*

#### Expressions

##### Live particle count

Number of particles this emitter currently holds, including the off-screen margin. Useful for checking the cost of a density setting.

Returns a **number**. Call as `Object.Behavior::ParticleCount(...)`.

*No parameters.*

---

### Screen Distortion 2D (heat haze / underwater / ripples)

Internal name: `ScreenDistortion2D`

Bends the whole layer with a shader - rising heat shimmer, an underwater wobble, or expanding ripples you spawn where something hits the water. Attach it to any one object; the object is only a home for the settings. Strength and wavelength are in real screen pixels and stay that way regardless of what is on the layer, which is what stops the effect jumping in size as you move around the map.

#### Properties

**Effect | Start here**

| Property | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| Enabled | Boolean | `true` | Turn the distortion off without removing it. The shader stays attached and stops running, so switching back on costs nothing. |
| Intensity | Number | `1` | Multiplies the displacement. 0 is completely flat, 1 is the normal amount. This is the setting to tween when the player enters or leaves water. |
| Effect layer | String | `` | Name of the layer to distort. Leave EMPTY for the base layer. Everything drawn on that layer is bent, including objects; anything on another layer is untouched. |
| Mode | choice: `Heat Haze`, `Underwater`, `Ripples Only`, `Heat Shimmer`, `Tear Lines`, `Magnifier Band` | `Heat Haze` | Heat Haze shimmers sideways in short fast waves and fades toward the top of the screen. Underwater swims slowly on both axes with a long wavelength. Heat Shimmer is the turbulent cousin of Heat Haze, built from fractal noise instead of a sine, and reads as real rising air. Tear Lines slices the screen into hard-edged strips that jump sideways, which suits pixel art and glitch effects. Magnifier Band scrolls a lens down the screen that stretches whatever passes through it. Ripples Only leaves the standing wave off entirely, so nothing moves until you spawn a ripple. |
| Use built-in settings for this mode | Boolean | `true` | ON (default): every Wave, Heat haze and Ripple setting below is ignored and the built-in look for the chosen Mode is used, so switching Mode just works. Turn this OFF to author the numbers yourself. Effect layer, Enabled, Intensity and Anchoring always apply either way. |

**Heat haze only | Custom settings**

| Property | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| Fade toward top (0-1) | Number | `0.55` | 0 shimmers evenly over the whole screen. 1 shimmers only along the bottom and fades out completely at the top, which reads as heat coming off the ground. Only used in Heat Haze mode. |
| Heat rise speed | Number | `1.6` | How fast the shimmer scrolls upward. Only used in Heat Haze mode. |

**Magnifier band only | Custom settings**

| Property | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| Magnification | Number | `1.35` | How much the band stretches what passes through it. 1 is no change, 1.35 is a gentle bulge, 2 is a strong lens. Below 1 pinches instead. Only used in Magnifier Band mode. |
| Band thickness (px) | Number | `70` | How tall the lens band is. The magnification falls off smoothly to nothing at this distance from the band centre. Only used in Magnifier Band mode. |

**Placement**

| Property | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| World anchoring (0-1) | Number | `1` | 1 (default) anchors the distortion pattern to the map as the camera moves. 0 attaches it to the screen. Intermediate values give partial camera following. Spawned ripple centres always stay at their world positions. |

**Ripples | Custom settings**

| Property | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| Ripple lifetime (seconds) | Number | `1.6` | How long a ripple lasts before it has faded to nothing. |
| Ripple expansion speed (px/s) | Number | `260` | How fast a ripple ring grows outward from where it was spawned. |
| Ripple strength (px) | Number | `8` | How far a ripple pushes the image outward at the ring, in screen pixels. |
| Ripple ring thickness (px) | Number | `30` | Thickness of the moving ring. Wider is softer and more like a swell; narrower is sharper and more like a raindrop. |

**Tear lines only | Custom settings**

| Property | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| Tear line offset (px) | Number | `7` | How far a strip jumps sideways, in screen pixels. This is a hard jump, not a gradient - the whole strip moves together. Only used in Tear Lines mode. |
| Tear strip height (px) | Number | `4` | Quantises tear edges into strips this tall, so they stair-step like pixel art instead of cutting on a smooth line. Set to 0 for smooth edges. Only used in Tear Lines mode. |
| Tear line coverage (0-1) | Number | `0.35` | What fraction of each cycle is inside a tear. 0.5 means half the screen is offset at any moment; small values give occasional thin slices. Only used in Tear Lines mode. |

**Wave | Custom settings**

| Property | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| Secondary detail (0-1) | Number | `0.4` | Strength of a second, faster wave mixed on top so the motion does not look like one mechanical wobble. In Heat Shimmer mode this is how much each row is offset from its neighbours instead, which is what stops the noise sliding as one flat sheet. |
| Wavelength across (px) | Number | `160` | Distance in screen pixels between wave crests measured horizontally. |
| Wavelength down (px) | Number | `55` | Distance in screen pixels between wave crests measured vertically. Short values here make the tight horizontal banding that reads as heat. In Tear Lines mode this is the distance between tears; in Magnifier Band mode it is the distance between passes of the lens. |
| Wave speed | Number | `1.1` | How fast the wave animates. Each harmonic keeps its own phase, folded to one turn, so this can run for hours without drifting or popping. |
| Wave strength (px) | Number | `4` | Maximum displacement of the standing wave, in SCREEN pixels. This is a real pixel count and stays a real pixel count no matter what is on the layer. |

#### Actions

##### Enable / disable this distortion

> Set distortion on _PARAM0_ enabled: _PARAM2_

Turn the distortion on or off. The shader stays attached while off and costs nothing.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Enabled` | yes/no | Enabled |

##### Set distortion intensity

> Set distortion intensity of _PARAM0_ to _PARAM2_

Set how strongly the image is bent, as a multiplier. 0 is flat, 1 is normal. Tween this when the player enters or leaves water.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Intensity` | number | Intensity multiplier (0 = flat, 1 = normal) (default `1`) |

##### Spawn a ripple at this object

> Spawn a ripple on _PARAM0_ at its own position

Start an expanding ripple centred on the object carrying this behavior. Good for footsteps in shallow water: put the behavior on the player and call this each time a step lands.

*No parameters.*

##### Spawn a ripple at a position

> Spawn a ripple on _PARAM0_ at _PARAM2_ ; _PARAM3_

Start distortion on this layer first. Spawn an expanding ripple at scene coordinates - the same numbers Object.X() and CursorX() give you. The ripple stays over that spot on the map while the camera moves. Up to 12 can run at once; a thirteenth replaces the oldest.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `X` | number | Scene X coordinate (default `0`) |
| `Y` | number | Scene Y coordinate (default `0`) |

##### Copy a built-in look into the settings

> Configure _PARAM0_ with built-in settings: _PARAM2_

Writes the built-in numbers for one mode into this behavior's own Wave, Heat haze and Ripple properties, and switches "Use built-in settings" OFF, so you have a working starting point to edit. Runtime only - the values shown in the editor panel do not change.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Mode` | choice: `Heat Haze`, `Underwater`, `Ripples Only`, `Heat Shimmer`, `Tear Lines`, `Magnifier Band` | Mode to copy from (default `Heat Haze`) |

#### Conditions

##### Distortion is enabled

> Distortion on _PARAM0_ is enabled

Check whether this distortion is currently running.

*No parameters.*

#### Expressions

##### Live ripple count

How many ripples are currently animating on this distortion, out of a maximum of 12.

Returns a **number**. Call as `Object.Behavior::RippleCount(...)`.

*No parameters.*

---

## Free functions (no behavior needed)

#### Actions

##### Start snow

> Start snow on layer _PARAM1_; Intensity (0 = hidden, 1 = normal): _PARAM2_

Start snow without a behavior. Updates only these settings; other settings for this effect are preserved. Switching from another weather effect restores this effect's defaults. One weather effect and one distortion effect can run per layer; use separate layers to combine more effects.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Layer` | layer | Effect layer (empty = base layer) |
| `Value_intensity` | number | Intensity (0 = hidden, 1 = normal) (default `1`) |

##### Configure snow particles

> Configure snow particles on layer _PARAM1_; Density (particles per screen): _PARAM2_; Minimum size (px): _PARAM3_; Maximum size (px): _PARAM4_; Depth variation (0-1): _PARAM5_

Start or configure snow without a behavior. Updates only these settings; other settings for this effect are preserved. Switching from another weather effect restores this effect's defaults. One weather effect and one distortion effect can run per layer; use separate layers to combine more effects.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Layer` | layer | Effect layer (empty = base layer) |
| `Value_density` | number | Density (particles per screen) (default `220`) |
| `Value_minSize` | number | Minimum size (px) (default `2`) |
| `Value_maxSize` | number | Maximum size (px) (default `5`) |
| `Value_depthVariation` | number | Depth variation (0-1) (default `0.6`) |

##### Configure snow appearance

> Configure snow appearance on layer _PARAM1_; Colour: _PARAM2_; Opacity (0-255): _PARAM3_; Softness (0-1): _PARAM4_; Additive blending: _PARAM5_

Start or configure snow without a behavior. Updates only these settings; other settings for this effect are preserved. Switching from another weather effect restores this effect's defaults. One weather effect and one distortion effect can run per layer; use separate layers to combine more effects.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Layer` | layer | Effect layer (empty = base layer) |
| `Value_color` | colour | Colour (default `255;255;255`) |
| `Value_opacity` | number | Opacity (0-255) (default `210`) |
| `Value_softness` | number | Softness (0-1) (default `0`) |
| `Value_additive` | yes/no | Additive blending (default `false`) |

##### Configure snow falling

> Configure snow falling on layer _PARAM1_; Minimum travel speed (px/s): _PARAM2_; Maximum travel speed (px/s): _PARAM3_; Direction (degrees: 90 = down): _PARAM4_; Per-particle angle variation (degrees): _PARAM5_; Wind gusts (0-1): _PARAM6_

Start or configure snow without a behavior. Updates only these settings; other settings for this effect are preserved. Switching from another weather effect restores this effect's defaults. One weather effect and one distortion effect can run per layer; use separate layers to combine more effects.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Layer` | layer | Effect layer (empty = base layer) |
| `Value_minSpeed` | number | Minimum travel speed (px/s) (default `35`) |
| `Value_maxSpeed` | number | Maximum travel speed (px/s) (default `95`) |
| `Value_windAngle` | number | Direction (degrees: 90 = down) (default `90`) |
| `Value_windSpread` | number | Per-particle angle variation (degrees) (default `14`) |
| `Value_gustStrength` | number | Wind gusts (0-1) (default `0.3`) |

##### Configure snow swing

> Configure snow swing on layer _PARAM1_; Sideways swing distance (px): _PARAM2_; Swing frequency (100 = one cycle/s): _PARAM3_; Swing irregularity (0-1): _PARAM4_

Start or configure snow without a behavior. Updates only these settings; other settings for this effect are preserved. Switching from another weather effect restores this effect's defaults. One weather effect and one distortion effect can run per layer; use separate layers to combine more effects.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Layer` | layer | Effect layer (empty = base layer) |
| `Value_swayAmount` | number | Sideways swing distance (px) (default `16`) |
| `Value_swaySpeed` | number | Swing frequency (100 = one cycle/s) (default `55`) |
| `Value_swayIrregularity` | number | Swing irregularity (0-1) (default `0.4`) |

##### Configure snow placement

> Configure snow placement on layer _PARAM1_; Enabled: _PARAM2_; Intensity (0 = hidden, 1 = normal): _PARAM3_; Particle anchoring (rings always use world positions): _PARAM4_; Draw order: _PARAM5_; Snap to whole pixels: _PARAM6_

Start or configure snow without a behavior. Updates only these settings; other settings for this effect are preserved. Switching from another weather effect restores this effect's defaults. One weather effect and one distortion effect can run per layer; use separate layers to combine more effects.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Layer` | layer | Effect layer (empty = base layer) |
| `Value_enabled` | yes/no | Enabled (default `true`) |
| `Value_intensity` | number | Intensity (0 = hidden, 1 = normal) (default `1`) |
| `Value_anchoring` | choice: `World`, `Screen` | Particle anchoring (rings always use world positions) (default `World`) |
| `Value_zOrder` | number | Draw order (default `1000`) |
| `Value_pixelSnap` | yes/no | Snap to whole pixels (default `false`) |

##### Start rain

> Start rain on layer _PARAM1_; Intensity (0 = hidden, 1 = normal): _PARAM2_

Start rain without a behavior. Updates only these settings; other settings for this effect are preserved. Switching from another weather effect restores this effect's defaults. One weather effect and one distortion effect can run per layer; use separate layers to combine more effects.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Layer` | layer | Effect layer (empty = base layer) |
| `Value_intensity` | number | Intensity (0 = hidden, 1 = normal) (default `1`) |

##### Configure rain drops

> Configure rain drops on layer _PARAM1_; Density (particles per screen): _PARAM2_; Drop width (px): _PARAM3_; Streak length (px; 0 = automatic): _PARAM4_; Depth variation (0-1): _PARAM5_

Start or configure rain without a behavior. Updates only these settings; other settings for this effect are preserved. Switching from another weather effect restores this effect's defaults. One weather effect and one distortion effect can run per layer; use separate layers to combine more effects.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Layer` | layer | Effect layer (empty = base layer) |
| `Value_density` | number | Density (particles per screen) (default `320`) |
| `Value_streakWidth` | number | Drop width (px) (default `2`) |
| `Value_streakLength` | number | Streak length (px; 0 = automatic) (default `0`) |
| `Value_depthVariation` | number | Depth variation (0-1) (default `0.55`) |

##### Configure rain appearance

> Configure rain appearance on layer _PARAM1_; Colour: _PARAM2_; Opacity (0-255): _PARAM3_; Additive blending: _PARAM4_

Start or configure rain without a behavior. Updates only these settings; other settings for this effect are preserved. Switching from another weather effect restores this effect's defaults. One weather effect and one distortion effect can run per layer; use separate layers to combine more effects.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Layer` | layer | Effect layer (empty = base layer) |
| `Value_color` | colour | Colour (default `191;216;255`) |
| `Value_opacity` | number | Opacity (0-255) (default `150`) |
| `Value_additive` | yes/no | Additive blending (default `false`) |

##### Configure rain falling

> Configure rain falling on layer _PARAM1_; Minimum travel speed (px/s): _PARAM2_; Maximum travel speed (px/s): _PARAM3_; Direction (degrees: 90 = down): _PARAM4_; Per-particle angle variation (degrees): _PARAM5_; Wind gusts (0-1): _PARAM6_

Start or configure rain without a behavior. Updates only these settings; other settings for this effect are preserved. Switching from another weather effect restores this effect's defaults. One weather effect and one distortion effect can run per layer; use separate layers to combine more effects.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Layer` | layer | Effect layer (empty = base layer) |
| `Value_minSpeed` | number | Minimum travel speed (px/s) (default `700`) |
| `Value_maxSpeed` | number | Maximum travel speed (px/s) (default `1300`) |
| `Value_windAngle` | number | Direction (degrees: 90 = down) (default `90`) |
| `Value_windSpread` | number | Per-particle angle variation (degrees) (default `3`) |
| `Value_gustStrength` | number | Wind gusts (0-1) (default `0`) |

##### Configure rain splashes

> Configure rain splashes on layer _PARAM1_; Rings per second (0 = manual only): _PARAM2_; Minimum ring radius (px): _PARAM3_; Maximum ring radius (px): _PARAM4_; Ring lifetime (seconds): _PARAM5_

Start or configure rain without a behavior. Updates only these settings; other settings for this effect are preserved. Switching from another weather effect restores this effect's defaults. One weather effect and one distortion effect can run per layer; use separate layers to combine more effects.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Layer` | layer | Effect layer (empty = base layer) |
| `Value_splashAmount` | number | Rings per second (0 = manual only) (default `26`) |
| `Value_splashMinRadius` | number | Minimum ring radius (px) (default `5`) |
| `Value_splashMaxRadius` | number | Maximum ring radius (px) (default `13`) |
| `Value_splashLife` | number | Ring lifetime (seconds) (default `0.45`) |

##### Configure rain placement

> Configure rain placement on layer _PARAM1_; Enabled: _PARAM2_; Intensity (0 = hidden, 1 = normal): _PARAM3_; Particle anchoring (rings always use world positions): _PARAM4_; Draw order: _PARAM5_; Snap to whole pixels: _PARAM6_

Start or configure rain without a behavior. Updates only these settings; other settings for this effect are preserved. Switching from another weather effect restores this effect's defaults. One weather effect and one distortion effect can run per layer; use separate layers to combine more effects.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Layer` | layer | Effect layer (empty = base layer) |
| `Value_enabled` | yes/no | Enabled (default `true`) |
| `Value_intensity` | number | Intensity (0 = hidden, 1 = normal) (default `1`) |
| `Value_anchoring` | choice: `World`, `Screen` | Particle anchoring (rings always use world positions) (default `World`) |
| `Value_zOrder` | number | Draw order (default `1000`) |
| `Value_pixelSnap` | yes/no | Snap to whole pixels (default `false`) |

##### Start fog

> Start fog on layer _PARAM1_; Intensity (0 = hidden, 1 = normal): _PARAM2_

Start fog without a behavior. Updates only these settings; other settings for this effect are preserved. Switching from another weather effect restores this effect's defaults. One weather effect and one distortion effect can run per layer; use separate layers to combine more effects.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Layer` | layer | Effect layer (empty = base layer) |
| `Value_intensity` | number | Intensity (0 = hidden, 1 = normal) (default `1`) |

##### Configure fog patches

> Configure fog patches on layer _PARAM1_; Density (particles per screen): _PARAM2_; Minimum size (px): _PARAM3_; Maximum size (px): _PARAM4_; Depth variation (0-1): _PARAM5_

Start or configure fog without a behavior. Updates only these settings; other settings for this effect are preserved. Switching from another weather effect restores this effect's defaults. One weather effect and one distortion effect can run per layer; use separate layers to combine more effects.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Layer` | layer | Effect layer (empty = base layer) |
| `Value_density` | number | Density (particles per screen) (default `26`) |
| `Value_minSize` | number | Minimum size (px) (default `140`) |
| `Value_maxSize` | number | Maximum size (px) (default `380`) |
| `Value_depthVariation` | number | Depth variation (0-1) (default `0.7`) |

##### Configure fog appearance

> Configure fog appearance on layer _PARAM1_; Colour: _PARAM2_; Opacity (0-255): _PARAM3_; Softness (0-1): _PARAM4_; Additive blending: _PARAM5_

Start or configure fog without a behavior. Updates only these settings; other settings for this effect are preserved. Switching from another weather effect restores this effect's defaults. One weather effect and one distortion effect can run per layer; use separate layers to combine more effects.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Layer` | layer | Effect layer (empty = base layer) |
| `Value_color` | colour | Colour (default `223;232;242`) |
| `Value_opacity` | number | Opacity (0-255) (default `34`) |
| `Value_softness` | number | Softness (0-1) (default `1`) |
| `Value_additive` | yes/no | Additive blending (default `false`) |

##### Configure fog drift

> Configure fog drift on layer _PARAM1_; Minimum travel speed (px/s): _PARAM2_; Maximum travel speed (px/s): _PARAM3_; Direction (degrees: 90 = down): _PARAM4_; Per-particle angle variation (degrees): _PARAM5_; Wind gusts (0-1): _PARAM6_

Start or configure fog without a behavior. Updates only these settings; other settings for this effect are preserved. Switching from another weather effect restores this effect's defaults. One weather effect and one distortion effect can run per layer; use separate layers to combine more effects.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Layer` | layer | Effect layer (empty = base layer) |
| `Value_minSpeed` | number | Minimum travel speed (px/s) (default `4`) |
| `Value_maxSpeed` | number | Maximum travel speed (px/s) (default `16`) |
| `Value_windAngle` | number | Direction (degrees: 90 = down) (default `0`) |
| `Value_windSpread` | number | Per-particle angle variation (degrees) (default `22`) |
| `Value_gustStrength` | number | Wind gusts (0-1) (default `0.5`) |

##### Configure fog sway

> Configure fog sway on layer _PARAM1_; Sideways swing distance (px): _PARAM2_; Swing frequency (100 = one cycle/s): _PARAM3_; Swing irregularity (0-1): _PARAM4_

Start or configure fog without a behavior. Updates only these settings; other settings for this effect are preserved. Switching from another weather effect restores this effect's defaults. One weather effect and one distortion effect can run per layer; use separate layers to combine more effects.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Layer` | layer | Effect layer (empty = base layer) |
| `Value_swayAmount` | number | Sideways swing distance (px) (default `10`) |
| `Value_swaySpeed` | number | Swing frequency (100 = one cycle/s) (default `8`) |
| `Value_swayIrregularity` | number | Swing irregularity (0-1) (default `0`) |

##### Configure fog placement

> Configure fog placement on layer _PARAM1_; Enabled: _PARAM2_; Intensity (0 = hidden, 1 = normal): _PARAM3_; Particle anchoring (rings always use world positions): _PARAM4_; Draw order: _PARAM5_; Snap to whole pixels: _PARAM6_

Start or configure fog without a behavior. Updates only these settings; other settings for this effect are preserved. Switching from another weather effect restores this effect's defaults. One weather effect and one distortion effect can run per layer; use separate layers to combine more effects.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Layer` | layer | Effect layer (empty = base layer) |
| `Value_enabled` | yes/no | Enabled (default `true`) |
| `Value_intensity` | number | Intensity (0 = hidden, 1 = normal) (default `1`) |
| `Value_anchoring` | choice: `World`, `Screen` | Particle anchoring (rings always use world positions) (default `World`) |
| `Value_zOrder` | number | Draw order (default `1000`) |
| `Value_pixelSnap` | yes/no | Snap to whole pixels (default `false`) |

##### Start embers

> Start embers on layer _PARAM1_; Intensity (0 = hidden, 1 = normal): _PARAM2_

Start embers without a behavior. Updates only these settings; other settings for this effect are preserved. Switching from another weather effect restores this effect's defaults. One weather effect and one distortion effect can run per layer; use separate layers to combine more effects.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Layer` | layer | Effect layer (empty = base layer) |
| `Value_intensity` | number | Intensity (0 = hidden, 1 = normal) (default `1`) |

##### Configure embers particles

> Configure embers particles on layer _PARAM1_; Density (particles per screen): _PARAM2_; Minimum size (px): _PARAM3_; Maximum size (px): _PARAM4_; Depth variation (0-1): _PARAM5_

Start or configure embers without a behavior. Updates only these settings; other settings for this effect are preserved. Switching from another weather effect restores this effect's defaults. One weather effect and one distortion effect can run per layer; use separate layers to combine more effects.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Layer` | layer | Effect layer (empty = base layer) |
| `Value_density` | number | Density (particles per screen) (default `90`) |
| `Value_minSize` | number | Minimum size (px) (default `2`) |
| `Value_maxSize` | number | Maximum size (px) (default `4`) |
| `Value_depthVariation` | number | Depth variation (0-1) (default `0.65`) |

##### Configure embers appearance

> Configure embers appearance on layer _PARAM1_; Colour: _PARAM2_; Opacity (0-255): _PARAM3_; Softness (0-1): _PARAM4_; Additive blending: _PARAM5_

Start or configure embers without a behavior. Updates only these settings; other settings for this effect are preserved. Switching from another weather effect restores this effect's defaults. One weather effect and one distortion effect can run per layer; use separate layers to combine more effects.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Layer` | layer | Effect layer (empty = base layer) |
| `Value_color` | colour | Colour (default `255;160;50`) |
| `Value_opacity` | number | Opacity (0-255) (default `220`) |
| `Value_softness` | number | Softness (0-1) (default `0.75`) |
| `Value_additive` | yes/no | Additive blending (default `true`) |

##### Configure embers rising

> Configure embers rising on layer _PARAM1_; Minimum travel speed (px/s): _PARAM2_; Maximum travel speed (px/s): _PARAM3_; Direction (degrees: 90 = down): _PARAM4_; Per-particle angle variation (degrees): _PARAM5_; Wind gusts (0-1): _PARAM6_

Start or configure embers without a behavior. Updates only these settings; other settings for this effect are preserved. Switching from another weather effect restores this effect's defaults. One weather effect and one distortion effect can run per layer; use separate layers to combine more effects.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Layer` | layer | Effect layer (empty = base layer) |
| `Value_minSpeed` | number | Minimum travel speed (px/s) (default `25`) |
| `Value_maxSpeed` | number | Maximum travel speed (px/s) (default `70`) |
| `Value_windAngle` | number | Direction (degrees: 90 = down) (default `275`) |
| `Value_windSpread` | number | Per-particle angle variation (degrees) (default `22`) |
| `Value_gustStrength` | number | Wind gusts (0-1) (default `0.45`) |

##### Configure embers flutter

> Configure embers flutter on layer _PARAM1_; Sideways swing distance (px): _PARAM2_; Swing frequency (100 = one cycle/s): _PARAM3_; Swing irregularity (0-1): _PARAM4_

Start or configure embers without a behavior. Updates only these settings; other settings for this effect are preserved. Switching from another weather effect restores this effect's defaults. One weather effect and one distortion effect can run per layer; use separate layers to combine more effects.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Layer` | layer | Effect layer (empty = base layer) |
| `Value_swayAmount` | number | Sideways swing distance (px) (default `22`) |
| `Value_swaySpeed` | number | Swing frequency (100 = one cycle/s) (default `90`) |
| `Value_swayIrregularity` | number | Swing irregularity (0-1) (default `0`) |

##### Configure embers placement

> Configure embers placement on layer _PARAM1_; Enabled: _PARAM2_; Intensity (0 = hidden, 1 = normal): _PARAM3_; Particle anchoring (rings always use world positions): _PARAM4_; Draw order: _PARAM5_; Snap to whole pixels: _PARAM6_

Start or configure embers without a behavior. Updates only these settings; other settings for this effect are preserved. Switching from another weather effect restores this effect's defaults. One weather effect and one distortion effect can run per layer; use separate layers to combine more effects.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Layer` | layer | Effect layer (empty = base layer) |
| `Value_enabled` | yes/no | Enabled (default `true`) |
| `Value_intensity` | number | Intensity (0 = hidden, 1 = normal) (default `1`) |
| `Value_anchoring` | choice: `World`, `Screen` | Particle anchoring (rings always use world positions) (default `World`) |
| `Value_zOrder` | number | Draw order (default `1000`) |
| `Value_pixelSnap` | yes/no | Snap to whole pixels (default `false`) |

##### Start water rings

> Start water rings on layer _PARAM1_; Intensity (0 = hidden, 1 = normal): _PARAM2_

Start water rings without a behavior. Updates only these settings; other settings for this effect are preserved. Switching from another weather effect restores this effect's defaults. One weather effect and one distortion effect can run per layer; use separate layers to combine more effects.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Layer` | layer | Effect layer (empty = base layer) |
| `Value_intensity` | number | Intensity (0 = hidden, 1 = normal) (default `1`) |

##### Configure water rings

> Configure water rings on layer _PARAM1_; Rings per second (0 = manual only): _PARAM2_; Minimum ring radius (px): _PARAM3_; Maximum ring radius (px): _PARAM4_; Ring lifetime (seconds): _PARAM5_

Start or configure water rings without a behavior. Updates only these settings; other settings for this effect are preserved. Switching from another weather effect restores this effect's defaults. One weather effect and one distortion effect can run per layer; use separate layers to combine more effects.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Layer` | layer | Effect layer (empty = base layer) |
| `Value_splashAmount` | number | Rings per second (0 = manual only) (default `8`) |
| `Value_splashMinRadius` | number | Minimum ring radius (px) (default `14`) |
| `Value_splashMaxRadius` | number | Maximum ring radius (px) (default `46`) |
| `Value_splashLife` | number | Ring lifetime (seconds) (default `2.2`) |

##### Configure water rings appearance

> Configure water rings appearance on layer _PARAM1_; Colour: _PARAM2_; Opacity (0-255): _PARAM3_; Additive blending: _PARAM4_

Start or configure water rings without a behavior. Updates only these settings; other settings for this effect are preserved. Switching from another weather effect restores this effect's defaults. One weather effect and one distortion effect can run per layer; use separate layers to combine more effects.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Layer` | layer | Effect layer (empty = base layer) |
| `Value_color` | colour | Colour (default `255;255;255`) |
| `Value_opacity` | number | Opacity (0-255) (default `130`) |
| `Value_additive` | yes/no | Additive blending (default `false`) |

##### Configure water rings placement

> Configure water rings placement on layer _PARAM1_; Enabled: _PARAM2_; Intensity (0 = hidden, 1 = normal): _PARAM3_; Draw order: _PARAM4_

Start or configure water rings without a behavior. Updates only these settings; other settings for this effect are preserved. Switching from another weather effect restores this effect's defaults. One weather effect and one distortion effect can run per layer; use separate layers to combine more effects.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Layer` | layer | Effect layer (empty = base layer) |
| `Value_enabled` | yes/no | Enabled (default `true`) |
| `Value_intensity` | number | Intensity (0 = hidden, 1 = normal) (default `1`) |
| `Value_zOrder` | number | Draw order (default `1000`) |

##### Start heat haze

> Start heat haze on layer _PARAM1_; Intensity (0 = hidden, 1 = normal): _PARAM2_

Start heat haze without a behavior. Updates only these settings; other settings for this effect are preserved. Switching from another distortion effect restores this effect's defaults. One weather effect and one distortion effect can run per layer; use separate layers to combine more effects.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Layer` | layer | Effect layer (empty = base layer) |
| `Value_intensity` | number | Intensity (0 = hidden, 1 = normal) (default `1`) |

##### Configure heat haze waves

> Configure heat haze waves on layer _PARAM1_; Wave strength (px): _PARAM2_; Horizontal wavelength (px): _PARAM3_; Vertical wavelength (px): _PARAM4_; Animation speed: _PARAM5_; Secondary detail (0-1): _PARAM6_

Start or configure heat haze without a behavior. Updates only these settings; other settings for this effect are preserved. Switching from another distortion effect restores this effect's defaults. One weather effect and one distortion effect can run per layer; use separate layers to combine more effects.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Layer` | layer | Effect layer (empty = base layer) |
| `Value_strength` | number | Wave strength (px) (default `4`) |
| `Value_wavelengthX` | number | Horizontal wavelength (px) (default `160`) |
| `Value_wavelengthY` | number | Vertical wavelength (px) (default `55`) |
| `Value_speed` | number | Animation speed (default `1.1`) |
| `Value_detail` | number | Secondary detail (0-1) (default `0.4`) |

##### Configure heat haze heat

> Configure heat haze heat on layer _PARAM1_; Rise speed multiplier: _PARAM2_; Fade toward top (0-1): _PARAM3_

Start or configure heat haze without a behavior. Updates only these settings; other settings for this effect are preserved. Switching from another distortion effect restores this effect's defaults. One weather effect and one distortion effect can run per layer; use separate layers to combine more effects.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Layer` | layer | Effect layer (empty = base layer) |
| `Value_riseSpeed` | number | Rise speed multiplier (default `1.6`) |
| `Value_horizonFade` | number | Fade toward top (0-1) (default `0.55`) |

##### Configure heat haze ripples

> Configure heat haze ripples on layer _PARAM1_; Ripple strength (px): _PARAM2_; Ripple expansion (px/s): _PARAM3_; Ripple lifetime (seconds): _PARAM4_; Ripple thickness (px): _PARAM5_

Start or configure heat haze without a behavior. Updates only these settings; other settings for this effect are preserved. Switching from another distortion effect restores this effect's defaults. One weather effect and one distortion effect can run per layer; use separate layers to combine more effects.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Layer` | layer | Effect layer (empty = base layer) |
| `Value_rippleStrength` | number | Ripple strength (px) (default `8`) |
| `Value_rippleSpeed` | number | Ripple expansion (px/s) (default `260`) |
| `Value_rippleLife` | number | Ripple lifetime (seconds) (default `1.6`) |
| `Value_rippleWidth` | number | Ripple thickness (px) (default `30`) |

##### Configure heat haze placement

> Configure heat haze placement on layer _PARAM1_; Enabled: _PARAM2_; Intensity (0 = hidden, 1 = normal): _PARAM3_; World anchoring (0 = screen, 1 = world): _PARAM4_

Start or configure heat haze without a behavior. Updates only these settings; other settings for this effect are preserved. Switching from another distortion effect restores this effect's defaults. One weather effect and one distortion effect can run per layer; use separate layers to combine more effects.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Layer` | layer | Effect layer (empty = base layer) |
| `Value_enabled` | yes/no | Enabled (default `true`) |
| `Value_intensity` | number | Intensity (0 = hidden, 1 = normal) (default `1`) |
| `Value_worldFollow` | number | World anchoring (0 = screen, 1 = world) (default `1`) |

##### Start heat shimmer

> Start heat shimmer on layer _PARAM1_; Intensity (0 = hidden, 1 = normal): _PARAM2_

Start heat shimmer without a behavior. Updates only these settings; other settings for this effect are preserved. Switching from another distortion effect restores this effect's defaults. One weather effect and one distortion effect can run per layer; use separate layers to combine more effects.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Layer` | layer | Effect layer (empty = base layer) |
| `Value_intensity` | number | Intensity (0 = hidden, 1 = normal) (default `1`) |

##### Configure heat shimmer

> Configure heat shimmer on layer _PARAM1_; Wave strength (px): _PARAM2_; Horizontal wavelength (px): _PARAM3_; Vertical wavelength (px): _PARAM4_; Animation speed: _PARAM5_; Secondary detail (0-1): _PARAM6_; Fade toward top (0-1): _PARAM7_

Start or configure heat shimmer without a behavior. Updates only these settings; other settings for this effect are preserved. Switching from another distortion effect restores this effect's defaults. One weather effect and one distortion effect can run per layer; use separate layers to combine more effects.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Layer` | layer | Effect layer (empty = base layer) |
| `Value_strength` | number | Wave strength (px) (default `5`) |
| `Value_wavelengthX` | number | Horizontal wavelength (px) (default `240`) |
| `Value_wavelengthY` | number | Vertical wavelength (px) (default `150`) |
| `Value_speed` | number | Animation speed (default `0.45`) |
| `Value_detail` | number | Secondary detail (0-1) (default `0.5`) |
| `Value_horizonFade` | number | Fade toward top (0-1) (default `0.6`) |

##### Configure heat shimmer ripples

> Configure heat shimmer ripples on layer _PARAM1_; Ripple strength (px): _PARAM2_; Ripple expansion (px/s): _PARAM3_; Ripple lifetime (seconds): _PARAM4_; Ripple thickness (px): _PARAM5_

Start or configure heat shimmer without a behavior. Updates only these settings; other settings for this effect are preserved. Switching from another distortion effect restores this effect's defaults. One weather effect and one distortion effect can run per layer; use separate layers to combine more effects.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Layer` | layer | Effect layer (empty = base layer) |
| `Value_rippleStrength` | number | Ripple strength (px) (default `8`) |
| `Value_rippleSpeed` | number | Ripple expansion (px/s) (default `260`) |
| `Value_rippleLife` | number | Ripple lifetime (seconds) (default `1.6`) |
| `Value_rippleWidth` | number | Ripple thickness (px) (default `30`) |

##### Configure heat shimmer placement

> Configure heat shimmer placement on layer _PARAM1_; Enabled: _PARAM2_; Intensity (0 = hidden, 1 = normal): _PARAM3_; World anchoring (0 = screen, 1 = world): _PARAM4_

Start or configure heat shimmer without a behavior. Updates only these settings; other settings for this effect are preserved. Switching from another distortion effect restores this effect's defaults. One weather effect and one distortion effect can run per layer; use separate layers to combine more effects.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Layer` | layer | Effect layer (empty = base layer) |
| `Value_enabled` | yes/no | Enabled (default `true`) |
| `Value_intensity` | number | Intensity (0 = hidden, 1 = normal) (default `1`) |
| `Value_worldFollow` | number | World anchoring (0 = screen, 1 = world) (default `1`) |

##### Start underwater

> Start underwater on layer _PARAM1_; Intensity (0 = hidden, 1 = normal): _PARAM2_

Start underwater without a behavior. Updates only these settings; other settings for this effect are preserved. Switching from another distortion effect restores this effect's defaults. One weather effect and one distortion effect can run per layer; use separate layers to combine more effects.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Layer` | layer | Effect layer (empty = base layer) |
| `Value_intensity` | number | Intensity (0 = hidden, 1 = normal) (default `1`) |

##### Configure underwater waves

> Configure underwater waves on layer _PARAM1_; Wave strength (px): _PARAM2_; Horizontal wavelength (px): _PARAM3_; Vertical wavelength (px): _PARAM4_; Animation speed: _PARAM5_; Secondary detail (0-1): _PARAM6_

Start or configure underwater without a behavior. Updates only these settings; other settings for this effect are preserved. Switching from another distortion effect restores this effect's defaults. One weather effect and one distortion effect can run per layer; use separate layers to combine more effects.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Layer` | layer | Effect layer (empty = base layer) |
| `Value_strength` | number | Wave strength (px) (default `9`) |
| `Value_wavelengthX` | number | Horizontal wavelength (px) (default `220`) |
| `Value_wavelengthY` | number | Vertical wavelength (px) (default `190`) |
| `Value_speed` | number | Animation speed (default `0.55`) |
| `Value_detail` | number | Secondary detail (0-1) (default `0.3`) |

##### Configure underwater ripples

> Configure underwater ripples on layer _PARAM1_; Ripple strength (px): _PARAM2_; Ripple expansion (px/s): _PARAM3_; Ripple lifetime (seconds): _PARAM4_; Ripple thickness (px): _PARAM5_

Start or configure underwater without a behavior. Updates only these settings; other settings for this effect are preserved. Switching from another distortion effect restores this effect's defaults. One weather effect and one distortion effect can run per layer; use separate layers to combine more effects.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Layer` | layer | Effect layer (empty = base layer) |
| `Value_rippleStrength` | number | Ripple strength (px) (default `10`) |
| `Value_rippleSpeed` | number | Ripple expansion (px/s) (default `220`) |
| `Value_rippleLife` | number | Ripple lifetime (seconds) (default `2`) |
| `Value_rippleWidth` | number | Ripple thickness (px) (default `40`) |

##### Configure underwater placement

> Configure underwater placement on layer _PARAM1_; Enabled: _PARAM2_; Intensity (0 = hidden, 1 = normal): _PARAM3_; World anchoring (0 = screen, 1 = world): _PARAM4_

Start or configure underwater without a behavior. Updates only these settings; other settings for this effect are preserved. Switching from another distortion effect restores this effect's defaults. One weather effect and one distortion effect can run per layer; use separate layers to combine more effects.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Layer` | layer | Effect layer (empty = base layer) |
| `Value_enabled` | yes/no | Enabled (default `true`) |
| `Value_intensity` | number | Intensity (0 = hidden, 1 = normal) (default `1`) |
| `Value_worldFollow` | number | World anchoring (0 = screen, 1 = world) (default `1`) |

##### Start distortion ripples

> Start distortion ripples on layer _PARAM1_; Intensity (0 = hidden, 1 = normal): _PARAM2_

Start distortion ripples without a behavior. Updates only these settings; other settings for this effect are preserved. Switching from another distortion effect restores this effect's defaults. One weather effect and one distortion effect can run per layer; use separate layers to combine more effects.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Layer` | layer | Effect layer (empty = base layer) |
| `Value_intensity` | number | Intensity (0 = hidden, 1 = normal) (default `1`) |

##### Configure distortion ripples

> Configure distortion ripples on layer _PARAM1_; Ripple strength (px): _PARAM2_; Ripple expansion (px/s): _PARAM3_; Ripple lifetime (seconds): _PARAM4_; Ripple thickness (px): _PARAM5_

Start or configure distortion ripples without a behavior. Updates only these settings; other settings for this effect are preserved. Switching from another distortion effect restores this effect's defaults. One weather effect and one distortion effect can run per layer; use separate layers to combine more effects.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Layer` | layer | Effect layer (empty = base layer) |
| `Value_rippleStrength` | number | Ripple strength (px) (default `12`) |
| `Value_rippleSpeed` | number | Ripple expansion (px/s) (default `300`) |
| `Value_rippleLife` | number | Ripple lifetime (seconds) (default `1.4`) |
| `Value_rippleWidth` | number | Ripple thickness (px) (default `26`) |

##### Configure distortion ripples placement

> Configure distortion ripples placement on layer _PARAM1_; Enabled: _PARAM2_; Intensity (0 = hidden, 1 = normal): _PARAM3_

Start or configure distortion ripples without a behavior. Updates only these settings; other settings for this effect are preserved. Switching from another distortion effect restores this effect's defaults. One weather effect and one distortion effect can run per layer; use separate layers to combine more effects.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Layer` | layer | Effect layer (empty = base layer) |
| `Value_enabled` | yes/no | Enabled (default `true`) |
| `Value_intensity` | number | Intensity (0 = hidden, 1 = normal) (default `1`) |

##### Start tear lines

> Start tear lines on layer _PARAM1_; Intensity (0 = hidden, 1 = normal): _PARAM2_

Start tear lines without a behavior. Updates only these settings; other settings for this effect are preserved. Switching from another distortion effect restores this effect's defaults. One weather effect and one distortion effect can run per layer; use separate layers to combine more effects.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Layer` | layer | Effect layer (empty = base layer) |
| `Value_intensity` | number | Intensity (0 = hidden, 1 = normal) (default `1`) |

##### Configure tear lines strips

> Configure tear lines strips on layer _PARAM1_; Strip offset (px): _PARAM2_; Strip coverage (0-1): _PARAM3_; Strip height (px; 0 = smooth): _PARAM4_; Band spacing (px): _PARAM5_; Animation speed: _PARAM6_; Wave strength (px): _PARAM7_

Start or configure tear lines without a behavior. Updates only these settings; other settings for this effect are preserved. Switching from another distortion effect restores this effect's defaults. One weather effect and one distortion effect can run per layer; use separate layers to combine more effects.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Layer` | layer | Effect layer (empty = base layer) |
| `Value_tearStrength` | number | Strip offset (px) (default `7`) |
| `Value_tearWidth` | number | Strip coverage (0-1) (default `0.35`) |
| `Value_tearStripHeight` | number | Strip height (px; 0 = smooth) (default `4`) |
| `Value_wavelengthY` | number | Band spacing (px) (default `90`) |
| `Value_speed` | number | Animation speed (default `0.35`) |
| `Value_strength` | number | Wave strength (px) (default `2`) |

##### Configure tear lines ripples

> Configure tear lines ripples on layer _PARAM1_; Ripple strength (px): _PARAM2_; Ripple expansion (px/s): _PARAM3_; Ripple lifetime (seconds): _PARAM4_; Ripple thickness (px): _PARAM5_

Start or configure tear lines without a behavior. Updates only these settings; other settings for this effect are preserved. Switching from another distortion effect restores this effect's defaults. One weather effect and one distortion effect can run per layer; use separate layers to combine more effects.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Layer` | layer | Effect layer (empty = base layer) |
| `Value_rippleStrength` | number | Ripple strength (px) (default `8`) |
| `Value_rippleSpeed` | number | Ripple expansion (px/s) (default `260`) |
| `Value_rippleLife` | number | Ripple lifetime (seconds) (default `1.6`) |
| `Value_rippleWidth` | number | Ripple thickness (px) (default `30`) |

##### Configure tear lines placement

> Configure tear lines placement on layer _PARAM1_; Enabled: _PARAM2_; Intensity (0 = hidden, 1 = normal): _PARAM3_; World anchoring (0 = screen, 1 = world): _PARAM4_

Start or configure tear lines without a behavior. Updates only these settings; other settings for this effect are preserved. Switching from another distortion effect restores this effect's defaults. One weather effect and one distortion effect can run per layer; use separate layers to combine more effects.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Layer` | layer | Effect layer (empty = base layer) |
| `Value_enabled` | yes/no | Enabled (default `true`) |
| `Value_intensity` | number | Intensity (0 = hidden, 1 = normal) (default `1`) |
| `Value_worldFollow` | number | World anchoring (0 = screen, 1 = world) (default `1`) |

##### Start magnifier band

> Start magnifier band on layer _PARAM1_; Intensity (0 = hidden, 1 = normal): _PARAM2_

Start magnifier band without a behavior. Updates only these settings; other settings for this effect are preserved. Switching from another distortion effect restores this effect's defaults. One weather effect and one distortion effect can run per layer; use separate layers to combine more effects.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Layer` | layer | Effect layer (empty = base layer) |
| `Value_intensity` | number | Intensity (0 = hidden, 1 = normal) (default `1`) |

##### Configure magnifier band lens

> Configure magnifier band lens on layer _PARAM1_; Magnification (1 = unchanged): _PARAM2_; Band thickness (px): _PARAM3_; Band spacing (px): _PARAM4_; Animation speed: _PARAM5_

Start or configure magnifier band without a behavior. Updates only these settings; other settings for this effect are preserved. Switching from another distortion effect restores this effect's defaults. One weather effect and one distortion effect can run per layer; use separate layers to combine more effects.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Layer` | layer | Effect layer (empty = base layer) |
| `Value_magnification` | number | Magnification (1 = unchanged) (default `1.35`) |
| `Value_bandWidth` | number | Band thickness (px) (default `70`) |
| `Value_wavelengthY` | number | Band spacing (px) (default `420`) |
| `Value_speed` | number | Animation speed (default `0.25`) |

##### Configure magnifier band ripples

> Configure magnifier band ripples on layer _PARAM1_; Ripple strength (px): _PARAM2_; Ripple expansion (px/s): _PARAM3_; Ripple lifetime (seconds): _PARAM4_; Ripple thickness (px): _PARAM5_

Start or configure magnifier band without a behavior. Updates only these settings; other settings for this effect are preserved. Switching from another distortion effect restores this effect's defaults. One weather effect and one distortion effect can run per layer; use separate layers to combine more effects.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Layer` | layer | Effect layer (empty = base layer) |
| `Value_rippleStrength` | number | Ripple strength (px) (default `8`) |
| `Value_rippleSpeed` | number | Ripple expansion (px/s) (default `260`) |
| `Value_rippleLife` | number | Ripple lifetime (seconds) (default `1.6`) |
| `Value_rippleWidth` | number | Ripple thickness (px) (default `30`) |

##### Configure magnifier band placement

> Configure magnifier band placement on layer _PARAM1_; Enabled: _PARAM2_; Intensity (0 = hidden, 1 = normal): _PARAM3_; World anchoring (0 = screen, 1 = world): _PARAM4_

Start or configure magnifier band without a behavior. Updates only these settings; other settings for this effect are preserved. Switching from another distortion effect restores this effect's defaults. One weather effect and one distortion effect can run per layer; use separate layers to combine more effects.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Layer` | layer | Effect layer (empty = base layer) |
| `Value_enabled` | yes/no | Enabled (default `true`) |
| `Value_intensity` | number | Intensity (0 = hidden, 1 = normal) (default `1`) |
| `Value_worldFollow` | number | World anchoring (0 = screen, 1 = world) (default `1`) |

##### Start weather on a layer

> Start weather on layer _PARAM1_; type: _PARAM2_; intensity: _PARAM3_

Start snow, rain, fog, embers or water rings with a built-in look. No object or behavior is needed. Once started it keeps running on its own - there is no "update every frame" action to remember. Calling it again on the same layer changes the running weather rather than stacking a second one.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Layer` | layer | Layer to draw the weather on (empty = base layer) |
| `Type` | choice: `Snow`, `Rain`, `Fog`, `Embers`, `Ripples` | Weather type (default `Snow`) |
| `Intensity` | number | Intensity multiplier (0 = none, 1 = normal) (default `1`) |

##### Set weather intensity on a layer

> Set weather intensity on layer _PARAM1_ to _PARAM2_

Change how much weather is drawn without restarting it. 0 is none, 1 is normal. Tween this to build a storm up or let it fade out.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Layer` | layer | Layer the weather is on (empty = base layer) |
| `Intensity` | number | Intensity (0 = hidden, 1 = full effect) (default `1`) |

##### Set weather wind on a layer

> Set wind on layer _PARAM1_ to angle _PARAM2_ degrees, spread _PARAM3_

Change the direction the weather travels. Angles follow GDevelop: 0 is right, 90 is straight down, 270 is straight up.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Layer` | layer | Layer the weather is on (empty = base layer) |
| `Angle` | number | Wind angle in degrees (0 = right, 90 = down) (default `90`) |
| `Spread` | number | Spread in degrees (default `14`) |

##### Set weather colour on a layer

> Set weather on layer _PARAM1_ to colour _PARAM2_ with opacity _PARAM3_

Tint the weather and set how solid it is. Opacity runs 0 to 255.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Layer` | layer | Layer the weather is on (empty = base layer) |
| `Color` | colour | Particle colour (default `255;255;255`) |
| `Opacity` | number | Opacity from 0 to 255 (default `210`) |

##### Spawn a water ring on a layer

> Spawn a water ring on layer _PARAM1_ at _PARAM2_ ; _PARAM3_ with size _PARAM4_

Draw one expanding ring at a point in SCENE coordinates. This is the drawn-ring kind that sits on top of the water, not the shader kind that bends the image. Needs weather started on that layer first - the Ripples type is the natural one, but any type will draw rings.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Layer` | layer | Layer the weather is on (empty = base layer) |
| `X` | number | Scene X coordinate (default `0`) |
| `Y` | number | Scene Y coordinate (default `0`) |
| `Size` | number | Size multiplier (1 = the configured radius) (default `1`) |

##### Stop weather on a layer

> Stop weather on layer _PARAM1_

Remove the weather from a layer completely and free its particles. To turn it off temporarily, set the intensity to 0 instead - that keeps the field alive so restarting is instant.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Layer` | layer | Layer the weather is on (empty = base layer) |

##### Start distortion on a layer

> Start distortion on layer _PARAM1_; mode: _PARAM2_; intensity: _PARAM3_

Start heat haze, heat shimmer, underwater, tear lines, a magnifier band or ripples only. No object or behavior is needed. Once started it keeps running on its own. Calling it again on the same layer changes the running distortion rather than stacking a second shader.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Layer` | layer | Layer to distort (empty = base layer) |
| `Mode` | choice: `Heat Haze`, `Underwater`, `Ripples Only`, `Heat Shimmer`, `Tear Lines`, `Magnifier Band` | Distortion mode (default `Heat Haze`) |
| `Intensity` | number | Intensity multiplier (0 = flat, 1 = normal) (default `1`) |

##### Set distortion intensity on a layer

> Set distortion intensity on layer _PARAM1_ to _PARAM2_

Change how strongly the layer is bent without restarting the shader. 0 is flat, 1 is normal.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Layer` | layer | Layer the distortion is on (empty = base layer) |
| `Intensity` | number | Intensity (0 = hidden, 1 = full effect) (default `1`) |

##### Spawn a distortion ripple on a layer

> Spawn a ripple on layer _PARAM1_ at _PARAM2_ ; _PARAM3_

Start distortion on this layer first. Spawn an expanding ripple at scene coordinates - the same numbers Object.X() and CursorX() give you. The ripple stays over that spot on the map while the camera moves. Up to 12 can run at once; a thirteenth replaces the oldest.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Layer` | layer | Layer the distortion is on (empty = base layer) |
| `X` | number | Scene X coordinate (default `0`) |
| `Y` | number | Scene Y coordinate (default `0`) |

##### Stop distortion on a layer

> Stop distortion on layer _PARAM1_

Remove the distortion shader from a layer completely. To flatten it temporarily, set the intensity to 0 instead.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Layer` | layer | Layer the distortion is on (empty = base layer) |

##### Set global weather intensity

> Set global WeatherFX intensity to _PARAM1_

Scale every weather emitter and distortion in the scene at once, on top of their own intensity settings. One dial for "how bad is the weather right now", or for an accessibility option that turns all screen motion down.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Intensity` | number | Global multiplier from 0 to 1 (default `1`) |

##### Pause / resume all WeatherFX effects

> Set all WeatherFX effects paused: _PARAM1_

Pause animation and hide all weather and distortion effects. Resume to show them again and continue animation.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Paused` | yes/no | Paused |

##### Set weather numeric setting on a layer

> Set weather on layer _PARAM1_; setting: _PARAM2_; value: _PARAM3_

Adjust one setting. Sizes and distances use screen pixels; movement uses pixels per second. Intensity: 0 = hidden, 1 = normal. Opacity: 0-255. Start the effect first.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Layer` | layer | Effect layer (empty = base layer) |
| `Setting` | choice: `Intensity`, `Density`, `Minimum size`, `Maximum size`, `Softness`, `Minimum speed`, `Maximum speed`, `Wind angle`, `Wind spread`, `Gust strength`, `Sway distance`, `Sway speed`, `Sway irregularity`, `Opacity`, `Depth variation`, `Rain streak width`, `Rain streak length`, `Rings per second`, `Ring minimum radius`, `Ring maximum radius`, `Ring lifetime`, `Draw order` | Setting (default `Intensity`) |
| `Value` | number | New value (default `1`) |

##### Set weather option on a layer

> Set weather on layer _PARAM1_; setting: _PARAM2_; value: _PARAM3_

Turn the selected option on or off. Start the effect on this layer first.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Layer` | layer | Effect layer (empty = base layer) |
| `Setting` | choice: `Enabled`, `Additive blending`, `Snap to whole pixels` | Setting (default `Enabled`) |
| `Value` | yes/no | Turn this option on |

##### Set distortion numeric setting on a layer

> Set distortion on layer _PARAM1_; setting: _PARAM2_; value: _PARAM3_

Adjust one setting. Sizes and distances use screen pixels; movement uses pixels per second. Intensity: 0 = hidden, 1 = normal. Opacity: 0-255. Start the effect first.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Layer` | layer | Effect layer (empty = base layer) |
| `Setting` | choice: `Intensity`, `Wave strength`, `Wavelength across`, `Wavelength down`, `Wave speed`, `Secondary detail`, `Heat rise speed`, `Fade toward top`, `World follow`, `Ripple strength`, `Ripple expansion speed`, `Ripple lifetime`, `Ripple ring thickness`, `Tear line offset`, `Tear line coverage`, `Tear strip height`, `Magnification`, `Magnifier band thickness` | Setting (default `Intensity`) |
| `Value` | number | New value (default `1`) |

##### Set distortion option (legacy)

> Set distortion on layer _PARAM1_; setting: _PARAM2_; value: _PARAM3_

For existing events. Use Enable / disable distortion on a layer for a direct toggle.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Layer` | layer | Effect layer (empty = base layer) |
| `Setting` | choice: `Enabled` | Setting (default `Enabled`) |
| `Value` | yes/no | Turn this option on |

##### Set weather type on a layer

> Set weather type on layer _PARAM1_ to _PARAM2_

Switch to a built-in look and reset its custom appearance and motion settings. Keeps intensity and placement. Start the effect on this layer first.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Layer` | layer | Effect layer (empty = base layer) |
| `Value` | choice: `Snow`, `Rain`, `Fog`, `Embers`, `Ripples` | weather type (default `Snow`) |

##### Set weather anchoring on a layer

> Set weather anchoring on layer _PARAM1_ to _PARAM2_

World keeps particles on the map as the camera moves. Screen keeps falling particles attached to the view. Water rings and rain splashes always stay at their world positions. Start weather on this layer first.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Layer` | layer | Effect layer (empty = base layer) |
| `Value` | choice: `World`, `Screen` | weather anchoring (default `World`) |

##### Set distortion mode on a layer

> Set distortion mode on layer _PARAM1_ to _PARAM2_

Switch to a built-in look and reset its custom appearance and motion settings. Keeps intensity and placement. Start the effect on this layer first.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Layer` | layer | Effect layer (empty = base layer) |
| `Value` | choice: `Heat Haze`, `Underwater`, `Ripples Only`, `Heat Shimmer`, `Tear Lines`, `Magnifier Band` | distortion mode (default `Heat Haze`) |

##### Enable / disable distortion on a layer

> Set distortion on layer _PARAM1_ enabled: _PARAM2_

Show or hide the distortion already started on this layer. Turning it off keeps its settings. Start distortion on this layer first.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Layer` | layer | Effect layer (empty = base layer) |
| `Enabled` | yes/no | Enabled |

#### Conditions

##### Weather or distortion exists on a layer

> Weather or distortion exists on layer _PARAM1_

True when standalone weather or distortion has been started on this layer, including hidden or paused effects. False after both effects are stopped.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Layer` | layer | Layer to check (empty = base layer) |

##### All WeatherFX effects are paused

> All WeatherFX effects are paused

Check whether the scene-wide pause is currently on.

*No parameters.*

##### WeatherFX 2D is supported

> WeatherFX 2D is supported on this device

Check that the game is running on WebGL. The distortion shader needs it; on a canvas fallback the particles still work but the distortion does nothing.

*No parameters.*

#### Expressions

##### Particle count on a layer

How many particles the weather on a layer currently holds, including the off-screen margin.

Returns a **number**. Call as `WeatherFX2D::ParticleCountOnLayer(...)`.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Layer` | layer | Layer the weather is on (empty = base layer) |

##### Ripple count on a layer

How many ripples are currently animating on a layer, out of a maximum of 12.

Returns a **number**. Call as `WeatherFX2D::RippleCountOnLayer(...)`.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Layer` | layer | Layer the distortion is on (empty = base layer) |

##### Global weather intensity

The current scene-wide intensity multiplier.

Returns a **number**. Call as `WeatherFX2D::GlobalIntensity(...)`.

*No parameters.*

##### Weather setting on a layer

Read a numeric setting, including built-in defaults. Returns 0 when no effect is running.

Returns a **number**. Call as `WeatherFX2D::WeatherSetting(...)`.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Layer` | layer | Effect layer (empty = base layer) |
| `Setting` | choice: `Intensity`, `Density`, `Minimum size`, `Maximum size`, `Softness`, `Minimum speed`, `Maximum speed`, `Wind angle`, `Wind spread`, `Gust strength`, `Sway distance`, `Sway speed`, `Sway irregularity`, `Opacity`, `Depth variation`, `Rain streak width`, `Rain streak length`, `Rings per second`, `Ring minimum radius`, `Ring maximum radius`, `Ring lifetime`, `Draw order` | Setting (default `Intensity`) |

##### Distortion setting on a layer

Read a numeric setting, including built-in defaults. Returns 0 when no effect is running.

Returns a **number**. Call as `WeatherFX2D::DistortionSetting(...)`.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `Layer` | layer | Effect layer (empty = base layer) |
| `Setting` | choice: `Intensity`, `Wave strength`, `Wavelength across`, `Wavelength down`, `Wave speed`, `Secondary detail`, `Heat rise speed`, `Fade toward top`, `World follow`, `Ripple strength`, `Ripple expansion speed`, `Ripple lifetime`, `Ripple ring thickness`, `Tear line offset`, `Tear line coverage`, `Tear strip height`, `Magnification`, `Magnifier band thickness` | Setting (default `Intensity`) |
