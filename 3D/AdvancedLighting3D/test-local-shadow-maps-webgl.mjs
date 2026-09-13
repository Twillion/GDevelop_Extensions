/**
 * test-local-shadow-maps-webgl.mjs
 *
 * Real depth maps for clustered SPOT lights — the path that does what the SDF cannot.
 *
 * The decisive assertion is #2: a caster MOVES and its shadow moves with it. The SDF bakes static
 * geometry, so under that path a moving object never casts. If only one test in this file survives,
 * it is that one — it is the entire justification for the feature.
 *
 * Two hard-won rules from the SDF debugging that produced this feature, both applied here:
 *   - the scene is built at x ~ 1800, NOT at the world origin. An `updateMatrixWorld` bug hid for a
 *     long time because every other test placed geometry at 0,0,0.
 *   - a shadow is a REDUCTION in light. Nothing is lit => nothing can darken, however correct the
 *     shadow is, so the light is deliberately bright enough to leave headroom.
 *
 * Run: node AdvancedLighting3D/test-local-shadow-maps-webgl.mjs
 * Needs Chrome (or CHROME_PATH). Writes local-shadow-maps.png next to this file.
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

 const root=new THREE.Scene();root.scale.y=-1;   // GDevelop mirrors Y; up is +Z
 const camera=new THREE.PerspectiveCamera(55,W/H,1,6000);camera.up.set(0,0,1);
 camera.position.set(2050,-1150,430);camera.lookAt(1800,-700,40);camera.updateMatrixWorld(true);

 // Deliberately far from the origin.
 const CX=1800, CY=700;
 const floor=new THREE.Mesh(new THREE.PlaneGeometry(1600,1600),
   new THREE.MeshStandardMaterial({color:0xffffff,roughness:1,metalness:0}));
 floor.position.set(CX,CY,0);floor.receiveShadow=true;root.add(floor);

 const box=new THREE.Mesh(new THREE.BoxGeometry(90,90,140),
   new THREE.MeshStandardMaterial({color:0xffffff,roughness:1,metalness:0}));
 box.position.set(CX,CY,70);box.castShadow=true;box.receiveShadow=true;root.add(box);

 const scene={getGame:()=>({getRenderer:()=>({getThreeRenderer:()=>renderer})}),
              getLayer:()=>({getRenderer:()=>({getThreeScene:()=>root,getThreeCamera:()=>camera})})};
 AL.registerSceneManager(scene);
 AL.setShadowMode(scene,'Auto');

 // Spot well off to one side so the shadow lands on open floor rather than under the box.
 const lightObj={getX:()=>CX-320,getY:()=>CY-300,getZ:()=>420,
   getWidth:()=>1,getHeight:()=>1,getDepth:()=>1,getRenderer:()=>null,
   getAABB:()=>({min:[CX-320,CY-300,420],max:[CX-320,CY-300,420]})};
 const lightBeh={};
 const LIGHT={lightType:'Spot',intensity:60,radius:14,colorMode:'RGB',lightColor:'255;255;255',
   spotInnerAngle:38,spotOuterAngle:60,flickerMode:'None',castShadow:true,
   shadowTechnique:'ShadowMap',shadowMapSize:1024};
 AL.registerLight(scene,lightObj,lightBeh,LIGHT);

 const draw=()=>{AL.doStepPostEvents(scene);renderer.render(root,camera);};
 const pixels=()=>{const gl=renderer.getContext(),p=new Uint8Array(W*H*4);
   gl.readPixels(0,0,W,H,gl.RGBA,gl.UNSIGNED_BYTE,p);return p;};
 const luma=(p,i)=>p[i]*0.299+p[i+1]*0.587+p[i+2]*0.114;
 // Centroid of the darkened region, in pixels. Null when nothing darkened.
 const darkCentroid=(base,test)=>{
   let n=0,sx=0,sy=0;
   for(let y=0;y<H;y++)for(let x=0;x<W;x++){
     const i=(y*W+x)*4, a=luma(base,i), b=luma(test,i);
     if(a>12&&a-b>10){n++;sx+=x;sy+=y;}
   }
   return n?{n,x:+(sx/n).toFixed(1),y:+(sy/n).toFixed(1)}:{n:0,x:null,y:null};
 };

 const out={revision:THREE.REVISION};

 /* --- 1. a shadow exists at all --------------------------------------------------------- */
 AL.updateLight(scene,lightObj,lightBeh,{...LIGHT,castShadow:false});
 for(let i=0;i<4;i++)draw();
 const noShadow=pixels();
 out.litPixels=(()=>{let n=0;for(let i=0;i<noShadow.length;i+=4)if(luma(noShadow,i)>12)n++;return n;})();

 AL.updateLight(scene,lightObj,lightBeh,{...LIGHT,castShadow:true});
 for(let i=0;i<4;i++)draw();
 const shadowA=pixels();
 out.mapped=AL.getShadowMappedLightCount(scene);
 out.shadowA=darkCentroid(noShadow,shadowA);

 /* --- 2. THE assertion: move the caster, the shadow must follow -------------------------
    Each position gets its OWN unshadowed baseline. Comparing the moved box against the baseline
    from its old position would count the box's own silhouette moving as "shadow", which it is
    not — the centroid would shift even with shadows completely broken. */
 box.position.set(CX-150,CY-120,70);   // toward the light: stays well inside the cone
 box.updateMatrixWorld(true);
 AL.updateLight(scene,lightObj,lightBeh,{...LIGHT,castShadow:false});
 for(let i=0;i<4;i++)draw();
 const noShadowB=pixels();
 AL.updateLight(scene,lightObj,lightBeh,{...LIGHT,castShadow:true});
 for(let i=0;i<4;i++)draw();
 const shadowB=pixels();
 out.shadowB=darkCentroid(noShadowB,shadowB);
 out.centroidShift=(out.shadowA.n&&out.shadowB.n)
   ? +Math.hypot(out.shadowA.x-out.shadowB.x,out.shadowA.y-out.shadowB.y).toFixed(1) : 0;

 /* --- 3. caching: a still scene must stop re-rendering maps ------------------------------ */
 for(let i=0;i<8;i++)draw();                       // let it settle
 let updatesWhileStill=0;
 for(let i=0;i<12;i++){draw();updatesWhileStill+=AL.getShadowMapUpdatesThisFrame(scene);}
 out.updatesWhileStill=updatesWhileStill;

 /* --- 4. ...and start again when something moves ----------------------------------------- */
 box.position.set(CX-140,CY-90,70);box.updateMatrixWorld(true);
 draw();
 out.updatesAfterMove=AL.getShadowMapUpdatesThisFrame(scene);

 /* --- 5. the per-frame update budget is respected ---------------------------------------- */
 AL.setMaxShadowMapUpdatesPerFrame(scene,1);
 box.position.set(CX+40,CY+40,70);box.updateMatrixWorld(true);
 draw();
 out.updatesUnderBudget1=AL.getShadowMapUpdatesThisFrame(scene);

 /* --- 6. turning maps off must not leave a stale shadow behind --------------------------- */
 AL.setShadowMode(scene,'Off');
 for(let i=0;i<3;i++)draw();
 out.mappedAfterOff=AL.getShadowMappedLightCount(scene);

 AL.setShadowMode(scene,'Auto');
 box.position.set(CX,CY,70);box.updateMatrixWorld(true);
 for(let i=0;i<4;i++)draw();

 /* --- 7. POINT lights: six cube faces instead of one perspective map --------------------- */
 AL.setShadowMode(scene,'Auto');
 box.position.set(CX,CY,70);box.updateMatrixWorld(true);
 const POINT={...LIGHT,lightType:'Point',intensity:80,radius:14};
 AL.updateLight(scene,lightObj,lightBeh,{...POINT,castShadow:false});
 for(let i=0;i<6;i++)draw();
 const noPoint=pixels();
 out.pointLit=(()=>{let n=0;for(let i=0;i<noPoint.length;i+=4)if(luma(noPoint,i)>12)n++;return n;})();
 AL.updateLight(scene,lightObj,lightBeh,{...POINT,castShadow:true});
 for(let i=0;i<6;i++)draw();
 const pointA=pixels();
 out.pointShadowA=darkCentroid(noPoint,pointA);
 out.pointMapped=AL.getShadowMappedLightCount(scene);

 // And it must track a moving caster too, each position against its own baseline.
 box.position.set(CX-150,CY-120,70);box.updateMatrixWorld(true);
 AL.updateLight(scene,lightObj,lightBeh,{...POINT,castShadow:false});
 for(let i=0;i<6;i++)draw();
 const noPointB=pixels();
 AL.updateLight(scene,lightObj,lightBeh,{...POINT,castShadow:true});
 for(let i=0;i<6;i++)draw();
 out.pointShadowB=darkCentroid(noPointB,pixels());
 out.pointCentroidShift=(out.pointShadowA.n&&out.pointShadowB.n)
   ? +Math.hypot(out.pointShadowA.x-out.pointShadowB.x,out.pointShadowA.y-out.pointShadowB.y).toFixed(1) : 0;

 // Back to a spot so the captured image and diagnostics describe the spot path.
 AL.updateLight(scene,lightObj,lightBeh,{...LIGHT,castShadow:true});
 box.position.set(CX,CY,70);box.updateMatrixWorld(true);
 for(let i=0;i<5;i++)draw();

 /* --- diagnostics: where does the chain break if no shadow appears? ---------------------- */
 const ls=AL.__internals.localShadowStateOf(scene);
 const s0=ls.slots[0];
 out.diag={
   slotLive:!!(s0&&s0.live),
   hasMap:!!(s0&&s0.light.shadow&&s0.light.shadow.map),
   lightLocal:s0?s0.light.position.toArray().map(v=>+v.toFixed(1)):null,
   targetLocal:s0?s0.light.target.position.toArray().map(v=>+v.toFixed(1)):null,
   angleDeg:s0?+(s0.light.angle*180/Math.PI).toFixed(1):null,
   camFar:s0?+s0.light.shadow.camera.far.toFixed(1):null,
   visible:s0?s0.light.visible:null,
   intensity:s0?s0.light.intensity:null,
   shadowMatrix:s0?s0.light.shadow.matrix.elements.map(function(v){return +v.toFixed(4);}):null,
   mapTexSize:(s0&&s0.light.shadow.map)?[s0.light.shadow.map.width,s0.light.shadow.map.height]:null,
   rendererShadowEnabled:renderer.shadowMap.enabled,
   rendererShadowAuto:renderer.shadowMap.autoUpdate,
   // Read the depth target directly. A map that never had geometry drawn into it is a uniform
   // "far" value everywhere; real content varies across the frame.
   // Scan the WHOLE map, not its centre: the centre is the spot's own axis, where only the
   // (non-casting) floor sits, so it is white whether or not the caster was drawn.
   mapScan:(function(){
     if(!s0||!s0.light.shadow.map)return null;
     const M=s0.light.shadow.map,W2=M.width,H2=M.height;
     const buf=new Uint8Array(W2*H2*4);
     try{renderer.readRenderTargetPixels(M,0,0,W2,H2,buf);}catch(e){return 'read failed: '+e.message;}
     let nonFar=0,minX=1e9,maxX=-1,minY=1e9,maxY=-1;
     for(let y=0;y<H2;y++)for(let x=0;x<W2;x++){
       const i=(y*W2+x)*4;
       // RGBA-packed depth: "far" packs to 255,255,255,255.
       if(!(buf[i]===255&&buf[i+1]===255&&buf[i+2]===255)){
         nonFar++;if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;
       }
     }
     return nonFar?{nonFar,pct:+(100*nonFar/(W2*H2)).toFixed(2),
                    bbox:[minX,minY,maxX,maxY]}:{nonFar:0};
   })(),
   castersWithCastShadow:(function(){
     let n=0,tot=0;
     root.traverse(function(o){if(o.isMesh){tot++;if(o.castShadow)n++;}});
     return n+'/'+tot;
   })()
 };
 let md=null;
 root.traverse(function(o){
   if(md||!o.isMesh||!o.material||!o.material.__alUniforms)return;
   const u=o.material.__alUniforms;
   md={define:!!(o.material.defines&&o.material.defines.AL_LOCAL_SHADOW_MAPS),
       params0:u.uAlLocalParams?u.uAlLocalParams.value[0].toArray().map(v=>+v.toFixed(4)):null,
       mapBound:!!(u.uAlLocalMap0&&u.uAlLocalMap0.value),
       mapSizeUniform:u.uAlLocalMapSize?u.uAlLocalMapSize.value:null};
 });
 out.matDiag=md;

 out.image=renderer.domElement.toDataURL();
 out.glError=renderer.getContext().getError();
 return out;
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
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'al-local-maps-'));
const chrome = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--use-gl=angle',
   '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-first-run',
   '--no-default-browser-check', 'about:blank'], { windowsHide: true, stdio: 'ignore' });

