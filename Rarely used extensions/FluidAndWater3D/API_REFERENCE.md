# FluidAndWater3D — API Reference & Specification

Complete specification of Behavior properties, Actions, Conditions, Expressions (ACEs), and Preset profiles for **FluidAndWater3D**.

---

## 1. `WaterBody3D` Behavior Properties (Macro Oceans & Pools)

### Group 1: Waves & Wind
| Property | Type | Default | Description |
| :--- | :--- | :---: | :--- |
| **`WaterType`** | Choice | `"Ocean"` | Reserved profile label. The current runtime stores it but does not retune other properties. |
| **`WaveHeight`** | Number | `18` | Master Gerstner-wave amplitude in GDevelop scene units. |
| **`WaveChoppiness`** | Number | `0.75` | Gerstner peak sharpness ($0.0 = \text{Smooth Sine}$, $1.0 = \text{Sharp Crests}$). |
| **`WaveSpeed`** | Number | `1.0` | Time frequency multiplier for wave propagation. |
| **`WindDirection`** | Number | `45.0` | Direction waves travel across the scene in degrees ($0 - 360^\circ$). |
| **`WaveTiling`** | Number | `1.0` | Divides the base wavelength. Higher = more, smaller waves; lower = longer swells. |
| **`DirectionalSpread`** | Number | `45.0` | How widely waves fan out from the wind, in degrees. **0** puts every wave on the wind — clean rolling swell all travelling one way. **45** is a normal wind sea. **70-90** gives a confused, choppy sea with crests in many directions. Raise this if the surface reads as parallel ridges all marching together. |
| **`PhaseSeed`** | Number | `0` | Shifts every octave by a different amount, producing a completely different arrangement of crests from the same sea state. Deterministic: the same value always rebuilds the same surface. |
| **`WaveIrregularity`** | Number | `0.4` | Deterministically bends and slowly evolves crest lines to break up straight Gerstner bands. `0` preserves straight authored waves; `1` is strongly confused. CPU queries and the GPU shader use the same term. |
| **`WaveScaleMode`** | Choice | `"Absolute"` | `"Absolute"` — wavelength is a fixed 300 units whatever the volume's size, so waves stay world-space and adjacent bodies tile seamlessly (oceans). `"RelativeToVolume"` — one base wave spans the volume's shorter horizontal side at `WaveTiling` 1, so waves stay proportional to the object (pools, ponds, lakes). |
| **`GridSubdivisions`** | Number | `48` | Surface mesh resolution (8 - 256). Sets which wave octaves can be drawn at all — see *Wave Scale and Mesh Resolution*. Raise it on large volumes. |

### Group 2: Color & Optics
| Property | Type | Default | Description |
| :--- | :--- | :---: | :--- |
| **`MaterialSource`** | Choice | `"Builtin"` | Reserved selector. The current runtime always uses its built-in shader; `"Material3D"` delegation is not implemented. |
| **`ShallowColor`** | Color | `"64; 224; 208"` | Color at shallow water depths (Turquoise). |
| **`DeepColor`** | Color | `"10; 45; 90"` | Color in deep oceanic trenches (Dark Navy). |
| **`ExtinctionDepth`** | Number | `150.0` | Beer-Lambert scale length. Larger values keep water reading as `ShallowColor` further from the shoreline. See *Optical depth* under Limitations. |
| **`RefractionScale`** | Number | `0.02` | Wave-normal distortion applied to the caustic pattern. This is **not** screen-space refraction of the scene behind the water — see Limitations. |

### Group 3: Foam & Caustics
| Property | Type | Default | Description |
| :--- | :--- | :---: | :--- |
| **`ShoreFoamIntensity`**| Number | `0.85` | Opacity of the surf band along a matching `WaterEdge3D`, falling back to the water volume perimeter when no edge is registered. |
| **`CrestFoamIntensity`**| Number | `0.60` | Whitecap foam spawning on steep wave peaks. |
| **`EnableCaustics`** | Boolean | `true` | Projects animated Voronoi caustic light patterns onto underwater seabeds. |

### Group 4: Underwater Camera Submersion
| Property | Type | Default | Description |
| :--- | :--- | :---: | :--- |
| **`EnableUnderwaterFX`**| Boolean | `false` | Applies scene fog while the camera is inside and below this water surface. |
| **`UnderwaterFogColor`**| Color | `"15; 65; 110"` | Volumetric color tint when swimming underwater. |
| **`UnderwaterFogDensity`**| Number| `0.0005` | Exponential fog density in scene-unit scale. |

