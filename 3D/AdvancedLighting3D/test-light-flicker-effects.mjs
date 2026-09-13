import assert from 'node:assert/strict';
import fs from 'node:fs';
await import('./test-runtime.mjs');
const AL=gdjs.__advancedLighting3D;
const ext=JSON.parse(fs.readFileSync(new URL('./AdvancedLighting3D.json',import.meta.url)));
const fx=ext.eventsBasedBehaviors.find(b=>b.name==='Lightflickereffects');
const tw=ext.eventsBasedBehaviors.find(b=>b.name==='LightTweens');
assert.ok(fx && tw);
assert.ok(!fx.eventsFunctions.some(f=>f.name==='TweenIntensity'));
assert.ok(!tw.propertyDescriptors.some(p=>p.name.startsWith('Flicker')));
const styles=JSON.parse(tw.eventsFunctions.find(f=>f.name==='TweenIntensity').parameters.find(p=>p.name==='Easing').supplementaryInformation);
assert.equal(styles.length,11);
function fixture() {
  let dt=250;
  const scene={getElapsedTime:()=>dt};
  const behaviors={fx:{},tw:{}};
  const object={getRenderer:()=>null,getBehavior:name=>behaviors[name]};
  const light=AL.registerLight(scene,object,{}, {intensity:2,radius:10,colorMode:'RGB',lightColor:'255;0;0'});
  const invoke=(type,name,args={})=>{
    const def=type==='fx'?fx:tw;
    const ctx={getObjects:()=>[object],getBehaviorName:()=>type,getArgument:k=>args[k]};
    for(const e of def.eventsFunctions.find(f=>f.name===name).events) new Function('runtimeScene','eventsFunctionContext',e.inlineCode)(scene,ctx);
    return ctx.returnValue;
  };
  invoke('fx','onCreated');invoke('tw','onCreated');
  return {scene,object,light,behaviors,invoke,setDt:v=>{dt=v;}};
}
const f=fixture();
assert.ok(f.invoke('fx','IsLightConnected') && f.invoke('tw','IsLightConnected'));
for(const style of styles) {
  f.light.intensity=2;
  f.invoke('tw','TweenIntensity',{Target:6,Duration:1,Easing:style,Playback:'Once'});
  f.setDt(250);f.invoke('tw','doStepPreEvents');assert.ok(f.light.intensity>=2 && f.light.intensity<=6);
  f.setDt(750);f.invoke('tw','doStepPreEvents');assert.equal(f.light.intensity,6);assert.equal(f.invoke('tw','IsTweenFinished',{Channel:'Intensity'}),true);
}
// Order independence, independent pauses, no duplicate modulation advance.
for(const order of [['fx','tw'],['tw','fx']]){
  const g=fixture();g.invoke('fx','ApplyFlickerPreset',{Preset:'Breathing'});
  g.invoke('tw','TweenIntensity',{Target:6,Duration:1,Easing:'Linear',Playback:'Once'});
  for(const type of order)g.invoke(type,'doStepPreEvents');
  assert.equal(g.light.intensity,3);
  assert.ok(Math.abs(g.light.currentIntensity-AL.evaluateFlicker('PulseWave',0.25,0.5,0.5,3))<1e-8);
  g.invoke('tw','PauseTweens');for(const type of order)g.invoke(type,'doStepPreEvents');assert.equal(g.light.intensity,3);
  g.invoke('fx','PauseEffects');g.invoke('tw','ResumeTweens');for(const type of order)g.invoke(type,'doStepPreEvents');assert.equal(g.light.intensity,4);
  g.invoke('tw','PauseTweens');g.invoke('tw','onDeActivate');g.invoke('tw','onActivate');assert.equal(g.invoke('tw','IsPaused'),true);
  g.invoke('tw','ResumeTweens');g.invoke('fx','ResumeEffects');g.invoke('fx','TriggerMuzzleFlash',{Duration:1});
  for(const type of order)g.invoke(type,'doStepPreEvents');assert.equal(g.light.muzzleFlashTimer,0.75);
  g.invoke('tw','onDestroy');assert.ok(g.light.flickerController);assert.equal(g.light.tweenController,null);
  g.invoke('fx','StopAllEffects');assert.equal(g.light.currentIntensity,g.light.intensity);
}
f.invoke('tw','TweenRadius',{Target:20,Duration:1,Easing:'Linear',Playback:'PingPong'});f.setDt(1500);f.invoke('tw','doStepPreEvents');assert.equal(f.light.radius,15);
f.invoke('tw','StopTween',{Channel:'Radius'});f.invoke('tw','doStepPreEvents');assert.equal(f.light.radius,15);
f.invoke('tw','TweenColor',{Target:'0;0;255',Duration:1,Easing:'Linear',Playback:'Once'});f.setDt(500);f.invoke('tw','doStepPreEvents');assert.deepEqual(f.light.lightColor,[127.5,0,127.5]);
f.invoke('tw','TweenTemperature',{Target:6500,Duration:1,Easing:'Linear',Playback:'Once'});assert.equal(f.behaviors.tw.__alLightTweens.channels.Color,undefined);f.invoke('tw','doStepPreEvents');assert.equal(f.light.colorMode,'RGB');f.invoke('tw','doStepPreEvents');assert.equal(f.light.colorMode,'Kelvin');
f.invoke('tw','TweenIntensity',{Target:0,Duration:0,Easing:'Linear',Playback:'Once'});assert.equal(f.light.intensity,0);
assert.equal(AL.startLightTween(f.scene,f.behaviors.tw,'Intensity',1,Infinity,'Linear','Once'),false);
const duplicate={};assert.equal(AL.registerLightTweens(f.scene,f.object,duplicate,{}).light,null);
f.invoke('fx','onDestroy');assert.ok(f.light.tweenController,'Destroying flicker must preserve tween ownership');
const before={};const obj={getRenderer:()=>null};const sc={getElapsedTime:()=>500};
AL.registerLightTweens(sc,obj,before,{});const late=AL.registerLight(sc,obj,{}, {intensity:0});assert.ok(AL.startLightTween(sc,before,'Intensity',2,1,'Linear','Once'));AL.stepLightTweens(sc,obj,before);assert.equal(late.intensity,1);
console.log('LightTweens + Lightflickereffects: generated actions, 11 easing styles, independent playback and both execution orders passed.');
