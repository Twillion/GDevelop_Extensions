// NOTE on this suite's history — it was once a false positive, and the reason matters.
//
// Its assertion is only "some region darkened". Before the ray-origin fix it passed on 72.5% of the
// frame darkening, identical at every shadow bias: that was not a shadow, it was the ray starting
// inside the bake's solid band and hitting on its first sample. The correct figure is ~3%.
//
// So a bare "something got darker" is not enough to prove a shadow. Check the FRACTION: a single
// box lit by one spot shadows a few percent of the lit area, not most of it. See
// test-sdf-boundary-webgl.mjs, which measures the boundary artefact and a real occluder separately.

/**
 * test-local-sdf-shadow-webgl.mjs
 *
 * Does a CLUSTERED LOCAL LIGHT cast an SDF shadow, in a scene FAR FROM THE WORLD ORIGIN?
 *
 * Two gaps met here and hid a real bug for a long time:
 *
 * 1. test-shadow-webgl.mjs only ever exercised the directional Sun path. It sets shadow mode to
 *    'SDF' with a THREE.DirectionalLight and never registers a clustered light, so the local-light
 *    branch — the `shadowBits & 1u` gate and the 12-step sdfShadow() march inside the clustered
 *    loop — had no coverage at any level.
 *
 * 2. Every other test placed geometry at the world origin. collectBakeGeometry bakes through
 *    mesh.matrixWorld, which Three only refreshes during render(); a bake started from a
 *    pre-events step (where auto-bake runs) read matrices from before the objects were placed.
 *    At the origin that error is invisible. Away from it, every triangle lands somewhere else,
 *    the volume bakes empty, and SDF shadows silently never appear.
 *
 * So this scene is deliberately built at x~1828, y~-688 — not at the origin. It renders with the
 * light's castShadow flag off and then on and counts pixels that got DARKER; nothing else in the
 * scene changes between the two frames. It sweeps intensity because a shadow is a REDUCTION in
 * light: with nothing lit there is nothing to reduce, however correct the distance field is.
 *
 * Exits non-zero if no intensity produces any shadowed pixel.
 *
 * Run: node AdvancedLighting3D/test-local-sdf-shadow-webgl.mjs
 * Needs Chrome (or CHROME_PATH). Writes local-sdf-shadow.png next to this file.
 */

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1'));
const root = path.resolve(decodeURIComponent(here), '../..');