### Moving Physics3D/Jolt body interactions (shared by both water types)

`WaterBody3D` and `OceanFFT3D` expose the same four properties. A moving object only needs a
`Physics3D` behavior; it does **not** need `Buoyancy3D`. The water detects overlap with its 3D volume,
reads Jolt linear velocity (falling back to measured position change), and emits expanding displacement
rings plus foam. Successive rings form a wake.

| Property | Type | Default | Description |
| :--- | :--- | :---: | :--- |
| **`EnableBodyInteractions`** | Boolean | `true` | Enables automatic wakes and splash rings from moving Physics3D/Jolt objects inside this water volume. |
| **`InteractionStrength`** | Number | `14` | Maximum vertical ripple displacement in scene units. Entry and vertical movement receive a splash boost. |
| **`InteractionRadius`** | Number | `180` | Maximum radius reached by each expanding ring, in scene units. |
| **`InteractionSpeedThreshold`** | Number | `35` | Minimum movement speed in scene units per second before a ring is emitted. |

---

## 1a. `Buoyancy3D` Behavior Properties

Buoyancy works with both `WaterBody3D` and `OceanFFT3D`. A hull receives lift only while its bounds
overlap the water volume in XY and extend above the volume's bottom. Leaving the volume applies no
force, clears `IsFloating`, and lets `Physics3D` gravity take over normally. `TargetWaterBody`, when
set, is strict: a missing or non-overlapping named object does not fall back to unrelated water.

| Property | Type | Default | Description |
| :--- | :--- | :---: | :--- |
| **`Physics3D`** | Behavior | `Physics3D` | Physics behavior to drive. Renamed Physics3D behaviors are also auto-detected. |
| **`BuoyancyFactor`** | Number | `1.0` | Lift relative to the object's weight at full submersion. |
| **`HullProbeCount`** | Choice | `4-Corners` | `1-Center`, `4-Corners`, or `8-HullBox`. Use 8 for long ships. |
| **`FluidDrag`** | Number | `2.0` | Linear and rotational water drag. |
| **`WaveInfluence`** | Number | `0.8` | How strongly the hull follows the local wave normal and orbital velocity. |
| **`Ship Stability`** | Number | `0.65` | Restoring roll/pitch torque. `0` disables it; values near `1` suit stable ships. |
| **`Stability Damping`** | Number | `1.5` | Damps roll/pitch angular velocity while probes touch water. Yaw is unaffected. |
| **`MaxSubmersionDepth`** | Number | `2.0` | Probe depth in scene units at which lift reaches its maximum. |
| **`TargetWaterBody`** | String | empty | Optional exact water-object name. |
| **`Enabled`** | Boolean | `true` | Enables buoyancy. Disabling immediately clears floating state. |

---

## 2. `PourableLiquid3D` Behavior Properties (Micro SPH Pouring)

### Group 1: Liquid Profile & Emitter
| Property | Type | Default | Description |
| :--- | :--- | :---: | :--- |
| **`FluidPreset`** | Choice | `"MagicPotion"` | Profile: `"Water"`, `"MagicPotion"`, `"HoneySyrup"`, `"GreenSlime"`, `"AcidPoison"`, `"LavaMagma"`. |
| **`MaxDroplets`** | Number | `1500` | Maximum live droplets **from this emitter**. The scene-wide solver holds 3,000 across all emitters. |
| **`FlowRate`** | Number | `60.0` | Droplets spawned per second when pouring. |
| **`PourTiltThreshold`**| Number | `45.0` | Bottle tilt angle in degrees that triggers automatic pouring. |
| **`DropletRadius`** | Number | `0.02` | Droplet radius in metres. Also sets the rendered sphere size and the volume one droplet contributes to a container: $V = \tfrac{4}{3}\pi r^3 \times 1000$ litres. |

### Group 2: SPH Physics Parameters
| Property | Type | Default | Description |
| :--- | :--- | :---: | :--- |
| **`Viscosity`** | Number | `1.0` | Fluid thickness ($0.1 = \text{Water}$, $10.0 = \text{Honey}$, $50.0 = \text{Slime}$). |
| **`SurfaceTension`** | Number | `0.8` | Clumping cohesion force holding liquid stream together. |
| **`RestDensity`** | Number | `1000.0`| SPH target fluid density ($\text{kg/m}^3$). |

