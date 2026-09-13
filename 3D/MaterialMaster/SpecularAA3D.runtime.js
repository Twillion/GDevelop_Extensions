// SpecularAA3D.runtime.js — geometric specular anti-aliasing (Tokuyoshi & Kaplanyan 2019).
//
// Phase 2 of docs/RENDERER-MODERNIZATION-PLAN.md. This is a SHADER-LEVEL filter, not a surface
// property, so it deliberately does not go through the Material 3D Core contributor negotiation:
// it never writes a material field, it only rewrites how roughness is derived inside the lighting
// stage. It registers one ShaderChain injector in the 600-799 LIGHTING ADD-ONS band.
//
// WHAT IT REPLACES. Three r160 already filters, in `lights_physical_fragment`:
//
//     vec3 dxy = max( abs( dFdx( nonPerturbedNormal ) ), abs( dFdy( nonPerturbedNormal ) ) );
//     float geometryRoughness = max( max( dxy.x, dxy.y ), dxy.z );
//     material.roughness += geometryRoughness;
//
// That is a Vlachos-style empirical clamp, added in the PERCEPTUAL roughness domain, computed from
// the GEOMETRIC normal. T&K filters in the alpha-squared domain from the SHADING normal. The two
// terms live in different domains and cannot be combined with max() — so this REPLACES the additive
// term rather than stacking onto it.
//
// THE CLEARCOAT COUPLING. `geometryRoughness` is computed once and applied TWICE in r160: to
// material.roughness and, under USE_CLEARCOAT, to material.clearcoatRoughness. Replacing only the
// first would silently delete clearcoat roughness filtering and bring back sparkle on every
// clearcoated surface - a regression in a feature this injector was never meant to touch. Both are
// replaced, each through its own full round trip.
//
// WHAT IT DOES NOT FIX, from the paper's own Limitations section: it addresses only aliasing from
// specular highlights, not from geometric discontinuities; GGX highlights can be overblurred
// because the filtering assumes a Beckmann NDF; and it underfilters at grazing halfvectors.
// Critically, screen-space normal derivatives can only see variance that SURVIVES TO THE PIXEL -
// normal-map detail already destroyed by mip minification is not recoverable this way. That case
// needs Toksvig or LEAN mapping, which bake variance into the mip chain and carry an asset-pipeline
// cost. This is not a general fix for normal-map aliasing.

