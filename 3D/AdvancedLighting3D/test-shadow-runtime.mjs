import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const here=new URL('.',import.meta.url);
let clock=0,advance=0;
const callbacks={};
const ctx=vm.createContext({console,performance:{now:()=>{clock+=advance;return clock;}},gdjs:{registerRuntimeSceneUnloadedCallback:f=>callbacks.unload=f}});
vm.runInContext(fs.readFileSync(new URL('../../tools/gdjs-harness/runtime/pixi-renderers/three.js',here),'utf8'),ctx);
// ShaderChain owns onBeforeCompile and must exist before the runtime registers its band-100
// injector — the built extension concatenates them in this order too.
vm.runInContext(fs.readFileSync(new URL('../MaterialMaster/ShaderChain.runtime.js',here),'utf8'),ctx);
vm.runInContext(fs.readFileSync(new URL('AdvancedLighting3D.runtime.js',here),'utf8'),ctx);
const {THREE:T,gdjs}=ctx,AL=gdjs.__advancedLighting3D;
const root=new T.Scene();root.scale.y=-1;
const camera=new T.PerspectiveCamera(61,1.7,2,8000);camera.up.set(0,0,1);camera.position.set(230,-170,520);camera.lookAt(51,84,36);camera.updateMatrixWorld(true);
const sun=new T.DirectionalLight();sun.position.set(360,170,920);sun.castShadow=true;root.add(sun);root.add(sun.target);
const mesh=new T.Mesh(new T.BoxGeometry(),new T.MeshStandardMaterial());mesh.castShadow=false;mesh.receiveShadow=true;root.add(mesh);
const renderer={capabilities:{isWebGL2:true},shadowMap:{enabled:false,type:T.BasicShadowMap,autoUpdate:false}};
const scene={getGame:()=>({getRenderer:()=>({getThreeRenderer:()=>renderer})}),getLayer:()=>({getRenderer:()=>({getThreeScene:()=>root,getThreeCamera:()=>camera})})};
const state=AL.registerSceneManager(scene);
assert.equal(AL.shadowState(scene).mode,'Auto','Auto is the default: this extension shadows the scene');
assert.equal(AL.shadowState(scene).sunShadows,'Cascades','Sun defaults to cascades');
// Mode is now purely an OWNERSHIP choice. Only Auto lets this extension shadow anything.
for(const mode of ['Auto','Off','Native']){assert.ok(AL.setShadowMode(scene,mode),mode+' must resolve');assert.equal(AL.shadowState(scene).mode,mode);assert.equal(AL.isSDFShadowsEnabled(scene),mode==='Auto',mode+' SDF permission');}
// The retired combined modes must be gone, not silently accepted as something else.
for(const gone of ['CSM','SDF','Hybrid','Maps','MapsSDF'])assert.equal(AL.setShadowMode(scene,gone),false,gone+' is retired and must be rejected');
assert.equal(AL.shadowState(scene).mode,'Native','a rejected mode must not change the current one');
// How the Sun casts is its own axis, independent of ownership.
for(const m of ['Cascades','DistanceField','Off'])assert.ok(AL.setSunShadows(scene,m),m+' must resolve');
assert.equal(AL.setSunShadows(scene,'nonsense'),false);
AL.setSunShadows(scene,'Cascades');
assert.equal(AL.setShadowMode(scene,'invalid'),false);
AL.setShadowMode(scene,'Off');assert.equal(AL.isSDFShadowsEnabled(scene),false);
AL.setShadowMode(scene,'Auto');assert.equal(AL.isSDFShadowsEnabled(scene),true);
const managerA={},managerB={};assert.equal(AL.registerShadowManager(scene,managerA,{mode:'Auto',sunShadows:'DistanceField',count:3}),true);assert.equal(AL.registerShadowManager(scene,managerB,{mode:'Auto',count:3}),false);assert.equal(AL.shadowState(scene).manager,managerA);AL.destroyShadowManager(scene,managerA);assert.equal(AL.shadowState(scene).manager,managerB);assert.equal(AL.shadowState(scene).mode,'Auto');AL.destroyShadowManager(scene,managerB);assert.equal(AL.shadowState(scene).manager,null);assert.equal(AL.shadowState(scene).mode,'Off');AL.setShadowMode(scene,'Auto');AL.setSunShadows(scene,'Cascades');
AL.__internals.updateCSM(scene,camera);const c=AL.shadowState(scene);
assert.equal(c.lights.length,3);assert.equal(c.ready,false);assert.equal(sun.castShadow,false);assert.equal(sun.intensity,1);
assert.equal(mesh.castShadow,false);assert.equal(mesh.receiveShadow,true);
for(const lambda of [0,0.75,1]){const split=AL.__internals.practicalSplits(2,5000,4,lambda);assert.equal(split[3],5000);assert.ok(split.every((v,i)=>v>(i?split[i-1]:2)));}
for(const r of c.ranges){assert.ok(Math.abs(r.center.x/r.texel-Math.round(r.center.x/r.texel))<1e-8);assert.ok(Math.abs(r.center.y/r.texel-Math.round(r.center.y/r.texel))<1e-8);}
let disposed=0;for(const l of c.lights)l.shadow.map={dispose:()=>disposed++};
AL.setShadowMode(scene,'Off');assert.equal(disposed,3);assert.equal(c.lights.length,0);assert.equal(mesh.castShadow,false);assert.equal(mesh.receiveShadow,true);assert.equal(sun.castShadow,true);assert.equal(renderer.shadowMap.enabled,false);
AL.__internals.updateCSM(scene,camera);assert.equal(sun.castShadow,false,'Off suppresses native Sun shadows');
AL.setShadowMode(scene,'Auto');AL.setSunShadows(scene,'DistanceField');const behavior={};const vol=AL.registerSDFVolume(scene,{getRenderer:()=>null},behavior,{resX:8,resY:8,resZ:4});
AL.startSDFBake(scene);AL.disposeSDFVolume(scene,behavior);assert.equal(AL.isSDFBakeInProgress(scene),false);AL.doStepPostEvents(scene);assert.equal(vol.texture,null);
const b2={};const v2=AL.registerSDFVolume(scene,{getRenderer:()=>null},b2,{resX:8,resY:8,resZ:4});AL.startSDFBake(scene);
// Force a known field, then compare the incremental EDT with its direct reference.
const bs=state.sdfBakeState;bs.phase=1;bs.grid.fill(1e20);bs.grid[0]=0;
const expected=new Float32Array(bs.grid);const sizes=[v2.threeSize.x/8,v2.threeSize.y/8,v2.threeSize.z/4];
AL.__internals.run3DEDT(expected,8,8,4,...sizes);
AL.setSDFBakeBudgetMs(scene,1);advance=0.2;AL.doStepPostEvents(scene);assert.ok(AL.isSDFBakeInProgress(scene),'EDT must yield within its budget');
let frames=1;while(AL.isSDFBakeInProgress(scene)&&frames++<1000)AL.doStepPostEvents(scene);assert.ok(AL.isSDFBakeComplete(scene));assert.ok(frames>2);
const dilation=Math.hypot(...sizes)/2;for(let i=0;i<expected.length;i++)assert.equal(v2.data[i],AL.toHalf(Math.min(65504,Math.max(0,expected[i]-dilation))));
AL.setSDFNormalBias(scene,0);const shader={uniforms:{},vertexShader:T.ShaderLib.standard.vertexShader,fragmentShader:T.ShaderLib.standard.fragmentShader};AL.__internals.injectShaderOnMaterial(mesh.material,state,null);mesh.material.onBeforeCompile(shader);assert.equal(shader.uniforms.uSdfParams.value.z,0);
const bytes=AL.__internals.exportSDFBinary(v2);AL.startSDFBake(scene);assert.equal(AL.loadSDFDataFromBuffer(scene,bytes),true);assert.equal(AL.isSDFBakeInProgress(scene),false);assert.equal(v2.voxelSize,Math.min(...sizes));
const bad=bytes.slice(0);new DataView(bad).setFloat32(32,NaN,true);assert.equal(AL.loadSDFDataFromBuffer(scene,bad),false);
callbacks.unload(scene);assert.equal(sun.castShadow,true);assert.equal(mesh.material.__alInjection,null);

