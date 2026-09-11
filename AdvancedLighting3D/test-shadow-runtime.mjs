import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const here=new URL('.',import.meta.url);
let clock=0,advance=0;
const callbacks={};
const ctx=vm.createContext({console,performance:{now:()=>{clock+=advance;return clock;}},gdjs:{registerRuntimeSceneUnloadedCallback:f=>callbacks.unload=f}});
vm.runInContext(fs.readFileSync(new URL('../Rarely used extensions/gdjs-harness/runtime/pixi-renderers/three.js',here),'utf8'),ctx);
vm.runInContext(fs.readFileSync(new URL('AdvancedLighting3D.runtime.js',here),'utf8'),ctx);
const {THREE:T,gdjs}=ctx,AL=gdjs.__advancedLighting3D;
const root=new T.Scene();root.scale.y=-1;
const camera=new T.PerspectiveCamera(61,1.7,2,8000);camera.up.set(0,0,1);camera.position.set(230,-170,520);camera.lookAt(51,84,36);camera.updateMatrixWorld(true);
const sun=new T.DirectionalLight();sun.position.set(360,170,920);sun.castShadow=true;root.add(sun);root.add(sun.target);
const mesh=new T.Mesh(new T.BoxGeometry(),new T.MeshStandardMaterial());mesh.castShadow=false;mesh.receiveShadow=true;root.add(mesh);
const renderer={capabilities:{isWebGL2:true},shadowMap:{enabled:false,type:T.BasicShadowMap,autoUpdate:false}};
const scene={getGame:()=>({getRenderer:()=>({getThreeRenderer:()=>renderer})}),getLayer:()=>({getRenderer:()=>({getThreeScene:()=>root,getThreeCamera:()=>camera})})};
const state=AL.registerSceneManager(scene);
assert.equal(AL.shadowState(scene).mode,'Hybrid');
for(const mode of ['Off','CSM','SDF','Hybrid']){assert.ok(AL.setShadowMode(scene,mode));assert.equal(AL.shadowState(scene).mode,mode);assert.equal(AL.isSDFShadowsEnabled(scene),mode==='SDF'||mode==='Hybrid');}
assert.equal(AL.setShadowMode(scene,'invalid'),false);
AL.setShadowMode(scene,'CSM');assert.equal(AL.isSDFShadowsEnabled(scene),false);
AL.setShadowMode(scene,'Hybrid');assert.equal(AL.isSDFShadowsEnabled(scene),true);
AL.setShadowMode(scene,'SDF');assert.equal(AL.isSDFShadowsEnabled(scene),true);
AL.setShadowMode(scene,'Hybrid');
const managerA={},managerB={};assert.equal(AL.registerShadowManager(scene,managerA,{mode:'CSM',count:3}),true);assert.equal(AL.registerShadowManager(scene,managerB,{mode:'Hybrid',count:3}),false);assert.equal(AL.shadowState(scene).manager,managerA);AL.destroyShadowManager(scene,managerA);assert.equal(AL.shadowState(scene).manager,managerB);assert.equal(AL.shadowState(scene).mode,'Hybrid');AL.destroyShadowManager(scene,managerB);assert.equal(AL.shadowState(scene).manager,null);assert.equal(AL.shadowState(scene).mode,'Off');AL.setShadowMode(scene,'Hybrid');
AL.__internals.updateCSM(scene,camera);const c=AL.shadowState(scene);
assert.equal(c.lights.length,3);assert.equal(c.ready,false);assert.equal(sun.castShadow,false);assert.equal(sun.intensity,1);
assert.equal(mesh.castShadow,false);assert.equal(mesh.receiveShadow,true);
for(const lambda of [0,0.75,1]){const split=AL.__internals.practicalSplits(2,5000,4,lambda);assert.equal(split[3],5000);assert.ok(split.every((v,i)=>v>(i?split[i-1]:2)));}
for(const r of c.ranges){assert.ok(Math.abs(r.center.x/r.texel-Math.round(r.center.x/r.texel))<1e-8);assert.ok(Math.abs(r.center.y/r.texel-Math.round(r.center.y/r.texel))<1e-8);}
let disposed=0;for(const l of c.lights)l.shadow.map={dispose:()=>disposed++};
AL.setShadowMode(scene,'Off');assert.equal(disposed,3);assert.equal(c.lights.length,0);assert.equal(mesh.castShadow,false);assert.equal(mesh.receiveShadow,true);assert.equal(sun.castShadow,true);assert.equal(renderer.shadowMap.enabled,false);
AL.__internals.updateCSM(scene,camera);assert.equal(sun.castShadow,false,'Off suppresses native Sun shadows');
AL.setShadowMode(scene,'SDF');const behavior={};const vol=AL.registerSDFVolume(scene,{getRenderer:()=>null},behavior,{resX:8,resY:8,resZ:4});
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
console.log('Shadow runtime checks passed: authoritative modes, manager takeover, authored mesh flags, mirrored fitting, snapping, teardown, incremental EDT, zero bias and binary validation.');
