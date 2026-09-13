import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const html=`<!doctype html><canvas id="c"></canvas><script src="/three.js"></script>
<script>var gdjs={};</script><script src="/chain.js"></script><script src="/runtime.js"></script><script>
window.run=()=>{
 const CD=gdjs.__clusteredDetail,T=THREE,W=256,H=256;
 const renderer=new T.WebGLRenderer({canvas:document.getElementById('c'),antialias:false,preserveDrawingBuffer:true});
 renderer.setSize(W,H);renderer.setClearColor(0x000000);renderer.outputColorSpace=T.LinearSRGBColorSpace;
 const root=new T.Scene();root.scale.y=-1;
 const camera=new T.PerspectiveCamera(60,1,1,1000);camera.position.set(1800,-700,150);camera.lookAt(1800,-700,0);
 const mesh=new T.Mesh(new T.PlaneGeometry(500,500),new T.MeshStandardMaterial({color:0xffffff,roughness:.8}));
 mesh.position.set(1800,700,0);root.add(mesh);root.add(new T.AmbientLight(0xffffff,2));
 const scene={getGame:()=>({getRenderer:()=>({getThreeRenderer:()=>renderer}),getImageManager:()=>({getThreeTexture:()=>atlas})}),
 getLayer:()=>({getRenderer:()=>({getThreeScene:()=>root})}),getTimeManager:()=>({getElapsedTime:()=>0})};
 const object={get3DRendererObject:()=>mesh,getLayer:()=>''},behavior={};
 const atlas=new T.DataTexture(new Uint8Array([255,0,0,255]),1,1);atlas.needsUpdate=true;
 CD.receive(scene,object,behavior);const m=CD.manager(scene);m.columns=m.rows=1;m.setAtlas(0,'test');
 const gl=renderer.getContext();
 function draw(cam=camera){CD.tick(scene);renderer.render(root,cam);}
 function pixel(x=128,y=128){const p=new Uint8Array(4);gl.readPixels(x,y,1,1,gl.RGBA,gl.UNSIGNED_BYTE,p);return Array.from(p);}
 const tests=[];function check(name,value){tests.push({name,pass:!!value});}
 draw();const baseline=pixel();
 const id=m.spawn({x:1800,y:700,z:0,width:60,height:60,depth:15});draw();const red=pixel();
 check('alpha decal renders at mirrored, non-origin world position',red[0]>baseline[0]*.8&&red[1]<baseline[1]*.1);
 check('outside projection stays unchanged',pixel(240,240)[1]>baseline[1]*.8);
 m.find(id).mode=1;draw();check('multiply darkens green',pixel()[1]<baseline[1]*.1);
 root.children.find(o=>o.isAmbientLight).intensity=0;m.find(id).mode=3;draw();
 check('emission remains visible without lights',pixel()[0]>150);
 root.children.find(o=>o.isAmbientLight).intensity=2;m.find(id).mode=0;
 camera.position.x+=30;camera.lookAt(1800,-700,0);draw();check('moving camera preserves projection',pixel()[1]<baseline[1]*.1);
 const ortho=new T.OrthographicCamera(-100,100,100,-100,1,1000);ortho.position.set(1800,-700,150);ortho.lookAt(1800,-700,0);draw(ortho);
 check('orthographic camera supported',pixel()[1]<baseline[1]*.1);
 const rt=new T.WebGLRenderTarget(128,128);renderer.setRenderTarget(rt);draw(ortho);const off=new Uint8Array(4);renderer.readRenderTargetPixels(rt,64,64,1,1,off);
 check('offscreen render target uses correct clusters',off[0]>100&&off[1]<10);renderer.setRenderTarget(null);rt.dispose();
 m.find(id).mask=2;draw();check('receiver masks filter decals',pixel()[1]>baseline[1]*.8);m.find(id).mask=1;
 m.find(id).matrix.makeRotationX(Math.PI);m.find(id).matrix.setPosition(1800,-700,0);m.updateTransform(m.find(id));draw();
 check('back-facing projection rejected',pixel()[1]>baseline[1]*.8);m.remove(id);
 const normalId=m.spawn({x:1800,y:700,z:0,width:60,height:60,depth:15,mode:'NormalOnly'});
 const normalAtlas=new T.DataTexture(new Uint8Array([220,128,215,255]),1,1);normalAtlas.needsUpdate=true;
 const oldManager=scene.getGame;scene.getGame=()=>({...oldManager(),getImageManager:()=>({getThreeTexture:()=>normalAtlas})});m.setAtlas(1,'normal');
 root.children.find(o=>o.isAmbientLight).intensity=0;
 const sun=new T.DirectionalLight(0xffffff,2);sun.position.set(1900,700,150);root.add(sun);sun.target.position.set(1800,700,0);root.add(sun.target);
 m.find(normalId).opacity=0;draw();const normalBase=pixel();m.find(normalId).opacity=1;draw();const normalPixel=pixel();
 check('projected normal changes lighting',Math.abs(normalBase[0]-normalPixel[0])>5);
 m.find(normalId).roughness=.1;m.find(normalId).metalness=.7;draw();check('PBR override shader links',gl.getError()===0);
 m.clear();sun.visible=false;root.children.find(o=>o.isAmbientLight).intensity=2;
 const fade=m.spawn({x:1800,y:700,z:0,width:60,height:60,depth:15,lifetime:1,fade:1});m.tick(1.1);draw();check('expired decal disappears',!m.find(fade)&&pixel()[1]>baseline[1]*.8);
 // A physical material exercises clearcoat shader variants too.
 mesh.material=new T.MeshPhysicalMaterial({color:0xffffff,clearcoat:1,roughness:.7});draw();
 check('replacement Physical material reinjected',!!mesh.material.__cdState);
 m.spawn({x:1800,y:700,z:0,width:60,height:60,depth:15});draw();
 check('replacement material renders decals',pixel()[1]<30);
 const image=renderer.domElement.toDataURL();const clone=mesh.material;CD.removeBehavior(scene,behavior);
 check('receiver removal restores original material',mesh.material!==clone&&!mesh.material.__cdState);
 check('all programs runnable',renderer.info.programs.every(p=>!p.diagnostics||p.diagnostics.runnable));
 check('no GL error',gl.getError()===0);CD.dispose(scene);
 return {revision:T.REVISION,tests,baseline,red,normalBase,normalPixel,image};
};</script>`;
const routes={'/three.js':'../gdjs-harness/runtime/pixi-renderers/three.js','/chain.js':'../../MaterialMaster/ShaderChain.runtime.js','/runtime.js':'ClusteredDetail.runtime.js'};
const server=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/'?'text/html':'text/javascript');
 if(req.url==='/')res.end(html);else if(routes[req.url])res.end(fs.readFileSync(path.join(here,routes[req.url])));else{res.statusCode=204;res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'clustered-detail-'));