// 'Native' hands shadowing back to GDevelop entirely: the clustered light loop still runs, but the
// engine's own lights and their shadow checkboxes are left untouched. 'Off' keeps its existing
// meaning of no shadows at all, asserted above.
AL.setShadowMode(scene,'Native');AL.__internals.updateCSM(scene,camera);
assert.equal(sun.castShadow,true,'Native must leave the native Sun casting');
AL.setShadowMode(scene,'Auto');AL.setSunShadows(scene,'Cascades');AL.__internals.updateCSM(scene,camera);
assert.equal(sun.castShadow,false,'Auto shadows the Sun with cascades, so it takes the flag over');
assert.equal(AL.shadowState(scene).lights.length,3,'Auto must build Sun cascades');
AL.setShadowMode(scene,'Native');AL.__internals.updateCSM(scene,camera);
assert.equal(sun.castShadow,true,'returning to Native must restore the authored flag');
assert.equal(AL.shadowState(scene).lights.length,0,'Native must release the cascade lights');

// Auto permits everything, so it must take the Sun over and compile the local shadow-map path in.
// Demand gating, which decides what is actually allocated, lands separately.
AL.setShadowMode(scene,'Auto');AL.__internals.updateCSM(scene,camera);
assert.equal(sun.castShadow,false,'Auto shadows the Sun with cascades');
assert.equal(AL.shadowState(scene).lights.length,3,'Auto must build Sun cascades');
// stateOf(scene), not the captured `state`: the unload above dropped that one, so the mode reads
// below must come from the scene state the mode setters are actually writing to.
AL.__internals.injectShaderOnMaterial(mesh.material,AL.stateOf(scene),null);
assert.ok(mesh.material.__alInjection.localMaps,'Auto must permit local shadow maps');
assert.ok(/\|LSM/.test(mesh.material.__alInjection.key),'Auto program key must carry the local-map variant');
AL.setShadowMode(scene,'Off');
AL.__internals.injectShaderOnMaterial(mesh.material,AL.stateOf(scene),null);
assert.equal(mesh.material.__alInjection.localMaps,false,'Off permits no local shadow maps');
AL.setShadowMode(scene,'Auto');

