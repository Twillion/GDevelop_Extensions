import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
const here=path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/,'$1'));
const root=path.resolve(decodeURIComponent(here),'../..');
const html=`<!doctype html><canvas id="c" width="384" height="256"></canvas><script src="/three.js"></script><script>var gdjs={};</script><script src="/runtime.js"></script><script>
window.run=async function(){
 const AL=gdjs.__advancedLighting3D;
 const renderer=new THREE.WebGLRenderer({canvas:document.getElementById('c'),preserveDrawingBuffer:true,antialias:false});
 renderer.setSize(384,256);renderer.setClearColor(0x334455);renderer.toneMapping=THREE.NoToneMapping;
 const root=new THREE.Scene();root.scale.y=-1;
 const camera=new THREE.PerspectiveCamera(55,384/256,1,5000);camera.up.set(0,0,1);camera.position.set(550,-850,650);camera.lookAt(0,0,60);camera.updateMatrixWorld(true);
 const sun=new THREE.DirectionalLight(0xffffff,3);sun.position.set(400,-300,900);root.add(sun);root.add(sun.target);
 const floor=new THREE.Mesh(new THREE.PlaneGeometry(2000,2000),new THREE.MeshStandardMaterial({color:0xaaaaaa,roughness:1}));floor.receiveShadow=true;floor.castShadow=false;root.add(floor);
 const box=new THREE.Mesh(new THREE.BoxGeometry(180,180,200),new THREE.MeshPhysicalMaterial({color:0xcc9966,roughness:0.8,clearcoat:0.2}));box.position.set(0,0,100);box.castShadow=true;box.receiveShadow=true;root.add(box);
 root.add(new THREE.AmbientLight(0xffffff,0.2));
 const scene={getGame:()=>({getRenderer:()=>({getThreeRenderer:()=>renderer})}),getLayer:()=>({getRenderer:()=>({getThreeScene:()=>root,getThreeCamera:()=>camera})})};
 const state=AL.registerSceneManager(scene);AL.configureCSM(scene,{distance:2500,mapSize:1024,count:3});
 const glErrors=[];const draw=()=>{AL.doStepPostEvents(scene);renderer.render(root,camera);const e=renderer.getContext().getError();if(e)glErrors.push({mode:AL.shadowState(scene).mode,count:AL.shadowState(scene).count,error:e});};
 const pixels=()=>{const gl=renderer.getContext(),p=new Uint8Array(384*256*4);gl.readPixels(0,0,384,256,gl.RGBA,gl.UNSIGNED_BYTE,p);return p;};
 AL.setShadowMode(scene,'Off');draw();draw();const off=pixels();
 AL.setShadowMode(scene,'Auto');draw();draw();const csm=pixels();
 let changed=0;for(let i=0;i<off.length;i+=4)if(Math.abs(off[i]-csm[i])+Math.abs(off[i+1]-csm[i+1])+Math.abs(off[i+2]-csm[i+2])>10)changed++;
 const ready=AL.shadowState(scene).ready;
 const contain=AL.shadowState(scene).ranges.every((r,i)=>{const l=AL.shadowState(scene).lights[i];l.shadow.updateMatrices(l);return r.corners.every(p=>{const v=p.clone().applyMatrix4(l.shadow.camera.matrixWorldInverse);return Math.abs(v.x)<=r.half+0.001 && Math.abs(v.y)<=r.half+0.001 && -v.z>=0 && -v.z<=l.shadow.camera.far;});});
 // Asking the Sun for a distance field it has not got must visibly DROP its shadow rather than
 // render black or corrupt, and switching back must return the exact CSM image - that round trip
 // is what proves the cascade teardown and rebuild are clean.
 AL.setSunShadows(scene,'DistanceField');draw();draw();const hybrid=pixels();let sunNoVolumeDifference=0;for(let i=0;i<csm.length;i++)sunNoVolumeDifference=Math.max(sunNoVolumeDifference,Math.abs(csm[i]-hybrid[i]));
 AL.setSunShadows(scene,'Cascades');draw();draw();const backToCsm=pixels();let sunRoundTripDifference=0;for(let i=0;i<csm.length;i++)sunRoundTripDifference=Math.max(sunRoundTripDifference,Math.abs(csm[i]-backToCsm[i]));
 const saved=renderer.domElement.toDataURL();
 AL.configureCSM(scene,{count:4});draw();draw();const count4=AL.shadowState(scene).lights.length;AL.configureCSM(scene,{count:2});draw();draw();const count2=AL.shadowState(scene).lights.length;
 const behavior={};const volume=AL.registerSDFVolume(scene,{getRenderer:()=>null},behavior,{resX:24,resY:24,resZ:12});AL.setSDFVolumeBounds(scene,-700,-700,-100,700,700,600);
 AL.startSDFBake(scene);let steps=0;while(AL.isSDFBakeInProgress(scene)&&steps++<2000)draw();
 AL.setSunShadows(scene,'DistanceField');draw();draw();const sdf=AL.isSDFBakeComplete(scene);const sdfPixels=pixels();let sdfChanged=0;for(let i=0;i<off.length;i+=4)if(Math.abs(off[i]-sdfPixels[i])>5)sdfChanged++;
 AL.setShadowMode(scene,'Off');draw();draw();const restored=pixels();let restoreDifference=0;for(let i=0;i<off.length;i++)restoreDifference=Math.max(restoreDifference,Math.abs(off[i]-restored[i]));
 const noCascades=AL.shadowState(scene).lights.length===0;
 return {revision:THREE.REVISION,ready,contain,changed,sunNoVolumeDifference,sunRoundTripDifference,count4,count2,sdf,sdfChanged,steps,restoreDifference,noCascades,glErrors,image:saved,glError:renderer.getContext().getError()};
};</script>`;
const server=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/'?'text/html':'text/javascript');if(req.url==='/')res.end(html);else if(req.url==='/three.js')res.end(fs.readFileSync(path.join(root,'tools/gdjs-harness/runtime/pixi-renderers/three.js')));else if(req.url==='/runtime.js')res.end(
  // ShaderChain first: the band-100 injector registers at module load, and the built extension
  // concatenates them in this order. Serving the runtime alone leaves the chain absent and every
  // clustered/SDF injection is skipped, so the shader compiles but renders unlit.
  fs.readFileSync(path.join(root,'3D/MaterialMaster/ShaderChain.runtime.js'),'utf8')+'\n'+
  fs.readFileSync(path.join(root,'3D/AdvancedLighting3D/AdvancedLighting3D.runtime.js'),'utf8'));else{res.statusCode=204;res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'al-shadow-check-'));
