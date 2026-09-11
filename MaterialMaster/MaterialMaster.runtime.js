if (typeof THREE !== 'undefined' && !gdjs.__material3D) {
    gdjs.__material3D = (function() {
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

                    // How many times an AO map forced a uv -> uv1 alias onto a geometry.
                    aoUvAliased: 0
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
            const rawAnisotropy = readOverride(behavior, 'AnisotropicFiltering') !== undefined
                ? readOverride(behavior, 'AnisotropicFiltering')
                : (readOverride(behavior, 'TextureAnisotropy') !== undefined
                    ? readOverride(behavior, 'TextureAnisotropy')
                    : getString(behavior, 'AnisotropicFiltering', '16x'));
            const anisotropy = gdjs.__materialController3D
                ? gdjs.__materialController3D.resolveAnisotropy(rawAnisotropy, null)
                : null;

            for (const mat of state.targetMaterials) {
                if (mat) {
                    applyMaterialSettings(mat, behavior, state.root);
                    if (anisotropy !== null && gdjs.__materialController3D) {
                        gdjs.__materialController3D.applyAnisotropyToMaterial(mat, anisotropy);
                    }
                }
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

        // What the targeting modes can actually match on this object. Mesh-name and
        // material-name targeting were previously unguessable: the expressions could read back
        // the string you typed but never what was there to type, so a name that came out of
        // Blender had to be copied by eye from the outliner and a typo failed silently.
        const nameList = (values) => {
            const seen = [];
            for (const value of values) {
                const name = (value === undefined || value === null) ? '' : String(value);
                if (name === '') continue;
                if (seen.indexOf(name) < 0) seen.push(name);
            }
            return seen;
        };

        const meshNamesOf = (meshes) => nameList(meshes.map((mesh) => mesh && mesh.name));

        const materialNamesOf = (meshes) => {
            const names = [];
            for (const mesh of meshes) {
                const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
                for (const mat of mats) names.push(mat && mat.name);
            }
            return nameList(names);
        };

        // Meshes and materials an object exposes, resolved from scratch rather than from the
        // behavior's own target list -- the point is to report what is available to target,
        // including everything the current mode filtered out.
        const listNames = (object, pick) => {
            const root = getRootObject3D(object);
            if (!root) return '';
            try {
                return pick(collectMeshRecords(root, true)).join(', ');
            } catch(e) {
                return '';
            }
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
        const loadTexture = (game, resourceName, slotKey, filterMode, anisotropy, state, usedKeys) => {
            if (typeof resourceName !== 'string') return null;
            const resName = resourceName.trim();
            if (resName === '') return null;

            const cacheKey = slotKey + ':' + resName + ':' + filterMode + ':af' + (anisotropy !== null ? anisotropy : 'orig');
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
            if (anisotropy !== null && anisotropy !== undefined) {
                texture.anisotropy = anisotropy;
                // Anisotropic filtering has nothing to sample without a mip chain, and the
                // engine hands out textures with minFilter = LinearFilter, which suppresses
                // mipmap generation. "Keep Original" therefore used to mean "anisotropy does
                // nothing", silently, which is the default configuration.
                if (anisotropy > 1 && gdjs.__materialController3D &&
                    typeof gdjs.__materialController3D.ensureMipmapChain === 'function') {
                    gdjs.__materialController3D.ensureMipmapChain(texture);
                }
            }
            // Once, so the clone's colour space and filters reach the GPU. This must not
            // be repeated per frame: it forces a full re-upload of the image.
            texture.needsUpdate = true;

            state.ownedTextures.set(cacheKey, texture);
            usedKeys.add(cacheKey);
            return texture;
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
        const MATERIAL_PRESETS = {
            'Default (Standard PBR)': {
                roughness: 0.5, metalness: 0.0, useRoughness: true, useMetalness: true
            },
            'Matte Plastic': {
                roughness: 0.85, metalness: 0.0, useRoughness: true, useMetalness: true
            },
            'Glossy Plastic': {
                roughness: 0.1, metalness: 0.0, useRoughness: true, useMetalness: true
            },
            'Metal / Chrome': {
                roughness: 0.05, metalness: 1.0, useRoughness: true, useMetalness: true
            },
            'Brushed Metal': {
                roughness: 0.35, metalness: 1.0, useRoughness: true, useMetalness: true
            },
            'Gold': {
                color: '255;215;0', roughness: 0.2, metalness: 1.0, useBaseColor: true, useRoughness: true, useMetalness: true
            },
            'Glass / Window': {
                roughness: 0.05, metalness: 0.0, useRoughness: true, useMetalness: true,
                alphaMode: 'Blend', alpha: 0.2, depthWrite: false
            },
            'Mirror': {
                color: '255;255;255', roughness: 0.0, metalness: 1.0, useBaseColor: true, useRoughness: true, useMetalness: true
            },
            'Rubber': {
                color: '35;35;35', roughness: 0.9, metalness: 0.0, useBaseColor: true, useRoughness: true, useMetalness: true
            },
            'Emissive Glow': {
                roughness: 0.5, metalness: 0.0, useEmissive: true, emissiveColor: '0;255;200', emissiveStrength: 3.0
            },
        };

        const chooseMaterialClass = (behavior, root) => {
            const mode = getString(behavior, 'ShaderType', 'Auto');
            const presetName = readOverride(behavior, 'Preset') !== undefined ? String(readOverride(behavior, 'Preset')) : getString(behavior, 'Preset', 'Custom');
            const wantsPhysical = !!(root && gdjs.__materialController3D &&
                    gdjs.__materialController3D.requiredMaterialClass(root) === 'Physical') || (presetName === 'Glass / Window');

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

        // Fields carried across a material class change. A class change cannot clone -- a
        // Standard material does not become a Physical one -- so the replacement starts at
        // Three.js defaults and everything the model authored is lost unless it is copied here.
        // The six texture slots come back through __m3dBaseMaps; nothing else did, which is why
        // an emissive panel went black and a double-sided transparent leaf card came back opaque
        // and single-sided. "Preserve" could not help: there was no longer anything to preserve.
        //
        // Every field is guarded on both sides, so carrying a Physical into a Basic drops the
        // fields Basic cannot honour instead of inventing them.
        const CARRIED_COLORS = ['emissive', 'specularColor', 'sheenColor', 'attenuationColor'];
        const CARRIED_NUMBERS = [
            'emissiveIntensity', 'aoMapIntensity', 'lightMapIntensity', 'envMapIntensity',
            'bumpScale', 'displacementScale', 'displacementBias', 'opacity', 'alphaTest',
            'reflectivity'
        ];
        const CARRIED_FLAGS = [
            'transparent', 'depthWrite', 'depthTest', 'vertexColors', 'flatShading',
            'premultipliedAlpha', 'toneMapped', 'side', 'shadowSide', 'blending',
            'alphaToCoverage', 'dithering'
        ];
        const CARRIED_MAPS = ['alphaMap', 'bumpMap', 'displacementMap', 'lightMap', 'envMap'];

        const carryAuthoredFields = (newMat, baseMat) => {
            if (!newMat || !baseMat) return;
            newMat.name = baseMat.name;
            if (baseMat.color && newMat.color) newMat.color.copy(baseMat.color);
            if (baseMat.map) newMat.map = baseMat.map;
            if (newMat.roughness !== undefined) {
                newMat.roughness = baseMat.roughness !== undefined ? baseMat.roughness : 0.5;
            }
            if (newMat.metalness !== undefined) {
                newMat.metalness = baseMat.metalness !== undefined ? baseMat.metalness : 0;
            }
            for (const key of CARRIED_COLORS) {
                const src = baseMat[key];
                const dst = newMat[key];
                if (src && dst && typeof dst.copy === 'function') dst.copy(src);
            }
            for (const key of CARRIED_NUMBERS) {
                if (newMat[key] === undefined) continue;
                const v = Number(baseMat[key]);
                if (Number.isFinite(v)) newMat[key] = v;
            }
            for (const key of CARRIED_FLAGS) {
                if (newMat[key] === undefined || baseMat[key] === undefined) continue;
                newMat[key] = baseMat[key];
            }
            for (const key of CARRIED_MAPS) {
                if (newMat[key] === undefined) continue;
                if (baseMat[key]) newMat[key] = baseMat[key];
            }
            // A Vector2. Assigning it would alias the model's own object, so that editing one
            // material's normal strength silently moved every material sharing the source.
            if (baseMat.normalScale && newMat.normalScale && typeof newMat.normalScale.copy === 'function') {
                newMat.normalScale.copy(baseMat.normalScale);
            }
        };

        const applyMaterialSettings = (mat, behavior, root) => {
            if (root && gdjs.__materialController3D && gdjs.__materialController3D.requiresVertexColors(root)) {
                mat.vertexColors = true;
            }

            const presetName = readOverride(behavior, 'Preset') !== undefined ? String(readOverride(behavior, 'Preset')) : getString(behavior, 'Preset', 'Custom');
            const preset = MATERIAL_PRESETS[presetName];
            if (preset) {
                if (preset.useBaseColor && !getBoolean(behavior, 'UseBaseColor', false) && readOverride(behavior, 'BaseColor') === undefined) {
                    if (mat.color) mat.color.copy(parseColor(preset.color));
                }
                if (preset.useRoughness && !getBoolean(behavior, 'UseRoughness', false) && readOverride(behavior, 'Roughness') === undefined) {
                    mat.roughness = preset.roughness;
                }
                if (preset.useMetalness && !getBoolean(behavior, 'UseMetalness', false) && readOverride(behavior, 'Metalness') === undefined) {
                    mat.metalness = preset.metalness;
                }
                if (preset.useEmissive && !getBoolean(behavior, 'UseEmissive', false) && readOverride(behavior, 'EmissiveColor') === undefined) {
                    if (mat.emissive) mat.emissive.copy(parseColor(preset.emissiveColor));
                    if (mat.emissiveIntensity !== undefined) mat.emissiveIntensity = preset.emissiveStrength;
                }
                if (preset.alphaMode && getString(behavior, 'AlphaMode', 'Preserve') === 'Preserve' && readOverride(behavior, 'AlphaMode') === undefined) {
                    mat.transparent = true;
                    mat.opacity = preset.alpha;
                    if (preset.depthWrite !== undefined) mat.depthWrite = preset.depthWrite;
                }
            }

            if (getBoolean(behavior, 'UseBaseColor', false) && mat.color) {
                mat.color.copy(parseColor(getString(behavior, 'BaseColor', '255;255;255')));
            }

            if (mat.isMeshStandardMaterial || mat.isMeshPhysicalMaterial) {
                const overrideRoughness = readOverride(behavior, 'Roughness');
                if (overrideRoughness !== undefined || getBoolean(behavior, 'UseRoughness', false)) {
                    mat.roughness = clamp(getNumber(behavior, 'Roughness', 0.5), 0, 1);
                }
                const overrideMetalness = readOverride(behavior, 'Metalness');
                if (overrideMetalness !== undefined || getBoolean(behavior, 'UseMetalness', false)) {
                    mat.metalness = clamp(getNumber(behavior, 'Metalness', 0), 0, 1);
                }

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

            // Both of these used to be written unconditionally from their property defaults, so
            // merely attaching the behavior forced wireframe off and fog on -- flattening what
            // the model authored, which is the same silent overwrite the Use* gates and the
            // Preserve defaults exist to prevent. They now write only when the value actually
            // says something: a setter override (so turning either OFF from events still works)
            // or a property moved off its default.
            if (mat.wireframe !== undefined) {
                const wireframe = getBoolean(behavior, 'Wireframe', false);
                if (readOverride(behavior, 'Wireframe') !== undefined || wireframe === true) {
                    mat.wireframe = wireframe;
                }
            }
            if (mat.fog !== undefined) {
                const fog = getBoolean(behavior, 'Fog', true);
                if (readOverride(behavior, 'Fog') !== undefined || fog === false) {
                    mat.fog = fog;
                }
            }

            mat.needsUpdate = true;
        };

        // Resolve every texture slot and bind it to the target materials. Runs on apply
        // and whenever an action changes a texture, never per frame.
        const bindTextures = (state, behavior, game) => {
            const filterMode = getString(behavior, 'TextureFiltering', 'Keep Original');
            const rawAnisotropy = readOverride(behavior, 'AnisotropicFiltering') !== undefined
                ? readOverride(behavior, 'AnisotropicFiltering')
                : (readOverride(behavior, 'TextureAnisotropy') !== undefined
                    ? readOverride(behavior, 'TextureAnisotropy')
                    : getString(behavior, 'AnisotropicFiltering', '16x'));
            const anisotropy = gdjs.__materialController3D
                ? gdjs.__materialController3D.resolveAnisotropy(rawAnisotropy, game)
                : null;
            const normalScale = getNumber(behavior, 'NormalScale', 1);
            const aoIntensity = getNumber(behavior, 'AOIntensity', 1);

            const usedKeys = new Set();
            const resolved = {};
            for (const slot of TEXTURE_SLOTS) {
                const texture = loadTexture(game, getString(behavior, slot.property, ''), slot.key, filterMode, anisotropy, state, usedKeys);
                resolved[slot.target] = texture;
            }

            for (const mat of state.targetMaterials) {
                if (!mat) continue;
                // Slots with no resource assigned fall back to whatever the object's own
                // material already had, so a 3D model keeps its baked-in maps instead of
                // losing them to an empty slot.
                const base = mat.__m3dBaseMaps || {};
                for (const slot of TEXTURE_SLOTS) {
                    const ownMap = resolved[slot.target] || null;
                    const currentMap = ownMap || base[slot.target] || null;
                    mat[slot.target] = currentMap;
                    // Only textures this behavior loaded get their wrap mode forced. A map that
                    // arrived with the model is shared and not ours to change: glTF routinely
                    // authors ClampToEdge for atlases and non-tiling UV layouts, and switching
                    // that to Repeat bleeds the edges for every other object drawing the same
                    // image. It also outlives RestoreMaterials, which restores materials but has
                    // no record of a texture it never owned.
                    if (ownMap && typeof ownMap === 'object') {
                        if (typeof THREE !== 'undefined' && THREE.RepeatWrapping) {
                            ownMap.wrapS = THREE.RepeatWrapping;
                            ownMap.wrapT = THREE.RepeatWrapping;
                        }
                    }
                }
                // These used to apply only to maps this behavior loaded, so both properties were
                // inert on a model's own normal and AO maps. They now reach whichever map is
                // actually bound -- but only when the value was really set, because a default of 1
                // would otherwise overwrite the strength the model authored the instant the
                // behavior was attached, which is the failure the Use* gates exist to prevent.
                const normalScaleSet = readOverride(behavior, 'NormalScale') !== undefined || normalScale !== 1;
                const aoIntensitySet = readOverride(behavior, 'AOIntensity') !== undefined || aoIntensity !== 1;
                if (mat.normalMap && mat.normalScale && normalScaleSet) {
                    mat.normalScale.set(normalScale, normalScale);
                }
                if (mat.aoMap && mat.aoMapIntensity !== undefined && aoIntensitySet) {
                    mat.aoMapIntensity = aoIntensity;
                }
                if (anisotropy !== null && gdjs.__materialController3D) {
                    gdjs.__materialController3D.applyAnisotropyToMaterial(mat, anisotropy);
                }
                mat.needsUpdate = true;
            }

            ensureAOUv(state);

            // Drop textures this behavior owns that nothing references any more, so
            // repeatedly swapping a texture at runtime does not accumulate GPU memory.
            // Safe only because every slot above is now assigned unconditionally.
            for (const [key, texture] of state.ownedTextures) {
                if (usedKeys.has(key)) continue;
                try { texture.dispose(); } catch(e) {}
                state.ownedTextures.delete(key);
            }
        };

        // Three.js r160 samples aoMap from the SECOND UV set, geometry.attributes.uv1. The
        // Blender glTF exporter writes a single UV set unless a second one is added on purpose,
        // so an AO map on a typical .glb sampled an attribute that was not there and contributed
        // nothing at all, with a clean console -- the exact silent failure this extension's
        // diagnostics exist to remove. Alias uv onto uv1 in that case: with one UV set those ARE
        // the same coordinates, so this is what the model meant. A model that ships a real uv1 is
        // left alone. UVRepairCount's sibling, AOUVAliasCount(), reports when it fired.
        const ensureAOUv = (state) => {
            let needsAO = false;
            for (const mat of state.targetMaterials) {
                if (mat && mat.aoMap) { needsAO = true; break; }
            }
            if (!needsAO) return;
            for (const mesh of state.targetMeshes) {
                const geom = mesh && mesh.geometry;
                const attrs = geom && geom.attributes;
                if (!attrs || !attrs.uv || attrs.uv1) continue;
                if (typeof geom.setAttribute !== 'function') continue;
                try {
                    geom.setAttribute('uv1', attrs.uv);
                    state.aoUvAliased++;
                } catch(e) {}
            }
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
                    // Naming what IS there turns the most common 3D-model mistake -- a mesh or
                    // material name that does not match what the .glb actually shipped -- from a
                    // silent no-op into a one-line answer.
                    const mode = getString(behavior, 'TargetMode', 'All materials');
                    let detail = '';
                    if (mode === 'Mesh name') {
                        const available = meshNamesOf(allMeshes);
                        detail = ' Looking for mesh "' + getString(behavior, 'MeshName', '') +
                            '". This object has: ' + (available.length ? available.join(', ') : '(no named meshes)') + '.';
                    } else if (mode === 'Material name') {
                        const available = materialNamesOf(allMeshes);
                        detail = ' Looking for material "' + getString(behavior, 'MaterialName', '') +
                            '". This object has: ' + (available.length ? available.join(', ') : '(no named materials)') + '.';
                    } else if (mode === 'Material index') {
                        detail = ' Looking for material index ' + getNumber(behavior, 'MaterialIndex', 0) +
                            ' across ' + allMeshes.length + ' mesh(es).';
                    }
                    fail(state, 'No materials matched the current Target Mode.' + detail);
                    return;
                }

                const cloneMaterials = getBoolean(behavior, 'CloneMaterials', true);
                const appliedMaterials = [];
                const appliedMeshes = [];
                const wanted = chooseMaterialClass(behavior, root);

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
                        carryAuthoredFields(newMat, baseMat);
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

                    applyMaterialSettings(newMat, behavior, root);

                    // The currently attached material may be a BRDF-owned patched clone. Core is
                    // about to displace it and cannot track it in ownedMaterials, so return it to
                    // its owner before committing the replacement.
                    const currentMat = Array.isArray(mesh.material)
                        ? mesh.material[target.index]
                        : mesh.material;
                    if (currentMat && currentMat !== newMat && gdjs.__brdfMaterial3D &&
                        typeof gdjs.__brdfMaterial3D.releaseIfOwned === 'function') {
                        gdjs.__brdfMaterial3D.releaseIfOwned(currentMat);
                    }

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
                    // collected above are no longer the ones on the meshes. Resolve the same exact
                    // (mesh, slot) targets again. Gathering all materials from an affected mesh
                    // would silently widen "Material index" targeting on multi-material models.
                    if (rePatched) {
                        const live = [];
                        for (const target of targets) {
                            const mesh = target.mesh;
                            if (!mesh || !mesh.material) continue;
                            const mat = Array.isArray(mesh.material)
                                ? mesh.material[target.index]
                                : (target.index === 0 ? mesh.material : null);
                            if (mat) live.push(mat);
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

                // Publish one authoritative material generation for the divided behaviors. Exact
                // slots are retained; contributors must never infer targets by expanding a mesh.
                if (gdjs.__materialController3D) {
                    const controllerTargets = [];
                    for (const target of targets) {
                        const mesh = target.mesh;
                        if (!mesh || !mesh.material) continue;
                        const material = Array.isArray(mesh.material)
                            ? mesh.material[target.index]
                            : (target.index === 0 ? mesh.material : null);
                        if (material) controllerTargets.push({ mesh, slot: target.index, material });
                    }
                    state.materialGeneration = gdjs.__materialController3D.commitTargets(root, controllerTargets);
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

            const root = getRootObject3D(object);
            if (root && gdjs.__materialController3D) {
                const requests = gdjs.__materialController3D.consumeRequests(root);
                if (requests.material.length) {
                    reapply(behavior, object, runtimeScene.getGame());
                    return;
                }
                if (requests.shader.length) {
                    for (const target of gdjs.__materialController3D.getTargets(root)) {
                        if (target.material) target.material.needsUpdate = true;
                    }
                }
            }

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

        };

        const restoreOriginalMaterials = (state, allMeshes, root) => {
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
            state.ownedMaterials.clear();
            state.ownedTextures.clear();
            state.originalMaterials.clear();
            state.targetMaterials = [];
            state.targetMeshes = [];
            state.state = 'Uninitialized';
            state.retryCount = 0;
            // Overrides are dropped with the materials they described. Leaving them set would
            // mean a later re-apply silently inherited every setter call made before the restore.
            state.overrides = {};
            state.dirty = false;
            state.materialGeneration = 0;
            if (root && gdjs.__materialController3D) {
                gdjs.__materialController3D.commitTargets(root, []);
            }
        };

        return {
            getBehaviorState,
            getRootObject3D,
            collectMeshRecords,
            applyToBehavior,
            bindTextures,
            reapply,
            tick,
            restoreOriginalMaterials,
            getMaterialGeneration: (behavior) => getBehaviorState(behavior).materialGeneration || 0,

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
            getAOUvAliasCount: (behavior) => getBehaviorState(behavior).aoUvAliased || 0,
            listMeshNames: (object) => listNames(object, meshNamesOf),
            listMaterialNames: (object) => listNames(object, materialNamesOf),
            getMaterialCount: (behavior) => getBehaviorState(behavior).materialsCount,
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
            },

            getAnisotropicFiltering: (behavior) => {
                const ov = readOverride(behavior, 'AnisotropicFiltering');
                if (ov !== undefined) return String(ov);
                return getString(behavior, 'AnisotropicFiltering', '16x');
            },

            getTextureAnisotropy: (behavior) => {
                const state = getBehaviorState(behavior);
                if (state && state.targetMaterials && state.targetMaterials[0] && gdjs.__materialController3D) {
                    const mat = state.targetMaterials[0];
                    for (const slot of TEXTURE_SLOTS) {
                        const t = mat[slot.target];
                        if (t && typeof t.anisotropy === 'number') return t.anisotropy;
                    }
                }
                const raw = readOverride(behavior, 'AnisotropicFiltering') !== undefined
                    ? readOverride(behavior, 'AnisotropicFiltering')
                    : (readOverride(behavior, 'TextureAnisotropy') !== undefined
                        ? readOverride(behavior, 'TextureAnisotropy')
                        : getString(behavior, 'AnisotropicFiltering', '16x'));
                return gdjs.__materialController3D ? (gdjs.__materialController3D.resolveAnisotropy(raw, null) || 1) : 1;
            },

            presets: MATERIAL_PRESETS,
            getPreset: (behavior) => {
                const ov = readOverride(behavior, 'Preset');
                if (ov !== undefined) return String(ov);
                return getString(behavior, 'Preset', 'Custom');
            }
        };
    })();
}