### Group 3: Droplet Appearance
| Property | Type | Default | Description |
| :--- | :--- | :---: | :--- |
| **`LiquidColor`** | Color | `"220; 30; 120"`| Per-droplet tint, written to the instanced droplet mesh. Two emitters with different presets render in their own colours. |
| **`LiquidOpacity`** | Number | `0.85` | Droplet transparency. All droplets share one instanced material, so the scene uses the **highest** opacity among registered emitters. |
| **`LiquidRoughness`** | Number | `0.05` | Stored on the behavior and readable from events. The droplet renderer is unlit, so this currently has no visual effect — see Limitations. |

---

## 2a. `WaterEdge3D` Behavior Properties (Coastline Volumes)

`WaterEdge3D` affects both `WaterBody3D` and `OceanFFT3D`. Its axis-aligned XY bounds represent land:
water beneath the bounds is masked, waves flatten across the shallow band, and foam is generated on
the water-facing side. The edge must be on the same layer and its Z span must cross the water's top
surface. Up to eight nearest edges are uploaded per water body.

| Property | Type | Default | Description |
| :--- | :--- | :---: | :--- |
| **`FoamWidth`** | Number | `0` (auto) | Width of the animated surf band outside the land boundary, in scene units. `0` fits it to the water body — about 8% of its short side — so foam stays readable at any scene scale. A fixed width that looks right on a small pond is a hairline on a large bay. |
| **`ShallowWidth`** | Number | `0` (auto) | Distance over which water color shallows and wave displacement fades toward the boundary. `0` uses three times the resolved foam band width. |
| **`Enabled`** | Boolean | `true` | Whether this edge currently affects matching water. |
| **`HideSourceObject`** | Boolean | `false` | Hides a dedicated helper box at runtime. Leave disabled when the source object is visible beach or cliff geometry. |

---

## 3. Actions

### `WaterBody3D` Actions
* **`Set wave height on _PARAM0_ to _PARAM1_ scene units`**: Updates Gerstner-wave amplitude in real time.
* **`Set wave irregularity on _PARAM0_ to _PARAM1_`**: Adjusts deterministic crest-line warping from 0 to 1.
* **`Set wind direction on _PARAM0_ to _PARAM1_ degrees`**: Rotates ocean swell propagation vector.
* **`Set water colors on _PARAM0_ (ShallowColor: _PARAM1_, DeepColor: _PARAM2_)`**: Updates water palette.
* **`Set underwater fog density on _PARAM0_ to _PARAM1_`**: Modifies murky underwater visibility.

### Buoyancy Actions
* **Set buoyancy factor**: Changes lift relative to object weight.
* **Set fluid drag** and **Set wave influence**: Tune motion through and alignment with water.
* **Set ship stability** and **Set ship stability damping**: Tune restoring torque and rocking decay at runtime.
* **Set max submersion depth**: Changes the probe depth at which lift reaches maximum.
* **Enable / Disable buoyancy**: Stops or resumes buoyancy and clears floating state when disabled.

### `PourableLiquid3D` Actions
* **`Start pouring liquid on _PARAM0_ (FlowRate: _PARAM1_)`**: Manually activates liquid emitter stream.
* **`Stop pouring liquid on _PARAM0_`**: Stops liquid emission.
* **`Set liquid preset on _PARAM0_ to _PARAM1_`**: Applies preset (`"Honey"`, `"Acid"`, `"Potion"`).
* **`Set liquid viscosity on _PARAM0_ to _PARAM1_`**: Adjusts fluid thickness live.
* **`Empty container volume on _PARAM0_`**: Resets liquid fill volume inside cup/cauldron to zero.

---

## 4. Conditions

### `WaterBody3D` Conditions
* **`Is camera underwater inside _PARAM0_`**: True if active camera has submerged below water surface.
* **`Is object floating on water _PARAM0_`**: True if rigid body is currently buoyant on waves.

### `PourableLiquid3D` Conditions
* **`Is bottle currently pouring on _PARAM0_`**: True if liquid droplets are actively streaming.
* **`Is container full on _PARAM0_`**: True if container has reached $100\%$ capacity.
* **`Is container fill level greater than _PARAM1_ percent on _PARAM0_`**: Threshold check ($0 - 100\%$).

---

## 5. Expressions

### Wave & Water Queries
* **`Object.WaterBody3D::WaveHeightAt(x, y)`**: Returns live wave height $Z$ at world $(X, Y)$ coordinates.
* **`Object.WaterBody3D::WaterSurfaceZ(x, y)`**: Returns exact top surface altitude including waves.
* **`Object.WaterBody3D::SubmersionDepth()`**: Returns depth below the surface in scene units.