const chrome=spawn(process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--remote-debugging-port=0','--user-data-dir='+profile,'--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-first-run','--no-default-browser-check','about:blank'],{windowsHide:true,stdio:'ignore'});
let ws;try{
 let port;for(let i=0;i<100;i++){try{port=Number(fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]);break;}catch{}await new Promise(r=>setTimeout(r,100));}
 if(!port)throw Error('Chrome debugging endpoint unavailable');
 const tabs=await (await fetch('http://127.0.0.1:'+port+'/json')).json();ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
 let id=0;const pending=new Map(),errors=[];ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(m.error)p.reject(m.error);else p.resolve(m.result);}if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')errors.push(m.params.args.map(a=>a.value||a.description).join(' '));if(m.method==='Log.entryAdded' && (m.params.entry.level==='error'||m.params.entry.text.includes('GL_INVALID')))errors.push(m.params.entry.text);if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);};
 const send=(method,params={})=>new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
 await send('Runtime.enable');await send('Log.enable');await send('Page.enable');await send('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/'});
 for(let i=0;i<100;i++){const r=await send('Runtime.evaluate',{expression:'typeof window.run'});if(r.result.value==='function')break;await new Promise(r=>setTimeout(r,100));}
 const result=await send('Runtime.evaluate',{expression:'window.run()',awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));
 const data=result.result.value;const image=data.image;delete data.image;console.log(JSON.stringify({ ...data,errors },null,2));
 assert.equal(errors.length,0);assert.ok(data.ready&&data.contain&&data.noCascades&&data.sdf);assert.ok(data.changed>50,'CSM must visibly shadow the scene');assert.ok(data.sdfChanged>50,'SDF must visibly shadow the scene');assert.ok(data.sunNoVolumeDifference>0,'DistanceField Sun with no baked volume must visibly drop the Sun shadow, not silently keep cascades');assert.equal(data.sunRoundTripDifference,0,'returning to Cascades must rebuild the identical image');assert.equal(data.restoreDifference,0);assert.equal(data.glError,0);assert.equal(data.glErrors.length,0);assert.equal(data.count4,4);assert.equal(data.count2,2);
 fs.writeFileSync(path.join(root,'3D/AdvancedLighting3D/shadow-validation.png'),Buffer.from(image.split(',')[1],'base64'));
}finally{if(ws)ws.close();chrome.kill();server.close();}
