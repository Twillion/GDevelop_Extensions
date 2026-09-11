# StableShadowAnchor3D — API Reference & Specification

Complete specification of Behavior Properties, Actions, Conditions, and Expressions (ACEs) for **StableShadowAnchor3D**.

---

## 1. `StableShadowAnchor3D` Behavior Properties

### Group 1: Anchoring Mode & Target
| Property | Type | Default | Description |
| :--- | :--- | :---: | :--- |
| **`AnchorMode`** | Choice | `"WorldFixed"` | Shadow anchor mode: `"WorldFixed"`, `"FocusObject"`, or `"CameraFollowing"`. |
| **`FocusObjectName`** | String | `""` | Name of the object whose world position anchors the shadow frustum. |
| **`FreezeInEditor`** | Boolean | `false` | When enabled, freezes the shadow projection matrix in place. |
| **`EditorOnlyLock`** | Boolean | `true` | When true, shadow locking is active only in the editor; reverts to camera-following during play. |

### Group 2: World-Fixed Dimensions
| Property | Type | Default | Description |
| :--- | :--- | :---: | :--- |
| **`WorldCenterX`** | Number | `0.0` | World X center of the fixed shadow box in meters. |
| **`WorldCenterY`** | Number | `0.0` | World Y center of the fixed shadow box in meters. |
| **`WorldCenterZ`** | Number | `0.0` | World Z center of the fixed shadow box in meters. |
| **`BoxWidth`** | Number | `100.0` | Width of the shadow orthographic projection volume in meters. |
| **`BoxHeight`** | Number | `100.0` | Height of the shadow orthographic projection volume in meters. |
| **`BoxDepth`** | Number | `150.0` | Depth range of the shadow projection volume in meters. |

### Group 3: Stabilization & Quality
| Property | Type | Default | Description |
| :--- | :--- | :---: | :--- |
| **`EnableTexelSnapping`**| Boolean | `true` | Quantizes shadow position to light-space texel grid (eliminates edge shimmering). |

---

## 2. Actions

* **`Set anchor mode on _PARAM0_ to _PARAM1_`**: Updates active mode (`"WorldFixed"`, `"FocusObject"`, `"CameraFollowing"`).
* **`Set world anchor center position on _PARAM0_ to (X:_PARAM1_, Y:_PARAM2_, Z:_PARAM3_)`**: Updates fixed world coordinate.
* **`Set anchor box dimensions on _PARAM0_ (Width:_PARAM1_, Height:_PARAM2_, Depth:_PARAM3_)`**: Sets shadow volume size in meters.
* **`Set focus object target on _PARAM0_ to _PARAM1_`**: Sets object anchor by name or instance.
* **`Freeze shadow projection on _PARAM0_ (Freeze:_PARAM1_)`**: Freezes or unfreezes shadow matrix calculations.
* **`Toggle shadow freeze state on _PARAM0_`**: Toggles frozen shadow state (ideal for hotkeys like `F7`).
* **`Enable sub-texel snapping on _PARAM0_ (Enable:_PARAM1_)`**: Toggles light-space texel grid quantization.

---

## 3. Conditions

* **`Is shadow projection frozen on _PARAM0_`**: True if shadow camera calculations are currently frozen.
* **`Is sub-texel snapping enabled on _PARAM0_`**: True if texel quantization is active.
* **`Current anchor mode on _PARAM0_ is _PARAM1_`**: Checks if active mode matches string (`"WorldFixed"`, `"FocusObject"`, etc.).

---

## 4. Expressions

* **`Object.StableShadowAnchor3D::AnchorCenterX()`**: World X center of active shadow anchor.
* **`Object.StableShadowAnchor3D::AnchorCenterY()`**: World Y center of active shadow anchor.
* **`Object.StableShadowAnchor3D::AnchorCenterZ()`**: World Z center of active shadow anchor.
* **`Object.StableShadowAnchor3D::BoxWidth()`**: Width of shadow frustum in meters.
* **`Object.StableShadowAnchor3D::BoxHeight()`**: Height of shadow frustum in meters.
* **`Object.StableShadowAnchor3D::TexelSize()`**: World size of one shadow map texel in meters.
