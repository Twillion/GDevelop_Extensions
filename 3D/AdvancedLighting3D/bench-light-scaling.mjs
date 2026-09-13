/**
 * bench-light-scaling.mjs — how does cost grow with light count?
 *
 * READ THIS BEFORE QUOTING ANY NUMBER FROM IT.
 *
 * This runs in headless Chrome on SwiftShader, a SOFTWARE rasteriser. The absolute milliseconds
 * are NOT your frame times and are perhaps one to two orders of magnitude slower than a real GPU.
 * What software rendering does preserve is the SHAPE of the curve: how cost scales as lights are
 * added, and the relative cost of clustered lighting vs SDF shadows vs shadow maps. Use it to find
 * where a knee appears, not to predict FPS.
 *
 * For real numbers: run a GDevelop preview on the target hardware and read its FPS counter.
 *
 * Run: node AdvancedLighting3D/bench-light-scaling.mjs
 */

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1'));
const root = path.resolve(decodeURIComponent(here), '..');

const html = `<!doctype html><canvas id="c" width="640" height="360"></canvas>
<script src="/three.js"></script><script>var gdjs={};</script><script src="/runtime.js"></script><script>
window.run=async function(){
 const AL=gdjs.__advancedLighting3D;
 const W=640,H=360;
 const renderer=new THREE.WebGLRenderer({canvas:document.getElementById('c'),antialias:false});
 renderer.setSize(W,H);renderer.setClearColor(0x101010);renderer.toneMapping=THREE.NoToneMapping;

 const root=new THREE.Scene();root.scale.y=-1;
 const camera=new THREE.PerspectiveCamera(55,W/H,1,8000);camera.up.set(0,0,1);
 camera.position.set(1200,-1600,700);camera.lookAt(900,-900,60);camera.updateMatrixWorld(true);

 const floor=new THREE.Mesh(new THREE.PlaneGeometry(3000,3000),
   new THREE.MeshStandardMaterial({color:0xcccccc,roughness:1,metalness:0}));
 floor.position.set(900,900,0);floor.receiveShadow=true;root.add(floor);

 // A modest prop field, so the depth passes have real work rather than one box.
 const boxes=[];
 for(let i=0;i<24;i++){
   const m=new THREE.Mesh(new THREE.BoxGeometry(70,70,120),
     new THREE.MeshStandardMaterial({color:0xffffff,roughness:0.9,metalness:0}));
   m.position.set(300+(i%6)*220, 300+Math.floor(i/6)*220, 60);
   m.castShadow=true;m.receiveShadow=true;root.add(m);boxes.push(m);
 }

 const scene={getGame:()=>({getRenderer:()=>({getThreeRenderer:()=>renderer})}),
              getLayer:()=>({getRenderer:()=>({getThreeScene:()=>root,getThreeCamera:()=>camera})})};
 AL.registerSceneManager(scene,{maxLights:512});

 const behs=[],objs=[];
 function makeLight(i,technique){
   const gx=250+(i%8)*180, gy=250+Math.floor(i/8)*180, gz=380;
   const o={getX:()=>gx,getY:()=>gy,getZ:()=>gz,getWidth:()=>1,getHeight:()=>1,getDepth:()=>1,
     getRenderer:()=>null,getAABB:()=>({min:[gx,gy,gz],max:[gx,gy,gz]})};
   const b={};
   AL.registerLight(scene,o,b,{lightType:'Spot',intensity:20,radius:9,colorMode:'RGB',
     lightColor:'255;240;220',spotInnerAngle:30,spotOuterAngle:55,flickerMode:'None',
     castShadow:technique!=='none',shadowTechnique:technique==='none'?'None':
       (technique==='map'?'ShadowMap':'SDF'),shadowMapSize:1024});
   objs.push(o);behs.push(b);
 }

 const draw=()=>{AL.doStepPostEvents(scene);renderer.render(root,camera);};
 // Median of per-frame wall clock. Median, not mean: one compile spike must not set the number.
 function timeFrames(n,moveEvery){
   for(let i=0;i<6;i++)draw();                    // warm up shaders and first shadow renders
   const t=[];let upd=0;
   for(let i=0;i<n;i++){
     if(moveEvery){ boxes[i%boxes.length].position.x += (i%2?1:-1)*4;
                    boxes[i%boxes.length].updateMatrixWorld(true); }
     const a=performance.now();draw();t.push(performance.now()-a);
     upd+=AL.getShadowMapUpdatesThisFrame(scene);
   }
   t.sort((x,y)=>x-y);
   return {median:+t[Math.floor(t.length/2)].toFixed(2),
           p95:+t[Math.floor(t.length*0.95)].toFixed(2),
           // Depth-pass count per frame. On a software rasteriser the timing noise swamps the
           // cost of a depth pass, but this counts them directly and is not a timing measurement
           // at all - it is the honest evidence that caching works.
           updates:+(upd/n).toFixed(2)};
 }

 const rows=[];
 // Clustered lighting only, no shadows at all - isolates the cost of the light loop itself.
 AL.setShadowMode(scene,'Off');
 for(const n of [1,2,4,8,16,32,64]){
   while(behs.length<n)makeLight(behs.length,'none');
   const t=timeFrames(40,false);
   rows.push({lights:n,mode:'Off (no shadows)',median:t.median,p95:t.p95,mapped:0,updates:t.updates});
 }
 // Tear the lights down and rebuild them as shadow-mapped spots.
 behs.forEach(b=>AL.destroyLight(scene,b));behs.length=0;objs.length=0;
 AL.setShadowMode(scene,'Maps');
 for(const n of [1,2,4,8]){
   while(behs.length<n)makeLight(behs.length,'map');
   const still=timeFrames(40,false);
   const moving=timeFrames(40,true);
   rows.push({lights:n,mode:'Maps (static scene, cached)',median:still.median,p95:still.p95,
              mapped:AL.getShadowMappedLightCount(scene),updates:still.updates});
   rows.push({lights:n,mode:'Maps (a caster moving every frame)',median:moving.median,p95:moving.p95,
              mapped:AL.getShadowMappedLightCount(scene),updates:moving.updates});
 }
 return {revision:THREE.REVISION,rows,
         note:'SwiftShader software rasteriser - relative shape only, NOT real frame times.'};
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

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'al-bench-'));
const chrome = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--use-gl=angle',
   '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-first-run',
   '--no-default-browser-check', 'about:blank'], { windowsHide: true, stdio: 'ignore' });

let ws;
try {
  let dport;
  for (let i = 0; i < 100; i++) {
    try { dport = Number(fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split(/\r?\n/)[0]); break; }
    catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  if (!dport) throw Error('Chrome debugging endpoint unavailable');
  const tabs = await (await fetch('http://127.0.0.1:' + dport + '/json')).json();
  ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => ws.onopen = r);
  let id = 0; const pending = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id) { const p = pending.get(m.id); pending.delete(m.id); if (m.error) p.reject(m.error); else p.resolve(m.result); } };
  const send = (method, params = {}) => new Promise((resolve, reject) => { pending.set(++id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port + '/' });
  for (let i = 0; i < 100; i++) { const r = await send('Runtime.evaluate', { expression: 'typeof window.run' }); if (r.result.value === 'function') break; await new Promise((r) => setTimeout(r, 100)); }
  const out = await send('Runtime.evaluate', { expression: 'window.run()', awaitPromise: true, returnByValue: true });
  if (out.exceptionDetails) throw Error(JSON.stringify(out.exceptionDetails));
  const d = out.result.value;

  console.log('\n  SOFTWARE RASTERISER (SwiftShader) — relative shape only, NOT real frame times.\n');
  console.log('  lights  mode                                median    p95   mapped  depth passes/frame');
  console.log('  ' + '-'.repeat(66));
  for (const r of d.rows) {
    console.log('  ' + String(r.lights).padStart(5) + '   ' + r.mode.padEnd(34) +
      String(r.median).padStart(7) + String(r.p95).padStart(7) + String(r.mapped).padStart(8) + String(r.updates).padStart(15));
  }
  const off = d.rows.filter((r) => r.mode.startsWith('Off'));
  if (off.length > 1) {
    const per = (off[off.length - 1].median - off[0].median) / (off[off.length - 1].lights - off[0].lights);
    console.log('\n  clustered light loop: ~' + per.toFixed(3) + ' ms per extra light (software)');
  }
} finally { if (ws) ws.close(); chrome.kill(); server.close(); }
