# WebGPUCore v1.2.0 — Extension API Reference

**Author**: Scroll Weaver Interactive  
**Platform**: GDevelop ≥ 5.3.0  
**Latest**: v1.2.0

---

## Quick Start

Every extension using WebGPUCore follows this pattern:

```javascript
// 1. Wait for WebGPUCore to initialize
if (!gdjs.__webgpu) {
  console.error('WebGPUCore not loaded');
  throw new Error('WebGPUCore platform required');
}

// 2. Register your extension
const myExtension = {
  name: 'MyComputePass',
  pipeline: null,
  buffers: new Map()
};

gdjs.__webgpu.Registry.register('MyComputePass', myExtension);

// 3. Listen for lifecycle events
gdjs.__webgpu.Events.on('CoreInitialized', (device) => {
  myExtension.onInit(device);
});

// 4. Register a scheduler pass
gdjs.__webgpu.Scheduler.registerPass(
  'MyComputePass', 
  gdjs.__webgpu.Scheduler.phases.COMPUTE, 
  () => myExtension.dispatch(),
  16 // Run every 16ms (~60Hz)
);
```

---

## Core API

### `gdjs.__webgpu.Runtime`

GPU device and adapter lifecycle.

#### Properties

| Name | Type | Description |
|------|------|-------------|
| `device` | `GPUDevice \| null` | Active WebGPU device; `null` before init |
| `adapter` | `GPUAdapter \| null` | Selected adapter; `null` before init |
| `initialized` | `boolean` | True when device is ready |
| `isLost` | `boolean` | True if device has been lost (auto-recovery pending) |
| `initPromise` | `Promise<boolean> \| null` | Pending init task; use to await readiness |

#### Methods

##### `Runtime.init(): Promise<boolean>`

Initializes WebGPU. Called automatically by `InitializeCore` action; safe to call again.

**Returns**: Promise resolving to `true` on success, `false` if WebGPU unavailable.

**Behavior**:
- Sets power preference to `"high-performance"`
- Auto-subscribes to `device.lost` and retries after 1500ms
- Emits `CoreInitialized` on success, `DeviceLost` on loss

**Example**:
```javascript
await gdjs.__webgpu.Runtime.init();
if (gdjs.__webgpu.Runtime.initialized) {
  console.log('Ready to use WebGPU');
}
```

---

### `gdjs.__webgpu.Resources`

GPU resource lifecycle (buffers, textures, pipelines).

#### Properties

| Name | Type | Description |
|------|------|-------------|
| `buffers` | `Map<string, GPUBuffer>` | All active GPU buffers by ID |
| `textures` | `Map<string, GPUTexture>` | All active GPU textures by ID |
| `pipelines` | `Map<string, GPUComputePipeline>` | All compute pipelines by ID |

#### Methods

##### `Resources.createBuffer(id: string, descriptor: GPUBufferDescriptor): GPUBuffer | null`

Create a GPU buffer and track it.

**Parameters**:
- `id`: Unique string key (e.g., `"VertexBuffer_0"`)
- `descriptor`: Standard WebGPU buffer descriptor

**Returns**: `GPUBuffer` or `null` if not initialized.

**Side effects**: Increments `Diagnostics.bufferCount`.

**Example**:
```javascript
const vertexBuffer = gdjs.__webgpu.Resources.createBuffer('verts_0', {
  size: 1024,
  usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  mappedAtCreation: false
});
gdjs.__webgpu.Runtime.device.queue.writeBuffer(vertexBuffer, 0, vertexData);
```

##### `Resources.destroyBuffer(id: string): void`

Destroy a buffer and remove from tracking.

**Side effects**: Decrements `Diagnostics.bufferCount`.

---

##### `Resources.createTexture(id: string, descriptor: GPUTextureDescriptor): GPUTexture | null`

Create a GPU texture and track it.

**Parameters**:
- `id`: Unique string key (e.g., `"NormalMap_0"`)
- `descriptor`: Standard WebGPU texture descriptor

**Returns**: `GPUTexture` or `null` if not initialized.

**Side effects**: Increments `Diagnostics.textureCount`.

**Example**:
```javascript
const renderTarget = gdjs.__webgpu.Resources.createTexture('rt_0', {
  size: [1024, 1024],
  format: 'rgba8unorm',
  usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
});
```

##### `Resources.destroyTexture(id: string): void`

Destroy a texture and remove from tracking.

**Side effects**: Decrements `Diagnostics.textureCount`.

---

### `gdjs.__webgpu.BufferPool`

