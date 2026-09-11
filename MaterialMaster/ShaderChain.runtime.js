// ShaderChain.runtime.js — the single owner of onBeforeCompile for Material3D materials.
//
// WHY THIS EXISTS
//
// `material.onBeforeCompile` is one function property, not a list. Two behaviors that both assign
// it do not compose — whichever assigns last silently wins, and the loser's shader edits never
// appear. No error, no warning, just a plausible-looking surface missing half its features.
//
// Material 3D and BRDF Material both need to edit the compiled shader, and the planned v3.5 modules
// (parallax occlusion, subsurface scattering, triplanar, detail normals, wetness) each need it too.
// So nobody assigns the hook directly. Injectors register here, and this module owns the one hook
// and runs them in a declared order.
//
// CLONE SAFETY
//
// THREE.Material.copy() carries neither `onBeforeCompile` nor `customProgramCacheKey`, and it JSON
// round-trips `userData` — so anything stored there loses its prototype. Material 3D clones
// materials routinely. Therefore: all chain state lives on DIRECT material properties, and
// install() must be re-run on every clone. `isInstalled()` is how a caller checks.
//
// This file is embedded in both behaviors' runtimes and self-guards, so load order does not matter.

if (typeof THREE !== 'undefined' && !gdjs.__m3dShaderChain) {
    gdjs.__m3dShaderChain = (function () {

        // ORDER BANDS — where a new module slots in.
        //
        // Ordered low to high, and the principle is layering, not shader execution order: the
        // BASE decides how the surface responds to light, and everything after it modifies the
        // inputs that response is computed from. A module registering in a later band can assume
        // the earlier bands are already in place and integrate with them.
        //
        //   100-199  BASE SHADING     the lighting model itself           — brdf
        //   200-399  UV SYNTHESIS     what texture coordinates are used   — triplanar, parallax
        //   400-599  SURFACE INPUTS   normals, roughness, albedo          — detail normals, ripples
        //   600-799  LIGHTING ADD-ONS extra light response                — subsurface scattering
        //   800-999  OVERRIDES        anything that must have the last word
        //
        // Two injectors in the same band editing the same chunk is allowed but must be deliberate;
        // the build prints a note when it sees a chunk claimed twice.
        var injectors = [];

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

        function activeFor(mat) {
            var out = [];
            for (var i = 0; i < injectors.length; i++) {
                var inj = injectors[i];
                try { if (inj.isActive(mat)) out.push(inj); } catch (e) {}
            }
            return out;
        }

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
            register: register,
            install: install,
            ensure: ensure,
            isInstalled: isInstalled,
            injectedIds: injectedIds,
            hasInjector: hasInjector,
            registeredIds: registeredIds,
            activeFor: activeFor,
        };
    })();
}
