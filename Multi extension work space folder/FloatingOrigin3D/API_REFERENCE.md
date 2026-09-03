# FloatingOrigin3D — API Reference & Specification

Complete specification of Behavior properties, Actions, Conditions, and Expressions (ACEs) for **FloatingOrigin3D**.

---

## 1. `FloatingOrigin3D` Behavior Properties

| Property | Type | Default | Description |
| :--- | :--- | :---: | :--- |
| **`ShiftThreshold`** | Number | `1000.0` | Distance in meters from local origin before triggering a silent re-centering shift. |
| **`StepSize`** | Number | `1000.0` | Quantized snap distance in meters for origin shifts. |
| **`EnablePhysicsShift`**| Boolean | `true` | Automatically shifts Jolt 3D Physics simulation bodies synchronously. |

---

## 2. Actions

* **`Manually trigger origin shift on _PARAM0_`**: Forces an immediate scene and physics re-centering.
* **`Set origin shift threshold distance on _PARAM0_ to _PARAM1_ meters`**: Configures re-center interval.

---

## 3. Conditions

* **`Has origin recently shifted on _PARAM0_`**: True during the single frame when a Floating Origin shift occurred.

---

## 4. Expressions

* **`Object.FloatingOrigin3D::OriginWorldX()`**: True 64-bit world origin X coordinate in meters.
* **`Object.FloatingOrigin3D::OriginWorldY()`**: True 64-bit world origin Y coordinate in meters.
* **`Object.FloatingOrigin3D::OriginWorldZ()`**: True 64-bit world origin Z coordinate in meters.
* **`Object.FloatingOrigin3D::TruePlayerWorldX()`**: Full double-precision Player X ($\text{OriginX} + \text{LocalX}$).
* **`Object.FloatingOrigin3D::TruePlayerWorldY()`**: Full double-precision Player Y ($\text{OriginY} + \text{LocalY}$).
* **`Object.FloatingOrigin3D::TruePlayerWorldZ()`**: Full double-precision Player Z ($\text{OriginZ} + \text{LocalZ}$).