### SPH & Container Queries
* **`Object.PourableLiquid3D::FillLevelPercent()`**: Container fill level percentage ($0.0 - 100.0\%$).
* **`Object.PourableLiquid3D::CurrentLiquidVolume()`**: Fluid volume accumulated in liters/milliliters.
* **`Object.PourableLiquid3D::ActiveDropletCount()`**: Number of live fluid particles in simulation.

---

## 6. Fluid Preset Profiles Table

| Preset | Viscosity ($\mu$) | Surface Tension | Opacity | Roughness | Visual Style |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **`Water`** | `0.2` | `0.5` | `0.30` | `0.02` | Clear, rapid splashing, high refraction. |
| **`MagicPotion`** | `0.8` | `1.2` | `0.85` | `0.05` | Glowing magenta/cyan, sparkling highlights. |
| **`HoneySyrup`** | `15.0` | `2.5` | `0.90` | `0.08` | Thick, gooey, slow stringy pouring. |
| **`GreenSlime`** | `35.0` | `3.0` | `0.95` | `0.15` | Chunky blobby viscous monster slime. |
| **`AcidPoison`** | `0.3` | `0.6` | `0.70` | `0.02` | Bright lime-green, sizzle bubble motes. |
| **`LavaMagma`** | `20.0` | `2.0` | `1.00` | `0.35` | Incandescent molten rock with crust. |

---

| **`PeakWavelength`** | Number | `0` | Crest-to-crest distance in **scene units** — the setting that decides how big the water feels next to the player. At 100 units/metre, `1400` is a 14 m swell a person cannot see over; `300` is choppy 3 m water. `0` fits automatically to the volume (about 2-3 waves across it). |
## 7. Wave Scale and Mesh Resolution

Wave size is **not** derived from the water volume unless you ask for it.

`WaveScaleMode: "Absolute"` (the default) fixes the base wavelength at 300 scene units. Ten non-harmonic octaves descend from 300 to about 4.6 units at `WaveTiling` 1. Scaling the cube does not scale the waves. That is the right behaviour for an ocean — the surface does not slide when the object moves and neighbouring bodies line up — and the wrong behaviour for a swimming pool, where `"RelativeToVolume"` sizes the base wave to the volume's shorter side instead.

### Octaves below the mesh resolution are faded out

The surface is a `GridSubdivisions x GridSubdivisions` plane, so vertex spacing is `width / GridSubdivisions`. A Gerstner wave sampled at fewer than about four vertices per wavelength does not render as a wave — it renders as a crosshatch of sampling noise. Any octave shorter than `4 x vertex spacing` is therefore faded to zero, in the vertex shader **and** in the CPU solver, so buoyancy keeps agreeing with the surface on screen.

The practical consequence is that a large volume on a coarse mesh is calmer and smoother, not noisier. Retained octaves at `WaveTiling` 1:

| Setup | Vertex spacing | Octaves drawn |
| :--- | ---: | ---: |
| Absolute, 1000-unit volume, 48 subdivisions | 20.8 | resolution-filtered; query `WaveDetailPercent()` |
| Absolute, 1000-unit volume, 128 subdivisions | 7.8 | more short-wave detail retained |
| Absolute, 300-unit volume, 48 subdivisions | 6.3 | most authored amplitude retained |
| RelativeToVolume, 1000-unit volume, 48 subdivisions | 20.8 | most authored amplitude retained |
| RelativeToVolume, 400x240 pool, 48 subdivisions | 8.3 | most authored amplitude retained |
| RelativeToVolume, 400x240 pool, 96 subdivisions | 4.2 | additional fine chop retained |

`"RelativeToVolume"` holds detail better on large bodies because the fine octaves scale with the volume rather than staying fixed while the mesh stretches. If you want more chop on a big absolute-scale ocean, raise `GridSubdivisions` before raising `WaveTiling` — tiling shortens every wavelength and so pushes *more* octaves below the cutoff, not fewer.

Both wavelengths are recomputed when the volume is resized at runtime.

### When nothing is renderable

If **every** octave falls below the cutoff the water renders perfectly flat — visually identical to a broken shader. The runtime detects this and logs a one-time console warning naming the volume size, the vertex spacing, the longest octave, and the two concrete fixes with computed values. It re-warns only if the configuration actually changes, not once per frame.

