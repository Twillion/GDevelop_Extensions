import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const ctx=vm.createContext({console,performance,gdjs:{},WeakRef});
for(const file of ['../gdjs-harness/runtime/pixi-renderers/three.js','../../MaterialMaster/ShaderChain.runtime.js','ClusteredDetail.runtime.js'])vm.runInContext(fs.readFileSync(path.join(here,file),'utf8'),ctx);
const {THREE:T,gdjs}=ctx,CD=gdjs.__clusteredDetail;
const root=new T.Scene();root.scale.y=-1;
const scene={getGame:()=>({getRenderer:()=>({getThreeRenderer:()=>({capabilities:{isWebGL2:true}})})}),
  getLayer:()=>({getRenderer:()=>({getThreeScene:()=>root})}),getTimeManager:()=>({getElapsedTime:()=>16})};
const m=CD.manager(scene),camera=new T.PerspectiveCamera(60,1,1,1000);
camera.position.set(100,-200,100);camera.lookAt(100,-200,0);camera.updateMatrixWorld(true);
let n=0;function test(name,run){run();n++;console.log('ok '+name);}
test('projection includes GDevelop Y reflection and non-origin translation',()=>{
 const id=m.spawn({x:100,y:200,z:0,width:20,height:30,depth:10});
 const d=m.find(id);const p=new T.Vector3(100,-200,0).applyMatrix4(d.inverse);
 assert.ok(p.length()<1e-6);assert.equal(d.center.y,-200);
 assert.ok(Math.abs(new T.Vector3(110,-200,0).applyMatrix4(d.inverse).x-.5)<1e-6);
});
test('surface normal alignment and finite zero-normal fallback',()=>{
 for(const normal of [[1,0,0],[0,1,0],[0,0,0]]){
 const d=m.find(m.spawn({normal}));assert.ok(d.inverse.elements.every(Number.isFinite));
 if(normal[1])assert.ok(new T.Vector3(0,0,1).transformDirection(d.matrix).distanceTo(new T.Vector3(0,-1,0))<1e-6);
 }
});
test('cluster headers reference valid full-capacity texels, including near-plane crossing',()=>{
 m.spawn({x:100,y:200,z:100,width:500,height:500,depth:500});m.prepare(camera);
 assert.ok(m.grid.some(v=>v>0));
 for(let i=0;i<m.grid.length;i+=2){assert.ok(m.grid[i]+m.grid[i+1]<=m.indices.length);assert.ok(m.grid[i+1]<=32);}
 assert.ok(m.data.every(Number.isFinite));
});
test('lifetime fading, removal and persistent pinned slots',()=>{
 const id=m.spawn({lifetime:2,fade:1});const pinned=m.spawn({lifetime:-1});m.tick(1.5);m.prepare(camera);
 const slot=m.slots.findIndex(d=>d?.id===id);assert.equal(m.data[slot*24+18],.5);
 m.tick(.6);assert.equal(m.find(id),undefined);assert.ok(m.find(pinned));m.clear();assert.equal(m.count,1);
});
test('all-pinned full capacity rejects new decals; shrink preserves pins',()=>{
 m.resize(64);while(m.count<64)m.spawn({lifetime:-1});assert.equal(m.spawn(),-1);
 assert.ok(m.resize(128));while(m.count<65)m.spawn({lifetime:-1});assert.equal(m.resize(64),false);
});
test('capacity overflow evicts oldest dynamic decal, never a pinned slot',()=>{
 const local=new CD.Manager(scene,'',64),pin=local.spawn({lifetime:-1}),old=local.spawn();
 for(let i=0;i<62;i++)local.spawn();local.spawn();assert.ok(local.find(pin));assert.equal(local.find(old),undefined);local.dispose();
});
test('crowded clusters keep newest 32 in deterministic blend order',()=>{
 const local=new CD.Manager(scene,'',64);
 for(let i=0;i<40;i++)local.spawn({x:100,y:200,z:0,width:100,height:100,depth:100});local.prepare(camera);
 const h=local.grid.findIndex((v,i)=>i%2===1&&v===32);assert.ok(h>=0);const off=local.grid[h-1];
 assert.deepEqual(Array.from(local.indices.slice(off,off+32)),Array.from({length:32},(_,i)=>i+8));
 assert.ok(local.overflow>0);local.dispose();
});
test('receiver clone isolation, other ShaderChain injectors, replacement and restoration',()=>{
 const original=new T.MeshStandardMaterial(),mesh=new T.Mesh(new T.BoxGeometry(),original);root.add(mesh);
 const object={get3DRendererObject:()=>mesh,getLayer:()=>''},b={_getEnabled:()=>true,_getLayerMask:()=>3};
 original.__testActive=true;
 gdjs.__m3dShaderChain.register({id:'testOther',order:100,isActive:m=>!!m.__testActive,key:()=> '1',inject:s=>{s.fragmentShader+='\n// other';}});
 CD.receive(scene,object,b);assert.notEqual(mesh.material,original);assert.equal(original.__cdState,undefined);
 const shader={vertexShader:T.ShaderLib.standard.vertexShader,fragmentShader:T.ShaderLib.standard.fragmentShader,uniforms:{}};
 mesh.material.onBeforeCompile(shader);assert.ok(shader.fragmentShader.includes('// other'));assert.ok(shader.fragmentShader.includes('cdHeader'));
 assert.equal(shader.uniforms.cdMask.value,3);
 const replacement=new T.MeshPhysicalMaterial();mesh.material=replacement;CD.receive(scene,object,b);
 assert.notEqual(mesh.material,replacement);CD.removeBehavior(scene,b);assert.equal(mesh.material,replacement);
});
test('hidden authored anchor tracks full world transform and is cleaned up',()=>{
 const mesh=new T.Mesh(new T.BoxGeometry(20,30,10),new T.MeshBasicMaterial());root.add(mesh);
 mesh.position.set(100,200,0);mesh.rotation.z=.3;mesh.visible=false;
 let op=1,em=1,rough=-1;
 const b={_getOpacity:()=>op,_getEmissiveIntensity:()=>em,_getRoughness:()=>rough};
 const obj={get3DRendererObject:()=>mesh,getLayer:()=>''};
 const other={...scene};CD.anchor(other,obj,b);CD.tick(other);const mm=CD.manager(other);assert.equal(mm.count,1);
 const d=mm.slots.find(Boolean);assert.equal(d.center.y,-200);assert.equal(d.opacity,1);
 const frameBefore=mm.frame;mesh.position.x=300;op=.4;em=3;rough=.8;CD.tick(other);
 assert.equal(d.center.x,300);assert.equal(d.opacity,.4);assert.equal(d.emissive,3);assert.equal(d.roughness,.8);
 assert.ok(mm.frame>frameBefore);
 CD.removeBehavior(other,b);assert.equal(mm.count,0);CD.dispose(other);
});
test('setters for appearance and normal/surface atlases update manager and uniforms',()=>{
 const local=new CD.Manager(scene,'',64);const id=local.spawn({opacity:1,cutoff:60});
 const d=local.find(id);assert.ok(d);
 const frame0=local.frame;
 d.opacity=.5;d.roughness=.2;d.metalness=.9;d.mask=7;local.frame++;
 assert.equal(d.opacity,.5);assert.equal(d.roughness,.2);assert.equal(d.metalness,.9);assert.equal(d.mask,7);
 assert.ok(local.frame>frame0);
 const dummyTex=new T.DataTexture(new Uint8Array(4),1,1);
 const oldGame=scene.getGame;scene.getGame=()=>({...oldGame(),getImageManager:()=>({getThreeTexture:()=>dummyTex})});
 assert.ok(local.setAtlas(1,'dummyNormal'));assert.equal(local.uniforms.cdChannels.value.x,1);
 assert.ok(local.setAtlas(2,'dummySurface'));assert.equal(local.uniforms.cdChannels.value.y,1);
 local.dispose();
});
test('generated extension has valid schema and executable public spawn wrappers',()=>{
 const json=JSON.parse(fs.readFileSync(path.join(here,'ClusteredDetail.json')));
 assert.equal(json.eventsBasedBehaviors.length,2);assert.ok(json.eventsBasedBehaviors.every(b=>b.propertyDescriptors.length));
 const onSceneLoaded=json.eventsFunctions.find(f=>f.name==='onSceneLoaded');
 assert.ok(onSceneLoaded);assert.equal(onSceneLoaded.private,true);assert.equal(onSceneLoaded.functionType,'Action');
 const expressions=json.eventsFunctions.filter(f=>f.functionType==='Expression');
 assert.equal(expressions.length,5);
 for(const e of expressions){assert.equal(e.expressionType,'number');assert.equal(e.sentence,'');}
 const other={...scene};ctx.runtimeScene=other;
 ctx.eventsFunctionContext={getArgument:k=>({X:4,Y:5,Z:6,NormalZ:1,Width:10,Height:10,Depth:10,AtlasIndex:0,BlendMode:'AlphaBlend',Lifetime:30,FadeDuration:1,Layer:''}[k]??0)};
 vm.runInContext('(function(){'+json.eventsFunctions.find(f=>f.name==='SpawnDecalOnSurface').events[0].inlineCode+'})()',ctx);
 assert.equal(CD.manager(other).count,1);CD.dispose(other);
});
CD.dispose(scene);console.log(`${n} runtime tests passed.`);
