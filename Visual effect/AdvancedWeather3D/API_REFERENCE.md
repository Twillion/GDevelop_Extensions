# AdvancedWeather3D — API Reference

Detailed reference for all behaviors, properties, actions, conditions, and expressions provided by the **AdvancedWeather3D** extension in GDevelop 5.

---

## 1. Modular Behaviors

AdvancedWeather3D provides six dedicated weather behaviors, one universal master behavior, and one shelter behavior.

### 🌧️ `RainVolume3D` (Rain Volume 3D)
Attach to a 3D Box. Simulates falling rain with velocity-aligned streaks, floor/roof impact ripple rings, and lightning strikes.

- **Properties**:
  - `VolumeMode`: `BoundedBox` (default) or `FollowCamera`. Follow mode keeps existing particles and ripples world-anchored and seeds recycled particles at the camera-facing leading edge.
  - `ParticleDensity`: Number of falling raindrops (default `800`).
  - `ParticleSpeed`: Terminal fall speed in units/sec (default `520.0`).
  - `StreakLength`: Streak elongation length (default `22.0`).
  - `StreakThickness`: Cross-section width/thickness of streaks (default `2.2`).
  - `ParticleColor`: Color tint (default `190;220;255`).
  - `ParticleOpacity`: Opacity factor `0.0` to `1.0` (default `0.75`).
  - `WindSpeed`: Horizontal wind speed (default `60.0`).
  - `WindDirection`: Wind azimuth compass angle in degrees `0` to `360` (default `45.0`).
  - `WindPitch`: Wind vertical pitch tilt `-85` to `+85` degrees (default `0.0`).
  - `WindTurbulence`: Gustiness factor (default `0.3`).
  - `EnableFloorSplashes`: Spawns expanding ripple rings on floor/roofs (default `true`).
  - `SplashSize`: Ripple ring maximum radius (default `14.0`).
  - `RippleStyle`: `Ring`, `DoubleRing`, or `Crown` (default `Ring`).
  - `EnableLightning`: Enables thunderstorm lightning flashes (default `false`).
  - `LightningIntervalMin`: Min delay between lightning strikes (default `8.0`).
  - `LightningIntervalMax`: Max delay between lightning strikes (default `22.0`).

### ❄️ `SnowVolume3D` (Snow Volume 3D)
Attach to a 3D Box. Simulates gentle fluttering snowflakes with lateral swaying motion.

- **Properties**:
  - `VolumeMode`: `BoundedBox` or `FollowCamera`.
  - `ParticleDensity`: Snowflake count (default `600`).
  - `ParticleSpeed`: Gentle fall speed (default `85.0`).
  - `ParticleSize`: Flake radius (default `4.5`).
  - `SwayAmount`: Lateral flutter amplitude in units (default `28.0`).
  - `SwaySpeed`: Flutter frequency in Hz (default `2.2`).
  - `ParticleColor`: Color tint (default `245;250;255`).
  - `ParticleOpacity`: Opacity (default `0.90`).
  - `WindSpeed`, `WindDirection`, `WindPitch`, `WindTurbulence`.

### 🌫️ `ClusteredFogVolume3D` (Clustered Fog Volume 3D)
Attach to a 3D Box (or stack onto a rain box). Renders a 3D raymarched volumetric fog with Beer-Lambert extinction, Henyey-Greenstein forward solar scattering, 3D wind advection, ground height falloff, and CPU spatial sampling.

- **Properties**:
  - `VolumeMode`: `BoundedBox` or `FollowCamera`.
  - `FogThickness`: Physical optical extinction and opacity per meter (default `0.05`).
  - `FogHeightFalloff`: Exponential ground fog accumulation (default `1.5`).
  - `FogAnisotropy`: Henyey-Greenstein phase $g$ (`-0.8` to `+0.8`, default `0.4` for sunbeams/god rays).
  - `FogColor`: Albedo color tint (default `200;215;230`).
  - `FogNoiseScale`: Procedural 3D cluster noise frequency (default `1.0`).
  - `FogQuality`: `Low` (12 samples), `Medium` (24), `High` (40), or `Ultra` (64).
  - `WindSpeed`, `WindDirection`, `WindPitch`: Controls real-time 3D wind advection through the fog volume.
  - Lightning enable, interval, color, and intensity controls for autonomous internal flashes. Lightning from another weather behavior on the same host object also illuminates the fog.
- **Expressions**:
  - `Object.ClusteredFogVolume3D::FogDensityAt(X, Y, Z)`: Evaluates real-time volumetric fog density at any 3D coordinate (great for stealth/visibility mechanics).
  - `Object.ClusteredFogVolume3D::FogThickness()`: Returns current optical thickness.

### 🧊 `HailVolume3D` (Hail Volume 3D)
Attach to a 3D Box. Simulates fast-falling icy pellets with swept roof collision, rebound arcs, and impact splashes.