if (typeof THREE !== 'undefined' && !gdjs.__m3dSpecularAA) {
  gdjs.__m3dSpecularAA = (function () {
    var INJECTOR_ID = 'specular-aa';

    // KAPPA is the clamping threshold stated in the paper. SIGMA2 is the pixel-filter kernel
    // variance; the paper does NOT fix a numeric default, so it is a tuning parameter.
    //
    // 0.15 (Filament's value for the same formulation) was the starting point and was MEASURED to
    // fail on this renderer. On plan scene 2 - a metal sphere array with a mipmapped normal map and
    // an orbiting camera, against a 16x supersampled reference - a sigma2 sweep came out strictly
    // monotonic, and every value above about 0.02 made BOTH acceptance metrics worse:
    //
    //     sigma2   temporal   RMSE    SSIM
    //     stock     6.524    20.55   0.7315     <- Three's own geometryRoughness
    //     0.00      5.711    16.96   0.8115     <- best on every metric
    //     0.02      6.011    20.36   0.7938     <- last value still passing both gates
    //     0.15      7.266    27.07   0.6708     <- Filament's default, fails both
    //
    // The striking part is that sigma2 = 0 wins: on this content the improvement comes from
    // REMOVING Three's Vlachos clamp, not from adding T&K filtering on top. Three's term is already
    // over-filtering low-roughness metal.
    //
    // The default is therefore 0.02, the largest measured value that still passes both gates -
    // shipping a value measured to FAIL the plan's own acceptance would be indefensible, and so
    // would silently shipping 0, which would make a feature named "anti-aliasing" add no filtering.
    //
    // CAVEAT, because this is one scene: a supersampled reference structurally favours LESS
    // screen-space filtering, since every screen-space term shrinks as resolution rises. Content
    // with strong pixel-scale curvature may well want more. Raise it per object and measure.
    // See demos/bench/run-sigma-sweep.mjs to re-run this on your own content.
    var DEFAULT_SIGMA2 = 0.02;
    var DEFAULT_KAPPA = 0.18;

    function finite(value, fallback) {
      var n = Number(value);
      return Number.isFinite(n) ? n : fallback;
    }
    function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

    // Eq. 4 / Listing 2, the CONSERVATIVE form - the `2.0 *` is the paper's red code, kept.
    //
    // Eq. 5, the less conservative form, differs only by that factor applied before the kappa
    // clamp, so it is exactly equivalent to halving sigma2. It therefore needs no second code path
    // and no mode switch: set Sigma2 to half its value to get Eq. 5 behaviour.
    var HELPERS = [
      'uniform float uM3DSpecAASigma2;',
      'uniform float uM3DSpecAAKappa;',
      '',
      'float m3dSpecAAKernel2(vec3 n) {',
      '  vec3 dndu = dFdx(n);',
      '  vec3 dndv = dFdy(n);',
      '  float variance = uM3DSpecAASigma2 * (dot(dndu, dndu) + dot(dndv, dndv));',
      '  return min(2.0 * variance, uM3DSpecAAKappa);',
      '}',
      '',
      // Filtering happens in alpha-squared. perceptual r -> alpha = r*r -> alpha^2, filter, then
      // back: alpha = sqrt(alpha2), r = sqrt(alpha). Doing this in the perceptual domain instead is
      // the mistake that makes a naive implementation overblur at low roughness.
      'float m3dSpecAAFilter(float perceptualRoughness, float kernel2) {',
      '  float alpha = perceptualRoughness * perceptualRoughness;',
      '  float filteredAlpha2 = clamp(alpha * alpha + kernel2, 0.0, 1.0);',
      '  return sqrt(sqrt(filteredAlpha2));',
      '}'
    ].join('\n');

    // The exact r160 source being replaced. Matched verbatim: if a Three upgrade changes this text
    // the replace silently does nothing, so the injector verifies the match and throws instead.
    var THREE_ROUGHNESS_TERM = 'material.roughness += geometryRoughness;';
    var THREE_CLEARCOAT_TERM = 'material.clearcoatRoughness += geometryRoughness;';

    function roughnessReplacement(useGeometricFloor) {
      var lines = ['float m3dKernel2 = m3dSpecAAKernel2( normal );'];
      if (useGeometricFloor) {
        // Both kernels live in the alpha-squared domain, so max() between them IS coherent - unlike
        // max() against Three's perceptual-domain term, which is what makes the stock value
        // unusable as a floor.
        lines.push('m3dKernel2 = max( m3dKernel2, m3dSpecAAKernel2( nonPerturbedNormal ) );');
      }
      lines.push('material.roughness = m3dSpecAAFilter( material.roughness, m3dKernel2 );');
      return lines.join('\n');
    }

    function clearcoatReplacement(useGeometricFloor) {
      // Clearcoat is a separate lobe with its own roughness, so it needs its own full round trip
      // rather than sharing the base layer's filtered value.
      var lines = ['float m3dCcKernel2 = m3dSpecAAKernel2( normal );'];
      if (useGeometricFloor) {
        lines.push('m3dCcKernel2 = max( m3dCcKernel2, m3dSpecAAKernel2( nonPerturbedNormal ) );');
      }
      lines.push('material.clearcoatRoughness = m3dSpecAAFilter( material.clearcoatRoughness, m3dCcKernel2 );');
      return lines.join('\n');
    }

    /**
     * Apply both replacements to a copy of the chunk body.
     * Returns null if the expected text is not there, so callers can report rather than guess.
     */
    function patchChunk(chunk, useGeometricFloor) {
      if (!chunk || chunk.indexOf(THREE_ROUGHNESS_TERM) < 0) return null;
      var out = chunk.replace(THREE_ROUGHNESS_TERM, roughnessReplacement(useGeometricFloor));
      // Clearcoat only exists when the material declares it, and the chunk carries it inside an
      // #ifdef USE_CLEARCOAT. Patching it unconditionally is correct: the preprocessor drops the
      // whole block for materials without clearcoat.
      if (out.indexOf(THREE_CLEARCOAT_TERM) >= 0) {
        out = out.replace(THREE_CLEARCOAT_TERM, clearcoatReplacement(useGeometricFloor));
      }
      return out;
    }

    function settingsOf(mat) {
      return mat && mat.__m3dSpecAA;
    }

    function ensureUniforms(mat) {
      var s = settingsOf(mat);
      if (!s) return null;
      if (!s.uniforms) {
        s.uniforms = {
          uM3DSpecAASigma2: { value: DEFAULT_SIGMA2 },
          uM3DSpecAAKappa: { value: DEFAULT_KAPPA }
        };
      }
      s.uniforms.uM3DSpecAASigma2.value = s.sigma2;
      s.uniforms.uM3DSpecAAKappa.value = s.kappa;
      return s.uniforms;
    }

    /**
     * Enable or update specular AA on one material.
     * Returns true if the material can carry it at all.
     */
    function applyToMaterial(mat, options) {
      if (!mat) return false;
      // MeshBasicMaterial has no lighting stage, so there is nothing to filter. Say so rather than
      // registering an injector that will throw on every compile.
      if (mat.isMeshBasicMaterial || !mat.isMeshStandardMaterial) return false;

      options = options || {};
      var existing = mat.__m3dSpecAA;
      var next = {
        enabled: options.enabled !== undefined ? !!options.enabled : (existing ? existing.enabled : true),
        sigma2: clamp(finite(options.sigma2, existing ? existing.sigma2 : DEFAULT_SIGMA2), 0.0, 4.0),
        kappa: clamp(finite(options.kappa, existing ? existing.kappa : DEFAULT_KAPPA), 0.0, 1.0),
        geometricFloor: options.geometricFloor !== undefined
          ? !!options.geometricFloor
          : (existing ? existing.geometricFloor : false),
        uniforms: existing ? existing.uniforms : null
      };

      // Only the flags that change GENERATED SOURCE may force a recompile. sigma2 and kappa are
      // uniforms, so changing them must NOT change the key - otherwise every tweak of a slider
      // rebuilds the program.
      var sourceChanged = !existing ||
        existing.enabled !== next.enabled ||
        existing.geometricFloor !== next.geometricFloor;

      mat.__m3dSpecAA = next;
      ensureUniforms(mat);

      if (gdjs.__m3dShaderChain && !mat.__m3dChainInstalled) {
        gdjs.__m3dShaderChain.install(mat);
      }
      if (sourceChanged) mat.needsUpdate = true;
      return true;
    }

    function removeFromMaterial(mat) {
      if (!mat || !mat.__m3dSpecAA) return;
      mat.__m3dSpecAA = null;
      mat.needsUpdate = true;
    }

    function eachMaterial(root, fn) {
      if (!root || !root.traverse) return 0;
      var count = 0;
      root.traverse(function (node) {
        if (!node.isMesh || !node.material) return;
        var mats = Array.isArray(node.material) ? node.material : [node.material];
        for (var i = 0; i < mats.length; i++) { if (fn(mats[i])) count++; }
      });
      return count;
    }

    function applyToObject(object, options) {
      if (!object || typeof object.get3DRendererObject !== 'function') return 0;
      var root = null;
      try { root = object.get3DRendererObject(); } catch (e) { root = null; }
      return eachMaterial(root, function (mat) { return applyToMaterial(mat, options); });
    }

    function removeFromObject(object) {
      if (!object || typeof object.get3DRendererObject !== 'function') return;
      var root = null;
      try { root = object.get3DRendererObject(); } catch (e) { root = null; }
      eachMaterial(root, function (mat) { removeFromMaterial(mat); return false; });
    }

    if (gdjs.__m3dShaderChain) {
      gdjs.__m3dShaderChain.register({
        id: INJECTOR_ID,
        chunk: 'lights_physical_fragment',
        order: 650,
        isActive: function (mat) {
          var s = settingsOf(mat);
          return !!(s && s.enabled);
        },
        key: function (mat) {
          var s = settingsOf(mat);
          // Source-affecting flags only. sigma2/kappa are uniforms and must not appear here.
          return s.geometricFloor ? 'floor' : 'plain';
        },
        inject: function (shader, mat) {
          var s = settingsOf(mat);
          Object.assign(shader.uniforms, ensureUniforms(mat));

          shader.fragmentShader = shader.fragmentShader.replace(
            '#include <common>', '#include <common>\n' + HELPERS);

          // THE SOURCE IS NOT RESOLVED YET.
          //
          // Three calls onBeforeCompile BEFORE resolveIncludes, so at this point the fragment
          // shader still contains the literal directive `#include <lights_physical_fragment>` and
          // NOT the chunk body. Searching for the chunk's text here finds nothing, the edit
          // silently does nothing, and the surface renders exactly as if the feature were off —
          // which is indistinguishable from it being on and having no effect.
          //
          // So expand the chunk ourselves, patch the expansion, and substitute it for the
          // directive. The already-resolved form is still handled as a fallback, because tests and
          // other injectors may hand over source that has been expanded already.
          var patched = patchChunk(THREE.ShaderChunk.lights_physical_fragment, s.geometricFloor);
          var directive = '#include <lights_physical_fragment>';

          if (patched && shader.fragmentShader.indexOf(directive) >= 0) {
            shader.fragmentShader = shader.fragmentShader.replace(directive, patched);
          } else if (shader.fragmentShader.indexOf(THREE_ROUGHNESS_TERM) >= 0) {
            shader.fragmentShader = shader.fragmentShader.replace(
              THREE_ROUGHNESS_TERM, roughnessReplacement(s.geometricFloor));
            if (shader.fragmentShader.indexOf(THREE_CLEARCOAT_TERM) >= 0) {
              shader.fragmentShader = shader.fragmentShader.replace(
                THREE_CLEARCOAT_TERM, clearcoatReplacement(s.geometricFloor));
            }
          } else {
            // Either the material is unlit, or a Three upgrade changed the chunk. Both must be
            // loud: a silent no-op here looks exactly like "specular AA is on and doing nothing".
            throw new Error(
              'no physical lighting stage to filter. Either this material is unlit (set Material ' +
              'class to Standard or Physical), or the bundled Three.js version changed the ' +
              'lights_physical_fragment chunk and this injector needs updating.');
          }
        }
      });
    }

    return {
      DEFAULT_SIGMA2: DEFAULT_SIGMA2,
      DEFAULT_KAPPA: DEFAULT_KAPPA,
      applyToMaterial: applyToMaterial,
      removeFromMaterial: removeFromMaterial,
      applyToObject: applyToObject,
      removeFromObject: removeFromObject,
      settingsOf: settingsOf,
      __helpers: HELPERS,
      __roughnessTerm: THREE_ROUGHNESS_TERM,
      __clearcoatTerm: THREE_CLEARCOAT_TERM
    };
  })();
}
