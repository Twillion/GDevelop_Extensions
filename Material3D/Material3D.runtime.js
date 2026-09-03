if (typeof THREE !== 'undefined' && !gdjs.__material3D) {
    gdjs.__material3D = (function() {
        const DEG_TO_RAD = Math.PI / 180;

        const clamp = (val, min, max) => Math.max(min, Math.min(max, val));
        const isMesh = (node) => node && node.isMesh === true && node.material;

        // Finite guard for every value that reaches a Three.js numeric field. A NaN in
        // texture.offset or texture.repeat poisons the whole UV matrix and the surface
        // renders undefined, so nothing untrusted gets through without passing here.
        const finite = (value, def) => {
            const v = Number(value);
            return Number.isFinite(v) ? v : def;
        };

        // Slots holding colour data, which must be sRGB-decoded. Everything else is
        // data (normals, roughness, metalness, occlusion) and must stay linear.
        const COLOR_SLOTS = { albedo: true, emissive: true };

        const TEXTURE_SLOTS = [
            { key: 'albedo', property: 'AlbedoMap', target: 'map' },
            { key: 'normal', property: 'NormalMap', target: 'normalMap' },
            { key: 'roughness', property: 'RoughnessMap', target: 'roughnessMap' },
            { key: 'metalness', property: 'MetalnessMap', target: 'metalnessMap' },
            { key: 'ao', property: 'AOMap', target: 'aoMap' },
            { key: 'emissive', property: 'EmissiveMap', target: 'emissiveMap' }
        ];

        const getRootObject3D = (object) => {
            if (!object) return null;
            if (typeof object.get3DRendererObject === 'function') {
                try {
                    const obj = object.get3DRendererObject();
                    if (obj) return obj;
                } catch(e) {}
            }
            return null;
        };

        const getBehaviorState = (behavior) => {
            if (!behavior.__material3DState) {
                behavior.__material3DState = {
                    state: 'Uninitialized',
                    error: '',
                    warned: false,
                    retryCount: 0,
                    animationInitialized: false,
                    meshesCount: 0,
                    materialsCount: 0,
                    targetMaterials: [],
                    targetMeshes: [],

                    // Runtime property overrides written by setter actions. Consulted by
                    // getBoolean/getNumber/getString ahead of the editor property, so a set
                    // action wins until RestoreMaterials or a fresh apply clears it.
                    overrides: {},
                    // Set whenever an override is written; consumed by tick() according to
                    // UpdateMode. "Manual" leaves it set until ReapplyMaterial is called.
                    dirty: false,

                    originalMaterials: new Map(),
                    ownedMaterials: new Set(),
                    ownedTextures: new Map(), // cacheKey -> THREE.Texture owned by this behavior
                    animatedTextures: [], // textures whose UV transform this behavior drives
                    videoElement: null,
                    videoTexture: null,

                    // Base UV transform, read from the behavior properties when the
                    // material is applied and left alone from then on.
                    baseTilingX: 1,
                    baseTilingY: 1,
                    baseOffsetX: 0,
                    baseOffsetY: 0,
                    baseRotation: 0,
                    centerX: 0.5,
                    centerY: 0.5,

                    // UV animation runtime state
                    uvOffset: { x: 0, y: 0 },
                    uvRotation: 0,
                    isScrolling: false,
                    scrollSpeedX: 0,
                    scrollSpeedY: 0,
                    scrollRotSpeed: 0,

                    // Flipbook runtime state
                    flipbook: {
                        enabled: false,
                        isPlaying: false,
                        columns: 1,
                        rows: 1,
                        fps: 12,
                        loop: true,
                        totalFrames: 1,
                        currentFrame: 0,
                        timer: 0,
                        isFinished: false
                    }
                };
            }
            return behavior.__material3DState;
        };

        const fail = (state, message) => {
            state.error = message;
            state.state = 'Failed';
            if (!state.warned) {
                state.warned = true;
                console.warn('[Material3D] ' + message);
            }
        };

        // ---------------------------------------------------------------- Property reads
        //
        // Every property read in this runtime goes through these three functions, which is what
        // makes runtime overrides possible without touching the forty-odd call sites. A setter
        // action writes into `state.overrides`; the getters consult that first and fall back to
        // the editor property. `undefined` is never a valid override — `hasOwnProperty` is used
        // so that an override of `0`, `false` or `''` still wins over the property.
        //
        // Overrides live on the behavior state, so they are per-instance and die with the object.

        const readOverride = (behavior, name) => {
            const st = behavior.__material3DState;
            if (!st || !st.overrides) return undefined;
            return Object.prototype.hasOwnProperty.call(st.overrides, name) ? st.overrides[name] : undefined;
        };

        const getBoolean = (behavior, name, def) => {
            const o = readOverride(behavior, name);
            if (o !== undefined) return o === true || o === 'true' || o === 1 || o === '1';
            const g = behavior['_get' + name];
            if (typeof g !== 'function') return def;
            const v = g.call(behavior);
            return v === true || v === 'true' || v === 1 || v === '1';
        };

        const getNumber = (behavior, name, def) => {
            const o = readOverride(behavior, name);
            if (o !== undefined) return finite(o, def);
            const g = behavior['_get' + name];
            if (typeof g !== 'function') return def;
            return finite(g.call(behavior), def);
        };

        const getString = (behavior, name, def) => {
            const o = readOverride(behavior, name);
            if (o !== undefined) return String(o);
            const g = behavior['_get' + name];
            return typeof g === 'function' ? String(g.call(behavior)) : def;
        };

        // Writing an override marks the behavior dirty. Whether that actually triggers a re-apply
        // is decided by UpdateMode in tick() — "Manual" defers it until ReapplyMaterial is called.
        const setOverride = (behavior, name, value) => {
            const state = getBehaviorState(behavior);
            if (!state.overrides) state.overrides = {};
            state.overrides[name] = value;
            state.dirty = true;
            return state;
        };

        // Settings-only refresh: re-runs applyMaterialSettings over the materials this behavior
        // already owns, without re-walking the mesh tree or rebuilding materials. This is the
        // cheap path used for per-frame updates and for most setters.
        const refreshSettings = (behavior) => {
            const state = getBehaviorState(behavior);
            if (state.state !== 'Ready') return false;
            for (const mat of state.targetMaterials) {
                if (mat) applyMaterialSettings(mat, behavior);
            }
            applyMeshFlags(behavior, state);
            state.dirty = false;
            return true;
        };

        // castShadow / receiveShadow / renderOrder live on the mesh, not the material, so they
        // are re-applied separately from applyMaterialSettings.
        const applyMeshFlags = (behavior, state) => {
            const castShadow = getBoolean(behavior, 'CastShadow', true);
            const receiveShadow = getBoolean(behavior, 'ReceiveShadow', true);
            const renderOrder = Math.round(getNumber(behavior, 'RenderOrder', 0));
            for (const mesh of state.targetMeshes) {
                if (!mesh) continue;
                mesh.castShadow = castShadow;
                mesh.receiveShadow = receiveShadow;
                mesh.renderOrder = renderOrder;
            }
        };

        const parseColor = (colorString) => {
            const color = new THREE.Color();
            if (!colorString) return color.setRGB(1, 1, 1, THREE.SRGBColorSpace);
            const parts = String(colorString).split(';');
            if (parts.length < 3) {
                try { color.set(colorString); return color; } catch(e) { return color.setRGB(1, 1, 1, THREE.SRGBColorSpace); }
            }
            const r = clamp(finite(parts[0], 0), 0, 255) / 255;
            const g = clamp(finite(parts[1], 0), 0, 255) / 255;
            const b = clamp(finite(parts[2], 0), 0, 255) / 255;
            color.setRGB(r, g, b, THREE.SRGBColorSpace);
            return color;
        };

        const collectMeshRecords = (root, includeChildren) => {
            const records = [];
            if (isMesh(root)) records.push(root);
            if (includeChildren && typeof root.traverse === 'function') {
                root.traverse((child) => {
                    if (child !== root && isMesh(child)) records.push(child);
                });
            }
            return records;
        };

        const resolveTargets = (meshes, behavior) => {
            const targetMode = getString(behavior, 'TargetMode', 'All materials');
            const targetMatIndex = getNumber(behavior, 'MaterialIndex', 0);
            const targetMatName = getString(behavior, 'MaterialName', '');
            const targetMeshName = getString(behavior, 'MeshName', '');
            const results = [];
            let firstFound = false;

            for (const mesh of meshes) {
                if (targetMode === 'Mesh name' && mesh.name !== targetMeshName) continue;
                const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
                for (let i = 0; i < mats.length; i++) {
                    const mat = mats[i];
                    if (!mat) continue;
                    let match = false;
                    if (targetMode === 'All materials' || targetMode === 'Mesh name') match = true;
                    else if (targetMode === 'First material' && !firstFound) { match = true; firstFound = true; }
                    else if (targetMode === 'Material index' && i === targetMatIndex) match = true;
                    else if (targetMode === 'Material name' && mat.name === targetMatName) match = true;

                    if (match) {
                        results.push({ mesh, material: mat, index: i });
                        if (targetMode === 'First material') return results;
                    }
                }
            }
            return results;
        };

        // Resolve a project image resource to a texture this behavior owns.
        //
        // gdjs.PixiImageManager.getThreeTexture() is the engine's public loader. It keeps
        // one texture per resource and disposes it on scene unload, so the shared instance
        // must not be handed out here: this behavior animates offset/repeat/rotation, and
        // mutating the shared texture would drag every other user of that image along.
        // clone() gives an independent UV transform while Texture.copy() carries the same
        // `source` across, so the decoded image and its GPU upload are still shared.
        const loadTexture = (game, resourceName, slotKey, filterMode, state, usedKeys) => {
            if (typeof resourceName !== 'string') return null;
            const resName = resourceName.trim();
            if (resName === '') return null;

            const cacheKey = slotKey + ':' + resName + ':' + filterMode;
            const cached = state.ownedTextures.get(cacheKey);
            if (cached) {
                usedKeys.add(cacheKey);
                return cached;
            }

            const imageManager = game.getImageManager();
            if (!imageManager || typeof imageManager.getThreeTexture !== 'function') return null;

            let texture = null;
            try {
                const shared = imageManager.getThreeTexture(resName);
                if (shared) texture = shared.clone();
            } catch(e) {
                fail(state, 'Could not load image resource "' + resName + '": ' + e.message);
                return null;
            }
            if (!texture) return null;

            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.RepeatWrapping;
            // getThreeTexture marks every texture sRGB, which is right for colour maps
            // and wrong for the data maps, where an sRGB decode corrupts the values.
            texture.colorSpace = COLOR_SLOTS[slotKey] ? THREE.SRGBColorSpace : THREE.NoColorSpace;
            if (filterMode === 'Nearest') {
                texture.magFilter = THREE.NearestFilter;
                texture.minFilter = THREE.NearestFilter;
                texture.generateMipmaps = false;
            } else if (filterMode === 'Linear') {
                texture.magFilter = THREE.LinearFilter;
                texture.minFilter = THREE.LinearMipmapLinearFilter;
            }
            // Once, so the clone's colour space and filters reach the GPU. This must not
            // be repeated per frame: it forces a full re-upload of the image.
            texture.needsUpdate = true;

            state.ownedTextures.set(cacheKey, texture);
            usedKeys.add(cacheKey);
            return texture;
        };

        // Push the current UV transform onto the animated textures. Called every frame
        // while something is animating, so it stays allocation-free and never touches
        // needsUpdate: Texture.matrixAutoUpdate is true by default, so the renderer
        // rebuilds the UV matrix from offset/repeat/rotation/center on its own.
        const applyUVTransform = (state) => {
            const textures = state.animatedTextures;
            if (textures.length === 0) return;

            let repeatX = state.baseTilingX;
            let repeatY = state.baseTilingY;
            let offsetX = state.baseOffsetX + state.uvOffset.x;
            let offsetY = state.baseOffsetY + state.uvOffset.y;

            const fb = state.flipbook;
            if (fb.enabled) {
                const cols = fb.columns;
                const rows = fb.rows;
                const frameW = 1 / cols;
                const frameH = 1 / rows;
                const colIdx = fb.currentFrame % cols;
                const rowIdx = Math.floor(fb.currentFrame / cols) % rows;

                repeatX = frameW * state.baseTilingX;
                repeatY = frameH * state.baseTilingY;
                offsetX += colIdx * frameW;
                offsetY += 1 - frameH - rowIdx * frameH;
            }

            const rotation = (state.baseRotation + state.uvRotation) * DEG_TO_RAD;

            for (let i = 0; i < textures.length; i++) {
                const texture = textures[i];
                texture.repeat.set(repeatX, repeatY);
                texture.offset.set(offsetX, offsetY);
                texture.rotation = rotation;
                texture.center.set(state.centerX, state.centerY);
            }
        };

        // ---------------------------------------------------------------- Material class
        //
        // Three material classes are reachable. They are not interchangeable:
        //   Basic    — unlit. Ignores lights, roughness, metalness, emissive. Cheapest.
        //   Standard — the PBR workhorse. What this extension used exclusively before the merge.
        //   Physical — Standard plus transmission, IOR, thickness and clearcoat. Heavier to
        //              render, so it is opt-in rather than the default.
        //
        // "Auto" picks Physical only when a property that requires it is actually in use, which
        // keeps the common case on the cheaper Standard path.
        const chooseMaterialClass = (behavior) => {
            const mode = getString(behavior, 'ShaderType', 'Auto');
            // Every field that exists only on MeshPhysicalMaterial has to be listed here. If one is
            // missed, setting it under "Auto" builds a Standard material, Three.js drops the
            // assignment on the floor, and nothing is logged — the exact silent failure this
            // extension's diagnostics exist to prevent.
            const wantsPhysical =
                getNumber(behavior, 'Transmission', 0) > 0 ||
                getNumber(behavior, 'Clearcoat', 0) > 0 ||
                getNumber(behavior, 'Sheen', 0) > 0 ||
                getNumber(behavior, 'Iridescence', 0) > 0 ||
                getNumber(behavior, 'Anisotropy', 0) > 0;

            if (mode === 'Basic (unlit)') {
                return { Ctor: THREE.MeshBasicMaterial, matches: (m) => m.isMeshBasicMaterial === true };
            }
            if (mode === 'Physical (transmission, clearcoat)') {
                return { Ctor: THREE.MeshPhysicalMaterial, matches: (m) => m.isMeshPhysicalMaterial === true };
            }
            if (mode === 'Standard (PBR)') {
                // A Physical material satisfies "Standard" — it is a subclass — so an existing
                // Physical is left alone rather than downgraded, which would drop transmission.
                return { Ctor: THREE.MeshStandardMaterial, matches: (m) => m.isMeshStandardMaterial === true };
            }
            if (mode === 'Keep Original') {
                return { Ctor: THREE.MeshStandardMaterial, matches: () => true };
            }
            // Auto
            return wantsPhysical
                ? { Ctor: THREE.MeshPhysicalMaterial, matches: (m) => m.isMeshPhysicalMaterial === true }
                : { Ctor: THREE.MeshStandardMaterial, matches: (m) => m.isMeshStandardMaterial === true };
        };

        // ---------------------------------------------------------------- Wetness
        //
        // The visible part of "wet surface" is two field assignments, not a shader: porous
        // materials darken as water fills their surface pores, and the water film drives roughness
        // toward mirror. Both are computed here on the CPU, so the whole effect works with no
        // shader injection and no recompile. Only animated rain ripples need a shader, and they
        // are a separate module.
        const applyWetness = (mat, behavior) => {
            const wetness = clamp(getNumber(behavior, 'Wetness', 0), 0, 1);
            const porosity = clamp(getNumber(behavior, 'Porosity', 0.5), 0, 1);

            // This runs at the END of applyMaterialSettings, so roughness has just been written
            // from its property and is authoritative — read it fresh every pass, or a later change
            // to the Roughness property would be ignored while wet.
            //
            // Colour is different: it is only rewritten when UseBaseColor is on. With it off, the
            // colour on the material may already be darkened by a previous wet pass, so reading it
            // fresh would compound the darkening every frame until the surface went black. That
            // case has to use the cached original.
            const colorIsManaged = getBoolean(behavior, 'UseBaseColor', false);
            if (!mat.__m3dDryState || colorIsManaged) {
                mat.__m3dDryState = {
                    r: mat.color ? mat.color.r : 1,
                    g: mat.color ? mat.color.g : 1,
                    b: mat.color ? mat.color.b : 1,
                };
            }
            const dry = mat.__m3dDryState;
            dry.roughness = mat.roughness !== undefined ? mat.roughness : 0.5;

            if (wetness <= 0) {
                if (mat.color) mat.color.setRGB(dry.r, dry.g, dry.b, THREE.SRGBColorSpace);
                return;
            }

            // Water filling surface pores darkens the diffuse albedo. Metal has no pores, so
            // porosity 0 leaves colour untouched while still going glossy.
            const darken = 1 - wetness * porosity * 0.35;
            if (mat.color) {
                mat.color.setRGB(dry.r * darken, dry.g * darken, dry.b * darken, THREE.SRGBColorSpace);
            }
            // A water film is close to a mirror. 0.02 rather than 0 keeps the specular highlight a
            // shape rather than a single blown-out pixel.
            if (mat.roughness !== undefined) {
                mat.roughness = dry.roughness + (0.02 - dry.roughness) * wetness;
            }
        };

        // BRDF Material computes its diffuse from its own roughness uniform, not from
        // material.roughness. Left alone the two drift apart, and a wet surface ends up with a
        // wet-looking specular highlight over a diffuse that still behaves dry.
        //
        // This runs after every write to material.roughness. Uniform objects are read by Three.js
        // each frame, so assigning .value is enough — no recompile.
        const syncBrdfRoughness = (mat) => {
            if (!mat.__brdfFollowRoughness || !mat.__brdfUniforms) return;
            if (typeof mat.roughness !== 'number') return;
            mat.__brdfUniforms.uBrdfRoughness.value = mat.roughness;
        };

        const applyMaterialSettings = (mat, behavior) => {
            if (getBoolean(behavior, 'UseBaseColor', false) && mat.color) {
                mat.color.copy(parseColor(getString(behavior, 'BaseColor', '255;255;255')));
            }

            if (mat.isMeshStandardMaterial || mat.isMeshPhysicalMaterial) {
                mat.metalness = clamp(getNumber(behavior, 'Metalness', 0), 0, 1);
                mat.roughness = clamp(getNumber(behavior, 'Roughness', 0.5), 0, 1);

                // Emissive is gated so that leaving the colour at its default black does not
                // fight a colour the model already shipped with. UseEmissive off means
                // "don't touch it", not "force black".
                if (getBoolean(behavior, 'UseEmissive', false)) {
                    if (mat.emissive) mat.emissive.copy(parseColor(getString(behavior, 'EmissiveColor', '0;0;0')));
                    if (mat.emissiveIntensity !== undefined) {
                        mat.emissiveIntensity = Math.max(0, getNumber(behavior, 'EmissiveStrength', 1));
                    }
                }
            }

            // Physical-only fields. Assigning these to a Standard material silently does nothing
            // in Three.js, so they are guarded rather than left to fail quietly — the guard is
            // what makes "why is my glass opaque" answerable via the ShaderType property.
            if (mat.isMeshPhysicalMaterial) {
                mat.transmission = clamp(getNumber(behavior, 'Transmission', 0), 0, 1);
                mat.ior = clamp(getNumber(behavior, 'IOR', 1.5), 1, 2.333);
                mat.thickness = Math.max(0, getNumber(behavior, 'Thickness', 0.1));
                mat.clearcoat = clamp(getNumber(behavior, 'Clearcoat', 0), 0, 1);
                mat.clearcoatRoughness = clamp(getNumber(behavior, 'ClearcoatRoughness', 0), 0, 1);

                // Sheen, iridescence and anisotropy are native MeshPhysicalMaterial fields in
                // Three.js r160 — no shader injection needed, which is why they sit here with the
                // other physical fields rather than in the shader chain.
                mat.sheen = clamp(getNumber(behavior, 'Sheen', 0), 0, 1);
                if (mat.sheenColor) {
                    mat.sheenColor.copy(parseColor(getString(behavior, 'SheenColor', '255;255;255')));
                }
                mat.sheenRoughness = clamp(getNumber(behavior, 'SheenRoughness', 1), 0, 1);

                mat.iridescence = clamp(getNumber(behavior, 'Iridescence', 0), 0, 1);
                mat.iridescenceIOR = clamp(getNumber(behavior, 'IridescenceIOR', 1.3), 1, 2.5);
                if (Array.isArray(mat.iridescenceThicknessRange)) {
                    // Clamped so a min above max cannot produce an inverted range.
                    const thinMin = Math.max(0, getNumber(behavior, 'IridescenceThicknessMin', 100));
                    const thinMax = Math.max(thinMin, getNumber(behavior, 'IridescenceThicknessMax', 400));
                    mat.iridescenceThicknessRange[0] = thinMin;
                    mat.iridescenceThicknessRange[1] = thinMax;
                }

                mat.anisotropy = clamp(getNumber(behavior, 'Anisotropy', 0), 0, 1);
                mat.anisotropyRotation = getNumber(behavior, 'AnisotropyRotation', 0) * DEG_TO_RAD;
            }

            applyWetness(mat, behavior);
            syncBrdfRoughness(mat);

            const alphaMode = getString(behavior, 'AlphaMode', 'Preserve');
            const alpha = clamp(getNumber(behavior, 'Alpha', 1), 0, 1);
            const alphaCutoff = clamp(getNumber(behavior, 'AlphaCutoff', 0.1), 0, 1);

            // "Preserve" is the default, and it is the only mode that touches nothing. The old
            // default was "Opaque", which meant merely attaching the behavior flattened
            // transparency on any model that shipped with it — a silent, hard-to-trace change.
            if (alphaMode === 'Preserve') {
                mat.needsUpdate = true;
            } else {

            mat.depthWrite = getBoolean(behavior, 'DepthWrite', true);
            mat.blending = THREE.NormalBlending;

            if (alphaMode === 'Blend') {
                mat.transparent = true;
                mat.opacity = alpha;
                mat.alphaTest = 0;
            } else if (alphaMode === 'Cutout') {
                mat.transparent = false;
                mat.opacity = 1;
                mat.alphaTest = alphaCutoff;
            } else if (alphaMode === 'Additive') {
                mat.transparent = true;
                mat.opacity = alpha;
                mat.alphaTest = 0;
                mat.blending = THREE.AdditiveBlending;
            } else if (alphaMode === 'Multiply') {
                mat.transparent = true;
                mat.opacity = alpha;
                mat.alphaTest = 0;
                mat.blending = THREE.MultiplyBlending;
            } else {
                mat.transparent = false;
                mat.opacity = 1;
                mat.alphaTest = 0;
            }

            } // end of non-Preserve alpha handling

            const sideMode = getString(behavior, 'MaterialSide', 'Preserve');
            if (sideMode === 'Front') mat.side = THREE.FrontSide;
            else if (sideMode === 'Back') mat.side = THREE.BackSide;
            else if (sideMode === 'Double') mat.side = THREE.DoubleSide;
            // "Preserve" leaves mat.side as the model authored it.

            if (mat.wireframe !== undefined) mat.wireframe = getBoolean(behavior, 'Wireframe', false);
            if (mat.fog !== undefined) mat.fog = getBoolean(behavior, 'Fog', true);

            mat.needsUpdate = true;
        };

        // Resolve every texture slot and bind it to the target materials. Runs on apply
        // and whenever an action changes a texture, never per frame.
        const bindTextures = (state, behavior, game) => {
            const filterMode = getString(behavior, 'TextureFiltering', 'Keep Original');
            const normalScale = getNumber(behavior, 'NormalScale', 1);
            const aoIntensity = getNumber(behavior, 'AOIntensity', 1);

            state.animatedTextures.length = 0;

            const usedKeys = new Set();
            const resolved = {};
            for (const slot of TEXTURE_SLOTS) {
                let texture = null;
                if (slot.key === 'albedo' && state.videoTexture) {
                    texture = state.videoTexture;
                } else {
                    texture = loadTexture(game, getString(behavior, slot.property, ''), slot.key, filterMode, state, usedKeys);
                }
                resolved[slot.target] = texture;
                if (texture) state.animatedTextures.push(texture);
            }

            for (const mat of state.targetMaterials) {
                if (!mat) continue;
                // Slots with no resource assigned fall back to whatever the object's own
                // material already had, so a 3D model keeps its baked-in maps instead of
                // losing them to an empty slot.
                const base = mat.__m3dBaseMaps || {};
                for (const slot of TEXTURE_SLOTS) {
                    mat[slot.target] = resolved[slot.target] || base[slot.target] || null;
                }
                if (resolved.normalMap && mat.normalScale) mat.normalScale.set(normalScale, normalScale);
                if (resolved.aoMap) mat.aoMapIntensity = aoIntensity;
                mat.needsUpdate = true;
            }

            // Drop textures this behavior owns that nothing references any more, so
            // repeatedly swapping a texture at runtime does not accumulate GPU memory.
            // Safe only because every slot above is now assigned unconditionally.
            for (const [key, texture] of state.ownedTextures) {
                if (usedKeys.has(key)) continue;
                try { texture.dispose(); } catch(e) {}
                state.ownedTextures.delete(key);
            }

            applyUVTransform(state);
        };

        const applyToBehavior = (behavior, object, game) => {
            const state = getBehaviorState(behavior);
            const root = getRootObject3D(object);
            if (!root) {
                if (state.state === 'Uninitialized' || state.state === 'WaitingForRenderer') {
                    state.state = 'WaitingForRenderer';
                    state.retryCount++;
                    if (state.retryCount > 180) {
                        fail(state, 'No 3D renderer on this object. This behavior needs a 3D object (3D Box, 3D Model, or another object exposing get3DRendererObject).');
                    }
                }
                return;
            }

            try {
                const allMeshes = collectMeshRecords(root, getBoolean(behavior, 'IncludeChildren', true));
                if (allMeshes.length === 0) {
                    fail(state, 'No compatible meshes found on this 3D object.');
                    return;
                }

                const targets = resolveTargets(allMeshes, behavior);
                state.meshesCount = new Set(targets.map(t => t.mesh)).size;
                state.materialsCount = targets.length;

                if (targets.length === 0) {
                    fail(state, 'No materials matched the current Target Mode.');
                    return;
                }

                const cloneMaterials = getBoolean(behavior, 'CloneMaterials', true);
                const appliedMaterials = [];
                const appliedMeshes = [];
                const wanted = chooseMaterialClass(behavior);

                for (const target of targets) {
                    const mesh = target.mesh;
                    if (!state.originalMaterials.has(mesh.uuid)) {
                        const wasArray = Array.isArray(mesh.material);
                        state.originalMaterials.set(mesh.uuid, {
                            wasArray: wasArray,
                            materials: wasArray ? mesh.material.slice() : [mesh.material]
                        });
                    }

                    const origArray = state.originalMaterials.get(mesh.uuid).materials;
                    const baseMat = origArray[target.index] || origArray[0];

                    let newMat;
                    if (cloneMaterials) {
                        // Clone only when the existing material is already the class we want.
                        // Otherwise build the wanted class fresh and carry the visible fields
                        // across by hand — cloning a Standard material does not turn it into a
                        // Physical one, and cloning a Physical into a Basic keeps fields that
                        // Basic cannot honour.
                        const reusable = baseMat && wanted.matches(baseMat);
                        newMat = reusable ? baseMat.clone() : new wanted.Ctor();
                        if (baseMat) {
                            newMat.name = baseMat.name;
                            if (baseMat.color && newMat.color) newMat.color.copy(baseMat.color);
                            if (baseMat.map) newMat.map = baseMat.map;
                            if (newMat.roughness !== undefined) {
                                newMat.roughness = baseMat.roughness !== undefined ? baseMat.roughness : 0.5;
                            }
                            if (newMat.metalness !== undefined) {
                                newMat.metalness = baseMat.metalness !== undefined ? baseMat.metalness : 0;
                            }
                        }
                        state.ownedMaterials.add(newMat);
                    } else {
                        newMat = baseMat;
                    }
                    if (!newMat) continue;

                    // Remember the maps the object shipped with, once, so empty texture
                    // slots can fall back to them instead of blanking the material.
                    // Captured before this behavior writes anything, and never re-captured.
                    if (!newMat.__m3dBaseMaps) {
                        const baseMaps = {};
                        for (const slot of TEXTURE_SLOTS) {
                            baseMaps[slot.target] = (baseMat && baseMat[slot.target]) || null;
                        }
                        newMat.__m3dBaseMaps = baseMaps;
                    }

                    applyMaterialSettings(newMat, behavior);

                    if (Array.isArray(mesh.material)) {
                        mesh.material[target.index] = newMat;
                    } else {
                        mesh.material = newMat;
                    }

                    appliedMaterials.push(newMat);
                    if (appliedMeshes.indexOf(mesh) < 0) appliedMeshes.push(mesh);
                }

                state.targetMaterials = appliedMaterials;
                state.targetMeshes = appliedMeshes;
                applyMeshFlags(behavior, state);

                // If the BRDF Material behavior has patched this object's shaders, the material
                // swap above just threw that patch away — the surface would silently revert to
                // the stock diffuse with nothing logged. Rebuild it on top of the new materials.
                // No-op when the BRDF behavior is not attached.
                if (gdjs.__brdfMaterial3D && typeof gdjs.__brdfMaterial3D.reapplyIfPatched === 'function') {
                    let rePatched = false;
                    try { rePatched = gdjs.__brdfMaterial3D.reapplyIfPatched(object); } catch(e) {}

                    // BRDF re-patches by CLONING and swapping mesh.material again, so the objects
                    // collected above are no longer the ones on the meshes. Left stale, every later
                    // settings refresh would write to discarded materials and appear to do nothing.
                    if (rePatched) {
                        const live = [];
                        for (const mesh of appliedMeshes) {
                            if (!mesh || !mesh.material) continue;
                            if (Array.isArray(mesh.material)) live.push(...mesh.material.filter(Boolean));
                            else live.push(mesh.material);
                        }
                        if (live.length) state.targetMaterials = live;
                    }
                }

                // THREE.Material.copy() carries neither onBeforeCompile nor customProgramCacheKey,
                // so every material built above lost the shader chain. Re-install on any that has
                // an active injector. Skipping this is the same silent-revert failure the userData
                // patch markers caused, one level up.
                if (gdjs.__m3dShaderChain) {
                    for (const mat of state.targetMaterials) {
                        if (mat) gdjs.__m3dShaderChain.ensure(mat);
                    }
                }

                // Cache the base UV transform so the per-frame path never re-reads properties.
                state.baseTilingX = getNumber(behavior, 'TilingX', 1);
                state.baseTilingY = getNumber(behavior, 'TilingY', 1);
                state.baseOffsetX = getNumber(behavior, 'OffsetX', 0);
                state.baseOffsetY = getNumber(behavior, 'OffsetY', 0);
                state.baseRotation = getNumber(behavior, 'RotationAngle', 0);
                state.centerX = getNumber(behavior, 'RotationCenterX', 0.5);
                state.centerY = getNumber(behavior, 'RotationCenterY', 0.5);

                // Seeded from the properties once. A later re-apply (triggered by a
                // texture action) must not discard scroll speeds or flipbook settings
                // that events have since configured.
                if (!state.animationInitialized) {
                    state.animationInitialized = true;

                    state.isScrolling = getBoolean(behavior, 'EnableScroll', false);
                    state.scrollSpeedX = getNumber(behavior, 'ScrollSpeedX', 0);
                    state.scrollSpeedY = getNumber(behavior, 'ScrollSpeedY', 0);
                    state.scrollRotSpeed = getNumber(behavior, 'ScrollRotationSpeed', 0);

                    const fb = state.flipbook;
                    fb.enabled = getBoolean(behavior, 'EnableFlipbook', false);
                    fb.columns = Math.max(1, Math.floor(getNumber(behavior, 'FlipbookColumns', 1)));
                    fb.rows = Math.max(1, Math.floor(getNumber(behavior, 'FlipbookRows', 1)));
                    fb.fps = Math.max(0.01, getNumber(behavior, 'FlipbookFPS', 12));
                    fb.loop = getBoolean(behavior, 'FlipbookLoop', true);
                    const declaredFrames = Math.floor(getNumber(behavior, 'FlipbookTotalFrames', 0));
                    fb.totalFrames = declaredFrames > 0 ? Math.min(declaredFrames, fb.columns * fb.rows) : fb.columns * fb.rows;
                    fb.isPlaying = fb.enabled;
                }

                bindTextures(state, behavior, game);

                state.state = 'Ready';
                state.error = '';
            } catch(e) {
                fail(state, 'Material setup error: ' + e.message);
                console.error('[Material3D]', e);
            }
        };

        // Force a full re-apply. Actions that change a behavior property call this so the
        // change reaches the material; there is no per-frame polling for it.
        const reapply = (behavior, object, game) => {
            const state = getBehaviorState(behavior);

            // Hold the previous clones aside rather than disposing up front: if the
            // re-apply fails the meshes would otherwise be left holding disposed
            // materials. They are only released once the new set is in place.
            const previous = state.ownedMaterials;
            state.ownedMaterials = new Set();
            state.targetMaterials = [];
            state.state = 'Uninitialized';
            state.retryCount = 0;

            applyToBehavior(behavior, object, game);

            if (state.state === 'Ready') {
                for (const mat of previous) {
                    if (state.ownedMaterials.has(mat)) continue;
                    try { mat.dispose(); } catch(e) {}
                }
            } else {
                for (const mat of previous) state.ownedMaterials.add(mat);
            }
            state.dirty = false;
        };

        const disposeVideo = (state) => {
            if (state.videoTexture) {
                try { state.videoTexture.dispose(); } catch(e) {}
                state.videoTexture = null;
            }
            if (state.videoElement) {
                try {
                    state.videoElement.pause();
                    // removeAttribute rather than src = '': an empty src resolves to the
                    // document URL and the browser fetches the page again as media.
                    state.videoElement.removeAttribute('src');
                    state.videoElement.load();
                } catch(e) {}
                state.videoElement = null;
            }
        };

        const setVideo = (behavior, object, runtimeScene, videoUrl, loop, muted) => {
            const state = getBehaviorState(behavior);
            if (typeof videoUrl !== 'string' || videoUrl.trim() === '') return;

            if (!state.videoElement) {
                state.videoElement = document.createElement('video');
                state.videoElement.crossOrigin = 'anonymous';
                state.videoElement.playsInline = true;
            }

            state.videoElement.src = videoUrl;
            state.videoElement.loop = loop === true;
            state.videoElement.muted = muted === true;

            if (!state.videoTexture) {
                state.videoTexture = new THREE.VideoTexture(state.videoElement);
                state.videoTexture.wrapS = THREE.RepeatWrapping;
                state.videoTexture.wrapT = THREE.RepeatWrapping;
                // Without this the renderer skips the sRGB decode for video frames
                // (its decodeVideoTexture path keys off the texture's colour space).
                state.videoTexture.colorSpace = THREE.SRGBColorSpace;
            }

            const playback = state.videoElement.play();
            if (playback && typeof playback.catch === 'function') {
                playback.catch((err) => {
                    console.warn('[Material3D] Video playback was blocked by the browser. ' +
                        'Autoplay usually requires the video to be muted, or a user interaction first. (' + err + ')');
                });
            }

            reapply(behavior, object, runtimeScene.getGame());
        };

        const tick = (behavior, object, runtimeScene) => {
            const state = getBehaviorState(behavior);

            if (state.state === 'Uninitialized' || state.state === 'WaitingForRenderer') {
                if (!getBoolean(behavior, 'ApplyOnCreation', true)) {
                    state.state = 'Idle';
                    return;
                }
                applyToBehavior(behavior, object, runtimeScene.getGame());
                return;
            }
            if (state.state !== 'Ready') return;

            // UpdateMode decides what happens to pending property changes:
            //   Apply once   — settings are applied at creation; later overrides land on the
            //                  next dirty check, which is the common case.
            //   Every frame  — re-reads and re-applies every frame. Costs a property read per
            //                  field per frame; use it when properties are driven by events
            //                  that do not go through this behavior's own setters.
            //   Manual       — nothing is re-applied until ReapplyMaterial is called.
            const updateMode = getString(behavior, 'UpdateMode', 'Apply once');
            if (updateMode === 'Every frame') {
                refreshSettings(behavior);
            } else if (state.dirty && updateMode !== 'Manual') {
                refreshSettings(behavior);
            }

            // VideoTexture drives its own uploads through requestVideoFrameCallback where
            // the browser has it; update() is the documented fallback and a no-op otherwise.
            // Setting needsUpdate here unconditionally would re-upload even on frames the
            // video has not advanced.
            if (state.videoTexture) state.videoTexture.update();

            const dt = runtimeScene.getTimeManager().getElapsedTime() / 1000;
            let uvDirty = false;

            if (state.isScrolling && (state.scrollSpeedX !== 0 || state.scrollSpeedY !== 0 || state.scrollRotSpeed !== 0)) {
                // Wrapped, because UV offsets are periodic and an unbounded accumulator
                // loses float precision in the texture matrix over a long session.
                state.uvOffset.x = (state.uvOffset.x + state.scrollSpeedX * dt) % 1;
                state.uvOffset.y = (state.uvOffset.y + state.scrollSpeedY * dt) % 1;
                state.uvRotation = (state.uvRotation + state.scrollRotSpeed * dt) % 360;
                uvDirty = true;
            }

            const fb = state.flipbook;
            if (fb.enabled && fb.isPlaying && !fb.isFinished && fb.totalFrames > 0) {
                fb.timer += dt;
                const frameDuration = 1 / fb.fps;
                if (fb.timer >= frameDuration) {
                    const advance = Math.floor(fb.timer / frameDuration);
                    fb.timer -= advance * frameDuration;
                    fb.currentFrame += advance;

                    if (fb.currentFrame >= fb.totalFrames) {
                        if (fb.loop) {
                            fb.currentFrame = fb.currentFrame % fb.totalFrames;
                        } else {
                            fb.currentFrame = fb.totalFrames - 1;
                            fb.isFinished = true;
                            fb.isPlaying = false;
                        }
                    }
                    uvDirty = true;
                }
            }

            if (uvDirty) applyUVTransform(state);
        };

        const restoreOriginalMaterials = (state, allMeshes) => {
            for (const mesh of allMeshes) {
                const orig = state.originalMaterials.get(mesh.uuid);
                if (!orig) continue;
                // Restore the shape that was saved, not whatever is currently attached:
                // a single-material array must go back as an array.
                mesh.material = orig.wasArray ? orig.materials.slice() : orig.materials[0];
            }
            for (const mat of state.ownedMaterials) {
                try { mat.dispose(); } catch(e) {}
            }
            for (const tex of state.ownedTextures.values()) {
                try { tex.dispose(); } catch(e) {}
            }
            disposeVideo(state);

            state.ownedMaterials.clear();
            state.ownedTextures.clear();
            state.originalMaterials.clear();
            state.targetMaterials = [];
            state.targetMeshes = [];
            state.animatedTextures.length = 0;
            state.state = 'Uninitialized';
            state.retryCount = 0;
            state.animationInitialized = false;
            // Overrides are dropped with the materials they described. Leaving them set would
            // mean a later re-apply silently inherited every setter call made before the restore.
            state.overrides = {};
            state.dirty = false;
        };

        return {
            getBehaviorState,
            getRootObject3D,
            collectMeshRecords,
            applyToBehavior,
            applyUVTransform,
            bindTextures,
            reapply,
            disposeVideo,
            setVideo,
            tick,
            restoreOriginalMaterials,

            // Merged in from Advanced3DMaterial: runtime overrides, explicit re-apply control,
            // and the diagnostics accessors that make a silent failure visible from events.
            setOverride,
            refreshSettings,
            chooseMaterialClass,
            markDirty: (behavior) => { getBehaviorState(behavior).dirty = true; },
            isDirty: (behavior) => getBehaviorState(behavior).dirty === true,
            getStateName: (behavior) => getBehaviorState(behavior).state,
            getError: (behavior) => getBehaviorState(behavior).error,
            getRetryCount: (behavior) => getBehaviorState(behavior).retryCount,
            getMeshCount: (behavior) => getBehaviorState(behavior).meshesCount,
            getMaterialCount: (behavior) => getBehaviorState(behavior).materialsCount,
            // Read through the same override-aware getter the runtime uses, so a value events just
            // set is reported even before the change has been applied to the material.
            getWetness: (behavior) => clamp(getNumber(behavior, 'Wetness', 0), 0, 1),

            // What actually reached the shader compiler on this object's first material. Empty
            // until the object has rendered at least one frame — onBeforeCompile has not run
            // before that, so an empty result means "not drawn yet", not "injection failed".
            getShaderInjectors: (behavior) => {
                const st = getBehaviorState(behavior);
                const mat = st.targetMaterials && st.targetMaterials[0];
                if (!mat || !gdjs.__m3dShaderChain) return [];
                return gdjs.__m3dShaderChain.injectedIds(mat);
            },
            hasShaderInjector: (behavior, id) => {
                const st = getBehaviorState(behavior);
                const mat = st.targetMaterials && st.targetMaterials[0];
                if (!mat || !gdjs.__m3dShaderChain) return false;
                return gdjs.__m3dShaderChain.hasInjector(mat, String(id));
            },

            getMaterialClassName: (behavior) => {
                const st = getBehaviorState(behavior);
                const mat = st.targetMaterials && st.targetMaterials[0];
                if (!mat) return '';
                if (mat.isMeshPhysicalMaterial) return 'Physical';
                if (mat.isMeshStandardMaterial) return 'Standard';
                if (mat.isMeshBasicMaterial) return 'Basic';
                return mat.type || '';
            }
        };
    })();
}
