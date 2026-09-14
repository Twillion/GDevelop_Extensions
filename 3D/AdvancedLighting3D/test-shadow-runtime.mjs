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
// Cascades are OWNED render targets now, not borrowed DirectionalLights: each cascade used to
// cost two fragment texture units because Three declared directionalShadowMap[N] for the light
// and this extension declared uAlCSMMap<i> for the same texture. c.lights must stay EMPTY, or
// that duplication is back.
assert.equal(c.cascades.length,3,'three cascades must be allocated');
assert.equal(c.lights.length,0,'no cascade DirectionalLight may exist, or Three declares a second sampler per cascade');
// ready stays false here because the stub renderer cannot draw: an undrawn map is all zeros,
// which reads as FULLY SHADOWED, so absent must be reported as not-ready rather than black.
assert.equal(c.ready,false);assert.equal(sun.castShadow,false);assert.equal(sun.intensity,1);
assert.equal(mesh.castShadow,false);assert.equal(mesh.receiveShadow,true);
for(const lambda of [0,0.75,1]){const split=AL.__internals.practicalSplits(2,5000,4,lambda);assert.equal(split[3],5000);assert.ok(split.every((v,i)=>v>(i?split[i-1]:2)));}
for(const r of c.ranges){assert.ok(Math.abs(r.center.x/r.texel-Math.round(r.center.x/r.texel))<1e-8);assert.ok(Math.abs(r.center.y/r.texel-Math.round(r.center.y/r.texel))<1e-8);}
let disposed=0;for(const cascade of c.cascades)cascade.target={dispose:()=>disposed++};
AL.setShadowMode(scene,'Off');assert.equal(disposed,3,'every cascade target must be released');assert.equal(c.cascades.length,0);assert.equal(mesh.castShadow,false);assert.equal(mesh.receiveShadow,true);assert.equal(sun.castShadow,true);assert.equal(renderer.shadowMap.enabled,false);
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
assert.equal(AL.shadowState(scene).cascades.length,3,'Auto must build Sun cascades');
AL.setShadowMode(scene,'Native');AL.__internals.updateCSM(scene,camera);
assert.equal(sun.castShadow,true,'returning to Native must restore the authored flag');
assert.equal(AL.shadowState(scene).cascades.length,0,'Native must release the cascade targets');

// Auto requests every shadow path, but the sampler allocator must keep the linked program inside
// the GPU limit. This mock has WebGL2's 16-unit floor: clustered data + CSM + four Native local
// slots cannot coexist, so CSM wins and the local-map permutation is suppressed.
AL.setShadowMode(scene,'Auto');AL.__internals.updateCSM(scene,camera);
assert.equal(sun.castShadow,false,'Auto shadows the Sun with cascades');
assert.equal(AL.shadowState(scene).cascades.length,3,'Auto must build Sun cascades');
// stateOf(scene), not the captured `state`: the unload above dropped that one, so the mode reads
// below must come from the scene state the mode setters are actually writing to.
// LEAN SCENE. Cascades are owned render targets now, so three of them cost THREE units rather
// than six - Three no longer declares a directionalShadowMap per cascade alongside ours. Those
// three reclaimed units are exactly what lets the local-map block fit here, where it did not
// before. This assertion is the payoff of owning the cascade pass, so it is asserted directly.
AL.__internals.injectShaderOnMaterial(mesh.material,AL.stateOf(scene),null);
assert.equal(mesh.material.__alInjection.localMaps,true,'owned cascades must free enough units for local maps on a lean 16-unit scene');
assert.match(mesh.material.__alInjection.key,/\|LSM/,'the local-map variant must compile when it fits');
// ...and the allocator must STILL refuse when the scene genuinely cannot afford it. Six material
// maps is an ordinary textured asset, not a pathological case.
const heavyMaps=['map','aoMap','emissiveMap','normalMap','roughnessMap','metalnessMap'];
for(const k of heavyMaps)mesh.material[k]={};
AL.__internals.refreshTextureUnitBudget(AL.stateOf(scene),scene);
AL.__internals.injectShaderOnMaterial(mesh.material,AL.stateOf(scene),null);
assert.equal(mesh.material.__alInjection.localMaps,false,'six material maps must push the local-map block back out of a 16-unit budget');
assert.doesNotMatch(mesh.material.__alInjection.key,/\|LSM/,'the rejected local-map variant must not compile');
for(const k of heavyMaps)mesh.material[k]=null;
AL.__internals.refreshTextureUnitBudget(AL.stateOf(scene),scene);
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