`Object.WaterBody3D::WaveDetailPercent()` returns the same diagnostic to events: the percentage of the authored wave amplitude the mesh can draw. 100 means fully resolved, 0 means flat.

A worked example — a 6987 x 7501 ocean at the default settings:

| `WaveScaleMode` | `GridSubdivisions` | Longest octave | Amplitude drawn |
| :--- | ---: | ---: | ---: |
| `Absolute` | 48 | 300 | **0%** (flat) |
| `Absolute` | 101 | 300 | 40% |
| `Absolute` | 256 | 300 | 65% |
| `RelativeToVolume` | 48 | 6987 | **93%** |

For a body this large, `"RelativeToVolume"` is the answer. Also scale `WaveHeight` to the volume: at 100 units ≈ 1 m this is a 70 m ocean, and the default `WaveHeight` of 18 units is an 18 cm ripple. Real ocean swell wants roughly 150 - 300.

---

## 8. Units & Semantics

* **Scene units.** Every X/Y/Z argument and return value is in **GDevelop scene units** (pixels), matching `Object.X()` / `Object.Z()`. The SPH solver runs internally in metres at 100 units = 1 m, the same world scale Physics3D uses by default.
* **Container volume** is in **litres**. One droplet contributes $\tfrac{4}{3}\pi r^3 \times 1000$ L, so a default 0.02 m droplet is ≈ 0.034 L and a 1.0 L cauldron fills in about 30 droplets.
* **`BuoyancyFactor` is relative to the object's own weight.** With a `Physics3D` behavior attached, `1.0` at full submersion applies exactly enough upward impulse to cancel gravity (neutral buoyancy); above `1.0` the object rises, below `1.0` it sinks. Force is split evenly across the hull probes and applied at each probe's world position, which is what produces pitch and roll.
* **`FluidDrag`** is a quadratic drag coefficient applied against the local wave orbital velocity, also per probe. It only acts on the `Physics3D` path.
* **`Ship Stability`** adds a balanced force pair at the hull probes. It rights roll and pitch without adding net lift or changing yaw; **`Stability Damping`** removes angular oscillation. Both act only while probes touch water.
* **Water contact is finite.** Buoyancy requires horizontal overlap and rejects hulls entirely below the water object's bottom. Outside the volume, no lift or kinematic repositioning is applied, so a Physics3D object falls under normal Jolt gravity.
* **Without `Physics3D`**, `Buoyancy3D` falls back to driving `Z`, `RotationX` and `RotationY` directly. In that mode `BuoyancyFactor` is unused and `WaveInfluence` controls how hard the object is pinned to the surface.
* **Droplet floor.** Poured droplets settle on Z = 0 by default. Use the global action *Set droplet floor altitude* if your table or ground sits elsewhere.

---

## 9. Limitations

These are the gaps between the design document and what the shipped runtime does. They are listed so events are written against real behavior.

* **No screen-space refraction.** GDevelop does not expose the scene colour buffer to a custom material, so the water cannot sample and distort what is behind it. `RefractionScale` distorts the caustic pattern instead, which reads as refraction over a sea bed but not over arbitrary objects.
* **No depth pre-pass, so optical depth is approximated.** With a matching `WaterEdge3D`, the Beer-Lambert column is derived from signed distance to its land bounds; otherwise `WaterBody3D` falls back to its own perimeter. Moving Physics3D hulls can create wakes and splash foam, but they do not cut an exact silhouette out of the water or alter its optical depth.
* **No SSFR (screen-space fluid rendering).** Droplets render as an instanced sphere mesh, coloured per droplet, not as a smoothed metaball surface. The SPH physics — density, pressure, per-droplet viscosity, surface tension, container filling — is real; the surface reconstruction is not implemented.
* **Droplets do not collide with scene geometry.** They collide with each other, the droplet floor plane, and container AABBs. They pass through walls and sloped meshes.
* **Containers are axis-aligned boxes.** A container's fill volume is its object AABB; cylindrical and irregular vessels are approximated by their bounding box.
* **`MaterialSource: "Material3D"` is stored but not acted on.** `WaterBody3D` always renders with its own built-in shader.
* **`WaterType` is stored but does not change any default.** Tune the wave and colour properties directly.
* **One water surface mesh per behavior**, parented to the object's layer. A water body spanning multiple layers is not supported.
* **Water edges are axis-aligned boxes in XY.** Rotation and actual 3D Model contours are not sampled. Use several boxes to approximate a curved or diagonal shoreline.