const html = `<!doctype html><canvas id="c" width="384" height="256"></canvas>
<script src="/three.js"></script><script>var gdjs={};</script><script src="/runtime.js"></script><script>
window.run=async function(){
 const AL=gdjs.__advancedLighting3D;
 const W=384,H=256;
 const renderer=new THREE.WebGLRenderer({canvas:document.getElementById('c'),preserveDrawingBuffer:true,antialias:false});
 renderer.setSize(W,H);renderer.setClearColor(0x000000);renderer.toneMapping=THREE.NoToneMapping;

 // GDevelop's 3D root is mirrored on Y and up is +Z.
 const root=new THREE.Scene();root.scale.y=-1;
 const camera=new THREE.PerspectiveCamera(55,W/H,1,5000);camera.up.set(0,0,1);
 camera.position.set(1950,-450,200);camera.lookAt(1791,-735,55);camera.updateMatrixWorld(true);

 // Floor + caster. No Sun, no ambient: the clustered light is the ONLY source, so any pixel that
 // darkens when castShadow flips on is unambiguously the local SDF shadow.
 const floor=new THREE.Mesh(new THREE.PlaneGeometry(4909,5313),
   new THREE.MeshStandardMaterial({color:0xffffff,roughness:1,metalness:0}));
 floor.position.set(2757,2737,-22);root.add(floor);
 // GrassBlock: 50x50x40, GDevelop corner at (1766,710,45) -> centre (1791,735,65)
 const box=new THREE.Mesh(new THREE.BoxGeometry(50,50,40),
   new THREE.MeshStandardMaterial({color:0xffffff,roughness:1,metalness:0}));
 box.position.set(1791,735,65);root.add(box);

 const scene={getGame:()=>({getRenderer:()=>({getThreeRenderer:()=>renderer})}),
              getLayer:()=>({getRenderer:()=>({getThreeScene:()=>root,getThreeCamera:()=>camera})})};
 AL.registerSceneManager(scene);
 AL.setShadowMode(scene,'Auto');

 // One clustered point light, high and off to one side so the box throws a shadow across the floor
 // toward the camera. 6 metres = 600 world units of reach at 100 units/metre.
 let LX=1807,LY=766,LZ=211;
 const lightObj={getX:()=>LX,getY:()=>LY,getZ:()=>LZ,
   getWidth:()=>1,getHeight:()=>1,getDepth:()=>1,getRenderer:()=>null,
   getAABB:()=>({min:[LX,LY,LZ],max:[LX,LY,LZ]})};
 const lightBeh={};
 AL.registerLight(scene,lightObj,lightBeh,{
   lightType:'Point',intensity:1,radius:12,colorMode:'RGB',lightColor:'255;255;255',
   castShadow:false,shadowBias:0.02,sourceRadius:0,shadowTechnique:'SDF'
 });

 // SDF volume tight around floor + box.
 const volBeh={};
 AL.registerSDFVolume(scene,{getRenderer:()=>null},volBeh,{resX:128,resY:128,resZ:128});
 AL.setSDFVolumeBounds(scene,1611,409,-32,2045,968,328);

 const draw=()=>{AL.doStepPostEvents(scene);renderer.render(root,camera);};
 AL.startSDFBake(scene);
 let steps=0;while(AL.isSDFBakeInProgress(scene)&&steps++<20000)draw();
 const baked=AL.isSDFBakeComplete(scene);

 const pixels=()=>{const gl=renderer.getContext(),p=new Uint8Array(W*H*4);
   gl.readPixels(0,0,W,H,gl.RGBA,gl.UNSIGNED_BYTE,p);return p;};
 const luma=(p,i)=>p[i]*0.299+p[i+1]*0.587+p[i+2]*0.114;

 // The one variable never tested: Point (what the harness used) vs Spot (what the project uses).
 // Everything else is held at the project's real values.
 const sweep=[];
 for(const cfg of [
   {label:'spot overhead  (your scene)', lx:1807, ly:766, lz:211},
   {label:'spot off-axis 250u',          lx:1560, ly:600, lz:300},
   {label:'spot off-axis 250u, wide 70deg', lx:1560, ly:600, lz:300, outer:70},
 ]){
   LX=cfg.lx;LY=cfg.ly;LZ=cfg.lz;
   const base={lightType:'Spot',intensity:25,radius:12,colorMode:'Kelvin',
     colorTemperature:2200,spotInnerAngle:25,spotOuterAngle:cfg.outer||45,flickerMode:'None',
     sourceRadius:0,shadowBias:0.999};
   AL.updateLight(scene,lightObj,lightBeh,{...base,castShadow:false});
   draw();draw();const noShadow=pixels();
   let lit=0;for(let i=0;i<noShadow.length;i+=4)if(luma(noShadow,i)>12)lit++;
   AL.updateLight(scene,lightObj,lightBeh,{...base,castShadow:true});
   draw();draw();const withShadow=pixels();
   let darker=0,totalDrop=0;
   for(let i=0;i<noShadow.length;i+=4){
     const a=luma(noShadow,i),b=luma(withShadow,i);
     if(a>12&&a-b>8){darker++;totalDrop+=a-b;}
   }
   sweep.push({cfg:cfg.label,lit,darker,
     darkPct:+(100*darker/Math.max(1,lit)).toFixed(1),
     avgDrop:+(totalDrop/Math.max(1,darker)).toFixed(1)});
 }
 const litPixels=sweep[0].lit;
 // Best bias gets captured as an image for eyeballing.
 const best=sweep[1]||sweep[0];
 LX=1560;LY=600;LZ=300;AL.updateLight(scene,lightObj,lightBeh,{lightType:'Spot',intensity:25,radius:12,colorMode:'Kelvin',colorTemperature:2200,spotInnerAngle:25,spotOuterAngle:45,flickerMode:'None',castShadow:true,shadowBias:0.999});
 draw();draw();const image=renderer.domElement.toDataURL();

 return {revision:THREE.REVISION,baked,steps,litPixels,sweep,best,
         voxel:AL.getSDFVoxelSize(scene),glError:renderer.getContext().getError(),image};
};
</script>`;