// --- Slot ownership follows this frame's rendered clusters, then visual distance --------------
// Shadow selection must happen after clustered binning. Otherwise isInFrustum is stale by one
// frame and a quick camera turn can retain a map behind the player or pop at the screen edge.
{
  const visualRoot = new T.Scene(); visualRoot.scale.y = -1;
  const visualCamera = new T.PerspectiveCamera(60, 1, 1, 5000);
  visualCamera.position.set(0, 0, 0); visualCamera.lookAt(0, 0, -1);
  visualCamera.updateProjectionMatrix(); visualCamera.updateMatrixWorld(true);
  const visualRenderer = {capabilities:{isWebGL2:true},
    shadowMap:{enabled:false,type:T.BasicShadowMap,autoUpdate:false},
    getContext:()=>({MAX_TEXTURE_IMAGE_UNITS:0x8872,getParameter:()=>32})};
  const visualScene = {getGame:()=>({getRenderer:()=>({getThreeRenderer:()=>visualRenderer})}),
    getLayer:()=>({getRenderer:()=>({getThreeScene:()=>visualRoot,getThreeCamera:()=>visualCamera})})};
  const visualState = AL.registerSceneManager(visualScene);
  AL.setSunShadows(visualScene, 'Off');
  AL.applySceneShadowSettings(visualScene, {maxShadowMappedLights:1});

  const pos = {near:{x:0,y:0,z:-300}, far:{x:0,y:0,z:-1000}, side:{x:3000,y:0,z:-400}};
  const obj = (p) => ({getX:()=>p.x,getY:()=>p.y,getZ:()=>p.z,getRenderer:()=>null});
  const opts = {lightType:'Spot',intensity:1,radius:1,castShadow:true,shadowTechnique:'ShadowMap'};
  const near = AL.registerLight(visualScene,obj(pos.near),{},opts);
  const far = AL.registerLight(visualScene,obj(pos.far),{},opts);
  const side = AL.registerLight(visualScene,obj(pos.side),{},opts);
  // Its enormous range SPHERE overlaps the whole camera frustum, but its narrow cone points away.
  // This reproduces the FPS scene: off-screen spotlights used to look visible and occupy all four
  // map slots even though only one or two actual pools of light were on screen.
  side.radius = 40;
  side.spotOuterAngle = 10;
  side.worldDirection.set(1,0,0);
  near.isInFrustum = false; // deliberately stale: this frame's clustered pass must replace it
  AL.doStepPostEvents(visualScene);
  assert.equal(near.__alMapSlot,0,'the nearest visible shadow must own the only slot');
  assert.equal(far.__alMapSlot,-1);
  assert.equal(side.__alMapSlot,-1,'an off-screen light must not reserve a visible shadow slot');
  assert.equal(side.isInFrustum,false,
    'a spotlight range sphere intersecting the view is not enough when its finite cone misses');
  assert.equal(Math.floor(visualState.lightDataArray[near.__alPackedIndex * 16 + 14]),2,
    'the newly selected map slot must reach the packed light record in the same frame');

  pos.near.x = 3000;
  AL.doStepPostEvents(visualScene);
  assert.equal(near.__alMapSlot,-1,'a light leaving the view must release its slot immediately');
  assert.equal(far.__alMapSlot,0,'the next closest visible shadow must take the released slot');
  assert.equal(Math.floor(visualState.lightDataArray[far.__alPackedIndex * 16 + 14]),2,
    'a map hand-off must repack the new owner without a one-frame delay');

  // FPS-camera rotation is applied during behavior post-events. The lighting callback must use
  // that new transform immediately, not the editor camera or the preceding frame's matrix.
  near.active = false; far.active = false;
  visualCamera.lookAt(1,0,0); visualCamera.updateMatrixWorld(true);
  AL.doStepPostEvents(visualScene);
  assert.equal(side.isInFrustum,true,'the same cone must become visible after the FPS camera turns');
  assert.equal(side.__alMapSlot,0,'the newly viewed cone must acquire the shadow slot immediately');
}

