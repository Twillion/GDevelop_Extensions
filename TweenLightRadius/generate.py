import json

extension = {
  "name": "TweenLightRadius",
  "fullName": "Tween Light Radius",
  "description": "An extension to smoothly tween the radius of a Light object over time. Supports standard easing functions, tween identifiers, and lifecycle management (pause, resume, stop).",
  "shortDescription": "Advanced tweening for a light's radius.",
  "category": "Visual Effect",
  "author": "",
  "license": "MIT",
  "version": "1.1.1",
  "tags": ["light", "lighting", "tween", "radius", "animation"],
  "extensionNamespace": "TweenLightRadius",
  "gdevelopVersion": ">=5.0.0",
  "eventsFunctions": [],
  "eventsBasedBehaviors": [
    {
      "name": "LightRadiusTweener",
      "fullName": "Light Radius Tweener",
      "description": "Attach this to a Light object to tween its radius.",
      "objectType": "Lighting::LightObject",
      "private": False,
      "propertyDescriptors": [],
      "eventsFunctions": [
        {
          "name": "TweenRadius",
          "fullName": "Tween Light Radius",
          "description": "Tween the radius of the light object to a new value.",
          "sentence": "Tween _PARAM0_ radius to _PARAM3_ over _PARAM4_ ms (Easing: _PARAM5_) (ID: _PARAM2_)",
          "functionType": "Action",
          "events": [
            {
              "type": "BuiltinCommonInstructions::JsCode",
              "inlineCode": """
const obj = objects[0];
if (!obj) return;

const tweenId = eventsFunctionContext.getArgument("TweenId") || "";
const targetRadius = eventsFunctionContext.getArgument("TargetRadius");
const duration = eventsFunctionContext.getArgument("Duration");
const easing = eventsFunctionContext.getArgument("Easing") || "linear";
const destroyOnFinish = eventsFunctionContext.getArgument("DestroyOnFinish") || false;

obj._lightRadiusTweens = obj._lightRadiusTweens || {};
obj._lightRadiusTweens[tweenId] = {
    timePassed: 0,
    duration: duration,
    startRadius: obj.getRadius(),
    targetRadius: targetRadius,
    easing: easing,
    playing: true,
    finished: false,
    destroyOnFinish: destroyOnFinish
};
"""
            }
          ],
          "parameters": [
            { "name": "Object", "type": "object", "description": "Light object", "extraInformation": ["Lighting::LightObject"] },
            { "name": "Behavior", "type": "behavior", "description": "Behavior", "extraInformation": ["TweenLightRadius::LightRadiusTweener"] },
            { "name": "TweenId", "type": "string", "description": "Tween Identifier", "value": "\"\"" },
            { "name": "TargetRadius", "type": "expression", "description": "Target Radius", "value": "100" },
            { "name": "Duration", "type": "expression", "description": "Duration (in ms)", "value": "1000" },
            { "name": "Easing", "type": "stringWithSelector", "description": "Easing function", "value": "\"linear\"", "extraInformation": [
              "\"linear\"", "\"easeInQuad\"", "\"easeOutQuad\"", "\"easeInOutQuad\"",
              "\"easeInCubic\"", "\"easeOutCubic\"", "\"easeInOutCubic\"",
              "\"easeInQuart\"", "\"easeOutQuart\"", "\"easeInOutQuart\"",
              "\"easeInQuint\"", "\"easeOutQuint\"", "\"easeInOutQuint\"",
              "\"easeInSine\"", "\"easeOutSine\"", "\"easeInOutSine\"",
              "\"easeInExpo\"", "\"easeOutExpo\"", "\"easeInOutExpo\"",
              "\"easeInCirc\"", "\"easeOutCirc\"", "\"easeInOutCirc\"",
              "\"easeInBack\"", "\"easeOutBack\"", "\"easeInOutBack\"",
              "\"easeInElastic\"", "\"easeOutElastic\"", "\"easeInOutElastic\"",
              "\"easeInBounce\"", "\"easeOutBounce\"", "\"easeInOutBounce\""
            ] },
            { "name": "DestroyOnFinish", "type": "yesorno", "description": "Destroy object when finished?", "value": "no" }
          ]
        },
        {
          "name": "doStepPreEvents",
          "functionType": "BehaviorEvent",
          "events": [
            {
              "type": "BuiltinCommonInstructions::JsCode",
              "inlineCode": """
const obj = objects[0];
if (!obj || !obj._lightRadiusTweens) return;

if (!gdjs.__tweenLightEasings) {
    gdjs.__tweenLightEasings = {
        linear: x => x,
        easeInQuad: x => x * x,
        easeOutQuad: x => 1 - (1 - x) * (1 - x),
        easeInOutQuad: x => x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2,
        easeInCubic: x => x * x * x,
        easeOutCubic: x => 1 - Math.pow(1 - x, 3),
        easeInOutCubic: x => x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2,
        easeInQuart: x => x * x * x * x,
        easeOutQuart: x => 1 - Math.pow(1 - x, 4),
        easeInOutQuart: x => x < 0.5 ? 8 * x * x * x * x : 1 - Math.pow(-2 * x + 2, 4) / 2,
        easeInQuint: x => x * x * x * x * x,
        easeOutQuint: x => 1 - Math.pow(1 - x, 5),
        easeInOutQuint: x => x < 0.5 ? 16 * x * x * x * x * x : 1 - Math.pow(-2 * x + 2, 5) / 2,
        easeInSine: x => 1 - Math.cos((x * Math.PI) / 2),
        easeOutSine: x => Math.sin((x * Math.PI) / 2),
        easeInOutSine: x => -(Math.cos(Math.PI * x) - 1) / 2,
        easeInExpo: x => x === 0 ? 0 : Math.pow(2, 10 * x - 10),
        easeOutExpo: x => x === 1 ? 1 : 1 - Math.pow(2, -10 * x),
        easeInOutExpo: x => x === 0 ? 0 : x === 1 ? 1 : x < 0.5 ? Math.pow(2, 20 * x - 10) / 2 : (2 - Math.pow(2, -20 * x + 10)) / 2,
        easeInCirc: x => 1 - Math.sqrt(1 - Math.pow(x, 2)),
        easeOutCirc: x => Math.sqrt(1 - Math.pow(x - 1, 2)),
        easeInOutCirc: x => x < 0.5 ? (1 - Math.sqrt(1 - Math.pow(2 * x, 2))) / 2 : (Math.sqrt(1 - Math.pow(-2 * x + 2, 2)) + 1) / 2,
        easeInBack: x => { const c1 = 1.70158; const c3 = c1 + 1; return c3 * x * x * x - c1 * x * x; },
        easeOutBack: x => { const c1 = 1.70158; const c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); },
        easeInOutBack: x => { const c1 = 1.70158; const c2 = c1 * 1.525; return x < 0.5 ? (Math.pow(2 * x, 2) * ((c2 + 1) * 2 * x - c2)) / 2 : (Math.pow(2 * x - 2, 2) * ((c2 + 1) * (x * 2 - 2) + c2) + 2) / 2; },
        easeInElastic: x => { const c4 = (2 * Math.PI) / 3; return x === 0 ? 0 : x === 1 ? 1 : -Math.pow(2, 10 * x - 10) * Math.sin((x * 10 - 10.75) * c4); },
        easeOutElastic: x => { const c4 = (2 * Math.PI) / 3; return x === 0 ? 0 : x === 1 ? 1 : Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * c4) + 1; },
        easeInOutElastic: x => { const c5 = (2 * Math.PI) / 4.5; return x === 0 ? 0 : x === 1 ? 1 : x < 0.5 ? -(Math.pow(2, 20 * x - 10) * Math.sin((20 * x - 11.125) * c5)) / 2 : (Math.pow(2, -20 * x + 10) * Math.sin((20 * x - 11.125) * c5)) / 2 + 1; },
        easeInBounce: x => 1 - gdjs.__tweenLightEasings.easeOutBounce(1 - x),
        easeOutBounce: x => { const n1 = 7.5625; const d1 = 2.75; if (x < 1 / d1) { return n1 * x * x; } else if (x < 2 / d1) { return n1 * (x -= 1.5 / d1) * x + 0.75; } else if (x < 2.5 / d1) { return n1 * (x -= 2.25 / d1) * x + 0.9375; } else { return n1 * (x -= 2.625 / d1) * x + 0.984375; } },
        easeInOutBounce: x => x < 0.5 ? (1 - gdjs.__tweenLightEasings.easeOutBounce(1 - 2 * x)) / 2 : (1 + gdjs.__tweenLightEasings.easeOutBounce(2 * x - 1)) / 2
    };
}

const dt = runtimeScene.getTimeManager().getElapsedTime(); // in ms

for (const id in obj._lightRadiusTweens) {
    const tween = obj._lightRadiusTweens[id];
    if (!tween.playing || tween.finished) continue;

    tween.timePassed += dt;
    let t = tween.duration > 0 ? tween.timePassed / tween.duration : 1.0;

    if (t >= 1.0) {
        t = 1.0;
        tween.playing = false;
        tween.finished = true;
    }

    const easeFunc = gdjs.__tweenLightEasings[tween.easing] || gdjs.__tweenLightEasings.linear;
    const easedT = easeFunc(t);

    const newRadius = tween.startRadius + (tween.targetRadius - tween.startRadius) * easedT;
    obj.setRadius(newRadius);

    if (tween.finished && tween.destroyOnFinish) {
        obj.deleteFromScene(runtimeScene);
    }
}
"""
            }
          ],
          "parameters": [
            { "name": "Object", "type": "object", "description": "Light object", "extraInformation": ["Lighting::LightObject"] },
            { "name": "Behavior", "type": "behavior", "description": "Behavior", "extraInformation": ["TweenLightRadius::LightRadiusTweener"] }
          ]
        },
        {
          "name": "IsPlaying",
          "fullName": "Tween is playing",
          "description": "Check if a radius tween is currently playing.",
          "sentence": "Radius tween _PARAM2_ on _PARAM0_ is playing",
          "functionType": "Condition",
          "events": [
            {
              "type": "BuiltinCommonInstructions::JsCode",
              "inlineCode": """
const obj = objects[0];
const id = eventsFunctionContext.getArgument("TweenId");
const tween = obj && obj._lightRadiusTweens && obj._lightRadiusTweens[id];
eventsFunctionContext.returnValue = tween ? tween.playing : false;
"""
            }
          ],
          "parameters": [
            { "name": "Object", "type": "object", "description": "Light object", "extraInformation": ["Lighting::LightObject"] },
            { "name": "Behavior", "type": "behavior", "description": "Behavior", "extraInformation": ["TweenLightRadius::LightRadiusTweener"] },
            { "name": "TweenId", "type": "string", "description": "Tween Identifier", "value": "\"\"" }
          ]
        },
        {
          "name": "HasFinished",
          "fullName": "Tween has finished",
          "description": "Check if a radius tween has finished playing.",
          "sentence": "Radius tween _PARAM2_ on _PARAM0_ has finished",
          "functionType": "Condition",
          "events": [
            {
              "type": "BuiltinCommonInstructions::JsCode",
              "inlineCode": """
const obj = objects[0];
const id = eventsFunctionContext.getArgument("TweenId");
const tween = obj && obj._lightRadiusTweens && obj._lightRadiusTweens[id];
eventsFunctionContext.returnValue = tween ? tween.finished : false;
"""
            }
          ],
          "parameters": [
            { "name": "Object", "type": "object", "description": "Light object", "extraInformation": ["Lighting::LightObject"] },
            { "name": "Behavior", "type": "behavior", "description": "Behavior", "extraInformation": ["TweenLightRadius::LightRadiusTweener"] },
            { "name": "TweenId", "type": "string", "description": "Tween Identifier", "value": "\"\"" }
          ]
        },
        {
          "name": "Exists",
          "fullName": "Tween exists",
          "description": "Check if a radius tween exists.",
          "sentence": "Radius tween _PARAM2_ exists on _PARAM0_",
          "functionType": "Condition",
          "events": [
            {
              "type": "BuiltinCommonInstructions::JsCode",
              "inlineCode": """
const obj = objects[0];
const id = eventsFunctionContext.getArgument("TweenId");
eventsFunctionContext.returnValue = !!(obj && obj._lightRadiusTweens && obj._lightRadiusTweens[id]);
"""
            }
          ],
          "parameters": [
            { "name": "Object", "type": "object", "description": "Light object", "extraInformation": ["Lighting::LightObject"] },
            { "name": "Behavior", "type": "behavior", "description": "Behavior", "extraInformation": ["TweenLightRadius::LightRadiusTweener"] },
            { "name": "TweenId", "type": "string", "description": "Tween Identifier", "value": "\"\"" }
          ]
        },
        {
          "name": "StopTween",
          "fullName": "Stop Tween",
          "description": "Stop a radius tween on the light.",
          "sentence": "Stop radius tween _PARAM2_ on _PARAM0_",
          "functionType": "Action",
          "events": [
            {
              "type": "BuiltinCommonInstructions::JsCode",
              "inlineCode": """
const obj = objects[0];
const id = eventsFunctionContext.getArgument("TweenId");
if (obj && obj._lightRadiusTweens && obj._lightRadiusTweens[id]) {
    obj._lightRadiusTweens[id].playing = false;
    obj._lightRadiusTweens[id].finished = true; // Treating stop as finish
}
"""
            }
          ],
          "parameters": [
            { "name": "Object", "type": "object", "description": "Light object", "extraInformation": ["Lighting::LightObject"] },
            { "name": "Behavior", "type": "behavior", "description": "Behavior", "extraInformation": ["TweenLightRadius::LightRadiusTweener"] },
            { "name": "TweenId", "type": "string", "description": "Tween Identifier", "value": "\"\"" }
          ]
        },
        {
          "name": "PauseTween",
          "fullName": "Pause Tween",
          "description": "Pause a radius tween on the light.",
          "sentence": "Pause radius tween _PARAM2_ on _PARAM0_",
          "functionType": "Action",
          "events": [
            {
              "type": "BuiltinCommonInstructions::JsCode",
              "inlineCode": """
const obj = objects[0];
const id = eventsFunctionContext.getArgument("TweenId");
if (obj && obj._lightRadiusTweens && obj._lightRadiusTweens[id] && !obj._lightRadiusTweens[id].finished) {
    obj._lightRadiusTweens[id].playing = false;
}
"""
            }
          ],
          "parameters": [
            { "name": "Object", "type": "object", "description": "Light object", "extraInformation": ["Lighting::LightObject"] },
            { "name": "Behavior", "type": "behavior", "description": "Behavior", "extraInformation": ["TweenLightRadius::LightRadiusTweener"] },
            { "name": "TweenId", "type": "string", "description": "Tween Identifier", "value": "\"\"" }
          ]
        },
        {
          "name": "ResumeTween",
          "fullName": "Resume Tween",
          "description": "Resume a paused radius tween on the light.",
          "sentence": "Resume radius tween _PARAM2_ on _PARAM0_",
          "functionType": "Action",
          "events": [
            {
              "type": "BuiltinCommonInstructions::JsCode",
              "inlineCode": """
const obj = objects[0];
const id = eventsFunctionContext.getArgument("TweenId");
if (obj && obj._lightRadiusTweens && obj._lightRadiusTweens[id] && !obj._lightRadiusTweens[id].finished) {
    obj._lightRadiusTweens[id].playing = true;
}
"""
            }
          ],
          "parameters": [
            { "name": "Object", "type": "object", "description": "Light object", "extraInformation": ["Lighting::LightObject"] },
            { "name": "Behavior", "type": "behavior", "description": "Behavior", "extraInformation": ["TweenLightRadius::LightRadiusTweener"] },
            { "name": "TweenId", "type": "string", "description": "Tween Identifier", "value": "\"\"" }
          ]
        },
        {
          "name": "RemoveTween",
          "fullName": "Remove Tween",
          "description": "Remove a radius tween on the light.",
          "sentence": "Remove radius tween _PARAM2_ on _PARAM0_",
          "functionType": "Action",
          "events": [
            {
              "type": "BuiltinCommonInstructions::JsCode",
              "inlineCode": """
const obj = objects[0];
const id = eventsFunctionContext.getArgument("TweenId");
if (obj && obj._lightRadiusTweens && obj._lightRadiusTweens[id]) {
    delete obj._lightRadiusTweens[id];
}
"""
            }
          ],
          "parameters": [
            { "name": "Object", "type": "object", "description": "Light object", "extraInformation": ["Lighting::LightObject"] },
            { "name": "Behavior", "type": "behavior", "description": "Behavior", "extraInformation": ["TweenLightRadius::LightRadiusTweener"] },
            { "name": "TweenId", "type": "string", "description": "Tween Identifier", "value": "\"\"" }
          ]
        },
        {
          "name": "Progress",
          "fullName": "Tween progress",
          "description": "Get the progress of a radius tween (from 0 to 1).",
          "sentence": "Progress of radius tween _PARAM2_",
          "functionType": "Expression",
          "events": [
            {
              "type": "BuiltinCommonInstructions::JsCode",
              "inlineCode": """
const obj = objects[0];
const id = eventsFunctionContext.getArgument("TweenId");
const tween = obj && obj._lightRadiusTweens && obj._lightRadiusTweens[id];
if (tween) {
    eventsFunctionContext.returnValue = tween.duration > 0 ? Math.min(1.0, tween.timePassed / tween.duration) : 1.0;
} else {
    eventsFunctionContext.returnValue = 0;
}
"""
            }
          ],
          "parameters": [
            { "name": "Object", "type": "object", "description": "Light object", "extraInformation": ["Lighting::LightObject"] },
            { "name": "Behavior", "type": "behavior", "description": "Behavior", "extraInformation": ["TweenLightRadius::LightRadiusTweener"] },
            { "name": "TweenId", "type": "string", "description": "Tween Identifier", "value": "\"\"" }
          ]
        }
      ]
    }
  ]
}

with open("c:\\Users\\chris\\OneDrive\\Documents\\Extensions for gdevelop\\TweenLightRadius\\TweenLightRadius.json", "w") as f:
    json.dump(extension, f, indent=2)