const chrome=spawn(process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',
 ['--headless=new','--remote-debugging-port=0','--user-data-dir='+profile,'--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-first-run','--no-default-browser-check','about:blank'],{windowsHide:true,stdio:'ignore'});
let ws;
try{
 let port;for(let i=0;i<100;i++){try{port=Number(fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split(/\r?\n/)[0]);break;}catch{await new Promise(r=>setTimeout(r,100));}}
 if(!port)throw Error('Chrome did not start');
 const tabs=await(await fetch('http://127.0.0.1:'+port+'/json')).json();ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);
 await new Promise(r=>ws.onopen=r);let id=0;const pending=new Map(),errors=[];
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result);}
 if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')errors.push(m.params.args.map(a=>a.value||a.description).join(' '));
 if(m.method==='Runtime.exceptionThrown')errors.push(JSON.stringify(m.params.exceptionDetails));};
 const send=(method,params={})=>new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
 await send('Runtime.enable');await send('Page.enable');await send('Page.navigate',{url:'http://127.0.0.1:'+server.address().port});
 for(let i=0;i<100;i++){const r=await send('Runtime.evaluate',{expression:'typeof window.run'});if(r.result.value==='function')break;await new Promise(r=>setTimeout(r,100));}
 const result=await send('Runtime.evaluate',{expression:'window.run()',returnByValue:true,awaitPromise:true});
 if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));
 const data=result.result.value;fs.writeFileSync(path.join(here,'preview.png'),Buffer.from(data.image.split(',')[1],'base64'));delete data.image;
 console.log(JSON.stringify({...data,errors},null,2));process.exitCode=data.tests.some(t=>!t.pass)||errors.length?1:0;
}finally{ws?.close();chrome.kill();server.close();}
