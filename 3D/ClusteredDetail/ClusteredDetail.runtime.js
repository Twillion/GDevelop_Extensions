/* ClusteredDetail: forward projected decals, Three.js r160 / WebGL2.
 * All public positions use GDevelop layer coordinates (+Z up). Matrices stored
 * on the GPU use Three world coordinates, including the layer's Y reflection.
 * ShaderChain.runtime.js is embedded by build-extension.mjs before this file.
 */
(function () {
  'use strict';
  if (typeof gdjs === 'undefined' || typeof THREE === 'undefined' || gdjs.__clusteredDetail) return;
  const NX = 16, NY = 9, NZ = 24, CELLS = NX * NY * NZ, LIMIT = 32;
  const INDEX_WIDTH = 1024, INDEX_HEIGHT = Math.ceil(CELLS * LIMIT / INDEX_WIDTH);
  const MODES = ['AlphaBlend', 'Multiply', 'NormalOnly', 'EmissiveGlow'];
  const scenes = new WeakMap();
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const number = (v, fallback) => Number.isFinite(Number(v)) ? Number(v) : fallback;
  const prop = (b, key, fallback) => typeof b['_get' + key] === 'function' ? b['_get' + key]() : fallback;
  const meshOf = o => o?.get3DRendererObject?.() || o?.getRenderer?.()?.get3DRendererObject?.() || null;
  const rendererOf = s => s.getGame?.().getRenderer?.().getThreeRenderer?.();
  function supported(scene) {
    return !!(rendererOf(scene)?.capabilities?.isWebGL2 && gdjs.__m3dShaderChain);
  }
  function texture(data, w, h, format, type, internal) {
    const t = new THREE.DataTexture(data, w, h, format, type);
    t.internalFormat = internal; t.minFilter = t.magFilter = THREE.NearestFilter;
    t.generateMipmaps = false; t.colorSpace = THREE.NoColorSpace; t.needsUpdate = true;
    return t;
  }
  function solid(r, g, b, a) { return texture(new Uint8Array([r,g,b,a]), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType, 'RGBA8'); }

  const HEADER = `
  uniform highp sampler2D cdData;
  uniform highp usampler3D cdGrid;
  uniform highp usampler2D cdIndices;
  uniform sampler2D cdAtlas;
  uniform sampler2D cdNormalAtlas;
  uniform sampler2D cdSurfaceAtlas;
  uniform vec2 cdZ;
  uniform vec3 cdChannels;
  uniform int cdMask;
  varying vec3 cdWorld;
  varying vec4 cdClip;
  vec3 cdLinear(vec3 c) {
    return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
  }
  // RNM in the decal's orthonormal projection frame, never mixing world/view normals.
  vec3 cdBlendNormal(vec3 base, vec3 detail) {
    vec3 t = base + vec3(0.0, 0.0, 1.0);
    vec3 u = detail * vec3(-1.0, -1.0, 1.0);
    return normalize(t * dot(t, u) / max(t.z, 0.0001) - u);
  }
  `;
  const LOOP = `
  vec2 cdScreen = cdClip.xy / cdClip.w * 0.5 + 0.5;
  float cdDepth = max(vViewPosition.z, cdZ.x);
  ivec3 cdCell = ivec3(clamp(floor(cdScreen * vec2(16.0,9.0)), vec2(0.0), vec2(15.0,8.0)),
    clamp(floor(log(cdDepth / cdZ.x) / cdZ.y * 24.0), 0.0, 23.0));
  uvec2 cdHeader = texelFetch(cdGrid, cdCell, 0).rg;
  vec3 cdGeomWorld = inverseTransformDirection(nonPerturbedNormal, viewMatrix);
  for (int cdI = 0; cdI < 32; cdI++) {
    if (uint(cdI) >= cdHeader.g) break;
    int cdAddress = int(cdHeader.r) + cdI;
    int cdSlot = int(texelFetch(cdIndices, ivec2(cdAddress % 1024, cdAddress / 1024), 0).r);
    vec4 cdR0 = texelFetch(cdData, ivec2(0,cdSlot), 0);
    vec4 cdR1 = texelFetch(cdData, ivec2(1,cdSlot), 0);
    vec4 cdR2 = texelFetch(cdData, ivec2(2,cdSlot), 0);
    vec4 cdUV = texelFetch(cdData, ivec2(3,cdSlot), 0);
    vec4 cdP = texelFetch(cdData, ivec2(4,cdSlot), 0);
    vec4 cdS = texelFetch(cdData, ivec2(5,cdSlot), 0);
    if ((int(cdS.z) & cdMask) == 0) continue;
    vec4 cdWP = vec4(cdWorld,1.0);
    vec3 cdLocal = vec3(dot(cdR0,cdWP),dot(cdR1,cdWP),dot(cdR2,cdWP));
    if (any(greaterThan(abs(cdLocal),vec3(0.5)))) continue;
    vec3 cdN = normalize(cdR2.xyz);
    float cdCos = dot(cdGeomWorld,cdN);
    if (cdCos <= cdP.x) continue;
    vec2 cdTexUV = cdUV.xy + vec2(cdLocal.x+0.5,0.5-cdLocal.y)*cdUV.zw;
    // Explicit LOD: cluster loops diverge. Atlases must have padded cells; no mip bleed.
    vec4 cdTex = textureLod(cdAtlas,cdTexUV,0.0);
    vec4 cdNT = textureLod(cdNormalAtlas,cdTexUV,0.0);
    float cdA = (int(cdP.y)==2 ? cdNT.a : cdTex.a) * cdP.z
      * clamp((cdCos-cdP.x)/(1.0-cdP.x),0.0,1.0)
      * (1.0-smoothstep(0.35,0.5,abs(cdLocal.z)));
    vec3 cdColor = cdLinear(cdTex.rgb);
    int cdMode = int(cdP.y);
    if (cdMode==0) diffuseColor.rgb = mix(diffuseColor.rgb,cdColor,cdA);
    if (cdMode==1) diffuseColor.rgb = mix(diffuseColor.rgb,diffuseColor.rgb*cdColor,cdA);
    if (cdMode==3) totalEmissiveRadiance += cdColor*cdA*cdP.w;
    if (cdChannels.x > 0.5 || cdMode==2) {
      vec3 cdT = normalize(cdR0.xyz);
      // Atlas V increases opposite local Y. Use a right handed frame, accounting for mirror.
      vec3 cdB = normalize(cross(cdN,cdT));
      float cdHand = sign(dot(cdB,-normalize(cdR1.xyz)));
      vec3 cdWN = inverseTransformDirection(normal,viewMatrix);
      vec3 cdBase = vec3(dot(cdWN,cdT),dot(cdWN,cdB),dot(cdWN,cdN));
      vec3 cdDetail = cdNT.xyz*2.0-1.0; cdDetail.y *= cdHand;
      vec3 cdRN = cdBlendNormal(cdBase,normalize(cdDetail));
      vec3 cdTarget = cdT*cdRN.x + cdB*cdRN.y + cdN*cdRN.z;
      normal = normalize(mix(normal,transformDirection(cdTarget,viewMatrix),cdA));
    }
    vec2 cdRM = textureLod(cdSurfaceAtlas,cdTexUV,0.0).rg;
    if (cdChannels.y > 0.5 || cdS.x >= 0.0)
      roughnessFactor = mix(roughnessFactor,cdChannels.y > 0.5 ? cdRM.x : cdS.x,cdA);
    if (cdChannels.y > 0.5 || cdS.y >= 0.0)
      metalnessFactor = mix(metalnessFactor,cdChannels.y > 0.5 ? cdRM.y : cdS.y,cdA);
  }
  `;
  function inject(shader, mat) {
    const state = mat.__cdState;
    Object.assign(shader.uniforms, state.manager.uniforms, {cdMask: state.maskUniform});
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform mat4 cdCameraWorld;\nvarying vec3 cdWorld;\nvarying vec4 cdClip;');
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\ncdWorld = (cdCameraWorld * mvPosition).xyz; cdClip = gl_Position;');
    // After ALL base input maps, before physical lighting consumes normal/roughness/emission.
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\n' + HEADER);
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + LOOP);
  }
  gdjs.__m3dShaderChain?.register({id:'clusteredDetail', order:590, chunk:'emissivemap_fragment',
    isActive:m=>!!m.__cdState, key:()=> '2', inject});

  class Manager {
    constructor(scene, layer, capacity = 128) {
      this.scene = scene; this.layer = layer; this.capacity = capacity;
      this.slots = Array(capacity).fill(null); this.serial = 0; this.lastId = -1;
      this.columns = 4; this.rows = 4; this.timeMs = 0; this.overflow = 0;
      this.count = 0; this.frame = 0; this.preparedFrame = -1; this.preparedCamera = null;
      this.matrix = new THREE.Matrix4(); this.inverse = new THREE.Matrix4();
      this.point = new THREE.Vector3(); this.q = new THREE.Quaternion(); this.scale = new THREE.Vector3();
      this.viewBox = new THREE.Box3(); this.bounds = new THREE.Box3();
      this.cameraKey = new Float64Array(32);
      this.data = new Float32Array(6 * capacity * 4);
      this.grid = new Uint32Array(CELLS * 2);
      this.indices = new Uint16Array(INDEX_WIDTH * INDEX_HEIGHT);
      this.dataTexture = texture(this.data, 6, capacity, THREE.RGBAFormat, THREE.FloatType, 'RGBA32F');
      this.indexTexture = texture(this.indices, INDEX_WIDTH, INDEX_HEIGHT, THREE.RedIntegerFormat, THREE.UnsignedShortType, 'R16UI');
      this.gridTexture = new THREE.Data3DTexture(this.grid, NX, NY, NZ);
      Object.assign(this.gridTexture, {format:THREE.RGIntegerFormat, type:THREE.UnsignedIntType,
        internalFormat:'RG32UI', minFilter:THREE.NearestFilter, magFilter:THREE.NearestFilter,
        generateMipmaps:false, needsUpdate:true});
      this.atlases = [solid(255,255,255,0),solid(128,128,255,255),solid(255,0,0,255)];
      this.uniforms = {cdData:{value:this.dataTexture}, cdGrid:{value:this.gridTexture},
        cdIndices:{value:this.indexTexture}, cdAtlas:{value:this.atlases[0]},
        cdNormalAtlas:{value:this.atlases[1]}, cdSurfaceAtlas:{value:this.atlases[2]},
        cdZ:{value:new THREE.Vector2(0.1,1)}, cdChannels:{value:new THREE.Vector3()},
        cdCameraWorld:{value:new THREE.Matrix4()}};
    }
    root() { return this.scene.getLayer(this.layer).getRenderer().getThreeScene(); }
    spawn(options = {}) {
      let slot = this.slots.indexOf(null);
      if (slot < 0) {
        let oldest = Infinity;
        for (let i=0;i<this.capacity;i++) if (!this.slots[i].pinned && this.slots[i].id<oldest) {oldest=this.slots[i].id;slot=i;}
      }
      if (slot < 0) {this.lastId=-1;return -1;}
      const life = number(options.lifetime,30);
      const decal = {id:++this.serial, age:0, lifetime:life, pinned:options.pinned ?? life<0,
        fade:Math.max(0,number(options.fade,1)), opacity:clamp(number(options.opacity,1),0,1),
        atlas:Math.max(0,Math.floor(number(options.atlas,0))), mode:Math.max(0,MODES.indexOf(options.mode)),
        cutoff:Math.cos(clamp(number(options.cutoff,60),0.1,89.9)*Math.PI/180),
        emissive:Math.max(0,number(options.emissive,1)), mask:clamp(number(options.mask,1)|0,0,65535),
        roughness:clamp(number(options.roughness,-1),-1,1), metalness:clamp(number(options.metalness,-1),-1,1),
        matrix:new THREE.Matrix4(), inverse:new THREE.Matrix4(), center:new THREE.Vector3(), radius:0};
      this.slots[slot]=decal;
      if (options.matrix) decal.matrix.copy(options.matrix);
      else {
        this.point.set(number(options.x,0),number(options.y,0),number(options.z,0));
        if (options.normal) {
          const n = new THREE.Vector3(...options.normal);
          if (n.lengthSq()<1e-12 || !Number.isFinite(n.lengthSq())) n.set(0,0,1);
          this.q.setFromUnitVectors(new THREE.Vector3(0,0,1),n.normalize());
        } else this.q.setFromEuler(new THREE.Euler(...['rx','ry','rz'].map(k=>number(options[k],0)*Math.PI/180),'XYZ'));
        this.scale.set(...['width','height','depth'].map(k=>Math.max(0.001,Math.abs(number(options[k],10)))));
        decal.matrix.compose(this.point,this.q,this.scale);
        const root=this.root();root.updateMatrixWorld(true);decal.matrix.premultiply(root.matrixWorld);
      }
      this.updateTransform(decal); this.lastId=decal.id;this.frame++;
      this.count=this.slots.reduce((n,d)=>n+!!d,0);
      return decal.id;
    }
    updateTransform(d) {
      d.inverse.copy(d.matrix).invert();d.center.setFromMatrixPosition(d.matrix);
      // Sum of axis lengths is conservative even under sheared parents.
      const e=d.matrix.elements;
      d.radius=0.5*(Math.hypot(e[0],e[1],e[2])+Math.hypot(e[4],e[5],e[6])+Math.hypot(e[8],e[9],e[10]));
    }
    find(id) {return this.slots.find(d=>d?.id===id);}
    remove(id) {const i=this.slots.findIndex(d=>d?.id===id);if(i>=0){this.slots[i]=null;this.count--;this.frame++;}}
    clear() {for(let i=0;i<this.capacity;i++)if(this.slots[i]&&!this.slots[i].pinned)this.remove(this.slots[i].id);}
    resize(capacity) {
      capacity=number(capacity,128);if(![64,128,256,512].includes(capacity)||capacity===this.capacity)return false;
      const live=this.slots.filter(Boolean).sort((a,b)=>Number(b.pinned)-Number(a.pinned)||b.id-a.id);
      if(live.filter(d=>d.pinned).length>capacity)return false;
      this.slots=Array(capacity).fill(null);live.slice(0,capacity).forEach((d,i)=>this.slots[i]=d);
      this.capacity=capacity;this.count=Math.min(live.length,capacity);
      this.data=new Float32Array(capacity*24);this.dataTexture.dispose();
      this.dataTexture=texture(this.data,6,capacity,THREE.RGBAFormat,THREE.FloatType,'RGBA32F');
      this.uniforms.cdData.value=this.dataTexture;this.frame++;return true;
    }
    tick(dt) {
      for(const d of this.slots)if(d){d.age+=Math.max(0,dt);if(d.lifetime>=0&&d.age>=d.lifetime)this.remove(d.id);}
      this.frame++;
    }
    setAtlas(channel,resource) {
      const shared=this.scene.getGame().getImageManager().getThreeTexture(resource);
      if(!shared)return false;
      const t=shared.clone();t.colorSpace=THREE.NoColorSpace;t.generateMipmaps=false;
      t.minFilter=t.magFilter=THREE.LinearFilter;t.wrapS=t.wrapT=THREE.ClampToEdgeWrapping;t.needsUpdate=true;
      this.atlases[channel].dispose();this.atlases[channel]=t;
      this.uniforms[['cdAtlas','cdNormalAtlas','cdSurfaceAtlas'][channel]].value=t;
      if(channel===1)this.uniforms.cdChannels.value.x=1;
      if(channel===2)this.uniforms.cdChannels.value.y=1;
      return true;
    }
    prepare(camera) {
      camera.updateMatrixWorld(true);
      const ce=camera.matrixWorld.elements, pe=camera.projectionMatrix.elements;
      let changed=this.preparedFrame!==this.frame||this.preparedCamera!==camera;
      for(let i=0;i<16;i++)if(this.cameraKey[i]!==ce[i]||this.cameraKey[16+i]!==pe[i])changed=true;
      if(!changed)return;
      this.cameraKey.set(ce);this.cameraKey.set(pe,16);this.preparedCamera=camera;this.preparedFrame=this.frame;
      const start=performance.now();
      const near=Math.max(0.0001,camera.near),far=Math.max(near+0.0001,camera.far),log=Math.log(far/near);
      this.uniforms.cdZ.value.set(near,log);this.uniforms.cdCameraWorld.value.copy(camera.matrixWorld);
      this.grid.fill(0);this.overflow=0;
      // Oldest first -> newest last gives deterministic alpha layering.
      const ordered=this.slots.map((d,i)=>d?i:-1).filter(i=>i>=0).sort((a,b)=>this.slots[a].id-this.slots[b].id);
      for(const slot of ordered) {
        const d=this.slots[slot],e=d.inverse.elements,base=slot*24;
        for(let row=0;row<3;row++)for(let col=0;col<4;col++)this.data[base+row*4+col]=e[col*4+row];
        const atlas=d.atlas%(this.columns*this.rows),col=atlas%this.columns,row=Math.floor(atlas/this.columns);
        const im=this.atlases[0].image,tw=Math.max(1,im?.width||1),th=Math.max(1,im?.height||1);
        const padX=tw>1?0.5/tw:0,padY=th>1?0.5/th:0;
        // Cell zero is top-left in the source image; Three UV V points upward.
        this.data.set([col/this.columns+padX,1-(row+1)/this.rows+padY,
          1/this.columns-2*padX,1/this.rows-2*padY,d.cutoff,d.mode,
          d.opacity*(d.lifetime>=0&&d.fade>0?clamp((d.lifetime-d.age)/d.fade,0,1):1),
          d.emissive,d.roughness,d.metalness,d.mask,0],base+12);
        this.point.copy(d.center).applyMatrix4(camera.matrixWorldInverse);
        const depth=-this.point.z,r=d.radius;
        if(depth+r<near||depth-r>far)continue;
        const z0=clamp(Math.floor(Math.log(Math.max(near,depth-r)/near)/log*NZ),0,NZ-1);
        const z1=clamp(Math.floor(Math.log(Math.max(near,depth+r)/near)/log*NZ),0,NZ-1);
        let minX=-1,maxX=1,minY=-1,maxY=1;
        if(depth-r>near || camera.isOrthographicCamera) {
          this.viewBox.min.copy(this.point).addScalar(-r);this.viewBox.max.copy(this.point).addScalar(r);
          this.viewBox.applyMatrix4(camera.projectionMatrix);
          minX=this.viewBox.min.x;maxX=this.viewBox.max.x;minY=this.viewBox.min.y;maxY=this.viewBox.max.y;
          if(maxX< -1||minX>1||maxY< -1||minY>1)continue;
        }
        const x0=clamp(Math.floor((minX+1)*0.5*NX),0,NX-1),x1=clamp(Math.floor((maxX+1)*0.5*NX),0,NX-1);
        const y0=clamp(Math.floor((minY+1)*0.5*NY),0,NY-1),y1=clamp(Math.floor((maxY+1)*0.5*NY),0,NY-1);
        for(let z=z0;z<=z1;z++)for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++) {
          const cell=x+NX*(y+NY*z),h=cell*2,count=this.grid[h+1],offset=cell*LIMIT;
          this.grid[h]=offset;
          if(count<LIMIT){this.indices[offset+count]=slot;this.grid[h+1]++;}
          else {this.indices.copyWithin(offset,offset+1,offset+LIMIT);this.indices[offset+LIMIT-1]=slot;this.overflow++;}
        }
      }
      this.dataTexture.needsUpdate=true;this.gridTexture.needsUpdate=true;this.indexTexture.needsUpdate=true;
      this.timeMs=performance.now()-start;
    }
    dispose() {this.dataTexture.dispose();this.gridTexture.dispose();this.indexTexture.dispose();this.atlases.forEach(t=>t.dispose());}
  }

  function state(scene) {
    let s=scenes.get(scene);if(!s){s={managers:new Map(),receivers:new Map(),anchors:new Map()};scenes.set(scene,s);}return s;
  }
  function manager(scene,layer='') {const s=state(scene);if(!s.managers.has(layer))s.managers.set(layer,new Manager(scene,layer));return s.managers.get(layer);}
  function restore(entry) {
    for(const r of entry.records) {
      if(r.mesh.material===r.assigned)r.mesh.material=r.original;
      if(r.mesh.onBeforeRender===r.hook)r.mesh.onBeforeRender=r.before;
      for(const m of r.clones){delete m.__cdState;gdjs.__m3dShaderChain.uninstall(m);m.dispose();}
    }
    entry.records=[];
  }
  function receive(scene,object,behavior) {
    const s=state(scene);let entry=s.receivers.get(behavior);
    if(!entry){entry={object,behavior,records:[],root:null};s.receivers.set(behavior,entry);}
    const root=meshOf(object),enabled=prop(behavior,'Enabled',true)&&supported(scene);
    if(!enabled||!root){restore(entry);entry.root=null;return;}
    const layer=object.getLayer?.()||'',m=manager(scene,layer),mask=clamp(number(prop(behavior,'LayerMask',1),1)|0,0,65535);
    if(entry.root!==root||entry.manager!==m||entry.records.some(r=>r.mesh.material!==r.assigned)) {restore(entry);entry.root=root;entry.manager=m;}
    root.traverse(mesh=>{
      if(!mesh.isMesh)return;
      let record=entry.records.find(r=>r.mesh===mesh);
      if(record){record.clones.forEach(c=>c.__cdState.maskUniform.value=mask);return;}
      const original=mesh.material,materials=Array.isArray(original)?original:[original],clones=[];
      const patched=materials.map(mat=>{
        if(!mat?.isMeshStandardMaterial)return mat;
        const clone=mat.clone();
        // Carry direct state used by other ShaderChain injectors; userData clone alone loses it.
        for(const key of Object.keys(mat))if(key.startsWith('__')&&!key.startsWith('__cd')&&!key.startsWith('__m3dChain'))clone[key]=mat[key];
        clone.__cdState={manager:m,maskUniform:{value:mask}};gdjs.__m3dShaderChain.install(clone);clones.push(clone);return clone;
      });
      if(!clones.length)return;
      const assigned=Array.isArray(original)?patched:patched[0],before=mesh.onBeforeRender;
      const hook=function(renderer,scene3,camera,...args){before?.call(this,renderer,scene3,camera,...args);m.prepare(camera);};
      mesh.material=assigned;mesh.onBeforeRender=hook;
      entry.records.push({mesh,original,assigned,before,hook,clones});
    });
  }
  function anchor(scene,object,behavior) {
    const s=state(scene);if(!s.anchors.has(behavior))s.anchors.set(behavior,{object,behavior,id:null,manager:null});
  }
  function updateAnchor(scene,a) {
    const obj=meshOf(a.object);if(!obj)return;
    const m=manager(scene,a.object.getLayer?.()||'');
    if(a.manager&&a.manager!==m){a.manager.remove(a.id);a.id=null;}
    a.manager=m;
    obj.updateWorldMatrix(true,true);
    // Use local geometry bounds, retaining the object's full rotation and scale.
    const box=new THREE.Box3(),inv=new THREE.Matrix4().copy(obj.matrixWorld).invert();
    obj.traverse(child=>{if(child.geometry){if(!child.geometry.boundingBox)child.geometry.computeBoundingBox();
      const local=child.geometry.boundingBox.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv,child.matrixWorld));box.union(local);}});
    if(box.isEmpty())return;
    const matrix=new THREE.Matrix4().compose(box.getCenter(new THREE.Vector3()),new THREE.Quaternion(),box.getSize(new THREE.Vector3()));
    matrix.premultiply(obj.matrixWorld);
    if(a.id===null) {
      const b=a.behavior;
      a.id=m.spawn({matrix,atlas:prop(b,'AtlasIndex',0),mode:prop(b,'BlendMode','AlphaBlend'),
        lifetime:prop(b,'Lifetime',-1),fade:prop(b,'FadeDuration',1),opacity:prop(b,'Opacity',1),
        cutoff:prop(b,'NormalCutoffAngle',60),emissive:prop(b,'EmissiveIntensity',1),mask:prop(b,'LayerMask',1),
        roughness:prop(b,'Roughness',-1),metalness:prop(b,'Metalness',-1)});
      if(a.id<0)a.id=null;
    } else {
      const d=m.find(a.id);
      if(d){
        d.matrix.copy(matrix);m.updateTransform(d);
        const b=a.behavior;
        d.atlas=Math.max(0,Math.floor(number(prop(b,'AtlasIndex',0),0)));
        d.mode=Math.max(0,MODES.indexOf(prop(b,'BlendMode','AlphaBlend')));
        d.cutoff=Math.cos(clamp(number(prop(b,'NormalCutoffAngle',60),60),0.1,89.9)*Math.PI/180);
        d.opacity=clamp(number(prop(b,'Opacity',1),1),0,1);
        d.emissive=Math.max(0,number(prop(b,'EmissiveIntensity',1),1));
        d.mask=clamp(number(prop(b,'LayerMask',1),1)|0,0,65535);
        d.roughness=clamp(number(prop(b,'Roughness',-1),-1),-1,1);
        d.metalness=clamp(number(prop(b,'Metalness',-1),-1),-1,1);
        m.frame++;
      }
    }
  }
  function removeBehavior(scene,b) {const s=scenes.get(scene);if(!s)return;
    const r=s.receivers.get(b);if(r){restore(r);s.receivers.delete(b);}
    const a=s.anchors.get(b);if(a){a.manager?.remove(a.id);s.anchors.delete(b);}}
  function tick(scene) {const s=scenes.get(scene);if(!s)return;
    for(const a of s.anchors.values())updateAnchor(scene,a);
    for(const r of s.receivers.values())receive(scene,r.object,r.behavior);
    const dt=(scene.getTimeManager?.().getElapsedTime?.()||0)/1000;
    for(const m of s.managers.values())m.tick(dt);
  }
  function dispose(scene) {const s=scenes.get(scene);if(!s)return;
    for(const r of s.receivers.values())restore(r);for(const m of s.managers.values())m.dispose();scenes.delete(scene);}
  gdjs.__clusteredDetail={Manager,manager,receive,anchor,removeBehavior,tick,dispose,supported,MODES};
  gdjs.registerRuntimeScenePostEventsCallback?.(tick);
  gdjs.registerRuntimeSceneUnloadedCallback?.(dispose);
})();
