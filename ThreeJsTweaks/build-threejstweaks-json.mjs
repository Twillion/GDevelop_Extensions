import fs from 'node:fs';

const ev = (inlineCode) => [{ type: 'BuiltinCommonInstructions::JsCode', inlineCode }];
const param = (name, type, description, extra = {}) => ({ name, type, description, ...extra });
const prop = (name, type, description, label, extra = {}) => ({ name, type, description, label, ...extra });

const tweaksBehavior = {
  name: 'ThreeJsSceneTweaks',
  fullName: 'Three.js Scene Tweaks',
  description: 'Attach to an object to expose advanced Three.js global scene and renderer settings in the properties panel.',
  objectType: '', 
  private: false,
  propertyDescriptors: [
    prop('ShadowMapType', 'Choice', 'Controls the algorithm used for casting 3D shadows.', 'Shadow Map Type', {
      value: 'PCFSoftShadowMap',
      extraInformation: ['BasicShadowMap', 'PCFShadowMap', 'PCFSoftShadowMap', 'VSMShadowMap']
    }),
    prop('ToneMapping', 'Choice', 'Controls the algorithm used to approximate HDR color onto the LDR screen.', 'Tone Mapping', {
      value: 'ACESFilmicToneMapping',
      extraInformation: ['NoToneMapping', 'LinearToneMapping', 'ReinhardToneMapping', 'CineonToneMapping', 'ACESFilmicToneMapping', 'AgXToneMapping']
    }),
    prop('ToneMappingExposure', 'Number', 'Exposure level for tone mapping (default 1.0)', 'Tone Mapping Exposure', { value: '1.0' }),
    prop('ShadowRadius', 'Number', 'Shadow Blur Radius (default 1.0). Increase for softer shadows (PCFSoft and VSM only).', 'Shadow Blur Radius', { value: '1.0' }),
    prop('GlobalShadowBias', 'Number', 'Global shadow map bias. Use a tiny negative number (e.g. -0.001) to reduce shadow acne.', 'Global Shadow Bias', { value: '0' }),
    prop('GlobalShadowNormalBias', 'Number', 'Global normal bias. Pushes shadow receiver along its normal to fix acne on curved/extruded meshes. (e.g. 0.05)', 'Global Shadow Normal Bias', { value: '0' })
  ],
  eventsFunctions: [
    {
      name: 'onCreated',
      functionType: 'BehaviorEvent',
      events: ev(`
        // Grab the Three.js renderer from GDevelop's game instance
        const renderer = runtimeScene.getGame().getRenderer().getThreeRenderer();
        if (renderer) {
           
           let needsMaterialUpdate = false;
           
           // --- SHADOW MAP TYPE ---
           const shadowTypeStr = eventsFunctionContext.getArgument("ShadowMapType");
           let shadowType = 1; // Default PCF
           if (shadowTypeStr === "BasicShadowMap") shadowType = 0;
           else if (shadowTypeStr === "PCFSoftShadowMap") shadowType = 2;
           else if (shadowTypeStr === "VSMShadowMap") shadowType = 3;
           
           if (renderer.shadowMap && renderer.shadowMap.type !== shadowType) {
               renderer.shadowMap.type = shadowType;
               renderer.shadowMap.needsUpdate = true;
               needsMaterialUpdate = true;
           }
           
           // --- TONE MAPPING ---
           const toneStr = eventsFunctionContext.getArgument("ToneMapping");
           let toneMapping = 0; // Default NoToneMapping
           if (toneStr === "LinearToneMapping") toneMapping = 1;
           else if (toneStr === "ReinhardToneMapping") toneMapping = 2;
           else if (toneStr === "CineonToneMapping") toneMapping = 3;
           else if (toneStr === "ACESFilmicToneMapping") toneMapping = 4;
           else if (toneStr === "AgXToneMapping") toneMapping = 5;
           
           if (renderer.toneMapping !== toneMapping) {
               renderer.toneMapping = toneMapping;
               needsMaterialUpdate = true;
           }
           
           if (needsMaterialUpdate) {
               const updateMaterials = function(scene) {
                   if (!scene) return;
                   scene.traverse(function(child) {
                       if (child.isMesh && child.material) {
                           if (Array.isArray(child.material)) {
                               child.material.forEach(function(m) { m.needsUpdate = true; });
                           } else {
                               child.material.needsUpdate = true;
                           }
                       }
                   });
               };

               const processLayer = function(layer) {
                   if (layer && layer.getRenderer && layer.getRenderer().getThreeScene) {
                       updateMaterials(layer.getRenderer().getThreeScene());
                   }
               };

               if (runtimeScene._layers && runtimeScene._layers.items) {
                   for (const k in runtimeScene._layers.items) {
                       processLayer(runtimeScene._layers.items[k]);
                   }
               } else if (runtimeScene._layers && typeof runtimeScene._layers === "object") {
                   for (const k in runtimeScene._layers) {
                       processLayer(runtimeScene._layers[k]);
                   }
               } else {
                   processLayer(runtimeScene.getLayer(""));
               }
           }
           
           // --- EXPOSURE ---
           const exposureStr = eventsFunctionContext.getArgument("ToneMappingExposure");
           const exposure = parseFloat(exposureStr);
           if (!isNaN(exposure)) {
               renderer.toneMappingExposure = exposure;
           }
        }
      `)
    },
    {
      name: 'doStepPreEvents',
      functionType: 'BehaviorEvent',
      events: ev(`
        const radiusStr = eventsFunctionContext.getArgument("ShadowRadius");
        const biasStr = eventsFunctionContext.getArgument("GlobalShadowBias");
        const normalBiasStr = eventsFunctionContext.getArgument("GlobalShadowNormalBias");
        
        const radius = parseFloat(radiusStr);
        const bias = parseFloat(biasStr);
        const normalBias = parseFloat(normalBiasStr);
        
        if (isNaN(radius) && isNaN(bias) && isNaN(normalBias)) return;
        
        const processLayerLights = function(layer) {
            if (layer && layer.getRenderer && layer.getRenderer().getThreeScene) {
                const scene = layer.getRenderer().getThreeScene();
                scene.traverse(function(child) {
                    if (child.isLight && child.shadow) {
                        if (!isNaN(radius) && child.shadow.radius !== radius) child.shadow.radius = radius;
                        if (!isNaN(bias) && child.shadow.bias !== bias) child.shadow.bias = bias;
                        if (!isNaN(normalBias) && child.shadow.normalBias !== normalBias) child.shadow.normalBias = normalBias;
                    }
                });
            }
        };

        if (runtimeScene._layers && runtimeScene._layers.items) {
            for (const k in runtimeScene._layers.items) {
                processLayerLights(runtimeScene._layers.items[k]);
            }
        } else if (runtimeScene._layers && typeof runtimeScene._layers === "object") {
            for (const k in runtimeScene._layers) {
                processLayerLights(runtimeScene._layers[k]);
            }
        } else {
            processLayerLights(runtimeScene.getLayer(""));
        }
      `)
    }
  ]
};

const extension = {
  name: 'ThreeJsTweaks',
  fullName: 'Three.js Tweaks',
  description: 'Exposes advanced Three.js rendering settings (Soft Shadows, ACES Filmic Tone Mapping) natively in GDevelop.',
  shortDescription: 'Advanced Three.js settings like Soft Shadows and Tone Mapping.',
  category: '3D',
  author: '',
  license: 'MIT',
  version: '0.1.0',
  tags: ['3D', 'rendering', 'shadows', 'soft shadows', 'tone mapping', 'three.js'],
  extensionNamespace: 'ThreeJsTweaks',
  gdevelopVersion: '>=5.5.222',
  eventsFunctions: [],
  eventsBasedBehaviors: [tweaksBehavior]
};

fs.writeFileSync('ThreeJsTweaks.json', JSON.stringify(extension, null, 2) + '\n');
console.log('Successfully generated ThreeJsTweaks.json');
