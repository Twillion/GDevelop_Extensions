# Portal3D — Valve Portal-Style Visual & Physical Portals for GDevelop 5

**Portal3D** brings authentic, seamless visual and physical portals—inspired by Valve's *Portal* series—directly into **GDevelop 5 (Three.js r160)**.

Unlike static CCTV cameras that render a flat feed onto a monitor, **Portal3D** turns any 3D surface into an optically seamless gateway into another part of the world. Walking or jumping through a portal instantly teleports your character or physics objects, rotating velocity and look angles while strictly preserving momentum: *"Speedy thing goes in, speedy thing comes out."*

By **Twillion**. Version **1.0.0**.

---

## Key Features

1. **Perspective-Matched Virtual Camera**:
   - Looking into Portal A renders the destination from Portal B relative to your player's exact eye perspective:
     $$M_{A \to B} = T_B \cdot R_{\text{flip}} \cdot T_A^{-1}$$
     $$\text{Cam}_{\text{portal}} = M_{A \to B} \cdot \text{Cam}_{\text{player}}$$
   - As you walk around Portal A, jump, or crouch, the scene visible inside shifts with realistic optical parallax.

2. **Screen-Space Projective Texture Mapping**:
   - The portal face does not stretch a static texture; instead, fragments sample the destination buffer using screen-space coordinates (`gl_FragCoord`), creating the illusion of an open window cut directly into the world.

3. **Oblique Near-Plane Frustum Clipping (Lengyel's Algorithm)**:
   - When the virtual camera sits behind Portal B's wall, the camera's near clipping plane is tilted to align flush with Portal B's surface, preventing walls or occluders behind the destination portal from blocking your view.

4. **Seamless Traversal & Momentum Redirection**:
   - Continuous frame-to-frame signed plane-crossing checks detect when an object crosses the threshold.
   - Instantly rotates linear velocity vectors for physics characters (`YAxisPhysicsCharacter3D`, standard 3D physics) to match the destination portal's orientation.
   - Nudges the entity forward along the destination portal normal to eliminate boundary oscillations.

5. **Iconic Visual Styling**:
   - Customizable glowing energetic portal rim (default Blue `#00a2ff` and Orange `#ff7700`).
   - Supports both classic **Oval** aperture rings and **Rectangular** doorway frames.

6. **Engine Safety & Zero State Leaks**:
   - Implements strict WebGL state restoration (`renderer.resetState()`, `pixi.reset()`, shadow-map reuse, and per-instance material cloning) based on patterns verified in `InGameCamera3D`.

---

## Installation

1. In GDevelop: **Project Manager → Extensions → Import an extension → Select `Portal3D.json`**.
2. Rebuild the extension after modifying runtime code:
   ```bash
   node Portal3D/build-extension.mjs
   ```
3. Run the automated test suite:
   ```bash
   node Portal3D/test-portal3d.mjs
   ```

---

## Quick Start: Creating a Linked Portal Pair

### Step 1: Create the Blue Portal
1. Add a **3D Box** to your scene (e.g. Width: `60`, Height: `100`, Depth: `10`). Name it `PortalBlue`.
2. Add the **Portal (3D)** (`Portal3D`) behavior to it:
   - **Portal tag (ID):** `Blue`
   - **Linked portal tag:** `Orange`
   - **Face:** `Front`
   - **Shape:** `Oval`
   - **Border ring color:** `#00a2ff`
   - **Resolution:** `Standard` (512x512) or `MatchScreen`

### Step 2: Create the Orange Portal
1. Add another **3D Box** to your scene. Name it `PortalOrange`.
2. Add the **Portal (3D)** (`Portal3D`) behavior to it:
   - **Portal tag (ID):** `Orange`
   - **Linked portal tag:** `Blue`
   - **Face:** `Front`
   - **Shape:** `Oval`
   - **Border ring color:** `#ff7700`
   - **Resolution:** `Standard` (512x512) or `MatchScreen`

### Step 3: Enable Player / Prop Traversal
1. Select your **Player** or physics prop (e.g. `CompanionCube`).
2. Add the **Portal Traversable (3D)** (`PortalTraversable3D`) behavior:
   - **Traversable enabled:** `true`
   - **Redirect velocity & momentum:** `true`
   - **Redirect camera / object rotation:** `true`
   - **Exit normal offset:** `20`
3. Launch preview: walk through `PortalBlue` and you will instantly emerge from `PortalOrange` facing into the destination room!

---

## Behavior Reference

### 1. `Portal3D` (Portal Object Behavior)

| Property | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `Tag` | String | `Blue` | Unique ID identifying this portal. |
| `LinkedTag` | String | `Orange` | Tag of the destination portal this portal connects to. |
| `Face` | Choice | `Front` | Face of the 3D Box used as the portal opening (`Front`, `Back`, `Left`, `Right`, `Top`, `Bottom`). |
| `Shape` | Choice | `Oval` | Visual frame style: `Oval` aperture ring or `Rectangle` frame. |
| `BorderColor` | Color | `#00a2ff` | Color of the glowing energetic rim. |
| `BorderWidth` | Number | `0.08` | Relative border thickness (0.01 to 0.3). |
| `Resolution` | Choice | `Standard` | Target resolution: `Tiny` (160x120), `Low` (320x240), `Standard` (512x512), `SD` (640x480), `HD` (1280x720), `MatchScreen`, `Custom`. |
| `ObliqueClipping` | Boolean | `true` | When true, clips geometry behind the destination portal's wall. |
| `ForwardAxis` | Choice | `+Z` | Local outward normal (`+Z`, `-Z`, `+X`, `-X`, `+Y`, `-Y`). |
| `IsOpen` | Boolean | `true` | Whether the portal is currently open and rendering. |

#### Actions & Conditions
- **Action**: `SetOpen(boolean)` — Opens or closes the portal.
- **Action**: `LinkToPortal(TargetPortal)` — Dynamically links to another portal instance at runtime.
- **Action**: `SetBorderColor(color)` — Updates the border rim glow color.
- **Action**: `SetResolution(preset)` — Changes the render target resolution.
- **Condition**: `IsOpen()` — True if the portal is currently open.
- **Condition**: `IsLinked()` — True if linked to a valid destination portal.
- **Expression**: `LinkedPortalTag()` — Returns the tag of the destination portal.

---

### 2. `PortalTraversable3D` (Entity Traversal Behavior)

| Property | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `Enabled` | Boolean | `true` | Whether this entity can traverse active portals. |
| `TeleportCooldown` | Number | `0.15` | Minimum seconds between consecutive teleports (anti-oscillation). |
| `RedirectVelocity` | Boolean | `true` | Rotates physics linear velocity vectors to match exit orientation while preserving speed magnitude ($|V'| = |V|$). |
| `RedirectCamera` | Boolean | `true` | Rotates object angles and camera look rotation. |
| `ExitOffset` | Number | `20.0` | Units to push the entity forward along the destination portal normal upon emergence. |

#### Actions & Conditions
- **Condition**: `JustTeleported()` — True for exactly 1 frame after passing through a portal (ideal for playing portal sound effects or triggering particles).
- **Expression**: `LastPortalTag()` — Returns the tag of the entry portal traversed (e.g. `"Blue"` or `"Orange"`).

---

### 3. Free Functions

- **Action**: `Portal3D::TeleportObjectThrough(Object, EntryPortal, ExitPortal, RedirectVelocity)` — Manually triggers teleportation of any object between two portals from event logic.