- **Properties**:
  - `ParticleDensity`: Hail count (default `400`).
  - `ParticleSpeed`: Rapid fall speed (default `650.0`).
  - `ParticleSize`: Pellet diameter (default `3.8`).
  - `StreakLength`, `StreakThickness`, `ParticleColor`, and `ParticleOpacity`.
  - `EnableFloorSplashes`, `SplashSize`, `SplashLifetime`, and `SplashDensity`.
  - `RippleStyle`: `Ring`, `DoubleRing`, or `Crown` (default `Crown`).
  - `WindSpeed`, `WindDirection`, `WindPitch`, and `WindTurbulence`.
  - Full lightning enable, interval, trigger, brightness, and elapsed-time controls.

### 🔥 `EmbersVolume3D` (Embers & Sparks Volume 3D)
Attach to a 3D Box. Simulates upward-rising embers with additive fire glow blending and turbulent draft swirling.

- **Properties**:
  - `ParticleDensity`: Ember count (default `350`).
  - `ParticleSpeed`: Negative speed indicating upward draft (default `-55.0`).
  - `ParticleSize`: Spark size (default `3.2`).
  - `SwayAmount`, `SwaySpeed`: Fluttering draft motion (default `35.0` / `3.0`).
  - `ParticleColor`: Fiery orange/gold tint (default `255;125;35`).
  - `StreakLength`, `StreakThickness`, `SwayAmount`, and `SwaySpeed`.
  - `WindSpeed`, `WindDirection`, `WindPitch`, `WindTurbulence`.

### 🌪️ `DustVolume3D` (Dust & Sand Volume 3D)
Attach to a 3D Box. Combines airborne dust or sand particles with an optional color-matched volumetric haze.

- **Properties**:
  - `ParticleDensity`, `ParticleSpeed`, `ParticleSpeedVariation`, `ParticleSize`, `ParticleColor`, and `ParticleOpacity`.
  - `SwayAmount`, `SwaySpeed`, plus full 3D wind and turbulence controls.
  - `EnableDustHaze`: Toggles raymarched haze independently of the motes.
  - `FogThickness`, `FogHeightFalloff`, `FogAnisotropy`, `FogColor`, `FogNoiseScale`, and `FogQuality`.

### 🌐 `WeatherVolume3D` (Universal Weather Volume 3D)
Universal master behavior containing all controls, preset switching, and custom weather simulation capabilities.

- **Properties**:
  - `WeatherType`: `Rain`, `Snow`, `Hail`, `Dust`, `Embers`, `Fog`, `Custom`.
  - All particle, wind, splash, fog, and lightning properties.

### 🏠 `WeatherShelter3D` (Weather Shelter 3D)
Attach to roofs, canopies, bridges, or ceilings. Blocks precipitation from passing into dry areas beneath.

- **Properties**:
  - `ShelterEnabled`: Toggle occlusion on/off (default `true`).
  - `SplashOnRoof`: Spawns ripples on roof surface (default `true`).

---

## 2. Common Actions, Conditions & Expressions

The universal behavior exposes the complete interface below. Dedicated behaviors expose the actions and expressions relevant to their effect.

### Actions
- **Set wind speed**: Update wind velocity force.
- **Set wind direction**: Set horizontal azimuth compass angle (0° - 360°).
- **Set wind vertical pitch**: Set vertical tilt (-85° downward to +85° upward).
- **Set streak thickness**: Set physical width of streaks/particles.
- **Set fog optical thickness**: Adjust extinction/density.
- **Set volumetric fog quality**: Choose a 12, 24, 40, or 64-sample raymarch tier.
- **Set impact ripple style**: Switch live between a single ring, double ring, or raised splash crown.
- **Trigger lightning flash**: Manually trigger a multi-pulse lightning flash.
- **Set weather volume enabled**: Toggle simulation on/off.
- **Show volume debug wireframe**: View bounding box in-game.

### Conditions
- **Is weather volume active**: True if simulation is running.
- **Is lightning flashing**: True during an active lightning flash.
- **Is point inside weather volume**: Checks if (X, Y, Z) is within volume.
- **Is object inside weather volume**: Checks if target 3D object is inside volume.

### Expressions
- `Object.<Behavior>::WindSpeed()`: Wind speed in units/sec.
- `Object.<Behavior>::WindDirection()`: Wind horizontal azimuth.
- `Object.<Behavior>::WindPitch()`: Wind vertical tilt.
- `Object.<Behavior>::StreakThickness()`: Streak/particle thickness.
- `Object.<Behavior>::FogThickness()`: Fog optical extinction.
- `Object.<Behavior>::FogDensityAt(X, Y, Z)`: Evaluated density at position.
- `Object.<Behavior>::LightningBrightness()`: Lightning intensity (0.0 to 1.0).
- `Object.<Behavior>::TimeSinceLastLightning()`: Elapsed seconds since last strike.
- `Object.<Behavior>::VolumeWidth()`, `VolumeHeight()`, `VolumeDepth()`: Dimensions.

---

## 3. Global Functions

Affect all weather volumes scene-wide.

- **Actions**:
  - `Set global wind` (`Speed`, `Direction`): Adds an independent horizontal wind vector to every volume's local 3D wind.
  - `Set global weather simulation speed` (`Multiplier`): Freeze (0.0), slow-mo (0.5), or speed up weather.
- **Expressions**:
  - `AdvancedWeather3D::GlobalWindSpeed()`
  - `AdvancedWeather3D::GlobalWindDirection()`
