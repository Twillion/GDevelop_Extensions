import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const runtime=fs.readFileSync(path.join(here,'../../MaterialMaster/ShaderChain.runtime.js'),'utf8')+'\n'+fs.readFileSync(path.join(here,'ClusteredDetail.runtime.js'),'utf8');
const NS='gdjs.__clusteredDetail';
const num=(name,value='0',description=name)=>({name,type:'expression',description,defaultValue:String(value)});
const str=(name,value='""',description=name)=>({name,type:'string',description,defaultValue:value});
const choice=(name,values)=>({name,type:'stringWithSelector',description:name,supplementaryInformation:JSON.stringify(values),defaultValue:JSON.stringify(values[0])});
const layer=()=>str('Layer','""','3D layer containing the decals and receiving objects');
const argument=name=>`eventsFunctionContext.getArgument(${JSON.stringify(name)})`;
const event=(code,withRuntime=false)=>[{type:'BuiltinCommonInstructions::JsCode',inlineCode:(withRuntime?runtime+'\n':'')+code,parameterObjects:'',useStrict:true}];
function fn(name,type,parameters,code,description=name,withRuntime=false) {
  return {name,fullName:name.replace(/([a-z])([A-Z])/g,'$1 $2'),description,functionType:type,
    sentence:type==='Expression'?'':name.replace(/([a-z])([A-Z])/g,'$1 $2')+' '+parameters.map((p,i)=>`${p.name}: _PARAM${i}_`).join(', '),
    ...(type==='Expression'?{expressionType:'number'}:{}),
    private:false,parameters,events:event(code,withRuntime)};
}
const functions=[];
functions.push({
  name:'onSceneLoaded',fullName:'onSceneLoaded',description:'Initializes the ClusteredDetail runtime singleton for the scene.',
  functionType:'Action',sentence:'',private:true,parameters:[],events:event('',true)
});
const modes=['AlphaBlend','Multiply','NormalOnly','EmissiveGlow'];
const common=[num('Width',15),num('Height',15),num('Depth',10),num('AtlasIndex'),choice('BlendMode',modes),num('Lifetime',30),num('FadeDuration',1),layer()];
const fields={X:'x',Y:'y',Z:'z',RotationX:'rx',RotationY:'ry',RotationZ:'rz',Width:'width',Height:'height',Depth:'depth',AtlasIndex:'atlas',BlendMode:'mode',Lifetime:'lifetime',FadeDuration:'fade'};
for(const surface of [true,false]) {
  const params=[num('X'),num('Y'),num('Z'),...(surface?[num('NormalX'),num('NormalY'),num('NormalZ',1)]:[num('RotationX'),num('RotationY'),num('RotationZ')]),...common];
  const options=params.filter(p=>fields[p.name]).map(p=>`${fields[p.name]}:${argument(p.name)}`);
  if(surface)options.push(`normal:[${['NormalX','NormalY','NormalZ'].map(argument)}]`);
  functions.push(fn(surface?'SpawnDecalOnSurface':'SpawnDecalAtTransform','Action',params,
    `if (${NS}.supported(runtimeScene)) ${NS}.manager(runtimeScene,${argument('Layer')}).spawn({${options.join(',')}});`,
    'Spawn a decal in GDevelop layer coordinates. The newest ID is available with LastDecalId; -1 means all slots are pinned. Negative lifetime pins the decal.',true));
}
const pre=`if (!${NS}.supported(runtimeScene)) return;\nconst manager=${NS}.manager(runtimeScene,${argument('Layer')});\n`;
for(const [name,channel] of [['SetDecalAtlasTexture',0],['SetDecalNormalAtlasTexture',1],['SetDecalSurfaceAtlasTexture',2]])
  functions.push(fn(name,'Action',[{name:'AtlasResource',type:'imageResource',description:'Atlas image resource',supplementaryInformation:'image'},layer()],
    pre+`manager.setAtlas(${channel},${argument('AtlasResource')});`,channel===2?'R channel: roughness. G channel: metalness. Use the same cell layout and image dimensions as the color atlas.':'Assign a project image resource. All atlas images must have matching grids and dimensions.'));
