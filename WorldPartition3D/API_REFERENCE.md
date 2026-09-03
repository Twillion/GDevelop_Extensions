# WorldPartition3D — API Reference & Specification

Complete specification of Behavior properties, Actions, Conditions, Expressions (ACEs), and Configuration profiles for **WorldPartition3D**, **ClipmapTerrain3D**, and **FloatingOrigin3D**.

---

## 1. `WorldPartition3D` Behavior Properties

### Group 1: Grid & Streaming Configuration
| Property | Type | Default | Description |
| :--- | :--- | :---: | :--- |
| **`SectorSize`** | Number | `128.0` | Width/Height of each Cartesian world grid sector in meters. |
| **`NearStreamingRadius`**| Number | `256.0` | Distance in meters where full dynamic objects, physics, and AI are active. |
| **`FarStreamingRadius`** | Number | `1500.0`| Outer horizon distance in meters where distant sectors are tracked. |
| **`MaxVRAMBudgetMB`** | Number | `150.0` | Memory threshold for LRU cache eviction of inactive sectors. |

### Group 2: Hierarchical Level of Detail (HLOD)
| Property | Type | Default | Description |
| :--- | :--- | :---: | :--- |
| **`EnableHLOD`** | Boolean | `true` | Merges distant static props into single low-poly proxy meshes per sector. |
| **`HLODDistanceThreshold`**| Number | `450.0` | Distance in meters where individual meshes swap to the merged HLOD proxy. |

### Group 3: Concentric Geometry Clipmap Terrain
| Property | Type | Default | Description |
| :--- | :--- | :---: | :--- |
| **`EnableClipmapTerrain`**| Boolean | `true` | Enables 4–6 nested concentric geometry rings with GPU height displacement. |
| **`ClipmapRingLevels`** | Choice | `5` | Number of concentric ring levels (`4`, `5`, or `6`). |
| **`BaseGridResolution`** | Choice | `64` | Resolution per ring: `64` ($64\times 64$ quads) or `128` ($128\times 128$ quads). |
| **`HeightmapTexture`** | Resource Image | `""` | 16-bit elevation heightmap texture for world terrain. |
| **`HeightmapScaleZ`** | Number | `350.0` | Maximum vertical mountain height in meters ($0 - 2000$). |

### Group 4: Delta-State Persistence (World Memory)
| Property | Type | Default | Description |
| :--- | :--- | :---: | :--- |
| **`EnableDeltaPersistence`**| Boolean | `true` | Remembers dynamic state changes (looted chests, dead enemies, broken doors). |
| **`AutoSaveToStorage`** | Boolean | `true` | Automatically serializes delta state to `IndexedDB` / `localStorage`. |
| **`StorageSaveSlot`** | String | `"SaveSlot_01"` | File save slot name. |

---

## 2. `FloatingOrigin3D` Behavior Properties (64-Bit Coordinates)

| Property | Type | Default | Description |
| :--- | :--- | :---: | :--- |
| **`ShiftThreshold`** | Number | `1000.0` | Distance in meters from local origin before triggering a silent re-centering shift. |
| **`StepSize`** | Number | `1000.0` | Quantized snap distance in meters for origin shifts. |
| **`EnablePhysicsShift`**| Boolean | `true` | Automatically shifts Jolt 3D Physics simulation bodies synchronously. |

---

## 3. Actions

### Grid & Sector Streaming
* **`Set streaming radii on _PARAM0_ (NearRadius: _PARAM1_, FarRadius: _PARAM2_)`**: Updates active loading circles in meters.
* **`Preload sector at coordinates on _PARAM0_ (SectorX: _PARAM1_, SectorY: _PARAM2_)`**: Asynchronously loads a target chunk before cutscenes or teleports.
* **`Evict sector at coordinates on _PARAM0_ (SectorX: _PARAM1_, SectorY: _PARAM2_)`**: Manually purges a sector from VRAM.

### Delta-State & World Persistence
* **`Save object state string on _PARAM0_ (ObjectID: _PARAM1_, Key: _PARAM2_, Value: _PARAM3_)`**: Records text state (e.g. `chest_04`, `"state"`, `"opened"`).
* **`Save object state number on _PARAM0_ (ObjectID: _PARAM1_, Key: _PARAM2_, Value: _PARAM3_)`**: Records numeric state (e.g. `boss_gate`, `"hp"`, `0.0`).
* **`Save object state boolean on _PARAM0_ (ObjectID: _PARAM1_, Key: _PARAM2_, Value: _PARAM3_)`**: Records flag (e.g. `goblin_chief`, `"isDead"`, `true`).
* **`Save world delta state to disk on _PARAM0_ (SaveSlot: _PARAM1_)`**: Saves entire world state to storage.
* **`Load world delta state from disk on _PARAM0_ (SaveSlot: _PARAM1_)`**: Restores world progress on game load.
* **`Clear world delta state history on _PARAM0_`**: Resets all world progress for New Game.

### Floating Origin
* **`Manually trigger origin shift on _PARAM0_`**: Forces an immediate scene and physics re-centering.
* **`Set origin shift threshold distance on _PARAM0_ to _PARAM1_ meters`**: Configures re-center interval.

---

## 4. Conditions

### Streaming & State Conditions
* **`Is sector loaded at coordinates (_PARAM1_, _PARAM2_) on _PARAM0_`**: True if sector is active in VRAM.
* **`Is object state key saved on _PARAM0_ (ObjectID: _PARAM1_, Key: _PARAM2_)`**: True if object has a delta override.
* **`Is object state boolean true on _PARAM0_ (ObjectID: _PARAM1_, Key: _PARAM2_)`**: Checks boolean flag (e.g. `isOpened`).
* **`Has origin recently shifted on _PARAM0_`**: True during the single frame when a Floating Origin shift occurred.

---

## 5. Expressions

### Grid & Sector Queries
* **`Object.WorldPartition3D::CurrentSectorX()`**: Player's active sector grid X index.
* **`Object.WorldPartition3D::CurrentSectorY()`**: Player's active sector grid Y index.
* **`Object.WorldPartition3D::ActiveSectorCount()`**: Number of loaded near/mid sectors in memory.
* **`Object.WorldPartition3D::ActiveHLODProxyCount()`**: Number of active distant HLOD proxy meshes.

### Delta-State Queries
* **`Object.WorldPartition3D::GetObjectStateString(objectID, key)`**: Retrieves saved string property.
* **`Object.WorldPartition3D::GetObjectStateNumber(objectID, key)`**: Retrieves saved numeric property.

### 64-Bit Coordinates & Floating Origin
* **`Object.FloatingOrigin3D::OriginWorldX()`**: True 64-bit world origin X coordinate in meters.
* **`Object.FloatingOrigin3D::OriginWorldY()`**: True 64-bit world origin Y coordinate in meters.
* **`Object.FloatingOrigin3D::OriginWorldZ()`**: True 64-bit world origin Z coordinate in meters.
* **`Object.FloatingOrigin3D::TruePlayerWorldX()`**: Full double-precision Player X ($\text{OriginX} + \text{LocalX}$).
* **`Object.FloatingOrigin3D::TruePlayerWorldY()`**: Full double-precision Player Y ($\text{OriginY} + \text{LocalY}$).
