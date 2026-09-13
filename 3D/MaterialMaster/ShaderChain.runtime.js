// ShaderChain.runtime.js — the single owner of onBeforeCompile for Material3D materials.
//
// WHY THIS EXISTS
//
// `material.onBeforeCompile` is one function property, not a list. Two behaviors that both assign
// it do not compose — whichever assigns last silently wins, and the loser's shader edits never
// appear. No error, no warning, just a plausible-looking surface missing half its features.
//
// Material 3D, BRDF Material and AdvancedLighting3D all need to edit the compiled shader, and the
// planned v3.5 modules (parallax occlusion, subsurface scattering, triplanar, detail normals,
// wetness) each need it too. So nobody assigns the hook directly. Injectors register here, and this
// module owns the one hook and runs them in a declared order.
//
// CLONE SAFETY
//
// THREE.Material.copy() carries neither `onBeforeCompile` nor `customProgramCacheKey`, and it JSON
// round-trips `userData` — so anything stored there loses its prototype. Material 3D clones
// materials routinely. Therefore: all chain state lives on DIRECT material properties, and
// install() must be re-run on every clone. `isInstalled()` is how a caller checks.
//
// MATERIAL REPLACEMENT
//
// Several runtimes construct `new THREE.Mesh*Material` and swap it onto the mesh. That throws the
// hook, the cache key and the chain state away with the discarded object — silently. `ensureAll()`
// exists for this: call it on the per-frame tick and a replaced material gets re-patched instead of
// quietly losing every injector.
//
// VERSION NEGOTIATION
//
// This file is embedded in more than one extension's runtime. Each copy carries CHAIN_VERSION, and
// a newer copy replaces an older one. The registry and the tracked-material list live on
// `gdjs.__m3dShaderChainState`, NOT in this closure, so an upgrade adopts what the previous copy
// had rather than starting empty — see the comment on the migration guard below for the one case
// that cannot be migrated.