console.log('Shadow-map reservation follows current-camera visibility and visual distance.');

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

  // A LEAN scene now fits at 16, and that is the point of owning the cascade pass: 3 cluster +
  // 3 cascades + 4 of our local samplers + 4 of Three's = 14. It did NOT fit while each cascade
  // cost two units (3 + 6 + 8 = 17), so this assertion is the reclaimed headroom, stated as a number.
  const lean = sceneWith(16);
  const stLean = AL.registerSceneManager(lean);
  assert.equal(stLean.__localMapsAffordable, true,
    'owned cascades must leave a lean 16-unit scene enough room for 4 native local slots');

  // ...and the verdict must still DISABLE rather than merely warn once the scene is genuinely over
  // budget. It once read `affordableSlots > 0`, found room for 2 of 4 slots, printed "disabled",
  // and then returned affordable - announcing the exact overrun it went on to commit.
  const heavy = ['map','aoMap','emissiveMap','normalMap','roughnessMap','metalnessMap'];
  for (const k of heavy) mesh.material[k] = {};
  const tight = sceneWith(16);
  const st = AL.registerSceneManager(tight);
  assert.equal(st.__localMapsAffordable, false,
    'six material maps push 4 native slots past 16 units, and that must be refused, not warned about');
  for (const k of heavy) mesh.material[k] = null;

  const roomy = sceneWith(32);
  const st2 = AL.registerSceneManager(roomy);
  assert.equal(st2.__localMapsAffordable, true, '32 units comfortably fits 4 native slots');

  const noSunRoot = new T.Scene();
  const noSun = {getGame:()=>({getRenderer:()=>({getThreeRenderer:()=>units(16)})}),
    getLayer:()=>({getRenderer:()=>({getThreeScene:()=>noSunRoot,getThreeCamera:()=>camera})})};
  const noSunState = AL.registerSceneManager(noSun);
  // THREE, not six: one owned render target per cascade instead of Three's map plus ours.
  assert.equal(noSunState.textureUnitBudget.csmCost, 3);
  assert.equal(noSunState.__localMapsAffordable, true,
    'a scene with no Sun must not reserve inactive CSM samplers at all');

  const exactRoot = new T.Scene();
  const exactSun = new T.DirectionalLight(); exactSun.castShadow = true; exactRoot.add(exactSun);
  const exactMat = new T.MeshStandardMaterial();
  for (const p of ['map','normalMap','roughnessMap','metalnessMap','aoMap','emissiveMap']) exactMat[p] = {};
  exactRoot.add(new T.Mesh(new T.BoxGeometry(), exactMat));
  const exact = {getGame:()=>({getRenderer:()=>({getThreeRenderer:()=>units(16)})}),
    getLayer:()=>({getRenderer:()=>({getThreeScene:()=>exactRoot,getThreeCamera:()=>camera})})};
  const exactState = AL.registerSceneManager(exact);
  AL.setContactShadows(exact, true);
  AL.__internals.refreshTextureUnitBudget(exactState, exact);
  assert.equal(exactState.textureUnitBudget.csm, true,
    'CSM must subtract the native Sun sampler it replaces, and must fit');
  // 3 cluster + 6 material maps + 1 native Sun shadow + 1 contact + (3 cascades - 1 replaced Sun).
  // This was 16 - exactly at the limit - while each cascade cost two units; owning the cascade pass
  // is what turned a scene sitting on the edge into one with three units of headroom.
  assert.equal(exactState.textureUnitBudget.used, 13);
  assert.equal(exactState.textureUnitBudget.localMaps, false);
}

console.log('Texture-unit affordability disables rather than warning-and-proceeding.');