const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', req.url === '/' ? 'text/html' : 'text/javascript');
  if (req.url === '/') res.end(html);
  else if (req.url === '/three.js') res.end(fs.readFileSync(path.join(root, 'tools/gdjs-harness/runtime/pixi-renderers/three.js')));
  else if (req.url === '/runtime.js') res.end(
    fs.readFileSync(path.join(root, '3D/MaterialMaster/ShaderChain.runtime.js'), 'utf8') + '\n' +
    fs.readFileSync(path.join(root, '3D/AdvancedLighting3D/AdvancedLighting3D.runtime.js'), 'utf8'));
  else { res.statusCode = 204; res.end(); }
});

await new Promise(r=>server.listen(0,'127.0.0.1',r));
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'al-local-sdf-'));
const chrome=spawn(process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--remote-debugging-port=0','--user-data-dir='+profile,'--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-first-run','--no-default-browser-check','about:blank'],{windowsHide:true,stdio:'ignore'});
let ws;
try{
 let dport;for(let i=0;i<100;i++){try{dport=Number(fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split(/\r?\n/)[0]);break;}catch{}await new Promise(r=>setTimeout(r,100));}
 if(!dport)throw Error('Chrome debugging endpoint unavailable');
 const tabs=await (await fetch('http://127.0.0.1:'+dport+'/json')).json();
 ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);
 await new Promise(r=>ws.onopen=r);
 let id=0;const pending=new Map(),errors=[];
 ws.onmessage=e=>{const m=JSON.parse(e.data);
  if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(m.error)p.reject(m.error);else p.resolve(m.result);}
  if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')errors.push(m.params.args.map(a=>a.value||a.description).join(' '));
  if(m.method==='Log.entryAdded'&&(m.params.entry.level==='error'||m.params.entry.text.includes('GL_INVALID')))errors.push(m.params.entry.text);
  if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);};
 const send=(method,params={})=>new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
 await send('Runtime.enable');await send('Log.enable');await send('Page.enable');
 await send('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/'});
 for(let i=0;i<100;i++){const r=await send('Runtime.evaluate',{expression:'typeof window.run'});if(r.result.value==='function')break;await new Promise(r=>setTimeout(r,100));}
 const out=await send('Runtime.evaluate',{expression:'window.run()',awaitPromise:true,returnByValue:true});
 if(out.exceptionDetails)throw Error(JSON.stringify(out.exceptionDetails));
 const data=out.result.value;const image=data.image;delete data.image;
 console.log(JSON.stringify({...data,errors},null,2));
 if(image)fs.writeFileSync(path.join(root,'3D/AdvancedLighting3D/local-sdf-shadow.png'),Buffer.from(image.split(',')[1],'base64'));
 const anyShadow=data.sweep.some(s=>s.darker>0);
 console.log('');
 console.log(anyShadow
  ? `LOCAL SDF SHADOW RENDERS. ${data.best.cfg}: lit ${data.best.lit}px, shadowed ${data.best.darkPct}%.`
  : 'NO LOCAL SDF SHADOW AT ANY BIAS - the clustered local-light shadow path does not work.');
 process.exitCode=anyShadow?0:1;
}finally{if(ws)ws.close();chrome.kill();server.close();}
