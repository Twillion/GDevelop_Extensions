import fs from 'node:fs';

const runtime = fs.readFileSync('VolumetricFog.runtime.js', 'utf8');

const ev = (inlineCode) => [{ type: 'BuiltinCommonInstructions::JsCode', inlineCode }];
const param = (name, type, description, extra = {}) => ({ name, type, description, ...extra });
const prop = (name, type, description, label, extra = {}) => ({ name, type, description, label, ...extra });

const fogBehavior = {
  name: 'VolumetricFog',
  fullName: 'Volumetric Fog',
  description: 'Attach to a 3D Box to turn it into a volume of fog particles.',
  objectType: '',
  private: false,
  propertyDescriptors: [
    prop('ParticleCount', 'Number', 'Number of fog balls', 'Particle Count', { value: '1000' }),
    prop('ParticleSize', 'Number', 'Size of individual balls', 'Particle Size', { value: '1' }),
    prop('Color', 'Color', 'Fog color', 'Color', { value: '255;255;255' }),
    prop('MaxBlockers', 'Number', 'Maximum number of blockers supported', 'Max Blockers', { value: '10' })
  ],
  eventsFunctions: [
    {
      name: 'onCreated',
      functionType: 'BehaviorEvent',
      events: ev(`
        ${runtime}
        const obj = (typeof objects !== 'undefined' && objects.length) ? objects[0] : null;
        if (!obj) return;
        const fogRegistry = gdjs.__volumetricFog;
        
        const count = eventsFunctionContext.getArgument("ParticleCount");
        const size = eventsFunctionContext.getArgument("ParticleSize");
        const color = eventsFunctionContext.getArgument("Color");
        
        let hexColor = 0xffffff;
        if (typeof color === "string") {
          const parts = color.split(";").map(Number);
          if (parts.length === 3) {
            hexColor = (parts[0] << 16) | (parts[1] << 8) | parts[2];
          }
        }
        
        const maxBlockers = eventsFunctionContext.getArgument("MaxBlockers");
        
        fogRegistry.initFog(runtimeScene, obj, count, size, hexColor, maxBlockers);
      `)
    },
    {
      name: 'doStepPreEvents',
      functionType: 'BehaviorEvent',
      events: ev(`
        const obj = (typeof objects !== 'undefined' && objects.length) ? objects[0] : null;
        if (!obj) return;
        const fogRegistry = gdjs.__volumetricFog;
        fogRegistry.updateFog(runtimeScene, obj);
      `)
    }
  ]
};

const blockerBehavior = {
  name: 'VolumetricFogBlocker',
  fullName: 'Volumetric Fog Blocker',
  description: 'Attach to a 3D object to make it subtract from the volumetric fog.',
  objectType: '', // any object
  private: false,
  propertyDescriptors: [
    prop('ShapeType', 'Choice', '0 = Box, 1 = Sphere, 2 = Capsule', 'Collision Shape', {
      value: '0',
      extraInformation: ['0', '1', '2']
    }),
    prop('EnableCollisionMesh', 'Boolean', 'Use collision mesh instead of primitive shape (WIP)', 'Enable Collision Mesh', { value: 'false' })
  ],
  eventsFunctions: [
    {
      name: 'onCreated',
      functionType: 'BehaviorEvent',
      events: ev(`
        ${runtime}
        const obj = (typeof objects !== 'undefined' && objects.length) ? objects[0] : null;
        if (!obj) return;
        const fogRegistry = gdjs.__volumetricFog;
        
        const shapeType = eventsFunctionContext.getArgument("ShapeType");
        const enableCollisionMesh = eventsFunctionContext.getArgument("EnableCollisionMesh") === "true";
        
        fogRegistry.registerBlocker(runtimeScene, obj, parseInt(shapeType), enableCollisionMesh);
      `)
    },
    {
      name: 'onDestroy',
      functionType: 'BehaviorEvent',
      events: ev(`
        const obj = (typeof objects !== 'undefined' && objects.length) ? objects[0] : null;
        if (!obj) return;
        const fogRegistry = gdjs.__volumetricFog;
        fogRegistry.unregisterBlocker(runtimeScene, obj);
      `)
    }
  ]
};

const extension = {
  name: 'VolumetricFog',
  fullName: 'Volumetric Fog',
  description: 'Adds volumetric fog and dynamic boolean subtractive blockers for 3D scenes.',
  shortDescription: 'Volumetric fog with SDF boolean blockers.',
  category: '3D',
  author: '',
  license: 'MIT',
  version: '0.1.0',
  tags: ['3D', 'fog', 'volume', 'shader', 'SDF', 'boolean'],
  extensionNamespace: 'VolumetricFog',
  gdevelopVersion: '>=5.5.222',
  eventsFunctions: [],
  eventsBasedBehaviors: [fogBehavior, blockerBehavior]
};

fs.writeFileSync('VolumetricFog.json', JSON.stringify(extension, null, 2) + '\n');
console.log('Successfully generated VolumetricFog.json');