Reusable GPU buffer pool for memory-pressure scenarios.

#### Properties

| Name | Type | Description |
|------|------|-------------|
| `pool` | `GPUBuffer[]` | Available buffers awaiting reuse |
| `maxPoolSize` | `number` | Cap before destroying excess buffers (default: 50) |

#### Methods

##### `BufferPool.acquire(size: number, usage: number): GPUBuffer | null`

Acquire a buffer from pool or create new. Finds first buffer ≥ requested size with matching usage flags.

**Parameters**:
- `size`: Minimum byte size
- `usage`: GPUBufferUsage flags (e.g., `GPUBufferUsage.STORAGE`)

**Returns**: Reused or new `GPUBuffer`, or `null` if uninitialized.

**Example**:
```javascript
const stagingBuffer = gdjs.__webgpu.BufferPool.acquire(256, GPUBufferUsage.COPY_SRC);
// Use stagingBuffer...
gdjs.__webgpu.BufferPool.release(stagingBuffer); // Return to pool
```

##### `BufferPool.release(buf: GPUBuffer): void`

Return a buffer to the pool. If pool is at capacity, destroys the buffer instead.

**Note**: Do not use `buf` after release; it may be destroyed or reused by another subsystem.

---

### `gdjs.__webgpu.Compute`

Compute pipeline and dispatch management.

#### Methods

##### `Compute.getOrCreatePipeline(id: string, wgsl: string): GPUComputePipeline | null`

Get cached compute pipeline or create from WGSL source.

**Parameters**:
- `id`: Unique pipeline ID (e.g., `"ParticleUpdate"`)
- `wgsl`: Complete WGSL shader source; must define `fn main()` entry point

**Returns**: Cached or newly created `GPUComputePipeline`, or `null` if uninitialized.

**Side effects**: Caches pipeline in `Resources.pipelines[id]`. Shader module is created but not stored (created fresh each call).

**Example**:
```javascript
const wgsl = `
@group(0) @binding(0) var<storage, read_write> data: array<f32>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  if (idx < arrayLength(&data)) {
    data[idx] = data[idx] * 2.0;
  }
}
`;

const pipeline = gdjs.__webgpu.Compute.getOrCreatePipeline('double', wgsl);
```

##### `Compute.dispatch(pipeline: GPUComputePipeline, bindGroup: GPUBindGroup | null, x: number, y?: number, z?: number): void`

Dispatch compute work. Automatically measures execution time.

**Parameters**:
- `pipeline`: Compute pipeline (from `getOrCreatePipeline`)
- `bindGroup`: Bind group with resource bindings, or `null` for no bindings
- `x, y, z`: Workgroup dispatch counts (default: `y=1, z=1`)

**Side effects**: Adds elapsed time to `Diagnostics.computeTimeMs`.

**Example**:
```javascript
gdjs.__webgpu.Compute.dispatch(pipeline, myBindGroup, 256, 1, 1);
```

---

### `gdjs.__webgpu.Scheduler`

Phase-ordered, throttled execution of compute and render passes.

#### Properties

| Name | Type | Description |
|------|------|-------------|
| `phases` | `{PRE_COMPUTE: 0, COMPUTE: 1, PHYSICS: 2, RENDER: 3, POST: 4}` | Phase enum |
| `passes` | `SchedulerPass[]` | Registered passes, sorted by phase |
| `lastRun` | `{[name]: number}` | Last execution timestamp (ms) per pass |

#### Methods

##### `Scheduler.registerPass(name: string, phase: number, callback: () => void, throttleMs?: number): void`

Register a scheduler pass. Calls are sorted by phase and executed in order.

**Parameters**:
- `name`: Unique pass name (e.g., `"UpdateParticles"`)
- `phase`: One of `Scheduler.phases.*`
- `callback`: Function to invoke each frame (or throttled interval)
- `throttleMs`: Minimum milliseconds between invocations (default: 0 = every frame)

**Side effects**: Inserts into `Scheduler.passes` and re-sorts by phase.

**Example**:
```javascript
gdjs.__webgpu.Scheduler.registerPass(
  'PhysicsStep',
  gdjs.__webgpu.Scheduler.phases.PHYSICS,
  () => {
    console.log('Physics tick');
  },
  16 // Run every 16ms (~60Hz)
);
```

##### `Scheduler.execute(): void`

Run all scheduler passes in phase order, respecting throttle times. **Call once per frame** from a GDevelop event.

---

### `gdjs.__webgpu.Events`

Event emitter for lifecycle and system notifications.