functions.push(fn('SetDecalAtlasGrid','Action',[num('Columns',4),num('Rows',4),layer()],pre+`manager.columns=Math.max(1,Math.min(64,Math.floor(Number(${argument('Columns')})||1)));manager.rows=Math.max(1,Math.min(64,Math.floor(Number(${argument('Rows')})||1)));manager.frame++;`));
functions.push(fn('ClearAllDynamicDecals','Action',[layer()],pre+'manager.clear();'));
functions.push(fn('SetMaxDecals','Action',[num('Capacity',128,'Capacity: 64, 128, 256 or 512'),layer()],pre+`manager.resize(${argument('Capacity')});`,'Resize without removing pinned decals. A shrink below the pinned count is rejected.'));
functions.push(fn('RemoveDecal','Action',[num('DecalId'),layer()],pre+`manager.remove(${argument('DecalId')});`));
functions.push(fn('SetDecalAppearance','Action',[num('DecalId'),num('Opacity',1),num('NormalCutoffAngle',60),num('EmissiveIntensity',1),num('Roughness',-1),num('Metalness',-1),num('LayerMask',1),layer()],pre+`
const d=manager.find(${argument('DecalId')});
if(d){
 const safe=(v,f)=>Number.isFinite(Number(v))?Number(v):f;
 d.opacity=Math.max(0,Math.min(1,safe(${argument('Opacity')},1)));
 d.cutoff=Math.cos(Math.max(0.1,Math.min(89.9,safe(${argument('NormalCutoffAngle')},60)))*Math.PI/180);
 d.emissive=Math.max(0,safe(${argument('EmissiveIntensity')},1));
 d.roughness=Math.max(-1,Math.min(1,safe(${argument('Roughness')},-1)));
 d.metalness=Math.max(-1,Math.min(1,safe(${argument('Metalness')},-1)));
 d.mask=Math.max(0,Math.min(65535,safe(${argument('LayerMask')},1)|0));manager.frame++;
}`,'Change a decal by ID. Roughness/metalness -1 leaves the underlying material unchanged. Masks use bits 0–15.'));
functions.push(fn('IsClusteredDetailSupported','Condition',[],`eventsFunctionContext.returnValue=${NS}.supported(runtimeScene);`));
for(const [name,field] of [['ActiveDecalCount','count'],['MaxDecals','capacity'],['DecalCPUTimeMs','timeMs'],['LastDecalId','lastId'],['ClusterOverflowCount','overflow']])
  functions.push(fn(name,'Expression',[layer()],`eventsFunctionContext.returnValue=${NS}.supported(runtimeScene)?${NS}.manager(runtimeScene,${argument('Layer')}).${field}:0;`));

