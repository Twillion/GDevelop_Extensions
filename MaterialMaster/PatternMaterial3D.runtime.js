// PatternMaterial3D.runtime.js — procedural pattern recipe contributor for Material 3D Core.
if (typeof THREE !== 'undefined' && !gdjs.__patternMaterial3D) {
  gdjs.__patternMaterial3D = (function () {
    var MODES = {
      Solid: 0,
      Grid: 1,
      Brick: 2,
      Checker: 3,
      Stripes: 4,
      Dots: 5,
      Hexagons: 6,
      Voronoi: 7,
      Herringbone: 8,
      Basketweave: 9,
      WoodPlanks: 10
    };
    var GLSL = [
      'varying vec2 vM3DPatternUv;',
      'varying vec3 vM3DPatternNormal;',
      'uniform float uM3DPatternMode,uM3DPatternSeed,uM3DPatternGap,uM3DPatternSoftness,uM3DPatternVariation,uM3DPatternNoiseScale,uM3DPatternNoiseStrength,uM3DPatternStrength,uM3DPatternOverwriteTexture,uM3DPatternAutoTiling,uM3DPatternRotation;',
      'uniform vec2 uM3DPatternScale;',
      'uniform vec3 uM3DPatternObjectScale;',
      'uniform vec3 uM3DPatternPrimary,uM3DPatternSecondary,uM3DPatternBorder,uM3DPatternOverlayColor;',
      'uniform float uM3DPatternSaturation;',
      'uniform float uM3DPatternRoughPrimary,uM3DPatternRoughBorder,uM3DPatternMetalness;',
      'struct M3DPatternResult{vec3 color;float roughness;float metalness;float height;};',
      'M3DPatternResult m3dPatternResult;',
      'float m3dHash(vec2 p){vec3 p3=fract(vec3(p.xyx)*0.1031+uM3DPatternSeed*0.017);p3+=dot(p3,p3.yzx+33.33);return fract((p3.x+p3.y)*p3.z);}',
      'float m3dNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(m3dHash(i),m3dHash(i+vec2(1.,0.)),f.x),mix(m3dHash(i+vec2(0.,1.)),m3dHash(i+vec2(1.,1.)),f.x),f.y);}',
      'float m3dVoronoi(vec2 p){vec2 i=floor(p),f=fract(p);float d1=8.,d2=8.;for(int y=-1;y<=1;y++){for(int x=-1;x<=1;x++){vec2 g=vec2(float(x),float(y));vec2 q=g+vec2(m3dHash(i+g),m3dHash(i+g+19.3))-f;float d=dot(q,q);if(d<d1){d2=d1;d1=d;}else if(d<d2){d2=d;}}}return(sqrt(d2)-sqrt(d1))*0.5;}',
      'float m3dBoxSDF(vec2 p,vec2 b,float r){r=min(r,min(b.x,b.y));vec2 q=abs(p)-b+vec2(r);return min(max(q.x,q.y),0.0)+length(max(q,0.0))-r;}',
      'float m3dHexSDF(vec2 p,float r){vec3 k=vec3(-0.866025404,0.5,0.577350269);p=abs(p);float d=dot(k.xy,p);if(d<0.0)p-=2.0*d*k.xy;p-=vec2(clamp(p.x,-k.z*r,k.z*r),r);return(p.y>0.0?1.0:-1.0)*length(p);}',
      'M3DPatternResult m3dPattern(vec2 uv){',
      'vec2 aspect=vec2(1.);',
      'if(uM3DPatternAutoTiling>0.5){vec3 nAbs=abs(vM3DPatternNormal);if(nAbs.z>=nAbs.x&&nAbs.z>=nAbs.y)aspect=uM3DPatternObjectScale.xy;else if(nAbs.x>=nAbs.y)aspect=uM3DPatternObjectScale.zy;else aspect=uM3DPatternObjectScale.xz;}',
      'vec2 p=uv;',
      'if(abs(uM3DPatternRotation)>0.001){float cR=cos(uM3DPatternRotation),sR=sin(uM3DPatternRotation);p=mat2(cR,sR,-sR,cR)*(p-0.5)+0.5;}',
      'p=p*uM3DPatternScale*aspect;vec2 cell=floor(p);float d=1.0;int mode=int(uM3DPatternMode+.5);',
      'if(mode==1){vec2 lp=fract(p)-0.5;vec2 bs=vec2(0.5-uM3DPatternGap*0.5);d=m3dBoxSDF(lp,bs,min(bs.y*0.12,uM3DPatternGap*0.35));}',
      'else if(mode==2){float asp=2.85;vec2 pB=vec2(p.x/asp,p.y);float row=floor(pB.y);pB.x+=mod(row,2.0)*0.5;cell=floor(pB);vec2 lp=vec2((fract(pB.x)-0.5)*asp,fract(pB.y)-0.5);vec2 bs=vec2(0.5*asp-uM3DPatternGap*0.5,0.5-uM3DPatternGap*0.5);d=m3dBoxSDF(lp,bs,min(min(bs.x,bs.y)*0.2,uM3DPatternGap*0.4));}',
      'else if(mode==3){vec2 lp=fract(p)-0.5;vec2 bs=vec2(0.5-uM3DPatternGap*0.5);d=m3dBoxSDF(lp,bs,0.01);}',
      'else if(mode==4){cell=vec2(0.0,floor(p.y));d=abs(fract(p.y)-0.5)-(0.5-uM3DPatternGap*0.5);}',
      'else if(mode==5){vec2 lp=fract(p)-0.5;d=length(lp)-(0.5-uM3DPatternGap*0.5);}',
      'else if(mode==6){float hs=0.866025404;float hy=p.y/hs;float hr=floor(hy);float hx=p.x+mod(hr,2.0)*0.5;cell=vec2(floor(hx),hr);vec2 lp=vec2(fract(hx)-0.5,(fract(hy)-0.5)*hs);d=m3dHexSDF(lp,0.5-uM3DPatternGap*0.5);}',
      'else if(mode==7){d=uM3DPatternGap-m3dVoronoi(p);}',
      'else if(mode==8){vec2 hp=vec2((p.x+p.y)*0.5,(p.y-p.x)*0.5);cell=floor(hp);d=m3dBoxSDF(fract(hp)-0.5,vec2(0.5-uM3DPatternGap*0.5),0.02);}',
      'else if(mode==9){vec2 bp=p*0.5;vec2 bc=floor(bp);float isV=mod(bc.x+bc.y,2.0);vec2 sb=fract(bp);if(isV>0.5){cell=vec2(bc.x*2.0+floor(sb.x*2.0),bc.y*2.0);d=m3dBoxSDF(vec2((fract(sb.x*2.0)-0.5)*0.5,sb.y-0.5),vec2(0.25-uM3DPatternGap*0.5,0.5-uM3DPatternGap*0.5),0.02);}else{cell=vec2(bc.x*2.0,bc.y*2.0+floor(sb.y*2.0));d=m3dBoxSDF(vec2(sb.x-0.5,(fract(sb.y*2.0)-0.5)*0.5),vec2(0.5-uM3DPatternGap*0.5,0.25-uM3DPatternGap*0.5),0.02);}}',
      'else if(mode==10){float pr=floor(p.y);float ps=m3dHash(vec2(pr,11.0))*2.0;float px=p.x/3.0+ps;cell=vec2(floor(px),pr);d=m3dBoxSDF(vec2((fract(px)-0.5)*3.0,fract(p.y)-0.5),vec2(1.5-uM3DPatternGap*0.5,0.5-uM3DPatternGap*0.5),0.02);}',
      'float fill=1.0,edge=0.0,relief=0.0;float bz=max(0.001,uM3DPatternGap*0.5);',
      'if(d<=0.0){fill=1.0;edge=0.0;float din=-d;if(din>=bz){relief=1.0;}else{float t=din/bz;relief=t*t*(3.0-2.0*t);}}else{float tm=clamp(d/max(0.001,uM3DPatternGap*0.5),0.0,1.0);float aa=max(uM3DPatternSoftness,fwidth(d)*1.5);fill=1.0-smoothstep(0.0,aa,d);edge=1.0-fill;relief=-tm;}',
      'if(mode==3){float isOdd=mod(cell.x+cell.y,2.0);if(isOdd<0.5){fill=1.0-fill;edge=1.0-fill;}}',
      'float rnd=m3dHash(cell),n=m3dNoise(uv*uM3DPatternNoiseScale);float variation=(rnd-.5)*uM3DPatternVariation+(n-.5)*uM3DPatternNoiseStrength;',
      'vec3 surface=mix(uM3DPatternPrimary,uM3DPatternSecondary,clamp(rnd+variation,0.,1.));M3DPatternResult r;r.color=mix(uM3DPatternBorder,surface,fill);r.roughness=mix(uM3DPatternRoughBorder,uM3DPatternRoughPrimary,fill);r.metalness=uM3DPatternMetalness;r.height=fill>=edge?relief:-edge;return r;}'
    ].join('\n');
    function inject(shader,mat){var s=mat.__m3dPattern;if(!s)throw new Error('pattern state missing');Object.assign(shader.uniforms,s.uniforms);if(shader.fragmentShader.indexOf('#include <common>')<0||shader.vertexShader.indexOf('#include <uv_vertex>')<0||shader.fragmentShader.indexOf('#include <map_fragment>')<0)throw new Error('required Three.js UV/map chunks missing');shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec2 vM3DPatternUv;\nvarying vec3 vM3DPatternNormal;').replace('#include <uv_vertex>','#include <uv_vertex>\nvM3DPatternUv=uv;\nvM3DPatternNormal=normal;');shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\n'+GLSL).replace('#include <map_fragment>','#include <map_fragment>\nm3dPatternResult=m3dPattern(vM3DPatternUv);\nfloat m3dPatternLuma=dot(m3dPatternResult.color,vec3(.2126,.7152,.0722));\nm3dPatternResult.color=mix(vec3(m3dPatternLuma),m3dPatternResult.color,uM3DPatternSaturation)*uM3DPatternOverlayColor;\nif(uM3DPatternOverwriteTexture>0.5){\ndiffuseColor.rgb=mix(diffuseColor.rgb,m3dPatternResult.color,uM3DPatternStrength);\n}else{\ndiffuseColor.rgb*=mix(vec3(1.),m3dPatternResult.color,uM3DPatternStrength);\n}').replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor=mix(roughnessFactor,m3dPatternResult.roughness,uM3DPatternStrength);').replace('#include <metalnessmap_fragment>','#include <metalnessmap_fragment>\nmetalnessFactor=mix(metalnessFactor,m3dPatternResult.metalness,uM3DPatternStrength);');}
    if(gdjs.__m3dShaderChain)gdjs.__m3dShaderChain.register({id:'pattern-material',chunk:'map_fragment',order:420,isActive:function(m){return!!(m.__m3dPattern&&m.__m3dPattern.enabled&&m.__m3dPattern.uniforms&&m.__m3dPattern.uniforms.uM3DPatternStrength.value>0);},key:function(m){return m.__m3dPattern?m.__m3dPattern.key:'off';},inject:inject});
    function n(v,d){v=Number(v);return Number.isFinite(v)?v:d;}function c(v){var p=String(v||'255;255;255').split(';'),x=new THREE.Color();x.setRGB(Math.max(0,Math.min(255,n(p[0],255)))/255,Math.max(0,Math.min(255,n(p[1],255)))/255,Math.max(0,Math.min(255,n(p[2],255)))/255,THREE.SRGBColorSpace);return x;}function rootOf(o){try{return o&&o.get3DRendererObject?o.get3DRendererObject():null;}catch(e){return null;}}
    function calcScale(root,o){var sx=1,sy=1,sz=1;if(root&&root.scale){sx=Math.abs(root.scale.x)||1;sy=Math.abs(root.scale.y)||1;sz=Math.abs(root.scale.z)||1;}if(o&&typeof o.getWidth==='function'&&typeof o.getHeight==='function'&&typeof o.getDepth==='function'){var w=o.getWidth(),h=o.getHeight(),d=o.getDepth();if(w>0&&h>0&&d>0){sx=w;sy=h;sz=d;}}var maxDim=Math.max(sx,Math.max(sy,sz));var ref=maxDim<10?maxDim:100.0;if(ref>0){sx/=ref;sy/=ref;sz/=ref;}return[sx,sy,sz];}
    var PATTERN_PRESETS = {
      'Red Brick': {
        type: 'Brick', scaleX: 8, scaleY: 8, gap: 0.06, softness: 0.02,
        primary: '180;60;45', secondary: '140;45;35', border: '60;60;60',
        roughPrimary: 0.8, roughBorder: 0.95, variation: 0.15
      },
      'Subway Tiles': {
        type: 'Tiles', scaleX: 10, scaleY: 10, gap: 0.03, softness: 0.01,
        primary: '240;240;240', secondary: '225;225;225', border: '80;80;80',
        roughPrimary: 0.15, roughBorder: 0.85, variation: 0.05
      },
      'Herringbone Wood': {
        type: 'Herringbone', scaleX: 6, scaleY: 6, gap: 0.025, softness: 0.015,
        primary: '160;110;60', secondary: '130;85;45', border: '70;45;20',
        roughPrimary: 0.5, roughBorder: 0.8, variation: 0.2
      },
      'Hexagon Mosaic': {
        type: 'Hexagons', scaleX: 12, scaleY: 12, gap: 0.04, softness: 0.02,
        primary: '200;210;220', secondary: '160;180;200', border: '50;50;50',
        roughPrimary: 0.2, roughBorder: 0.85, variation: 0.1
      },
      'Checkerboard': {
        type: 'Checker', scaleX: 8, scaleY: 8, gap: 0.01, softness: 0.01,
        primary: '230;230;230', secondary: '30;30;30', border: '20;20;20',
        roughPrimary: 0.3, roughBorder: 0.9, variation: 0.0
      },
      'Cobblestone': {
        type: 'Voronoi', scaleX: 8, scaleY: 8, gap: 0.08, softness: 0.04,
        primary: '130;125;120', secondary: '95;90;85', border: '40;40;40',
        roughPrimary: 0.75, roughBorder: 0.95, variation: 0.2
      },
      'Noise Weathering': {
        type: 'Noise', scaleX: 4, scaleY: 4, gap: 0.05, softness: 0.05,
        primary: '150;145;140', secondary: '110;105;100', border: '50;50;50',
        roughPrimary: 0.7, roughBorder: 0.9, noiseScale: 3, noiseStrength: 0.3
      },
      'Vertical Stripes': {
        type: 'Stripes', scaleX: 10, scaleY: 10, gap: 0.03, softness: 0.01,
        primary: '200;200;200', secondary: '50;50;50', border: '30;30;30',
        roughPrimary: 0.4, roughBorder: 0.8, variation: 0.0
      }
    };

    function read(b){
      var presetName = b._getPreset ? String(b._getPreset()) : 'Custom';
      var ps = PATTERN_PRESETS[presetName] || null;
      var typeStr = ps && (!b._getPatternType || b._getPatternType() === 'Brick') ? ps.type : String(b._getPatternType ? b._getPatternType() : 'Brick');
      return {
        preset: presetName,
        enabled: b._getEnabled ? !!b._getEnabled() : true,
        mode: MODES[typeStr] ?? 0,
        type: typeStr,
        scaleX: Math.max(.001, n(b._getScaleX ? b._getScaleX() : (ps ? ps.scaleX : 8), ps ? ps.scaleX : 8)),
        scaleY: Math.max(.001, n(b._getScaleY ? b._getScaleY() : (ps ? ps.scaleY : 8), ps ? ps.scaleY : 8)),
        rotation: n(b._getRotationAngle ? b._getRotationAngle() : 0, 0),
        seed: n(b._getSeed ? b._getSeed() : 1, 1),
        gap: Math.max(0, Math.min(.49, n(b._getGapWidth ? b._getGapWidth() : (ps ? ps.gap : .06), ps ? ps.gap : .06))),
        softness: Math.max(.0001, n(b._getEdgeSoftness ? b._getEdgeSoftness() : (ps ? ps.softness : .02), ps ? ps.softness : .02)),
        primary: String(b._getPrimaryColor ? b._getPrimaryColor() : (ps ? ps.primary : '180;180;180')),
        secondary: String(b._getSecondaryColor ? b._getSecondaryColor() : (ps ? ps.secondary : '130;130;130')),
        border: String(b._getBorderColor ? b._getBorderColor() : (ps ? ps.border : '45;45;45')),
        overlayColor: String(b._getTextureOverlayColor ? b._getTextureOverlayColor() : '255;255;255'),
        saturation: Math.max(0, Math.min(2, n(b._getSaturation ? b._getSaturation() : 1, 1))),
        variation: Math.max(0, n(b._getColorVariation ? b._getColorVariation() : (ps ? ps.variation : .15), ps ? ps.variation : .15)),
        noiseScale: Math.max(.001, n(b._getNoiseScale ? b._getNoiseScale() : (ps ? ps.noiseScale : 2), ps ? ps.noiseScale : 2)),
        noiseStrength: Math.max(0, n(b._getNoiseStrength ? b._getNoiseStrength() : (ps ? ps.noiseStrength : .15), ps ? ps.noiseStrength : .15)),
        roughPrimary: Math.max(0, Math.min(1, n(b._getSurfaceRoughness ? b._getSurfaceRoughness() : (ps ? ps.roughPrimary : .6), ps ? ps.roughPrimary : .6))),
        roughBorder: Math.max(0, Math.min(1, n(b._getBorderRoughness ? b._getBorderRoughness() : (ps ? ps.roughBorder : .9), ps ? ps.roughBorder : .9))),
        metalness: Math.max(0, Math.min(1, n(b._getMetalness ? b._getMetalness() : 0, 0))),
        strength: Math.max(0, Math.min(1, n(b._getStrength ? b._getStrength() : 1, 1))),
        overwriteTexture: b._getOverwriteTexture ? !!b._getOverwriteTexture() : true,
        autoTiling: b._getAutoTiling ? !!b._getAutoTiling() : true,
        anisotropicFiltering: b._getAnisotropicFiltering ? String(b._getAnisotropicFiltering()) : '16x',
        targetMode: b._getTargetMode ? String(b._getTargetMode()) : 'All materials',
        materialIndex: b._getMaterialIndex ? Number(b._getMaterialIndex()) : 0,
        materialName: b._getMaterialName ? String(b._getMaterialName()) : '',
        meshName: b._getMeshName ? String(b._getMeshName()) : ''
      };
    }
    function matchesTarget(p,mat,ctx){if(!p)return true;var m=p.targetMode||'All materials';if(m==='All materials')return true;if(m==='First material')return ctx&&ctx.slot!==undefined?ctx.slot===0:true;if(m==='Material index'){var idx=Number(p.materialIndex||0);return ctx&&ctx.slot!==undefined?ctx.slot===idx:true;}if(m==='Material name'){var nm=String(p.materialName||'');return mat&&mat.name===nm;}if(m==='Mesh name'){var mn=String(p.meshName||'');return ctx&&ctx.mesh&&ctx.mesh.name===mn;}return true;}
    function uniforms(p,root,o){var sc=calcScale(root,o);return{uM3DPatternMode:{value:p.mode},uM3DPatternSeed:{value:p.seed},uM3DPatternScale:{value:new THREE.Vector2(p.scaleX,p.scaleY)},uM3DPatternRotation:{value:(p.rotation||0)*Math.PI/180},uM3DPatternGap:{value:p.gap},uM3DPatternSoftness:{value:p.softness},uM3DPatternPrimary:{value:c(p.primary)},uM3DPatternSecondary:{value:c(p.secondary)},uM3DPatternBorder:{value:c(p.border)},uM3DPatternOverlayColor:{value:c(p.overlayColor)},uM3DPatternSaturation:{value:p.saturation},uM3DPatternVariation:{value:p.variation},uM3DPatternNoiseScale:{value:p.noiseScale},uM3DPatternNoiseStrength:{value:p.noiseStrength},uM3DPatternRoughPrimary:{value:p.roughPrimary},uM3DPatternRoughBorder:{value:p.roughBorder},uM3DPatternMetalness:{value:p.metalness},uM3DPatternStrength:{value:p.strength},uM3DPatternOverwriteTexture:{value:p.overwriteTexture?1:0},uM3DPatternAutoTiling:{value:p.autoTiling?1:0},uM3DPatternObjectScale:{value:new THREE.Vector3(sc[0],sc[1],sc[2])}};}
    function stateOf(b){if(!b.__patternMaterial3DState)b.__patternMaterial3DState={root:null,params:null,uniforms:null,contributor:null,state:'Uninitialized',error:'',appliedGeneration:-1};return b.__patternMaterial3DState;}
    function syncUniforms(u,p,root,o){var sc=calcScale(root,o);u.uM3DPatternMode.value=p.mode;u.uM3DPatternSeed.value=p.seed;u.uM3DPatternScale.value.set(p.scaleX,p.scaleY);u.uM3DPatternRotation.value=(p.rotation||0)*Math.PI/180;u.uM3DPatternGap.value=p.gap;u.uM3DPatternSoftness.value=p.softness;u.uM3DPatternPrimary.value.copy(c(p.primary));u.uM3DPatternSecondary.value.copy(c(p.secondary));u.uM3DPatternBorder.value.copy(c(p.border));u.uM3DPatternOverlayColor.value.copy(c(p.overlayColor));u.uM3DPatternSaturation.value=p.saturation;u.uM3DPatternVariation.value=p.variation;u.uM3DPatternNoiseScale.value=p.noiseScale;u.uM3DPatternNoiseStrength.value=p.noiseStrength;u.uM3DPatternRoughPrimary.value=p.roughPrimary;u.uM3DPatternRoughBorder.value=p.roughBorder;u.uM3DPatternMetalness.value=p.metalness;u.uM3DPatternStrength.value=p.strength;u.uM3DPatternOverwriteTexture.value=p.overwriteTexture?1:0;u.uM3DPatternAutoTiling.value=p.autoTiling?1:0;u.uM3DPatternObjectScale.value.set(sc[0],sc[1],sc[2]);}
    function sync(b,o){var s=stateOf(b),root=rootOf(o);if(!root){s.state='WaitingForRenderer';s.error='No 3D renderer is available.';return false;}if(!gdjs.__materialController3D){s.state='Failed';s.error='Material 3D controller is not loaded.';return false;}var p=read(b);s.root=root;s.params=p;s.recipe=gdjs.__patternMath3D?gdjs.__patternMath3D.normalizeRecipe(p):null;root.__m3dPatternRecipe=s.recipe;if(!s.uniforms)s.uniforms=uniforms(p,root,o);else syncUniforms(s.uniforms,p,root,o);if(!s.contributor)s.contributor={id:'pattern-material',order:420,requiresPhysical:function(){return false;},attach:function(mat,ctx){if(!mat||!matchesTarget(s.params,mat,ctx))return;if(ctx&&ctx.mesh&&gdjs.__materialController3D&&gdjs.__materialController3D.ensureIsolatedMaterial){mat=gdjs.__materialController3D.ensureIsolatedMaterial({mesh:ctx.mesh,slot:ctx.slot,material:mat},ctx.root);}mat.__m3dPattern={enabled:s.params.enabled,key:'procedural-v1',uniforms:s.uniforms};if(gdjs.__m3dShaderChain)gdjs.__m3dShaderChain.install(mat);mat.needsUpdate=true;},detach:function(mat,ctx){if(mat&&matchesTarget(s.params,mat,ctx)){mat.__m3dPattern=null;mat.needsUpdate=true;}}};gdjs.__materialController3D.registerContributor(root,b,s.contributor);var ts=gdjs.__materialController3D.resolveBehaviorTargets?gdjs.__materialController3D.resolveBehaviorTargets(root,b):gdjs.__materialController3D.getTargets(root);if(!ts.length&&typeof gdjs.__materialController3D.findLiveTargets==='function'){ts=gdjs.__materialController3D.findLiveTargets(root);}for(var i=0;i<ts.length;i++){var mat=ts[i].material;if(!mat||!matchesTarget(p,mat,ts[i]))continue;if(gdjs.__materialController3D&&gdjs.__materialController3D.ensureIsolatedMaterial){mat=gdjs.__materialController3D.ensureIsolatedMaterial(ts[i],root);}var needsInstall=!mat.__m3dPattern||(gdjs.__m3dShaderChain&&!gdjs.__m3dShaderChain.isInstalled(mat));var enabledChanged=mat.__m3dPattern&&mat.__m3dPattern.enabled!==p.enabled;mat.__m3dPattern={enabled:p.enabled,key:'procedural-v1',uniforms:s.uniforms};if(needsInstall&&gdjs.__m3dShaderChain){gdjs.__m3dShaderChain.install(mat);mat.needsUpdate=true;}else if(enabledChanged){mat.needsUpdate=true;}}gdjs.__materialController3D.applyAnisotropyToObject(root,p.anisotropicFiltering);var cs=gdjs.__materialController3D.getState(root,false);s.appliedGeneration=cs?cs.generation:0;s.state=ts.length?'Ready':'WaitingForMesh';s.error=ts.length?'':'No 3D meshes found on object.';return true;}
    function tick(b,o){var s=stateOf(b),root=rootOf(o);if(!root||s.state==='Uninitialized'||s.root!==root)return sync(b,o);var cs=gdjs.__materialController3D&&gdjs.__materialController3D.getState(root,false),g=cs?cs.generation:0;return g!==s.appliedGeneration?sync(b,o):true;}
    function dispose(b){var s=stateOf(b);if(s.root){if(s.root.__m3dPatternRecipe)delete s.root.__m3dPatternRecipe;var ts=gdjs.__materialController3D?gdjs.__materialController3D.getTargets(s.root):[];if(!ts.length&&gdjs.__materialController3D&&typeof gdjs.__materialController3D.findLiveTargets==='function'){ts=gdjs.__materialController3D.findLiveTargets(s.root);}for(var i=0;i<ts.length;i++){if(ts[i].material&&ts[i].material.__m3dPattern){ts[i].material.__m3dPattern=null;ts[i].material.needsUpdate=true;}}if(gdjs.__materialController3D)gdjs.__materialController3D.unregisterContributor(s.root,b);}s.root=null;s.state='Uninitialized';}
    function getActiveRecipe(root){return root&&root.__m3dPatternRecipe?root.__m3dPatternRecipe:null;}
    return{read:read,stateOf:stateOf,sync:sync,tick:tick,dispose:dispose,inject:inject,modes:MODES,presets:PATTERN_PRESETS,getActiveRecipe:getActiveRecipe,calcScale:calcScale};
  })();
}