(function () {
    if (typeof gdjs === 'undefined' || typeof THREE === 'undefined') return;

    // Bump when the contract changes (new band, new injector field, new exported function).
    var CHAIN_VERSION = 2;

    var previous = gdjs.__m3dShaderChain;
    var previousVersion = previous ? (previous.VERSION || 1) : 0;

    // Same or newer already installed: leave it alone. An equal version means another extension
    // embedded this identical file; there is nothing to gain by replacing it.
    if (previous && previousVersion >= CHAIN_VERSION) return;

    // Shared across module replacements. A v1 copy kept `injectors` in its own closure and cannot
    // be read from here, so its registrations are unrecoverable — warn rather than silently drop
    // them. From v2 onward every copy uses this object and upgrades migrate cleanly.
    var shared = gdjs.__m3dShaderChainState;
    if (!shared) {
        shared = gdjs.__m3dShaderChainState = { injectors: [], tracked: [] };
    }

    if (previous && previousVersion < 2) {
        // Only ids the shared registry does NOT already hold are actually lost. A predecessor that
        // kept its injectors in the shared array (any v2+) loses nothing, so warning on its ids
        // would be a false alarm.
        var had = [];
        try { had = previous.registeredIds ? previous.registeredIds() : []; } catch (e) {}
        var lost = [];
        for (var h = 0; h < had.length; h++) {
            var known = false;
            for (var j = 0; j < shared.injectors.length; j++) {
                if (shared.injectors[j].id === had[h]) { known = true; break; }
            }
            if (!known) lost.push(had[h]);
        }
        if (lost.length) {
            console.error(
                '[Material3D] ShaderChain v' + CHAIN_VERSION + ' replaced v' + previousVersion +
                ', which kept its injector registry privately and cannot be migrated. These ' +
                'injectors are no longer registered: ' + lost.join(', ') + '. The extension that ' +
                'shipped the older ShaderChain needs updating to match. Materials already patched ' +
                'by the old copy keep working; newly created ones will be missing these effects.'
            );
        }
    }

    var injectors = shared.injectors;
    var tracked = shared.tracked;

    var HAS_WEAKREF = (typeof WeakRef === 'function');

    gdjs.__m3dShaderChain = (function () {

        // ORDER BANDS — where a new module slots in.
        //
        // Ordered low to high, and the principle is layering, not shader execution order: the
        // BASE decides how the surface responds to light, and everything after it modifies the
        // inputs that response is computed from. A module registering in a later band can assume
        // the earlier bands are already in place and integrate with them.
        //
        //   100-199  BASE SHADING     the lighting model itself           — brdf, clustered lighting
        //   200-399  UV SYNTHESIS     what texture coordinates are used   — triplanar, parallax
        //   400-599  SURFACE INPUTS   normals, roughness, albedo          — detail normals, ripples
        //   600-799  LIGHTING ADD-ONS extra light response                — subsurface, specular AA
        //   800-999  OVERRIDES        anything that must have the last word
        //
        // Two injectors in the same band editing the same chunk is allowed but must be deliberate;
        // the build prints a note when it sees a chunk claimed twice.

        /**
         * @param {object} inj
         *   id       {string}   short stable key, also used to build the program cache key
         *   chunk    {string}   the Three.js shader chunk this injector edits, for conflict checks
         *   order    {number}   sort position; ties broken by registration order
         *   isActive {function} (mat) => boolean — whether this injector applies to this material
         *   inject   {function} (shader, mat) => void — perform the edit
         *   key      {function} (mat) => string — cache-key fragment; MUST vary with anything that
         *                       changes the generated source, or Three.js will reuse a stale program
         */
        function register(inj) {
            for (var i = 0; i < injectors.length; i++) {
                if (injectors[i].id === inj.id) { injectors[i] = inj; return; }
            }
            injectors.push(inj);
            injectors.sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
        }

        /** Drop an injector entirely. Materials keep their hook; the injector simply stops applying. */
        function unregister(id) {
            for (var i = 0; i < injectors.length; i++) {
                if (injectors[i].id === id) { injectors.splice(i, 1); return true; }
            }
            return false;
        }

        function activeFor(mat) {
            var out = [];
            for (var i = 0; i < injectors.length; i++) {
                var inj = injectors[i];
                try { if (inj.isActive(mat)) out.push(inj); } catch (e) {}
            }
            return out;
        }

        /* ------------------------------------------------------- Material tracking */

        // Held weakly where the runtime supports it, so a material dropped by the scene can still
        // be collected. Without WeakRef the list holds strong references and clearTracked() on
        // scene teardown is what keeps it from growing across scene changes.
        function track(mat) {
            for (var i = 0; i < tracked.length; i++) {
                if (deref(tracked[i]) === mat) return;
            }
            tracked.push(HAS_WEAKREF ? new WeakRef(mat) : mat);
        }

        function deref(entry) {
            if (!entry) return null;
            return (HAS_WEAKREF && entry instanceof WeakRef) ? (entry.deref() || null) : entry;
        }

        function forget(mat) {
            for (var i = tracked.length - 1; i >= 0; i--) {
                if (deref(tracked[i]) === mat) tracked.splice(i, 1);
            }
        }

        /**
         * Re-patch every tracked material that has lost the hook, and drop collected entries.
         *
         * This is the answer to material replacement: a runtime that swaps in a fresh
         * `new THREE.MeshStandardMaterial` leaves the old one patched and the new one bare, and
         * nothing errors. Call this once per frame from a post-events tick.
         *
         * @returns {number} how many materials were re-installed this call
         */
        function ensureAll() {
            var repaired = 0;
            for (var i = tracked.length - 1; i >= 0; i--) {
                var mat = deref(tracked[i]);
                if (!mat) { tracked.splice(i, 1); continue; }
                if (isInstalled(mat)) continue;
                if (!activeFor(mat).length) continue;
                if (install(mat)) repaired++;
            }
            return repaired;
        }

        function clearTracked() {
            tracked.length = 0;
        }

        function trackedCount() {
            var n = 0;
            for (var i = 0; i < tracked.length; i++) { if (deref(tracked[i])) n++; }
            return n;
        }

        /* ------------------------------------------------------- Install / uninstall */

        /**
         * Claim onBeforeCompile on this material. Safe to call repeatedly and REQUIRED after any
         * clone, because copy() drops the hook.
         */
        function install(mat) {
            if (!mat) return false;

            mat.onBeforeCompile = function (shader) {
                var active = activeFor(mat);
                var landed = [];
                for (var i = 0; i < active.length; i++) {
                    try {
                        active[i].inject(shader, mat);
                        landed.push(active[i].id);
                    } catch (e) {
                        // One bad injector must not cost the others their edits.
                        console.warn('[Material3D] shader injector "' + active[i].id + '" failed: ' + e.message);
                    }
                }
                // Diagnostic surface. GDevelop 3D shader work fails silently, so record what
                // actually ran and what the compiler actually received.
                mat.__m3dInjected = landed;
                mat.__m3dCompiledAt = (typeof performance !== 'undefined' && performance.now)
                    ? performance.now() : 0;
            };

            // Three.js reuses one compiled program across materials with equal cache keys. Two
            // materials with different injectors active generate different source, so the key must
            // distinguish them or one will silently render with the other's shader.
            mat.customProgramCacheKey = function () {
                var active = activeFor(mat);
                var k = 'M3D';
                for (var i = 0; i < active.length; i++) {
                    var frag;
                    try { frag = active[i].key(mat); } catch (e) { frag = '?'; }
                    k += '|' + active[i].id + ':' + frag;
                }
                return k;
            };

            mat.__m3dChainInstalled = true;
            mat.needsUpdate = true;
            track(mat);
            return true;
        }

        /**
         * Release the hook and stop tracking. Use on teardown instead of assigning a no-op
         * onBeforeCompile directly, so the material leaves the tracked list too.
         */
        function uninstall(mat) {
            if (!mat) return false;
            mat.onBeforeCompile = function () {};
            mat.customProgramCacheKey = function () { return ''; };
            mat.__m3dChainInstalled = false;
            mat.__m3dInjected = null;
            forget(mat);
            mat.needsUpdate = true;
            return true;
        }

        function isInstalled(mat) {
            return !!(mat && mat.__m3dChainInstalled === true && typeof mat.onBeforeCompile === 'function');
        }

        /** Re-install on a material that lost the hook to a clone. Returns true if it acted. */
        function ensure(mat) {
            if (!mat) return false;
            if (isInstalled(mat)) return false;
            if (!activeFor(mat).length) return false;
            return install(mat);
        }

        /** Which injector ids actually ran at the last compile. Empty until the material renders. */
        function injectedIds(mat) {
            return (mat && mat.__m3dInjected) ? mat.__m3dInjected.slice() : [];
        }

        function hasInjector(mat, id) {
            return injectedIds(mat).indexOf(id) >= 0;
        }

        /** Ids registered globally, whether or not active on any material. */
        function registeredIds() {
            return injectors.map(function (i) { return i.id; });
        }

        return {
            VERSION: CHAIN_VERSION,
            register: register,
            unregister: unregister,
            install: install,
            uninstall: uninstall,
            ensure: ensure,
            ensureAll: ensureAll,
            isInstalled: isInstalled,
            injectedIds: injectedIds,
            hasInjector: hasInjector,
            registeredIds: registeredIds,
            activeFor: activeFor,
            clearTracked: clearTracked,
            trackedCount: trackedCount,
        };
    })();

    // An upgrade inherits materials patched by the previous copy. Their hooks still close over the
    // OLD module's activeFor, so they must be re-installed against this one or they will never see
    // injectors registered from here on.
    //
    // ensureAll() is the wrong tool here: those materials still report __m3dChainInstalled === true,
    // so it would skip every one of them. Re-install unconditionally instead.
    //
    // For a v1 predecessor `tracked` is empty — v1 kept no material list — which is the other half
    // of the unmigratable-registry warning above.
    if (previous && tracked.length) {
        var stale = tracked.slice();
        for (var t = 0; t < stale.length; t++) {
            var m = (HAS_WEAKREF && stale[t] instanceof WeakRef) ? stale[t].deref() : stale[t];
            if (m) gdjs.__m3dShaderChain.install(m);
        }
    }
})();
