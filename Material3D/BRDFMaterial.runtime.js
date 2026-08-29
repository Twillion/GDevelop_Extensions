if (!gdjs.__brdfMaterial3D) {
  gdjs.__brdfMaterial3D = (function () {

    var MODE_INT = {
      'lambert': 0, 'burley': 1, 'oren-nayar': 2,
      'minnaert': 3, 'toon': 4, 'callisto': 5,
      'half-lambert': 6, 'wrap': 7, 'lommel-seeliger': 8, 'velvet': 9,
      'ashikhmin-shirley': 10, 'fresnel-diffuse': 11, 'kajiya-kay': 12
    };

    var BRDF_UNIFORMS_AND_HELPERS = [
      "",
      "// ── BRDFMaterials v3.1 ────────────────────────────────────────────────",
      "uniform float uBrdfMode;",
      "uniform float uBrdfRoughness;",
      "uniform float uDiffFresnel;",
      "uniform float uDiffFresnelFall;",
      "uniform float uDiffFresnelTanFall;",
      "uniform float uRetroRefl;",
      "uniform float uRetroReflFall;",
      "uniform float uRetroReflTanFall;",
      "uniform float uSmoothTerm;",
      "uniform float uSmoothTermLen;",
      "",
      "float brdf_burley(vec3 N,vec3 L,vec3 V,float r){",
      "  float NoL=max(dot(N,L),0.0);float NoV=max(dot(N,V),0.0);",
      "  vec3 H=normalize(L+V);float LoH=max(dot(L,H),0.0);",
      "  float f=0.5+2.0*r*LoH*LoH;",
      "  float ls=1.0+(f-1.0)*pow(max(1.0-NoL,0.0),5.0);",
      "  float vs=1.0+(f-1.0)*pow(max(1.0-NoV,0.0),5.0);",
      "  return ls*vs*NoL*RECIPROCAL_PI;",
      "}",
      "float brdf_orenNayar(vec3 N,vec3 L,vec3 V,float r){",
      "  float NoL=max(dot(N,L),0.0);float NoV=max(dot(N,V),0.0);",
      "  vec3 Lp=L-N*dot(L,N);vec3 Vp=V-N*dot(V,N);",
      "  float lL=length(Lp);float lV=length(Vp);",
      "  float cp=(lL>1e-5&&lV>1e-5)?max(0.0,dot(Lp/lL,Vp/lV)):0.0;",
      "  float a=acos(clamp(NoL,0.0,1.0));float b=acos(clamp(NoV,0.0,1.0));",
      "  float s2=r*r;",
      "  float A=1.0-0.5*(s2/(s2+0.33));float B=0.45*(s2/(s2+0.09));",
      "  return NoL*(A+B*cp*sin(max(a,b))*tan(min(a,b)))*RECIPROCAL_PI;",
      "}",
      "float brdf_minnaert(vec3 N,vec3 L,vec3 V,float r){",
      "  float NoL=max(dot(N,L),0.001);float NoV=max(dot(N,V),0.001);",
      "  return NoL*pow(NoL*NoV,1.0-r)*RECIPROCAL_PI;",
      "}",
      "float brdf_toon(vec3 N,vec3 L,float r){",
      "  float NoL=max(dot(N,L),0.0);float bands=mix(2.0,8.0,r);",
      "  return (floor(NoL*bands)/bands)*RECIPROCAL_PI;",
      "}",
      "float brdf_rR(float x){return 2.0*(1.0-x);}",
      "float brdf_hF(float cT,float n,float cP,float m){",
      "  return pow(max(1.0-cT,0.0),5.0*n)*pow(max(cP,0.0),5.0*m);",
      "}",
      "float brdf_callisto(vec3 N,vec3 L,vec3 V,float rF,float nf,float mf,float rR,float nr,float mr,float o,float p){",
      "  float NoL=max(dot(N,L),0.0);",
      "  vec3 H=normalize(L+V);",
      "  float cTh=max(dot(N,H),0.0);float cTd=max(dot(L,H),0.0);",
      "  float aF=brdf_hF(cTd,brdf_rR(nf),cTh,brdf_rR(mf));",
      "  float aR=brdf_hF(cTh,brdf_rR(nr),cTd,brdf_rR(mr));",
      "  float c1=mix(1.0,rF,aF)*mix(1.0,rR,aR);",
      "  float as_=1.0-pow(max(1.0-cTh,0.0),3.0);",
      "  float pp=max(p,0.001);",
      "  float c2=mix(1.0,smoothstep(0.0,pp,NoL),-clamp(o,-1.0,1.0)*as_);",
      "  return c1*NoL*c2*RECIPROCAL_PI;",
      "}",
      "float brdf_halfLambert(vec3 N,vec3 L){",
      "  float h=dot(N,L)*0.5+0.5;return h*h*RECIPROCAL_PI;",
      "}",
      "float brdf_wrap(vec3 N,vec3 L,float r){",
      "  float w=r;float d=max((dot(N,L)+w)/((1.0+w)*(1.0+w)),0.0);return d*RECIPROCAL_PI;",
      "}",
      "float brdf_lommelSeeliger(vec3 N,vec3 L,vec3 V){",
      "  float NoL=max(dot(N,L),0.0);float NoV=max(dot(N,V),0.0);",
      "  return 0.5*NoL/max(NoL+NoV,1e-4);",
      "}",
      "float brdf_velvet(vec3 N,vec3 L,vec3 V,float r){",
      "  float NoL=max(dot(N,L),0.0);float NoV=max(dot(N,V),0.0);",
      "  float sheen=pow(max(1.0-NoV,0.0),mix(8.0,1.5,r));",
      "  return (NoL+sheen)*0.5*RECIPROCAL_PI;",
      "}",
      "float brdf_ashikhmin(vec3 N,vec3 L,vec3 V){",
      "  float NoL=max(dot(N,L),0.0);float NoV=max(dot(N,V),0.0);",
      "  float Rs=0.04;float f=(28.0/(23.0*PI))*(1.0-Rs);",
      "  float a=1.0-pow(1.0-0.5*NoL,5.0);float b=1.0-pow(1.0-0.5*NoV,5.0);",
      "  return f*a*b*NoL;",
      "}",
      "float brdf_fresnelDiffuse(vec3 N,vec3 L,vec3 V){",
      "  float NoL=max(dot(N,L),0.0);float NoV=max(dot(N,V),0.0);",
      "  float F=0.04+0.96*pow(max(1.0-NoV,0.0),5.0);",
      "  return NoL*(1.0-F)*RECIPROCAL_PI;",
      "}",
      "float brdf_kajiyaKay(vec3 N,vec3 L,float r){",
      "  vec3 up=normalize((viewMatrix*vec4(0.0,1.0,0.0,0.0)).xyz);",
      "  vec3 T=cross(N,up);float tl=length(T);",
      "  T=(tl>1e-4)?T/tl:normalize(cross(N,normalize((viewMatrix*vec4(1.0,0.0,0.0,0.0)).xyz)));",
      "  float ToL=dot(T,L);float dd=sqrt(max(1.0-ToL*ToL,0.0));",
      "  dd=pow(dd,mix(1.0,4.0,r));return dd*RECIPROCAL_PI;",
      "}",
      "vec3 brdfCustom(const in vec3 diffuseColor, const in vec3 N, const in vec3 L, const in vec3 V){",
      "  int mode=int(uBrdfMode+0.5);",
      "  float d;",
      "  if(mode==1)      d=brdf_burley(N,L,V,uBrdfRoughness);",
      "  else if(mode==2) d=brdf_orenNayar(N,L,V,uBrdfRoughness);",
      "  else if(mode==3) d=brdf_minnaert(N,L,V,uBrdfRoughness);",
      "  else if(mode==4) d=brdf_toon(N,L,uBrdfRoughness);",
      "  else if(mode==5) d=brdf_callisto(N,L,V,uDiffFresnel,uDiffFresnelFall,uDiffFresnelTanFall,uRetroRefl,uRetroReflFall,uRetroReflTanFall,uSmoothTerm,uSmoothTermLen);",
      "  else if(mode==6)  d=brdf_halfLambert(N,L);",
      "  else if(mode==7)  d=brdf_wrap(N,L,uBrdfRoughness);",
      "  else if(mode==8)  d=brdf_lommelSeeliger(N,L,V);",
      "  else if(mode==9)  d=brdf_velvet(N,L,V,uBrdfRoughness);",
      "  else if(mode==10) d=brdf_ashikhmin(N,L,V);",
      "  else if(mode==11) d=brdf_fresnelDiffuse(N,L,V);",
      "  else if(mode==12) d=brdf_kajiyaKay(N,L,uBrdfRoughness);",
      "  else d=max(dot(N,L),0.0)*RECIPROCAL_PI;",
      "  return diffuseColor*d;",
      "}",
      "// ─────────────────────────────────────────────────────────────────────"
    ].join("\n");

    function makeUniforms(p) {
      return {
        uBrdfMode:            { value: parseFloat(MODE_INT[(p.mode||'lambert').toLowerCase()]) || 0 },
        uBrdfRoughness:       { value: p.roughness },
        uDiffFresnel:         { value: p.diffuseFresnel },
        uDiffFresnelFall:     { value: p.diffuseFresnelFalloff },
        uDiffFresnelTanFall:  { value: p.diffuseFresnelTangentFalloff },
        uRetroRefl:           { value: p.retroReflection },
        uRetroReflFall:       { value: p.retroReflectionFalloff },
        uRetroReflTanFall:    { value: p.retroReflectionTangentFalloff },
        uSmoothTerm:          { value: p.smoothTerminator },
        uSmoothTermLen:       { value: p.smoothTerminatorLength }
      };
    }

    function syncUniforms(u, p) {
      var modeKey = (p.mode || 'lambert').toLowerCase();
      u.uBrdfMode.value           = parseFloat(MODE_INT[modeKey] !== undefined ? MODE_INT[modeKey] : 0);
      u.uBrdfRoughness.value      = p.roughness;
      u.uDiffFresnel.value        = p.diffuseFresnel;
      u.uDiffFresnelFall.value    = p.diffuseFresnelFalloff;
      u.uDiffFresnelTanFall.value = p.diffuseFresnelTangentFalloff;
      u.uRetroRefl.value          = p.retroReflection;
      u.uRetroReflFall.value      = p.retroReflectionFalloff;
      u.uRetroReflTanFall.value   = p.retroReflectionTangentFalloff;
      u.uSmoothTerm.value         = p.smoothTerminator;
      u.uSmoothTermLen.value      = p.smoothTerminatorLength;
    }

    // The patch markers live as DIRECT properties on the material, never in userData.
    //
    // Three.js Material.copy() does `this.userData = JSON.parse(JSON.stringify(source.userData))`.
    // Anything stored in userData is therefore JSON round-tripped on clone: a Material kept there
    // comes back as a plain object with no .clone(), which threw "src.clone is not a function" the
    // moment anything cloned a patched material. copy() also does NOT carry onBeforeCompile, so a
    // clone that inherited a userData "patched" flag claimed to be patched while rendering
    // unpatched — a silent revert.
    //
    // Direct properties are not touched by copy(), so a clone reads as unpatched, which is the
    // truth: it has no hook. It then gets patched fresh.
    function patchMaterial(mat, uniforms) {
      mat.__brdfPatched  = true;
      mat.__brdfUniforms = uniforms;
      // Mirrored into userData for inspection only. Never read back as an object.
      mat.userData.__brdfPatched = true;

      mat.onBeforeCompile = function (shader) {
        Object.assign(shader.uniforms, uniforms);

        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <common>',
          '#include <common>\n' + BRDF_UNIFORMS_AND_HELPERS
        );

        var physChunk = THREE.ShaderChunk['lights_physical_pars_fragment'];
        if (physChunk) {
          var patched = physChunk.replace(
            /(void\s+RE_Direct_Physical[\s\S]*?)(?=void\s+RE_IndirectDiffuse_Physical|$)/,
            function(match) {
              return match.replace(
                /BRDF_Lambert\s*\(\s*material\.diffuseColor\s*\)/g,
                'brdfCustom(material.diffuseColor, geometryNormal, directLight.direction, geometryViewDir)'
              );
            }
          );
          shader.fragmentShader = shader.fragmentShader.replace(
            '#include <lights_physical_pars_fragment>',
            patched
          );
        }
      };

      mat.customProgramCacheKey = function () {
        return 'brdf3.1-' + String(uniforms.uBrdfMode.value);
      };
      mat.needsUpdate = true;
    }

    function getThreeObject(object) {
      if (!object) return null;
      if (typeof object.get3DRendererObject === 'function') {
        var o = object.get3DRendererObject();
        if (o) return o;
      }
      var r = object.getRenderer ? object.getRenderer() : null;
      if (r) {
        if (typeof r.get3DRendererObject === 'function') {
          var o2 = r.get3DRendererObject();
          if (o2) return o2;
        }
        if (r._threeObject) return r._threeObject;
        if (r.object3D)     return r.object3D;
      }
      return null;
    }

    function readParams(behavior) {
      return {
        mode:                         behavior._getBRDFModel(),
        r:                            behavior._getColorR(),
        g:                            behavior._getColorG(),
        b:                            behavior._getColorB(),
        roughness:                    behavior._getRoughness(),
        diffuseFresnel:               behavior._getDiffuseFresnel(),
        diffuseFresnelFalloff:        behavior._getDiffuseFresnelFalloff(),
        diffuseFresnelTangentFalloff: behavior._getDiffuseFresnelTangentFalloff(),
        retroReflection:              behavior._getRetroReflection(),
        retroReflectionFalloff:       behavior._getRetroReflectionFalloff(),
        retroReflectionTangentFalloff:behavior._getRetroReflectionTangentFalloff(),
        smoothTerminator:             behavior._getSmoothTerminator(),
        smoothTerminatorLength:       behavior._getSmoothTerminatorLength()
      };
    }

    function apply(object, p) {
      var root = getThreeObject(object);
      if (!root) return;
      var uniforms = makeUniforms(p);

      root.traverse(function (child) {
        if (!child.isMesh || !child.geometry) return;
        var existing = child.material;
        if (!existing) return;
        var mats = Array.isArray(existing) ? existing : [existing];
        var result = mats.map(function (m) {
          if (m.__brdfPatched) {
            m.onBeforeCompile = function(){};
            m.needsUpdate = true;
          }
          // Re-derive from the unpatched source when this material is one we patched, so
          // repeated applies do not stack patch on patch. The typeof guard is the backstop for
          // a reference that came through a userData JSON round-trip in older saved data.
          var prev = m.__brdfOriginalRef;
          var src = (prev && typeof prev.clone === 'function') ? prev : m;
          if (typeof src.clone !== 'function') return m;
          var clone = src.clone();
          clone.__brdfOriginalRef = src;
          patchMaterial(clone, uniforms);
          return clone;
        });
        child.material = Array.isArray(existing) ? result : result[0];
      });

      if (!root.userData.__brdf) root.userData.__brdf = {};
      root.userData.__brdf.uniforms = uniforms;
      root.userData.__brdf.mode     = (p.mode || 'lambert').toLowerCase();
      // Kept so the patch can be rebuilt without the behavior in hand — Material3D calls
      // reapplyIfPatched() after it swaps materials, and has no BRDF behavior reference.
      root.userData.__brdf.params   = p;
    }

    // Material3D replaces mesh.material outright. That discards the patched clone this module
    // installed, and the surface silently reverts to the stock Three.js Lambert diffuse with no
    // error anywhere. Material3D calls this immediately after it applies, so the patch is
    // rebuilt on top of the new material rather than lost.
    function reapplyIfPatched(object) {
      var root = getThreeObject(object);
      if (!root || !root.userData.__brdf || !root.userData.__brdf.params) return false;
      apply(object, root.userData.__brdf.params);
      return true;
    }

    function updateUniforms(object, p) {
      var root = getThreeObject(object);
      if (!root || !root.userData.__brdf) { apply(object, p); return; }
      var newMode = (p.mode || 'lambert').toLowerCase();
      if (root.userData.__brdf.mode !== newMode) { apply(object, p); return; }
      syncUniforms(root.userData.__brdf.uniforms, p);
    }

    function dispose(object) {
      var root = getThreeObject(object);
      if (!root) return;
      root.traverse(function (child) {
        if (!child.isMesh) return;
        var m = child.material;
        if (!m) return;
        var mats = Array.isArray(m) ? m : [m];
        mats.forEach(function (mat) {
          if (mat.__brdfPatched) {
            var orig = mat.__brdfOriginalRef;
            if (orig && typeof orig.clone === 'function') {
              var arr = Array.isArray(child.material);
              if (arr) {
                child.material = child.material.map(function(x){ return x===mat?orig:x; });
              } else if (child.material === mat) {
                child.material = orig;
              }
            }
            mat.dispose();
          }
        });
      });
      if (root.userData.__brdf) root.userData.__brdf = null;
    }

    return { apply:apply, updateUniforms:updateUniforms, dispose:dispose,
             readParams:readParams, getThreeObject:getThreeObject,
             reapplyIfPatched:reapplyIfPatched };
  })();
}
