import fs from 'node:fs';

const runtime = fs.readFileSync('Custom3DShaderBackend.runtime.js', 'utf8');

const ev = (inlineCode) => [{ type: 'BuiltinCommonInstructions::JsCode', inlineCode }];
const param = (name, type, description, extra = {}) => ({ name, type, description, ...extra });

const functions = [
  {
    name: 'onFirstSceneLoaded',
    functionType: 'Action',
    private: true,
    events: ev(runtime),
  },
  {
    name: 'Apply3DMaterialShader',
    functionType: 'Action',
    fullName: 'Apply 3D material shader',
    description: 'Replace compatible 3D mesh materials on selected objects with a custom GLSL ShaderMaterial.',
    sentence: 'Apply 3D material shader to _PARAM0_',
    parameters: [
      param('Object', 'object', '3D object'),
      param('VertexShader', 'string', 'Complete GLSL vertex shader. Leave empty to use the default backend vertex shader.', { optional: true, defaultValue: '' }),
      param('FragmentShader', 'string', 'Complete GLSL fragment shader. Leave empty to use the default backend material shader.', { optional: true, defaultValue: '' }),
      param('IncludeChildren', 'yesorno', 'Include child meshes', { optional: true, defaultValue: 'true' }),
      param('UseOriginalTexture', 'yesorno', 'Bind original material texture as uMap', { optional: true, defaultValue: 'true' }),
    ],
    events: ev(`const backend = gdjs.__custom3DShaderBackend;
if (!backend) return;
const objects = eventsFunctionContext.getObjects("Object");
for (let i = 0; i < objects.length; i++) {
  backend.applyMaterialShader(
    objects[i],
    eventsFunctionContext.getArgument("VertexShader"),
    eventsFunctionContext.getArgument("FragmentShader"),
    eventsFunctionContext.getArgument("IncludeChildren"),
    eventsFunctionContext.getArgument("UseOriginalTexture")
  );
}
return;`),
  },
  {
    name: 'Restore3DMaterialShader',
    functionType: 'Action',
    fullName: 'Restore 3D material shader',
    description: 'Restore original Three.js material assignments saved before applying a custom shader.',
    sentence: 'Restore original materials on _PARAM0_',
    parameters: [param('Object', 'object', '3D object')],
    events: ev(`const backend = gdjs.__custom3DShaderBackend;
if (!backend) return;
const objects = eventsFunctionContext.getObjects("Object");
for (let i = 0; i < objects.length; i++) backend.restoreMaterialShader(objects[i]);
return;`),
  },
  {
    name: 'Set3DMaterialShaderNumberUniform',
    functionType: 'Action',
    fullName: 'Set 3D material shader number uniform',
    description: 'Set or create a numeric uniform on custom material shaders applied to selected 3D objects.',
    sentence: 'Set material shader uniform _PARAM1_ on _PARAM0_ to _PARAM2_',
    parameters: [
      param('Object', 'object', '3D object'),
      param('UniformName', 'string', 'Uniform name'),
      param('Value', 'expression', 'Number value'),
    ],
    events: ev(`const backend = gdjs.__custom3DShaderBackend;
if (!backend) return;
const objects = eventsFunctionContext.getObjects("Object");
const uniformName = String(eventsFunctionContext.getArgument("UniformName") || "");
const value = eventsFunctionContext.getArgument("Value");
for (let i = 0; i < objects.length; i++) backend.setMaterialUniformNumber(objects[i], uniformName, value);
return;`),
  },
  {
    name: 'Set3DMaterialShaderColorUniform',
    functionType: 'Action',
    fullName: 'Set 3D material shader color uniform',
    description: 'Set or create a vec3 color uniform on custom material shaders applied to selected 3D objects.',
    sentence: 'Set material shader color uniform _PARAM1_ on _PARAM0_ to _PARAM2_;_PARAM3_;_PARAM4_',
    parameters: [
      param('Object', 'object', '3D object'),
      param('UniformName', 'string', 'Uniform name'),
      param('Red', 'expression', 'Red 0-255'),
      param('Green', 'expression', 'Green 0-255'),
      param('Blue', 'expression', 'Blue 0-255'),
    ],
    events: ev(`const backend = gdjs.__custom3DShaderBackend;
if (!backend) return;
const objects = eventsFunctionContext.getObjects("Object");
const uniformName = String(eventsFunctionContext.getArgument("UniformName") || "");
const r = eventsFunctionContext.getArgument("Red");
const g = eventsFunctionContext.getArgument("Green");
const b = eventsFunctionContext.getArgument("Blue");
for (let i = 0; i < objects.length; i++) backend.setMaterialUniformColor(objects[i], uniformName, r, g, b);
return;`),
  },
  {
    name: 'Start3DPostShader',
    functionType: 'Action',
    fullName: 'Start 3D post-process shader',
    description: 'Apply a custom GLSL fullscreen shader pass to the rendered 3D scene, using the same render-target approach as CRT+.',
    sentence: 'Start 3D post shader on layer _PARAM0_',
    parameters: [
      param('Layer3D', 'layer', '3D layer. Leave empty to process all 3D rendering.', { optional: true, defaultValue: '' }),
      param('FragmentShader', 'string', 'Complete GLSL fragment shader. Leave empty to use the default backend post shader.', { optional: true, defaultValue: '' }),
    ],
    events: ev(`const backend = gdjs.__custom3DShaderBackend;
if (!backend) return;
backend.startPostShader(runtimeScene, eventsFunctionContext.getArgument("Layer3D"), eventsFunctionContext.getArgument("FragmentShader"));
return;`),
  },
  {
    name: 'Stop3DPostShader',
    functionType: 'Action',
    fullName: 'Stop 3D post-process shader',
    description: 'Disable the custom 3D post-process shader.',
    sentence: 'Stop the 3D post shader',
    parameters: [],
    events: ev(`if (gdjs.__custom3DShaderBackend) gdjs.__custom3DShaderBackend.stopPostShader(runtimeScene);
return;`),
  },
  {
    name: 'Set3DPostShaderFragment',
    functionType: 'Action',
    fullName: 'Set 3D post-process fragment shader',
    description: 'Replace the active custom 3D post-process fragment shader.',
    sentence: 'Set 3D post shader fragment code',
    parameters: [param('FragmentShader', 'string', 'Complete GLSL fragment shader')],
    events: ev(`if (gdjs.__custom3DShaderBackend) gdjs.__custom3DShaderBackend.setPostFragmentShader(runtimeScene, eventsFunctionContext.getArgument("FragmentShader"));
return;`),
  },
  {
    name: 'Set3DPostShaderNumberUniform',
    functionType: 'Action',
    fullName: 'Set 3D post-process number uniform',
    description: 'Set or create a numeric uniform on the active 3D post-process shader.',
    sentence: 'Set post shader uniform _PARAM0_ to _PARAM1_',
    parameters: [
      param('UniformName', 'string', 'Uniform name'),
      param('Value', 'expression', 'Number value'),
    ],
    events: ev(`if (gdjs.__custom3DShaderBackend) gdjs.__custom3DShaderBackend.setPostUniformNumber(runtimeScene, String(eventsFunctionContext.getArgument("UniformName") || ""), eventsFunctionContext.getArgument("Value"));
return;`),
  },
  {
    name: 'Set3DPostShaderColorUniform',
    functionType: 'Action',
    fullName: 'Set 3D post-process color uniform',
    description: 'Set or create a vec3 color uniform on the active 3D post-process shader.',
    sentence: 'Set post shader color uniform _PARAM0_ to _PARAM1_;_PARAM2_;_PARAM3_',
    parameters: [
      param('UniformName', 'string', 'Uniform name'),
      param('Red', 'expression', 'Red 0-255'),
      param('Green', 'expression', 'Green 0-255'),
      param('Blue', 'expression', 'Blue 0-255'),
    ],
    events: ev(`if (gdjs.__custom3DShaderBackend) gdjs.__custom3DShaderBackend.setPostUniformColor(runtimeScene, String(eventsFunctionContext.getArgument("UniformName") || ""), eventsFunctionContext.getArgument("Red"), eventsFunctionContext.getArgument("Green"), eventsFunctionContext.getArgument("Blue"));
return;`),
  },
  {
    name: 'Custom3DPostShaderIsEnabled',
    functionType: 'Condition',
    fullName: '3D post-process shader is enabled',
    description: 'Check if the custom 3D post-process shader is enabled.',
    sentence: '3D post shader is enabled',
    parameters: [],
    events: ev('return gdjs.__custom3DShaderBackend ? gdjs.__custom3DShaderBackend.isPostEnabled(runtimeScene) : false;'),
  },
  {
    name: 'Custom3DMaterialShaderIsApplied',
    functionType: 'Condition',
    fullName: '3D material shader is applied',
    description: 'Check if selected 3D objects have custom material shaders applied.',
    sentence: '3D material shader is applied on _PARAM0_',
    parameters: [param('Object', 'object', '3D object')],
    events: ev(`const backend = gdjs.__custom3DShaderBackend;
if (!backend) return false;
const objects = eventsFunctionContext.getObjects("Object");
for (let i = 0; i < objects.length; i++) {
  if (backend.materialIsApplied(objects[i])) return true;
}
return false;`),
  },
  {
    name: 'Custom3DMaterialShaderCount',
    functionType: 'Expression',
    fullName: '3D material shader count',
    description: 'Return the number of ShaderMaterial instances managed on the first selected object.',
    expressionType: 'number',
    parameters: [param('Object', 'object', '3D object')],
    events: ev(`const backend = gdjs.__custom3DShaderBackend;
if (!backend) return 0;
const objects = eventsFunctionContext.getObjects("Object");
return objects.length ? backend.materialCount(objects[0]) : 0;`),
  },
  {
    name: 'Custom3DShaderLastError',
    functionType: 'StringExpression',
    fullName: 'Custom 3D shader last error',
    description: 'Return the last backend, material, or post-process shader error.',
    parameters: [],
    events: ev('return gdjs.__custom3DShaderBackend ? String(gdjs.__custom3DShaderBackend.lastError() || "") : "";'),
  },
  {
    name: 'Default3DMaterialVertexShader',
    functionType: 'StringExpression',
    fullName: 'Default 3D material vertex shader',
    description: 'Return the backend default complete material vertex shader.',
    parameters: [],
    events: ev('return gdjs.__custom3DShaderBackend ? gdjs.__custom3DShaderBackend.DEFAULT_VERTEX_SHADER : "";'),
  },
  {
    name: 'Default3DMaterialFragmentShader',
    functionType: 'StringExpression',
    fullName: 'Default 3D material fragment shader',
    description: 'Return the backend default complete material fragment shader.',
    parameters: [],
    events: ev('return gdjs.__custom3DShaderBackend ? gdjs.__custom3DShaderBackend.DEFAULT_MATERIAL_FRAGMENT_SHADER : "";'),
  },
  {
    name: 'Default3DPostFragmentShader',
    functionType: 'StringExpression',
    fullName: 'Default 3D post-process fragment shader',
    description: 'Return the backend default complete post-process fragment shader.',
    parameters: [],
    events: ev('return gdjs.__custom3DShaderBackend ? gdjs.__custom3DShaderBackend.DEFAULT_POST_FRAGMENT_SHADER : "";'),
  },
];

const extension = {
  name: 'Custom3DShaderBackend',
  fullName: 'Custom 3D Shader Backend',
  description: 'Backend for applying custom WebGL GLSL shaders to GDevelop 3D objects and CRT-style 3D post-processing passes.',
  shortDescription: 'Custom GLSL backend for 3D object materials and 3D post-processing.',
  category: '3D',
  author: 'Twillion',
  license: 'MIT',
  version: '0.1.0',
  tags: ['3D', 'shader', 'GLSL', 'Three.js', 'post-processing', 'material'],
  extensionNamespace: 'Custom3DShaderBackend',
  gdevelopVersion: '>=5.5.222',
  eventsFunctions: functions,
};

fs.writeFileSync('Custom3DShaderBackend.json', JSON.stringify(extension, null, 2) + '\n');