#### Methods

##### `Events.on(event: string, callback: (data?: any) => void): void`

Subscribe to an event. Multiple handlers per event are supported.

**Built-in events**:

| Event | Data | When |
|-------|------|------|
| `CoreInitialized` | `GPUDevice` | Device ready after init |
| `DeviceLost` | `GPUDeviceLostInfo` | Device lost (auto-recovery starting) |
| `SceneLoaded` | (none) | GDevelop scene loaded (manual trigger) |
| `SceneUnloaded` | (none) | GDevelop scene unloaded (manual trigger) |

**Example**:
```javascript
gdjs.__webgpu.Events.on('CoreInitialized', (device) => {
  console.log('Device ready:', device.limits);
});

gdjs.__webgpu.Events.on('DeviceLost', (info) => {
  console.log('Device lost, retrying:', info.message);
});
```

##### `Events.emit(event: string, data?: any): void`

Emit an event to all subscribers. For custom extension events:

```javascript
gdjs.__webgpu.Events.emit('MyExtension:DataReady', { buffer: myBuffer });
```

---

### `gdjs.__webgpu.Registry`

Extension plugin registry.

#### Methods

##### `Registry.register(name: string, obj: any): void`

Register an extension object by name. Allows other extensions to look up your plugin.

**Example**:
```javascript
const myPlugin = {
  name: 'Particles',
  init() { /* ... */ },
  update() { /* ... */ }
};

gdjs.__webgpu.Registry.register('Particles', myPlugin);
```

##### `Registry.getExtension(name: string): any | undefined`

Retrieve a registered extension by name.

**Example**:
```javascript
const particles = gdjs.__webgpu.Registry.getExtension('Particles');
if (particles) particles.update();
```

---

### `gdjs.__webgpu.Renderer`

Access GDevelop's Three.js rendering context.

#### Methods

##### `Renderer.getThreeRenderer(scene: RuntimeScene): THREE.WebGLRenderer | null`

Get the Three.js renderer from GDevelop's default layer.

**Parameters**: `scene` — GDevelop RuntimeScene

**Returns**: Three.js renderer or `null` if unavailable.

**Coupling note**: Uses hardcoded default layer (`''`). If your game uses named layers, retrieve the renderer from that layer directly.

##### `Renderer.getThreeScene(scene: RuntimeScene): THREE.Scene | null`

Get the Three.js scene graph.

##### `Renderer.getThreeCamera(scene: RuntimeScene): THREE.Camera | null`

Get the Three.js camera.

---

### `gdjs.__webgpu.Diagnostics`

Real-time telemetry for debugging and profiling.

#### Properties

| Name | Type | Description |
|------|------|-------------|
| `memory` | `number` | Reserved for future memory tracking |
| `drawCalls` | `number` | Reserved for future draw-call counting |
| `bufferCount` | `number` | Active GPU buffers |
| `textureCount` | `number` | Active GPU textures |
| `computeTimeMs` | `number` | Cumulative compute dispatch time (ms) |

**Example**:
```javascript
console.log(`Buffers: ${gdjs.__webgpu.Diagnostics.bufferCount}, ` +
            `Compute time: ${gdjs.__webgpu.Diagnostics.computeTimeMs}ms`);
```

---

### `gdjs.__webgpu.Capabilities`

Device feature and limit discovery.

#### Properties

| Name | Type | Description |
|------|------|-------------|
| `supported` | `boolean` | `true` if `navigator.gpu` exists |
| `limits` | `GPUSupportedLimits` | Device limits (e.g., max buffer size, texture dims) |
| `features` | `GPUSupportedFeatures` | Enabled device features |

**Example**:
```javascript
const maxBufferSize = gdjs.__webgpu.Capabilities.limits.maxBufferSize;
const hasShaderF16 = gdjs.__webgpu.Capabilities.features.has('shader-f16');
```

---

## Common Patterns

### Pattern 1: Async Initialization with Dependency

Wait for WebGPUCore, then set up resources:

```javascript
// In your extension's GDevelop event function
if (!gdjs.__webgpu) {
  console.error('WebGPUCore required');
  return;
}

gdjs.__webgpu.Events.on('CoreInitialized', (device) => {
  const myExtension = {
    compute: null,
    buffer: null,
    init() {
      const wgsl = `/* shader code */`;
      this.compute = gdjs.__webgpu.Compute.getOrCreatePipeline('MyPass', wgsl);
      this.buffer = gdjs.__webgpu.Resources.createBuffer('MyBuffer', {
        size: 1024,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
      });
    },
    run() {
      if (this.compute && this.buffer) {
        // Build bind group, dispatch, etc.
      }
    }
  };
  
  myExtension.init();
  gdjs.__webgpu.Registry.register('MyExtension', myExtension);
  gdjs.__webgpu.Scheduler.registerPass('MyPass', 
    gdjs.__webgpu.Scheduler.phases.COMPUTE, 
    () => myExtension.run()
  );
});
```