console.log('Shadow runtime checks passed: authoritative modes, manager takeover, authored mesh flags, mirrored fitting, snapping, teardown, incremental EDT, zero bias and binary validation.');

// --- Shadow-map budget is weighted by FACE COUNT, and slots park visible ---------------------
// A point light renders six cube faces per update while a spot renders one. Counting both as "1"
// let MaxShadowMapUpdatesPerFrame=2 permit twelve face renders in a frame, a six-fold overshoot of
// the budget whose whole purpose is to stop that spike.
{
  const spot = new T.SpotLight(0xffffff, 0); spot.castShadow = true;
  const point = new T.PointLight(0xffffff, 0); point.castShadow = true;
  assert.equal(AL.__internals.slotFaceCost({ light: spot }), 1, 'a spot costs one depth pass');
  assert.equal(AL.__internals.slotFaceCost({ light: point }), 6, 'a point costs six, one per cube face');
  assert.equal(AL.__internals.slotFaceCost({ light: null }), 1, 'an empty slot must not divide by zero');

  // Parking must leave the light VISIBLE. Hiding it changes NUM_SPOT_LIGHT_SHADOWS, which
  // recompiles every material in the scene - the 3.2s hitch this replaces.
  const parked = { light: new T.SpotLight(0xffffff, 5) };
  parked.light.castShadow = true;
  parked.light.visible = true;
  AL.__internals.parkSlotLight(parked);
  // Hidden, not visible. Keeping parked lights visible pinned 8 spotShadowMap[] texture units for
  // the scene's life and pushed the program past the sampler limit — a white screen, not a hitch.
  assert.equal(parked.light.visible, false, 'a parked slot light must be hidden, or it holds a texture unit forever');
  assert.equal(parked.light.intensity, 0, 'a parked slot light must contribute no radiance');
  assert.equal(parked.light.shadow.autoUpdate, false, 'a parked slot must not auto-render its map');
  assert.equal(parked.light.shadow.needsUpdate, false, 'and must not be queued for one');
}

console.log('Shadow-map budget checks passed: face-count weighting and visible slot parking.');

// --- The texture-unit verdict must be settled before any material compiles -------------------
// Decided lazily it answers "affordable" on frame 0 and the real answer on frame 1, which flips
// AL_LOCAL_SHADOW_MAPS and recompiles every material in the scene — a visible stutter the moment a
// light is added, and one that looks like a rendering bug rather than a cache-key bug.
{
  const s2 = {getGame:()=>({getRenderer:()=>({getThreeRenderer:()=>renderer})}),
              getLayer:()=>({getRenderer:()=>({getThreeScene:()=>root,getThreeCamera:()=>camera})})};
  const st2 = AL.registerSceneManager(s2);
  assert.notEqual(st2.__localMapsAffordable, undefined,
    'registerSceneManager must resolve the texture-unit verdict, not leave it for the first step');
  const first = AL.__internals.localMapsEnabled(st2);
  const second = AL.__internals.localMapsEnabled(st2);
  assert.equal(first, second, 'the verdict must not change between reads');
}

console.log('Texture-unit verdict is settled at registration, before any material compiles.');

// --- The affordability verdict must DISABLE, not merely warn ---------------------------------
// It read `affordableSlots > 0`, so on 16-unit hardware it found room for 2 of 4 slots, printed
// "disabled", and then returned affordable — letting all 4 compile and overrun anyway. The warning
// announced the exact failure it then committed.
{
  const units = (n) => ({capabilities:{isWebGL2:true},shadowMap:{enabled:false,type:T.BasicShadowMap,autoUpdate:false},
    getContext:()=>({MAX_TEXTURE_IMAGE_UNITS:0x8872,getParameter:()=>n})});
  const sceneWith = (n) => ({getGame:()=>({getRenderer:()=>({getThreeRenderer:()=>units(n)})}),
    getLayer:()=>({getRenderer:()=>({getThreeScene:()=>root,getThreeCamera:()=>camera})})});

  const tight = sceneWith(16);
  const st = AL.registerSceneManager(tight);
  assert.equal(st.__localMapsAffordable, false,
    '16 units cannot fit 4 native slots (12 reserved + 4x2 = 20) and must be refused, not warned about');

  const roomy = sceneWith(32);
  const st2 = AL.registerSceneManager(roomy);
  assert.equal(st2.__localMapsAffordable, true, '32 units comfortably fits 4 native slots');
}

console.log('Texture-unit affordability disables rather than warning-and-proceeding.');