const properties={
  AtlasIndex:['Number','0','Atlas cell index (top-left first)'],BlendMode:['Choice','AlphaBlend','Decal blend mode',modes],
  NormalCutoffAngle:['Number','60','Reject surfaces steeper than this angle in degrees'],Opacity:['Number','1','Opacity from 0 to 1'],
  EmissiveIntensity:['Number','1','Emissive multiplier'],Lifetime:['Number','-1','Seconds; -1 is permanent and pinned'],
  FadeDuration:['Number','1','Fade-out duration in seconds'],LayerMask:['Number','1','16-bit receiver/decal matching mask'],
  Roughness:['Number','-1','Roughness override; -1 leaves unchanged'],Metalness:['Number','-1','Metalness override; -1 leaves unchanged'],
  Enabled:['Boolean','true','Receive projected decals']
};
function behavior(name,keys,isReceiver) {
  const params=[{name:'Object',type:'object',description:'3D object'},{name:'Behavior',type:'behavior',description:'Behavior',supplementaryInformation:'ClusteredDetail::'+name}];
  const start=`const object=eventsFunctionContext.getObjects('Object')[0];if(!object)return;\nconst behavior=object.getBehavior(eventsFunctionContext.getBehaviorName('Behavior'));if(!behavior)return;\n`;
  const life=(name,code,withRuntime=false)=>({...fn(name,'Action',params,start+code,name,withRuntime),private:true});
  return {name,fullName:isReceiver?'Receive clustered decals':'Clustered decal 3D',description:isReceiver?'Project decals on Standard/Physical materials.':'Use this 3D object as a decal volume. Hide the anchor object with a visibility action; its transform still drives the decal.',objectType:'',
    propertyDescriptors:keys.map(key=>({name:key,type:properties[key][0],value:properties[key][1],label:key.replace(/([a-z])([A-Z])/g,'$1 $2'),description:properties[key][2],group:'Decals',extraInformation:properties[key][3]||[]})),
    sharedPropertyDescriptors:[],
    eventsFunctions:[life('onCreated',`${NS}.${isReceiver?'receive':'anchor'}(runtimeScene,object,behavior);`,true),
      life('doStepPostEvents',`${NS}.${isReceiver?'receive':'anchor'}(runtimeScene,object,behavior);`),
      life('onDestroy',`${NS}.removeBehavior(runtimeScene,behavior);`),
      life('onDeActivate',`${NS}.removeBehavior(runtimeScene,behavior);`),
      life('onActivate',`${NS}.${isReceiver?'receive':'anchor'}(runtimeScene,object,behavior);`),
      ...keys.map(key=>fn('Set'+key,'Action',[...params,{name:'Value',type:properties[key][0]==='Boolean'?'yesorno':properties[key][0]==='Choice'?'stringWithSelector':'expression',description:key,...(properties[key][3]?{supplementaryInformation:JSON.stringify(properties[key][3])}:{})}],
        start+`behavior._set${key}(${argument('Value')});`))]
  };
}
const icon='data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#142336"/><path d="m10 42 22 12 22-12-22-12z" fill="#608298"/><path d="m16 18 16-9 16 9v22l-16 9-16-9z" fill="none" stroke="#59dbc1" stroke-width="3"/><circle cx="32" cy="38" r="8" fill="#ffbb5d"/></svg>').toString('base64');
const extension={name:'ClusteredDetail',fullName:'Clustered Detail 3D',version:'0.1.0',author:'Twillion',authorIds:[],category:'3D',
  shortDescription:'Project bullet holes, footprints, paint and glowing marks onto 3D surfaces.',
  description:'WebGL2 clustered forward decals for Standard and Physical materials. Includes projected normal maps, surface roughness/metalness, lifetime fading and pinned editor anchors. Up to 512 decals and 32 overlaps per cluster; newest overlaps win. Performance depends on scene and hardware.',
  tags:['3D','decals','bullet holes','footprints','surface details'],iconUrl:icon,previewIconUrl:icon,helpPath:'',extensionNamespace:'',
  dependencies:[],globalVariables:[],sceneVariables:[],eventsFunctions:functions,
  eventsBasedBehaviors:[behavior('ClusteredDecal3D',Object.keys(properties).filter(k=>k!=='Enabled'),false),behavior('ReceiveClusteredDecals',['Enabled','LayerMask'],true)],eventsBasedObjects:[]};
let blocks=0;
for(const f of [...functions,...extension.eventsBasedBehaviors.flatMap(b=>b.eventsFunctions)])for(const e of f.events){
  if([...e.inlineCode].some(c=>{const n=c.charCodeAt(0);return n<9||n===11||n===12||(n>=14&&n<32);}))throw Error('Control character in '+f.name);
  new Function('runtimeScene','eventsFunctionContext',e.inlineCode);blocks++;
}
fs.writeFileSync(path.join(here,'ClusteredDetail.json'),JSON.stringify(extension,null,2)+'\n');
console.log(`Built ClusteredDetail.json; ${blocks} JavaScript blocks parsed.`);