let ws, failed = 0;
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
  let id = 0; const pending = new Map(), errors = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id) { const p = pending.get(m.id); pending.delete(m.id); if (m.error) p.reject(m.error); else p.resolve(m.result); }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value || a.description).join(' '));
    if (m.method === 'Log.entryAdded' && (m.params.entry.level === 'error' || m.params.entry.text.includes('GL_INVALID'))) errors.push(m.params.entry.text);
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => { pending.set(++id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port + '/' });
  for (let i = 0; i < 100; i++) { const r = await send('Runtime.evaluate', { expression: 'typeof window.run' }); if (r.result.value === 'function') break; await new Promise((r) => setTimeout(r, 100)); }
  const out = await send('Runtime.evaluate', { expression: 'window.run()', awaitPromise: true, returnByValue: true });
  if (out.exceptionDetails) throw Error(JSON.stringify(out.exceptionDetails));
  const d = out.result.value; const image = d.image; delete d.image;
  console.log(JSON.stringify({ ...d, errors }, null, 2));
  if (image) fs.writeFileSync(path.join(root, '3D/AdvancedLighting3D/local-shadow-maps.png'), Buffer.from(image.split(',')[1], 'base64'));

  const check = (label, cond, detail) => {
    if (cond) console.log('  ok   ' + label);
    else { failed++; console.log('  FAIL ' + label + (detail ? ' — ' + detail : '')); }
  };
  console.log('');
  check('the light got a shadow map', d.mapped === 1, `mapped=${d.mapped}`);
  check('the scene is lit (a shadow needs light to remove)', d.litPixels > 2000, `lit=${d.litPixels}`);
  check('a shadow renders', d.shadowA.n > 200, `darkened=${d.shadowA.n}`);
  check('MOVING THE CASTER MOVES THE SHADOW', d.centroidShift > 20,
    `centroid moved ${d.centroidShift}px (${JSON.stringify(d.shadowA)} -> ${JSON.stringify(d.shadowB)})`);
  check('a still scene stops re-rendering maps', d.updatesWhileStill === 0, `updates=${d.updatesWhileStill}`);
  check('a moving caster dirties the map again', d.updatesAfterMove >= 1, `updates=${d.updatesAfterMove}`);
  check('the per-frame update budget is respected', d.updatesUnderBudget1 <= 1, `updates=${d.updatesUnderBudget1}`);
  check('turning maps off releases the slots', d.mappedAfterOff === 0, `mapped=${d.mappedAfterOff}`);
  check('a POINT light gets a shadow map', d.pointMapped === 1, `mapped=${d.pointMapped}`);
  check('a POINT light renders a shadow', d.pointShadowA.n > 200, `darkened=${d.pointShadowA.n}`);
  check('a POINT light shadow follows its caster', d.pointCentroidShift > 15,
    `moved ${d.pointCentroidShift}px (${JSON.stringify(d.pointShadowA)} -> ${JSON.stringify(d.pointShadowB)})`);
  check('no GL errors', d.glError === 0 && errors.length === 0, JSON.stringify(errors));
  console.log('');
  console.log(failed ? `${failed} FAILED` : 'LOCAL SHADOW MAPS WORK — including a moving caster.');
} finally { if (ws) ws.close(); chrome.kill(); server.close(); }
process.exitCode = failed ? 1 : 0;