### Pattern 2: Compute-to-Three.js Output

Run compute, write result to WebGPU texture, composite into Three.js:

```javascript
const shader = `
@group(0) @binding(0) var outputTex: texture_storage_2d<rgba8unorm, write>;

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let coords = gid.xy;
  textureStore(outputTex, coords, vec4<f32>(1.0, 0.0, 0.0, 1.0)); // Red
}
`;

const pipeline = gdjs.__webgpu.Compute.getOrCreatePipeline('ToTexture', shader);
const targetTexture = gdjs.__webgpu.Resources.createTexture('ComputeOutput', {
  size: [512, 512],
  format: 'rgba8unorm',
  usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
});

// After dispatch, convert WebGPU texture to Three.js texture
// (Requires interop code; see Three.js-to-WebGPU bridge patterns)
```

### Pattern 3: Scene Lifecycle Cleanup

Clean up resources when scene unloads:

```javascript
gdjs.__webgpu.Events.on('SceneUnloaded', () => {
  const ext = gdjs.__webgpu.Registry.getExtension('MyExtension');
  if (ext && ext.buffers) {
    ext.buffers.forEach((id) => {
      gdjs.__webgpu.Resources.destroyBuffer(id);
    });
  }
});
```

### Pattern 4: Device Loss Recovery

Auto-recovery is built-in, but extensions can listen and re-upload data:

```javascript
gdjs.__webgpu.Events.on('DeviceLost', (info) => {
  console.log('Recovering from device loss...');
  const ext = gdjs.__webgpu.Registry.getExtension('MyExtension');
  if (ext && ext.reuploadData) {
    ext.reuploadData(); // Re-upload buffers, recreate pipelines, etc.
  }
});
```

---

## Best Practices

1. **Always null-check `gdjs.__webgpu`** before use; it may not be loaded if the WebGPUCore action hasn't been called yet.

2. **Use descriptive IDs** for resources:
   ```javascript
   createBuffer('VoxelGrid_LOD0', ...) // Clear, namespaced
   createBuffer('buf_0', ...)          // Opaque, prone to collisions
   ```

3. **Register scheduler passes early**, ideally in a `CoreInitialized` event handler, not per-frame.

4. **Throttle expensive passes**:
   ```javascript
   registerPass('Physics', PHYSICS, update, 16); // ~60Hz, not every frame
   ```

5. **Clean up in `SceneUnloaded`** to prevent memory leaks and resource handle exhaustion.

6. **Check `Capabilities.limits`** before allocating huge buffers:
   ```javascript
   if (maxSize > Capabilities.limits.maxBufferSize) {
     // Use multi-buffer strategy or error
   }
   ```

7. **Avoid recreating pipelines** per-frame; cache in `Registry` or extension state.

8. **Use `BufferPool` for transient staging buffers**, not persistent GPU data.

---

## Troubleshooting

| Symptom | Cause | Solution |
|---------|-------|----------|
| `gdjs.__webgpu is undefined` | WebGPUCore not loaded | Call `InitializeCore` action first |
| `Runtime.initialized is false` | Device init failed | Check browser console for WebGPU errors; may not be supported |
| Buffers/textures not found | Wrong ID string | Verify ID matches the one passed to `create*` |
| Compute dispatch does nothing | Uninitialized pipeline or null bind group | Ensure pipeline exists and bind group is valid |
| Device lost every few seconds | Driver issue or unsupported device | Try power preference `"low-power"` or fallback to WebGL |
| Memory grows over time | Buffers not released | Call `destroyBuffer` and `BufferPool.release` correctly |

---

## Version History

- **v1.2.0** (current): Full RHI, scheduler, buffer pooling, device-loss recovery
- **v1.1.x**: Compute pipeline caching
- **v1.0.x**: Basic device init and resource tracking

---

## Related Extensions

- **3DCRT+** (ScrollWeaver): CRT post-processing; uses WebGPUCore for shader dispatch
- **ParticleGPU** (future): GPU-accelerated particles via compute
- **TerrainStreaming** (future): LOD voxel terrain with WebGPU compute deformation

